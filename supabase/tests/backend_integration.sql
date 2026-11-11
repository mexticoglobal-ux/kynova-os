-- Backend Core Integration tests (ADR-0015): RLS and privileges of platform_events, platform_audit and storage_objects, the functions that write them, the
-- continuity of the audit chain, tenant isolation, roles, and company deletion.
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/tests/backend_integration.sql   (after 00_bootstrap.sql and every migration)
-- Fictitious data only. A failed expectation raises an exception and stops the run (non-zero exit).
--
-- Actors: O owns T1; M is a member of T1; V is a viewer of T1; X owns T2 and has nothing in T1.

create function pg_temp.as_user(uid uuid, mail text)
returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'email', mail)::text, true);
end $$;

-- Runs a statement and returns the SQLSTATE it fails with ('00000' when it succeeds).
create function pg_temp.state_of(stmt text)
returns text language plpgsql as $$
begin
  execute stmt;
  return '00000';
exception when others then
  return sqlstate;
end $$;

insert into auth.users (id, email) values
  ('20000000-0000-4000-8000-000000000001', 'o@example.test'),
  ('20000000-0000-4000-8000-000000000002', 'm@example.test'),
  ('20000000-0000-4000-8000-000000000003', 'v@example.test'),
  ('20000000-0000-4000-8000-000000000004', 'x@example.test');

insert into public.tenants (id, name) values
  ('20000000-0000-4000-8000-0000000000b1', 'Empresa Uno'),
  ('20000000-0000-4000-8000-0000000000b2', 'Empresa Dos');

insert into public.memberships (user_id, tenant_id, role) values
  ('20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000000b1', 'owner'),
  ('20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000000b1', 'member'),
  ('20000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-0000000000b1', 'viewer'),
  ('20000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-0000000000b2', 'owner');

