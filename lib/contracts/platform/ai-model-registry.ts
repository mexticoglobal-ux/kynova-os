// The model registry and the five policies: the DATA the AI Cost Optimizer works from. A model here is a PROFILE (what it can do, what it costs, how fast, how
// private): it carries no provider. Which provider serves a model is the AI Gateway's business (gateway-catalog.ts). A new model or policy is a new entry here,
// never a change to the Optimizer. Nothing here calls anything.

import type { Clearance, DataPolicy, ModelClass } from "./koe-registry";
import type { PolicyId } from "./ai-decision";

export type Speed = 1 | 2 | 3 | 4 | 5; // 5 = the fastest
export type Quality = 1 | 2 | 3 | 4 | 5; // 5 = the best
export type ModelPrivacy = DataPolicy | "local"; // "local": the data never leaves the platform

/** One entry of the registry. `id` is the INTERNAL name (stable, what the code uses); `label` is what a person sees. */
export type ModelProfile = {
  id: string;
  label: string;
  capabilities: readonly ModelClass[];
  costMicrosPer1k: number; // millionths of a dollar per 1 000 tokens (input and output together), an integer
  maxContextTokens: number;
  speed: Speed;
  baseLatencyMs: number;
  quality: Quality;
  privacy: ModelPrivacy;
  regions: readonly string[];
  supportsTools: boolean;
  enabled: boolean;
};

const model = (id: string, label: string, capabilities: ModelClass[], costMicrosPer1k: number, maxContextTokens: number, speed: Speed, baseLatencyMs: number, quality: Quality, privacy: ModelPrivacy, regions: string[], supportsTools: boolean): ModelProfile => (
  { id, label, capabilities, costMicrosPer1k, maxContextTokens, speed, baseLatencyMs, quality, privacy, regions, supportsTools, enabled: true }
);

// Illustrative catalog with INTERNAL names. The visible label names a role, never a vendor's product.
export const MODEL_REGISTRY: readonly ModelProfile[] = [
  model("gw-fast-1", "Rápido (1)", ["fast", "multilingual"], 150, 32_000, 5, 250, 2, "noTraining", ["us", "eu"], true),
  model("gw-reason-1", "Razonamiento (1)", ["reasoning", "longContext", "multilingual", "code"], 3_000, 200_000, 2, 1_400, 5, "noTraining", ["us", "eu"], true),
  model("gw-balanced-1", "Equilibrado (1)", ["reasoning", "fast", "multilingual", "vision"], 900, 128_000, 4, 500, 4, "noTraining", ["us", "eu"], true),
  model("gw-eu-1", "Europa (1)", ["fast", "multilingual", "code"], 500, 64_000, 4, 400, 3, "noTraining", ["eu"], true),
  model("gw-live-1", "Conversación en vivo (1)", ["fast", "reasoning"], 1_200, 64_000, 4, 450, 3, "unknown", ["us"], true),
  model("gw-econ-1", "Económico (1)", ["reasoning", "code", "multilingual"], 100, 64_000, 3, 800, 3, "mayTrain", ["asia"], true),
  model("gw-route-1", "Agregador (1)", ["fast", "multilingual"], 400, 32_000, 3, 700, 3, "unknown", ["us", "eu"], true),
  model("gw-local-1", "Local privado (1)", ["fast", "multilingual"], 40, 8_000, 3, 600, 2, "local", ["us", "eu", "asia"], false),
  model("gw-embed-1", "Embeddings (1)", ["embedding"], 10, 8_000, 5, 120, 3, "local", ["us", "eu", "asia"], false),
];
export const modelProfile = (id: string): ModelProfile | undefined => MODEL_REGISTRY.find((item) => item.id === id);
/** The ids that are not in the registry. */
export const unknownModels = (ids: readonly string[]): string[] => ids.filter((id) => !modelProfile(id));
export const knownRegion = (region: string): boolean => MODEL_REGISTRY.some((item) => item.regions.includes(region));
export const costOf = (profile: ModelProfile, tokens: number): number => Math.ceil((tokens / 1_000) * profile.costMicrosPer1k);

export function validateModelProfile(item: ModelProfile): string[] {
  const issues: string[] = [];
  if (!/^[a-z][a-z0-9-]{2,40}$/.test(item.id)) issues.push("nombre interno");
  if (item.label.trim() === "") issues.push("etiqueta visible");
  if (item.capabilities.length === 0) issues.push("capacidades");
  if (!Number.isInteger(item.costMicrosPer1k) || item.costMicrosPer1k < 0) issues.push("costo estimado");
  if (!Number.isInteger(item.maxContextTokens) || item.maxContextTokens <= 0) issues.push("contexto");
  if (item.speed < 1 || item.speed > 5 || item.quality < 1 || item.quality > 5) issues.push("velocidad o calidad");
  if (item.regions.length === 0) issues.push("regiones");
  return issues;
}

// ---------------------------------------------------------------- policies
export type PolicyWeights = { cost: number; quality: number; speed: number; privacy: number };
export type ModelPolicy = { id: PolicyId; label: string; summary: string; weights: PolicyWeights; /** a hard rule on top of the weights */ minPrivacyRank: number };
export const PRIVACY_RANK: Record<ModelPrivacy, number> = { unknown: 0, mayTrain: 1, noTraining: 2, local: 3 };

export const MODEL_POLICIES: readonly ModelPolicy[] = [
  { id: "costFirst", label: "Costo primero", summary: "El modelo más barato que cumpla la tarea.", weights: { cost: 6, quality: 1, speed: 1, privacy: 1 }, minPrivacyRank: 0 },
  { id: "qualityFirst", label: "Calidad primero", summary: "El mejor modelo disponible, sin importar el costo.", weights: { cost: 1, quality: 6, speed: 1, privacy: 1 }, minPrivacyRank: 0 },
  { id: "speedFirst", label: "Velocidad primero", summary: "El que responde más rápido.", weights: { cost: 1, quality: 1, speed: 6, privacy: 1 }, minPrivacyRank: 0 },
  { id: "privacyFirst", label: "Privacidad primero", summary: "Solo modelos que no entrenan con los datos; los datos personales, solo en modelos locales.", weights: { cost: 1, quality: 1, speed: 1, privacy: 6 }, minPrivacyRank: PRIVACY_RANK.noTraining },
  { id: "balanced", label: "Equilibrada", summary: "Un balance entre costo, calidad, velocidad y privacidad.", weights: { cost: 2, quality: 2, speed: 2, privacy: 2 }, minPrivacyRank: 0 },
];
export const DEFAULT_POLICY: PolicyId = "balanced";
export const policyById = (id: string): ModelPolicy | undefined => MODEL_POLICIES.find((item) => item.id === id);
export const policyFor = (id: string): ModelPolicy => policyById(id) ?? (MODEL_POLICIES.find((item) => item.id === DEFAULT_POLICY) as ModelPolicy);

/** The privacy a model must have for the data it will see: a hard rule, not a preference. */
export function requiredPrivacy(clearance: Clearance, policy: ModelPolicy): number {
  const base = clearance === "public" ? 0 : PRIVACY_RANK.noTraining;
  const strict = policy.id === "privacyFirst" && clearance === "personal" ? PRIVACY_RANK.local : base;
  return Math.max(base, strict, policy.minPrivacyRank);
}
