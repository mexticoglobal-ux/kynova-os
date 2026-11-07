// KOE (KYNOVA Orchestration Engine): runs Workers as specialists that collaborate. Pure and deterministic, one global state
// with every record owned by a company (tenant). It reads the registries in koe-registry.ts, so a new Worker, tool or model
// is data and the engine does not change.
//
// No real model or tool is ever called: tools and models are simulated here and will be reached only through adapters
// (lib/ai/ and AI Gateway for models). Every step of every run is audited, and nothing is ever trimmed.
//
// Constitution (ADR-0009), enforced here and tested:
// - The autonomy level of an action comes from the catalog in workers.ts, never from a model: Level 1 runs, Level 2 runs only
//   inside an active authorization a person granted (with a daily limit), Level 3 always waits for a person.
// - Delegation never raises a Worker's powers: a child run only gets tools its delegator already holds (or Level 1 ones),
//   its approvals still go to people, and personal data crosses to a Worker only if that Worker is cleared for it.
// - A Worker can draft a new Worker (Level 1) but never submit, approve, enable or grant anything.

import { isPerson, isWorker } from "./actors";
import { addDays } from "./billing";
import { label, message, type ErrorCode } from "./koe-messages";
import {
  BASE_MODELS, BASE_TOOLS, CLEARANCE_RANK, MEMORY_DURABLE_DAYS, PLATFORM_OWNER, STARTER_WORKERS, autonomyOf, covers, looksSecret, routeModel, validateModel, validateTool, validateWorker,
  type Clearance, type ModelManifest, type TaskProfile, type ToolEntry, type ToolManifest, type WorkerDefinition,
} from "./koe-registry";
import { decide as decideAutonomy, levelForAction, type AutonomyLevel } from "./workers";

// ---------------------------------------------------------------- state
// "paused" is temporary; "disabled" is switched off (nothing runs, live runs are cancelled) until a person enables it again.
// The company can also lower the run limit and exclude model providers for this Worker, never beyond what its definition allows.
export type WorkerInstance = { id: string; tenantId: string; definitionId: string; status: "active" | "paused" | "disabled"; enabledBy: string; enabledAt: string; maxRunsPerDay: number; deniedProviders: readonly string[] };
export type StepKind = "tool" | "model" | "delegate" | "memory" | "note" | "result";
export type Decision = "allowed" | "needsApproval" | "approved" | "rejected" | "refused" | "expired";
export type RunStep = { id: string; at: string; kind: StepKind; detail: string; tool?: string; level?: AutonomyLevel; decision?: Decision; modelId?: string; routing?: string; childRunId?: string; output?: string; approvalId?: string; tokens?: number };
export type ContextItem = { key: string; value: string; sensitivity: Clearance; from: string };
export type RunStatus = "running" | "waitingApproval" | "completed" | "failed" | "cancelled";
export type Run = {
  id: string; tenantId: string; instanceId: string; workerId: string; goal: string; status: RunStatus; startedBy: string; startedAt: string;
  parentRunId?: string; rootRunId: string; depth: number; chain: readonly string[]; grant?: readonly string[];
  steps: readonly RunStep[]; context: readonly ContextItem[]; dataTouched: Clearance; result?: string; finishedAt?: string;
};
export type Approval = { id: string; tenantId: string; runId: string; stepId: string; tool: string; input: Readonly<Record<string, string>>; level: AutonomyLevel; financial: boolean; requestedAt: string; status: "pending" | "approved" | "rejected" | "expired"; decidedBy?: string; decidedAt?: string; reason?: string };
export type MemoryEntry = { id: string; tenantId: string; instanceId: string; runId?: string; scope: "run" | "durable"; key: string; value: string; sensitivity: Clearance; createdAt: string; expiresAt?: string; cleared?: boolean };
export type WorkerAuthorization = { id: string; tenantId: string; instanceId: string; action: string; maxPerDay: number; expiresAt?: string; grantedBy: string; grantedAt: string; status: "active" | "revoked" };

export type KoeAudit = { at: string; actor: string; tenantId: string; action: string; detail?: string; runId?: string };
export type KoeLog = { at: string; level: "info" | "warn"; event: string };

export type KoeState = {
  admins: readonly string[];
  platformPaused: boolean;
  pausedTenants: readonly string[];
  tools: Record<string, ToolEntry>;
  models: readonly ModelManifest[];
  definitions: readonly WorkerDefinition[];
  instances: readonly WorkerInstance[];
  runs: readonly Run[];
  approvals: readonly Approval[];
  memory: readonly MemoryEntry[];
  authorizations: readonly WorkerAuthorization[];
  audit: readonly KoeAudit[];
  logs: readonly KoeLog[];
  sequence: number;
};

export const APPROVAL_TTL_HOURS = 24;

export function newKoeState(admins: readonly string[] = []): KoeState {
  return {
    admins, platformPaused: false, pausedTenants: [],
    tools: Object.fromEntries(BASE_TOOLS.map((manifest) => [manifest.id, { manifest, status: "active", registeredBy: "kynova" } satisfies ToolEntry])),
    models: BASE_MODELS, definitions: STARTER_WORKERS, instances: [], runs: [], approvals: [], memory: [], authorizations: [], audit: [], logs: [], sequence: 0,
  };
}

// ---------------------------------------------------------------- events
export type WorkerInput = Omit<WorkerDefinition, "status" | "createdBy" | "submittedBy" | "ownerTenantId" | "origin"> & { origin?: "kynova" | "tenant" };
type Base = { at: string; tenantId: string; actor: string };

