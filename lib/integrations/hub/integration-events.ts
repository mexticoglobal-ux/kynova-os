// The Hub's events: an append-only record of everything that happens to a connection, in a shape the Backend Core's Event Bus connector can carry later (`toAudit`). An event holds ids, kinds
// and numbers, never a token, a message body or a provider's words: `sanitizeDetail` drops anything that looks like content or a credential before it is stored.

export const HUB_EVENT_TYPES = [
  "connection.created", "connection.connected", "connection.failed", "connection.disconnected", "connection.refreshed", "connection.refresh_failed",
  "health.checked", "health.changed",
  "sync.started", "sync.finished", "sync.failed",
  "execute.requested", "execute.awaiting_approval", "execute.approved", "execute.rejected", "execute.succeeded", "execute.failed",
  "rate.limited", "retry.scheduled", "circuit.opened", "circuit.half_open", "circuit.closed", "connector.dead", "connector.recovered", "fallback.used",
  "webhook.received", "webhook.rejected", "workflow.started", "workflow.step", "workflow.finished", "workflow.failed",
] as const;
export type HubEventType = (typeof HUB_EVENT_TYPES)[number];
export type Detail = Readonly<Record<string, string | number | boolean>>;
export type HubEvent = { id: string; at: string; tenantId: string; providerId: string; connectionId?: string; type: HubEventType; traceId?: string; detail?: Detail };

const FORBIDDEN_KEY = /token|secret|authorization|password|credential|body|text|content|subject|email|address|code|cookie/i;
/** Keeps only plain ids, kinds and numbers: a key that smells of content or a credential is dropped, and a long string is cut. */
export function sanitizeDetail(detail: Record<string, unknown> | undefined): Detail | undefined {
  if (!detail) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (FORBIDDEN_KEY.test(key)) continue;
    if (typeof value === "string") out[key] = value.slice(0, 120);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

export type HubEventInput = Omit<HubEvent, "id" | "detail"> & { detail?: Record<string, unknown> };
export class HubEventLog {
  private readonly rows: HubEvent[] = [];
  private readonly listeners = new Set<(event: HubEvent) => void>();
  private counter = 0;
  emit(input: HubEventInput): HubEvent {
    const detail = sanitizeDetail(input.detail);
    const event: HubEvent = { id: `hv_${String(++this.counter).padStart(6, "0")}`, at: input.at, tenantId: input.tenantId, providerId: input.providerId, ...(input.connectionId ? { connectionId: input.connectionId } : {}), type: input.type, ...(input.traceId ? { traceId: input.traceId } : {}), ...(detail ? { detail } : {}) };
    this.rows.push(event);
    for (const listener of this.listeners) listener(event);
    return event;
  }
  listen(listener: (event: HubEvent) => void): () => void { this.listeners.add(listener); return () => void this.listeners.delete(listener); }
  /** One company's events, and only theirs. */
  forTenant(tenantId: string): readonly HubEvent[] { return this.rows.filter((row) => row.tenantId === tenantId); }
  all(): readonly HubEvent[] { return [...this.rows]; }
  ofType(type: HubEventType, tenantId?: string): readonly HubEvent[] { return this.rows.filter((row) => row.type === type && (!tenantId || row.tenantId === tenantId)); }
  byTrace(traceId: string): readonly HubEvent[] { return this.rows.filter((row) => row.traceId === traceId); }
  /** The trail in the shape of the platform's other modules (at, actor, tenantId, action, detail): what a Backend Core bridge reads. */
  toAudit(tenantId: string): { at: string; actor: string; tenantId: string; action: string; detail?: string }[] {
    return this.forTenant(tenantId).map((row) => ({ at: row.at, actor: "system", tenantId: row.tenantId, action: row.type, detail: `${row.providerId}${row.connectionId ? ` · ${row.connectionId}` : ""}` }));
  }
}
