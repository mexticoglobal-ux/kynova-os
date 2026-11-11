// AI Business Architect (Sprint 37): Smart Onboarding. A new customer answers a few short questions and KYNOVA proposes, previews and installs their whole company: the Business Template that fits,
// the plan, how many AI agents, the AI budget, the automations, the Workers, the teams, the KPIs and the dashboard. It is a GUIDE over what already exists, not a new business module:
//   - every recommendation is DERIVED from the Business Templates' own data and from Billing's plan limits; there is no rule of the business here, only the choice and the scaling of what a template holds;
//   - installing is `installBusinessTemplate` (Organization, KOE Workers, NEX's AI settings, Billing, AI Studio, Automations, Insights), unchanged, through the same reducers;
//   - the "intelligence" is deterministic (keywords and the company's own answers). No AI provider is called: it is an assistant script, not a model (a model could later write the questions through KOE).
// A person (the new company's owner) answers, adjusts and confirms; NEX only presents the questions. Everything is audited in the append-only trail the Backend Core's Event Bus connector reads, every
// record carries its company, and nothing is installed until the owner confirms. It touches nothing of KOE, NEX, the AI Gateway, the Runtime, the Backend Core or the Financial Router (ADR-0021).

import { isPerson } from "./actors";
import { PLANS, type Plan } from "./billing-catalog";
import {
  BUSINESS_TEMPLATES, TEMPLATE_IDS, emptyParts, installBusinessTemplate, templateById,
  type BusinessTemplate, type DashboardWidget, type Installation, type TemplateAgent, type TemplateId, type TemplateKpi, type TemplateObjective, type TemplateOverrides, type TemplateTeam,
} from "./business-templates";
import type { OperationParts } from "./kynova-operation";

// ---------------------------------------------------------------- the questionnaire: seven short questions, one more only when the business could not be recognised
export const TEAM_SIZES = ["solo", "small", "medium", "large"] as const;
export const MONTHLY_LEADS = ["under10", "from10to50", "from50to200", "over200"] as const;
export const CHANNELS = ["email", "webchat", "webform"] as const;
export const GOALS = ["moreSales", "organizeClients", "automate", "controlFinances", "understandData"] as const;
export const APPETITES = ["cautious", "balanced", "ambitious"] as const;
export const QUESTION_IDS = ["businessName", "description", "sector", "teamSize", "monthlyLeads", "channels", "goal", "aiAppetite"] as const;
export type QuestionId = (typeof QUESTION_IDS)[number];
export type Question = { id: QuestionId; kind: "text" | "choice" | "multi"; prompt: string; options?: readonly string[]; hint?: string };
export const QUESTIONS: Record<QuestionId, Question> = {
  businessName: { id: "businessName", kind: "text", prompt: "¿Cómo se llama tu empresa?" },
  description: { id: "description", kind: "text", prompt: "Cuéntame en una frase a qué se dedica.", hint: "Por ejemplo: «una clínica dental» o «agencia de marketing para restaurantes»." },
  sector: { id: "sector", kind: "choice", prompt: "No estoy seguro de tu tipo de negocio. ¿Cuál se parece más?", options: [...TEMPLATE_IDS, "other"] },
  teamSize: { id: "teamSize", kind: "choice", prompt: "¿Cuántas personas trabajan contigo?", options: TEAM_SIZES },
  monthlyLeads: { id: "monthlyLeads", kind: "choice", prompt: "¿Cuántas personas te escriben o te piden información al mes?", options: MONTHLY_LEADS },
  channels: { id: "channels", kind: "multi", prompt: "¿Por dónde te contactan tus clientes?", options: CHANNELS },
  goal: { id: "goal", kind: "choice", prompt: "¿Qué quieres lograr primero?", options: GOALS },
  aiAppetite: { id: "aiAppetite", kind: "choice", prompt: "¿Cuánto quieres que la IA haga por ti?", options: APPETITES, hint: "Siempre prepara; las personas deciden y aprueban." },
};
export type Answers = Partial<{ businessName: string; description: string; sector: string; teamSize: (typeof TEAM_SIZES)[number]; monthlyLeads: (typeof MONTHLY_LEADS)[number]; channels: readonly (typeof CHANNELS)[number][]; goal: (typeof GOALS)[number]; aiAppetite: (typeof APPETITES)[number] }>;

