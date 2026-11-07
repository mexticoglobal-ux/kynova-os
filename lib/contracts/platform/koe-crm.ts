// KOE CRM Intelligence: the ONE place where a lead's scores, probability, risk, expected value and time, best next action, the reasons
// for it, the Sales Assistant's messages, the dashboard and the Customer 360 are worked out. Every screen only formats these answers
// and no other module keeps a second copy of this logic. Pure and deterministic: the same records and the same "now" give the same
// answer. Nothing here sends, moves or closes anything: it only reads records and says what it recommends and why.
// (The records that make the answers durable, with the Worker and model KOE used, are kept by crm-center.ts.)

import { PRIORITY_RANK, type Priority } from "./koe-registry";
import type { AuditResult, Customer, CrmState, Lead, Meeting, Stage, Task, TaskKind, TimelineEntry } from "./crm-center";
import { auditFit } from "./crm-audit";

export const STAGES = ["prospect", "qualified", "meeting", "proposal", "negotiation", "won", "lost"] as const;
export const OPEN_STAGES = ["prospect", "qualified", "meeting", "proposal", "negotiation"] as const;
export const OPPORTUNITY_STAGES = ["meeting", "proposal", "negotiation"] as const;
const DAY = 86_400_000;

// ---------------------------------------------------------------- the rules (declared, so every number can be explained)
export const STAGE_BASE: Record<Stage, number> = { prospect: 10, qualified: 25, meeting: 40, proposal: 55, negotiation: 70, won: 100, lost: 0 };
export const STAGE_DAYS: Record<(typeof OPEN_STAGES)[number], number> = { prospect: 5, qualified: 7, meeting: 5, proposal: 7, negotiation: 10 }; // typical days spent in each stage
export const STAGE_SLA: Record<(typeof OPEN_STAGES)[number], number> = { prospect: 7, qualified: 10, meeting: 7, proposal: 10, negotiation: 14 }; // past this, the deal is slow
export const ADVANCE_THRESHOLD: Record<"prospect" | "qualified" | "meeting" | "proposal", number> = { prospect: 60, qualified: 65, meeting: 70, proposal: 75 }; // lead/opportunity score KOE wants before it recommends moving up
export const STALE_AFTER_DAYS = 5;
export const NEW_WINDOW_DAYS = 7;
export const HIGH_PROBABILITY = 0.7;

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Urgency = "low" | "normal" | "high";
export type NextAction = { kind: TaskKind; reason: string; urgency: Urgency };
export type Insight = {
  leadScore: number; opportunityScore: number; probability: number; risk: RiskLevel; riskPoints: number; riskReasons: string[];
  expectedValueMicros: number; expectedDays: number; expectedCloseAt: string | null; nextBest: NextAction | null; priority: Priority;
  daysInStage: number; daysSinceTouch: number | null; interactions30d: number; auditScore: number | null; reasons: string[];
};

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const days = (from: string, to: string) => Math.max(0, Math.floor((Date.parse(to) - Date.parse(from)) / DAY));
const TOUCH_KINDS = ["email", "whatsapp", "call", "meeting"] as const;
const isTouch = (entry: TimelineEntry) => (TOUCH_KINDS as readonly string[]).includes(entry.kind);
const isOpen = (stage: Stage) => (OPEN_STAGES as readonly string[]).includes(stage);

export type LeadContext = { lead: Lead; timeline: readonly TimelineEntry[]; tasks: readonly Task[]; audits: readonly AuditResult[] };

/** The records that belong to one lead, taken from the whole state: the only way the engine reads a lead's history. */
export function contextOf(state: Pick<CrmState, "timeline" | "tasks" | "audits">, lead: Lead): LeadContext {
  return {
    lead,
    timeline: state.timeline.filter((entry) => entry.tenantId === lead.tenantId && entry.subject.kind === "lead" && entry.subject.id === lead.id),
    tasks: state.tasks.filter((task) => task.tenantId === lead.tenantId && task.leadId === lead.id),
    audits: state.audits.filter((audit) => audit.tenantId === lead.tenantId && audit.leadId === lead.id),
  };
}

