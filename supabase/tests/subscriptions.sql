-- Subscription tests (ADR-0037, minimum persistence): RLS and privileges, internal costs hidden, append-only history, one grant per payment however many events carry it, incompatible identities
-- refused, early / out-of-order / paid-ahead events kept pending and resumed in order, reactivation as a NEW cycle at the confirmed instant, a failed payment, isolation between companies and company deletion.
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/tests/subscriptions.sql   (after 00_bootstrap.sql and every migration). The parallel part is supabase/tests/subscriptions_concurrency.sh and the
-- date-function parity with lib/billing-periods.ts is supabase/tests/billing_parity.sql.
-- Fictitious data only: the plans and the payments are invented for the test (no catalog, no price, no provider). A failed expectation raises an exception and stops the run (non-zero exit).
--
-- Actors: O owns T1; M is a plain member of T1; V is a viewer of T1; X owns T2. The "server" is the service_role: the only role that records a payment.

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

create function pg_temp.expect(cond boolean, msg text)
returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
end $$;

-- the server records an event (as service_role) and gets the answer
create function pg_temp.ev(p_sub uuid, p_tenant uuid, p_event text, p_kind text, p_payment text, p_at timestamptz, p_hash text default null, p_concept text default 'included')
returns jsonb language plpgsql as $$
declare r jsonb;
begin
  set local role service_role;
  r := public.apply_payment_event('prov-test', p_event, p_kind, p_payment, p_concept, p_tenant, p_sub, p_at, coalesce(p_hash, 'h-' || p_payment));
  reset role;
  return r;
end $$;

insert into auth.users (id, email) values
  ('50000000-0000-4000-8000-000000000001', 'sub-o@example.test'),
  ('50000000-0000-4000-8000-000000000002', 'sub-m@example.test'),
  ('50000000-0000-4000-8000-000000000003', 'sub-v@example.test'),
  ('50000000-0000-4000-8000-000000000004', 'sub-x@example.test');

insert into public.tenants (id, name) values
  ('50000000-0000-4000-8000-0000000000b1', 'Empresa Uno'), ('50000000-0000-4000-8000-0000000000b2', 'Empresa Dos'), ('50000000-0000-4000-8000-0000000000b3', 'Empresa Tres'),
  ('50000000-0000-4000-8000-0000000000b4', 'Empresa Cuatro'), ('50000000-0000-4000-8000-0000000000b5', 'Empresa Cinco'), ('50000000-0000-4000-8000-0000000000b6', 'Empresa Seis'),
  ('50000000-0000-4000-8000-0000000000b7', 'Empresa Siete'), ('50000000-0000-4000-8000-0000000000b8', 'Empresa Ocho');

insert into public.memberships (user_id, tenant_id, role) values
  ('50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-0000000000b1', 'owner'),
  ('50000000-0000-4000-8000-000000000002', '50000000-0000-4000-8000-0000000000b1', 'member'),
  ('50000000-0000-4000-8000-000000000003', '50000000-0000-4000-8000-0000000000b1', 'viewer'),
  ('50000000-0000-4000-8000-000000000004', '50000000-0000-4000-8000-0000000000b2', 'owner'),
  ('50000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-0000000000b8', 'owner');

-- ---------------------------------------------------------------------------
-- Static checks: RLS, privileges, who can run what, internal costs
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['plan_versions', 'subscriptions', 'subscription_cycles', 'billing_periods', 'payment_events', 'ai_allocation_grants'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'FAIL: RLS is off on %', t; end if;
    if (select count(*) from pg_policy where polrelid = ('public.' || t)::regclass) < 1 then raise exception 'FAIL: % has no policy', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'select') then raise exception 'FAIL: anon reaches %', t; end if;
    if has_table_privilege('authenticated', 'public.' || t, 'insert') or has_table_privilege('authenticated', 'public.' || t, 'update') or has_table_privilege('authenticated', 'public.' || t, 'delete')
      then raise exception 'FAIL: authenticated can write % directly', t; end if;
    if has_table_privilege('service_role', 'public.' || t, 'select') or has_table_privilege('service_role', 'public.' || t, 'insert') then raise exception 'FAIL: the server key reaches %', t; end if;
  end loop;
  -- the internal cost of a plan is not readable by any signed-in role; the visible columns are
  if has_column_privilege('authenticated', 'public.plan_versions', 'internal_cost_micros', 'select') or has_column_privilege('anon', 'public.plan_versions', 'internal_cost_micros', 'select')
    then raise exception 'FAIL: the internal cost of a plan is readable'; end if;
  if not has_column_privilege('authenticated', 'public.plan_versions', 'included_micros', 'select') then raise exception 'FAIL: the visible columns of a plan are not readable'; end if;

  foreach t in array array['public.create_plan_version(text, int, text, bigint, int, bigint)', 'public.create_subscription(uuid, uuid, text)',
    'public.apply_payment_event(text, text, text, text, text, uuid, uuid, timestamptz, text)', 'public.subscription_access(uuid, timestamptz)'] loop
    if not has_function_privilege('service_role', t, 'execute') then raise exception 'FAIL: the server key cannot run %', t; end if;
    if has_function_privilege('authenticated', t, 'execute') or has_function_privilege('anon', t, 'execute') then raise exception 'FAIL: % is open to a signed-in user or anon', t; end if;
  end loop;
  foreach t in array array['private.local_day_start(date, text)', 'private.cycle_period_bounds(date, text, timestamptz, int)', 'private.apply_confirmed_payment(uuid)'] loop
    if has_function_privilege('authenticated', t, 'execute') or has_function_privilege('anon', t, 'execute') or has_function_privilege('service_role', t, 'execute') then raise exception 'FAIL: the private function % is exposed', t; end if;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname in ('create_plan_version', 'create_subscription', 'apply_payment_event', 'subscription_access')
     and (not p.prosecdef or p.proconfig is null or not ('search_path=""' = any (p.proconfig)))) then
    raise exception 'FAIL: a subscription function is not security definer with an empty search_path';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Plans (fictitious) and subscriptions: only the platform creates them; the time zone and the plan are not edited
