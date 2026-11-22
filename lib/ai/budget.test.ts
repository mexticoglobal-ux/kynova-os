import { describe, expect, it, vi } from "vitest";
import { parseReserveOutcome, parseSettleOutcome, type BudgetStore, type ReserveOutcome } from "@/lib/contracts/ai-budget";
import type { GatewayLimits } from "@/lib/contracts/platform/ai-limits";
import type { NativeModel } from "./providers";
import type { AttemptEvent } from "./executor";
import { BILLING_POLICY, createBudgetGate, rowsFromAttempts, treatmentOf, worstCaseMicros } from "./budget";

const RID = "00000000-0000-4000-8000-0000000000c1";
const limits = { retry: { maxAttempts: 2, backoffMs: [0] } } as unknown as GatewayLimits;
const natives: Record<string, NativeModel> = {
  m1: { provider: "p1", model: "n1", chat: true, inputMicrosPerM: 1_000_000, outputMicrosPerM: 2_000_000 },
  m2: { provider: "p2", model: "n2", chat: true, inputMicrosPerM: 3_000_000, outputMicrosPerM: 6_000_000 },
  embed: { provider: "p3", model: "n3", chat: false, inputMicrosPerM: 0, outputMicrosPerM: 0 },
};
const call = { inputTokens: 1000, maxOutputTokens: 500 };
const ev = (over: Partial<AttemptEvent>): AttemptEvent => ({ providerId: "p1", modelId: "m1", outcome: "ok", latencyMs: 5, ...over });

describe("what to reserve: the worst case, retries and fallbacks included", () => {
  it("adds every chat model of the chain, each as many times as the Gateway may try it", () => {
    // m1: (1000*1 + 500*2) = 2000 per try; m2: (1000*3 + 500*6) = 6000 per try; 2 tries each; the embedding model is not a chat model and adds nothing
    expect(worstCaseMicros({ models: ["m1", "m2", "embed"], priority: "normal", limits, inputTokens: 1000, maxOutputTokens: 500 }, natives)).toBe(2 * 2000 + 2 * 6000);
  });

  it("a low priority is tried once; an empty or unknown chain still reserves at least 1", () => {
    expect(worstCaseMicros({ models: ["m1"], priority: "low", limits, inputTokens: 1000, maxOutputTokens: 500 }, natives)).toBe(2000);
    expect(worstCaseMicros({ models: [], priority: "normal", limits, inputTokens: 1000, maxOutputTokens: 500 }, natives)).toBe(1);
    expect(worstCaseMicros({ models: ["nope"], priority: "normal", limits, inputTokens: 1000, maxOutputTokens: 500 }, natives)).toBe(1);
  });
});

describe("what counts as billed", () => {
  it("counts a success by its real tokens, a possibly-processed failure at its worst case, and a rejection as nothing", () => {
    expect(treatmentOf(ev({ outcome: "ok" }))).toBe("actual");
    for (const kind of ["timeout", "network", "server"] as const) expect(treatmentOf(ev({ outcome: "down", errorKind: kind })), kind).toBe("worst_case");
    for (const kind of ["rateLimited", "auth", "badRequest", "notConfigured"] as const) expect(treatmentOf(ev({ outcome: "down", errorKind: kind })), kind).toBe("none");
    expect(treatmentOf(ev({ outcome: "skipped" }))).toBe("none");
    // an outcome nobody wrote down is never assumed free
    expect(treatmentOf(ev({ outcome: "down", errorKind: "somethingNew" as never }))).toBe("worst_case");
    expect(BILLING_POLICY.timeout).toBe("worst_case");
  });

  it("turns the executor's attempts into rows: roles, billable flags and costs, retries and fallbacks included, skipped ones left out", () => {
    const { rows, unpriced } = rowsFromAttempts(
      [
        ev({ outcome: "timeout", errorKind: "timeout" }),
        ev({ outcome: "skipped", providerId: "p9", modelId: "m9" }),
        ev({ outcome: "rateLimited", errorKind: "rateLimited" }),
        ev({ providerId: "p2", modelId: "m2", outcome: "ok", inputTokens: 900, outputTokens: 100 }),
      ],
      call,
      natives,
    );
    expect(unpriced).toEqual([]);
    expect(rows).toEqual([
      { attempt_no: 1, role: "primary", provider: "p1", model: "m1", input_tokens: 1000, output_tokens: 500, cost_micros: 2000, billable: true },
      { attempt_no: 2, role: "retry", provider: "p1", model: "m1", input_tokens: 0, output_tokens: 0, cost_micros: 0, billable: false },
      { attempt_no: 3, role: "fallback", provider: "p2", model: "m2", input_tokens: 900, output_tokens: 100, cost_micros: 3300, billable: true },
    ]);
    expect(rows.filter((row) => row.billable).reduce((sum, row) => sum + row.cost_micros, 0)).toBe(5300);
  });

  it("says which billable attempts had no price, and never sends more than 20", () => {
    expect(rowsFromAttempts([ev({ modelId: "ghost" })], call, natives).unpriced).toEqual(["ghost"]);
    const many = Array.from({ length: 30 }, () => ev({ outcome: "timeout", errorKind: "timeout" }));
    expect(rowsFromAttempts(many, call, natives).rows).toHaveLength(20);
  });
});

