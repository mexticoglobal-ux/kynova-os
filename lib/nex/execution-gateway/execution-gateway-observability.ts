// Execution Gateway Observability: per-company counters built ONLY from event types and their numbers: ids, metrics and counters. It never sees, and never stores, a prompt, a context, a memory or an
// answer; one company never sees another's numbers. Pure bookkeeping.

import type { GatewayEventLog, GatewayLogEvent } from "./execution-gateway-events";
import type { GatewayState } from "./execution-gateway-types";

type Counters = {
  created: number; validated: number; transitions: number; ready: number; blocked: number; rejected: number; cancelled: number; expired: number; failures: number; dispatches: number; dispatched: number;
  dashboards: number; refused: number;
};
const zero = (): Counters => ({ created: 0, validated: 0, transitions: 0, ready: 0, blocked: 0, rejected: 0, cancelled: 0, expired: 0, failures: 0, dispatches: 0, dispatched: 0, dashboards: 0, refused: 0 });
type Tenant = { counters: Counters; byFailure: Record<string, number>; byTransition: Record<string, number>; refusals: Record<string, number> };

export class GatewayObservability {
  private readonly tenants = new Map<string, Tenant>();
  private detach: (() => void) | undefined;
  constructor(log?: GatewayEventLog) { if (log) this.detach = log.listen((event) => this.count(event)); }
  stop(): void { this.detach?.(); }
  private row(tenantId: string): Tenant {
    const found = this.tenants.get(tenantId);
    if (found) return found;
    const created: Tenant = { counters: zero(), byFailure: {}, byTransition: {}, refusals: {} };
    this.tenants.set(tenantId, created);
    return created;
  }
  count(event: GatewayLogEvent): void {
    const row = this.row(event.tenantId);
    const c = row.counters;
    const d = event.detail ?? {};
    switch (event.type) {
      case "request.created": c.created += 1; break;
      case "request.validated": c.validated += 1; break;
      case "request.transition": { c.transitions += 1; const key = `${String(d["from"] ?? "?")}>${String(d["to"] ?? "?")}`; row.byTransition[key] = (row.byTransition[key] ?? 0) + 1; break; }
      case "request.failure": { c.failures += 1; const code = typeof d["code"] === "string" ? d["code"] : "unknown"; row.byFailure[code] = (row.byFailure[code] ?? 0) + 1; break; }
      case "request.ready": c.ready += 1; break;
      case "request.blocked": c.blocked += 1; break;
      case "request.rejected": c.rejected += 1; break;
      case "request.cancelled": c.cancelled += 1; break;
      case "request.expired": c.expired += 1; break;
      case "gateway.dispatched": c.dispatches += 1; c.dispatched += typeof d["requests"] === "number" ? d["requests"] : 0; break;
      case "gateway.dashboard": c.dashboards += 1; break;
      case "gateway.refused": { c.refused += 1; const reason = typeof d["reason"] === "string" ? d["reason"] : "unknown"; row.refusals[reason] = (row.refusals[reason] ?? 0) + 1; break; }
      default: break;
    }
  }
  /** One company's numbers; `state` adds the requests by state. */
  snapshot(tenantId: string, state?: GatewayState) {
    const row = this.row(tenantId);
    const byState: Record<string, number> = {};
    for (const record of state?.requests ?? []) if (record.request.companyId === tenantId) byState[record.state] = (byState[record.state] ?? 0) + 1;
    return { counters: { ...row.counters }, byFailure: { ...row.byFailure }, byTransition: { ...row.byTransition }, refusals: { ...row.refusals }, ...(state ? { requests: { total: Object.values(byState).reduce((a, b) => a + b, 0), byState } } : {}) };
  }
}
