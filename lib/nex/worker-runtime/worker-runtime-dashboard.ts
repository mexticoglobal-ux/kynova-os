// Worker Runtime Dashboard: the numbers a screen would draw, as plain data (no UI). Workers in total and by state, average health, capacity used, queues and versions. Only ONE company's workers go in
// and only that company's numbers come out; ids and counts, never the content of any task. Pure: the clock is handed in.

import { healthScore } from "./worker-runtime-health";
import { loadOf } from "./worker-runtime-scheduler";
import { WORKER_STATES, type Task, type WorkerRecord, type WorkerRuntimeConfig, type WorkerState } from "./worker-runtime-types";

export type WorkerRuntimeDashboard = {
  tenantId: string; at: string;
  workers: { total: number; idle: number; busy: number; offline: number; failed: number; maintenance: number; byState: Record<WorkerState, number> };
  health: { average: number; lowest: { workerId: string; score: number }[] };
  capacity: { used: number; total: number; percent: number };
  queues: { queued: number; pending: number; awaitingApproval: number; byWorker: { workerId: string; queued: number }[] };
  versions: Record<string, number>;
};
const COUNTED: readonly WorkerState[] = ["Idle", "Reserved", "Busy", "WaitingApproval", "Retrying"];

export function buildWorkerRuntimeDashboard(input: { tenantId: string; at: string; workers: readonly WorkerRecord[]; tasks: readonly Task[]; config: WorkerRuntimeConfig }): WorkerRuntimeDashboard {
  const { tenantId, at, config } = input;
  const nowMs = Date.parse(at);
  // one company: whatever belongs to another does not exist here
  const workers = input.workers.filter((worker) => worker.tenantId === tenantId);
  const tasks = input.tasks.filter((task) => task.tenantId === tenantId);
  const load = loadOf(tasks);
  const byState = Object.fromEntries(WORKER_STATES.map((state) => [state, 0])) as Record<WorkerState, number>;
  for (const worker of workers) byState[worker.state] += 1;
  const scored = workers.filter((worker) => worker.state !== "Created" && worker.state !== "Stopped").map((worker) => ({ workerId: worker.id, score: healthScore(worker, nowMs, config) }));
  const counted = workers.filter((worker) => COUNTED.includes(worker.state));
  const used = counted.reduce((sum, worker) => sum + Math.min(worker.maxConcurrent, load.get(worker.id)?.slots ?? 0), 0);
  const total = counted.reduce((sum, worker) => sum + worker.maxConcurrent, 0);
  const versions: Record<string, number> = {};
  for (const worker of workers) versions[worker.version] = (versions[worker.version] ?? 0) + 1;
  return {
    tenantId, at,
    workers: { total: workers.length, idle: byState.Idle, busy: byState.Busy, offline: byState.Offline, failed: byState.Failed, maintenance: byState.Maintenance, byState },
    health: { average: scored.length === 0 ? 0 : Math.round((scored.reduce((sum, row) => sum + row.score, 0) / scored.length) * 10) / 10, lowest: [...scored].sort((a, b) => a.score - b.score || a.workerId.localeCompare(b.workerId)).slice(0, 3) },
    capacity: { used, total, percent: total === 0 ? 0 : Math.round((used / total) * 1000) / 10 },
    queues: {
      queued: tasks.filter((task) => task.status === "queued").length, pending: tasks.filter((task) => task.status === "pending").length, awaitingApproval: tasks.filter((task) => task.status === "awaitingApproval").length,
      byWorker: [...load].filter(([, row]) => row.queued > 0).map(([workerId, row]) => ({ workerId, queued: row.queued })).sort((a, b) => a.workerId.localeCompare(b.workerId)),
    },
    versions,
  };
}
