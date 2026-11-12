// The Integration Hub: the single door between KYNOVA and every external service.
//
//     Worker -> Connector -> Integration Hub -> Provider
//
// A Worker (through its Connector) asks the Hub for a CAPABILITY ("mail.send", "files.upload"); the Hub chooses the connection (and a fallback), checks the Worker, the permission and the contract,
// holds anything that leaves the platform for a person (Level 3), and calls the provider through the engine (breaker, rate limits, timeout, retries, health, events). Nothing in the platform
// imports a provider; adding Outlook, WhatsApp, Stripe, Slack or any future API is registering an adapter that implements `IntegrationProvider`. The Hub holds no token: a connection keeps
// only the opaque reference the provider gave it. Everything is per company.

import { HubEventLog } from "./integration-events";
import { IntegrationEngine, WorkflowEngine, validateWorkflow, type HubPort, type Workflow, type WorkflowRun } from "./integration-engine";
import { HealthTracker, type HealthReport } from "./integration-health";
import { Observability, traceIdFor } from "./integration-observability";
import { RateLimiter } from "./integration-rate-limit";
import type { IntegrationRegistry } from "./integration-registry";
import {
  isPersonActor, realDeps, type Actor, type Caller, type Capability, type Connection, type ConnectInput, type ConnectionStatus, type Deps, type ExecuteInput, type FailureKind, type HealthProbe, type IntegrationProvider, type ProviderContext,
  type ProviderResult, type ValidateInput,
} from "./integration-types";

/** What the Hub asks the platform: who administers a company, and whether a Worker is active in it. Injected: the Hub holds no organization data of its own. */
export type HubPolicy = { isAdmin(tenantId: string, actorId: string): boolean; isWorkerActive(tenantId: string, workerId: string): boolean };
export type HubOptions = { registry: IntegrationRegistry; policy: HubPolicy; deps?: Deps; log?: HubEventLog };

export type Refusal = "notFound" | "notRegistered" | "forbidden" | "personRequired" | "workerRequired" | "workerInactive" | "unknownCapability" | "invalid" | "notConnected" | "alreadyConnected" | "accountInUse" | "noProvider" | "notPending" | "samePerson";
export type HubResult<T = undefined> = { ok: boolean; status: "done" | "awaitingApproval" | "failed" | "refused" | "rejected"; refusal?: Refusal; failure?: FailureKind; message?: string; value?: T; connection?: Connection; approvalId?: string; traceId?: string; attempts?: number; usedProvider?: string; fallbackUsed?: boolean };
type Pending = { id: string; tenantId: string; caller: Caller; connectionId: string; providerId: string; capability: string; params: Readonly<Record<string, unknown>>; fallbackProviders: readonly string[]; allowWriteFallback: boolean; requestedAt: string };

export class IntegrationHub implements HubPort {
  readonly registry: IntegrationRegistry;
  readonly log: HubEventLog;
  readonly observability: Observability;
  readonly engine: IntegrationEngine;
  readonly workflows: WorkflowEngine;
  private readonly deps: Deps;
  private readonly policy: HubPolicy;
  private readonly rows = new Map<string, Connection>();
  private readonly pending = new Map<string, Pending>();
  private readonly lastStatus = new Map<string, string>();
  private counter = 0;
  private traces = 0;

  constructor(options: HubOptions) {
    this.registry = options.registry;
    this.policy = options.policy;
    this.deps = options.deps ?? realDeps;
    this.log = options.log ?? new HubEventLog();
    this.observability = new Observability(this.log);
    this.engine = new IntegrationEngine(this.deps, this.log, this.observability, new RateLimiter(() => this.deps.now()), new HealthTracker());
    this.workflows = new WorkflowEngine(this, this.deps, this.log);
  }

