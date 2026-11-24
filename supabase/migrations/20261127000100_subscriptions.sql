-- Subscriptions, cycles, periods, payment events and allocation grants (ADR-0037, minimum persistence; the ADR is still PROPOSED, and this does not approve any pending commercial decision).
-- What is stored: versioned plans, one live subscription per company, the CYCLES of a subscription (append-only history: an anchor never changes), the paid PERIODS of each cycle, the payment
-- EVENTS received (an inbox with a status) and the ALLOCATION GRANTS (an append-only ledger: what consumption each paid period gave). NO provider, NO price list and NO real plan is defined here:
-- plans are rows that the platform (server key) creates; the tests use fictitious ones. Nothing here is connected to the AI budget (ai_budget_periods), to a route, to the app's access or to a payment provider.
--
-- Rules implemented (approved commercial rules, 2026-11-26/27):
--   * A period runs from its start date to the same date next month, always counted from the ORIGINAL anchor of its cycle (31 Jan -> 28 Feb -> 31 Mar), renewing at 00:00 in the subscription's fixed time zone.
--     private.local_day_start mirrors lib/billing-periods.ts (first real instant of the local day); supabase/tests/billing_parity.sql checks it against the values that file produces.
--   * A payment CONFIRMED before the paid time ends renews the same cycle (same anchor and calendar). A payment confirmed AFTER it opens a NEW cycle: its anchor is the local date of the confirmation and its
--     first period starts at the confirmation INSTANT (no retroactive access). Nothing is charged or granted for the suspended interval: no period covers it. Cycles and periods are never overwritten.
--   * What decides is the CONFIRMATION instant the provider reports, never when the event arrived.
--   * One payment never grants twice: (provider, payment_id, concept) is checked BEFORE classifying, under the lock of the subscription, and is unique in the ledger and among live events.
--   * There is NO sequence number and arrival order never orders payments. Each confirmed payment is identified by (provider, payment_id, concept) and judged by its CONFIRMATION instant against the stored
--     history: first activation, renewal, reactivation, paid ahead (the next period is already paid) or late (confirmed before the current cycle began, notified after a later payment opened it).
--     Paid-ahead and late payments are kept PENDING with their reason: they grant nothing, change no cycle and move no anchor, and they never block another payment. A failed, rejected or absent
--     payment therefore blocks nothing. Whether a late or paid-ahead payment is applied, credited or refunded is a pending decision.
--   * "Suspended" is DERIVED from the stored periods (public.subscription_access), not a flag that a timer must flip.
--
-- NOT APPLIED to any remote project: review first (AGENTS.md 7.11).
--
-- Reversal plan (development only, destroys these records): drop the functions public.create_plan_version, create_subscription, apply_payment_event, subscription_access and private.local_day_start, cycle_period_bounds, apply_confirmed_payment, protect_subscription; then drop the tables ai_allocation_grants, payment_events,
-- billing_periods, subscription_cycles, subscriptions and plan_versions, in that order.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- A plan is a versioned row, never edited: a new version is a new row. internal_cost_micros is an INTERNAL figure: no signed-in role can read that column.
create table public.plan_versions (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[a-z][a-z0-9._-]{0,59}$'),
  version int not null check (version >= 1),
  name text not null check (char_length(name) between 1 and 120),
  included_micros bigint not null check (included_micros >= 0),
  included_calls int check (included_calls is null or included_calls >= 0),
  internal_cost_micros bigint not null default 0 check (internal_cost_micros >= 0),
  created_at timestamptz not null default now(),
  unique (code, version)
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  plan_version_id uuid not null references public.plan_versions (id),
  -- the time zone is fixed for the whole subscription (changing a profile never moves a period)
  timezone text not null check (char_length(timezone) between 1 and 64),
  status text not null default 'pending' check (status in ('pending', 'active', 'cancel_at_period_end', 'ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index subscriptions_one_live_per_tenant on public.subscriptions (tenant_id) where status <> 'ended';

-- The history of a subscription: one row per cycle, append-only. A reactivation is a NEW row; the anchor of a row never changes.
create table public.subscription_cycles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  subscription_id uuid not null,
  cycle_index int not null check (cycle_index >= 0),
  anchor_date date not null,
  activated_at timestamptz not null,
  activation_provider text not null check (char_length(activation_provider) between 1 and 40),
  activation_payment_id text not null check (char_length(activation_payment_id) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (subscription_id, cycle_index),
  -- a payment opens at most one cycle, whatever events carried it
  unique (activation_provider, activation_payment_id),
  foreign key (tenant_id, subscription_id) references public.subscriptions (tenant_id, id) on delete cascade
);

-- The paid periods of a cycle, append-only. The first period of a cycle starts at the confirmation instant; the next ones at 00:00 local of the anchor's day.
create table public.billing_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  cycle_id uuid not null,
  period_index int not null check (period_index >= 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  plan_version_id uuid not null references public.plan_versions (id),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (cycle_id, period_index),
  foreign key (tenant_id, cycle_id) references public.subscription_cycles (tenant_id, id) on delete cascade
);

-- The inbox of payment events. Status: received (inside the transaction only), pending (kept, to be resumed), applied, ignored (nothing to do, with the reason), rejected (inconsistent, with the reason).
create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  subscription_id uuid not null,
  provider text not null check (char_length(provider) between 1 and 40),
  external_event_id text not null check (char_length(external_event_id) between 1 and 200),
  payment_id text not null check (char_length(payment_id) between 1 and 200),
  concept text not null check (concept ~ '^[a-z][a-z0-9._:-]{0,79}$'),
  kind text not null check (kind in ('payment_confirmed', 'payment_failed', 'other')),
  -- what the payment is for, decided when it is classified: first_activation, renewal, reactivation, paid_ahead (kept pending) or late (kept pending)
  obligation text check (obligation in ('first_activation', 'renewal', 'reactivation', 'paid_ahead', 'late')),
  confirmed_at timestamptz,
  content_hash text not null check (char_length(content_hash) between 1 and 128),
  status text not null default 'received' check (status in ('received', 'pending', 'applied', 'ignored', 'rejected')),
  reason text check (char_length(reason) <= 200),
  period_id uuid,
  received_at timestamptz not null default now(),
  applied_at timestamptz,
  check (kind <> 'payment_confirmed' or confirmed_at is not null),
  unique (provider, external_event_id),
  foreign key (tenant_id, subscription_id) references public.subscriptions (tenant_id, id) on delete cascade,
  foreign key (tenant_id, period_id) references public.billing_periods (tenant_id, id) on delete cascade
);
-- backstop of the function's own check: one live event per payment identity
create unique index payment_events_live_identity on public.payment_events (provider, payment_id, concept) where kind = 'payment_confirmed' and status in ('pending', 'applied');
create index payment_events_pending_idx on public.payment_events (subscription_id, confirmed_at) where status = 'pending';

-- The ledger of consumption granted by paid periods, append-only. It is NOT connected to the AI budget.
create table public.ai_allocation_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  period_id uuid not null,
  kind text not null check (kind in ('included', 'upgrade_delta', 'top_up')),
  provider text not null check (char_length(provider) between 1 and 40),
  payment_id text not null check (char_length(payment_id) between 1 and 200),
  concept text not null check (concept ~ '^[a-z][a-z0-9._:-]{0,79}$'),
  micros bigint not null check (micros >= 0),
  calls int check (calls is null or calls >= 0),
  created_at timestamptz not null default now(),
  unique (provider, payment_id, concept),
  foreign key (tenant_id, period_id) references public.billing_periods (tenant_id, id) on delete cascade
);
create unique index ai_allocation_grants_one_included on public.ai_allocation_grants (period_id) where kind = 'included';

-- immutability
create function private.protect_subscription()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then raise exception 'tenant_id is immutable' using errcode = '42501'; end if;
  if new.timezone is distinct from old.timezone then raise exception 'the time zone of a subscription never changes' using errcode = '42501'; end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger subscriptions_protect before update on public.subscriptions for each row execute function private.protect_subscription();
create trigger payment_events_protect_tenant before update on public.payment_events for each row execute function private.protect_identity();
create trigger plan_versions_append_only before update or delete on public.plan_versions for each row execute function private.reject_mutation();
create trigger subscription_cycles_append_only before update or delete on public.subscription_cycles for each row execute function private.reject_mutation();
create trigger billing_periods_append_only before update or delete on public.billing_periods for each row execute function private.reject_mutation();
create trigger ai_allocation_grants_append_only before update or delete on public.ai_allocation_grants for each row execute function private.reject_mutation();

-- ---------------------------------------------------------------------------
-- RLS: administrators read their own company's rows; nobody writes directly; internal costs are not readable
-- ---------------------------------------------------------------------------

alter table public.plan_versions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_cycles enable row level security;
alter table public.billing_periods enable row level security;
alter table public.payment_events enable row level security;
alter table public.ai_allocation_grants enable row level security;

revoke all on table public.plan_versions, public.subscriptions, public.subscription_cycles, public.billing_periods, public.payment_events, public.ai_allocation_grants
  from public, anon, authenticated, service_role;
grant select on table public.subscriptions, public.subscription_cycles, public.billing_periods, public.payment_events, public.ai_allocation_grants to authenticated;
-- a plan's visible columns only: internal_cost_micros is never granted
grant select (id, code, version, name, included_micros, included_calls, created_at) on public.plan_versions to authenticated;

create policy subscriptions_select on public.subscriptions for select to authenticated using ((select private.is_admin(tenant_id)));
create policy subscription_cycles_select on public.subscription_cycles for select to authenticated using ((select private.is_admin(tenant_id)));
create policy billing_periods_select on public.billing_periods for select to authenticated using ((select private.is_admin(tenant_id)));
create policy payment_events_select on public.payment_events for select to authenticated using ((select private.is_admin(tenant_id)));
create policy ai_allocation_grants_select on public.ai_allocation_grants for select to authenticated using ((select private.is_admin(tenant_id)));
-- a company sees only the plan versions its own subscription uses (the periods it was granted under are visible through billing_periods)
create policy plan_versions_select on public.plan_versions for select to authenticated using (
  exists (select 1 from public.subscriptions s where s.plan_version_id = plan_versions.id and (select private.is_admin(s.tenant_id)))
  or exists (select 1 from public.billing_periods b where b.plan_version_id = plan_versions.id and (select private.is_admin(b.tenant_id)))
);

-- ---------------------------------------------------------------------------
-- Pure date helpers (mirror of lib/billing-periods.ts and lib/billing-cycles.ts)
-- ---------------------------------------------------------------------------

-- The first real instant of a local day: the earliest instant (in whole minutes) whose local date is on or after p_day. A midnight that does not exist gives the instant of the jump, an ambiguous
-- midnight gives the earlier one, a local day that does not exist gives the first instant of the next day that does.
create function private.local_day_start(p_day date, p_tz text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select min(t) from generate_series(
    (p_day::timestamp at time zone p_tz) - interval '36 hours',
    (p_day::timestamp at time zone p_tz) + interval '36 hours',
    interval '1 minute'
  ) as t
  where (t at time zone p_tz)::date >= p_day;
$$;

-- The bounds of period p_index of a cycle. Always counted from the original anchor (never chained): date + n months clamps to the last day of a short month.
-- The first period starts at the activation instant; the others at 00:00 local of their date.
create function private.cycle_period_bounds(p_anchor date, p_tz text, p_activated timestamptz, p_index int)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select case when p_index = 0 then p_activated else private.local_day_start((p_anchor + make_interval(months => p_index))::date, p_tz) end,
         private.local_day_start((p_anchor + make_interval(months => p_index + 1))::date, p_tz);
$$;

-- ---------------------------------------------------------------------------
-- Applying a confirmed payment (always called with the subscription row LOCKED)
-- ---------------------------------------------------------------------------

-- Classifies ONE confirmed payment against the stored history by its CONFIRMATION instant, and applies it when it is a first activation, a renewal or a reactivation. It depends on no other payment being
-- present and never on arrival order: each payment is judged against what is stored when it is processed, and what cannot be applied is kept PENDING with its reason (nothing is lost, nothing blocks).
--   first_activation: no cycle yet.
--   renewal: confirmed from the start of the current cycle's latest period up to the end of the paid time (inclusive): the next period of the same cycle (same anchor and calendar).
--   reactivation: confirmed after the paid time ended: a NEW cycle anchored on the local date of the confirmation, starting at the confirmation instant.
--   paid_ahead: confirmed inside the paid time but BEFORE the start of the latest paid period (the next period is already paid): pending, no grant, no cycle change; its policy is undecided.
--   late: confirmed BEFORE the current cycle began (notified after a later payment had already opened it): pending, no grant; applying it would rewrite history or overlap the new cycle.
-- Returns 'applied', 'held' (kept pending) or 'rejected'.
create function private.apply_confirmed_payment(p_event uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  e public.payment_events;
  s public.subscriptions;
  v_cycle public.subscription_cycles;
  v_cycle_id uuid;
  v_index int;
  v_anchor date;
  v_start timestamptz;
  v_end timestamptz;
  v_until timestamptz;
  v_latest_start timestamptz;
  v_period uuid;
  v_plan public.plan_versions;
  v_obligation text;
begin
  select * into e from public.payment_events where id = p_event;
  select * into s from public.subscriptions where id = e.subscription_id;
  select * into v_cycle from public.subscription_cycles where subscription_id = s.id order by cycle_index desc limit 1;

  if not found then
    v_obligation := 'first_activation';
  else
    select max(ends_at) into v_until from public.billing_periods where cycle_id = v_cycle.id;
    select starts_at into v_latest_start from public.billing_periods where cycle_id = v_cycle.id order by period_index desc limit 1;
    if e.confirmed_at < v_cycle.activated_at then
      v_obligation := 'late';
    elsif e.confirmed_at <= v_until then
      if s.status = 'cancel_at_period_end' then
        update public.payment_events set status = 'rejected', reason = 'renewal_after_cancellation', obligation = 'renewal' where id = e.id;
        return 'rejected';
      end if;
      v_obligation := case when e.confirmed_at < v_latest_start then 'paid_ahead' else 'renewal' end;
    else
      v_obligation := 'reactivation';
    end if;
  end if;

  if v_obligation in ('late', 'paid_ahead') then
    update public.payment_events
       set status = 'pending', obligation = v_obligation,
           reason = case v_obligation when 'late' then 'confirmed_before_current_cycle' else 'paid_ahead_policy_pending' end
     where id = e.id;
    return 'held';
  end if;

  if v_obligation = 'renewal' then
    v_cycle_id := v_cycle.id;
    select count(*) into v_index from public.billing_periods where cycle_id = v_cycle.id;
    select b.ends_at into v_end from private.cycle_period_bounds(v_cycle.anchor_date, s.timezone, v_cycle.activated_at, v_index) b;
    v_start := v_until; -- contiguous with the previous period
  else
    -- first activation or reactivation: a new cycle anchored on the LOCAL date of the confirmation, starting at the confirmation instant
    v_index := 0;
    v_anchor := (e.confirmed_at at time zone s.timezone)::date;
    insert into public.subscription_cycles (tenant_id, subscription_id, cycle_index, anchor_date, activated_at, activation_provider, activation_payment_id)
    values (s.tenant_id, s.id, coalesce(v_cycle.cycle_index + 1, 0), v_anchor, e.confirmed_at, e.provider, e.payment_id)
    returning id into v_cycle_id;
    select b.starts_at, b.ends_at into v_start, v_end from private.cycle_period_bounds(v_anchor, s.timezone, e.confirmed_at, 0) b;
  end if;

  select * into v_plan from public.plan_versions where id = s.plan_version_id;
  insert into public.billing_periods (tenant_id, cycle_id, period_index, starts_at, ends_at, plan_version_id)
  values (s.tenant_id, v_cycle_id, v_index, v_start, v_end, s.plan_version_id)
  returning id into v_period;
  insert into public.ai_allocation_grants (tenant_id, period_id, kind, provider, payment_id, concept, micros, calls)
  values (s.tenant_id, v_period, 'included', e.provider, e.payment_id, e.concept, v_plan.included_micros, v_plan.included_calls);

  update public.payment_events set status = 'applied', reason = null, obligation = v_obligation, period_id = v_period, applied_at = now() where id = e.id;
  if s.status = 'pending' or (s.status = 'cancel_at_period_end' and v_obligation = 'reactivation') then
    update public.subscriptions set status = 'active' where id = s.id;
  end if;
  return 'applied';
end;
$$;

-- ---------------------------------------------------------------------------
-- Server functions (service_role only)
-- ---------------------------------------------------------------------------

-- The platform creates a plan version. Nothing here names a price or a real plan: the figures are whatever the platform decides, and a version is never edited.
create function public.create_plan_version(p_code text, p_version int, p_name text, p_included_micros bigint, p_included_calls int default null, p_internal_cost_micros bigint default 0)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  insert into public.plan_versions (code, version, name, included_micros, included_calls, internal_cost_micros)
  values (p_code, p_version, p_name, p_included_micros, p_included_calls, p_internal_cost_micros)
  returning id into v_id;
  return v_id;
end;
$$;

-- The platform opens a subscription for an active company, with its fixed time zone. It is 'pending' until the first confirmed payment is applied.
create function public.create_subscription(p_tenant uuid, p_plan_version uuid, p_timezone text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not exists (select 1 from public.tenants where id = p_tenant and status = 'active') then raise exception 'company not found or not active' using errcode = '42501'; end if;
  if not exists (select 1 from public.plan_versions where id = p_plan_version) then raise exception 'plan version not found' using errcode = '22023'; end if;
  if p_timezone is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then raise exception 'invalid time zone' using errcode = '22023'; end if;
  insert into public.subscriptions (tenant_id, plan_version_id, timezone) values (p_tenant, p_plan_version, p_timezone) returning id into v_id;
  return v_id;
end;
$$;

-- Records a payment event and applies it when it can be. Answers {ok, duplicate, status, reason, obligation}.
-- Order of the checks (all under the lock of the subscription, so concurrent events of the same payment are serialized):
--   1. the same (provider, event id): the same data answers the stored result; DIFFERENT data under a reused id is refused (nothing changes);
--   2. a failed payment or any other kind grants nothing and blocks nothing;
--   3. the payment identity (provider, payment_id, concept) is checked BEFORE classifying: a payment already recorded is ignored if its data is compatible and REJECTED if not;
--   4. only then is the payment classified by its confirmation instant (see private.apply_confirmed_payment).
create function public.apply_payment_event(
  p_provider text, p_external_event_id text, p_kind text, p_payment_id text, p_concept text,
  p_tenant uuid, p_subscription uuid, p_confirmed_at timestamptz, p_content_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.subscriptions;
  x public.payment_events;
  o public.payment_events;
  v_id uuid;
  v_status text;
  v_reason text;
  v_obligation text;
begin
  if p_provider is null or char_length(p_provider) not between 1 and 40 or p_external_event_id is null or char_length(p_external_event_id) not between 1 and 200
     or p_payment_id is null or char_length(p_payment_id) not between 1 and 200 or p_content_hash is null or char_length(p_content_hash) not between 1 and 128
     or p_concept is null or p_concept !~ '^[a-z][a-z0-9._:-]{0,79}$' then raise exception 'invalid payment event' using errcode = '22023'; end if;
  if p_kind is null or p_kind not in ('payment_confirmed', 'payment_failed', 'other') then raise exception 'invalid kind' using errcode = '22023'; end if;
  if p_kind = 'payment_confirmed' and p_confirmed_at is null then raise exception 'a confirmed payment needs its confirmation instant' using errcode = '22023'; end if;

  -- the lock that serializes everything that touches this subscription
  select * into s from public.subscriptions where id = p_subscription and tenant_id = p_tenant for update;
  if not found then raise exception 'subscription not found' using errcode = '42501'; end if;

  -- 1. the same event
  select * into x from public.payment_events where provider = p_provider and external_event_id = p_external_event_id;
  if found then
    if x.tenant_id = p_tenant and x.subscription_id = p_subscription and x.kind = p_kind and x.payment_id = p_payment_id and x.concept = p_concept
       and x.confirmed_at is not distinct from p_confirmed_at and x.content_hash = p_content_hash then
      return jsonb_build_object('ok', true, 'duplicate', true, 'status', x.status, 'reason', x.reason, 'obligation', x.obligation);
    end if;
    return jsonb_build_object('ok', false, 'duplicate', false, 'status', 'rejected', 'reason', 'event_id_reused_with_different_data');
  end if;

  insert into public.payment_events (tenant_id, subscription_id, provider, external_event_id, payment_id, concept, kind, confirmed_at, content_hash)
  values (p_tenant, p_subscription, p_provider, p_external_event_id, p_payment_id, p_concept, p_kind, p_confirmed_at, p_content_hash)
  returning id into v_id;

  -- 2. what grants nothing
  if p_kind <> 'payment_confirmed' then
    v_status := 'ignored'; v_reason := case when p_kind = 'payment_failed' then 'payment_failed_no_grant' else 'kind_grants_nothing' end;
  elsif p_concept <> 'included' then
    v_status := 'rejected'; v_reason := 'concept_not_supported'; -- top-ups and upgrades have their own pending conditions
  elsif s.status = 'ended' then
    v_status := 'rejected'; v_reason := 'subscription_ended';
  else
    -- 3. the payment identity, BEFORE classifying
    select * into o from public.payment_events
     where provider = p_provider and payment_id = p_payment_id and concept = p_concept and kind = 'payment_confirmed' and status in ('pending', 'applied') and id <> v_id;
    if found then
      if o.tenant_id = p_tenant and o.subscription_id = p_subscription and o.confirmed_at = p_confirmed_at then
        v_status := 'ignored'; v_reason := 'payment_already_recorded';
      else
        v_status := 'rejected'; v_reason := 'payment_id_reused_with_different_data';
      end if;
    elsif exists (select 1 from public.ai_allocation_grants where provider = p_provider and payment_id = p_payment_id and concept = p_concept) then
      v_status := 'rejected'; v_reason := 'payment_id_reused_with_different_data';
    else
      -- 4. classified by its confirmation instant and applied, or kept pending with its reason
      update public.payment_events set status = 'pending' where id = v_id;
      perform private.apply_confirmed_payment(v_id);
      select status, reason, obligation into v_status, v_reason, v_obligation from public.payment_events where id = v_id;
      return jsonb_build_object('ok', v_status <> 'rejected', 'duplicate', false, 'status', v_status, 'reason', v_reason, 'obligation', v_obligation);
    end if;
  end if;

  update public.payment_events set status = v_status, reason = v_reason where id = v_id;
  return jsonb_build_object('ok', v_status <> 'rejected', 'duplicate', false, 'status', v_status, 'reason', v_reason);
end;
$$;

-- Whether a subscription has operational access at an instant, derived from the stored periods: {state: 'none'} before the first activation, {state: 'active', cycleIndex, periodIndex, startsAt, endsAt}
-- inside a paid period, or {state: 'suspended', cycleIndex, since} once the paid time ended with no confirmed renewal (and during the whole interval until a reactivation).
create function public.subscription_access(p_subscription uuid, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c record;
  b public.billing_periods;
begin
  for c in select id, cycle_index, activated_at from public.subscription_cycles where subscription_id = p_subscription and activated_at <= p_at order by cycle_index desc limit 1 loop
    select * into b from public.billing_periods where cycle_id = c.id and starts_at <= p_at and p_at < ends_at;
    if found then
      return jsonb_build_object('state', 'active', 'cycleIndex', c.cycle_index, 'periodIndex', b.period_index, 'startsAt', b.starts_at, 'endsAt', b.ends_at);
    end if;
    return jsonb_build_object('state', 'suspended', 'cycleIndex', c.cycle_index, 'since', (select max(ends_at) from public.billing_periods where cycle_id = c.id));
  end loop;
  return jsonb_build_object('state', 'none');
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  private.protect_subscription(), private.local_day_start(date, text), private.cycle_period_bounds(date, text, timestamptz, int),
  private.apply_confirmed_payment(uuid),
  public.create_plan_version(text, int, text, bigint, int, bigint), public.create_subscription(uuid, uuid, text),
  public.apply_payment_event(text, text, text, text, text, uuid, uuid, timestamptz, text), public.subscription_access(uuid, timestamptz)
  from public, anon, authenticated, service_role;

-- Only the server key runs the public ones (it neither reads nor writes a table); no signed-in role records a payment, a plan or a subscription.
grant execute on function
  public.create_plan_version(text, int, text, bigint, int, bigint), public.create_subscription(uuid, uuid, text),
  public.apply_payment_event(text, text, text, text, text, uuid, uuid, timestamptz, text), public.subscription_access(uuid, timestamptz)
  to service_role;
