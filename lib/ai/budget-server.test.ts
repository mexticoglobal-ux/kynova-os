import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { createAiBudgetServerStore } from "./budget-server";

const RID = "00000000-0000-4000-8000-0000000000c1";
const T = "00000000-0000-4000-8000-0000000000b1";
const U = "00000000-0000-4000-8000-0000000000a1";
const client = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient;

describe("the SERVER's budget store (the only way the AI path records or frees consumption)", () => {
  it("uses the client it is given (the server client) for every function, and names the user the server verified", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, reservationId: RID, periodStart: "2026-11-01", expiresAt: "2026-11-18T12:05:00Z", repeated: false }, error: null });
    const store = createAiBudgetServerStore({}, async () => client(rpc));
    expect(await store.reserve({ tenantId: T, requestedBy: U, purposeId: "message.draft", estimateMicros: 5, idempotencyKey: "k" })).toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("reserve_ai_budget", expect.objectContaining({ p_requested_by: U }));
  });

  it("never throws and never claims a grant: without Supabase or a service key, or when a call fails, the answer is \"could not tell\"", async () => {
    // no configuration at all: the real client cannot be built
    const unconfigured = createAiBudgetServerStore({});
    expect(await unconfigured.reserve({ tenantId: T, requestedBy: U, purposeId: "message.draft", estimateMicros: 5, idempotencyKey: "k" })).toBeNull();
    expect(await unconfigured.settle(RID, [])).toBeNull();
    expect(await unconfigured.release(RID)).toBe(false);
    // a database that fails
    const broken = createAiBudgetServerStore({}, async () => client(vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } })));
    expect(await broken.reserve({ tenantId: T, requestedBy: U, purposeId: "message.draft", estimateMicros: 5, idempotencyKey: "k" })).toBeNull();
    expect(await broken.release(RID)).toBe(false);
  });

  it("reads the service key only through the Secrets Manager (a configured environment without the key is still \"could not tell\")", async () => {
    const vars = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "p".repeat(30) }; // no SUPABASE_SERVICE_ROLE_KEY
    expect(await createAiBudgetServerStore(vars).release(RID)).toBe(false);
  });
});
