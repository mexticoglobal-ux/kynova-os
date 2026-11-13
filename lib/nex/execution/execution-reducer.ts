// Execution Reducer: `reduceExecution(state, event, sources, config)` is a pure reducer (no clock, no database, no network, no AI): the same state and event always give the same new state. It
// prepares plans from the Copilot's output and moves them through the nine states, and that is all. IT EXECUTES NOTHING: `start` and `report` only RECORD what a future runtime says it did (and only
// the system may say it), so "Running", "Paused" and "Completed" are bookkeeping. Every change of state is appended to the plan's own history, so a plan explains itself.
// States: Draft → WaitingApproval → Approved → Running ⇄ Paused → Completed; a plan can also be Rejected, Cancelled or Expired. A step failing more times than its retry policy allows pauses the plan.

import { isKnownAction } from "@/lib/contracts/platform/workers";
import { assignWorkers, prepareExecution, validateExecution } from "./execution-runtime";
import { canDecide, canOperate, canPrepare, canReport, canSeePlan, canSubmit, canTransition, isExpired, isTerminal, stepPermission } from "./execution-policy";
import { finalize, topologicalOrder } from "./planner";
import {
  DEFAULT_CONFIG,
  type AuditEntry, type ExecutionConfig, type ExecutionEvent, type ExecutionEventInput, type ExecutionEventType, type ExecutionOutcome, type ExecutionPlan, type ExecutionResult, type ExecutionSources, type ExecutionState,
  type ExecutionStep, type PlanStatus, type Principal, type Refusal,
} from "./execution-types";

export const newExecutionState = (): ExecutionState => ({ plans: [], seq: {}, audit: [] });
const MAX_AUDIT = 2_000;
const name = (principal: Principal): string => (principal.kind === "system" ? "system" : principal.id);

const note = (event: ExecutionEvent, type: ExecutionEventType, planId?: string, detail?: Readonly<Record<string, unknown>>): ExecutionEventInput => ({
  at: event.at, tenantId: event.actor.tenantId, actorKind: event.actor.kind, actorId: name(event.actor), type, ...(planId ? { planId } : {}), ...(detail ? { detail } : {}),
});
function finish(state: ExecutionState, event: ExecutionEvent, result: Omit<ExecutionResult, "events">, events: readonly ExecutionEventInput[], detail: Record<string, string | number | boolean> = {}): ExecutionOutcome {
  // the audit trail names the action and counts, never any content; it is written in the ACTOR's company
  const entry: AuditEntry = { at: event.at, actor: name(event.actor), tenantId: event.actor.tenantId, action: `${event.type}${result.ok ? "" : ".refused"}`, detail: { ok: result.ok, ...(result.refusal ? { reason: result.refusal } : {}), ...detail } };
  return { state: { ...state, audit: [...state.audit, entry].slice(-MAX_AUDIT) }, result: { ...result, events } };
}
const refuse = (state: ExecutionState, event: ExecutionEvent, refusal: Refusal, reasons: readonly string[] = [], before: readonly ExecutionEventInput[] = []): ExecutionOutcome =>
  finish(state, event, { ok: false, refusal, ...(reasons.length > 0 ? { reasons } : {}) }, [...before, note(event, "execution.refused", undefined, { reason: refusal, action: event.type })]);

const replace = (state: ExecutionState, next: ExecutionPlan): ExecutionState => ({ ...state, plans: state.plans.map((plan) => (plan.tenantId === next.tenantId && plan.id === next.id ? next : plan)) });
const find = (state: ExecutionState, tenantId: string, id: string): ExecutionPlan | undefined => state.plans.find((plan) => plan.tenantId === tenantId && plan.id === id);
const STATUS_EVENT: Readonly<Partial<Record<PlanStatus, ExecutionEventType>>> = {
  WaitingApproval: "plan.submitted", Approved: "plan.approved", Rejected: "plan.rejected", Running: "plan.started", Paused: "plan.paused", Completed: "plan.completed", Cancelled: "plan.cancelled", Expired: "plan.expired",
};
/** A plan moved to a new state, with the change written into its own history. Callers check that the change exists first. */
const moved = (plan: ExecutionPlan, to: PlanStatus, by: string, at: string, patch: Partial<ExecutionPlan> = {}): ExecutionPlan => ({ ...plan, ...patch, status: to, history: [...plan.history, { at, from: plan.status, to, by }] });

