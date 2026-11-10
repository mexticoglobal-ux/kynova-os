// ModelPerformance: the contract for FUTURE learning. One day KOE will read how each model really performed on each specialty (how often it succeeded, what it cost,
// how long it took, how good the answers were) and the AI Cost Optimizer will use it to recommend better. ARCHITECTURE ONLY: nothing records it, nothing reads it
// and the Optimizer does not take it into account today.

import type { AiSpecialty } from "./ai-decision";

export type ModelPerformance = {
  specialty: AiSpecialty;
  /** The internal model id (never a provider). */
  model: string;
  /** Share of calls that ended well, from 0 to 100. */
  successPercent: number;
  /** Average estimated cost of a call, in millionths of a dollar. */
  averageCostMicros: number;
  /** Average latency of a call, in milliseconds. */
  averageLatencyMs: number;
  /** Average quality of the answers, from 1 to 5. */
  averageQuality: number;
  /** How many calls the figures come from. */
  samples: number;
};

export const MODEL_PERFORMANCE_ARCHITECTURE = {
  implemented: false,
  scope: "tenant", // a company's results are never mixed with another's
  keyParts: ["tenantId", "specialty", "model"],
  readBy: "AI Cost Optimizer",
  writtenFrom: "the AI Gateway's call records plus a quality signal",
} as const;

export function validateModelPerformance(item: ModelPerformance): string[] {
  const issues: string[] = [];
  if (item.model.trim() === "") issues.push("model");
  if (item.successPercent < 0 || item.successPercent > 100) issues.push("successPercent");
  if (item.averageCostMicros < 0) issues.push("averageCostMicros");
  if (item.averageLatencyMs < 0) issues.push("averageLatencyMs");
  if (item.averageQuality < 1 || item.averageQuality > 5) issues.push("averageQuality");
  if (!Number.isInteger(item.samples) || item.samples < 0) issues.push("samples");
  return issues;
}
