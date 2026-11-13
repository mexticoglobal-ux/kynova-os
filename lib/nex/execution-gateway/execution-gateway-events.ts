// Execution Gateway Events: what happened to the requests of a company (created, validated, every transition, each failed check by code, ready, blocked, rejected, cancelled, expired, dispatch lists), with
// ids and numbers ONLY. Free text is dropped before an event is kept; there is no field for a prompt, a context, a memory or an answer. The log can hand itself over in the platform's audit shape, and
// `toBusMessage` prepares each event for an Event Bus that a later sprint will connect: this layer publishes to nothing and touches no Backend Core.

import type { AuditEntry, GatewayEventInput, GatewayEventType } from "./execution-gateway-types";

export type GatewayLogEvent = Omit<GatewayEventInput, "detail"> & { id: string; detail?: Readonly<Record<string, string | number | boolean>> };
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

export class GatewayEventLog {
  private readonly events: GatewayLogEvent[] = [];
  private readonly listeners = new Set<(event: GatewayLogEvent) => void>();
  emit(input: GatewayEventInput): GatewayLogEvent {
    const detail = sanitizeDetail(input.detail);
    const event: GatewayLogEvent = {
      id: `ge_${String(this.events.length + 1).padStart(6, "0")}`, at: input.at, tenantId: input.tenantId, actorKind: input.actorKind, actorId: input.actorId, type: input.type,
      ...(input.requestId && SAFE_VALUE.test(input.requestId) ? { requestId: input.requestId } : {}), ...(detail ? { detail } : {}),
    };
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
    return event;
  }
  listen(listener: (event: GatewayLogEvent) => void): () => void { this.listeners.add(listener); return () => void this.listeners.delete(listener); }
  all(): readonly GatewayLogEvent[] { return this.events; }
  forTenant(tenantId: string): readonly GatewayLogEvent[] { return this.events.filter((event) => event.tenantId === tenantId); }
  ofType(type: GatewayEventType): readonly GatewayLogEvent[] { return this.events.filter((event) => event.type === type); }
  toAudit(tenantId: string): readonly AuditEntry[] {
    return this.forTenant(tenantId).map((event) => ({ at: event.at, actor: event.actorKind === "system" || event.actorKind === "nex" ? event.actorKind : event.actorId, tenantId: event.tenantId, action: event.type, ...(event.detail ? { detail: event.detail } : {}) }));
  }
}

/** The shape of a message for the future Event Bus: a topic per event family, scoped by company, ids and numbers only. Nothing is published here. */
export type BusMessage = { topic: string; tenantId: string; at: string; key: string; data: Readonly<Record<string, string | number | boolean>> };
export const BUS_TOPICS: readonly string[] = ["execution-gateway.request", "execution-gateway.gateway"];
export function toBusMessage(event: GatewayLogEvent): BusMessage {
  const [family = "gateway"] = event.type.split(".");
  return { topic: `execution-gateway.${family}`, tenantId: event.tenantId, at: event.at, key: event.requestId ?? event.id, data: { type: event.type, eventId: event.id, ...(event.detail ?? {}) } };
}
