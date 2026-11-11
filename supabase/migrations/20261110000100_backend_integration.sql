-- Backend Core Integration (ADR-0015): where the Event Bus, the central audit and Storage persist.
-- Three tenant tables, each with RLS on from the moment it exists, and the functions that write to them. As everywhere else in this schema, members only
-- READ the tables; every write goes through a function that checks the right to write in that company. The tables are append-only (the central audit is
-- also a hash chain whose continuity the database enforces). Storage gets a private bucket and policies that tie every object to its company's folder.
-- Fictitious data only: nothing here makes real customer data admissible (ADR-0006 gates are unchanged).
--
-- Reversal plan (development only): drop the three tables and the functions created here, restore delete_company from 20261106000400, and
-- delete the storage policies and the bucket named below.

-- ---------------------------------------------------------------------------
-- Tables (no FK to tenants, like the other logs: delete_company removes their rows explicitly)
-- ---------------------------------------------------------------------------

-- What every module publishes on the internal Event Bus. event_id is the bus id: a repeated one is ignored.
create table public.platform_events (
  id uuid not null default private.uuid_v7(),
  tenant_id uuid not null,
  organization_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  event_id text not null check (char_length(event_id) between 1 and 64),
  type text not null check (char_length(type) between 3 and 80),
  module text not null check (char_length(module) between 2 and 40),
  actor text not null check (char_length(actor) between 1 and 64),
  correlation_id text check (char_length(correlation_id) <= 64),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) < 16384),
  seq bigint generated always as identity,
  primary key (id),
  unique (tenant_id, event_id)
);
create index platform_events_tenant_seq_idx on public.platform_events (tenant_id, seq desc);
create index platform_events_type_idx on public.platform_events (tenant_id, type, created_at desc);

-- The central audit: who did what, in which company, with what result. Each record is chained to the previous one of its company.
create table public.platform_audit (
  id uuid not null default private.uuid_v7(),
  tenant_id uuid not null,
  organization_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  record_id text not null check (char_length(record_id) between 1 and 120),
  seq int not null check (seq >= 1),
  actor_id text not null check (char_length(actor_id) between 1 and 64),
  actor_kind text not null check (actor_kind in ('person', 'worker', 'system')),
  module text not null check (char_length(module) between 2 and 40),
  action text not null check (char_length(action) between 1 and 160),
  category text not null check (char_length(category) between 1 and 80),
  target text check (char_length(target) <= 120),
  detail text check (char_length(detail) <= 2000),
  outcome text not null check (outcome in ('success', 'refused', 'error')),
  request_id text check (char_length(request_id) <= 64),
  prev_hash text not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  primary key (id),
  unique (tenant_id, seq)
);

-- The files of a company: where each one is, its type and size. Retired files stay in the table (a file is retired, not erased).
create table public.storage_objects (
  id uuid not null default private.uuid_v7(),
  tenant_id uuid not null,
  organization_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,
  bucket text not null check (bucket in ('documents', 'images', 'videos', 'avatars', 'academy', 'marketplace')),
  path text not null check (char_length(path) between 3 and 400),
  mime text not null check (char_length(mime) between 3 and 120),
  bytes bigint not null check (bytes >= 1),
  scanned boolean not null default false,
  retired_at timestamptz,
  primary key (id),
  unique (tenant_id, path),
  -- the first folder of the path is the company: the same rule the Storage policies use
  check (path like tenant_id::text || '/%')
);
create index storage_objects_tenant_idx on public.storage_objects (tenant_id, created_at desc);

create trigger platform_events_append_only before update or delete on public.platform_events
  for each row execute function private.reject_mutation();
create trigger platform_audit_append_only before update or delete on public.platform_audit
  for each row execute function private.reject_mutation();

-- ---------------------------------------------------------------------------
-- RLS: members read; nobody writes directly
-- ---------------------------------------------------------------------------
alter table public.platform_events enable row level security;
alter table public.platform_audit enable row level security;
alter table public.storage_objects enable row level security;

revoke all on table public.platform_events, public.platform_audit, public.storage_objects from public, anon, authenticated, service_role;
grant select on table public.platform_events, public.platform_audit, public.storage_objects to authenticated;

create policy platform_events_select on public.platform_events
  for select to authenticated using ((select private.is_member(tenant_id)));
create policy platform_audit_select on public.platform_audit
  for select to authenticated using ((select private.is_member(tenant_id)));
create policy storage_objects_select on public.storage_objects
  for select to authenticated using ((select private.is_member(tenant_id)));

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

