// KOE (KYNOVA Orchestration Engine): the registries the engine reads. A Worker is DATA (a definition) over a registry of
// tools and a registry of models, so a new Worker, tool or model is a new entry, never a change to the engine.
//
// - Tools: each declares what it reads and writes, whether it acts outside the platform, and its autonomy level, which
//   comes from the single catalog in workers.ts (the level is decided by code, and anything unknown is Level 3).
// - Models: provider-neutral. A task asks for capabilities and a data clearance; the router picks a model by policy and
//   health, never by vendor name, and falls back to the next one. Real calls will go only through lib/ai/ and AI Gateway.
// - Memory: bounded, ephemeral by default, and never a place for secrets, payment data or personal data it was not cleared for.

import { levelForAction, type AutonomyLevel } from "./workers";

// ---------------------------------------------------------------- data clearance
export const CLEARANCES = ["public", "business", "personal"] as const;
export type Clearance = (typeof CLEARANCES)[number];
export const CLEARANCE_RANK: Record<Clearance, number> = { public: 0, business: 1, personal: 2 };
export const covers = (held: Clearance, needed: Clearance): boolean => CLEARANCE_RANK[held] >= CLEARANCE_RANK[needed];

// ---------------------------------------------------------------- tools
export type ToolManifest = {
  id: string; // the action key in the autonomy catalog (workers.ts)
  label: string;
  description: string;
  reads: readonly string[];
  writes: readonly string[];
  externalEffect: boolean; // acts outside the platform: always Level 3
  financial: boolean; // moves money: a person other than the initiator approves
  dataAccess: Clearance;
  required: readonly string[]; // input fields the tool needs
};
export type ToolEntry = { manifest: ToolManifest; status: "active" | "pending"; registeredBy: string; approvedBy?: string };

const tool = (id: string, label: string, description: string, over: Partial<ToolManifest> = {}): ToolManifest => ({ id, label, description, reads: [], writes: [], externalEffect: false, financial: false, dataAccess: "business", required: [], ...over });

export const BASE_TOOLS: readonly ToolManifest[] = [
  tool("contact.read", "Leer contacto", "Consulta los datos de un contacto.", { reads: ["contacts"], dataAccess: "personal", required: ["contacto"] }),
  tool("lead.score", "Calificar prospecto", "Calcula el Business Score de un prospecto.", { reads: ["leads"], required: ["prospecto"] }),
  tool("summary.prepare", "Preparar resumen", "Redacta un resumen para una persona.", { reads: ["leads", "customers"], required: ["tema"] }),
  tool("message.draft", "Redactar mensaje", "Prepara un mensaje sin enviarlo.", { reads: ["contacts"], dataAccess: "personal", required: ["contacto", "tema"] }),
  tool("task.create", "Crear tarea", "Crea una tarea interna con fecha.", { writes: ["tasks"], required: ["titulo"] }),
  tool("faq.answer", "Responder pregunta frecuente", "Responde con contenido aprobado.", { reads: ["faq"], required: ["pregunta"] }),
  tool("followup.send", "Enviar seguimiento", "Envía un mensaje de seguimiento al contacto.", { reads: ["contacts"], writes: ["messages"], externalEffect: true, dataAccess: "personal", required: ["contacto", "mensaje"] }),
  tool("message.sendFirst", "Enviar primer contacto", "Envía el primer mensaje a un prospecto.", { reads: ["contacts"], writes: ["messages"], externalEffect: true, dataAccess: "personal", required: ["contacto", "mensaje"] }),
  tool("opportunity.create", "Crear oportunidad", "Abre una oportunidad en el pipeline.", { writes: ["opportunities"], required: ["prospecto"] }),
  tool("customer.create", "Crear cliente", "Convierte un prospecto en cliente.", { writes: ["customers"], dataAccess: "personal", required: ["prospecto"] }),
  tool("payment.createLink", "Crear enlace de cobro", "Genera un enlace de cobro.", { writes: ["payments"], externalEffect: true, financial: true, dataAccess: "personal", required: ["cliente", "monto"] }),
  tool("payment.refund", "Reembolsar", "Solicita un reembolso.", { writes: ["payments"], externalEffect: true, financial: true, dataAccess: "personal", required: ["pago", "monto"] }),
  tool("calendar.write", "Escribir en el calendario", "Crea o cambia un evento.", { writes: ["calendar"], externalEffect: true, dataAccess: "personal", required: ["evento"] }),
  tool("academy.tutorAnswer", "Responder como tutor", "Responde una duda con el material del curso.", { reads: ["courses"], required: ["pregunta"] }),
  tool("marketplace.draftListing", "Preparar publicación", "Deja un borrador de publicación.", { writes: ["listings"], required: ["nombre"] }),
];

