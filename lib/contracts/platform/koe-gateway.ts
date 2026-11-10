// KOE AI Gateway Intelligence: the ONE place where "which AI answers this" is worked out. The prompt pipeline (system, business, guardrails, memory, context,
// tools, user), the guardrails (personal data, moderation, token limits, timeout, rate limit, retry, circuit breaker), the router (provider, model, Worker,
// estimated cost, priority, policy), the fallback, the simulated provider adapters, the cache keys and the metrics. No module, Worker or screen repeats this
// logic, and none of them can name a provider or a model: a request carries a PURPOSE and the gateway decides everything else.
// Pure and deterministic, with no real network, no real credential and no real model. Real calls will go only through lib/ai/ and AI Gateway, behind
// this same decision; today every provider is a simulation that never leaves the process.

import { fnv } from "./koe-dev";
import {
  CACHE_ARCHITECTURE, GATEWAY_MODELS, GATEWAY_POLICIES, GUARDRAIL_CEILINGS, GUARDRAIL_DEFAULTS, GUARDRAIL_PROMPT, LAYER_RULES, PRIVACY_RANK, PROMPT_LAYERS, SYSTEM_PROMPT, policyById,
  type GatewayModel, type GatewayPolicy, type GuardrailLimits, type ModerationCategory, type PiiKind, type PolicyId, type PromptLayer, type Purpose,
} from "./gateway-catalog";
import { PRIORITY_RANK, higherPriority, type Clearance, type Priority } from "./koe-registry";

const MINUTE = 60_000;

// ---------------------------------------------------------------- tokens and personal data
/** A deliberate approximation (four characters a token): the real count comes from the provider adapter. */
export const estimateTokens = (text: string): number => (text === "" ? 0 : Math.ceil(text.length / 4));

const PII_RULES: ReadonlyArray<{ kind: PiiKind; pattern: RegExp; placeholder: string }> = [
  { kind: "email", pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/g, placeholder: "[correo]" },
  { kind: "card", pattern: /\b(?:\d[ -]?){13,16}\b/g, placeholder: "[tarjeta]" },
  { kind: "id", pattern: /\b\d{3}-\d{2}-\d{4}\b|\b\d-\d{4}-\d{4}\b/g, placeholder: "[documento]" },
  { kind: "phone", pattern: /\+?\d[\d ()-]{7,}\d/g, placeholder: "[teléfono]" },
];

/** Replaces personal data with a placeholder and says which kinds were found. */
export function redactPii(text: string): { text: string; found: PiiKind[] } {
  let output = text;
  const found: PiiKind[] = [];
  for (const rule of PII_RULES) {
    const next = output.replace(rule.pattern, rule.placeholder);
    if (next !== output) found.push(rule.kind);
    output = next;
  }
  return { text: output, found };
}
export const detectPii = (text: string): PiiKind[] => redactPii(text).found;

const MODERATION_TERMS: Record<ModerationCategory, readonly string[]> = {
  violence: ["matar a", "asesinar", "bomba casera", "kill him", "build a bomb"],
  selfHarm: ["quiero morir", "hacerme daño", "suicid", "hurt myself"],
  hate: ["odio a los", "raza inferior", "inferior race"],
  sexual: ["contenido sexual explícito", "explicit sexual"],
  illegal: ["lavar dinero", "falsificar", "evadir impuestos", "launder money", "counterfeit"],
};
/** A conservative, rule-based first filter. A real moderation model plugs in behind the same answer. */
export function moderate(text: string): ModerationCategory[] {
  const lower = text.toLowerCase();
  return (Object.keys(MODERATION_TERMS) as ModerationCategory[]).filter((category) => MODERATION_TERMS[category].some((term) => lower.includes(term)));
}

// ---------------------------------------------------------------- prompt pipeline
/** What a module hands over. It has no field for a provider or a model: it can only say what it wants to say. */
export type PromptInput = { business?: string; memory?: readonly string[]; context?: readonly string[]; tools?: readonly string[]; user: string };
export type PromptPart = { layer: PromptLayer; text: string; tokens: number };
export type PromptPlan = { parts: PromptPart[]; inputTokens: number; pii: PiiKind[]; moderation: ModerationCategory[]; trimmed: PromptLayer[]; overLimit: boolean; hash: string };

