// The internal Event Bus. Every module publishes what happened as a typed, validated, company-scoped event; the events go to an append-only store.
// Nothing consumes them yet: the bus only records, and KOE (or anything else) will read them later through `read`, one company at a time.
// An event never carries a secret, and a module can only publish events of its own. Pure and in memory: no network, no database.
import { randomToken } from "./crypto";

export const MODULE_IDS = ["users", "organizations", "workers", "automations", "marketplace", "academy", "crm", "billing", "insights", "developer", "communications", "koe"] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

export type FieldType = "string" | "number" | "boolean" | "string?" | "number?" | "boolean?";
export type EventDef = { type: string; module: ModuleId; description: string; payload: Readonly<Record<string, FieldType>> };

const def = (module: ModuleId, name: string, description: string, payload: Record<string, FieldType>): EventDef => ({ type: `${module}.${name}`, module, description, payload });
const audit = (module: ModuleId): EventDef => def(module, "audit.recorded", "Algo quedó registrado en la auditoría del módulo.", { action: "string", category: "string", detail: "string?" });

/** Every event the platform knows. A new event is added here first. */
export const EVENT_CATALOG: readonly EventDef[] = [
  def("users", "invited", "Se invitó a una persona.", { userId: "string", roleId: "string" }),
  def("users", "role.changed", "Cambió el rol de una persona.", { userId: "string", from: "string", to: "string" }),
  audit("users"),
  def("organizations", "created", "Se creó una empresa.", { organizationId: "string", name: "string" }),
  def("organizations", "member.joined", "Una persona entró a la empresa.", { userId: "string", roleId: "string" }),
  audit("organizations"),
  def("workers", "installed", "Se instaló un Worker.", { workerId: "string", name: "string" }),
  def("workers", "run.completed", "Un Worker terminó una ejecución.", { workerId: "string", runId: "string", outcome: "string", costMicros: "number" }),
  audit("workers"),
  def("automations", "activated", "Se activó una automatización.", { automationId: "string" }),
  def("automations", "run.finished", "Terminó la corrida de una automatización.", { automationId: "string", runId: "string", outcome: "string" }),
  audit("automations"),
  def("marketplace", "listing.published", "Se publicó un artículo.", { listingId: "string", kind: "string" }),
  def("marketplace", "purchase.completed", "Se completó una compra.", { purchaseId: "string", listingId: "string" }),
  audit("marketplace"),
  def("academy", "course.completed", "Una persona terminó un curso.", { courseId: "string", userId: "string" }),
  def("academy", "certificate.issued", "Se emitió un certificado.", { certificateId: "string", courseId: "string" }),
  audit("academy"),
  def("crm", "lead.created", "Entró un prospecto.", { leadId: "string", source: "string" }),
  def("crm", "deal.won", "Se ganó una oportunidad.", { opportunityId: "string", valueMicros: "number" }),
  audit("crm"),
  def("billing", "invoice.issued", "Se emitió una factura.", { invoiceId: "string", totalMicros: "number" }),
  def("billing", "plan.changed", "Cambió el plan.", { from: "string", to: "string" }),
  audit("billing"),
  def("insights", "report.generated", "Se generó un reporte.", { reportId: "string" }),
  audit("insights"),
  def("developer", "key.created", "Se creó una API Key.", { keyId: "string", appId: "string" }),
  def("developer", "webhook.delivered", "Se entregó un webhook.", { deliveryId: "string", status: "number" }),
  audit("developer"),
  def("communications", "message.received", "Llegó un mensaje.", { conversationId: "string", channel: "string" }),
  def("communications", "message.sent", "Se envió un mensaje.", { conversationId: "string" }),
  audit("communications"),
  def("koe", "decision.recorded", "KOE registró una decisión.", { decisionId: "string", kind: "string" }),
  audit("koe"),
];
const BY_TYPE = new Map(EVENT_CATALOG.map((item) => [item.type, item]));
export const eventDef = (type: string): EventDef | undefined => BY_TYPE.get(type);

export type PlatformEvent = {
  id: string;
  type: string;
  version: 1;
  module: ModuleId;
  tenantId: string;
  organizationId?: string;
  /** A person, `worker:<id>` or `system`. */
  actor: string;
  at: string;
  correlationId?: string;
  payload: Readonly<Record<string, unknown>>;
};
export type StoredEvent = PlatformEvent & { seq: number };

const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
// A payload names what happened, never a credential.
const FORBIDDEN_KEY = /(secret|password|passwd|token|api_?key|authorization|credential|private_?key)/i;

