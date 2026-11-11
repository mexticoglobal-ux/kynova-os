// KYNOVA operating KYNOVA (Sprint 33). The company that makes the platform is its own first customer: this file only SCRIPTS a company and a working day, and applies every step
// through the reducers that already exist (Organization, Billing, Communications, CRM, Marketplace, Academy, AI Studio, Insights, Automations, KOE, NEX's AI and the Agent
// Runtime). It adds no module, no screen, no rule and no capability: if the platform could not do a step, the step would come back as an error here, and the end-to-end tests
// would fail. Everything is simulated: no message is sent, no card is charged, no social network, WhatsApp or Stripe is touched. The people and the numbers are invented.

import { newAcademyState, reduceAcademy, type AcademyEvent, type AcademyState } from "./academy-center";
import { baseCourse, exam, lesson, question } from "./academy-demo";
import { newAgentState, reduceAgent, type AgentEvent, type AgentState } from "./agent-center";
import { newAutomationState, reduceAutomations, type AutomationEvent, type AutomationState } from "./automation-center";
import { SAMPLE_PAYLOADS, action, blankInput } from "./automation-demo";
import { newBillingState, reduceBilling, type BillingEvent, type BillingState } from "./billing-center";
import { newCommsState, reduceComms, type CommsEnv, type CommsEvent, type CommsState } from "./comms-center";
import { newCrmState, reduceCrm, type CrmEvent, type CrmState, type LeadInput } from "./crm-center";
import { HOT_ANSWERS } from "./crm-demo";
import { newInsightsState, reduceInsights, type InsightsEvent, type InsightsState } from "./insights-center";
import { simulateFacts } from "./insights-demo";
import { DEFAULT_KOE_ENV } from "./automation-koe";
import { computeInsights, type Insights } from "./koe-insights";
import { reduceAi, type AiEvent, type AiResult } from "./koe-ai-center";
import { executionsFromAutomations, executionsFromKoe, executionsFromStudio, rosterOf, workersOf, type ExecutionEvent } from "./koe-ledger";
import { reduceKoe, type KoeEvent } from "./koe-engine";
import { newMarketState, reduceMarket, type MarketEvent, type MarketState } from "./marketplace-center";
import { baseContent } from "./marketplace-demo";
import { newOrgState, reduceOrg, type OrgEvent, type OrgState } from "./org-center";
import { agentContent, demoStudioEnv, meta, promptContent } from "./studio-demo";
import { newStudioState, reduceStudio, type StudioEvent, type StudioState } from "./studio-center";
import { playbookById } from "./agent-catalog";

/** The company that is both the platform and its own first customer. */
export const KYNOVA_TENANT = "tenant-kynova";
/** An outside customer, used only to prove that KYNOVA's records stay KYNOVA's and that the Marketplace sells across companies. */
export const CUSTOMER_TENANT = "tenant-cliente-demo";
export const KYNOVA_ADMINS = ["admin:jeffrey", "admin:valeria"] as const;

/** "Today" of the simulated working day. */
export const OPERATION_NOW = "2026-11-10T12:00:00.000Z";
const ago = (days: number, hours = 0) => new Date(Date.parse(OPERATION_NOW) - days * 86_400_000 - hours * 3_600_000).toISOString();
/** A moment a few minutes after another: a session that waits for a person must be answered inside its own time limit. */
const later = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();
const usd = (amount: number) => amount * 1_000_000;

export const KYNOVA_PEOPLE = [
  { id: "jeffrey", name: "Jeffrey Hernandez", role: "owner", department: "Dirección" },
  { id: "valeria", name: "Valeria Núñez", role: "manager", department: "Producto" },
  { id: "sofia", name: "Sofía Mora", role: "sales", department: "Ventas" },
  { id: "diego", name: "Diego Solano", role: "marketing", department: "Marketing" },
  { id: "mateo", name: "Mateo Brenes", role: "support", department: "Soporte" },
  { id: "lucia", name: "Lucía Campos", role: "finance", department: "Finanzas" },
] as const;

export const KYNOVA_DEPARTMENTS = ["Ventas", "Marketing", "Soporte", "Finanzas", "Producto"] as const;
export const KYNOVA_WORKERS = ["coordinator", "sales", "followup", "reporter", "collections"] as const;

export type OperationStep = { phase: string; module: string; event: string; ok: boolean; at: string };
export type OperationParts = {
  org: OrgState; billing: BillingState; comms: CommsState; crm: CrmState; market: MarketState; academy: AcademyState; studio: StudioState; insights: InsightsState;
  automations: AutomationState; agent: AgentState;
};
export type DailyPhase = "setup" | "leads" | "followup" | "support" | "billing" | "marketing" | "content" | "metrics" | "meetings" | "tasks";
export type OperatingDashboard = {
  tenantId: string; asOf: string;
  people: { active: number; departments: number; teams: number; workers: number };
  sales: { leadsOpen: number; leadsToday: number; leadsWon: number; pipelineMicros: number; meetings: number; customers: number };
  tasks: { open: number; done: number; proposedByNex: number };
  support: { open: number; waitingForAnswer: number; resolved: number; draftsReady: number };
  billing: { planId: string; invoices: number; paidMicros: number; creditMicros: number; proposalsWaiting: number };
  marketing: { assets: number; approvedAssets: number; contentPublished: number; reportsApproved: number };
  marketplace: { listingsLive: number; sales: number; earningsMinor: number };
  academy: { courses: number; enrollments: number; certificates: number };
  automation: { active: number; runs: number; outputsOpen: number };
  ai: { workerRuns: number; agentSessions: number; agentSessionsCompleted: number; aiCalls: number; aiCostMicros: number; approvalsWaiting: number };
  insights: Insights["executive"];
  health: Record<"sales" | "support" | "billing" | "automation" | "ai", "good" | "attention">;
};
export type KynovaOperation = {
  parts: OperationParts; ai: AgentState["ai"]; executions: readonly ExecutionEvent[]; steps: readonly OperationStep[]; errors: string[];
  dashboard: OperatingDashboard; aiResults: readonly AiResult[];
};

