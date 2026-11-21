-- AI budget tests (ADR-0036): RLS and privileges of ai_budget_periods, ai_reservations and ai_usage_attempts, the atomic reservation, idempotency, settlement of every billable attempt (retries
-- and fallbacks included), what an expired reservation does and does not free, the written-off decision, the UTC month, isolation between companies and company deletion.
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/tests/ai_budget.sql   (after 00_bootstrap.sql and every migration). The parallel part is supabase/tests/ai_budget_concurrency.sh.
-- Fictitious data only. A failed expectation raises an exception and stops the run (non-zero exit).
--
-- Actors: O owns T1; M is a plain member of T1; V is a viewer of T1; X owns T2 and has nothing in T1.

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
  ('30000000-0000-4000-8000-0000000000b3', 'Empresa Tres');

insert into public.memberships (user_id, tenant_id, role) values
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-0000000000b1', 'owner'),
  ('30000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-0000000000b1', 'member'),
  ('30000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-0000000000b1', 'viewer'),
  ('30000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-0000000000b2', 'owner'),
  ('30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-0000000000b3', 'owner');

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

  foreach t in array array['public.reserve_ai_budget(uuid, text, bigint, text, int)', 'public.settle_ai_budget(uuid, jsonb)', 'public.release_ai_budget(uuid)', 'public.write_off_ai_reservation(uuid, text)'] loop
    if not has_function_privilege('authenticated', t, 'execute') then raise exception 'FAIL: authenticated cannot run %', t; end if;
    if has_function_privilege('anon', t, 'execute') or has_function_privilege('service_role', t, 'execute') then raise exception 'FAIL: % is open to anon or the server key', t; end if;
  end loop;
  -- the platform assigns limits and runs the expiry; a company never does
  foreach t in array array['public.assign_ai_budget(uuid, date, bigint)', 'public.expire_ai_reservations()'] loop
    if not has_function_privilege('service_role', t, 'execute') then raise exception 'FAIL: the server key cannot run %', t; end if;
    if has_function_privilege('authenticated', t, 'execute') or has_function_privilege('anon', t, 'execute') then raise exception 'FAIL: % is open to a signed-in user', t; end if;
  end loop;
  if has_function_privilege('authenticated', 'private.ai_budget_period()', 'execute') then raise exception 'FAIL: the private period function is exposed'; end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('reserve_ai_budget', 'settle_ai_budget', 'release_ai_budget',
     'write_off_ai_reservation', 'assign_ai_budget', 'expire_ai_reservations') and (not p.prosecdef or p.proconfig is null or not ('search_path=""' = any (p.proconfig)))) then
    raise exception 'FAIL: a budget function is not security definer with an empty search_path';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- No assignment = no budget; limit 0 = nothing reservable; only the platform assigns
