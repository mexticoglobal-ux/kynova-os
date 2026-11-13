// Orchestrator Events: what happened in the runtime of a company (assignment, start, pause, resume, timeout, retry, cancel, finish, fail), with ids and numbers ONLY. Free text is dropped before an event
// is kept; there is no field for a prompt, an answer, a context, a secret, an OAuth grant, a token or any content. The log can hand itself over in the platform's audit shape; the observability
// counts the events per company and reads nothing else.

import type { AuditEntry, OrchestratorEventInput, OrchestratorEventType, RuntimeState } from "./orchestrator-types";

export type OrchestratorLogEvent = Omit<OrchestratorEventInput, "detail"> & { id: string; detail?: Readonly<Record<string, string | number | boolean>> };
const SAFE_VALUE = /^[A-Za-z0-9_.:#-]{1,60}$/;

/** Numbers, booleans and short identifiers survive; free text never does. */
export function sanitizeDetail(detail: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, string | number | boolean>> | undefined {
  if (!detail) return undefined;
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === "number" && Number.isFinite(value)) clean[key] = Math.round(value * 100) / 100;
    else if (typeof value === "boolean") clean[key] = value;
    else if (typeof value === "string" && SAFE_VALUE.test(value)) clean[key] = value;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export class OrchestratorEventLog {
  private readonly events: OrchestratorLogEvent[] = [];
  private readonly listeners = new Set<(event: OrchestratorLogEvent) => void>();
  emit(input: OrchestratorEventInput): OrchestratorLogEvent {
    const detail = sanitizeDetail(input.detail);
    const event: OrchestratorLogEvent = {
      id: `oe_${String(this.events.length + 1).padStart(6, "0")}`, at: input.at, tenantId: input.tenantId, actorKind: input.actorKind, actorId: input.actorId, type: input.type,
      ...(input.planId && SAFE_VALUE.test(input.planId) ? { planId: input.planId } : {}), ...(input.itemId && SAFE_VALUE.test(input.itemId) ? { itemId: input.itemId } : {}), ...(detail ? { detail } : {}),
    };
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
    return event;
  }
  listen(listener: (event: OrchestratorLogEvent) => void): () => void { this.listeners.add(listener); return () => void this.listeners.delete(listener); }
  all(): readonly OrchestratorLogEvent[] { return this.events; }
  forTenant(tenantId: string): readonly OrchestratorLogEvent[] { return this.events.filter((event) => event.tenantId === tenantId); }
  ofType(type: OrchestratorEventType): readonly OrchestratorLogEvent[] { return this.events.filter((event) => event.type === type); }
  toAudit(tenantId: string): readonly AuditEntry[] {
    return this.forTenant(tenantId).map((event) => ({ at: event.at, actor: event.actorKind === "system" ? "system" : event.actorId, tenantId: event.tenantId, action: event.type, ...(event.detail ? { detail: event.detail } : {}) }));
  }
}

type Counters = {
  enqueued: number; items: number; assigned: number; unassigned: number; started: number; paused: number; resumed: number; timeouts: number; retries: number; cancelled: number; finished: number; failed: number;
  runsCompleted: number; runsFailed: number; runsExpired: number; ticks: number; blocked: number; dashboards: number; refused: number;
};
const zero = (): Counters => ({ enqueued: 0, items: 0, assigned: 0, unassigned: 0, started: 0, paused: 0, resumed: 0, timeouts: 0, retries: 0, cancelled: 0, finished: 0, failed: 0, runsCompleted: 0, runsFailed: 0, runsExpired: 0, ticks: 0, blocked: 0, dashboards: 0, refused: 0 });
const num = (value: unknown): number => (typeof value === "number" ? value : 0);
const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10);
type Tenant = { counters: Counters; latency: number[]; refusals: Record<string, number>; byPriority: Record<string, number>; byBlockage: Record<string, number> };

export class OrchestratorObservability {
  private readonly tenants = new Map<string, Tenant>();
  private detach: (() => void) | undefined;
  constructor(log?: OrchestratorEventLog) { if (log) this.detach = log.listen((event) => this.count(event)); }
  stop(): void { this.detach?.(); }
  private row(tenantId: string): Tenant {
    const found = this.tenants.get(tenantId);
    if (found) return found;
    const created: Tenant = { counters: zero(), latency: [], refusals: {}, byPriority: {}, byBlockage: {} };
    this.tenants.set(tenantId, created);
    return created;
  }
  count(event: OrchestratorLogEvent): void {
    const row = this.row(event.tenantId);
    const c = row.counters;
    const d = event.detail ?? {};
    switch (event.type) {
      case "queue.enqueued": c.enqueued += 1; c.items += num(d["items"]); if (typeof d["priority"] === "string") row.byPriority[d["priority"]] = (row.byPriority[d["priority"]] ?? 0) + 1; break;
      case "queue.assigned": c.assigned += 1; break;
      case "queue.unassigned": c.unassigned += 1; break;
      case "execution.started": c.started += 1; break;
      case "execution.paused": c.paused += 1; break;
      case "execution.resumed": c.resumed += 1; break;
      case "execution.timeout": c.timeouts += 1; break;
      case "execution.retry": c.retries += 1; break;
      case "execution.cancelled": c.cancelled += 1; break;
      case "execution.finished": c.finished += 1; break;
      case "execution.failed": c.failed += 1; break;
      case "run.completed": c.runsCompleted += 1; break;
      case "run.failed": c.runsFailed += 1; break;
      case "run.expired": c.runsExpired += 1; break;
      case "orchestrator.tick": c.ticks += 1; if (typeof d["latencyMs"] === "number") row.latency.push(d["latencyMs"]); break;
      case "orchestrator.blocked": c.blocked += Math.max(1, num(d["count"])); if (typeof d["kind"] === "string") row.byBlockage[d["kind"]] = (row.byBlockage[d["kind"]] ?? 0) + Math.max(1, num(d["count"])); break;
      case "orchestrator.dashboard": c.dashboards += 1; break;
      case "orchestrator.refused": { c.refused += 1; const reason = typeof d["reason"] === "string" ? d["reason"] : "unknown"; row.refusals[reason] = (row.refusals[reason] ?? 0) + 1; break; }
      default: break;
    }
  }
  /** One company's numbers; a company never sees another's. `state` adds the queue by state. */
  snapshot(tenantId: string, state?: RuntimeState) {
    const row = this.row(tenantId);
    const sorted = [...row.latency].sort((a, b) => a - b);
    const byState: Record<string, number> = {};
    for (const item of state?.queue ?? []) if (item.tenantId === tenantId) byState[item.state] = (byState[item.state] ?? 0) + 1;
    return {
      counters: { ...row.counters },
      latency: { count: sorted.length, avgMs: mean(sorted), maxMs: sorted.at(-1) ?? 0, p95Ms: sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] as number) },
      byPriority: { ...row.byPriority }, blockages: { ...row.byBlockage }, refusals: { ...row.refusals },
      ...(state ? { queue: { items: Object.values(byState).reduce((a, b) => a + b, 0), byState }, runs: state.runs.filter((run) => run.tenantId === tenantId).length } : {}),
    };
  }
}
