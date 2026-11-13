// Worker Runtime Health: one number from 0 to 100 per worker, from seven things worth 30, 20, 10, 10, 10, 10 and 10 points: how recent its heartbeat is, how few errors it has, how few retries, whether it is
// overloaded with active tasks, how long it has been up, how much capacity it has left, and how little it has had to recover. A worker that cannot work (Created, Stopped, Failed, Offline) scores 0.
// Pure: the clock is handed in. The weights are starting values.

import { silenceMs } from "./worker-runtime-heartbeat";
import type { WorkerRecord, WorkerRuntimeConfig, WorkerState } from "./worker-runtime-types";

const ZERO: readonly WorkerState[] = ["Created", "Stopped", "Failed", "Offline"];
export type HealthParts = { heartbeat: number; errors: number; retries: number; activeTasks: number; uptime: number; capacity: number; recovery: number };
const clamp = (value: number, max: number): number => Math.max(0, Math.min(max, value));

export function healthParts(worker: WorkerRecord, nowMs: number, config: WorkerRuntimeConfig): HealthParts {
  const silence = silenceMs(worker, nowMs);
  const span = Math.max(1, config.heartbeatTimeoutMs - config.heartbeatIntervalMs);
  const ratio = worker.maxConcurrent > 0 ? worker.current / worker.maxConcurrent : 1;
  const uptime = worker.activeSince ? Math.max(0, nowMs - Date.parse(worker.activeSince)) : 0;
  return {
    heartbeat: silence <= config.heartbeatIntervalMs ? 30 : clamp(30 * (1 - (silence - config.heartbeatIntervalMs) / span), 30),
    errors: clamp(20 - 5 * worker.errors, 20), retries: clamp(10 - 2 * worker.retries, 10),
    activeTasks: ratio <= 0.8 ? 10 : clamp((10 * (1 - ratio)) / 0.2, 10), uptime: clamp((10 * uptime) / Math.max(1, config.uptimeFullMs), 10),
    capacity: clamp(10 * (1 - ratio), 10), recovery: clamp(10 - 5 * worker.recoveries, 10),
  };
}
export function healthScore(worker: WorkerRecord, nowMs: number, config: WorkerRuntimeConfig): number {
  if (ZERO.includes(worker.state)) return 0;
  const parts = healthParts(worker, nowMs, config);
  return Math.round(clamp(Object.values(parts).reduce((sum, part) => sum + part, 0), 100));
}
export const healthBand = (score: number): "healthy" | "degraded" | "critical" => (score >= 70 ? "healthy" : score >= 40 ? "degraded" : "critical");
