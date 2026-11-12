// Memory Events: what happened, with no knowledge in it. An event carries ids, counts and short identifiers; anything else (a summary, a query, free text) is dropped before it is kept.
// The log can hand itself over in the platform's audit shape so the Event Bus of a later step can consume it.

import type { AuditEntry, MemoryEventInput, MemoryEventType } from "./memory-types";

export type MemoryLogEvent = Omit<MemoryEventInput, "detail"> & { id: string; detail?: Readonly<Record<string, string | number | boolean>> };
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

export class MemoryEventLog {
  private readonly events: MemoryLogEvent[] = [];
  private readonly listeners = new Set<(event: MemoryLogEvent) => void>();
  emit(input: MemoryEventInput): MemoryLogEvent {
    const detail = sanitizeDetail(input.detail);
    const event: MemoryLogEvent = { id: `me_${String(this.events.length + 1).padStart(6, "0")}`, at: input.at, tenantId: input.tenantId, actorKind: input.actorKind, actorId: input.actorId, type: input.type, ...(input.memoryId ? { memoryId: input.memoryId } : {}), ...(detail ? { detail } : {}) };
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
    return event;
  }
  listen(listener: (event: MemoryLogEvent) => void): () => void { this.listeners.add(listener); return () => void this.listeners.delete(listener); }
  all(): readonly MemoryLogEvent[] { return this.events; }
  forTenant(tenantId: string): readonly MemoryLogEvent[] { return this.events.filter((event) => event.tenantId === tenantId); }
  ofType(type: MemoryEventType): readonly MemoryLogEvent[] { return this.events.filter((event) => event.type === type); }
  toAudit(tenantId: string): readonly AuditEntry[] {
    return this.forTenant(tenantId).map((event) => ({ at: event.at, actor: event.actorKind === "system" ? "system" : event.actorId, tenantId: event.tenantId, action: event.type, ...(event.detail ? { detail: event.detail } : {}) }));
  }
}
