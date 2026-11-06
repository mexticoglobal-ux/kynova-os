-- Backend Core v1 (ADR-0010) · 1 of 4: foundations.
-- Roles, helper functions, monthly partitions, the two append-only logs and the row-audit trigger.
-- One logical change: everything here ships together and every table has RLS and minimum privileges.
--
-- Apply only to a disposable development project from the SQL editor, never `supabase db push` without
-- approval (AGENTS.md 7.11). Fictitious data only (ADR-0006).
--
-- Reversal plan (development only, destroys data): drop the objects created here in reverse order
-- (audit_log, action_log, the private helpers, the `parts` schema), then restore the two-role check:
--   alter table public.memberships drop constraint memberships_role_check;
--   alter table public.memberships add constraint memberships_role_check check (role in ('owner', 'member'));

create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- Partitions live outside `public` so the API never exposes them as tables.
create schema if not exists parts;
revoke all on schema parts from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Roles and tenant slug
-- ---------------------------------------------------------------------------

-- owner: everything; admin: everything except ownership; member: works the commercial data; viewer: read only.
alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.memberships
  add constraint memberships_role_check check (role in ('owner', 'admin', 'member', 'viewer'));

alter table public.tenants add column if not exists slug text;
alter table public.tenants
  add constraint tenants_slug_check check (slug is null or (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 60));
create unique index tenants_slug_key on public.tenants (slug) where slug is not null;
create index memberships_user_id_idx on public.memberships (user_id);

-- ---------------------------------------------------------------------------
-- Helper functions (private schema: not exposed by the API)
-- ---------------------------------------------------------------------------

-- Time-ordered UUID (v7) for high-volume tables: near-sequential inserts keep indexes compact.
create function private.uuid_v7()
returns uuid
language sql
volatile
set search_path = ''
as $$
  select encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid()) placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3) from 1 for 6),
        52, 1),
      53, 1),
    'hex')::uuid;
$$;

create function private.has_role(target_tenant uuid, allowed text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = target_tenant
      and m.user_id = (select auth.uid())
      and m.role = any (allowed)
      and t.status = 'active'
  );
$$;