export type KoeEvent =
  | (Base & { type: "worker.draft"; input: WorkerInput })
  | (Base & { type: "worker.edit"; definitionId: string; input: WorkerInput })
  | (Base & { type: "worker.submit"; definitionId: string })
  | (Base & { type: "worker.review"; definitionId: string; approve: boolean; reason?: string })
  | (Base & { type: "worker.retire"; definitionId: string })
  | (Base & { type: "worker.enable"; definitionId: string })
  | (Base & { type: "instance.disable"; instanceId: string })
  | (Base & { type: "instance.enable"; instanceId: string })
  | (Base & { type: "instance.configure"; instanceId: string; maxRunsPerDay: number; deniedProviders: readonly string[] })
  | (Base & { type: "instance.pause"; instanceId: string })
  | (Base & { type: "instance.resume"; instanceId: string })
  | (Base & { type: "tenant.pause"; paused: boolean })
  | (Base & { type: "platform.pause"; paused: boolean })
  | (Base & { type: "authorization.grant"; instanceId: string; action: string; maxPerDay: number; expiresAt?: string })
  | (Base & { type: "authorization.revoke"; authorizationId: string })
  | (Base & { type: "run.start"; instanceId: string; goal: string; context?: readonly ContextItem[] })
  | (Base & { type: "run.tool"; runId: string; tool: string; input: Readonly<Record<string, string>> })
  | (Base & { type: "run.model"; runId: string; task?: Partial<TaskProfile> })
  | (Base & { type: "run.delegate"; runId: string; toWorker: string; goal: string; grant: readonly string[]; contextKeys: readonly string[] })
  | (Base & { type: "run.finish"; runId: string; outcome: "completed" | "failed"; result: string })
  | (Base & { type: "run.cancel"; runId: string })
  | (Base & { type: "approval.decide"; approvalId: string; approve: boolean; reason?: string })
  | (Base & { type: "memory.put"; runId: string; key: string; value: string; sensitivity: Clearance })
  | (Base & { type: "memory.promote"; entryId: string })
  | (Base & { type: "memory.forget"; entryId: string })
  | (Base & { type: "tool.register"; manifest: ToolManifest })
  | (Base & { type: "tool.approve"; toolId: string })
  | (Base & { type: "model.register"; model: ModelManifest })
  | (Base & { type: "model.update"; modelId: string; health?: ModelManifest["health"]; enabled?: boolean })
  | (Base & { type: "tick" });

export type KoeResult = { state: KoeState; error?: string; errorCode?: ErrorCode };

// ---------------------------------------------------------------- helpers
// Nothing is ever trimmed: records, logs and the audit trail all stay. Limits belong to the view (display.ts).
const append = <T,>(items: readonly T[], item: T): readonly T[] => [...items, item];
const replace = <T extends { id: string }>(items: readonly T[], item: T): readonly T[] => items.map((existing) => (existing.id === item.id ? item : existing));
const nextId = (state: KoeState, prefix: string): { id: string; state: KoeState } => {
  const sequence = state.sequence + 1;
  return { id: `${prefix}_${String(sequence).padStart(4, "0")}`, state: { ...state, sequence } };
};
const note = (state: KoeState, event: { at: string; actor: string; tenantId: string }, action: string, detail?: string, level: KoeLog["level"] = "info", runId?: string): KoeState => ({
  ...state,
  audit: append(state.audit, { at: event.at, actor: event.actor, tenantId: event.tenantId, action, detail, runId }),
  logs: append(state.logs, { at: event.at, level, event: detail ? `${action}: ${detail}` : action }),
});
export const isAdmin = (state: KoeState, actor: string): boolean => isPerson(actor) && state.admins.includes(actor);
const sameDay = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10);
const higher = (a: Clearance, b: Clearance): Clearance => (CLEARANCE_RANK[a] >= CLEARANCE_RANK[b] ? a : b);
export const workerActor = (workerId: string) => `worker:${workerId}`;

export const definitionOf = (state: KoeState, id: string) => state.definitions.find((item) => item.id === id);
export const instanceFor = (state: KoeState, tenantId: string, definitionId: string) => state.instances.find((item) => item.tenantId === tenantId && item.definitionId === definitionId);
export const childrenOf = (state: KoeState, runId: string) => state.runs.filter((run) => run.parentRunId === runId);
const isLive = (run: Run) => run.status === "running" || run.status === "waitingApproval";
const live = (state: KoeState, runId: string): Run[] => {
  const out: Run[] = [];
  for (const child of childrenOf(state, runId)) { if (isLive(child)) out.push(child); out.push(...live(state, child.id)); }
  return out;
};

/** Can `from` hand work to `to`? Both sides must agree: the sender lists the receiver and the receiver accepts the sender. */
export function canDelegate(from: WorkerDefinition, to: WorkerDefinition): boolean {
  return from.collaboration.delegatesTo.includes(to.id) && (to.collaboration.acceptsFrom.includes(from.id) || to.collaboration.acceptsFrom.includes("*"));
}

/** The tools a run may use: its Worker's, narrowed by the delegation that created it, if any. */
export function effectiveTools(definition: WorkerDefinition, run: Pick<Run, "grant">): readonly string[] {
  return run.grant ? definition.tools.filter((id) => run.grant?.includes(id)) : definition.tools;
}

/** What a tool call needs right now: nothing, a person's approval, or it is refused. Level comes from the catalog. */
export function decideTool(state: KoeState, run: Run, definition: WorkerDefinition, toolId: string, at: string): { decision: "allowed" | "needsApproval"; level: AutonomyLevel } {
  const entry = state.tools[toolId];
  const level = entry ? levelForAction(toolId) : 3;
  if (level === 1) return { decision: "allowed", level };
  if (level === 3) return { decision: "needsApproval", level };
  const authorization = state.authorizations.find((item) => item.instanceId === run.instanceId && item.action === toolId && item.status === "active" && (!item.expiresAt || Date.parse(item.expiresAt) > Date.parse(at)));
  if (!authorization) return { decision: "needsApproval", level };
  const used = state.runs.filter((other) => other.instanceId === run.instanceId).flatMap((other) => other.steps).filter((step) => step.tool === toolId && step.decision === "allowed" && sameDay(step.at, at)).length;
  const verdict = decideAutonomy(toolId, { action: toolId, status: "active", maxPerDay: authorization.maxPerDay, usedToday: used, expiresAt: authorization.expiresAt }, new Date(at));
  return { decision: verdict.allowed ? "allowed" : "needsApproval", level };
}

/** Deterministic stand-ins for the real tool and model. They never leave the process. */
export const simulateToolOutput = (manifest: ToolManifest, input: Readonly<Record<string, string>>): string => `[simulado] ${manifest.label}: ${Object.values(input).join(" · ")}`;

