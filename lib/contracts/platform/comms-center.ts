// Communications Hub store: a company's conversations across every channel, in one place. Pure and deterministic, one global state
// with every record owned by a company (tenant). It holds the conversations, their append-only history, KOE's routing decisions, the
// drafts NEX prepares and the assignment authorizations. All the understanding (urgency, sentiment, intent, next best action) and the
// routing (which Worker, which model) is worked out by koe-comms.ts; here a result is only RECORDED. Nothing is ever sent.
//
// Constitution (ADR-0009), enforced by how the events are built and tested:
// - Level 1 (NEX prepares): classify a conversation, tag it, route it through KOE, prepare drafts of the reply and revise its own drafts.
// - Level 2 (a standing authorization): reassign a conversation. A person granted a vigente authorization with its limits.
// - Level 3 (a person only): send a message, close a case, delete anything. There is NO event to send or to delete, and resolving or
//   archiving is always a person's decision. A draft "ready" only means a person may send it themselves, outside the platform.
// - Customers' messages arrive through the platform ("system"), never typed in by a person or NEX. Internal notes are never part of
//   anything a customer can see or of any draft.

import { isPerson, isWorker } from "./actors";
import { DEFAULT_KOE_ENV, type KoeEnv } from "./automation-koe";
import { message, type ErrorCode } from "./comms-messages";
import { CHANNELS_INFO, analyzeConversation, draftReply, entriesOf, linkHint, routeConversation, type ConversationInsight } from "./koe-comms";
import { looksSecret, type Priority } from "./koe-registry";
import type { CrmState } from "./crm-center";
import { decide, type Authorization } from "./workers";

export { DEFAULT_KOE_ENV, type KoeEnv } from "./automation-koe";

export const CHANNELS = ["email", "whatsapp", "messenger", "instagram", "webchat", "webform", "sms"] as const;
export type Channel = (typeof CHANNELS)[number];
export type ConvStatus = "open" | "pending" | "resolved" | "archived";
export type DraftKind = "email" | "whatsapp" | "messenger" | "instagram" | "chat" | "form";
export type EntryKind = "email" | "whatsapp" | "messenger" | "instagram" | "chat" | "form" | "sms" | "note" | "worker" | "automation" | "audit" | "crm" | "assignment" | "status" | "tag" | "nex" | "routing";
export const ASSIGN_AUTH_ACTION = "comms.assign.auto";

export type Conversation = {
  id: string; tenantId: string; channel: Channel; subject: string; contact: { name: string; handle: string }; company: string;
  status: ConvStatus; assignee: string; tags: readonly string[]; link: { leadId?: string; customerId?: string };
  createdAt: string; lastActivityAt: string;
};
// One append-only list: customer messages, recorded replies, internal notes, and what Workers, automations, audits and the CRM did.
// `internal` entries (notes, assignments, routing...) are for the team only and never reach the customer.
export type Entry = { id: string; tenantId: string; conversationId: string; at: string; kind: EntryKind; direction?: "in" | "out"; text: string; actor: string; internal: boolean; ref?: string };
// What KOE decided, with the Worker and the model it used. Appended every time; an earlier one is never rewritten.
export type Routing = {
  id: string; tenantId: string; conversationId: string; at: string; trigger: "receive" | "classify" | "route"; specialty: string; workerId: string; workerName: string;
  model: { id: string; label: string }; modelReason: string; priority: Priority; estimatedCostMicros: number; reason: string;
  snapshot: Pick<ConversationInsight, "urgency" | "sentiment" | "intent" | "category" | "saleProbability" | "supportProbability" | "waitMinutes"> & { nextBest: ConversationInsight["nextBest"] };
};
export type DraftRevision = { at: string; by: string; subject?: string; body: string };
export type Draft = {
  id: string; tenantId: string; conversationId: string; kind: DraftKind; reason: string; status: "draft" | "ready" | "discarded"; revisions: readonly DraftRevision[];
  createdBy: string; createdAt: string; decidedBy?: string; decidedAt?: string;
};
export type Grant = { id: string; tenantId: string; action: typeof ASSIGN_AUTH_ACTION; status: "active" | "revoked"; maxPerDay?: number; expiresAt?: string; grantedBy: string; grantedAt: string };
export type CommsAudit = { at: string; actor: string; tenantId: string; action: string; detail?: string };
export type CommsLog = { at: string; level: "info" | "warn"; event: string };

