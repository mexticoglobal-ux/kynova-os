// KYNOVA Internal Beta (Sprint 38). KYNOVA as the official administrator of the first businesses: Nova Marketing Studio, PSI Sostenible, Real Estate and YouTube Studio. This file only SCRIPTS four
// companies and their first working use cases; every step goes through the reducers that already exist (the AI Business Architect and the Business Templates to create each company, then Organization,
// CRM, Communications, Billing, KOE Workers, the Agent Runtime, AI Studio, Automations and Insights). It adds no module, no rule and no capability, and it touches nothing of KOE, NEX, the AI Gateway,
// the Runtime, the Backend Core or the Financial Router.
//
// IMPORTANT: this is a BETA SET-UP with SAMPLE records. The four companies are real businesses, but every person, prospect, property, product and figure here is invented, because real customers' data
// stays blocked until the gates of ADR-0006 are met (see REAL_DATA_GATES). Nothing is sent, charged or published; WhatsApp, Stripe, MakaPay and the social networks are not connected: a "social" lead
// is only a source label a person types in.

import { applyArchitectEvents, newArchitectState, nextQuestion, reduceArchitect, type Answers, type ArchitectEvent, type ArchitectState } from "./business-architect";
import { emptyParts, readKpis, revenueEngine, templateById, type KpiReading, type RevenueReading, type BusinessTemplate } from "./business-templates";
import { reduceAgent, type AgentEvent } from "./agent-center";
import { reduceAutomations, type AutomationEvent } from "./automation-center";
import { blankInput, action } from "./automation-demo";
import { reduceBilling, type BillingEvent } from "./billing-center";
import { reduceComms, type CommsEnv, type CommsEvent } from "./comms-center";
import { reduceCrm, type CrmEvent, type LeadInput } from "./crm-center";
import { HOT_ANSWERS } from "./crm-demo";
import { reduceInsights, type InsightsEvent } from "./insights-center";
import { DEFAULT_KOE_ENV } from "./automation-koe";
import { operatingDashboard, type OperatingDashboard, type OperationParts, type OperationStep } from "./kynova-operation";
import { reduceOrg, type OrgEvent } from "./org-center";
import { reduceStudio, type StudioEvent } from "./studio-center";
import { demoStudioEnv, promptContent } from "./studio-demo";
import { PLANS } from "./billing-catalog";

export const BETA_NOW = "2026-11-12T12:00:00.000Z";
const ago = (days: number, hours = 0) => new Date(Date.parse(BETA_NOW) - days * 86_400_000 - hours * 3_600_000).toISOString();
const later = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();
const usd = (amount: number) => amount * 1_000_000;

/** The gates that keep real customers' data out (ADR-0006). All four are open: this beta holds no real data until they are met and production is approved. */
export const REAL_DATA_GATES = [
  { id: "auth", label: "Autenticación verificada de punta a punta", met: false },
  { id: "isolation", label: "Aislamiento por empresa probado en la base real", met: false },
  { id: "export", label: "Exportación de los datos de cada empresa", met: false },
  { id: "delete", label: "Borrado de los datos de cada empresa", met: false },
] as const;

export type BetaTenantSpec = {
  id: string; name: string; slug: string; expectedTemplate: string; owner: { id: string; name: string; email: string }; answers: Answers; useCases: readonly string[];
};
export const BETA_TENANTS: readonly BetaTenantSpec[] = [
  { id: "tenant-nova-marketing-studio", name: "Nova Marketing Studio", slug: "nova", expectedTemplate: "marketingAgency", owner: { id: "nova-owner", name: "Propietaria de Nova", email: "owner@nova.test" },
    answers: { businessName: "Nova Marketing Studio", description: "agencia de marketing digital: SEO, campañas y redes sociales", teamSize: "small", monthlyLeads: "from10to50", channels: ["email", "webchat", "webform"], goal: "moreSales", aiAppetite: "balanced" },
    useCases: ["Captación de clientes", "Seguimiento", "SEO", "Campañas", "Redes Sociales"] },
  { id: "tenant-psi-sostenible", name: "PSI Sostenible", slug: "psi", expectedTemplate: "generic", owner: { id: "psi-owner", name: "Propietario de PSI", email: "owner@psi.test" },
    answers: { businessName: "PSI Sostenible", description: "productos sostenibles para empresas y distribuidores", sector: "other", teamSize: "small", monthlyLeads: "from10to50", channels: ["email", "webform"], goal: "moreSales", aiAppetite: "balanced" },
    useCases: ["Prospectos B2B", "Seguimiento comercial", "Cotizaciones", "Productos", "Distribuidores"] },
  { id: "tenant-real-estate", name: "Real Estate", slug: "re", expectedTemplate: "realEstate", owner: { id: "re-owner", name: "Propietaria de Real Estate", email: "owner@realestate.test" },
    answers: { businessName: "Real Estate", description: "inmobiliaria con propiedades en venta y alquiler", teamSize: "small", monthlyLeads: "from50to200", channels: ["email", "webchat", "webform"], goal: "moreSales", aiAppetite: "balanced" },
    useCases: ["Propiedades", "Leads", "Seguimiento", "Agenda", "Cierre"] },
  { id: "tenant-youtube-studio", name: "YouTube Studio", slug: "yt", expectedTemplate: "facelessYoutube", owner: { id: "yt-owner", name: "Propietario de YouTube Studio", email: "owner@youtube.test" },
    answers: { businessName: "YouTube Studio", description: "canal de YouTube con videos sin rostro", teamSize: "solo", monthlyLeads: "under10", channels: ["email", "webform"], goal: "understandData", aiAppetite: "cautious" },
    useCases: ["Producción", "Calendario", "Guiones", "Miniaturas", "Publicaciones", "Analíticas"] },
];