// ---------------------------------------------------------------- the analysis of one opportunity
export function analyzeLead(context: LeadContext, asOf: string): Insight {
  const { lead, timeline, tasks, audits } = context;
  const touches = timeline.filter((entry) => isTouch(entry) && Date.parse(entry.at) <= Date.parse(asOf));
  const lastTouch = touches.length ? touches.map((entry) => entry.at).sort()[touches.length - 1] : null;
  const interactions30d = touches.filter((entry) => Date.parse(asOf) - Date.parse(entry.at) <= 30 * DAY).length;
  const daysSinceTouch = lastTouch ? days(lastTouch, asOf) : null;
  const sinceContact = daysSinceTouch ?? days(lead.createdAt, asOf);
  const daysInStage = days(lead.stageSince, asOf);
  const lastAudit = audits.length ? audits.map((audit) => ({ at: audit.at, score: audit.fitScore })).sort((a, b) => a.at.localeCompare(b.at))[audits.length - 1].score : null;

  const bonus = Math.min(10, interactions30d * 2);
  const leadScore = clamp(Math.round(0.6 * lead.fit + 0.4 * (lastAudit ?? lead.fit) + bonus), 0, 100);
  const penalty = Math.min(25, Math.max(0, sinceContact - 3) * 3);
  const open = isOpen(lead.stage);
  const opportunityScore = lead.stage === "won" ? 100 : lead.stage === "lost" ? 0 : clamp(Math.round(STAGE_BASE[lead.stage] + 0.25 * leadScore + 0.2 * (lastAudit ?? leadScore) - penalty), 0, 99);
  const probability = lead.stage === "won" ? 1 : lead.stage === "lost" ? 0 : Math.round(clamp(opportunityScore, 2, 98)) / 100;

  // risk: points for how long since anyone touched it, how long it has sat in a stage, how weak it is and what is overdue
  const riskReasons: string[] = [];
  let riskPoints = 0;
  const overdue = tasks.filter((task) => task.status === "accepted" && Date.parse(task.dueAt) < Date.parse(asOf)).length;
  if (open) {
    if (sinceContact >= 10) { riskPoints += 3; riskReasons.push(`Pasaron ${sinceContact} días sin contacto`); }
    else if (sinceContact >= STALE_AFTER_DAYS) { riskPoints += 2; riskReasons.push(`Pasaron ${sinceContact} días sin contacto`); }
    else if (sinceContact >= 3) { riskPoints += 1; riskReasons.push(`Pasaron ${sinceContact} días sin contacto`); }
    const sla = STAGE_SLA[lead.stage as (typeof OPEN_STAGES)[number]];
    if (daysInStage > sla) { riskPoints += 2; riskReasons.push(`Lleva ${daysInStage} días en «${lead.stage}» (lo normal es hasta ${sla})`); }
    if (opportunityScore < 35) { riskPoints += 2; riskReasons.push(`Puntaje de oportunidad bajo (${opportunityScore})`); }
    else if (opportunityScore < 50) { riskPoints += 1; riskReasons.push(`Puntaje de oportunidad medio-bajo (${opportunityScore})`); }
    if (overdue > 0) { riskPoints += 1; riskReasons.push(`${overdue} tarea(s) aceptada(s) vencida(s)`); }
  }
  const risk: RiskLevel = riskPoints <= 1 ? "low" : riskPoints <= 3 ? "medium" : riskPoints <= 5 ? "high" : "critical";

  const expectedValueMicros = Math.round(lead.estimatedValueMicros * probability);
  let remaining = 0;
  if (open) {
    const order = OPEN_STAGES as readonly string[];
    const index = order.indexOf(lead.stage);
    remaining = Math.max(2, STAGE_DAYS[lead.stage as (typeof OPEN_STAGES)[number]] - daysInStage) + order.slice(index + 1).reduce((total, stage) => total + STAGE_DAYS[stage as (typeof OPEN_STAGES)[number]], 0);
    remaining = Math.ceil(remaining * (risk === "critical" ? 1.5 : risk === "high" ? 1.25 : 1));
  }
  const expectedCloseAt = open ? new Date(Date.parse(asOf) + remaining * DAY).toISOString() : null;

  const stageAction: Record<(typeof OPEN_STAGES)[number], NextAction> = {
    prospect: { kind: "email", reason: "Es un prospecto nuevo: un primer correo abre la conversación", urgency: "normal" },
    qualified: { kind: "meeting", reason: "Está calificado: conviene agendar una reunión para entender la necesidad", urgency: "normal" },
    meeting: { kind: "proposal", reason: "Ya hubo reunión: preparar la propuesta con lo conversado", urgency: "normal" },
    proposal: { kind: "followup", reason: "La propuesta está enviada: dar seguimiento antes de que se enfríe", urgency: "normal" },
    negotiation: { kind: "call", reason: "Está en negociación: una llamada para cerrar los últimos puntos", urgency: "normal" },
  };
  let nextBest: NextAction | null = null;
  if (open) {
    if (touches.length === 0) nextBest = { kind: "email", reason: "Todavía no hay ningún contacto: preparar un primer correo", urgency: "normal" };
    else if (sinceContact >= STALE_AFTER_DAYS) nextBest = { kind: "call", reason: `Han pasado ${sinceContact} días sin contacto: llamar hoy`, urgency: "high" };
    else nextBest = stageAction[lead.stage as (typeof OPEN_STAGES)[number]];
    if (nextBest && (risk === "high" || risk === "critical")) nextBest = { ...nextBest, urgency: "high" };
    else if (nextBest && risk === "low" && probability < 0.3) nextBest = { ...nextBest, urgency: "low" };
  }
  const priority: Priority = !open ? "low" : risk === "critical" ? "critical" : risk === "high" || (opportunityScore >= 75 && lead.stage !== "prospect") ? "high" : opportunityScore < 30 ? "low" : "normal";

  const reasons = open
    ? [
        `Etapa «${lead.stage}»: base ${STAGE_BASE[lead.stage]} puntos.`,
        `Puntaje del prospecto ${leadScore}${lastAudit === null ? "" : `, con un Business Audit de ${lastAudit}`}.`,
        interactions30d > 0 ? `${interactions30d} contacto(s) en los últimos 30 días suman a favor.` : "Sin contactos en los últimos 30 días.",
        ...(penalty > 0 ? [`El tiempo sin contacto resta ${penalty} puntos.`] : []),
      ]
    : [lead.stage === "won" ? "Venta ganada." : "Negocio perdido."];
  return {
    leadScore, opportunityScore, probability, risk, riskPoints, riskReasons, expectedValueMicros, expectedDays: remaining, expectedCloseAt, nextBest, priority,
    daysInStage, daysSinceTouch, interactions30d, auditScore: lastAudit, reasons,
  };
}

