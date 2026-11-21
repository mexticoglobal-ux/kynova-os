// SIMULATED collaborators for tests of the controlled call and the evals runner: a budget that behaves like the database's functions and a provider that answers from a script.
// Used only by tests (nothing in the application imports this file): no network, no key, no database.
import type { BudgetAttemptRow, BudgetStore, ReserveOutcome, SettleOutcome } from "@/lib/contracts/ai-budget";
import { PROVIDER_REGISTRY, type ProviderConfig } from "./providers";
import { ProviderError, type Completion, type ProviderAdapter, type StreamEvent } from "./types";

export const SIMULATED_RID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RID = SIMULATED_RID;
export const SIMULATED_PHRASES = { offer: "campañas de marketing para pequeños negocios", audience: "restaurantes y cafés" };
/** A valid answer for the given phrases: what a well-behaved model would write (it only says what the person said). */
export const answerFor = (phrases: { offer: string; audience: string }): string => JSON.stringify({ message: `Hola, le escribo de parte de Nova. Lo que ofrecemos: ${phrases.offer}. Trabajamos con: ${phrases.audience}. ¿Conversamos 15 minutos?`, presentation: `Nova\nQué hacemos: ${phrases.offer}\nA quién ayudamos: ${phrases.audience}` });
const ANSWER = answerFor(SIMULATED_PHRASES);

/** A budget that behaves like the database's functions (one atomic step per call, idempotent by key, call cap and money in the same check), to test the integration without a database. */
export function memoryStore(options: { limit?: number | null; maxCalls?: number | null; failSettle?: boolean } = {}) {
  const state = { limit: options.limit === undefined ? 100_000 : options.limit, maxCalls: options.maxCalls === undefined ? 30 : options.maxCalls, reserved: 0, spent: 0, callsUsed: 0, sequence: 0 };
  const rows = new Map<string, { id: string; amount: number; status: "held" | "settled" | "released"; settledRows?: BudgetAttemptRow[] }>();
  const calls = { reserve: 0, settle: 0, release: 0 };
  const store: BudgetStore = {
    async reserve(input): Promise<ReserveOutcome | null> {
      calls.reserve += 1;
      if (state.limit === null) return { ok: false, reason: "no_budget" };
      const existing = rows.get(input.idempotencyKey);
      if (existing) return { ok: true, reservationId: existing.id, periodStart: "2026-11-01", expiresAt: "2026-11-21T12:05:00.000Z", repeated: true };
      if (state.maxCalls !== null && state.callsUsed >= state.maxCalls) return { ok: false, reason: "call_limit_reached" };
      if (state.reserved + state.spent + input.estimateMicros > state.limit) return { ok: false, reason: "budget_exceeded" };
      state.sequence += 1;
      const id = RID(state.sequence);
      rows.set(input.idempotencyKey, { id, amount: input.estimateMicros, status: "held" });
      state.reserved += input.estimateMicros;
      state.callsUsed += 1;
      return { ok: true, reservationId: id, periodStart: "2026-11-01", expiresAt: "2026-11-21T12:05:00.000Z", repeated: false };
    },
    async settle(reservationId, attempts): Promise<SettleOutcome | null> {
      calls.settle += 1;
      if (options.failSettle) return null;
      const row = [...rows.values()].find((item) => item.id === reservationId);
      if (!row || row.status !== "held") return null;
      const cost = attempts.filter((attempt) => attempt.billable).reduce((sum, attempt) => sum + attempt.cost_micros, 0);
      row.status = "settled";
      row.settledRows = [...attempts];
      state.reserved -= row.amount;
      state.spent += cost;
      return { ok: true, reservationId, settledMicros: cost, overageMicros: Math.max(0, cost - row.amount), repeated: false };
    },
    async release(reservationId) {
      calls.release += 1;
      const row = [...rows.values()].find((item) => item.id === reservationId);
      if (!row || row.status !== "held") return false;
      row.status = "released";
      state.reserved -= row.amount;
      state.callsUsed -= 1;
      return true;
    },
  };
  return { store, state, rows, calls };
}

export type Script = "ok" | "nousage" | "badtext" | "timeout" | "server" | "rateLimited" | "auth";
/** A simulated OpenAI-compatible provider: it counts every call it receives. */
export function simulatedProvider(script: Script[] | ((n: number) => Script) = () => "ok", delayMs = 0, answer?: (prompt: { system: string; user: string }) => string) {
  const seen = { calls: 0, prompts: [] as { system: string; user: string }[] };
  const adapter: ProviderAdapter = {
    id: "openai",
    label: "simulated",
    async complete(call): Promise<Completion> {
      seen.calls += 1;
      seen.prompts.push(call.prompt);
      const behavior = typeof script === "function" ? script(seen.calls) : (script.shift() ?? "ok");
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (behavior === "timeout" || behavior === "server" || behavior === "rateLimited" || behavior === "auth") throw new ProviderError(behavior);
      if (behavior === "badtext") return { text: "no es json", usage: { inputTokens: 700, outputTokens: 20 }, finishReason: "stop" };
      if (behavior === "nousage") return { text: answer ? answer(call.prompt) : ANSWER, usage: null, finishReason: "stop" };
      return { text: answer ? answer(call.prompt) : ANSWER, usage: { inputTokens: 700, outputTokens: 350 }, finishReason: "stop" };
    },
    async *stream(): AsyncGenerator<StreamEvent, void> { throw new ProviderError("badRequest"); },
  };
  const registry: Record<string, ProviderConfig> = Object.fromEntries(Object.entries(PROVIDER_REGISTRY).map(([id, config]) => [id, id === "openai" ? { ...config, adapter } : config]));
  return { adapter, registry, seen };
}

/** A simulated model that reads the person's two phrases from the delimited data of the prompt and writes the draft from them (it says only what the person said). */
export function echoAnswer(prompt: { system: string; user: string }): string {
  const field = (label: string): string => (new RegExp(`<<<${label}\\n([\\s\\S]*?)\\n>>>`).exec(prompt.user)?.[1] ?? "").trim();
  const offer = field("QUE_OFRECE");
  const audience = field("A_QUIEN_SE_DIRIGE");
  return JSON.stringify({
    message: `Hola, le escribo de parte de Nova. ${offer ? `Lo que ofrecemos: ${offer}. ` : "Lo que ofrecemos: [completar: qué ofrece su empresa]. "}${audience ? `Trabajamos con: ${audience}. ` : "Trabajamos con: [completar: a quién se dirige]. "}¿Conversamos 15 minutos?`,
    presentation: `Nova\nQué hacemos: ${offer || "[completar: qué ofrece su empresa]"}\nA quién ayudamos: ${audience || "[completar: a quién se dirige]"}`,
  });
}
