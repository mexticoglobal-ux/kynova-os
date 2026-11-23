import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { REAL_CONFIRMATION, evalRequestId, runEvalsCli } from "./evals-cli";
import { SIMULATED_RID, echoAnswer, memoryStore, simulatedProvider } from "./simulated";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const SUITE = read("prompts/evals/nex/first-work-draft.yaml");
const FIXTURE = read("prompts/evals/fixtures/first-work-draft.yaml");
const T = "00000000-0000-4000-8000-0000000000b1";
const USER = "00000000-0000-4000-8000-0000000000a1";
const RUN = "00000000-0000-4000-8000-000000000000";
// values that are obviously not real (they look like nothing); the tests check that none of them is ever printed
const SECRETS = { OPENAI_API_KEY: "key-openai-" + "x".repeat(20), SUPABASE_SERVICE_ROLE_KEY: "key-service-" + "y".repeat(20), SUPABASE_PUBLISHABLE_KEY: "key-publishable-" + "z".repeat(20) };
const FULL_ENV = { NEX_AI_FIRST_TEST_TENANT: T, KYNOVA_EVALS_USER_ID: USER, SUPABASE_URL: "https://example.supabase.co", ...SECRETS, [REAL_CONFIRMATION.name]: REAL_CONFIRMATION.value };

const capture = () => { const out: string[] = []; const err: string[] = []; return { out, err, io: { out: (line: string) => out.push(line), err: (line: string) => err.push(line) } }; };
const run = (argv: string[], env: Record<string, string>, deps?: Parameters<typeof runEvalsCli>[0]["deps"]) => {
  const c = capture();
  return runEvalsCli({ argv, env, suiteYaml: SUITE, fixtureYaml: FIXTURE, io: c.io, ...(deps ? { deps } : {}) }).then((code) => ({ code, out: c.out.join("\n"), err: c.err.join("\n") }));
};

afterEach(() => vi.restoreAllMocks());

