// AI Gateway engine: the ONE place where "which provider answers, and what happens when it does not" is worked out. From the ordered list of models KOE hands over, it
// decides the provider and the model that answer, the fallback, the retry, the timeout and what to observe (the circuit breaker, the simulated adapters, the cache
// verdict and the metrics). It never decides, and does not know, a Worker, a specialty, a policy, a prompt or a budget: the request it receives is narrow on purpose.
// Pure and deterministic, with no real network, no real credential and no real model. Real calls will go only through lib/ai/ and AI Gateway, behind this same
// decision; today every provider is a simulation that never leaves the process.

import { fnv } from "./koe-dev";
import { CACHE_ARCHITECTURE } from "./gateway-catalog";
import { GATEWAY_CEILINGS, type GatewayLimits } from "./ai-limits";
import type { ModelProfile } from "./ai-model-registry";
import { PRIORITY_RANK, type Priority } from "./koe-registry";

// ---------------------------------------------------------------- what KOE hands over (and nothing else)
/**
 * The Gateway's whole input. `models` is ordered: the first is preferred, the rest are the fallbacks. `requestId` and `cacheScope` are opaque labels the Gateway
 * only carries. There is no Worker, specialty, policy, budget or prompt here, and no way to add one.
 */
export type GatewayRequest = {
  requestId: string;
  tenantId: string;
  at: string;
  models: readonly string[];
  priority: Priority;
  maxTimeMs: number;
  inputTokens: number;
  maxOutputTokens: number;
  limits: GatewayLimits;
  promptHash: string;
  /** Present only when KOE says the answer may be cached. Opaque. */
  cacheScope?: string;
};

// ---------------------------------------------------------------- retry
/** A low priority gets one attempt, critical gets one more than the limits allow (never beyond the ceiling). */
export function attemptsFor(priority: Priority, limits: GatewayLimits): number {
  if (PRIORITY_RANK[priority] === PRIORITY_RANK.low) return 1;
  return Math.min(limits.retry.maxAttempts + (priority === "critical" ? 1 : 0), GATEWAY_CEILINGS.maxAttempts);
}
export const backoffFor = (attempt: number, limits: GatewayLimits): number => limits.retry.backoffMs[Math.min(attempt, limits.retry.backoffMs.length - 1)] ?? 0;

// ---------------------------------------------------------------- circuit breaker
export type BreakerStatus = "closed" | "open" | "halfOpen";
export type BreakerRecord = { tenantId: string; providerId: string; failures: number; openedAt?: string; lastFailureAt?: string };
/** Open until the cool-down passes; then half open: one trial decides whether it closes or opens again. */
export function breakerStatus(record: BreakerRecord | undefined, breaker: GatewayLimits["breaker"], at: string): BreakerStatus {
  if (!record?.openedAt) return "closed";
  return Date.parse(at) - Date.parse(record.openedAt) < breaker.cooldownMs ? "open" : "halfOpen";
}
export function afterAttempt(record: BreakerRecord | undefined, tenantId: string, providerId: string, ok: boolean, breaker: GatewayLimits["breaker"], at: string): BreakerRecord {
  if (ok) return { tenantId, providerId, failures: 0 };
  const failures = (record?.failures ?? 0) + 1;
  const wasHalfOpen = breakerStatus(record, breaker, at) === "halfOpen";
  const opens = wasHalfOpen || failures >= breaker.failureThreshold;
  return { tenantId, providerId, failures, lastFailureAt: at, ...(opens ? { openedAt: at } : record?.openedAt ? { openedAt: record.openedAt } : {}) };
}

// ---------------------------------------------------------------- simulated provider adapters (deterministic, they never leave the process)
export const INCIDENT_MODES = ["down", "timeout", "rateLimited", "slow"] as const;
export type IncidentMode = (typeof INCIDENT_MODES)[number];
export type Incident = { providerId: string; mode: IncidentMode; since: string; by: string };
export type AttemptOutcome = "ok" | "down" | "timeout" | "rateLimited";
export type SimulatedAttempt = { outcome: AttemptOutcome; latencyMs: number; outputTokens: number };
export const RETRYABLE: readonly AttemptOutcome[] = ["timeout", "rateLimited"];

export function simulateAttempt(profile: ModelProfile, incident: Incident | undefined, inputTokens: number, timeoutMs: number, maxOutputTokens: number, seed: string): SimulatedAttempt {
  const hash = Number.parseInt(fnv(seed), 16);
  const jitter = hash % (Math.floor(profile.baseLatencyMs / 5) + 1);
  const normal = profile.baseLatencyMs + Math.ceil(inputTokens / 20) + jitter;
  if (incident?.mode === "down") return { outcome: "down", latencyMs: 40, outputTokens: 0 };
  if (incident?.mode === "rateLimited") return { outcome: "rateLimited", latencyMs: 60, outputTokens: 0 };
  if (incident?.mode === "timeout") return { outcome: "timeout", latencyMs: timeoutMs, outputTokens: 0 };
  const latencyMs = incident?.mode === "slow" ? normal * 5 : normal;
  if (latencyMs > timeoutMs) return { outcome: "timeout", latencyMs: timeoutMs, outputTokens: 0 };
  return { outcome: "ok", latencyMs, outputTokens: Math.min(maxOutputTokens, 50 + (hash % 200)) };
}

