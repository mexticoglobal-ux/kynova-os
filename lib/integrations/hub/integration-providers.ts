// The providers that plug into the Hub. This is the ONLY file of the layer that knows a specific provider; the Hub, the engine and the registry never do.
//   - `SimulatedProvider`: a deterministic, in-memory provider that implements the whole contract from any manifest. It is how every other expected provider (Outlook, WhatsApp, Stripe, Slack...)
//     is exercised before its real adapter exists, and how the engine's retries, breaker, limits and timeouts are tested. It never leaves the process.
//   - `googleHubProvider`: Google Workspace (Sprint 41) behind the universal contract. It WRAPS `GoogleWorkspace` and the connectors reducer without changing either: every call still goes
//     through the unchanged Worker -> Connector -> Google chain, and the person who approved an external write is passed down so the connector's own approval rule is kept.

import { CONNECTORS, type ConnectorEnv, type ConnectorId, type ConnectorsState } from "@/lib/contracts/platform/connectors";
import { workspaceView, type GoogleConnectorId, type GoogleWorkspace } from "@/lib/integrations/google";
import {
  failure, ok, type Capability, type ConnectInput, type ConnectOutput, type ExecuteInput, type ExecuteOutput, type FailureKind, type HealthProbe, type IntegrationProvider, type ProviderContext, type ProviderManifest,
  type ProviderFailure, type ProviderResult, type SyncInput, type SyncOutput, type ValidateInput, type ValidateOutput,
} from "./integration-types";

// ---------------------------------------------------------------- the simulated provider
export type Scripted = ProviderResult<unknown> | "hang";
/** A provider for tests and for the day before an adapter exists: it answers from a script (or succeeds), takes a simulated time, and records every call. */
export class SimulatedProvider implements IntegrationProvider {
  readonly calls: { method: string; capability?: string; tenantId: string; workerId?: string; approvedBy?: string }[] = [];
  private readonly scripts = new Map<string, Scripted[]>();
  private accounts = 0;
  /** the account the next callback reports (so a test can make two companies claim the same one) */
  nextAccount: string | undefined;
  latencyMs = 40;
  oauth: HealthProbe["oauth"] = "authorized";
  tokenState: HealthProbe["tokenState"] = "valid";
  /** capabilities whose params are checked: `required[capability] = ["to", "subject"]` */
  required: Record<string, readonly string[]> = {};
  webhookSecret = "sim-signature";
  constructor(readonly manifest: ProviderManifest, private readonly clock: { advance(ms: number): void }) {}

  /** Queue results for a method (`"execute"`, `"execute:mail.send"`, `"sync"`...): they are used once each, in order, then the provider goes back to succeeding. */
  script(key: string, results: readonly Scripted[]): void { this.scripts.set(key, [...results]); }
  private next(...keys: string[]): Scripted | undefined { for (const key of keys) { const queue = this.scripts.get(key); if (queue?.length) return queue.shift(); } return undefined; }
  private async answer<T>(method: string, ctx: ProviderContext, fallback: () => ProviderResult<T>, capability?: string): Promise<ProviderResult<T>> {
    this.calls.push({ method, ...(capability ? { capability } : {}), tenantId: ctx.tenantId, ...(ctx.workerId ? { workerId: ctx.workerId } : {}), ...(ctx.approvedBy ? { approvedBy: ctx.approvedBy } : {}) });
    const scripted = this.next(...(capability ? [`${method}:${capability}`, method] : [method]));
    if (scripted === "hang") return new Promise<ProviderResult<T>>(() => undefined);
    this.clock.advance(this.latencyMs);
    return (scripted as ProviderResult<T> | undefined) ?? fallback();
  }
  capabilities(): readonly Capability[] { return this.manifest.capabilities; }
  connect(ctx: ProviderContext, input: ConnectInput): Promise<ProviderResult<ConnectOutput>> {
    return this.answer<ConnectOutput>("connect", ctx, () => input.phase === "start"
      ? ok({ status: "pending" as const, authorizationUrl: `https://sim.example/${this.manifest.id}/authorize?scopes=${input.scopes.length}` })
      : input.error || !input.code ? ok({ status: "failed" as const }) : ok({ status: "connected" as const, accountRef: this.nextAccount ?? `${this.manifest.id}-account-${++this.accounts}`, tokenRef: `secret:sim-${this.manifest.id}-${ctx.connectionId}` }));
  }
  disconnect(ctx: ProviderContext): Promise<ProviderResult<{ revoked: boolean }>> { return this.answer("disconnect", ctx, () => ok({ revoked: true })); }
  refresh(ctx: ProviderContext): Promise<ProviderResult<{ renewed: boolean; expiresAt?: number }>> { return this.answer("refresh", ctx, () => ok({ renewed: true, expiresAt: ctx.now + 3_600_000 })); }
  health(ctx: ProviderContext): Promise<ProviderResult<HealthProbe>> { return this.answer("health", ctx, () => ok({ ok: true, latencyMs: this.latencyMs, oauth: this.oauth, tokenState: this.tokenState })); }
  sync(ctx: ProviderContext, input: SyncInput): Promise<ProviderResult<SyncOutput>> { return this.answer("sync", ctx, () => ok({ kind: input.kind, items: 3, cursor: `c${ctx.now}` })); }
  execute(ctx: ProviderContext, input: ExecuteInput): Promise<ProviderResult<ExecuteOutput>> { return this.answer("execute", ctx, () => ok({ data: { capability: input.capability, by: this.manifest.id } }), input.capability); }
  async validate(ctx: ProviderContext, input: ValidateInput): Promise<ProviderResult<ValidateOutput>> {
    this.calls.push({ method: "validate", tenantId: ctx.tenantId });
    if ("webhook" in input) { const valid = input.webhook.headers["x-signature"] === this.webhookSecret; return ok({ valid, issues: valid ? [] : ["firma"] }); }
    if (!this.manifest.capabilities.some((cap) => cap.id === input.capability)) return ok({ valid: false, issues: ["capacidad"] });
    const missing = (this.required[input.capability] ?? []).filter((key) => input.params[key] === undefined || input.params[key] === "");
    return ok({ valid: missing.length === 0, issues: missing });
  }
}