export function validateTool(manifest: ToolManifest): string[] {
  const issues: string[] = [];
  if (!/^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/.test(manifest.id)) issues.push("identificador (area.accion)");
  if (manifest.label.trim() === "" || manifest.description.trim() === "") issues.push("nombre y descripción");
  const level = levelForAction(manifest.id); // an action missing from the catalog is Level 3
  if (manifest.externalEffect && level !== 3) issues.push("una herramienta que actúa fuera de la plataforma debe ser de Nivel 3");
  if (manifest.financial && (!manifest.externalEffect || level !== 3)) issues.push("una herramienta que mueve dinero debe ser externa y de Nivel 3");
  return issues;
}

export const toolLevel = (manifest: Pick<ToolManifest, "id">): AutonomyLevel => levelForAction(manifest.id);

// ---------------------------------------------------------------- models (provider-neutral)
export const MODEL_CLASSES = ["reasoning", "fast", "vision", "code", "longContext", "embedding", "multilingual"] as const;
export type ModelClass = (typeof MODEL_CLASSES)[number];
export type DataPolicy = "noTraining" | "mayTrain" | "unknown";
export type Health = "healthy" | "degraded" | "down";

export type ModelManifest = {
  id: string;
  provider: string; // an opaque label; the router never branches on it except through policy lists
  label: string;
  classes: readonly ModelClass[];
  maxContextTokens: number;
  costMicrosPer1k: number; // millionths of a dollar per 1 000 tokens, an integer
  dataPolicy: DataPolicy;
  regions: readonly string[];
  supportsTools: boolean;
  health: Health;
  enabled: boolean;
};

const model = (id: string, provider: string, label: string, classes: ModelClass[], maxContextTokens: number, costMicrosPer1k: number, dataPolicy: DataPolicy, regions: string[], supportsTools: boolean): ModelManifest => ({ id, provider, label, classes, maxContextTokens, costMicrosPer1k, dataPolicy, regions, supportsTools, health: "healthy", enabled: true });

// Illustrative catalog with neutral provider names. The real one is loaded from the AI Gateway configuration.
export const BASE_MODELS: readonly ModelManifest[] = [
  model("m-fast-a", "proveedor-a", "Rápido A", ["fast", "multilingual"], 32_000, 200, "noTraining", ["us", "eu"], true),
  model("m-reason-b", "proveedor-b", "Razonamiento B", ["reasoning", "longContext", "multilingual", "code"], 200_000, 3_000, "noTraining", ["us"], true),
  model("m-reason-c", "proveedor-c", "Razonamiento C", ["reasoning", "multilingual"], 64_000, 1_500, "unknown", ["eu"], true),
  model("m-vision-d", "proveedor-d", "Visión D", ["vision", "fast"], 16_000, 800, "noTraining", ["us", "eu"], false),
  model("m-embed-a", "proveedor-a", "Embeddings A", ["embedding"], 8_000, 20, "noTraining", ["us", "eu"], false),
];

export function validateModel(manifest: ModelManifest): string[] {
  const issues: string[] = [];
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(manifest.id)) issues.push("identificador");
  if (manifest.provider.trim() === "" || manifest.label.trim() === "") issues.push("proveedor y nombre");
  if (manifest.classes.length === 0 || manifest.classes.some((item) => !MODEL_CLASSES.includes(item))) issues.push("capacidades");
  if (!Number.isSafeInteger(manifest.maxContextTokens) || manifest.maxContextTokens < 1_000) issues.push("contexto máximo");
  if (!Number.isSafeInteger(manifest.costMicrosPer1k) || manifest.costMicrosPer1k < 0) issues.push("costo");
  if (manifest.regions.length === 0) issues.push("regiones");
  return issues;
}

export type TaskProfile = { needs: readonly ModelClass[]; dataClearance: Clearance; contextTokens: number; needsTools: boolean; region?: string };
export type RoutingPolicy = { allowedProviders?: readonly string[]; deniedProviders?: readonly string[]; maxCostMicrosPer1k?: number };

