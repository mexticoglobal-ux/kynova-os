// Worker Runtime Observability: per-company counters built ONLY from event types and their numbers. It never sees, and never stores, a prompt, a context, a memory or an answer; one company never
// sees another's numbers. Pure bookkeeping.

import type { WorkerLogEvent, WorkerEventLog } from "./worker-runtime-events";
import type { WorkerRuntimeState } from "./worker-runtime-types";

type Counters = {
  registered: number; transitions: number; heartbeats: number; timeouts: number; recoveries: number; versionChanges: number; submitted: number; assigned: number; queued: number; started: number;
  completed: number; failed: number; retries: number; released: number; approved: number; rejected: number; scheduled: number; ticks: number; dashboards: number; refused: number;
};
const zero = (): Counters => ({ registered: 0, transitions: 0, heartbeats: 0, timeouts: 0, recoveries: 0, versionChanges: 0, submitted: 0, assigned: 0, queued: 0, started: 0, completed: 0, failed: 0, retries: 0, released: 0, approved: 0, rejected: 0, scheduled: 0, ticks: 0, dashboards: 0, refused: 0 });
type Tenant = { counters: Counters; byTransition: Record<string, number>; refusals: Record<string, number> };

export class WorkerRuntimeObservability {
  private readonly tenants = new Map<string, Tenant>();
  private detach: (() => void) | undefined;
  constructor(log?: WorkerEventLog) { if (log) this.detach = log.listen((event) => this.count(event)); }
  stop(): void { this.detach?.(); }
  private row(tenantId: string): Tenant {
    const found = this.tenants.get(tenantId);
    if (found) return found;
    const created: Tenant = { counters: zero(), byTransition: {}, refusals: {} };
    this.tenants.set(tenantId, created);
    return created;
  }
  count(event: WorkerLogEvent): void {
    const row = this.row(event.tenantId);
    const c = row.counters;
    const d = event.detail ?? {};
    switch (event.type) {
      case "worker.registered": c.registered += 1; break;
      case "worker.transition": { c.transitions += 1; const key = `${String(d["from"] ?? "?")}>${String(d["to"] ?? "?")}`; row.byTransition[key] = (row.byTransition[key] ?? 0) + 1; break; }
      case "worker.heartbeat": c.heartbeats += 1; break;
      case "worker.timeout": c.timeouts += 1; break;
      case "worker.recovered": c.recoveries += 1; break;
      case "worker.version": c.versionChanges += 1; break;
      case "task.submitted": c.submitted += 1; break;
      case "task.assigned": c.assigned += 1; break;
      case "task.queued": c.queued += 1; break;
      case "task.started": c.started += 1; break;
      case "task.completed": c.completed += 1; break;
      case "task.failed": c.failed += 1; break;
      case "task.retry": c.retries += 1; break;
      case "task.released": c.released += 1; break;
      case "task.approved": c.approved += 1; break;
      case "task.rejected": c.rejected += 1; break;
      case "runtime.scheduled": c.scheduled += 1; break;
      case "runtime.tick": c.ticks += 1; break;
      case "runtime.dashboard": c.dashboards += 1; break;
      case "runtime.refused": { c.refused += 1; const reason = typeof d["reason"] === "string" ? d["reason"] : "unknown"; row.refusals[reason] = (row.refusals[reason] ?? 0) + 1; break; }
      default: break;
    }
  }
  /** One company's numbers; `state` adds the workers by state. */
  snapshot(tenantId: string, state?: WorkerRuntimeState) {
    const row = this.row(tenantId);
    const byState: Record<string, number> = {};
    for (const worker of state?.workers ?? []) if (worker.tenantId === tenantId) byState[worker.state] = (byState[worker.state] ?? 0) + 1;
    return { counters: { ...row.counters }, byTransition: { ...row.byTransition }, refusals: { ...row.refusals }, ...(state ? { workers: { total: Object.values(byState).reduce((a, b) => a + b, 0), byState } } : {}) };
  }
}
