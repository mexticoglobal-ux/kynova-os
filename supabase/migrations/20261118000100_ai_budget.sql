-- AI budget per company (ADR-0036, option D): where the consumption of AI is kept, so that a company's limit is real across requests, instances and concurrent calls.
-- Three tables with RLS from the moment they exist and the functions that write them. Members never write: every change goes through a function that checks the right to do it.
-- Figures only (micros of a dollar, token counts): never a prompt, an answer or any other content.
--
-- How it works: a call RESERVES its worst case before reaching a provider (one atomic UPDATE with the limit in its WHERE), and SETTLES with the provider's attempts afterwards.
--   * The period is the calendar month in UTC. A company with no explicit assignment for the month has NO budget (0): nothing is reserved.
--   * The same idempotency key never reserves twice (a retried request finds its reservation).
--   * Every billable provider attempt is recorded, retries and fallbacks included; settling twice never counts an attempt twice.
--   * A reservation that expires is NOT released: its amount moves to "unreconciled" and keeps counting against the limit, because the provider call may have happened. It
--     frees room only when it is settled with the provider's attempts, or written off by an owner/admin with a written reason.
--   * Nothing here chooses a plan, a price or an amount: limits are assigned by the platform (service role) and the micros of each call come from the caller.
--
-- NOT APPLIED to any remote project: review first (AGENTS.md 7.11). Apply only to a disposable development project from the SQL editor.
--
-- Reversal plan (development only, destroys the budget records): drop the functions public.reserve_ai_budget, settle_ai_budget, release_ai_budget, write_off_ai_reservation,
-- assign_ai_budget, expire_ai_reservations and private.ai_budget_period; then drop the tables ai_usage_attempts, ai_reservations and ai_budget_periods, in that order.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per company and month (UTC). reserved: held for calls in flight. unreconciled: held for calls whose reservation expired and have not been reconciled.
-- spent: what settled calls cost. The limit is enforced when reserving: reserved + unreconciled + spent + new <= limit.
create table public.ai_budget_periods (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  period_start date not null check (period_start = date_trunc('month', period_start)::date),
  limit_micros bigint not null check (limit_micros >= 0),
  reserved_micros bigint not null default 0 check (reserved_micros >= 0),
  unreconciled_micros bigint not null default 0 check (unreconciled_micros >= 0),
  spent_micros bigint not null default 0 check (spent_micros >= 0),
  -- an OPTIONAL cap on the number of calls of the period (null = no cap): max_calls is assigned by the platform, calls_used counts every reservation that was not released
  -- (a held, settled, expired or written-off one may have reached a provider) plus any extra billable attempt a settlement reports. It is checked in the same atomic UPDATE as the money.
  max_calls int check (max_calls is null or max_calls >= 0),
  calls_used int not null default 0 check (calls_used >= 0),
  assigned_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, period_start)
);

create table public.ai_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  period_start date not null,
  purpose_id text not null check (purpose_id ~ '^[a-z][a-z0-9._-]{0,79}$'),
  amount_micros bigint not null check (amount_micros > 0),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  status text not null default 'held' check (status in ('held', 'settled', 'released', 'expired_unreconciled', 'written_off')),
  requested_by uuid,
  expires_at timestamptz not null,
  settled_micros bigint check (settled_micros >= 0),
  -- how much a settled call cost beyond what was reserved (an estimate that was too low): visible, never hidden
  overage_micros bigint not null default 0 check (overage_micros >= 0),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, idempotency_key),
  foreign key (tenant_id, period_start) references public.ai_budget_periods (tenant_id, period_start) on delete cascade
);
create index ai_reservations_held_idx on public.ai_reservations (expires_at) where status = 'held';
create index ai_reservations_tenant_idx on public.ai_reservations (tenant_id, created_at desc);