// ---------------------------------------------------------------- Google Workspace behind the universal contract
export type GoogleStore = { state: ConnectorsState; env: ConnectorEnv };
const GOOGLE_CAPABILITIES: readonly { capability: Capability; operation: string; connectorId: GoogleConnectorId; required: readonly string[] }[] = [
  { capability: { id: "mail.search", label: "Buscar correos", kind: "read", external: false }, operation: "gmail.search", connectorId: "gmail", required: ["query"] },
  { capability: { id: "mail.read", label: "Leer un correo", kind: "read", external: false }, operation: "gmail.read", connectorId: "gmail", required: ["id"] },
  { capability: { id: "mail.attachment", label: "Descargar un adjunto", kind: "read", external: false }, operation: "gmail.attachment", connectorId: "gmail", required: ["messageId", "attachmentId"] },
  { capability: { id: "mail.labels", label: "Ver las etiquetas", kind: "read", external: false }, operation: "gmail.listLabels", connectorId: "gmail", required: [] },
  { capability: { id: "mail.send", label: "Enviar un correo", kind: "write", external: true }, operation: "gmail.send", connectorId: "gmail", required: ["to", "subject", "text"] },
  { capability: { id: "mail.reply", label: "Responder un correo", kind: "write", external: true }, operation: "gmail.reply", connectorId: "gmail", required: ["messageId", "text"] },
  { capability: { id: "mail.draft", label: "Crear un borrador", kind: "write", external: true }, operation: "gmail.createDraft", connectorId: "gmail", required: ["to", "subject", "text"] },
  { capability: { id: "calendar.list", label: "Ver eventos", kind: "read", external: false }, operation: "calendar.list", connectorId: "googleCalendar", required: ["timeMin", "timeMax"] },
  { capability: { id: "calendar.availability", label: "Proponer horarios libres", kind: "read", external: false }, operation: "calendar.availability", connectorId: "googleCalendar", required: ["timeMin", "timeMax", "minutes"] },
  { capability: { id: "calendar.create", label: "Crear un evento", kind: "write", external: true }, operation: "calendar.create", connectorId: "googleCalendar", required: ["summary", "start", "end"] },
  { capability: { id: "calendar.update", label: "Cambiar un evento", kind: "write", external: true }, operation: "calendar.update", connectorId: "googleCalendar", required: ["eventId"] },
  { capability: { id: "calendar.cancel", label: "Cancelar un evento", kind: "write", external: true }, operation: "calendar.cancel", connectorId: "googleCalendar", required: ["eventId"] },
  { capability: { id: "files.search", label: "Buscar archivos", kind: "read", external: false }, operation: "drive.search", connectorId: "googleDrive", required: [] },
  { capability: { id: "files.get", label: "Ver un archivo", kind: "read", external: false }, operation: "drive.get", connectorId: "googleDrive", required: ["fileId"] },
  { capability: { id: "files.createFolder", label: "Crear una carpeta", kind: "write", external: true }, operation: "drive.createFolder", connectorId: "googleDrive", required: ["name"] },
  { capability: { id: "files.upload", label: "Subir un archivo", kind: "write", external: true }, operation: "drive.upload", connectorId: "googleDrive", required: ["name", "mimeType", "dataBase64"] },
  { capability: { id: "files.move", label: "Mover un archivo", kind: "write", external: true }, operation: "drive.move", connectorId: "googleDrive", required: ["fileId", "toFolderId"] },
  { capability: { id: "files.share", label: "Compartir un archivo", kind: "write", external: true }, operation: "drive.share", connectorId: "googleDrive", required: ["fileId", "email", "role"] },
];
export const GOOGLE_HUB_MANIFEST: ProviderManifest = {
  id: "google-workspace", name: "Google Workspace", category: "email", type: "oauth2", version: "1.0.0",
  permissions: ["mail.read", "mail.send", "calendar.read", "calendar.write", "files.read", "files.write"],
  scopes: (["gmail", "googleCalendar", "googleDrive"] as const).flatMap((id) => CONNECTORS[id].scopes.map((row) => ({ id: `${id}.${row.id}`, label: `${CONNECTORS[id].label}: ${row.label}`, effect: row.effect }))),
  // reference values: Google's real quotas are per user and per project and are verified at the first real connection
  rateLimits: { perMinute: 600, perHour: 15_000, perDay: 500_000, burst: 20 }, health: { latencyTargetMs: 1_500, syncMaxAgeMs: 3_600_000 }, capabilities: GOOGLE_CAPABILITIES.map((row) => row.capability), timeoutMs: 20_000,
};
const KIND: Record<string, FailureKind> = { auth: "auth", scope: "scope", rateLimit: "rateLimit", provider: "provider", network: "network", notFound: "notFound", invalid: "invalid", notConfigured: "notConnected", scopeInsufficient: "scope", workerInactive: "invalid", permissionOff: "scope", denied: "auth" };
const toFailure = (code: string | undefined, message: string | undefined): ProviderResult<never> => { const kind = KIND[code ?? ""] ?? "provider"; return failure(kind, message ?? "Google no pudo completar la operación.", { retryable: kind === "rateLimit" || kind === "provider" || kind === "network" }); };

