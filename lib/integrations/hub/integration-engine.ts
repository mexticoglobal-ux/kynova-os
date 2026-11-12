// The Integration Engine and the Workflow Engine.
//
// IntegrationEngine: the ONE way a provider is ever called. For every call it applies, in order: the circuit breaker (a dead or open connector is not called), the rate limits (the connection's
// own AND the provider's shared quota), a timeout, retries with exponential backoff, health recording, metrics and events. It knows nothing about which provider it is calling.
//
// WorkflowEngine: the universal flow  Worker -> Integration Hub -> Connector -> Provider -> Result  as a stored definition that can be triggered by sync, push, pull, a webhook, a person
// (manual) or a schedule. A workflow always runs AS a Worker of its company: it adds no new way to reach a provider.

import type { HubEventLog } from "./integration-events";
import { healthScore, type HealthTracker } from "./integration-health";
import type { Observability } from "./integration-observability";
import type { RateLimiter } from "./integration-rate-limit";
import { CircuitBreaker, mergeBreaker, mergeRetry, runWithRetry, type AttemptRecord } from "./integration-retry";
import { failure, type Caller, type Deps, type FailureKind, type ProviderManifest, type ProviderResult } from "./integration-types";

export type CallInput<T> = { manifest: ProviderManifest; tenantId: string; connectionId: string; traceId: string; label: string; run: (attempt: number) => Promise<ProviderResult<T>> };
export type CallOutcome<T> = { result: ProviderResult<T>; attempts: readonly AttemptRecord[]; blocked?: "circuit" | "dead" | "rateLimit"; latencyMs: number };
/** failures that say the PROVIDER is unwell (they count against the circuit); an authorization or a bad request does not */
const INFRA: readonly FailureKind[] = ["provider", "network", "timeout"];

export class IntegrationEngine {
  private readonly breakers = new Map<string, CircuitBreaker>();
  constructor(readonly deps: Deps, readonly log: HubEventLog, readonly observability: Observability, readonly limiter: RateLimiter, readonly health: HealthTracker) {}

  static connectionKey = (tenantId: string, connectionId: string) => `${tenantId}:${connectionId}`;
  breakerFor(manifest: ProviderManifest, key: string): CircuitBreaker {
    let row = this.breakers.get(key);
    if (!row) { row = new CircuitBreaker(mergeBreaker(manifest.breaker)); this.breakers.set(key, row); }
    return row;
  }
  forget(key: string): void { this.breakers.delete(key); this.limiter.reset(key); this.health.forget(key); }

  private emit(type: Parameters<HubEventLog["emit"]>[0]["type"], input: { manifest: ProviderManifest; tenantId: string; connectionId: string; traceId: string }, detail?: Record<string, unknown>) {
    return this.log.emit({ at: new Date(this.deps.now()).toISOString(), tenantId: input.tenantId, providerId: input.manifest.id, connectionId: input.connectionId, type, traceId: input.traceId, ...(detail ? { detail } : {}) });
  }

  async call<T>(input: CallInput<T>): Promise<CallOutcome<T>> {
    const { manifest } = input;
    const key = IntegrationEngine.connectionKey(input.tenantId, input.connectionId);
    const providerKey = `provider:${manifest.id}`;
    const breaker = this.breakerFor(manifest, key);
    const decision = breaker.allow(this.deps.now());
    if (decision.transition === "half_open") this.emit("circuit.half_open", input);
    if (!decision.allowed) {
      const dead = decision.state === "dead";
      return { result: failure("provider", dead ? "El conector está muerto: hace falta recuperarlo." : "El circuito está abierto: se vuelve a probar cuando termine la espera.", { retryable: false, ...(decision.retryAt ? { retryAfterMs: Math.max(1, decision.retryAt - this.deps.now()) } : {}) }), attempts: [], blocked: dead ? "dead" : "circuit", latencyMs: 0 };
    }
    const policy = mergeRetry(manifest.retry);
    const timeoutMs = manifest.timeoutMs ?? 10_000;
    let limited: { retryAfterMs: number; by: string } | undefined;
    let lastLatency = 0;
    const attemptsOutcome = await runWithRetry<T>(async (attempt) => {
      // both buckets must allow: the company's own and the provider's shared quota
      const own = this.limiter.acquire(key, manifest.rateLimits);
      const shared = own.allowed ? this.limiter.acquire(providerKey, manifest.rateLimits) : own;
      if (!shared.allowed) {
        limited = { retryAfterMs: shared.retryAfterMs, by: shared.limitedBy ?? "minute" };
        this.emit("rate.limited", input, { limitedBy: limited.by, retryAfterMs: limited.retryAfterMs, attempt });
        return failure("rateLimit", "Se alcanzó el límite de peticiones: la llamada no se hizo.", { retryable: false, retryAfterMs: limited.retryAfterMs });
      }
      const started = this.deps.now();
      const raced = await Promise.race([input.run(attempt), this.deps.timeout(timeoutMs)]);
      lastLatency = this.deps.now() - started;
      const result: ProviderResult<T> = raced === "timeout" ? failure("timeout", "El proveedor no respondió a tiempo.") : raced;
      this.health.record(key, { latencyMs: lastLatency, ok: result.ok, ...(result.ok ? {} : { kind: result.error.kind }) });
      this.observability.recordLatency(manifest.id, lastLatency);
      return result;
    }, { policy, seed: `${key}|${input.label}|${input.traceId}`, sleep: this.deps.sleep, onRetry: (attempt, waitMs, failed) => this.emit("retry.scheduled", input, { attempt, waitMs, kind: failed.kind }) });
    const { result, attempts } = attemptsOutcome;
    if (result.ok) { if (breaker.success() === "closed") this.emit("circuit.closed", input); }
    else if (!limited && INFRA.includes(result.error.kind)) {
      const tripped = breaker.failure(this.deps.now());
      if (tripped === "open") this.emit("circuit.opened", input, { opens: breaker.info().opens });
      if (tripped === "dead") this.emit("connector.dead", input, { opens: breaker.info().opens });
    }
    return { result, attempts, ...(limited ? { blocked: "rateLimit" as const } : {}), latencyMs: lastLatency };
  }