-- ---------------------------------------------------------------------------
do $$
declare
  pa uuid; pb uuid; sub uuid;
  t1 constant uuid := '50000000-0000-4000-8000-0000000000b1';
begin
  set local role service_role;
  pa := public.create_plan_version('test-plan-a', 1, 'Plan de prueba A', 1000000, 30, 250000);
  pb := public.create_plan_version('test-plan-b', 1, 'Plan de prueba B', 5000000, null, 900000);
  if pg_temp.state_of($q$select public.create_plan_version('test-plan-a', 1, 'duplicada', 1)$q$) <> '23505' then raise exception 'FAIL: a plan version was created twice'; end if;
  if pg_temp.state_of($q$select public.create_plan_version('Bad Code', 1, 'x', 1)$q$) <> '23514' then raise exception 'FAIL: an invalid plan code was accepted'; end if;
  if pg_temp.state_of(format($q$select public.create_subscription('%s', '%s', 'No/Such_Zone')$q$, t1, pa)) <> '22023' then raise exception 'FAIL: an invalid time zone was accepted'; end if;
  if pg_temp.state_of(format($q$select public.create_subscription(gen_random_uuid(), '%s', 'America/Costa_Rica')$q$, pa)) <> '42501' then raise exception 'FAIL: a subscription for no company was accepted'; end if;
  sub := public.create_subscription(t1, pa, 'America/Costa_Rica');
  if pg_temp.state_of(format($q$select public.create_subscription('%s', '%s', 'America/Costa_Rica')$q$, t1, pa)) <> '23505' then raise exception 'FAIL: a company got two live subscriptions'; end if;
  reset role;
  perform pg_temp.expect((select status from public.subscriptions where id = sub) = 'pending', 'a new subscription is pending until the first payment');
end $$;

do $$
declare sub uuid := (select id from public.subscriptions where tenant_id = '50000000-0000-4000-8000-0000000000b1');
begin
  set local role service_role;
  perform pg_temp.expect((public.subscription_access(sub, '2026-01-01 00:00:00+00') ->> 'state') = 'none', 'before the first payment there is no access');
  reset role;
  -- the time zone and the company never change
  if pg_temp.state_of(format($q$update public.subscriptions set timezone = 'America/New_York' where id = '%s'$q$, sub)) <> '42501' then raise exception 'FAIL: the time zone of a subscription changed'; end if;
  if pg_temp.state_of(format($q$update public.subscriptions set tenant_id = '50000000-0000-4000-8000-0000000000b2' where id = '%s'$q$, sub)) <> '42501' then raise exception 'FAIL: the company of a subscription changed'; end if;
  -- plan versions are never edited
  if pg_temp.state_of($q$update public.plan_versions set included_micros = 1$q$) <> '42501' then raise exception 'FAIL: a plan version was edited'; end if;
  if pg_temp.state_of($q$delete from public.plan_versions$q$) <> '42501' then raise exception 'FAIL: a plan version was deleted'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- First activation, then a renewal paid in time, with EVENT duplicates, a duplicate of the same PAYMENT under another event, and incompatible identities
-- Time zone America/Costa_Rica (UTC-6, no daylight saving): 06:00Z is 00:00 local.
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb; c record; p record;
  t1 constant uuid := '50000000-0000-4000-8000-0000000000b1';
  sub uuid := (select id from public.subscriptions where tenant_id = '50000000-0000-4000-8000-0000000000b1');
