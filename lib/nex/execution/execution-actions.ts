// Execution Actions: what each catalog action means for a plan: the module it belongs to, the kind of worker it needs, the connector it would use, what must happen before it, how it is undone, and
// its limits (timeout, retries, time and cost estimates), which depend on its autonomy level. The level itself is the platform's (workers.ts, decided in code, unknown = Level 3). Pure data and
// pure functions: nothing here runs an action.

import type { ConnectorId } from "@/lib/contracts/platform/connectors";
import type { AutonomyLevel, InvolvedModule, RetryPolicy, RollbackPolicy } from "./execution-types";

/** The module an action belongs to, by the family of its id. */
export function moduleOfAction(action: string): InvolvedModule {
  const family = action.split(".")[0] ?? "";
  const known: Readonly<Record<string, InvolvedModule>> = {
    crm: "crm", comms: "comms", message: "comms", followup: "comms", insights: "insights", billing: "billing", payment: "payments", studio: "workers", org: "organization", marketplace: "marketplace",
    academy: "academy", referral: "referrals", calendar: "integrations", task: "organization", summary: "knowledge", reminder: "organization", notification: "organization", lead: "sales", opportunity: "sales", customer: "crm",
  };
  return known[family] ?? "organization";
}
/** The kind of worker (its specialty in the roster) that would do an action. */
export function specialtyOfAction(action: string): string {
  const family = action.split(".")[0] ?? "";
  if (["crm", "message", "followup", "lead", "opportunity", "customer"].includes(family)) return "sales";
  if (["comms"].includes(family)) return "support";
  if (["insights", "billing", "payment"].includes(family)) return "finance";
  if (["marketplace", "academy"].includes(family)) return "marketing";
  return "operations";
}
/** The connector an action would use when it leaves the platform. Drafts and internal work use none. */
export const ACTION_CONNECTOR: Readonly<Record<string, ConnectorId>> = { "followup.send": "gmail", "message.sendFirst": "gmail", "message.sendSensitive": "gmail", "calendar.write": "googleCalendar" };
/** Actions that must come first when both are in the same plan. (Every Level 3 step also waits for the lower levels: preparing comes before acting.) */
export const ACTION_PREREQS: Readonly<Record<string, readonly string[]>> = { "followup.send": ["message.draft", "crm.draft", "crm.task"], "studio.assign": ["studio.test", "studio.draft"] };

/** Limits by autonomy level: the riskier the action, the longer it may take, the fewer times it is retried, and the more it is estimated to cost. */
export const LEVEL_PROFILE: Readonly<Record<AutonomyLevel, { timeoutMs: number; retry: RetryPolicy; aiMicros: number; estimatedMs: number }>> = {
  1: { timeoutMs: 30_000, retry: { maxAttempts: 3, backoffMs: 1_000 }, aiMicros: 20_000, estimatedMs: 5_000 },
  2: { timeoutMs: 60_000, retry: { maxAttempts: 2, backoffMs: 2_000 }, aiMicros: 40_000, estimatedMs: 15_000 },
  3: { timeoutMs: 120_000, retry: { maxAttempts: 1, backoffMs: 5_000 }, aiMicros: 60_000, estimatedMs: 30_000 },
};
/** What one call to a connector is estimated to cost. */
export const API_COST_MICROS = 2_000;

/** How a step is undone. A draft or an internal task leaves nothing to undo; a step inside a standing authorization is compensated; a step that leaves the platform (Level 3) needs a person. */
export function rollbackFor(action: string, level: AutonomyLevel): { policy: RollbackPolicy; compensationAction?: string } {
  if (level === 1) return { policy: "none" };
  if (level === 2) return { policy: "compensate", compensationAction: `${action}.undo` };
  return { policy: "manual", compensationAction: `${action}.manual-review` };
}
