// AI Cost Optimizer: the step between KOE and the AI Gateway. It receives the policy, the specialty, the budget, the priority and the models the company allows,
// and answers which model it recommends, what it will cost, how sure it is and why. It also ranks the others, in order, so the Gateway has a fallback list.
// It does NOT know a prompt (only its size), a Worker or a provider: a model is a profile, and which provider serves it is the Gateway's business.
// Pure and deterministic: the same input always gives the same answer.

import type { Clearance, ModelClass, Priority } from "./koe-registry";
import { PRIORITY_RANK } from "./koe-registry";
import type { AiSpecialty, PolicyId } from "./ai-decision";
import { MODEL_REGISTRY, PRIVACY_RANK, costOf, knownRegion, policyFor, requiredPrivacy, unknownModels, type ModelPolicy, type ModelProfile } from "./ai-model-registry";

/** KOE validates what a company configures through these, so it never has to read the registry itself. */
export { knownRegion, unknownModels };

/** What a model must be able to do for each specialty. */
export const SPECIALTY_NEEDS: Record<AiSpecialty, { needs: readonly ModelClass[]; tools: boolean }> = {
  conversation: { needs: ["fast", "multilingual"], tools: false },
  summarization: { needs: ["reasoning", "multilingual"], tools: false },
  analysis: { needs: ["reasoning", "multilingual"], tools: false },
  writing: { needs: ["fast", "multilingual"], tools: false },
  longDocument: { needs: ["reasoning", "longContext"], tools: false },
  code: { needs: ["code", "reasoning"], tools: true },
  tutoring: { needs: ["fast", "multilingual"], tools: false },
  embedding: { needs: ["embedding"], tools: false },
};

export type Confidence = "high" | "medium" | "low";
/** The size of the work, never its text. */
export type WorkSize = { inputTokens: number; outputTokens: number };
export type OptimizerInput = {
  policy: PolicyId;
  specialty: AiSpecialty;
  privacy: Clearance;
  priority: Priority;
  /** What the company may still spend this month. `null` means no limit. */
  budgetMicros: number | null;
  /** The models the company allows, as ids. Empty means every enabled model. */
  allowedModels: readonly string[];
  region?: string;
  size: WorkSize;
  models?: readonly ModelProfile[];
};
export type RankedModel = { model: string; label: string; score: number; estimatedCostMicros: number };
export type Recommendation = {
  /** The recommended model, or `null` when none fits. */
  model: string | null;
  /** The next best models, in order: what the Gateway falls back to. */
  alternatives: string[];
  ranking: RankedModel[];
  rejected: { model: string; reasons: string[] }[];
  estimatedCostMicros: number;
  withinBudget: boolean;
  confidence: Confidence;
  reason: string;
};

/** Why a model cannot serve the work. Empty when it can. */
export function rejections(profile: ModelProfile, input: OptimizerInput, policy: ModelPolicy): string[] {
  const spec = SPECIALTY_NEEDS[input.specialty];
  const reasons: string[] = [];
  if (!profile.enabled) reasons.push("desactivado");
  if (input.allowedModels.length > 0 && !input.allowedModels.includes(profile.id)) reasons.push("no permitido por la empresa");
  const missing = spec.needs.filter((need) => !profile.capabilities.includes(need));
  if (missing.length > 0) reasons.push(`sin capacidad: ${missing.join(", ")}`);
  if (profile.maxContextTokens < input.size.inputTokens + input.size.outputTokens) reasons.push("contexto insuficiente");
  if (spec.tools && !profile.supportsTools) reasons.push("sin herramientas");
  if (PRIVACY_RANK[profile.privacy] < requiredPrivacy(input.privacy, policy)) reasons.push("privacidad insuficiente para estos datos");
  if (input.region && !profile.regions.includes(input.region)) reasons.push("fuera de la región de la empresa");
  return reasons;
}

/** A score from 0 to 100 under the policy's weights. Cost is judged against the other candidates, so the same model scores differently in a different field. */
export function scoreModel(profile: ModelProfile, policy: ModelPolicy, candidates: readonly ModelProfile[]): number {
  const costs = candidates.map((item) => item.costMicrosPer1k);
  const low = Math.min(...costs);
  const high = Math.max(...costs);
  const parts = {
    cost: high === low ? 1 : (high - profile.costMicrosPer1k) / (high - low), quality: (profile.quality - 1) / 4, speed: (profile.speed - 1) / 4, privacy: PRIVACY_RANK[profile.privacy] / PRIVACY_RANK.local,
  };
  const w = policy.weights;
  return Math.round(((parts.cost * w.cost + parts.quality * w.quality + parts.speed * w.speed + parts.privacy * w.privacy) / (w.cost + w.quality + w.speed + w.privacy)) * 100);
}

/** How sure the recommendation is: a clear lead, a single fit, or a close call, lowered when the budget is nearly used. */
export function confidenceOf(ranking: readonly RankedModel[], withinBudget: boolean, budgetMicros: number | null): Confidence {
  const first = ranking[0];
  if (!first || !withinBudget) return "low";
  const second = ranking[1];
  const lead = second ? first.score - second.score : 100;
  let level: Confidence = lead >= 15 ? "high" : lead >= 5 ? "medium" : "low";
  if (level === "high" && budgetMicros !== null && first.estimatedCostMicros > budgetMicros * 0.8) level = "medium";
  return level;
}

/**
 * Recommends a model. On a tie in the score, a high or critical priority prefers the better model and any other priority prefers the cheaper one.
 * The budget never removes a model: the answer says whether the recommendation is within it, and KOE decides what to do.
 */
export function optimize(input: OptimizerInput): Recommendation {
  const policy = policyFor(input.policy);
  const models = input.models ?? MODEL_REGISTRY;
  const rejected: Recommendation["rejected"] = [];
  const eligible: ModelProfile[] = [];
  for (const profile of models) {
    const reasons = rejections(profile, input, policy);
    if (reasons.length === 0) eligible.push(profile); else rejected.push({ model: profile.id, reasons });
  }
  const tokens = input.size.inputTokens + input.size.outputTokens;
  const prefersQuality = PRIORITY_RANK[input.priority] >= PRIORITY_RANK.high;
  const ranked = eligible
    .map((profile) => ({ profile, score: scoreModel(profile, policy, eligible), estimatedCostMicros: costOf(profile, tokens) }))
    .sort((a, b) => b.score - a.score || (prefersQuality ? b.profile.quality - a.profile.quality : 0) || a.estimatedCostMicros - b.estimatedCostMicros || a.profile.id.localeCompare(b.profile.id));
  const ranking: RankedModel[] = ranked.map((item) => ({ model: item.profile.id, label: item.profile.label, score: item.score, estimatedCostMicros: item.estimatedCostMicros }));
  const top = ranking[0];
  const estimatedCostMicros = top?.estimatedCostMicros ?? 0;
  const withinBudget = input.budgetMicros === null || estimatedCostMicros <= input.budgetMicros;
  return {
    model: top?.model ?? null, alternatives: ranking.slice(1).map((item) => item.model), ranking, rejected, estimatedCostMicros, withinBudget,
    confidence: confidenceOf(ranking, withinBudget, input.budgetMicros),
    reason: top ? `${top.label} · ${policy.label} · puntaje ${top.score}` : `ningún modelo cumple: ${rejected.map((item) => `${item.model} (${item.reasons[0] ?? "?"})`).join("; ")}`,
  };
}