begin
  -- a payment that is not confirmed yet grants nothing; a payment for a subscription of another company is refused
  r := pg_temp.ev(sub, t1, 'evt-fail-0', 'payment_failed', 'pay-fail-0', null);
  perform pg_temp.expect(r ->> 'status' = 'ignored' and r ->> 'reason' = 'payment_failed_no_grant', 'a failed payment is ignored: ' || r::text);
  perform pg_temp.expect((select count(*) from public.subscription_cycles where subscription_id = sub) = 0, 'a failed payment opened a cycle');
  if pg_temp.state_of(format($q$select pg_temp.ev('%s', '50000000-0000-4000-8000-0000000000b2', 'evt-x', 'payment_confirmed', 'pay-x', now())$q$, sub)) <> '42501' then raise exception 'FAIL: an event for another company was accepted'; end if;

  -- 1. first payment: confirmed 09:00 local on 8 Jan 2026
  r := pg_temp.ev(sub, t1, 'evt-1a', 'payment_confirmed', 'pay-1', '2026-01-08 15:00:00+00');
  perform pg_temp.expect(r ->> 'status' = 'applied' and (r ->> 'duplicate') = 'false', 'the first payment was not applied: ' || r::text);
  select * into c from public.subscription_cycles where subscription_id = sub;
  perform pg_temp.expect(c.cycle_index = 0 and c.anchor_date = date '2026-01-08' and c.activated_at = timestamptz '2026-01-08 15:00:00+00', 'the first cycle is wrong');
  select * into p from public.billing_periods where cycle_id = c.id;
  perform pg_temp.expect(p.period_index = 0 and p.starts_at = timestamptz '2026-01-08 15:00:00+00' and p.ends_at = timestamptz '2026-02-08 06:00:00+00', 'the first period is wrong');
  perform pg_temp.expect((select micros = 1000000 and calls = 30 and kind = 'included' from public.ai_allocation_grants where period_id = p.id), 'the grant of the first period is wrong');
  perform pg_temp.expect((select status from public.subscriptions where id = sub) = 'active', 'the subscription did not become active');

  -- 2. the SAME event again (retried delivery): recognised, nothing else happens
  r := pg_temp.ev(sub, t1, 'evt-1a', 'payment_confirmed', 'pay-1', '2026-01-08 15:00:00+00');
  perform pg_temp.expect((r ->> 'duplicate') = 'true' and r ->> 'status' = 'applied', 'a repeated event was not recognised: ' || r::text);

  -- 3. a DIFFERENT event of the SAME payment (the provider sends several): ignored, no second cycle, period or grant
  r := pg_temp.ev(sub, t1, 'evt-1b', 'payment_confirmed', 'pay-1', '2026-01-08 15:00:00+00');
  perform pg_temp.expect(r ->> 'status' = 'ignored' and r ->> 'reason' = 'payment_already_recorded', 'another event of the same payment was not ignored: ' || r::text);
  r := pg_temp.ev(sub, t1, 'evt-1c', 'other', 'pay-1', null);
  perform pg_temp.expect(r ->> 'status' = 'ignored', 'an update event granted something: ' || r::text);
  perform pg_temp.expect((select count(*) from public.subscription_cycles where subscription_id = sub) = 1
    and (select count(*) from public.billing_periods where cycle_id = c.id) = 1
    and (select count(*) from public.ai_allocation_grants g join public.billing_periods b on b.id = g.period_id where b.cycle_id = c.id) = 1, 'a payment seen through several events was applied more than once');

  -- 4. identities reused with INCOMPATIBLE data are refused and change nothing
  r := pg_temp.ev(sub, t1, 'evt-1a', 'payment_confirmed', 'pay-1', '2026-01-08 15:00:00+00', 'other-hash');
  perform pg_temp.expect((r ->> 'ok') = 'false' and r ->> 'reason' = 'event_id_reused_with_different_data', 'an event id reused with another content was accepted: ' || r::text);
  r := pg_temp.ev(sub, t1, 'evt-1d', 'payment_confirmed', 'pay-1', '2026-01-09 15:00:00+00');
  perform pg_temp.expect(r ->> 'status' = 'rejected' and r ->> 'reason' = 'payment_id_reused_with_different_data', 'a payment id reused with another instant was accepted: ' || r::text);
  r := pg_temp.ev(sub, t1, 'evt-1g', 'payment_confirmed', 'pay-1', '2026-01-08 15:00:00+00', null, 'top_up');
  perform pg_temp.expect(r ->> 'status' = 'rejected' and r ->> 'reason' = 'concept_not_supported', 'a concept without conditions was accepted: ' || r::text);
  perform pg_temp.expect((select count(*) from public.ai_allocation_grants g join public.billing_periods b on b.id = g.period_id where b.cycle_id = c.id) = 1, 'a refused event changed the ledger');

  -- 5. renewal paid BEFORE the end (3 Feb): same cycle, same anchor, the next period of the calendar
  r := pg_temp.ev(sub, t1, 'evt-2a', 'payment_confirmed', 'pay-2', '2026-02-03 12:00:00+00');
  perform pg_temp.expect(r ->> 'status' = 'applied', 'the renewal was not applied: ' || r::text);
  perform pg_temp.expect((select count(*) from public.subscription_cycles where subscription_id = sub) = 1, 'a renewal paid in time opened a new cycle');
  select * into p from public.billing_periods where cycle_id = c.id and period_index = 1;
  perform pg_temp.expect(p.starts_at = timestamptz '2026-02-08 06:00:00+00' and p.ends_at = timestamptz '2026-03-08 06:00:00+00', 'the renewal period is wrong');
  perform pg_temp.expect((select count(*) from public.ai_allocation_grants g join public.billing_periods b on b.id = g.period_id where b.cycle_id = c.id) = 2, 'the renewal did not grant exactly one more period');

  -- 6. a failed payment: nothing is granted, and access is suspended once the paid time ends
  r := pg_temp.ev(sub, t1, 'evt-fail-3', 'payment_failed', 'pay-fail-3', null);
  perform pg_temp.expect(r ->> 'status' = 'ignored', 'a failed payment was not ignored');
  set local role service_role;
  perform pg_temp.expect(public.subscription_access(sub, '2026-02-08 05:59:59.999+00') ->> 'state' = 'active' and public.subscription_access(sub, '2026-02-08 06:00:00+00') ->> 'periodIndex' = '1', 'access around the first renewal');
  perform pg_temp.expect(public.subscription_access(sub, '2026-03-08 05:59:59.999+00') ->> 'state' = 'active', 'access before the end of the paid time');
  perform pg_temp.expect(public.subscription_access(sub, '2026-03-08 06:00:00+00') ->> 'state' = 'suspended', 'access after the paid time ended without a renewal');
  perform pg_temp.expect(public.subscription_access(sub, '2026-01-08 14:59:59.999+00') ->> 'state' = 'none', 'access before the first activation');
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Reactivation after a suspension: a NEW cycle from the confirmed INSTANT (19:00 local), nothing for the suspended interval, history untouched
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb; c0 public.subscription_cycles; c1 public.subscription_cycles; p public.billing_periods;
  t1 constant uuid := '50000000-0000-4000-8000-0000000000b1';
  sub uuid := (select id from public.subscriptions where tenant_id = '50000000-0000-4000-8000-0000000000b1');
