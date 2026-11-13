// Worker Runtime Engine: the convenience class that holds the state of the workers' lives, their event log and observability, and hands every move to the pure reducer. The clock is INJECTED (`now`), so
// the same script always gives the same result; the engine reads no clock, calls no network, no database, no AI and no Runtime, and executes nothing. A later sprint connects it to a real Runtime.

import { buildWorkerRuntimeDashboard, type WorkerRuntimeDashboard } from "./worker-runtime-dashboard";
import { WorkerEventLog } from "./worker-runtime-events";
import { WorkerRuntimeObservability } from "./worker-runtime-observability";
import { newWorkerRuntimeState, reduceWorkerRuntime } from "./worker-runtime-reducer";
import { DEFAULT_CONFIG, type ErrorKind, type Heartbeat, type Principal, type Task, type TaskSpec, type WorkerRecord, type WorkerRuntimeConfig, type WorkerRuntimeEvent, type WorkerRuntimeResult, type WorkerRuntimeState, type WorkerSpec } from "./worker-runtime-types";

export type WorkerRuntimeOptions = { /** the injected clock: epoch milliseconds */ now: () => number; config?: Partial<WorkerRuntimeConfig>; state?: WorkerRuntimeState };
type Lifecycle = "start" | "stop" | "pause" | "resume" | "maintenance" | "endMaintenance" | "recover";

export class WorkerRuntimeEngine {
  readonly log = new WorkerEventLog();
  readonly observability = new WorkerRuntimeObservability(this.log);
  private state: WorkerRuntimeState;
  private readonly config: WorkerRuntimeConfig;
  constructor(private readonly options: WorkerRuntimeOptions) {
    this.state = options.state ?? newWorkerRuntimeState();
    this.config = { ...DEFAULT_CONFIG, ...options.config };
  }

  private at = (): string => new Date(this.options.now()).toISOString();
  private run(event: WorkerRuntimeEvent): WorkerRuntimeResult {
    const outcome = reduceWorkerRuntime(this.state, event, this.config);
    this.state = outcome.state;
    for (const input of outcome.result.events) this.log.emit(input);
    return outcome.result;
  }

  // Level 3: only a person (administrator or owner)
  register(actor: Principal, tenantId: string, worker: WorkerSpec): WorkerRuntimeResult { return this.run({ type: "register", actor, tenantId, at: this.at(), worker }); }
  private lifecycle(type: Lifecycle, actor: Principal, tenantId: string, workerId: string): WorkerRuntimeResult { return this.run({ type, actor, tenantId, at: this.at(), workerId }); }
  start(actor: Principal, tenantId: string, workerId: string) { return this.lifecycle("start", actor, tenantId, workerId); }
  stop(actor: Principal, tenantId: string, workerId: string) { return this.lifecycle("stop", actor, tenantId, workerId); }
  pause(actor: Principal, tenantId: string, workerId: string) { return this.lifecycle("pause", actor, tenantId, workerId); }
  resume(actor: Principal, tenantId: string, workerId: string) { return this.lifecycle("resume", actor, tenantId, workerId); }
  maintenance(actor: Principal, tenantId: string, workerId: string) { return this.lifecycle("maintenance", actor, tenantId, workerId); }
  endMaintenance(actor: Principal, tenantId: string, workerId: string) { return this.lifecycle("endMaintenance", actor, tenantId, workerId); }
  recover(actor: Principal, tenantId: string, workerId: string) { return this.lifecycle("recover", actor, tenantId, workerId); }
  approve(actor: Principal, tenantId: string, taskId: string): WorkerRuntimeResult { return this.run({ type: "approve", actor, tenantId, at: this.at(), taskId }); }
  reject(actor: Principal, tenantId: string, taskId: string): WorkerRuntimeResult { return this.run({ type: "reject", actor, tenantId, at: this.at(), taskId }); }

  // the worker's own reports
  heartbeat(actor: Principal, tenantId: string, heartbeat: Heartbeat): WorkerRuntimeResult { return this.run({ type: "heartbeat", actor, tenantId, at: this.at(), heartbeat }); }
  taskStart(actor: Principal, tenantId: string, taskId: string): WorkerRuntimeResult { return this.run({ type: "taskStart", actor, tenantId, at: this.at(), taskId }); }
  taskFinish(actor: Principal, tenantId: string, taskId: string, outcome: "completed" | "failed", error?: ErrorKind): WorkerRuntimeResult {
    return this.run({ type: "taskFinish", actor, tenantId, at: this.at(), taskId, outcome, ...(error ? { error } : {}) });
  }

  // the system or a manager
  submit(actor: Principal, tenantId: string, task: TaskSpec): WorkerRuntimeResult { return this.run({ type: "submit", actor, tenantId, at: this.at(), task }); }
  schedule(actor: Principal, tenantId: string): WorkerRuntimeResult { return this.run({ type: "schedule", actor, tenantId, at: this.at() }); }
  tick(actor: Principal, tenantId: string): WorkerRuntimeResult { return this.run({ type: "tick", actor, tenantId, at: this.at() }); }

  /** What this actor may see: their own company's workers and tasks. Anything else does not exist. */
  workersFor(actor: Principal): readonly WorkerRecord[] { return this.state.workers.filter((row) => row.tenantId === actor.tenantId); }
  tasksFor(actor: Principal): readonly Task[] { return this.state.tasks.filter((row) => row.tenantId === actor.tenantId); }
  /** The dashboard of the actor's company. Reading it leaves a trace (a count, nothing else). */
  dashboard(actor: Principal): WorkerRuntimeDashboard {
    const at = this.at();
    const dashboard = buildWorkerRuntimeDashboard({ tenantId: actor.tenantId, at, workers: this.workersFor(actor), tasks: this.tasksFor(actor), config: this.config });
    this.log.emit({ at, tenantId: actor.tenantId, actorKind: actor.kind, actorId: actor.kind === "system" || actor.kind === "nex" ? actor.kind : actor.id, type: "runtime.dashboard", detail: { workers: dashboard.workers.total } });
    return dashboard;
  }
  snapshot(tenantId: string) { return this.observability.snapshot(tenantId, this.state); }
  /** The whole state, for persistence by someone else: this layer stores nothing. */
  exportState(): WorkerRuntimeState { return this.state; }
  audit(tenantId: string) { return this.state.audit.filter((entry) => entry.tenantId === tenantId); }
}
