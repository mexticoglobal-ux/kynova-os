import { runAudit, qualifyLead } from "@/lib/audit";
import { AUDIT_DIMENSIONS, type AuditAnswers, type MaturityLevel, type QualificationInput } from "@/lib/contracts/audit";
import { PRIORITIES, type ContactMethod, type Grade, type Lead, type Priority, type Stage } from "@/lib/contracts/pipeline";
import { pick, type Treatment } from "@/lib/audit-copy";
import { buildSummary, scoreStatus } from "@/lib/audit-summary";
import type { ClientPack } from "@/lib/audit-packs/nova-draft";
import type { Handoff } from "@/lib/guided-chat";

// Pure pipeline logic: turns a conversation's handoff into a lead, moves leads through stages, and summarises the day.
// Everything here is deterministic and in memory (demo mode, no persistence).

const PRIORITY_BY_GRADE: Record<Grade, Priority> = { hot: "high", human: "high", warm: "medium", cold: "low" };

export const OWNER_NEX = "NEX";
export const OWNER_TEAM = "Equipo de Nova";

function meetingDraft(pack: ClientPack, name: string, serviceName: string | undefined, treatment: Treatment): string {
  const t = (usted: string, tu: string) => pick(treatment, [usted, tu]);
  const topic = serviceName ? ` (${serviceName})` : "";
  return t(
    `Hola ${name}, soy NEX, el asistente de ${pack.brand}. Con lo que nos contó, el equipo puede revisar con usted cómo avanzar${topic}. ¿Le parece una llamada breve esta semana? Indíquenos el día y la hora que le convengan.`,
    `Hola ${name}, soy NEX, el asistente de ${pack.brand}. Con lo que nos contaste, el equipo puede revisar contigo cómo avanzar${topic}. ¿Te parece una llamada breve esta semana? Indícanos el día y la hora que te convengan.`,
  );
}

function nextActionFor(grade: Grade, hasContact: boolean): string {
  if (!hasContact && grade !== "human") return "Sin medio de contacto: esperar a que el prospecto vuelva a escribir";
  if (grade === "human") return "Responder personalmente a lo que pidió";
  if (grade === "hot") return "Aprobar la solicitud de reunión que NEX preparó";
  if (grade === "warm") return "Enviar información y proponer una llamada";
  return "Enviar información útil y dejar la puerta abierta";
}

// A conversation channel hands over a `Handoff`; this is the single adapter into the pipeline.
export function leadFromHandoff(handoff: Handoff, pack: ClientPack, id: string): Lead {
  const hasContact = handoff.contact !== null;
  const name = handoff.name?.trim() || "Prospecto";
  const grade: Grade = handoff.route;
  const canRequestMeeting = hasContact && (grade === "hot" || grade === "warm");
  const firstService = handoff.services[0] ? pack.services[handoff.services[0]]?.name : undefined;
  const status = handoff.audit ? scoreStatus(runAudit(handoff.audit.answers), handoff.treatment, handoff.business.name) : null;
  return {
    id,
    channel: "webChat",
    arrival: "session",
    company: handoff.business.name?.trim() || name,
    contactName: name,
    contact: handoff.contact ? { method: handoff.contact.method, value: handoff.contact.value } : null,
    score: handoff.audit?.score ?? null,
    band: handoff.audit?.band ?? null,
    infrastructure: handoff.audit?.infrastructure ?? null,
    status,
    grade,
    points: handoff.qualification?.points ?? null,
    reasons: handoff.reasons,
    priority: PRIORITY_BY_GRADE[grade],
    services: handoff.services,
    topGaps: handoff.audit?.topGaps ?? [],
    challenge: handoff.business.challenge,
    question: handoff.question,
    stage: "new",
    nextAction: nextActionFor(grade, hasContact),
    owner: grade === "hot" || grade === "human" ? OWNER_TEAM : OWNER_NEX,
    approval: canRequestMeeting ? { kind: "meeting", draft: meetingDraft(pack, name, firstService, handoff.treatment) } : null,
  };
}

// The owner approves the drafted meeting request: from now on the lead is waiting for the prospect's answer.
export function approveMeeting(leads: readonly Lead[], id: string): Lead[] {
  return leads.map((lead) =>
    lead.id === id && lead.approval ? { ...lead, approval: null, stage: "meetingRequested", nextAction: "Esperar la respuesta del prospecto y confirmar la fecha" } : lead,
  );
}

