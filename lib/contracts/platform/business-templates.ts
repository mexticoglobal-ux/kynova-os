// Business Templates & Revenue Engine (Sprint 34). A template is only DATA: the roles, teams, Workers, AI agents, automations, workflows, KPIs, objectives, dashboard and plan that a kind
// of business needs on its first day. Installing one APPLIES that data through the reducers that already exist (Organization, KOE, Billing, AI Studio, Automations, Insights); there is
// no second implementation of any of them and no new module. The Revenue Engine is a pure READING of what the CRM and Insights already keep: the pipeline, the revenue, and what is
// missing to reach a company's monthly goal. Nothing here sends, charges or publishes, and nothing grants autonomy: every template installs at Level 1 (NEX prepares, people decide).
// Autonomy (Level 2) is the owner's own, later decision (ADR-0009).

import { newAcademyState } from "./academy-center";
import { playbookById } from "./agent-catalog";
import { newAgentState } from "./agent-center";
import { newAutomationState, type ActionKind, type AutomationInput, type TriggerKind } from "./automation-center";
import { PLANS } from "./billing-catalog";
import { newBillingState } from "./billing-center";
import { newCommsState } from "./comms-center";
import { newCrmState } from "./crm-center";
import { newInsightsState } from "./insights-center";
import { MODULES as ORG_MODULES, newOrgState, type Level } from "./org-center";
import { METRICS } from "./koe-ledger";
import { STARTER_WORKERS, SPECIALTIES } from "./koe-registry";
import { newMarketState } from "./marketplace-center";
import { CATEGORIES } from "./studio-center";
import { newStudioState } from "./studio-center";
import { KYNOVA_TENANT, operatingDashboard, track, type OperatingDashboard, type OperationParts, type OperationStep } from "./kynova-operation";
import { isPerson } from "./actors";
import { reduceOrg, type OrgEvent } from "./org-center";
import { reduceKoe, type KoeEvent } from "./koe-engine";
import { reduceAi, type AiEvent } from "./koe-ai-center";
import { reduceAgent } from "./agent-center";
import { reduceBilling, type BillingEvent } from "./billing-center";
import { reduceStudio, type StudioEvent } from "./studio-center";
import { reduceAutomations, type AutomationEvent } from "./automation-center";
import { reduceInsights, type InsightsEvent } from "./insights-center";
import { demoStudioEnv, promptContent } from "./studio-demo";