begin
  select * into c0 from public.subscription_cycles where subscription_id = sub and cycle_index = 0;
  -- 19:00 local on 20 Apr 2026 is 01:00Z on the 21st: the anchor is the LOCAL day, the access starts at the instant
  r := pg_temp.ev(sub, t1, 'evt-3a', 'payment_confirmed', 'pay-3', '2026-04-21 01:00:00+00');
  perform pg_temp.expect(r ->> 'status' = 'applied', 'the reactivation was not applied: ' || r::text);
  select * into c1 from public.subscription_cycles where subscription_id = sub and cycle_index = 1;
  perform pg_temp.expect(c1.anchor_date = date '2026-04-20' and c1.activated_at = timestamptz '2026-04-21 01:00:00+00' and c1.activation_payment_id = 'pay-3', 'the new cycle is wrong');
  select * into p from public.billing_periods where cycle_id = c1.id and period_index = 0;
  perform pg_temp.expect(p.starts_at = timestamptz '2026-04-21 01:00:00+00' and p.ends_at = timestamptz '2026-05-20 06:00:00+00', 'the first period of the new cycle is wrong');
  -- nothing was granted or charged for the suspended interval: no period covers it
  perform pg_temp.expect(not exists (select 1 from public.billing_periods b join public.subscription_cycles c on c.id = b.cycle_id
     where c.subscription_id = sub and b.starts_at < timestamptz '2026-04-21 01:00:00+00' and b.ends_at > timestamptz '2026-03-08 06:00:00+00'), 'a period covers the suspended interval');
  perform pg_temp.expect((select count(*) from public.ai_allocation_grants g join public.billing_periods b on b.id = g.period_id join public.subscription_cycles c on c.id = b.cycle_id where c.subscription_id = sub) = 3, 'the ledger of the subscription is not 3 grants');
  -- the old cycle and its periods are history, untouched
  perform pg_temp.expect((select anchor_date from public.subscription_cycles where id = c0.id) = date '2026-01-08' and (select count(*) from public.billing_periods where cycle_id = c0.id) = 2, 'the old cycle changed');
  -- access: suspended through the whole gap (no access at 00:00 local of the anchor day or 18:59 local), active from the exact instant
  set local role service_role;
  perform pg_temp.expect(public.subscription_access(sub, '2026-04-10 00:00:00+00') ->> 'state' = 'suspended' and public.subscription_access(sub, '2026-04-10 00:00:00+00') ->> 'cycleIndex' = '0', 'access during the gap');
  perform pg_temp.expect(public.subscription_access(sub, '2026-04-20 06:00:00+00') ->> 'state' = 'suspended', 'access at 00:00 local of the anchor day, before the payment');
  perform pg_temp.expect(public.subscription_access(sub, '2026-04-21 00:59:59.999+00') ->> 'state' = 'suspended', 'access before the confirmed instant');
  perform pg_temp.expect(public.subscription_access(sub, '2026-04-21 01:00:00+00') ->> 'state' = 'active' and public.subscription_access(sub, '2026-04-21 01:00:00+00') ->> 'cycleIndex' = '1', 'access from the confirmed instant');
  perform pg_temp.expect(public.subscription_access(sub, '2026-01-20 00:00:00+00') ->> 'state' = 'active' and public.subscription_access(sub, '2026-01-20 00:00:00+00') ->> 'cycleIndex' = '0', 'the old cycle still answers for its own time');
  reset role;
  -- a later NOTIFICATION of the first payment (a different event, long after) does not touch the anchor or open anything
  r := pg_temp.ev(sub, t1, 'evt-late-1', 'payment_confirmed', 'pay-1', '2026-01-08 15:00:00+00');
  perform pg_temp.expect(r ->> 'status' = 'ignored', 'a late notification of an applied payment was not ignored: ' || r::text);
  perform pg_temp.expect((select count(*) from public.subscription_cycles where subscription_id = sub) = 2 and (select anchor_date from public.subscription_cycles where id = c1.id) = date '2026-04-20', 'a late notification moved the anchor');
  -- the history cannot be rewritten
  if pg_temp.state_of(format($q$update public.subscription_cycles set anchor_date = '2026-05-01' where id = '%s'$q$, c1.id)) <> '42501' then raise exception 'FAIL: a cycle was edited'; end if;
  if pg_temp.state_of(format($q$delete from public.billing_periods where id = '%s'$q$, p.id)) <> '42501' then raise exception 'FAIL: a period was deleted'; end if;
  if pg_temp.state_of($q$update public.ai_allocation_grants set micros = 0$q$) <> '42501' then raise exception 'FAIL: the ledger was edited'; end if;
  -- backstops of the schema itself (a second grant or cycle for the same payment), as the owner of the script
  if pg_temp.state_of(format($q$insert into public.ai_allocation_grants (tenant_id, period_id, kind, provider, payment_id, concept, micros) values ('%s', '%s', 'top_up', 'prov-test', 'pay-3', 'included', 1)$q$, t1, p.id)) <> '23505' then raise exception 'FAIL: the ledger allowed the same payment twice'; end if;
  if pg_temp.state_of(format($q$insert into public.subscription_cycles (tenant_id, subscription_id, cycle_index, anchor_date, activated_at, activation_provider, activation_payment_id) values ('%s', '%s', 9, '2026-06-01', now(), 'prov-test', 'pay-3')$q$, t1, sub)) <> '23505' then raise exception 'FAIL: a payment opened two cycles'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Notifications out of order (T2): arrival order never orders payments. A payment is judged by its CONFIRMATION instant against what is stored; one confirmed before the current cycle began is