  /** The health score of a connection from everything the engine has seen. */
  score(manifest: ProviderManifest, tenantId: string, connectionId: string, probe: { tokenState: "valid" | "expiringSoon" | "expired" | "revoked" | "none"; oauth: "authorized" | "pending" | "revoked" | "none" | "n/a" }, lastSyncAt?: string) {
    const key = IntegrationEngine.connectionKey(tenantId, connectionId);
    const summary = this.health.summary(key);
    return healthScore({
      hasSamples: summary.count > 0, ...(summary.p95Ms !== undefined ? { latencyP95Ms: summary.p95Ms } : {}), latencyTargetMs: manifest.health.latencyTargetMs, errorRate: summary.errorRate, timeoutRate: summary.timeoutRate,
      tokenState: probe.tokenState, oauth: probe.oauth, ...(lastSyncAt ? { lastSyncAgeMs: Math.max(0, this.deps.now() - Date.parse(lastSyncAt)) } : {}), syncMaxAgeMs: manifest.health.syncMaxAgeMs,
      rateLimitPressure: this.limiter.pressure(key, manifest.rateLimits), breaker: this.breakerFor(manifest, key).info().state,
    });
  }
}

// ---------------------------------------------------------------- workflows
export const TRIGGER_KINDS = ["sync", "push", "pull", "webhook", "manual", "scheduled"] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];
export type WorkflowStep = { id: string; kind: "sync" | "pull" | "push"; capability?: string; syncKind?: string; params?: Readonly<Record<string, unknown>> };
export type Workflow = { id: string; tenantId: string; name: string; providerId: string; workerId: string; trigger: { kind: TriggerKind; everyMinutes?: number }; steps: readonly WorkflowStep[]; enabled: boolean; createdBy: string; createdAt: string; lastRunAt?: string };
export type StepResult = { id: string; status: "ok" | "failed" | "awaitingApproval" | "refused" | "skipped"; kind?: FailureKind; items?: number; approvalId?: string };
export type WorkflowRun = { id: string; workflowId: string; tenantId: string; trigger: TriggerKind; startedAt: string; finishedAt: string; status: "completed" | "failed" | "awaitingApproval" | "skipped"; steps: readonly StepResult[]; traceId: string };

/** What the workflow engine needs from the Hub: the same two calls a Worker makes. A workflow adds no other way to reach a provider. */
export interface HubPort {
  sync(caller: Caller, input: { providerId?: string; connectionId?: string; kind: string }): Promise<{ status: "done" | "failed" | "refused"; items?: number; failure?: FailureKind }>;
  execute(caller: Caller, input: { providerId?: string; connectionId?: string; capability: string; params: Readonly<Record<string, unknown>> }): Promise<{ status: "done" | "awaitingApproval" | "failed" | "refused" | "rejected"; failure?: FailureKind; approvalId?: string }>;
}
export type WorkflowIssue = string;
export function validateWorkflow(workflow: Workflow, knows: (providerId: string) => boolean): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  if (workflow.name.trim().length < 2) issues.push("name");
  if (!knows(workflow.providerId)) issues.push("provider");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(workflow.workerId)) issues.push("worker");
  if (!(TRIGGER_KINDS as readonly string[]).includes(workflow.trigger.kind)) issues.push("trigger");
  if (workflow.trigger.kind === "scheduled" && !(Number.isInteger(workflow.trigger.everyMinutes) && (workflow.trigger.everyMinutes ?? 0) >= 1)) issues.push("schedule");
  if (workflow.steps.length === 0 || workflow.steps.length > 20) issues.push("steps");
  for (const step of workflow.steps) {
    if (step.kind === "sync" && !step.syncKind) issues.push(`step:${step.id}:syncKind`);
    if ((step.kind === "pull" || step.kind === "push") && !step.capability) issues.push(`step:${step.id}:capability`);
  }
  if (new Set(workflow.steps.map((step) => step.id)).size !== workflow.steps.length) issues.push("steps:duplicate");
  return issues;
}

