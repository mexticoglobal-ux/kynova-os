-- Backend Core v1 tests (ADR-0010): privileges, tenant isolation, roles, the commercial flow, append-only logs,
-- assistant privacy, inbound ingestion and company deletion.
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/tests/backend_core.sql   (after 00_bootstrap.sql and every migration)
-- Fictitious data only. A failed expectation raises an exception and stops the run (non-zero exit).
--
-- Actors: U1 owns company T1; U2 is a member; U4 a viewer; U5 is invited by email and accepts at sign-in;
-- U3 has no membership and later creates its own company T2.

create function pg_temp.as_user(uid uuid, mail text)
returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'email', mail)::text, true);
end $$;

insert into auth.users (id, email) values
  ('10000000-0000-4000-8000-000000000001', 'owner@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'member@example.test'),
  ('10000000-0000-4000-8000-000000000003', 'outsider@example.test'),
  ('10000000-0000-4000-8000-000000000004', 'viewer@example.test'),
  ('10000000-0000-4000-8000-000000000005', 'invited@example.test');

-- ---------------------------------------------------------------------------
-- Static checks
-- ---------------------------------------------------------------------------
do $$
declare n int; missing text;
begin
  -- Every table in public has RLS on, tenant_id (except the three platform tables) and at least one policy.
  select string_agg(c.relname, ', ') into missing from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if missing is not null then raise exception 'FAIL: RLS is off on: %', missing; end if;

  select string_agg(c.relname, ', ') into missing from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
     and c.relname not in ('tenants', 'memberships', 'user_profiles', 'inbound_dedup', 'metrics_daily')
     and not exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped);
  if missing is not null then raise exception 'FAIL: tables without tenant_id: %', missing; end if;
  if (select count(*) from pg_attribute a where a.attrelid = 'public.metrics_daily'::regclass and a.attname = 'tenant_id') <> 1 then
    raise exception 'FAIL: metrics_daily has no tenant_id';
  end if;

  select string_agg(c.relname, ', ') into missing from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and c.relname not in ('inbound_dedup', 'inbound_events') -- server-only: deny by default, no policy on purpose
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid);
  if missing is not null then raise exception 'FAIL: tables with RLS but no policy: %', missing; end if;

  -- No table grants for anon, service_role or PUBLIC, in public or in the partitions schema.
  select count(*) into n from information_schema.role_table_grants
   where table_schema in ('public', 'parts') and grantee in ('anon', 'service_role', 'PUBLIC');
  if n <> 0 then raise exception 'FAIL: anon/service_role/PUBLIC hold % table privilege(s)', n; end if;
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'parts' and grantee = 'authenticated';
  if n <> 0 then raise exception 'FAIL: authenticated can reach partitions directly'; end if;

  -- The API cannot write the append-only and system tables.
  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'authenticated' and privilege_type <> 'SELECT'
     and table_name in ('action_log', 'audit_log', 'assessment_runs', 'opportunity_stage_history', 'messages', 'conversations',
                        'handoffs', 'consent_records', 'approval_requests', 'outbox_messages', 'inbound_events', 'metrics_daily', 'invitations');
  if n <> 0 then raise exception 'FAIL: authenticated can write % system privilege(s)', n; end if;

  -- anon runs nothing; the server key runs exactly two public functions and no private ones.
  select count(*) into n from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
    and has_function_privilege('anon', p.oid, 'execute') and p.prokind = 'f';
  if n <> 0 then raise exception 'FAIL: anon can execute % function(s)', n; end if;
  select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace
    and has_function_privilege('service_role', p.oid, 'execute') and p.proname not in ('ingest_inbound_event', 'maintain_partitions');
  if n <> 0 then raise exception 'FAIL: service_role can execute % unexpected function(s)', n; end if;
  select count(*) into n from pg_proc p where p.pronamespace = 'private'::regnamespace and has_function_privilege('service_role', p.oid, 'execute');
  if n <> 0 then raise exception 'FAIL: service_role can execute % private function(s)', n; end if;

  -- Every public function the API can run is SECURITY DEFINER with an empty search_path.
  select count(*) into n from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
    and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']);
  if n <> 0 then raise exception 'FAIL: % public function(s) are not SECURITY DEFINER with an empty search_path', n; end if;

  -- The four big tables are partitioned and already have partitions.
  select count(*) into n from pg_partitioned_table pt join pg_class c on c.oid = pt.partrelid
   where c.relnamespace = 'public'::regnamespace and c.relname in ('messages', 'inbound_events', 'action_log', 'audit_log');
  if n <> 4 then raise exception 'FAIL: expected 4 partitioned tables, found %', n; end if;
  select count(*) into n from pg_inherits i join pg_class p on p.oid = i.inhparent where p.relname = 'messages';
  if n < 5 then raise exception 'FAIL: messages should have monthly partitions plus a default, found %', n; end if;

  raise notice 'ok: static checks';
