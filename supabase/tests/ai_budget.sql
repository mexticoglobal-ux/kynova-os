-- AI budget tests (ADR-0036): RLS and privileges of ai_budget_periods, ai_reservations and ai_usage_attempts, the TRUST BOUNDARY (no signed-in user can reserve, settle, release or write off: only the
-- server key), the atomic reservation, idempotency, settlement of every billable attempt (retries and fallbacks included), what an expired reservation does and does not free, the platform-only
-- written-off decision, the cap of calls, the UTC month, isolation between companies and company deletion.
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/tests/ai_budget.sql   (after 00_bootstrap.sql and every migration). The parallel part is supabase/tests/ai_budget_concurrency.sh.
-- Fictitious data only. A failed expectation raises an exception and stops the run (non-zero exit).
--
-- Actors: O owns T1; M is a plain member of T1; V is a viewer of T1; X owns T2 and has nothing in T1. The "server" is the service_role: the only role that records consumption.

create function pg_temp.as_user(uid uuid, mail text)
returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'email', mail)::text, true);
end $$;

create function pg_temp.state_of(stmt text)
returns text language plpgsql as $$
begin
  execute stmt;
  return '00000';
exception when others then
  return sqlstate;
end $$;

insert into auth.users (id, email) values
  ('30000000-0000-4000-8000-000000000001', 'budget-o@example.test'),
  ('30000000-0000-4000-8000-000000000002', 'budget-m@example.test'),
  ('30000000-0000-4000-8000-000000000003', 'budget-v@example.test'),
  ('30000000-0000-4000-8000-000000000004', 'budget-x@example.test');

insert into public.tenants (id, name) values
  ('30000000-0000-4000-8000-0000000000b1', 'Empresa Uno'),
  ('30000000-0000-4000-8000-0000000000b2', 'Empresa Dos'),
  ('30000000-0000-4000-8000-0000000000b3', 'Empresa Tres'),
  ('30000000-0000-4000-8000-0000000000b4', 'Empresa Cuatro');

insert into public.memberships (user_id, tenant_id, role) values
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-0000000000b1', 'owner'),
  ('30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-0000000000b1', 'member'),
  ('30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-0000000000b1', 'viewer'),
  ('30000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-0000000000b2', 'owner'),
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-0000000000b3', 'owner'),
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-0000000000b4', 'owner');

-- ---------------------------------------------------------------------------
-- Static checks: RLS, privileges, who can run what
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['ai_budget_periods', 'ai_reservations', 'ai_usage_attempts'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'FAIL: RLS is off on %', t; end if;
    if (select count(*) from pg_policy where polrelid = ('public.' || t)::regclass) < 1 then raise exception 'FAIL: % has no policy', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'select') then raise exception 'FAIL: anon reaches %', t; end if;
    if has_table_privilege('authenticated', 'public.' || t, 'insert') or has_table_privilege('authenticated', 'public.' || t, 'update') or has_table_privilege('authenticated', 'public.' || t, 'delete')
      then raise exception 'FAIL: authenticated can write % directly', t; end if;
    if has_table_privilege('service_role', 'public.' || t, 'select') or has_table_privilege('service_role', 'public.' || t, 'insert') then raise exception 'FAIL: the server key reaches %', t; end if;
  end loop;

  -- the trust boundary: NOTHING that records, frees or reconciles consumption is open to a signed-in user or to anon; the server key runs exactly these
  foreach t in array array['public.reserve_ai_budget(uuid, uuid, text, bigint, text, int)', 'public.settle_ai_budget(uuid, jsonb)', 'public.release_ai_budget(uuid)', 'public.write_off_ai_reservation(uuid, text)',
                           'public.assign_ai_budget(uuid, date, bigint)', 'public.assign_ai_call_cap(uuid, date, int)', 'public.expire_ai_reservations()'] loop
    if not has_function_privilege('service_role', t, 'execute') then raise exception 'FAIL: the server key cannot run %', t; end if;
    if has_function_privilege('authenticated', t, 'execute') or has_function_privilege('anon', t, 'execute') then raise exception 'FAIL: % is open to a signed-in user or anon', t; end if;
  end loop;
  foreach t in array array['private.ai_budget_period()', 'private.member_can_write(uuid, uuid)'] loop
    if has_function_privilege('authenticated', t, 'execute') or has_function_privilege('anon', t, 'execute') or has_function_privilege('service_role', t, 'execute') then raise exception 'FAIL: the private function % is exposed', t; end if;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('reserve_ai_budget', 'settle_ai_budget', 'release_ai_budget',
     'write_off_ai_reservation', 'assign_ai_budget', 'assign_ai_call_cap', 'expire_ai_reservations') and (not p.prosecdef or p.proconfig is null or not ('search_path=""' = any (p.proconfig)))) then
    raise exception 'FAIL: a budget function is not security definer with an empty search_path';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- No assignment = no budget; limit 0 = nothing reservable; only the platform assigns
