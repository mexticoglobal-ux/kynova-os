// AI Studio store: where a company creates, tests and manages its prompts and AI agents. Pure and deterministic, one global
// state with every record owned by a company (tenant). Nothing here calls an AI provider: Studio only holds configuration
// (prompts, agents, versions) and runs SIMULATED tests, and every test goes through KOE.
//
// Architecture (ADR-0009 and the KOE rules):
// - KOE decides which Worker carries a test out; the Worker's definition decides which model (KOE's router, automation-koe.ts).
//   Studio records the choice, the reason, the estimated cost and time. No model is called; no provider is named in the UI.
// - Constitution: NEX only prepares drafts (Level 1). Changing what an agent is connected to (Workers, automations, courses)
//   is Level 2: it needs a standing authorization a person granted. Publishing a version and sharing across companies are
//   Level 3: always a person's approval. Versions are never overwritten: every save is a new version, history is complete.
// - Templates and sharing are only the model and the records: no Marketplace of prompts, no copy between companies yet.

import { isPerson, isWorker } from "./actors";
import { DEFAULT_KOE_ENV, failed, planExecution, type ExecutionPlan, type KoeEnv, type PlanFailure } from "./automation-koe";
import { MAX_RUN_COST_MICROS, PRIORITY_RANK, covers, looksSecret, type Clearance, type Specialty } from "./koe-registry";
import { message, type ErrorCode } from "./studio-messages";
import { decide, levelForAction, type AutonomyLevel, type Authorization } from "./workers";

export { DEFAULT_KOE_ENV, type KoeEnv } from "./automation-koe";
export type { Clearance } from "./koe-registry";