/** The minutes the customer needs, counted at half a minute per question: the promise is a company configured in under five. */
export const SECONDS_PER_QUESTION = 30;
export const welcomeMessage = (ownerName: string): string => `Hola ${ownerName.split(" ")[0] ?? ""}, soy NEX, la asistente de IA de KYNOVA. Con unas pocas preguntas cortas dejo tu empresa lista: tu plantilla, tu plan, tus agentes, tus automatizaciones y tu panel. Antes de instalar nada, te muestro una vista previa y tú decides.`;

// ---------------------------------------------------------------- detecting the type of business from what the customer wrote
/** Words (without accents) that point to each template. This is the whole of the "detection": a customer who says "clínica dental" is a Clínica. */
export const SECTOR_SIGNALS: Record<TemplateId, readonly string[]> = {
  marketingAgency: ["marketing", "agencia", "publicidad", "redes sociales", "branding", "seo", "anuncios", "campanas"],
  realEstate: ["inmobiliaria", "bienes raices", "propiedades", "casas", "alquiler", "corredor", "terrenos", "apartamentos"],
  restaurant: ["restaurante", "comida", "cafeteria", "menu", "panaderia", "reservas de mesa", "bar ", "cocina"],
  clinic: ["clinica", "paciente", "medico", "dental", "dentista", "salud", "consultorio", "odontologia", "psicologia", "veterinaria"],
  lawyer: ["abogado", "bufete", "legal", "juridico", "despacho", "notaria", "litigio"],
  accountant: ["contador", "contabilidad", "impuestos", "tributario", "planilla", "declaraciones"],
  construction: ["constructora", "construccion", "obra", "remodelacion", "ingenieria civil", "arquitectura", "contratista"],
  ecommerce: ["tienda en linea", "e-commerce", "ecommerce", "shopify", "tienda online", "envios", "venta de productos", "tienda virtual"],
  facelessYoutube: ["youtube", "canal", "videos", "creador de contenido", "faceless", "monetizar", "podcast"],
  consultant: ["consultor", "consultoria", "asesoria", "coach", "mentoria", "asesor"],
  education: ["academia", "cursos", "escuela", "educacion", "alumnos", "clases", "capacitacion", "tutor", "colegio"],
  generic: [],
};
export const normalizeText = (text: string): string => ` ${text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9\-\s]/g, " ").replace(/\s+/g, " ").trim()} `;
export type Detection = { templateId: TemplateId; confidence: "confirmed" | "high" | "low" | "none"; scores: readonly { templateId: TemplateId; hits: number }[]; matched: readonly string[] };
/** Scores every template by the words the customer used, and says how sure it is. A sector the customer chose always wins. */
export function detectBusiness(answers: Answers): Detection {
  const text = normalizeText(`${answers.description ?? ""} ${answers.businessName ?? ""}`);
  const matches = TEMPLATE_IDS.map((templateId) => ({ templateId, found: SECTOR_SIGNALS[templateId].filter((word) => text.includes(` ${word.trim()}`) || (word.endsWith(" ") && text.includes(word))) }));
  const scores = matches.map((item) => ({ templateId: item.templateId, hits: item.found.length })).filter((item) => item.hits > 0).sort((a, b) => b.hits - a.hits || a.templateId.localeCompare(b.templateId));
  const matchedOf = (id: string) => matches.find((item) => item.templateId === id)?.found ?? [];
  if (answers.sector && (TEMPLATE_IDS as readonly string[]).includes(answers.sector)) return { templateId: answers.sector as TemplateId, confidence: "confirmed", scores, matched: matchedOf(answers.sector) };
  if (answers.sector === "other") return { templateId: "generic", confidence: "confirmed", scores, matched: [] };
  const top = scores[0];
  if (!top) return { templateId: "generic", confidence: "none", scores, matched: [] };
  const second = scores[1];
  return { templateId: top.templateId, confidence: !second || (top.hits > second.hits && top.hits >= 2) ? "high" : "low", scores, matched: matchedOf(top.templateId) };
}