/** A reducer plus the list of what it refused. Every step of the scenario goes through one of these, so a step the platform cannot do is an error, never a silent skip. */
function track<S, E extends { type: string }>(module: string, initial: S, reduce: (state: S, event: E) => { state: S; error?: string }, steps: OperationStep[], errors: string[], phase: () => string, clock: () => string) {
  const box = { state: initial };
  const send = (event: E & { at?: string }) => {
    const result = reduce(box.state, event);
    steps.push({ phase: phase(), module, event: event.type, ok: !result.error, at: event.at ?? clock() });
    if (result.error) errors.push(`${module} · ${event.type}: ${result.error}`);
    box.state = result.state;
    return result;
  };
  return { box, send };
}

export function runKynovaOperation(): KynovaOperation {
  const steps: OperationStep[] = [];
  const errors: string[] = [];
  let phase: string = "setup";
  const clock = () => OPERATION_NOW;
  const at = () => phase;

  const org = track<OrgState, OrgEvent>("org", newOrgState(), reduceOrg, steps, errors, at, clock);
  const billing = track<BillingState, BillingEvent>("billing", newBillingState(), reduceBilling, steps, errors, at, clock);
  const crm = track<CrmState, CrmEvent>("crm", newCrmState(), reduceCrm, steps, errors, at, clock);
  const market = track<MarketState, MarketEvent>("marketplace", newMarketState(KYNOVA_ADMINS), reduceMarket, steps, errors, at, clock);
  const academy = track<AcademyState, AcademyEvent>("academy", newAcademyState(KYNOVA_ADMINS), reduceAcademy, steps, errors, at, clock);
  const insights = track<InsightsState, InsightsEvent>("insights", newInsightsState(), reduceInsights, steps, errors, at, clock);
  const automations = track<AutomationState, AutomationEvent>("automations", newAutomationState(), (state, event) => reduceAutomations(state, event), steps, errors, at, clock);
  const agent = track<AgentState, AgentEvent | (KoeEvent & { kind: "koe" }) | (AiEvent & { kind: "ai" })>("koe", newAgentState(KYNOVA_ADMINS), (state, event) => {
    if ("kind" in event && event.kind === "koe") { const r = reduceKoe(state.koe, event as KoeEvent); return { state: { ...state, koe: r.state }, ...(r.error ? { error: r.error } : {}) }; }
    if ("kind" in event && event.kind === "ai") { const r = reduceAi(state.ai, event as AiEvent); aiResults.push(r); return { state: { ...state, ai: r.state }, ...(r.error ? { error: r.error } : {}) }; }
    return reduceAgent(state, event as AgentEvent);
  }, steps, errors, at, clock);
  const aiResults: AiResult[] = [];
  const koe = (event: KoeEvent) => agent.send({ ...event, kind: "koe" } as never);
  const ai = (event: AiEvent) => agent.send({ ...event, kind: "ai" } as never);

  // ---- Communications and Studio need what other modules hold, by id only
  const commsEnv = (): CommsEnv => ({ ...DEFAULT_KOE_ENV, refs: { leads: crm.box.state.leads.map((item) => ({ id: item.id, tenantId: item.tenantId })), customers: crm.box.state.customers.map((item) => ({ id: item.id, tenantId: item.tenantId })) }, crm: crm.box.state });
  const comms = track<CommsState, CommsEvent>("communications", newCommsState(), (state, event) => reduceComms(state, event, commsEnv()), steps, errors, at, clock);
  const studioEnv = () => ({ ...demoStudioEnv(), refs: { automations: automations.box.state.automations.map((item) => ({ id: item.id, tenantId: item.tenantId, name: item.name })), courses: academy.box.state.courses.map((item) => ({ id: item.id, tenantId: item.ownerTenantId, name: item.content.title })) } });
  const studio = track<StudioState, StudioEvent>("studio", newStudioState(), (state, event) => reduceStudio(state, event, studioEnv()), steps, errors, at, clock);

  const jeffrey = { tenantId: KYNOVA_TENANT, actor: "jeffrey" };
  const valeria = { tenantId: KYNOVA_TENANT, actor: "valeria" };
  const sofia = { tenantId: KYNOVA_TENANT, actor: "sofia" };
  const diego = { tenantId: KYNOVA_TENANT, actor: "diego" };
  const mateo = { tenantId: KYNOVA_TENANT, actor: "mateo" };
  const lucia = { tenantId: KYNOVA_TENANT, actor: "lucia" };
  const nex = { tenantId: KYNOVA_TENANT, actor: "worker:nex" };
  const system = { tenantId: KYNOVA_TENANT, actor: "system" };
  const adminJeffrey = { tenantId: KYNOVA_TENANT, actor: "admin:jeffrey" };
  const adminValeria = { tenantId: KYNOVA_TENANT, actor: "admin:valeria" };
  const customer = { tenantId: CUSTOMER_TENANT, actor: "cliente" };

  // ======================================================================== 1. the company: Organization
  phase = "setup";
  const orgS = () => org.box.state;
  const roleId = (key: string) => orgS().roles.find((item) => item.key === key && item.tenantId === KYNOVA_TENANT)?.id ?? "";
  const branchId = orgS;
  org.send({ ...system, at: ago(30), type: "org.create", name: "KYNOVA", ownerId: "jeffrey", ownerName: "Jeffrey Hernandez", ownerEmail: "jeffrey@kynova.test" });
  org.send({ ...jeffrey, at: ago(29), type: "branch.create", name: "Sede Central", city: "San José" });
  const branch = () => branchId().branches.find((item) => item.tenantId === KYNOVA_TENANT)?.id ?? "";
  for (const name of KYNOVA_DEPARTMENTS) org.send({ ...jeffrey, at: ago(29), type: "department.create", branchId: branch(), name });
  const dept = (name: string) => orgS().departments.find((item) => item.name === name && item.tenantId === KYNOVA_TENANT)?.id ?? "";
  for (const person of KYNOVA_PEOPLE.filter((item) => item.id !== "jeffrey")) {
    org.send({ ...jeffrey, at: ago(28), type: "invite.create", email: `${person.id}@kynova.test`, name: person.name, roleId: roleId(person.role), branchId: branch() });
    org.send({ ...system, at: ago(27), type: "invite.accept", invitationId: orgS().invitations.find((item) => item.userId === person.id && item.tenantId === KYNOVA_TENANT)?.id ?? "" });
  }
  const teams: [string, string, string, string[], string][] = [
    ["Ventas KYNOVA", "Ventas", "sales", ["Responder cada prospecto en menos de 2 horas", "Cerrar 10 cuentas este trimestre"], "sofia"],
    ["Marketing KYNOVA", "Marketing", "sales", ["Publicar 12 contenidos al mes"], "diego"],
    ["Soporte KYNOVA", "Soporte", "followup", ["Primera respuesta en menos de 1 hora"], "mateo"],
    ["Finanzas KYNOVA", "Finanzas", "collections", ["Cobrar el 95 % a tiempo"], "lucia"],
    ["Producto y IA", "Producto", "analysis", ["Un reporte ejecutivo por semana"], "valeria"],
  ];
  for (const [name, department, specialty, goals, leadId] of teams) org.send({ ...valeria, at: ago(26), type: "team.create", departmentId: dept(department), name, specialty, goals, leadId });
  const team = (name: string) => orgS().teams.find((item) => item.name === name && item.tenantId === KYNOVA_TENANT)?.id ?? "";
  for (const [id, name] of [["sofia", "Ventas KYNOVA"], ["diego", "Marketing KYNOVA"], ["mateo", "Soporte KYNOVA"], ["lucia", "Finanzas KYNOVA"], ["valeria", "Producto y IA"]] as const) org.send({ ...valeria, at: ago(25), type: "membership.assign", subject: { kind: "user", id }, teamId: team(name) });
  // the internal AI workers belong to a team exactly like a person
  for (const [workerId, name] of [["sales", "Ventas KYNOVA"], ["followup", "Soporte KYNOVA"], ["collections", "Finanzas KYNOVA"], ["reporter", "Producto y IA"]] as const) org.send({ ...valeria, at: ago(25), type: "membership.assign", subject: { kind: "worker", id: workerId }, teamId: team(name) });
  org.send({ ...jeffrey, at: ago(24), type: "authorization.grant", maxPerDay: 3 }); // Level 2: NEX may reassign a person inside this limit
  org.send({ ...nex, at: ago(2), type: "proposal.create", payload: { kind: "team", departmentId: dept("Soporte"), name: "Soporte nocturno", specialty: "followup", goals: ["Cubrir de 6 p. m. a 10 p. m."] }, reason: "Hay mensajes sin responder por la noche." });
  org.send({ ...valeria, at: ago(1), type: "proposal.approve", proposalId: orgS().proposals.at(-1)?.id ?? "" });
  for (const person of KYNOVA_PEOPLE) org.send({ ...system, at: ago(0, 3), type: "access.record", userId: person.id });

  // ======================================================================== 2. KOE: the internal Workers, and NEX's AI configuration
  for (const worker of KYNOVA_WORKERS) koe({ ...jeffrey, at: ago(24), type: "worker.enable", definitionId: worker });
  const instance = (definitionId: string) => agent.box.state.koe.instances.find((item) => item.tenantId === KYNOVA_TENANT && item.definitionId === definitionId)?.id ?? "";
  koe({ ...jeffrey, at: ago(23), type: "authorization.grant", instanceId: instance("sales"), action: "faq.answer", maxPerDay: 20 }); // Level 2: answer approved FAQs
  koe({ ...jeffrey, at: ago(23), type: "instance.configure", instanceId: instance("sales"), maxRunsPerDay: 40, deniedProviders: [] });
  ai({ ...jeffrey, at: ago(23), type: "ai.configure", policy: "balanced", budgetMicros: usd(100), limits: { maxInputTokens: 6_000 } });

  // ======================================================================== 3. Billing: KYNOVA pays for KYNOVA
  billing.send({ ...system, at: ago(30), type: "account.create", ownerId: "jeffrey", planId: "business" });
  billing.send({ ...jeffrey, at: ago(30), type: "billing.setAdmin", userId: "lucia", enabled: true });
  billing.send({ ...lucia, at: ago(20), type: "addon.purchase", addon: "aiCredits", quantity: 1 });

  // ======================================================================== 4. AI Studio: the internal prompts and agent
  const asset = (name: string) => studio.box.state.assets.find((item) => item.name === name && item.tenantId === KYNOVA_TENANT)?.id ?? "";
  studio.send({ ...jeffrey, at: ago(22), type: "authorization.grant", maxPerDay: 10 });
  studio.send({ ...diego, at: ago(22), type: "asset.create", kind: "prompt", meta: meta("Primera respuesta a prospecto", "sales", ["ventas", "primer-contacto"], "Primera respuesta a quien pide información de KYNOVA."), content: promptContent("Eres el asistente comercial de KYNOVA.\nResponde a {{nombre}} sobre {{tema}} con un tono cercano.\nNo prometas precios.", "business", { nombre: "Marta", tema: "el plan Business" }) });
  studio.send({ ...diego, at: ago(22), type: "version.submit", assetId: asset("Primera respuesta a prospecto"), versionNumber: 1 });
  studio.send({ ...valeria, at: ago(21), type: "version.approve", assetId: asset("Primera respuesta a prospecto"), versionNumber: 1, note: "Listo para usar" });
  studio.send({ ...diego, at: ago(21), type: "asset.create", kind: "prompt", meta: meta("Calendario de contenido", "marketing", ["contenido", "marketing"], "Propone las piezas de contenido de la semana."), content: promptContent("Propone {{cantidad}} piezas de contenido para {{canal}} sobre {{tema}}.", "business", { cantidad: "3", canal: "el blog", tema: "automatizar el seguimiento" }) });
  studio.send({ ...diego, at: ago(21), type: "version.submit", assetId: asset("Calendario de contenido"), versionNumber: 1 });
  studio.send({ ...valeria, at: ago(20), type: "version.approve", assetId: asset("Calendario de contenido"), versionNumber: 1 });
  studio.send({ ...diego, at: ago(20), type: "asset.create", kind: "agent", meta: meta("Agente comercial de KYNOVA", "sales", ["ventas"], "Atiende a los prospectos con el prompt de primera respuesta."), content: agentContent(asset("Primera respuesta a prospecto"), { workerIds: ["sales"] }) });
  studio.send({ ...diego, at: ago(20), type: "version.submit", assetId: asset("Agente comercial de KYNOVA"), versionNumber: 1 });
  studio.send({ ...valeria, at: ago(19), type: "version.approve", assetId: asset("Agente comercial de KYNOVA"), versionNumber: 1 });

  // ======================================================================== 5. Automations and workflows: the internal ones
  const auto = (name: string) => automations.box.state.automations.find((item) => item.name === name && item.tenantId === KYNOVA_TENANT)?.id ?? "";
  const defs = [
    blankInput({ name: "Prospecto entrante → tarea y borrador", description: "Un prospecto con buen ajuste genera una tarea para Ventas y un correo preparado.", trigger: "newProspect", conditions: [{ field: "puntaje", op: "greaterThan", value: "60" }],
      actions: [action("createTask", { titulo: "Llamar a {{nombre}} ({{empresa}})", enDias: "1" }), action("notifyInternal", { texto: "Prospecto nuevo: {{nombre}} ({{empresa}}), puntaje {{puntaje}}", para: "team" }), action("prepareEmail", { para: "{{correo}}", asunto: "Gracias por su interés, {{nombre}}", cuerpo: "Hola {{nombre}}, recibimos su solicitud y le escribiremos hoy." })] }),
    blankInput({ name: "Cliente nuevo → bienvenida", trigger: "newClient", actions: [action("prepareEmail", { para: "{{correo}}", asunto: "Bienvenido a KYNOVA", cuerpo: "Hola {{nombre}}, empecemos con la configuración de su empresa." }), action("createReminder", { texto: "Revisar el primer mes de {{nombre}}", enHoras: "720" })] }),
    blankInput({ name: "Pago recibido → conciliar", trigger: "paymentReceived", actions: [action("createTask", { titulo: "Conciliar el pago de {{cliente}}" }), action("notifyInternal", { texto: "Pago recibido de {{cliente}}: {{monto}} {{moneda}}", para: "owner" })] }),
    blankInput({ name: "Formulario web → respuesta de precios", trigger: "formSubmitted", conditions: [{ field: "mensaje", op: "contains", value: "precio" }], actions: [action("prepareEmail", { para: "{{correo}}", asunto: "Sobre su consulta de precios", cuerpo: "Hola {{nombre}}, le compartimos los planes de KYNOVA en breve." }), action("notifyInternal", { texto: "Consulta de precios de {{nombre}}", para: "team" })] }),
    blankInput({ name: "Reunión creada → preparar", trigger: "meetingCreated", actions: [action("createPendingEvent", { titulo: "Preparar: {{titulo}}", enDias: "0" })] }),
    blankInput({ name: "Revisión semanal", trigger: "manual", actions: [action("createTask", { titulo: "Revisar {{tema}}", asignado: "member" })] }),
  ];
  for (const input of defs) automations.send({ ...jeffrey, at: ago(18), type: "automation.create", input });
  for (const input of defs) { automations.send({ ...jeffrey, at: ago(17), type: "automation.activate", automationId: auto(input.name) }); automations.send({ ...jeffrey, at: ago(17), type: "automation.setTestMode", automationId: auto(input.name), testMode: false }); }

  // ======================================================================== 6. Marketplace and Academy: what KYNOVA sells and teaches
  const listing = (name: string) => market.box.state.listings.find((item) => item.content.name === name)?.id ?? "";
  const publish = (name: string, kind: "digitalResource" | "aiAgent", summary: string, pricing: { model: "free" } | { model: "oneTime"; amountMinor: number } | { model: "subscription"; amountMinor: number; interval: "month" }) => {
    market.send({ ...jeffrey, at: ago(16), type: "listing.create", kind, content: baseContent({ name, summary, category: "sales", tags: ["ventas", "kynova"], pricing, ...(kind === "aiAgent" ? { permissions: { capabilities: ["readCalendar"], readsPersonalData: false, writesExternally: false }, privacyPolicyUrl: "https://kynova.example/privacidad", supportContact: "soporte@kynova.example" } : { deliverable: { fileName: "plantillas-seguimiento.pdf", sizeBytes: 800_000 } }) }) });
    market.send({ ...jeffrey, at: ago(16), type: "listing.submit", listingId: market.box.state.listings.at(-1)?.id ?? "" });
    market.send({ ...adminValeria, at: ago(15), type: "moderation.decide", listingId: listing(name), approve: true });
  };
  publish("Plantillas de seguimiento comercial", "digitalResource", "Mensajes listos para cada etapa del seguimiento.", { model: "oneTime", amountMinor: 2_900 });
  publish("Asistente de seguimiento KYNOVA", "aiAgent", "Prepara y recuerda el seguimiento de cada prospecto.", { model: "subscription", amountMinor: 2_900, interval: "month" });
  const kynova101 = "Operar una empresa con KYNOVA";
  const course = () => academy.box.state.courses.find((item) => item.content.title === kynova101)?.id ?? "";
  academy.send({ ...adminJeffrey, at: ago(14), type: "course.create", origin: "official", distribution: "internal", content: baseCourse({
    title: kynova101, summary: "El día de trabajo de un equipo que opera con KYNOVA.", description: "Prospectos, seguimiento, soporte, cobros y reportes con NEX y las aprobaciones.", tags: ["operación", "nex"],
    lessons: [lesson("l1", "El día en KYNOVA", "text", 8, true, { body: "Cada mañana se revisa el panel, se aprueban las tareas que NEX propuso y se responde a los prospectos nuevos." }), lesson("l2", "Qué aprueba una persona", "text", 6, true, { body: "Enviar un mensaje, mover dinero y publicar requieren una persona." })],
    exams: [exam("e1", "Examen de operación", [question("q1", "¿Quién aprueba un pago?", "single", [["a", "NEX"], ["b", "Una persona"]], ["b"])])], tutor: { enabled: true, dailyLimit: 5 } }) });
  academy.send({ ...adminJeffrey, at: ago(14), type: "course.publish", courseId: course() });
  academy.send({ ...adminValeria, at: ago(13), type: "course.review", courseId: course(), approve: true });

  // ======================================================================== the working day
  // ---- leads: a form arrives, the automation reacts, NEX and the team qualify
  phase = "leads";
  const lead = (name: string) => crm.box.state.leads.find((item) => item.name === name && item.tenantId === KYNOVA_TENANT)?.id ?? "";
  const subject = (name: string) => ({ kind: "lead" as const, id: lead(name) });
  const input = (name: string, company: string, value: number, fit: number, source: string, extra: Partial<LeadInput> = {}): LeadInput => ({ name, company, source, estimatedValueMicros: usd(value), fit, owner: "sofia", ...extra });
  crm.send({ ...jeffrey, at: ago(1, 20), type: "authorization.grant", maxPerDay: 3 }); // Level 2: NEX may move a stage one step
  const incoming: [string, string, number, number, string, Partial<LeadInput>][] = [
    ["Marta Solís", "Clínica Dental Sol", 4_800, 82, "Formulario web", { email: "marta@dentalsol.test" }],
    ["Andrés Quirós", "Taller Rápido", 2_400, 71, "Referido", { email: "andres@taller.test" }],
    ["Paula Rivas", "Boutique Luna", 1_200, 48, "Formulario web", { email: "paula@luna.test" }],
    ["Esteban Mora", "Hotel Mar", 9_000, 90, "Marketplace", { email: "esteban@hotelmar.test" }],
    ["Camila Rojas", "Rojas y Cía", 3_600, 77, "Chat web", { phone: "88889999" }],
  ];
  for (const [name, company, value, fit, source, extra] of incoming) crm.send({ ...sofia, at: ago(0, 6), type: "lead.create", input: input(name, company, value, fit, source, extra) });
  automations.send({ ...system, at: ago(0, 6), type: "trigger.fire", kind: "newProspect", eventId: "kyn-lead-1", payload: { nombre: "Marta Solís", empresa: "Clínica Dental Sol", correo: "marta@dentalsol.test", puntaje: "82", origen: "Formulario web" } });
  automations.send({ ...system, at: ago(0, 6), type: "trigger.fire", kind: "newProspect", eventId: "kyn-lead-2", payload: { nombre: "Paula Rivas", empresa: "Boutique Luna", correo: "paula@luna.test", puntaje: "40", origen: "Formulario web" } }); // below the threshold: nothing runs
  automations.send({ ...system, at: ago(0, 6), type: "trigger.fire", kind: "formSubmitted", eventId: "kyn-form-1", payload: { ...SAMPLE_PAYLOADS.formSubmitted, nombre: "Esteban Mora", correo: "esteban@hotelmar.test", mensaje: "¿Cuál es el precio del plan Business?" } });
  automations.send({ ...system, at: ago(0, 6), type: "trigger.fire", kind: "newProspect", eventId: "kyn-lead-1", payload: { nombre: "Marta Solís", empresa: "Clínica Dental Sol", correo: "marta@dentalsol.test", puntaje: "82", origen: "Formulario web" } }); // the same event again: processed once
  crm.send({ ...system, at: ago(0, 5), type: "audit.record", leadId: lead("Marta Solís"), answers: HOT_ANSWERS });
  crm.send({ ...system, at: ago(0, 5), type: "audit.record", leadId: lead("Esteban Mora"), answers: HOT_ANSWERS });
  for (const name of ["Marta Solís", "Andrés Quirós", "Esteban Mora"]) crm.send({ ...nex, at: ago(0, 5), type: "analysis.refresh", leadId: lead(name) });
  insights.send({ ...system, at: ago(0, 5), type: "fact.record", module: "sales", metric: "leadsNew", value: incoming.length });
  insights.send({ ...system, at: ago(0, 5), type: "fact.record", module: "sales", metric: "leadsQualified", value: 3 });

  // ---- follow-up: interactions, stages, an agent, NEX's tasks
  phase = "followup";
  crm.send({ ...sofia, at: ago(0, 4), type: "interaction.record", subject: subject("Marta Solís"), kind: "email", direction: "out", summary: "Primer correo con la presentación de KYNOVA." });
  crm.send({ ...sofia, at: ago(0, 4), type: "stage.move", leadId: lead("Marta Solís"), to: "qualified" });
  crm.send({ ...sofia, at: ago(0, 4), type: "interaction.record", subject: subject("Esteban Mora"), kind: "call", direction: "out", summary: "Llamada de 20 minutos: quiere automatizar reservas." });
  crm.send({ ...sofia, at: ago(0, 4), type: "stage.move", leadId: lead("Esteban Mora"), to: "qualified" });
  crm.send({ ...sofia, at: ago(0, 3), type: "stage.move", leadId: lead("Esteban Mora"), to: "meeting" });
  crm.send({ ...sofia, at: ago(0, 3), type: "stage.move", leadId: lead("Esteban Mora"), to: "proposal" });
  crm.send({ ...nex, at: ago(0, 3), type: "stage.move", leadId: lead("Andrés Quirós"), to: "qualified", note: "Respondió el correo de bienvenida" }); // Level 2, inside the authorization
  for (const name of ["Marta Solís", "Andrés Quirós", "Esteban Mora", "Camila Rojas"]) crm.send({ ...nex, at: ago(0, 3), type: "task.generate", leadId: lead(name) });
  const task = (name: string) => crm.box.state.tasks.find((item) => item.leadId === lead(name) && item.status === "proposed")?.id ?? "";
  crm.send({ ...sofia, at: ago(0, 2), type: "task.accept", taskId: task("Marta Solís") });
  crm.send({ ...sofia, at: ago(0, 2), type: "task.accept", taskId: task("Esteban Mora") });
  crm.send({ ...sofia, at: ago(0, 2), type: "task.complete", taskId: crm.box.state.tasks.find((item) => item.leadId === lead("Esteban Mora") && item.status === "accepted")?.id ?? "", note: "Se envió la propuesta" });
  crm.send({ ...sofia, at: ago(0, 2), type: "task.dismiss", taskId: task("Camila Rojas") });

  // ---- the agent runtime: a Worker follows a plan, and a person approves what sends a message
  const session = () => agent.box.state.sessions.at(-1)?.id ?? "";
  agent.send({ ...sofia, at: ago(0, 2), type: "session.start", instanceId: instance("sales"), playbookId: "sales.qualify", goal: "Calificar a Marta Solís", input: { contacto: "Marta Solís" } });
  agent.send({ ...system, at: ago(0, 2), type: "session.run", sessionId: session() });
  agent.send({ ...sofia, at: ago(0, 2), type: "session.start", instanceId: instance("followup"), playbookId: "followup.nudge", goal: "Dar seguimiento a Esteban Mora", input: { contacto: "Esteban Mora", tema: "la propuesta" } });
  agent.send({ ...system, at: ago(0, 2), type: "session.run", sessionId: session() });
  const waiting = agent.box.state.sessions.find((item) => item.status === "waitingApproval");
  if (waiting) agent.send({ ...valeria, at: later(ago(0, 2), 4), type: "session.approve", sessionId: waiting.id, approve: true });
  if (waiting) agent.send({ ...system, at: later(ago(0, 2), 5), type: "session.run", sessionId: waiting.id });

  // ---- meetings
  phase = "meetings";
  crm.send({ ...sofia, at: ago(0, 1), type: "meeting.schedule", leadId: lead("Esteban Mora"), scheduledFor: "2026-11-12T15:00:00.000Z", title: "Demostración de KYNOVA para Hotel Mar" });
  crm.send({ ...sofia, at: ago(0, 1), type: "meeting.schedule", leadId: lead("Marta Solís"), scheduledFor: "2026-11-11T16:00:00.000Z", title: "Diagnóstico con Clínica Dental Sol" });
  automations.send({ ...system, at: ago(0, 1), type: "trigger.fire", kind: "meetingCreated", eventId: "kyn-meet-1", payload: { titulo: "Demostración de KYNOVA para Hotel Mar", fecha: "2026-11-12", contacto: "Esteban Mora", correo: "esteban@hotelmar.test" } });
  crm.send({ ...sofia, at: ago(0, 3), type: "stage.move", leadId: lead("Esteban Mora"), to: "negotiation" });
  crm.send({ ...jeffrey, at: ago(0, 3), type: "stage.move", leadId: lead("Esteban Mora"), to: "won", note: "Aceptó el plan Business" });
  crm.send({ ...jeffrey, at: ago(0, 3), type: "customer.convert", leadId: lead("Esteban Mora") });
  automations.send({ ...system, at: ago(0, 3), type: "trigger.fire", kind: "newClient", eventId: "kyn-client-1", payload: { nombre: "Hotel Mar", empresa: "Hotel Mar", correo: "esteban@hotelmar.test", telefono: "88885678" } });

  // ---- support: conversations, NEX's drafts, a person answers
  phase = "support";
  const conv = (subjectText: string) => comms.box.state.conversations.find((item) => item.subject === subjectText && item.tenantId === KYNOVA_TENANT)?.id ?? "";
  comms.send({ ...jeffrey, at: ago(3), type: "authorization.grant", maxPerDay: 3 }); // Level 2: NEX may reassign a conversation
  comms.send({ ...system, at: ago(0, 7), type: "conversation.open", input: { channel: "email", subject: "Cotización final del plan Business", contact: { name: "Marta Solís", handle: "marta@dentalsol.test" }, company: "Clínica Dental Sol", text: "Hola, ¿pueden enviarme la cotización final? Quisiera contratar esta semana." } });
  comms.send({ ...system, at: ago(0, 5), type: "conversation.open", input: { channel: "webchat", subject: "No puedo invitar a mi equipo", contact: { name: "Visitante 301", handle: "visitor-301" }, company: "", text: "Necesito ayuda: no me deja invitar a una persona nueva." } });
  comms.send({ ...system, at: ago(0, 4), type: "conversation.open", input: { channel: "webform", subject: "Consulta sobre facturación", contact: { name: "Esteban Mora", handle: "esteban@hotelmar.test" }, company: "Hotel Mar", text: "¿Cuándo se emite la primera factura?" } });
  comms.send({ ...mateo, at: ago(0, 4), type: "conversation.link", conversationId: conv("Cotización final del plan Business"), leadId: lead("Marta Solís") });
  comms.send({ ...mateo, at: ago(0, 4), type: "conversation.link", conversationId: conv("Consulta sobre facturación"), leadId: lead("Esteban Mora") });
  for (const text of ["Cotización final del plan Business", "No puedo invitar a mi equipo", "Consulta sobre facturación"]) {
    comms.send({ ...nex, at: ago(0, 3), type: "conversation.classify", conversationId: conv(text) });
    comms.send({ ...nex, at: ago(0, 3), type: "draft.create", conversationId: conv(text) });
  }
  comms.send({ ...nex, at: ago(0, 3), type: "conversation.assign", conversationId: conv("No puedo invitar a mi equipo"), assignee: "mateo" });
  comms.send({ ...mateo, at: ago(0, 2), type: "note.add", conversationId: conv("No puedo invitar a mi equipo"), text: "Revisar el límite de usuarios del plan antes de responder." });
  const draft = (text: string) => comms.box.state.drafts.find((item) => item.conversationId === conv(text))?.id ?? "";
  comms.send({ ...mateo, at: ago(0, 2), type: "draft.ready", draftId: draft("No puedo invitar a mi equipo") });
  comms.send({ ...mateo, at: ago(0, 2), type: "message.record", conversationId: conv("No puedo invitar a mi equipo"), text: "Hola, le ayudamos: su plan permite 10 personas; ya aumentamos el espacio." });
  comms.send({ ...mateo, at: ago(0, 1), type: "status.set", conversationId: conv("No puedo invitar a mi equipo"), to: "resolved" });
  comms.send({ ...sofia, at: ago(0, 1), type: "message.record", conversationId: conv("Cotización final del plan Business"), text: "Con gusto, le enviamos la cotización hoy." });
  crm.send({ ...mateo, at: ago(0, 1), type: "interaction.record", subject: subject("Marta Solís"), kind: "email", direction: "in", summary: "Marta pide la cotización final." });

  // ---- billing: the invoice, the payment, NEX's proposals, the collections agent
  phase = "billing";
  billing.send({ ...lucia, at: ago(0, 6), type: "renewal.run" });
  const invoice = billing.box.state.invoices.find((item) => item.tenantId === KYNOVA_TENANT);
  if (invoice) billing.send({ ...lucia, at: ago(0, 5), type: "payment.record", invoiceId: invoice.id, amountMicros: invoice.totalMicros, method: "simulatedCard" });
  billing.send({ ...nex, at: ago(0, 4), type: "billing.analyze" });
  billing.send({ ...nex, at: ago(0, 4), type: "proposal.create", payload: { kind: "addon", addon: "storage", quantity: 1 }, reason: "El almacenamiento superará el 80 % el próximo mes." });
  automations.send({ ...system, at: ago(0, 5), type: "trigger.fire", kind: "paymentReceived", eventId: "kyn-pay-1", payload: { cliente: "KYNOVA (suscripción)", monto: String((invoice?.totalMicros ?? 0) / 1_000_000), moneda: "USD", metodo: "Tarjeta simulada", referencia: invoice?.number ?? "KYN-0001" } });
  agent.send({ ...lucia, at: ago(0, 3), type: "session.start", instanceId: instance("collections"), playbookId: "collections.reminder", goal: "Recordar el pago de Hotel Mar", input: { contacto: "Esteban Mora", cliente: "Hotel Mar", monto: "399" } });
  agent.send({ ...system, at: ago(0, 3), type: "session.run", sessionId: session() });
  const waitingPay = agent.box.state.sessions.find((item) => item.status === "waitingApproval");
  if (waitingPay) agent.send({ ...jeffrey, at: later(ago(0, 3), 4), type: "session.approve", sessionId: waitingPay.id, approve: true });
  if (waitingPay) agent.send({ ...system, at: later(ago(0, 3), 5), type: "session.run", sessionId: waitingPay.id });
  const sold = market.box.state.purchases.length;
  market.send({ ...customer, at: ago(0, 5), type: "purchase.create", listingId: listing("Plantillas de seguimiento comercial") });
  market.send({ ...customer, at: ago(0, 5), type: "purchase.create", listingId: listing("Asistente de seguimiento KYNOVA") });
  if (sold === 0) market.send({ ...customer, at: ago(0, 4), type: "download.record", purchaseId: market.box.state.purchases.find((item) => item.buyerTenantId === CUSTOMER_TENANT)?.id ?? "" });
  market.send({ ...customer, at: ago(0, 3), type: "review.submit", purchaseId: market.box.state.purchases.find((item) => item.buyerTenantId === CUSTOMER_TENANT)?.id ?? "", rating: 5, body: "Muy útil: lo usamos desde el primer día." });
  market.send({ ...adminJeffrey, at: ago(0, 2), type: "settlement.request", sellerTenantId: KYNOVA_TENANT, currency: "USD" });

  // ---- marketing and content: a plan, tests through KOE, a published piece
  phase = "marketing";
  studio.send({ ...diego, at: ago(0, 5), type: "test.run", assetId: asset("Calendario de contenido"), versionNumber: 1, inputs: { cantidad: "3", canal: "el blog", tema: "automatizar el seguimiento" } });
  studio.send({ ...diego, at: ago(0, 5), type: "test.run", assetId: asset("Agente comercial de KYNOVA"), versionNumber: 1, inputs: { nombre: "Camila Rojas", tema: "una demostración" } });
  phase = "content";
  studio.send({ ...diego, at: ago(0, 4), type: "asset.create", kind: "prompt", meta: meta("Publicación del día", "marketing", ["contenido"], "Redacta la publicación del día para el blog."), content: promptContent("Redacta una publicación de {{palabras}} palabras sobre {{tema}}.", "business", { palabras: "300", tema: "seguimiento a prospectos" }) });
  studio.send({ ...diego, at: ago(0, 4), type: "version.submit", assetId: asset("Publicación del día"), versionNumber: 1 });
  studio.send({ ...valeria, at: ago(0, 3), type: "version.approve", assetId: asset("Publicación del día"), versionNumber: 1 });
  studio.send({ ...diego, at: ago(0, 3), type: "test.run", assetId: asset("Publicación del día"), versionNumber: 1, inputs: { palabras: "300", tema: "seguimiento a prospectos" } });
  insights.send({ ...system, at: ago(0, 3), type: "fact.record", module: "marketing", metric: "contentPublished", value: 2 });
  insights.send({ ...system, at: ago(0, 3), type: "fact.record", module: "marketing", metric: "marketingLeads", value: 4 });
  academy.send({ ...mateo, at: ago(0, 6), type: "enroll", courseId: course(), name: "Mateo Brenes" });
  academy.send({ ...mateo, at: ago(0, 6), type: "lesson.complete", courseId: course(), lessonId: "l1" });
  academy.send({ ...mateo, at: ago(0, 6), type: "lesson.complete", courseId: course(), lessonId: "l2" });
  academy.send({ ...mateo, at: ago(0, 5), type: "exam.start", courseId: course(), examId: "e1" });
  academy.send({ ...mateo, at: ago(0, 5), type: "exam.submit", courseId: course(), examId: "e1", answers: { q1: ["b"] } });
  academy.send({ ...mateo, at: ago(0, 5), type: "certificate.claim", courseId: course() });
  academy.send({ ...mateo, at: ago(0, 4), type: "tutor.ask", courseId: course(), question: "¿Quién aprueba un pago?" });

  // ---- NEX asks KOE for the AI itself: every call goes Module -> KOE -> Optimizer -> Gateway (simulated)
  for (const [caller, purposeId, text] of [
    ["nex", "faq.answer", "¿Cuál es el horario de atención de KYNOVA?"], ["crm", "lead.analyze", "Analiza al prospecto Hotel Mar"], ["communications", "message.draft", "Redacta la respuesta de la cotización"],
    ["insights", "summary.prepare", "Resume el día de operación"], ["academy", "course.tutor", "¿Quién aprueba un pago?"],
  ] as const) ai({ ...jeffrey, at: ago(0, 2), type: "ai.request", caller, purposeId, input: { business: "KYNOVA es el sistema operativo de negocio con IA.", user: text } });

  // ---- metrics: the day's figures, a report and its approval
  phase = "metrics";
  for (const event of simulateFacts(KYNOVA_TENANT, 0.6, 33_001)) insights.send(event);
  insights.send({ ...diego, at: ago(0, 1), type: "report.draft", input: { name: "Resumen ejecutivo del día", sections: ["executive", "financial", "customers"], format: "pdf" } });
  const report = insights.box.state.reports.at(-1)?.id ?? "";
  insights.send({ ...valeria, at: ago(0, 1), type: "report.approve", reportId: report });
  insights.send({ ...valeria, at: ago(0, 1), type: "report.schedule", reportId: report, frequency: "weekly" });
  insights.send({ ...valeria, at: ago(0, 1), type: "report.share", reportId: report, recipients: ["jeffrey", "sofia"] });
  insights.send({ ...jeffrey, at: ago(0, 0), type: "report.export", reportId: report });

  // ---- tasks and the automations' own outputs
  phase = "tasks";
  automations.send({ ...jeffrey, at: ago(0, 1), type: "automation.runManual", automationId: auto("Revisión semanal"), payload: { tema: "el embudo de ventas" } });
  for (const output of automations.box.state.outputs.filter((item) => item.tenantId === KYNOVA_TENANT && item.kind === "task").slice(0, 2)) automations.send({ ...sofia, at: ago(0, 0), type: "output.resolve", outputId: output.id, resolution: "done" });

  // ======================================================================== the figures the dashboard reads
  const parts: OperationParts = { org: org.box.state, billing: billing.box.state, comms: comms.box.state, crm: crm.box.state, market: market.box.state, academy: academy.box.state, studio: studio.box.state, insights: insights.box.state, automations: automations.box.state, agent: agent.box.state };
  const executions = [...executionsFromKoe(parts.agent.koe), ...executionsFromAutomations(parts.automations, workersOf(parts.agent.koe)), ...executionsFromStudio(parts.studio, workersOf(parts.agent.koe))].filter((item) => item.tenantId === KYNOVA_TENANT);
  const operation: KynovaOperation = { parts, ai: parts.agent.ai, executions, steps, errors, aiResults, dashboard: undefined as unknown as OperatingDashboard };
  return { ...operation, dashboard: operatingDashboard(operation, KYNOVA_TENANT) };
}