/** Whether KOE recommends moving a lead up one stage today, and why not when it does not. Level 2 uses this; a person need not. */
export function advanceCheck(insight: Insight, stage: Stage): { ok: boolean; reason: string } {
  if (!(stage in ADVANCE_THRESHOLD)) return { ok: false, reason: "solo se avanza hasta negociación; cerrar es de una persona" };
  const needed = ADVANCE_THRESHOLD[stage as keyof typeof ADVANCE_THRESHOLD];
  const score = stage === "prospect" ? insight.leadScore : insight.opportunityScore;
  if (score < needed) return { ok: false, reason: `el puntaje es ${score} y KOE pide al menos ${needed}` };
  if (stage !== "prospect" && insight.interactions30d < 1) return { ok: false, reason: "no hay contactos recientes" };
  return { ok: true, reason: `el puntaje es ${score} (mínimo ${needed})` };
}

// ---------------------------------------------------------------- prepared drafts and task proposals (never sent)
const TASK_TITLE: Record<TaskKind, string> = { call: "Llamar a", email: "Enviar correo a", whatsapp: "Enviar WhatsApp a", meeting: "Programar reunión con", proposal: "Enviar propuesta a", followup: "Dar seguimiento a" };
export const taskTitle = (kind: TaskKind, name: string) => `${TASK_TITLE[kind]} ${name}`;

/** The text NEX prepares for a task. It is only a draft: a person reads it, edits it and sends it themselves. */
export function draftFor(kind: TaskKind, lead: Lead, insight: Insight): string {
  const first = lead.name.split(" ")[0];
  switch (kind) {
    case "email": return `Asunto: Hola ${first}, gracias por su interés\n\nHola ${first}, le escribo de parte de nuestro equipo. Vimos que ${lead.company || "su empresa"} busca mejorar su proceso comercial y nos gustaría conversar 20 minutos. ¿Qué día le queda mejor esta semana?`;
    case "whatsapp": return `Hola ${first}, ¿cómo está? Quedé pendiente de contarle cómo podemos ayudar a ${lead.company || "su empresa"}. ¿Le parece si hablamos hoy o mañana?`;
    case "meeting": return `Propuesta de reunión con ${lead.name}: 30 minutos, objetivo: entender la necesidad y mostrar cómo trabajamos. Opciones: dos horarios esta semana.`;
    case "proposal": return `Propuesta para ${lead.company || lead.name}: 1) lo que entendimos de la necesidad, 2) lo que proponemos, 3) alcance y tiempos, 4) inversión estimada (${Math.round(lead.estimatedValueMicros / 1_000_000)} USD), 5) siguientes pasos.`;
    case "followup": return `Hola ${first}, ¿pudo revisar la propuesta? Con gusto resolvemos cualquier duda y ajustamos lo que haga falta.`;
    case "call": return `Puntos para la llamada con ${lead.name}: ${insight.nextBest?.reason ?? "revisar el estado"}. Preguntar por prioridades, presupuesto y fecha de decisión.`;
  }
}

