import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The migration cannot be executed here (no Postgres): CI runs it with supabase/tests/ai_budget.sql and ai_budget_concurrency.sh. These checks read its text and keep the
// properties that must not be lost in a later edit: RLS, privileges, atomic reservation, idempotency, billable attempts, and an expiry that never frees room.
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const sql = read("supabase/migrations/20261118000100_ai_budget.sql");
const body = (name: string) => {
  const start = sql.indexOf(`create function public.${name}`);
  expect(start, name).toBeGreaterThan(-1);
  return sql.slice(start, sql.indexOf("\n$$;", start));
};
const code = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");

describe("AI budget migration (not applied)", () => {
  it("says it is not applied and how to undo it", () => {
    expect(sql).toContain("NOT APPLIED to any remote project");
    expect(sql).toContain("Reversal plan");
  });

  it("creates the three tables with RLS, no direct writes and read for owners and admins only", () => {
    for (const table of ["ai_budget_periods", "ai_reservations", "ai_usage_attempts"]) {
      expect(code, table).toContain(`create table public.${table} (`);
      expect(code, table).toContain(`alter table public.${table} enable row level security;`);
      expect(code, `${table} select policy`).toMatch(new RegExp(`create policy ${table}_select on public\\.${table}\\n  for select to authenticated using \\(\\(select private\\.is_admin\\(tenant_id\\)\\)\\);`));
    }
    expect(code).toContain("revoke all on table public.ai_budget_periods, public.ai_reservations, public.ai_usage_attempts from public, anon, authenticated, service_role;");
    expect(code).toContain("grant select on table public.ai_budget_periods, public.ai_reservations, public.ai_usage_attempts to authenticated;");
    expect(code).not.toMatch(/grant (insert|update|delete|all)/i);
    expect(code).not.toMatch(/to anon/i);
  });

  it("every function is security definer with an empty search_path, and only the right roles can run them", () => {
    const functions = [...code.matchAll(/create function (public|private)\.(\w+)/g)];
    expect(functions.map((match) => match[2])).toEqual(["ai_budget_period", "reserve_ai_budget", "settle_ai_budget", "release_ai_budget", "write_off_ai_reservation", "assign_ai_budget", "assign_ai_call_cap", "expire_ai_reservations"]);
    for (const name of ["reserve_ai_budget", "settle_ai_budget", "release_ai_budget", "write_off_ai_reservation", "assign_ai_budget", "assign_ai_call_cap", "expire_ai_reservations"]) {
      expect(body(name), name).toMatch(/security definer\nset search_path = ''/);
    }
    expect(code).toMatch(/grant execute on function public\.reserve_ai_budget\(uuid, text, bigint, text, int\), public\.settle_ai_budget\(uuid, jsonb\), public\.release_ai_budget\(uuid\), public\.write_off_ai_reservation\(uuid, text\) to authenticated;/);
    // a company never assigns its own budget, nor runs the expiry: only the server key does
    expect(code).toMatch(/grant execute on function public\.assign_ai_budget\(uuid, date, bigint\), public\.assign_ai_call_cap\(uuid, date, int\), public\.expire_ai_reservations\(\) to service_role;/);
    expect(code.match(/grant execute[^;]*to authenticated;/g)?.length).toBe(1);
    expect(code.match(/grant execute[^;]*to service_role;/g)?.length).toBe(1);
  });

  it("works in UTC months and starts every company at 0 (no seed, no plan, no price, no amount)", () => {
    expect(code).toContain("date_trunc('month', now() at time zone 'utc')::date");
    expect(code).toContain("'no_budget'");
    expect(code.match(/insert into public\.ai_budget_periods/g)?.length).toBe(1); // only inside assign_ai_budget
    expect(body("assign_ai_budget")).toContain("insert into public.ai_budget_periods");
    expect(code).not.toMatch(/\b(plan|price|precio|usd)\b/i);
  });

  it("reserves atomically against the limit and never twice for the same key", () => {
    const reserve = body("reserve_ai_budget");
    expect(reserve).toContain("reserved_micros + unreconciled_micros + spent_micros + p_estimate_micros <= limit_micros");
    expect(reserve.match(/update public\.ai_budget_periods/g)?.length).toBe(1);
    expect(reserve).toContain("on conflict (tenant_id, idempotency_key) do nothing");
    expect(reserve).toContain("perform private.require_write(p_tenant)");
    expect(code).toContain("unique (tenant_id, idempotency_key)");
  });

  it("counts every billable attempt once, from what is stored", () => {
    const settle = body("settle_ai_budget");
    expect(settle).toContain("on conflict (reservation_id, attempt_no) do nothing");
    expect(settle).toContain("sum(cost_micros) filter (where billable)");
    expect(settle).toContain("from public.ai_usage_attempts where reservation_id = r.id");
    expect(settle).toContain("for update");
    expect(settle).toContain("jsonb_array_length(p_attempts) > 20");
    expect(code).toContain("create trigger ai_usage_attempts_append_only before update or delete on public.ai_usage_attempts");
  });

  it("an expired reservation never frees room: it only moves to unreconciled, and leaves it by settlement or a written-off decision", () => {
    const expire = body("expire_ai_reservations");
    expect(expire).toContain("unreconciled_micros = unreconciled_micros + r.amount_micros");
    expect(expire).toContain("reserved_micros = reserved_micros - r.amount_micros");
    expect(expire).not.toContain("spent_micros");
    expect(expire).not.toMatch(/'released'|limit_micros/);
    expect(body("release_ai_budget")).toContain("only a held reservation can be released");
    expect(body("settle_ai_budget")).toContain("reconciling an expired reservation needs the attempts the provider reported");
    const writeOff = body("write_off_ai_reservation");
    expect(writeOff).toContain("perform private.require_admin(r.tenant_id)");
    expect(writeOff).toContain("char_length(btrim(p_note)) not between 10 and 500");
    expect(writeOff).toContain("private.log_action");
  });

  it("the cap of calls is checked in the same atomic UPDATE as the money, returned only by a release and never freed by the expiry", () => {
    const reserve = body("reserve_ai_budget");
    expect(reserve).toContain("and (max_calls is null or calls_used < max_calls)");
    expect(reserve).toContain("calls_used = calls_used + 1");
    expect(reserve).toContain("'call_limit_reached'");
    expect(body("release_ai_budget")).toContain("calls_used = greatest(0, calls_used - 1)");
    expect(body("settle_ai_budget")).toContain("calls_used = calls_used + greatest(0, v_billable - 1)");
    expect(body("expire_ai_reservations")).not.toContain("calls_used");
    expect(body("write_off_ai_reservation")).not.toContain("calls_used");
    expect(body("assign_ai_call_cap")).toContain("calls_used <= p_max_calls");
    expect(code).toContain("max_calls int check (max_calls is null or max_calls >= 0)");
    expect(code.match(/set max_calls = p_max_calls/g)?.length).toBe(1); // only the platform function writes the cap
  });

  it("the CI runs its SQL and concurrency tests", () => {
    const workflow = read(".github/workflows/rls-isolation.yml");
    expect(workflow).toContain("supabase/tests/ai_budget.sql");
    expect(workflow).toContain("supabase/tests/ai_budget_concurrency.sh");
    expect(read("supabase/tests/ai_budget_concurrency.sh")).toContain("EXACTLY 10 are granted");
    expect(read("supabase/tests/ai_budget_concurrency.sh")).toContain("EXACTLY 30 are granted");
    expect(read("supabase/tests/ai_budget.sql")).toContain("the 4th call was not refused by the cap");
    expect(read("supabase/tests/ai_budget.sql")).toContain("the expiry freed room");
  });
});
