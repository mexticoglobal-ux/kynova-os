// The real executor of the AI Gateway: it runs a GatewayRequest (the ordered list of models KOE and the Optimizer chose) against real providers with the Gateway's own rules.
// It tries the models in order, retries a temporary failure with the company's backoff, falls back to ANOTHER provider, honours the circuit breaker, applies the timeout,
// and records every attempt. It skips (and says why) a provider that is only prepared, or that has no secret. The tokens are the provider's own count and the cost is worked
// out from them. It produces a DriverOutcome, which the Gateway's reducer records exactly like a simulated call; nothing here decides which model is preferred, and nothing
// keeps the prompt or the answer. Only this layer reads a provider key, and only through the Secrets Manager, for the moment of the call.

import type { SecretsManager } from "@/lib/backend/secrets";
import { SecretMissingError } from "@/lib/backend/secrets";
import { reason } from "@/lib/contracts/platform/gateway-messages";
import { MODEL_PROVIDER } from "@/lib/contracts/platform/gateway-catalog";
import { afterAttempt, attemptsFor, backoffFor, breakerStatus, type AttemptOutcome, type AttemptRecord, type BreakerRecord, type DriverOutcome, type GatewayRequest } from "@/lib/contracts/platform/gateway-engine";
import { NATIVE_MODELS, PROVIDER_REGISTRY, costOfNative, type NativeModel, type ProviderConfig } from "./providers";
import { ProviderError, RETRYABLE_KINDS, type AdapterCall, type Completion, type ProviderErrorKind, type ProviderPrompt, type StreamEvent, type Usage } from "./types";

export type AttemptEvent = { providerId: string; modelId: string; outcome: AttemptOutcome | "skipped"; latencyMs: number; errorKind?: ProviderErrorKind; inputTokens?: number; outputTokens?: number };

export type ExecutorDeps = {
  secrets: SecretsManager;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** An ISO clock for the breaker. */
  clock?: () => string;
  registry?: Readonly<Record<string, ProviderConfig>>;
  natives?: Readonly<Record<string, NativeModel>>;
  /** The breaker rows the Gateway holds now. */
  breakers?: readonly BreakerRecord[];
  /** Told about every attempt (no text, no key): a place to log, count and trace. */
  onAttempt?: (event: AttemptEvent) => void;
};

export type Execution = { outcome: DriverOutcome; text: string | null };

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Control characters are removed from what a model answers before anyone shows or uses it (rules/ai.md 7); line breaks and tabs stay. */
export const sanitizeAnswer = (value: string): string => [...value].filter((char) => { const code = char.charCodeAt(0); return code >= 32 || code === 9 || code === 10 || code === 13; }).join("");
export const estimateTokens = (value: string): number => (value === "" ? 0 : Math.ceil(value.length / 4));

/** The outcome of an attempt, in the words of the Gateway, from what the provider layer saw. */
export function outcomeOfKind(kind: ProviderErrorKind): AttemptOutcome {
  return kind === "rateLimited" ? "rateLimited" : kind === "timeout" ? "timeout" : "down";
}
const kindOf = (error: unknown): ProviderErrorKind => (error instanceof ProviderError ? error.kind : error instanceof SecretMissingError ? "notConfigured" : "network");

type Attempt<T> = (call: Omit<AdapterCall, "model"> & { adapter: ProviderConfig["adapter"]; native: NativeModel; providerId: string }) => Promise<T>;
type Chain<T> = { winner?: { modelId: string; providerId: string; native: NativeModel; value: T }; attempts: AttemptRecord[]; reasons: string[]; breakers: BreakerRecord[]; latencyMs: number; first: string };

