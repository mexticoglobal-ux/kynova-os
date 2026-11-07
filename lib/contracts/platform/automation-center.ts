// Automations Center store: "when this happens, prepare that". Pure and deterministic, one global state with every record
// owned by a company (tenant). Triggers and actions are closed sets; there are no real events, mailboxes or messaging here.
//
// Constitution (ADR-0009), enforced by how the sets are built and tested:
// - Every action only PREPARES or records something inside the platform (a task, a reminder, an internal notice, an email
//   or WhatsApp DRAFT, a pending event). None sends, writes outside the platform or moves money, so every action is Level 1
//   in the single autonomy catalog (workers.ts). Sending a draft is a different action that does not exist here: a person
//   reviews it and sends it themselves.
// - NEX may draft or duplicate an automation (Level 1). It never activates, edits a live one, switches off test mode, runs,
//   deletes, resolves a result or stops anything: a person does.
// - New automations start in test mode: they log what they would have done and create nothing until a person turns it off.
// - Contact data (email, phone) only flows into drafts, never into task titles, reminders or internal notices.
// - Every automation is carried out by a KOE Worker, never by a model directly: the Worker's tools, data clearance, priority and
//   estimated cost apply, and KOE's router picks the model (automation-koe.ts). Without a usable Worker it is "setupPending".
// - By construction nothing an automation creates can fire another one, and an event is processed once. A per-hour limit stops a flood.

import { isPerson, isWorker } from "./actors";
import { addDays } from "./billing";
import { message, type ErrorCode } from "./automation-messages";
import { DEFAULT_KOE_ENV, failed, planExecution, type KoeEnv, type ModelChoice, type Need } from "./automation-koe";
import { PRIORITY_RANK, type Priority } from "./koe-registry";
import { levelForAction, type AutonomyLevel } from "./workers";

export { DEFAULT_KOE_ENV, type KoeEnv } from "./automation-koe";

// ---------------------------------------------------------------- the closed sets
export const TRIGGERS = ["newProspect", "newClient", "paymentReceived", "meetingCreated", "formSubmitted", "manual"] as const;
export type TriggerKind = (typeof TRIGGERS)[number];

/** The data each event carries. A manual run carries whatever the person types. */
export const TRIGGER_FIELDS: Record<Exclude<TriggerKind, "manual">, readonly string[]> = {
  newProspect: ["nombre", "empresa", "correo", "telefono", "puntaje", "origen"],
  newClient: ["nombre", "empresa", "correo", "telefono"],
  paymentReceived: ["cliente", "monto", "moneda", "metodo", "referencia"],
  meetingCreated: ["titulo", "fecha", "contacto", "correo"],
  formSubmitted: ["formulario", "nombre", "correo", "mensaje"],
};
export const fieldsOf = (kind: TriggerKind): readonly string[] | "free" => (kind === "manual" ? "free" : TRIGGER_FIELDS[kind]);
/** Contact data: allowed only inside prepared drafts. */
export const CONTACT_FIELDS: readonly string[] = ["correo", "telefono"];

export const ACTIONS = ["createTask", "createReminder", "notifyInternal", "prepareEmail", "prepareWhatsapp", "createPendingEvent"] as const;
export type ActionKind = (typeof ACTIONS)[number];

// Each action is backed by an entry in the autonomy catalog. Email and WhatsApp both PREPARE a message (message.draft).
export const ACTION_TOOL: Record<ActionKind, string> = {
  createTask: "task.create", createReminder: "reminder.create", notifyInternal: "notification.internal", prepareEmail: "message.draft", prepareWhatsapp: "message.draft", createPendingEvent: "event.prepare",
};
export const actionLevel = (kind: ActionKind): AutonomyLevel => levelForAction(ACTION_TOOL[kind]);
export const ROLES = ["owner", "admin", "member", "team"] as const;

type ParamSpec = { key: string; required: boolean; max: number; kind: "text" | "int" | "role" | "email" | "phone"; min?: number; maxValue?: number };
export const ACTION_PARAMS: Record<ActionKind, readonly ParamSpec[]> = {
  createTask: [{ key: "titulo", required: true, max: 120, kind: "text" }, { key: "enDias", required: false, max: 3, kind: "int", min: 0, maxValue: 365 }, { key: "asignado", required: false, max: 10, kind: "role" }],
  createReminder: [{ key: "texto", required: true, max: 200, kind: "text" }, { key: "enHoras", required: true, max: 4, kind: "int", min: 1, maxValue: 8_760 }],
  notifyInternal: [{ key: "texto", required: true, max: 300, kind: "text" }, { key: "para", required: true, max: 10, kind: "role" }],
  prepareEmail: [{ key: "para", required: true, max: 120, kind: "email" }, { key: "asunto", required: true, max: 150, kind: "text" }, { key: "cuerpo", required: true, max: 2_000, kind: "text" }],
  prepareWhatsapp: [{ key: "para", required: true, max: 20, kind: "phone" }, { key: "mensaje", required: true, max: 1_000, kind: "text" }],
  createPendingEvent: [{ key: "titulo", required: true, max: 120, kind: "text" }, { key: "enDias", required: true, max: 3, kind: "int", min: 0, maxValue: 365 }],
};