export function discardMeeting(leads: readonly Lead[], id: string): Lead[] {
  return leads.map((lead) =>
    lead.id === id && lead.approval ? { ...lead, approval: null, nextAction: "Decidir cómo continuar con este prospecto" } : lead,
  );
}

// Highest priority first, then the ones that need a person before the ones already moving, then newest first.
export function sortLeads(leads: readonly Lead[]): Lead[] {
  const rank = (lead: Lead) => PRIORITIES.indexOf(lead.priority) * 10 + (lead.approval ? 0 : 1) + (lead.stage === "meetingRequested" ? 3 : 0);
  return leads
    .map((lead, index) => ({ lead, index }))
    .sort((a, b) => rank(a.lead) - rank(b.lead) || (a.lead.arrival === b.lead.arrival ? b.index - a.index : a.lead.arrival === "session" ? -1 : 1))
    .map(({ lead }) => lead);
}

export type Digest = {
  // What happened while the owner was away (the demo's overnight leads).
  overnight: { analyzed: number; hot: number; awaitingApproval: number; needFollowUp: number; withMeeting: number };
  // What arrived while the owner was using the app, newest first.
  session: Lead[];
  // Every meeting request waiting for approval, whichever way it arrived.
  approvals: Lead[];
  total: number;
};

export function digest(leads: readonly Lead[]): Digest {
  const overnight = leads.filter((lead) => lead.arrival === "overnight");
  const audited = (lead: Lead) => lead.score !== null;
  return {
    overnight: {
      analyzed: overnight.filter(audited).length,
      hot: overnight.filter((lead) => lead.grade === "hot").length,
      awaitingApproval: overnight.filter((lead) => lead.approval).length,
      needFollowUp: overnight.filter((lead) => lead.stage === "needsFollowUp").length,
      withMeeting: overnight.filter((lead) => lead.stage === "meetingRequested").length,
    },
    session: leads.filter((lead) => lead.arrival === "session").reverse(),
    approvals: sortLeads(leads.filter((lead) => lead.approval)),
    total: leads.length,
  };
}

export type ExecutiveSummary = { headline: string; rows: [string, string][] };

// The one-page brief for a lead: who it is, how the business is doing, why it was graded so, what to offer and what to do.
export function executiveSummary(lead: Lead, pack: ClientPack): ExecutiveSummary {
  const rows: [string, string][] = [];
  if (lead.score !== null && lead.status) rows.push(["Cómo está el negocio", `${lead.status} (Business Score ${lead.score} / 100)`]);
  if (lead.challenge) rows.push(["Su prioridad", lead.challenge]);
  if (lead.question) rows.push(["Lo que preguntó", lead.question]);
  rows.push(["Clasificación", lead.reasons.join(" ")]);
  if (lead.services.length > 0) rows.push(["Servicios recomendados", lead.services.map((id) => pack.services[id]?.name ?? id).join(", ")]);
  rows.push(["Qué recomienda NEX", lead.nextAction]);
  rows.push(["Contacto", lead.contact ? `${lead.contactName} · ${lead.contact.value}` : "No dejó un medio de contacto"]);
  const headline =
    lead.grade === "hot" ? `${lead.company}: oportunidad caliente`
    : lead.grade === "warm" ? `${lead.company}: oportunidad con interés`
    : lead.grade === "cold" ? `${lead.company}: interés bajo por ahora`
    : `${lead.company}: pidió atención de una persona`;
  return { headline, rows };
}

// ---------- Demo data ----------
// Fictional companies run through the real engine, so their scores, grades and services are consistent with the audit.

type SeedSpec = {
  company: string;
  contactName: string;
  contact: { method: ContactMethod; value: string } | null;
  answers: Record<keyof AuditAnswers, MaturityLevel>;
  qualification: Omit<QualificationInput, "hasContact">;
  challenge: string;
  stage: Stage;
  approval: boolean;
  nextAction?: string;
};

const answers = (levels: [MaturityLevel, MaturityLevel, MaturityLevel, MaturityLevel, MaturityLevel, MaturityLevel, MaturityLevel, MaturityLevel]): AuditAnswers =>
  Object.fromEntries(AUDIT_DIMENSIONS.map((dimension, index) => [dimension, levels[index]])) as AuditAnswers;