// ---------------------------------------------------------------- the closed sets
export const KINDS = ["prompt", "agent"] as const;
export type Kind = (typeof KINDS)[number];
export const CATEGORIES = ["sales", "support", "marketing", "education", "operations", "analysis", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export const CLEARANCE_LIST = ["public", "business", "personal"] as const;
export const TONES = ["formal", "friendly", "technical", "motivating"] as const;
export type Tone = (typeof TONES)[number];
export const LANGUAGES = ["es", "en", "pt", "fr"] as const;
export type Language = (typeof LANGUAGES)[number];
export const MEMORY_MODES = ["none", "session", "durable"] as const;
export type MemoryMode = (typeof MEMORY_MODES)[number];

export const MAX_BODY = 4_000;
export const MAX_VARIABLES = 20;
export const MAX_TAGS = 8;
export const MAX_WORKERS = 5;
export const MAX_LINKS = 10;
export const MAX_NOTE = 200;
export const ASSIGN_ACTION = "studio.assign";

// Every Studio action is in the single autonomy catalog (workers.ts); this maps what a person does to its level.
export const STUDIO_ACTIONS = { draft: "studio.draft", test: "studio.test", assign: ASSIGN_ACTION, publish: "studio.publish", share: "studio.share" } as const;
export const levelOfStudio = (action: keyof typeof STUDIO_ACTIONS): AutonomyLevel => levelForAction(STUDIO_ACTIONS[action]);

// ---------------------------------------------------------------- content
export type VariableSpec = { name: string; description: string; example: string };
export type PromptContent = { kind: "prompt"; body: string; variables: readonly VariableSpec[]; clearance: Clearance };
export type Memory = { mode: MemoryMode; maxEntries: number; maxChars: number };
export type Personality = { tone: Tone; language: Language; style: string };
export type Limits = { maxRunsPerDay: number; maxStepsPerRun: number; maxCostMicrosPerRun: number };
export type AgentContent = {
  kind: "agent"; promptId: string; workerIds: readonly string[]; automationIds: readonly string[]; courseIds: readonly string[];
  memory: Memory; personality: Personality; limits: Limits; clearance: Clearance;
};
export type Content = PromptContent | AgentContent;

export type VersionState = "draft" | "pendingApproval" | "published" | "rejected" | "superseded";
// The content of a version never changes after it is saved; only its state moves, and every move is recorded.
export type Version = {
  id: string; number: number; state: VersionState; content: Content; note: string; createdBy: string; createdAt: string;
  submittedBy?: string; submittedAt?: string; decidedBy?: string; decidedAt?: string; decisionNote?: string;
};

export type TemplateSource = { origin: "own" | "duplicate" | "template" | "shared"; ref?: string; version?: number };
export type AssetStatus = "draft" | "inReview" | "published" | "archived";
export type Asset = {
  id: string; tenantId: string; kind: Kind; name: string; description: string; category: Category; tags: readonly string[];
  versions: readonly Version[]; publishedNumber?: number; archived: boolean; source: TemplateSource;
  createdBy: string; createdAt: string; updatedAt: string;
};

export type Model = { id: string; label: string };
export type TestRun = {
  id: string; tenantId: string; assetId: string; assetName: string; kind: Kind; versionId: string; versionNumber: number; at: string; by: string;
  inputs: Readonly<Record<string, string>>; rendered: string; output: string;
  // what KOE decided: the Worker, the model its router chose and why; the cost and time are estimates, not measurements
  workerId: string; workerName: string; workerReason: string; priority: string; model: Model; modelReason: string;
  tokensIn: number; tokensOut: number; estimatedCostMicros: number; estimatedMs: number; level: AutonomyLevel; compareGroup?: string;
};

export type AgentTemplateContent = Omit<AgentContent, "promptId" | "workerIds" | "automationIds" | "courseIds">;
type TemplateBase = { id: string; tenantId: string; version: number; author: string; company: string; source: TemplateSource; name: string; description: string; category: Category; tags: readonly string[]; fromAssetId: string; createdAt: string };
// Ready for a future library or Marketplace: who wrote it, for which company, from where and which version. Not listed anywhere yet.
export type PromptTemplate = TemplateBase & { kind: "prompt"; content: PromptContent };
export type AgentTemplate = TemplateBase & { kind: "agent"; content: AgentTemplateContent };
export type Template = PromptTemplate | AgentTemplate;

export type ShareStatus = "proposed" | "approved" | "revoked";
// Architecture only: an approved share is a record. Nothing is copied or shown to the other company yet.
export type Share = { id: string; fromTenantId: string; toTenantId: string; assetId: string; versionNumber: number; status: ShareStatus; proposedBy: string; proposedAt: string; decidedBy?: string; decidedAt?: string };
export type Grant = { id: string; tenantId: string; action: typeof ASSIGN_ACTION; status: "active" | "revoked"; maxPerDay?: number; expiresAt?: string; grantedBy: string; grantedAt: string };

export type StudioAudit = { at: string; actor: string; tenantId: string; action: string; detail?: string };
export type StudioLog = { at: string; level: "info" | "warn"; event: string };
export type StudioState = {
  assets: readonly Asset[]; tests: readonly TestRun[]; templates: readonly Template[]; shares: readonly Share[]; grants: readonly Grant[];
  audit: readonly StudioAudit[]; logs: readonly StudioLog[]; sequence: number;
};
export const newStudioState = (): StudioState => ({ assets: [], tests: [], templates: [], shares: [], grants: [], audit: [], logs: [], sequence: 0 });

/** What Studio can link an agent to, from other modules (read-only references by id; never their internals). */
export type Ref = { id: string; tenantId: string; name: string };
export type StudioEnv = KoeEnv & { refs: { automations: readonly Ref[]; courses: readonly Ref[] } };
export const DEFAULT_STUDIO_ENV: StudioEnv = { ...DEFAULT_KOE_ENV, refs: { automations: [], courses: [] } };

// ---------------------------------------------------------------- variables and templates
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;
const VAR_NAME = /^[a-z][a-zA-Z0-9_]{0,29}$/;
const TAG = /^[a-z0-9][a-z0-9-]{0,23}$/;
export const placeholdersOf = (body: string): string[] => [...new Set([...body.matchAll(PLACEHOLDER)].map((match) => match[1]))];
const clean = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim().slice(0, 1_000);

/** Fills the placeholders with the test input. A value is data: it is never expanded again. */
export function renderPrompt(body: string, inputs: Readonly<Record<string, string>>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = body.replace(PLACEHOLDER, (_, name: string) => {
    const value = clean(inputs[name] ?? "");
    if (value === "") missing.push(name);
    return value;
  });
  return { text, missing: [...new Set(missing)] };
}

/** Declares exactly the variables the body uses, keeping what was already described. */
export const declareVariables = (body: string, current: readonly VariableSpec[] = []): VariableSpec[] =>
  placeholdersOf(body).map((name) => current.find((item) => item.name === name) ?? { name, description: "", example: "" });

// ---------------------------------------------------------------- validation
type Lookup = { assets: readonly Asset[]; env: StudioEnv; tenantId: string };
const dupes = (items: readonly string[]) => new Set(items).size !== items.length;

export function validateMeta(meta: { name: string; description: string; category: Category; tags: readonly string[] }): string[] {
  const issues: string[] = [];
  if (meta.name.trim() === "" || meta.name.length > 80) issues.push("nombre (1 a 80 caracteres)");
  if (meta.description.length > 300) issues.push("descripción (hasta 300 caracteres)");
  if (!CATEGORIES.includes(meta.category)) issues.push("categoría");
  if (meta.tags.length > MAX_TAGS) issues.push(`hasta ${MAX_TAGS} etiquetas`);
  if (meta.tags.some((tag) => !TAG.test(tag))) issues.push("etiquetas (minúsculas, números y guiones, hasta 24 caracteres)");
  if (dupes(meta.tags)) issues.push("etiquetas repetidas");
  return issues;
}

function validatePrompt(content: PromptContent): string[] {
  const issues: string[] = [];
  if (content.body.trim() === "") issues.push("el texto del prompt");
  if (content.body.length > MAX_BODY) issues.push(`el texto supera ${MAX_BODY} caracteres`);
  if (looksSecret(content.body)) issues.push("el texto parece contener un secreto o una clave");
  if (!CLEARANCE_LIST.includes(content.clearance)) issues.push("nivel de datos");
  const used = placeholdersOf(content.body);
  const declared = content.variables.map((item) => item.name);
  if (used.length > MAX_VARIABLES) issues.push(`hasta ${MAX_VARIABLES} variables`);
  for (const name of used) if (!VAR_NAME.test(name)) issues.push(`variable «${name}»: use letras, números y guion bajo, empezando por minúscula`);
  if (dupes(declared)) issues.push("variables repetidas");
  for (const name of used) if (VAR_NAME.test(name) && !declared.includes(name)) issues.push(`la variable «${name}» se usa pero no está declarada`);
  for (const name of declared) if (!used.includes(name)) issues.push(`la variable «${name}» está declarada pero no se usa`);
  for (const item of content.variables) {
    if (item.description.length > 200) issues.push(`variable «${item.name}»: la descripción supera 200 caracteres`);
    if (item.example.length > 200 || looksSecret(item.example)) issues.push(`variable «${item.name}»: ejemplo no válido`);
  }
  return issues;
}

function validateAgent(content: AgentContent, lookup: Lookup): string[] {
  const issues: string[] = [];
  const { env, tenantId } = lookup;
  if (!CLEARANCE_LIST.includes(content.clearance)) issues.push("nivel de datos");
  const prompt = lookup.assets.find((item) => item.id === content.promptId && item.kind === "prompt");
  if (!prompt || prompt.tenantId !== tenantId) issues.push("prompt principal (elija un prompt de su empresa)");
  else {
    const last = prompt.versions.at(-1)?.content;
    if (last?.kind === "prompt" && !covers(content.clearance, last.clearance)) issues.push("el nivel de datos del agente no cubre el del prompt principal");
  }
  if (content.workerIds.length > MAX_WORKERS) issues.push(`hasta ${MAX_WORKERS} Workers`);
  if (dupes(content.workerIds)) issues.push("Workers repetidos");
  for (const id of content.workerIds) {
    const plan = planExecution(env, tenantId, id, { tools: ["summary.prepare"], clearance: content.clearance });
    if (failed(plan)) issues.push(`Worker «${id}»: ${plan.problem}`);
  }
  for (const [field, ids, refs] of [["automatización", content.automationIds, env.refs.automations], ["curso", content.courseIds, env.refs.courses]] as const) {
    if (ids.length > MAX_LINKS) issues.push(`hasta ${MAX_LINKS} ${field}es`);
    if (dupes(ids)) issues.push(`${field}es repetidos`);
    for (const id of ids) if (!refs.some((ref) => ref.id === id && ref.tenantId === tenantId)) issues.push(`${field} «${id}» no existe en su empresa`);
  }
  const { memory, personality, limits } = content;
  if (!MEMORY_MODES.includes(memory.mode)) issues.push("modo de memoria");
  if (!Number.isInteger(memory.maxEntries) || memory.maxEntries < 1 || memory.maxEntries > 100) issues.push("memoria: entradas de 1 a 100");
  if (!Number.isInteger(memory.maxChars) || memory.maxChars < 100 || memory.maxChars > 10_000) issues.push("memoria: caracteres de 100 a 10000");
  if (memory.mode === "durable" && content.clearance === "personal") issues.push("la memoria duradera no admite datos personales");
  if (!TONES.includes(personality.tone)) issues.push("tono");
  if (!LANGUAGES.includes(personality.language)) issues.push("idioma");
  if (personality.style.length > 300 || looksSecret(personality.style)) issues.push("estilo (hasta 300 caracteres, sin secretos)");
  if (!Number.isInteger(limits.maxRunsPerDay) || limits.maxRunsPerDay < 1 || limits.maxRunsPerDay > 1_000) issues.push("límite: ejecuciones por día de 1 a 1000");
  if (!Number.isInteger(limits.maxStepsPerRun) || limits.maxStepsPerRun < 1 || limits.maxStepsPerRun > 50) issues.push("límite: pasos por ejecución de 1 a 50");
  if (!Number.isInteger(limits.maxCostMicrosPerRun) || limits.maxCostMicrosPerRun < 1 || limits.maxCostMicrosPerRun > MAX_RUN_COST_MICROS) issues.push(`límite: costo por ejecución de 1 a ${MAX_RUN_COST_MICROS} millonésimas`);
  return issues;
}

export function validateContent(kind: Kind, content: Content, lookup: Lookup): string[] {
  if (content.kind !== kind) return ["el contenido no corresponde al tipo"];
  return content.kind === "prompt" ? validatePrompt(content) : validateAgent(content, lookup);
}

// ---------------------------------------------------------------- KOE: which Worker, which model, at what cost
const CATEGORY_SPECIALTY: Record<Category, Specialty | null> = { sales: "sales", support: "followup", marketing: "sales", education: "education", operations: "coordination", analysis: "analysis", other: null };
export type Choice = { plan: ExecutionPlan; reason: string };

/** KOE picks the Worker (a company's agent may narrow the pool); the Worker's definition decides the model. Nothing is called. */
export function chooseWorker(env: KoeEnv, tenantId: string, category: Category, clearance: Clearance, pool?: readonly string[]): Choice | PlanFailure {
  const ids = pool && pool.length > 0 ? pool : env.workers.map((item) => item.id);
  const results = ids.map((id) => planExecution(env, tenantId, id, { tools: ["summary.prepare"], clearance }));
  const ok = results.filter((item): item is ExecutionPlan => !failed(item));
  if (ok.length === 0) return { problem: pool && pool.length ? results.filter(failed).map((item) => item.problem).join("; ") : "ningún Worker puede ejecutar un prompt con estos datos" };
  const wanted = CATEGORY_SPECIALTY[category];
  const match = (plan: ExecutionPlan) => (plan.worker.specialty === wanted ? 0 : 1);
  const best = [...ok].sort((a, b) => match(a) - match(b) || PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || a.estimatedCostMicros - b.estimatedCostMicros || a.worker.id.localeCompare(b.worker.id))[0];
  const why = match(best) === 0 ? `su especialidad coincide con la categoría` : ok.length > 1 ? "mayor prioridad y menor costo entre los que pueden ejecutarlo" : "es el único que puede ejecutarlo";
  return { plan: best, reason: `${pool && pool.length ? "uno de los Workers del agente; " : ""}${why}` };
}

const tokensOf = (text: string) => Math.max(1, Math.ceil(text.length / 4));
/** Estimates, not measurements: the Worker's cost per run plus the model's cost per 1 000 tokens, and a time that grows with size. */
export function estimate(env: KoeEnv, plan: ExecutionPlan, rendered: string, output: string): { tokensIn: number; tokensOut: number; costMicros: number; ms: number } {
  const tokensIn = tokensOf(rendered);
  const tokensOut = tokensOf(output);
  const perK = env.models.find((model) => model.id === plan.model.id)?.costMicrosPer1k ?? 0;
  const reasoning = plan.worker.routing.needs.includes("reasoning");
  return { tokensIn, tokensOut, costMicros: plan.estimatedCostMicros + Math.ceil(((tokensIn + tokensOut) / 1_000) * perK), ms: 300 + (tokensIn + tokensOut) * (reasoning ? 6 : 2) };
}

export const simulateOutput = (plan: ExecutionPlan, rendered: string): string => `[Simulación] ${plan.worker.name} respondería a: «${rendered.slice(0, 160)}${rendered.length > 160 ? "…" : ""}». Ningún modelo fue llamado.`;

// ---------------------------------------------------------------- events
type Base = { at: string; tenantId: string; actor: string };
export type Meta = { name: string; description: string; category: Category; tags: readonly string[] };
export type StudioEvent =
  | (Base & { type: "asset.create"; kind: Kind; meta: Meta; content: Content; note?: string })
  | (Base & { type: "asset.update"; assetId: string; meta: Meta })
  | (Base & { type: "asset.save"; assetId: string; content: Content; note?: string })
  | (Base & { type: "asset.duplicate"; assetId: string })
  | (Base & { type: "asset.archive"; assetId: string; archived: boolean })
  | (Base & { type: "version.submit"; assetId: string; versionNumber: number })
  | (Base & { type: "version.approve"; assetId: string; versionNumber: number; note?: string })
  | (Base & { type: "version.reject"; assetId: string; versionNumber: number; note: string })
  | (Base & { type: "test.run"; assetId: string; versionNumber: number; inputs: Readonly<Record<string, string>>; workerId?: string })
  | (Base & { type: "test.compare"; assetId: string; a: number; b: number; inputs: Readonly<Record<string, string>> })
  | (Base & { type: "template.create"; assetId: string; versionNumber: number })
  | (Base & { type: "asset.fromTemplate"; templateId: string; promptId?: string })
  | (Base & { type: "share.propose"; assetId: string; versionNumber: number; toTenantId: string })
  | (Base & { type: "share.approve"; shareId: string })
  | (Base & { type: "share.revoke"; shareId: string })
  | (Base & { type: "authorization.grant"; maxPerDay?: number; expiresAt?: string })
  | (Base & { type: "authorization.revoke"; grantId: string });

export type StudioResult = { state: StudioState; error?: string; errorCode?: ErrorCode };

// ---------------------------------------------------------------- helpers
// Nothing is ever trimmed: assets, versions, tests, audit and logs all stay. Limits belong to the view (display.ts).
const append = <T,>(items: readonly T[], item: T): readonly T[] => [...items, item];
const replace = <T extends { id: string }>(items: readonly T[], item: T): readonly T[] => items.map((existing) => (existing.id === item.id ? item : existing));
const nextId = (state: StudioState, prefix: string): { id: string; state: StudioState } => {
  const sequence = state.sequence + 1;
  return { id: `${prefix}_${String(sequence).padStart(4, "0")}`, state: { ...state, sequence } };
};
const note = (state: StudioState, event: { at: string; actor: string; tenantId: string }, action: string, detail?: string, level: StudioLog["level"] = "info"): StudioState => ({
  ...state,
  audit: append(state.audit, { at: event.at, actor: event.actor, tenantId: event.tenantId, action, detail }),
  logs: append(state.logs, { at: event.at, level, event: detail ? `${action}: ${detail}` : action }),
});
const sameDay = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10);