export type BetaTenantResult = {
  spec: BetaTenantSpec; template: BusinessTemplate; planId: string; questionsAnswered: number; installedSteps: number; dashboard: OperatingDashboard; kpis: readonly KpiReading[]; revenue: RevenueReading; useCaseEvidence: Readonly<Record<string, string>>;
};
export type PortfolioRow = { tenantId: string; name: string; template: string; plan: string; monthlyMicros: number; leadsOpen: number; pipelineMicros: number; customers: number; conversationsOpen: number; automationRuns: number; agentSessions: number; tasksDone: number; health: OperatingDashboard["health"] };
export type InternalBeta = { parts: OperationParts; architect: ArchitectState; tenants: readonly BetaTenantResult[]; steps: readonly OperationStep[]; errors: string[]; portfolio: readonly PortfolioRow[]; mrrMicros: number };

export function runInternalBeta(): InternalBeta {
  const steps: OperationStep[] = [];
  const errors: string[] = [];
  let parts: OperationParts = emptyParts();
  let architect = newArchitectState();
  let phase = "architect";
  const note = (module: string, event: string, error?: string, when = BETA_NOW) => { steps.push({ phase, module, event, ok: !error, at: when }); if (error) errors.push(`${module} · ${event}: ${error}`); };

  // each module goes through ITS OWN reducer, on the shared records; one failed step is an error here, never a silent skip
  const org = (event: OrgEvent) => { const r = reduceOrg(parts.org, event); note("org", event.type, r.error, event.at); parts = { ...parts, org: r.state }; };
  const crm = (event: CrmEvent) => { const r = reduceCrm(parts.crm, event); note("crm", event.type, r.error, event.at); parts = { ...parts, crm: r.state }; };
  const commsEnv = (): CommsEnv => ({ ...DEFAULT_KOE_ENV, refs: { leads: parts.crm.leads.map((item) => ({ id: item.id, tenantId: item.tenantId })), customers: parts.crm.customers.map((item) => ({ id: item.id, tenantId: item.tenantId })) }, crm: parts.crm });
  const comms = (event: CommsEvent) => { const r = reduceComms(parts.comms, event, commsEnv()); note("communications", event.type, r.error, event.at); parts = { ...parts, comms: r.state }; };
  const billing = (event: BillingEvent) => { const r = reduceBilling(parts.billing, event); note("billing", event.type, r.error, event.at); parts = { ...parts, billing: r.state }; };
  const automations = (event: AutomationEvent) => { const r = reduceAutomations(parts.automations, event); note("automations", event.type, r.error, event.at); parts = { ...parts, automations: r.state }; };
  const insights = (event: InsightsEvent) => { const r = reduceInsights(parts.insights, event); note("insights", event.type, r.error, event.at); parts = { ...parts, insights: r.state }; };
  const studio = (event: StudioEvent) => {
    const env = { ...demoStudioEnv(), refs: { automations: parts.automations.automations.map((item) => ({ id: item.id, tenantId: item.tenantId, name: item.name })), courses: [] } };
    const r = reduceStudio(parts.studio, event, env); note("studio", event.type, r.error, event.at); parts = { ...parts, studio: r.state };
  };
  const agent = (event: AgentEvent) => { const r = reduceAgent(parts.agent, event); note("agents", event.type, r.error, event.at); parts = { ...parts, agent: r.state }; return r; };

  const results: BetaTenantResult[] = [];
  for (const spec of BETA_TENANTS) {
    const tenantId = spec.id;
    const ownerActor = { tenantId, actor: spec.owner.id };
    const system = { tenantId, actor: "system" };
    const nex = { tenantId, actor: "worker:nex" };

    // ================================================================ 1. the AI Business Architect creates the company: questions, preview, one click
    phase = `${spec.slug}:architect`;
    const arch = (event: ArchitectEvent) => { const r = reduceArchitect(architect, event); note("architect", event.type, r.error, event.at); architect = r.state; return r; };
    let step = arch({ ...ownerActor, at: ago(10), type: "session.start", owner: spec.owner });
    const sessionId = step.session?.id ?? "";
    let answered = 0;
    for (let guard = 0; guard < 10 && step.question; guard += 1) {
      const question = step.question;
      const value = (spec.answers as Record<string, string | readonly string[] | undefined>)[question.id] ?? "";
      step = arch({ ...ownerActor, at: later(ago(10), guard + 1), type: "answer.submit", sessionId, questionId: question.id, value });
      answered += 1;
      if (step.error) break;
    }
    if (nextQuestion(architect.sessions.find((item) => item.id === sessionId)?.answers ?? {}) !== null) errors.push(`${tenantId}: el asistente no terminó de preguntar`);
    const confirmed = arch({ ...ownerActor, at: ago(10, -1), type: "install.confirm", sessionId, parts });
    if (confirmed.installation) parts = confirmed.installation.parts;
    const template = templateById(confirmed.session?.templateId ?? "") as BusinessTemplate;
    const planId = confirmed.session?.planId ?? "";

    // ================================================================ 2. the team: a second person who approves what the owner prepares (the platform requires two people)
    phase = `${spec.slug}:org`;
    const roleId = (key: string) => parts.org.roles.find((item) => item.tenantId === tenantId && item.key === key)?.id ?? "";
    const branch = parts.org.branches.find((item) => item.tenantId === tenantId)?.id;
    const manager = `${spec.slug}-equipo`;
    org({ ...ownerActor, at: ago(9), type: "invite.create", email: `${manager}@${spec.slug}.test`, name: `Equipo de ${spec.name}`, roleId: roleId("manager"), ...(branch ? { branchId: branch } : {}) });
    org({ ...system, at: ago(9), type: "invite.accept", invitationId: parts.org.invitations.find((item) => item.tenantId === tenantId && item.userId === manager)?.id ?? "" });
    const approver = { tenantId, actor: manager };

    // the agents and prompts the Architect installed wait for review: the second person publishes them
    phase = `${spec.slug}:studio`;
    for (const asset of parts.studio.assets.filter((item) => item.tenantId === tenantId)) {
      for (const version of asset.versions.filter((item) => item.state === "pendingApproval")) studio({ ...approver, at: ago(8), type: "version.approve", assetId: asset.id, versionNumber: version.number, note: "Revisado en la beta" });
    }
    const assetId = (name: string) => parts.studio.assets.find((item) => item.tenantId === tenantId && item.name === name)?.id ?? "";
    const addPrompt = (name: string, category: "sales" | "marketing" | "operations" | "analysis" | "support", body: string, tags: string[], description: string) => {
      studio({ ...ownerActor, at: ago(7), type: "asset.create", kind: "prompt", meta: { name, description, category, tags }, content: promptContent(body) });
      studio({ ...ownerActor, at: ago(7), type: "version.submit", assetId: assetId(name), versionNumber: 1 });
      studio({ ...approver, at: ago(7), type: "version.approve", assetId: assetId(name), versionNumber: 1 });
    };
    const testPrompt = (name: string, inputs: Record<string, string>) => studio({ ...ownerActor, at: ago(0, 6), type: "test.run", assetId: assetId(name), versionNumber: 1, inputs });

    const lead = (name: string, company: string, value: number, fit: number, source: string, extra: Partial<LeadInput> = {}) => crm({ ...ownerActor, at: ago(2, 6), type: "lead.create", input: { name, company, source, estimatedValueMicros: usd(value), fit, owner: spec.owner.id, ...extra } });
    const leadId = (name: string) => parts.crm.leads.find((item) => item.tenantId === tenantId && item.name === name)?.id ?? "";
    const subject = (name: string) => ({ kind: "lead" as const, id: leadId(name) });
    const move = (name: string, to: Parameters<typeof crm>[0] extends infer E ? (E extends { type: "stage.move"; to: infer S } ? S : never) : never, hours: number) => crm({ ...ownerActor, at: ago(1, hours), type: "stage.move", leadId: leadId(name), to });
    const talk = (name: string, kind: "email" | "call", direction: "in" | "out", summary: string, hours: number) => crm({ ...ownerActor, at: ago(1, hours), type: "interaction.record", subject: subject(name), kind, direction, summary });
    const conversation = (channel: "email" | "webchat" | "webform", subjectText: string, contact: { name: string; handle: string }, company: string, text: string, hours: number) =>
      comms({ ...system, at: ago(0, hours), type: "conversation.open", input: { channel, subject: subjectText, contact, company, text } });
    const conv = (subjectText: string) => parts.comms.conversations.find((item) => item.tenantId === tenantId && item.subject === subjectText)?.id ?? "";
    const instance = (workerId: string) => parts.agent.koe.instances.find((item) => item.tenantId === tenantId && item.definitionId === workerId && item.status === "active")?.id ?? "";
    const sessionOf = () => parts.agent.sessions.filter((item) => item.tenantId === tenantId).at(-1)?.id ?? "";
    const runAgent = (workerId: string, playbookId: string, goal: string, input: Record<string, string>, hours: number) => {
      if (!instance(workerId)) { errors.push(`${tenantId}: el Worker ${workerId} no está activo`); return; }
      agent({ ...ownerActor, at: ago(0, hours), type: "session.start", instanceId: instance(workerId), playbookId, goal, input });
      agent({ ...system, at: ago(0, hours), type: "session.run", sessionId: sessionOf() });
      const waiting = parts.agent.sessions.find((item) => item.id === sessionOf() && item.status === "waitingApproval");
      if (waiting) { agent({ ...approver, at: later(ago(0, hours), 4), type: "session.approve", sessionId: waiting.id, approve: true }); agent({ ...system, at: later(ago(0, hours), 5), type: "session.run", sessionId: waiting.id }); }
    };
    const extraAutomation = (input: ReturnType<typeof blankInput>) => {
      automations({ ...ownerActor, at: ago(6), type: "automation.create", input });
      const id = parts.automations.automations.find((item) => item.tenantId === tenantId && item.name === input.name)?.id ?? "";
      automations({ ...ownerActor, at: ago(6), type: "automation.activate", automationId: id });
      automations({ ...ownerActor, at: ago(6), type: "automation.setTestMode", automationId: id, testMode: false });
      return id;
    };
    const fact = (module: "sales" | "marketing" | "seo" | "crm", metric: string, value: number, hours = 3) => insights({ ...system, at: ago(0, hours), type: "fact.record", module, metric, value });
    const evidence: Record<string, string> = {};

    // ================================================================ 3. the real use cases of each business, with the modules that already exist
    phase = `${spec.slug}:cases`;
    if (spec.slug === "nova") {
      // Captación de clientes: a form with a price question prepares a reply; leads come from SEO, ads and referrals (social networks are only a label typed by a person)
      extraAutomation(blankInput({ name: "Consulta de SEO: respuesta preparada", description: "Una consulta de SEO o de campañas prepara la respuesta y avisa al equipo.", trigger: "formSubmitted", conditions: [{ field: "mensaje", op: "contains", value: "seo" }], actions: [action("prepareEmail", { para: "{{correo}}", asunto: "Sobre su consulta de SEO", cuerpo: "Hola {{nombre}}, le enviamos nuestra propuesta de SEO." }), action("notifyInternal", { texto: "Consulta de SEO de {{nombre}}", para: "team" })] }));
      lead("Clínica Dental Sol", "Clínica Dental Sol", 3_000, 80, "SEO", { email: "contacto@dentalsol.test" });
      lead("Café Aurora", "Café Aurora", 1_500, 65, "Campaña de anuncios", { email: "hola@aurora.test" });
      lead("Boutique Luna", "Boutique Luna", 1_800, 72, "Redes sociales (manual)", { email: "hola@luna.test" });
      lead("Taller Rápido", "Taller Rápido", 2_200, 58, "Referido", { email: "info@taller.test" });
      automations({ ...system, at: ago(0, 7), type: "trigger.fire", kind: "newProspect", eventId: "nova-lead-1", payload: { nombre: "Clínica Dental Sol", empresa: "Clínica Dental Sol", correo: "contacto@dentalsol.test", puntaje: "80", origen: "SEO" } });
      automations({ ...system, at: ago(0, 7), type: "trigger.fire", kind: "formSubmitted", eventId: "nova-form-1", payload: { formulario: "Contacto", nombre: "Taller Rápido", correo: "info@taller.test", mensaje: "Quiero saber cuánto cuesta el SEO" } });
      // Seguimiento
      talk("Clínica Dental Sol", "email", "out", "Se envió la propuesta de SEO local.", 5);
      move("Clínica Dental Sol", "qualified", 5);
      talk("Café Aurora", "call", "out", "Llamada de descubrimiento sobre campañas de anuncios.", 4);
      crm({ ...system, at: ago(1, 3), type: "audit.record", leadId: leadId("Clínica Dental Sol"), answers: HOT_ANSWERS });
      for (const name of ["Clínica Dental Sol", "Café Aurora"]) crm({ ...nex, at: ago(0, 8), type: "task.generate", leadId: leadId(name) });
      crm({ ...ownerActor, at: ago(0, 7), type: "task.accept", taskId: parts.crm.tasks.find((item) => item.tenantId === tenantId && item.leadId === leadId("Clínica Dental Sol") && item.status === "proposed")?.id ?? "" });
      runAgent("followup", "followup.nudge", "Dar seguimiento a Clínica Dental Sol", { contacto: "Clínica Dental Sol", tema: "la propuesta de SEO" }, 6);
      // SEO, Campañas, Redes Sociales: the prompts the agency works with, tested through KOE
      addPrompt("Auditoría SEO", "marketing", "Haz una auditoría SEO de {{sitio}} y propone 5 mejoras priorizadas.", ["seo"], "Revisa un sitio y propone mejoras.");
      addPrompt("Brief de campaña", "marketing", "Redacta el brief de una campaña para {{cliente}} con el objetivo {{objetivo}}.", ["campanas"], "Brief de campaña de anuncios.");
      addPrompt("Calendario de redes", "marketing", "Propone {{cantidad}} publicaciones para las redes de {{cliente}} sobre {{tema}}.", ["redes"], "Calendario de contenido para redes (se publica a mano).");
      testPrompt("Auditoría SEO", { sitio: "dentalsol.test" });
      testPrompt("Brief de campaña", { cliente: "Café Aurora", objetivo: "más reservas" });
      testPrompt("Calendario de redes", { cantidad: "3", cliente: "Boutique Luna", tema: "colección nueva" });
      fact("seo", "organicVisits", 420); fact("marketing", "marketingLeads", 12); fact("marketing", "contentPublished", 9); fact("sales", "leadsNew", 4);
      conversation("webform", "Consulta de SEO local", { name: "Clínica Dental Sol", handle: "contacto@dentalsol.test" }, "Clínica Dental Sol", "Quisiera una propuesta de SEO para mi clínica.", 5);
      Object.assign(evidence, { "Captación de clientes": "4 prospectos y 2 automatizaciones disparadas", Seguimiento: "interacciones, etapas, tareas de NEX y un agente de seguimiento", SEO: "Auditoría SEO probada en KOE y visitas orgánicas", Campañas: "Brief de campaña probado en KOE", "Redes Sociales": "Calendario de redes (a mano, sin conectar redes)" });
    }
    if (spec.slug === "psi") {
      lead("Hotel Eco Playa", "Hotel Eco Playa", 6_000, 78, "Prospecto B2B", { email: "compras@ecoplaya.test" });
      lead("Cadena Verde", "Cadena Verde", 12_000, 85, "Feria", { email: "compras@cadenaverde.test" });
      lead("Distribuidora Norte", "Distribuidora Norte", 18_000, 70, "Distribuidor", { email: "ventas@distnorte.test" });
      lead("Distribuidora Sur", "Distribuidora Sur", 9_000, 62, "Distribuidor", { email: "ventas@distsur.test" });
      lead("Oficinas Ambar", "Oficinas Ámbar", 2_500, 55, "Prospecto B2B", { email: "info@ambar.test" });
      automations({ ...system, at: ago(0, 7), type: "trigger.fire", kind: "newProspect", eventId: "psi-lead-1", payload: { nombre: "Cadena Verde", empresa: "Cadena Verde", correo: "compras@cadenaverde.test", puntaje: "85", origen: "Feria" } });
      // Seguimiento comercial → Cotizaciones
      talk("Cadena Verde", "email", "out", "Se envió el catálogo de productos sostenibles.", 6);
      move("Cadena Verde", "qualified", 6); move("Cadena Verde", "meeting", 5); move("Cadena Verde", "proposal", 4);
      talk("Distribuidora Norte", "call", "out", "Acuerdo preliminar de condiciones de distribución.", 5);
      move("Distribuidora Norte", "qualified", 5); move("Distribuidora Norte", "meeting", 4); move("Distribuidora Norte", "proposal", 3);
      insights({ ...system, at: ago(0, 5), type: "fact.record", module: "sales", metric: "proposalsSent", value: 2 });
      conversation("email", "Cotización de 500 unidades", { name: "Cadena Verde", handle: "compras@cadenaverde.test" }, "Cadena Verde", "Necesitamos la cotización de 500 unidades del producto base.", 5);
      conversation("webform", "Consulta de distribución", { name: "Distribuidora Sur", handle: "ventas@distsur.test" }, "Distribuidora Sur", "¿Qué condiciones tienen para distribuidores?", 4);
      comms({ ...nex, at: ago(0, 4), type: "conversation.classify", conversationId: conv("Cotización de 500 unidades") });
      comms({ ...nex, at: ago(0, 4), type: "draft.create", conversationId: conv("Cotización de 500 unidades") });
      comms({ ...ownerActor, at: ago(0, 3), type: "draft.ready", draftId: parts.comms.drafts.find((item) => item.tenantId === tenantId)?.id ?? "" });
      comms({ ...ownerActor, at: ago(0, 3), type: "message.record", conversationId: conv("Cotización de 500 unidades"), text: "Con gusto, le enviamos la cotización hoy." });
      extraAutomation(blankInput({ name: "Cotización enviada: recordatorio", description: "Tres días después de una cotización, recordar el seguimiento.", trigger: "manual", actions: [action("createReminder", { texto: "Dar seguimiento a la cotización de {{cliente}}", enHoras: "72" }), action("createTask", { titulo: "Llamar a {{cliente}} por la cotización" })] }));
      automations({ ...ownerActor, at: ago(0, 2), type: "automation.runManual", automationId: parts.automations.automations.find((item) => item.tenantId === tenantId && item.name === "Cotización enviada: recordatorio")?.id ?? "", payload: { cliente: "Cadena Verde" } });
      // Productos: the catalog lives in AI Studio (sample SKUs); Distribuidores: leads and customers of the CRM
      addPrompt("Catálogo de productos", "sales", "Catálogo de PSI Sostenible. Línea base: {{producto}}. Responde sobre disponibilidad y presentaciones sin prometer precios.", ["catalogo"], "Catálogo de productos (referencias de ejemplo).");
      testPrompt("Catálogo de productos", { producto: "bolsa compostable 100 unidades" });
      move("Distribuidora Norte", "negotiation", 3); crm({ ...ownerActor, at: ago(1, 2), type: "stage.move", leadId: leadId("Distribuidora Norte"), to: "won", note: "Aceptó las condiciones" });
      crm({ ...ownerActor, at: ago(1, 1), type: "customer.convert", leadId: leadId("Distribuidora Norte") });
      const customerId = parts.crm.customers.find((item) => item.tenantId === tenantId)?.id ?? "";
      crm({ ...ownerActor, at: ago(1, 0), type: "contact.add", customerId, name: "Responsable de compras", role: "Compras", email: "compras@distnorte.test" });
      runAgent("followup", "followup.nudge", "Seguimiento de la cotización de Cadena Verde", { contacto: "Cadena Verde", tema: "la cotización" }, 6);
      fact("sales", "leadsNew", 5); fact("sales", "leadsConverted", 1);
      Object.assign(evidence, { "Prospectos B2B": "5 prospectos entre B2B, feria y distribuidores", "Seguimiento comercial": "interacciones y etapas hasta propuesta", Cotizaciones: "borrador de cotización aprobado por una persona y recordatorio automático", Productos: "catálogo de ejemplo en AI Studio", Distribuidores: "distribuidor ganado y convertido en cliente con contacto" });
    }
    if (spec.slug === "re") {
      addPrompt("Fichas de propiedades", "sales", "Ficha de la propiedad {{propiedad}} en {{zona}}: describe características y pregunta por presupuesto, sin confirmar precio final.", ["propiedades"], "Fichas de propiedades (ejemplos).");
      testPrompt("Fichas de propiedades", { propiedad: "casa de 3 habitaciones", zona: "Escazú" });
      lead("Familia Rojas", "Familia Rojas", 8_000, 80, "Portal inmobiliario", { email: "rojas@familia.test" });
      lead("Inversionista Vega", "Inversiones Vega", 20_000, 88, "Referido", { email: "vega@inversiones.test" });
      lead("Pareja Mora", "Pareja Mora", 5_000, 60, "Formulario web", { email: "mora@pareja.test" });
      lead("Empresa Lumbre", "Lumbre S.A.", 12_000, 70, "Portal inmobiliario", { email: "lumbre@empresa.test" });
      automations({ ...system, at: ago(0, 7), type: "trigger.fire", kind: "newProspect", eventId: "re-lead-1", payload: { nombre: "Inversionista Vega", empresa: "Inversiones Vega", correo: "vega@inversiones.test", puntaje: "88", origen: "Referido" } });
      talk("Familia Rojas", "email", "out", "Se enviaron 3 fichas de casas en Escazú.", 6);
      move("Familia Rojas", "qualified", 6);
      talk("Inversionista Vega", "call", "out", "Llamada de 20 minutos sobre terrenos.", 5);
      move("Inversionista Vega", "qualified", 5); move("Inversionista Vega", "meeting", 4);
      // Agenda: visits are meetings; the meeting automation prepares each one
      crm({ ...ownerActor, at: ago(0, 6), type: "meeting.schedule", leadId: leadId("Familia Rojas"), scheduledFor: "2026-11-14T10:00:00.000Z", title: "Visita a casa en Escazú" });
      crm({ ...ownerActor, at: ago(0, 6), type: "meeting.schedule", leadId: leadId("Inversionista Vega"), scheduledFor: "2026-11-13T15:00:00.000Z", title: "Visita al terreno en Heredia" });
      automations({ ...system, at: ago(0, 6), type: "trigger.fire", kind: "meetingCreated", eventId: "re-meet-1", payload: { titulo: "Visita a casa en Escazú", fecha: "2026-11-14", contacto: "Familia Rojas", correo: "rojas@familia.test" } });
      conversation("webchat", "Consulta por una casa", { name: "Pareja Mora", handle: "visitor-77" }, "", "Hola, ¿todavía está disponible la casa de 3 habitaciones?", 3);
      comms({ ...nex, at: ago(0, 3), type: "draft.create", conversationId: conv("Consulta por una casa") });
      runAgent("followup", "followup.nudge", "Dar seguimiento a Familia Rojas tras la visita", { contacto: "Familia Rojas", tema: "la visita" }, 5);
      runAgent("sales", "sales.qualify", "Calificar a Inversionista Vega", { contacto: "Inversionista Vega" }, 4);
      // Cierre
      move("Inversionista Vega", "proposal", 3); move("Inversionista Vega", "negotiation", 2); crm({ ...ownerActor, at: ago(1, 1), type: "stage.move", leadId: leadId("Inversionista Vega"), to: "won", note: "Firmó la promesa de compra" });
      crm({ ...ownerActor, at: ago(1, 0), type: "customer.convert", leadId: leadId("Inversionista Vega") });
      fact("sales", "leadsNew", 8); fact("sales", "proposalsSent", 3); fact("sales", "leadsConverted", 1);
      Object.assign(evidence, { Propiedades: "fichas de ejemplo en AI Studio probadas en KOE", Leads: "4 leads de portal, referido y formulario", Seguimiento: "interacciones, etapas y un agente de seguimiento", Agenda: "2 visitas agendadas y su automatización", Cierre: "una venta ganada y convertida en cliente" });
    }
    if (spec.slug === "yt") {
      // Producción, Guiones, Miniaturas: prompts the channel works with; Calendario: tasks with due dates; Publicaciones and Analíticas: Insights
      addPrompt("Guion de video", "marketing", "Escribe el guion de un video de {{minutos}} minutos sobre {{tema}} con un gancho de 10 segundos.", ["guiones"], "Guion de video sin rostro.");
      addPrompt("Brief de miniatura", "marketing", "Describe una miniatura para el video {{titulo}}: texto corto, colores y elemento principal.", ["miniaturas"], "Brief para el diseño de la miniatura.");
      addPrompt("Calendario editorial", "operations", "Propone el calendario de {{cantidad}} videos para {{periodo}} con tema y fecha.", ["calendario"], "Calendario editorial.");
      testPrompt("Guion de video", { minutos: "8", tema: "finanzas personales" });
      testPrompt("Brief de miniatura", { titulo: "Cómo ahorrar sin esfuerzo" });
      testPrompt("Calendario editorial", { cantidad: "8", periodo: "diciembre" });
      const produce = extraAutomation(blankInput({ name: "Producir y programar un video", description: "Crea las tareas de producción de un video con sus fechas.", trigger: "manual", actions: [action("createTask", { titulo: "Guion de {{video}}", enDias: "1" }), action("createTask", { titulo: "Grabación de voz y edición de {{video}}", enDias: "3" }), action("createTask", { titulo: "Miniatura de {{video}}", enDias: "4" }), action("createReminder", { texto: "Publicar {{video}}", enHoras: "120" })] }));
      for (const video of ["Cómo ahorrar sin esfuerzo", "Errores al invertir"]) automations({ ...ownerActor, at: ago(0, 6), type: "automation.runManual", automationId: produce, payload: { video } });
      for (const output of parts.automations.outputs.filter((item) => item.tenantId === tenantId && item.kind === "task").slice(0, 2)) automations({ ...ownerActor, at: ago(0, 2), type: "output.resolve", outputId: output.id, resolution: "done" });
      lead("Marca EcoBank", "EcoBank", 1_200, 70, "Patrocinio", { email: "marcas@ecobank.test" });
      talk("Marca EcoBank", "email", "out", "Se envió el media kit del canal.", 4);
      move("Marca EcoBank", "qualified", 4);
      conversation("webform", "Propuesta de patrocinio", { name: "Marca EcoBank", handle: "marcas@ecobank.test" }, "EcoBank", "Nos interesa patrocinar sus videos de finanzas.", 3);
      runAgent("reporter", "reporter.daily", "Resumen semanal del canal", { tema: "videos publicados y visitas" }, 5);
      fact("marketing", "contentPublished", 8); fact("seo", "organicVisits", 31_500); fact("sales", "leadsNew", 1);
      insights({ ...ownerActor, at: ago(0, 2), type: "report.draft", input: { name: "Analíticas del canal", sections: ["executive", "analytics"], format: "pdf" } });
      insights({ ...approver, at: ago(0, 1), type: "report.approve", reportId: parts.insights.reports.filter((item) => item.tenantId === tenantId).at(-1)?.id ?? "" });
      Object.assign(evidence, { Producción: "automatización que crea las tareas de cada video", Calendario: "calendario editorial y tareas con fecha", Guiones: "prompt de guiones probado en KOE", Miniaturas: "brief de miniaturas probado en KOE", Publicaciones: "recordatorio de publicación y contenidos registrados", Analíticas: "visitas orgánicas y reporte aprobado" });
    }

    // ================================================================ 4. every company: Communications handled by a person, Billing analysed by NEX, a report for Insights
    phase = `${spec.slug}:common`;
    for (const conversationRow of parts.comms.conversations.filter((item) => item.tenantId === tenantId && item.status === "open").slice(0, 1)) {
      comms({ ...ownerActor, at: ago(0, 1), type: "message.record", conversationId: conversationRow.id, text: "Gracias por escribirnos, le respondemos hoy." });
      comms({ ...ownerActor, at: ago(0, 0), type: "status.set", conversationId: conversationRow.id, to: "resolved" });
    }
    billing({ ...nex, at: ago(0, 1), type: "billing.analyze" });
    if (spec.slug !== "yt") {
      insights({ ...ownerActor, at: ago(0, 2), type: "report.draft", input: { name: "Resumen semanal", sections: ["executive", "customers"], format: "pdf" } });
      insights({ ...approver, at: ago(0, 1), type: "report.approve", reportId: parts.insights.reports.filter((item) => item.tenantId === tenantId && item.name === "Resumen semanal").at(-1)?.id ?? "" });
    }

    const dashboard = operatingDashboard({ parts, executions: [] }, tenantId, BETA_NOW);
    results.push({ spec, template, planId, questionsAnswered: answered, installedSteps: confirmed.session?.installed?.steps ?? 0, dashboard, kpis: readKpis(template, parts, tenantId), revenue: revenueEngine(template, parts, tenantId), useCaseEvidence: evidence });
  }
  void applyArchitectEvents;

  // ======================================================================== KYNOVA as the administrator: the portfolio of its four businesses (a reading)
  const portfolio: PortfolioRow[] = results.map((item) => ({
    tenantId: item.spec.id, name: item.spec.name, template: item.template.name, plan: item.planId, monthlyMicros: PLANS.find((plan) => plan.id === item.planId)?.monthlyMicros ?? 0, leadsOpen: item.dashboard.sales.leadsOpen, pipelineMicros: item.dashboard.sales.pipelineMicros,
    customers: item.dashboard.sales.customers, conversationsOpen: item.dashboard.support.open, automationRuns: item.dashboard.automation.runs, agentSessions: item.dashboard.ai.agentSessions, tasksDone: item.dashboard.tasks.done, health: item.dashboard.health,
  }));
  return { parts, architect, tenants: results, steps, errors, portfolio, mrrMicros: portfolio.reduce((total, row) => total + row.monthlyMicros, 0) };
}