export class WorkflowEngine {
  private readonly rows = new Map<string, Workflow>();
  private readonly history: WorkflowRun[] = [];
  private counter = 0;
  constructor(private readonly hub: HubPort, private readonly deps: Deps, private readonly log: HubEventLog) {}

  save(workflow: Workflow): void { this.rows.set(workflow.id, workflow); }
  get(id: string, tenantId: string): Workflow | undefined { const row = this.rows.get(id); return row && row.tenantId === tenantId ? row : undefined; }
  list(tenantId: string): readonly Workflow[] { return [...this.rows.values()].filter((row) => row.tenantId === tenantId); }
  runs(tenantId: string): readonly WorkflowRun[] { return this.history.filter((row) => row.tenantId === tenantId); }
  setEnabled(id: string, tenantId: string, enabled: boolean): boolean { const row = this.get(id, tenantId); if (!row) return false; this.rows.set(id, { ...row, enabled }); return true; }

  /** Runs one workflow, step by step, as its Worker. A failed step stops the run; a step that needs a person leaves the run waiting for them. */
  async run(workflowId: string, tenantId: string, trigger: TriggerKind): Promise<WorkflowRun | undefined> {
    const workflow = this.get(workflowId, tenantId);
    if (!workflow) return undefined;
    const startedAt = new Date(this.deps.now()).toISOString();
    const traceId = `wf_${String(++this.counter).padStart(6, "0")}`;
    const base = { tenantId, providerId: workflow.providerId, traceId, at: startedAt } as const;
    if (!workflow.enabled || trigger !== workflow.trigger.kind && trigger !== "manual") {
      const skipped: WorkflowRun = { id: `run_${String(this.history.length + 1).padStart(6, "0")}`, workflowId, tenantId, trigger, startedAt, finishedAt: startedAt, status: "skipped", steps: workflow.steps.map((step) => ({ id: step.id, status: "skipped" as const })), traceId };
      this.history.push(skipped);
      return skipped;
    }
    this.log.emit({ ...base, type: "workflow.started", detail: { workflowId, trigger } });
    const caller: Caller = { kind: "worker", workerId: workflow.workerId, tenantId, connectorId: workflow.providerId };
    const results: StepResult[] = [];
    let status: WorkflowRun["status"] = "completed";
    for (const step of workflow.steps) {
      if (status !== "completed") { results.push({ id: step.id, status: "skipped" }); continue; }
      const outcome = step.kind === "sync"
        ? await this.hub.sync(caller, { providerId: workflow.providerId, kind: step.syncKind as string })
        : await this.hub.execute(caller, { providerId: workflow.providerId, capability: step.capability as string, params: step.params ?? {} });
      const row: StepResult = { id: step.id, status: outcome.status === "done" ? "ok" : outcome.status === "rejected" ? "refused" : outcome.status, ...(outcome.failure ? { kind: outcome.failure } : {}), ...("items" in outcome && outcome.items !== undefined ? { items: outcome.items } : {}), ...("approvalId" in outcome && outcome.approvalId ? { approvalId: outcome.approvalId } : {}) };
      results.push(row);
      this.log.emit({ ...base, at: new Date(this.deps.now()).toISOString(), type: "workflow.step", detail: { workflowId, step: step.id, status: row.status } });
      if (row.status === "awaitingApproval") status = "awaitingApproval";
      else if (row.status !== "ok") status = "failed";
    }
    const finishedAt = new Date(this.deps.now()).toISOString();
    const run: WorkflowRun = { id: `run_${String(this.history.length + 1).padStart(6, "0")}`, workflowId, tenantId, trigger, startedAt, finishedAt, status, steps: results, traceId };
    this.history.push(run);
    this.rows.set(workflowId, { ...workflow, lastRunAt: finishedAt });
    this.log.emit({ ...base, at: finishedAt, type: status === "failed" ? "workflow.failed" : "workflow.finished", detail: { workflowId, status } });
    return run;
  }

  /** Runs every scheduled workflow of the company that is due: its interval has passed since its last run (or it never ran). Call it from the platform's own scheduler. */
  async runDue(tenantId: string): Promise<readonly WorkflowRun[]> {
    const out: WorkflowRun[] = [];
    for (const workflow of this.list(tenantId).filter((row) => row.enabled && row.trigger.kind === "scheduled")) {
      const every = (workflow.trigger.everyMinutes ?? 1) * 60_000;
      if (workflow.lastRunAt && this.deps.now() - Date.parse(workflow.lastRunAt) < every) continue;
      const run = await this.run(workflow.id, tenantId, "scheduled");
      if (run) out.push(run);
    }
    return out;
  }
  /** Every enabled workflow of the company whose trigger is `kind` for this provider (a webhook, a sync...). */
  async fire(tenantId: string, providerId: string, kind: TriggerKind): Promise<readonly WorkflowRun[]> {
    const out: WorkflowRun[] = [];
    for (const workflow of this.list(tenantId).filter((row) => row.enabled && row.providerId === providerId && row.trigger.kind === kind)) { const run = await this.run(workflow.id, tenantId, kind); if (run) out.push(run); }
    return out;
  }
}
