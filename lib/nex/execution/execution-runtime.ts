// Execution Runtime Adapter: the four functions a future runtime will use to get a plan ready, and NOTHING more. They only build and return data structures:
//   prepareExecution()  — Copilot output → plans (permissions applied first, idempotent), with workers assigned and the plan validated;
//   validateExecution() — what is wrong or missing in a plan before anybody approves it;
//   assignWorkers()     — which of the company's workers would do each step;
//   scheduleExecution() — in what order, and when (as offsets), the steps would run.
// None of them executes an action, calls the Runtime, a Worker or a Connector, reads a clock or touches a network: they are pure.

import { isKnownAction } from "@/lib/contracts/platform/workers";
import { CONNECTOR_IDS } from "@/lib/contracts/platform/connectors";
import { PRIORITY_RANK, buildPlan, finalize, planDependencies, topologicalOrder } from "./planner";
import { canSeeAction, canSeeRecommendation, isTerminal } from "./execution-policy";
import type { ConnectorId, DroppedCounts, ExecutionConfig, ExecutionPlan, ExecutionSources, ExecutionStep, Principal, Recommendation, RosterView, SuggestedAction, ValidationIssue, ValidationReport } from "./execution-types";

// ---------------------------------------------------------------------------------------------- assignWorkers
const loadOf = (plans: readonly ExecutionPlan[]): Map<string, number> => {
  const load = new Map<string, number>();
  for (const plan of plans) if (!isTerminal(plan.status)) for (const step of plan.steps) if (step.worker.workerId) load.set(step.worker.workerId, (load.get(step.worker.workerId) ?? 0) + 1);
  return load;
};
/**
 * Chooses, for each step, one ACTIVE worker of the company whose specialty fits, the one with the least work so far (ties by id). A step with no fitting worker stays unassigned.
 * Only the plan's own structure changes: nobody is told anything.
 */
export function assignWorkers(plan: ExecutionPlan, roster: RosterView, load: ReadonlyMap<string, number> = new Map(), grants: readonly string[] = []): ExecutionPlan {
  const counts = new Map(load);
  const steps: ExecutionStep[] = plan.steps.map((step) => {
    const candidates = roster.workers.filter((worker) => worker.status === "active" && worker.specialty === step.worker.specialty).sort((a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0) || a.id.localeCompare(b.id));
    const chosen = candidates[0];
    if (!chosen) return { ...step, worker: { specialty: step.worker.specialty } };
    counts.set(chosen.id, (counts.get(chosen.id) ?? 0) + 1);
    return { ...step, worker: { specialty: step.worker.specialty, workerId: chosen.id } };
  });
  return finalize({ ...plan, steps }, plan.modules, grants);
}

// ---------------------------------------------------------------------------------------------- validateExecution
export type ValidationContext = { connected: readonly ConnectorId[]; grants: readonly string[]; nowMs?: number };
/** Errors stop a plan from being submitted; warnings are for whoever approves it. */
export function validateExecution(plan: ExecutionPlan, context: ValidationContext): ValidationReport {
  const issues: ValidationIssue[] = [];
  const error = (code: string, stepId?: string) => issues.push({ code, severity: "error", ...(stepId ? { stepId } : {}) });
  const warn = (code: string, stepId?: string) => issues.push({ code, severity: "warning", ...(stepId ? { stepId } : {}) });
  if (plan.steps.length === 0) error("plan.empty");
  const ids = new Set(plan.steps.map((step) => step.id));
  for (const step of plan.steps) {
    for (const dep of step.dependsOn) if (!ids.has(dep)) error("step.dependencyMissing", step.id);
    if (!isKnownAction(step.action)) error("step.unknownAction", step.id);
    if (step.timeoutMs <= 0) error("step.timeout", step.id);
    if (step.retry.maxAttempts < 1 || step.retry.backoffMs < 0) error("step.retry", step.id);
    if (step.authorizationLevel > 1 && step.rollbackPolicy === "none") error("step.rollbackMissing", step.id);
    if (step.rollbackPolicy !== "none" && !step.compensationAction) error("step.compensationMissing", step.id);
    if (step.connector && !(CONNECTOR_IDS as readonly string[]).includes(step.connector)) error("step.connectorUnknown", step.id);
    else if (step.connector && !context.connected.includes(step.connector)) warn("step.connectorNotConnected", step.id);
    if (!step.worker.workerId) warn("step.workerMissing", step.id);
    if (step.authorizationLevel === 2 && !context.grants.includes(step.action)) warn("step.standingAuthorizationMissing", step.id);
  }
  if (topologicalOrder(plan.steps) === undefined && !issues.some((issue) => issue.code === "step.dependencyMissing")) error("plan.cycle");
  if (context.nowMs !== undefined && Date.parse(plan.expiresAt) <= context.nowMs && !isTerminal(plan.status)) error("plan.expired");
  const sorted = issues.sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error") || a.code.localeCompare(b.code) || (a.stepId ?? "").localeCompare(b.stepId ?? ""));
  return { valid: !sorted.some((issue) => issue.severity === "error"), issues: sorted };
}