end $$;

-- ---------------------------------------------------------------------------
-- U1 creates a company; the team grows
-- ---------------------------------------------------------------------------
do $$
declare t uuid; boot jsonb; n int;
begin
  perform pg_temp.as_user('10000000-0000-4000-8000-000000000001', 'owner@example.test');
  boot := public.session_bootstrap('Dueña Test');
  if boot ->> 'displayName' <> 'Dueña Test' then raise exception 'FAIL: profile name not stored'; end if;
  if jsonb_array_length(boot -> 'memberships') <> 0 then raise exception 'FAIL: a new user should have no companies'; end if;

  t := public.create_company('Nova Test');
  perform set_config('test.t1', t::text, false);

  select count(*) into n from public.pipeline_stages where tenant_id = t;
  if n <> 6 then raise exception 'FAIL: default pipeline should have 6 stages, has %', n; end if;
  select count(*) into n from public.integration_accounts where tenant_id = t and provider = 'web_chat' and status = 'active';
  if n <> 1 then raise exception 'FAIL: web chat connection missing'; end if;
  if (select role from public.memberships where tenant_id = t) <> 'owner' then raise exception 'FAIL: creator is not owner'; end if;
  if (select slug from public.tenants where id = t) !~ '^nova-test-[0-9a-f]{5}$' then raise exception 'FAIL: unexpected slug'; end if;

  -- Existing accounts join immediately; unknown emails become invitations.
  if public.invite_member(t, 'Member@Example.test', 'member') ->> 'status' <> 'added' then raise exception 'FAIL: existing user not added'; end if;
  if public.invite_member(t, 'viewer@example.test', 'viewer') ->> 'status' <> 'added' then raise exception 'FAIL: viewer not added'; end if;
  if public.invite_member(t, 'invited@example.test', 'admin') ->> 'status' <> 'added' then
    raise exception 'FAIL: U5 already exists, should be added';
  end if;
  if public.invite_member(t, 'later@example.test', 'member') ->> 'status' <> 'invited' then raise exception 'FAIL: unknown email not invited'; end if;
  begin
    perform public.invite_member(t, 'member@example.test', 'member');
    raise exception 'FAIL: duplicate member accepted';
  exception when unique_violation then null; end;
  begin
    perform public.invite_member(t, 'not-an-email', 'member');
    raise exception 'FAIL: invalid email accepted';
  exception when invalid_parameter_value then null; end;
  raise notice 'ok: company and team';
end $$;

-- A person invited before they have an account accepts at their first sign-in.
do $$
declare t uuid := current_setting('test.t1')::uuid; boot jsonb;
begin
  insert into auth.users (id, email) values ('10000000-0000-4000-8000-000000000006', 'later@example.test');
  perform pg_temp.as_user('10000000-0000-4000-8000-000000000006', 'later@example.test');
  boot := public.session_bootstrap(null);
  if jsonb_array_length(boot -> 'memberships') <> 1 or boot #>> '{memberships,0,role}' <> 'member' then
    raise exception 'FAIL: invitation not accepted at sign-in: %', boot;
  end if;
  reset role;
  if (select status from public.invitations where tenant_id = t and email = 'later@example.test') <> 'accepted' then raise exception 'FAIL: invitation not marked accepted'; end if;
  raise notice 'ok: invitation accepted';