/** The operating dashboard: only a READING of the records the modules already keep. It stores and decides nothing. */
export function operatingDashboard(operation: Pick<KynovaOperation, "parts" | "executions">, tenantId: string, asOf: string = OPERATION_NOW): OperatingDashboard {
  const { org, billing, comms, crm, market, academy, studio, insights, automations, agent } = operation.parts;
  const mine = <T extends { tenantId: string }>(items: readonly T[]) => items.filter((item) => item.tenantId === tenantId);
  const dayStart = Date.parse(asOf) - 12 * 3_600_000;
  const leads = mine(crm.leads);
  const tasks = mine(crm.tasks);
  const conversations = mine(comms.conversations);
  const invoices = mine(billing.invoices);
  const payments = mine(billing.payments);
  const sessions = mine(agent.sessions);
  const runs = mine(agent.koe.runs);
  const aiCalls = mine(agent.ai.gateway.calls);
  const account = mine(billing.accounts)[0];
  const automationRuns = mine(automations.runs);
  const outputsOpen = mine(automations.outputs).filter((item) => item.status === "open").length;
  const roster = rosterOf(agent.koe, studio, tenantId);
  const insight = computeInsights({ tenantId, executions: operation.executions.filter((item) => item.tenantId === tenantId), facts: mine(insights.facts), roster });
  const stagesOpen = leads.filter((item) => item.stage !== "won" && item.stage !== "lost");
    const dashboard: OperatingDashboard = {
    tenantId, asOf,
    people: { active: mine(org.users).filter((item) => item.status === "active").length, departments: mine(org.departments).length, teams: mine(org.teams).length, workers: mine(agent.koe.instances).filter((item) => item.status === "active").length },
    sales: { leadsOpen: stagesOpen.length, leadsToday: leads.filter((item) => Date.parse(item.createdAt) >= dayStart).length, leadsWon: leads.filter((item) => item.stage === "won").length, pipelineMicros: stagesOpen.reduce((total, item) => total + item.estimatedValueMicros, 0), meetings: mine(crm.meetings).length, customers: mine(crm.customers).length },
    tasks: { open: tasks.filter((item) => item.status === "accepted").length, done: tasks.filter((item) => item.status === "done").length, proposedByNex: tasks.filter((item) => item.status === "proposed").length },
    support: { open: conversations.filter((item) => item.status === "open").length, waitingForAnswer: conversations.filter((item) => item.status === "open" || item.status === "pending").length, resolved: conversations.filter((item) => item.status === "resolved").length, draftsReady: mine(comms.drafts).filter((item) => item.status === "ready").length },
    billing: { planId: account?.planId ?? "none", invoices: invoices.length, paidMicros: payments.reduce((total, item) => total + item.amountMicros, 0), creditMicros: mine(billing.credits).reduce((total, item) => total + item.amountMicros, 0), proposalsWaiting: mine(billing.proposals).filter((item) => item.status === "proposed").length },
    marketing: { assets: mine(studio.assets).length, approvedAssets: mine(studio.assets).filter((item) => item.versions.some((version) => version.state === "published")).length, contentPublished: mine(insights.facts).filter((item) => item.metric === "contentPublished").reduce((total, item) => total + item.value, 0), reportsApproved: mine(insights.reports).filter((item) => item.status === "approved").length },
    marketplace: { listingsLive: market.listings.filter((item) => item.sellerTenantId === tenantId && item.status === "published").length, sales: market.purchases.filter((item) => market.listings.find((listing) => listing.id === item.listingId)?.sellerTenantId === tenantId).length, earningsMinor: market.charges.filter((item) => item.sellerTenantId === tenantId).reduce((total, item) => total + item.sellerNet.amountMinor, 0) },
    academy: { courses: academy.courses.filter((item) => item.ownerTenantId === tenantId).length, enrollments: mine(academy.enrollments).length, certificates: mine(academy.certificates).length },
    automation: { active: mine(automations.automations).filter((item) => item.status === "active").length, runs: automationRuns.length, outputsOpen },
    ai: { workerRuns: runs.length, agentSessions: sessions.length, agentSessionsCompleted: sessions.filter((item) => item.status === "completed").length, aiCalls: aiCalls.length, aiCostMicros: aiCalls.reduce((total, item) => total + item.estimatedCostMicros, 0), approvalsWaiting: mine(agent.koe.approvals).filter((item) => item.status === "pending").length },
    insights: insight.executive,
    health: { sales: "good", support: "good", billing: "good", automation: "good", ai: "good" },
  };
  return {
    ...dashboard,
    health: {
      sales: dashboard.sales.leadsOpen > 0 && dashboard.sales.meetings > 0 ? "good" : "attention",
      support: dashboard.support.open <= dashboard.support.resolved + 2 ? "good" : "attention",
      billing: dashboard.billing.paidMicros > 0 ? "good" : "attention",
      automation: dashboard.automation.runs > 0 ? "good" : "attention",
      ai: dashboard.ai.aiCalls > 0 && dashboard.ai.agentSessionsCompleted > 0 ? "good" : "attention",
    },
  };
}
void playbookById;