/** The questions still to ask, in order. The sector is asked only when the description did not make the business clear. */
export function pendingQuestions(answers: Answers): Question[] {
  const detected = detectBusiness(answers);
  return QUESTION_IDS.filter((id) => {
    if (id === "sector") return answers.description !== undefined && answers.sector === undefined && detected.confidence !== "high";
    return answers[id] === undefined;
  }).filter((id) => id !== "sector" || answers.description !== undefined).map((id) => QUESTIONS[id]);
}
export const nextQuestion = (answers: Answers): Question | null => pendingQuestions(answers)[0] ?? null;
/** The most questions anyone will see, and the minutes they take. */
export const MAX_QUESTIONS = QUESTION_IDS.length;
export const estimatedMinutes = (answers: Answers): number => Math.round(((Object.values(answers).filter((item) => item !== undefined).length + pendingQuestions(answers).length) * SECONDS_PER_QUESTION) / 6) / 10;

// ---------------------------------------------------------------- the recommendation: only a choice and a scaling of what the templates and Billing already say
const PEOPLE: Record<(typeof TEAM_SIZES)[number], number> = { solo: 1, small: 5, medium: 20, large: 60 };
const LEADS: Record<(typeof MONTHLY_LEADS)[number], number> = { under10: 10, from10to50: 50, from50to200: 200, over200: 1_000 };
const BUDGET_FACTOR: Record<(typeof APPETITES)[number], number> = { cautious: 0.6, balanced: 1, ambitious: 1.6 };
/** The metrics each first goal looks at first; the template's own KPIs are only reordered, never replaced. */
const GOAL_METRICS: Record<(typeof GOALS)[number], readonly string[]> = {
  moreSales: ["leadsNew", "leadsQualified", "proposalsSent", "leadsConverted", "attributedRevenue", "marketingLeads"], organizeClients: ["customersNew", "customersActive", "customersServed", "tasksCompleted"],
  automate: ["tasksCompleted", "contentPublished", "lessonsCompleted"], controlFinances: ["paymentsValue", "paymentsCount", "attributedRevenue"], understandData: [],
};
const GOAL_WIDGET: Record<(typeof GOALS)[number], DashboardWidget | undefined> = { moreSales: "sales", organizeClients: "tasks", automate: "automation", controlFinances: "billing", understandData: "insights" };
const tierOf = (planId: string) => PLANS.find((item) => item.id === planId)?.tier ?? 1;

export type PlanChoice = { id: string; name: string; monthlyMicros: number; fits: boolean; reasons: readonly string[]; needs: Readonly<Record<string, number>> };
export type Adjust = { templateId?: string; planId?: string };
export type Recommendation = {
  template: { id: TemplateId; name: string; summary: string; confidence: Detection["confidence"]; matched: readonly string[]; alternatives: readonly { id: TemplateId; name: string }[] };
  plan: PlanChoice; agents: { count: number; list: readonly TemplateAgent[] }; aiBudgetUsd: number; automations: readonly string[]; workers: readonly string[]; teams: readonly TemplateTeam[];
  kpis: readonly TemplateKpi[]; objectives: readonly TemplateObjective[]; dashboard: readonly DashboardWidget[]; overrides: TemplateOverrides; notes: readonly string[]; nextSteps: readonly string[];
};

/** The plan: the cheapest self-serve one whose own limits cover what the company will install, never below the template's recommended tier. */
export function choosePlan(needs: Readonly<Record<string, number>>, floorPlanId: string, forced?: string): PlanChoice {
  const covers = (plan: Plan) => Object.entries(needs).every(([resource, amount]) => ((plan.limits as unknown as Record<string, number>)[resource] ?? 0) >= amount);
  const forcedPlan = forced ? PLANS.find((item) => item.id === forced && item.selfServe) : undefined;
  const candidates = PLANS.filter((item) => item.selfServe && item.tier >= tierOf(floorPlanId)).sort((a, b) => a.tier - b.tier);
  const chosen = forcedPlan ?? candidates.find(covers) ?? PLANS.filter((item) => !item.custom).sort((a, b) => b.tier - a.tier)[0] as Plan;
  const fits = covers(chosen);
  const reasons = forcedPlan ? ["Elegido por ti."] : [`Cubre ${Object.entries(needs).map(([resource, amount]) => `${amount} ${resource}`).join(", ")}.`];
  if (!chosen.selfServe) reasons.push("Supera los planes de autoservicio: se acuerda con el equipo de KYNOVA.");
  if (forcedPlan && !fits) reasons.push("Ojo: este plan no cubre todo lo recomendado.");
  return { id: chosen.id, name: chosen.name, monthlyMicros: chosen.monthlyMicros, fits, reasons, needs };
}