  private iso = () => new Date(this.deps.now()).toISOString();
  private trace = () => traceIdFor(++this.traces);
  private event(type: Parameters<HubEventLog["emit"]>[0]["type"], connection: Connection | { tenantId: string; providerId: string; id?: string }, traceId?: string, detail?: Record<string, unknown>) {
    return this.log.emit({ at: this.iso(), tenantId: connection.tenantId, providerId: connection.providerId, ...("id" in connection && connection.id ? { connectionId: connection.id } : {}), type, ...(traceId ? { traceId } : {}), ...(detail ? { detail } : {}) });
  }
  private refuse<T>(refusal: Refusal, message: string): HubResult<T> { return { ok: false, status: "refused", refusal, message }; }
  private ctx(connection: Connection, traceId: string, extra: Partial<ProviderContext> = {}): ProviderContext { return { tenantId: connection.tenantId, connectionId: connection.id, now: this.deps.now(), traceId, ...extra }; }
  private set(connection: Connection): Connection { this.rows.set(connection.id, connection); return connection; }
  private mark(connection: Connection, status: ConnectionStatus, error?: { kind: FailureKind; message: string }): Connection {
    const { lastError: _old, ...rest } = connection; void _old;
    return this.set({ ...rest, status, ...(error ? { lastError: { at: this.iso(), kind: error.kind, message: error.message } } : {}) });
  }

  // ------------------------------------------------------------ reading
  connections(tenantId: string): readonly Connection[] { return [...this.rows.values()].filter((row) => row.tenantId === tenantId).sort((a, b) => a.id.localeCompare(b.id)); }
  connection(tenantId: string, connectionId: string): Connection | undefined { const row = this.rows.get(connectionId); return row && row.tenantId === tenantId ? row : undefined; }
  /** What a provider can do (the capabilities its manifest promises), or what every registered provider can. */
  capabilities(providerId?: string): readonly { providerId: string; capability: Capability }[] {
    return this.registry.registered().filter((row) => !providerId || row.manifest.id === providerId).flatMap((row) => row.manifest.capabilities.map((capability) => ({ providerId: row.manifest.id, capability })));
  }
  private isAdmin(actor: Actor, tenantId: string): boolean { return isPersonActor(actor) && this.policy.isAdmin(tenantId, actor.id); }

  // ------------------------------------------------------------ connect, disconnect, refresh, recover (a person of the company, or the platform)
  async connect(actor: Actor, input: { tenantId: string; providerId: string; connectInput: ConnectInput }): Promise<HubResult<{ authorizationUrl?: string }>> {
    if (!isPersonActor(actor)) return this.refuse("personRequired", "Solo una persona conecta una app.");
    if (!this.isAdmin(actor, input.tenantId)) return this.refuse("forbidden", "Solo una persona que administra la empresa conecta una app.");
    const provider = this.registry.providerOf(input.providerId);
    if (!provider) return this.refuse("notRegistered", "Ese proveedor todavía no tiene un adaptador.");
    let connection = [...this.rows.values()].find((row) => row.tenantId === input.tenantId && row.providerId === input.providerId);
    if (connection && ["connected", "pending"].includes(connection.status) && input.connectInput.phase === "start") return this.refuse("alreadyConnected", "Esa app ya está conectada o en proceso.");
    if (!connection) { connection = this.set({ id: `ic_${String(++this.counter).padStart(5, "0")}`, tenantId: input.tenantId, providerId: input.providerId, status: "disconnected", createdBy: actor.id, createdAt: this.iso() }); this.event("connection.created", connection); }
    const traceId = this.trace();
    const outcome = await this.engine.call({ manifest: provider.manifest, tenantId: connection.tenantId, connectionId: connection.id, traceId, label: "connect", run: () => provider.connect(this.ctx(connection as Connection, traceId, { actorId: actor.id }), input.connectInput) });
    if (!outcome.result.ok) { const failed = this.mark(connection, "error", outcome.result.error); this.event("connection.failed", failed, traceId, { kind: outcome.result.error.kind }); return { ok: false, status: "failed", failure: outcome.result.error.kind, message: outcome.result.error.message, connection: failed, traceId }; }
    const value = outcome.result.value;
    if (value.status === "pending") { const pending = this.mark(connection, "pending"); return { ok: true, status: "done", value: { ...(value.authorizationUrl ? { authorizationUrl: value.authorizationUrl } : {}) }, connection: pending, traceId }; }
    if (value.status === "failed") { const failed = this.mark(connection, "error", { kind: "auth", message: "El proveedor no concedió el acceso." }); this.event("connection.failed", failed, traceId, { kind: "auth" }); return { ok: false, status: "failed", failure: "auth", connection: failed, traceId }; }
    // an external account belongs to ONE company
    if (value.accountRef && [...this.rows.values()].some((row) => row.providerId === input.providerId && row.id !== connection?.id && row.accountRef === value.accountRef && row.status === "connected")) {
      await provider.disconnect(this.ctx(connection, traceId, { actorId: actor.id }));
      this.mark(connection, "error", { kind: "auth", message: "Esa cuenta ya pertenece a otra empresa." });
      this.event("connection.failed", connection, traceId, { reason: "accountInUse" });
      return { ok: false, status: "refused", refusal: "accountInUse", message: "Esa cuenta ya pertenece a otra empresa.", traceId };
    }
    const done = this.set({ ...(this.mark(connection, "connected")), ...(value.accountRef ? { accountRef: value.accountRef } : {}), ...(value.tokenRef ? { tokenRef: value.tokenRef } : {}), connectedAt: this.iso() });
    this.event("connection.connected", done, traceId);
    return { ok: true, status: "done", connection: done, traceId };
  }