function store(over: Partial<BudgetStore> = {}): BudgetStore & { reserve: ReturnType<typeof vi.fn>; settle: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> } {
  const granted: ReserveOutcome = { ok: true, reservationId: RID, periodStart: "2026-11-01", expiresAt: "2026-11-18T12:05:00.000Z", repeated: false };
  return { reserve: vi.fn().mockResolvedValue(granted), settle: vi.fn().mockResolvedValue({ ok: true, reservationId: RID, settledMicros: 5300, overageMicros: 0, repeated: false }), release: vi.fn().mockResolvedValue(true), ...over } as never;
}
const params = { tenantId: "t1", requestedBy: "u1", purposeId: "message.draft", idempotencyKey: "req-1", estimateMicros: 16000 };

describe("the budget gate of one call", () => {
  it("is granted only when the store grants it, and passes the request's own idempotency key and estimate", async () => {
    const s = store();
    const gate = createBudgetGate(s, params);
    expect(await gate.reserve()).toBe(true);
    expect(gate.reservationId).toBe(RID);
    expect(s.reserve).toHaveBeenCalledWith({ tenantId: "t1", requestedBy: "u1", purposeId: "message.draft", estimateMicros: 16000, idempotencyKey: "req-1" });
  });

  it("every refusal is false, with its reason, and no reservation id: nothing may be sent to a provider", async () => {
    for (const reason of ["no_budget", "budget_exceeded", "call_limit_reached", "already_closed"] as const) {
      const gate = createBudgetGate(store({ reserve: vi.fn().mockResolvedValue({ ok: false, reason }) }), params);
      expect(await gate.reserve(), reason).toBe(false);
      expect(gate.refusal).toBe(reason);
      expect(gate.reservationId).toBeUndefined();
    }
  });

  it("a store that fails or answers nothing is 'unavailable', also false", async () => {
    for (const reserve of [vi.fn().mockRejectedValue(new Error("db down")), vi.fn().mockResolvedValue(null)]) {
      const gate = createBudgetGate(store({ reserve }), params);
      expect(await gate.reserve()).toBe(false);
      expect(gate.refusal).toBe("unavailable");
    }
  });

  it("settles with every attempt of the call, retries and fallbacks included", async () => {
    const s = store();
    const gate = createBudgetGate(s, params);
    await gate.reserve();
    const outcome = await gate.settle([ev({ outcome: "timeout", errorKind: "timeout" }), ev({ providerId: "p2", modelId: "m2", inputTokens: 900, outputTokens: 100 })], call);
    expect(outcome?.settledMicros).toBe(5300);
    const rows = s.settle.mock.calls[0]?.[1] as { role: string; billable: boolean }[];
    expect(s.settle.mock.calls[0]?.[0]).toBe(RID);
    expect(rows.map((row) => row.role)).toEqual(["primary", "fallback"]);
    expect(rows.every((row) => row.billable)).toBe(true);
  });

  it("cannot settle or release what was never reserved, and a failing store does not throw into the caller", async () => {
    const s = store();
    const gate = createBudgetGate(s, params);
    expect(await gate.settle([], call)).toBeNull();
    expect(await gate.release()).toBe(false);
    expect(s.settle).not.toHaveBeenCalled();
    const failing = createBudgetGate(store({ settle: vi.fn().mockRejectedValue(new Error("x")), release: vi.fn().mockRejectedValue(new Error("x")) }), params);
    await failing.reserve();
    expect(await failing.settle([ev({})], call)).toBeNull();
    expect(await failing.release()).toBe(false);
  });
});

describe("what the database answers is checked before it is believed", () => {
  it("accepts the expected shapes and nothing else", () => {
    expect(parseReserveOutcome({ ok: true, reservationId: RID, periodStart: "2026-11-01", expiresAt: "2026-11-18T12:05:00Z", repeated: false })).toMatchObject({ ok: true, reservationId: RID });
    expect(parseReserveOutcome({ ok: false, reason: "no_budget" })).toEqual({ ok: false, reason: "no_budget" });
    for (const bad of [null, "x", {}, { ok: true }, { ok: true, reservationId: "nope", periodStart: "a", expiresAt: "b" }, { ok: false, reason: "because" }]) expect(parseReserveOutcome(bad)).toBeNull();
    expect(parseSettleOutcome({ ok: true, reservationId: RID, settledMicros: 5, overageMicros: 0 })).toMatchObject({ settledMicros: 5, repeated: false });
    for (const bad of [null, { ok: true, reservationId: RID, settledMicros: -1, overageMicros: 0 }, { ok: true, reservationId: RID, settledMicros: 1.5, overageMicros: 0 }, { ok: false }]) expect(parseSettleOutcome(bad)).toBeNull();
  });
});
