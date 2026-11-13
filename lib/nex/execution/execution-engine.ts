// Execution Engine: the state, the event log and the observability around the pure reducer, and the read-only views (plans, validation, schedule, dashboard data) that a future screen or runtime
// would ask for. The pipeline is  Copilot → RAG → Memory → Knowledge → KOE → Execution Engine → Execution Plan: this engine receives what the Copilot already produced (its recommendations and
// the actions it suggested) and prepares plans. It reads its company's roster, connected connectors and standing authorizations as plain data; it calls none of them. It executes nothing.

import { buildExecutionDashboard, type ExecutionDashboard } from "./execution-dashboard";
import { ExecutionEventLog, ExecutionObservability } from "./execution-events";
import { canSeePlan, isTerminal, stepPermission } from "./execution-policy";
import { newExecutionState, reduceExecution } from "./execution-reducer";
import { scheduleExecution, validateExecution, type ExecutionSchedule } from "./execution-runtime";
import {
  DEFAULT_CONFIG,
  type ConnectorId, type ExecutionConfig, type ExecutionEnv, type ExecutionEvent, type ExecutionPlan, type ExecutionResult, type ExecutionSources, type ExecutionState, type Principal, type Recommendation, type RosterView,
  type SuggestedAction, type ValidationReport,
} from "./execution-types";

/** What the Copilot hands over: its ranked recommendations and the actions it suggested for them. */
export type CopilotOutput = { recommendations: readonly Recommendation[]; actions: readonly SuggestedAction[] };

export type EngineOptions = {
  env: ExecutionEnv;
  /** milliseconds; injected so nothing here reads a clock */
  now: () => number;
  /** the workers of a company (KOE's roster): only read */
  roster: (tenantId: string) => RosterView;
  /** the connectors a company has connected: only read, never called */
  connected?: (tenantId: string) => readonly ConnectorId[];
  /** the actions a company's standing authorizations cover: only read */
  grants?: (tenantId: string) => readonly string[];
  config?: Partial<ExecutionConfig>;
  state?: ExecutionState;
};

export class ExecutionEngine {
  state: ExecutionState;
  readonly config: ExecutionConfig;
  readonly log = new ExecutionEventLog();
  readonly observability = new ExecutionObservability(this.log);
  constructor(private readonly options: EngineOptions) {
    this.state = options.state ?? newExecutionState();
    this.config = { ...DEFAULT_CONFIG, ...options.config };
  }

  private iso(ms: number): string { return new Date(ms).toISOString(); }
  private sources(tenantId: string): ExecutionSources {
    return { env: this.options.env, roster: this.options.roster(tenantId), connected: this.options.connected?.(tenantId) ?? [], grants: this.options.grants?.(tenantId) ?? [] };
  }
  private apply(event: ExecutionEvent, latencyMs?: (() => number) | undefined): ExecutionResult {
    const { state, result } = reduceExecution(this.state, event, this.sources(event.actor.tenantId), this.config);
    this.state = state;
    const latency = latencyMs?.();
    // the latency of one `prepare` call is recorded once (on its first plan), not once per plan
    let timed = false;
    for (const input of result.events) {
      const attach = input.type === "plan.prepared" && latency !== undefined && !timed;
      if (attach) timed = true;
      this.log.emit(attach ? { ...input, detail: { ...input.detail, latencyMs: latency } } : input);
    }
    return result;
  }
  private send(actor: Principal, rest: { type: Exclude<ExecutionEvent["type"], "prepare" | "report">; planId?: string }): ExecutionResult {
    return this.apply({ ...rest, tenantId: actor.tenantId, actor, at: this.iso(this.options.now()) } as ExecutionEvent);
  }

