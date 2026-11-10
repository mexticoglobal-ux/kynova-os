// KOE AI store: each company's configuration (policy, allowed models, budget, limits), the record of every request KOE decided, and the state of the AI Gateway it hands
// the work to. Pure and deterministic, one global state with every company record owned by a company (tenant): nothing is shared between companies.
//
// The official flow, in one reducer:  Module -> KOE (`ai.request`) -> AI Cost Optimizer -> AI Gateway (`gateway.execute`) -> simulated provider.
// KOE decides the Worker, the specialty, the priority and the policy (the AIDecision) and enforces the company's limits. The Optimizer recommends a model. The Gateway
// decides the provider, the fallback, the retry, the timeout and what to observe. The request has NO field for a provider or a model, and the prompt text is never
// stored: the record keeps the hash, the counts and the decision. Nothing here calls anything: every provider is a simulation.
//
// Constitution (ADR-0009): an AI call here is internal and simulated (Level 1). Only a person of the company changes its configuration; NEX, a Worker or the system
// never does. There is no event that edits or deletes a record or a log: every list only grows.

import { isPerson } from "./actors";
import { validateDecision, POLICY_IDS, type AIDecision, type PolicyId } from "./ai-decision";
import { optimize, knownRegion, unknownModels } from "./ai-cost-optimizer";
import { reduceGateway, newGatewayState, KOE_ACTOR, type GatewayResult, type GatewayState } from "./gateway-center";
import type { GatewayRequest } from "./gateway-engine";
import { spentThisMonth } from "./gateway-engine";
import { CALLERS, GUARDRAIL_DEFAULTS, purposeById } from "./koe-ai-catalog";
import { message, type ErrorCode } from "./koe-ai-messages";
import {
  buildPrompt, callsInLastMinute, decisionFor, defaultConfig, validateLimits,
  type AiConfig, type AiRecord, type PromptInput,
} from "./koe-ai";
import type { GuardrailLimits } from "./koe-ai-catalog";
import type { Priority } from "./koe-registry";

export * from "./koe-ai-catalog";
export type { AiConfig, AiRecord, PromptInput } from "./koe-ai";

export type AiLog = { at: string; actor: string; tenantId: string; action: string; detail?: string };
export type AiState = { configs: readonly AiConfig[]; records: readonly AiRecord[]; logs: readonly AiLog[]; sequence: number; gateway: GatewayState };
export const newAiState = (): AiState => ({ configs: [], records: [], logs: [], sequence: 0, gateway: newGatewayState() });

type Base = { at: string; tenantId: string; actor: string };
export type AiEvent =
  | (Base & { type: "ai.configure"; policy?: PolicyId; allowedModels?: readonly string[]; budgetMicros?: number | null; limits?: Partial<Omit<GuardrailLimits, "retry" | "breaker">> & { retry?: Partial<GuardrailLimits["retry"]>; breaker?: Partial<GuardrailLimits["breaker"]> }; region?: string | null; admins?: readonly string[] })
  | (Base & { type: "ai.request"; caller: string; purposeId: string; input: PromptInput; priority?: Priority })

export type AiResult = { state: AiState; error?: string; errorCode?: ErrorCode | GatewayResult["errorCode"]; record?: AiRecord; decision?: AIDecision; output?: string };

const append = <T,>(items: readonly T[], item: T): readonly T[] => [...items, item];
const log = (state: AiState, event: Base, action: string, detail?: string): AiState => ({ ...state, logs: append(state.logs, { at: event.at, actor: event.actor, tenantId: event.tenantId, action, ...(detail ? { detail } : {}) }) });
const configOf = (state: AiState, tenantId: string): AiConfig | undefined => state.configs.find((item) => item.tenantId === tenantId);
/** The configuration a company actually runs with: what it set, or the defaults. */
export const effectiveConfig = (state: AiState, tenantId: string, at: string): AiConfig => configOf(state, tenantId) ?? defaultConfig(tenantId, at);