// ---------------------------------------------------------------- the reducer
export function reduceKoe(state: KoeState, event: KoeEvent): KoeResult {
  const person = isPerson(event.actor);
  const refuse = (code: ErrorCode, params?: Record<string, string | number>, log = false): KoeResult => {
    const text = message(code, params);
    return { state: log ? note(state, event, "refused", `${event.type} · ${text}`, "warn") : state, error: text, errorCode: code };
  };
  const needPerson = (): KoeResult | null => (person ? null : refuse("personRequired", undefined, true));
  const needAdmin = (): KoeResult | null => (isAdmin(state, event.actor) ? null : refuse(person ? "adminRequired" : "personRequired"));
  const paused = (tenantId: string): KoeResult | null => (state.platformPaused ? refuse("platformPaused") : state.pausedTenants.includes(tenantId) ? refuse("tenantPaused") : null);

  // finds a run of this company that the acting Worker is allowed to move
  const workingRun = (runId: string): { run?: Run; definition?: WorkerDefinition; instance?: WorkerInstance; failure?: KoeResult } => {
    const run = state.runs.find((item) => item.id === runId);
    if (!run) return { failure: refuse("runNotFound") };
    if (run.tenantId !== event.tenantId) return { failure: refuse("notYours", undefined, true) };
    const definition = definitionOf(state, run.workerId);
    const instance = state.instances.find((item) => item.id === run.instanceId);
    if (!definition || !instance) return { failure: refuse("instanceNotFound") };
    if (event.actor !== workerActor(run.workerId)) return { failure: refuse("notThisWorker", undefined, true) };
    const stopped = paused(run.tenantId); // a kill switch wins over everything else
    if (stopped) return { failure: stopped };
    if (run.status !== "running") return { failure: refuse("runNotRunning", { status: run.status }) };
    if (instance.status === "disabled") return { failure: refuse("instanceDisabled") };
    if (instance.status === "paused") return { failure: refuse("instancePaused") };
    return { run, definition, instance };
  };
  const addStep = (run: Run, step: Omit<RunStep, "id">, current: KoeState): { run: Run; state: KoeState; step: RunStep } => {
    const created = nextId(current, "sp");
    const entry: RunStep = { id: created.id, ...step };
    return { run: { ...run, steps: append(run.steps, entry) }, state: created.state, step: entry };
  };
  const stepLimit = (run: Run, definition: WorkerDefinition): KoeResult | null => (run.steps.length >= definition.limits.maxStepsPerRun ? refuse("stepLimit", { max: definition.limits.maxStepsPerRun }, true) : null);

  switch (event.type) {
    // ================================================================ Worker definitions: new Workers are data
    case "worker.draft": {
      if (!person && !isWorker(event.actor)) return refuse("personRequired");
      const origin = event.input.origin ?? "tenant";
      if (origin === "kynova" && !isAdmin(state, event.actor)) return refuse(person ? "adminRequired" : "personRequired", undefined, true);
      if (state.definitions.some((item) => item.id === event.input.id)) return refuse("definitionExists");
      const { origin: _ignored, ...rest } = event.input;
      const definition: WorkerDefinition = { ...rest, ownerTenantId: origin === "kynova" ? PLATFORM_OWNER : event.tenantId, origin, status: "draft", createdBy: event.actor };
      return { state: note({ ...state, definitions: append(state.definitions, definition) }, event, "worker.draft", definition.id) };
    }

    case "worker.edit": {
      const definition = definitionOf(state, event.definitionId);
      if (!definition) return refuse("definitionNotFound");
      if (definition.ownerTenantId !== (definition.origin === "kynova" ? PLATFORM_OWNER : event.tenantId) || (definition.origin === "kynova" && !isAdmin(state, event.actor) && !isWorker(event.actor))) return refuse("notYours", undefined, true);
      if (definition.status !== "draft") return refuse("invalidTransition", { from: definition.status, to: "draft" });
      if (!person && !isWorker(event.actor)) return refuse("personRequired");
      const { origin: _ignored, ...rest } = event.input;
      return { state: note({ ...state, definitions: replace(state.definitions, { ...rest, ownerTenantId: definition.ownerTenantId, origin: definition.origin, status: "draft", createdBy: definition.createdBy }) }, event, "worker.edit", definition.id) };
    }

    case "worker.submit": {
      const denied = needPerson();
      if (denied) return denied;
      const definition = definitionOf(state, event.definitionId);
      if (!definition) return refuse("definitionNotFound");
      if (definition.origin === "kynova" ? !isAdmin(state, event.actor) : definition.ownerTenantId !== event.tenantId) return refuse("notYours", undefined, true);
      if (definition.status !== "draft") return refuse("invalidTransition", { from: definition.status, to: "pendingReview" });
      const issues = validateWorker(definition, state.tools);
      if (issues.length) return refuse("definitionInvalid", { detail: issues[0] });
      return { state: note({ ...state, definitions: replace(state.definitions, { ...definition, status: "pendingReview", submittedBy: event.actor }) }, event, "worker.submit", definition.id) };
    }

    case "worker.review": {
      const denied = needPerson();
      if (denied) return denied;
      const definition = definitionOf(state, event.definitionId);
      if (!definition) return refuse("definitionNotFound");
      if (definition.status !== "pendingReview") return refuse("nothingToReview");
      if (definition.origin === "kynova" ? !isAdmin(state, event.actor) : definition.ownerTenantId !== event.tenantId) return refuse(definition.origin === "kynova" ? "adminRequired" : "notYours", undefined, true);
      if (definition.submittedBy === event.actor) return refuse("selfReview");
      if (!event.approve && !event.reason?.trim()) return refuse("reasonRequired");
      if (event.approve) {
        const issues = validateWorker(definition, state.tools);
        if (issues.length) return refuse("definitionInvalid", { detail: issues[0] });
      }
      return { state: note({ ...state, definitions: replace(state.definitions, { ...definition, status: event.approve ? ("active" as const) : ("draft" as const) }) }, event, event.approve ? "worker.approve" : "worker.reject", `${definition.id}${event.reason ? ` · ${event.reason.trim()}` : ""}`) };
    }

    case "worker.retire": {
      const denied = needPerson();
      if (denied) return denied;
      const definition = definitionOf(state, event.definitionId);
      if (!definition) return refuse("definitionNotFound");
      if (definition.origin === "kynova" ? !isAdmin(state, event.actor) : definition.ownerTenantId !== event.tenantId) return refuse("notYours", undefined, true);
      if (definition.status !== "active") return refuse("invalidTransition", { from: definition.status, to: "retired" });
      // retiring a Worker stops its instances and its runs everywhere
      const instances = state.instances.map((instance) => (instance.definitionId === definition.id && instance.status !== "disabled" ? { ...instance, status: "paused" as const } : instance)); // an instance that was switched off stays off
      const runs = state.runs.map((run) => (run.workerId === definition.id && isLive(run) ? { ...run, status: "cancelled" as const, finishedAt: event.at } : run));
      return { state: note({ ...state, instances, runs, definitions: replace(state.definitions, { ...definition, status: "retired" }) }, event, "worker.retire", definition.id, "warn") };
    }

    case "worker.enable": {
      const denied = needPerson();
      if (denied) return denied;
      const definition = definitionOf(state, event.definitionId);
      if (!definition) return refuse("definitionNotFound");
      if (definition.origin === "tenant" && definition.ownerTenantId !== event.tenantId) return refuse("notYours", undefined, true);
      if (definition.status !== "active") return refuse("notActive");
      if (instanceFor(state, event.tenantId, definition.id)) return refuse("alreadyEnabled");
      const created = nextId(state, "wi");
      const instance: WorkerInstance = { id: created.id, tenantId: event.tenantId, definitionId: definition.id, status: "active", enabledBy: event.actor, enabledAt: event.at, maxRunsPerDay: definition.limits.maxRunsPerDay, deniedProviders: [] };
      return { state: note({ ...created.state, instances: append(created.state.instances, instance) }, event, "worker.enable", `${instance.id} · ${definition.id}`) };
    }

    case "instance.pause":
    case "instance.resume": {
      const denied = needPerson();
      if (denied) return denied;
      const instance = state.instances.find((item) => item.id === event.instanceId);
      if (!instance) return refuse("instanceNotFound");
      if (instance.tenantId !== event.tenantId) return refuse("notYours", undefined, true);
      const to = event.type === "instance.pause" ? "paused" : "active";
      if (instance.status !== (to === "paused" ? "active" : "paused")) return refuse("invalidTransition", { from: label("instanceStatus", instance.status), to: label("instanceStatus", to) });
      return { state: note({ ...state, instances: replace(state.instances, { ...instance, status: to }) }, event, event.type, instance.id, event.type === "instance.pause" ? "warn" : "info") };
    }

    // Switching a Worker off in a company: its live runs (and what they delegated) are cancelled, pending approvals are rejected, and it stays off until enabled again.
    case "instance.disable": {
      const denied = needPerson();
      if (denied) return denied;
      const instance = state.instances.find((item) => item.id === event.instanceId);
      if (!instance) return refuse("instanceNotFound");
      if (instance.tenantId !== event.tenantId) return refuse("notYours", undefined, true);
      if (instance.status === "disabled") return refuse("invalidTransition", { from: label("instanceStatus", "disabled"), to: label("instanceStatus", "disabled") });
      const stopped = new Set<string>();
      for (const run of state.runs.filter((item) => item.instanceId === instance.id && isLive(item))) {
        stopped.add(run.id);
        for (const child of live(state, run.id)) stopped.add(child.id);
      }
      const runs = state.runs.map((item) => (stopped.has(item.id) ? { ...item, status: "cancelled" as const, finishedAt: event.at } : item));
      const approvals = state.approvals.map((item) => (stopped.has(item.runId) && item.status === "pending" ? { ...item, status: "rejected" as const, decidedBy: event.actor, decidedAt: event.at, reason: "Worker deshabilitado" } : item));
      const memory = state.memory.map((item) => (item.runId && stopped.has(item.runId) && item.scope === "run" ? { ...item, value: "", cleared: true } : item));
      return { state: note({ ...state, runs, approvals, memory, instances: replace(state.instances, { ...instance, status: "disabled" as const }) }, event, "instance.disable", `${instance.id}${stopped.size ? ` · ${stopped.size} ejecuciones canceladas` : ""}`, "warn") };
    }

    case "instance.enable": {
      const denied = needPerson();
      if (denied) return denied;
      const instance = state.instances.find((item) => item.id === event.instanceId);
      if (!instance) return refuse("instanceNotFound");
      if (instance.tenantId !== event.tenantId) return refuse("notYours", undefined, true);
      if (instance.status !== "disabled") return refuse("invalidTransition", { from: label("instanceStatus", instance.status), to: label("instanceStatus", "active") });
      const definition = definitionOf(state, instance.definitionId);
      if (!definition || definition.status !== "active") return refuse("notActive");
      return { state: note({ ...state, instances: replace(state.instances, { ...instance, status: "active" as const }) }, event, "instance.enable", instance.id) };
    }

    // Per-company configuration: a lower daily run limit, and model providers this company does not want this Worker to use.
    case "instance.configure": {
      const denied = needPerson();
      if (denied) return denied;
      const instance = state.instances.find((item) => item.id === event.instanceId);
      if (!instance) return refuse("instanceNotFound");
      if (instance.tenantId !== event.tenantId) return refuse("notYours", undefined, true);
      const definition = definitionOf(state, instance.definitionId);
      if (!definition) return refuse("definitionNotFound");
      if (!Number.isInteger(event.maxRunsPerDay) || event.maxRunsPerDay < 1 || event.maxRunsPerDay > definition.limits.maxRunsPerDay) return refuse("configInvalid", { detail: `ejecuciones por día de 1 a ${definition.limits.maxRunsPerDay}` });
      const known = new Set(state.models.map((model) => model.provider));
      const unknown = event.deniedProviders.find((provider) => !known.has(provider));
      if (unknown) return refuse("configInvalid", { detail: `proveedor desconocido: ${unknown}` });
      const providers = [...new Set(event.deniedProviders)];
      return { state: note({ ...state, instances: replace(state.instances, { ...instance, maxRunsPerDay: event.maxRunsPerDay, deniedProviders: providers }) }, event, "instance.configure", `${instance.id} · ${event.maxRunsPerDay}/día${providers.length ? ` · sin ${providers.join(", ")}` : ""}`) };
    }

    // ================================================================ kill switches: a person can stop everything at once
    case "tenant.pause": {
      const denied = needPerson();
      if (denied) return denied;
      const pausedTenants = event.paused ? (state.pausedTenants.includes(event.tenantId) ? state.pausedTenants : append(state.pausedTenants, event.tenantId)) : state.pausedTenants.filter((id) => id !== event.tenantId);
      return { state: note({ ...state, pausedTenants }, event, event.paused ? "tenant.pause" : "tenant.resume", undefined, event.paused ? "warn" : "info") };
    }

    case "platform.pause": {
      const denied = needAdmin();
      if (denied) return denied;
      return { state: note({ ...state, platformPaused: event.paused }, event, event.paused ? "platform.pause" : "platform.resume", undefined, event.paused ? "warn" : "info") };
    }

    // ================================================================ Level 2 authorizations: only a person, only Level 2, always with a limit
    case "authorization.grant": {
      const denied = needPerson();
      if (denied) return denied;
      const instance = state.instances.find((item) => item.id === event.instanceId);
      if (!instance) return refuse("instanceNotFound");
      if (instance.tenantId !== event.tenantId) return refuse("notYours", undefined, true);
      const definition = definitionOf(state, instance.definitionId);
      if (!definition || !definition.tools.includes(event.action)) return refuse("authorizationInvalid", { detail: "el Worker no tiene esa herramienta" });
      if (levelForAction(event.action) !== 2) return refuse("authorizationInvalid", { detail: levelForAction(event.action) === 3 ? "el Nivel 3 siempre pide confirmación y no se autoriza" : "el Nivel 1 no necesita autorización" }, true);
      if (!Number.isInteger(event.maxPerDay) || event.maxPerDay < 1 || event.maxPerDay > 1_000) return refuse("authorizationInvalid", { detail: "el límite diario va de 1 a 1 000" });
      if (event.expiresAt && (Number.isNaN(Date.parse(event.expiresAt)) || Date.parse(event.expiresAt) <= Date.parse(event.at))) return refuse("authorizationInvalid", { detail: "el vencimiento debe ser futuro" });
      const created = nextId(state, "au");
      const authorization: WorkerAuthorization = { id: created.id, tenantId: event.tenantId, instanceId: instance.id, action: event.action, maxPerDay: event.maxPerDay, expiresAt: event.expiresAt, grantedBy: event.actor, grantedAt: event.at, status: "active" };
      return { state: note({ ...created.state, authorizations: append(created.state.authorizations, authorization) }, event, "authorization.grant", `${authorization.id} · ${event.action} · ${event.maxPerDay}/día`) };
    }

    case "authorization.revoke": {
      const denied = needPerson();
      if (denied) return denied;
      const authorization = state.authorizations.find((item) => item.id === event.authorizationId);
      if (!authorization) return refuse("authorizationNotFound");
      if (authorization.tenantId !== event.tenantId) return refuse("notYours", undefined, true);
      return { state: note({ ...state, authorizations: replace(state.authorizations, { ...authorization, status: "revoked" as const }) }, event, "authorization.revoke", authorization.id, "warn") };
    }

    // ================================================================ runs
    case "run.start": {
      if (!person && event.actor !== "system") return refuse("personRequired", undefined, true);
      const stopped = paused(event.tenantId);
      if (stopped) return stopped;
      const instance = state.instances.find((item) => item.id === event.instanceId);
      if (!instance) return refuse("instanceNotFound");
      if (instance.tenantId !== event.tenantId) return refuse("notYours", undefined, true);
      if (instance.status === "disabled") return refuse("instanceDisabled");
      if (instance.status === "paused") return refuse("instancePaused");
      const definition = definitionOf(state, instance.definitionId);
      if (!definition || definition.status !== "active") return refuse("notActive");
      const limit = Math.min(instance.maxRunsPerDay, definition.limits.maxRunsPerDay);
      if (state.runs.filter((run) => run.instanceId === instance.id && sameDay(run.startedAt, event.at)).length >= limit) return refuse("dailyRunLimit", { max: limit });
      if (event.goal.trim() === "") return refuse("reasonRequired");
      const created = nextId(state, "rn");
      const context = (event.context ?? []).filter((item) => covers(definition.dataClearance, item.sensitivity));
      const run: Run = { id: created.id, tenantId: event.tenantId, instanceId: instance.id, workerId: definition.id, goal: event.goal.trim(), status: "running", startedBy: event.actor, startedAt: event.at, rootRunId: created.id, depth: 0, chain: [definition.id], steps: [], context, dataTouched: context.reduce<Clearance>((max, item) => higher(max, item.sensitivity), "business") };
      return { state: note({ ...created.state, runs: append(created.state.runs, run) }, event, "run.start", `${run.id} · ${definition.id}`, "info", run.id) };
    }

    case "run.tool": {
      const found = workingRun(event.runId);
      if (!found.run || !found.definition) return found.failure as KoeResult;
      const { run, definition } = found;
      const limit = stepLimit(run, definition);
      if (limit) return limit;
      const entry = state.tools[event.tool];
      if (!entry || entry.status !== "active") return refuse("toolUnknown", { tool: event.tool }, true);
      if (!definition.tools.includes(event.tool)) return refuse("toolNotAllowed", { tool: event.tool }, true);
      if (!effectiveTools(definition, run).includes(event.tool)) return refuse("toolNotGranted", { tool: event.tool }, true);
      const missing = entry.manifest.required.filter((field) => !(event.input[field] ?? "").trim());
      if (missing.length) return refuse("inputInvalid", { detail: missing.join(", ") });
      const verdict = decideTool(state, run, definition, event.tool, event.at);
      const touched = higher(run.dataTouched, entry.manifest.dataAccess);
      if (verdict.decision === "allowed") {
        const added = addStep({ ...run, dataTouched: touched }, { at: event.at, kind: "tool", detail: entry.manifest.label, tool: event.tool, level: verdict.level, decision: "allowed", output: simulateToolOutput(entry.manifest, event.input) }, state);
        return { state: note({ ...added.state, runs: replace(added.state.runs, added.run) }, event, "tool.allowed", `${event.tool} · Nivel ${verdict.level}`, "info", run.id) };
      }
      // needs a person: nothing happens until someone approves, and the run waits
      const approvalId = nextId(state, "ap");
      const added = addStep({ ...run, dataTouched: touched, status: "waitingApproval" }, { at: event.at, kind: "tool", detail: entry.manifest.label, tool: event.tool, level: verdict.level, decision: "needsApproval", approvalId: approvalId.id }, approvalId.state);
      const approval: Approval = { id: approvalId.id, tenantId: run.tenantId, runId: run.id, stepId: added.step.id, tool: event.tool, input: event.input, level: verdict.level, financial: entry.manifest.financial, requestedAt: event.at, status: "pending" };
      return { state: note({ ...added.state, runs: replace(added.state.runs, added.run), approvals: append(added.state.approvals, approval) }, event, "tool.needsApproval", `${event.tool} · Nivel ${verdict.level} · ${approval.id}`, "info", run.id) };
    }

    case "approval.decide": {
      const denied = needPerson();
      if (denied) return denied;
      const approval = state.approvals.find((item) => item.id === event.approvalId);
      if (!approval) return refuse("approvalNotFound");
      if (approval.tenantId !== event.tenantId) return refuse("notYours", undefined, true);
      if (approval.status !== "pending") return refuse("approvalResolved");
      const run = state.runs.find((item) => item.id === approval.runId);
      if (!run) return refuse("runNotFound");
      const root = state.runs.find((item) => item.id === run.rootRunId) ?? run;
      if (event.approve) {
        const stopped = paused(approval.tenantId);
        if (stopped) return stopped; // while paused nothing executes; it can still be rejected
        if (approval.financial && isPerson(root.startedBy) && root.startedBy === event.actor) return refuse("selfApproval", undefined, true);
      }
      const entry = state.tools[approval.tool];
      const steps = run.steps.map((step) => (step.id === approval.stepId ? { ...step, decision: (event.approve ? "approved" : "rejected") as Decision, output: event.approve && entry ? simulateToolOutput(entry.manifest, approval.input) : step.output } : step));
      const updatedRun: Run = { ...run, steps, status: run.status === "waitingApproval" ? "running" : run.status };
      const decided: Approval = { ...approval, status: event.approve ? "approved" : "rejected", decidedBy: event.actor, decidedAt: event.at, reason: event.reason?.trim() || undefined };
      return { state: note({ ...state, runs: replace(state.runs, updatedRun), approvals: replace(state.approvals, decided) }, event, event.approve ? "approval.approve" : "approval.reject", `${approval.id} · ${approval.tool}`, "info", run.id) };
    }

    case "run.model": {
      const found = workingRun(event.runId);
      if (!found.run || !found.definition) return found.failure as KoeResult;
      const { run, definition } = found;
      const limit = stepLimit(run, definition);
      if (limit) return limit;
      const task: TaskProfile = { needs: definition.routing.needs, dataClearance: run.dataTouched, contextTokens: 2_000, needsTools: true, ...event.task };
      // the task can ask for more than the Worker's defaults, but never for less data protection than what the run has touched
      const protectedTask: TaskProfile = { ...task, dataClearance: higher(task.dataClearance, run.dataTouched) };
      // the company's own exclusions add to the Worker's policy; neither can widen the other
      const policy = { ...definition.routing.policy, deniedProviders: [...(definition.routing.policy.deniedProviders ?? []), ...(found.instance?.deniedProviders ?? [])] };
      const routed = routeModel(state.models, protectedTask, policy);
      if (!routed.chosen) {
        const failed = note(state, event, "model.none", routed.reason, "warn", run.id);
        return { state: failed, error: message("noModel", { detail: routed.reason.replace(/^ninguno cumple: /, "") }), errorCode: "noModel" };
      }
      const tokens = Math.ceil(protectedTask.contextTokens / 10) + 50;
      const added = addStep(run, { at: event.at, kind: "model", detail: `Consulta a ${routed.chosen.label}`, modelId: routed.chosen.id, routing: routed.reason, tokens, output: `[simulado] respuesta de ${routed.chosen.id}` }, state);
      return { state: note({ ...added.state, runs: replace(added.state.runs, added.run) }, event, "model.route", `${routed.chosen.id}${routed.fallbackUsed ? " (respaldo)" : ""} · ${protectedTask.dataClearance}`, routed.fallbackUsed ? "warn" : "info", run.id) };
    }

    case "run.delegate": {
      const found = workingRun(event.runId);
      if (!found.run || !found.definition) return found.failure as KoeResult;
      const { run, definition } = found;
      const limit = stepLimit(run, definition);
      if (limit) return limit;
      const target = definitionOf(state, event.toWorker);
      if (!target || target.status !== "active") return refuse("notActive");
      if (!definition.collaboration.delegatesTo.includes(target.id)) return refuse("delegationNotAllowed", { from: definition.id, to: target.id }, true);
      if (!canDelegate(definition, target)) return refuse("delegationNotAccepted", { from: definition.id, to: target.id }, true);
      if (run.chain.includes(target.id)) return refuse("delegationCycle", { to: target.id }, true);
      // the shallowest limit along the chain wins: nobody can be pushed deeper than they agreed to
      const maxDepth = Math.min(...run.chain.map((id) => definitionOf(state, id)?.limits.maxDelegationDepth ?? 0));
      if (run.depth + 1 > maxDepth) return refuse("delegationDepth", { max: maxDepth }, true);
      const targetInstance = instanceFor(state, run.tenantId, target.id);
      if (!targetInstance || targetInstance.status !== "active") return refuse("targetNotEnabled", { to: target.id });
      if (state.runs.filter((item) => item.instanceId === targetInstance.id && sameDay(item.startedAt, event.at)).length >= Math.min(targetInstance.maxRunsPerDay, target.limits.maxRunsPerDay)) return refuse("dailyRunLimit", { max: Math.min(targetInstance.maxRunsPerDay, target.limits.maxRunsPerDay) });
      // delegation never raises powers: only tools the receiver has AND (Level 1, or the delegator already holds them)
      const mine = effectiveTools(definition, run);
      const badGrant = event.grant.find((id) => !target.tools.includes(id) || (levelForAction(id) !== 1 && !mine.includes(id)));
      if (badGrant) return refuse("grantInvalid", { detail: badGrant }, true);
      if (event.goal.trim() === "") return refuse("reasonRequired");

      // the bundle: what the delegator chose to share, minus whatever the receiver is not cleared for
      const memories = state.memory.filter((item) => item.runId === run.id && !item.cleared);
      const offered: ContextItem[] = [
        ...run.context,
        ...memories.filter((item) => event.contextKeys.includes(item.key)).map((item) => ({ key: item.key, value: item.value, sensitivity: item.sensitivity, from: definition.id })),
      ].filter((item, index, all) => all.findIndex((other) => other.key === item.key) === index && (run.context.some((c) => c.key === item.key) || event.contextKeys.includes(item.key)));
      const bundle = offered.filter((item) => covers(target.dataClearance, item.sensitivity));
      const withheld = offered.length - bundle.length;

      const created = nextId(state, "rn");
      const child: Run = {
        id: created.id, tenantId: run.tenantId, instanceId: targetInstance.id, workerId: target.id, goal: event.goal.trim(), status: "running", startedBy: run.startedBy, startedAt: event.at,
        parentRunId: run.id, rootRunId: run.rootRunId, depth: run.depth + 1, chain: [...run.chain, target.id], grant: event.grant.length ? event.grant : target.tools.filter((id) => levelForAction(id) === 1),
        steps: [], context: bundle, dataTouched: bundle.reduce<Clearance>((max, item) => higher(max, item.sensitivity), "business"),
      };
      const added = addStep(run, { at: event.at, kind: "delegate", detail: `Delega en ${target.name}${withheld ? ` · ${withheld} dato(s) retenido(s) por privacidad` : ""}`, childRunId: child.id }, created.state);
      return { state: note({ ...added.state, runs: append(replace(added.state.runs, added.run), child) }, event, "run.delegate", `${definition.id} → ${target.id} · ${child.id}${withheld ? ` · retenidos ${withheld}` : ""}`, withheld ? "warn" : "info", run.id) };
    }

    case "run.finish": {
      const found = workingRun(event.runId);
      if (!found.run || !found.definition) return found.failure as KoeResult;
      const { run, definition } = found;
      if (live(state, run.id).length) return refuse("childrenRunning");
      if (event.result.trim() === "") return refuse("reasonRequired");
      const added = addStep(run, { at: event.at, kind: "result", detail: event.outcome === "completed" ? "Terminó" : "Falló", output: event.result.trim().slice(0, 2_000) }, state);
      let next: KoeState = { ...added.state, runs: replace(added.state.runs, { ...added.run, status: event.outcome, result: event.result.trim().slice(0, 2_000), finishedAt: event.at }) };
      // working memory belongs to the run: when it ends the values are erased and only the trace of their existence stays
      next = { ...next, memory: next.memory.map((item) => (item.runId === run.id && item.scope === "run" ? { ...item, value: "", cleared: true } : item)) };
      // the result travels back to the delegator, unless the delegator is not cleared for what the result touched
      if (run.parentRunId) {
        const parent = next.runs.find((item) => item.id === run.parentRunId);
        const parentDef = parent ? definitionOf(next, parent.workerId) : undefined;
        if (parent && parentDef) {
          const allowed = covers(parentDef.dataClearance, run.dataTouched);
          const item: ContextItem = { key: `resultado:${definition.id}`, value: allowed ? event.result.trim().slice(0, 500) : "[retenido: contiene datos personales]", sensitivity: allowed ? run.dataTouched : "business", from: definition.id };
          const delivered = addStep(parent, { at: event.at, kind: "result", detail: `Resultado de ${definition.name}${allowed ? "" : " (contenido retenido por privacidad)"}`, childRunId: run.id }, next);
          next = { ...delivered.state, runs: replace(delivered.state.runs, { ...delivered.run, context: [...delivered.run.context.filter((c) => c.key !== item.key), item], dataTouched: allowed ? higher(delivered.run.dataTouched, run.dataTouched) : delivered.run.dataTouched }) };
        }
      }
      return { state: note(next, event, event.outcome === "completed" ? "run.complete" : "run.fail", run.id, event.outcome === "failed" ? "warn" : "info", run.id) };
    }

    case "run.cancel": {
      const denied = needPerson();
      if (denied) return denied;
      const run = state.runs.find((item) => item.id === event.runId);
      if (!run) return refuse("runNotFound");
      if (run.tenantId !== event.tenantId) return refuse("notYours", undefined, true);
      if (!isLive(run)) return refuse("runNotRunning", { status: run.status });
      const cancelled = new Set([run.id, ...live(state, run.id).map((item) => item.id)]);
      const runs = state.runs.map((item) => (cancelled.has(item.id) ? { ...item, status: "cancelled" as const, finishedAt: event.at } : item));
      const approvals = state.approvals.map((item) => (cancelled.has(item.runId) && item.status === "pending" ? { ...item, status: "rejected" as const, decidedBy: event.actor, decidedAt: event.at, reason: "ejecución cancelada" } : item));
      const memory = state.memory.map((item) => (item.runId && cancelled.has(item.runId) && item.scope === "run" ? { ...item, value: "", cleared: true } : item));
      return { state: note({ ...state, runs, approvals, memory }, event, "run.cancel", `${run.id}${cancelled.size > 1 ? ` (+${cancelled.size - 1} delegadas)` : ""}`, "warn", run.id) };
    }

    // ================================================================ working memory
    case "memory.put": {
      const found = workingRun(event.runId);
      if (!found.run || !found.definition || !found.instance) return found.failure as KoeResult;
      const { run, definition, instance } = found;
      const { memory } = definition;
      if (event.key.trim() === "" || event.key.length > 60) return refuse("reasonRequired");
      if (event.value.length > memory.maxChars) return refuse("memoryTooLong", { max: memory.maxChars });
      if (looksSecret(event.value)) return refuse("memorySecret", undefined, true);
      if (!covers(definition.dataClearance, event.sensitivity) || (event.sensitivity === "personal" && !memory.allowPersonal)) return refuse("memoryClearance", { level: event.sensitivity }, true);
      const mine = state.memory.filter((item) => item.runId === run.id && item.scope === "run");
      if (mine.filter((item) => item.key !== event.key).length >= memory.maxEntries) return refuse("memoryFull", { max: memory.maxEntries });
      const created = nextId(state, "me");
      const entry: MemoryEntry = { id: created.id, tenantId: run.tenantId, instanceId: instance.id, runId: run.id, scope: "run", key: event.key.trim(), value: event.value, sensitivity: event.sensitivity, createdAt: event.at };
      const kept = created.state.memory.filter((item) => !(item.runId === run.id && item.scope === "run" && item.key === entry.key));
      const added = addStep({ ...run, dataTouched: higher(run.dataTouched, event.sensitivity) }, { at: event.at, kind: "memory", detail: `Guarda «${entry.key}» (${event.sensitivity})` }, { ...created.state, memory: append(kept, entry) });
      return { state: note({ ...added.state, runs: replace(added.state.runs, added.run) }, event, "memory.put", `${entry.key} · ${event.sensitivity}`, "info", run.id) };
    }

    case "memory.promote": {
      const denied = needPerson();
      if (denied) return denied;
      const entry = state.memory.find((item) => item.id === event.entryId);
      if (!entry) return refuse("memoryNotFound");
      if (entry.tenantId !== event.tenantId) return refuse("notYours", undefined, true);
      const instance = state.instances.find((item) => item.id === entry.instanceId);
      const definition = instance ? definitionOf(state, instance.definitionId) : undefined;
      if (!definition || !instance) return refuse("instanceNotFound");
      if (entry.cleared || entry.scope !== "run") return refuse("memoryNotPromotable", { detail: "ya fue borrada o ya es conservada" });
      if (!definition.memory.durable) return refuse("memoryNotPromotable", { detail: "este Worker no conserva memoria" });
      if (entry.sensitivity === "personal") return refuse("memoryNotPromotable", { detail: "los datos personales viven en el CRM, no en la memoria" }, true);
      if (state.memory.filter((item) => item.instanceId === instance.id && item.scope === "durable" && !item.cleared).length >= definition.memory.maxEntries) return refuse("memoryFull", { max: definition.memory.maxEntries });
      const created = nextId(state, "me");
      const durable: MemoryEntry = { ...entry, id: created.id, runId: undefined, scope: "durable", createdAt: event.at, expiresAt: addDays(event.at, MEMORY_DURABLE_DAYS) };
      return { state: note({ ...created.state, memory: append(created.state.memory, durable) }, event, "memory.promote", `${entry.key} → ${durable.id}`) };
    }

    case "memory.forget": {
      const denied = needPerson();
      if (denied) return denied;
      const entry = state.memory.find((item) => item.id === event.entryId);
      if (!entry) return refuse("memoryNotFound");
      if (entry.tenantId !== event.tenantId) return refuse("notYours", undefined, true);
      return { state: note({ ...state, memory: replace(state.memory, { ...entry, value: "", cleared: true }) }, event, "memory.forget", entry.key, "warn") };
    }

    // ================================================================ extending the platform with data: tools and models
    case "tool.register": {
      const denied = needAdmin();
      if (denied) return denied;
      const issues = validateTool(event.manifest);
      if (issues.length) return refuse("toolRegistrationInvalid", { detail: issues[0] });
      if (state.tools[event.manifest.id]) return refuse("toolExists");
      return { state: note({ ...state, tools: { ...state.tools, [event.manifest.id]: { manifest: event.manifest, status: "pending", registeredBy: event.actor } } }, event, "tool.register", event.manifest.id) };
    }

    case "tool.approve": {
      const denied = needAdmin();
      if (denied) return denied;
      const entry = state.tools[event.toolId];
      if (!entry) return refuse("toolNotFound");
      if (entry.status === "active") return refuse("toolExists");
      if (entry.registeredBy === event.actor) return refuse("selfReview");
      return { state: note({ ...state, tools: { ...state.tools, [event.toolId]: { ...entry, status: "active", approvedBy: event.actor } } }, event, "tool.approve", event.toolId) };
    }

    case "model.register": {
      const denied = needAdmin();
      if (denied) return denied;
      const issues = validateModel(event.model);
      if (issues.length) return refuse("modelInvalid", { detail: issues[0] });
      if (state.models.some((item) => item.id === event.model.id)) return refuse("modelInvalid", { detail: "identificador repetido" });
      return { state: note({ ...state, models: append(state.models, event.model) }, event, "model.register", event.model.id) };
    }

    case "model.update": {
      const denied = needAdmin();
      if (denied) return denied;
      const current = state.models.find((item) => item.id === event.modelId);
      if (!current) return refuse("modelNotFound");
      const updated: ModelManifest = { ...current, health: event.health ?? current.health, enabled: event.enabled ?? current.enabled };
      return { state: note({ ...state, models: state.models.map((item) => (item.id === updated.id ? updated : item)) }, event, "model.update", `${updated.id} · ${updated.health}${updated.enabled ? "" : " · desactivado"}`, updated.health === "healthy" && updated.enabled ? "info" : "warn") };
    }

    case "tick": {
      const now = Date.parse(event.at);
      const memory = state.memory.map((item) => (item.scope === "durable" && !item.cleared && item.expiresAt && Date.parse(item.expiresAt) <= now ? { ...item, value: "", cleared: true } : item));
      const expired = state.approvals.filter((item) => item.status === "pending" && now - Date.parse(item.requestedAt) > APPROVAL_TTL_HOURS * 3_600_000);
      const approvals = state.approvals.map((item) => (expired.includes(item) ? { ...item, status: "expired" as const } : item));
      const runs = state.runs.map((run) => {
        const mine = expired.filter((item) => item.runId === run.id);
        if (mine.length === 0) return run;
        return { ...run, status: run.status === "waitingApproval" ? ("running" as const) : run.status, steps: run.steps.map((step) => (mine.some((item) => item.stepId === step.id) ? { ...step, decision: "expired" as const } : step)) };
      });
      return { state: note({ ...state, memory, approvals, runs }, event, "tick", expired.length ? `${expired.length} aprobaciones vencidas` : undefined) };
    }
  }
}