-- Who may work the commercial data, and who may administer the tenant.
create function private.can_write(target_tenant uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select private.has_role(target_tenant, array['owner', 'admin', 'member']); $$;

create function private.is_admin(target_tenant uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select private.has_role(target_tenant, array['owner', 'admin']); $$;

-- Teammates see each other's display name, nobody else's.
create function private.shares_tenant_with(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.tenant_id = mine.tenant_id
    join public.tenants t on t.id = mine.tenant_id and t.status = 'active'
    where mine.user_id = (select auth.uid()) and theirs.user_id = other_user
  );
$$;

create function private.protect_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

create function private.reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only delete_company sets this, inside its own transaction, to remove a deleted tenant's rows. The API roles hold
  -- no DELETE privilege on these tables anyway; this trigger guards the owner role and any future grant.
  if tg_op = 'DELETE' and current_setting('kynova.allow_log_delete', true) = 'on' then
    return old;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;

-- ---------------------------------------------------------------------------
-- Monthly partitions
-- ---------------------------------------------------------------------------

-- Creates the partitions from `months_back` before to `months_ahead` after the current month, plus a default
-- one so an insert never fails for lack of a partition. Run on every migration and then monthly (maintain_partitions).
create function private.ensure_partitions(parent text, months_back int, months_ahead int)
returns void
language plpgsql
set search_path = ''
as $$
declare
  month_start date;
  part text;
begin
  for i in -months_back .. months_ahead loop
    month_start := (date_trunc('month', now() at time zone 'utc') + make_interval(months => i))::date;
    part := format('%s_y%sm%s', parent, to_char(month_start, 'YYYY'), to_char(month_start, 'MM'));
    if to_regclass(format('parts.%I', part)) is null then
      execute format(
        'create table parts.%I partition of public.%I for values from (%L) to (%L)',
        part, parent,
        to_char(month_start, 'YYYY-MM-DD') || ' 00:00:00+00',
        to_char((month_start + interval '1 month')::date, 'YYYY-MM-DD') || ' 00:00:00+00'
      );
      execute format('revoke all on table parts.%I from public, anon, authenticated, service_role', part);
    end if;
  end loop;
  if to_regclass(format('parts.%I', parent || '_default')) is null then
    execute format('create table parts.%I partition of public.%I default', parent || '_default', parent);
    execute format('revoke all on table parts.%I from public, anon, authenticated, service_role', parent || '_default');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Append-only logs (partitioned by month)
-- ---------------------------------------------------------------------------

-- What NEX, a person or a system did, why, and under which authorization (ADR-0009 shape).
create table public.action_log (
  id uuid not null default private.uuid_v7(),
  occurred_at timestamptz not null default now(),
  -- No FK to tenants: the logs outlive a cascade and delete_company removes a tenant's rows explicitly.
  tenant_id uuid not null,
  actor_type text not null check (actor_type in ('user', 'nex', 'system', 'integration')),
  actor_id uuid,
  action_kind text not null check (char_length(action_kind) between 1 and 80),
  level smallint not null default 1 check (level in (1, 2, 3)),
  summary text not null check (char_length(summary) between 1 and 500),
  reason text check (char_length(reason) <= 500),
  authorization_id uuid,
  approval_request_id uuid,
  contact_id uuid,
  lead_id uuid,
  opportunity_id uuid,
  conversation_id uuid,
  outcome text not null default 'ok' check (outcome in ('ok', 'failed', 'blocked')),
  request_id text,
  primary key (id, occurred_at)
) partition by range (occurred_at);
create index action_log_tenant_time_idx on public.action_log (tenant_id, occurred_at desc);

-- Which fields changed, by whom, from what to what. Personal columns are redacted by the trigger arguments.
create table public.audit_log (
  id uuid not null default private.uuid_v7(),
  occurred_at timestamptz not null default now(),
  tenant_id uuid not null,
  actor_type text not null check (actor_type in ('user', 'nex', 'system', 'integration')),
  actor_id uuid,
  table_name text not null,
  row_id uuid,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  changed jsonb not null default '{}'::jsonb,
  request_id text,
  primary key (id, occurred_at)
) partition by range (occurred_at);
create index audit_log_tenant_time_idx on public.audit_log (tenant_id, occurred_at desc);
create index audit_log_row_idx on public.audit_log (tenant_id, table_name, row_id);

select private.ensure_partitions('action_log', 1, 3);
select private.ensure_partitions('audit_log', 1, 3);

create trigger action_log_append_only before update or delete on public.action_log
  for each row execute function private.reject_mutation();
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function private.reject_mutation();

-- Row audit: `execute function private.audit_row('personal_column', ...)` redacts the listed columns.
create function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  new_row jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  diff jsonb := '{}'::jsonb;
  col text;
begin
  for col in select jsonb_object_keys(old_row || new_row) loop
    if col = 'updated_at' then continue; end if;
    if old_row -> col is distinct from new_row -> col then
      diff := diff || jsonb_build_object(
        col,
        case when col = any (tg_argv) then jsonb_build_array('[redactado]', '[redactado]')
             else jsonb_build_array(old_row -> col, new_row -> col) end
      );
    end if;
  end loop;

  insert into public.audit_log (tenant_id, actor_type, actor_id, table_name, row_id, operation, changed, request_id)
  values (
    coalesce((new_row ->> 'tenant_id')::uuid, (old_row ->> 'tenant_id')::uuid),
    case when (select auth.uid()) is null then 'system' else 'user' end,
    (select auth.uid()),
    tg_table_name,
    coalesce((new_row ->> 'id')::uuid, (old_row ->> 'id')::uuid),
    lower(tg_op),
    diff,
    nullif(current_setting('kynova.request_id', true), '')
  );
  return null;
end;
$$;

-- Internal helper used by the business functions: writes an action_log row in the caller's transaction.
create function private.log_action(
  p_tenant uuid, p_action text, p_level smallint, p_summary text, p_reason text default null,
  p_contact uuid default null, p_lead uuid default null, p_opportunity uuid default null,
  p_conversation uuid default null, p_approval uuid default null, p_actor_type text default 'user'
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.action_log (tenant_id, actor_type, actor_id, action_kind, level, summary, reason,
                                 contact_id, lead_id, opportunity_id, conversation_id, approval_request_id, request_id)
  values (p_tenant, p_actor_type, (select auth.uid()), p_action, p_level, p_summary, p_reason,
          p_contact, p_lead, p_opportunity, p_conversation, p_approval, nullif(current_setting('kynova.request_id', true), ''));
$$;

-- Generic RLS for a tenant table. kind: 'rw' (writers insert and update), 'admin' (admins insert, update, delete),
-- 'read' (members read; every write goes through a function). Dropped at the end of the foundations.
create function private.apply_tenant_rls(tbl text, kind text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  qualified text := format('public.%I', tbl);
begin
  execute format('alter table %s enable row level security', qualified);
  execute format('revoke all on table %s from public, anon, authenticated, service_role', qualified);
  execute format('grant select on table %s to authenticated', qualified);
  execute format('create policy %I on %s for select to authenticated using ((select private.is_member(tenant_id)))', tbl || '_select', qualified);

  if kind = 'rw' then
    execute format('grant insert, update on table %s to authenticated', qualified);
    execute format('create policy %I on %s for insert to authenticated with check ((select private.can_write(tenant_id)))', tbl || '_insert', qualified);
    execute format('create policy %I on %s for update to authenticated using ((select private.can_write(tenant_id))) with check ((select private.can_write(tenant_id)))', tbl || '_update', qualified);
  elsif kind = 'rw_delete' then
    execute format('grant insert, update, delete on table %s to authenticated', qualified);
    execute format('create policy %I on %s for insert to authenticated with check ((select private.can_write(tenant_id)))', tbl || '_insert', qualified);
    execute format('create policy %I on %s for update to authenticated using ((select private.can_write(tenant_id))) with check ((select private.can_write(tenant_id)))', tbl || '_update', qualified);
    execute format('create policy %I on %s for delete to authenticated using ((select private.can_write(tenant_id)))', tbl || '_delete', qualified);
  elsif kind = 'admin' then
    execute format('grant insert, update, delete on table %s to authenticated', qualified);
    execute format('create policy %I on %s for insert to authenticated with check ((select private.is_admin(tenant_id)))', tbl || '_insert', qualified);
    execute format('create policy %I on %s for update to authenticated using ((select private.is_admin(tenant_id))) with check ((select private.is_admin(tenant_id)))', tbl || '_update', qualified);
    execute format('create policy %I on %s for delete to authenticated using ((select private.is_admin(tenant_id)))', tbl || '_delete', qualified);
  elsif kind <> 'read' then
    raise exception 'unknown policy kind %', kind;
  end if;
end;
$$;

-- The two logs: members read, nobody writes directly.
select private.apply_tenant_rls('action_log', 'read');
select private.apply_tenant_rls('audit_log', 'read');

-- ---------------------------------------------------------------------------
-- User profiles: a display name, visible to teammates
-- ---------------------------------------------------------------------------

create table public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  locale text check (locale ~ '^[a-z]{2}$'),
  -- When the dashboard last showed this user what NEX did while they were away.
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger user_profiles_touch_updated_at before update on public.user_profiles
  for each row execute function private.touch_updated_at();

alter table public.user_profiles enable row level security;
revoke all on table public.user_profiles from public, anon, authenticated, service_role;
grant select, insert, update on table public.user_profiles to authenticated;
create policy user_profiles_select on public.user_profiles
  for select to authenticated using (user_id = (select auth.uid()) or (select private.shares_tenant_with(user_id)));
create policy user_profiles_insert on public.user_profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy user_profiles_update on public.user_profiles
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Privileges for the helpers
-- ---------------------------------------------------------------------------

revoke execute on function
  private.uuid_v7(), private.has_role(uuid, text[]), private.can_write(uuid), private.is_admin(uuid),
  private.shares_tenant_with(uuid), private.protect_identity(), private.reject_mutation(),
  private.ensure_partitions(text, int, int), private.audit_row(),
  private.log_action(uuid, text, smallint, text, text, uuid, uuid, uuid, uuid, uuid, text),
  private.apply_tenant_rls(text, text)
  from public, anon, authenticated, service_role;
-- Policies, defaults and the API call these as the signed-in user.
grant execute on function
  private.uuid_v7(), private.has_role(uuid, text[]), private.can_write(uuid), private.is_admin(uuid),
  private.shares_tenant_with(uuid)
  to authenticated;