-- Every provider attempt that was or may have been billed, with the tokens and the cost in micros. Append-only. The same attempt number of a reservation is stored once.
create table public.ai_usage_attempts (
  tenant_id uuid not null,
  reservation_id uuid not null,
  attempt_no int not null check (attempt_no between 1 and 20),
  attempt_role text not null check (attempt_role in ('primary', 'retry', 'fallback')),
  provider text not null check (char_length(provider) between 1 and 40),
  model text not null check (char_length(model) between 1 and 80),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  billable boolean not null,
  recorded_at timestamptz not null default now(),
  primary key (reservation_id, attempt_no),
  foreign key (tenant_id, reservation_id) references public.ai_reservations (tenant_id, id) on delete cascade
);

create trigger ai_budget_periods_protect_tenant before update on public.ai_budget_periods
  for each row execute function private.protect_identity();
create trigger ai_reservations_protect_tenant before update on public.ai_reservations
  for each row execute function private.protect_identity();
create trigger ai_usage_attempts_append_only before update or delete on public.ai_usage_attempts
  for each row execute function private.reject_mutation();

-- ---------------------------------------------------------------------------
-- RLS: owners and admins read the figures of their company; nobody writes directly
-- ---------------------------------------------------------------------------

alter table public.ai_budget_periods enable row level security;
alter table public.ai_reservations enable row level security;
alter table public.ai_usage_attempts enable row level security;

revoke all on table public.ai_budget_periods, public.ai_reservations, public.ai_usage_attempts from public, anon, authenticated, service_role;
grant select on table public.ai_budget_periods, public.ai_reservations, public.ai_usage_attempts to authenticated;

create policy ai_budget_periods_select on public.ai_budget_periods
  for select to authenticated using ((select private.is_admin(tenant_id)));
create policy ai_reservations_select on public.ai_reservations
  for select to authenticated using ((select private.is_admin(tenant_id)));
create policy ai_usage_attempts_select on public.ai_usage_attempts
  for select to authenticated using ((select private.is_admin(tenant_id)));

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

-- The current period: the calendar month in UTC.
create function private.ai_budget_period()
returns date
language sql
stable
set search_path = ''
as $$ select date_trunc('month', now() at time zone 'utc')::date; $$;

