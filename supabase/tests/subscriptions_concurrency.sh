#!/usr/bin/env bash
# Subscriptions under concurrency (ADR-0037): many sessions record payment events of the SAME subscription at once. Run after the migrations, with PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE set
# (the CI job sets them):  bash supabase/tests/subscriptions_concurrency.sh
# Expectations, checked at the end (a failed one exits non-zero):
#   1. 30 sessions send 30 DIFFERENT events of the SAME payment at once: exactly ONE cycle, ONE period and ONE grant exist, and one event is applied.
#   2. 20 sessions send the SAME event at once: ONE event row, no second grant.
#   3. Five different payments (sequence 2..6, all inside the paid time) are sent at once in a shuffled order: every one is applied exactly once, in sequence order, with contiguous periods and no duplicate.
#   4. 10 sessions reuse ONE payment id with two incompatible instants: exactly one version wins, the other is refused, and the ledger holds one grant for that payment.
# Every call runs as the SERVER (service_role). Fictitious data only. It creates its own companies and removes nothing else.
set -euo pipefail

T1='60000000-0000-4000-8000-0000000000b1'
T2='60000000-0000-4000-8000-0000000000b2'
T3='60000000-0000-4000-8000-0000000000b3'
T4='60000000-0000-4000-8000-0000000000b4'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
psql_admin() { psql -X -q -At -v ON_ERROR_STOP=1 "$@"; }
fail() { echo "FAIL: $*"; exit 1; }

psql_admin <<SQL
insert into public.tenants (id, name) values ('$T1', 'Empresa Conc 1'), ('$T2', 'Empresa Conc 2'), ('$T3', 'Empresa Conc 3'), ('$T4', 'Empresa Conc 4') on conflict do nothing;
SQL
if [ -z "$(psql_admin -c "select id from public.plan_versions where code = 'conc-plan'")" ]; then
  psql_admin <<SQL
set role service_role;
select public.create_plan_version('conc-plan', 1, 'Plan de concurrencia', 1000000, 30, 0);
SQL
fi
PLAN=$(psql_admin -c "select id from public.plan_versions where code = 'conc-plan'")
sub_of() { psql_admin <<SQL | tail -n1
set role service_role;
select public.create_subscription('$1', '$PLAN', 'America/Costa_Rica');
SQL
}
S1=$(sub_of "$T1"); S2=$(sub_of "$T2"); S3=$(sub_of "$T3"); S4=$(sub_of "$T4")

# ev TENANT SUB EVENT PAYMENT SEQ AT [HASH]  ->  prints the status of the answer
ev() {
  local hash="${7:-h-$4}"
  { echo "set role service_role;"; echo "select public.apply_payment_event('prov-conc', '$3', 'payment_confirmed', '$4', 'included', '$1', '$2', $5, '$6'::timestamptz, '$hash') ->> 'status';"; } | psql_admin -f - | tail -n1
}

# first payment of each subscription (sequential): 9 Jan 2026 15:00Z, paid until 9 Feb 06:00Z
ev "$T1" "$S1" first-1 pay-first-1 1 '2026-01-09 15:00:00+00' >/dev/null
ev "$T2" "$S2" first-2 pay-first-2 1 '2026-01-09 15:00:00+00' >/dev/null
ev "$T3" "$S3" first-3 pay-first-3 1 '2026-01-09 15:00:00+00' >/dev/null
ev "$T4" "$S4" first-4 pay-first-4 1 '2026-01-09 15:00:00+00' >/dev/null

# 1. different events of the SAME payment (a renewal confirmed in time), 30 at once
for i in $(seq 1 30); do ( ev "$T1" "$S1" "same-pay-evt-$i" pay-renew 2 '2026-02-02 12:00:00+00' > "$TMP/a$i" ) & done
wait
applied=$(cat "$TMP"/a* | grep -c '^applied$' || true); ignored=$(cat "$TMP"/a* | grep -c '^ignored$' || true)
cycles=$(psql_admin -c "select count(*) from public.subscription_cycles where subscription_id = '$S1'")
periods=$(psql_admin -c "select count(*) from public.billing_periods where tenant_id = '$T1'")
grants=$(psql_admin -c "select count(*) from public.ai_allocation_grants where tenant_id = '$T1'")
[ "$applied" -eq 1 ] && [ "$ignored" -eq 29 ] || fail "30 events of one payment: applied=$applied ignored=$ignored (want 1 and 29)"
[ "$cycles" -eq 1 ] && [ "$periods" -eq 2 ] && [ "$grants" -eq 2 ] || fail "30 events of one payment left cycles=$cycles periods=$periods grants=$grants (want 1, 2, 2: the first payment and ONE renewal)"
echo "ok: 30 concurrent events of one payment granted once (1 cycle, 2 periods, 2 grants)"

