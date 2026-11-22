import { describe, expect, it } from "vitest";
import { GATEWAY_LIMIT_DEFAULTS } from "@/lib/contracts/platform/ai-limits";
import type { GatewayRequest } from "@/lib/contracts/platform/gateway-engine";
import { FIRST_WORK_TEST_LIMITS, generateDraft } from "@/lib/first-work-draft";
import { MemorySecretsProvider, SecretsManager } from "@/lib/backend/secrets";
import { reservationMicros } from "./controlled-call";
import { executeChain } from "./executor";
import { buildFirstWorkDraftDeps, firstWorkAiConfigFor } from "./first-work";
import { chatInputTokenBound } from "./input-bound";
import { NATIVE_MODELS, costOfNative } from "./providers";
import { SIMULATED_RID, SIMULATED_PHRASES, memoryStore, simulatedProvider } from "./simulated";

const T = "00000000-0000-4000-8000-0000000000b1";
const RID = SIMULATED_RID;
const PHRASES = SIMULATED_PHRASES;
const CONFIG = firstWorkAiConfigFor(T, T); // the test switch names this company
const LIMITS: { maxInputTokens: number; maxOutputTokens: number } = { maxInputTokens: FIRST_WORK_TEST_LIMITS.maxInputTokens, maxOutputTokens: FIRST_WORK_TEST_LIMITS.maxOutputTokens };

const draftThrough = async (budget: ReturnType<typeof memoryStore>, provider: ReturnType<typeof simulatedProvider>, requestId: string, over: { env?: Record<string, string>; limits?: typeof LIMITS } = {}) => {
  const { deps, controlled } = buildFirstWorkDraftDeps({
    store: budget.store, tenantId: T, requestId, config: CONFIG, limits: over.limits ?? LIMITS,
    env: over.env ?? { OPENAI_API_KEY: "sk-" + "x".repeat(30) },
    executor: { registry: provider.registry, sleep: async () => undefined },
  });
  const result = await generateDraft(PHRASES, { companyName: "Nova Marketing Studio" }, deps, CONFIG);
  return { result, report: controlled.report() };
};

