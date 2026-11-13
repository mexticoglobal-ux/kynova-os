// Orchestrator Dashboard: the numbers a screen would draw, as plain data (no UI). Active plans, active and free workers, the queue, throughput, utilization, average time, retries, failures,
// bottlenecks, dependencies and completed plans. Only ONE company's data goes in and only that company's comes out; counts and ids, never the content of any step. Pure: the clock is handed in.

import { detectBlockages, } from "./scheduler";
import { queueOrder } from "./execution-queue";
import { loadOf } from "./worker-assignment";
import { ITEM_STATES, TERMINAL_ITEM, TERMINAL_RUN, type Blockage, type ItemState, type OrchestratorConfig, type OrchestratorEnv, type OrchestratorWorker, type QueueItem, type RunRecord } from "./orchestrator-types";

export type OrchestratorDashboard = {
  tenantId: string; at: string;
  plans: { active: { planId: string; status: RunRecord["status"]; priority: string; items: number; completed: number; progress: number }[]; completed: string[]; total: number };
  workers: { active: { workerId: string; load: number; capacity: number; running: number }[]; free: string[]; total: number };
  queue: { total: number; byState: Record<ItemState, number>; next: string[] };
  throughput: { windowMs: number; completed: number; perHour: number };
  utilization: { percent: number; used: number; capacity: number };
  averageMs: { execution: number; wait: number };
  retries: { items: number; attempts: number };
  failures: { items: number; plans: number; byCause: Record<string, number> };
  bottlenecks: { kind: string; ref: string; count: number }[];
  dependencies: { edges: number; waiting: number; mostDepended: { itemId: string; dependents: number }[] };
};

const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : Math.round(values.reduce((a, b) => a + b, 0) / values.length));
const pct = (part: number, whole: number): number => (whole <= 0 ? 0 : Math.round((part / whole) * 1000) / 10);

export function buildOrchestratorDashboard(input: { tenantId: string; at: string; runs: readonly RunRecord[]; queue: readonly QueueItem[]; workers: readonly OrchestratorWorker[]; env: OrchestratorEnv; config: OrchestratorConfig }): OrchestratorDashboard {
  const { tenantId, at, config } = input;
  const nowMs = Date.parse(at);
  // one company: whatever belongs to another does not exist here
  const runs = input.runs.filter((run) => run.tenantId === tenantId);
  const items = input.queue.filter((item) => item.tenantId === tenantId);
  const workers = input.workers.filter((worker) => worker.tenantId === tenantId && worker.status === "active" && input.env.isWorkerActive(tenantId, worker.id));
  const load = loadOf(items);

  const byState = Object.fromEntries(ITEM_STATES.map((state) => [state, 0])) as Record<ItemState, number>;
  for (const item of items) byState[item.state] += 1;

  const active = runs.filter((run) => !TERMINAL_RUN.includes(run.status)).map((run) => {
    const own = items.filter((item) => item.planId === run.planId);
    const done = own.filter((item) => item.state === "Completed").length;
    return { planId: run.planId, status: run.status, priority: run.priority, items: own.length, completed: done, progress: pct(done, own.length) };
  }).sort((a, b) => a.planId.localeCompare(b.planId));

  const capacity = workers.reduce((sum, worker) => sum + worker.capacity, 0);
  const used = workers.reduce((sum, worker) => sum + Math.min(worker.capacity, load.get(worker.id) ?? 0), 0);
  const running = new Map<string, number>();
  for (const item of items) if (item.state === "Running" && item.workerId) running.set(item.workerId, (running.get(item.workerId) ?? 0) + 1);

  const finished = items.filter((item) => item.state === "Completed" && item.completedAt && item.startedAt);
  const inWindow = finished.filter((item) => nowMs - Date.parse(item.completedAt as string) <= config.throughputWindowMs);
  const windowHours = Math.max(1 / 60, config.throughputWindowMs / 3_600_000);
  const retried = items.filter((item) => item.attempts > 0);
  const failed = items.filter((item) => item.state === "Failed");
  const byCause: Record<string, number> = {};
  for (const item of failed) byCause[item.lastFailure ?? "failed"] = (byCause[item.lastFailure ?? "failed"] ?? 0) + 1;

  // bottlenecks: saturated workers, the most depended-on steps, approvals and workers that never came, and whatever the scheduler calls blocked
  const bottlenecks: { kind: string; ref: string; count: number }[] = [];
  for (const worker of workers) if ((load.get(worker.id) ?? 0) >= worker.capacity && items.some((item) => item.state === "Ready" && item.specialty === worker.specialty)) bottlenecks.push({ kind: "workerSaturated", ref: worker.id, count: items.filter((item) => item.state === "Ready" && item.specialty === worker.specialty).length });
  const runMap = new Map(runs.map((run) => [run.planId, run]));
  const blockages: Blockage[] = detectBlockages(items, runMap, workers, input.env, nowMs, config.blockedAfterMs);
  const kinds = new Map<string, number>();
  for (const blockage of blockages) kinds.set(blockage.kind, (kinds.get(blockage.kind) ?? 0) + 1);
  for (const [kind, count] of [...kinds].sort((a, b) => a[0].localeCompare(b[0]))) bottlenecks.push({ kind, ref: "queue", count });

  const dependents = new Map<string, number>();
  let edges = 0;
  for (const item of items) for (const dep of item.dependsOn) { edges += 1; dependents.set(dep, (dependents.get(dep) ?? 0) + 1); }
  const mostDepended = [...dependents].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([itemId, count]) => ({ itemId, dependents: count }));
  for (const entry of mostDepended) bottlenecks.push({ kind: "dependencyFanOut", ref: entry.itemId, count: entry.dependents });

  return {
    tenantId, at,
    plans: { active, completed: runs.filter((run) => run.status === "Completed").map((run) => run.planId).sort(), total: runs.length },
    workers: {
      active: workers.filter((worker) => (load.get(worker.id) ?? 0) > 0).map((worker) => ({ workerId: worker.id, load: load.get(worker.id) ?? 0, capacity: worker.capacity, running: running.get(worker.id) ?? 0 })).sort((a, b) => a.workerId.localeCompare(b.workerId)),
      free: workers.filter((worker) => (load.get(worker.id) ?? 0) < worker.capacity).map((worker) => worker.id).sort(), total: workers.length,
    },
    queue: { total: items.filter((item) => !TERMINAL_ITEM.includes(item.state)).length, byState, next: queueOrder(items.filter((item) => item.state === "Assigned" || item.state === "Ready")).slice(0, 5).map((item) => item.id) },
    throughput: { windowMs: config.throughputWindowMs, completed: inWindow.length, perHour: Math.round((inWindow.length / windowHours) * 100) / 100 },
    utilization: { percent: pct(used, capacity), used, capacity },
    averageMs: {
      execution: mean(finished.map((item) => Date.parse(item.completedAt as string) - Date.parse(item.startedAt as string))),
      wait: mean(items.filter((item) => item.startedAt).map((item) => Date.parse(item.startedAt as string) - Date.parse(item.enqueuedAt))),
    },
    retries: { items: retried.length, attempts: retried.reduce((sum, item) => sum + item.attempts, 0) },
    failures: { items: failed.length, plans: runs.filter((run) => run.status === "Failed").length, byCause },
    bottlenecks, dependencies: { edges, waiting: byState.WaitingDependencies, mostDepended },
  };
}
