// Runtime Orchestrator: the convenience class that holds the state of the runtime, its event log and its observability, and hands every move to the pure reducer. The clock is INJECTED (`now`), so the
// same script always gives the same result; the engine itself reads no clock, calls no network, no database and no AI, and executes nothing: no Worker, no Connector, no provider is ever called.
// What the Runtime would be asked to do comes out as lists (`tick` → dispatch); "Running" and "Completed" are what the system principal reports.

import { canSeePlan } from "@/lib/nex/execution";
import { buildOrchestratorDashboard, type OrchestratorDashboard } from "./orchestrator-dashboard";
import { OrchestratorEventLog, OrchestratorObservability } from "./orchestrator-events";
import { newRuntimeState, reduceRuntime } from "./runtime-engine";
import { DEFAULT_CONFIG, type ExecutionPlan, type OrchestratorConfig, type OrchestratorEnv, type OrchestratorWorker, type Principal, type QueueItem, type Role, type RunRecord, type RuntimeEvent, type RuntimeResult, type RuntimeState } from "./orchestrator-types";

export type OrchestratorOptions = {
  env: OrchestratorEnv; /** the injected clock: epoch milliseconds */ now: () => number;
  /** the workers a company has (read only) */ workers: (tenantId: string) => readonly OrchestratorWorker[];
  /** the role a person holds in a company (read only) */ roleOf: (tenantId: string, personId: string) => Role | undefined;
  config?: Partial<OrchestratorConfig>; state?: RuntimeState;
};

export class OrchestratorEngine {
  readonly log = new OrchestratorEventLog();
  readonly observability = new OrchestratorObservability(this.log);
  private state: RuntimeState;
  private readonly config: OrchestratorConfig;
  constructor(private readonly options: OrchestratorOptions) {
    this.state = options.state ?? newRuntimeState();
    this.config = { ...DEFAULT_CONFIG, ...options.config };
  }

  private at = (): string => new Date(this.options.now()).toISOString();
  private run(event: RuntimeEvent): RuntimeResult {
    const sources = { env: this.options.env, workers: this.options.workers(event.tenantId), roleOf: (personId: string) => this.options.roleOf(event.tenantId, personId) };
    const started = this.options.now();
    const outcome = reduceRuntime(this.state, event, sources, this.config);
    this.state = outcome.state;
    const latencyMs = Math.max(0, this.options.now() - started);
    for (const input of outcome.result.events) this.log.emit(input.type === "orchestrator.tick" ? { ...input, detail: { ...input.detail, latencyMs } } : input);
    return outcome.result;
  }

  enqueue(actor: Principal, tenantId: string, plan: ExecutionPlan): RuntimeResult { return this.run({ type: "enqueue", actor, tenantId, at: this.at(), plan }); }
  tick(actor: Principal, tenantId: string, autoStart?: boolean): RuntimeResult { return this.run({ type: "tick", actor, tenantId, at: this.at(), ...(autoStart === undefined ? {} : { autoStart }) }); }
  start(actor: Principal, tenantId: string, itemId: string): RuntimeResult { return this.run({ type: "start", actor, tenantId, at: this.at(), itemId }); }
  finish(actor: Principal, tenantId: string, itemId: string, outcome: "completed" | "failed"): RuntimeResult { return this.run({ type: "finish", actor, tenantId, at: this.at(), itemId, outcome }); }
  pause(actor: Principal, tenantId: string, planId: string): RuntimeResult { return this.run({ type: "pause", actor, tenantId, at: this.at(), planId }); }
  resume(actor: Principal, tenantId: string, planId: string): RuntimeResult { return this.run({ type: "resume", actor, tenantId, at: this.at(), planId }); }
  cancel(actor: Principal, tenantId: string, planId: string): RuntimeResult { return this.run({ type: "cancel", actor, tenantId, at: this.at(), planId }); }

  /** What this person may see of the queue: their own company's items, and no finance items unless they may see finance. Anything else does not exist. */
  queueFor(actor: Principal): readonly QueueItem[] { return this.state.queue.filter((item) => item.tenantId === actor.tenantId && canSeePlan(actor, item)); }
  runsFor(actor: Principal): readonly RunRecord[] { return this.state.runs.filter((run) => run.tenantId === actor.tenantId && canSeePlan(actor, run)); }

  /** The dashboard of the actor's company, built only from what the actor may see. Reading it leaves a trace (a count, nothing else). */
  dashboard(actor: Principal): OrchestratorDashboard {
    const at = this.at();
    const dashboard = buildOrchestratorDashboard({ tenantId: actor.tenantId, at, runs: this.runsFor(actor), queue: this.queueFor(actor), workers: this.options.workers(actor.tenantId), env: this.options.env, config: this.config });
    this.log.emit({ at, tenantId: actor.tenantId, actorKind: actor.kind, actorId: actor.kind === "system" ? "system" : actor.id, type: "orchestrator.dashboard", detail: { plans: dashboard.plans.total, queued: dashboard.queue.total } });
    return dashboard;
  }
  snapshot(tenantId: string) { return this.observability.snapshot(tenantId, this.state); }
  /** The whole state, for persistence by someone else: this layer stores nothing. */
  exportState(): RuntimeState { return this.state; }
  audit(tenantId: string) { return this.state.audit.filter((entry) => entry.tenantId === tenantId); }
}