export const latestOf = (asset: Asset): Version => asset.versions[asset.versions.length - 1];
export const versionOf = (asset: Asset, number: number): Version | undefined => asset.versions.find((item) => item.number === number);
export const publishedOf = (asset: Asset): Version | undefined => (asset.publishedNumber === undefined ? undefined : versionOf(asset, asset.publishedNumber));
export function statusOf(asset: Asset): AssetStatus {
  if (asset.archived) return "archived";
  if (asset.versions.some((item) => item.state === "pendingApproval")) return "inReview";
  return asset.publishedNumber === undefined ? "draft" : "published";
}

const linksOf = (content: Content | undefined): string => JSON.stringify(content?.kind === "agent" ? [[...content.workerIds].sort(), [...content.automationIds].sort(), [...content.courseIds].sort()] : [[], [], []]);

/** The standing authorization for Level 2 changes, if one is in force on this day and has uses left. */
function assignDecision(state: StudioState, tenantId: string, at: string): { allowed: boolean } {
  const grant = state.grants.find((item) => item.tenantId === tenantId && item.status === "active" && (!item.expiresAt || Date.parse(item.expiresAt) > Date.parse(at)));
  if (!grant) return { allowed: false };
  const usedToday = state.audit.filter((entry) => entry.tenantId === tenantId && entry.action === "agent.assign" && sameDay(entry.at, at)).length;
  const authorization: Authorization = { action: ASSIGN_ACTION, status: "active", maxPerDay: grant.maxPerDay, usedToday, expiresAt: grant.expiresAt };
  return { allowed: decide(ASSIGN_ACTION, authorization, new Date(at)).allowed };
}