// ---------------------------------------------------------------------------------------------- scheduleExecution
export type ScheduleItem = { planId: string; stepId: string; workerId: string | null; startMs: number; endMs: number };
export type ExecutionSchedule = { queue: readonly string[]; items: readonly ScheduleItem[]; totalMs: number };
/**
 * When each step would run, as offsets from the moment the plans start (no clock): plans in order of priority, then impact, then id; a step starts when its dependencies are done and its worker is
 * free (a worker does one step at a time; steps with no worker share a virtual one per specialty); a plan waits for the plans it depends on. The same plans always give the same schedule.
 */
export function scheduleExecution(plans: readonly ExecutionPlan[]): ExecutionSchedule {
  const queue = [...plans].sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.expectedImpact.score - a.expectedImpact.score || a.id.localeCompare(b.id));
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  const free = new Map<string, number>();
  const planEnd = new Map<string, number>();
  const items: ScheduleItem[] = [];
  const visiting = new Set<string>();
  const place = (plan: ExecutionPlan): number => {
    const known = planEnd.get(plan.id);
    if (known !== undefined) return known;
    if (visiting.has(plan.id)) return 0; // a loop between plans cannot be scheduled: it is not waited for
    visiting.add(plan.id);
    const start = Math.max(0, ...plan.dependsOn.flatMap((dep) => { const other = byId.get(dep); return other ? [place(other)] : []; }));
    const end = new Map<string, number>();
    for (const stepId of topologicalOrder(plan.steps) ?? plan.steps.map((step) => step.id)) {
      const step = plan.steps.find((row) => row.id === stepId) as ExecutionStep;
      const worker = step.worker.workerId ?? null;
      const key = worker ?? `unassigned:${step.worker.specialty}`;
      const startMs = Math.max(start, free.get(key) ?? 0, ...step.dependsOn.map((dep) => end.get(dep) ?? 0));
      const endMs = startMs + step.estimatedMs;
      free.set(key, endMs);
      end.set(step.id, endMs);
      items.push({ planId: plan.id, stepId: step.id, workerId: worker, startMs, endMs });
    }
    const finished = Math.max(start, ...end.values());
    planEnd.set(plan.id, finished);
    visiting.delete(plan.id);
    return finished;
  };
  for (const plan of queue) place(plan);
  return { queue: queue.map((plan) => plan.id), items, totalMs: Math.max(0, ...planEnd.values()) };
}

// ---------------------------------------------------------------------------------------------- prepareExecution
export type PrepareInput = {
  tenantId: string; actor: Principal; at: string; recommendations: readonly Recommendation[]; actions: readonly SuggestedAction[];
  existing: readonly ExecutionPlan[]; sources: Pick<ExecutionSources, "roster" | "connected" | "grants">; config: Pick<ExecutionConfig, "planTtlMs">; createdBy: string;
};
export type PreparedExecution = { plans: readonly ExecutionPlan[]; unchanged: number; dropped: DroppedCounts };

/**
 * Copilot recommendations and actions → execution plans. Permissions come FIRST: an action of another company, an action the asker may not see and a recommendation behind money they may not see are
 * dropped before anything is built (and counted), so nothing they cannot see exists inside a plan. Only actions still waiting for a person (or already approved in the Copilot) become steps. Preparing
 * the same input again changes nothing: a recommendation that already has a plan in progress is left alone, and one whose plan ended gets a new revision.
 */
export function prepareExecution(input: PrepareInput): PreparedExecution {
  const dropped: DroppedCounts = { crossTenant: 0, hidden: 0, notSuggested: 0, noActions: 0, unknownAction: 0 };
  const usable = input.actions.filter((action) => {
    if (action.tenantId !== input.tenantId) { dropped.crossTenant += 1; return false; }
    if (!canSeeAction(input.actor, action)) { dropped.hidden += 1; return false; }
    if (action.status !== "suggested" && action.status !== "approved") { dropped.notSuggested += 1; return false; }
    if (!isKnownAction(action.actionId)) { dropped.unknownAction += 1; return false; }
    return true;
  });
  const created: ExecutionPlan[] = [];
  let unchanged = 0;
  const load = loadOf(input.existing);
  const recs = [...input.recommendations].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  for (const rec of recs) {
    if (!canSeeRecommendation(input.actor, rec)) { dropped.hidden += 1; continue; }
    const actions = usable.filter((action) => action.recommendationId === rec.id);
    if (actions.length === 0) { dropped.noActions += 1; continue; }
    const latest = [...input.existing, ...created].filter((plan) => plan.tenantId === input.tenantId && plan.findingId === rec.findingId).sort((a, b) => b.revision - a.revision)[0];
    if (latest && !isTerminal(latest.status)) { unchanged += 1; continue; }
    const built = buildPlan({ tenantId: input.tenantId, at: input.at, createdBy: input.createdBy, recommendation: rec, actions, revision: (latest?.revision ?? 0) + 1, config: input.config, grants: input.sources.grants });
    const assigned = assignWorkers(built, input.sources.roster, load, input.sources.grants);
    for (const step of assigned.steps) if (step.worker.workerId) load.set(step.worker.workerId, (load.get(step.worker.workerId) ?? 0) + 1);
    created.push(assigned);
  }
  // the plans each one waits for, now that all of them exist
  const everything = [...input.existing, ...created];
  return { plans: created.map((plan) => ({ ...plan, dependsOn: planDependencies(plan.findingId, everything.filter((row) => row.id !== plan.id), input.tenantId) })), unchanged, dropped };
}