// ---------------------------------------------------------------- the shape of a template
export const TEMPLATE_IDS = ["marketingAgency", "realEstate", "restaurant", "clinic", "lawyer", "accountant", "construction", "ecommerce", "facelessYoutube", "consultant", "education", "generic"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** The words of the business, so the same automation reads right for a clinic ("paciente") and an agency ("cliente"). */
export type Terms = { customer: string; prospect: string; offer: string };
export type TemplateRole = { name: string; permissions: Partial<Record<(typeof ORG_MODULES)[number], Level>> };
export type TemplateTeam = { name: string; department: string; specialty: (typeof SPECIALTIES)[number]; goals: readonly string[] };
export type TemplateAgent = { name: string; worker: string; category: (typeof CATEGORIES)[number]; summary: string; prompt: string };
export type TemplateKpi = { id: string; label: string; metric: string; target: number; period: "day" | "week" | "month" };
export type TemplateObjective = { text: string; kpi: string };
export type WorkflowStep = { kind: "automation"; ref: AutomationId } | { kind: "playbook"; ref: string } | { kind: "person"; ref: string };
export type TemplateWorkflow = { id: string; name: string; steps: readonly WorkflowStep[] };
export type DashboardWidget = keyof Pick<OperatingDashboard, "sales" | "tasks" | "support" | "billing" | "marketing" | "marketplace" | "academy" | "automation" | "ai" | "insights">;
/** The Revenue Engine's inputs: what a sale is worth and what the company wants to earn each month. */
export type RevenuePlan = { averageTicketMicros: number; monthlyGoalMicros: number; closeRate: number; leadSources: readonly string[] };
/** What CRM and Communications are given: neither has a setup event, so the template supplies their first-day configuration as data the dashboard and the engine read. */
export type FrontOffice = { channels: readonly ("email" | "webchat" | "webform")[]; firstResponseMinutes: number; pipelineFocus: string };
export type BusinessTemplate = {
  id: TemplateId; name: string; sector: string; summary: string; terms: Terms;
  departments: readonly string[]; teams: readonly TemplateTeam[]; roles: readonly TemplateRole[]; workers: readonly string[];
  agents: readonly TemplateAgent[]; automations: readonly AutomationId[]; extraAutomations: readonly AutomationInput[]; workflows: readonly TemplateWorkflow[];
  kpis: readonly TemplateKpi[]; objectives: readonly TemplateObjective[]; dashboard: readonly DashboardWidget[]; revenue: RevenuePlan; frontOffice: FrontOffice;
  planId: string; aiBudgetUsd: number;
};

// ---------------------------------------------------------------- the one library of automations every template draws from
export const AUTOMATION_IDS = ["newLead", "welcomeCustomer", "paymentReceived", "webForm", "meetingPrep", "weeklyReview"] as const;
export type AutomationId = (typeof AUTOMATION_IDS)[number];
const act = (kind: ActionKind, params: Record<string, string>) => ({ kind, params });
const base = (over: Partial<AutomationInput>): AutomationInput => ({ name: "", description: "", trigger: "manual" as TriggerKind, conditions: [], actions: [], workerId: "automator", ...over });

/** The automations are written once, here; a template only chooses which it needs and in which words. */
export function automationLibrary(terms: Terms): Record<AutomationId, AutomationInput> {
  return {
    newLead: base({ name: `Nuevo ${terms.prospect}: tarea y respuesta`, description: `Cuando entra un ${terms.prospect} con buen ajuste, avisar al equipo y preparar la primera respuesta.`, trigger: "newProspect", conditions: [{ field: "puntaje", op: "greaterThan", value: "50" }],
      actions: [act("createTask", { titulo: "Contactar a {{nombre}} ({{empresa}})", enDias: "1" }), act("notifyInternal", { texto: `Nuevo ${terms.prospect}: {{nombre}}, puntaje {{puntaje}}`, para: "team" }), act("prepareEmail", { para: "{{correo}}", asunto: "Gracias por escribirnos, {{nombre}}", cuerpo: `Hola {{nombre}}, recibimos su solicitud sobre ${terms.offer} y le respondemos hoy.` })] }),
    welcomeCustomer: base({ name: `Bienvenida al ${terms.customer}`, trigger: "newClient", actions: [act("prepareEmail", { para: "{{correo}}", asunto: "Bienvenido, {{nombre}}", cuerpo: `Hola {{nombre}}, gracias por elegirnos. Estos son los siguientes pasos de ${terms.offer}.` }), act("createReminder", { texto: "Revisar el primer mes de {{nombre}}", enHoras: "720" })] }),
    paymentReceived: base({ name: "Pago recibido: conciliar", trigger: "paymentReceived", actions: [act("createTask", { titulo: "Conciliar el pago de {{cliente}}" }), act("notifyInternal", { texto: "Pago recibido de {{cliente}}: {{monto}} {{moneda}}", para: "owner" })] }),
    webForm: base({ name: "Formulario web: respuesta de precios", trigger: "formSubmitted", conditions: [{ field: "mensaje", op: "contains", value: "precio" }], actions: [act("prepareEmail", { para: "{{correo}}", asunto: "Sobre su consulta de precios", cuerpo: `Hola {{nombre}}, le compartimos los precios de ${terms.offer} en breve.` }), act("notifyInternal", { texto: "Consulta de precios de {{nombre}}", para: "team" })] }),
    meetingPrep: base({ name: "Reunión creada: preparar", trigger: "meetingCreated", actions: [act("createPendingEvent", { titulo: "Preparar: {{titulo}}", enDias: "0" })] }),
    weeklyReview: base({ name: "Revisión semanal", trigger: "manual", actions: [act("createTask", { titulo: "Revisar {{tema}}", asignado: "member" })] }),
  };
}

// ---------------------------------------------------------------- the twelve templates, as data
type Spec = Omit<BusinessTemplate, "automations" | "extraAutomations" | "workflows" | "dashboard" | "frontOffice" | "planId" | "aiBudgetUsd" | "roles" | "departments"> & Partial<Pick<BusinessTemplate, "automations" | "extraAutomations" | "workflows" | "dashboard" | "frontOffice" | "planId" | "aiBudgetUsd" | "roles" | "departments">>;
const usd = (amount: number) => amount * 1_000_000;
const SALES_WORKFLOW: TemplateWorkflow = { id: "lead-to-customer", name: "Del prospecto al cliente", steps: [{ kind: "automation", ref: "newLead" }, { kind: "playbook", ref: "sales.qualify" }, { kind: "person", ref: "Aprobar y enviar la primera respuesta" }, { kind: "automation", ref: "meetingPrep" }, { kind: "automation", ref: "welcomeCustomer" }] };
const COLLECT_WORKFLOW: TemplateWorkflow = { id: "invoice-to-cash", name: "De la factura al cobro", steps: [{ kind: "playbook", ref: "collections.reminder" }, { kind: "person", ref: "Aprobar el enlace de cobro" }, { kind: "automation", ref: "paymentReceived" }] };
const REPORT_WORKFLOW: TemplateWorkflow = { id: "weekly-report", name: "Reporte semanal", steps: [{ kind: "playbook", ref: "reporter.daily" }, { kind: "automation", ref: "weeklyReview" }] };
const kpi = (id: string, label: string, metric: string, target: number, period: TemplateKpi["period"] = "month"): TemplateKpi => ({ id, label, metric, target, period });
/** A workflow keeps only the steps the template can really run (an enabled Worker's playbook, an installed automation); a flow left with fewer than two steps is dropped. */
const fit = (flows: readonly TemplateWorkflow[], workers: readonly string[], automations: readonly AutomationId[]): TemplateWorkflow[] => flows
  .map((flow) => ({ ...flow, steps: flow.steps.filter((step) => step.kind === "person" || (step.kind === "automation" ? automations.includes(step.ref) : workers.includes(playbookById(step.ref)?.workerId ?? ""))) }))
  .filter((flow) => flow.steps.length >= 2);
const make = (spec: Spec): BusinessTemplate => finish({
  departments: ["Comercial", "Operaciones", "Administración"],
  roles: [{ name: "Coordinador", permissions: { crm: "write", communications: "write", insights: "read", workers: "read" } }],
  automations: ["newLead", "welcomeCustomer", "paymentReceived", "webForm", "meetingPrep", "weeklyReview"], extraAutomations: [], workflows: [SALES_WORKFLOW, COLLECT_WORKFLOW, REPORT_WORKFLOW],
  dashboard: ["sales", "tasks", "support", "billing", "automation", "ai", "insights"], frontOffice: { channels: ["email", "webchat", "webform"], firstResponseMinutes: 60, pipelineFocus: "prospecto → calificado → reunión → propuesta → cierre" },
  planId: "starter", aiBudgetUsd: 25, ...spec,
});
function finish(template: BusinessTemplate): BusinessTemplate { return { ...template, workflows: fit(template.workflows, template.workers, template.automations) }; }
const agent = (name: string, worker: string, category: TemplateAgent["category"], summary: string, prompt: string): TemplateAgent => ({ name, worker, category, summary, prompt });
const goalsRevenue = (ticketUsd: number, goalUsd: number, closeRate: number, leadSources: string[]): RevenuePlan => ({ averageTicketMicros: usd(ticketUsd), monthlyGoalMicros: usd(goalUsd), closeRate, leadSources });

export const BUSINESS_TEMPLATES: readonly BusinessTemplate[] = [
  make({ id: "marketingAgency", name: "Agencia de Marketing", sector: "services", summary: "Capta clientes para la agencia, da seguimiento y reporta resultados cada semana.", terms: { customer: "cliente", prospect: "prospecto", offer: "nuestros servicios de marketing" },
    teams: [{ name: "Cuentas", department: "Comercial", specialty: "sales", goals: ["Responder cada prospecto en menos de 2 horas"] }, { name: "Contenido", department: "Operaciones", specialty: "custom", goals: ["Publicar 12 contenidos al mes por cliente"] }],
    workers: ["coordinator", "sales", "followup", "reporter"], agents: [agent("Asistente comercial de agencia", "sales", "sales", "Califica prospectos y prepara la propuesta.", "Eres el asistente comercial de una agencia de marketing.\nResponde a {{nombre}} sobre {{tema}} con tono profesional.\nNo prometas resultados."), agent("Planificador de contenido", "reporter", "marketing", "Propone el calendario de contenido.", "Propone {{cantidad}} piezas de contenido para {{canal}} sobre {{tema}}.")],
    kpis: [kpi("k1", "Prospectos nuevos", "leadsNew", 40), kpi("k2", "Clientes nuevos", "customersNew", 4), kpi("k3", "Contenidos publicados", "contentPublished", 48)], objectives: [{ text: "Sumar 4 clientes nuevos este mes", kpi: "k2" }, { text: "Mantener 48 contenidos publicados", kpi: "k3" }],
    revenue: goalsRevenue(1_500, 9_000, 0.2, ["Formulario web", "Referido", "Contacto directo"]), planId: "professional" }),
  make({ id: "realEstate", name: "Bienes Raíces", sector: "realEstate", summary: "Capta interesados en propiedades, agenda visitas y da seguimiento hasta el cierre.", terms: { customer: "cliente", prospect: "interesado", offer: "nuestras propiedades" },
    teams: [{ name: "Corredores", department: "Comercial", specialty: "sales", goals: ["Agendar 15 visitas al mes"] }, { name: "Postventa", department: "Operaciones", specialty: "followup", goals: ["Llamar a cada cliente tras la firma"] }],
    workers: ["coordinator", "sales", "followup", "collections"], agents: [agent("Asistente de propiedades", "sales", "sales", "Responde consultas y califica interesados.", "Eres el asistente de una inmobiliaria.\nResponde a {{nombre}} sobre {{tema}} y pregunta por presupuesto y zona.\nNo confirmes precios finales."), agent("Seguimiento de visitas", "followup", "sales", "Prepara el seguimiento después de cada visita.", "Redacta un mensaje de seguimiento para {{nombre}} tras visitar {{propiedad}}.")],
    kpis: [kpi("k1", "Interesados nuevos", "leadsNew", 60), kpi("k2", "Propuestas enviadas", "proposalsSent", 12), kpi("k3", "Cierres", "leadsConverted", 3)], objectives: [{ text: "Cerrar 3 ventas este mes", kpi: "k3" }, { text: "Enviar 12 propuestas", kpi: "k2" }],
    revenue: goalsRevenue(6_000, 18_000, 0.05, ["Portal inmobiliario", "Referido", "Formulario web"]), planId: "professional" }),
  make({ id: "restaurant", name: "Restaurante", sector: "hospitality", summary: "Atiende reservas y consultas, fideliza clientes y controla cobros de eventos.", terms: { customer: "cliente", prospect: "consulta", offer: "nuestro restaurante" },
    teams: [{ name: "Salón y reservas", department: "Operaciones", specialty: "support", goals: ["Confirmar cada reserva el mismo día"] }, { name: "Eventos", department: "Comercial", specialty: "sales", goals: ["Cerrar 4 eventos privados al mes"] }],
    workers: ["coordinator", "followup", "reporter"], agents: [agent("Asistente de reservas", "followup", "support", "Responde preguntas de horario y reservas.", "Eres el asistente de un restaurante.\nResponde a {{nombre}} sobre {{tema}} con amabilidad.\nPide siempre fecha, hora y número de personas."), agent("Reporte de ventas del día", "reporter", "analysis", "Resume el día del restaurante.", "Resume el día {{fecha}} del restaurante en cinco puntos.")],
    kpis: [kpi("k1", "Consultas nuevas", "leadsNew", 120), kpi("k2", "Clientes nuevos", "customersNew", 60), kpi("k3", "Pagos registrados", "paymentsCount", 200)], objectives: [{ text: "Subir a 60 clientes nuevos al mes", kpi: "k2" }],
    revenue: goalsRevenue(45, 12_000, 0.25, ["Chat web", "Formulario web"]), automations: ["newLead", "welcomeCustomer", "paymentReceived", "webForm", "weeklyReview"], workflows: [SALES_WORKFLOW, REPORT_WORKFLOW] }),
  make({ id: "clinic", name: "Clínica", sector: "health", summary: "Atiende pacientes, recuerda citas y mantiene el contacto sin tocar datos clínicos.", terms: { customer: "paciente", prospect: "consulta", offer: "nuestros servicios de salud" },
    teams: [{ name: "Recepción", department: "Operaciones", specialty: "support", goals: ["Confirmar todas las citas"] }, { name: "Admisión", department: "Comercial", specialty: "sales", goals: ["Responder cada consulta en menos de 1 hora"] }],
    workers: ["coordinator", "followup", "reporter"], agents: [agent("Asistente de citas", "followup", "support", "Responde dudas y prepara recordatorios de cita.", "Eres el asistente de una clínica.\nResponde a {{nombre}} sobre {{tema}} con calidez.\nNo des consejos médicos: deriva a una persona."), agent("Seguimiento de pacientes", "followup", "support", "Prepara el seguimiento posterior a la consulta.", "Redacta un recordatorio para {{nombre}} de su cita del {{fecha}}.")],
    kpis: [kpi("k1", "Consultas nuevas", "leadsNew", 80), kpi("k2", "Pacientes nuevos", "customersNew", 30), kpi("k3", "Pacientes activos", "customersActive", 400, "month")], objectives: [{ text: "Llegar a 30 pacientes nuevos", kpi: "k2" }],
    revenue: goalsRevenue(80, 8_000, 0.3, ["Formulario web", "Referido", "Chat web"]), aiBudgetUsd: 30 }),
  make({ id: "lawyer", name: "Abogado", sector: "legal", summary: "Recibe consultas, agenda reuniones y controla honorarios, con revisión humana de todo.", terms: { customer: "cliente", prospect: "consulta", offer: "nuestros servicios legales" },
    teams: [{ name: "Casos", department: "Operaciones", specialty: "followup", goals: ["Actualizar a cada cliente cada semana"] }, { name: "Captación", department: "Comercial", specialty: "sales", goals: ["Agendar 20 primeras reuniones al mes"] }],
    workers: ["coordinator", "sales", "collections"], agents: [agent("Asistente de captación legal", "sales", "sales", "Califica consultas y propone la primera reunión.", "Eres el asistente de un despacho jurídico.\nResponde a {{nombre}} sobre {{tema}} sin dar opinión legal.\nPropón una reunión con el abogado."), agent("Cobro de honorarios", "collections", "operations", "Prepara recordatorios de honorarios.", "Redacta un recordatorio cordial a {{cliente}} por {{monto}}.")],
    kpis: [kpi("k1", "Consultas nuevas", "leadsNew", 40), kpi("k2", "Casos nuevos", "leadsConverted", 8), kpi("k3", "Honorarios cobrados", "paymentsValue", usd(12_000))], objectives: [{ text: "Abrir 8 casos nuevos", kpi: "k2" }],
    revenue: goalsRevenue(1_800, 14_400, 0.2, ["Referido", "Formulario web"]) }),
  make({ id: "accountant", name: "Contador", sector: "finance", summary: "Capta empresas, recuerda obligaciones y ordena los cobros mensuales.", terms: { customer: "cliente", prospect: "prospecto", offer: "nuestros servicios contables" },
    teams: [{ name: "Cartera de clientes", department: "Operaciones", specialty: "followup", goals: ["Recordar cada vencimiento con 5 días"] }, { name: "Cobros", department: "Administración", specialty: "collections", goals: ["Cobrar el 95 % a tiempo"] }],
    workers: ["coordinator", "followup", "collections", "reporter"], agents: [agent("Recordatorio de vencimientos", "followup", "operations", "Prepara avisos de obligaciones.", "Redacta un aviso para {{nombre}} sobre {{tema}} que vence el {{fecha}}."), agent("Cobro mensual", "collections", "operations", "Prepara el recordatorio de la mensualidad.", "Redacta un recordatorio cordial a {{cliente}} por {{monto}}.")],
    kpis: [kpi("k1", "Clientes activos", "customersActive", 60, "month"), kpi("k2", "Pagos registrados", "paymentsCount", 55), kpi("k3", "Cobrado", "paymentsValue", usd(9_000))], objectives: [{ text: "Cobrar el 95 % a tiempo", kpi: "k3" }],
    revenue: goalsRevenue(150, 9_000, 0.25, ["Referido", "Formulario web"]) }),
  make({ id: "construction", name: "Constructora", sector: "construction", summary: "Gestiona licitaciones y cotizaciones, y controla anticipos y pagos de obra.", terms: { customer: "cliente", prospect: "solicitud de cotización", offer: "nuestros proyectos de construcción" },
    teams: [{ name: "Cotizaciones", department: "Comercial", specialty: "sales", goals: ["Entregar cada cotización en 3 días"] }, { name: "Obra", department: "Operaciones", specialty: "followup", goals: ["Informar avances cada semana"] }],
    workers: ["coordinator", "sales", "collections", "reporter"], agents: [agent("Asistente de cotizaciones", "sales", "sales", "Recoge requisitos y prepara la cotización.", "Eres el asistente de una constructora.\nResponde a {{nombre}} sobre {{tema}} y pide medidas, ubicación y plazo.\nNo des precios finales."), agent("Avance de obra", "reporter", "operations", "Resume el avance semanal de cada obra.", "Resume el avance de la obra {{obra}} esta semana.")],
    kpis: [kpi("k1", "Solicitudes nuevas", "leadsNew", 25), kpi("k2", "Cotizaciones enviadas", "proposalsSent", 15), kpi("k3", "Contratos", "leadsConverted", 3)], objectives: [{ text: "Firmar 3 contratos", kpi: "k3" }],
    revenue: goalsRevenue(30_000, 90_000, 0.2, ["Licitación", "Referido", "Formulario web"]), planId: "professional" }),
  make({ id: "ecommerce", name: "E-commerce", sector: "retail", summary: "Atiende clientes de la tienda, recupera interesados y reporta ventas.", terms: { customer: "cliente", prospect: "consulta", offer: "nuestra tienda" },
    teams: [{ name: "Atención", department: "Operaciones", specialty: "support", goals: ["Responder en menos de 1 hora"] }, { name: "Crecimiento", department: "Comercial", specialty: "sales", goals: ["Recuperar el 10 % de los interesados"] }],
    workers: ["coordinator", "sales", "followup", "reporter"], agents: [agent("Asistente de tienda", "sales", "sales", "Responde dudas de producto y envíos.", "Eres el asistente de una tienda en línea.\nResponde a {{nombre}} sobre {{tema}} y sugiere productos relacionados."), agent("Recuperación de interesados", "followup", "marketing", "Prepara mensajes para quien no terminó su compra.", "Redacta un mensaje para {{nombre}} que dejó {{producto}} sin comprar.")],
    kpis: [kpi("k1", "Consultas nuevas", "leadsNew", 300), kpi("k2", "Clientes nuevos", "customersNew", 120), kpi("k3", "Ventas registradas", "paymentsCount", 400), kpi("k4", "Ingresos", "paymentsValue", usd(20_000))], objectives: [{ text: "Llegar a 20 000 USD de ventas", kpi: "k4" }],
    revenue: goalsRevenue(55, 20_000, 0.08, ["Chat web", "Formulario web", "Referido"]) }),
  make({ id: "facelessYoutube", name: "YouTube Faceless", sector: "creator", summary: "Planifica videos sin rostro, mide el alcance y cierra patrocinios.", terms: { customer: "patrocinador", prospect: "marca interesada", offer: "patrocinios en nuestro canal" },
    teams: [{ name: "Producción", department: "Producción", specialty: "custom", goals: ["Publicar 8 videos al mes"] }, { name: "Patrocinios", department: "Patrocinios", specialty: "sales", goals: ["Cerrar 2 patrocinios al mes"] }],
    workers: ["coordinator", "reporter", "sales"], agents: [agent("Planificador de videos", "reporter", "marketing", "Propone temas y guiones.", "Propone {{cantidad}} ideas de video sobre {{tema}} con un gancho de 10 segundos."), agent("Asistente de patrocinios", "sales", "sales", "Responde a marcas interesadas.", "Responde a {{nombre}} sobre {{tema}} con el media kit del canal. No prometas fechas.")],
    kpis: [kpi("k1", "Videos publicados", "contentPublished", 8), kpi("k2", "Visitas orgánicas", "organicVisits", 50_000), kpi("k3", "Patrocinios cerrados", "leadsConverted", 2)], objectives: [{ text: "Publicar 8 videos", kpi: "k1" }, { text: "Cerrar 2 patrocinios", kpi: "k3" }],
    revenue: goalsRevenue(1_200, 2_400, 0.25, ["Formulario web", "Correo directo"]), departments: ["Producción", "Patrocinios", "Administración"],
    automations: ["newLead", "paymentReceived", "webForm", "weeklyReview"], workflows: [SALES_WORKFLOW, REPORT_WORKFLOW] }),
  make({ id: "consultant", name: "Consultor", sector: "services", summary: "Capta clientes de consultoría, agenda diagnósticos y da seguimiento a cada propuesta.", terms: { customer: "cliente", prospect: "prospecto", offer: "nuestra consultoría" },
    teams: [{ name: "Consultoría", department: "Operaciones", specialty: "followup", goals: ["Entregar cada diagnóstico en 5 días"] }, { name: "Desarrollo de negocio", department: "Comercial", specialty: "sales", goals: ["Agendar 12 diagnósticos al mes"] }],
    workers: ["coordinator", "sales", "followup"], agents: [agent("Asistente de diagnóstico", "sales", "sales", "Califica prospectos y propone un diagnóstico.", "Eres el asistente de un consultor.\nResponde a {{nombre}} sobre {{tema}} y propón un diagnóstico inicial."), agent("Seguimiento de propuestas", "followup", "sales", "Prepara el seguimiento tras enviar una propuesta.", "Redacta un seguimiento para {{nombre}} sobre la propuesta {{tema}}.")],
    kpis: [kpi("k1", "Prospectos nuevos", "leadsNew", 30), kpi("k2", "Propuestas enviadas", "proposalsSent", 10), kpi("k3", "Clientes nuevos", "customersNew", 3)], objectives: [{ text: "Ganar 3 clientes de consultoría", kpi: "k3" }],
    revenue: goalsRevenue(3_000, 9_000, 0.25, ["Referido", "Formulario web", "Contacto directo"]) }),
  make({ id: "education", name: "Educación", sector: "education", summary: "Capta alumnos, publica cursos y sigue el avance de cada estudiante.", terms: { customer: "alumno", prospect: "interesado", offer: "nuestros cursos" },
    teams: [{ name: "Admisiones", department: "Comercial", specialty: "sales", goals: ["Responder cada interesado en 2 horas"] }, { name: "Docencia", department: "Docencia", specialty: "education", goals: ["Subir 10 lecciones al mes"] }],
    workers: ["coordinator", "sales", "tutor", "reporter"], agents: [agent("Asistente de admisiones", "sales", "sales", "Responde dudas de cursos y matrícula.", "Eres el asistente de una academia.\nResponde a {{nombre}} sobre {{tema}} e invita a la próxima clase."), agent("Tutor de curso", "tutor", "education", "Responde dudas del material del curso.", "Responde la duda de {{nombre}} sobre {{tema}} usando solo el material del curso.")],
    kpis: [kpi("k1", "Interesados nuevos", "leadsNew", 100), kpi("k2", "Lecciones completadas", "lessonsCompleted", 500), kpi("k3", "Certificados emitidos", "certificatesIssued", 20)], objectives: [{ text: "Emitir 20 certificados", kpi: "k3" }],
    revenue: goalsRevenue(200, 8_000, 0.15, ["Formulario web", "Chat web", "Referido"]), departments: ["Comercial", "Docencia", "Administración"] }),
  make({ id: "generic", name: "Empresa Genérica", sector: "general", summary: "Una base sencilla para cualquier negocio: prospectos, clientes, cobros y reportes.", terms: { customer: "cliente", prospect: "prospecto", offer: "nuestros productos y servicios" },
    teams: [{ name: "Ventas", department: "Comercial", specialty: "sales", goals: ["Responder cada prospecto en menos de 2 horas"] }, { name: "Atención", department: "Operaciones", specialty: "support", goals: ["Primera respuesta en menos de 1 hora"] }],
    workers: ["coordinator", "sales", "followup", "reporter"], agents: [agent("Asistente comercial", "sales", "sales", "Califica prospectos y prepara respuestas.", "Eres el asistente comercial de la empresa.\nResponde a {{nombre}} sobre {{tema}} con un tono cercano.\nNo prometas precios."), agent("Resumen del negocio", "reporter", "analysis", "Resume el estado del negocio.", "Resume el estado del negocio sobre {{tema}} en cinco puntos.")],
    kpis: [kpi("k1", "Prospectos nuevos", "leadsNew", 30), kpi("k2", "Clientes nuevos", "customersNew", 5), kpi("k3", "Tareas completadas", "tasksCompleted", 60)], objectives: [{ text: "Conseguir 5 clientes nuevos", kpi: "k2" }],
    revenue: goalsRevenue(500, 2_500, 0.2, ["Formulario web", "Referido"]) }),
];
export const templateById = (id: string): BusinessTemplate | undefined => BUSINESS_TEMPLATES.find((item) => item.id === id);

// ---------------------------------------------------------------- the template is checked against the platform's own catalogs
/** Every reference a template makes must exist in the platform. Returns the problems (empty when valid). */
export function validateTemplate(template: BusinessTemplate): string[] {
  const issues: string[] = [];
  const workerIds = STARTER_WORKERS.map((item) => item.id);
  const kpiIds = template.kpis.map((item) => item.id);
  for (const worker of template.workers) if (!workerIds.includes(worker)) issues.push(`worker:${worker}`);
  for (const item of template.agents) { if (!template.workers.includes(item.worker)) issues.push(`agentWorker:${item.name}`); if (!(CATEGORIES as readonly string[]).includes(item.category)) issues.push(`category:${item.name}`); }
  for (const team of template.teams) { if (!template.departments.includes(team.department)) issues.push(`department:${team.name}`); if (!(SPECIALTIES as readonly string[]).includes(team.specialty)) issues.push(`specialty:${team.name}`); }
  for (const item of template.kpis) if (!METRICS.some((metric) => metric.id === item.metric)) issues.push(`metric:${item.id}`);
  for (const item of template.objectives) if (!kpiIds.includes(item.kpi)) issues.push(`objective:${item.text}`);
  for (const id of template.automations) if (!(AUTOMATION_IDS as readonly string[]).includes(id)) issues.push(`automation:${id}`);
  for (const flow of template.workflows) for (const step of flow.steps) {
    if (step.kind === "automation" && !template.automations.includes(step.ref)) issues.push(`workflowAutomation:${flow.id}:${step.ref}`);
    if (step.kind === "playbook") { const playbook = playbookById(step.ref); if (!playbook || !template.workers.includes(playbook.workerId)) issues.push(`workflowPlaybook:${flow.id}:${step.ref}`); }
  }
  for (const role of template.roles) for (const key of Object.keys(role.permissions)) if (!(ORG_MODULES as readonly string[]).includes(key)) issues.push(`role:${role.name}:${key}`);
  if (!PLANS.some((plan) => plan.id === template.planId)) issues.push(`plan:${template.planId}`);
  if (template.revenue.monthlyGoalMicros <= 0 || template.revenue.averageTicketMicros <= 0 || template.revenue.closeRate <= 0 || template.revenue.closeRate > 1) issues.push("revenue");
  if (template.dashboard.length === 0) issues.push("dashboard");
  return issues;
}

// ---------------------------------------------------------------- installing: the template's data goes through the existing reducers
export type InstallInput = { templateId: string; tenantId: string; companyName: string; owner: { id: string; name: string; email: string }; at: string };
export type Installation = { template: BusinessTemplate; tenantId: string; parts: OperationParts; steps: readonly OperationStep[]; errors: string[]; kpis: readonly KpiReading[]; objectives: readonly TemplateObjective[]; dashboard: OperatingDashboard };
export const emptyParts = (): OperationParts => ({ org: newOrgState(), billing: newBillingState(), comms: newCommsState(), crm: newCrmState(), market: newMarketState([]), academy: newAcademyState([]), studio: newStudioState(), insights: newInsightsState(), automations: newAutomationState(), agent: newAgentState([]) });

/** Installs a template. `base` lets several companies share one set of records (each stays isolated by its tenant); the same company cannot be installed twice. */
export function installBusinessTemplate(input: InstallInput, base: OperationParts = emptyParts()): Installation | { errors: string[] } {
  const template = templateById(input.templateId);
  if (!template) return { errors: [`La plantilla «${input.templateId}» no existe.`] };
  const problems = validateTemplate(template);
  if (problems.length) return { errors: problems.map((item) => `plantilla inválida: ${item}`) };
  if (!isPerson(input.owner.id)) return { errors: ["El propietario debe ser una persona."] };

  const steps: OperationStep[] = [];
  const errors: string[] = [];
  const phase = () => "install";
  const clock = () => input.at;
  const { tenantId, at } = input;
  const owner = { tenantId, actor: input.owner.id };
  const system = { tenantId, actor: "system" };

  const org = track("org", base.org, (state, event: OrgEvent) => reduceOrg(state, event), steps, errors, phase, clock);
  const koeAi = track("koe", base.agent, (state, event: ({ kind: "koe" } & KoeEvent) | ({ kind: "ai" } & AiEvent)) => {
    if (event.kind === "koe") { const result = reduceKoe(state.koe, event); return { state: { ...state, koe: result.state }, ...(result.error ? { error: result.error } : {}) }; }
    const result = reduceAi(state.ai, event);
    return { state: { ...state, ai: result.state }, ...(result.error ? { error: result.error } : {}) };
  }, steps, errors, phase, clock);
  void reduceAgent;
  const billing = track("billing", base.billing, (state, event: BillingEvent) => reduceBilling(state, event), steps, errors, phase, clock);
  const studio = track("studio", base.studio, (state, event: StudioEvent) => reduceStudio(state, event, { ...demoStudioEnv(), refs: { automations: automations.box.state.automations.map((item) => ({ id: item.id, tenantId: item.tenantId, name: item.name })), courses: [] } }), steps, errors, phase, clock);
  const automations = track("automations", base.automations, (state, event: AutomationEvent) => reduceAutomations(state, event), steps, errors, phase, clock);
  const insights = track("insights", base.insights, (state, event: InsightsEvent) => reduceInsights(state, event), steps, errors, phase, clock);

  // 1. Organization: the company, its departments, roles and teams
  org.send({ ...system, at, type: "org.create", name: input.companyName, ownerId: input.owner.id, ownerName: input.owner.name, ownerEmail: input.owner.email });
  org.send({ ...owner, at, type: "branch.create", name: "Sede principal", city: "—" });
  const branch = org.box.state.branches.find((item) => item.tenantId === tenantId)?.id ?? "";
  for (const name of template.departments) org.send({ ...owner, at, type: "department.create", branchId: branch, name });
  for (const role of template.roles) org.send({ ...owner, at, type: "role.create", name: role.name, permissions: role.permissions });
  const dept = (name: string) => org.box.state.departments.find((item) => item.tenantId === tenantId && item.name === name)?.id ?? "";
  for (const team of template.teams) org.send({ ...owner, at, type: "team.create", departmentId: dept(team.department), name: team.name, specialty: team.specialty, goals: team.goals });
  // 2. Workers (KOE): enabled for the company, assigned to the team of their specialty; NO authorization is granted: autonomy is the owner's later decision
  for (const worker of template.workers) koeAi.send({ kind: "koe", ...owner, at, type: "worker.enable", definitionId: worker });
  for (const worker of template.workers) {
    const specialty = STARTER_WORKERS.find((item) => item.id === worker)?.specialty;
    const team = template.teams.find((item) => item.specialty === specialty) ?? template.teams[0];
    const teamId = org.box.state.teams.find((item) => item.tenantId === tenantId && item.name === team?.name)?.id;
    if (teamId) org.send({ ...owner, at, type: "membership.assign", subject: { kind: "worker", id: worker }, teamId });
  }
  // 3. NEX's AI: the policy and the budget of the company
  koeAi.send({ kind: "ai", ...owner, at, type: "ai.configure", policy: "balanced", budgetMicros: usd(template.aiBudgetUsd) });
  // 4. Billing: the recommended plan
  billing.send({ ...system, at, type: "account.create", ownerId: input.owner.id, planId: template.planId });
  // 5. AI Studio: the recommended agents (prompt + agent), sent to review; a second person publishes them
  const tag = template.id.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
  const assetId = (name: string) => studio.box.state.assets.find((item) => item.tenantId === tenantId && item.name === name)?.id ?? "";
  for (const item of template.agents) {
    studio.send({ ...owner, at, type: "asset.create", kind: "prompt", meta: { name: `${item.name} (instrucciones)`, description: item.summary, category: item.category, tags: [tag] }, content: promptContent(item.prompt) });
    studio.send({ ...owner, at, type: "version.submit", assetId: assetId(`${item.name} (instrucciones)`), versionNumber: 1 });
    studio.send({ ...owner, at, type: "asset.create", kind: "agent", meta: { name: item.name, description: item.summary, category: item.category, tags: [tag, `worker-${item.worker}`] }, content: {
      kind: "agent", promptId: assetId(`${item.name} (instrucciones)`), workerIds: [], automationIds: [], courseIds: [], clearance: "business", memory: { mode: "session", maxEntries: 20, maxChars: 2_000 },
      personality: { tone: "friendly", language: "es", style: "Breve y claro" }, limits: { maxRunsPerDay: 50, maxStepsPerRun: 10, maxCostMicrosPerRun: 20_000 } } });
    studio.send({ ...owner, at, type: "version.submit", assetId: assetId(item.name), versionNumber: 1 });
  }
  // 6. Automations: written once in the library, in the words of the business; active from the first day (they only PREPARE: a person approves what is sent)
  const library = automationLibrary(template.terms);
  const inputs = [...template.automations.map((id) => library[id]), ...template.extraAutomations];
  for (const automation of inputs) automations.send({ ...owner, at, type: "automation.create", input: automation });
  for (const automation of inputs) {
    const id = automations.box.state.automations.find((item) => item.tenantId === tenantId && item.name === automation.name)?.id ?? "";
    automations.send({ ...owner, at, type: "automation.activate", automationId: id });
    automations.send({ ...owner, at, type: "automation.setTestMode", automationId: id, testMode: false });
  }
  // 7. Insights: the executive report, as a draft for the owner to approve
  insights.send({ ...owner, at, type: "report.draft", input: { name: "Resumen ejecutivo", sections: ["executive", "financial", "customers"], format: "pdf" } });

  const parts: OperationParts = { ...base, org: org.box.state, agent: koeAi.box.state, billing: billing.box.state, studio: studio.box.state, automations: automations.box.state, insights: insights.box.state };
  const installation: Installation = { template, tenantId, parts, steps, errors, kpis: [], objectives: template.objectives, dashboard: undefined as unknown as OperatingDashboard };
  return { ...installation, kpis: readKpis(template, parts, tenantId), dashboard: operatingDashboard({ parts, executions: [] }, tenantId, at) };
}
void KYNOVA_TENANT;

// ---------------------------------------------------------------- KPIs and the Revenue Engine: pure readings
export type KpiReading = { id: string; label: string; metric: string; period: TemplateKpi["period"]; target: number; value: number; progress: number };
/** A KPI's value is the sum of the facts of its metric that Insights holds for the company; its progress is capped at 100 %. */
export function readKpis(template: BusinessTemplate, parts: OperationParts, tenantId: string): KpiReading[] {
  return template.kpis.map((item) => {
    const value = parts.insights.facts.filter((fact) => fact.tenantId === tenantId && fact.metric === item.metric).reduce((total, fact) => total + fact.value, 0);
    return { id: item.id, label: item.label, metric: item.metric, period: item.period, target: item.target, value, progress: Math.min(100, Math.round((value / item.target) * 100)) };
  });
}

export type RevenueReading = {
  goalMicros: number; wonMicros: number; pipelineMicros: number; expectedMicros: number; gapMicros: number; salesNeeded: number; leadsNeeded: number; leadsInPipeline: number; onTrack: boolean; sources: readonly string[];
};
/** What is missing to reach the monthly goal: won revenue (Insights), the open pipeline weighted by the close rate (CRM), and the leads still needed. Reads only; decides nothing. */
export function revenueEngine(template: BusinessTemplate, parts: OperationParts, tenantId: string): RevenueReading {
  const { averageTicketMicros, monthlyGoalMicros, closeRate, leadSources } = template.revenue;
  const open = parts.crm.leads.filter((item) => item.tenantId === tenantId && item.stage !== "won" && item.stage !== "lost");
  const wonMicros = parts.insights.facts.filter((fact) => fact.tenantId === tenantId && (fact.metric === "attributedRevenue" || fact.metric === "paymentsValue")).reduce((total, fact) => total + fact.value, 0)
    + parts.crm.leads.filter((item) => item.tenantId === tenantId && item.stage === "won").reduce((total, item) => total + item.estimatedValueMicros, 0);
  const pipelineMicros = open.reduce((total, item) => total + item.estimatedValueMicros, 0);
  const expectedMicros = Math.round(pipelineMicros * closeRate);
  const gapMicros = Math.max(0, monthlyGoalMicros - wonMicros - expectedMicros);
  const salesNeeded = Math.ceil(gapMicros / averageTicketMicros);
  return { goalMicros: monthlyGoalMicros, wonMicros, pipelineMicros, expectedMicros, gapMicros, salesNeeded, leadsNeeded: Math.ceil(salesNeeded / closeRate), leadsInPipeline: open.length, onTrack: gapMicros === 0, sources: leadSources };
}