/** Recommends from the answers (and the owner's adjustments). Pure: it reads the templates and the plans and decides nothing. Returns null while the answers are incomplete. */
export function recommend(answers: Answers, adjust: Adjust = {}): Recommendation | null {
  if (pendingQuestions(answers).length > 0 || !answers.teamSize || !answers.monthlyLeads || !answers.channels || !answers.goal || !answers.aiAppetite) return null;
  const detection = detectBusiness(answers);
  const templateId = adjust.templateId && (TEMPLATE_IDS as readonly string[]).includes(adjust.templateId) ? (adjust.templateId as TemplateId) : detection.templateId;
  const template = templateById(templateId) as BusinessTemplate;
  const goal = answers.goal;
  const agentCount = answers.aiAppetite === "cautious" ? 1 : template.agents.length;
  const agents = template.agents.slice(0, agentCount);
  const automations = template.automations.filter((id) => id !== "webForm" || (answers.channels as readonly string[]).includes("webform"));
  const teams = answers.teamSize === "solo" ? template.teams.slice(0, 1) : template.teams;
  const wanted = [...new Set([...agents.map((item) => item.worker), ...template.workers])];
  const needs = { users: PEOPLE[answers.teamSize], workers: new Set(agents.map((item) => item.worker)).size, teams: teams.length, departments: template.departments.length, automations: automations.length + template.extraAutomations.length, aiStudio: agents.length * 2, crm: LEADS[answers.monthlyLeads] };
  const plan = choosePlan(needs, template.planId, adjust.planId);
  const workerLimit = PLANS.find((item) => item.id === plan.id)?.limits.workers ?? wanted.length;
  const workers = wanted.slice(0, Math.max(workerLimit, agents.length ? new Set(agents.map((item) => item.worker)).size : 0));
  const aiBudgetUsd = Math.max(5, Math.round((template.aiBudgetUsd * BUDGET_FACTOR[answers.aiAppetite]) / 5) * 5);
  const preferred = GOAL_METRICS[goal];
  const rank = (metric: string) => (preferred.includes(metric) ? preferred.indexOf(metric) : preferred.length + 1);
  const kpis = [...template.kpis].sort((a, b) => rank(a.metric) - rank(b.metric)).slice(0, 4);
  const widget = GOAL_WIDGET[goal];
  const dashboard = widget && template.dashboard.includes(widget) ? [widget, ...template.dashboard.filter((item) => item !== widget)] : template.dashboard;
  const keptKpis = new Set(kpis.map((item) => item.id));
  const objectives = template.objectives.filter((item) => keptKpis.has(item.kpi));
  const overrides: TemplateOverrides = { agents, automations, workers, teams, kpis, objectives: objectives.length ? objectives : template.objectives.slice(0, 1).filter((item) => keptKpis.has(item.kpi)), dashboard, planId: plan.id, aiBudgetUsd };
  const notes = [
    ...(detection.scores.filter((item) => item.templateId !== template.id).length > 0 ? ["Tu descripción también encaja con otra plantilla: puedes cambiarla en la vista previa."] : []),
    ...(answers.teamSize === "solo" ? ["Trabajas solo: para publicar los agentes hace falta una segunda persona que los apruebe; invítala cuando quieras."] : []),
    ...(!plan.fits ? ["Lo recomendado supera los planes de autoservicio: hablemos de un plan a medida."] : []),
    "Todo se instala en Nivel 1: la IA prepara y tú apruebas. La autonomía la activas tú más adelante.",
  ];
  const nextSteps = [
    "Invita a tu equipo en Organización y asigna sus roles.", "Revisa y aprueba tus agentes en AI Studio (los publica una segunda persona).", "Revisa tus automatizaciones: ya están activas y solo preparan, no envían.",
    "Aprueba tu reporte ejecutivo en Insights y mira tu panel.", "Explora el curso «Operar una empresa con KYNOVA» en Academy y las plantillas del Marketplace.",
  ];
  return {
    template: { id: template.id, name: template.name, summary: template.summary, confidence: adjust.templateId ? "confirmed" : detection.confidence, matched: detection.matched, alternatives: [...detection.scores.filter((item) => item.templateId !== template.id).slice(0, 2).map((item) => ({ id: item.templateId, name: (templateById(item.templateId) as BusinessTemplate).name })), ...(template.id !== "generic" ? [{ id: "generic" as TemplateId, name: "Empresa Genérica" }] : [])].filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index) },
    plan, agents: { count: agents.length, list: agents }, aiBudgetUsd, automations: [...automations, ...template.extraAutomations.map((item) => item.name)], workers, teams, kpis, objectives: overrides.objectives ?? [], dashboard, overrides, notes, nextSteps,
  };
}

