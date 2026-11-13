// Worker Assignment: which Worker would take an item. A worker is eligible when it belongs to the item's company, is active (both in the roster and for the company, which decides who is active),
// has the item's specialty, is PERMITTED to do the item's action, and has capacity left (assigned and running items count). Among the eligible, the one with the lowest load (by its capacity), ties
// by id. A worker of another company, or an inactive one, is never assigned, whatever the roster says. Pure: nobody is called or told anything.

import type { OrchestratorEnv, OrchestratorWorker, QueueItem } from "./orchestrator-types";

export type Ineligible = "tenant" | "inactive" | "specialty" | "permission" | "capacity";
export type Eligibility = { ok: true } | { ok: false; reason: Ineligible };

/** `*`, the exact action id, or its family (`crm.*`). */
export const permits = (permissions: readonly string[], action: string): boolean => permissions.some((entry) => entry === "*" || entry === action || (entry.endsWith(".*") && action.startsWith(entry.slice(0, -1))));
/** Items that hold a worker's capacity: assigned, running and paused-while-held. */
const HOLDING = new Set(["Assigned", "Running", "Paused"]);
export function loadOf(items: readonly QueueItem[]): Map<string, number> {
  const load = new Map<string, number>();
  for (const item of items) if (item.workerId && HOLDING.has(item.state)) load.set(item.workerId, (load.get(item.workerId) ?? 0) + 1);
  return load;
}

/** Can this worker take this item right now? The reasons are checked in a fixed order, so the answer never changes. */
export function eligibility(worker: OrchestratorWorker, item: Pick<QueueItem, "tenantId" | "specialty" | "action">, env: OrchestratorEnv, load: ReadonlyMap<string, number>): Eligibility {
  if (worker.tenantId !== item.tenantId) return { ok: false, reason: "tenant" };
  if (worker.status !== "active" || !env.isWorkerActive(worker.tenantId, worker.id)) return { ok: false, reason: "inactive" };
  if (worker.specialty !== item.specialty) return { ok: false, reason: "specialty" };
  if (!permits(worker.permissions, item.action)) return { ok: false, reason: "permission" };
  if ((load.get(worker.id) ?? 0) >= worker.capacity) return { ok: false, reason: "capacity" };
  return { ok: true };
}
export type Choice = { workerId?: string; rejected: Readonly<Record<Ineligible, number>> };
/** The worker that takes the item: the least loaded of the eligible (load ÷ capacity, then load, then id). Says why the others were not, in counts. */
export function chooseWorker(item: Pick<QueueItem, "tenantId" | "specialty" | "action">, workers: readonly OrchestratorWorker[], env: OrchestratorEnv, load: ReadonlyMap<string, number>): Choice {
  const rejected: Record<Ineligible, number> = { tenant: 0, inactive: 0, specialty: 0, permission: 0, capacity: 0 };
  const eligible: OrchestratorWorker[] = [];
  for (const worker of workers) {
    const result = eligibility(worker, item, env, load);
    if (result.ok) eligible.push(worker); else rejected[result.reason] += 1;
  }
  eligible.sort((a, b) => (load.get(a.id) ?? 0) / Math.max(1, a.capacity) - (load.get(b.id) ?? 0) / Math.max(1, b.capacity) || (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0) || a.id.localeCompare(b.id));
  return { ...(eligible[0] ? { workerId: eligible[0].id } : {}), rejected };
}
/** Is there ANY worker that could ever take this item (ignoring how busy they are)? If not, the item is blocked, not just waiting. */
export function anyoneCould(item: Pick<QueueItem, "tenantId" | "specialty" | "action">, workers: readonly OrchestratorWorker[], env: OrchestratorEnv): boolean {
  return workers.some((worker) => { const result = eligibility(worker, item, env, new Map()); return result.ok; });
}
