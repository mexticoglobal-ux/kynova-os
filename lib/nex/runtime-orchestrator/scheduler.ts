// Scheduler: what the queue would do next, as lists. It orders by priority, respects dependencies and authorizations (an item is only dispatchable when it is Assigned, which means authorized, with every
// dependency Completed and a worker holding it), controls retries (with exponential backoff), controls timeouts, and detects blockages: an item that waits for something that failed, a plan nobody can
// do, an approval that never came, a dependency that is not even queued, a cycle. It orders; it never runs anything. Pure: the clock is handed in.

import { deadDependencies, graphIsAcyclic, waitingFor } from "./dependency-graph";
import { queueOrder } from "./execution-queue";
import { anyoneCould } from "./worker-assignment";
import type { Blockage, Dispatch, OrchestratorEnv, OrchestratorWorker, QueueItem, RunRecord } from "./orchestrator-types";

/** Exponential backoff after the nth failed attempt: base, 2×base, 4×base…, never more than the cap. */
export const backoffFor = (attempt: number, baseMs: number, maxMs: number): number => Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));

/** What the Runtime would be asked to start now: the Assigned items of runs that are not paused, in queue order. */
export function dispatchList(items: readonly QueueItem[], runs: ReadonlyMap<string, RunRecord>): Dispatch[] {
  return queueOrder(items.filter((item) => item.state === "Assigned" && item.workerId !== undefined && runs.get(item.planId)?.paused !== true))
    .map((item, order): Dispatch => ({ order: order + 1, itemId: item.id, planId: item.planId, workerId: item.workerId as string, action: item.action, level: item.level }));
}
/** The running items whose time is up. */
export const detectTimeouts = (items: readonly QueueItem[], nowMs: number): QueueItem[] =>
  queueOrder(items.filter((item) => item.state === "Running" && item.deadlineAt !== undefined && Date.parse(item.deadlineAt) <= nowMs));
/** After a failed attempt: retry (after a backoff) while attempts remain, otherwise the item fails. */
export function retryDecision(item: Pick<QueueItem, "attempts" | "maxAttempts" | "backoffMs">, nowMs: number, maxBackoffMs: number): { retry: boolean; attempts: number; notBeforeMs?: number } {
  const attempts = item.attempts + 1;
  return attempts < item.maxAttempts ? { retry: true, attempts, notBeforeMs: nowMs + backoffFor(attempts, item.backoffMs, maxBackoffMs) } : { retry: false, attempts };
}

/** What is stuck, and for how long. Waiting for a busy worker is not a blockage; waiting for something that can never happen is. */
export function detectBlockages(items: readonly QueueItem[], runs: ReadonlyMap<string, RunRecord>, workers: readonly OrchestratorWorker[], env: OrchestratorEnv, nowMs: number, blockedAfterMs: number): Blockage[] {
  const found: Blockage[] = [];
  const waited = (item: QueueItem) => Math.max(0, nowMs - Date.parse(item.enqueuedAt));
  for (const item of deadDependencies(items, runs)) found.push({ kind: "dependencyFailed", planId: item.planId, itemId: item.id, waitedMs: waited(item) });
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of items.filter((row) => row.state === "WaitingDependencies")) {
    if (waitingFor(item, byId, runs).some((wait) => wait.kind === "plan" && wait.state === "NotQueued")) found.push({ kind: "dependencyNotQueued", planId: item.planId, itemId: item.id, waitedMs: waited(item) });
  }
  for (const item of items.filter((row) => row.state === "Ready")) if (!anyoneCould(item, workers, env)) found.push({ kind: "noWorker", planId: item.planId, itemId: item.id, waitedMs: waited(item) });
  for (const item of items.filter((row) => row.state === "WaitingApproval")) if (waited(item) >= blockedAfterMs) found.push({ kind: "waitingApproval", planId: item.planId, itemId: item.id, waitedMs: waited(item) });
  if (!graphIsAcyclic(items)) found.push({ kind: "cycle", planId: items[0]?.planId ?? "", waitedMs: 0 });
  return found.sort((a, b) => a.kind.localeCompare(b.kind) || a.planId.localeCompare(b.planId) || (a.itemId ?? "").localeCompare(b.itemId ?? ""));
}