// ---------------------------------------------------------------- the preview: what WILL be installed, proven by a dry run on a scratch copy that is thrown away
export type Preview = {
  company: string; template: string; plan: { id: string; name: string; monthlyMicros: number }; aiBudgetUsd: number; agents: readonly string[]; automations: readonly string[]; workers: readonly string[]; teams: readonly string[]; departments: readonly string[];
  roles: readonly string[]; kpis: readonly string[]; dashboard: readonly string[]; objectives: readonly string[]; workflows: readonly string[]; steps: number; ok: boolean; errors: readonly string[]; notes: readonly string[]; nextSteps: readonly string[];
};
/** Runs the real installer on an empty, throw-away set of records, so the preview is exactly what the one click will do (and any problem shows up before the click). */
export function previewInstall(answers: Answers, adjust: Adjust = {}): Preview | null {
  const rec = recommend(answers, adjust);
  if (!rec) return null;
  const dry = installBusinessTemplate({ templateId: rec.template.id, tenantId: "tenant-preview", companyName: answers.businessName ?? "Empresa", owner: { id: "preview-owner", name: "Propietario", email: "preview@example.test" }, at: "2026-01-01T00:00:00.000Z", overrides: rec.overrides });
  const template = templateById(rec.template.id) as BusinessTemplate;
  const ok = "parts" in dry && dry.errors.length === 0;
  return {
    company: answers.businessName ?? "", template: rec.template.name, plan: { id: rec.plan.id, name: rec.plan.name, monthlyMicros: rec.plan.monthlyMicros }, aiBudgetUsd: rec.aiBudgetUsd, agents: rec.agents.list.map((item) => item.name), automations: rec.automations, workers: rec.workers,
    teams: rec.teams.map((item) => item.name), departments: template.departments, roles: template.roles.map((item) => item.name), kpis: rec.kpis.map((item) => `${item.label}: ${item.target}`), dashboard: rec.dashboard, objectives: rec.objectives.map((item) => item.text),
    workflows: "parts" in dry ? dry.template.workflows.map((item) => item.name) : [], steps: "steps" in dry ? dry.steps.length : 0, ok, errors: "errors" in dry ? dry.errors : [], notes: rec.notes, nextSteps: rec.nextSteps,
  };
}

// ---------------------------------------------------------------- the session: one customer, one company, one confirmation
export type SessionStatus = "asking" | "ready" | "installed" | "failed" | "cancelled";
export type Session = {
  id: string; tenantId: string; ownerId: string; ownerName: string; ownerEmail: string; status: SessionStatus; answers: Answers; adjust: Adjust; startedAt: string; readyAt?: string; installedAt?: string; templateId?: TemplateId; planId?: string;
  installed?: { steps: number; agents: number; automations: number; workers: number; teams: number }; failure?: string;
};
export type ArchitectAudit = { at: string; actor: string; tenantId: string; action: string; detail?: string };
export type ArchitectState = { sessions: readonly Session[]; audit: readonly ArchitectAudit[]; sequence: number };
export const newArchitectState = (): ArchitectState => ({ sessions: [], audit: [], sequence: 0 });

