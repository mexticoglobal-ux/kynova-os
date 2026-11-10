// KOE AI Intelligence: what KOE works out for every AI request BEFORE anything is chosen. The prompt pipeline (system, business, guardrails, memory, context, tools, user),
// the guardrails KOE owns (personal data, moderation, token limits, the company's rate limit), the company's configuration, the AIDecision (Worker, specialty, policy,
// priority, budget, privacy, time) and the metrics. KOE decides the Worker, the specialty, the priority and the policy, and nothing more: the model comes from the AI Cost
// Optimizer and the provider from the AI Gateway. Pure and deterministic, with no real network and no real credential.

import { AI_SPECIALTIES, type AIDecision, type PolicyId } from "./ai-decision";
import { validateGatewayLimits } from "./ai-limits";
import {
  GUARDRAIL_CEILINGS, GUARDRAIL_DEFAULTS, GUARDRAIL_PROMPT, LAYER_RULES, PROMPT_LAYERS, SYSTEM_PROMPT, DEFAULT_POLICY_ID,
  type GuardrailLimits, type ModerationCategory, type PiiKind, type PromptLayer, type Purpose,
} from "./koe-ai-catalog";
import { fnv } from "./koe-dev";
import type { Priority } from "./koe-registry";

const MINUTE = 60_000;

// ---------------------------------------------------------------- tokens and personal data
/** A deliberate approximation (four characters a token): the real count comes from the adapter that answers. */
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
/** A conservative, rule-based first filter. A real moderation service plugs in behind the same answer. */
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

// ---------------------------------------------------------------- the company's configuration (KOE reads it; a person writes it)
export type AiConfig = {
  tenantId: string; ownerId: string; admins: readonly string[]; policy: PolicyId;
  /** Opaque ids the company allows. KOE never reads them: it hands them to the AI Cost Optimizer. Empty means all. */
  allowedModels: readonly string[];
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
  issues.push(...validateGatewayLimits({ retry: limits.retry, breaker: limits.breaker }));
  return issues;
}

export function defaultConfig(tenantId: string, at: string): AiConfig {
  return { tenantId, ownerId: "", admins: [], policy: DEFAULT_POLICY_ID, allowedModels: [], budgetMicros: null, limits: GUARDRAIL_DEFAULTS, updatedAt: at, updatedBy: "system" };
}

// ---------------------------------------------------------------- the decision (Worker, specialty, policy, priority, budget, privacy, time; never a provider or a model)
export function decisionFor(id: string, purpose: Purpose, config: AiConfig, priority: Priority, remainingBudgetMicros: number | null): AIDecision {
  return {
    id, tenantId: config.tenantId, workerId: purpose.workerId, specialty: purpose.specialty, policy: config.policy, priority, budgetMicros: remainingBudgetMicros,
    privacy: purpose.privacy, maxTimeMs: config.limits.timeoutMs,
  };
}
export const knownSpecialty = (value: string): boolean => (AI_SPECIALTIES as readonly string[]).includes(value);

// ---------------------------------------------------------------- the record of a request (what KOE decided; the Gateway keeps what it observed, and ai-observability.ts joins both)
export type AiStatus = "ok" | "failed" | "refused";
export type AiRecord = {
  id: string; tenantId: string; at: string; caller: string; actor: string; purposeId: string; workerId: string; specialty: string; policyId: PolicyId; priority: Priority;
  status: AiStatus; errorCode?: string; pii: PiiKind[]; trimmed: PromptLayer[]; moderation: ModerationCategory[]; promptHash: string; inputTokens: number;
  estimatedCostMicros: number; confidence?: string; gatewayCallId?: string;
};
export const callsInLastMinute = (records: readonly AiRecord[], tenantId: string, at: string): number => records.filter((item) => item.tenantId === tenantId && Date.parse(item.at) > Date.parse(at) - MINUTE && Date.parse(item.at) <= Date.parse(at)).length;
