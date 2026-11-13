// Worker Operating System: the convenience class that holds the state of what the Workers ARE, their event log and observability, and hands every move to the pure reducer. The clock is INJECTED (`now`), so
// the same script always gives the same result; the engine reads no clock, calls no network, no database, no AI and no Runtime, and executes and installs nothing. A later sprint connects it to real
// execution and to the external connectors.

import { buildWorkerOsDashboard, type WorkerOsDashboard } from "./worker-os-dashboard";
import { OsEventLog } from "./worker-os-events";
import { WorkerOsObservability } from "./worker-os-observability";
import { evaluateRequest } from "./worker-os-policy";
import { newWorkerOsState, reduceWorkerOs } from "./worker-os-reducer";
import { DEFAULT_CONFIG, type Capability, type PolicyRequest, type Principal, type ReleaseTarget, type WorkerChanges, type WorkerInput, type WorkerOsConfig, type WorkerOsEvent, type WorkerOsResult, type WorkerOsState, type WorkerRecord } from "./worker-os-types";

export type WorkerOsOptions = { /** the injected clock: epoch milliseconds */ now: () => number; config?: Partial<WorkerOsConfig>; state?: WorkerOsState };
export type PolicyCheck = { ok: boolean; refusal?: "tenant" | "notFound"; allowed: boolean; violations: readonly string[] };

export class WorkerOsEngine {
  readonly log = new OsEventLog();
  readonly observability = new WorkerOsObservability(this.log);
  private state: WorkerOsState;
  private readonly config: WorkerOsConfig;
  constructor(private readonly options: WorkerOsOptions) {
    this.state = options.state ?? newWorkerOsState();
    this.config = { ...DEFAULT_CONFIG, ...options.config };
  }

  private at = (): string => new Date(this.options.now()).toISOString();
  private run(event: WorkerOsEvent): WorkerOsResult {
    const outcome = reduceWorkerOs(this.state, event, this.config);
    this.state = outcome.state;
    for (const input of outcome.result.events) this.log.emit(input);
    return outcome.result;
  }

  // Level 3: only a person (administrator or owner)
  create(actor: Principal, tenantId: string, worker: WorkerInput): WorkerOsResult { return this.run({ type: "create", actor, tenantId, at: this.at(), worker }); }
  update(actor: Principal, tenantId: string, workerId: string, changes: WorkerChanges): WorkerOsResult { return this.run({ type: "update", actor, tenantId, at: this.at(), workerId, changes }); }
  setCapabilities(actor: Principal, tenantId: string, workerId: string, capabilities: readonly Capability[]): WorkerOsResult { return this.run({ type: "setCapabilities", actor, tenantId, at: this.at(), workerId, capabilities }); }
  setPermissions(actor: Principal, tenantId: string, workerId: string, permissions: readonly string[]): WorkerOsResult { return this.run({ type: "setPermissions", actor, tenantId, at: this.at(), workerId, permissions }); }
  setTools(actor: Principal, tenantId: string, workerId: string, tools: readonly string[]): WorkerOsResult { return this.run({ type: "setTools", actor, tenantId, at: this.at(), workerId, tools }); }
  requestUpgrade(actor: Principal, tenantId: string, workerId: string, to: ReleaseTarget): WorkerOsResult { return this.run({ type: "upgradeRequested", actor, tenantId, at: this.at(), workerId, to }); }
  approveUpgrade(actor: Principal, tenantId: string, workerId: string): WorkerOsResult { return this.run({ type: "upgradeApproved", actor, tenantId, at: this.at(), workerId }); }
  installUpgrade(actor: Principal, tenantId: string, workerId: string): WorkerOsResult { return this.run({ type: "upgradeInstalled", actor, tenantId, at: this.at(), workerId }); }
  rollback(actor: Principal, tenantId: string, workerId: string): WorkerOsResult { return this.run({ type: "rollback", actor, tenantId, at: this.at(), workerId }); }
  /** The worker's own health report (or the system's relay): the only thing they may write. */
  reportHealth(actor: Principal, tenantId: string, workerId: string, score: number): WorkerOsResult { return this.run({ type: "health", actor, tenantId, at: this.at(), workerId, score }); }

  /** May this worker be given this? A read-only answer for whoever of the company asks (a later sprint asks before it runs anything). Nothing is run. */
  check(actor: Principal, tenantId: string, workerId: string, request: Omit<PolicyRequest, "tenantId">): PolicyCheck {
    const at = this.at();
    const who = actor.kind === "system" || actor.kind === "nex" ? actor.kind : actor.id;
    const row = actor.tenantId === tenantId ? this.state.workers.find((entry) => entry.workerId === workerId && entry.companyId === tenantId) : undefined;
    if (actor.tenantId !== tenantId || !row) {
      const refusal = actor.tenantId !== tenantId ? ("tenant" as const) : ("notFound" as const);
      this.log.emit({ at, tenantId: actor.tenantId, actorKind: actor.kind, actorId: who, type: "os.refused", detail: { reason: refusal, action: "check" } });
      return { ok: false, refusal, allowed: false, violations: [refusal] };
    }
    const decision = evaluateRequest(row, { ...request, tenantId }, this.config);
    this.log.emit({ at, tenantId, actorKind: actor.kind, actorId: who, type: "policy.checked", workerId: workerId, detail: { allowed: decision.allowed, violations: decision.violations.length, ...Object.fromEntries(decision.violations.map((violation) => [`v_${violation}`, true])) } });
    return { ok: true, allowed: decision.allowed, violations: decision.violations };
  }

  /** What this actor may see: their own company's workers. Anything else does not exist. */
  workersFor(actor: Principal): readonly WorkerRecord[] { return this.state.workers.filter((row) => row.companyId === actor.tenantId); }
  /** The dashboard of the actor's company. Reading it leaves a trace (a count, nothing else). */
  dashboard(actor: Principal): WorkerOsDashboard {
    const at = this.at();
    const dashboard = buildWorkerOsDashboard({ tenantId: actor.tenantId, at, workers: this.workersFor(actor), config: this.config });
    this.log.emit({ at, tenantId: actor.tenantId, actorKind: actor.kind, actorId: actor.kind === "system" || actor.kind === "nex" ? actor.kind : actor.id, type: "os.dashboard", detail: { workers: dashboard.workers.total } });
    return dashboard;
  }
  snapshot(tenantId: string) { return this.observability.snapshot(tenantId, this.state); }
  /** The whole state, for persistence by someone else: this layer stores nothing. */
  exportState(): WorkerOsState { return this.state; }
  audit(tenantId: string) { return this.state.audit.filter((entry) => entry.tenantId === tenantId); }
}