/** Runs the models in order. `attempt` does one real call (a completion, or the start of a stream); this decides everything around it. */
async function runChain<T>(request: GatewayRequest, maxOutputTokens: number, deps: ExecutorDeps, attempt: Attempt<T>): Promise<Chain<T>> {
  const registry = deps.registry ?? PROVIDER_REGISTRY;
  const natives = deps.natives ?? NATIVE_MODELS;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const clock = deps.clock ?? (() => new Date(now()).toISOString());
  const fetchImpl = deps.fetchImpl ?? fetch;
  const attempts: AttemptRecord[] = [];
  const reasons: string[] = [];
  const failed = new Set<string>();
  let breakers = [...(deps.breakers ?? [])];
  const rowOf = (providerId: string) => breakers.find((item) => item.tenantId === request.tenantId && item.providerId === providerId);
  const setRow = (row: BreakerRecord) => { breakers = [...breakers.filter((item) => !(item.tenantId === row.tenantId && item.providerId === row.providerId)), row]; };
  const mine = (): BreakerRecord[] => breakers.filter((item) => item.tenantId === request.tenantId);
  let latencyMs = 0;
  const first = request.models[0] ?? "";

  const skip = (modelId: string, providerId: string, note: string) => {
    attempts.push({ modelId, providerId, outcome: "skipped", latencyMs: 0, backoffMs: 0, note });
    reasons.push(`${modelId}: ${note}`);
    failed.add(providerId);
    deps.onAttempt?.({ providerId, modelId, outcome: "skipped", latencyMs: 0 });
  };

  for (const modelId of request.models) {
    const native = natives[modelId];
    const providerId = MODEL_PROVIDER[modelId];
    if (!native || !providerId) continue;
    if (failed.has(providerId)) { attempts.push({ modelId, providerId, outcome: "skipped", latencyMs: 0, backoffMs: 0, note: reason("providerFailed") }); continue; }
    const config = registry[providerId];
    if (!config || !native.chat) { skip(modelId, providerId, "sin adaptador de chat"); continue; }
    if (!config.connected) { skip(modelId, providerId, "preparado, sin conectar"); continue; }
    const needs = config.secret ?? config.addressName;
    if (needs && !deps.secrets.has(needs)) { skip(modelId, providerId, "sin configurar"); continue; }
    const status = breakerStatus(rowOf(providerId), request.limits.breaker, clock());
    if (status === "open") { skip(modelId, providerId, reason("circuitOpen")); continue; }

    const allowed = status === "halfOpen" ? 1 : attemptsFor(request.priority, request.limits);
    let lastKind: ProviderErrorKind = "network";
    for (let index = 0; index < allowed; index += 1) {
      const controller = new AbortController();
      const started = now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new ProviderError("timeout")); }, request.maxTimeMs); });
      let value: T | undefined;
      let kind: ProviderErrorKind | undefined;
      try {
        const work = deps.secrets.use(needs ?? "", `ai:${providerId}`, (secret) => attempt({
          adapter: config.adapter, native, providerId, key: config.secret ? secret : "", prompt: { system: "", user: "" }, maxOutputTokens, signal: controller.signal, fetchImpl,
          // a provider that runs where we choose has no key: the value read is its address
          ...(!config.secret && config.addressName ? { baseUrl: secret } : {}),
        }));
        value = await Promise.race([work, timedOut]);
      } catch (error) {
        kind = kindOf(error);
      } finally {
        if (timer) clearTimeout(timer);
      }
      const took = Math.max(0, now() - started);
      latencyMs += took;
      const ok = kind === undefined;
      const retry = !ok && RETRYABLE_KINDS.includes(kind as ProviderErrorKind) && index < allowed - 1;
      const backoffMs = retry ? backoffFor(index, request.limits) : 0;
      attempts.push({ modelId, providerId, outcome: ok ? "ok" : outcomeOfKind(kind as ProviderErrorKind), latencyMs: took, backoffMs, note: ok ? "" : retry ? reason("retry") : (kind as string) });
      deps.onAttempt?.({ providerId, modelId, outcome: ok ? "ok" : outcomeOfKind(kind as ProviderErrorKind), latencyMs: took, ...(ok ? {} : { errorKind: kind as ProviderErrorKind }) });
      setRow(afterAttempt(rowOf(providerId), request.tenantId, providerId, ok, request.limits.breaker, clock()));
      if (ok) return { winner: { modelId, providerId, native, value: value as T }, attempts, reasons, breakers: mine(), latencyMs, first };
      lastKind = kind as ProviderErrorKind;
      if (!retry) break;
      latencyMs += backoffMs;
      await sleep(backoffMs);
    }
    reasons.push(`${modelId}: ${lastKind}`);
    failed.add(providerId);
  }
  return { attempts, reasons, breakers: mine(), latencyMs, first };
}

const failedOutcome = (request: GatewayRequest, chain: Chain<unknown>): DriverOutcome => ({
  status: "failed", attempts: chain.attempts, fallbackUsed: false, fallbackReasons: chain.reasons, latencyMs: chain.latencyMs, inputTokens: request.inputTokens, outputTokens: 0,
  estimatedCostMicros: 0, tokenSource: "estimated", breakers: chain.breakers,
});