-- kept pending (it cannot rewrite history or move the anchor), and nothing that is pending or failed blocks the payments that follow.
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb; sub uuid; pa uuid := (select id from public.plan_versions where code = 'test-plan-a');
  t2 constant uuid := '50000000-0000-4000-8000-0000000000b2';
begin
  set local role service_role;
  sub := public.create_subscription(t2, pa, 'America/Costa_Rica');
  reset role;
  perform pg_temp.ev(sub, t2, 'o-1', 'payment_confirmed', 'po-1', '2026-01-08 15:00:00+00');
  -- the payment confirmed on 20 Feb (the paid time ended on 8 Feb) is notified FIRST: a reactivation
  r := pg_temp.ev(sub, t2, 'o-3', 'payment_confirmed', 'po-3', '2026-02-20 18:00:00+00');
  perform pg_temp.expect(r ->> 'status' = 'applied' and r ->> 'obligation' = 'reactivation', 'the payment of 20 Feb was not a reactivation: ' || r::text);
  -- the payment confirmed on 5 Feb (in time for the first cycle) is notified LATE: it cannot rewrite history, so it is kept, with no grant, and the anchor does not move
  r := pg_temp.ev(sub, t2, 'o-2', 'payment_confirmed', 'po-2', '2026-02-05 18:00:00+00');
  perform pg_temp.expect(r ->> 'status' = 'pending' and r ->> 'reason' = 'confirmed_before_current_cycle' and r ->> 'obligation' = 'late', 'a late notification was not kept pending: ' || r::text);
  perform pg_temp.expect((select count(*) from public.subscription_cycles where subscription_id = sub) = 2 and (select anchor_date from public.subscription_cycles where subscription_id = sub and cycle_index = 1) = date '2026-02-20',
    'a late notification moved the anchor or opened a cycle');
  perform pg_temp.expect((select count(*) from public.ai_allocation_grants where tenant_id = t2) = 2, 'a late notification granted something');
  -- another event of the same late payment (a repeated delivery under a new id) is recognised, not applied
  r := pg_temp.ev(sub, t2, 'o-2b', 'payment_confirmed', 'po-2', '2026-02-05 18:00:00+00');
  perform pg_temp.expect(r ->> 'status' = 'ignored' and r ->> 'reason' = 'payment_already_recorded', 'a repeat of a held payment was not ignored: ' || r::text);
  -- what is held blocks NOTHING: the next payment (10 Mar, inside the new cycle) renews it
  r := pg_temp.ev(sub, t2, 'o-4', 'payment_confirmed', 'po-4', '2026-03-10 12:00:00+00');
  perform pg_temp.expect(r ->> 'status' = 'applied' and r ->> 'obligation' = 'renewal', 'a payment after a held one was blocked: ' || r::text);
  perform pg_temp.expect((select starts_at from public.billing_periods b join public.subscription_cycles c on c.id = b.cycle_id where c.subscription_id = sub and c.cycle_index = 1 and b.period_index = 1) = timestamptz '2026-03-20 06:00:00+00',
    'the renewal of the new cycle is not on its calendar');
  perform pg_temp.expect((select count(*) from public.ai_allocation_grants where tenant_id = t2) = 3 and (select status from public.payment_events where external_event_id = 'o-2') = 'pending', 'the ledger or the held payment changed');