export const CONDITION_OPS = ["equals", "notEquals", "greaterThan", "lessThan", "contains"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];
export type Condition = { field: string; op: ConditionOp; value: string };
export type ActionSpec = { kind: ActionKind; params: Readonly<Record<string, string>> };

export const MAX_ACTIONS = 8;
export const MAX_CONDITIONS = 6;
export const MAX_RUNS_PER_HOUR = 60;

// ---------------------------------------------------------------- records
export type AutomationStatus = "setupPending" | "draft" | "active" | "paused";
/** Where an automation came from, when it was made from a template of the future Automations Library (not built yet). */
export type TemplateRef = { templateId: string; templateVersion: number };
export type AutomationInput = { name: string; description: string; trigger: TriggerKind; conditions: readonly Condition[]; actions: readonly ActionSpec[]; workerId?: string; source?: TemplateRef };

/** Shape of a future library template: an automation without a company or a Worker. Only the model exists; there is no catalog yet. */
export type AutomationTemplate = Omit<AutomationInput, "workerId" | "source"> & { id: string; version: number };
export const inputFromTemplate = (template: AutomationTemplate, workerId?: string): AutomationInput => ({
  name: template.name, description: template.description, trigger: template.trigger, conditions: template.conditions, actions: template.actions, workerId, source: { templateId: template.id, templateVersion: template.version },
});
export type Automation = AutomationInput & {
  id: string; tenantId: string; status: AutomationStatus; testMode: boolean; version: number;
  createdBy: string; createdAt: string; updatedAt: string; lastRunAt?: string; runCount: number;
};

export type ActionResult = { index: number; kind: ActionKind; level: AutonomyLevel; rendered: Readonly<Record<string, string>>; outputId?: string; error?: string };
export type RunStatus = "completed" | "testLogged" | "skipped" | "failed";
export type AutomationRun = {
  id: string; tenantId: string; automationId: string; automationName: string; trigger: TriggerKind; eventId?: string; at: string; firedBy: string;
  status: RunStatus; reason?: string; mode: "live" | "test"; payload: Readonly<Record<string, string>>; results: readonly ActionResult[];
  // what KOE decided, copied when the run starts: the Worker, its priority and estimated cost, and the model KOE's router chose.
  // The model is only recorded: nothing calls it. Empty when the run was skipped because there was no usable Worker or model.
  workerId?: string; workerName?: string; priority?: Priority; estimatedCostMicros: number; model?: ModelChoice; modelReason?: string;
};

export type OutputKind = "task" | "reminder" | "notification" | "emailDraft" | "whatsappDraft" | "pendingEvent";
export type OutputStatus = "open" | "done" | "dismissed";
// A draft is only ever a draft: "done" means a person handled it outside the platform. Nothing here is sent.
export type Output = {
  id: string; tenantId: string; runId: string; automationId: string; kind: OutputKind; title: string; body?: string; to?: string; dueAt?: string;
  status: OutputStatus; createdAt: string; resolvedBy?: string; resolvedAt?: string;
};

export type AutomationAudit = { at: string; actor: string; tenantId: string; action: string; detail?: string };
export type AutomationLog = { at: string; level: "info" | "warn"; event: string };

export type AutomationState = {
  automations: readonly Automation[];
  runs: readonly AutomationRun[];
  outputs: readonly Output[];
  seenEvents: readonly string[];
  pausedTenants: readonly string[];
  audit: readonly AutomationAudit[];
  logs: readonly AutomationLog[];
  sequence: number;
};

export const newAutomationState = (): AutomationState => ({ automations: [], runs: [], outputs: [], seenEvents: [], pausedTenants: [], audit: [], logs: [], sequence: 0 });

// ---------------------------------------------------------------- templates
const PLACEHOLDER = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;
export const placeholdersOf = (text: string): string[] => [...text.matchAll(PLACEHOLDER)].map((match) => match[1]);

/** A value from an event is data, never instructions: control characters out, length bounded. */
const clean = (value: string): string => value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, 500);