const TOOL_ID = /^[a-z]+(\.[a-zA-Z]+)+$/;

/**
 * Assembles the prompt in the fixed order of PROMPT_LAYERS. Personal data is replaced in every layer unless the purpose is cleared for it. When the prompt
 * is over the limit, context and then memory are trimmed (oldest first); the system, guardrails and user layers are never cut.
 */
export function buildPrompt(input: PromptInput, options: { keepPersonal: boolean; maxInputTokens: number }): PromptPlan {
  const pii = new Set<PiiKind>();
  const clean = (layer: PromptLayer, text: string): string => {
    const result = redactPii(text);
    for (const kind of result.found) pii.add(kind);
    return LAYER_RULES[layer].sanitized && !options.keepPersonal ? result.text : text;
  };
  const memory = (input.memory ?? []).map((item) => clean("memory", item));
  const context = (input.context ?? []).map((item) => clean("context", item));
  const tools = (input.tools ?? []).filter((item) => TOOL_ID.test(item));
  const user = clean("user", input.user);
  const business = clean("business", input.business ?? "");

  const compose = (): PromptPart[] => {
    const text: Record<PromptLayer, string> = {
      system: SYSTEM_PROMPT, business, guardrails: GUARDRAIL_PROMPT, memory: memory.join("\n"), context: context.join("\n"),
      tools: tools.length ? `Herramientas: ${tools.join(", ")}` : "", user,
    };
    return PROMPT_LAYERS.filter((layer) => text[layer] !== "").map((layer) => ({ layer, text: text[layer], tokens: estimateTokens(text[layer]) }));
  };
  const total = (parts: readonly PromptPart[]) => parts.reduce((sum, part) => sum + part.tokens, 0);

  const trimmed = new Set<PromptLayer>();
  let parts = compose();
  while (total(parts) > options.maxInputTokens && (context.length > 0 || memory.length > 0)) {
    if (context.length > 0) { context.pop(); trimmed.add("context"); } else { memory.shift(); trimmed.add("memory"); }
    parts = compose();
  }
  const inputTokens = total(parts);
  const joined = parts.map((part) => `${part.layer}:${part.text}`).join("|");
  return {
    parts, inputTokens, pii: [...pii], moderation: moderate([user, ...context].join("\n")), trimmed: [...trimmed],
    overLimit: inputTokens > options.maxInputTokens, hash: `${fnv(joined)}${fnv(`${joined.length}|${joined}`)}`,
  };
}

// ---------------------------------------------------------------- the company's configuration (the gateway reads it; a person writes it)
export type GatewayConfig = {
  tenantId: string; ownerId: string; admins: readonly string[]; policy: PolicyId; allowedModels: readonly string[]; // [] = every enabled model
  budgetMicros: number | null; limits: GuardrailLimits; region?: string; updatedAt: string; updatedBy: string;
};

/** The issues of a proposed limit set. A company may be stricter than the defaults or looser up to the ceilings, never beyond. */
export function validateLimits(limits: GuardrailLimits): string[] {
  const issues: string[] = [];
  const positive = (value: number) => Number.isInteger(value) && value > 0;
  if (!positive(limits.maxInputTokens) || limits.maxInputTokens > GUARDRAIL_CEILINGS.maxInputTokens) issues.push("tokens de entrada");
  if (!positive(limits.maxOutputTokens) || limits.maxOutputTokens > GUARDRAIL_CEILINGS.maxOutputTokens) issues.push("tokens de salida");
  if (!positive(limits.timeoutMs) || limits.timeoutMs > GUARDRAIL_CEILINGS.timeoutMs) issues.push("tiempo máximo");
  if (!positive(limits.requestsPerMinute) || limits.requestsPerMinute > GUARDRAIL_CEILINGS.requestsPerMinute) issues.push("solicitudes por minuto");
  if (!positive(limits.retry.maxAttempts) || limits.retry.maxAttempts > GUARDRAIL_CEILINGS.maxAttempts) issues.push("intentos");
  if (limits.retry.backoffMs.some((value) => !Number.isInteger(value) || value < 0)) issues.push("espera entre intentos");
  if (!positive(limits.breaker.failureThreshold) || !positive(limits.breaker.cooldownMs)) issues.push("cortacircuitos");
  return issues;
}