export type TaskProposal = { kind: TaskKind; title: string; reason: string; draft: string; dueInDays: number };
/** What NEX proposes for a lead right now (at most 3), skipping what is already waiting. Proposals only: nothing is executed. */
export function proposalsFor(context: LeadContext, insight: Insight): TaskProposal[] {
  if (!insight.nextBest) return [];
  const open = new Set(context.tasks.filter((task) => task.status === "proposed" || task.status === "accepted").map((task) => task.kind));
  const out: TaskProposal[] = [];
  const add = (kind: TaskKind, reason: string, dueInDays: number) => {
    if (open.has(kind) || out.some((item) => item.kind === kind) || out.length >= 3) return;
    out.push({ kind, title: taskTitle(kind, context.lead.name), reason, draft: draftFor(kind, context.lead, insight), dueInDays });
  };
  add(insight.nextBest.kind, insight.nextBest.reason, insight.nextBest.urgency === "high" ? 0 : insight.nextBest.urgency === "normal" ? 1 : 3);
  if (context.lead.stage === "proposal" && insight.daysInStage >= 3) add("followup", `La propuesta lleva ${insight.daysInStage} días sin respuesta`, 1);
  if (context.lead.stage === "qualified" && insight.leadScore >= 70) add("whatsapp", "Alto puntaje: un mensaje corto acelera la reunión", 1);
  return out;
}

// ---------------------------------------------------------------- the pipeline board
export type Card = {
  leadId: string; name: string; company: string; stage: Stage; leadScore: number; opportunityScore: number; probability: number; risk: RiskLevel; valueMicros: number;
  expectedValueMicros: number; daysInStage: number; owner: string; nextAction: NextAction | null; priority: Priority;
};
export type Column = { stage: Stage; cards: Card[]; count: number; valueMicros: number; expectedValueMicros: number };

export const cardOf = (context: LeadContext, asOf: string): Card => {
  const insight = analyzeLead(context, asOf);
  const { lead } = context;
  return {
    leadId: lead.id, name: lead.name, company: lead.company, stage: lead.stage, leadScore: insight.leadScore, opportunityScore: insight.opportunityScore, probability: insight.probability, risk: insight.risk,
    valueMicros: lead.estimatedValueMicros, expectedValueMicros: insight.expectedValueMicros, daysInStage: insight.daysInStage, owner: lead.owner, nextAction: insight.nextBest, priority: insight.priority,
  };
};

export function pipelineBoard(state: CrmState, tenantId: string, asOf: string): Column[] {
  const cards = state.leads.filter((lead) => lead.tenantId === tenantId).map((lead) => cardOf(contextOf(state, lead), asOf));
  return STAGES.map((stage) => {
    const inStage = cards.filter((card) => card.stage === stage).sort((a, b) => b.opportunityScore - a.opportunityScore || a.name.localeCompare(b.name));
    return { stage, cards: inStage, count: inStage.length, valueMicros: inStage.reduce((sum, card) => sum + card.valueMicros, 0), expectedValueMicros: inStage.reduce((sum, card) => sum + card.expectedValueMicros, 0) };
  });
}

// ---------------------------------------------------------------- the Sales Assistant: what KOE would say to a salesperson
export type AssistantMessage = { id: string; code: "highProbability" | "callToday" | "stale" | "atRisk" | "canBuyMore"; text: string; reason: string; priority: Priority; leadId?: string; customerId?: string };