export type CommsState = {
  conversations: readonly Conversation[]; entries: readonly Entry[]; routings: readonly Routing[]; drafts: readonly Draft[]; grants: readonly Grant[];
  audit: readonly CommsAudit[]; logs: readonly CommsLog[]; sequence: number;
};
export const newCommsState = (): CommsState => ({ conversations: [], entries: [], routings: [], drafts: [], grants: [], audit: [], logs: [], sequence: 0 });

/** What KOE knows from other modules, by id only: the CRM's prospects and customers a conversation can be linked to. */
export type Ref = { id: string; tenantId: string };
export type CommsEnv = KoeEnv & { refs: { leads: readonly Ref[]; customers: readonly Ref[] }; crm?: CrmState };
export const DEFAULT_COMMS_ENV: CommsEnv = { ...DEFAULT_KOE_ENV, refs: { leads: [], customers: [] } };

export type OpenInput = { channel: Channel; subject: string; contact: { name: string; handle: string }; company: string; text: string };
type Base = { at: string; tenantId: string; actor: string };
export type CommsEvent =
  | (Base & { type: "conversation.open"; input: OpenInput })
  | (Base & { type: "message.receive"; conversationId: string; text: string })
  | (Base & { type: "message.record"; conversationId: string; text: string })
  | (Base & { type: "timeline.record"; conversationId: string; kind: "worker" | "automation" | "audit" | "crm"; text: string; ref?: string })
  | (Base & { type: "conversation.link"; conversationId: string; leadId?: string; customerId?: string })
  | (Base & { type: "conversation.classify"; conversationId: string })
  | (Base & { type: "tag.add"; conversationId: string; tag: string })
  | (Base & { type: "tag.remove"; conversationId: string; tag: string })
  | (Base & { type: "draft.create"; conversationId: string })
  | (Base & { type: "draft.revise"; draftId: string; body: string; subject?: string })
  | (Base & { type: "draft.ready"; draftId: string })
  | (Base & { type: "draft.discard"; draftId: string })
  | (Base & { type: "conversation.assign"; conversationId: string; assignee: string })
  | (Base & { type: "status.set"; conversationId: string; to: ConvStatus })
  | (Base & { type: "note.add"; conversationId: string; text: string })
  | (Base & { type: "authorization.grant"; maxPerDay?: number; expiresAt?: string })
  | (Base & { type: "authorization.revoke"; grantId: string });
export type CommsResult = { state: CommsState; error?: string; errorCode?: ErrorCode };

// ---------------------------------------------------------------- helpers
// Nothing is ever trimmed or deleted: every list only grows. Limits belong to the view (display.ts).
const append = <T,>(items: readonly T[], item: T): readonly T[] => [...items, item];
const replace = <T extends { id: string }>(items: readonly T[], item: T): readonly T[] => items.map((existing) => (existing.id === item.id ? item : existing));
const nextId = (state: CommsState, prefix: string): { id: string; state: CommsState } => {
  const sequence = state.sequence + 1;
  return { id: `${prefix}_${String(sequence).padStart(5, "0")}`, state: { ...state, sequence } };
};
const note = (state: CommsState, event: { at: string; actor: string; tenantId: string }, action: string, detail?: string, level: CommsLog["level"] = "info"): CommsState => ({
  ...state,
  audit: append(state.audit, { at: event.at, actor: event.actor, tenantId: event.tenantId, action, detail }),
  logs: append(state.logs, { at: event.at, level, event: detail ? `${action}: ${detail}` : action }),
});
const sameDay = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10);
const TAG = /^[a-z0-9áéíóúñ][a-z0-9áéíóúñ:-]{0,29}$/;
const STATUS_TEXT: Record<ConvStatus, string> = { open: "abierta", pending: "pendiente", resolved: "resuelta", archived: "archivada" };