export type RouteCandidate = { model: ModelManifest; accepted: boolean; reasons: string[] };
export type RouteResult = { chosen: ModelManifest | null; fallbackUsed: boolean; candidates: RouteCandidate[]; reason: string };

/** Why a model cannot serve a task. Empty when it can. Data policy is a hard rule, not a preference. */
export function rejections(candidate: ModelManifest, task: TaskProfile, policy: RoutingPolicy, ignoreHealth = false): string[] {
  const reasons: string[] = [];
  if (!candidate.enabled) reasons.push("desactivado");
  if (!ignoreHealth && candidate.health === "down") reasons.push("caído");
  const missing = task.needs.filter((need) => !candidate.classes.includes(need));
  if (missing.length) reasons.push(`le falta: ${missing.join(", ")}`);
  if (candidate.maxContextTokens < task.contextTokens) reasons.push("contexto insuficiente");
  if (task.needsTools && !candidate.supportsTools) reasons.push("no admite herramientas");
  if (task.region && !candidate.regions.includes(task.region)) reasons.push(`no opera en ${task.region}`);
  if (task.dataClearance === "personal" && candidate.dataPolicy !== "noTraining") reasons.push("datos personales exigen «no entrena con sus datos»");
  if (task.dataClearance === "business" && candidate.dataPolicy === "mayTrain") reasons.push("puede entrenar con datos del negocio");
  if (policy.allowedProviders && !policy.allowedProviders.includes(candidate.provider)) reasons.push("proveedor no permitido");
  if (policy.deniedProviders?.includes(candidate.provider)) reasons.push("proveedor excluido");
  if (policy.maxCostMicrosPer1k !== undefined && candidate.costMicrosPer1k > policy.maxCostMicrosPer1k) reasons.push("supera el costo máximo");
  return reasons;
}

export type ModelAvailability = { model: ModelManifest; usable: boolean; reasons: string[] };

/**
 * Which models a Worker may use at all, judged against the most demanding task it is allowed to do (its capabilities, its
 * highest data clearance, tools). Health is left out on purpose: it changes by the minute, eligibility does not.
 * The company's own excluded providers add to the Worker's policy.
 */
export function modelAvailability(models: readonly ModelManifest[], definition: Pick<WorkerDefinition, "routing" | "dataClearance">, excludedByCompany: readonly string[] = []): ModelAvailability[] {
  const policy: RoutingPolicy = { ...definition.routing.policy, deniedProviders: [...(definition.routing.policy.deniedProviders ?? []), ...excludedByCompany] };
  const task: TaskProfile = { needs: definition.routing.needs, dataClearance: definition.dataClearance, contextTokens: 2_000, needsTools: true };
  return models.map((model) => {
    const reasons = rejections(model, task, policy, true);
    return { model, usable: reasons.length === 0, reasons };
  });
}

const HEALTH_RANK: Record<Health, number> = { healthy: 0, degraded: 1, down: 2 };

/**
 * Picks the cheapest healthy model that satisfies the task, else the cheapest degraded one. If a better model exists only
 * because of its health, `fallbackUsed` says the router moved down the list. No vendor is ever named in the logic.
 */
export function routeModel(models: readonly ModelManifest[], task: TaskProfile, policy: RoutingPolicy = {}): RouteResult {
  const candidates: RouteCandidate[] = models.map((candidate) => ({ model: candidate, reasons: rejections(candidate, task, policy), accepted: false }));
  for (const entry of candidates) entry.accepted = entry.reasons.length === 0;
  const order = (a: ModelManifest, b: ModelManifest) => HEALTH_RANK[a.health] - HEALTH_RANK[b.health] || a.costMicrosPer1k - b.costMicrosPer1k || a.id.localeCompare(b.id);
  const chosen = candidates.filter((entry) => entry.accepted).map((entry) => entry.model).sort(order)[0] ?? null;
  const ideal = models.filter((candidate) => rejections(candidate, task, policy, true).length === 0).sort((a, b) => a.costMicrosPer1k - b.costMicrosPer1k || a.id.localeCompare(b.id))[0] ?? null;
  const fallbackUsed = Boolean(chosen && ideal && chosen.id !== ideal.id);
  const reason = chosen
    ? fallbackUsed ? `${chosen.label} (respaldo: ${ideal?.label} no está disponible)` : chosen.label
    : `ninguno cumple: ${[...new Set(candidates.flatMap((entry) => entry.reasons))].slice(0, 4).join("; ")}`;
  return { chosen, fallbackUsed, candidates, reason };
}