function okOutcome(request: GatewayRequest, chain: Chain<unknown>, won: NonNullable<Chain<unknown>["winner"]>, usage: Usage | null, answer: string): DriverOutcome {
  // the provider's own count when it gives one; otherwise our estimate of the text, and the outcome says so
  const inputTokens = usage?.inputTokens ?? request.inputTokens;
  const outputTokens = usage?.outputTokens ?? estimateTokens(answer);
  const fallbackUsed = won.modelId !== chain.first;
  return {
    status: "ok", modelId: won.modelId, providerId: won.providerId, attempts: chain.attempts, fallbackUsed, fallbackReasons: fallbackUsed ? chain.reasons.map((item) => reason("fallback", { detail: item })) : [],
    latencyMs: chain.latencyMs, inputTokens, outputTokens, estimatedCostMicros: costOfNative(won.native, inputTokens, outputTokens), tokenSource: usage ? "provider" : "estimated", breakers: chain.breakers,
  };
}

/** One answer, all at once. */
export async function executeChain(request: GatewayRequest, prompt: ProviderPrompt, deps: ExecutorDeps): Promise<Execution> {
  const chain = await runChain<Completion>(request, request.maxOutputTokens, deps, (call) => call.adapter.complete({ ...call, model: call.native.model, prompt }));
  if (!chain.winner) return { outcome: failedOutcome(request, chain), text: null };
  const answer = sanitizeAnswer(chain.winner.value.text);
  return { outcome: okOutcome(request, chain, chain.winner, chain.winner.value.usage, answer), text: answer };
}

export type StreamPart = { type: "delta"; text: string } | { type: "done"; execution: Execution };

/**
 * An answer as it is written. The fallback works until the first piece arrives: once the provider has started to answer, the stream belongs to it, and a failure in the
 * middle ends the stream as failed (the Gateway records it) instead of mixing two models. The usage comes at the end, so the outcome is only known then.
 */
export async function* executeStream(request: GatewayRequest, prompt: ProviderPrompt, deps: ExecutorDeps): AsyncGenerator<StreamPart, void> {
  type Opened = { events: AsyncGenerator<StreamEvent, void>; head: StreamEvent[] };
  const chain = await runChain<Opened>(request, request.maxOutputTokens, deps, async (call) => {
    const events = call.adapter.stream({ ...call, model: call.native.model, prompt });
    const first = await events.next();
    if (first.done) throw new ProviderError("parse");
    return { events, head: [first.value] };
  });
  if (!chain.winner) { yield { type: "done", execution: { outcome: failedOutcome(request, chain), text: null } }; return; }
  const won = chain.winner;
  const now = deps.now ?? Date.now;
  const started = now();
  let answer = "";
  let usage: Usage | null = null;
  let broke: ProviderErrorKind | null = null;
  const take = (event: StreamEvent): StreamPart | null => {
    if (event.type === "delta") { const clean = sanitizeAnswer(event.text); answer += clean; return clean === "" ? null : { type: "delta", text: clean }; }
    if (event.type === "usage") usage = { inputTokens: event.inputTokens ?? usage?.inputTokens ?? 0, outputTokens: event.outputTokens ?? usage?.outputTokens ?? 0 };
    return null;
  };
  try {
    for (const event of won.value.head) { const part = take(event); if (part) yield part; }
    for (;;) {
      const next = await won.value.events.next();
      if (next.done) break;
      const part = take(next.value);
      if (part) yield part;
    }
  } catch (error) {
    broke = kindOf(error);
  }
  chain.latencyMs += Math.max(0, now() - started);
  if (broke) {
    chain.attempts.push({ modelId: won.modelId, providerId: won.providerId, outcome: outcomeOfKind(broke), latencyMs: 0, backoffMs: 0, note: `a mitad del flujo: ${broke}` });
    chain.reasons.push(`${won.modelId}: ${broke}`);
    yield { type: "done", execution: { outcome: { ...failedOutcome(request, chain), outputTokens: estimateTokens(answer) }, text: null } };
    return;
  }
  yield { type: "done", execution: { outcome: okOutcome(request, chain, won, usage, answer), text: answer } };
}