type Base = { at: string; tenantId: string; actor: string };
export type ArchitectEvent =
  | (Base & { type: "session.start"; owner: { id: string; name: string; email: string } })
  | (Base & { type: "answer.submit"; sessionId: string; questionId: string; value: string | readonly string[] })
  | (Base & { type: "recommendation.adjust"; sessionId: string; templateId?: string; planId?: string })
  | (Base & { type: "install.confirm"; sessionId: string; parts?: OperationParts })
  | (Base & { type: "session.cancel"; sessionId: string });
export type ArchitectResult = { state: ArchitectState; error?: string; errorCode?: string; session?: Session; question?: Question | null; welcome?: string; recommendation?: Recommendation | null; preview?: Preview | null; installation?: Installation };
export const ERRORS = {
  tenantRequired: "Falta la empresa (tenant_id).", personRequired: "Solo una persona puede hacerlo: NEX no responde ni instala por ti.", forbidden: "Solo quien abrió el asistente puede hacerlo.", invalid: "Dato no válido.", notFound: "No existe.",
  sessionOpen: "Ya hay un asistente abierto para esta empresa.", alreadyInstalled: "Esta empresa ya está configurada.", invalidTransition: "Ese paso no es posible en este momento.", notReady: "Faltan preguntas por responder.", unknownQuestion: "Esa pregunta no existe.",
} as const;
export type ArchitectErrorCode = keyof typeof ERRORS;
const pad = (value: number) => String(value).padStart(4, "0");

/** Validates one answer against its question. Returns the cleaned value, or null when it is not acceptable. */
export function cleanAnswer(questionId: string, value: string | readonly string[]): string | readonly string[] | null {
  const question = (QUESTIONS as Record<string, Question | undefined>)[questionId];
  if (!question) return null;
  if (question.kind === "text") return typeof value === "string" && value.trim().length >= 2 && value.trim().length <= 200 ? value.trim() : null;
  if (question.kind === "choice") return typeof value === "string" && (question.options ?? []).includes(value) ? value : null;
  return Array.isArray(value) && value.length > 0 && value.every((item) => (question.options ?? []).includes(item)) ? [...new Set(value)] : null;
}

