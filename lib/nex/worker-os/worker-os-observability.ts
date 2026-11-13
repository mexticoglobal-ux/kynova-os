// Worker OS Observability: per-company counters built ONLY from event types and their numbers. It never sees, and never stores, a prompt, a context, a memory or an answer; one company never sees
// another's numbers. Pure bookkeeping.

import type { OsEventLog, OsLogEvent } from "./worker-os-events";
import type { WorkerOsState } from "./worker-os-types";

type Counters = {
  created: number; updated: number; capabilityChanges: number; permissionChanges: number; toolChanges: number; blocked: number; unblocked: number; upgradesRequested: number; upgradesApproved: number;
  upgradesInstalled: number; rollbacks: number; healthReports: number; policyChecks: number; policyDenied: number; dashboards: number; refused: number;
};
const zero = (): Counters => ({ created: 0, updated: 0, capabilityChanges: 0, permissionChanges: 0, toolChanges: 0, blocked: 0, unblocked: 0, upgradesRequested: 0, upgradesApproved: 0, upgradesInstalled: 0, rollbacks: 0, healthReports: 0, policyChecks: 0, policyDenied: 0, dashboards: 0, refused: 0 });
type Tenant = { counters: Counters; refusals: Record<string, number>; violations: Record<string, number> };

export class WorkerOsObservability {
  private readonly tenants = new Map<string, Tenant>();
  private detach: (() => void) | undefined;
  constructor(log?: OsEventLog) { if (log) this.detach = log.listen((event) => this.count(event)); }
  stop(): void { this.detach?.(); }
  private row(tenantId: string): Tenant {
    const found = this.tenants.get(tenantId);
    if (found) return found;
    const created: Tenant = { counters: zero(), refusals: {}, violations: {} };
    this.tenants.set(tenantId, created);
    return created;
  }
  count(event: OsLogEvent): void {
    const row = this.row(event.tenantId);
    const c = row.counters;
    const d = event.detail ?? {};
    switch (event.type) {
      case "worker.created": c.created += 1; break;
      case "worker.updated": c.updated += 1; break;
      case "worker.capabilities": c.capabilityChanges += 1; break;
      case "worker.permissions": c.permissionChanges += 1; break;
      case "worker.tools": c.toolChanges += 1; break;
      case "worker.blocked": c.blocked += 1; break;
      case "worker.unblocked": c.unblocked += 1; break;
      case "upgrade.requested": c.upgradesRequested += 1; break;
      case "upgrade.approved": c.upgradesApproved += 1; break;
      case "upgrade.installed": c.upgradesInstalled += 1; break;
      case "worker.rolledback": c.rollbacks += 1; break;
      case "health.reported": c.healthReports += 1; break;
      case "policy.checked": {
        c.policyChecks += 1;
        if (d["allowed"] === false) { c.policyDenied += 1; for (const key of Object.keys(d)) if (key.startsWith("v_") && d[key] === true) row.violations[key.slice(2)] = (row.violations[key.slice(2)] ?? 0) + 1; }
        break;
      }
      case "os.dashboard": c.dashboards += 1; break;
      case "os.refused": { c.refused += 1; const reason = typeof d["reason"] === "string" ? d["reason"] : "unknown"; row.refusals[reason] = (row.refusals[reason] ?? 0) + 1; break; }
      default: break;
    }
  }
  /** One company's numbers; `state` adds the workers by status. */
  snapshot(tenantId: string, state?: WorkerOsState) {
    const row = this.row(tenantId);
    const byStatus: Record<string, number> = {};
    for (const worker of state?.workers ?? []) if (worker.companyId === tenantId) byStatus[worker.status] = (byStatus[worker.status] ?? 0) + 1;
    return { counters: { ...row.counters }, refusals: { ...row.refusals }, violations: { ...row.violations }, ...(state ? { workers: { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus } } : {}) };
  }
}