  /** Copilot output → execution plans. Nothing is executed and nobody is called; the latency of preparing is recorded. */
  prepare(actor: Principal, from: CopilotOutput): ExecutionResult {
    const started = this.options.now();
    return this.apply({ type: "prepare", tenantId: actor.tenantId, actor, at: this.iso(started), recommendations: from.recommendations, actions: from.actions }, () => Math.max(0, this.options.now() - started));
  }
  submit(actor: Principal, planId: string): ExecutionResult { return this.send(actor, { type: "submit", planId }); }
  approve(actor: Principal, planId: string): ExecutionResult { return this.send(actor, { type: "approve", planId }); }
  reject(actor: Principal, planId: string): ExecutionResult { return this.send(actor, { type: "reject", planId }); }
  cancel(actor: Principal, planId: string): ExecutionResult { return this.send(actor, { type: "cancel", planId }); }
  assign(actor: Principal, planId: string): ExecutionResult { return this.send(actor, { type: "assign", planId }); }
  pause(actor: Principal, planId: string): ExecutionResult { return this.send(actor, { type: "pause", planId }); }
  resume(actor: Principal, planId: string): ExecutionResult { return this.send(actor, { type: "resume", planId }); }
  /** Records that the plan started. Only the system can say so: a future runtime reports through it. Nothing starts here. */
  start(actor: Principal, planId: string): ExecutionResult { return this.send(actor, { type: "start", planId }); }
  /** Records what a future runtime reported about a step. Only the system can say so. Nothing is run here. */
  report(actor: Principal, planId: string, stepId: string, outcome: "started" | "completed" | "failed"): ExecutionResult {
    return this.apply({ type: "report", tenantId: actor.tenantId, actor, at: this.iso(this.options.now()), planId, stepId, outcome });
  }
  sweep(actor: Principal): ExecutionResult { return this.send(actor, { type: "sweep" }); }

  /** The plans of the asker's company that the asker may see: what they may not see does not exist for them. */
  plansFor(actor: Principal): readonly ExecutionPlan[] { return this.state.plans.filter((plan) => plan.tenantId === actor.tenantId && canSeePlan(actor, plan)); }
  planFor(actor: Principal, planId: string): ExecutionPlan | undefined { return this.plansFor(actor).find((plan) => plan.id === planId); }
  /** What is wrong or missing in a plan before anybody approves it (no state changes). */
  validate(actor: Principal, planId: string): ValidationReport | undefined {
    const plan = this.planFor(actor, planId);
    return plan ? validateExecution(plan, { connected: this.sources(actor.tenantId).connected, grants: this.sources(actor.tenantId).grants, nowMs: this.options.now() }) : undefined;
  }

  private emit(actor: Principal, type: "execution.scheduled" | "execution.dashboard" | "execution.refused", detail: Record<string, unknown>) {
    this.log.emit({ at: this.iso(this.options.now()), tenantId: actor.tenantId, actorKind: actor.kind, actorId: actor.kind === "system" ? "system" : actor.id, type, detail });
  }
  private allowed(actor: Principal): boolean {
    const denied = stepPermission(actor, this.options.env, actor.tenantId);
    if (denied) this.emit(actor, "execution.refused", { reason: denied, action: "read" });
    return denied === undefined;
  }
  /** In what order, and when (as offsets), the steps of the plans still to run would run. A structure only. */
  schedule(actor: Principal): ExecutionSchedule | undefined {
    if (!this.allowed(actor)) return undefined;
    const schedule = scheduleExecution(this.plansFor(actor).filter((plan) => !isTerminal(plan.status)));
    this.emit(actor, "execution.scheduled", { plans: schedule.queue.length, items: schedule.items.length, totalMs: schedule.totalMs });
    return schedule;
  }
  /** The data a future dashboard will show, built only from the plans the asker may see. No screen. */
  dashboard(actor: Principal): ExecutionDashboard | undefined {
    if (!this.allowed(actor)) return undefined;
    const data = buildExecutionDashboard({ tenantId: actor.tenantId, at: this.iso(this.options.now()), plans: this.plansFor(actor), roster: this.options.roster(actor.tenantId) });
    this.emit(actor, "execution.dashboard", { plans: data.plans.total, bottlenecks: data.bottlenecks.length });
    return data;
  }
  snapshot(tenantId: string) { return this.observability.snapshot(tenantId, this.state); }
}