export function assistantMessages(state: CrmState, tenantId: string, asOf: string): AssistantMessage[] {
  const out: AssistantMessage[] = [];
  for (const lead of state.leads.filter((item) => item.tenantId === tenantId && isOpen(item.stage))) {
    const insight = analyzeLead(contextOf(state, lead), asOf);
    const who = lead.company || lead.name;
    if (insight.probability >= HIGH_PROBABILITY) out.push({ id: `${lead.id}:highProbability`, code: "highProbability", text: "Este prospecto tiene alta probabilidad.", reason: `${lead.name}: ${Math.round(insight.probability * 100)} % de cierre`, priority: "high", leadId: lead.id });
    if (insight.nextBest?.kind === "call" && insight.nextBest.urgency === "high") out.push({ id: `${lead.id}:callToday`, code: "callToday", text: "Recomiendo llamar hoy.", reason: `${lead.name}: ${insight.nextBest.reason}`, priority: insight.priority === "critical" ? "critical" : "high", leadId: lead.id });
    if (insight.daysSinceTouch !== null && insight.daysSinceTouch >= STALE_AFTER_DAYS) out.push({ id: `${lead.id}:stale`, code: "stale", text: `Han pasado ${insight.daysSinceTouch} días.`, reason: `Sin contacto con ${lead.name}`, priority: "normal", leadId: lead.id });
    if (insight.risk === "high" || insight.risk === "critical") out.push({ id: `${lead.id}:atRisk`, code: "atRisk", text: "Existe riesgo de perder la oportunidad.", reason: `${who}: ${insight.riskReasons.join("; ")}`, priority: insight.risk === "critical" ? "critical" : "high", leadId: lead.id });
  }
  for (const customer of state.customers.filter((item) => item.tenantId === tenantId)) {
    const products = state.links.filter((link) => link.tenantId === tenantId && link.customerId === customer.id && link.kind === "product").length;
    const paid = state.links.some((link) => link.tenantId === tenantId && link.customerId === customer.id && link.kind === "payment");
    if (paid && products <= 1) out.push({ id: `${customer.id}:canBuyMore`, code: "canBuyMore", text: "Este cliente puede comprar otro servicio.", reason: `${customer.company} tiene ${products} servicio(s) y pagos al día`, priority: "normal", customerId: customer.id });
  }
  return out.sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- the commercial dashboard
export type Dashboard = {
  newLeads: number; activeLeads: number; opportunities: number; customers: number; estimatedSalesMicros: number; wonValueMicros: number; conversionRate: number | null;
  nextActions: { taskId: string; title: string; kind: TaskKind; dueAt: string; status: Task["status"]; leadName: string }[];
  meetings: { id: string; at: string; title: string; leadName: string }[]; recentActivity: TimelineEntry[];
};

export function crmDashboard(state: CrmState, tenantId: string, asOf: string): Dashboard {
  const leads = state.leads.filter((lead) => lead.tenantId === tenantId);
  const open = leads.filter((lead) => isOpen(lead.stage));
  const nameOf = (id: string) => leads.find((lead) => lead.id === id)?.name ?? id;
  const expected = open.map((lead) => analyzeLead(contextOf(state, lead), asOf).expectedValueMicros);
  const won = leads.filter((lead) => lead.stage === "won");
  const meetings = state.meetings.filter((meeting) => meeting.tenantId === tenantId && Date.parse(meeting.at) >= Date.parse(asOf)).sort((a, b) => a.at.localeCompare(b.at));
  return {
    newLeads: leads.filter((lead) => Date.parse(asOf) - Date.parse(lead.createdAt) <= NEW_WINDOW_DAYS * DAY).length,
    activeLeads: open.length,
    opportunities: leads.filter((lead) => (OPPORTUNITY_STAGES as readonly string[]).includes(lead.stage)).length,
    customers: state.customers.filter((customer) => customer.tenantId === tenantId).length,
    estimatedSalesMicros: expected.reduce((sum, value) => sum + value, 0),
    wonValueMicros: won.reduce((sum, lead) => sum + lead.estimatedValueMicros, 0),
    conversionRate: leads.length ? won.length / leads.length : null,
    nextActions: state.tasks.filter((task) => task.tenantId === tenantId && (task.status === "accepted" || task.status === "proposed")).sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id)).slice(0, 5)
      .map((task) => ({ taskId: task.id, title: task.title, kind: task.kind, dueAt: task.dueAt, status: task.status, leadName: nameOf(task.leadId) })),
    meetings: meetings.map((meeting: Meeting) => ({ id: meeting.id, at: meeting.at, title: meeting.title, leadName: nameOf(meeting.leadId) })),
    recentActivity: state.timeline.filter((entry) => entry.tenantId === tenantId).sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).slice(0, 8),
  };
}

