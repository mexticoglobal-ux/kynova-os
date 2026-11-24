#!/usr/bin/env bash
# Subscriptions under concurrency (ADR-0037): many sessions record payment events of the SAME subscription at once. Run after the migrations, with PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE set
# (the CI job sets them):  bash supabase/tests/subscriptions_concurrency.sh
# Expectations, checked at the end (a failed one exits non-zero):
#   1. 30 sessions send 30 DIFFERENT events of the SAME payment at once: exactly ONE cycle, TWO periods (the first payment and ONE renewal) and TWO grants exist, one event is applied and 29 are ignored.
#   2. 20 sessions send the SAME event at once: ONE event row, no second grant, every answer reads 'applied'.
#   3. Five DIFFERENT payments, all confirmed inside the time already paid, are sent at once: exactly ONE is applied (a renewal) and the other four are held as paid ahead, with no grant and no cycle change.
#   4. 10 sessions reuse ONE payment id with two incompatible instants: exactly one version wins and the other is refused; the ledger holds one grant for that payment.
#   5. Two reactivation candidates and a late payment arriving together never produce overlapping periods or two grants for one payment.
# Every call runs as the SERVER (service_role). Fictitious data only. It creates its own companies and removes nothing else.
set -euo pipefail

T1='60000000-0000-4000-8000-0000000000b1'
T2='60000000-0000-4000-8000-0000000000b2'
T3='60000000-0000-4000-8000-0000000000b3'
T4='60000000-0000-4000-8000-0000000000b4'
T5='60000000-0000-4000-8000-0000000000b5'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
psql_admin() { psql -X -q -At -v ON_ERROR_STOP=1 "$@"; }
fail() { echo "FAIL: $*"; exit 1; }

psql_admin <<SQL
insert into public.tenants (id, name) values ('$T1', 'Empresa Conc 1'), ('$T2', 'Empresa Conc 2'), ('$T3', 'Empresa Conc 3'), ('$T4', 'Empresa Conc 4'), ('$T5', 'Empresa Conc 5') on conflict do nothing;
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
S1=$(sub_of "$T1"); S2=$(sub_of "$T2"); S3=$(sub_of "$T3"); S4=$(sub_of "$T4"); S5=$(sub_of "$T5")

# ev TENANT SUB EVENT PAYMENT AT [HASH]  ->  prints the status of the answer
ev() {
  local hash="${6:-h-$4}"
  { echo "set role service_role;"; echo "select public.apply_payment_event('prov-conc', '$3', 'payment_confirmed', '$4', 'included', '$1', '$2', '$5'::timestamptz, '$hash') ->> 'status';"; } | psql_admin -f - | tail -n1
}

# first payment of each subscription (sequential): 9 Jan 2026 15:00Z, paid until 9 Feb 06:00Z
for pair in "$T1:$S1:1" "$T2:$S2:2" "$T3:$S3:3" "$T4:$S4:4" "$T5:$S5:5"; do
  IFS=: read -r tt ss nn <<< "$pair"
  ev "$tt" "$ss" "first-$nn" "pay-first-$nn" '2026-01-09 15:00:00+00' >/dev/null
done

# 1. different events of the SAME payment (a renewal confirmed in time), 30 at once
for i in $(seq 1 30); do ( ev "$T1" "$S1" "same-pay-evt-$i" pay-renew '2026-02-02 12:00:00+00' > "$TMP/a$i" ) & done
wait
applied=$(cat "$TMP"/a* | grep -c '^applied$' || true); ignored=$(cat "$TMP"/a* | grep -c '^ignored$' || true)
cycles=$(psql_admin -c "select count(*) from public.subscription_cycles where subscription_id = '$S1'")
periods=$(psql_admin -c "select count(*) from public.billing_periods where tenant_id = '$T1'")
grants=$(psql_admin -c "select count(*) from public.ai_allocation_grants where tenant_id = '$T1'")
[ "$applied" -eq 1 ] && [ "$ignored" -eq 29 ] || fail "30 events of one payment: applied=$applied ignored=$ignored (want 1 and 29)"
[ "$cycles" -eq 1 ] && [ "$periods" -eq 2 ] && [ "$grants" -eq 2 ] || fail "30 events of one payment left cycles=$cycles periods=$periods grants=$grants (want 1, 2, 2)"
echo "ok: 30 concurrent events of one payment granted once (1 cycle, 2 periods, 2 grants)"

# 2. the SAME event 20 times at once
for i in $(seq 1 20); do ( ev "$T2" "$S2" same-event pay-same '2026-02-02 12:00:00+00' > "$TMP/b$i" ) & done
wait
rows=$(psql_admin -c "select count(*) from public.payment_events where provider = 'prov-conc' and external_event_id = 'same-event'")
grants=$(psql_admin -c "select count(*) from public.ai_allocation_grants where tenant_id = '$T2'")
[ "$rows" -eq 1 ] && [ "$grants" -eq 2 ] || fail "the same event 20 times: rows=$rows grants=$grants (want 1 and 2)"
[ "$(cat "$TMP"/b* | grep -c '^applied$')" -eq 20 ] || fail "every answer to the same event must read 'applied' (the first applied it, the rest found it)"
echo "ok: the same event sent 20 times at once left one row and one grant"