export function defaultConfig(tenantId: string, at: string): GatewayConfig {
  return { tenantId, ownerId: "", admins: [], policy: "balanced", allowedModels: [], budgetMicros: null, limits: GUARDRAIL_DEFAULTS, updatedAt: at, updatedBy: "system" };
}

// ---------------------------------------------------------------- the router
export type RouteContext = {
  purpose: Purpose; policy: GatewayPolicy; allowedModels: readonly string[]; region?: string; inputTokens: number; outputTokens: number;
  clearance: Clearance; priority: Priority; models?: readonly GatewayModel[];
};
export type RankedModel = { model: GatewayModel; score: number; estimatedCostMicros: number };
export type RoutePlan = {
  policyId: PolicyId; workerId: string; priority: Priority; chain: RankedModel[]; rejected: { modelId: string; reasons: string[] }[];
  chosen: RankedModel | null; estimatedCostMicros: number; reason: string;
};

/** The privacy a model must have for the data it will see: a hard rule, not a preference. */
export function requiredPrivacy(clearance: Clearance, policy: GatewayPolicy): number {
  const base = clearance === "public" ? 0 : PRIVACY_RANK.noTraining;
  const strict = policy.id === "privacyFirst" && clearance === "personal" ? PRIVACY_RANK.local : base;
  return Math.max(base, strict, policy.minPrivacyRank);
}

export const costOf = (model: GatewayModel, tokens: number): number => Math.ceil((tokens / 1_000) * model.costMicrosPer1k);

/** Why a model cannot serve a request. Empty when it can. */
export function rejections(model: GatewayModel, context: RouteContext): string[] {
  const reasons: string[] = [];
  if (!model.enabled) reasons.push("desactivado");
  if (context.allowedModels.length > 0 && !context.allowedModels.includes(model.id)) reasons.push("no permitido por la empresa");
  const missing = context.purpose.needs.filter((need) => !model.capabilities.includes(need));
  if (missing.length > 0) reasons.push(`sin capacidad: ${missing.join(", ")}`);
  if (model.maxContextTokens < context.inputTokens + context.outputTokens) reasons.push("contexto insuficiente");
  if (context.purpose.needsTools && !model.supportsTools) reasons.push("sin herramientas");
  if (PRIVACY_RANK[model.privacy] < requiredPrivacy(context.clearance, context.policy)) reasons.push("privacidad insuficiente para estos datos");
  if (context.region && !model.regions.includes(context.region)) reasons.push("fuera de la región de la empresa");
  return reasons;
}

/** A score from 0 to 100 under the policy's weights. Cost is judged against the other candidates, so the same model scores differently in a different field. */
export function scoreModel(model: GatewayModel, policy: GatewayPolicy, candidates: readonly GatewayModel[]): number {
  const costs = candidates.map((item) => item.costMicrosPer1k);
  const low = Math.min(...costs);
  const high = Math.max(...costs);
  const cost = high === low ? 1 : (high - model.costMicrosPer1k) / (high - low);
  const parts = { cost, quality: (model.quality - 1) / 4, speed: (model.speed - 1) / 4, privacy: PRIVACY_RANK[model.privacy] / PRIVACY_RANK.local };
  const weights = policy.weights;
  const total = weights.cost + weights.quality + weights.speed + weights.privacy;
  return Math.round(((parts.cost * weights.cost + parts.quality * weights.quality + parts.speed * weights.speed + parts.privacy * weights.privacy) / total) * 100);
}

/** Decides provider, model, Worker, estimated cost, priority and policy. The module never does. */
export function route(context: RouteContext): RoutePlan {
  const models = context.models ?? GATEWAY_MODELS;
  const rejected: RoutePlan["rejected"] = [];
  const eligible: GatewayModel[] = [];
  for (const model of models) {
    const reasons = rejections(model, context);
    if (reasons.length === 0) eligible.push(model); else rejected.push({ modelId: model.id, reasons });
  }
  const tokens = context.inputTokens + context.outputTokens;
  const chain = eligible
    .map((model) => ({ model, score: scoreModel(model, context.policy, eligible), estimatedCostMicros: costOf(model, tokens) }))
    .sort((a, b) => b.score - a.score || a.estimatedCostMicros - b.estimatedCostMicros || a.model.id.localeCompare(b.model.id));
  const chosen = chain[0] ?? null;
  const priority = higherPriority(context.purpose.priority, context.priority);
  return {
    policyId: context.policy.id, workerId: context.purpose.workerId, priority, chain, rejected, chosen, estimatedCostMicros: chosen?.estimatedCostMicros ?? 0,
    reason: chosen ? `${chosen.model.label} · ${context.policy.label} · puntaje ${chosen.score}` : `ningún modelo cumple: ${rejected.map((item) => `${item.modelId} (${item.reasons[0] ?? "?"})`).join("; ")}`,
  };
}