/** The problems of an event, in Spanish. Empty when it is valid. */
export function validateEvent(event: PlatformEvent): string[] {
  const problems: string[] = [];
  const definition = BY_TYPE.get(event.type);
  if (!definition) return [`el evento «${event.type}» no está en el catálogo`];
  if (definition.module !== event.module) problems.push(`el evento ${event.type} es del módulo ${definition.module}, no de ${event.module}`);
  if (!ID.test(event.tenantId)) problems.push("falta la empresa (tenantId)");
  if (event.organizationId !== undefined && !ID.test(event.organizationId)) problems.push("organizationId no es válido");
  if (!ID.test(event.id)) problems.push("el id no es válido");
  if (event.actor.trim() === "" || event.actor.length > 64) problems.push("falta quién lo hizo");
  if (Number.isNaN(Date.parse(event.at))) problems.push("la fecha no es válida");
  for (const [key, type] of Object.entries(definition.payload)) {
    const value = event.payload[key];
    const optional = type.endsWith("?");
    if (value === undefined) { if (!optional) problems.push(`falta el dato «${key}»`); continue; }
    if (typeof value !== type.replace("?", "")) problems.push(`el dato «${key}» debe ser ${type.replace("?", "")}`);
  }
  for (const key of Object.keys(event.payload)) {
    if (!(key in definition.payload)) problems.push(`el dato «${key}» no existe en ${event.type}`);
    if (FORBIDDEN_KEY.test(key)) problems.push(`el dato «${key}» parece una credencial: un evento nunca la lleva`);
  }
  return problems;
}

// ---------------------------------------------------------------- the store (append-only)
export type AppendResult = { seq: number; duplicate: boolean };

/** Where events are kept. Only append and read: there is no way to change or remove an event, and reading always names a company. */
export class InMemoryEventStore {
  private readonly events: StoredEvent[] = [];
  private readonly ids = new Set<string>();

  append(event: PlatformEvent): AppendResult {
    if (this.ids.has(event.id)) return { seq: this.events.find((item) => item.id === event.id)?.seq ?? 0, duplicate: true }; // the same event twice is one event
    const stored: StoredEvent = Object.freeze({ ...event, payload: Object.freeze({ ...event.payload }), seq: this.events.length + 1 });
    this.events.push(stored);
    this.ids.add(event.id);
    return { seq: stored.seq, duplicate: false };
  }

  /** The events of ONE company after a position, oldest first. This is how KOE will consume them. */
  read(options: { tenantId: string; after?: number; limit?: number; types?: readonly string[] }): StoredEvent[] {
    const { tenantId, after = 0, limit = 100, types } = options;
    return this.events.filter((item) => item.tenantId === tenantId && item.seq > after && (!types || types.includes(item.type))).slice(0, limit);
  }

  get size(): number {
    return this.events.length;
  }
}

// ---------------------------------------------------------------- the bus
export type PublishInput = Omit<PlatformEvent, "id" | "at" | "version"> & { id?: string; at?: string };
export type PublishResult = { ok: true; seq: number; duplicate: boolean; id: string } | { ok: false; problems: string[] };
export type EventHandler = (event: StoredEvent) => void;

export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler>>();
  constructor(
    readonly store: InMemoryEventStore = new InMemoryEventStore(),
    private readonly clock: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = () => `evt_${randomToken(9)}`,
  ) {}

  publish(input: PublishInput): PublishResult {
    const event: PlatformEvent = { ...input, id: input.id ?? this.newId(), at: input.at ?? this.clock(), version: 1 };
    const problems = validateEvent(event);
    if (problems.length > 0) return { ok: false, problems };
    const { seq, duplicate } = this.store.append(event);
    if (!duplicate) {
      const stored = this.store.read({ tenantId: event.tenantId, after: seq - 1, limit: 1 })[0];
      if (stored) for (const handler of [...(this.handlers.get(event.type) ?? []), ...(this.handlers.get("*") ?? [])]) {
        try { handler(stored); } catch { /* a failing consumer never breaks the publisher */ }
      }
    }
    return { ok: true, seq, duplicate, id: event.id };
  }

  /** Subscribing is possible, but nothing subscribes yet: the bus only records. Returns the way to stop. */
  subscribe(type: string, handler: EventHandler): () => void {
    const set = this.handlers.get(type) ?? new Set<EventHandler>();
    set.add(handler);
    this.handlers.set(type, set);
    return () => void set.delete(handler);
  }

  subscribers(): number {
    let total = 0;
    for (const set of this.handlers.values()) total += set.size;
    return total;
  }
}

/** What a module uses to publish: it can only publish events of its own module, always for one company. */
export function publisherFor(bus: EventBus, module: ModuleId, scope: { tenantId: string; organizationId?: string }) {
  return {
    publish(name: string, payload: Record<string, unknown>, options: { actor: string; correlationId?: string; at?: string }): PublishResult {
      const type = `${module}.${name}`;
      if (!BY_TYPE.has(type)) return { ok: false, problems: [`el evento «${type}» no está en el catálogo`] };
      return bus.publish({ type, module, tenantId: scope.tenantId, ...(scope.organizationId ? { organizationId: scope.organizationId } : {}), actor: options.actor, ...(options.correlationId ? { correlationId: options.correlationId } : {}), ...(options.at ? { at: options.at } : {}), payload });
    },
  };
}

/** What every module's own audit entries look like (the platform modules all share this shape). */
export type ModuleEntry = { at: string; actor: string; action: string; category?: string; kind?: string; detail?: string };

/** Turns an entry of any module's own audit trail into the one audit event, so every module can publish through the same contract. */
export function eventFromEntry(module: ModuleId, tenantId: string, entry: ModuleEntry): PublishInput {
  return {
    type: `${module}.audit.recorded`, module, tenantId, actor: entry.actor, at: entry.at,
    payload: { action: entry.action, category: entry.category ?? entry.kind ?? "other", ...(entry.detail ? { detail: entry.detail.slice(0, 500) } : {}) },
  };
}