  async disconnect(actor: Actor, input: { tenantId: string; connectionId: string }): Promise<HubResult<{ revoked: boolean }>> {
    if (!isPersonActor(actor)) return this.refuse("personRequired", "Solo una persona desconecta una app.");
    if (!this.isAdmin(actor, input.tenantId)) return this.refuse("forbidden", "Solo una persona que administra la empresa desconecta una app.");
    const connection = this.connection(input.tenantId, input.connectionId);
    const provider = connection && this.registry.providerOf(connection.providerId);
    if (!connection || !provider) return this.refuse("notFound", "No existe esa conexión.");
    const traceId = this.trace();
    // a disconnection is never blocked by a breaker or a limit: the company must always be able to leave
    const result = await provider.disconnect(this.ctx(connection, traceId, { actorId: actor.id })).catch((): ProviderResult<{ revoked: boolean }> => ({ ok: true, value: { revoked: false } }));
    const closed = this.set({ ...this.mark(connection, "disconnected"), ...Object.fromEntries([]) });
    const { accountRef: _a, tokenRef: _t, ...clean } = closed; void _a; void _t;
    this.set(clean as Connection);
    for (const [id, row] of this.pending) if (row.connectionId === connection.id) this.pending.delete(id);
    this.engine.forget(IntegrationEngine.connectionKey(connection.tenantId, connection.id));
    this.event("connection.disconnected", closed, traceId, { revoked: result.ok ? result.value.revoked : false });
    return { ok: true, status: "done", value: { revoked: result.ok ? result.value.revoked : false }, connection: clean as Connection, traceId };
  }

  async refresh(actor: Actor, input: { tenantId: string; connectionId: string }): Promise<HubResult<{ renewed: boolean }>> {
    if (actor.kind !== "system" && !this.isAdmin(actor, input.tenantId)) return this.refuse("forbidden", "Solo la plataforma o quien administra la empresa renueva el acceso.");
    const connection = this.connection(input.tenantId, input.connectionId);
    const provider = connection && this.registry.providerOf(connection.providerId);
    if (!connection || !provider) return this.refuse("notFound", "No existe esa conexión.");
    if (connection.status !== "connected" && connection.status !== "error") return this.refuse("notConnected", "La app no está conectada.");
    const traceId = this.trace();
    const outcome = await this.engine.call({ manifest: provider.manifest, tenantId: connection.tenantId, connectionId: connection.id, traceId, label: "refresh", run: () => provider.refresh(this.ctx(connection, traceId)) });
    if (!outcome.result.ok) {
      const failed = this.mark(connection, outcome.result.error.kind === "auth" ? "error" : connection.status, outcome.result.error);
      this.event("connection.refresh_failed", failed, traceId, { kind: outcome.result.error.kind });
      return { ok: false, status: "failed", failure: outcome.result.error.kind, connection: failed, traceId, attempts: outcome.attempts.length };
    }
    const healthy = this.mark(connection, "connected");
    this.event("connection.refreshed", healthy, traceId, { renewed: outcome.result.value.renewed });
    return { ok: true, status: "done", value: { renewed: outcome.result.value.renewed }, connection: healthy, traceId };
  }