end $$;

-- ---------------------------------------------------------------------------
-- A failed payment, then a rejected one, then a valid one (T9): neither blocks the valid payment
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb; sub uuid; pa uuid := (select id from public.plan_versions where code = 'test-plan-a');
  t9 constant uuid := '50000000-0000-4000-8000-0000000000b9';
begin
  insert into public.tenants (id, name) values (t9, 'Empresa Nueve');
  set local role service_role; sub := public.create_subscription(t9, pa, 'America/Costa_Rica'); reset role;
  r := pg_temp.ev(sub, t9, 'f-1', 'payment_failed', 'pf-1', null);
  perform pg_temp.expect(r ->> 'status' = 'ignored', 'a failed payment was not ignored');
  r := pg_temp.ev(sub, t9, 'f-2', 'payment_confirmed', 'pf-2', '2026-01-08 15:00:00+00', null, 'top_up'); -- a concept without approved conditions: rejected
  perform pg_temp.expect(r ->> 'status' = 'rejected', 'an unsupported concept was not rejected');
  r := pg_temp.ev(sub, t9, 'f-3', 'payment_confirmed', 'pf-3', '2026-01-08 15:00:00+00');
  perform pg_temp.expect(r ->> 'status' = 'applied' and r ->> 'obligation' = 'first_activation', 'a valid payment after a failed and a rejected one was blocked: ' || r::text);
  -- a payment id reused with another instant is rejected, and the next valid payment is still not blocked
  r := pg_temp.ev(sub, t9, 'f-4', 'payment_confirmed', 'pf-3', '2026-01-09 15:00:00+00');
  perform pg_temp.expect(r ->> 'status' = 'rejected', 'an incompatible identity was accepted');
  r := pg_temp.ev(sub, t9, 'f-5', 'payment_confirmed', 'pf-5', '2026-02-01 12:00:00+00');
  perform pg_temp.expect(r ->> 'status' = 'applied' and r ->> 'obligation' = 'renewal', 'a valid payment after a rejected one was blocked: ' || r::text);
  perform pg_temp.expect((select count(*) from public.ai_allocation_grants where tenant_id = t9) = 2, 'the ledger of T9 is not 2 grants');
end $$;

-- ---------------------------------------------------------------------------
-- Paid ahead: a payment made while the next period is already paid is NOT applied automatically (T3)
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb; sub uuid; pa uuid := (select id from public.plan_versions where code = 'test-plan-a');
  t3 constant uuid := '50000000-0000-4000-8000-0000000000b3';
begin
  set local role service_role; sub := public.create_subscription(t3, pa, 'America/Costa_Rica'); reset role;
  perform pg_temp.ev(sub, t3, 'a-1', 'payment_confirmed', 'pa-1', '2026-01-08 15:00:00+00');
  r := pg_temp.ev(sub, t3, 'a-2', 'payment_confirmed', 'pa-2', '2026-01-20 10:00:00+00'); -- pays the period that starts on 8 Feb
  perform pg_temp.expect(r ->> 'status' = 'applied', 'the early renewal was not applied');
  r := pg_temp.ev(sub, t3, 'a-3', 'payment_confirmed', 'pa-3', '2026-01-25 10:00:00+00'); -- the next period is already paid
  perform pg_temp.expect(r ->> 'status' = 'pending' and r ->> 'reason' = 'paid_ahead_policy_pending' and r ->> 'obligation' = 'paid_ahead', 'a payment made ahead was not held: ' || r::text);
  perform pg_temp.expect((select count(*) from public.billing_periods b where b.tenant_id = t3) = 2 and (select count(*) from public.ai_allocation_grants where tenant_id = t3) = 2 and (select count(*) from public.subscription_cycles where tenant_id = t3) = 1,
    'a payment made ahead granted something or changed a cycle');
  -- it stays held (its policy is undecided), a repeat of it is recognised, and it blocks nothing: the payment of 12 Feb (inside the paid time, from the start of the latest period) renews
  r := pg_temp.ev(sub, t3, 'a-3b', 'payment_confirmed', 'pa-3', '2026-01-25 10:00:00+00');
  perform pg_temp.expect(r ->> 'status' = 'ignored' and r ->> 'reason' = 'payment_already_recorded', 'a repeat of a held payment was not ignored: ' || r::text);
  r := pg_temp.ev(sub, t3, 'a-4', 'payment_confirmed', 'pa-4', '2026-02-12 10:00:00+00');
  perform pg_temp.expect(r ->> 'status' = 'applied' and r ->> 'obligation' = 'renewal', 'a payment after a held one was blocked: ' || r::text);
  perform pg_temp.expect((select status from public.payment_events where external_event_id = 'a-3') = 'pending' and (select reason from public.payment_events where external_event_id = 'a-3') = 'paid_ahead_policy_pending', 'the payment made ahead was applied or lost');
  perform pg_temp.expect((select count(*) from public.billing_periods where tenant_id = t3) = 3 and (select count(*) from public.ai_allocation_grants where tenant_id = t3) = 3 and (select count(*) from public.subscription_cycles where tenant_id = t3) = 1,
    'the ledger of T3 is not 3 periods and 3 grants in one cycle');
