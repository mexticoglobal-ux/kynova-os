#!/usr/bin/env bash
# AI budget under concurrency (ADR-0036): many sessions of the SAME company reserve at once against a small limit. Run after the migrations, with PGHOST, PGPORT, PGUSER,
# PGPASSWORD and PGDATABASE set (the CI job sets them):  bash supabase/tests/ai_budget_concurrency.sh
# Expectations, checked at the end (a failed one exits non-zero):
#   1. With a limit that fits exactly 10 reservations of 100 and 40 sessions asking, EXACTLY 10 are granted and reserved is exactly 1000: the limit holds under concurrency.
#   2. 20 sessions that use the SAME idempotency key create ONE reservation and reserve its amount ONCE.
#   3. Settling the same reservation from 10 sessions at once counts its attempts once.
# Fictitious data only. It creates its own company and user and removes nothing else.
set -euo pipefail

T='40000000-0000-4000-8000-0000000000b1'
U='40000000-0000-4000-8000-000000000001'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
psql_admin() { psql -X -q -At -v ON_ERROR_STOP=1 "$@"; }

psql_admin <<SQL
insert into auth.users (id, email) values ('$U', 'conc@example.test') on conflict do nothing;
insert into public.tenants (id, name) values ('$T', 'Empresa Concurrencia') on conflict do nothing;
insert into public.memberships (user_id, tenant_id, role) values ('$U', '$T', 'owner') on conflict do nothing;
set role service_role;
select public.assign_ai_budget('$T', date_trunc('month', now() at time zone 'utc')::date, 1000);
SQL

as_user() { # prints the SQL that makes the session act as the owner
  cat <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', '$U', false);
select set_config('request.jwt.claims', '{"sub":"$U","email":"conc@example.test"}', false);
SQL
}

# 1. 40 distinct keys at once; the limit fits 10
for i in $(seq 1 40); do
  ( { as_user; echo "select public.reserve_ai_budget('$T', 'message.draft', 100, 'conc-$i', 300) ->> 'ok';"; } | psql_admin -f - | tail -n1 > "$TMP/r$i" ) &
done
wait
granted=$(cat "$TMP"/r* | grep -c '^true$' || true)
reserved=$(psql_admin -c "select reserved_micros from public.ai_budget_periods where tenant_id = '$T'")
if [ "$granted" -ne 10 ] || [ "$reserved" -ne 1000 ]; then echo "FAIL: granted=$granted (want 10), reserved=$reserved (want 1000)"; exit 1; fi
echo "ok: the limit held under 40 concurrent reservations (10 granted, 1000 reserved)"

# make room for the next checks: release what the first part held
psql_admin <<SQL
update public.ai_reservations set status = 'released', closed_at = now() where tenant_id = '$T' and status = 'held';
update public.ai_budget_periods set reserved_micros = 0 where tenant_id = '$T';
SQL

# 2. 20 sessions, one key
for i in $(seq 1 20); do
  ( { as_user; echo "select public.reserve_ai_budget('$T', 'message.draft', 100, 'same-key', 300) ->> 'ok';"; } | psql_admin -f - | tail -n1 > "$TMP/s$i" ) &
done
wait
rows=$(psql_admin -c "select count(*) from public.ai_reservations where tenant_id = '$T' and idempotency_key = 'same-key'")
reserved=$(psql_admin -c "select reserved_micros from public.ai_budget_periods where tenant_id = '$T'")
if [ "$rows" -ne 1 ] || [ "$reserved" -ne 100 ]; then echo "FAIL: same key made $rows reservations and reserved $reserved (want 1 and 100)"; exit 1; fi
echo "ok: one key, one reservation, reserved once"

# 3. the same settlement from 10 sessions
RID=$(psql_admin -c "select id from public.ai_reservations where tenant_id = '$T' and idempotency_key = 'same-key'")
ATT='[{"attempt_no":1,"role":"primary","provider":"p1","model":"m1","input_tokens":10,"output_tokens":5,"cost_micros":40,"billable":true},{"attempt_no":2,"role":"fallback","provider":"p2","model":"m2","input_tokens":10,"output_tokens":5,"cost_micros":25,"billable":true}]'
for i in $(seq 1 10); do
  ( { as_user; echo "select public.settle_ai_budget('$RID', '$ATT'::jsonb) ->> 'settledMicros';"; } | psql_admin -f - | tail -n1 > "$TMP/t$i" ) &
done
wait
spent=$(psql_admin -c "select spent_micros from public.ai_budget_periods where tenant_id = '$T'")
attempts=$(psql_admin -c "select count(*) from public.ai_usage_attempts where reservation_id = '$RID'")
if [ "$spent" -ne 65 ] || [ "$attempts" -ne 2 ]; then echo "FAIL: spent=$spent (want 65), attempts=$attempts (want 2)"; exit 1; fi
echo "ok: concurrent settlements counted each attempt once (spent 65)"
echo "ai_budget_concurrency: all checks passed"
