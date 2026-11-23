// The command line of the first-work evals (scripts/run-evals.ts is only a thin wrapper that reads the files and the environment and calls this). Two modes:
//  - DRY-RUN (the default): validates the suite and its fixtures, loads the prompt, shows the plan with the estimated reservation of each call, and makes ZERO calls: no network, no database.
//  - REAL (`--real` plus the confirmation variable): runs the plan through the SAME controlled path as the API route (budget reservation, the persistent cap of 30 calls, the input check, ONE
//    provider attempt, validation of the output) with the SERVER's budget store. It cannot assign, raise or reset a budget or a cap (the store it uses has no such function), and the cap
//    it shares with the manual tests is the database's, so it is never reset. If anything it needs is missing it stops with the exact reason BEFORE any call.
// Nothing here prints a value of the environment: only the names of what is missing.

import type { BudgetStore } from "@/lib/contracts/ai-budget";
import type { EnvSource } from "@/lib/backend/env";
import { FIRST_WORK_TEST_LIMITS, buildProviderPrompt, generateDraft } from "@/lib/first-work-draft";
import { reservationMicros } from "./controlled-call";
import { parseEvalSuite, parseFixture, planFirstWorkEvals, runFirstWorkEvals, type EvalReport } from "./evals";
import { buildFirstWorkDraftDeps, createAiBudgetServerStore, firstWorkAiConfigFor, type FirstWorkDepsParams } from "./first-work";
import { chatInputTokenBound } from "./input-bound";
import { instructionsOf } from "./prompts";
import { NATIVE_MODELS } from "./providers";

/** The explicit activation of the real mode: `--real` AND this variable with this value. */
export const REAL_CONFIRMATION = { name: "KYNOVA_EVALS_CONFIRM", value: "run-real-calls" } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CliIo = { out: (line: string) => void; err: (line: string) => void };
export type CliInput = {
  argv: readonly string[];
  env: EnvSource;
  suiteYaml: string;
  fixtureYaml: string;
  io: CliIo;
  /** for tests */ deps?: { store?: BudgetStore; executor?: FirstWorkDepsParams["executor"]; newRunId?: () => string };
};

/** The id of run number `index` of a run: the same run id and index always give the same request id, so a run that is resumed never repeats a call (the budget finds it as a repeated key). */
export const evalRequestId = (runId: string, index: number): string => `${runId.slice(0, 24)}${index.toString(16).padStart(12, "0")}`;

function parseArgs(argv: readonly string[]): { real: boolean; repetitions: number; runId: string | null; problems: string[] } {
  const problems: string[] = [];
  let real = false;
  let repetitions = 3;
  let runId: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--real") real = true;
    else if (arg === "--repetitions") { repetitions = Number(argv[i + 1]); i += 1; }
    else if (arg === "--run-id") { runId = argv[i + 1] ?? null; i += 1; }
    else problems.push(`argumento desconocido: ${arg}`);
  }
  if (!Number.isInteger(repetitions) || repetitions < 1) problems.push("--repetitions debe ser un entero positivo");
  if (runId !== null && !UUID.test(runId)) problems.push("--run-id debe ser un UUID");
  return { real, repetitions, runId, problems };
}