end $$;

-- ---------------------------------------------------------------------------
-- The exact end instant renews; one millisecond later is a reactivation (T4, T5). A cancelled subscription is not renewed; a reactivation after it is allowed. An ended one rejects (T6, T7)
-- ---------------------------------------------------------------------------
do $$
declare
  sub4 uuid; sub5 uuid; sub6 uuid; sub7 uuid; r jsonb; pa uuid := (select id from public.plan_versions where code = 'test-plan-a');
  t4 constant uuid := '50000000-0000-4000-8000-0000000000b4'; t5 constant uuid := '50000000-0000-4000-8000-0000000000b5';
  t6 constant uuid := '50000000-0000-4000-8000-0000000000b6'; t7 constant uuid := '50000000-0000-4000-8000-0000000000b7';
begin
  set local role service_role;
  sub4 := public.create_subscription(t4, pa, 'America/Costa_Rica'); sub5 := public.create_subscription(t5, pa, 'America/Costa_Rica');
  sub6 := public.create_subscription(t6, pa, 'America/Costa_Rica'); sub7 := public.create_subscription(t7, pa, 'America/Costa_Rica');
  reset role;
  perform pg_temp.ev(sub4, t4, 'b-1', 'payment_confirmed', 'pb-1', '2026-01-08 15:00:00+00');
  perform pg_temp.ev(sub5, t5, 'c-1', 'payment_confirmed', 'pc-1', '2026-01-08 15:00:00+00');
  perform pg_temp.ev(sub6, t6, 'd-1', 'payment_confirmed', 'pd-1', '2026-01-08 15:00:00+00');
  perform pg_temp.ev(sub7, t7, 'e-1', 'payment_confirmed', 'pe-1', '2026-01-08 15:00:00+00');

  r := pg_temp.ev(sub4, t4, 'b-2', 'payment_confirmed', 'pb-2', '2026-02-08 06:00:00+00');
  perform pg_temp.expect(r ->> 'status' = 'applied' and (select count(*) from public.subscription_cycles where subscription_id = sub4) = 1, 'a payment confirmed at the exact end instant was not a renewal');
  r := pg_temp.ev(sub5, t5, 'c-2', 'payment_confirmed', 'pc-2', '2026-02-08 06:00:00.001+00');
  perform pg_temp.expect(r ->> 'status' = 'applied' and (select count(*) from public.subscription_cycles where subscription_id = sub5) = 2, 'a payment one millisecond after the end was not a reactivation');

  -- a cancelled subscription is not renewed (a rejection blocks nothing that follows) ...
  update public.subscriptions set status = 'cancel_at_period_end' where id = sub6;
  r := pg_temp.ev(sub6, t6, 'd-2', 'payment_confirmed', 'pd-2', '2026-02-03 12:00:00+00');
  perform pg_temp.expect(r ->> 'status' = 'rejected' and r ->> 'reason' = 'renewal_after_cancellation', 'a cancelled subscription was renewed: ' || r::text);
  -- ... and a payment confirmed AFTER its paid time ended reactivates it with a new cycle
  r := pg_temp.ev(sub6, t6, 'd-3', 'payment_confirmed', 'pd-3', '2026-03-15 20:00:00+00');
  perform pg_temp.expect(r ->> 'status' = 'applied' and (select count(*) from public.subscription_cycles where subscription_id = sub6) = 2 and (select status from public.subscriptions where id = sub6) = 'active',
    'a payment after the end of a cancelled subscription did not reactivate it: ' || r::text);

  -- an ended subscription accepts nothing
  update public.subscriptions set status = 'ended' where id = sub7;
  r := pg_temp.ev(sub7, t7, 'e-2', 'payment_confirmed', 'pe-2', '2026-02-03 12:00:00+00');
  perform pg_temp.expect(r ->> 'status' = 'rejected' and r ->> 'reason' = 'subscription_ended', 'an ended subscription accepted a payment: ' || r::text);
end $$;

-- ---------------------------------------------------------------------------
-- Isolation between companies, and between roles of the same company
-- ---------------------------------------------------------------------------
do $$
declare
  t1 constant uuid := '50000000-0000-4000-8000-0000000000b1';
  t2 constant uuid := '50000000-0000-4000-8000-0000000000b2';
  n_sub int; n_cyc int; n_per int; n_ev int; n_gr int; n_plan int;
