// Worker OS Events: what happened to the Workers' definitions of a company (created, updated, capabilities, permissions or tools changed, blocked, upgrades, rollbacks, health, policy checks), with ids and
// numbers ONLY. Free text is dropped before an event is kept; there is no field for a prompt, a context, a memory or an answer. The log can hand itself over in the platform's audit shape, and
// `toBusMessage` prepares each event for an Event Bus that a later sprint will connect: this layer publishes to nothing and touches no Backend Core.

import type { AuditEntry, OsEventInput, OsEventType } from "./worker-os-types";

export type OsLogEvent = Omit<OsEventInput, "detail"> & { id: string; detail?: Readonly<Record<string, string | number | boolean>> };
const SAFE_VALUE = /^[A-Za-z0-9_.:#>@-]{1,60}$/;

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

export class OsEventLog {
  private readonly events: OsLogEvent[] = [];
  private readonly listeners = new Set<(event: OsLogEvent) => void>();
  emit(input: OsEventInput): OsLogEvent {
    const detail = sanitizeDetail(input.detail);
    const event: OsLogEvent = {
      id: `oe_${String(this.events.length + 1).padStart(6, "0")}`, at: input.at, tenantId: input.tenantId, actorKind: input.actorKind, actorId: input.actorId, type: input.type,
      ...(input.workerId && SAFE_VALUE.test(input.workerId) ? { workerId: input.workerId } : {}), ...(detail ? { detail } : {}),
    };
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
    return event;
  }
  listen(listener: (event: OsLogEvent) => void): () => void { this.listeners.add(listener); return () => void this.listeners.delete(listener); }
  all(): readonly OsLogEvent[] { return this.events; }
  forTenant(tenantId: string): readonly OsLogEvent[] { return this.events.filter((event) => event.tenantId === tenantId); }
  ofType(type: OsEventType): readonly OsLogEvent[] { return this.events.filter((event) => event.type === type); }
  toAudit(tenantId: string): readonly AuditEntry[] {
    return this.forTenant(tenantId).map((event) => ({ at: event.at, actor: event.actorKind === "system" || event.actorKind === "nex" ? event.actorKind : event.actorId, tenantId: event.tenantId, action: event.type, ...(event.detail ? { detail: event.detail } : {}) }));
  }
}

/** The shape of a message for the future Event Bus: a topic per event family, scoped by company, ids and numbers only. Nothing is published here. */
export type BusMessage = { topic: string; tenantId: string; at: string; key: string; data: Readonly<Record<string, string | number | boolean>> };
export const BUS_TOPICS: readonly string[] = ["worker-os.worker", "worker-os.upgrade", "worker-os.health", "worker-os.policy", "worker-os.os"];
export function toBusMessage(event: OsLogEvent): BusMessage {
  const [family = "os"] = event.type.split(".");
  return { topic: `worker-os.${family}`, tenantId: event.tenantId, at: event.at, key: event.workerId ?? event.id, data: { type: event.type, eventId: event.id, ...(event.detail ?? {}) } };
}