-- Publishes events of ONE company. Up to 200 at a time; an event_id already stored is ignored. Returns how many were new.
create function public.append_platform_events(p_tenant uuid, p_events jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare v_count int;
begin
  perform private.require_write(p_tenant);
  if coalesce(jsonb_typeof(p_events), '') <> 'array' or jsonb_array_length(p_events) > 200 then
    raise exception 'invalid events' using errcode = '22023';
  end if;
  with input as (
    select e.* from jsonb_to_recordset(p_events)
      as e(event_id text, type text, module text, actor text, correlation_id text, payload jsonb, at timestamptz, organization_id uuid)
  ), inserted as (
    insert into public.platform_events (tenant_id, organization_id, created_at, updated_at, created_by, event_id, type, module, actor, correlation_id, payload)
    select p_tenant, organization_id, coalesce(at, now()), coalesce(at, now()), (select auth.uid()), event_id, type, module, actor, correlation_id, coalesce(payload, '{}'::jsonb)
    from input
    on conflict (tenant_id, event_id) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end;
$$;

-- Appends audit records of ONE company, in order. The database enforces the chain: each record must continue the one before it (seq + 1 and the previous hash).
-- A record that is already stored is skipped when it is identical and refused when it is not, so replaying is safe and rewriting history is not possible.
create function public.append_platform_audit(p_tenant uuid, p_records jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare r jsonb; v_seq int; v_hash text; v_n int := 0;
begin
  perform private.require_write(p_tenant);
  if coalesce(jsonb_typeof(p_records), '') <> 'array' or jsonb_array_length(p_records) > 200 then
    raise exception 'invalid records' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('platform_audit:' || p_tenant::text, 0));
  select seq, hash into v_seq, v_hash from public.platform_audit where tenant_id = p_tenant order by seq desc limit 1;
  v_seq := coalesce(v_seq, 0);
  v_hash := coalesce(v_hash, repeat('0', 64));
  for r in select value from jsonb_array_elements(p_records) loop
    if (r ->> 'seq')::int <= v_seq then
      if not exists (select 1 from public.platform_audit where tenant_id = p_tenant and seq = (r ->> 'seq')::int and hash = r ->> 'hash') then
        raise exception 'audit record conflicts with the stored history' using errcode = '23514';
      end if;
      continue;
    end if;
    if (r ->> 'seq')::int <> v_seq + 1 or r ->> 'prev_hash' is distinct from v_hash then
      raise exception 'audit chain broken' using errcode = '23514';
    end if;
    insert into public.platform_audit (tenant_id, created_at, updated_at, created_by, record_id, seq, actor_id, actor_kind, module, action, category, target, detail, outcome, request_id, prev_hash, hash)
    values (p_tenant, coalesce((r ->> 'at')::timestamptz, now()), coalesce((r ->> 'at')::timestamptz, now()), (select auth.uid()), r ->> 'record_id', (r ->> 'seq')::int,
            r ->> 'actor_id', r ->> 'actor_kind', r ->> 'module', r ->> 'action', r ->> 'category', r ->> 'target', r ->> 'detail', r ->> 'outcome', r ->> 'request_id',
            r ->> 'prev_hash', r ->> 'hash');
    v_seq := v_seq + 1;
    v_hash := r ->> 'hash';
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Registers a file of a company. The path must start with the company id; a path already registered is ignored.
create function public.register_storage_object(p_tenant uuid, p_bucket text, p_path text, p_mime text, p_bytes bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  perform private.require_write(p_tenant);
  if p_path not like p_tenant::text || '/%' then raise exception 'path outside the company folder' using errcode = '42501'; end if;
  insert into public.storage_objects (tenant_id, created_by, bucket, path, mime, bytes)
  values (p_tenant, (select auth.uid()), p_bucket, p_path, p_mime, p_bytes)
  on conflict (tenant_id, path) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- Retires a file: it stays registered, marked, and is no longer offered.
create function public.retire_storage_object(p_tenant uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_write(p_tenant);
  update public.storage_objects set retired_at = now(), updated_at = now() where tenant_id = p_tenant and path = p_path and retired_at is null;
end;
$$;

revoke execute on function
  public.append_platform_events(uuid, jsonb), public.append_platform_audit(uuid, jsonb),
  public.register_storage_object(uuid, text, text, text, bigint), public.retire_storage_object(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.append_platform_events(uuid, jsonb), public.append_platform_audit(uuid, jsonb),
  public.register_storage_object(uuid, text, text, text, bigint), public.retire_storage_object(uuid, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Deleting a company removes these rows too (the cascade does not reach them)
-- ---------------------------------------------------------------------------
create or replace function public.delete_company(p_tenant uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_name text;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not private.has_role(p_tenant, array['owner']) then raise exception 'forbidden' using errcode = '42501'; end if;
  select name into v_name from public.tenants where id = p_tenant;
  if v_name is distinct from btrim(p_confirm_name) then raise exception 'confirmation does not match' using errcode = '22023'; end if;

  perform set_config('kynova.allow_log_delete', 'on', true);
  delete from public.messages where tenant_id = p_tenant;
  delete from public.inbound_events where tenant_id = p_tenant;
  delete from public.inbound_dedup where integration_account_id in (select id from public.integration_accounts where tenant_id = p_tenant);
  delete from public.platform_events where tenant_id = p_tenant;
  delete from public.platform_audit where tenant_id = p_tenant;
  delete from public.storage_objects where tenant_id = p_tenant;
  delete from public.tenants where id = p_tenant;
  -- The cascade fires the audit triggers: clear what it wrote.
  delete from public.action_log where tenant_id = p_tenant;
  delete from public.audit_log where tenant_id = p_tenant;
  perform set_config('kynova.allow_log_delete', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage (only where the Supabase storage schema exists: a plain Postgres, like the one the tests use, skips this block)
-- ---------------------------------------------------------------------------
do $storage$
begin
  if to_regnamespace('storage') is null then
    return;
  end if;
  -- One private bucket for company documents. The first folder of every object path is the company id.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('documents', 'documents', false, 26214400,
          array['application/pdf', 'text/plain', 'text/csv',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
  on conflict (id) do nothing;

  -- Members read their company's folder; writers add to it. No update and no delete: a file is retired in public.storage_objects, never erased.
  execute $p$
    create policy documents_select on storage.objects for select to authenticated
    using (bucket_id = 'documents' and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           and (select private.is_member(((storage.foldername(name))[1])::uuid)))
  $p$;
  execute $p$
    create policy documents_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'documents' and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                and (select private.can_write(((storage.foldername(name))[1])::uuid)))
  $p$;
end
$storage$;