begin
  -- the owner of T1 sees only T1
  perform pg_temp.as_user('50000000-0000-4000-8000-000000000001', 'sub-o@example.test');
  select count(*) into n_sub from public.subscriptions; select count(*) into n_cyc from public.subscription_cycles; select count(*) into n_per from public.billing_periods;
  select count(*) into n_ev from public.payment_events; select count(*) into n_gr from public.ai_allocation_grants;
  if n_sub <> 1 or n_cyc <> 2 or n_per <> 3 or n_gr <> 3 then raise exception 'FAIL: the owner of T1 sees % subs, % cycles, % periods, % grants', n_sub, n_cyc, n_per, n_gr; end if;
  if exists (select 1 from public.subscriptions where tenant_id <> t1) or exists (select 1 from public.payment_events where tenant_id <> t1) then raise exception 'FAIL: the owner of T1 sees another company'; end if;
  if (select count(*) from public.plan_versions) <> 1 then raise exception 'FAIL: the owner of T1 sees plans that are not its own'; end if;
  if pg_temp.state_of($q$select internal_cost_micros from public.plan_versions$q$) <> '42501' then raise exception 'FAIL: the internal cost is readable'; end if;
  if pg_temp.state_of($q$select * from public.plan_versions$q$) <> '42501' then raise exception 'FAIL: select * exposes the internal cost'; end if;
  if pg_temp.state_of($q$select id, code, included_micros from public.plan_versions$q$) <> '00000' then raise exception 'FAIL: the visible columns of a plan are not readable'; end if;
  -- nobody records anything directly or through a function
  if pg_temp.state_of($q$insert into public.subscriptions (tenant_id, plan_version_id, timezone) select tenant_id, plan_version_id, timezone from public.subscriptions$q$) <> '42501' then raise exception 'FAIL: the owner inserted a subscription'; end if;
  if pg_temp.state_of($q$update public.payment_events set status = 'applied'$q$) <> '42501' then raise exception 'FAIL: the owner edited a payment event'; end if;
  if pg_temp.state_of($q$select public.apply_payment_event('p', 'e', 'payment_confirmed', 'x', 'included', '50000000-0000-4000-8000-0000000000b1', gen_random_uuid(), now(), 'h')$q$) <> '42501' then raise exception 'FAIL: the owner ran the payment function'; end if;
  if pg_temp.state_of($q$select public.create_plan_version('hack', 1, 'x', 1)$q$) <> '42501' then raise exception 'FAIL: the owner created a plan'; end if;
  reset role;

  -- a plain member and a viewer of T1 see nothing (only owners and admins read billing)
  perform pg_temp.as_user('50000000-0000-4000-8000-000000000002', 'sub-m@example.test');
  if (select count(*) from public.subscriptions) + (select count(*) from public.subscription_cycles) + (select count(*) from public.billing_periods) + (select count(*) from public.payment_events)
     + (select count(*) from public.ai_allocation_grants) + (select count(*) from public.plan_versions) <> 0 then raise exception 'FAIL: a member reads billing records'; end if;
  reset role;
  perform pg_temp.as_user('50000000-0000-4000-8000-000000000003', 'sub-v@example.test');
  if (select count(*) from public.subscriptions) + (select count(*) from public.ai_allocation_grants) <> 0 then raise exception 'FAIL: a viewer reads billing records'; end if;
  reset role;

  -- the owner of T2 sees only T2 (3 grants: the first payment, the reactivation and the renewal of the out-of-order test)
  perform pg_temp.as_user('50000000-0000-4000-8000-000000000004', 'sub-x@example.test');
  if exists (select 1 from public.subscriptions where tenant_id <> t2) or exists (select 1 from public.billing_periods where tenant_id <> t2) or exists (select 1 from public.ai_allocation_grants where tenant_id <> t2) then raise exception 'FAIL: the owner of T2 sees another company'; end if;
  if (select count(*) from public.ai_allocation_grants) <> 3 then raise exception 'FAIL: the owner of T2 does not see its 3 grants'; end if;
  reset role;

  -- anon sees nothing
  set local role anon;
  if pg_temp.state_of($q$select 1 from public.subscriptions$q$) <> '42501' then raise exception 'FAIL: anon reads subscriptions'; end if;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- Deleting a company removes its billing records (the append-only ones included)
-- ---------------------------------------------------------------------------
do $$
declare
  t8 constant uuid := '50000000-0000-4000-8000-0000000000b8';
  uo constant uuid := '50000000-0000-4000-8000-000000000001';
  sub uuid; pa uuid := (select id from public.plan_versions where code = 'test-plan-a');
begin
  set local role service_role; sub := public.create_subscription(t8, pa, 'America/Costa_Rica'); reset role;
  perform pg_temp.ev(sub, t8, 'z-1', 'payment_confirmed', 'pz-1', '2026-01-08 15:00:00+00');
  perform pg_temp.expect((select count(*) from public.ai_allocation_grants where tenant_id = t8) = 1, 'setup of the deletion test');
  perform pg_temp.as_user(uo, 'sub-o@example.test');
  perform public.delete_company(t8, 'Empresa Ocho');
  reset role;
  if exists (select 1 from public.subscriptions where tenant_id = t8) or exists (select 1 from public.subscription_cycles where tenant_id = t8) or exists (select 1 from public.billing_periods where tenant_id = t8)
     or exists (select 1 from public.payment_events where tenant_id = t8) or exists (select 1 from public.ai_allocation_grants where tenant_id = t8) then raise exception 'FAIL: deleting the company left billing records'; end if;
end $$;

select 'subscriptions: all checks passed' as result;