export function googleHubProvider(workspace: GoogleWorkspace, store: GoogleStore, options: { redirectUri: string; now: () => number }): IntegrationProvider {
  const iso = () => new Date(options.now()).toISOString();
  const connectionOf = (tenantId: string, connectorId: ConnectorId) => store.state.connections.find((row) => row.tenantId === tenantId && row.connectorId === connectorId);
  const targetOf = (value: string | undefined): GoogleConnectorId => (value === "googleCalendar" || value === "googleDrive" ? value : "gmail");
  const provider: IntegrationProvider = {
    manifest: GOOGLE_HUB_MANIFEST,
    capabilities: () => GOOGLE_HUB_MANIFEST.capabilities,
    async connect(ctx, input) {
      const connectorId = targetOf(input.target);
      if (input.phase === "start") {
        const begun = await workspace.begin(store.state, store.env, { tenantId: ctx.tenantId, actor: ctx.actorId ?? "", at: iso(), connectorId, scopes: input.scopes, redirectUri: options.redirectUri });
        if (!begun.ok) return toFailure(begun.code, begun.error);
        store.state = begun.state;
        return ok<ConnectOutput>({ status: "pending", authorizationUrl: (begun.result as { url: string }).url });
      }
      const opaque = (reference: string) => reference;
      const finished = await workspace.finish(store.state, store.env, { tenantId: ctx.tenantId, at: iso(), connectorId, state: input.state, ...(input.code ? { code: input.code } : {}), ...(input.error ? { error: input.error } : {}), redirectUri: input.redirectUri });
      store.state = finished.state;
      if (!finished.ok) return finished.code === "denied" ? ok<ConnectOutput>({ status: "failed" }) : toFailure(finished.code, finished.error);
      return ok<ConnectOutput>({ status: "connected", ...(finished.connection?.accountId ? { accountRef: finished.connection.accountId } : {}), ...(finished.connection?.tokenRef ? { tokenRef: opaque(finished.connection.tokenRef) } : {}) });
    },
    async disconnect(ctx) {
      let revoked = false;
      for (const connection of store.state.connections.filter((row) => row.tenantId === ctx.tenantId && row.connectorId in { gmail: 1, googleCalendar: 1, googleDrive: 1 } && row.status !== "notConnected")) {
        const result = await workspace.disconnect(store.state, store.env, { tenantId: ctx.tenantId, actor: ctx.actorId ?? "", at: iso(), connectionId: connection.id });
        if (result.ok) { store.state = result.state; revoked = revoked || (result.result as { revokedAtGoogle: boolean } | undefined)?.revokedAtGoogle === true; }
      }
      return ok({ revoked });
    },
    async refresh(ctx) {
      const renewed = await workspace.renewDue(store.state, store.env, iso(), ctx.tenantId);
      store.state = renewed.state;
      const authFailure = renewed.failed.find((row) => row.kind === "auth");
      if (authFailure) return failure("auth", "Google ya no acepta este acceso: hay que autorizar de nuevo.");
      return ok({ renewed: renewed.renewed.length > 0 });
    },
    async health(ctx) {
      const rows = workspaceView(store.state, workspace.activities_(), ctx.tenantId, iso());
      const connected = rows.filter((row) => row.display === "Connected");
      const lastSyncAt = rows.map((row) => row.lastSyncAt).filter((value): value is string => !!value).sort().at(-1);
      const revoked = rows.some((row) => row.needsReauthorization);
      return ok<HealthProbe>({ ok: connected.length > 0 && !revoked, latencyMs: 0, oauth: revoked ? "revoked" : connected.length > 0 ? "authorized" : "none", tokenState: revoked ? "revoked" : connected.length === 0 ? "none" : connected.some((row) => row.renewalDue) ? "expiringSoon" : "valid", ...(lastSyncAt ? { lastSyncAt } : {}) });
    },
    async sync(ctx, input: SyncInput) {
      const connectorId: GoogleConnectorId = input.kind === "events" ? "googleCalendar" : input.kind === "files" ? "googleDrive" : "gmail";
      const connection = connectionOf(ctx.tenantId, connectorId);
      if (!connection) return failure("notConnected", "Esa app de Google no está conectada.");
      const result = await workspace.sync(store.state, store.env, { tenantId: ctx.tenantId, connectionId: connection.id, at: iso() });
      store.state = result.state;
      if (!result.ok) return toFailure(result.code, result.error);
      return ok<SyncOutput>({ kind: input.kind, items: (result.result as { synced: { items: number }[] }).synced.reduce((total, row) => total + row.items, 0) });
    },
    async execute(ctx, input: ExecuteInput) {
      const row = GOOGLE_CAPABILITIES.find((item) => item.capability.id === input.capability);
      if (!row) return failure("unsupported", "Esa capacidad no existe en Google Workspace.");
      const connection = connectionOf(ctx.tenantId, row.connectorId);
      if (!connection) return failure("notConnected", "Esa app de Google no está conectada.");
      let result = await workspace.request(store.state, store.env, { tenantId: ctx.tenantId, workerId: ctx.workerId ?? "", connectionId: connection.id, operation: row.operation, params: input.params as Record<string, unknown>, at: iso() });
      store.state = result.state;
      // the Hub already had a person approve this external write: that same person approves it in the connector, whose own rule is therefore kept
      if (result.status === "awaitingApproval" && result.action && ctx.approvedBy) {
        result = await workspace.approve(store.state, store.env, { tenantId: ctx.tenantId, actor: ctx.approvedBy, actionId: result.action.id, at: iso() });
        store.state = result.state;
      }
      if (!result.ok) return toFailure(result.code, result.error);
      return ok<ExecuteOutput>({ data: result.result });
    },
    async validate(_ctx, input: ValidateInput) {
      if ("webhook" in input) return ok<ValidateOutput>({ valid: false, issues: ["Google Workspace no usa avisos en esta versión"] });
      const row = GOOGLE_CAPABILITIES.find((item) => item.capability.id === input.capability);
      if (!row) return ok<ValidateOutput>({ valid: false, issues: ["capacidad"] });
      const missing = row.required.filter((key) => input.params[key] === undefined || input.params[key] === "");
      return ok<ValidateOutput>({ valid: missing.length === 0, issues: missing });
    },
  };
  return provider;
}
export const googleCapabilityMap = (): readonly { capability: string; operation: string; connectorId: GoogleConnectorId }[] => GOOGLE_CAPABILITIES.map((row) => ({ capability: row.capability.id, operation: row.operation, connectorId: row.connectorId }));
export type { ProviderFailure };