export function reduceAi(state: AiState, event: AiEvent): AiResult {
  const refuse = (code: ErrorCode, params: Record<string, string | number> = {}): AiResult => ({ state, error: message(code, params), errorCode: code });
  if (event.tenantId.trim() === "" || event.actor.trim() === "") return refuse("invalid", { detail: "empresa o autor" });

  switch (event.type) {
    // ================================================================ configuration (a person of the company decides)
    case "ai.configure": {
      if (!isPerson(event.actor)) return refuse("personRequired");
      const current = configOf(state, event.tenantId);
      if (current && event.actor !== current.ownerId && !current.admins.includes(event.actor)) return refuse("forbidden");
      const base = current ?? defaultConfig(event.tenantId, event.at);
      if (event.policy !== undefined && !POLICY_IDS.includes(event.policy)) return refuse("invalid", { detail: "política" });
      if (event.allowedModels && unknownModels(event.allowedModels).length > 0) return refuse("invalid", { detail: "modelo no registrado" });
      if (event.budgetMicros !== undefined && event.budgetMicros !== null && (!Number.isInteger(event.budgetMicros) || event.budgetMicros < 0)) return refuse("invalid", { detail: "presupuesto" });
      const limits: GuardrailLimits = { ...base.limits, ...event.limits, retry: { ...base.limits.retry, ...event.limits?.retry }, breaker: { ...base.limits.breaker, ...event.limits?.breaker } };
      const issues = validateLimits(limits);
      if (issues.length) return refuse("invalid", { detail: issues[0] ?? "límites" });
      if (event.region != null && !knownRegion(event.region)) return refuse("invalid", { detail: "región" });
      const region = event.region === undefined ? base.region : event.region === null ? undefined : event.region;
      const next: AiConfig = {
        ...base, ownerId: current?.ownerId ?? event.actor, admins: event.admins ?? base.admins, policy: event.policy ?? base.policy, allowedModels: event.allowedModels ?? base.allowedModels,
        budgetMicros: event.budgetMicros === undefined ? base.budgetMicros : event.budgetMicros, limits, ...(region ? { region } : {}), updatedAt: event.at, updatedBy: event.actor,
      };
      const configs = current ? state.configs.map((item) => (item.tenantId === event.tenantId ? next : item)) : append(state.configs, next);
      return { state: log({ ...state, configs }, event, "ai.configure", `${next.policy} · ${next.allowedModels.length === 0 ? "sin restricción" : `${next.allowedModels.length} permitidos`}`) };
    }

    // ================================================================ the ONE entry point for any AI call
    case "ai.request": {
      const sequence = state.sequence + 1;
      const id = `dec-${sequence}`;
      const config = effectiveConfig(state, event.tenantId, event.at);
      const purpose = purposeById(event.purposeId);
      const priority: Priority = event.priority ?? purpose?.priority ?? "normal";
      const blank = (over: Partial<AiRecord>): AiRecord => ({
        id, tenantId: event.tenantId, at: event.at, caller: event.caller, actor: event.actor, purposeId: event.purposeId, workerId: purpose?.workerId ?? "-", specialty: purpose?.specialty ?? "-",
        policyId: config.policy, priority: purpose ? priority : "normal", status: "refused", pii: [], trimmed: [], moderation: [], promptHash: "", inputTokens: 0, estimatedCostMicros: 0, ...over,
      });
      const refused = (code: ErrorCode, params: Record<string, string | number>, over: Partial<AiRecord> = {}): AiResult => {
        const record = blank({ errorCode: code, ...over });
        const next = log({ ...state, sequence, records: append(state.records, record) }, event, "ai.refused", `${event.purposeId} · ${code}`);
        return { state: next, error: message(code, params), errorCode: code, record };
      };

      if (!CALLERS.includes(event.caller as (typeof CALLERS)[number])) return refused("unknownCaller", { detail: event.caller });
      if (!purpose) return refused("unknownPurpose", { detail: event.purposeId });

      const limits = config.limits;
      if (callsInLastMinute(state.records, event.tenantId, event.at) >= limits.requestsPerMinute) return refused("rateLimited", {});
      const outputTokens = Math.min(purpose.maxOutputTokens, limits.maxOutputTokens);
      const plan = buildPrompt(event.input, { keepPersonal: purpose.privacy === "personal", maxInputTokens: limits.maxInputTokens });
      const seen = { inputTokens: plan.inputTokens, pii: plan.pii, trimmed: plan.trimmed, moderation: plan.moderation, promptHash: plan.hash };
      if (plan.moderation.length > 0) return refused("moderated", { detail: plan.moderation.join(", ") }, seen);
      if (plan.overLimit) return refused("tooLong", {}, seen);

      // ---- 1. KOE decides: Worker, specialty, priority, policy (never a provider or a model)
      const spent = spentThisMonth(state.gateway.calls, event.tenantId, event.at);
      const remaining = config.budgetMicros === null ? null : Math.max(0, config.budgetMicros - spent);
      const decision = decisionFor(id, purpose, config, priority, remaining);
      const issues = validateDecision(decision);
      if (issues.length) return refused("badDecision", { detail: issues[0] ?? "decisión" }, seen);

      // ---- 2. The AI Cost Optimizer recommends
      const recommendation = optimize({
        policy: decision.policy, specialty: decision.specialty, privacy: decision.privacy, priority: decision.priority, budgetMicros: decision.budgetMicros,
        allowedModels: config.allowedModels, ...(config.region ? { region: config.region } : {}), size: { inputTokens: plan.inputTokens, outputTokens },
      });
      if (recommendation.model === null) return refused("noModel", { detail: recommendation.reason.replace(/^ningún modelo cumple: /, "") }, { ...seen, confidence: recommendation.confidence });
      if (!recommendation.withinBudget) return refused("overBudget", {}, { ...seen, estimatedCostMicros: recommendation.estimatedCostMicros, confidence: recommendation.confidence });

      // ---- 3. The AI Gateway executes (the preferred model first, then the fallbacks)
      const request: GatewayRequest = {
        requestId: id, tenantId: event.tenantId, at: event.at, models: [recommendation.model, ...recommendation.alternatives], priority: decision.priority, maxTimeMs: decision.maxTimeMs,
        inputTokens: plan.inputTokens, maxOutputTokens: outputTokens, limits: { retry: limits.retry, breaker: limits.breaker }, promptHash: plan.hash,
        ...(purpose.cacheable && plan.pii.length === 0 ? { cacheScope: purpose.id } : {}),
      };
      const executed = reduceGateway(state.gateway, { type: "gateway.execute", at: event.at, tenantId: event.tenantId, actor: KOE_ACTOR, request });
      const gatewayCall = executed.call;
      const status = executed.error ? "failed" : "ok";
      const record = blank({
        ...seen, status, confidence: recommendation.confidence, estimatedCostMicros: gatewayCall?.estimatedCostMicros ?? 0, ...(gatewayCall ? { gatewayCallId: gatewayCall.id } : {}),
        ...(executed.error ? { errorCode: executed.errorCode ?? "allFailed" } : {}),
      });
      const next = log({ ...state, sequence, gateway: executed.state, records: append(state.records, record) }, event, executed.error ? "ai.failed" : "ai.call", `${purpose.id}${gatewayCall?.fallbackUsed ? " (respaldo)" : ""}`);
      if (executed.error) return { state: next, error: executed.error, errorCode: executed.errorCode, record, decision };
      return { state: next, record, decision, ...(executed.output ? { output: executed.output } : {}) };
    }
  }
}

export { GUARDRAIL_DEFAULTS };