-- ---------------------------------------------------------------------------
do $$
declare res jsonb;
  t1 constant uuid := '30000000-0000-4000-8000-0000000000b1';
  um constant uuid := '30000000-0000-4000-8000-000000000002';
  p constant date := date_trunc('month', now() at time zone 'utc')::date;
begin
  set local role service_role;
  res := public.reserve_ai_budget(t1, um, 'message.draft', 100, 'k-none', 300);
  if res ->> 'ok' <> 'false' or res ->> 'reason' <> 'no_budget' then raise exception 'FAIL: a company with no assignment reserved something (%)', res; end if;
  reset role;
  if (select count(*) from public.ai_reservations) <> 0 then raise exception 'FAIL: a rejected reservation left a row'; end if;

  -- a company cannot give itself a budget (member and owner)
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000002', 'budget-m@example.test');
  if pg_temp.state_of($q$select public.assign_ai_budget('30000000-0000-4000-8000-0000000000b1', date_trunc('month', now() at time zone 'utc')::date, 1000000)$q$) <> '42501' then raise exception 'FAIL: a member assigned a budget'; end if;
  reset role;
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000001', 'budget-o@example.test');
  if pg_temp.state_of($q$select public.assign_ai_budget('30000000-0000-4000-8000-0000000000b1', date_trunc('month', now() at time zone 'utc')::date, 1000000)$q$) <> '42501' then raise exception 'FAIL: the owner assigned its own budget'; end if;
  reset role;

  -- the platform assigns: an explicit 0 is a budget of 0
  set local role service_role;
  perform public.assign_ai_budget(t1, p, 0);
  res := public.reserve_ai_budget(t1, um, 'message.draft', 100, 'k-zero', 300);
  if res ->> 'reason' <> 'budget_exceeded' then raise exception 'FAIL: a limit of 0 let a reservation through (%)', res; end if;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- The period is the UTC month, and a limit cannot be assigned to another kind of period
-- ---------------------------------------------------------------------------
do $$
begin
  if private.ai_budget_period() <> date_trunc('month', now() at time zone 'utc')::date then raise exception 'FAIL: the period is not the UTC month'; end if;
  set local role service_role;
  if pg_temp.state_of($q$select public.assign_ai_budget('30000000-0000-4000-8000-0000000000b1', (date_trunc('month', now() at time zone 'utc')::date + 1), 10)$q$) <> '23514' then raise exception 'FAIL: a period that is not a month start was accepted'; end if;
  if pg_temp.state_of($q$select public.assign_ai_budget('30000000-0000-4000-8000-0000000000b1', date_trunc('month', now() at time zone 'utc')::date, -1)$q$) <> '22023' then raise exception 'FAIL: a negative limit was accepted'; end if;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Reserve (server only): limit, the user the server names, isolation and idempotency
-- ---------------------------------------------------------------------------
do $$
declare res jsonb; first_id uuid; again jsonb;
  t1 constant uuid := '30000000-0000-4000-8000-0000000000b1';
  um constant uuid := '30000000-0000-4000-8000-000000000002';