-- Reserves room for ONE call of a company, before it reaches a provider. Answers a jsonb: {ok, reservationId, status, expiresAt, periodStart, repeated} or {ok: false, reason}.
-- reason: 'no_budget' (nothing assigned for this month: the budget is 0), 'budget_exceeded', 'call_limit_reached' (the period's cap of calls is used up), 'already_closed' (the key belongs to a reservation that is no longer held).
-- Atomic: the limit is in the WHERE of the single UPDATE, and the row lock serializes concurrent calls of the same company. Idempotent by key: a retry never reserves twice.
create function public.reserve_ai_budget(p_tenant uuid, p_purpose text, p_estimate_micros bigint, p_idempotency_key text, p_ttl_seconds int default 300)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date := private.ai_budget_period();
  v_id uuid;
  v_existing public.ai_reservations;
  v_row public.ai_budget_periods;
  v_expires timestamptz;
begin
  perform private.require_write(p_tenant);
  if p_estimate_micros is null or p_estimate_micros <= 0 or p_estimate_micros > 1000000000000 then raise exception 'invalid estimate' using errcode = '22023'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then raise exception 'invalid idempotency key' using errcode = '22023'; end if;
  if p_purpose is null or p_purpose !~ '^[a-z][a-z0-9._-]{0,79}$' then raise exception 'invalid purpose' using errcode = '22023'; end if;
  if p_ttl_seconds is null or p_ttl_seconds not between 30 and 3600 then raise exception 'invalid ttl' using errcode = '22023'; end if;

  -- no explicit assignment for this month = no budget
  if not exists (select 1 from public.ai_budget_periods where tenant_id = p_tenant and period_start = v_period) then
    return jsonb_build_object('ok', false, 'reason', 'no_budget');
  end if;

  v_expires := now() + make_interval(secs => p_ttl_seconds);
  insert into public.ai_reservations (tenant_id, period_start, purpose_id, amount_micros, idempotency_key, requested_by, expires_at)
  values (p_tenant, v_period, p_purpose, p_estimate_micros, p_idempotency_key, (select auth.uid()), v_expires)
  on conflict (tenant_id, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    -- the key was used before: the same request finds its reservation (a different request under the same key is a mistake)
    select * into v_existing from public.ai_reservations where tenant_id = p_tenant and idempotency_key = p_idempotency_key;
    if v_existing.amount_micros <> p_estimate_micros or v_existing.purpose_id <> p_purpose then
      raise exception 'idempotency key reused for a different request' using errcode = '23505';
    end if;
    return jsonb_build_object('ok', v_existing.status = 'held', 'reason', case when v_existing.status = 'held' then null else 'already_closed' end,
                              'reservationId', v_existing.id, 'status', v_existing.status, 'expiresAt', v_existing.expires_at, 'periodStart', v_existing.period_start, 'repeated', true);
  end if;

  update public.ai_budget_periods
     set reserved_micros = reserved_micros + p_estimate_micros, calls_used = calls_used + 1, updated_at = now()
   where tenant_id = p_tenant and period_start = v_period
     and reserved_micros + unreconciled_micros + spent_micros + p_estimate_micros <= limit_micros
     and (max_calls is null or calls_used < max_calls)
  returning * into v_row;
  if not found then
    delete from public.ai_reservations where id = v_id;
    -- the cap of calls is reported first: it is the limit that does not depend on the size of the estimate
    if exists (select 1 from public.ai_budget_periods where tenant_id = p_tenant and period_start = v_period and max_calls is not null and calls_used >= max_calls) then
      return jsonb_build_object('ok', false, 'reason', 'call_limit_reached');
    end if;
    return jsonb_build_object('ok', false, 'reason', 'budget_exceeded');
  end if;
  return jsonb_build_object('ok', true, 'reservationId', v_id, 'status', 'held', 'expiresAt', v_expires, 'periodStart', v_period, 'repeated', false);
end;
$$;

-- Settles a reservation with the attempts the provider layer made: p_attempts is an array (at most 20) of
-- {attempt_no, role, provider, model, input_tokens, output_tokens, cost_micros, billable}. EVERY billable attempt counts (retries and fallbacks too). Works on a held reservation and
-- on an expired one (that is how it is reconciled: it needs at least one attempt as evidence). Idempotent: an attempt number is stored once and a settled reservation answers
-- the same again. The part of the reservation that was not spent returns to the budget; a cost above the reservation is recorded as overage and counts as spent.
create function public.settle_ai_budget(p_reservation uuid, p_attempts jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.ai_reservations;
  v_actual bigint;
  v_over bigint;
  v_billable int;
begin
  select * into r from public.ai_reservations where id = p_reservation for update;
  if r.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  perform private.require_write(r.tenant_id);
  if r.status = 'settled' then
    return jsonb_build_object('ok', true, 'reservationId', r.id, 'status', r.status, 'settledMicros', r.settled_micros, 'overageMicros', r.overage_micros, 'repeated', true);
  end if;
  if r.status not in ('held', 'expired_unreconciled') then raise exception 'reservation is closed' using errcode = '23514'; end if;
  if p_attempts is null or jsonb_typeof(p_attempts) <> 'array' or jsonb_array_length(p_attempts) > 20 then raise exception 'invalid attempts' using errcode = '22023'; end if;
  if r.status = 'expired_unreconciled' and jsonb_array_length(p_attempts) = 0 then
    raise exception 'reconciling an expired reservation needs the attempts the provider reported' using errcode = '22023';
  end if;

  insert into public.ai_usage_attempts (tenant_id, reservation_id, attempt_no, attempt_role, provider, model, input_tokens, output_tokens, cost_micros, billable)
  select r.tenant_id, r.id, a.attempt_no, a.role, a.provider, a.model, coalesce(a.input_tokens, 0), coalesce(a.output_tokens, 0), coalesce(a.cost_micros, 0), a.billable
  from jsonb_to_recordset(p_attempts) as a(attempt_no int, role text, provider text, model text, input_tokens bigint, output_tokens bigint, cost_micros bigint, billable boolean)
  on conflict (reservation_id, attempt_no) do nothing;

  -- what was spent is what is STORED for the reservation, so a replay or a repeated attempt number cannot count twice
  select coalesce(sum(cost_micros) filter (where billable), 0), count(*) filter (where billable) into v_actual, v_billable from public.ai_usage_attempts where reservation_id = r.id;
  v_over := greatest(0, v_actual - r.amount_micros);

  update public.ai_budget_periods
     set reserved_micros = reserved_micros - case when r.status = 'held' then r.amount_micros else 0 end,
         unreconciled_micros = unreconciled_micros - case when r.status = 'expired_unreconciled' then r.amount_micros else 0 end,
         spent_micros = spent_micros + v_actual,
         -- the reservation already holds ONE call: every further billable attempt (a retry or a fallback) is a call too
         calls_used = calls_used + greatest(0, v_billable - 1),
         updated_at = now()
   where tenant_id = r.tenant_id and period_start = r.period_start;
  update public.ai_reservations set status = 'settled', settled_micros = v_actual, overage_micros = v_over, closed_at = now() where id = r.id;
  return jsonb_build_object('ok', true, 'reservationId', r.id, 'status', 'settled', 'settledMicros', v_actual, 'overageMicros', v_over, 'repeated', false);
end;
$$;

-- Releases a HELD reservation whose call never reached a provider (the caller attests it); the call it held returns to the cap. It is refused when any attempt was recorded and, always, for an expired one:
-- an expired reservation may have been spent and is only closed by settling it or by a written-off decision.
create function public.release_ai_budget(p_reservation uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.ai_reservations;
begin
  select * into r from public.ai_reservations where id = p_reservation for update;
  if r.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  perform private.require_write(r.tenant_id);
  if r.status <> 'held' then raise exception 'only a held reservation can be released' using errcode = '23514'; end if;
  if exists (select 1 from public.ai_usage_attempts where reservation_id = r.id) then raise exception 'attempts were recorded: settle it instead' using errcode = '23514'; end if;
  update public.ai_budget_periods set reserved_micros = reserved_micros - r.amount_micros, calls_used = greatest(0, calls_used - 1), updated_at = now() where tenant_id = r.tenant_id and period_start = r.period_start;
  update public.ai_reservations set status = 'released', closed_at = now() where id = r.id;
  return jsonb_build_object('ok', true, 'reservationId', r.id, 'status', 'released');
end;
$$;

-- An owner or admin closes an expired reservation without a settlement, with a written reason (for instance, the provider confirmed there was no charge). The amount returns to
-- the budget and the decision is recorded in the action log. This is the only way an unreconciled amount stops counting without a settlement.
create function public.write_off_ai_reservation(p_reservation uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare r public.ai_reservations;
begin
  select * into r from public.ai_reservations where id = p_reservation for update;
  if r.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  perform private.require_admin(r.tenant_id);
  if r.status <> 'expired_unreconciled' then raise exception 'only an expired, unreconciled reservation can be written off' using errcode = '23514'; end if;
  if p_note is null or char_length(btrim(p_note)) not between 10 and 500 then raise exception 'a written reason of 10 to 500 characters is required' using errcode = '22023'; end if;
  update public.ai_budget_periods set unreconciled_micros = unreconciled_micros - r.amount_micros, updated_at = now() where tenant_id = r.tenant_id and period_start = r.period_start;
  update public.ai_reservations set status = 'written_off', note = btrim(p_note), closed_at = now() where id = r.id;
  perform private.log_action(r.tenant_id, 'ai.budget.written_off', 3::smallint, 'Se canceló una reserva de IA vencida sin liquidación', btrim(p_note));
  return jsonb_build_object('ok', true, 'reservationId', r.id, 'status', 'written_off');
end;
$$;

-- The platform (server key) assigns a company's limit for a month. The company never sets its own. A limit cannot go below what is already committed (reserved + unreconciled + spent).
create function public.assign_ai_budget(p_tenant uuid, p_period date, p_limit_micros bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows int;
begin
  if p_period is null or p_period <> date_trunc('month', p_period)::date then raise exception 'the period is the first day of a month' using errcode = '23514'; end if;
  if p_limit_micros is null or p_limit_micros < 0 then raise exception 'invalid limit' using errcode = '22023'; end if;
  insert into public.ai_budget_periods (tenant_id, period_start, limit_micros) values (p_tenant, p_period, p_limit_micros)
  on conflict (tenant_id, period_start) do update set limit_micros = excluded.limit_micros, assigned_at = now(), updated_at = now()
    where public.ai_budget_periods.reserved_micros + public.ai_budget_periods.unreconciled_micros + public.ai_budget_periods.spent_micros <= excluded.limit_micros;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'the limit cannot be below what is already committed' using errcode = '23514'; end if;
end;
$$;

-- The platform (server key) caps the number of calls of a period, on top of its money limit (null removes the cap). It needs the period's budget to be assigned first, and a cap
-- cannot go below the calls already used. The company never sets its own cap. A cap is counted per reservation, so it assumes ONE attempt per request (no automatic retries).
create function public.assign_ai_call_cap(p_tenant uuid, p_period date, p_max_calls int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows int;
begin
  if p_period is null or p_period <> date_trunc('month', p_period)::date then raise exception 'the period is the first day of a month' using errcode = '23514'; end if;
  if p_max_calls is not null and p_max_calls < 0 then raise exception 'invalid cap' using errcode = '22023'; end if;
  update public.ai_budget_periods set max_calls = p_max_calls, updated_at = now()
   where tenant_id = p_tenant and period_start = p_period and (p_max_calls is null or calls_used <= p_max_calls);
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'assign the period budget first, and a cap cannot be below the calls already used' using errcode = '23514'; end if;
end;
$$;

-- Maintenance (server key): moves every held reservation past its expiry to "unreconciled". It NEVER frees room: the amount keeps counting against the limit until it is settled
-- with the provider's attempts or written off. Returns how many it moved.
create function public.expire_ai_reservations()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_count int := 0;
begin
  for r in select id, tenant_id, period_start, amount_micros from public.ai_reservations where status = 'held' and expires_at < now() order by expires_at for update skip locked loop
    update public.ai_budget_periods
       set reserved_micros = reserved_micros - r.amount_micros, unreconciled_micros = unreconciled_micros + r.amount_micros, updated_at = now()
     where tenant_id = r.tenant_id and period_start = r.period_start;
    update public.ai_reservations set status = 'expired_unreconciled' where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  private.ai_budget_period(),
  public.reserve_ai_budget(uuid, text, bigint, text, int), public.settle_ai_budget(uuid, jsonb), public.release_ai_budget(uuid), public.write_off_ai_reservation(uuid, text),
  public.assign_ai_budget(uuid, date, bigint), public.assign_ai_call_cap(uuid, date, int), public.expire_ai_reservations()
  from public, anon, authenticated, service_role;

-- A person who can work the company's data reserves, settles and releases (the permission is checked inside); an owner or admin writes off.
grant execute on function public.reserve_ai_budget(uuid, text, bigint, text, int), public.settle_ai_budget(uuid, jsonb), public.release_ai_budget(uuid), public.write_off_ai_reservation(uuid, text) to authenticated;
-- The server key assigns limits and call caps and runs the expiry: it never reads or writes a table.
grant execute on function public.assign_ai_budget(uuid, date, bigint), public.assign_ai_call_cap(uuid, date, int), public.expire_ai_reservations() to service_role;
