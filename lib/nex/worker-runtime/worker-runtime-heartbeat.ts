// Worker Runtime Heartbeat: what a Worker reports about itself (id, company, timestamp, cpu, memory, queue, running tasks, version) and how a report is checked. The timestamp always comes WITH the
// report; nothing here reads a clock. A heartbeat from another company, for another worker, from the future, too old to matter, older than the last one, or with impossible numbers is refused.

import { parseVersion, type Heartbeat, type WorkerRecord, type WorkerRuntimeConfig } from "./worker-runtime-types";

export type HeartbeatCheck = { ok: true; atMs: number } | { ok: false; reason: "tenant" | "worker" | "timestamp" | "future" | "expired" | "stale" | "metrics" | "version" };
const percent = (value: unknown): boolean => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
const count = (value: unknown): boolean => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** Checks a heartbeat against the worker it claims to come from. `nowMs` is the instant it is received. */
export function validateHeartbeat(heartbeat: Heartbeat, worker: Pick<WorkerRecord, "id" | "tenantId" | "lastHeartbeatAt">, nowMs: number, config: Pick<WorkerRuntimeConfig, "heartbeatTimeoutMs">): HeartbeatCheck {
  if (heartbeat.companyId !== worker.tenantId) return { ok: false, reason: "tenant" };
  if (heartbeat.workerId !== worker.id) return { ok: false, reason: "worker" };
  const atMs = Date.parse(heartbeat.timestamp);
  if (Number.isNaN(atMs)) return { ok: false, reason: "timestamp" };
  if (atMs > nowMs) return { ok: false, reason: "future" };
  if (nowMs - atMs > config.heartbeatTimeoutMs) return { ok: false, reason: "expired" };
  if (worker.lastHeartbeatAt !== undefined && atMs <= Date.parse(worker.lastHeartbeatAt)) return { ok: false, reason: "stale" };
  if (!percent(heartbeat.cpu) || !percent(heartbeat.memory) || !count(heartbeat.queueLength) || !count(heartbeat.runningTasks)) return { ok: false, reason: "metrics" };
  if (!parseVersion(heartbeat.version)) return { ok: false, reason: "version" };
  return { ok: true, atMs };
}

/** The instant silence is measured from: the last heartbeat, or where the watch began (starting, recovering, back from maintenance), whichever is later. */
export function referenceMs(worker: Pick<WorkerRecord, "lastHeartbeatAt" | "watchFrom" | "createdAt">): number {
  return Math.max(worker.lastHeartbeatAt ? Date.parse(worker.lastHeartbeatAt) : 0, worker.watchFrom ? Date.parse(worker.watchFrom) : 0, worker.lastHeartbeatAt || worker.watchFrom ? 0 : Date.parse(worker.createdAt));
}
export const silenceMs = (worker: Pick<WorkerRecord, "lastHeartbeatAt" | "watchFrom" | "createdAt">, nowMs: number): number => Math.max(0, nowMs - referenceMs(worker));
/** Has the worker been silent for longer than its timeout? */
export const heartbeatExpired = (worker: Pick<WorkerRecord, "lastHeartbeatAt" | "watchFrom" | "createdAt">, nowMs: number, config: Pick<WorkerRuntimeConfig, "heartbeatTimeoutMs">): boolean => silenceMs(worker, nowMs) > config.heartbeatTimeoutMs;