# 2. the SAME event 20 times at once
for i in $(seq 1 20); do ( ev "$T2" "$S2" same-event pay-same 2 '2026-02-02 12:00:00+00' > "$TMP/b$i" ) & done
wait
rows=$(psql_admin -c "select count(*) from public.payment_events where provider = 'prov-conc' and external_event_id = 'same-event'")
grants=$(psql_admin -c "select count(*) from public.ai_allocation_grants where tenant_id = '$T2'")
[ "$rows" -eq 1 ] && [ "$grants" -eq 2 ] || fail "the same event 20 times: rows=$rows grants=$grants (want 1 and 2)"
[ "$(cat "$TMP"/b* | grep -c '^applied$')" -eq 20 ] || fail "every answer to the same event must read 'applied' (the first applied it, the rest found it)"
echo "ok: the same event sent 20 times at once left one row and one grant"

# 3. five different payments, sequence 2..6, shuffled and concurrent. The second period starts 9 Feb 06:00Z; each confirmation is inside the time already paid
n=0
for seq in 5 3 6 2 4; do
  n=$((n + 1))
  # each payment is confirmed inside the time already paid (one month per payment)
  case $seq in 2) at='2026-01-20 12:00:00+00';; 3) at='2026-02-12 12:00:00+00';; 4) at='2026-03-12 12:00:00+00';; 5) at='2026-04-12 12:00:00+00';; 6) at='2026-05-12 12:00:00+00';; esac
  ( ev "$T3" "$S3" "chain-$seq" "pay-chain-$seq" "$seq" "$at" > "$TMP/c$n" ) &
done
wait
# a late arrival may leave a payment pending until its predecessor lands; one more resume applies whatever is left
psql_admin <<SQL > /dev/null
set role service_role;
select public.apply_pending_payment_events('$S3');
SQL
pending=$(psql_admin -c "select count(*) from public.payment_events where subscription_id = '$S3' and status = 'pending'")
applied=$(psql_admin -c "select count(*) from public.payment_events where subscription_id = '$S3' and status = 'applied'")
grants=$(psql_admin -c "select count(*) from public.ai_allocation_grants where tenant_id = '$T3'")
order=$(psql_admin -c "select string_agg(b.period_index::text, ',' order by b.starts_at) from public.billing_periods b where b.tenant_id = '$T3'")
gaps=$(psql_admin -c "select count(*) from (select b.ends_at, lead(b.starts_at) over (order by b.starts_at) as next_start from public.billing_periods b where b.tenant_id = '$T3') x where next_start is not null and next_start <> ends_at")
[ "$pending" -eq 0 ] && [ "$applied" -eq 6 ] && [ "$grants" -eq 6 ] || fail "shuffled chain: pending=$pending applied=$applied grants=$grants (want 0, 6, 6)"
[ "$order" = "0,1,2,3,4,5" ] && [ "$gaps" -eq 0 ] || fail "shuffled chain: periods in order '$order', $gaps gaps or overlaps"
# the sequence of the events matches the order of the periods (nothing was applied out of order)
inversions=$(psql_admin -c "select count(*) from public.payment_events e join public.billing_periods b on b.id = e.period_id where e.subscription_id = '$S3' and e.sequence_no - 1 <> b.period_index")
[ "$inversions" -eq 0 ] || fail "shuffled chain: $inversions events were applied to a period that is not theirs"
echo "ok: five payments delivered in a shuffled concurrent order were applied once each, in sequence, with contiguous periods"

# 4. one payment id, two incompatible instants, 10 sessions
for i in $(seq 1 10); do
  if [ $((i % 2)) -eq 0 ]; then at='2026-02-03 12:00:00+00'; else at='2026-02-04 12:00:00+00'; fi
  ( ev "$T4" "$S4" "clash-$i" pay-clash 2 "$at" > "$TMP/d$i" ) &
done
wait
applied=$(cat "$TMP"/d* | grep -c '^applied$' || true); rejected=$(cat "$TMP"/d* | grep -c '^rejected$' || true); ignored=$(cat "$TMP"/d* | grep -c '^ignored$' || true)
grants=$(psql_admin -c "select count(*) from public.ai_allocation_grants where tenant_id = '$T4' and payment_id = 'pay-clash'")
[ "$applied" -eq 1 ] && [ "$grants" -eq 1 ] || fail "a payment id with incompatible data: applied=$applied grants=$grants (want exactly one winner)"
[ "$((applied + rejected + ignored))" -eq 10 ] && [ "$rejected" -ge 1 ] || fail "incompatible versions were not refused (applied=$applied ignored=$ignored rejected=$rejected)"
echo "ok: one payment id with incompatible data produced one winner and $rejected refusals"
echo "subscriptions concurrency: all checks passed"
