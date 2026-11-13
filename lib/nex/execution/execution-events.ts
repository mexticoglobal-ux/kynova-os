// Execution Events: what happened to the plans of a company, with ids and numbers only. An event never carries a prompt, an answer, a context, an address, a phone number, a token, a secret or any
// content: free text is dropped before an event is kept, and a plan is named by its id. The log can hand itself over in the platform's audit shape. The observability counts the events per company.

import type { AuditEntry, ExecutionEventInput, ExecutionEventType, ExecutionPlan, ExecutionState } from "./execution-types";

export type ExecutionLogEvent = Omit<ExecutionEventInput, "detail"> & { id: string; detail?: Readonly<Record<string, string | number | boolean>> };
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

export class ExecutionEventLog {
  private readonly events: ExecutionLogEvent[] = [];
  private readonly listeners = new Set<(event: ExecutionLogEvent) => void>();
  emit(input: ExecutionEventInput): ExecutionLogEvent {
    const detail = sanitizeDetail(input.detail);
    const event: ExecutionLogEvent = {
      id: `xe_${String(this.events.length + 1).padStart(6, "0")}`, at: input.at, tenantId: input.tenantId, actorKind: input.actorKind, actorId: input.actorId, type: input.type,
      ...(input.planId && SAFE_VALUE.test(input.planId) ? { planId: input.planId } : {}), ...(detail ? { detail } : {}),
    };
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
    return event;
  }
  listen(listener: (event: ExecutionLogEvent) => void): () => void { this.listeners.add(listener); return () => void this.listeners.delete(listener); }
  all(): readonly ExecutionLogEvent[] { return this.events; }
  forTenant(tenantId: string): readonly ExecutionLogEvent[] { return this.events.filter((event) => event.tenantId === tenantId); }
  ofType(type: ExecutionEventType): readonly ExecutionLogEvent[] { return this.events.filter((event) => event.type === type); }
  toAudit(tenantId: string): readonly AuditEntry[] {
    return this.forTenant(tenantId).map((event) => ({ at: event.at, actor: event.actorKind === "system" ? "system" : event.actorId, tenantId: event.tenantId, action: event.type, ...(event.detail ? { detail: event.detail } : {}) }));
  }
}

type Counters = {
  prepared: number; validated: number; errors: number; warnings: number; assigned: number; submitted: number; approved: number; rejected: number; started: number; paused: number; resumed: number;
  completed: number; cancelled: number; expired: number; rollbacks: number; stepsReported: number; retries: number; stepFailures: number; scheduled: number; dashboards: number; refused: number;
};
const zero = (): Counters => ({ prepared: 0, validated: 0, errors: 0, warnings: 0, assigned: 0, submitted: 0, approved: 0, rejected: 0, started: 0, paused: 0, resumed: 0, completed: 0, cancelled: 0, expired: 0, rollbacks: 0, stepsReported: 0, retries: 0, stepFailures: 0, scheduled: 0, dashboards: 0, refused: 0 });
const num = (value: unknown): number => (typeof value === "number" ? value : 0);
const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10);
const bump = (record: Record<string, number>, key: string, by = 1) => { record[key] = (record[key] ?? 0) + by; };

type Tenant = { counters: Counters; latency: number[]; plannedMs: number[]; byPriority: Record<string, number>; byLevel: Record<string, number>; refusals: Record<string, number>; aiMicros: number; apiMicros: number };

export class ExecutionObservability {
  private readonly tenants = new Map<string, Tenant>();
  private detach: (() => void) | undefined;
  constructor(log?: ExecutionEventLog) { if (log) this.detach = log.listen((event) => this.count(event)); }
  stop(): void { this.detach?.(); }

  private row(tenantId: string): Tenant {
    const found = this.tenants.get(tenantId);
    if (found) return found;
    const created: Tenant = { counters: zero(), latency: [], plannedMs: [], byPriority: {}, byLevel: {}, refusals: {}, aiMicros: 0, apiMicros: 0 };
    this.tenants.set(tenantId, created);
    return created;
  }
  count(event: ExecutionLogEvent): void {
    const row = this.row(event.tenantId);
    const c = row.counters;
    const d = event.detail ?? {};
    switch (event.type) {
      case "plan.prepared":
        c.prepared += 1;
        if (typeof d["priority"] === "string") bump(row.byPriority, d["priority"]);
        bump(row.byLevel, `level${num(d["level"])}`);
        row.aiMicros += num(d["aiMicros"]); row.apiMicros += num(d["apiMicros"]);
        row.plannedMs.push(num(d["estimatedMs"]));
        if (typeof d["latencyMs"] === "number") row.latency.push(d["latencyMs"]);
        break;
      case "plan.validated": c.validated += 1; c.errors += num(d["errors"]); c.warnings += num(d["warnings"]); break;
      case "plan.assigned": c.assigned += 1; break;
      case "plan.submitted": c.submitted += 1; break;
      case "plan.approved": c.approved += 1; break;
      case "plan.rejected": c.rejected += 1; break;
      case "plan.started": c.started += 1; break;
      case "plan.paused": c.paused += 1; break;
      case "plan.resumed": c.resumed += 1; break;
      case "plan.completed": c.completed += 1; break;
      case "plan.cancelled": c.cancelled += 1; break;
      case "plan.expired": c.expired += 1; break;
      case "plan.rollback_requested": c.rollbacks += 1; break;
      case "step.reported": c.stepsReported += 1; break;
      case "step.retried": c.retries += 1; break;
      case "step.failed": c.stepFailures += 1; break;
      case "execution.scheduled": c.scheduled += 1; break;
      case "execution.dashboard": c.dashboards += 1; break;
      case "execution.refused": { c.refused += 1; bump(row.refusals, typeof d["reason"] === "string" ? d["reason"] : "unknown"); break; }
      default: break;
    }
  }

  /** One company's numbers; a company never sees another's. `state` adds the plans by state. */
  snapshot(tenantId: string, state?: ExecutionState) {
    const row = this.row(tenantId);
    const sorted = [...row.latency].sort((a, b) => a - b);
    const plans: readonly ExecutionPlan[] = state?.plans.filter((plan) => plan.tenantId === tenantId) ?? [];
    const byStatus: Record<string, number> = {};
    for (const plan of plans) bump(byStatus, plan.status);
    return {
      counters: { ...row.counters },
      latency: { count: sorted.length, avgMs: mean(sorted), maxMs: sorted.at(-1) ?? 0, p95Ms: sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] as number) },
      planned: { avgMs: mean(row.plannedMs), aiMicros: row.aiMicros, apiMicros: row.apiMicros },
      byPriority: { ...row.byPriority }, byLevel: { ...row.byLevel }, refusals: { ...row.refusals },
      ...(state ? { plans: { total: plans.length, byStatus } } : {}),
    };
  }
}