// ---------------------------------------------------------------- the reducer
export function reduceStudio(state: StudioState, event: StudioEvent, env: StudioEnv = DEFAULT_STUDIO_ENV): StudioResult {
  const person = isPerson(event.actor);
  const refuse = (code: ErrorCode, params?: Record<string, string | number>): StudioResult => ({ state, error: message(code, params), errorCode: code });
  const needPerson = (): StudioResult | null => (person ? null : refuse("personRequired"));
  // NEX (a Worker) may prepare drafts; the platform ("system") and anything else may not act in Studio
  const needDrafter = (): StudioResult | null => (person || isWorker(event.actor) ? null : refuse("personRequired"));
  const lookup: Lookup = { assets: state.assets, env, tenantId: event.tenantId };
  const findAsset = (id: string): { asset?: Asset; failure?: StudioResult } => {
    const asset = state.assets.find((item) => item.id === id);
    if (!asset) return { failure: refuse("notFound") };
    if (asset.tenantId !== event.tenantId) return { failure: refuse("notYours") };
    return { asset };
  };

  const newVersion = (asset: Asset, content: Content, noteText: string, st: StudioState): { asset: Asset; state: StudioState } => {
    const made = nextId(st, "ver");
    const version: Version = { id: made.id, number: asset.versions.length + 1, state: "draft", content, note: noteText.slice(0, MAX_NOTE), createdBy: event.actor, createdAt: event.at };
    return { asset: { ...asset, versions: append(asset.versions, version), updatedAt: event.at }, state: made.state };
  };
  const checkAssign = (previous: Content | undefined, next: Content, st: StudioState): { ok: true; state: StudioState } | { ok: false; result: StudioResult } => {
    if (next.kind !== "agent" || linksOf(previous) === linksOf(next)) return { ok: true, state: st };
    if (!assignDecision(st, event.tenantId, event.at).allowed) return { ok: false, result: refuse("needsAuthorization") };
    return { ok: true, state: note(st, event, "agent.assign", `${event.actor} cambió las asignaciones`) };
  };

  switch (event.type) {
    // ---- authoring: NEX may leave drafts; everything that makes something live is a person's
    case "asset.create": {
      const denied = needDrafter();
      if (denied) return denied;
      const issues = [...validateMeta(event.meta), ...validateContent(event.kind, event.content, lookup)];
      if (issues.length) return refuse("invalid", { detail: issues[0] });
      const assigned = checkAssign(undefined, event.content, state);
      if (!assigned.ok) return assigned.result;
      const made = nextId(assigned.state, "as");
      const base: Asset = { id: made.id, tenantId: event.tenantId, kind: event.kind, ...event.meta, name: event.meta.name.trim(), versions: [], archived: false, source: { origin: "own" }, createdBy: event.actor, createdAt: event.at, updatedAt: event.at };
      const withVersion = newVersion(base, event.content, event.note ?? "Versión inicial", made.state);
      return { state: note({ ...withVersion.state, assets: append(withVersion.state.assets, withVersion.asset) }, event, "asset.create", `${made.id} · ${event.kind} · ${base.name}`) };
    }

    case "asset.update": {
      const denied = needDrafter();
      if (denied) return denied;
      const { asset, failure } = findAsset(event.assetId);
      if (!asset) return failure as StudioResult;
      if (asset.archived) return refuse("archived");
      if (!person && asset.publishedNumber !== undefined) return refuse("notEditableByAi");
      const issues = validateMeta(event.meta);
      if (issues.length) return refuse("invalid", { detail: issues[0] });
      const updated: Asset = { ...asset, ...event.meta, name: event.meta.name.trim(), updatedAt: event.at };
      return { state: note({ ...state, assets: replace(state.assets, updated) }, event, "asset.update", `${asset.id} · «${asset.name}» → «${updated.name}»`) };
    }

    case "asset.save": {
      const denied = needDrafter();
      if (denied) return denied;
      const { asset, failure } = findAsset(event.assetId);
      if (!asset) return failure as StudioResult;
      if (asset.archived) return refuse("archived");
      const issues = validateContent(asset.kind, event.content, lookup);
      if (issues.length) return refuse("invalid", { detail: issues[0] });
      const assigned = checkAssign(latestOf(asset).content, event.content, state);
      if (!assigned.ok) return assigned.result;
      const next = newVersion(asset, event.content, event.note ?? "", assigned.state); // a new version: the previous ones stay exactly as they were
      return { state: note({ ...next.state, assets: replace(next.state.assets, next.asset) }, event, "asset.save", `${asset.id} · v${next.asset.versions.length}`) };
    }

    case "asset.duplicate": {
      const denied = needDrafter();
      if (denied) return denied;
      const { asset, failure } = findAsset(event.assetId);
      if (!asset) return failure as StudioResult;
      const source = latestOf(asset);
      const assigned = checkAssign(undefined, source.content, state);
      if (!assigned.ok) return assigned.result;
      const made = nextId(assigned.state, "as");
      const base: Asset = { ...asset, id: made.id, name: `${asset.name} (copia)`.slice(0, 80), versions: [], publishedNumber: undefined, archived: false, source: { origin: "duplicate", ref: asset.id, version: source.number }, createdBy: event.actor, createdAt: event.at, updatedAt: event.at };
      const withVersion = newVersion(base, source.content, `Copia de ${asset.name} v${source.number}`, made.state);
      return { state: note({ ...withVersion.state, assets: append(withVersion.state.assets, withVersion.asset) }, event, "asset.duplicate", `${asset.id} → ${made.id}`) };
    }

    case "asset.archive": {
      const denied = needPerson();
      if (denied) return denied;
      const { asset, failure } = findAsset(event.assetId);
      if (!asset) return failure as StudioResult;
      return { state: note({ ...state, assets: replace(state.assets, { ...asset, archived: event.archived, updatedAt: event.at }) }, event, event.archived ? "asset.archive" : "asset.restore", asset.id, event.archived ? "warn" : "info") };
    }

    // ---- review: a person decides; publishing is Level 3
    case "version.submit": {
      const denied = needDrafter();
      if (denied) return denied;
      const { asset, failure } = findAsset(event.assetId);
      if (!asset) return failure as StudioResult;
      if (asset.archived) return refuse("archived");
      const version = versionOf(asset, event.versionNumber);
      if (!version) return refuse("versionNotFound");
      if (version.state !== "draft") return refuse("invalidState", { from: stateText(version.state), to: "pendiente de aprobación" });
      const issues = validateContent(asset.kind, version.content, lookup);
      if (issues.length) return refuse("invalid", { detail: issues[0] });
      const moved: Version = { ...version, state: "pendingApproval", submittedBy: event.actor, submittedAt: event.at };
      return { state: note({ ...state, assets: replace(state.assets, { ...asset, versions: asset.versions.map((item) => (item.number === moved.number ? moved : item)), updatedAt: event.at }) }, event, "version.submit", `${asset.id} · v${moved.number}`) };
    }

    case "version.approve":
    case "version.reject": {
      const denied = needPerson(); // publishing and rejecting are decisions: a person, never NEX
      if (denied) return denied;
      const { asset, failure } = findAsset(event.assetId);
      if (!asset) return failure as StudioResult;
      const version = versionOf(asset, event.versionNumber);
      if (!version) return refuse("versionNotFound");
      if (version.state !== "pendingApproval") return refuse("invalidState", { from: stateText(version.state), to: event.type === "version.approve" ? "publicada" : "rechazada" });
      if (event.type === "version.reject") {
        if (event.note.trim() === "") return refuse("invalid", { detail: "el motivo del rechazo" });
        const rejected: Version = { ...version, state: "rejected", decidedBy: event.actor, decidedAt: event.at, decisionNote: event.note.slice(0, MAX_NOTE) };
        return { state: note({ ...state, assets: replace(state.assets, { ...asset, versions: asset.versions.map((item) => (item.number === rejected.number ? rejected : item)), updatedAt: event.at }) }, event, "version.reject", `${asset.id} · v${rejected.number}`, "warn") };
      }
      const issues = validateContent(asset.kind, version.content, lookup);
      if (issues.length) return refuse("invalid", { detail: issues[0] });
      if (version.content.kind === "agent") {
        const prompt = state.assets.find((item) => item.id === (version.content as AgentContent).promptId);
        if (!prompt || prompt.publishedNumber === undefined) return refuse("promptNotPublished");
      }
      const published: Version = { ...version, state: "published", decidedBy: event.actor, decidedAt: event.at, decisionNote: event.note?.slice(0, MAX_NOTE) };
      const versions = asset.versions.map((item) => (item.number === published.number ? published : item.state === "published" ? { ...item, state: "superseded" as const } : item));
      return { state: note({ ...state, assets: replace(state.assets, { ...asset, versions, publishedNumber: published.number, updatedAt: event.at }) }, event, "version.approve", `${asset.id} · v${published.number} publicada`) };
    }

    // ---- the Playground: every test goes through KOE; nothing is called
    case "test.run":
    case "test.compare": {
      const denied = needPerson();
      if (denied) return denied;
      const { asset, failure } = findAsset(event.assetId);
      if (!asset) return failure as StudioResult;
      if (asset.archived) return refuse("archived");
      const numbers = event.type === "test.run" ? [event.versionNumber] : [event.a, event.b];
      if (event.type === "test.compare" && event.a === event.b) return refuse("invalid", { detail: "elija dos versiones distintas" });
      let next = state;
      const runs: TestRun[] = [];
      let group: string | undefined;
      if (event.type === "test.compare") { const made = nextId(next, "cg"); group = made.id; next = made.state; }
      let pinned: string | undefined = event.type === "test.run" ? event.workerId : undefined;
      for (const number of numbers) {
        const version = versionOf(asset, number);
        if (!version) return refuse("versionNotFound");
        const issues = validateContent(asset.kind, version.content, lookup);
        if (issues.length) return refuse("invalid", { detail: issues[0] });
        let promptContent: PromptContent;
        let pool: readonly string[] | undefined = pinned ? [pinned] : undefined;
        let header = "";
        let limits: Limits | undefined;
        if (version.content.kind === "prompt") promptContent = version.content;
        else {
          const agent = version.content;
          const prompt = state.assets.find((item) => item.id === agent.promptId);
          const published = prompt && publishedOf(prompt)?.content;
          if (!published || published.kind !== "prompt") return refuse("promptNotPublished");
          promptContent = published;
          pool = pinned ? [pinned] : agent.workerIds;
          header = `[${toneText(agent.personality.tone)} · ${agent.personality.language}${agent.personality.style ? ` · ${agent.personality.style}` : ""}]\n`;
          limits = agent.limits;
        }
        const rendered = renderPrompt(promptContent.body, event.inputs);
        if (rendered.missing.length) return refuse("invalid", { detail: `falta el dato «${rendered.missing[0]}»` });
        const choice = chooseWorker(env, event.tenantId, asset.category, version.content.clearance, pool);
        if ("problem" in choice) return refuse("noWorker", { detail: choice.problem });
        const text = header + rendered.text;
        const output = simulateOutput(choice.plan, text);
        const sized = estimate(env, choice.plan, text, output);
        if (limits) {
          const today = [...state.tests, ...runs].filter((item) => item.assetId === asset.id && sameDay(item.at, event.at)).length;
          if (today >= limits.maxRunsPerDay) return refuse("limitReached", { detail: `${limits.maxRunsPerDay} ejecuciones por día` });
          if (sized.costMicros > limits.maxCostMicrosPerRun) return refuse("limitReached", { detail: "el costo estimado supera el límite por ejecución" });
        }
        const made = nextId(next, "tr");
        next = made.state;
        runs.push({
          id: made.id, tenantId: event.tenantId, assetId: asset.id, assetName: asset.name, kind: asset.kind, versionId: version.id, versionNumber: version.number, at: event.at, by: event.actor,
          inputs: event.inputs, rendered: text, output, workerId: choice.plan.worker.id, workerName: choice.plan.worker.name, workerReason: choice.reason, priority: choice.plan.priority,
          model: { id: choice.plan.model.id, label: choice.plan.model.label }, modelReason: choice.plan.modelReason, tokensIn: sized.tokensIn, tokensOut: sized.tokensOut,
          estimatedCostMicros: sized.costMicros, estimatedMs: sized.ms, level: levelOfStudio("test"), compareGroup: group,
        });
        if (event.type === "test.compare") pinned = choice.plan.worker.id; // a fair comparison: both versions through the same Worker
      }
      return { state: note({ ...next, tests: [...next.tests, ...runs] }, event, event.type, `${asset.id} · ${numbers.map((n) => `v${n}`).join(" vs ")} · ${runs[0].workerName}`) };
    }

    // ---- templates and sharing: the model only
    case "template.create": {
      const denied = needPerson();
      if (denied) return denied;
      const { asset, failure } = findAsset(event.assetId);
      if (!asset) return failure as StudioResult;
      const version = versionOf(asset, event.versionNumber);
      if (!version) return refuse("versionNotFound");
      if (version.state !== "published") return refuse("notPublished");
      const made = nextId(state, "tp");
      const common = { id: made.id, tenantId: event.tenantId, version: version.number, author: version.createdBy, company: event.tenantId, source: { origin: "own" as const, ref: asset.id, version: version.number }, name: asset.name, description: asset.description, category: asset.category, tags: asset.tags, fromAssetId: asset.id, createdAt: event.at };
      let template: Template;
      if (version.content.kind === "prompt") template = { ...common, kind: "prompt", content: version.content };
      else { const { memory, personality, limits, clearance } = version.content; template = { ...common, kind: "agent", content: { kind: "agent", memory, personality, limits, clearance } }; } // links belong to a company: they do not travel
      return { state: note({ ...made.state, templates: append(made.state.templates, template) }, event, "template.create", `${made.id} · ${asset.name} v${version.number}`) };
    }

    case "asset.fromTemplate": {
      const denied = needDrafter();
      if (denied) return denied;
      const template = state.templates.find((item) => item.id === event.templateId);
      if (!template) return refuse("templateNotFound");
      if (template.tenantId !== event.tenantId) return refuse("notYours");
      const content: Content = template.kind === "prompt" ? template.content : { ...template.content, promptId: event.promptId ?? "", workerIds: [], automationIds: [], courseIds: [] };
      const meta: Meta = { name: template.name, description: template.description, category: template.category, tags: template.tags };
      const issues = [...validateMeta(meta), ...validateContent(template.kind, content, lookup)];
      if (issues.length) return refuse("invalid", { detail: issues[0] });
      const made = nextId(state, "as");
      const base: Asset = { id: made.id, tenantId: event.tenantId, kind: template.kind, ...meta, versions: [], archived: false, source: { origin: "template", ref: template.id, version: template.version }, createdBy: event.actor, createdAt: event.at, updatedAt: event.at };
      const withVersion = newVersion(base, content, `Desde la plantilla ${template.id} v${template.version}`, made.state);
      return { state: note({ ...withVersion.state, assets: append(withVersion.state.assets, withVersion.asset) }, event, "asset.fromTemplate", `${template.id} → ${made.id}`) };
    }

    case "share.propose": {
      const denied = needDrafter();
      if (denied) return denied;
      const { asset, failure } = findAsset(event.assetId);
      if (!asset) return failure as StudioResult;
      const version = versionOf(asset, event.versionNumber);
      if (!version) return refuse("versionNotFound");
      if (version.state !== "published") return refuse("notPublished");
      const to = event.toTenantId.trim();
      if (to === "" || to.length > 40) return refuse("shareInvalid", { detail: "elija la empresa destinataria" });
      if (to === event.tenantId) return refuse("shareInvalid", { detail: "no puede compartir con su propia empresa" });
      if (state.shares.some((item) => item.assetId === asset.id && item.versionNumber === version.number && item.toTenantId === to && item.status !== "revoked")) return refuse("shareInvalid", { detail: "ya existe un acuerdo para esa versión y empresa" });
      const made = nextId(state, "sh");
      const share: Share = { id: made.id, fromTenantId: event.tenantId, toTenantId: to, assetId: asset.id, versionNumber: version.number, status: "proposed", proposedBy: event.actor, proposedAt: event.at };
      return { state: note({ ...made.state, shares: append(made.state.shares, share) }, event, "share.propose", `${made.id} · ${asset.name} v${version.number} → ${to}`) };
    }

    case "share.approve":
    case "share.revoke": {
      const denied = needPerson();
      if (denied) return denied;
      const share = state.shares.find((item) => item.id === event.shareId);
      if (!share) return refuse("notFound");
      if (share.fromTenantId !== event.tenantId) return refuse("notYours");
      if (event.type === "share.approve" ? share.status !== "proposed" : share.status === "revoked") return refuse("shareClosed");
      const status: ShareStatus = event.type === "share.approve" ? "approved" : "revoked";
      return { state: note({ ...state, shares: replace(state.shares, { ...share, status, decidedBy: event.actor, decidedAt: event.at }) }, event, event.type, share.id, status === "revoked" ? "warn" : "info") };
    }

    // ---- Level 2: a standing authorization a person grants
    case "authorization.grant": {
      const denied = needPerson();
      if (denied) return denied;
      if (event.maxPerDay !== undefined && (!Number.isInteger(event.maxPerDay) || event.maxPerDay < 1 || event.maxPerDay > 100)) return refuse("invalid", { detail: "usos por día de 1 a 100" });
      if (event.expiresAt !== undefined && !(Date.parse(event.expiresAt) > Date.parse(event.at))) return refuse("invalid", { detail: "la fecha de vencimiento debe ser futura" });
      const made = nextId(state, "gr");
      const grant: Grant = { id: made.id, tenantId: event.tenantId, action: ASSIGN_ACTION, status: "active", maxPerDay: event.maxPerDay, expiresAt: event.expiresAt, grantedBy: event.actor, grantedAt: event.at };
      return { state: note({ ...made.state, grants: append(made.state.grants, grant) }, event, "authorization.grant", `${made.id} · ${ASSIGN_ACTION}`) };
    }

    case "authorization.revoke": {
      const denied = needPerson();
      if (denied) return denied;
      const grant = state.grants.find((item) => item.id === event.grantId);
      if (!grant) return refuse("authorizationNotFound");
      if (grant.tenantId !== event.tenantId) return refuse("notYours");
      return { state: note({ ...state, grants: replace(state.grants, { ...grant, status: "revoked" }) }, event, "authorization.revoke", grant.id, "warn") };
    }
  }
}

