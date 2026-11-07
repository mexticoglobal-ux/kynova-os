// KOE Communications Intelligence: the ONE place where a conversation is understood and routed. It works out urgency, a simulated
// sentiment, the intent and category, the probability of a sale or of a support case, the waiting time, the next best action and its
// reason; it decides which Worker should attend it, which specialty it needs, its priority and which model KOE's router picks; it
// prepares the draft of a reply; and it assembles the inbox, the omnichannel timeline and the customer context. Every screen only
// formats these answers, and no other module repeats this logic. Pure and deterministic: the same records and the same "now" give the
// same answer. Nothing here sends, assigns, closes or deletes anything, and no provider is ever named or called.

import { failed, planExecution, type ExecutionPlan, type KoeEnv } from "./automation-koe";
import type { Entry, EntryKind, Conversation, CommsState, Channel, ConvStatus, DraftKind } from "./comms-center";
import type { CrmState } from "./crm-center";
import { cardOf, contextOf, customer360, type Card, type Customer360 } from "./koe-crm";
import { PRIORITY_RANK, type Priority } from "./koe-registry";

// ---------------------------------------------------------------- the channels
export const CHANNELS_INFO: Record<Channel, { label: string; entry: EntryKind; draft: DraftKind | null; future: boolean }> = {
  email: { label: "Email", entry: "email", draft: "email", future: false },
  whatsapp: { label: "WhatsApp", entry: "whatsapp", draft: "whatsapp", future: false },
  messenger: { label: "Facebook Messenger", entry: "messenger", draft: "messenger", future: false },
  instagram: { label: "Instagram Direct", entry: "instagram", draft: "instagram", future: false },
  webchat: { label: "Chat Web", entry: "chat", draft: "chat", future: false },
  webform: { label: "Formulario Web", entry: "form", draft: "form", future: false },
  sms: { label: "SMS (arquitectura futura)", entry: "sms", draft: null, future: true },
};
export const MESSAGE_KINDS: readonly EntryKind[] = ["email", "whatsapp", "messenger", "instagram", "chat", "form", "sms"];
const isMessage = (entry: Entry) => (MESSAGE_KINDS as readonly string[]).includes(entry.kind);

// ---------------------------------------------------------------- the rules (declared, so every figure can be explained)
const norm = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
export const LEXICON = {
  buy: ["precio", "cotiz", "comprar", "contratar", "plan anual", "cuanto cuesta", "demo", "presupuesto"],
  support: ["problema", "error", "no funciona", "ayuda", "falla", "soporte", "no puedo", "no carga"],
  billing: ["factura", "cobro", "me cobraron", "pago", "reembolso", "cargo doble"],
  complaint: ["queja", "molest", "pesimo", "reclamo", "mal servicio", "terrible", "nadie me respondio", "inaceptable"],
  cancel: ["cancelar", "darme de baja", "dar de baja"],
  info: ["horario", "donde", "informacion", "como funciona", "cuanto"],
  positive: ["gracias", "excelente", "perfecto", "genial", "encanto", "muy buena"],
  urgent: ["urgente", "ya mismo", "hoy mismo", "inmediat", "lo antes posible", "es urgente"],
} as const;
export const URGENCY_LEVELS = { critical: 70, high: 45, normal: 20 } as const;
export const WAIT_POINTS = [{ minutes: 1_440, points: 35 }, { minutes: 240, points: 20 }, { minutes: 60, points: 10 }] as const;
export const MIN_PROB = 0.02;
export const MAX_PROB = 0.98;

