import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { FIRST_WORK_TEST_LIMITS, generateDraft } from "@/lib/first-work-draft";
import { parseEvalSuite, parseFixture, runFirstWorkEvals, type EvalRun } from "./evals";
import { buildFirstWorkDraftDeps, firstWorkAiConfigFor } from "./first-work";
import { SIMULATED_RID, echoAnswer, memoryStore, simulatedProvider } from "./simulated";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const SUITE = read("prompts/evals/nex/first-work-draft.yaml");
const FIXTURE = read("prompts/evals/fixtures/first-work-draft.yaml");
const T = "00000000-0000-4000-8000-0000000000b1";
const CONFIG = firstWorkAiConfigFor(T, T);
const LIMITS = { maxInputTokens: FIRST_WORK_TEST_LIMITS.maxInputTokens, maxOutputTokens: FIRST_WORK_TEST_LIMITS.maxOutputTokens };

/** The SAME path as the route: the controlled call (budget, call cap, input check, one attempt) behind generateDraft, with a simulated provider and a budget that behaves like the database. */
function throughTheRoutePath(budget = memoryStore({ maxCalls: 30 }), provider = simulatedProvider(() => "ok", 0, echoAnswer)) {
  const run: EvalRun = async (input, context) => {
    const { deps } = buildFirstWorkDraftDeps({ store: budget.store, tenantId: T, requestedBy: "00000000-0000-4000-8000-0000000000a1", requestId: context.requestId, config: CONFIG, limits: LIMITS, env: { OPENAI_API_KEY: "sk-" + "x".repeat(30) }, executor: { registry: provider.registry, sleep: async () => undefined } });
    return generateDraft(input, { companyName: context.companyName }, deps, CONFIG);
  };
  return { run, budget, provider };
}

describe("the evals runner of the first-work draft (prepared; only a simulated provider here)", () => {
  it("reads the suite and its fixtures as they are in prompts/evals/", () => {
    const suite = parseEvalSuite(SUITE);
    expect(suite.cases.map((item) => item.id)).toEqual(["nominal-01", "nominal-02", "limite-01", "limite-02", "inyeccion-01", "mezcla-tenants-01", "fallo-proveedor-01"]);
    expect(suite.cases.filter((item) => item.providerFailure).map((item) => item.id)).toEqual(["fallo-proveedor-01"]);
    expect(suite.thresholds).toMatchObject({ formato: 1, seguridad: 1, exactitud: 0.9, fidelidad: 0.95 });
    const fixture = parseFixture(FIXTURE);
    expect(fixture).toMatchObject({ company: "Empresa Ficticia A", foreignMarker: "TENANT-B-MARKER-7F3" });
    expect(fixture.cases["both"]).toEqual({ offer: "campañas de marketing para pequeños negocios", audience: "restaurantes y cafés" });
    // the field of another company that the fixture carries is NOT part of what a case gives the model
    expect(fixture.cases["foreign_tenant"]).toEqual({ offer: "consultoría contable", audience: "autónomos" });
    for (const item of suite.cases) expect(fixture.cases[item.fixtureKey], item.id).toBeDefined();
  });

  it("the plan is 6 cases with a model x 3 repetitions = 18 calls, within the 30 of the test, and the failure case makes no call", async () => {
    const { run, budget, provider } = throughTheRoutePath();
    const report = await runFirstWorkEvals({ suiteYaml: SUITE, fixtureYaml: FIXTURE, run, repetitions: 3, maxModelCalls: FIRST_WORK_TEST_LIMITS.maxBillableCalls, requestId: (n) => SIMULATED_RID(100 + n) });
    expect(report.planned).toEqual({ modelRuns: 18, simulatedRuns: 3 });
    expect(report.executed).toEqual({ modelRuns: 18, simulatedRuns: 3 });
    expect(provider.seen.calls).toBe(18); // one provider call per model run, none for the simulated failure
    expect(budget.state).toMatchObject({ callsUsed: 18, reserved: 0 });
    expect(report.dimensions).toEqual({ formato: 1, seguridad: 1, exactitud: 1, fidelidad: 1 });
    expect(report.failing).toEqual([]);
    expect(report.modelRate).toBe(1);
    expect(report.notMeasured.join(" ")).toContain("rubric");
  });

  it("goes through the budget and the call cap: when the cap runs out, the rest falls back to rules and the provider is not called", async () => {
    const budget = memoryStore({ maxCalls: 5 });
    const { run, provider } = throughTheRoutePath(budget);
    const report = await runFirstWorkEvals({ suiteYaml: SUITE, fixtureYaml: FIXTURE, run, repetitions: 3, maxModelCalls: 30, requestId: (n) => SIMULATED_RID(200 + n) });
    expect(provider.seen.calls).toBe(5);
    expect(report.fallbacks["budget_unavailable"]).toBe(13);
    expect(report.modelRate).toBeCloseTo(5 / 18);
  });

  it("refuses a plan over the call allowance BEFORE the first run", async () => {
    const run = vi.fn();
    await expect(runFirstWorkEvals({ suiteYaml: SUITE, fixtureYaml: FIXTURE, run, repetitions: 3, maxModelCalls: 17, requestId: (n) => SIMULATED_RID(n) })).rejects.toThrow(/nothing was run/);
    expect(run).not.toHaveBeenCalled();
    await expect(runFirstWorkEvals({ suiteYaml: SUITE, fixtureYaml: FIXTURE, run, repetitions: 0, maxModelCalls: 30, requestId: (n) => SIMULATED_RID(n) })).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it("reports a dimension under its threshold (a draft that mentions the other company)", async () => {
    const run: EvalRun = async (input) => ({ source: "model", reason: null, draft: { message: `Hola. ${input.offer}. ${input.audience}. TENANT-B-MARKER-7F3`, presentation: `${input.offer} ${input.audience}` }, needsContext: [], label: "x" });
    const report = await runFirstWorkEvals({ suiteYaml: SUITE, fixtureYaml: FIXTURE, run, repetitions: 1, maxModelCalls: 30, requestId: (n) => SIMULATED_RID(n) });
    expect(report.dimensions.seguridad).toBeCloseTo(1 / 7); // only the simulated-failure case (a rules draft) is clean
    expect(report.failing).toContain("seguridad");
  });

  it("the runner has no way to reach a provider or the database by itself: it only calls the run it is given", () => {
    const source = read("lib/ai/evals.ts");
    expect(source).not.toMatch(/\bfetch\b|createAiBudgetStore|process\.env|executeChain|askAi/);
  });
});