export function reduceArchitect(state: ArchitectState, event: ArchitectEvent): ArchitectResult {
  const refuse = (code: ArchitectErrorCode, detail?: string): ArchitectResult => ({ state, error: detail ? `${ERRORS[code]} ${detail}` : ERRORS[code], errorCode: code });
  if (!event.tenantId || event.tenantId.trim() === "" || !event.actor || event.actor.trim() === "") return refuse("tenantRequired");
  if (!isPerson(event.actor)) return refuse("personRequired");
  const { tenantId, at } = event;
  const record = (next: ArchitectState, action: string, detail?: string): ArchitectState => ({ ...next, audit: [...next.audit, { at, actor: event.actor, tenantId, action, ...(detail ? { detail } : {}) }] });
  const replace = (session: Session): ArchitectState => ({ ...state, sessions: state.sessions.map((item) => (item.id === session.id ? session : item)) });

  if (event.type === "session.start") {
    if (event.owner.id !== event.actor || event.owner.name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(event.owner.email)) return refuse("invalid");
    if (state.sessions.some((item) => item.tenantId === tenantId && item.status === "installed")) return refuse("alreadyInstalled");
    if (state.sessions.some((item) => item.tenantId === tenantId && (item.status === "asking" || item.status === "ready"))) return refuse("sessionOpen");
    const session: Session = { id: `bs_${pad(state.sequence + 1)}`, tenantId, ownerId: event.owner.id, ownerName: event.owner.name.trim(), ownerEmail: event.owner.email.trim().toLowerCase(), status: "asking", answers: {}, adjust: {}, startedAt: at };
    return { state: record({ ...state, sessions: [...state.sessions, session], sequence: state.sequence + 1 }, "session.start", session.id), session, question: nextQuestion({}), welcome: welcomeMessage(session.ownerName) };
  }
  const session = state.sessions.find((item) => item.id === event.sessionId && item.tenantId === tenantId);
  if (!session) return refuse("notFound");
  if (session.ownerId !== event.actor) return refuse("forbidden");

  switch (event.type) {
    case "answer.submit": {
      if (session.status !== "asking" && session.status !== "ready") return refuse("invalidTransition", session.status);
      if (!(QUESTION_IDS as readonly string[]).includes(event.questionId)) return refuse("unknownQuestion");
      const cleaned = cleanAnswer(event.questionId, event.value);
      if (cleaned === null) return refuse("invalid", QUESTIONS[event.questionId as QuestionId].prompt);
      const answers: Answers = { ...session.answers, [event.questionId]: cleaned };
      const missing = pendingQuestions(answers);
      const next: Session = { ...session, answers, status: missing.length === 0 ? "ready" : "asking", ...(missing.length === 0 ? { readyAt: at } : {}) };
      if (missing.length > 0) { delete (next as { readyAt?: string }).readyAt; }
      const recommendation = recommend(answers, session.adjust);
      return { state: record(replace(next), "answer.submit", `${session.id} · ${event.questionId}`), session: next, question: missing[0] ?? null, recommendation, preview: recommendation ? previewInstall(answers, session.adjust) : null };
    }
    case "recommendation.adjust": {
      if (session.status !== "ready") return refuse("notReady");
      if (event.templateId !== undefined && !(TEMPLATE_IDS as readonly string[]).includes(event.templateId)) return refuse("invalid", "plantilla");
      if (event.planId !== undefined && !PLANS.some((item) => item.id === event.planId && item.selfServe)) return refuse("invalid", "plan");
      const adjust: Adjust = { ...session.adjust, ...(event.templateId ? { templateId: event.templateId } : {}), ...(event.planId ? { planId: event.planId } : {}) };
      const next: Session = { ...session, adjust };
      return { state: record(replace(next), "recommendation.adjust", `${session.id} · ${event.templateId ?? ""} ${event.planId ?? ""}`.trim()), session: next, recommendation: recommend(session.answers, adjust), preview: previewInstall(session.answers, adjust) };
    }
    case "install.confirm": {
      if (session.status === "installed") return refuse("alreadyInstalled");
      if (session.status !== "ready") return refuse("notReady");
      const rec = recommend(session.answers, session.adjust);
      if (!rec) return refuse("notReady");
      const result = installBusinessTemplate({ templateId: rec.template.id, tenantId, companyName: session.answers.businessName ?? "Empresa", owner: { id: session.ownerId, name: session.ownerName, email: session.ownerEmail }, at, overrides: rec.overrides }, event.parts ?? emptyParts());
      if (!("parts" in result) || result.errors.length > 0) {
        const failure = result.errors.slice(0, 3).join("; ");
        const failed: Session = { ...session, status: "failed", failure };
        return { state: record(replace(failed), "install.failed", `${session.id} · ${failure}`), error: `No se pudo instalar: ${failure}`, errorCode: "installFailed", session: failed };
      }
      const done: Session = { ...session, status: "installed", installedAt: at, templateId: rec.template.id, planId: rec.plan.id, installed: { steps: result.steps.length, agents: rec.agents.count, automations: rec.automations.length, workers: rec.workers.length, teams: rec.teams.length } };
      return { state: record(replace(done), "install.confirm", `${session.id} · ${rec.template.id} · ${rec.plan.id}`), session: done, installation: result, recommendation: rec };
    }
    case "session.cancel": {
      if (session.status === "installed" || session.status === "cancelled") return refuse("invalidTransition", session.status);
      const cancelled: Session = { ...session, status: "cancelled" };
      return { state: record(replace(cancelled), "session.cancel", session.id), session: cancelled };
    }
    default: return refuse("invalid");
  }
}

export function applyArchitectEvents(state: ArchitectState, events: readonly ArchitectEvent[]): { state: ArchitectState; errors: string[] } {
  const errors: string[] = [];
  let current = state;
  for (const event of events) { const result = reduceArchitect(current, event); if (result.error) errors.push(`${event.type}: ${result.error}`); current = result.state; }
  return { state: current, errors };
}

// ---------------------------------------------------------------- the tables this module will need (a contract only: no migration)
/** Both are a company's (tenant_id); members read and writes go through functions; the trail is append-only. */
export const ARCHITECT_TABLES = [{ table: "architect_sessions", appendOnly: false }, { table: "architect_audit", appendOnly: true }] as const;
export const TEMPLATE_COUNT = BUSINESS_TEMPLATES.length;