export const policyFor = (id: string): GatewayPolicy => policyById(id) ?? GATEWAY_POLICIES[GATEWAY_POLICIES.length - 1] ?? (GATEWAY_POLICIES[0] as GatewayPolicy);

// ---------------------------------------------------------------- retry
/** A low priority gets one attempt, critical gets one more than the company allows (never beyond the ceiling). */
export function attemptsFor(priority: Priority, limits: GuardrailLimits): number {
  if (PRIORITY_RANK[priority] === PRIORITY_RANK.low) return 1;
  return Math.min(limits.retry.maxAttempts + (priority === "critical" ? 1 : 0), GUARDRAIL_CEILINGS.maxAttempts);
}
export const backoffFor = (attempt: number, limits: GuardrailLimits): number => limits.retry.backoffMs[Math.min(attempt, limits.retry.backoffMs.length - 1)] ?? 0;

// ---------------------------------------------------------------- circuit breaker
export type BreakerStatus = "closed" | "open" | "halfOpen";
export type BreakerRecord = { tenantId: string; providerId: string; failures: number; openedAt?: string; lastFailureAt?: string };
/** Open until the cool-down passes; then half open: one trial decides whether it closes or opens again. */
export function breakerStatus(record: BreakerRecord | undefined, limits: GuardrailLimits, at: string): BreakerStatus {
  if (!record?.openedAt) return "closed";
  return Date.parse(at) - Date.parse(record.openedAt) < limits.breaker.cooldownMs ? "open" : "halfOpen";
}
export function afterAttempt(record: BreakerRecord | undefined, tenantId: string, providerId: string, ok: boolean, limits: GuardrailLimits, at: string): BreakerRecord {
  if (ok) return { tenantId, providerId, failures: 0 };
  const failures = (record?.failures ?? 0) + 1;
  const wasHalfOpen = breakerStatus(record, limits, at) === "halfOpen";
  const opens = wasHalfOpen || failures >= limits.breaker.failureThreshold;
  return { tenantId, providerId, failures, lastFailureAt: at, ...(opens ? { openedAt: at } : record?.openedAt ? { openedAt: record.openedAt } : {}) };
}

// ---------------------------------------------------------------- simulated provider adapters (deterministic, they never leave the process)
export const INCIDENT_MODES = ["down", "timeout", "rateLimited", "slow"] as const;
export type IncidentMode = (typeof INCIDENT_MODES)[number];
export type Incident = { providerId: string; mode: IncidentMode; since: string; by: string };
export type AttemptOutcome = "ok" | "down" | "timeout" | "rateLimited";
export type SimulatedAttempt = { outcome: AttemptOutcome; latencyMs: number; outputTokens: number };
export const RETRYABLE: readonly AttemptOutcome[] = ["timeout", "rateLimited"];

