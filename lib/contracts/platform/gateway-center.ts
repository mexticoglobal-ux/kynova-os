// AI Gateway store: the circuit breakers, the simulated provider incidents and the record of every call. Pure and deterministic, one global state with every record
// owned by a company (tenant): nothing is shared between companies. There is NO real provider, model, key or network call: a call is answered by the simulated adapters
// of gateway-engine.ts. The Gateway holds no company configuration, no Worker, no specialty and no policy: it only receives a GatewayRequest from KOE.
//
// Only KOE may ask the Gateway to execute (`gateway.execute`): a module, a Worker or NEX asks KOE. Only the platform starts or ends a simulated incident.
// The prompt text never reaches the Gateway: the record keeps counts, the decision and the opaque ids KOE gave. There is no event that edits or deletes a call or a
// log: every list only grows.

import { GATEWAY_PROVIDERS, MODEL_PROVIDER, PROVIDER_IDS, providerById } from "./gateway-catalog";
import { validateGatewayLimits, type GatewayLimits } from "./ai-limits";
import { message, reason, type ErrorCode } from "./gateway-messages";
import {
  INCIDENT_MODES, RETRYABLE, afterAttempt, attemptsFor, backoffFor, breakerStatus, cacheVerdict, simulateAttempt,
  type AttemptRecord, type BreakerRecord, type GatewayCall, type GatewayRequest, type Incident, type IncidentMode,
} from "./gateway-engine";
import { costOf, modelProfile } from "./ai-model-registry";

export * from "./gateway-catalog";

/** The only caller the Gateway accepts. */
export const KOE_ACTOR = "koe";

export type GatewayLog = { at: string; actor: string; tenantId: string; action: string; detail?: string };
export type GatewayState = { incidents: readonly Incident[]; breakers: readonly BreakerRecord[]; calls: readonly GatewayCall[]; logs: readonly GatewayLog[]; sequence: number };
export const newGatewayState = (): GatewayState => ({ incidents: [], breakers: [], calls: [], logs: [], sequence: 0 });

type Base = { at: string; tenantId: string; actor: string };
export type GatewayEvent =
  | (Base & { type: "gateway.execute"; request: GatewayRequest })
  | (Base & { type: "provider.incident"; providerId: string; mode: IncidentMode })
  | (Base & { type: "provider.recover"; providerId: string });

export type GatewayResult = { state: GatewayState; error?: string; errorCode?: ErrorCode; call?: GatewayCall; output?: string };

const append = <T,>(items: readonly T[], item: T): readonly T[] => [...items, item];
const log = (state: GatewayState, event: Base, action: string, detail?: string): GatewayState => ({ ...state, logs: append(state.logs, { at: event.at, actor: event.actor, tenantId: event.tenantId, action, ...(detail ? { detail } : {}) }) });