export function validateOpen(input: OpenInput): string[] {
  const issues: string[] = [];
  if (!CHANNELS.includes(input.channel)) issues.push("canal");
  if (input.subject.trim() === "" || input.subject.length > 120) issues.push("asunto (1 a 120 caracteres)");
  if (input.contact.name.trim() === "" || input.contact.name.length > 80) issues.push("nombre del contacto");
  if (input.contact.handle.trim() === "" || input.contact.handle.length > 120) issues.push("dato de contacto");
  if (input.company.length > 80) issues.push("empresa");
  if (input.text.trim() === "" || input.text.length > 2_000) issues.push("el mensaje (1 a 2000 caracteres)");
  return issues;
}

// ---------------------------------------------------------------- the reducer
export function reduceComms(state: CommsState, event: CommsEvent, env: CommsEnv = DEFAULT_COMMS_ENV): CommsResult {
  const person = isPerson(event.actor);
  const refuse = (code: ErrorCode, params?: Record<string, string | number>): CommsResult => ({ state, error: message(code, params), errorCode: code });
  const needPerson = (): CommsResult | null => (person ? null : refuse("personRequired"));
  const needDrafter = (): CommsResult | null => (person || isWorker(event.actor) ? null : refuse("personRequired"));
  const needSystem = (): CommsResult | null => (event.actor === "system" ? null : refuse("systemOnly"));
  const find = (id: string): { conversation?: Conversation; failure?: CommsResult } => {
    const conversation = state.conversations.find((item) => item.id === id);
    if (!conversation) return { failure: refuse("notFound") };
    if (conversation.tenantId !== event.tenantId) return { failure: refuse("notYours") };
    return { conversation };
  };
  const entry = (st: CommsState, conversation: Conversation, kind: EntryKind, text: string, actor: string, extra: Partial<Entry> = {}): CommsState => {
    const made = nextId(st, "en");
    const internal = !["email", "whatsapp", "messenger", "instagram", "chat", "form", "sms"].includes(kind);
    return { ...made.state, entries: append(made.state.entries, { id: made.id, tenantId: event.tenantId, conversationId: conversation.id, at: event.at, kind, text: text.slice(0, 2_000), actor, internal, ...extra }) };
  };
  const touch = (st: CommsState, id: string, patch: Partial<Conversation> = {}): CommsState => {
    const current = st.conversations.find((item) => item.id === id) as Conversation;
    return { ...st, conversations: replace(st.conversations, { ...current, ...patch, lastActivityAt: event.at }) };
  };
  const analyse = (st: CommsState, conversation: Conversation): ConversationInsight => analyzeConversation(conversation, entriesOf(st, conversation.tenantId, conversation.id), event.at, linkHint(env.crm, conversation));
  /** KOE routes a conversation: the Worker, the specialty, the priority and the model are decided here, never by a screen. */
  const route = (st: CommsState, conversation: Conversation, trigger: Routing["trigger"]): { state: CommsState } | { problem: string } => {
    const insight = analyse(st, conversation);
    const decided = routeConversation(env, event.tenantId, insight);
    if ("problem" in decided) return { problem: decided.problem };
    const made = nextId(st, "ro");
    const routing: Routing = {
      id: made.id, tenantId: event.tenantId, conversationId: conversation.id, at: event.at, trigger, specialty: decided.specialty, workerId: decided.workerId, workerName: decided.workerName, model: decided.model,
      modelReason: decided.modelReason, priority: decided.priority, estimatedCostMicros: decided.estimatedCostMicros, reason: decided.reason,
      snapshot: { urgency: insight.urgency, sentiment: insight.sentiment, intent: insight.intent, category: insight.category, saleProbability: insight.saleProbability, supportProbability: insight.supportProbability, waitMinutes: insight.waitMinutes, nextBest: insight.nextBest },
    };
    return { state: entry({ ...made.state, routings: append(made.state.routings, routing) }, conversation, "routing", `KOE enrutó la conversación a ${decided.workerName} (${decided.specialty}), prioridad ${decided.priority}, modelo ${decided.model.label}.`, `worker:${decided.workerId}`) };
  };
  const autoAssignAllowed = (st: CommsState): boolean => {
    const grant = st.grants.find((item) => item.tenantId === event.tenantId && item.status === "active" && (!item.expiresAt || Date.parse(item.expiresAt) > Date.parse(event.at)));
    if (!grant) return false;
    const usedToday = st.audit.filter((item) => item.tenantId === event.tenantId && item.action === "assign.auto" && sameDay(item.at, event.at)).length;
    const authorization: Authorization = { action: ASSIGN_AUTH_ACTION, status: "active", maxPerDay: grant.maxPerDay, usedToday, expiresAt: grant.expiresAt };
    return decide(ASSIGN_AUTH_ACTION, authorization, new Date(event.at)).allowed;
  };

  switch (event.type) {
    // ---- what the customers write arrives through the platform, never from a person or NEX
    case "conversation.open": {
      const denied = needSystem();
      if (denied) return denied;
      if (event.input.channel === "sms" || CHANNELS_INFO[event.input.channel]?.future) return refuse("channelFuture");
      const issues = validateOpen(event.input);
      if (issues.length) return refuse("invalid", { detail: issues[0] });
      const made = nextId(state, "cv");
      const conversation: Conversation = { id: made.id, tenantId: event.tenantId, channel: event.input.channel, subject: event.input.subject.trim(), contact: { name: event.input.contact.name.trim(), handle: event.input.contact.handle.trim() }, company: event.input.company.trim(), status: "open", assignee: "", tags: [], link: {}, createdAt: event.at, lastActivityAt: event.at };
      let next: CommsState = { ...made.state, conversations: append(made.state.conversations, conversation) };
      next = entry(next, conversation, CHANNELS_INFO[conversation.channel].entry, event.input.text, "customer", { direction: "in" });
      const routed = route(next, conversation, "receive"); // best effort: a message is never lost because KOE has no Worker at that moment
      next = "state" in routed ? routed.state : note(next, event, "routing.pending", `${made.id} · ${routed.problem}`, "warn");
      return { state: note(next, event, "conversation.open", `${made.id} · ${conversation.channel}`) };
    }

    case "message.receive": {
      const denied = needSystem();
      if (denied) return denied;
      const { conversation, failure } = find(event.conversationId);
      if (!conversation) return failure as CommsResult;
      if (event.text.trim() === "" || event.text.length > 2_000) return refuse("invalid", { detail: "el mensaje (1 a 2000 caracteres)" });
      let next = entry(state, conversation, CHANNELS_INFO[conversation.channel].entry, event.text, "customer", { direction: "in" });
      const reopened = conversation.status === "resolved" || conversation.status === "archived";
      next = touch(next, conversation.id, reopened ? { status: "open" } : {});
      if (reopened) next = entry(next, conversation, "status", `Reabierta por un mensaje nuevo del cliente (estaba ${STATUS_TEXT[conversation.status]}).`, "system"); // a new customer message reopens it; nothing is ever closed on its own
      const fresh = next.conversations.find((item) => item.id === conversation.id) as Conversation;
      const routed = route(next, fresh, "receive");
      next = "state" in routed ? routed.state : note(next, event, "routing.pending", `${conversation.id} · ${routed.problem}`, "warn");
      return { state: note(next, event, "message.receive", conversation.id) };
    }

    case "timeline.record": {
      const denied = needSystem(); // Workers, automations, Business Audits and the CRM report what they did through KOE
      if (denied) return denied;
      const { conversation, failure } = find(event.conversationId);
      if (!conversation) return failure as CommsResult;
      if (event.text.trim() === "" || event.text.length > 300) return refuse("invalid", { detail: "el texto" });
      return { state: entry(state, conversation, event.kind, event.text, "system", event.ref ? { ref: event.ref } : {}) };
    }

    // ---- a person records what they did outside the platform; the platform sends nothing
    case "message.record": {
      const denied = needPerson();
      if (denied) return denied;
      const { conversation, failure } = find(event.conversationId);
      if (!conversation) return failure as CommsResult;
      if (event.text.trim() === "" || event.text.length > 2_000) return refuse("invalid", { detail: "el mensaje (1 a 2000 caracteres)" });
      const next = entry(state, conversation, CHANNELS_INFO[conversation.channel].entry, `${event.text} (respuesta enviada fuera de la plataforma y registrada por ${event.actor})`, event.actor, { direction: "out" });
      return { state: note(touch(next, conversation.id), event, "message.record", conversation.id) };
    }

    case "conversation.link": {
      const denied = needPerson();
      if (denied) return denied;
      const { conversation, failure } = find(event.conversationId);
      if (!conversation) return failure as CommsResult;
      if (!event.leadId && !event.customerId) return refuse("invalid", { detail: "un prospecto o un cliente del CRM" });
      if (event.leadId && !env.refs.leads.some((item) => item.id === event.leadId && item.tenantId === event.tenantId)) return refuse("invalid", { detail: "ese prospecto no existe en su empresa" });
      if (event.customerId && !env.refs.customers.some((item) => item.id === event.customerId && item.tenantId === event.tenantId)) return refuse("invalid", { detail: "ese cliente no existe en su empresa" });
      const link = { ...(event.leadId ? { leadId: event.leadId } : {}), ...(event.customerId ? { customerId: event.customerId } : {}) };
      const next = entry(touch(state, conversation.id, { link: { ...conversation.link, ...link } }), conversation, "crm", `${event.actor} vinculó la conversación con el CRM (${event.leadId ?? event.customerId}).`, event.actor);
      return { state: note(next, event, "conversation.link", `${conversation.id} → ${event.leadId ?? event.customerId}`) };
    }

    // ---- Level 1: NEX classifies, tags, routes and drafts
    case "conversation.classify": {
      const denied = needDrafter();
      if (denied) return denied;
      const { conversation, failure } = find(event.conversationId);
      if (!conversation) return failure as CommsResult;
      const routed = route(state, conversation, "classify");
      if (!("state" in routed)) return refuse("noWorker", { detail: routed.problem });
      const insight = analyse(routed.state, conversation);
      const suggested = [`categoría:${insight.category}`, `intención:${insight.intent}`].filter((tag) => !conversation.tags.includes(tag));
      let next = touch(routed.state, conversation.id, { tags: [...conversation.tags, ...suggested] });
      if (suggested.length) next = entry(next, conversation, "tag", `Etiquetas añadidas por la clasificación: ${suggested.join(", ")}.`, event.actor);
      return { state: note(next, event, "conversation.classify", `${conversation.id} · ${insight.category}/${insight.intent}`) };
    }

    case "tag.add":
    case "tag.remove": {
      const denied = event.type === "tag.add" ? needDrafter() : needPerson(); // NEX may label; removing a label is a person's
      if (denied) return denied;
      const { conversation, failure } = find(event.conversationId);
      if (!conversation) return failure as CommsResult;
      const tag = event.tag.trim().toLowerCase();
      if (!TAG.test(tag)) return refuse("invalid", { detail: "la etiqueta (minúsculas, hasta 30 caracteres)" });
      const has = conversation.tags.includes(tag);
      if (event.type === "tag.add" ? has : !has) return refuse("alreadyThere");
      const tags = event.type === "tag.add" ? [...conversation.tags, tag] : conversation.tags.filter((item) => item !== tag);
      const next = entry(touch(state, conversation.id, { tags }), conversation, "tag", `${event.type === "tag.add" ? "Etiqueta añadida" : "Etiqueta quitada"}: ${tag}.`, event.actor);
      return { state: note(next, event, event.type, `${conversation.id} · ${tag}`) };
    }

    case "draft.create": {
      const denied = needDrafter();
      if (denied) return denied;
      const { conversation, failure } = find(event.conversationId);
      if (!conversation) return failure as CommsResult;
      if (conversation.status === "archived") return refuse("closedConversation", { status: STATUS_TEXT[conversation.status] });
      const entries = entriesOf(state, conversation.tenantId, conversation.id).filter((item) => !item.internal); // the draft reads only what the customer can see: never an internal note
      const insight = analyzeConversation(conversation, entries, event.at, linkHint(env.crm, conversation));
      const content = draftReply(conversation, entries, insight);
      if (!content) return refuse("noChannelDraft");
      const made = nextId(state, "dr");
      const draft: Draft = { id: made.id, tenantId: event.tenantId, conversationId: conversation.id, kind: content.kind, reason: content.reason, status: "draft", revisions: [{ at: event.at, by: event.actor, ...(content.subject ? { subject: content.subject } : {}), body: content.body }], createdBy: event.actor, createdAt: event.at };
      const next = entry({ ...made.state, drafts: append(made.state.drafts, draft) }, conversation, "nex", `Se preparó un borrador de ${content.kind}. No se envió: lo revisa una persona.`, event.actor);
      return { state: note(next, event, "draft.create", `${made.id} · ${conversation.id}`) };
    }

    case "draft.revise":
    case "draft.ready":
    case "draft.discard": {
      const denied = event.type === "draft.revise" ? needDrafter() : needPerson(); // a person decides what is ready; NEX can only improve a draft
      if (denied) return denied;
      const draft = state.drafts.find((item) => item.id === event.draftId);
      if (!draft) return refuse("notFound");
      if (draft.tenantId !== event.tenantId) return refuse("notYours");
      if (draft.status !== "draft") return refuse("draftClosed");
      if (event.type === "draft.revise") {
        if (event.body.trim() === "" || event.body.length > 4_000 || looksSecret(event.body)) return refuse("invalid", { detail: "el texto del borrador (sin secretos, hasta 4000 caracteres)" });
        const revision: DraftRevision = { at: event.at, by: event.actor, ...(event.subject ? { subject: event.subject.slice(0, 160) } : {}), body: event.body }; // a new revision: the earlier text stays
        return { state: note({ ...state, drafts: replace(state.drafts, { ...draft, revisions: append(draft.revisions, revision) }) }, event, "draft.revise", `${draft.id} · revisión ${draft.revisions.length + 1}`) };
      }
      const status: Draft["status"] = event.type === "draft.ready" ? "ready" : "discarded";
      return { state: note({ ...state, drafts: replace(state.drafts, { ...draft, status, decidedBy: event.actor, decidedAt: event.at }) }, event, event.type, draft.id) };
    }

    // ---- assignments: a person assigns; NEX only inside a standing authorization (Level 2)
    case "conversation.assign": {
      const denied = needDrafter();
      if (denied) return denied;
      const { conversation, failure } = find(event.conversationId);
      if (!conversation) return failure as CommsResult;
      if (conversation.status === "archived" || conversation.status === "resolved") return refuse("closedConversation", { status: STATUS_TEXT[conversation.status] });
      const assignee = event.assignee.trim();
      if (assignee.length > 40 || assignee.startsWith("worker:") || assignee === "system") return refuse("invalid", { detail: "el responsable debe ser una persona" });
      if (assignee === conversation.assignee) return refuse("alreadyThere");
      if (!person && !autoAssignAllowed(state)) return refuse("needsAuthorization");
      const text = assignee === "" ? `${event.actor} dejó la conversación sin responsable (antes: ${conversation.assignee || "nadie"}).` : `${event.actor} asignó la conversación a ${assignee} (antes: ${conversation.assignee || "nadie"}).`;
      const next = entry(touch(state, conversation.id, { assignee }), conversation, "assignment", text, event.actor);
      return { state: note(next, event, person ? "assign" : "assign.auto", `${conversation.id} · ${conversation.assignee || "nadie"} → ${assignee || "nadie"}`) };
    }

    case "status.set": {
      const denied = needPerson(); // resolving or archiving a case is always a person's decision; nothing is closed automatically
      if (denied) return denied;
      const { conversation, failure } = find(event.conversationId);
      if (!conversation) return failure as CommsResult;
      if (!(["open", "pending", "resolved", "archived"] as const).includes(event.to)) return refuse("invalid", { detail: "estado" });
      if (event.to === conversation.status) return refuse("alreadyThere");
      const next = entry(touch(state, conversation.id, { status: event.to }), conversation, "status", `${event.actor} cambió el estado de «${STATUS_TEXT[conversation.status]}» a «${STATUS_TEXT[event.to]}».`, event.actor);
      return { state: note(next, event, "status.set", `${conversation.id} · ${conversation.status} → ${event.to}`, event.to === "open" ? "info" : "warn") };
    }

    case "note.add": {
      const denied = needPerson();
      if (denied) return denied;
      const { conversation, failure } = find(event.conversationId);
      if (!conversation) return failure as CommsResult;
      if (event.text.trim() === "" || event.text.length > 1_000 || looksSecret(event.text)) return refuse("invalid", { detail: "la nota (1 a 1000 caracteres, sin secretos)" });
      const next = entry(state, conversation, "note", event.text.trim(), event.actor); // internal: never visible to the customer
      return { state: note(next, event, "note.add", conversation.id) };
    }

    case "authorization.grant": {
      const denied = needPerson();
      if (denied) return denied;
      if (event.maxPerDay !== undefined && (!Number.isInteger(event.maxPerDay) || event.maxPerDay < 1 || event.maxPerDay > 100)) return refuse("invalid", { detail: "usos por día de 1 a 100" });
      if (event.expiresAt !== undefined && !(Date.parse(event.expiresAt) > Date.parse(event.at))) return refuse("invalid", { detail: "la fecha de vencimiento debe ser futura" });
      const made = nextId(state, "gr");
      const grant: Grant = { id: made.id, tenantId: event.tenantId, action: ASSIGN_AUTH_ACTION, status: "active", maxPerDay: event.maxPerDay, expiresAt: event.expiresAt, grantedBy: event.actor, grantedAt: event.at };
      return { state: note({ ...made.state, grants: append(made.state.grants, grant) }, event, "authorization.grant", `${made.id} · ${ASSIGN_AUTH_ACTION}`) };
    }

    case "authorization.revoke": {
      const denied = needPerson();
      if (denied) return denied;
      const grant = state.grants.find((item) => item.id === event.grantId);
      if (!grant) return refuse("notFound");
      if (grant.tenantId !== event.tenantId) return refuse("notYours");
      return { state: note({ ...state, grants: replace(state.grants, { ...grant, status: "revoked" }) }, event, "authorization.revoke", grant.id, "warn") };
    }
  }
}