// ---------------------------------------------------------------- cache (architecture only: a key can be derived, nothing is stored)
export type CacheVerdict = { status: "bypass" | "eligible"; key?: string; reason: string };
/** Whether a call COULD be cached and under which key. The cache itself is not implemented: today every call is a miss. */
export function cacheVerdict(request: Pick<GatewayRequest, "tenantId" | "promptHash" | "cacheScope">, modelId: string): CacheVerdict {
  if (!request.cacheScope) return { status: "bypass", reason: "KOE no la marcó como cacheable" };
  if (CACHE_ARCHITECTURE.implemented === false && request.promptHash === "") return { status: "bypass", reason: "sin contenido" };
  return { status: "eligible", key: `${request.tenantId}|${request.cacheScope}|${modelId}|${request.promptHash}`, reason: "cacheable cuando exista la caché" };
}

// ---------------------------------------------------------------- the record of a call (observability: everything but the text)
export type AttemptRecord = { modelId: string; providerId: string; outcome: AttemptOutcome | "skipped"; latencyMs: number; backoffMs: number; note: string };
export type CallStatus = "ok" | "failed" | "refused";
export type GatewayCall = {
  id: string; requestId: string; tenantId: string; at: string; status: CallStatus; modelId?: string; providerId?: string; attempts: AttemptRecord[]; fallbackUsed: boolean;
  fallbackReasons: string[]; latencyMs: number; inputTokens: number; outputTokens: number; estimatedCostMicros: number; cache: CacheVerdict["status"]; errorCode?: string;
};

// ---------------------------------------------------------------- metrics (what the Gateway observed, by model and by provider)
export type GatewayMetrics = {
  calls: number; ok: number; failed: number; refused: number; fallbackCalls: number; fallbackRate: number; averageLatencyMs: number; tokens: number; costMicros: number;
  byModel: { modelId: string; calls: number; costMicros: number }[]; byProvider: { providerId: string; calls: number; failures: number }[];
};
export function gatewayMetrics(calls: readonly GatewayCall[], tenantId: string): GatewayMetrics {
  const mine = calls.filter((call) => call.tenantId === tenantId);
  const done = mine.filter((call) => call.status === "ok");
  const byModel: GatewayMetrics["byModel"] = [];
  const byProvider = new Map<string, { calls: number; failures: number }>();
  for (const call of mine) {
    if (call.modelId && call.status === "ok") {
      const row = byModel.find((item) => item.modelId === call.modelId);
      if (row) { row.calls += 1; row.costMicros += call.estimatedCostMicros; } else byModel.push({ modelId: call.modelId, calls: 1, costMicros: call.estimatedCostMicros });
    }
    for (const attempt of call.attempts) {
      if (attempt.outcome === "skipped") continue;
      const row = byProvider.get(attempt.providerId) ?? { calls: 0, failures: 0 };
      row.calls += 1;
      if (attempt.outcome !== "ok") row.failures += 1;
      byProvider.set(attempt.providerId, row);
    }
  }
  const fallbackCalls = mine.filter((call) => call.fallbackUsed).length;
  return {
    calls: mine.length, ok: done.length, failed: mine.filter((call) => call.status === "failed").length, refused: mine.filter((call) => call.status === "refused").length,
    fallbackCalls, fallbackRate: mine.length === 0 ? 0 : Math.round((fallbackCalls / mine.length) * 100),
    averageLatencyMs: done.length === 0 ? 0 : Math.round(done.reduce((sum, call) => sum + call.latencyMs, 0) / done.length),
    tokens: done.reduce((sum, call) => sum + call.inputTokens + call.outputTokens, 0), costMicros: done.reduce((sum, call) => sum + call.estimatedCostMicros, 0),
    byModel, byProvider: [...byProvider].map(([providerId, row]) => ({ providerId, ...row })),
  };
}

/** What the company has spent this calendar month (UTC), from the calls that were answered. */
export function spentThisMonth(calls: readonly GatewayCall[], tenantId: string, at: string): number {
  const month = at.slice(0, 7);
  return calls.filter((call) => call.tenantId === tenantId && call.status === "ok" && call.at.slice(0, 7) === month).reduce((sum, call) => sum + call.estimatedCostMicros, 0);
}