const NEEDED_FOR_REAL = ["NEX_AI_FIRST_TEST_TENANT", "KYNOVA_EVALS_USER_ID", "OPENAI_API_KEY", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;

/** Exit code: 0 ok (dry-run valid, or every threshold met), 1 a threshold failed, 2 nothing was run (bad input or a missing condition). */
export async function runEvalsCli(input: CliInput): Promise<number> {
  const { io, env } = input;
  const args = parseArgs(input.argv);
  if (args.problems.length > 0) { for (const problem of args.problems) io.err(problem); return 2; }

  // 1. validate the suite and the fixtures, and plan (pure: no call of any kind)
  let plan;
  try {
    plan = planFirstWorkEvals({ suiteYaml: input.suiteYaml, fixtureYaml: input.fixtureYaml, repetitions: args.repetitions, maxModelCalls: FIRST_WORK_TEST_LIMITS.maxBillableCalls });
  } catch (error) {
    io.err(`el plan no es válido: ${error instanceof Error ? error.message : "error"}`);
    return 2;
  }
  const instructions = instructionsOf("nex.nex.first-work-draft", { allowDraft: true });
  if (!instructions) { io.err("no se pudo cargar el prompt nex.nex.first-work-draft"); return 2; }
  const native = NATIVE_MODELS["gw-fast-1"];
  if (!native) { io.err("gw-fast-1 no está en el registro de modelos"); return 2; }

  const suite = parseEvalSuite(input.suiteYaml);
  const fixture = parseFixture(input.fixtureYaml);
  let reservedTotal = 0;
  let overLimit = 0;
  const caseLines: string[] = [];
  for (const item of suite.cases) {
    if (item.providerFailure) { caseLines.push(`  ${item.id.padEnd(20)} simulado (sin proveedor): ${args.repetitions} ejecución(es), 0 llamadas`); continue; }
    const phrases = fixture.cases[item.fixtureKey] as { offer: string; audience: string };
    const bound = chatInputTokenBound(buildProviderPrompt(instructions, phrases, fixture.company));
    if (bound > FIRST_WORK_TEST_LIMITS.maxInputTokens) overLimit += 1;
    const each = reservationMicros(native, bound, FIRST_WORK_TEST_LIMITS.maxOutputTokens);
    reservedTotal += each * args.repetitions;
    caseLines.push(`  ${item.id.padEnd(20)} con modelo: ${args.repetitions} llamada(s), cota de entrada ${bound} tokens, reserva estimada ${each} µ$ por llamada`);
  }
  io.out(args.real ? "MODO REAL (con llamadas al proveedor, por la misma ruta controlada que la API)" : "DRY-RUN (por defecto): no se hace ninguna llamada de red ni a la base");
  io.out(`Suite: ${suite.cases.length} casos · Repeticiones: ${args.repetitions} · Modelo: gw-fast-1 · Un intento por petición, sin reintentos ni proveedor de respaldo`);
  for (const line of caseLines) io.out(line);
  io.out(`Plan: ${plan.modelRuns} llamadas reales + ${plan.simulatedRuns} ejecuciones simuladas · tope compartido con las pruebas manuales: ${FIRST_WORK_TEST_LIMITS.maxBillableCalls} llamadas en total (lo lleva la base; este comando nunca lo reinicia)`);
  io.out(`Reserva total estimada de las ${plan.modelRuns} llamadas: ${reservedTotal} µ$ (≈ $${(reservedTotal / 1_000_000).toFixed(4)}); presupuesto propuesto: ${FIRST_WORK_TEST_LIMITS.budgetMicros} µ$. Es una ESTIMACIÓN: la entrada no tiene un máximo garantizado por el proveedor; el coste real se liquida con los tokens que informe.`);
  if (overLimit > 0) { io.err(`${overLimit} caso(s) superan el límite de entrada: nada se ejecuta`); return 2; }

  if (!args.real) { io.out("Dry-run válido. Para ejecutar de verdad: --real y definir la confirmación explícita (ver docs/modules/nex-primera-prueba-ia.md)."); return 0; }

  // 2. real mode: every condition is checked BEFORE the first call, and the answer names what is missing (never a value)
  if (env[REAL_CONFIRMATION.name] !== REAL_CONFIRMATION.value) { io.err(`falta la confirmación explícita: defina ${REAL_CONFIRMATION.name}=${REAL_CONFIRMATION.value}. No se llamó a ningún proveedor.`); return 2; }
  const missing = NEEDED_FOR_REAL.filter((name) => !env[name]?.trim());
  if (missing.length > 0) { io.err(`faltan variables: ${missing.join(", ")}. No se llamó a ningún proveedor.`); return 2; }
  const tenantId = (env["NEX_AI_FIRST_TEST_TENANT"] as string).trim();
  const userId = (env["KYNOVA_EVALS_USER_ID"] as string).trim();
  if (!UUID.test(tenantId) || !UUID.test(userId)) { io.err("NEX_AI_FIRST_TEST_TENANT y KYNOVA_EVALS_USER_ID deben ser UUID. No se llamó a ningún proveedor."); return 2; }
  const config = firstWorkAiConfigFor(tenantId, tenantId);
  if (!config.enabled) { io.err("la configuración de la prueba no se activó para esa empresa. No se llamó a ningún proveedor."); return 2; }

  const runId = args.runId ?? (input.deps?.newRunId ?? (() => crypto.randomUUID()))();
  const store = input.deps?.store ?? createAiBudgetServerStore(env);
  const reports: ReturnType<ReturnType<typeof buildFirstWorkDraftDeps>["controlled"]["report"]>[] = [];
  io.out(`Ejecución ${runId} (con --run-id ${runId} se reanuda sin repetir llamadas)`);
  let report: EvalReport;
  try {
    report = await runFirstWorkEvals({
      suiteYaml: input.suiteYaml, fixtureYaml: input.fixtureYaml, repetitions: args.repetitions, maxModelCalls: FIRST_WORK_TEST_LIMITS.maxBillableCalls,
      requestId: (index) => evalRequestId(runId, index),
      // the SAME path as the route: the controlled call behind generateDraft
      run: async (phrases, context) => {
        const { deps, controlled } = buildFirstWorkDraftDeps({
          store, tenantId, requestedBy: userId, requestId: context.requestId, config, limits: FIRST_WORK_TEST_LIMITS, env, ...(input.deps?.executor ? { executor: input.deps.executor } : {}),
        });
        const result = await generateDraft(phrases, { companyName: context.companyName }, deps, config);
        const end = controlled.report();
        reports.push(end);
        io.out(`  ${result.source === "model" ? "modelo" : `reglas (${result.reason})`} · reserva ${end.reservation}${end.refusal ? ` · rechazo ${end.refusal}` : ""}`);
        return result;
      },
    });
  } catch (error) {
    io.err(`la ejecución se detuvo: ${error instanceof Error ? error.message : "error"}`);
    return 2;
  }

  const tally = (key: string) => reports.filter((item) => item.reservation === key).length;
  const settled = reports.reduce((sum, item) => sum + (item.settledMicros ?? 0), 0);
  io.out(`Ejecutadas: ${report.executed.modelRuns} con modelo + ${report.executed.simulatedRuns} simuladas · llamadas al proveedor: ${reports.reduce((sum, item) => sum + item.providerCalls, 0)}`);
  io.out(`Reservas: liquidadas ${tally("settled")}, sin cargo ${tally("settled_no_charge")}, liberadas ${tally("released")}, PENDIENTES de conciliar ${tally("pending")}, sin reserva ${tally("none")}`);
  io.out(`Gasto liquidado: ${settled} µ$ (estimado con los tokens que informó el proveedor) · entradas por encima de la cota: ${reports.filter((item) => item.inputOverBound).length}`);
  io.out(`Dimensiones: ${Object.entries(report.dimensions).map(([name, value]) => `${name} ${value.toFixed(2)}`).join(" · ")} · tasa de respuestas del modelo ${report.modelRate.toFixed(2)}`);
  if (Object.keys(report.fallbacks).length > 0) io.out(`Respaldo por reglas: ${Object.entries(report.fallbacks).map(([reason, count]) => `${reason} ${count}`).join(", ")}`);
  io.out(`No medido aquí: ${report.notMeasured.join("; ")}`);
  io.out(report.failing.length === 0 ? "Umbrales mecánicos cumplidos (la suite sigue sin darse por verde hasta revisar la rúbrica y la latencia/coste)." : `Por debajo del umbral: ${report.failing.join(", ")}`);
  return report.failing.length === 0 ? 0 : 1;
}