  /** A person brings a dead (or stuck) connector back: the next call is a single probe, and a success closes the circuit. */
  recover(actor: Actor, input: { tenantId: string; connectionId: string }): HubResult {
    if (!isPersonActor(actor)) return this.refuse("personRequired", "Solo una persona recupera un conector.");
    if (!this.isAdmin(actor, input.tenantId)) return this.refuse("forbidden", "Solo una persona que administra la empresa recupera un conector.");
    const connection = this.connection(input.tenantId, input.connectionId);
    const provider = connection && this.registry.providerOf(connection.providerId);
    if (!connection || !provider) return this.refuse("notFound", "No existe esa conexión.");
    this.engine.breakerFor(provider.manifest, IntegrationEngine.connectionKey(connection.tenantId, connection.id)).recover();
    const recovered = this.mark(connection, "error");
    this.event("connector.recovered", recovered);
    return { ok: true, status: "done", connection: recovered };
  }

  // ------------------------------------------------------------ health
  async health(tenantId: string, connectionId: string): Promise<HubResult<{ report: HealthReport; probe?: HealthProbe }>> {
    const connection = this.connection(tenantId, connectionId);
    const provider = connection && this.registry.providerOf(connection.providerId);
    if (!connection || !provider) return this.refuse("notFound", "No existe esa conexión.");
    const traceId = this.trace();
    const key = IntegrationEngine.connectionKey(tenantId, connectionId);
    const breaker = this.engine.breakerFor(provider.manifest, key).info().state;
    let probe: HealthProbe | undefined;
    if (connection.status === "connected" && breaker !== "dead" && breaker !== "open") {
      const outcome = await this.engine.call({ manifest: provider.manifest, tenantId, connectionId, traceId, label: "health", run: () => provider.health(this.ctx(connection, traceId)) });
      if (outcome.result.ok) probe = outcome.result.value;
    }
    const report = this.engine.score(provider.manifest, tenantId, connectionId, { tokenState: probe?.tokenState ?? (connection.status === "connected" ? "valid" : "none"), oauth: probe?.oauth ?? (connection.status === "connected" ? "n/a" : "none") }, probe?.lastSyncAt ?? connection.lastSyncAt);
    const label = `${report.status}:${report.score}`;
    this.event("health.checked", connection, traceId, { score: report.score, status: report.status });
    if (this.lastStatus.get(connectionId) !== report.status) { this.event("health.changed", connection, traceId, { to: report.status }); this.lastStatus.set(connectionId, report.status); }
    void label;
    return { ok: true, status: "done", value: { report, ...(probe ? { probe } : {}) }, traceId };
  }

  validate(tenantId: string, input: { connectionId: string; validate: ValidateInput }): Promise<HubResult<{ valid: boolean; issues: readonly string[] }>> {
    const connection = this.connection(tenantId, input.connectionId);
    const provider = connection && this.registry.providerOf(connection.providerId);
    if (!connection || !provider) return Promise.resolve(this.refuse("notFound", "No existe esa conexión."));
    const traceId = this.trace();
    return provider.validate(this.ctx(connection, traceId), input.validate).then((result) => (result.ok ? { ok: result.value.valid, status: "done" as const, value: result.value, traceId } : { ok: false, status: "failed" as const, failure: result.error.kind, traceId }));
  }

  // ------------------------------------------------------------ the Worker's door: sync and execute
  private checkCaller(caller: Caller): HubResult<never> | undefined {
    if (caller.kind === "system") return undefined;
    if (caller.kind !== "worker" || !caller.workerId) return this.refuse("workerRequired", "Solo un Worker, a través de su conector, llega al Hub.");
    if (!this.policy.isWorkerActive(caller.tenantId, caller.workerId)) return this.refuse("workerInactive", "Ese Worker no está activo en la empresa.");
    return undefined;
  }
  private pick(tenantId: string, input: { providerId?: string; connectionId?: string; capability?: string }): Connection[] {
    const mine = this.connections(tenantId).filter((row) => row.status === "connected");
    if (input.connectionId) return mine.filter((row) => row.id === input.connectionId);
    if (input.providerId) return mine.filter((row) => row.providerId === input.providerId);
    const capable = new Set(this.registry.byCapability(input.capability ?? "").map((row) => row.manifest.id));
    // the healthiest first: a connection whose breaker is open or dead is never the first choice
    return mine.filter((row) => capable.has(row.providerId)).sort((a, b) => this.rank(a) - this.rank(b) || a.id.localeCompare(b.id));
  }
  private rank(connection: Connection): number {
    const provider = this.registry.providerOf(connection.providerId);
    if (!provider) return 9;
    const state = this.engine.breakerFor(provider.manifest, IntegrationEngine.connectionKey(connection.tenantId, connection.id)).info().state;
    return state === "closed" ? 0 : state === "halfOpen" ? 1 : 2;
  }