# 3. five DIFFERENT payments confirmed inside the time already paid (20 to 24 Jan), at once: one renews, the others are paid ahead
for i in 0 1 2 3 4; do ( ev "$T3" "$S3" "ahead-$i" "pay-ahead-$i" "2026-01-2$i 12:00:00+00" > "$TMP/c$i" ) & done
wait
applied=$(cat "$TMP"/c* | grep -c '^applied$' || true); pending=$(cat "$TMP"/c* | grep -c '^pending$' || true)
grants=$(psql_admin -c "select count(*) from public.ai_allocation_grants where tenant_id = '$T3'")
periods=$(psql_admin -c "select count(*) from public.billing_periods where tenant_id = '$T3'")
cycles=$(psql_admin -c "select count(*) from public.subscription_cycles where subscription_id = '$S3'")
held=$(psql_admin -c "select count(*) from public.payment_events where subscription_id = '$S3' and status = 'pending' and reason = 'paid_ahead_policy_pending' and obligation = 'paid_ahead'")
[ "$applied" -eq 1 ] && [ "$pending" -eq 4 ] || fail "five payments inside the paid time: applied=$applied pending=$pending (want 1 and 4)"
[ "$grants" -eq 2 ] && [ "$periods" -eq 2 ] && [ "$cycles" -eq 1 ] && [ "$held" -eq 4 ] || fail "paid ahead granted or changed something: grants=$grants periods=$periods cycles=$cycles held=$held (want 2, 2, 1, 4)"
echo "ok: five payments inside the paid time left one renewal and four held, with no extra grant"

# 4. one payment id, two incompatible instants, 10 sessions
for i in $(seq 1 10); do
  if [ $((i % 2)) -eq 0 ]; then at='2026-02-03 12:00:00+00'; else at='2026-02-04 12:00:00+00'; fi
  ( ev "$T4" "$S4" "clash-$i" pay-clash "$at" > "$TMP/d$i" ) &
done
wait
applied=$(cat "$TMP"/d* | grep -c '^applied$' || true); rejected=$(cat "$TMP"/d* | grep -c '^rejected$' || true); ignored=$(cat "$TMP"/d* | grep -c '^ignored$' || true)
grants=$(psql_admin -c "select count(*) from public.ai_allocation_grants where tenant_id = '$T4' and payment_id = 'pay-clash'")
[ "$applied" -eq 1 ] && [ "$grants" -eq 1 ] || fail "a payment id with incompatible data: applied=$applied grants=$grants (want exactly one winner)"
[ "$((applied + rejected + ignored))" -eq 10 ] && [ "$rejected" -ge 1 ] || fail "incompatible versions were not refused (applied=$applied ignored=$ignored rejected=$rejected)"
echo "ok: one payment id with incompatible data produced one winner and $rejected refusals"

# 5. after the paid time ended (9 Feb 06:00Z): two different payments confirmed on 20 and 21 Feb and a late one confirmed on 5 Feb arrive together
( ev "$T5" "$S5" r-1 pay-react-1 '2026-02-20 18:00:00+00' > "$TMP/e1" ) &
( ev "$T5" "$S5" r-2 pay-react-2 '2026-02-21 18:00:00+00' > "$TMP/e2" ) &
( ev "$T5" "$S5" r-3 pay-late-1 '2026-02-05 18:00:00+00' > "$TMP/e3" ) &
wait
grants=$(psql_admin -c "select count(*) from public.ai_allocation_grants where tenant_id = '$T5'")
dup=$(psql_admin -c "select count(*) from (select payment_id from public.ai_allocation_grants where tenant_id = '$T5' group by payment_id having count(*) > 1) x")
overlap=$(psql_admin -c "select count(*) from public.billing_periods a join public.billing_periods b on a.tenant_id = b.tenant_id and a.id < b.id and a.starts_at < b.ends_at and b.starts_at < a.ends_at where a.tenant_id = '$T5'")
cycles=$(psql_admin -c "select count(*) from public.subscription_cycles where subscription_id = '$S5'")
[ "$dup" -eq 0 ] && [ "$overlap" -eq 0 ] || fail "concurrent reactivation candidates: duplicated grants=$dup, overlapping periods=$overlap"
[ "$cycles" -ge 2 ] && [ "$grants" -ge 2 ] || fail "concurrent reactivation candidates produced cycles=$cycles grants=$grants (want a reactivation applied)"
echo "ok: concurrent reactivation candidates and a late payment left no duplicate grant and no overlapping period ($cycles cycles, $grants grants)"
echo "subscriptions concurrency: all checks passed"