describe("the evals command", () => {
  it("is a DRY-RUN by default: it validates, shows the plan (18 real calls, 3 simulated) and makes no network call, even with every variable set", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await run([], FULL_ENV);
    expect(result.code).toBe(0);
    expect(result.out).toContain("DRY-RUN");
    expect(result.out).toContain("18 llamadas reales + 3 ejecuciones simuladas");
    expect(result.out).toContain("30 llamadas en total");
    expect(result.out).toContain("ESTIMACIÓN");
    expect(result.out).toContain("simulado (sin proveedor)");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("never prints a value of the environment, in any mode or failure", async () => {
    const secrets = Object.values(SECRETS);
    for (const [argv, env] of [[[], FULL_ENV], [["--real"], FULL_ENV], [["--real"], { ...FULL_ENV, [REAL_CONFIRMATION.name]: "" }], [["--real"], { OPENAI_API_KEY: SECRETS.OPENAI_API_KEY }]] as const) {
      const text = Object.values(await run([...argv], { ...env }, { store: memoryStore().store, executor: { registry: simulatedProvider().registry } })).join("\n");
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
  });

  it("validates the arguments and the plan before anything: a bad flag, too many repetitions (more than 30 calls) or a bad run id ends with nothing run", async () => {
    expect((await run(["--nope"], {})).code).toBe(2);
    expect((await run(["--repetitions", "0"], {})).code).toBe(2);
    const tooMany = await run(["--repetitions", "6"], FULL_ENV); // 6 cases x 6 = 36 > 30
    expect(tooMany.code).toBe(2);
    expect(tooMany.err).toContain("nothing was run");
    expect((await run(["--real", "--run-id", "no-es-uuid"], FULL_ENV)).code).toBe(2);
  });

  it("the real mode needs the explicit confirmation, and says exactly what is missing, before any call", async () => {
    const provider = simulatedProvider();
    const budget = memoryStore();
    const deps = { store: budget.store, executor: { registry: provider.registry } };
    const noConfirm = await run(["--real"], { ...FULL_ENV, [REAL_CONFIRMATION.name]: "yes" }, deps);
    expect(noConfirm.code).toBe(2);
    expect(noConfirm.err).toContain(REAL_CONFIRMATION.name);
    const missing = await run(["--real"], { [REAL_CONFIRMATION.name]: REAL_CONFIRMATION.value }, deps);
    expect(missing.code).toBe(2);
    for (const name of ["NEX_AI_FIRST_TEST_TENANT", "KYNOVA_EVALS_USER_ID", "OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) expect(missing.err).toContain(name);
    const notUuid = await run(["--real"], { ...FULL_ENV, NEX_AI_FIRST_TEST_TENANT: "empresa-uno" }, deps);
    expect(notUuid.code).toBe(2);
    expect(provider.seen.calls).toBe(0);
    expect(budget.calls.reserve).toBe(0);
  });

  it("the real mode goes through the same controlled path: 18 reservations and provider calls, one attempt each, 3 simulated runs without provider, thresholds met", async () => {
    const provider = simulatedProvider(() => "ok", 0, echoAnswer);
    const budget = memoryStore({ maxCalls: 30 });
    const result = await run(["--real", "--run-id", RUN], FULL_ENV, { store: budget.store, executor: { registry: provider.registry, sleep: async () => undefined } });
    expect(result.code).toBe(0);
    expect(provider.seen.calls).toBe(18);
    expect(budget.state.callsUsed).toBe(18);
    expect(result.out).toContain("Ejecutadas: 18 con modelo + 3 simuladas");
    expect(result.out).toContain("liquidadas 18");
    expect(result.out).toContain("PENDIENTES de conciliar 0");
  });

  it("shares the persistent cap with the manual tests and never resets it: with 25 calls already used, only 5 are made and the rest fall back to rules", async () => {
    const provider = simulatedProvider(() => "ok", 0, echoAnswer);
    const budget = memoryStore({ maxCalls: 30 });
    budget.state.callsUsed = 25; // what the manual tests already consumed
    const result = await run(["--real", "--run-id", RUN], FULL_ENV, { store: budget.store, executor: { registry: provider.registry, sleep: async () => undefined } });
    expect(provider.seen.calls).toBe(5);
    expect(budget.state.callsUsed).toBe(30);
    expect(result.out).toContain("call_limit_reached");
    expect(result.out).toContain("budget_unavailable 13");
  });

  it("resuming a run with the same run id never repeats a call", async () => {
    const provider = simulatedProvider(() => "ok", 0, echoAnswer);
    const budget = memoryStore({ maxCalls: 30 });
    const deps = { store: budget.store, executor: { registry: provider.registry, sleep: async () => undefined } };
    await run(["--real", "--run-id", RUN], FULL_ENV, deps);
    expect(provider.seen.calls).toBe(18);
    await run(["--real", "--run-id", RUN], FULL_ENV, deps);
    expect(provider.seen.calls).toBe(18); // the same request ids: the budget finds them and grants nothing
    expect(evalRequestId(RUN, 0)).toBe(SIMULATED_RID(0));
  });

  it("an uncertain provider failure is left pending and is counted, never released", async () => {
    const provider = simulatedProvider(() => "server", 0, echoAnswer);
    const budget = memoryStore({ maxCalls: 30 });
    const result = await run(["--real", "--run-id", RUN], FULL_ENV, { store: budget.store, executor: { registry: provider.registry, sleep: async () => undefined } });
    expect(provider.seen.calls).toBe(18); // one attempt each, no retry
    expect(result.out).toContain("PENDIENTES de conciliar 18");
    expect(budget.calls.release).toBe(0);
    expect(result.code).toBe(0); // the mechanical thresholds hold (the rules draft is valid); the model rate says what happened
    expect(result.out).toContain("tasa de respuestas del modelo 0.00");
  });

  it("the command has no way to assign, raise or reset a budget or a cap", () => {
    const source = read("lib/ai/evals-cli.ts") + read("scripts/run-evals.ts");
    expect(source).not.toMatch(/assign_ai|expire_ai|write_off|calls_used\s*=|max_calls|service_role|process\.env\.[A-Z_]*KEY/);
  });
});