export function reduceGateway(state: GatewayState, event: GatewayEvent): GatewayResult {
  const refuse = (code: ErrorCode, params: Record<string, string | number> = {}): GatewayResult => ({ state, error: message(code, params), errorCode: code });
  if (event.tenantId.trim() === "" || event.actor.trim() === "") return refuse("invalid", { detail: "empresa o autor" });

  switch (event.type) {
    // ================================================================ simulated incidents (the platform, never a person or NEX)
    case "provider.incident": {
      if (event.actor !== "system") return refuse("systemOnly");
      if (!providerById(event.providerId)) return refuse("invalid", { detail: "proveedor" });
      if (!INCIDENT_MODES.includes(event.mode)) return refuse("invalid", { detail: "tipo de incidente" });
      const incidents = [...state.incidents.filter((item) => item.providerId !== event.providerId), { providerId: event.providerId, mode: event.mode, since: event.at, by: event.actor }];
      return { state: log({ ...state, incidents }, event, "provider.incident", `${event.providerId} · ${event.mode}`) };
    }
    case "provider.recover": {
      if (event.actor !== "system") return refuse("systemOnly");
      if (!state.incidents.some((item) => item.providerId === event.providerId)) return refuse("invalid", { detail: "no hay un incidente" });
      return { state: log({ ...state, incidents: state.incidents.filter((item) => item.providerId !== event.providerId) }, event, "provider.recover", event.providerId) };
    }

    // ================================================================ execute what KOE decided: provider, model, fallback, retry, timeout, observability
    case "gateway.execute": {
      if (event.actor !== KOE_ACTOR) return refuse("koeOnly");
      const request = event.request;
      if (request.tenantId !== event.tenantId) return refuse("invalid", { detail: "empresa" });
      const limitIssues = validateGatewayLimits(request.limits);
      if (limitIssues.length) return refuse("invalid", { detail: limitIssues[0] ?? "límites" });
      if (!Number.isInteger(request.maxTimeMs) || request.maxTimeMs <= 0) return refuse("invalid", { detail: "tiempo máximo" });

      const sequence = state.sequence + 1;
      const callId = `call-${sequence}`;
      const blank = (over: Partial<GatewayCall>): GatewayCall => ({
        id: callId, requestId: request.requestId, tenantId: event.tenantId, at: event.at, status: "refused", attempts: [], fallbackUsed: false, fallbackReasons: [], latencyMs: 0,
        inputTokens: request.inputTokens, outputTokens: 0, estimatedCostMicros: 0, cache: "bypass", ...over,
      });
      const usable = request.models.filter((id) => modelProfile(id) && MODEL_PROVIDER[id]);
      const first = usable[0];
      if (!first) {
        const call = blank({ errorCode: "noModel" });
        return { state: log({ ...state, sequence, calls: append(state.calls, call) }, event, "gateway.refused", `${request.requestId} · noModel`), error: message("noModel", { detail: request.models.join(", ") || "lista vacía" }), errorCode: "noModel", call };
      }

      // ---- run the list: retry a temporary failure, then fall back to ANOTHER provider, and always keep the reason
      const attempts: AttemptRecord[] = [];
      const reasons: string[] = [];
      const failedProviders = new Set<string>();
      let breakers = state.breakers;
      let latencyMs = 0;
      let winner: { modelId: string; providerId: string; tokensOut: number; cost: number } | undefined;
      const rowOf = (providerId: string) => breakers.find((item) => item.tenantId === event.tenantId && item.providerId === providerId);
      for (const modelId of usable) {
        const profile = modelProfile(modelId);
        const providerId = MODEL_PROVIDER[modelId];
        if (!profile || !providerId) continue;
        if (failedProviders.has(providerId)) {
          attempts.push({ modelId, providerId, outcome: "skipped", latencyMs: 0, backoffMs: 0, note: reason("providerFailed") });
          continue;
        }
        const status = breakerStatus(rowOf(providerId), request.limits.breaker, event.at);
        if (status === "open") {
          attempts.push({ modelId, providerId, outcome: "skipped", latencyMs: 0, backoffMs: 0, note: reason("circuitOpen") });
          reasons.push(`${modelId}: ${reason("circuitOpen")}`);
          failedProviders.add(providerId);
          continue;
        }
        const allowed = status === "halfOpen" ? 1 : attemptsFor(request.priority, request.limits);
        for (let attempt = 0; attempt < allowed; attempt += 1) {
          const sim = simulateAttempt(profile, state.incidents.find((item) => item.providerId === providerId), request.inputTokens, request.maxTimeMs, request.maxOutputTokens, `${callId}|${modelId}|${attempt}`);
          const retry = sim.outcome !== "ok" && RETRYABLE.includes(sim.outcome) && attempt < allowed - 1;
          const backoffMs = retry ? backoffFor(attempt, request.limits) : 0;
          attempts.push({ modelId, providerId, outcome: sim.outcome, latencyMs: sim.latencyMs, backoffMs, note: retry ? reason("retry") : "" });
          latencyMs += sim.latencyMs + backoffMs;
          const updated = afterAttempt(rowOf(providerId), event.tenantId, providerId, sim.outcome === "ok", request.limits.breaker, event.at);
          breakers = [...breakers.filter((item) => !(item.tenantId === event.tenantId && item.providerId === providerId)), updated];
          if (sim.outcome === "ok") { winner = { modelId, providerId, tokensOut: sim.outputTokens, cost: costOf(profile, request.inputTokens + sim.outputTokens) }; break; }
          if (!retry) { reasons.push(`${modelId}: ${sim.outcome}`); break; }
        }
        if (winner) break;
        failedProviders.add(providerId);
      }

      const cache = cacheVerdict(request, winner?.modelId ?? first).status;
      if (!winner) {
        const call = blank({ attempts, fallbackReasons: reasons, latencyMs, cache, status: "failed", errorCode: "allFailed" });
        const next = log({ ...state, sequence, breakers, calls: append(state.calls, call) }, event, "gateway.failed", `${request.requestId} · ${reasons.join("; ")}`);
        return { state: next, error: message("allFailed", { detail: reasons.join("; ") || "sin candidatos" }), errorCode: "allFailed", call };
      }
      const fallbackUsed = winner.modelId !== first;
      const call = blank({
        attempts, latencyMs, cache, status: "ok", modelId: winner.modelId, providerId: winner.providerId, fallbackUsed, outputTokens: winner.tokensOut, estimatedCostMicros: winner.cost,
        fallbackReasons: fallbackUsed ? reasons.map((item) => reason("fallback", { detail: item })) : [],
      });
      const next = log({ ...state, sequence, breakers, calls: append(state.calls, call) }, event, "gateway.call", `${request.requestId} · ${winner.modelId}${fallbackUsed ? " (respaldo)" : ""}`);
      return { state: next, call, output: `[simulado] respuesta de ${winner.modelId}` };
    }
  }
}

/** The providers and the state of their circuit breaker for one company, under the breaker limits KOE passes. */
export function providerHealth(state: GatewayState, tenantId: string, at: string, breaker: GatewayLimits["breaker"]): { providerId: string; incident?: IncidentMode; breaker: "closed" | "open" | "halfOpen"; failures: number }[] {
  return PROVIDER_IDS.map((providerId) => {
    const row = state.breakers.find((item) => item.tenantId === tenantId && item.providerId === providerId);
    const incident = state.incidents.find((item) => item.providerId === providerId)?.mode;
    return { providerId, ...(incident ? { incident } : {}), breaker: breakerStatus(row, breaker, at), failures: row?.failures ?? 0 };
  });
}
export { GATEWAY_PROVIDERS };