// Order: web, social, capture, followUp, automation, analytics, advertising, ai
const SEEDS: SeedSpec[] = [
  { company: "Panadería La Espiga", contactName: "Marisol Vargas", contact: { method: "email", value: "marisol@laespiga.example" }, answers: answers(["none", "adHoc", "adHoc", "none", "none", "none", "none", "none"]), qualification: { budget: "high", timeline: "now", decisionRole: "owner" }, challenge: "Conseguir más clientes", stage: "new", approval: true },
  { company: "Estudio Lumen", contactName: "Diego Quesada", contact: { method: "whatsapp", value: "+506 8000 0001" }, answers: answers(["optimized", "defined", "defined", "defined", "adHoc", "adHoc", "defined", "none"]), qualification: { budget: "high", timeline: "now", decisionRole: "owner" }, challenge: "Venderle más a los clientes que ya tengo", stage: "meetingRequested", approval: false, nextAction: "Esperar la respuesta del prospecto y confirmar la fecha" },
  { company: "Clínica Dental Sonrisa", contactName: "Andrés Mora", contact: { method: "email", value: "andres@sonrisa.example" }, answers: answers(["defined", "adHoc", "adHoc", "adHoc", "none", "adHoc", "adHoc", "none"]), qualification: { budget: "medium", timeline: "soon", decisionRole: "influencer" }, challenge: "Ahorrar tiempo en tareas repetitivas", stage: "needsFollowUp", approval: true },
  { company: "Viajes Pacífico", contactName: "Lucía Rojas", contact: { method: "phone", value: "+506 8000 0003" }, answers: answers(["adHoc", "defined", "adHoc", "none", "none", "none", "adHoc", "adHoc"]), qualification: { budget: "medium", timeline: "soon", decisionRole: "influencer" }, challenge: "Conseguir más clientes", stage: "needsFollowUp", approval: false, nextAction: "Enviar información y proponer una llamada" },
  { company: "Taller Hernández", contactName: "Pablo Hernández", contact: { method: "email", value: "pablo@taller.example" }, answers: answers(["none", "none", "adHoc", "none", "none", "none", "none", "none"]), qualification: { budget: "low", timeline: "exploring", decisionRole: "none" }, challenge: "Todavía no lo tengo claro", stage: "new", approval: false },
  { company: "Ferretería El Tornillo", contactName: "Rosa Alfaro", contact: null, answers: answers(["adHoc", "none", "adHoc", "adHoc", "none", "none", "none", "none"]), qualification: { budget: "unknown", timeline: "later", decisionRole: "influencer" }, challenge: "Organizar mejor el negocio", stage: "new", approval: false },
];

export function seedLeads(pack: ClientPack): Lead[] {
  return SEEDS.map((seed, index) => {
    const result = runAudit(seed.answers);
    const qualification = qualifyLead({ ...seed.qualification, hasContact: seed.contact !== null });
    const grade: Grade = qualification.grade;
    const summary = buildSummary(result, { catalog: pack.catalog, treatment: pack.defaultTreatment, businessName: seed.company });
    const firstService = summary.services[0] ? pack.services[summary.services[0].serviceId]?.name : undefined;
    return {
      id: `demo-${index + 1}`,
      channel: "webChat",
      arrival: "overnight",
      company: seed.company,
      contactName: seed.contactName,
      contact: seed.contact,
      score: result.score,
      band: result.band,
      infrastructure: result.infrastructure,
      status: summary.status,
      grade,
      points: qualification.points,
      reasons: [`Prospecto ${{ hot: "caliente", warm: "tibio", cold: "frío", human: "" }[grade]} (${qualification.points} puntos).`, ...(seed.contact ? [] : ["No dejó un medio de contacto: no se le puede escribir."])],
      priority: PRIORITY_BY_GRADE[grade],
      services: summary.services.map((service) => service.serviceId),
      topGaps: result.gaps.slice(0, 3).map((gap) => gap.dimension),
      challenge: seed.challenge,
      stage: seed.stage,
      nextAction: seed.nextAction ?? nextActionFor(grade, seed.contact !== null),
      owner: grade === "hot" ? OWNER_TEAM : OWNER_NEX,
      approval: seed.approval && seed.contact ? { kind: "meeting", draft: meetingDraft(pack, seed.contactName.split(" ")[0], firstService, pack.defaultTreatment) } : null,
    } satisfies Lead;
  });
}