export function simulateAttempt(model: GatewayModel, incident: Incident | undefined, inputTokens: number, timeoutMs: number, maxOutputTokens: number, seed: string): SimulatedAttempt {
  const hash = Number.parseInt(fnv(seed), 16);
  const jitter = hash % (Math.floor(model.baseLatencyMs / 5) + 1);
  const normal = model.baseLatencyMs + Math.ceil(inputTokens / 20) + jitter;
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
export function cacheVerdict(tenantId: string, purpose: Purpose, modelId: string, plan: PromptPlan): CacheVerdict {
  if (!purpose.cacheable) return { status: "bypass", reason: "el propósito no es cacheable" };
  if (plan.pii.length > 0) return { status: "bypass", reason: "contiene datos personales" };
  if (CACHE_ARCHITECTURE.implemented === false && plan.parts.length === 0) return { status: "bypass", reason: "sin contenido" };
  return { status: "eligible", key: `${tenantId}|${purpose.id}|${modelId}|${plan.hash}`, reason: "cacheable cuando exista la caché" };
}

// ---------------------------------------------------------------- the record of a call (observability: everything but the text)
export type AttemptRecord = { modelId: string; providerId: string; outcome: AttemptOutcome | "skipped"; latencyMs: number; backoffMs: number; note: string };
export type CallStatus = "ok" | "failed" | "refused";
export type GatewayCall = {
  id: string; tenantId: string; at: string; caller: string; actor: string; purposeId: string; workerId: string; policyId: PolicyId; priority: Priority; status: CallStatus;
  modelId?: string; providerId?: string; attempts: AttemptRecord[]; fallbackUsed: boolean; fallbackReasons: string[]; latencyMs: number; inputTokens: number; outputTokens: number;
  estimatedCostMicros: number; cache: CacheVerdict["status"]; pii: PiiKind[]; trimmed: PromptLayer[]; moderation: ModerationCategory[]; errorCode?: string; promptHash: string;
};

// ---------------------------------------------------------------- metrics (what the company and KOE read)
export type GatewayMetrics = {
  calls: number; ok: number; failed: number; refused: number; fallbackCalls: number; fallbackRate: number; averageLatencyMs: number; tokens: number; costMicros: number;
  byModel: { modelId: string; calls: number; costMicros: number }[]; byPurpose: { purposeId: string; calls: number }[]; errors: { code: string; count: number }[];
};
const bump = <T extends { calls: number }>(rows: T[], match: (row: T) => boolean, make: () => T, change: (row: T) => void) => {
  const found = rows.find(match);
  if (found) { found.calls += 1; change(found); } else { const row = make(); row.calls = 1; change(row); rows.push(row); }
};
export function gatewayMetrics(calls: readonly GatewayCall[], tenantId: string): GatewayMetrics {
  const mine = calls.filter((call) => call.tenantId === tenantId);
  const done = mine.filter((call) => call.status === "ok");
  const byModel: GatewayMetrics["byModel"] = [];
  const byPurpose: GatewayMetrics["byPurpose"] = [];
  const errors = new Map<string, number>();
  for (const call of mine) {
    if (call.modelId && call.status === "ok") bump(byModel, (row) => row.modelId === call.modelId, () => ({ modelId: call.modelId ?? "", calls: 0, costMicros: 0 }), (row) => { row.costMicros += call.estimatedCostMicros; });
    bump(byPurpose, (row) => row.purposeId === call.purposeId, () => ({ purposeId: call.purposeId, calls: 0 }), () => undefined);
    if (call.errorCode) errors.set(call.errorCode, (errors.get(call.errorCode) ?? 0) + 1);
  }
  const fallbackCalls = mine.filter((call) => call.fallbackUsed).length;
  const latency = done.reduce((sum, call) => sum + call.latencyMs, 0);
  return {
    calls: mine.length, ok: done.length, failed: mine.filter((call) => call.status === "failed").length, refused: mine.filter((call) => call.status === "refused").length,
    fallbackCalls, fallbackRate: mine.length === 0 ? 0 : Math.round((fallbackCalls / mine.length) * 100), averageLatencyMs: done.length === 0 ? 0 : Math.round(latency / done.length),
    tokens: done.reduce((sum, call) => sum + call.inputTokens + call.outputTokens, 0), costMicros: done.reduce((sum, call) => sum + call.estimatedCostMicros, 0),
    byModel, byPurpose, errors: [...errors].map(([code, count]) => ({ code, count })),
  };
}

/** What the company has spent this calendar month (UTC), from the calls that were answered. */
export function spentThisMonth(calls: readonly GatewayCall[], tenantId: string, at: string): number {
  const month = at.slice(0, 7);
  return calls.filter((call) => call.tenantId === tenantId && call.status === "ok" && call.at.slice(0, 7) === month).reduce((sum, call) => sum + call.estimatedCostMicros, 0);
}
export const callsInLastMinute = (calls: readonly GatewayCall[], tenantId: string, at: string): number => calls.filter((call) => call.tenantId === tenantId && Date.parse(call.at) > Date.parse(at) - MINUTE && Date.parse(call.at) <= Date.parse(at)).length;
