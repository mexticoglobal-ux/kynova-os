// Knowledge Events: what happened to the graph, with no knowledge in it. An event carries ids, counts and short identifiers; anything else is dropped before it is kept.
// The log can hand itself over in the platform's audit shape so the Event Bus of a later step can consume it.

import type { AuditEntry, KnowledgeEventInput, KnowledgeEventType } from "./knowledge-types";

export type KnowledgeLogEvent = Omit<KnowledgeEventInput, "detail"> & { id: string; detail?: Readonly<Record<string, string | number | boolean>> };
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

export class KnowledgeEventLog {
  private readonly events: KnowledgeLogEvent[] = [];
  private readonly listeners = new Set<(event: KnowledgeLogEvent) => void>();
  emit(input: KnowledgeEventInput): KnowledgeLogEvent {
    const detail = sanitizeDetail(input.detail);
    const event: KnowledgeLogEvent = { id: `ke_${String(this.events.length + 1).padStart(6, "0")}`, at: input.at, tenantId: input.tenantId, actorKind: input.actorKind, actorId: input.actorId, type: input.type, ...(detail ? { detail } : {}) };
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
    return event;
  }
  listen(listener: (event: KnowledgeLogEvent) => void): () => void { this.listeners.add(listener); return () => void this.listeners.delete(listener); }
  all(): readonly KnowledgeLogEvent[] { return this.events; }
  forTenant(tenantId: string): readonly KnowledgeLogEvent[] { return this.events.filter((event) => event.tenantId === tenantId); }
  ofType(type: KnowledgeEventType): readonly KnowledgeLogEvent[] { return this.events.filter((event) => event.type === type); }
  toAudit(tenantId: string): readonly AuditEntry[] {
    return this.forTenant(tenantId).map((event) => ({ at: event.at, actor: event.actorKind === "system" ? "system" : event.actorId, tenantId: event.tenantId, action: event.type, ...(event.detail ? { detail: event.detail } : {}) }));
  }
}