/** A step is ready when everything it depends on is completed. */
const refreshReady = (steps: readonly ExecutionStep[]): ExecutionStep[] => steps.map((step) => (step.state === "pending" && step.dependsOn.every((dep) => steps.find((row) => row.id === dep)?.state === "completed") ? { ...step, state: "ready" as const } : step));

/** Plans past their expiry stop waiting. A plan that is Running is in progress and never expires. */
function sweep(state: ExecutionState, tenantId: string, event: ExecutionEvent, nowMs: number): { state: ExecutionState; events: ExecutionEventInput[] } {
  const events: ExecutionEventInput[] = [];
  const plans = state.plans.map((plan) => {
    if (plan.tenantId !== tenantId || !isExpired(plan, nowMs)) return plan;
    events.push(note(event, "plan.expired", plan.id, { from: plan.status }));
    return moved(plan, "Expired", "system", event.at);
  });
  return { state: events.length > 0 ? { ...state, plans } : state, events };
}

export function reduceExecution(start: ExecutionState, event: ExecutionEvent, sources: ExecutionSources, config: ExecutionConfig = DEFAULT_CONFIG): ExecutionOutcome {
  const { actor, tenantId } = event;
  const denied = stepPermission(actor, sources.env, tenantId);
  if (denied) return refuse(start, event, denied as Refusal); // authorize() only says `tenant` or `workerInactive`
  if (Number.isNaN(Date.parse(event.at))) return refuse(start, event, "invalid", ["at"]);
  const nowMs = Date.parse(event.at);
  const swept = sweep(start, tenantId, event, nowMs);
  let state = swept.state;
  const before = swept.events;
  const rejected = (refusal: Refusal, reasons: readonly string[] = []) => refuse(state, event, refusal, reasons, before);
  const done = (result: Omit<ExecutionResult, "events">, events: readonly ExecutionEventInput[], detail: Record<string, string | number | boolean> = {}) => finish(state, event, result, [...before, ...events], detail);
  /** the plan the asker may see, or nothing: what they cannot see does not exist for them */
  const visible = (planId: string): ExecutionPlan | undefined => { const plan = find(state, tenantId, planId); return plan && canSeePlan(actor, plan) ? plan : undefined; };
  const context = () => ({ connected: sources.connected, grants: sources.grants, nowMs });

  switch (event.type) {
    case "sweep": return done({ ok: true }, [], { expired: before.length });

    case "prepare": {
      if (!canPrepare(actor)) return rejected("forbidden");
      const prepared = prepareExecution({ tenantId, actor, at: event.at, recommendations: event.recommendations, actions: event.actions, existing: state.plans, sources, config, createdBy: name(actor) });
      const mine = state.plans.filter((plan) => plan.tenantId === tenantId);
      if (mine.length + prepared.plans.length > config.maxPlans) {
        const room = config.maxPlans - mine.filter((plan) => !isTerminal(plan.status)).length;
        if (room < prepared.plans.length) return rejected("invalid", ["maxPlans"]);
        const finished = mine.filter((plan) => isTerminal(plan.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
        const drop = new Set(finished.slice(0, mine.length + prepared.plans.length - config.maxPlans).map((plan) => plan.id));
        state = { ...state, plans: state.plans.filter((plan) => !(plan.tenantId === tenantId && drop.has(plan.id))) };
      }
      state = { ...state, plans: [...state.plans, ...prepared.plans] };
      const events = prepared.plans.flatMap((plan) => {
        const report = validateExecution(plan, context());
        return [
          note(event, "plan.prepared", plan.id, {
            priority: plan.priority, steps: plan.steps.length, level: Math.max(0, ...plan.steps.map((step) => step.authorizationLevel)), aiMicros: plan.cost.aiMicros, apiMicros: plan.cost.apiMicros, estimatedMs: plan.estimatedMs,
            workers: plan.workers.length, connectors: plan.connectors.length, unassigned: plan.steps.filter((step) => !step.worker.workerId).length,
          }),
          note(event, "plan.validated", plan.id, { errors: report.issues.filter((issue) => issue.severity === "error").length, warnings: report.issues.filter((issue) => issue.severity === "warning").length }),
        ];
      });
      return done({ ok: true, plans: prepared.plans, unchanged: prepared.unchanged, dropped: prepared.dropped }, events, { plans: prepared.plans.length, unchanged: prepared.unchanged });
    }

    case "assign": {
      if (!canOperate(actor)) return rejected("forbidden");
      const plan = visible(event.planId);
      if (!plan) return rejected("notFound");
      if (isTerminal(plan.status) || plan.status === "Running") return rejected("state", [plan.status]);
      const load = new Map<string, number>();
      for (const other of state.plans) if (other.tenantId === tenantId && other.id !== plan.id && !isTerminal(other.status)) for (const step of other.steps) if (step.worker.workerId) load.set(step.worker.workerId, (load.get(step.worker.workerId) ?? 0) + 1);
      const next = assignWorkers(plan, sources.roster, load, sources.grants);
      state = replace(state, next);
      return done({ ok: true, plan: next }, [note(event, "plan.assigned", plan.id, { unassigned: next.steps.filter((step) => !step.worker.workerId).length })]);
    }

    case "submit": {
      if (!canSubmit(actor)) return rejected("forbidden");
      const plan = visible(event.planId);
      if (!plan) return rejected("notFound");
      if (!canTransition(plan.status, "WaitingApproval")) return rejected("state", [plan.status]);
      const report = validateExecution(plan, context());
      if (!report.valid) return rejected("invalid", report.issues.filter((issue) => issue.severity === "error").map((issue) => issue.code));
      const next = moved(plan, "WaitingApproval", name(actor), event.at);
      state = replace(state, next);
      return done({ ok: true, plan: next }, [note(event, "plan.submitted", plan.id, { warnings: report.issues.length })]);
    }

    case "approve":
    case "reject": {
      const plan = visible(event.planId);
      if (!plan) return rejected("notFound");
      if (actor.kind !== "person") return rejected("forbidden");
      if (plan.status !== "WaitingApproval") return rejected("state", [plan.status]);
      // only a person whose role reaches the plan's highest authorization level decides
      if (!canDecide(actor, plan)) return rejected("level", [`requires:${plan.requiredRole}`]);
      const to: PlanStatus = event.type === "approve" ? "Approved" : "Rejected";
      const next = moved(plan, to, name(actor), event.at, { decidedBy: name(actor), decidedAt: event.at });
      state = replace(state, next);
      return done({ ok: true, plan: next }, [note(event, STATUS_EVENT[to] as ExecutionEventType, plan.id, { level: plan.authorizations[0]?.level ?? 1 })]);
    }

    case "cancel": {
      if (!canOperate(actor)) return rejected("forbidden");
      const plan = visible(event.planId);
      if (!plan) return rejected("notFound");
      if (!canTransition(plan.status, "Cancelled")) return rejected("state", [plan.status]);
      // what was already done has to be undone, in reverse order: the compensations are PREPARED here, never run
      const completed = new Set(plan.steps.filter((step) => step.state === "completed").map((step) => step.id));
      const rollback = plan.rollback.steps.filter((entry) => completed.has(entry.stepId));
      const next = moved(plan, "Cancelled", name(actor), event.at, { rollback: { ...plan.rollback, requested: rollback.length > 0, requestedSteps: rollback.map((entry) => entry.stepId) } });
      state = replace(state, next);
      return done({ ok: true, plan: next, rollback }, [note(event, "plan.cancelled", plan.id, { from: plan.status }), ...(rollback.length > 0 ? [note(event, "plan.rollback_requested", plan.id, { steps: rollback.length })] : [])]);
    }

    case "start": {
      if (!canReport(actor)) return rejected("forbidden");
      const plan = visible(event.planId);
      if (!plan) return rejected("notFound");
      if (!canTransition(plan.status, "Running") || plan.status !== "Approved") return rejected("state", [plan.status]);
      // it waits for the plans it depends on, and every step needs a worker
      const waiting = plan.dependsOn.filter((dep) => find(state, tenantId, dep)?.status !== "Completed");
      if (waiting.length > 0) return rejected("dependency", waiting);
      const unassigned = plan.steps.filter((step) => !step.worker.workerId);
      if (unassigned.length > 0) return rejected("blocked", ["step.workerMissing"]);
      const next = moved(plan, "Running", name(actor), event.at, { startedAt: event.at, steps: refreshReady(plan.steps) });
      state = replace(state, next);
      return done({ ok: true, plan: next }, [note(event, "plan.started", plan.id, { steps: plan.steps.length })]);
    }

    case "pause": {
      if (!canOperate(actor)) return rejected("forbidden");
      const plan = visible(event.planId);
      if (!plan) return rejected("notFound");
      if (plan.status !== "Running") return rejected("state", [plan.status]);
      const next = moved(plan, "Paused", name(actor), event.at);
      state = replace(state, next);
      return done({ ok: true, plan: next }, [note(event, "plan.paused", plan.id, { by: "person" })]);
    }

    case "resume": {
      if (!canOperate(actor)) return rejected("forbidden");
      const plan = visible(event.planId);
      if (!plan) return rejected("notFound");
      if (plan.status !== "Paused") return rejected("state", [plan.status]);
      // a person who resumes a plan stopped by a failing step gives that step a fresh set of attempts
      const steps = refreshReady(plan.steps.map((step) => (step.state === "failed" ? { ...step, state: "pending" as const, attempts: 0 } : step)));
      const { blockedBy: _blocked, ...rest } = plan;
      const next = moved({ ...rest, steps }, "Running", name(actor), event.at);
      state = replace(state, next);
      return done({ ok: true, plan: next }, [note(event, "plan.resumed", plan.id)]);
    }

    case "report": {
      if (!canReport(actor)) return rejected("forbidden");
      const plan = visible(event.planId);
      if (!plan) return rejected("notFound");
      if (plan.status !== "Running") return rejected("state", [plan.status]);
      const step = plan.steps.find((row) => row.id === event.stepId);
      if (!step) return rejected("notFound");
      const events: ExecutionEventInput[] = [note(event, "step.reported", plan.id, { outcome: event.outcome, level: step.authorizationLevel })];
      let steps: ExecutionStep[];
      if (event.outcome === "started") {
        if (step.state !== "ready") return rejected("state", [step.state]);
        steps = plan.steps.map((row) => (row.id === step.id ? { ...row, state: "running" as const } : row));
        state = replace(state, { ...plan, steps });
        return done({ ok: true, plan: find(state, tenantId, plan.id) as ExecutionPlan }, events);
      }
      if (step.state !== "running") return rejected("state", [step.state]);
      if (event.outcome === "completed") {
        steps = refreshReady(plan.steps.map((row) => (row.id === step.id ? { ...row, state: "completed" as const } : row)));
        if (steps.every((row) => row.state === "completed" || row.state === "skipped")) {
          const next = moved({ ...plan, steps }, "Completed", name(actor), event.at, { completedAt: event.at });
          state = replace(state, next);
          return done({ ok: true, plan: next }, [...events, note(event, "plan.completed", plan.id, { steps: steps.length })]);
        }
        state = replace(state, { ...plan, steps });
        return done({ ok: true, plan: find(state, tenantId, plan.id) as ExecutionPlan }, events);
      }
      // failed: retry while the policy allows, then stop the plan for a person to decide
      const attempts = step.attempts + 1;
      if (attempts < step.retry.maxAttempts) {
        steps = plan.steps.map((row) => (row.id === step.id ? { ...row, state: "ready" as const, attempts } : row));
        state = replace(state, { ...plan, steps });
        return done({ ok: true, plan: find(state, tenantId, plan.id) as ExecutionPlan }, [...events, note(event, "step.retried", plan.id, { attempts, max: step.retry.maxAttempts })]);
      }
      steps = plan.steps.map((row) => (row.id === step.id ? { ...row, state: "failed" as const, attempts } : row));
      const next = moved({ ...plan, steps }, "Paused", name(actor), event.at, { blockedBy: step.id });
      state = replace(state, next);
      return done({ ok: true, plan: next }, [...events, note(event, "step.failed", plan.id, { attempts, level: step.authorizationLevel }), note(event, "plan.paused", plan.id, { by: "failure" })]);
    }
  }
}

/** Re-derives what summarizes a plan after its steps changed (used by tests and tools that edit a DAG). */
export const refreshPlan = (plan: ExecutionPlan, grants: readonly string[] = []): ExecutionPlan => finalize(plan, plan.modules, grants);
export const dagIsValid = (plan: Pick<ExecutionPlan, "steps">): boolean => topologicalOrder(plan.steps) !== undefined && plan.steps.every((step) => isKnownAction(step.action));
