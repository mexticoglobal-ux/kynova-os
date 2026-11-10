// AIDecision: the contract KOE produces for every AI request, and the ONLY thing it decides. Who does the work (Worker), what kind of work it is (specialty),
// how urgent (priority), which rule of the company applies (policy), how much may be spent, how sensitive the data is and how long it may take.
// It NEVER carries a provider or a model: those are chosen later, by the AI Cost Optimizer (which model) and the AI Gateway (which provider).
//
// The official flow:  Module -> KOE -> AI Cost Optimizer -> AI Gateway -> AI provider.
// Each step knows only the step it hands over to, and each reads the fields it needs from this contract or from its own narrower input.

import type { Clearance, Priority } from "./koe-registry";

/** What kind of work the AI does. KOE names it; the Optimizer turns it into the capabilities a model must have. */
export const AI_SPECIALTIES = ["conversation", "summarization", "analysis", "writing", "longDocument", "code", "tutoring", "embedding"] as const;
export type AiSpecialty = (typeof AI_SPECIALTIES)[number];

export const POLICY_IDS = ["costFirst", "qualityFirst", "speedFirst", "privacyFirst", "balanced"] as const;
export type PolicyId = (typeof POLICY_IDS)[number];

export type AIDecision = {
  id: string;
  tenantId: string;
  workerId: string;
  specialty: AiSpecialty;
  policy: PolicyId;
  priority: Priority;
  /** What the company may still spend this month, in millionths of a dollar. `null` means no limit. */
  budgetMicros: number | null;
  /** How sensitive the data of this request is. */
  privacy: Clearance;
  /** The longest the whole request may take, in milliseconds. */
  maxTimeMs: number;
};

/** The names a decision must never contain, at any depth: choosing a provider or a model is not KOE's job. */
export const FORBIDDEN_DECISION_KEYS = ["provider", "providerId", "model", "modelId", "models", "allowedModels"] as const;

/** The issues of a decision. Empty when it is valid. Extra fields are refused, so a provider or a model can never travel inside it. */
export function validateDecision(value: unknown): string[] {
  const issues: string[] = [];
  if (typeof value !== "object" || value === null) return ["decisión"];
  const record = value as Record<string, unknown>;
  const expected = ["id", "tenantId", "workerId", "specialty", "policy", "priority", "budgetMicros", "privacy", "maxTimeMs"];
  for (const key of Object.keys(record)) {
    if (!expected.includes(key)) issues.push((FORBIDDEN_DECISION_KEYS as readonly string[]).includes(key) ? `${key} (no lo decide KOE)` : `campo desconocido: ${key}`);
  }
  for (const key of ["id", "tenantId", "workerId"]) if (typeof record[key] !== "string" || record[key] === "") issues.push(key);
  if (!AI_SPECIALTIES.includes(record["specialty"] as AiSpecialty)) issues.push("specialty");
  if (!POLICY_IDS.includes(record["policy"] as PolicyId)) issues.push("policy");
  if (!["low", "normal", "high", "critical"].includes(record["priority"] as string)) issues.push("priority");
  if (!["public", "business", "personal"].includes(record["privacy"] as string)) issues.push("privacy");
  const budget = record["budgetMicros"];
  if (budget !== null && (typeof budget !== "number" || !Number.isInteger(budget) || budget < 0)) issues.push("budgetMicros");
  const time = record["maxTimeMs"];
  if (typeof time !== "number" || !Number.isInteger(time) || time <= 0) issues.push("maxTimeMs");
  return issues;
}