// ---------------------------------------------------------------- worker definitions
export const SPECIALTIES = ["coordination", "sales", "followup", "analysis", "collections", "education", "support", "marketplace", "custom"] as const;
export type Specialty = (typeof SPECIALTIES)[number];
export type DefinitionStatus = "draft" | "pendingReview" | "active" | "retired";

export type WorkerDefinition = {
  id: string;
  ownerTenantId: string; // "platform" for KYNOVA's own Workers
  origin: "kynova" | "tenant";
  name: string;
  specialty: Specialty;
  summary: string;
  version: string;
  tools: readonly string[];
  dataClearance: Clearance; // the most sensitive data this Worker may handle
  memory: { maxEntries: number; maxChars: number; allowPersonal: boolean; durable: boolean };
  routing: { needs: readonly ModelClass[]; policy: RoutingPolicy };
  collaboration: { delegatesTo: readonly string[]; acceptsFrom: readonly string[] }; // Worker ids; "*" accepts from any
  limits: { maxRunsPerDay: number; maxStepsPerRun: number; maxDelegationDepth: number };
  status: DefinitionStatus;
  createdBy: string;
  submittedBy?: string;
};

export const PLATFORM_OWNER = "platform";
export const MAX_DELEGATION_DEPTH = 3;

export function validateWorker(definition: WorkerDefinition, tools: Record<string, ToolEntry>): string[] {
  const issues: string[] = [];
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(definition.id)) issues.push("identificador");
  if (definition.name.trim() === "" || definition.name.length > 80) issues.push("nombre (1 a 80 caracteres)");
  if (!SPECIALTIES.includes(definition.specialty)) issues.push("especialidad");
  if (definition.summary.trim() === "") issues.push("resumen");
  if (!/^\d+\.\d+\.\d+$/.test(definition.version)) issues.push("versión semántica");
  if (definition.tools.length === 0) issues.push("al menos una herramienta");
  if (new Set(definition.tools).size !== definition.tools.length) issues.push("herramientas repetidas");
  for (const id of definition.tools) {
    const entry = tools[id];
    if (!entry || entry.status !== "active") issues.push(`herramienta desconocida o pendiente: ${id}`);
    else if (!covers(definition.dataClearance, entry.manifest.dataAccess)) issues.push(`«${id}» maneja datos «${entry.manifest.dataAccess}» y el Worker solo está habilitado para «${definition.dataClearance}»`);
  }
  const { memory, limits, collaboration, routing } = definition;
  if (!Number.isInteger(memory.maxEntries) || memory.maxEntries < 1 || memory.maxEntries > 200) issues.push("entradas de memoria (1 a 200)");
  if (!Number.isInteger(memory.maxChars) || memory.maxChars < 100 || memory.maxChars > 20_000) issues.push("caracteres de memoria (100 a 20 000)");
  if (memory.allowPersonal && definition.dataClearance !== "personal") issues.push("memoria con datos personales sin habilitación para datos personales");
  if (!Number.isInteger(limits.maxRunsPerDay) || limits.maxRunsPerDay < 1 || limits.maxRunsPerDay > 1_000) issues.push("ejecuciones por día (1 a 1 000)");
  if (!Number.isInteger(limits.maxStepsPerRun) || limits.maxStepsPerRun < 1 || limits.maxStepsPerRun > 100) issues.push("pasos por ejecución (1 a 100)");
  if (!Number.isInteger(limits.maxDelegationDepth) || limits.maxDelegationDepth < 0 || limits.maxDelegationDepth > MAX_DELEGATION_DEPTH) issues.push(`profundidad de delegación (0 a ${MAX_DELEGATION_DEPTH})`);
  if (collaboration.delegatesTo.includes(definition.id) || collaboration.acceptsFrom.includes(definition.id)) issues.push("un Worker no colabora consigo mismo");
  if (collaboration.delegatesTo.length > 0 && limits.maxDelegationDepth === 0) issues.push("delega pero su profundidad de delegación es 0");
  if (routing.needs.length === 0 || routing.needs.some((need) => !MODEL_CLASSES.includes(need))) issues.push("capacidades de modelo que necesita");
  return issues;
}

