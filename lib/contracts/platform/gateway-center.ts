// KOE AI Gateway store: each company's configuration (policy, allowed models, budget, limits), the circuit breakers, the simulated provider incidents and the
// record of every call. Pure and deterministic, one global state with every company record owned by a company (tenant): nothing is shared between companies.
// There is NO real provider, model, key or network call: a call is answered by the simulated adapters of koe-gateway.ts. This file only decides who may do what and
// records the result; the routing, guardrails, retry, breaker and metrics are all worked out by koe-gateway.ts.
//
// The single entry point is the `gateway.request` event. It has NO field for a provider or a model: a caller (NEX, a Worker, a module) names a PURPOSE and the
// gateway decides the rest. NEX never chooses an AI; it asks KOE.
//
// Constitution (ADR-0009): an AI call here is internal and simulated (Level 1). Only a person of the company changes its configuration; NEX, a Worker or the
// system never does. The prompt text is never stored: the record keeps the hash, the counts and the decision. There is no event that edits or deletes a call or
// a log: every list only grows.

import { isPerson } from "./actors";
import { CALLERS, GATEWAY_MODELS, POLICY_IDS, providerById, purposeById, PROVIDER_IDS, type PolicyId } from "./gateway-catalog";
import { message, reason, type ErrorCode } from "./gateway-messages";
import {
  INCIDENT_MODES, RETRYABLE, afterAttempt, attemptsFor, backoffFor, breakerStatus, buildPrompt, cacheVerdict, callsInLastMinute, costOf, defaultConfig, policyFor, route, simulateAttempt,
  spentThisMonth, validateLimits,
  type AttemptRecord, type BreakerRecord, type GatewayCall, type GatewayConfig, type Incident, type IncidentMode, type PromptInput, type RoutePlan,
} from "./koe-gateway";
import type { GuardrailLimits } from "./gateway-catalog";
import type { Priority } from "./koe-registry";

export * from "./gateway-catalog";

export type GatewayLog = { at: string; actor: string; tenantId: string; action: string; detail?: string };
export type GatewayState = {
  configs: readonly GatewayConfig[]; incidents: readonly Incident[]; breakers: readonly BreakerRecord[]; calls: readonly GatewayCall[]; logs: readonly GatewayLog[]; sequence: number;
};
export const newGatewayState = (): GatewayState => ({ configs: [], incidents: [], breakers: [], calls: [], logs: [], sequence: 0 });

type Base = { at: string; tenantId: string; actor: string };
export type GatewayEvent =
  | (Base & { type: "gateway.configure"; policy?: PolicyId; allowedModels?: readonly string[]; budgetMicros?: number | null; limits?: Partial<Omit<GuardrailLimits, "retry" | "breaker">> & { retry?: Partial<GuardrailLimits["retry"]>; breaker?: Partial<GuardrailLimits["breaker"]> }; region?: string | null; admins?: readonly string[] })
  | (Base & { type: "gateway.request"; caller: string; purposeId: string; input: PromptInput; priority?: Priority })
  | (Base & { type: "provider.incident"; providerId: string; mode: IncidentMode })
  | (Base & { type: "provider.recover"; providerId: string });

export type GatewayResult = { state: GatewayState; error?: string; errorCode?: ErrorCode; call?: GatewayCall; output?: string };

const append = <T,>(items: readonly T[], item: T): readonly T[] => [...items, item];
const log = (state: GatewayState, event: Base, action: string, detail?: string): GatewayState => ({ ...state, logs: append(state.logs, { at: event.at, actor: event.actor, tenantId: event.tenantId, action, ...(detail ? { detail } : {}) }) });
const configOf = (state: GatewayState, tenantId: string): GatewayConfig | undefined => state.configs.find((item) => item.tenantId === tenantId);
/** The configuration a company actually runs with: what it set, or the defaults. */
export const effectiveConfig = (state: GatewayState, tenantId: string, at: string): GatewayConfig => configOf(state, tenantId) ?? defaultConfig(tenantId, at);