describe("one controlled call, with a simulated provider", () => {
  it("a granted reservation, ONE provider attempt, settled with the provider's own tokens: the draft is the model's", async () => {
    const budget = memoryStore();
    const provider = simulatedProvider();
    const { result, report } = await draftThrough(budget, provider, RID(900));
    expect(result).toMatchObject({ source: "model", reason: null });
    expect(provider.seen.calls).toBe(1);
    expect(report).toMatchObject({ reservation: "settled", providerCalls: 1 });
    const native = NATIVE_MODELS["gw-fast-1"];
    if (!native) throw new Error("registry");
    expect(report.settledMicros).toBe(costOfNative(native, 700, 350)); // what the provider reported, not the reserved worst case
    expect(budget.state).toMatchObject({ reserved: 0, spent: costOfNative(native, 700, 350), callsUsed: 1 });
    expect(provider.seen.prompts[0]?.user).toContain("<<<QUE_OFRECE"); // the person's words go only as delimited data
  });

  it("the money reserved covers the input bound plus the full output cap at the model's price, with NO multiplier: an estimated cover for the input, not a claimed maximum", async () => {
    const budget = memoryStore();
    const provider = simulatedProvider();
    const { report } = await draftThrough(budget, provider, RID(901));
    const native = NATIVE_MODELS["gw-fast-1"];
    if (!native) throw new Error("registry");
    const sentBound = chatInputTokenBound(provider.seen.prompts[0] as { system: string; user: string });
    expect(report.reservedMicros).toBe(reservationMicros(native, sentBound, LIMITS.maxOutputTokens));
    expect(report.reservedMicros).toBe(costOfNative(native, sentBound, LIMITS.maxOutputTokens)); // exactly the cover of the bound and the output cap: nothing multiplied
    expect(report.inputOverBound).toBe(false); // the provider counted fewer input tokens (700) than the bound
  });

  it("a call without a reservation never reaches the provider: no budget assigned, exhausted money, exhausted call cap", async () => {
    const provider = simulatedProvider();
    for (const [label, options] of [["no budget", { limit: null }], ["money", { limit: 10 }], ["cap", { maxCalls: 0 }]] as const) {
      const budget = memoryStore(options);
      const { result, report } = await draftThrough(budget, provider, RID(910));
      expect(result, label).toMatchObject({ source: "rules", reason: "budget_unavailable" });
      expect(report.reservation, label).toBe("none");
      expect(budget.calls.settle + budget.calls.release, label).toBe(0);
    }
    expect(provider.seen.calls).toBe(0);
  });

  it("the call cap: 30 are made, the 31st is refused BEFORE calling the provider", async () => {
    const budget = memoryStore({ maxCalls: 30 });
    const provider = simulatedProvider();
    for (let n = 1; n <= 30; n += 1) expect((await draftThrough(budget, provider, RID(1000 + n))).result.source).toBe("model");
    const last = await draftThrough(budget, provider, RID(1031));
    expect(last.result).toMatchObject({ source: "rules", reason: "budget_unavailable" });
    expect(last.report.refusal).toBe("call_limit_reached");
    expect(provider.seen.calls).toBe(30);
    expect(budget.state.callsUsed).toBe(30);
  });

  it("concurrency: 40 requests at once against a cap of 30 make exactly 30 provider calls and settle each once", async () => {
    const budget = memoryStore({ maxCalls: 30 });
    const provider = simulatedProvider(() => "ok", 5);
    const results = await Promise.all(Array.from({ length: 40 }, (_, n) => draftThrough(budget, provider, RID(2000 + n))));
    expect(results.filter((entry) => entry.result.source === "model")).toHaveLength(30);
    expect(results.filter((entry) => entry.result.reason === "budget_unavailable")).toHaveLength(10);
    expect(provider.seen.calls).toBe(30);
    expect(budget.state).toMatchObject({ callsUsed: 30, reserved: 0 });
    expect([...budget.rows.values()].filter((row) => row.status === "settled")).toHaveLength(30);
  });

  it("idempotency: the same request id never makes a second call, even when sent twice at once", async () => {
    const budget = memoryStore();
    const provider = simulatedProvider();
    const [first, second] = await Promise.all([draftThrough(budget, provider, RID(3000)), draftThrough(budget, provider, RID(3000))]);
    const sources = [first.result.source, second.result.source].sort();
    expect(sources).toEqual(["model", "rules"]);
    expect([first, second].find((entry) => entry.result.source === "rules")?.report.refusal).toBe("repeated");
    expect(provider.seen.calls).toBe(1);
    expect(budget.state.callsUsed).toBe(1);
    // and sent again later, after it finished
    expect((await draftThrough(budget, provider, RID(3000))).result.source).toBe("rules");
    expect(provider.seen.calls).toBe(1);
  });

  it("an uncertain failure (timeout, server error, unreadable answer) is NEVER released or settled on a guess: the reservation stays held for reconciliation", async () => {
    for (const behavior of ["timeout", "server", "badtext"] as const) {
      const budget = memoryStore();
      const provider = simulatedProvider([behavior]);
      const { result, report } = await draftThrough(budget, provider, RID(4000));
      expect(result.source, behavior).toBe("rules");
      if (behavior === "badtext") {
        // the provider ANSWERED and was billed: it is settled with its own tokens, and the draft falls back because the text is not valid
        expect(result.reason).toBe("invalid_output");
        expect(report.reservation).toBe("settled");
      } else {
        expect(result.reason, behavior).toBe("provider_error");
        expect(report, behavior).toMatchObject({ reservation: "pending", providerCalls: 1 });
        expect(budget.calls.release + budget.calls.settle, behavior).toBe(0);
        expect(budget.state.reserved, behavior).toBeGreaterThan(0); // still counting against the money
        expect(budget.state.callsUsed, behavior).toBe(1); // and against the cap
      }
      expect(provider.seen.calls, behavior).toBe(1); // no retry
    }
  });

  it("ONE real attempt: a failure is not retried and there is no other model to fall back to", async () => {
    const budget = memoryStore();
    const provider = simulatedProvider(["server", "ok", "ok"]);
    const { result } = await draftThrough(budget, provider, RID(4100));
    expect(result).toMatchObject({ source: "rules", reason: "provider_error" });
    expect(provider.seen.calls).toBe(1);
  });

  it("a rejection the provider answered before processing (rate limit, bad key) settles at no charge, and the call still counts", async () => {
    for (const behavior of ["rateLimited", "auth"] as const) {
      const budget = memoryStore();
      const provider = simulatedProvider([behavior]);
      const { result, report } = await draftThrough(budget, provider, RID(4200));
      expect(result.reason, behavior).toBe("provider_error");
      expect(report, behavior).toMatchObject({ reservation: "settled_no_charge", settledMicros: 0 });
      expect(budget.state, behavior).toMatchObject({ reserved: 0, spent: 0, callsUsed: 1 });
    }
  });

  it("a reservation is released only when NOTHING was sent: a missing key and a prompt over the limit", async () => {
    // no provider key: the executor skips the provider, nothing is sent
    const noKey = memoryStore();
    const none = simulatedProvider();
    const a = await draftThrough(noKey, none, RID(4300), { env: {} });
    expect(a.result).toMatchObject({ source: "rules", reason: "provider_error" });
    expect(a.report.reservation).toBe("released");
    expect(none.seen.calls).toBe(0);
    expect(noKey.state).toMatchObject({ reserved: 0, callsUsed: 0 }); // the slot came back
    // over the input limit: it is not even reserved
    const over = memoryStore();
    const b = await draftThrough(over, none, RID(4301), { limits: { ...LIMITS, maxInputTokens: 100 } });
    expect(b.result).toMatchObject({ source: "rules", reason: "not_configured" });
    expect(over.calls.reserve).toBe(0);
    expect(none.seen.calls).toBe(0);
  });

  it("a settlement that cannot be recorded leaves the reservation pending, never released", async () => {
    const budget = memoryStore({ failSettle: true });
    const provider = simulatedProvider();
    const { report } = await draftThrough(budget, provider, RID(4400));
    expect(report.reservation).toBe("pending");
    expect(budget.calls.release).toBe(0);
    expect(budget.state.callsUsed).toBe(1);
  });

  it("when the provider counts MORE input tokens than the bound, the report says so and the real cost is settled above the reservation (never hidden)", async () => {
    const budget = memoryStore();
    const provider = simulatedProvider();
    const original = provider.adapter.complete.bind(provider.adapter);
    provider.adapter.complete = async (call) => ({ ...(await original(call)), usage: { inputTokens: 9_000, outputTokens: 350 } }); // far above the bound
    const { result, report } = await draftThrough(budget, provider, RID(4490));
    expect(result.source).toBe("model");
    expect(report.inputOverBound).toBe(true);
    expect(report.reservation).toBe("settled");
    expect(report.settledMicros ?? 0).toBeGreaterThan(report.reservedMicros ?? 0);
  });

  it("an answer without a token report is settled at the reserved worst case (it was billed, the amount is unknown)", async () => {
    const budget = memoryStore();
    const provider = simulatedProvider(["nousage"]);
    const { report } = await draftThrough(budget, provider, RID(4500));
    expect(report.reservation).toBe("settled");
    expect(report.settledMicros).toBeGreaterThan(0);
    expect(report.settledMicros).toBeLessThanOrEqual(report.reservedMicros ?? 0);
  });

  it("the executor refuses a second provider call BEFORE starting it, whatever the request's limits and models are", async () => {
    const provider = simulatedProvider(["server", "ok", "ok"]);
    const request: GatewayRequest = {
      requestId: "r", tenantId: T, at: "2026-11-21T12:00:00.000Z", models: ["gw-fast-1", "gw-balanced-1"], priority: "critical", maxTimeMs: 1_000, inputTokens: 100, maxOutputTokens: 100,
      limits: { ...GATEWAY_LIMIT_DEFAULTS, retry: { maxAttempts: 4, backoffMs: [0] } }, promptHash: "h",
    };
    const secrets = new SecretsManager(new MemorySecretsProvider({ OPENAI_API_KEY: "sk-" + "x".repeat(30), GEMINI_API_KEY: "g".repeat(30) }));
    const { outcome } = await executeChain(request, { system: "a", user: "b" }, { secrets, registry: provider.registry, sleep: async () => undefined, maxProviderCalls: 1 });
    expect(provider.seen.calls).toBe(1);
    expect(outcome.status).toBe("failed");
  });
});