export function applyAllKoe(state: KoeState, events: readonly KoeEvent[]): { state: KoeState; errors: string[] } {
  const errors: string[] = [];
  let current = state;
  for (const event of events) {
    const result = reduceKoe(current, event);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    current = result.state;
  }
  return { state: current, errors };
}

// ---------------------------------------------------------------- views
export const runsOf = (state: KoeState, tenantId: string) => state.runs.filter((run) => run.tenantId === tenantId);
export const rootRunsOf = (state: KoeState, tenantId: string) => runsOf(state, tenantId).filter((run) => !run.parentRunId);
export const pendingApprovals = (state: KoeState, tenantId: string) => state.approvals.filter((item) => item.tenantId === tenantId && item.status === "pending");
export const memoryOf = (state: KoeState, tenantId: string) => state.memory.filter((item) => item.tenantId === tenantId);
export const instancesOf = (state: KoeState, tenantId: string) => state.instances.filter((item) => item.tenantId === tenantId);

/** A human-readable trace of a run and everything it delegated. This is what "audit" looks like to a person. */
export function explainRun(state: KoeState, runId: string, depth = 0): string[] {
  const run = state.runs.find((item) => item.id === runId);
  if (!run) return [];
  const pad = "  ".repeat(depth);
  const definition = definitionOf(state, run.workerId);
  const lines = [`${pad}${definition?.name ?? run.workerId} · ${run.status} · «${run.goal}» (inició ${run.startedBy})`];
  for (const step of run.steps) {
    const decision = step.decision ? ` [${step.decision}${step.level ? ` · Nivel ${step.level}` : ""}]` : "";
    lines.push(`${pad}  - ${step.kind}: ${step.detail}${decision}${step.routing ? ` → ${step.routing}` : ""}`);
    if (step.childRunId && step.kind === "delegate") lines.push(...explainRun(state, step.childRunId, depth + 2));
  }
  return lines;
}