end $$;

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
do $$
declare t uuid := current_setting('test.t1')::uuid;
begin
  -- Viewer: reads, never writes.
  perform pg_temp.as_user('10000000-0000-4000-8000-000000000004', 'viewer@example.test');
  perform public.list_leads(t);
  begin
    perform public.capture_prospect(t, '{"route":"cold"}'::jsonb);
    raise exception 'FAIL: viewer captured a prospect';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.contacts (tenant_id, display_name) values (t, 'x');
    raise exception 'FAIL: viewer inserted a contact';
  exception when insufficient_privilege then null; end;
  begin
    perform public.invite_member(t, 'x@example.test', 'viewer');
    raise exception 'FAIL: viewer invited someone';
  exception when insufficient_privilege then null; end;

  -- Member: works the commercial data, cannot administer.
  perform pg_temp.as_user('10000000-0000-4000-8000-000000000002', 'member@example.test');
  insert into public.contacts (tenant_id, display_name) values (t, 'Contacto del miembro');
  begin
    perform public.update_company(t, 'Hack');
    raise exception 'FAIL: member renamed the company';
  exception when insufficient_privilege then null; end;
  begin
    update public.pipeline_stages set name = 'x' where tenant_id = t;
    if found then raise exception 'FAIL: member edited the pipeline'; end if;
  end;
  begin
    perform public.set_member_role(t, '10000000-0000-4000-8000-000000000004', 'admin');
    raise exception 'FAIL: member changed a role';
  exception when insufficient_privilege then null; end;

  -- Admin (U5): cannot touch ownership.
  perform pg_temp.as_user('10000000-0000-4000-8000-000000000005', 'invited@example.test');
  begin
    perform public.set_member_role(t, '10000000-0000-4000-8000-000000000001', 'member');
    raise exception 'FAIL: admin demoted the owner';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_member_role(t, '10000000-0000-4000-8000-000000000002', 'owner');
    raise exception 'FAIL: admin made an owner';
  exception when insufficient_privilege then null; end;
  begin
    perform public.remove_member(t, '10000000-0000-4000-8000-000000000001');
    raise exception 'FAIL: admin removed the owner';
  exception when insufficient_privilege then null; end;
  perform public.set_member_role(t, '10000000-0000-4000-8000-000000000004', 'member');
  perform public.set_member_role(t, '10000000-0000-4000-8000-000000000004', 'viewer');

  -- Owner: the last owner cannot leave or be demoted.
  perform pg_temp.as_user('10000000-0000-4000-8000-000000000001', 'owner@example.test');
  begin
    perform public.set_member_role(t, '10000000-0000-4000-8000-000000000001', 'admin');
    raise exception 'FAIL: the only owner was demoted';
  exception when check_violation then null; end;
  begin
    perform public.remove_member(t, '10000000-0000-4000-8000-000000000001');
    raise exception 'FAIL: the only owner left';
  exception when check_violation then null; end;
  if jsonb_array_length(public.list_team(t)) < 5 then raise exception 'FAIL: team list incomplete'; end if;
  raise notice 'ok: roles';
end $$;

-- ---------------------------------------------------------------------------
-- The commercial flow: prospect -> lead -> approval -> opportunity -> customer
-- ---------------------------------------------------------------------------
do $$
declare
  t uuid := current_setting('test.t1')::uuid;
  payload jsonb;
  r jsonb; r2 jsonb;
  n int;