// ---------------------------------------------------------------- Customer 360
export type Customer360 = {
  customer: Customer; company: string; contacts: Customer["contacts"]; pipeline: { stage: Stage; stageHistory: Lead["stageHistory"]; valueMicros: number; opportunityScore: number } | null;
  links: Record<"product" | "academy" | "marketplace" | "automation" | "worker" | "payment" | "referral", CrmState["links"][number][]>;
  paidMicros: number; timeline: TimelineEntry[]; tasks: Task[]; messages: AssistantMessage[];
};

export function customer360(state: CrmState, tenantId: string, customerId: string, asOf: string): Customer360 | null {
  const customer = state.customers.find((item) => item.id === customerId && item.tenantId === tenantId);
  if (!customer) return null;
  const lead = state.leads.find((item) => item.id === customer.leadId && item.tenantId === tenantId);
  const mine = state.links.filter((link) => link.tenantId === tenantId && link.customerId === customer.id);
  const kinds = ["product", "academy", "marketplace", "automation", "worker", "payment", "referral"] as const;
  const links = Object.fromEntries(kinds.map((kind) => [kind, mine.filter((link) => link.kind === kind).sort((a, b) => a.at.localeCompare(b.at))])) as Customer360["links"];
  const subjects = (entry: TimelineEntry) => (entry.subject.kind === "customer" && entry.subject.id === customer.id) || (lead !== undefined && entry.subject.kind === "lead" && entry.subject.id === lead.id);
  return {
    customer, company: customer.company, contacts: customer.contacts,
    pipeline: lead ? { stage: lead.stage, stageHistory: lead.stageHistory, valueMicros: lead.estimatedValueMicros, opportunityScore: analyzeLead(contextOf(state, lead), asOf).opportunityScore } : null,
    links, paidMicros: links.payment.reduce((sum, link) => sum + (link.amountMicros ?? 0), 0),
    timeline: state.timeline.filter((entry) => entry.tenantId === tenantId && subjects(entry)).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)),
    tasks: state.tasks.filter((task) => task.tenantId === tenantId && lead !== undefined && task.leadId === lead.id),
    messages: assistantMessages(state, tenantId, asOf).filter((message) => message.customerId === customer.id),
  };
}

/** A lead's whole story, oldest first: emails, WhatsApp, calls, notes, meetings, automations, Workers, Business Audits and NEX. */
export const timelineOf = (state: CrmState, tenantId: string, subject: { kind: "lead" | "customer"; id: string }): TimelineEntry[] =>
  state.timeline.filter((entry) => entry.tenantId === tenantId && entry.subject.kind === subject.kind && entry.subject.id === subject.id).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

export { auditFit };

// ---------------------------------------------------------------- the future, declared and NOT built
export type FutureCrm = { id: "salesPrediction" | "forecast" | "churnDetection" | "crossSelling" | "upSelling" | "renewals" | "churnPrediction"; label: string; status: "notBuilt"; readsFrom: "KOE CRM records"; runsThrough: "KOE"; needs: string };
/** Each will be a KOE Worker that reads the same records, so the figures keep one source. None exists yet. */
export const FUTURE_CRM: readonly FutureCrm[] = [
  { id: "salesPrediction", label: "Predicción de ventas", status: "notBuilt", readsFrom: "KOE CRM records", runsThrough: "KOE", needs: "historial de cierres suficiente por empresa" },
  { id: "forecast", label: "Forecast comercial", status: "notBuilt", readsFrom: "KOE CRM records", runsThrough: "KOE", needs: "tiempos reales por etapa y valores cerrados" },
  { id: "churnDetection", label: "Detección de abandono", status: "notBuilt", readsFrom: "KOE CRM records", runsThrough: "KOE", needs: "señales de uso y de contacto por cliente" },
  { id: "crossSelling", label: "Cross Selling", status: "notBuilt", readsFrom: "KOE CRM records", runsThrough: "KOE", needs: "catálogo de servicios relacionados y compras reales" },
  { id: "upSelling", label: "Up Selling", status: "notBuilt", readsFrom: "KOE CRM records", runsThrough: "KOE", needs: "planes y límites de uso por cliente" },
  { id: "renewals", label: "Renovaciones", status: "notBuilt", readsFrom: "KOE CRM records", runsThrough: "KOE", needs: "fechas de contrato y vencimientos" },
  { id: "churnPrediction", label: "Churn Prediction", status: "notBuilt", readsFrom: "KOE CRM records", runsThrough: "KOE", needs: "evals, privacidad y datos históricos de bajas" },
];