  async sync(caller: Caller, input: { providerId?: string; connectionId?: string; kind: string }): Promise<{ status: "done" | "failed" | "refused"; items?: number; failure?: FailureKind }> {
    const refused = this.checkCaller(caller);
    if (refused) return { status: "refused" };
    const connection = this.pick(caller.tenantId, input)[0];
    const provider = connection && this.registry.providerOf(connection.providerId);
    if (!connection || !provider) return { status: "refused" };
    const traceId = this.trace();
    this.event("sync.started", connection, traceId, { kind: input.kind });
    const outcome = await this.engine.call({ manifest: provider.manifest, tenantId: connection.tenantId, connectionId: connection.id, traceId, label: "sync", run: () => provider.sync(this.ctx(connection, traceId, caller.kind === "worker" ? { workerId: caller.workerId } : {}), { kind: input.kind }) });
    if (!outcome.result.ok) { this.settleFailure(connection, outcome.result.error); this.event("sync.failed", connection, traceId, { kind: outcome.result.error.kind }); return { status: "failed", failure: outcome.result.error.kind }; }
    this.set({ ...this.mark(connection, "connected"), lastSyncAt: this.iso() });
    this.event("sync.finished", connection, traceId, { kind: input.kind, items: outcome.result.value.items });
    return { status: "done", items: outcome.result.value.items };
  }

  /** What a failure does to the connection: a revoked or expired grant is an error the person must fix; a dead breaker marks it dead. */
  private settleFailure(connection: Connection, error: { kind: FailureKind; message: string }): void {
    const provider = this.registry.providerOf(connection.providerId);
    const state = provider ? this.engine.breakerFor(provider.manifest, IntegrationEngine.connectionKey(connection.tenantId, connection.id)).info().state : "closed";
    if (state === "dead") this.mark(connection, "dead", error);
    else if (error.kind === "auth") this.mark(connection, "error", error);
    else this.set({ ...connection, lastError: { at: this.iso(), kind: error.kind, message: error.message } });
  }