begin
  set local role service_role;
  perform public.assign_ai_budget(t1, date_trunc('month', now() at time zone 'utc')::date, 1000);

  -- the user the server names must hold a write role in THAT company: a viewer, a user of another company, an unknown user and no user are all refused
  if pg_temp.state_of($q$select public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', '30000000-0000-4000-8000-000000000003', 'message.draft', 100, 'k-v', 300)$q$) <> '42501' then raise exception 'FAIL: a viewer was reserved for'; end if;
  if pg_temp.state_of($q$select public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', '30000000-0000-4000-8000-000000000004', 'message.draft', 100, 'k-x', 300)$q$) <> '42501' then raise exception 'FAIL: a user of another company was reserved for'; end if;
  if pg_temp.state_of($q$select public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', gen_random_uuid(), 'message.draft', 100, 'k-u', 300)$q$) <> '42501' then raise exception 'FAIL: an unknown user was reserved for'; end if;
  if pg_temp.state_of($q$select public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', null, 'message.draft', 100, 'k-n', 300)$q$) <> '42501' then raise exception 'FAIL: no user was accepted'; end if;

  res := public.reserve_ai_budget(t1, um, 'message.draft', 400, 'k-1', 300);
  if res ->> 'ok' <> 'true' or res ->> 'repeated' <> 'false' then raise exception 'FAIL: a reservation within the limit was refused (%)', res; end if;
  first_id := (res ->> 'reservationId')::uuid;

  -- a retry with the same key finds the same reservation and reserves nothing more
  again := public.reserve_ai_budget(t1, um, 'message.draft', 400, 'k-1', 300);
  if (again ->> 'reservationId')::uuid <> first_id or again ->> 'repeated' <> 'true' then raise exception 'FAIL: a retried key made a second reservation (%)', again; end if;
  if pg_temp.state_of($q$select public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', '30000000-0000-4000-8000-000000000002', 'message.draft', 999, 'k-1', 300)$q$) <> '23505' then raise exception 'FAIL: a key reused for another request was accepted'; end if;

  res := public.reserve_ai_budget(t1, um, 'message.draft', 400, 'k-2', 300);
  if res ->> 'ok' <> 'true' then raise exception 'FAIL: the second reservation within the limit was refused'; end if;
  -- 800 held, the third 400 would make 1200 > 1000
  res := public.reserve_ai_budget(t1, um, 'message.draft', 400, 'k-3', 300);
  if res ->> 'ok' <> 'false' or res ->> 'reason' <> 'budget_exceeded' then raise exception 'FAIL: the limit was exceeded (%)', res; end if;

  -- (the server key has no table privileges: the figures are read as the table owner)
  reset role;
  if (select reserved_micros from public.ai_budget_periods where tenant_id = t1) <> 800 then raise exception 'FAIL: reserved is not 800'; end if;
  if (select count(*) from public.ai_reservations where tenant_id = t1) <> 2 then raise exception 'FAIL: the refused reservation left a row'; end if;
  if (select requested_by from public.ai_reservations where idempotency_key = 'k-1' and tenant_id = t1) <> um then raise exception 'FAIL: the reservation does not record who asked'; end if;
  -- bad input
  set local role service_role;
  if pg_temp.state_of($q$select public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', '30000000-0000-4000-8000-000000000002', 'message.draft', 0, 'k-bad', 300)$q$) <> '22023' then raise exception 'FAIL: a zero estimate was accepted'; end if;
  if pg_temp.state_of($q$select public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', '30000000-0000-4000-8000-000000000002', 'Message Draft', 10, 'k-bad', 300)$q$) <> '22023' then raise exception 'FAIL: a bad purpose was accepted'; end if;
  if pg_temp.state_of($q$select public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', '30000000-0000-4000-8000-000000000002', 'message.draft', 10, 'k-bad', 5)$q$) <> '22023' then raise exception 'FAIL: a ttl under 30 seconds was accepted'; end if;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- THE TRUST BOUNDARY, with signed-in users: nobody can record consumption, free a reservation, reconcile it or get around the counter
-- ---------------------------------------------------------------------------
do $$
declare rid uuid; calls_before int; reserved_before bigint; spent_before bigint; who text; uid uuid; mail text;
  t1 constant uuid := '30000000-0000-4000-8000-0000000000b1';
  attempts text := '[{"attempt_no":1,"role":"primary","provider":"p1","model":"m1","input_tokens":0,"output_tokens":0,"cost_micros":0,"billable":true}]';
begin
  rid := (select id from public.ai_reservations where idempotency_key = 'k-1' and tenant_id = t1);
  select calls_used, reserved_micros, spent_micros into calls_before, reserved_before, spent_before from public.ai_budget_periods where tenant_id = t1;

  -- the owner, a plain member, a viewer and the owner of another company: each is refused at the privilege level (42501) for EVERY function, and nothing changes
  for who, uid, mail in select * from (values ('owner', '30000000-0000-4000-8000-000000000001'::uuid, 'budget-o@example.test'), ('member', '30000000-0000-4000-8000-000000000002'::uuid, 'budget-m@example.test'),
                                ('viewer', '30000000-0000-4000-8000-000000000003'::uuid, 'budget-v@example.test'), ('other company', '30000000-0000-4000-8000-000000000004'::uuid, 'budget-x@example.test')) as v(who, uid, mail) loop
    perform pg_temp.as_user(uid, mail);
    -- falsify tokens or cost: declaring zero cost (or any cost) for a reservation that is still in flight
    if pg_temp.state_of(format('select public.settle_ai_budget(%L, %L::jsonb)', rid, attempts)) <> '42501' then raise exception 'FAIL: % settled a reservation with a cost of their choice', who; end if;
    -- free a reservation of the server while its call is in flight
    if pg_temp.state_of(format('select public.release_ai_budget(%L)', rid)) <> '42501' then raise exception 'FAIL: % released a reservation', who; end if;
    -- reserve for themselves, with an estimate of their choice, outside the server's call
    if pg_temp.state_of(format('select public.reserve_ai_budget(%L, %L, %L, 1, %L, 300)', t1, uid, 'message.draft', 'own-' || who)) <> '42501' then raise exception 'FAIL: % reserved directly', who; end if;
    -- reopen the platform's budget with a company decision
    if pg_temp.state_of(format('select public.write_off_ai_reservation(%L, %L)', rid, 'una decision de la empresa para reabrir presupuesto')) <> '42501' then raise exception 'FAIL: % wrote off a reservation', who; end if;
    -- direct writes to get around the counter or the limit
    if pg_temp.state_of($q$update public.ai_budget_periods set calls_used = 0, reserved_micros = 0, spent_micros = 0, limit_micros = 999999999$q$) <> '42501' then raise exception 'FAIL: % rewrote the counters directly', who; end if;
    if pg_temp.state_of($q$update public.ai_reservations set status = 'released'$q$) <> '42501' then raise exception 'FAIL: % released a reservation by a direct update', who; end if;
    if pg_temp.state_of($q$insert into public.ai_usage_attempts (tenant_id, reservation_id, attempt_no, attempt_role, provider, model, billable) select tenant_id, id, 9, 'primary', 'p', 'm', true from public.ai_reservations limit 1$q$) <> '42501' then raise exception 'FAIL: % inserted an attempt directly', who; end if;
    if pg_temp.state_of($q$delete from public.ai_reservations$q$) <> '42501' then raise exception 'FAIL: % deleted a reservation', who; end if;
    reset role;
  end loop;

  -- the same through anon
  set local role anon;
  if pg_temp.state_of(format('select public.settle_ai_budget(%L, %L::jsonb)', rid, attempts)) <> '42501' then raise exception 'FAIL: anon settled'; end if;
  if pg_temp.state_of(format('select public.release_ai_budget(%L)', rid)) <> '42501' then raise exception 'FAIL: anon released'; end if;
  reset role;

  -- none of it changed anything
  if exists (select 1 from public.ai_budget_periods where tenant_id = t1 and (calls_used <> calls_before or reserved_micros <> reserved_before or spent_micros <> spent_before)) then raise exception 'FAIL: the counters moved'; end if;
  if (select status from public.ai_reservations where id = rid) <> 'held' then raise exception 'FAIL: the server reservation is not held any more'; end if;
  if exists (select 1 from public.ai_usage_attempts where reservation_id = rid) then raise exception 'FAIL: an attempt was recorded by a user'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Settle (server only): every billable attempt counts (retries and fallbacks too), once
-- ---------------------------------------------------------------------------
do $$
declare
  rid uuid; res jsonb;
  t1 constant uuid := '30000000-0000-4000-8000-0000000000b1';
  attempts jsonb := '[
    {"attempt_no":1,"role":"primary","provider":"p1","model":"m1","input_tokens":100,"output_tokens":0,"cost_micros":60,"billable":true},
    {"attempt_no":2,"role":"retry","provider":"p1","model":"m1","input_tokens":100,"output_tokens":20,"cost_micros":100,"billable":true},
    {"attempt_no":3,"role":"fallback","provider":"p2","model":"m2","input_tokens":100,"output_tokens":40,"cost_micros":130,"billable":true},
    {"attempt_no":4,"role":"fallback","provider":"p3","model":"m3","input_tokens":0,"output_tokens":0,"cost_micros":999,"billable":false}
  ]'::jsonb;
begin
  rid := (select id from public.ai_reservations where idempotency_key = 'k-1' and tenant_id = t1);
  set local role service_role;
  res := public.settle_ai_budget(rid, attempts);
  -- 60 + 100 + 130 = 290: the retry and the fallback are billed, the unbilled attempt is not
  if (res ->> 'settledMicros')::bigint <> 290 or (res ->> 'overageMicros')::bigint <> 0 then raise exception 'FAIL: the settled cost is not 290 (%)', res; end if;
  -- settling again, even with other numbers, changes nothing
  res := public.settle_ai_budget(rid, '[{"attempt_no":1,"role":"primary","provider":"p1","model":"m1","input_tokens":1,"output_tokens":1,"cost_micros":500,"billable":true}]'::jsonb);
  if res ->> 'repeated' <> 'true' or (res ->> 'settledMicros')::bigint <> 290 then raise exception 'FAIL: a second settlement changed the cost (%)', res; end if;
  reset role;

  if (select count(*) from public.ai_usage_attempts where reservation_id = rid) <> 4 then raise exception 'FAIL: the attempts were not all stored once'; end if;
  -- reserved fell by the reservation (400), spent rose by the cost (290): the 110 not spent is free again
  if (select reserved_micros || ':' || spent_micros from public.ai_budget_periods where tenant_id = t1) <> '400:290' then
    raise exception 'FAIL: the period does not read 400 reserved and 290 spent';
  end if;

  -- a call that cost more than it reserved: the overage is recorded and counts as spent
  rid := (select id from public.ai_reservations where idempotency_key = 'k-2' and tenant_id = t1);
  set local role service_role;
  res := public.settle_ai_budget(rid, '[{"attempt_no":1,"role":"primary","provider":"p1","model":"m1","input_tokens":1,"output_tokens":1,"cost_micros":450,"billable":true}]'::jsonb);
  if (res ->> 'overageMicros')::bigint <> 50 then raise exception 'FAIL: the overage is not 50 (%)', res; end if;
  reset role;
  if (select spent_micros from public.ai_budget_periods where tenant_id = t1) <> 740 then raise exception 'FAIL: spent is not 740'; end if;
  -- the attempts are append-only, even for the owner of the table
  if pg_temp.state_of($q$update public.ai_usage_attempts set cost_micros = 0$q$) <> '42501' then raise exception 'FAIL: an attempt was rewritten'; end if;
  if pg_temp.state_of($q$delete from public.ai_usage_attempts$q$) <> '42501' then raise exception 'FAIL: an attempt was deleted'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Release (server only): only a held reservation that never reached a provider
-- ---------------------------------------------------------------------------
do $$
declare rid uuid; res jsonb;
  t1 constant uuid := '30000000-0000-4000-8000-0000000000b1';
  um constant uuid := '30000000-0000-4000-8000-000000000002';
begin
  set local role service_role;
  res := public.reserve_ai_budget(t1, um, 'message.draft', 100, 'k-rel', 300);
  rid := (res ->> 'reservationId')::uuid;
  perform public.release_ai_budget(rid);
  if pg_temp.state_of(format('select public.release_ai_budget(%L)', rid)) <> '23514' then raise exception 'FAIL: a released reservation was released again'; end if;
  if pg_temp.state_of(format('select public.settle_ai_budget(%L, %L::jsonb)', rid, '[]')) <> '23514' then raise exception 'FAIL: a released reservation was settled'; end if;
  -- a reservation that has attempts recorded cannot be released: it is settled
  res := public.reserve_ai_budget(t1, um, 'message.draft', 100, 'k-rel2', 300);
  rid := (res ->> 'reservationId')::uuid;
  reset role;
  insert into public.ai_usage_attempts (tenant_id, reservation_id, attempt_no, attempt_role, provider, model, billable) values (t1, rid, 1, 'primary', 'p1', 'm1', true);
  set local role service_role;
  if pg_temp.state_of(format('select public.release_ai_budget(%L)', rid)) <> '23514' then raise exception 'FAIL: a reservation with attempts was released'; end if;
  perform public.settle_ai_budget(rid, '[{"attempt_no":1,"role":"primary","provider":"p1","model":"m1","input_tokens":0,"output_tokens":0,"cost_micros":0,"billable":true}]'::jsonb);
  reset role;
  -- both earlier reservations are settled (reserved 0, spent 740); the released 100 left nothing behind
  if (select reserved_micros from public.ai_budget_periods where tenant_id = t1) <> 0 then raise exception 'FAIL: release did not return the 100'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Expiry never frees room; reconciling does; a write-off is the PLATFORM's decision, never the company's
-- ---------------------------------------------------------------------------
do $$
declare a uuid; b uuid; res jsonb; before_committed bigint; after_committed bigint;
  t1 constant uuid := '30000000-0000-4000-8000-0000000000b1';
  um constant uuid := '30000000-0000-4000-8000-000000000002';
begin
  -- spent is 740 against a limit of 1000: the platform raises the limit so that there is room to work with.
  set local role service_role;
  perform public.assign_ai_budget(t1, date_trunc('month', now() at time zone 'utc')::date, 2000);
  a := (public.reserve_ai_budget(t1, um, 'message.draft', 300, 'k-exp-a', 300) ->> 'reservationId')::uuid;
  b := (public.reserve_ai_budget(t1, um, 'message.draft', 200, 'k-exp-b', 300) ->> 'reservationId')::uuid;
  reset role;
  -- both are past their expiry (the clock is not mocked: the rows are aged, as the maintenance job would find them)
  update public.ai_reservations set expires_at = now() - interval '1 minute' where id in (a, b);

  before_committed := (select reserved_micros + unreconciled_micros + spent_micros from public.ai_budget_periods where tenant_id = t1);
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000001', 'budget-o@example.test');
  if pg_temp.state_of($q$select public.expire_ai_reservations()$q$) <> '42501' then raise exception 'FAIL: a signed-in user ran the expiry'; end if;
  reset role;
  set local role service_role;
  if public.expire_ai_reservations() <> 2 then raise exception 'FAIL: the expiry did not move both reservations'; end if;
  reset role;
  after_committed := (select reserved_micros + unreconciled_micros + spent_micros from public.ai_budget_periods where tenant_id = t1);
  if after_committed <> before_committed then raise exception 'FAIL: the expiry freed room (% -> %)', before_committed, after_committed; end if;
  if (select unreconciled_micros from public.ai_budget_periods where tenant_id = t1) <> 500 then raise exception 'FAIL: unreconciled is not 500'; end if;
  if (select count(*) from public.ai_reservations where status = 'expired_unreconciled') <> 2 then raise exception 'FAIL: the reservations are not marked expired'; end if;

  -- an expired reservation cannot be released, and reconciling it needs the provider's attempts
  set local role service_role;
  if pg_temp.state_of(format('select public.release_ai_budget(%L)', a)) <> '23514' then raise exception 'FAIL: an expired reservation was released'; end if;
  if pg_temp.state_of(format('select public.settle_ai_budget(%L, %L::jsonb)', a, '[]')) <> '22023' then raise exception 'FAIL: an expired reservation was reconciled without attempts'; end if;
  res := public.settle_ai_budget(a, '[{"attempt_no":1,"role":"primary","provider":"p1","model":"m1","input_tokens":10,"output_tokens":5,"cost_micros":30,"billable":true}]'::jsonb);
  if (res ->> 'settledMicros')::bigint <> 30 then raise exception 'FAIL: the reconciliation did not settle 30 (%)', res; end if;
  reset role;

  -- a company cannot write off, not even its owner: that would reopen the platform's budget on the company's own word
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000001', 'budget-o@example.test');
  if pg_temp.state_of(format('select public.write_off_ai_reservation(%L, %L)', b, 'el proveedor confirmo por escrito que no hubo cobro')) <> '42501' then raise exception 'FAIL: the owner wrote off a reservation'; end if;
  reset role;
  if (select unreconciled_micros from public.ai_budget_periods where tenant_id = t1) <> 200 then raise exception 'FAIL: a refused write-off moved the unreconciled amount'; end if;

  -- the platform writes off, with a written reason, once
  set local role service_role;
  if pg_temp.state_of(format('select public.write_off_ai_reservation(%L, %L)', b, 'corto')) <> '22023' then raise exception 'FAIL: a write-off without a real reason was accepted'; end if;
  perform public.write_off_ai_reservation(b, 'el proveedor confirmo por escrito que no hubo cobro');
  if pg_temp.state_of(format('select public.write_off_ai_reservation(%L, %L)', b, 'el proveedor confirmo por escrito que no hubo cobro')) <> '23514' then raise exception 'FAIL: a reservation was written off twice'; end if;
  reset role;
  if (select unreconciled_micros from public.ai_budget_periods where tenant_id = t1) <> 0 then raise exception 'FAIL: unreconciled is not 0 after reconciling and writing off'; end if;
  if not exists (select 1 from public.action_log where action_kind = 'ai.budget.written_off' and tenant_id = t1 and actor_type = 'system') then raise exception 'FAIL: the write-off was not logged as a system action'; end if;
  -- a limit cannot be lowered under what is committed
  set local role service_role;
  if pg_temp.state_of($q$select public.assign_ai_budget('30000000-0000-4000-8000-0000000000b1', date_trunc('month', now() at time zone 'utc')::date, 10)$q$) <> '23514' then raise exception 'FAIL: a limit below the committed amount was accepted'; end if;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Reading: only owners and admins, only their own company
-- ---------------------------------------------------------------------------
do $$
begin
  set local role service_role;
  perform public.assign_ai_budget('30000000-0000-4000-8000-0000000000b2', date_trunc('month', now() at time zone 'utc')::date, 500);
  reset role;
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000001', 'budget-o@example.test');
  if (select count(*) from public.ai_budget_periods where tenant_id = '30000000-0000-4000-8000-0000000000b1') <> 1 then raise exception 'FAIL: the owner does not read its budget'; end if;
  if (select count(*) from public.ai_budget_periods where tenant_id = '30000000-0000-4000-8000-0000000000b2') <> 0 then raise exception 'FAIL: the owner reads another company'; end if;
  reset role;
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000002', 'budget-m@example.test');
  if (select count(*) from public.ai_budget_periods) <> 0 or (select count(*) from public.ai_reservations) <> 0 or (select count(*) from public.ai_usage_attempts) <> 0 then raise exception 'FAIL: a plain member reads the budget'; end if;
  reset role;
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000004', 'budget-x@example.test');
  if (select count(*) from public.ai_budget_periods where tenant_id = '30000000-0000-4000-8000-0000000000b1') <> 0 then raise exception 'FAIL: another company reads T1'; end if;
  if (select count(*) from public.ai_budget_periods) <> 1 then raise exception 'FAIL: the owner of T2 does not read exactly its own'; end if;
  -- no direct write
  if pg_temp.state_of($q$insert into public.ai_budget_periods (tenant_id, period_start, limit_micros) values ('30000000-0000-4000-8000-0000000000b2', '2020-01-01', 999999)$q$) <> '42501' then raise exception 'FAIL: a company inserted its own budget'; end if;
  if pg_temp.state_of($q$update public.ai_budget_periods set limit_micros = 999999$q$) <> '42501' then raise exception 'FAIL: a company raised its own limit'; end if;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Cap of calls (the first AI test: 30 billable calls in total): atomic with the money, idempotent, returned by a release, never freed by the expiry
-- ---------------------------------------------------------------------------
do $$
declare res jsonb; k1 uuid; k3 uuid; used int;
  t4 constant uuid := '30000000-0000-4000-8000-0000000000b4';
  uo constant uuid := '30000000-0000-4000-8000-000000000001';
  p constant date := date_trunc('month', now() at time zone 'utc')::date;
begin
  -- a cap needs the period's budget first
  set local role service_role;
  if pg_temp.state_of($q$select public.assign_ai_call_cap('30000000-0000-4000-8000-0000000000b4', date_trunc('month', now() at time zone 'utc')::date, 3)$q$) <> '23514' then raise exception 'FAIL: a cap was set before the budget'; end if;
  perform public.assign_ai_budget(t4, p, 1000000);
  if pg_temp.state_of($q$select public.assign_ai_call_cap('30000000-0000-4000-8000-0000000000b4', date_trunc('month', now() at time zone 'utc')::date, -1)$q$) <> '22023' then raise exception 'FAIL: a negative cap was accepted'; end if;
  perform public.assign_ai_call_cap(t4, p, 3);
  reset role;

  -- a company never sets its own cap
  perform pg_temp.as_user(uo, 'budget-o@example.test');
  if pg_temp.state_of($q$select public.assign_ai_call_cap('30000000-0000-4000-8000-0000000000b4', date_trunc('month', now() at time zone 'utc')::date, 999)$q$) <> '42501' then raise exception 'FAIL: a company set its own cap'; end if;
  if pg_temp.state_of($q$update public.ai_budget_periods set max_calls = 999$q$) <> '42501' then raise exception 'FAIL: a company edited its cap directly'; end if;
  reset role;

  -- 3 calls fit, the 4th is refused with its own reason, and the refusal leaves no row and uses no call
  set local role service_role;
  k1 := (public.reserve_ai_budget(t4, uo, 'message.draft', 100, 'c-1', 300) ->> 'reservationId')::uuid;
  perform public.reserve_ai_budget(t4, uo, 'message.draft', 100, 'c-2', 300);
  k3 := (public.reserve_ai_budget(t4, uo, 'message.draft', 100, 'c-3', 300) ->> 'reservationId')::uuid;
  res := public.reserve_ai_budget(t4, uo, 'message.draft', 100, 'c-4', 300);
  if res ->> 'ok' <> 'false' or res ->> 'reason' <> 'call_limit_reached' then raise exception 'FAIL: the 4th call was not refused by the cap (%)', res; end if;
  reset role;
  if (select calls_used from public.ai_budget_periods where tenant_id = t4) <> 3 then raise exception 'FAIL: calls_used is not 3'; end if;
  if (select count(*) from public.ai_reservations where tenant_id = t4) <> 3 then raise exception 'FAIL: the refused call left a row'; end if;

  -- a user cannot get around the counter by releasing or settling directly: the slots stay used
  perform pg_temp.as_user(uo, 'budget-o@example.test');
  if pg_temp.state_of(format('select public.release_ai_budget(%L)', k3)) <> '42501' then raise exception 'FAIL: a user released a slot of the cap'; end if;
  if pg_temp.state_of(format('select public.reserve_ai_budget(%L, %L, %L, 1, %L, 300)', t4, uo, 'message.draft', 'c-direct')) <> '42501' then raise exception 'FAIL: a user reserved a call directly'; end if;
  reset role;
  if (select calls_used from public.ai_budget_periods where tenant_id = t4) <> 3 then raise exception 'FAIL: a user moved the counter'; end if;

  -- a retry of an existing key is the same call: it finds its reservation even at the cap and does not use another
  set local role service_role;
  res := public.reserve_ai_budget(t4, uo, 'message.draft', 100, 'c-1', 300);
  if res ->> 'ok' <> 'true' or res ->> 'repeated' <> 'true' then raise exception 'FAIL: a retried key was refused or counted again (%)', res; end if;
  reset role;
  if (select calls_used from public.ai_budget_periods where tenant_id = t4) <> 3 then raise exception 'FAIL: a retried key used another call'; end if;

  -- a call that never reached a provider is released BY THE SERVER: its slot returns, and a new request can use it
  set local role service_role;
  perform public.release_ai_budget(k3);
  reset role;
  if (select calls_used from public.ai_budget_periods where tenant_id = t4) <> 2 then raise exception 'FAIL: a release did not return its call'; end if;
  set local role service_role;
  res := public.reserve_ai_budget(t4, uo, 'message.draft', 100, 'c-5', 300);
  if res ->> 'ok' <> 'true' then raise exception 'FAIL: the returned call could not be reused (%)', res; end if;

  -- a settlement that reports a retry AND a fallback (3 billable attempts) counts the 2 extra calls once: the cap is then over-used and refuses
  perform public.settle_ai_budget(k1, '[{"attempt_no":1,"role":"primary","provider":"p1","model":"m1","input_tokens":1,"output_tokens":1,"cost_micros":1,"billable":true},{"attempt_no":2,"role":"retry","provider":"p1","model":"m1","input_tokens":1,"output_tokens":1,"cost_micros":1,"billable":true},{"attempt_no":3,"role":"fallback","provider":"p2","model":"m2","input_tokens":1,"output_tokens":1,"cost_micros":1,"billable":true}]'::jsonb);
  perform public.settle_ai_budget(k1, '[{"attempt_no":1,"role":"primary","provider":"p1","model":"m1","input_tokens":1,"output_tokens":1,"cost_micros":1,"billable":true}]'::jsonb); -- a replay counts nothing
  reset role;
  select calls_used into used from public.ai_budget_periods where tenant_id = t4;
  if used <> 5 then raise exception 'FAIL: extra billable attempts were not counted once (calls_used %)', used; end if;
  set local role service_role;
  res := public.reserve_ai_budget(t4, uo, 'message.draft', 100, 'c-6', 300);
  if res ->> 'reason' <> 'call_limit_reached' then raise exception 'FAIL: an over-used cap still granted a call (%)', res; end if;
  reset role;

  -- the expiry never frees a call
  update public.ai_reservations set expires_at = now() - interval '1 minute' where tenant_id = t4 and idempotency_key = 'c-5';
  set local role service_role;
  perform public.expire_ai_reservations();
  reset role;
  if (select calls_used from public.ai_budget_periods where tenant_id = t4) <> 5 then raise exception 'FAIL: the expiry freed a call'; end if;
  if (select status from public.ai_reservations where tenant_id = t4 and idempotency_key = 'c-5') <> 'expired_unreconciled' then raise exception 'FAIL: the reservation did not expire'; end if;

  -- a cap cannot go below the calls already used; raising it or removing it is the platform's decision
  set local role service_role;
  if pg_temp.state_of($q$select public.assign_ai_call_cap('30000000-0000-4000-8000-0000000000b4', date_trunc('month', now() at time zone 'utc')::date, 4)$q$) <> '23514' then raise exception 'FAIL: a cap below the calls used was accepted'; end if;
  perform public.assign_ai_call_cap(t4, p, 6);
  res := public.reserve_ai_budget(t4, uo, 'message.draft', 100, 'c-7', 300);
  if res ->> 'ok' <> 'true' then raise exception 'FAIL: a raised cap did not allow a call (%)', res; end if;
  perform public.assign_ai_call_cap(t4, p, null);
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Deleting a company removes its budget records (the append-only attempts included)
-- ---------------------------------------------------------------------------
do $$
declare rid uuid;
  t3 constant uuid := '30000000-0000-4000-8000-0000000000b3';
  uo constant uuid := '30000000-0000-4000-8000-000000000001';
begin
  set local role service_role;
  perform public.assign_ai_budget(t3, date_trunc('month', now() at time zone 'utc')::date, 1000);
  rid := (public.reserve_ai_budget(t3, uo, 'message.draft', 100, 'k-del', 300) ->> 'reservationId')::uuid;
  perform public.settle_ai_budget(rid, '[{"attempt_no":1,"role":"primary","provider":"p1","model":"m1","input_tokens":1,"output_tokens":1,"cost_micros":10,"billable":true}]'::jsonb);
  reset role;
  perform pg_temp.as_user(uo, 'budget-o@example.test');
  perform public.delete_company(t3, 'Empresa Tres');
  reset role;
  if exists (select 1 from public.ai_budget_periods where tenant_id = t3)
     or exists (select 1 from public.ai_reservations where tenant_id = t3)
     or exists (select 1 from public.ai_usage_attempts where tenant_id = t3) then raise exception 'FAIL: deleting the company left budget records'; end if;
end $$;

select 'ai_budget: all checks passed' as result;