-- ---------------------------------------------------------------------------
do $$
declare res jsonb;
begin
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000002', 'budget-m@example.test');
  res := public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', 'message.draft', 100, 'k-none', 300);
  if res ->> 'ok' <> 'false' or res ->> 'reason' <> 'no_budget' then raise exception 'FAIL: a company with no assignment reserved something (%)', res; end if;
  if (select count(*) from public.ai_reservations) <> 0 then raise exception 'FAIL: a rejected reservation left a row'; end if;

  -- a company cannot give itself a budget
  if pg_temp.state_of($q$select public.assign_ai_budget('30000000-0000-4000-8000-0000000000b1', date_trunc('month', now() at time zone 'utc')::date, 1000000)$q$) <> '42501' then raise exception 'FAIL: a member assigned a budget'; end if;
  reset role;
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000001', 'budget-o@example.test');
  if pg_temp.state_of($q$select public.assign_ai_budget('30000000-0000-4000-8000-0000000000b1', date_trunc('month', now() at time zone 'utc')::date, 1000000)$q$) <> '42501' then raise exception 'FAIL: the owner assigned its own budget'; end if;
  reset role;

  -- the platform assigns: an explicit 0 is a budget of 0
  set local role service_role;
  perform public.assign_ai_budget('30000000-0000-4000-8000-0000000000b1', date_trunc('month', now() at time zone 'utc')::date, 0);
  reset role;
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000002', 'budget-m@example.test');
  res := public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', 'message.draft', 100, 'k-zero', 300);
  if res ->> 'reason' <> 'budget_exceeded' then raise exception 'FAIL: a limit of 0 let a reservation through (%)', res; end if;
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
-- Reserve: limit, roles, isolation and idempotency
-- ---------------------------------------------------------------------------
do $$
declare res jsonb; first_id uuid; again jsonb;
begin
  set local role service_role;
  perform public.assign_ai_budget('30000000-0000-4000-8000-0000000000b1', date_trunc('month', now() at time zone 'utc')::date, 1000);
  reset role;

  -- a viewer and another company cannot reserve in T1
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000003', 'budget-v@example.test');
  if pg_temp.state_of($q$select public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', 'message.draft', 100, 'k-v', 300)$q$) <> '42501' then raise exception 'FAIL: a viewer reserved'; end if;
  reset role;
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000004', 'budget-x@example.test');
  if pg_temp.state_of($q$select public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', 'message.draft', 100, 'k-x', 300)$q$) <> '42501' then raise exception 'FAIL: another company reserved in T1'; end if;
  reset role;

  perform pg_temp.as_user('30000000-0000-4000-8000-000000000002', 'budget-m@example.test');
  res := public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', 'message.draft', 400, 'k-1', 300);
  if res ->> 'ok' <> 'true' or res ->> 'repeated' <> 'false' then raise exception 'FAIL: a reservation within the limit was refused (%)', res; end if;
  first_id := (res ->> 'reservationId')::uuid;

  -- a retry with the same key finds the same reservation and reserves nothing more
  again := public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', 'message.draft', 400, 'k-1', 300);
  if (again ->> 'reservationId')::uuid <> first_id or again ->> 'repeated' <> 'true' then raise exception 'FAIL: a retried key made a second reservation (%)', again; end if;
  if pg_temp.state_of($q$select public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', 'message.draft', 999, 'k-1', 300)$q$) <> '23505' then raise exception 'FAIL: a key reused for another request was accepted'; end if;

  res := public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', 'message.draft', 400, 'k-2', 300);
  if res ->> 'ok' <> 'true' then raise exception 'FAIL: the second reservation within the limit was refused'; end if;
  -- 800 held, the third 400 would make 1200 > 1000
  res := public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', 'message.draft', 400, 'k-3', 300);
  if res ->> 'ok' <> 'false' or res ->> 'reason' <> 'budget_exceeded' then raise exception 'FAIL: the limit was exceeded (%)', res; end if;
  reset role;

  if (select reserved_micros from public.ai_budget_periods where tenant_id = '30000000-0000-4000-8000-0000000000b1') <> 800 then raise exception 'FAIL: reserved is not 800'; end if;
  if (select count(*) from public.ai_reservations where tenant_id = '30000000-0000-4000-8000-0000000000b1') <> 2 then raise exception 'FAIL: the refused reservation left a row'; end if;
  -- bad input
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000002', 'budget-m@example.test');
  if pg_temp.state_of($q$select public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', 'message.draft', 0, 'k-bad', 300)$q$) <> '22023' then raise exception 'FAIL: a zero estimate was accepted'; end if;
  if pg_temp.state_of($q$select public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', 'Message Draft', 10, 'k-bad', 300)$q$) <> '22023' then raise exception 'FAIL: a bad purpose was accepted'; end if;
  if pg_temp.state_of($q$select public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', 'message.draft', 10, 'k-bad', 5)$q$) <> '22023' then raise exception 'FAIL: a ttl under 30 seconds was accepted'; end if;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Settle: every billable attempt counts (retries and fallbacks too), once
-- ---------------------------------------------------------------------------
do $$
declare
  rid uuid; res jsonb;
  attempts jsonb := '[
    {"attempt_no":1,"role":"primary","provider":"p1","model":"m1","input_tokens":100,"output_tokens":0,"cost_micros":60,"billable":true},
    {"attempt_no":2,"role":"retry","provider":"p1","model":"m1","input_tokens":100,"output_tokens":20,"cost_micros":100,"billable":true},
    {"attempt_no":3,"role":"fallback","provider":"p2","model":"m2","input_tokens":100,"output_tokens":40,"cost_micros":130,"billable":true},
    {"attempt_no":4,"role":"fallback","provider":"p3","model":"m3","input_tokens":0,"output_tokens":0,"cost_micros":999,"billable":false}
  ]'::jsonb;
begin
  rid := (select id from public.ai_reservations where idempotency_key = 'k-1' and tenant_id = '30000000-0000-4000-8000-0000000000b1');
  -- a viewer and another company cannot settle it
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000003', 'budget-v@example.test');
  if pg_temp.state_of(format('select public.settle_ai_budget(%L, %L::jsonb)', rid, attempts)) <> '42501' then raise exception 'FAIL: a viewer settled'; end if;
  reset role;
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000004', 'budget-x@example.test');
  if pg_temp.state_of(format('select public.settle_ai_budget(%L, %L::jsonb)', rid, attempts)) <> '42501' then raise exception 'FAIL: another company settled'; end if;
  reset role;

  perform pg_temp.as_user('30000000-0000-4000-8000-000000000002', 'budget-m@example.test');
  res := public.settle_ai_budget(rid, attempts);
  -- 60 + 100 + 130 = 290: the retry and the fallback are billed, the unbilled attempt is not
  if (res ->> 'settledMicros')::bigint <> 290 or (res ->> 'overageMicros')::bigint <> 0 then raise exception 'FAIL: the settled cost is not 290 (%)', res; end if;
  -- settling again, even with other numbers, changes nothing
  res := public.settle_ai_budget(rid, '[{"attempt_no":1,"role":"primary","provider":"p1","model":"m1","input_tokens":1,"output_tokens":1,"cost_micros":500,"billable":true}]'::jsonb);
  if res ->> 'repeated' <> 'true' or (res ->> 'settledMicros')::bigint <> 290 then raise exception 'FAIL: a second settlement changed the cost (%)', res; end if;
  reset role;

  if (select count(*) from public.ai_usage_attempts where reservation_id = rid) <> 4 then raise exception 'FAIL: the attempts were not all stored once'; end if;
  -- reserved fell by the reservation (400), spent rose by the cost (290): the 110 not spent is free again
  if (select reserved_micros || ':' || spent_micros from public.ai_budget_periods where tenant_id = '30000000-0000-4000-8000-0000000000b1') <> '400:290' then
    raise exception 'FAIL: the period does not read 400 reserved and 290 spent';
  end if;

  -- a call that cost more than it reserved: the overage is recorded and counts as spent
  rid := (select id from public.ai_reservations where idempotency_key = 'k-2' and tenant_id = '30000000-0000-4000-8000-0000000000b1');
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000002', 'budget-m@example.test');
  res := public.settle_ai_budget(rid, '[{"attempt_no":1,"role":"primary","provider":"p1","model":"m1","input_tokens":1,"output_tokens":1,"cost_micros":450,"billable":true}]'::jsonb);
  if (res ->> 'overageMicros')::bigint <> 50 then raise exception 'FAIL: the overage is not 50 (%)', res; end if;
  reset role;
  if (select spent_micros from public.ai_budget_periods where tenant_id = '30000000-0000-4000-8000-0000000000b1') <> 740 then raise exception 'FAIL: spent is not 740'; end if;
  -- the attempts of a company are append-only, even for the owner of the table
  if pg_temp.state_of($q$update public.ai_usage_attempts set cost_micros = 0$q$) <> '42501' then raise exception 'FAIL: an attempt was rewritten'; end if;
  if pg_temp.state_of($q$delete from public.ai_usage_attempts$q$) <> '42501' then raise exception 'FAIL: an attempt was deleted'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Release: only a held reservation that never reached a provider
-- ---------------------------------------------------------------------------
do $$
declare rid uuid; res jsonb;
begin
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000002', 'budget-m@example.test');
  res := public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', 'message.draft', 100, 'k-rel', 300);
  rid := (res ->> 'reservationId')::uuid;
  perform public.release_ai_budget(rid);
  if pg_temp.state_of(format('select public.release_ai_budget(%L)', rid)) <> '23514' then raise exception 'FAIL: a released reservation was released again'; end if;
  if pg_temp.state_of(format('select public.settle_ai_budget(%L, %L::jsonb)', rid, '[]')) <> '23514' then raise exception 'FAIL: a released reservation was settled'; end if;
  reset role;
  -- both earlier reservations are settled (reserved 0, spent 740); the released 100 left nothing behind
  if (select reserved_micros from public.ai_budget_periods where tenant_id = '30000000-0000-4000-8000-0000000000b1') <> 0 then raise exception 'FAIL: release did not return the 100'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Expiry never frees room; reconciling or writing off does
-- ---------------------------------------------------------------------------
do $$
declare a uuid; b uuid; res jsonb; before_committed bigint; after_committed bigint;
begin
  -- spent is 740 against a limit of 1000: the platform raises the limit so that there is room to work with.
  set local role service_role;
  perform public.assign_ai_budget('30000000-0000-4000-8000-0000000000b1', date_trunc('month', now() at time zone 'utc')::date, 2000);
  reset role;

  perform pg_temp.as_user('30000000-0000-4000-8000-000000000002', 'budget-m@example.test');
  a := (public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', 'message.draft', 300, 'k-exp-a', 300) ->> 'reservationId')::uuid;
  b := (public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b1', 'message.draft', 200, 'k-exp-b', 300) ->> 'reservationId')::uuid;
  reset role;
  -- both are past their expiry (the clock is not mocked: the rows are aged, as the maintenance job would find them)
  update public.ai_reservations set expires_at = now() - interval '1 minute' where id in (a, b);

  before_committed := (select reserved_micros + unreconciled_micros + spent_micros from public.ai_budget_periods where tenant_id = '30000000-0000-4000-8000-0000000000b1');
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000001', 'budget-o@example.test');
  if pg_temp.state_of($q$select public.expire_ai_reservations()$q$) <> '42501' then raise exception 'FAIL: a signed-in user ran the expiry'; end if;
  reset role;
  set local role service_role;
  if public.expire_ai_reservations() <> 2 then raise exception 'FAIL: the expiry did not move both reservations'; end if;
  reset role;
  after_committed := (select reserved_micros + unreconciled_micros + spent_micros from public.ai_budget_periods where tenant_id = '30000000-0000-4000-8000-0000000000b1');
  if after_committed <> before_committed then raise exception 'FAIL: the expiry freed room (% -> %)', before_committed, after_committed; end if;
  if (select unreconciled_micros from public.ai_budget_periods where tenant_id = '30000000-0000-4000-8000-0000000000b1') <> 500 then raise exception 'FAIL: unreconciled is not 500'; end if;
  if (select count(*) from public.ai_reservations where status = 'expired_unreconciled') <> 2 then raise exception 'FAIL: the reservations are not marked expired'; end if;

  -- an expired reservation cannot be released, and reconciling it needs the provider's attempts
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000002', 'budget-m@example.test');
  if pg_temp.state_of(format('select public.release_ai_budget(%L)', a)) <> '23514' then raise exception 'FAIL: an expired reservation was released'; end if;
  if pg_temp.state_of(format('select public.settle_ai_budget(%L, %L::jsonb)', a, '[]')) <> '22023' then raise exception 'FAIL: an expired reservation was reconciled without attempts'; end if;
  res := public.settle_ai_budget(a, '[{"attempt_no":1,"role":"primary","provider":"p1","model":"m1","input_tokens":10,"output_tokens":5,"cost_micros":30,"billable":true}]'::jsonb);
  if (res ->> 'settledMicros')::bigint <> 30 then raise exception 'FAIL: the reconciliation did not settle 30 (%)', res; end if;
  -- a plain member cannot write off
  if pg_temp.state_of(format('select public.write_off_ai_reservation(%L, %L)', b, 'el proveedor confirmo que no hubo cobro')) <> '42501' then raise exception 'FAIL: a member wrote off a reservation'; end if;
  reset role;
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000001', 'budget-o@example.test');
  if pg_temp.state_of(format('select public.write_off_ai_reservation(%L, %L)', b, 'corto')) <> '22023' then raise exception 'FAIL: a write-off without a real reason was accepted'; end if;
  perform public.write_off_ai_reservation(b, 'el proveedor confirmo por escrito que no hubo cobro');
  if pg_temp.state_of(format('select public.write_off_ai_reservation(%L, %L)', b, 'el proveedor confirmo por escrito que no hubo cobro')) <> '23514' then raise exception 'FAIL: a reservation was written off twice'; end if;
  reset role;
  if (select unreconciled_micros from public.ai_budget_periods where tenant_id = '30000000-0000-4000-8000-0000000000b1') <> 0 then raise exception 'FAIL: unreconciled is not 0 after reconciling and writing off'; end if;
  if not exists (select 1 from public.action_log where action_kind = 'ai.budget.written_off' and tenant_id = '30000000-0000-4000-8000-0000000000b1') then raise exception 'FAIL: the write-off was not logged'; end if;
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
-- Deleting a company removes its budget records (the append-only attempts included)
-- ---------------------------------------------------------------------------
do $$
declare rid uuid;
begin
  set local role service_role;
  perform public.assign_ai_budget('30000000-0000-4000-8000-0000000000b3', date_trunc('month', now() at time zone 'utc')::date, 1000);
  reset role;
  perform pg_temp.as_user('30000000-0000-4000-8000-000000000001', 'budget-o@example.test');
  rid := (public.reserve_ai_budget('30000000-0000-4000-8000-0000000000b3', 'message.draft', 100, 'k-del', 300) ->> 'reservationId')::uuid;
  perform public.settle_ai_budget(rid, '[{"attempt_no":1,"role":"primary","provider":"p1","model":"m1","input_tokens":1,"output_tokens":1,"cost_micros":10,"billable":true}]'::jsonb);
  perform public.delete_company('30000000-0000-4000-8000-0000000000b3', 'Empresa Tres');
  reset role;
  if exists (select 1 from public.ai_budget_periods where tenant_id = '30000000-0000-4000-8000-0000000000b3')
     or exists (select 1 from public.ai_reservations where tenant_id = '30000000-0000-4000-8000-0000000000b3')
     or exists (select 1 from public.ai_usage_attempts where tenant_id = '30000000-0000-4000-8000-0000000000b3') then raise exception 'FAIL: deleting the company left budget records'; end if;
end $$;

select 'ai_budget: all checks passed' as result;