const stateText = (state: VersionState): string => ({ draft: "en borrador", pendingApproval: "pendiente de aprobación", published: "publicada", rejected: "rechazada", superseded: "reemplazada" })[state];
const toneText = (tone: Tone): string => ({ formal: "Formal", friendly: "Cercano", technical: "Técnico", motivating: "Motivador" })[tone];

export function applyAllStudio(state: StudioState, events: readonly StudioEvent[], env: StudioEnv = DEFAULT_STUDIO_ENV): { state: StudioState; errors: string[] } {
  const errors: string[] = [];
  let current = state;
  for (const event of events) {
    const result = reduceStudio(current, event, env);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    current = result.state;
  }
  return { state: current, errors };
}

// ---------------------------------------------------------------- views
export const assetsOf = (state: StudioState, tenantId: string, kind?: Kind) => state.assets.filter((item) => item.tenantId === tenantId && (!kind || item.kind === kind));
export const testsOf = (state: StudioState, tenantId: string) => state.tests.filter((item) => item.tenantId === tenantId);
export const templatesOf = (state: StudioState, tenantId: string) => state.templates.filter((item) => item.tenantId === tenantId);
export const sharesOf = (state: StudioState, tenantId: string) => state.shares.filter((item) => item.fromTenantId === tenantId);
export const grantsOf = (state: StudioState, tenantId: string) => state.grants.filter((item) => item.tenantId === tenantId);

