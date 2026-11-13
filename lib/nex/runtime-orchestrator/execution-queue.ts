// Execution Queue: the items (one per step of an approved plan), their eleven states and the rules that move them. An item is evaluated from FACTS, never from a hunch: not authorized → WaitingApproval;
// authorized but something it depends on is not Completed → WaitingDependencies; backing off after a failure → Pending; otherwise Ready, or Assigned once a worker holds it. Starting, pausing, retrying,
// finishing and cancelling are separate moves with a closed table of allowed changes. Pure: the clock is handed in.

import { PRIORITY_RANK, roleRank } from "@/lib/nex/execution";
import { waitingFor } from "./dependency-graph";
import type { ExecutionPlan, ItemState, QueueItem, RunRecord } from "./orchestrator-types";

/** The changes that exist. A re-evaluation can move an item among Pending, WaitingApproval, WaitingDependencies, Ready and Assigned; the rest are one-way or explicit. */
const EVALUATED: readonly ItemState[] = ["Pending", "WaitingApproval", "WaitingDependencies", "Ready", "Assigned"];
export const ITEM_TRANSITIONS: Readonly<Record<ItemState, readonly ItemState[]>> = {
  Pending: [...EVALUATED.filter((state) => state !== "Pending"), "Paused", "Cancelled", "Expired"],
  WaitingApproval: [...EVALUATED.filter((state) => state !== "WaitingApproval"), "Paused", "Cancelled", "Expired"],
  WaitingDependencies: [...EVALUATED.filter((state) => state !== "WaitingDependencies"), "Paused", "Cancelled", "Expired"],
  Ready: [...EVALUATED.filter((state) => state !== "Ready"), "Paused", "Cancelled", "Expired"],
  Assigned: [...EVALUATED.filter((state) => state !== "Assigned"), "Running", "Paused", "Cancelled", "Expired"],
  Running: ["Paused", "Completed", "Failed", "Pending", "Cancelled"],
  Paused: ["Pending", "Running", "Cancelled", "Expired"],
  Completed: [], Failed: [], Cancelled: [], Expired: [],
};
export const canMove = (from: ItemState, to: ItemState): boolean => ITEM_TRANSITIONS[from].includes(to);

/** The order the queue is served in: priority, then expected impact, then who has waited longest, then id (so ties never change). */
export function queueOrder<T extends Pick<QueueItem, "priority" | "impact" | "enqueuedAt" | "id">>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.impact - a.impact || a.enqueuedAt.localeCompare(b.enqueuedAt) || a.id.localeCompare(b.id));
}

/** The queue items of an approved plan: one per step, nothing assigned yet. The worker the plan suggested is only a hint and is ignored: the orchestrator assigns with its own roster. */
export function itemsOfPlan(plan: ExecutionPlan, at: string): QueueItem[] {
  return plan.steps.map((step) => ({
    id: step.id, tenantId: plan.tenantId, planId: plan.id, stepId: step.id, action: step.action, level: step.authorizationLevel, approverRole: step.approverRole, priority: plan.priority, impact: plan.expectedImpact.score,
    needs: plan.needs, specialty: step.worker.specialty, ...(step.connector ? { connector: step.connector } : {}), state: "Pending" as const, attempts: 0, maxAttempts: step.retry.maxAttempts, backoffMs: step.retry.backoffMs,
    timeoutMs: step.timeoutMs, estimatedMs: step.estimatedMs, dependsOn: [...step.dependsOn].sort(), planDependsOn: [...plan.dependsOn].sort(), enqueuedAt: at,
  }));
}

/**
 * Is this item authorized to run? Only if its plan was approved by a person whose role reaches the level of the item's action (1 a member, 2 a manager, 3 an administrator) and the run is alive.
 * An approver whose role is unknown authorizes nothing: no step is ever run on an approval nobody can check.
 */
export const authorized = (item: Pick<QueueItem, "approverRole">, run: Pick<RunRecord, "approverRole" | "status"> | undefined): boolean =>
  run !== undefined && run.approverRole !== undefined && roleRank(run.approverRole) >= roleRank(item.approverRole) && run.status !== "Cancelled" && run.status !== "Expired" && run.status !== "Failed";

export type EvaluateContext = { nowMs: number; byId: ReadonlyMap<string, QueueItem>; runs: ReadonlyMap<string, RunRecord> };
/** The state an item that is not running, paused or finished should be in. Releases the worker if the item has to wait again. */
export function evaluate(item: QueueItem, context: EvaluateContext): QueueItem {
  if (!EVALUATED.includes(item.state)) return item;
  const { workerId: held, ...bare } = item;
  const next = (state: ItemState, keepWorker = false): QueueItem => ({ ...(keepWorker && held ? { ...bare, workerId: held } : bare), state });
  if (!authorized(item, context.runs.get(item.planId))) return next("WaitingApproval");
  if (waitingFor(item, context.byId, context.runs).length > 0) return next("WaitingDependencies");
  if (item.notBeforeMs !== undefined && item.notBeforeMs > context.nowMs) return next("Pending");
  return held ? next("Assigned", true) : next("Ready");
}
/** Re-evaluates every item of the queue against the others (dependencies are read from the queue as it was before this pass, so the result never depends on the order). */
export function refreshQueue(items: readonly QueueItem[], runs: ReadonlyMap<string, RunRecord>, nowMs: number): QueueItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return items.map((item) => evaluate(item, { nowMs, byId, runs }));
}
