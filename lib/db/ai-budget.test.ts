import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createAiBudgetStore } from "./ai-budget";

const RID = "00000000-0000-4000-8000-0000000000c1";
const T = "00000000-0000-4000-8000-0000000000b1";
const client = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient;

describe("the AI budget in the database", () => {
  it("calls the functions of the migration with their own parameter names", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { ok: true, reservationId: RID, periodStart: "2026-11-01", expiresAt: "2026-11-18T12:05:00Z", repeated: false }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, reservationId: RID, settledMicros: 40, overageMicros: 0, repeated: false }, error: null })
      .mockResolvedValueOnce({ data: { ok: true }, error: null });
    const store = createAiBudgetStore(client(rpc));
    expect(await store.reserve({ tenantId: T, purposeId: "message.draft", estimateMicros: 1000, idempotencyKey: "req-1" })).toMatchObject({ ok: true, reservationId: RID });
    expect(rpc).toHaveBeenNthCalledWith(1, "reserve_ai_budget", { p_tenant: T, p_purpose: "message.draft", p_estimate_micros: 1000, p_idempotency_key: "req-1", p_ttl_seconds: 300 });
    const attempts = [{ attempt_no: 1, role: "primary" as const, provider: "p", model: "m", input_tokens: 1, output_tokens: 1, cost_micros: 40, billable: true }];
    expect(await store.settle(RID, attempts)).toMatchObject({ settledMicros: 40 });
    expect(rpc).toHaveBeenNthCalledWith(2, "settle_ai_budget", { p_reservation: RID, p_attempts: attempts });
    expect(await store.release(RID)).toBe(true);
    expect(rpc).toHaveBeenNthCalledWith(3, "release_ai_budget", { p_reservation: RID });
  });

  it("the company is the function's argument, never taken from the client's own claims: another company's id is the database's to refuse", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(createAiBudgetStore(client(rpc)).reserve({ tenantId: T, purposeId: "message.draft", estimateMicros: 1, idempotencyKey: "k" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("an answer that is not the expected shape is null (the budget is then treated as unavailable)", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { surprise: true }, error: null });
    const store = createAiBudgetStore(client(rpc));
    expect(await store.reserve({ tenantId: T, purposeId: "message.draft", estimateMicros: 1, idempotencyKey: "k" })).toBeNull();
    expect(await store.settle(RID, [])).toBeNull();
  });

  it("a database that cannot be reached throws, and nothing is read from it as a grant", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "08006" } });
    await expect(createAiBudgetStore(client(rpc)).reserve({ tenantId: T, purposeId: "message.draft", estimateMicros: 1, idempotencyKey: "k" })).rejects.toMatchObject({ code: "unavailable" });
  });
});