export type AutonomySummary = { highest: AutonomyLevel; byLevel: Record<AutonomyLevel, string[]>; external: string[]; financial: string[] };

/** What a person should know before enabling a Worker: its highest autonomy level and what it can do outside or with money. */
export function autonomyOf(definition: Pick<WorkerDefinition, "tools">, tools: Record<string, ToolEntry>): AutonomySummary {
  const byLevel: Record<AutonomyLevel, string[]> = { 1: [], 2: [], 3: [] };
  const external: string[] = [];
  const financial: string[] = [];
  for (const id of definition.tools) {
    const level = levelForAction(id);
    byLevel[level].push(id);
    const manifest = tools[id]?.manifest;
    if (manifest?.externalEffect) external.push(id);
    if (manifest?.financial) financial.push(id);
  }
  const highest: AutonomyLevel = byLevel[3].length ? 3 : byLevel[2].length ? 2 : 1;
  return { highest, byLevel, external, financial };
}

const worker = (id: string, name: string, specialty: Specialty, summary: string, tools: string[], clearance: Clearance, needs: ModelClass[], delegatesTo: string[], acceptsFrom: string[], over: Partial<WorkerDefinition> = {}): WorkerDefinition => ({
  id, ownerTenantId: PLATFORM_OWNER, origin: "kynova", name, specialty, summary, version: "1.0.0", tools, dataClearance: clearance,
  memory: { maxEntries: 30, maxChars: 4_000, allowPersonal: false, durable: false },
  routing: { needs, policy: {} },
  collaboration: { delegatesTo, acceptsFrom },
  limits: { maxRunsPerDay: 100, maxStepsPerRun: 25, maxDelegationDepth: delegatesTo.length ? 2 : 0 },
  status: "active", createdBy: "kynova", ...over,
});

/** KYNOVA's own Workers. They ship as data; a company enables them, and builds its own the same way. */
export const STARTER_WORKERS: readonly WorkerDefinition[] = [
  worker("coordinator", "Coordinador", "coordination", "Recibe un objetivo, lo divide y delega en los especialistas.", ["summary.prepare", "task.create"], "business", ["reasoning"], ["sales", "followup", "reporter", "collections"], [], { memory: { maxEntries: 40, maxChars: 6_000, allowPersonal: false, durable: true }, limits: { maxRunsPerDay: 100, maxStepsPerRun: 30, maxDelegationDepth: 3 } }),
  worker("sales", "Asistente comercial", "sales", "Atiende prospectos, los califica y prepara el traspaso.", ["contact.read", "lead.score", "summary.prepare", "message.draft", "faq.answer", "message.sendFirst"], "personal", ["fast"], ["followup"], ["coordinator"]),
  worker("followup", "Seguimiento", "followup", "Que ningún prospecto se enfríe.", ["contact.read", "task.create", "message.draft", "followup.send"], "personal", ["fast"], ["reporter"], ["coordinator", "sales"]),
  worker("reporter", "Analista de reportes", "analysis", "Resume el negocio y señala lo que necesita atención.", ["summary.prepare", "lead.score"], "business", ["reasoning"], [], ["*"], { memory: { maxEntries: 30, maxChars: 8_000, allowPersonal: false, durable: true } }),
  worker("collections", "Cobranza", "collections", "Prepara recordatorios y enlaces de cobro.", ["contact.read", "message.draft", "payment.createLink"], "personal", ["fast"], [], ["coordinator"]),
  worker("tutor", "Tutor de cursos", "education", "Responde dudas con el material del curso.", ["academy.tutorAnswer"], "business", ["fast"], [], []),
];

// ---------------------------------------------------------------- working memory
export const MEMORY_DURABLE_DAYS = 30;
const SECRET_PATTERNS: readonly RegExp[] = [
  /sk_(live|test)_[A-Za-z0-9]+/,
  /AKIA[0-9A-Z]{12,}/,
  /Bearer\s+[A-Za-z0-9._-]{16,}/,
  /secret:[a-z0-9][a-z0-9-_]*/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:\d[ -]?){13,19}\b/, // something shaped like a card number
  /[A-Za-z0-9+/]{40,}={0,2}/, // a long token-like string
];
/** True when a value looks like a secret, a key or payment data: those never go into memory. */
export const looksSecret = (value: string): boolean => SECRET_PATTERNS.some((pattern) => pattern.test(value));