export function reduceGateway(state: GatewayState, event: GatewayEvent): GatewayResult {
  const refuse = (code: ErrorCode, params: Record<string, string | number> = {}): GatewayResult => ({ state, error: message(code, params), errorCode: code });
  if (event.tenantId.trim() === "" || event.actor.trim() === "") return refuse("invalid", { detail: "empresa o autor" });

  switch (event.type) {
    // ================================================================ configuration (a person of the company decides)
    case "gateway.configure": {
      if (!isPerson(event.actor)) return refuse("personRequired");
      const current = configOf(state, event.tenantId);
      if (current && event.actor !== current.ownerId && !current.admins.includes(event.actor)) return refuse("forbidden");
      const base = current ?? defaultConfig(event.tenantId, event.at);
      if (event.policy !== undefined && !POLICY_IDS.includes(event.policy)) return refuse("invalid", { detail: "política" });
      const known = new Set(GATEWAY_MODELS.map((item) => item.id));
      if (event.allowedModels?.some((id) => !known.has(id))) return refuse("invalid", { detail: "modelo no registrado" });
      if (event.budgetMicros !== undefined && event.budgetMicros !== null && (!Number.isInteger(event.budgetMicros) || event.budgetMicros < 0)) return refuse("invalid", { detail: "presupuesto" });
      const limits: GuardrailLimits = {
        ...base.limits, ...event.limits,
        retry: { ...base.limits.retry, ...event.limits?.retry }, breaker: { ...base.limits.breaker, ...event.limits?.breaker },
      };
      const issues = validateLimits(limits);
      if (issues.length) return refuse("invalid", { detail: issues[0] ?? "límites" });
      if (event.region != null && !GATEWAY_MODELS.some((item) => item.regions.includes(event.region as string))) return refuse("invalid", { detail: "región" });
      const region = event.region === undefined ? base.region : event.region === null ? undefined : event.region;
      const next: GatewayConfig = {
        ...base, ownerId: current?.ownerId ?? event.actor, admins: event.admins ?? base.admins, policy: event.policy ?? base.policy, allowedModels: event.allowedModels ?? base.allowedModels,
        budgetMicros: event.budgetMicros === undefined ? base.budgetMicros : event.budgetMicros, limits, ...(region ? { region } : {}), updatedAt: event.at, updatedBy: event.actor,
      };
      const configs = current ? state.configs.map((item) => (item.tenantId === event.tenantId ? next : item)) : append(state.configs, next);
      return { state: log({ ...state, configs }, event, "gateway.configure", `${next.policy} · ${next.allowedModels.length === 0 ? "todos los modelos" : `${next.allowedModels.length} modelos`}`) };
    }

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

    // ================================================================ the ONE entry point for any AI call
    case "gateway.request": {
      const sequence = state.sequence + 1;
      const callId = `call-${sequence}`;
      const config = effectiveConfig(state, event.tenantId, event.at);
      const purpose = purposeById(event.purposeId);
      const policy = policyFor(config.policy);
      const priority: Priority = event.priority ?? purpose?.priority ?? "normal";
      const blank = (over: Partial<GatewayCall>): GatewayCall => ({
        id: callId, tenantId: event.tenantId, at: event.at, caller: event.caller, actor: event.actor, purposeId: event.purposeId, workerId: purpose?.workerId ?? "-", policyId: policy.id,
        priority: purpose ? priority : "normal", status: "refused", attempts: [], fallbackUsed: false, fallbackReasons: [], latencyMs: 0, inputTokens: 0, outputTokens: 0, estimatedCostMicros: 0,
        cache: "bypass", pii: [], trimmed: [], moderation: [], promptHash: "", ...over,
      });
      const refused = (code: ErrorCode, params: Record<string, string | number>, over: Partial<GatewayCall> = {}): GatewayResult => {
        const call = blank({ errorCode: code, ...over });
        const next = log({ ...state, sequence, calls: append(state.calls, call) }, event, "gateway.refused", `${event.purposeId} · ${code}`);
        return { state: next, error: message(code, params), errorCode: code, call };
      };

      if (!CALLERS.includes(event.caller as (typeof CALLERS)[number])) return refused("unknownCaller", { detail: event.caller });
      if (!purpose) return refused("unknownPurpose", { detail: event.purposeId });

      const limits = config.limits;
      if (callsInLastMinute(state.calls, event.tenantId, event.at) >= limits.requestsPerMinute) return refused("rateLimited", {});
      const outputTokens = Math.min(purpose.maxOutputTokens, limits.maxOutputTokens);
      const plan = buildPrompt(event.input, { keepPersonal: purpose.clearance === "personal", maxInputTokens: limits.maxInputTokens });
      const seen = { inputTokens: plan.inputTokens, pii: plan.pii, trimmed: plan.trimmed, moderation: plan.moderation, promptHash: plan.hash };
      if (plan.moderation.length > 0) return refused("moderated", { detail: plan.moderation.join(", ") }, seen);
      if (plan.overLimit) return refused("tooLong", {}, seen);

      const routed: RoutePlan = route({ purpose, policy, allowedModels: config.allowedModels, ...(config.region ? { region: config.region } : {}), inputTokens: plan.inputTokens, outputTokens, clearance: purpose.clearance, priority });
      const top = routed.chosen;
      if (!top) return refused("noModel", { detail: routed.reason.replace(/^ningún modelo cumple: /, "") }, seen);
      const spent = spentThisMonth(state.calls, event.tenantId, event.at);
      if (config.budgetMicros !== null && spent + top.estimatedCostMicros > config.budgetMicros) return refused("overBudget", {}, { ...seen, estimatedCostMicros: top.estimatedCostMicros, modelId: top.model.id, providerId: top.model.providerId });

      // ---- run the chain: retry a temporary failure, then fall back to ANOTHER provider, and always keep the reason
      const attempts: AttemptRecord[] = [];
      const reasons: string[] = [];
      const failedProviders = new Set<string>();
      let breakers = state.breakers;
      let latencyMs = 0;
      let winner: { modelId: string; providerId: string; tokensOut: number; cost: number } | undefined;
      const rowOf = (providerId: string) => breakers.find((item) => item.tenantId === event.tenantId && item.providerId === providerId);
      for (const ranked of routed.chain) {
        const model = ranked.model;
        if (failedProviders.has(model.providerId)) {
          attempts.push({ modelId: model.id, providerId: model.providerId, outcome: "skipped", latencyMs: 0, backoffMs: 0, note: reason("providerFailed") });
          continue;
        }
        const status = breakerStatus(rowOf(model.providerId), limits, event.at);
        if (status === "open") {
          attempts.push({ modelId: model.id, providerId: model.providerId, outcome: "skipped", latencyMs: 0, backoffMs: 0, note: reason("circuitOpen") });
          reasons.push(`${model.id}: ${reason("circuitOpen")}`);
          failedProviders.add(model.providerId);
          continue;
        }
        const allowed = status === "halfOpen" ? 1 : attemptsFor(routed.priority, limits);
        for (let attempt = 0; attempt < allowed; attempt += 1) {
          const sim = simulateAttempt(model, state.incidents.find((item) => item.providerId === model.providerId), plan.inputTokens, limits.timeoutMs, outputTokens, `${callId}|${model.id}|${attempt}`);
          const retry = sim.outcome !== "ok" && RETRYABLE.includes(sim.outcome) && attempt < allowed - 1;
          const backoffMs = retry ? backoffFor(attempt, limits) : 0;
          attempts.push({ modelId: model.id, providerId: model.providerId, outcome: sim.outcome, latencyMs: sim.latencyMs, backoffMs, note: retry ? reason("retry") : "" });
          latencyMs += sim.latencyMs + backoffMs;
          const updated = afterAttempt(rowOf(model.providerId), event.tenantId, model.providerId, sim.outcome === "ok", limits, event.at);
          breakers = [...breakers.filter((item) => !(item.tenantId === event.tenantId && item.providerId === model.providerId)), updated];
          if (sim.outcome === "ok") { winner = { modelId: model.id, providerId: model.providerId, tokensOut: sim.outputTokens, cost: costOf(model, plan.inputTokens + sim.outputTokens) }; break; }
          if (!retry) { reasons.push(`${model.id}: ${sim.outcome}`); break; }
        }
        if (winner) break;
        failedProviders.add(model.providerId);
      }

      const cache = cacheVerdict(event.tenantId, purpose, winner?.modelId ?? top.model.id, plan);
      const common = { attempts, fallbackReasons: reasons, latencyMs, ...seen, cache: cache.status };
      if (!winner) {
        const call = blank({ ...common, status: "failed", errorCode: "allFailed", estimatedCostMicros: 0 });
        const next = log({ ...state, sequence, breakers, calls: append(state.calls, call) }, event, "gateway.failed", `${event.purposeId} · ${reasons.join("; ")}`);
        return { state: next, error: message("allFailed", { detail: reasons.join("; ") || "sin candidatos" }), errorCode: "allFailed", call };
      }
      const fallbackUsed = winner.modelId !== top.model.id;
      const call = blank({
        ...common, status: "ok", modelId: winner.modelId, providerId: winner.providerId, fallbackUsed, outputTokens: winner.tokensOut, estimatedCostMicros: winner.cost,
        fallbackReasons: fallbackUsed ? reasons.map((item) => reason("fallback", { detail: item })) : [],
      });
      const next = log({ ...state, sequence, breakers, calls: append(state.calls, call) }, event, "gateway.call", `${event.purposeId} · ${winner.modelId}${fallbackUsed ? " (respaldo)" : ""}`);
      return { state: next, call, output: `[simulado] respuesta de ${winner.modelId} para ${purpose.id}` };
    }
  }
}

/** The providers a company can see and the state of their circuit breaker, for its own calls only. */
export function providerHealth(state: GatewayState, tenantId: string, at: string): { providerId: string; incident?: IncidentMode; breaker: "closed" | "open" | "halfOpen"; failures: number }[] {
  const config = effectiveConfig(state, tenantId, at);
  return PROVIDER_IDS.map((providerId) => {
    const row = state.breakers.find((item) => item.tenantId === tenantId && item.providerId === providerId);
    const incident = state.incidents.find((item) => item.providerId === providerId)?.mode;
    return { providerId, ...(incident ? { incident } : {}), breaker: breakerStatus(row, config.limits, at), failures: row?.failures ?? 0 };
  });
}