begin
  perform pg_temp.as_user('10000000-0000-4000-8000-000000000002', 'member@example.test');
  payload := jsonb_build_object(
    'name', 'Ana', 'businessName', 'Café Sol', 'intent', 'audit', 'route', 'hot', 'challenge', 'Conseguir más clientes',
    'contact', jsonb_build_object('method', 'email', 'value', 'Ana@CafeSol.example'),
    'reasons', jsonb_build_array('Prospecto caliente (9 puntos).'), 'services', jsonb_build_array('web', 'social'),
    'nextStep', 'Aprobar la solicitud de reunión que NEX preparó', 'treatment', 'usted', 'noticeVersion', 'demo-1',
    'summary', 'Ana completó el diagnóstico.', 'meetingDraft', 'Hola Ana, soy NEX…',
    'qualification', jsonb_build_object('budget', 'high', 'timeline', 'now', 'decisionRole', 'owner', 'points', 9),
    'audit', jsonb_build_object('engineVersion', 1, 'score', 10, 'band', 'initial', 'infrastructure', 'none',
                                'answers', jsonb_build_object('web', 'none'), 'topGaps', jsonb_build_array('capture', 'web'),
                                'result', jsonb_build_object('gaps', jsonb_build_array())),
    'handoff', jsonb_build_object('route', 'hot'),
    'transcript', jsonb_build_array(
      jsonb_build_object('direction', 'out', 'senderKind', 'nex', 'body', 'Hola, soy NEX'),
      jsonb_build_object('direction', 'in', 'senderKind', 'contact', 'contentType', 'choice', 'body', 'Quiero un diagnóstico'),
      jsonb_build_object('direction', 'out', 'senderKind', 'nex', 'body', '¿Cómo se llama?')));
  r := public.capture_prospect(t, payload);
  perform set_config('test.lead', r ->> 'leadId', false);
  perform set_config('test.contact', r ->> 'contactId', false);
  perform set_config('test.conv', r ->> 'conversationId', false);
  perform set_config('test.approval', r ->> 'approvalRequestId', false);
  if r ->> 'approvalRequestId' is null then raise exception 'FAIL: no approval request prepared'; end if;

  select count(*) into n from public.messages where tenant_id = t and conversation_id = (r ->> 'conversationId')::uuid;
  if n <> 3 then raise exception 'FAIL: transcript not stored (% messages)', n; end if;
  if (select lifecycle_stage from public.contacts where id = (r ->> 'contactId')::uuid) <> 'lead' then raise exception 'FAIL: contact is not a lead'; end if;
  if (select status || grade || priority from public.leads where id = (r ->> 'leadId')::uuid) <> 'qualifiedhothigh' then raise exception 'FAIL: lead classification'; end if;
  if (select value_normalized from public.contact_identities where contact_id = (r ->> 'contactId')::uuid and kind = 'email') <> 'ana@cafesol.example' then raise exception 'FAIL: email not normalized'; end if;
  if not exists (select 1 from public.assessment_runs where id = (r ->> 'assessmentRunId')::uuid and score = 10) then raise exception 'FAIL: assessment not stored'; end if;
  if not exists (select 1 from public.handoffs where lead_id = (r ->> 'leadId')::uuid) then raise exception 'FAIL: handoff not stored'; end if;
  if not exists (select 1 from public.consent_records where contact_id = (r ->> 'contactId')::uuid) then raise exception 'FAIL: consent not recorded'; end if;
  if not exists (select 1 from public.action_log where lead_id = (r ->> 'leadId')::uuid and action_kind = 'prospect.captured' and actor_type = 'nex') then raise exception 'FAIL: action not logged'; end if;
  if not exists (select 1 from public.audit_log where tenant_id = t and table_name = 'leads' and operation = 'insert') then raise exception 'FAIL: lead insert not audited'; end if;

  -- The same person again reuses the contact and updates the single open lead.
  r2 := public.capture_prospect(t, payload || jsonb_build_object('route', 'warm'));
  perform set_config('test.approval', r2 ->> 'approvalRequestId', false);
  if (select status from public.approval_requests where id = (r ->> 'approvalRequestId')::uuid) <> 'expired' then raise exception 'FAIL: the older request should have expired'; end if;
  if r2 ->> 'contactId' <> r ->> 'contactId' or r2 ->> 'leadId' <> r ->> 'leadId' then raise exception 'FAIL: same email created a second contact or lead'; end if;
  select count(*) into n from public.leads where tenant_id = t and status in ('new', 'working', 'qualified');
  if n <> 1 then raise exception 'FAIL: one open lead per contact, found %', n; end if;
  if (select grade from public.leads where id = (r ->> 'leadId')::uuid) <> 'warm' then raise exception 'FAIL: lead not re-qualified'; end if;
  select count(*) into n from public.contacts c where c.tenant_id = t and c.display_name = 'Ana';
  if n <> 1 then raise exception 'FAIL: duplicated contact'; end if;

  -- Personal columns are redacted in the audit trail.
  if exists (select 1 from public.audit_log where tenant_id = t and table_name = 'contacts' and changed::text like '%Ana%') then
    raise exception 'FAIL: contact name leaked into audit_log';
  end if;
  raise notice 'ok: prospect captured';
end $$;

do $$
declare
  t uuid := current_setting('test.t1')::uuid;
  lead uuid := current_setting('test.lead')::uuid;
  contact uuid := current_setting('test.contact')::uuid;
  w jsonb; n int;