export function applyAllComms(state: CommsState, events: readonly CommsEvent[], env: CommsEnv = DEFAULT_COMMS_ENV): { state: CommsState; errors: string[] } {
  const errors: string[] = [];
  let current = state;
  for (const event of events) {
    const result = reduceComms(current, event, env);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    current = result.state;
  }
  return { state: current, errors };
}

export const conversationsOf = (state: CommsState, tenantId: string) => state.conversations.filter((item) => item.tenantId === tenantId);
export const draftsOf = (state: CommsState, tenantId: string, conversationId?: string) => state.drafts.filter((item) => item.tenantId === tenantId && (!conversationId || item.conversationId === conversationId));
export const routingsOf = (state: CommsState, tenantId: string, conversationId?: string) => state.routings.filter((item) => item.tenantId === tenantId && (!conversationId || item.conversationId === conversationId));
export const latestRouting = (state: CommsState, tenantId: string, conversationId: string): Routing | undefined => routingsOf(state, tenantId, conversationId).at(-1);
export const grantsOf = (state: CommsState, tenantId: string) => state.grants.filter((item) => item.tenantId === tenantId);
/** What a customer could ever see of a conversation: its messages, never an internal note or the team's work. */
export const customerVisible = (state: CommsState, tenantId: string, conversationId: string): Entry[] => state.entries.filter((item) => item.tenantId === tenantId && item.conversationId === conversationId && !item.internal);