  /**
   * A Worker asks for a capability. Reads run now. A write that leaves the platform is held for a person. A read that fails on its connection is retried on another connected provider that has the
   * same capability (fallback); a write is never sent to another provider unless the request says so.
   */
  async execute(caller: Caller, input: { providerId?: string; connectionId?: string; capability: string; params: Readonly<Record<string, unknown>>; allowWriteFallback?: boolean; fallbackProviders?: readonly string[] }, approvedBy?: string): Promise<HubResult<unknown>> {
    const refused = this.checkCaller(caller);
    if (refused) return refused;
    let candidates = this.pick(caller.tenantId, input);
    // an approved operation is pinned to the connection chosen when it was held, but keeps the fallbacks that were open then
    if (candidates.length > 0 && input.fallbackProviders?.length) {
      const connected = this.connections(caller.tenantId).filter((row) => row.status === "connected");
      const extra = input.fallbackProviders.flatMap((providerId) => connected.filter((row) => row.providerId === providerId && !candidates.some((item) => item.id === row.id)));
      candidates = [...candidates, ...extra];
    }
    if (candidates.length === 0) return this.refuse(this.registry.byCapability(input.capability).length === 0 ? "unknownCapability" : "noProvider", "No hay una app conectada de la empresa que pueda hacerlo.");
    const primary = candidates[0] as Connection;
    const capability = this.registry.capability(primary.providerId, input.capability);
    if (!capability) return this.refuse("unknownCapability", "Ese proveedor no ofrece esa capacidad.");
    const traceId = this.trace();
    const validity = await this.providerValidate(primary, input.capability, input.params, traceId);
    if (validity) return { ok: false, status: "refused", refusal: "invalid", message: validity, traceId };
    if (capability.external && !approvedBy) {
      const id = `ap_${String(++this.counter).padStart(5, "0")}`;
      this.pending.set(id, { id, tenantId: caller.tenantId, caller, connectionId: primary.id, providerId: primary.providerId, capability: input.capability, params: input.params, fallbackProviders: candidates.slice(1).map((row) => row.providerId), allowWriteFallback: input.allowWriteFallback ?? false, requestedAt: this.iso() });
      this.event("execute.awaiting_approval", primary, traceId, { capability: input.capability });
      return { ok: true, status: "awaitingApproval", approvalId: id, traceId };
    }
    this.event("execute.requested", primary, traceId, { capability: input.capability });
    const chain = capability.external && !input.allowWriteFallback ? [primary] : candidates;
    let last: HubResult<unknown> | undefined;
    for (const [position, connection] of chain.entries()) {
      const provider = this.registry.providerOf(connection.providerId);
      if (!provider || !this.registry.capability(connection.providerId, input.capability)) continue;
      if (position > 0) this.event("fallback.used", connection, traceId, { from: primary.providerId, to: connection.providerId });
      const outcome = await this.engine.call({
        manifest: provider.manifest, tenantId: connection.tenantId, connectionId: connection.id, traceId, label: `execute:${input.capability}`,
        run: () => provider.execute(this.ctx(connection, traceId, { ...(caller.kind === "worker" ? { workerId: caller.workerId } : {}), ...(approvedBy ? { approvedBy } : {}) }), { capability: input.capability, params: input.params } satisfies ExecuteInput),
      });
      if (outcome.result.ok) {
        this.event("execute.succeeded", connection, traceId, { capability: input.capability, attempts: outcome.attempts.length });
        return { ok: true, status: "done", value: outcome.result.value.data, connection, traceId, attempts: outcome.attempts.length, usedProvider: connection.providerId, fallbackUsed: position > 0 };
      }
      this.settleFailure(connection, outcome.result.error);
      this.event("execute.failed", connection, traceId, { capability: input.capability, kind: outcome.result.error.kind });
      last = { ok: false, status: "failed", failure: outcome.result.error.kind, message: outcome.result.error.message, connection, traceId, attempts: outcome.attempts.length, usedProvider: connection.providerId };
      // an authorization problem or a bad request will not be better elsewhere for a write; for a read another provider may still serve it
      if (!(outcome.blocked || INFRA_OR_LIMIT.includes(outcome.result.error.kind) || outcome.result.error.kind === "auth")) break;
    }
    return last ?? this.refuse("noProvider", "No hay una app conectada que pueda hacerlo.");
  }
  private async providerValidate(connection: Connection, capability: string, params: Readonly<Record<string, unknown>>, traceId: string): Promise<string | undefined> {
    const provider = this.registry.providerOf(connection.providerId);
    if (!provider) return "Proveedor sin adaptador.";
    const result = await provider.validate(this.ctx(connection, traceId), { capability, params });
    if (!result.ok) return result.error.message;
    return result.value.valid ? undefined : `Datos no válidos: ${result.value.issues.join(", ")}.`;
  }

