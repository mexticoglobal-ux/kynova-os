// Worker Runtime Scheduler: which Worker takes which task. A task goes only to a worker of ITS company, in a state that accepts work (Idle, Reserved, WaitingApproval or Busy: never Offline, Failed,
// Maintenance, Paused, Stopped or any other), that is not draining for a pause or maintenance, with the task's specialty, PERMITTED to do its action, running a compatible version with the capabilities the
// task needs, and with room: a free slot, or else a free place in its queue. Tasks are served by priority, then who waited longest, then id. It never exceeds `maxConcurrent` or `queueLimit`. Pure.

import { HELD, PRIORITY_RANK, compareVersions, type Placement, type Task, type WorkerRecord, type WorkerRuntimeConfig } from "./worker-runtime-types";

export type Ineligible = "tenant" | "state" | "draining" | "specialty" | "permission" | "version" | "capabilities" | "capacity";
export type Load = { slots: number; queued: number };
/** The states that accept new work. */
export const ASSIGNABLE: readonly WorkerRecord["state"][] = ["Idle", "Reserved", "WaitingApproval", "Busy"];
const SLOT: readonly Task["status"][] = ["awaitingApproval", "reserved", "running", "retrying"];

/** `*`, the exact action id, or its family (`crm.*`). */
export const permits = (permissions: readonly string[], action: string): boolean => permissions.some((entry) => entry === "*" || entry === action || (entry.endsWith(".*") && action.startsWith(entry.slice(0, -1))));

/** What each worker holds right now: slots (running, reserved, awaiting approval, retrying) and queued tasks. */
export function loadOf(tasks: readonly Task[]): Map<string, Load> {
  const load = new Map<string, Load>();
  for (const task of tasks) {
    if (!task.workerId || !HELD.includes(task.status)) continue;
    const row = load.get(task.workerId) ?? { slots: 0, queued: 0 };
    if (SLOT.includes(task.status)) row.slots += 1; else row.queued += 1;
    load.set(task.workerId, row);
  }
  return load;
}

export type Eligibility = { ok: true; slot: Placement["slot"] } | { ok: false; reason: Ineligible };
/** Can this worker take this task right now? The reasons are checked in a fixed order, so the answer never changes. */
export function eligibility(worker: WorkerRecord, task: Pick<Task, "tenantId" | "specialty" | "action" | "minVersion" | "capabilities" | "requiresApproval">, load: Load, config: Pick<WorkerRuntimeConfig, "minWorkerVersion">): Eligibility {
  if (worker.tenantId !== task.tenantId) return { ok: false, reason: "tenant" };
  if (!ASSIGNABLE.includes(worker.state)) return { ok: false, reason: "state" };
  if (worker.pending !== undefined) return { ok: false, reason: "draining" };
  if (worker.specialty !== task.specialty) return { ok: false, reason: "specialty" };
  if (!permits(worker.permissions, task.action)) return { ok: false, reason: "permission" };
  if (compareVersions(worker.version, config.minWorkerVersion) < 0 || (task.minVersion !== undefined && compareVersions(worker.version, task.minVersion) < 0)) return { ok: false, reason: "version" };
  if (!task.capabilities.every((capability) => worker.capabilities.includes(capability))) return { ok: false, reason: "capabilities" };
  if (load.slots < worker.maxConcurrent) return { ok: true, slot: task.requiresApproval ? "awaitingApproval" : "reserved" };
  if (load.queued < worker.queueLimit) return { ok: true, slot: "queued" };
  return { ok: false, reason: "capacity" };
}

/** The order the pending tasks are served in: priority, then who waited longest, then id. */
export const taskOrder = (tasks: readonly Task[]): Task[] => [...tasks].sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || a.submittedAt.localeCompare(b.submittedAt) || a.id.localeCompare(b.id));

/** Places every pending task that can be placed (one pass, load updated as it goes) and says why the others could not. */
export function planAssignments(workers: readonly WorkerRecord[], tasks: readonly Task[], nowMs: number, config: Pick<WorkerRuntimeConfig, "minWorkerVersion">): { placements: Placement[]; unplaced: { taskId: string; reasons: string[] }[] } {
  const load = loadOf(tasks);
  const placements: Placement[] = [];
  const unplaced: { taskId: string; reasons: string[] }[] = [];
  const pool = [...workers].sort((a, b) => a.id.localeCompare(b.id));
  for (const task of taskOrder(tasks.filter((row) => row.status === "pending" && (row.notBeforeMs === undefined || row.notBeforeMs <= nowMs)))) {
    const reasons = new Set<string>();
    const fits: { worker: WorkerRecord; slot: Placement["slot"]; ratio: number }[] = [];
    for (const worker of pool) {
      const row = load.get(worker.id) ?? { slots: 0, queued: 0 };
      const result = eligibility(worker, task, row, config);
      if (result.ok) fits.push({ worker, slot: result.slot, ratio: (row.slots + row.queued) / Math.max(1, worker.maxConcurrent) }); else reasons.add(result.reason);
    }
    fits.sort((a, b) => a.ratio - b.ratio || a.worker.id.localeCompare(b.worker.id));
    const best = fits[0];
    if (!best) { unplaced.push({ taskId: task.id, reasons: pool.length === 0 ? ["noWorkers"] : [...reasons].sort() }); continue; }
    const row = load.get(best.worker.id) ?? { slots: 0, queued: 0 };
    if (best.slot === "queued") row.queued += 1; else row.slots += 1;
    load.set(best.worker.id, row);
    placements.push({ taskId: task.id, workerId: best.worker.id, slot: best.slot });
  }
  return { placements, unplaced };
}

/** Exponential backoff after the nth failed attempt: base, 2×base, 4×base…, never more than the cap. */
export const backoffFor = (attempt: number, baseMs: number, maxMs: number): number => Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
/** After a failed attempt: retry (after a backoff) while attempts remain. Only retryable errors ever get here; a fatal error is never retried. */
export function retryDecision(task: Pick<Task, "attempts" | "maxAttempts">, nowMs: number, config: Pick<WorkerRuntimeConfig, "backoffMs" | "maxBackoffMs">): { retry: boolean; attempts: number; notBeforeMs?: number } {
  const attempts = task.attempts + 1;
  return attempts < task.maxAttempts ? { retry: true, attempts, notBeforeMs: nowMs + backoffFor(attempts, config.backoffMs, config.maxBackoffMs) } : { retry: false, attempts };
}