export type Urgency = "low" | "normal" | "high" | "critical";
export type Sentiment = "positive" | "neutral" | "negative" | "mixed";
export type Intent = "buy" | "support" | "billing" | "complain" | "cancel" | "info" | "thanks" | "unknown";
export type Category = "sales" | "support" | "billing" | "complaint" | "general";
export type NextKind = "reply" | "escalate" | "assign" | "wait" | "resolve";
export type ConversationInsight = {
  urgency: Urgency; urgencyScore: number; sentiment: Sentiment; sentimentSimulated: true; intent: Intent; category: Category;
  saleProbability: number; supportProbability: number; waitMinutes: number; needsReply: boolean; priority: Priority;
  nextBest: { kind: NextKind; reason: string }; reasons: string[];
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const cents = (value: number) => Math.round(clamp(value, MIN_PROB, MAX_PROB) * 100) / 100;
const minutesBetween = (from: string, to: string) => Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / 60_000));
export const formatWait = (minutes: number): string => (minutes < 60 ? `${minutes} min` : minutes < 1_440 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${Math.floor(minutes / 1_440)} d ${Math.floor((minutes % 1_440) / 60)} h`);
const hits = (text: string, words: readonly string[]) => words.filter((word) => text.includes(word)).length;

/** What the platform hears about the customer from the CRM, through KOE: only whether there is an open deal or a customer. */
export type LinkHint = { leadOpen: boolean; customer: boolean };
export const linkHint = (crm: CrmState | undefined, conversation: Conversation): LinkHint => {
  const lead = crm?.leads.find((item) => item.id === conversation.link.leadId && item.tenantId === conversation.tenantId);
  const customer = crm?.customers.some((item) => item.id === conversation.link.customerId && item.tenantId === conversation.tenantId) ?? false;
  return { leadOpen: lead !== undefined && !["won", "lost"].includes(lead.stage), customer: customer || (lead?.stage === "won") };
};

// ---------------------------------------------------------------- understanding one conversation
export function analyzeConversation(conversation: Conversation, entries: readonly Entry[], asOf: string, hint: LinkHint = { leadOpen: false, customer: false }): ConversationInsight {
  const messages = entries.filter((entry) => isMessage(entry) && Date.parse(entry.at) <= Date.parse(asOf)).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const inbound = messages.filter((entry) => entry.direction === "in");
  const text = norm(inbound.slice(-3).map((entry) => entry.text).join(" . "));
  const buy = hits(text, LEXICON.buy);
  const support = hits(text, LEXICON.support);
  const billing = hits(text, LEXICON.billing);
  const complaint = hits(text, LEXICON.complaint);
  const cancel = hits(text, LEXICON.cancel);
  const info = hits(text, LEXICON.info);
  const positive = hits(text, LEXICON.positive);
  const negative = hits(text, LEXICON.complaint) + hits(text, ["no funciona", "error", "urgente"]) + cancel;
  const sentiment: Sentiment = negative > 0 && positive > 0 ? "mixed" : negative > 0 ? "negative" : positive > 0 ? "positive" : "neutral";
  const category: Category = complaint + cancel > 0 ? "complaint" : billing > 0 ? "billing" : support > 0 ? "support" : buy > 0 ? "sales" : "general";
  const intent: Intent = cancel > 0 ? "cancel" : complaint > 0 ? "complain" : billing > 0 ? "billing" : buy > 0 ? "buy" : support > 0 ? "support" : info > 0 ? "info" : positive > 0 ? "thanks" : "unknown";

  const last = messages[messages.length - 1];
  const waitMinutes = last && last.direction === "in" ? minutesBetween(last.at, asOf) : 0;
  const waitPoints = WAIT_POINTS.find((rule) => waitMinutes >= rule.minutes)?.points ?? 0;
  const urgentWords = Math.min(2, hits(text, LEXICON.urgent));
  const channelPoints = conversation.channel === "webchat" && waitMinutes >= 10 ? 15 : conversation.channel === "whatsapp" && waitMinutes >= 60 ? 5 : 0;
  const sentimentPoints = sentiment === "negative" ? 15 : sentiment === "mixed" ? 5 : 0;
  const intentPoints = intent === "cancel" ? 25 : intent === "complain" ? 20 : intent === "billing" ? 10 : intent === "support" ? 8 : 0;
  const waiting = waitMinutes > 0 && conversation.status !== "resolved" && conversation.status !== "archived" && intent !== "thanks"; // a thank-you does not wait for an answer
  const saleProbability = cents(0.08 + 0.3 * Math.min(buy, 2) + (hint.leadOpen ? 0.15 : 0) + (intent === "buy" ? 0.1 : 0) - (complaint > 0 ? 0.1 : 0));
  const supportProbability = cents(0.08 + 0.3 * Math.min(support + billing, 2) + (hint.customer ? 0.15 : 0) + (complaint + cancel > 0 ? 0.1 : 0));

  const salePoints = saleProbability >= 0.6 && waitMinutes >= 60 ? 15 : 0; // a likely sale that has waited an hour is worth attending sooner
  const urgencyScore = waiting ? Math.min(100, urgentWords * 10 + waitPoints + channelPoints + sentimentPoints + intentPoints + salePoints) : 0;
  const urgency: Urgency = urgencyScore >= URGENCY_LEVELS.critical ? "critical" : urgencyScore >= URGENCY_LEVELS.high ? "high" : urgencyScore >= URGENCY_LEVELS.normal ? "normal" : "low";

  let nextBest: ConversationInsight["nextBest"];
  if (conversation.status === "resolved" || conversation.status === "archived") nextBest = { kind: "wait", reason: "La conversación está cerrada: no requiere acción." };
  else if (intent === "thanks" && last?.direction === "in") nextBest = { kind: "resolve", reason: "El cliente agradeció y no hay nada pendiente: una persona puede marcarla como resuelta." };
  else if (waitMinutes === 0) nextBest = { kind: "wait", reason: "Estamos esperando la respuesta del cliente." };
  else if (conversation.assignee === "") nextBest = { kind: "assign", reason: `Nadie la atiende y el cliente espera hace ${formatWait(waitMinutes)}.` };
  else if (urgency === "critical" || intent === "cancel" || intent === "complain") nextBest = { kind: "escalate", reason: `${intent === "cancel" ? "Quiere cancelar" : intent === "complain" ? "Hay un reclamo" : "La urgencia es crítica"} y espera hace ${formatWait(waitMinutes)}: conviene que lo vea un responsable.` };
  else nextBest = { kind: "reply", reason: `El cliente espera hace ${formatWait(waitMinutes)}: preparar una respuesta${intent === "buy" ? " con la cotización" : ""}.` };

  const reasons = [
    waiting ? `El cliente espera hace ${formatWait(waitMinutes)} (${waitPoints} puntos de urgencia).` : "No hay un mensaje del cliente esperando respuesta.",
    `Intención detectada: ${intent}; categoría: ${category}; sentimiento (simulado): ${sentiment}.`,
    ...(urgentWords > 0 ? ["El mensaje pide atención inmediata."] : []),
    ...(hint.leadOpen ? ["Hay un negocio abierto en el CRM: sube la probabilidad de venta."] : []),
  ];
  return {
    urgency, urgencyScore, sentiment, sentimentSimulated: true, intent, category, saleProbability, supportProbability, waitMinutes, needsReply: waiting,
    priority: urgency, nextBest, reasons,
  };
}

// ---------------------------------------------------------------- smart routing: KOE decides, never the screen
const CATEGORY_SPECIALTY: Record<Category, string> = { sales: "sales", support: "followup", billing: "collections", complaint: "followup", general: "sales" };
const ROUTE_NEED = { tools: ["message.draft"], clearance: "personal" as const }; // a customer's contact data is personal
export type Route = {
  specialty: string; workerId: string; workerName: string; model: { id: string; label: string }; modelReason: string; priority: Priority; estimatedCostMicros: number; reason: string;
};

/** Which Worker attends a conversation, which specialty it needs, its priority and the model KOE's router picks. */
export function routeConversation(env: KoeEnv, tenantId: string, insight: ConversationInsight): Route | { problem: string } {
  const specialty = CATEGORY_SPECIALTY[insight.category];
  const plans = env.workers.map((worker) => planExecution(env, tenantId, worker.id, ROUTE_NEED));
  const ok = plans.filter((plan): plan is ExecutionPlan => !failed(plan));
  if (ok.length === 0) return { problem: plans.find(failed)?.problem ?? "ningún Worker puede redactar mensajes con datos personales" };
  const match = (plan: ExecutionPlan) => (plan.worker.specialty === specialty ? 0 : 1);
  const best = [...ok].sort((a, b) => match(a) - match(b) || PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || a.estimatedCostMicros - b.estimatedCostMicros || a.worker.id.localeCompare(b.worker.id))[0];
  return {
    specialty, workerId: best.worker.id, workerName: best.worker.name, model: { id: best.model.id, label: best.model.label }, modelReason: best.modelReason, priority: insight.priority, estimatedCostMicros: best.estimatedCostMicros,
    reason: `Categoría «${insight.category}» → especialidad «${specialty}»${match(best) === 0 ? "" : " (no hay un Worker con esa especialidad: se eligió el más adecuado)"}; el Worker es ${best.worker.name}; prioridad ${insight.priority}.`,
  };
}

// ---------------------------------------------------------------- drafts (never sent)
export type DraftContent = { kind: DraftKind; subject?: string; body: string; reason: string };
/** The reply NEX prepares. It reads only what the customer wrote and the insight: never an internal note. It is a draft; a person sends it. */
export function draftReply(conversation: Conversation, entries: readonly Entry[], insight: ConversationInsight): DraftContent | null {
  const kind = CHANNELS_INFO[conversation.channel].draft;
  if (!kind) return null;
  const first = conversation.contact.name.split(" ")[0];
  const lastIn = [...entries].filter((entry) => isMessage(entry) && entry.direction === "in").sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  const quote = lastIn ? `«${lastIn.text.slice(0, 90)}${lastIn.text.length > 90 ? "…" : ""}»` : "su mensaje";
  const core: Record<Intent, string> = {
    buy: `Con gusto le preparamos la cotización. Para ajustarla, ¿nos confirma el alcance y la fecha en la que quisiera empezar?`,
    support: `Lamentamos el inconveniente. Ya lo estamos revisando; ¿nos puede compartir una captura o los pasos para reproducirlo?`,
    billing: `Revisaremos el cobro de inmediato y le confirmamos el resultado. ¿Nos indica la fecha y el monto que ve en su cuenta?`,
    complain: `Lamentamos mucho lo ocurrido y entendemos su molestia. Un responsable de nuestro equipo le escribirá hoy para resolverlo.`,
    cancel: `Sentimos que piense en cancelar. Antes de hacerlo, nos gustaría entender qué pasó y ver cómo podemos corregirlo. ¿Le parece si hablamos hoy?`,
    info: `Con gusto le damos la información. ¿Qué es lo que más le interesa saber?`,
    thanks: `¡Gracias a usted! Quedamos atentos a lo que necesite.`,
    unknown: `Gracias por escribirnos. ¿Nos cuenta un poco más para poder ayudarle mejor?`,
  };
  const reason = `${CHANNELS_INFO[conversation.channel].label}: intención «${insight.intent}», sentimiento (simulado) «${insight.sentiment}».`;
  switch (kind) {
    case "email": return { kind, subject: `Re: ${conversation.subject}`, body: `Hola ${first},\n\nGracias por escribirnos sobre ${quote}.\n\n${core[insight.intent]}\n\nUn saludo,\nEl equipo`, reason };
    case "whatsapp": return { kind, body: `Hola ${first} 👋 ${core[insight.intent]}`, reason };
    case "messenger": return { kind, body: `Hola ${first}, ${core[insight.intent]}`, reason };
    case "instagram": return { kind, body: `¡Hola ${first}! ${core[insight.intent]}`, reason };
    case "chat": return { kind, body: core[insight.intent], reason };
    case "form": return { kind, subject: `Respuesta a su formulario: ${conversation.subject}`, body: `Estimado/a ${conversation.contact.name}:\n\nRecibimos su formulario (${quote}).\n\n${core[insight.intent]}\n\nAtentamente,\nEl equipo`, reason };
  }
}

// ---------------------------------------------------------------- the inbox: one list, grouped by conversation
export type InboxFilter = { channel?: Channel; status?: ConvStatus; assignee?: string | "unassigned"; tag?: string; search?: string };
export type InboxRow = {
  id: string; channel: Channel; contactName: string; company: string; subject: string; status: ConvStatus; assignee: string; priority: Priority; waitMinutes: number;
  lastActivityAt: string; tags: readonly string[]; preview: string; waiting: boolean; intent: Intent; category: Category; sentiment: Sentiment; nextBest: ConversationInsight["nextBest"];
};

export const entriesOf = (state: CommsState, tenantId: string, conversationId: string): Entry[] => state.entries.filter((entry) => entry.tenantId === tenantId && entry.conversationId === conversationId).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

export function inbox(state: CommsState, tenantId: string, asOf: string, filter: InboxFilter = {}, crm?: CrmState): InboxRow[] {
  const q = norm(filter.search ?? "");
  const rows = state.conversations.filter((conversation) => conversation.tenantId === tenantId).map((conversation): InboxRow => {
    const entries = entriesOf(state, tenantId, conversation.id);
    const insight = analyzeConversation(conversation, entries, asOf, linkHint(crm, conversation));
    const lastMessage = entries.filter(isMessage).at(-1);
    return {
      id: conversation.id, channel: conversation.channel, contactName: conversation.contact.name, company: conversation.company, subject: conversation.subject, status: conversation.status, assignee: conversation.assignee,
      priority: insight.priority, waitMinutes: insight.waitMinutes, lastActivityAt: conversation.lastActivityAt, tags: conversation.tags, preview: (lastMessage?.text ?? "").slice(0, 100),
      waiting: insight.needsReply, intent: insight.intent, category: insight.category, sentiment: insight.sentiment, nextBest: insight.nextBest,
    };
  });
  return rows
    .filter((row) => (!filter.channel || row.channel === filter.channel) && (!filter.status || row.status === filter.status)
      && (!filter.assignee || (filter.assignee === "unassigned" ? row.assignee === "" : row.assignee === filter.assignee)) && (!filter.tag || row.tags.includes(filter.tag))
      && (q === "" || norm(`${row.contactName} ${row.company} ${row.subject} ${row.preview}`).includes(q)))
    .sort((a, b) => Number(b.waiting) - Number(a.waiting) || PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.waitMinutes - a.waitMinutes || b.lastActivityAt.localeCompare(a.lastActivityAt) || a.id.localeCompare(b.id));
}

export type CommsStats = { total: number; byStatus: Record<ConvStatus, number>; byChannel: Record<Channel, number>; waiting: number; unassigned: number; critical: number; averageWaitMinutes: number | null };
export function commsStats(state: CommsState, tenantId: string, asOf: string, crm?: CrmState): CommsStats {
  const rows = inbox(state, tenantId, asOf, {}, crm);
  const waiting = rows.filter((row) => row.waiting);
  return {
    total: rows.length,
    byStatus: { open: rows.filter((row) => row.status === "open").length, pending: rows.filter((row) => row.status === "pending").length, resolved: rows.filter((row) => row.status === "resolved").length, archived: rows.filter((row) => row.status === "archived").length },
    byChannel: Object.fromEntries((Object.keys(CHANNELS_INFO) as Channel[]).map((channel) => [channel, rows.filter((row) => row.channel === channel).length])) as Record<Channel, number>,
    waiting: waiting.length, unassigned: rows.filter((row) => row.assignee === "" && row.status !== "archived" && row.status !== "resolved").length, critical: rows.filter((row) => row.priority === "critical").length,
    averageWaitMinutes: waiting.length ? Math.round(waiting.reduce((sum, row) => sum + row.waitMinutes, 0) / waiting.length) : null,
  };
}

// ---------------------------------------------------------------- the omnichannel timeline: everything about a person, in one line
export type TimelineItem = { id: string; at: string; source: "comms" | "crm"; kind: EntryKind; text: string; actor: string; internal: boolean; channel?: Channel; conversationId?: string; direction?: "in" | "out" };

/** Every conversation of the same customer (the same CRM link or the same address) and the CRM's own timeline for the linked prospect, oldest first. */
export function omnichannelTimeline(state: CommsState, crm: CrmState | undefined, tenantId: string, conversationId: string): TimelineItem[] {
  const base = state.conversations.find((item) => item.id === conversationId && item.tenantId === tenantId);
  if (!base) return [];
  const same = (other: Conversation) => other.id === base.id
    || (base.link.leadId !== undefined && other.link.leadId === base.link.leadId) || (base.link.customerId !== undefined && other.link.customerId === base.link.customerId)
    || other.contact.handle.toLowerCase() === base.contact.handle.toLowerCase();
  const siblings = state.conversations.filter((other) => other.tenantId === tenantId && same(other));
  const ours: TimelineItem[] = siblings.flatMap((conversation) => entriesOf(state, tenantId, conversation.id).map((entry): TimelineItem => ({
    id: entry.id, at: entry.at, source: "comms", kind: entry.kind, text: entry.text, actor: entry.actor, internal: entry.internal, channel: conversation.channel, conversationId: conversation.id, direction: entry.direction,
  })));
  const fromCrm: TimelineItem[] = crm ? crm.timeline.filter((entry) => entry.tenantId === tenantId && ((base.link.leadId !== undefined && entry.subject.kind === "lead" && entry.subject.id === base.link.leadId) || (base.link.customerId !== undefined && entry.subject.kind === "customer" && entry.subject.id === base.link.customerId)))
    .map((entry): TimelineItem => ({ id: entry.id, at: entry.at, source: "crm", kind: entry.kind === "audit" ? "audit" : entry.kind === "automation" ? "automation" : entry.kind === "worker" ? "worker" : entry.kind === "nex" ? "nex" : "crm", text: entry.summary, actor: entry.actor, internal: true })) : [];
  return [...ours, ...fromCrm].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- customer context: opened from the conversation, never copied into it
export type CustomerContext = {
  linked: { leadId?: string; customerId?: string };
  pipeline: Card | null; customer: Customer360 | null; audits: CrmState["audits"][number][];
};
/** What the CRM already knows about the customer, asked through KOE's CRM module at the moment it is needed. Nothing is stored here. */
export function customerContext(state: CommsState, crm: CrmState, tenantId: string, conversationId: string, asOf: string): CustomerContext | null {
  const conversation = state.conversations.find((item) => item.id === conversationId && item.tenantId === tenantId);
  if (!conversation) return null;
  const lead = crm.leads.find((item) => item.id === conversation.link.leadId && item.tenantId === tenantId);
  const customerId = conversation.link.customerId ?? crm.customers.find((item) => lead && item.leadId === lead.id && item.tenantId === tenantId)?.id;
  return {
    linked: { ...(conversation.link.leadId ? { leadId: conversation.link.leadId } : {}), ...(customerId ? { customerId } : {}) },
    pipeline: lead ? cardOf(contextOf(crm, lead), asOf) : null,
    customer: customerId ? customer360(crm, tenantId, customerId, asOf) : null,
    audits: lead ? crm.audits.filter((audit) => audit.tenantId === tenantId && audit.leadId === lead.id) : [],
  };
}

// ---------------------------------------------------------------- the future, declared and NOT built
export type FutureConnector = { id: "whatsappBusiness" | "metaMessenger" | "instagramGraph" | "gmail" | "microsoft365" | "twilio" | "telephony" | "videoCalls"; label: string; channels: readonly Channel[]; status: "notBuilt"; goesThrough: "KOE"; direct: false; needs: string };
/** Each will be a KOE connector: a provider is never reached from a screen or a Worker, only through the integration layer that KOE owns. None exists yet. */
export const FUTURE_CONNECTORS: readonly FutureConnector[] = [
  { id: "whatsappBusiness", label: "WhatsApp Business API", channels: ["whatsapp"], status: "notBuilt", goesThrough: "KOE", direct: false, needs: "cuenta verificada, plantillas aprobadas y consentimiento de los contactos" },
  { id: "metaMessenger", label: "Meta Messenger", channels: ["messenger"], status: "notBuilt", goesThrough: "KOE", direct: false, needs: "página conectada, permisos y la ventana de mensajería" },
  { id: "instagramGraph", label: "Instagram Graph", channels: ["instagram"], status: "notBuilt", goesThrough: "KOE", direct: false, needs: "cuenta profesional conectada y permisos de mensajes" },
  { id: "gmail", label: "Gmail", channels: ["email"], status: "notBuilt", goesThrough: "KOE", direct: false, needs: "autorización de la persona dueña del buzón y alcance mínimo de lectura" },
  { id: "microsoft365", label: "Microsoft 365", channels: ["email"], status: "notBuilt", goesThrough: "KOE", direct: false, needs: "consentimiento del administrador de la empresa y alcance mínimo" },
  { id: "twilio", label: "Twilio", channels: ["sms", "whatsapp"], status: "notBuilt", goesThrough: "KOE", direct: false, needs: "números, consentimiento y reglas de cada país" },
  { id: "telephony", label: "Telefonía", channels: [], status: "notBuilt", goesThrough: "KOE", direct: false, needs: "proveedor de voz, grabación solo con aviso y retención definida" },
  { id: "videoCalls", label: "Video llamadas", channels: [], status: "notBuilt", goesThrough: "KOE", direct: false, needs: "proveedor de reuniones y calendario conectado" },
];