/** Fills `{{field}}` from the event. A missing field becomes an empty string and is reported, never guessed. */
export function renderTemplate(text: string, payload: Readonly<Record<string, string>>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const rendered = text.replace(PLACEHOLDER, (_, key: string) => {
    const value = payload[key];
    if (value === undefined || value.trim() === "") { missing.push(key); return ""; }
    return clean(value);
  });
  return { text: rendered.trim(), missing: [...new Set(missing)] };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?\d{8,15}$/;
const SINGLE_PLACEHOLDER = /^\{\{\s*[a-zA-Z_]+\s*\}\}$/;

// ---------------------------------------------------------------- validation
/** What is wrong with an automation. Empty when it can be activated. */
export function needOf(input: Pick<AutomationInput, "actions">): Need {
  const known = input.actions.filter((action) => ACTIONS.includes(action.kind));
  const drafts = known.some((action) => action.kind === "prepareEmail" || action.kind === "prepareWhatsapp");
  return { tools: [...new Set(known.map((action) => ACTION_TOOL[action.kind]))], clearance: drafts ? "personal" : "business" };
}

/** Why the assigned Worker cannot carry this automation out. Empty when there is none assigned (that is "setupPending", not an error). */
export function workerIssues(input: AutomationInput, env: KoeEnv = DEFAULT_KOE_ENV, tenantId?: string): string[] {
  if (!input.workerId) return [];
  const plan = planExecution(env, tenantId, input.workerId, needOf(input));
  return failed(plan) ? [`Worker: ${plan.problem}`] : [];
}

/** Whether a usable Worker is assigned: the difference between "draft" and "setupPending". */
export const isConfigured = (input: AutomationInput, env: KoeEnv = DEFAULT_KOE_ENV, tenantId?: string): boolean => Boolean(input.workerId) && workerIssues(input, env, tenantId).length === 0;

export function validateAutomation(input: AutomationInput, env: KoeEnv = DEFAULT_KOE_ENV, tenantId?: string): string[] {
  const issues: string[] = [];
  if (input.name.trim() === "" || input.name.length > 80) issues.push("nombre (1 a 80 caracteres)");
  if (input.description.length > 300) issues.push("descripción (hasta 300 caracteres)");
  if (!TRIGGERS.includes(input.trigger)) { issues.push("disparador"); return issues; }
  const known = fieldsOf(input.trigger);
  const available = (field: string) => known === "free" || known.includes(field);

  if (input.conditions.length > MAX_CONDITIONS) issues.push(`hasta ${MAX_CONDITIONS} condiciones`);
  for (const condition of input.conditions) {
    if (!CONDITION_OPS.includes(condition.op)) issues.push(`operador de la condición «${condition.field}»`);
    if (condition.field.trim() === "" || !available(condition.field)) issues.push(`campo de la condición: «${condition.field}» no existe en este disparador`);
    if (condition.value.trim() === "") issues.push(`valor de la condición «${condition.field}»`);
  }
  if (input.actions.length === 0) issues.push("al menos una acción");
  if (input.actions.length > MAX_ACTIONS) issues.push(`hasta ${MAX_ACTIONS} acciones`);

  input.actions.forEach((action, index) => {
    const n = index + 1;
    if (!ACTIONS.includes(action.kind)) { issues.push(`acción ${n}: tipo desconocido`); return; }
    const allowed = new Set(ACTION_PARAMS[action.kind].map((spec) => spec.key));
    for (const key of Object.keys(action.params)) if (!allowed.has(key)) issues.push(`acción ${n}: parámetro desconocido «${key}»`);
    for (const spec of ACTION_PARAMS[action.kind]) {
      const value = (action.params[spec.key] ?? "").trim();
      if (value === "") { if (spec.required) issues.push(`acción ${n}: falta «${spec.key}»`); continue; }
      if (value.length > spec.max) issues.push(`acción ${n}: «${spec.key}» supera ${spec.max} caracteres`);
      const holders = placeholdersOf(value);
      for (const field of holders) {
        if (!available(field)) issues.push(`acción ${n}: «{{${field}}}» no existe en este disparador`);
        const draft = action.kind === "prepareEmail" || action.kind === "prepareWhatsapp";
        if (CONTACT_FIELDS.includes(field) && !draft) issues.push(`acción ${n}: los datos de contacto («${field}») solo van en borradores de correo o WhatsApp`);
      }
      if (holders.length > 0 && spec.kind !== "text" && !SINGLE_PLACEHOLDER.test(value)) issues.push(`acción ${n}: «${spec.key}» admite un solo campo, sin texto alrededor`);
      if (holders.length === 0) {
        if (spec.kind === "int" && (!/^\d+$/.test(value) || Number(value) < (spec.min ?? 0) || Number(value) > (spec.maxValue ?? 0))) issues.push(`acción ${n}: «${spec.key}» va de ${spec.min} a ${spec.maxValue}`);
        if (spec.kind === "role" && !ROLES.includes(value as (typeof ROLES)[number])) issues.push(`acción ${n}: «${spec.key}» debe ser ${ROLES.join(", ")}`);
        if (spec.kind === "email" && !EMAIL.test(value)) issues.push(`acción ${n}: correo del destinatario no válido`);
        if (spec.kind === "phone" && !PHONE.test(value)) issues.push(`acción ${n}: teléfono del destinatario no válido`);
      }
    }
  });
  issues.push(...workerIssues(input, env, tenantId));
  return [...new Set(issues)];
}

// ---------------------------------------------------------------- conditions
const toNumber = (text: string) => (text.trim() === "" ? Number.NaN : Number(text.replace(/,/g, "")));
export function matches(conditions: readonly Condition[], payload: Readonly<Record<string, string>>): boolean {
  return conditions.every((condition) => {
    const actual = payload[condition.field];
    if (actual === undefined) return false; // an event without the field does not match: never guessed
    const a = actual.trim().toLowerCase();
    const b = condition.value.trim().toLowerCase();
    switch (condition.op) {
      case "equals": return a === b;
      case "notEquals": return a !== b;
      case "contains": return a.includes(b);
      case "greaterThan": return toNumber(actual) > toNumber(condition.value);
      case "lessThan": return toNumber(actual) < toNumber(condition.value);
    }
  });
}

// ---------------------------------------------------------------- events
type Base = { at: string; tenantId: string; actor: string };
export type AutomationEvent =
  | (Base & { type: "automation.create"; input: AutomationInput })
  | (Base & { type: "automation.edit"; automationId: string; input: AutomationInput })
  | (Base & { type: "automation.duplicate"; automationId: string })
  | (Base & { type: "automation.activate"; automationId: string })
  | (Base & { type: "automation.pause"; automationId: string })
  | (Base & { type: "automation.delete"; automationId: string })
  | (Base & { type: "automation.setTestMode"; automationId: string; testMode: boolean })
  | (Base & { type: "automation.test"; automationId: string; payload: Readonly<Record<string, string>> })
  | (Base & { type: "automation.runManual"; automationId: string; payload: Readonly<Record<string, string>> })
  | (Base & { type: "automation.killSwitch"; paused: boolean })
  | (Base & { type: "trigger.fire"; kind: TriggerKind; payload: Readonly<Record<string, string>>; eventId?: string })
  | (Base & { type: "output.resolve"; outputId: string; resolution: "done" | "dismissed" });

export type AutomationResult = { state: AutomationState; error?: string; errorCode?: ErrorCode };

// ---------------------------------------------------------------- helpers
// Nothing is ever trimmed: records, logs and the audit trail all stay. Limits belong to the view (display.ts).
const append = <T,>(items: readonly T[], item: T): readonly T[] => [...items, item];
const replace = <T extends { id: string }>(items: readonly T[], item: T): readonly T[] => items.map((existing) => (existing.id === item.id ? item : existing));
const nextId = (state: AutomationState, prefix: string): { id: string; state: AutomationState } => {
  const sequence = state.sequence + 1;
  return { id: `${prefix}_${String(sequence).padStart(4, "0")}`, state: { ...state, sequence } };
};
const note = (state: AutomationState, event: { at: string; actor: string; tenantId: string }, action: string, detail?: string, level: AutomationLog["level"] = "info"): AutomationState => ({
  ...state,
  audit: append(state.audit, { at: event.at, actor: event.actor, tenantId: event.tenantId, action, detail }),
  logs: append(state.logs, { at: event.at, level, event: detail ? `${action}: ${detail}` : action }),
});
const addHours = (iso: string, hours: number) => new Date(Date.parse(iso) + hours * 3_600_000).toISOString();

/** Runs the actions of one automation against one event. In test mode it records what it would do and creates nothing. */
type Ctx = { at: string; actor: string; eventId?: string; mode: "live" | "test" };

/** A run that did nothing, with the reason: over the hourly limit, or no usable Worker or model. Never counts as an execution. */
function skip(start: AutomationState, automation: Automation, payload: Readonly<Record<string, string>>, ctx: Ctx, reason: string): AutomationState {
  const created = nextId(start, "ar");
  const run: AutomationRun = {
    id: created.id, tenantId: automation.tenantId, automationId: automation.id, automationName: automation.name, trigger: automation.trigger, eventId: ctx.eventId, at: ctx.at, firedBy: ctx.actor,
    status: "skipped", reason, mode: ctx.mode, payload, results: [], estimatedCostMicros: 0,
  };
  return note({ ...created.state, runs: append(created.state.runs, run) }, { at: ctx.at, actor: ctx.actor, tenantId: automation.tenantId }, "automation.skipped", `${automation.id} · ${reason}`, "warn");
}

function execute(start: AutomationState, automation: Automation, payload: Readonly<Record<string, string>>, ctx: Ctx, env: KoeEnv): AutomationState {
  // KOE first: the Worker that carries this out and the model its router picks. The model is recorded, never called.
  const plan = automation.workerId ? planExecution(env, automation.tenantId, automation.workerId, needOf(automation)) : { problem: "no tiene un Worker asignado" };
  if (failed(plan)) return skip(start, automation, payload, ctx, `Configuración pendiente: ${plan.problem}`);
  let state = start;
  const created = nextId(state, "ar");
  state = created.state;
  const runId = created.id;
  const results: ActionResult[] = [];
  let hadErrors = false;

  automation.actions.forEach((action, index) => {
    const rendered: Record<string, string> = {};
    const problems: string[] = [];
    for (const spec of ACTION_PARAMS[action.kind]) {
      const raw = action.params[spec.key] ?? "";
      const out = renderTemplate(raw, payload);
      rendered[spec.key] = out.text;
      if (out.missing.length) problems.push(`falta «${out.missing.join("», «")}» en el evento`);
      if (spec.required && out.text === "") problems.push(`«${spec.key}» quedó vacío`);
      if (spec.kind === "email" && out.text !== "" && !EMAIL.test(out.text)) problems.push("correo del destinatario no válido");
      if (spec.kind === "phone" && out.text !== "" && !PHONE.test(out.text.replace(/[\s-]/g, ""))) problems.push("teléfono del destinatario no válido");
      if (spec.kind === "phone") rendered[spec.key] = out.text.replace(/[\s-]/g, "");
    }
    const level = actionLevel(action.kind);
    if (problems.length) {
      hadErrors = true;
      results.push({ index, kind: action.kind, level, rendered, error: [...new Set(problems)].join("; ") });
      return;
    }
    if (ctx.mode === "test") { results.push({ index, kind: action.kind, level, rendered }); return; }

    const outputCreated = nextId(state, "ou");
    state = outputCreated.state;
    const days = Number(rendered.enDias || "0");
    const base = { id: outputCreated.id, tenantId: automation.tenantId, runId, automationId: automation.id, status: "open" as const, createdAt: ctx.at };
    let output: Output;
    switch (action.kind) {
      case "createTask": output = { ...base, kind: "task", title: rendered.titulo, to: rendered.asignado || undefined, dueAt: rendered.enDias ? addDays(ctx.at, days) : undefined }; break;
      case "createReminder": output = { ...base, kind: "reminder", title: rendered.texto, dueAt: addHours(ctx.at, Number(rendered.enHoras)) }; break;
      case "notifyInternal": output = { ...base, kind: "notification", title: rendered.texto, to: rendered.para }; break;
      case "prepareEmail": output = { ...base, kind: "emailDraft", title: rendered.asunto, body: rendered.cuerpo, to: rendered.para }; break;
      case "prepareWhatsapp": output = { ...base, kind: "whatsappDraft", title: rendered.mensaje.slice(0, 60), body: rendered.mensaje, to: rendered.para }; break;
      case "createPendingEvent": output = { ...base, kind: "pendingEvent", title: rendered.titulo, dueAt: addDays(ctx.at, days) }; break;
    }
    state = { ...state, outputs: append(state.outputs, output) };
    results.push({ index, kind: action.kind, level, rendered, outputId: output.id });
  });

  const status: RunStatus = ctx.mode === "test" ? "testLogged" : hadErrors ? "failed" : "completed";
  const run: AutomationRun = {
    id: runId, tenantId: automation.tenantId, automationId: automation.id, automationName: automation.name, trigger: automation.trigger, eventId: ctx.eventId, at: ctx.at, firedBy: ctx.actor,
    status, reason: hadErrors ? "alguna acción no pudo prepararse" : undefined, mode: ctx.mode, payload, results,
    workerId: plan.worker.id, workerName: plan.worker.name, priority: plan.priority, estimatedCostMicros: plan.estimatedCostMicros, model: plan.model, modelReason: plan.modelReason,
  };
  state = { ...state, runs: append(state.runs, run) };
  if (ctx.mode === "live") state = { ...state, automations: replace(state.automations, { ...automation, lastRunAt: ctx.at, runCount: automation.runCount + 1 }) };
  return note(state, { at: ctx.at, actor: ctx.actor, tenantId: automation.tenantId }, ctx.mode === "test" ? "automation.test" : "automation.run", `${automation.id} · ${status} · ${plan.worker.name}${hadErrors ? " · con errores" : ""}`, hadErrors ? "warn" : "info");
}

// ---------------------------------------------------------------- the reducer
export function reduceAutomations(state: AutomationState, event: AutomationEvent, env: KoeEnv = DEFAULT_KOE_ENV): AutomationResult {
  const person = isPerson(event.actor);
  const refuse = (code: ErrorCode, params?: Record<string, string | number>): AutomationResult => ({ state, error: message(code, params), errorCode: code });
  const needPerson = (): AutomationResult | null => (person ? null : refuse("personRequired"));
  const stopped = state.pausedTenants.includes(event.tenantId);
  const configured = (input: AutomationInput) => isConfigured(input, env, event.tenantId);
  const sanitizeSource = (source: AutomationInput["source"]): TemplateRef | undefined => (source && typeof source.templateId === "string" && source.templateId.length > 0 && source.templateId.length <= 60 && Number.isInteger(source.templateVersion) && source.templateVersion > 0 ? { templateId: source.templateId, templateVersion: source.templateVersion } : undefined);
  const find = (id: string): { automation?: Automation; failure?: AutomationResult } => {
    const automation = state.automations.find((item) => item.id === id);
    if (!automation) return { failure: refuse("notFound") };
    if (automation.tenantId !== event.tenantId) return { failure: refuse("notYours") };
    return { automation };
  };

  switch (event.type) {
    // ---- authoring: NEX may leave a draft; everything that makes an automation act is a person's
    case "automation.create": {
      if (!person && !isWorker(event.actor)) return refuse("personRequired");
      const created = nextId(state, "au");
      const automation: Automation = { ...event.input, source: sanitizeSource(event.input.source), id: created.id, tenantId: event.tenantId, status: configured(event.input) ? "draft" : "setupPending", testMode: true, version: 1, createdBy: event.actor, createdAt: event.at, updatedAt: event.at, runCount: 0 };
      return { state: note({ ...created.state, automations: append(created.state.automations, automation) }, event, "automation.create", `${automation.id} · ${automation.name}`) };
    }

    case "automation.edit": {
      const { automation, failure } = find(event.automationId);
      if (!automation) return failure as AutomationResult;
      const draftLike = automation.status === "draft" || automation.status === "setupPending";
      if (!person) return draftLike && isWorker(event.actor) ? { state: note({ ...state, automations: replace(state.automations, { ...automation, ...event.input, workerId: event.input.workerId, source: automation.source, status: configured(event.input) ? "draft" : "setupPending", version: automation.version + 1, updatedAt: event.at }) }, event, "automation.edit", automation.id) } : refuse(isWorker(event.actor) ? "notEditableByAi" : "personRequired");
      // a live automation is paused while it is being changed, so it never runs half-edited; a person turns it back on.
      // Without a usable Worker it goes back to "setupPending"; once one is assigned it leaves that state.
      const ready = configured(event.input);
      const status: AutomationStatus = !ready ? "setupPending" : automation.status === "active" ? "paused" : automation.status === "setupPending" ? "draft" : automation.status;
      const edited: Automation = { ...automation, ...event.input, workerId: event.input.workerId, source: automation.source, status, version: automation.version + 1, updatedAt: event.at };
      return { state: note({ ...state, automations: replace(state.automations, edited) }, event, "automation.edit", `${automation.id} · v${edited.version}${automation.status === "active" ? " · pausada para editar" : ""}`) };
    }

    case "automation.duplicate": {
      if (!person && !isWorker(event.actor)) return refuse("personRequired");
      const { automation, failure } = find(event.automationId);
      if (!automation) return failure as AutomationResult;
      const created = nextId(state, "au");
      const copy: Automation = { ...automation, id: created.id, name: `${automation.name} (copia)`.slice(0, 80), status: configured(automation) ? "draft" : "setupPending", testMode: true, version: 1, createdBy: event.actor, createdAt: event.at, updatedAt: event.at, lastRunAt: undefined, runCount: 0 };
      return { state: note({ ...created.state, automations: append(created.state.automations, copy) }, event, "automation.duplicate", `${automation.id} → ${copy.id}`) };
    }

    case "automation.activate": {
      const denied = needPerson();
      if (denied) return denied;
      const { automation, failure } = find(event.automationId);
      if (!automation) return failure as AutomationResult;
      if (automation.status === "active") return refuse("invalidTransition", { from: "activa", to: "activa" });
      if (automation.status === "setupPending" || !automation.workerId) return refuse("workerRequired");
      const issues = validateAutomation(automation, env, event.tenantId);
      if (issues.length) return refuse("invalid", { detail: issues[0] });
      return { state: note({ ...state, automations: replace(state.automations, { ...automation, status: "active", updatedAt: event.at }) }, event, "automation.activate", `${automation.id}${automation.testMode ? " · en modo de prueba" : ""}`) };
    }

    case "automation.pause": {
      const denied = needPerson();
      if (denied) return denied;
      const { automation, failure } = find(event.automationId);
      if (!automation) return failure as AutomationResult;
      if (automation.status !== "active") return refuse("invalidTransition", { from: automation.status === "draft" ? "en borrador" : automation.status === "paused" ? "pausada" : "pendiente de configuración", to: "pausada" });
      return { state: note({ ...state, automations: replace(state.automations, { ...automation, status: "paused", updatedAt: event.at }) }, event, "automation.pause", automation.id, "warn") };
    }

    case "automation.delete": {
      const denied = needPerson();
      if (denied) return denied;
      const { automation, failure } = find(event.automationId);
      if (!automation) return failure as AutomationResult;
      if (automation.status === "active") return refuse("activeCannotDelete");
      // what it did stays on record: runs and results keep the name it had
      return { state: note({ ...state, automations: state.automations.filter((item) => item.id !== automation.id) }, event, "automation.delete", `${automation.id} · ${automation.name}`, "warn") };
    }

    case "automation.setTestMode": {
      const denied = needPerson();
      if (denied) return denied;
      const { automation, failure } = find(event.automationId);
      if (!automation) return failure as AutomationResult;
      if (!event.testMode) {
        if (automation.status === "setupPending" || !automation.workerId) return refuse("workerRequired");
        const issues = validateAutomation(automation, env, event.tenantId);
        if (issues.length) return refuse("invalid", { detail: issues[0] });
      }
      return { state: note({ ...state, automations: replace(state.automations, { ...automation, testMode: event.testMode, updatedAt: event.at }) }, event, "automation.setTestMode", `${automation.id} · ${event.testMode ? "prueba" : "en vivo"}`, event.testMode ? "info" : "warn") };
    }

    case "automation.killSwitch": {
      const denied = needPerson();
      if (denied) return denied;
      const pausedTenants = event.paused ? (state.pausedTenants.includes(event.tenantId) ? state.pausedTenants : append(state.pausedTenants, event.tenantId)) : state.pausedTenants.filter((id) => id !== event.tenantId);
      return { state: note({ ...state, pausedTenants }, event, event.paused ? "killSwitch.on" : "killSwitch.off", undefined, event.paused ? "warn" : "info") };
    }

    // ---- running
    case "automation.test": {
      const denied = needPerson();
      if (denied) return denied;
      const { automation, failure } = find(event.automationId);
      if (!automation) return failure as AutomationResult;
      if (automation.status === "setupPending" || !automation.workerId) return refuse("workerRequired");
      const issues = validateAutomation(automation, env, event.tenantId);
      if (issues.length) return refuse("invalid", { detail: issues[0] });
      return { state: execute(state, automation, event.payload, { at: event.at, actor: event.actor, mode: "test" }, env) }; // never creates anything, whatever its status
    }

    case "automation.runManual": {
      const denied = needPerson();
      if (denied) return denied;
      if (stopped) return refuse("tenantPaused");
      const { automation, failure } = find(event.automationId);
      if (!automation) return failure as AutomationResult;
      if (automation.trigger !== "manual") return refuse("notManual");
      if (automation.status !== "active") return refuse("notActive");
      return { state: execute(state, automation, event.payload, { at: event.at, actor: event.actor, mode: automation.testMode ? "test" : "live" }, env) };
    }

    case "trigger.fire": {
      // events come from the platform ("system") or from a person simulating one; never from a Worker
      if (!person && event.actor !== "system") return refuse("personRequired");
      if (stopped) return refuse("tenantPaused");
      const known = fieldsOf(event.kind);
      const keys = Object.keys(event.payload);
      if (keys.length > 20) return refuse("triggerInvalid", { detail: "demasiados datos" });
      for (const key of keys) {
        if (!/^[a-zA-Z_]{1,30}$/.test(key)) return refuse("triggerInvalid", { detail: `nombre de dato no válido: ${key}` });
        if (known !== "free" && !known.includes(key)) return refuse("triggerInvalid", { detail: `«${key}» no existe en este disparador` });
        if (event.payload[key].length > 2_000) return refuse("triggerInvalid", { detail: `«${key}» es demasiado largo` });
      }
      const dedup = event.eventId ? `${event.tenantId}|${event.eventId}` : null;
      if (dedup && state.seenEvents.includes(dedup)) return { state: note(state, event, "trigger.duplicate", event.eventId) }; // an event is processed once
      let next: AutomationState = dedup ? { ...state, seenEvents: append(state.seenEvents, dedup) } : state;
      // KOE decides the order: a Critical Worker's automation runs before a Low one's; ties keep creation order
      const rank = (item: Automation) => { const plan = item.workerId ? planExecution(env, item.tenantId, item.workerId, needOf(item)) : null; return plan && !failed(plan) ? PRIORITY_RANK[plan.priority] : -1; };
      const candidates = next.automations.filter((item) => item.tenantId === event.tenantId && item.status === "active" && item.trigger === event.kind).map((item, index) => ({ item, index, rank: rank(item) })).sort((a, b) => b.rank - a.rank || a.index - b.index).map((entry) => entry.item);
      let ran = 0;
      for (const automation of candidates) {
        if (!matches(automation.conditions, event.payload)) continue;
        const recent = next.runs.filter((run) => run.automationId === automation.id && run.status !== "skipped" && Date.parse(event.at) - Date.parse(run.at) < 3_600_000).length;
        if (recent >= MAX_RUNS_PER_HOUR) {
          next = skip(next, automation, event.payload, { at: event.at, actor: event.actor, eventId: event.eventId, mode: automation.testMode ? "test" : "live" }, `límite de ${MAX_RUNS_PER_HOUR} ejecuciones por hora`);
          continue;
        }
        next = execute(next, automation, event.payload, { at: event.at, actor: event.actor, eventId: event.eventId, mode: automation.testMode ? "test" : "live" }, env);
        ran += 1;
      }
      return { state: note(next, event, "trigger.fire", `${event.kind} · ${candidates.length} activas · ${ran} ejecutadas`) };
    }

    case "output.resolve": {
      const denied = needPerson();
      if (denied) return denied;
      const output = state.outputs.find((item) => item.id === event.outputId);
      if (!output) return refuse("outputNotFound");
      if (output.tenantId !== event.tenantId) return refuse("notYours");
      if (output.status !== "open") return refuse("outputResolved");
      return { state: note({ ...state, outputs: replace(state.outputs, { ...output, status: event.resolution, resolvedBy: event.actor, resolvedAt: event.at }) }, event, `output.${event.resolution}`, `${output.id} · ${output.kind}`) };
    }
  }
}

export function applyAllAutomations(state: AutomationState, events: readonly AutomationEvent[], env: KoeEnv = DEFAULT_KOE_ENV): { state: AutomationState; errors: string[] } {
  const errors: string[] = [];
  let current = state;
  for (const event of events) {
    const result = reduceAutomations(current, event, env);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    current = result.state;
  }
  return { state: current, errors };
}

// ---------------------------------------------------------------- views
export const automationsOf = (state: AutomationState, tenantId: string) => state.automations.filter((item) => item.tenantId === tenantId);
export const runsOf = (state: AutomationState, tenantId: string) => state.runs.filter((item) => item.tenantId === tenantId);
export const outputsOf = (state: AutomationState, tenantId: string) => state.outputs.filter((item) => item.tenantId === tenantId);

export type AutomationStats = {
  automations: Record<AutomationStatus, number>;
  estimatedCostMicros: number; // the Workers estimated cost of the live runs: an estimate for comparing, not an invoice
  live: number; // active and not in test mode
  runs: Record<RunStatus, number>;
  openOutputs: Record<OutputKind, number>;
};

export function automationStats(state: AutomationState, tenantId: string): AutomationStats {
  const mine = automationsOf(state, tenantId);
  const runs = runsOf(state, tenantId);
  const open = outputsOf(state, tenantId).filter((item) => item.status === "open");
  const count = <K extends string>(keys: readonly K[], has: (key: K) => number) => Object.fromEntries(keys.map((key) => [key, has(key)])) as Record<K, number>;
  return {
    automations: count(["setupPending", "draft", "active", "paused"] as const, (status) => mine.filter((item) => item.status === status).length),
    estimatedCostMicros: runs.filter((item) => item.mode === "live").reduce((sum, item) => sum + item.estimatedCostMicros, 0),
    live: mine.filter((item) => item.status === "active" && !item.testMode).length,
    runs: count(["completed", "testLogged", "skipped", "failed"] as const, (status) => runs.filter((item) => item.status === status).length),
    openOutputs: count(["task", "reminder", "notification", "emailDraft", "whatsappDraft", "pendingEvent"] as const, (kind) => open.filter((item) => item.kind === kind).length),
  };
}