begin
  -- A member sees the pending approval but cannot decide it.
  perform pg_temp.as_user('10000000-0000-4000-8000-000000000002', 'member@example.test');
  if jsonb_array_length(public.list_leads(t)) <> 1 then raise exception 'FAIL: member should see the lead'; end if;
  if public.list_leads(t) #>> '{0,approval,kind}' <> 'meeting_request' then raise exception 'FAIL: pending approval not listed'; end if;
  begin
    perform public.decide_approval(current_setting('test.approval')::uuid, true, null);
    raise exception 'FAIL: member decided an approval';
  exception when insufficient_privilege then null; end;
  begin
    update public.approval_requests set status = 'approved' where id = current_setting('test.approval')::uuid;
    raise exception 'FAIL: member wrote approval_requests directly';
  exception when insufficient_privilege then null; end;

  perform pg_temp.as_user('10000000-0000-4000-8000-000000000001', 'owner@example.test');
  if (public.dashboard_digest(t) #>> '{approvals,pending}')::int <> 1 then raise exception 'FAIL: dashboard should count 1 pending approval'; end if;
  perform public.decide_approval(current_setting('test.approval')::uuid, true, 'Adelante');
  begin
    perform public.decide_approval(current_setting('test.approval')::uuid, true, null);
    raise exception 'FAIL: approval decided twice';
  exception when check_violation then null; end;
  if (select status from public.leads where id = lead) <> 'working' then raise exception 'FAIL: lead did not advance after approval'; end if;
  if not exists (select 1 from public.messages where tenant_id = t and approval_request_id = current_setting('test.approval')::uuid and delivery_status = 'queued') then
    raise exception 'FAIL: approved message not queued';
  end if;
  if (public.dashboard_digest(t) #>> '{approvals,pending}')::int <> 0 then raise exception 'FAIL: pending approvals should be 0'; end if;

  -- Convert the prospect into a customer in one step.
  w := public.win_lead(lead, 'Plan anual', 120000, 'USD');
  if (select lifecycle_stage from public.contacts where id = contact) <> 'customer' then raise exception 'FAIL: contact is not a customer'; end if;
  if (select status from public.leads where id = lead) <> 'converted' then raise exception 'FAIL: lead not converted'; end if;
  if (select status from public.opportunities where id = (w ->> 'opportunityId')::uuid) <> 'won' then raise exception 'FAIL: opportunity not won'; end if;
  if (select count(*) from public.opportunity_stage_history where opportunity_id = (w ->> 'opportunityId')::uuid) <> 2 then raise exception 'FAIL: stage history incomplete'; end if;
  if (public.list_clients(t) #>> '{0,wonAmountMinor}')::bigint <> 120000 then raise exception 'FAIL: client revenue wrong'; end if;
  begin
    perform public.win_lead(lead);
    raise exception 'FAIL: a converted lead was won again';
  exception when check_violation then null; end;
  select (public.dashboard_digest(t) #>> '{customers,active}')::int into n;
  if n <> 1 then raise exception 'FAIL: dashboard should show 1 customer'; end if;
  raise notice 'ok: approval, opportunity and customer';
end $$;

-- ---------------------------------------------------------------------------
-- Clients CRUD
-- ---------------------------------------------------------------------------
do $$
declare t uuid := current_setting('test.t1')::uuid; c uuid;
begin
  perform pg_temp.as_user('10000000-0000-4000-8000-000000000002', 'member@example.test');
  c := public.create_client(t, 'Marta Ruiz', 'marta@clinica.example', '+506 8888 7777', 'Clínica Vida', 'Cliente histórica');
  begin
    perform public.create_client(t, 'Otra Marta', 'MARTA@clinica.example');
    raise exception 'FAIL: duplicate client accepted';
  exception when unique_violation then null; end;
  perform public.update_client(c, '{"name":"Marta Ruiz Mora","phone":"+506 7000 1111","notes":"Actualizada"}'::jsonb);
  if jsonb_array_length(public.list_clients(t, 'mora')) <> 1 then raise exception 'FAIL: search by name'; end if;
  if jsonb_array_length(public.list_clients(t, 'vida')) <> 1 then raise exception 'FAIL: search by company'; end if;
  perform public.update_client(c, '{"status":"inactive"}'::jsonb);
  if jsonb_array_length(public.list_clients(t, null, 'active')) <> 1 then raise exception 'FAIL: only the won customer should remain active'; end if;
  if (select lifecycle_stage from public.contacts where id = (select contact_id from public.customers where id = c)) <> 'former' then raise exception 'FAIL: archived client is not former'; end if;
  begin
    perform public.update_client(c, '{"status":"weird"}'::jsonb);
    raise exception 'FAIL: invalid status accepted';
  exception when invalid_parameter_value then null; end;
  raise notice 'ok: clients';
end $$;

-- ---------------------------------------------------------------------------
-- Assistant privacy and message access
-- ---------------------------------------------------------------------------
do $$
declare t uuid := current_setting('test.t1')::uuid; conv uuid; n int;
begin
  perform pg_temp.as_user('10000000-0000-4000-8000-000000000001', 'owner@example.test');
  conv := public.start_assistant_conversation(t, null);
  perform public.append_message(conv, 'in', 'user', 'text', '¿Qué leads necesitan seguimiento?');
  perform public.append_message(conv, 'out', 'nex', 'text', 'Resumen preparado.');
  if jsonb_array_length(public.list_messages(conv)) <> 2 then raise exception 'FAIL: assistant thread not stored'; end if;
  if (select title from public.conversations where id = conv) <> '¿Qué leads necesitan seguimiento?' then raise exception 'FAIL: thread not titled from the first question'; end if;
  perform set_config('test.assistant', conv::text, false);

  perform pg_temp.as_user('10000000-0000-4000-8000-000000000002', 'member@example.test');
  select count(*) into n from public.messages where conversation_id = conv;
  if n <> 0 then raise exception 'FAIL: a teammate can read a private assistant thread (%)', n; end if;
  select count(*) into n from public.conversations where id = conv;
  if n <> 0 then raise exception 'FAIL: a teammate can see a private assistant conversation'; end if;
  begin
    perform public.list_messages(conv);
    raise exception 'FAIL: list_messages exposed the thread';
  exception when insufficient_privilege then null; end;
  begin
    perform public.append_message(conv, 'in', 'user', 'text', 'intruso');
    raise exception 'FAIL: a teammate wrote in a private thread';
  exception when insufficient_privilege then null; end;
  -- Contact threads, on the other hand, are shared with the team.
  if jsonb_array_length(public.list_messages(current_setting('test.conv')::uuid)) <> 3 then raise exception 'FAIL: team cannot read the prospect conversation'; end if;
  raise notice 'ok: assistant privacy';
end $$;

-- ---------------------------------------------------------------------------
-- Isolation between companies
-- ---------------------------------------------------------------------------
do $$
declare t1 uuid := current_setting('test.t1')::uuid; t2 uuid; n int; r jsonb;
begin
  perform pg_temp.as_user('10000000-0000-4000-8000-000000000003', 'outsider@example.test');
  perform public.session_bootstrap('Externa');
  -- No membership: sees nothing in T1 and every function refuses.
  select count(*) into n from public.contacts;
  if n <> 0 then raise exception 'FAIL: outsider reads % contacts', n; end if;
  select count(*) into n from public.leads; if n <> 0 then raise exception 'FAIL: outsider reads leads'; end if;
  select count(*) into n from public.messages; if n <> 0 then raise exception 'FAIL: outsider reads messages'; end if;
  select count(*) into n from public.action_log; if n <> 0 then raise exception 'FAIL: outsider reads action_log'; end if;
  select count(*) into n from public.audit_log; if n <> 0 then raise exception 'FAIL: outsider reads audit_log'; end if;
  begin perform public.list_leads(t1); raise exception 'FAIL: outsider listed leads'; exception when insufficient_privilege then null; end;
  begin perform public.dashboard_digest(t1); raise exception 'FAIL: outsider read the dashboard'; exception when insufficient_privilege then null; end;
  begin perform public.list_team(t1); raise exception 'FAIL: outsider listed the team'; exception when insufficient_privilege then null; end;
  begin perform public.delete_company(t1, 'Nova Test'); raise exception 'FAIL: outsider deleted a company'; exception when insufficient_privilege then null; end;
  begin
    insert into public.contacts (tenant_id, display_name) values (t1, 'intruso');
    raise exception 'FAIL: outsider inserted into T1';
  exception when insufficient_privilege then null; end;

  -- Their own company, with data.
  t2 := public.create_company('Empresa Dos');
  perform set_config('test.t2', t2::text, false);
  r := public.capture_prospect(t2, '{"route":"cold","name":"Luis","contact":{"method":"phone","value":"+506 6000 0000"}}'::jsonb);
  perform set_config('test.t2contact', r ->> 'contactId', false);
  if jsonb_array_length(public.list_leads(t2)) <> 1 then raise exception 'FAIL: T2 should see its lead'; end if;
  perform set_config('test.t2lead', r ->> 'leadId', false);
  raise notice 'ok: outsider isolated';
end $$;

do $$
declare t1 uuid := current_setting('test.t1')::uuid; t2 uuid := current_setting('test.t2')::uuid; n int;
begin
  perform pg_temp.as_user('10000000-0000-4000-8000-000000000001', 'owner@example.test');
  select count(*) into n from public.contacts where tenant_id = t2; if n <> 0 then raise exception 'FAIL: U1 reads T2 contacts'; end if;
  select count(*) into n from public.leads where tenant_id = t2; if n <> 0 then raise exception 'FAIL: U1 reads T2 leads'; end if;
  select count(*) into n from public.tenants where id = t2; if n <> 0 then raise exception 'FAIL: U1 reads tenant T2'; end if;
  begin perform public.list_leads(t2); raise exception 'FAIL: U1 listed T2 leads'; exception when insufficient_privilege then null; end;
  begin
    perform public.advance_lead(current_setting('test.lead')::uuid, 'working');
  exception when check_violation then null; end;  -- own lead is converted: proves it resolved, not that it leaked
  begin
    update public.contacts set tenant_id = t2 where tenant_id = t1;
    raise exception 'FAIL: tenant_id was changed';
  exception when insufficient_privilege then null; end;

  -- A function on another company's rows refuses even when the caller supplies a valid id.
  begin
    perform public.win_lead(current_setting('test.t2lead')::uuid);
    raise exception 'FAIL: U1 won a T2 lead';
  exception when insufficient_privilege then null; end;
  raise notice 'ok: cross-tenant access refused';
end $$;

-- The schema itself refuses a cross-tenant reference, even for a role that bypasses RLS.
do $$
declare t1 uuid := current_setting('test.t1')::uuid; t2 uuid := current_setting('test.t2')::uuid;
begin
  begin
    insert into public.leads (tenant_id, contact_id) values (t1, current_setting('test.t2contact')::uuid);
    raise exception 'FAIL: a lead of T1 points at a contact of T2';
  exception when foreign_key_violation then null; end;
  begin
    insert into public.opportunities (tenant_id, contact_id, pipeline_id, stage_id, title, owner_user_id, next_action_at)
    select t1, current_setting('test.contact')::uuid, p.id, s.id, 'x', '10000000-0000-4000-8000-000000000001', now()
    from public.pipelines p join public.pipeline_stages s on s.pipeline_id = p.id where p.tenant_id = t2 limit 1;
    raise exception 'FAIL: an opportunity of T1 uses the pipeline of T2';
  exception when foreign_key_violation then null; end;
  raise notice 'ok: composite foreign keys';
end $$;

-- ---------------------------------------------------------------------------
-- Append-only
-- ---------------------------------------------------------------------------
do $$
begin
  begin update public.action_log set summary = 'x'; raise exception 'FAIL: action_log updated'; exception when insufficient_privilege then null; end;
  begin delete from public.audit_log; raise exception 'FAIL: audit_log deleted'; exception when insufficient_privilege then null; end;
  begin update public.assessment_runs set score = 99; raise exception 'FAIL: assessment edited'; exception when insufficient_privilege then null; end;
  begin delete from public.handoffs; raise exception 'FAIL: handoff deleted'; exception when insufficient_privilege then null; end;
  begin update public.consent_records set status = 'withdrawn'; raise exception 'FAIL: consent edited'; exception when insufficient_privilege then null; end;
  raise notice 'ok: append-only, even for the owner role';
end $$;

-- ---------------------------------------------------------------------------
-- Business rules enforced by the database
-- ---------------------------------------------------------------------------
do $$
declare t1 uuid := current_setting('test.t1')::uuid;
begin
  begin
    insert into public.opportunities (tenant_id, contact_id, pipeline_id, stage_id, title)
    select t1, current_setting('test.contact')::uuid, p.id, s.id, 'sin responsable'
    from public.pipelines p join public.pipeline_stages s on s.pipeline_id = p.id where p.tenant_id = t1 and s.kind = 'open' limit 1;
    raise exception 'FAIL: an open opportunity without owner or next action was accepted';
  exception when check_violation then null; end;
  begin
    insert into public.leads (tenant_id, contact_id, status) values (t1, current_setting('test.contact')::uuid, 'disqualified');
    raise exception 'FAIL: a disqualified lead without reason was accepted';
  exception when check_violation then null; end;
  begin
    -- A second open lead for the same contact.
    insert into public.leads (tenant_id, contact_id, status) values (t1, current_setting('test.contact')::uuid, 'new');
    insert into public.leads (tenant_id, contact_id, status) values (t1, current_setting('test.contact')::uuid, 'new');
    raise exception 'FAIL: two open leads for one contact';
  exception when unique_violation then null; end;
  raise notice 'ok: business rules';
end $$;

-- ---------------------------------------------------------------------------
-- Inbound integrations (server key): idempotent, tenant resolved server-side, no table access
-- ---------------------------------------------------------------------------
do $$
declare t1 uuid := current_setting('test.t1')::uuid; n int;
begin
  perform pg_temp.as_user('10000000-0000-4000-8000-000000000001', 'owner@example.test');
  update public.integration_accounts set inbound_key_hash = 'hash-t1' where tenant_id = t1 and provider = 'web_chat';
  reset role;

  set local role service_role;
  if public.ingest_inbound_event('hash-t1', 'web_chat', 'evt-1', true, '{"text":"hola"}'::jsonb) ->> 'status' <> 'accepted' then raise exception 'FAIL: event not accepted'; end if;
  if public.ingest_inbound_event('hash-t1', 'web_chat', 'evt-1', true, '{"text":"hola"}'::jsonb) ->> 'status' <> 'duplicate' then raise exception 'FAIL: retry not detected'; end if;
  if public.ingest_inbound_event('wrong', 'web_chat', 'evt-2', true, '{}'::jsonb) ->> 'status' <> 'rejected' then raise exception 'FAIL: unknown key accepted'; end if;
  if public.ingest_inbound_event('hash-t1', 'whatsapp', 'evt-3', true, '{}'::jsonb) ->> 'status' <> 'rejected' then raise exception 'FAIL: wrong provider accepted'; end if;
  begin perform 1 from public.contacts limit 1; raise exception 'FAIL: the server key read a table'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.inbound_events limit 1; raise exception 'FAIL: the server key read inbound_events'; exception when insufficient_privilege then null; end;
  begin perform private.require_member(gen_random_uuid()); raise exception 'FAIL: the server key ran a private function'; exception when insufficient_privilege then null; end;
  perform public.maintain_partitions();
  reset role;

  select count(*) into n from public.inbound_events where tenant_id = t1;
  if n <> 1 then raise exception 'FAIL: expected exactly 1 stored event, found %', n; end if;
  raise notice 'ok: inbound ingestion';
end $$;

-- ---------------------------------------------------------------------------
-- Erasure, dashboard, company deletion
-- ---------------------------------------------------------------------------
do $$
declare t1 uuid := current_setting('test.t1')::uuid; contact uuid := current_setting('test.contact')::uuid; d jsonb;
begin
  perform pg_temp.as_user('10000000-0000-4000-8000-000000000002', 'member@example.test');
  begin perform public.erase_contact(contact); raise exception 'FAIL: a member erased a contact'; exception when insufficient_privilege then null; end;
  perform pg_temp.as_user('10000000-0000-4000-8000-000000000001', 'owner@example.test');
  perform public.erase_contact(contact);
  if (select display_name from public.contacts where id = contact) <> 'Contacto anonimizado' then raise exception 'FAIL: contact not anonymized'; end if;
  if exists (select 1 from public.contact_identities where contact_id = contact) then raise exception 'FAIL: identities not removed'; end if;
  if exists (select 1 from public.messages where conversation_id = current_setting('test.conv')::uuid and body is not null) then raise exception 'FAIL: message bodies kept'; end if;
  if not exists (select 1 from public.data_requests where contact_id = contact and kind = 'erasure' and status = 'completed') then raise exception 'FAIL: erasure not recorded'; end if;

  d := public.dashboard_digest(t1);
  if (d #>> '{leads,total}')::int <> 1 then raise exception 'FAIL: dashboard lead total'; end if;
  if jsonb_array_length(d -> 'activity') < 3 then raise exception 'FAIL: dashboard shows no recent activity'; end if;
  raise notice 'ok: erasure and dashboard';
end $$;

do $$
declare t1 uuid := current_setting('test.t1')::uuid; t2 uuid := current_setting('test.t2')::uuid; n int;
begin
  perform pg_temp.as_user('10000000-0000-4000-8000-000000000002', 'member@example.test');
  begin perform public.delete_company(t1, 'Nova Test'); raise exception 'FAIL: a member deleted the company'; exception when insufficient_privilege then null; end;
  perform pg_temp.as_user('10000000-0000-4000-8000-000000000001', 'owner@example.test');
  begin perform public.delete_company(t1, 'otro nombre'); raise exception 'FAIL: wrong confirmation accepted'; exception when invalid_parameter_value then null; end;
  perform public.delete_company(t1, 'Nova Test');
  reset role;

  select count(*) into n from public.tenants where id = t1; if n <> 0 then raise exception 'FAIL: tenant not deleted'; end if;
  select count(*) into n from public.contacts where tenant_id = t1; if n <> 0 then raise exception 'FAIL: contacts left behind'; end if;
  select count(*) into n from public.messages where tenant_id = t1; if n <> 0 then raise exception 'FAIL: messages left behind'; end if;
  select count(*) into n from public.action_log where tenant_id = t1; if n <> 0 then raise exception 'FAIL: action_log left behind'; end if;
  select count(*) into n from public.audit_log where tenant_id = t1; if n <> 0 then raise exception 'FAIL: audit_log left behind'; end if;
  select count(*) into n from public.inbound_events where tenant_id = t1; if n <> 0 then raise exception 'FAIL: inbound events left behind'; end if;
  select count(*) into n from public.tenants where id = t2; if n <> 1 then raise exception 'FAIL: deleting T1 touched T2'; end if;
  select count(*) into n from public.leads where tenant_id = t2; if n <> 1 then raise exception 'FAIL: deleting T1 touched T2 data'; end if;
  -- The log stays append-only once the deletion switch is off.
  begin delete from public.action_log; raise exception 'FAIL: action_log deletable after delete_company'; exception when insufficient_privilege then null; end;
  raise notice 'ok: company deletion';
end $$;

-- Clean up so other test files start from a known state.
do $$
declare t2 uuid := current_setting('test.t2')::uuid;
begin
  perform pg_temp.as_user('10000000-0000-4000-8000-000000000003', 'outsider@example.test');
  perform public.delete_company(t2, 'Empresa Dos');
  reset role;
  delete from public.user_profiles where user_id::text like '10000000-%';
  delete from auth.users where id::text like '10000000-%';
  raise notice 'ok: cleaned up';
end $$;
