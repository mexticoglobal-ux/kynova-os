// Copilot Observability: questions, contexts, plans, recommendations, suggested actions, latency, ranking and the modules consulted, per company. The event log carries no question, no context and
// no knowledge: counts and short identifiers only. The observability only reads the log (and, for what is pending, the state).

import type { AuditEntry, CopilotEventInput, CopilotEventType, CopilotState } from "./copilot-types";

export type CopilotLogEvent = Omit<CopilotEventInput, "detail"> & { id: string; detail?: Readonly<Record<string, string | number | boolean>> };
const SAFE_VALUE = /^[A-Za-z0-9_.:-]{1,40}$/;

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

export class CopilotEventLog {
  private readonly events: CopilotLogEvent[] = [];
  private readonly listeners = new Set<(event: CopilotLogEvent) => void>();
  emit(input: CopilotEventInput): CopilotLogEvent {
    const detail = sanitizeDetail(input.detail);
    const event: CopilotLogEvent = { id: `ce_${String(this.events.length + 1).padStart(6, "0")}`, at: input.at, tenantId: input.tenantId, actorKind: input.actorKind, actorId: input.actorId, type: input.type, ...(detail ? { detail } : {}) };
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
    return event;
  }
  listen(listener: (event: CopilotLogEvent) => void): () => void { this.listeners.add(listener); return () => void this.listeners.delete(listener); }
  all(): readonly CopilotLogEvent[] { return this.events; }
  forTenant(tenantId: string): readonly CopilotLogEvent[] { return this.events.filter((event) => event.tenantId === tenantId); }
  ofType(type: CopilotEventType): readonly CopilotLogEvent[] { return this.events.filter((event) => event.type === type); }
  toAudit(tenantId: string): readonly AuditEntry[] {
    return this.forTenant(tenantId).map((event) => ({ at: event.at, actor: event.actorKind === "system" ? "system" : event.actorId, tenantId: event.tenantId, action: event.type, ...(event.detail ? { detail: event.detail } : {}) }));
  }
}

type Counters = {
  asked: number; contexts: number; contextItems: number; plans: number; recommendations: number; actionsSuggested: number; actionsApproved: number; actionsRejected: number; actionsExpired: number;
  dashboards: number; sessionsStarted: number; sessionsEnded: number; decisions: number; refused: number; cacheHits: number;
};
const zero = (): Counters => ({ asked: 0, contexts: 0, contextItems: 0, plans: 0, recommendations: 0, actionsSuggested: 0, actionsApproved: 0, actionsRejected: 0, actionsExpired: 0, dashboards: 0, sessionsStarted: 0, sessionsEnded: 0, decisions: 0, refused: 0, cacheHits: 0 });
const num = (value: unknown): number => (typeof value === "number" ? value : 0);
const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10);
const bump = (record: Record<string, number>, key: string, by = 1) => { record[key] = (record[key] ?? 0) + by; };

type Tenant = {
  counters: Counters; latency: number[]; topContext: number[]; topSeverity: number[]; planTypes: Record<string, number>; bySeverity: Record<string, number>; byLevel: Record<string, number>;
  intents: Record<string, number>; modules: Record<string, number>; refusals: Record<string, number>;
};

export class CopilotObservability {
  private readonly tenants = new Map<string, Tenant>();
  private detach: (() => void) | undefined;
  constructor(log?: CopilotEventLog) { if (log) this.detach = log.listen((event) => this.count(event)); }
  stop(): void { this.detach?.(); }

  private row(tenantId: string): Tenant {
    const found = this.tenants.get(tenantId);
    if (found) return found;
    const created: Tenant = { counters: zero(), latency: [], topContext: [], topSeverity: [], planTypes: {}, bySeverity: {}, byLevel: {}, intents: {}, modules: {}, refusals: {} };
    this.tenants.set(tenantId, created);
    return created;
  }
  count(event: CopilotLogEvent): void {
    const row = this.row(event.tenantId);
    const c = row.counters;
    const d = event.detail ?? {};
    switch (event.type) {
      case "copilot.asked":
        c.asked += 1;
        if (d["cached"] === true) c.cacheHits += 1;
        if (typeof d["intent"] === "string") bump(row.intents, d["intent"]);
        for (const consulted of ["rag", "memory", "graph", "koe"]) if (d[consulted] === true) bump(row.modules, consulted);
        if (typeof d["latencyMs"] === "number") row.latency.push(d["latencyMs"]);
        break;
      case "copilot.context": c.contexts += 1; c.contextItems += num(d["items"]); if (typeof d["topScore"] === "number") row.topContext.push(d["topScore"]); break;
      case "copilot.planned": c.plans += 1; if (typeof d["type"] === "string") bump(row.planTypes, d["type"]); break;
      case "copilot.recommended":
        c.recommendations += num(d["count"]);
        for (const severity of ["critical", "high", "medium", "low"]) bump(row.bySeverity, severity, num(d[severity]));
        if (typeof d["topScore"] === "number") row.topSeverity.push(d["topScore"]);
        break;
      case "copilot.action_suggested": c.actionsSuggested += num(d["count"]); for (const level of ["level1", "level2", "level3"]) bump(row.byLevel, level, num(d[level])); break;
      case "copilot.action_approved": c.actionsApproved += 1; break;
      case "copilot.action_rejected": c.actionsRejected += 1; break;
      case "copilot.action_expired": c.actionsExpired += Math.max(1, num(d["count"])); break;
      case "copilot.dashboard": c.dashboards += 1; break;
      case "copilot.session_started": c.sessionsStarted += 1; break;
      case "copilot.session_ended": c.sessionsEnded += Math.max(1, num(d["count"])); break;
      case "copilot.decision": c.decisions += 1; break;
      case "copilot.refused": { c.refused += 1; bump(row.refusals, typeof d["reason"] === "string" ? d["reason"] : "unknown"); break; }
      default: break;
    }
  }

  /** One company's numbers; a company never sees another's. `state` adds what is pending. */
  snapshot(tenantId: string, state?: CopilotState) {
    const row = this.row(tenantId);
    const sorted = [...row.latency].sort((a, b) => a - b);
    const mine = state?.actions.filter((action) => action.tenantId === tenantId);
    return {
      counters: { ...row.counters },
      latency: { count: sorted.length, avgMs: mean(sorted), maxMs: sorted.at(-1) ?? 0, p95Ms: sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] as number) },
      ranking: { avgTopContextScore: mean(row.topContext), maxTopContextScore: Math.max(0, ...row.topContext), avgTopSeverityScore: mean(row.topSeverity), maxTopSeverityScore: Math.max(0, ...row.topSeverity) },
      modulesConsulted: { rag: row.modules["rag"] ?? 0, memory: row.modules["memory"] ?? 0, graph: row.modules["graph"] ?? 0, koe: row.modules["koe"] ?? 0 },
      planTypes: { ...row.planTypes }, recommendationsBySeverity: { ...row.bySeverity }, actionsByLevel: { ...row.byLevel }, intents: { ...row.intents }, refusals: { ...row.refusals },
      ...(state ? { pending: { actions: mine?.filter((action) => action.status === "suggested").length ?? 0, sessions: state.sessions.filter((session) => session.tenantId === tenantId).length } } : {}),
    };
  }
}