-- ---------------------------------------------------------------------------
-- Static checks
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['platform_events', 'platform_audit', 'storage_objects'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'FAIL: RLS is off on %', t; end if;
    if (select count(*) from pg_policy where polrelid = ('public.' || t)::regclass) < 1 then raise exception 'FAIL: % has no policy', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('anon', 'public.' || t, 'insert') then raise exception 'FAIL: anon reaches %', t; end if;
    if not has_table_privilege('authenticated', 'public.' || t, 'select') then raise exception 'FAIL: members cannot read %', t; end if;
    if has_table_privilege('authenticated', 'public.' || t, 'insert') or has_table_privilege('authenticated', 'public.' || t, 'update') or has_table_privilege('authenticated', 'public.' || t, 'delete')
      then raise exception 'FAIL: authenticated can write % directly', t; end if;
    if has_table_privilege('service_role', 'public.' || t, 'select') then raise exception 'FAIL: the server key reads %', t; end if;
  end loop;

  foreach t in array array['public.append_platform_events(uuid, jsonb)', 'public.append_platform_audit(uuid, jsonb)', 'public.register_storage_object(uuid, text, text, text, bigint)', 'public.retire_storage_object(uuid, text)'] loop
    if not has_function_privilege('authenticated', t, 'execute') then raise exception 'FAIL: authenticated cannot run %', t; end if;
    if has_function_privilege('anon', t, 'execute') then raise exception 'FAIL: anon can run %', t; end if;
    if not (select prosecdef from pg_proc where oid = t::regprocedure) then raise exception 'FAIL: % is not security definer', t; end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Events: members read, writers publish, nobody else touches them
-- ---------------------------------------------------------------------------
do $$
declare n int; ev jsonb := '[{"event_id":"e1","type":"crm.audit.recorded","module":"crm","actor":"ana","correlation_id":"c1","payload":{"action":"lead.created","category":"crm"}}]'::jsonb;
begin
  perform pg_temp.as_user('20000000-0000-4000-8000-000000000001', 'o@example.test');
  n := public.append_platform_events('20000000-0000-4000-8000-0000000000b1', ev);
  if n <> 1 then raise exception 'FAIL: the owner could not publish an event (%)', n; end if;
  n := public.append_platform_events('20000000-0000-4000-8000-0000000000b1', ev);
  if n <> 0 then raise exception 'FAIL: a repeated event_id was stored again (%)', n; end if;
  if (select count(*) from public.platform_events) <> 1 then raise exception 'FAIL: the owner does not see exactly its event'; end if;

  -- a writer who is a plain member publishes too
  perform pg_temp.as_user('20000000-0000-4000-8000-000000000002', 'm@example.test');
  n := public.append_platform_events('20000000-0000-4000-8000-0000000000b1', '[{"event_id":"e2","type":"crm.audit.recorded","module":"crm","actor":"worker:nex","payload":{}}]'::jsonb);
  if n <> 1 then raise exception 'FAIL: a member could not publish'; end if;

  -- a viewer reads but never writes
  perform pg_temp.as_user('20000000-0000-4000-8000-000000000003', 'v@example.test');
  if (select count(*) from public.platform_events) <> 2 then raise exception 'FAIL: a viewer does not read the events of its company'; end if;
  if pg_temp.state_of($q$select public.append_platform_events('20000000-0000-4000-8000-0000000000b1', '[]'::jsonb)$q$) <> '42501' then raise exception 'FAIL: a viewer published'; end if;

  -- another company sees nothing and cannot publish into T1
  perform pg_temp.as_user('20000000-0000-4000-8000-000000000004', 'x@example.test');
  if (select count(*) from public.platform_events) <> 0 then raise exception 'FAIL: another company reads the events'; end if;
  if pg_temp.state_of($q$select public.append_platform_events('20000000-0000-4000-8000-0000000000b1', '[]'::jsonb)$q$) <> '42501' then raise exception 'FAIL: another company published into T1'; end if;
  n := public.append_platform_events('20000000-0000-4000-8000-0000000000b2', '[{"event_id":"e1","type":"crm.audit.recorded","module":"crm","actor":"x","payload":{}}]'::jsonb);
  if n <> 1 then raise exception 'FAIL: the same event_id must be allowed in another company'; end if;

  -- no direct write, no rewrite
  if pg_temp.state_of($q$insert into public.platform_events (tenant_id, event_id, type, module, actor) values ('20000000-0000-4000-8000-0000000000b2', 'z', 'a.b.c', 'crm', 'x')$q$) <> '42501' then raise exception 'FAIL: direct insert allowed'; end if;
  if pg_temp.state_of($q$update public.platform_events set actor = 'y'$q$) <> '42501' then raise exception 'FAIL: update allowed'; end if;
  if pg_temp.state_of($q$delete from public.platform_events$q$) <> '42501' then raise exception 'FAIL: delete allowed'; end if;
  -- bad input is refused
  if pg_temp.state_of($q$select public.append_platform_events('20000000-0000-4000-8000-0000000000b2', '{"x":1}'::jsonb)$q$) <> '22023' then raise exception 'FAIL: a non-array was accepted'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Audit: the database enforces the chain
-- ---------------------------------------------------------------------------
do $$
declare
  n int;
  h1 text := repeat('a', 64); h2 text := repeat('b', 64); zero text := repeat('0', 64);
  rec1 jsonb; rec2 jsonb;
begin
  rec1 := jsonb_build_array(jsonb_build_object('record_id', 'aud_T1_1', 'seq', 1, 'actor_id', 'ana', 'actor_kind', 'person', 'module', 'crm', 'action', 'lead.created', 'category', 'crm', 'outcome', 'success', 'prev_hash', zero, 'hash', h1, 'at', '2026-11-10T12:00:00Z'));
  rec2 := jsonb_build_array(jsonb_build_object('record_id', 'aud_T1_2', 'seq', 2, 'actor_id', 'ana', 'actor_kind', 'person', 'module', 'crm', 'action', 'lead.won', 'category', 'crm', 'outcome', 'success', 'prev_hash', h1, 'hash', h2, 'at', '2026-11-10T12:01:00Z'));

  perform pg_temp.as_user('20000000-0000-4000-8000-000000000001', 'o@example.test');
  if pg_temp.state_of(format($q$select public.append_platform_audit('20000000-0000-4000-8000-0000000000b1', %L::jsonb)$q$, rec2)) <> '23514' then raise exception 'FAIL: a chain that does not start at 1 was accepted'; end if;
  n := public.append_platform_audit('20000000-0000-4000-8000-0000000000b1', rec1);
  if n <> 1 then raise exception 'FAIL: the first audit record was not stored (%)', n; end if;
  if public.append_platform_audit('20000000-0000-4000-8000-0000000000b1', rec1) <> 0 then raise exception 'FAIL: a replay stored a record again'; end if;
  if pg_temp.state_of(format($q$select public.append_platform_audit('20000000-0000-4000-8000-0000000000b1', %L::jsonb)$q$, jsonb_set(rec1, '{0,hash}', to_jsonb(repeat('c', 64))))) <> '23514' then raise exception 'FAIL: a rewritten record was accepted'; end if;
  if pg_temp.state_of(format($q$select public.append_platform_audit('20000000-0000-4000-8000-0000000000b1', %L::jsonb)$q$, jsonb_set(rec2, '{0,prev_hash}', to_jsonb(repeat('d', 64))))) <> '23514' then raise exception 'FAIL: a record with a wrong previous hash was accepted'; end if;
  if pg_temp.state_of(format($q$select public.append_platform_audit('20000000-0000-4000-8000-0000000000b1', %L::jsonb)$q$, jsonb_set(rec2, '{0,seq}', '4'::jsonb))) <> '23514' then raise exception 'FAIL: a gap in the chain was accepted'; end if;
  if public.append_platform_audit('20000000-0000-4000-8000-0000000000b1', rec2) <> 1 then raise exception 'FAIL: the second record was not stored'; end if;
  if (select count(*) from public.platform_audit) <> 2 then raise exception 'FAIL: the owner does not see its two records'; end if;
  if pg_temp.state_of($q$update public.platform_audit set action = 'x'$q$) <> '42501' then raise exception 'FAIL: audit update allowed'; end if;
  if pg_temp.state_of($q$delete from public.platform_audit$q$) <> '42501' then raise exception 'FAIL: audit delete allowed'; end if;

  -- a viewer reads, never writes; another company has its own chain, starting at 1
  perform pg_temp.as_user('20000000-0000-4000-8000-000000000003', 'v@example.test');
  if (select count(*) from public.platform_audit) <> 2 then raise exception 'FAIL: a viewer does not read the audit'; end if;
  if pg_temp.state_of(format($q$select public.append_platform_audit('20000000-0000-4000-8000-0000000000b1', %L::jsonb)$q$, rec2)) <> '42501' then raise exception 'FAIL: a viewer wrote audit'; end if;
  perform pg_temp.as_user('20000000-0000-4000-8000-000000000004', 'x@example.test');
  if (select count(*) from public.platform_audit) <> 0 then raise exception 'FAIL: another company reads the audit'; end if;
  if pg_temp.state_of(format($q$select public.append_platform_audit('20000000-0000-4000-8000-0000000000b1', %L::jsonb)$q$, rec1)) <> '42501' then raise exception 'FAIL: another company wrote T1 audit'; end if;
  if public.append_platform_audit('20000000-0000-4000-8000-0000000000b2', rec1) <> 1 then raise exception 'FAIL: another company could not start its own chain at 1'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Storage registry
-- ---------------------------------------------------------------------------
do $$
declare id1 uuid;
begin
  perform pg_temp.as_user('20000000-0000-4000-8000-000000000002', 'm@example.test');
  id1 := public.register_storage_object('20000000-0000-4000-8000-0000000000b1', 'documents', '20000000-0000-4000-8000-0000000000b1/documents/system/a.txt', 'text/plain', 120);
  if id1 is null then raise exception 'FAIL: a writer could not register a file'; end if;
  if public.register_storage_object('20000000-0000-4000-8000-0000000000b1', 'documents', '20000000-0000-4000-8000-0000000000b1/documents/system/a.txt', 'text/plain', 120) is not null then raise exception 'FAIL: the same path was registered twice'; end if;
  if pg_temp.state_of($q$select public.register_storage_object('20000000-0000-4000-8000-0000000000b1', 'documents', '20000000-0000-4000-8000-0000000000b2/documents/system/b.txt', 'text/plain', 5)$q$) <> '42501' then raise exception 'FAIL: a path outside the company folder was accepted'; end if;
  if pg_temp.state_of($q$select public.register_storage_object('20000000-0000-4000-8000-0000000000b1', 'secrets', '20000000-0000-4000-8000-0000000000b1/secrets/x/c.txt', 'text/plain', 5)$q$) <> '23514' then raise exception 'FAIL: an unknown bucket was accepted'; end if;

  perform pg_temp.as_user('20000000-0000-4000-8000-000000000003', 'v@example.test');
  if (select count(*) from public.storage_objects) <> 1 then raise exception 'FAIL: a viewer does not see the file registry'; end if;
  if pg_temp.state_of($q$select public.register_storage_object('20000000-0000-4000-8000-0000000000b1', 'documents', '20000000-0000-4000-8000-0000000000b1/documents/system/v.txt', 'text/plain', 5)$q$) <> '42501' then raise exception 'FAIL: a viewer registered a file'; end if;
  if pg_temp.state_of($q$update public.storage_objects set bytes = 1$q$) <> '42501' then raise exception 'FAIL: the registry was updated directly'; end if;

  perform pg_temp.as_user('20000000-0000-4000-8000-000000000004', 'x@example.test');
  if (select count(*) from public.storage_objects) <> 0 then raise exception 'FAIL: another company sees the registry'; end if;
  if pg_temp.state_of($q$select public.retire_storage_object('20000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000b1/documents/system/a.txt')$q$) <> '42501' then raise exception 'FAIL: another company retired a file'; end if;

  perform pg_temp.as_user('20000000-0000-4000-8000-000000000002', 'm@example.test');
  perform public.retire_storage_object('20000000-0000-4000-8000-0000000000b1', '20000000-0000-4000-8000-0000000000b1/documents/system/a.txt');
  if (select retired_at from public.storage_objects where path like '%a.txt') is null then raise exception 'FAIL: the file was not retired'; end if;
  if (select count(*) from public.storage_objects) <> 1 then raise exception 'FAIL: a retired file must stay registered'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Deleting a company removes its rows and only its rows
-- ---------------------------------------------------------------------------
do $$
begin
  perform pg_temp.as_user('20000000-0000-4000-8000-000000000001', 'o@example.test');
  perform public.delete_company('20000000-0000-4000-8000-0000000000b1', 'Empresa Uno');
  reset role;
  if exists (select 1 from public.platform_events where tenant_id = '20000000-0000-4000-8000-0000000000b1') then raise exception 'FAIL: events of the deleted company remain'; end if;
  if exists (select 1 from public.platform_audit where tenant_id = '20000000-0000-4000-8000-0000000000b1') then raise exception 'FAIL: audit of the deleted company remains'; end if;
  if exists (select 1 from public.storage_objects where tenant_id = '20000000-0000-4000-8000-0000000000b1') then raise exception 'FAIL: files of the deleted company remain'; end if;
  if (select count(*) from public.platform_events where tenant_id = '20000000-0000-4000-8000-0000000000b2') <> 1 then raise exception 'FAIL: another company lost its events'; end if;
  if (select count(*) from public.platform_audit where tenant_id = '20000000-0000-4000-8000-0000000000b2') <> 1 then raise exception 'FAIL: another company lost its audit'; end if;
end $$;

select 'backend_integration.sql: all expectations passed' as result;