export type DelegationEdge = { from: string; to: string };
/** The collaboration graph of a company: an edge exists only when both Workers are enabled and both sides agree. */
export function delegationGraph(state: KoeState, tenantId: string): DelegationEdge[] {
  const enabled = instancesOf(state, tenantId).filter((item) => item.status === "active").map((item) => definitionOf(state, item.definitionId)).filter((item): item is WorkerDefinition => Boolean(item && item.status === "active"));
  const edges: DelegationEdge[] = [];
  for (const from of enabled) for (const to of enabled) if (from.id !== to.id && canDelegate(from, to)) edges.push({ from: from.id, to: to.id });
  return edges;
}

export function instanceUsage(state: KoeState, instance: WorkerInstance, at: string): { runsToday: number; authorizations: { authorization: WorkerAuthorization; usedToday: number }[] } {
  const runs = state.runs.filter((run) => run.instanceId === instance.id);
  return {
    runsToday: runs.filter((run) => sameDay(run.startedAt, at)).length,
    authorizations: state.authorizations.filter((item) => item.instanceId === instance.id && item.status === "active").map((authorization) => ({
      authorization, usedToday: runs.flatMap((run) => run.steps).filter((step) => step.tool === authorization.action && step.decision === "allowed" && sameDay(step.at, at)).length,
    })),
  };
}

export { autonomyOf };