export type StudioStats = {
  prompts: Record<AssetStatus, number>; agents: Record<AssetStatus, number>; versions: number; pendingApprovals: number;
  tests: number; estimatedCostMicros: number; templates: number; shares: Record<ShareStatus, number>;
};
export function studioStats(state: StudioState, tenantId: string): StudioStats {
  const count = (kind: Kind): Record<AssetStatus, number> => {
    const mine = assetsOf(state, tenantId, kind);
    return { draft: mine.filter((a) => statusOf(a) === "draft").length, inReview: mine.filter((a) => statusOf(a) === "inReview").length, published: mine.filter((a) => statusOf(a) === "published").length, archived: mine.filter((a) => statusOf(a) === "archived").length };
  };
  const mine = assetsOf(state, tenantId);
  const tests = testsOf(state, tenantId);
  const shares = sharesOf(state, tenantId);
  return {
    prompts: count("prompt"), agents: count("agent"),
    versions: mine.reduce((sum, a) => sum + a.versions.length, 0),
    pendingApprovals: mine.reduce((sum, a) => sum + a.versions.filter((v) => v.state === "pendingApproval").length, 0),
    tests: tests.length, estimatedCostMicros: tests.reduce((sum, t) => sum + t.estimatedCostMicros, 0), templates: templatesOf(state, tenantId).length,
    shares: { proposed: shares.filter((s) => s.status === "proposed").length, approved: shares.filter((s) => s.status === "approved").length, revoked: shares.filter((s) => s.status === "revoked").length },
  };
}

// ---------------------------------------------------------------- comparing versions
export type DiffLine = { type: "same" | "added" | "removed"; text: string };
/** A line diff (longest common subsequence): what changed between two versions of a prompt. */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { out.push({ type: "same", text: a[i] }); i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) { out.push({ type: "removed", text: a[i] }); i += 1; }
    else { out.push({ type: "added", text: b[j] }); j += 1; }
  }
  for (; i < a.length; i += 1) out.push({ type: "removed", text: a[i] });
  for (; j < b.length; j += 1) out.push({ type: "added", text: b[j] });
  return out;
}

// ---------------------------------------------------------------- Marketplace readiness
export type MarketplaceDraft = { kind: "aiAgent" | "digitalResource"; name: string; description: string; templateId: string; templateVersion: number; author: string; company: string; source: TemplateSource };
/** What a template would look like as a Marketplace listing draft. It creates no listing: publishing there is Level 3 and not built here. */
export const toMarketplaceDraft = (template: Template): MarketplaceDraft => ({
  kind: template.kind === "agent" ? "aiAgent" : "digitalResource", name: template.name, description: template.description, templateId: template.id, templateVersion: template.version, author: template.author, company: template.company, source: template.source,
});