  // ------------------------------------------------------------ approvals: only a person of THAT company, and a Worker never
  pendingFor(tenantId: string): readonly { id: string; providerId: string; capability: string; workerId: string; requestedAt: string }[] {
    return [...this.pending.values()].filter((row) => row.tenantId === tenantId).map((row) => ({ id: row.id, providerId: row.providerId, capability: row.capability, workerId: row.caller.kind === "worker" ? row.caller.workerId : "system", requestedAt: row.requestedAt }));
  }
  async approve(actor: Actor, input: { tenantId: string; approvalId: string }): Promise<HubResult<unknown>> {
    if (!isPersonActor(actor)) return this.refuse("personRequired", "Solo una persona aprueba.");
    if (!this.isAdmin(actor, input.tenantId)) return this.refuse("forbidden", "Solo una persona que administra la empresa aprueba.");
    const held = this.pending.get(input.approvalId);
    if (!held || held.tenantId !== input.tenantId) return this.refuse("notPending", "No hay nada pendiente con ese número.");
    this.pending.delete(input.approvalId);
    const connection = this.connection(held.tenantId, held.connectionId);
    if (connection) this.event("execute.approved", connection, undefined, { capability: held.capability });
    return this.execute(held.caller, { connectionId: held.connectionId, capability: held.capability, params: held.params, allowWriteFallback: held.allowWriteFallback, fallbackProviders: held.fallbackProviders }, actor.id);
  }
  reject(actor: Actor, input: { tenantId: string; approvalId: string; reason: string }): HubResult {
    if (!isPersonActor(actor)) return this.refuse("personRequired", "Solo una persona rechaza.");
    if (!this.isAdmin(actor, input.tenantId)) return this.refuse("forbidden", "Solo una persona que administra la empresa rechaza.");
    const held = this.pending.get(input.approvalId);
    if (!held || held.tenantId !== input.tenantId) return this.refuse("notPending", "No hay nada pendiente con ese número.");
    this.pending.delete(input.approvalId);
    const connection = this.connection(held.tenantId, held.connectionId);
    if (connection) this.event("execute.rejected", connection, undefined, { capability: held.capability });
    return { ok: true, status: "rejected" };
  }

  // ------------------------------------------------------------ workflows and webhooks
  defineWorkflow(actor: Actor, workflow: Omit<Workflow, "createdBy" | "createdAt" | "lastRunAt">): HubResult<{ issues: readonly string[] }> {
    if (!isPersonActor(actor)) return this.refuse("personRequired", "Solo una persona define un flujo.");
    if (!this.isAdmin(actor, workflow.tenantId)) return this.refuse("forbidden", "Solo una persona que administra la empresa define un flujo.");
    const full: Workflow = { ...workflow, createdBy: actor.id, createdAt: this.iso() };
    const issues = validateWorkflow(full, (id) => !!this.registry.providerOf(id));
    if (issues.length) return { ok: false, status: "refused", refusal: "invalid", value: { issues } };
    this.workflows.save(full);
    return { ok: true, status: "done", value: { issues: [] } };
  }
  /** A person starts a workflow by hand. */
  async runWorkflow(actor: Actor, input: { tenantId: string; workflowId: string }): Promise<WorkflowRun | undefined> {
    if (!this.isAdmin(actor, input.tenantId)) return undefined;
    return this.workflows.run(input.workflowId, input.tenantId, "manual");
  }
  /** The platform's scheduler calls this: every scheduled workflow that is due runs, as its Worker. */
  runScheduled(tenantId: string): Promise<readonly WorkflowRun[]> { return this.workflows.runDue(tenantId); }

  /** A provider's webhook arrives: it is validated by the PROVIDER first (a signature that does not check is dropped and nothing runs), then the company's webhook workflows run. */
  async webhook(input: { tenantId: string; providerId: string; headers: Readonly<Record<string, string>>; body: string }): Promise<HubResult<{ runs: number }>> {
    const connection = this.connections(input.tenantId).find((row) => row.providerId === input.providerId && row.status === "connected");
    const provider = connection && this.registry.providerOf(input.providerId);
    if (!connection || !provider) return this.refuse("notConnected", "No hay una app conectada de esa empresa para ese aviso.");
    const traceId = this.trace();
    const valid = await provider.validate(this.ctx(connection, traceId), { webhook: { headers: input.headers, body: input.body } });
    if (!valid.ok || !valid.value.valid) { this.event("webhook.rejected", connection, traceId); return { ok: false, status: "refused", refusal: "invalid", message: "La firma del aviso no es válida.", traceId }; }
    this.event("webhook.received", connection, traceId);
    const runs = await this.workflows.fire(input.tenantId, input.providerId, "webhook");
    return { ok: true, status: "done", value: { runs: runs.length }, traceId };
  }
}
const INFRA_OR_LIMIT: readonly FailureKind[] = ["provider", "network", "timeout", "rateLimit"];
export type { IntegrationProvider };
