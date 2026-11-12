// The chain  Worker -> Connector -> Google  for Gmail, Google Calendar and Google Drive. This service ORCHESTRATES the Connectors architecture (Sprint 40, unchanged) and the real Google
// calls: every request goes through `reduceConnectors` first (the Worker must be active in the company, the permission must be on, anything that leaves the platform waits for a person),
// and only then does Google get called, with the connection's own token. A Worker's request never carries content into the audit trail: the summary is the operation's label.
//
// What the Connectors reducer cannot say (and cannot be changed in this sprint): it simulates the outcome of an approved write and of a sync, and has no event for a REAL provider failure.
// So the REAL outcome of every call is kept here, in an append-only execution log without content (and in the per-connection activity), and the Connected Apps view reads both.

import {
  CONNECTORS, reduceConnectors, tokenDue, type ConnectorAction, type ConnectorEnv, type ConnectorId, type ConnectorsEvent, type ConnectorsState, type Connection, type SyncKind,
} from "@/lib/contracts/platform/connectors";
import * as calendar from "./calendar";
import { GoogleApiError, accessToken, authorizationUrl, completeAuthorization, errorKindOf, generatePkce, googleRequest, grantedGoogleScopes, randomState, refreshAccessToken, rememberVerifier, revokeAccess, GOOGLE_ENDPOINTS, type GoogleDeps, type GoogleErrorKind } from "./core";
import * as drive from "./drive";
import * as gmail from "./gmail";
import { GOOGLE_OPERATIONS, operationById, type GoogleOperationId, type Params } from "./operations";
import { GOOGLE_CONNECTORS, type GoogleConnectorId } from "./view";

export { GOOGLE_CONNECTORS, type GoogleConnectorId };
const isGoogle = (id: ConnectorId): id is GoogleConnectorId => (GOOGLE_CONNECTORS as readonly string[]).includes(id);

export type ExecutionRecord = { id: string; tenantId: string; connectionId: string; connectorId: ConnectorId; operation: string; workerId: string; actionId: string; at: string; outcome: "ok" | "failed"; errorKind?: GoogleErrorKind; durationMs: number };
export type Seen = { id: string; at: string };
export type ConnectionActivity = { connectionId: string; tenantId: string; lastSyncAt?: string; lastEmail?: Seen; lastEvent?: Seen; lastFile?: Seen; recent: readonly ("ok" | "failed")[]; consecutiveFailures: number; needsReauthorization: boolean; lastErrorKind?: GoogleErrorKind };
export type WorkspaceResult<T = unknown> = { state: ConnectorsState; ok: boolean; status?: "done" | "awaitingApproval" | "rejected" | "failed" | "refused"; code?: string; error?: string; action?: ConnectorAction; result?: T; connection?: Connection };
const RECENT = 20;
const system = (tenantId: string, at: string) => ({ tenantId, actor: "system", at });

export class GoogleWorkspace {
  readonly executions: ExecutionRecord[] = [];
  private readonly activities = new Map<string, ConnectionActivity>();
  private readonly pending = new Map<string, { tenantId: string; operation: GoogleOperationId; params: Params }>();
  private counter = 0;
  constructor(private readonly deps: GoogleDeps) {}

  activity(connectionId: string): ConnectionActivity | undefined { return this.activities.get(connectionId); }
  activities_(): readonly ConnectionActivity[] { return [...this.activities.values()]; }
  pendingCount(tenantId: string): number { return [...this.pending.values()].filter((row) => row.tenantId === tenantId).length; }

  private touch(connection: Connection, change: (current: ConnectionActivity) => ConnectionActivity): void {
    const current = this.activities.get(connection.id) ?? { connectionId: connection.id, tenantId: connection.tenantId, recent: [], consecutiveFailures: 0, needsReauthorization: false };
    this.activities.set(connection.id, change(current));
  }
  private note(connection: Connection, outcome: "ok" | "failed", errorKind?: GoogleErrorKind): void {
    this.touch(connection, (row) => ({
      ...row, recent: [...row.recent, outcome].slice(-RECENT), consecutiveFailures: outcome === "ok" ? 0 : row.consecutiveFailures + 1,
      needsReauthorization: outcome === "failed" && errorKind === "auth" ? true : outcome === "ok" ? false : row.needsReauthorization, ...(errorKind ? { lastErrorKind: errorKind } : {}),
    }));
  }
  private log(connection: Connection, action: ConnectorAction, operation: string, workerId: string, at: string, started: number, outcome: "ok" | "failed", errorKind?: GoogleErrorKind): void {
    this.executions.push({ id: `ex_${String(++this.counter).padStart(5, "0")}`, tenantId: connection.tenantId, connectionId: connection.id, connectorId: connection.connectorId, operation, workerId, actionId: action.id, at, outcome, ...(errorKind ? { errorKind } : {}), durationMs: Math.max(0, this.deps.now() - started) });
    this.note(connection, outcome, errorKind);
  }

  // ------------------------------------------------------------ OAuth: start, finish, disconnect (a person; the provider's callback)
  /** Starts the real authorization for the person's company: PKCE, a single-use state, and the URL to send them to. */
  async begin(state: ConnectorsState, env: ConnectorEnv, input: { tenantId: string; actor: string; at: string; connectorId: GoogleConnectorId; scopes: readonly string[]; redirectUri: string }): Promise<WorkspaceResult<{ url: string }>> {
    const pkce = await generatePkce();
    const oauthState = randomState();
    const started = reduceConnectors(state, { tenantId: input.tenantId, actor: input.actor, at: input.at, type: "connect.start", connectorId: input.connectorId, scopes: input.scopes, redirectUri: input.redirectUri, state: oauthState, codeChallenge: pkce.challenge }, env);
    if (started.error || !started.authorization) return { state, ok: false, status: "refused", ...(started.errorCode ? { code: started.errorCode } : {}), ...(started.error ? { error: started.error } : {}) };
    try {
      await rememberVerifier(this.deps, oauthState, pkce.verifier);
      const url = await authorizationUrl(this.deps, started.authorization);
      return { state: started.state, ok: true, ...(started.connection ? { connection: started.connection } : {}), result: { url } };
    } catch (error) {
      return { state, ok: false, status: "refused", code: errorKindOf(error), error: error instanceof GoogleApiError ? error.message : "No se pudo preparar la autorización." };
    }
  }

  /** Finishes the authorization from the callback: exchanges the code, learns which account it is, and records it for the company that started it, or refuses it and throws the tokens away. */
  async finish(state: ConnectorsState, env: ConnectorEnv, input: { tenantId: string; at: string; connectorId: GoogleConnectorId; state: string; code?: string; error?: string; redirectUri: string }): Promise<WorkspaceResult> {
    const connection = state.connections.find((row) => row.tenantId === input.tenantId && row.connectorId === input.connectorId && row.flow?.state === input.state);
    if (!connection) { const refused = reduceConnectors(state, { ...system(input.tenantId, input.at), type: "oauth.callback", connectorId: input.connectorId, state: input.state, error: "state" }, env); return { state, ok: false, status: "refused", ...(refused.errorCode ? { code: refused.errorCode } : {}), ...(refused.error ? { error: refused.error } : {}) }; }
    if (input.error || !input.code) { const denied = reduceConnectors(state, { ...system(input.tenantId, input.at), type: "oauth.callback", connectorId: input.connectorId, state: input.state, error: input.error ?? "denied" }, env); return { state: denied.state, ok: false, status: "refused", code: "denied", error: "Google no concedió el acceso.", ...(denied.connection ? { connection: denied.connection } : {}) }; }
    const tokenRef = `secret:oauth-${connection.id}`;
    let granted: readonly string[];
    try { granted = (await completeAuthorization(this.deps, { state: input.state, code: input.code, redirectUri: input.redirectUri, tokenRef })).grantedScopes; }
    catch (error) { return { state, ok: false, status: "failed", code: errorKindOf(error), error: error instanceof GoogleApiError ? error.message : "No se pudo completar la autorización." }; }
    let account: string;
    try { account = (await this.identity(input.connectorId, tokenRef)).toLowerCase(); }
    catch (error) { await revokeAccess(this.deps, tokenRef); return { state, ok: false, status: "failed", code: errorKindOf(error), error: "No se pudo saber qué cuenta de Google es." }; }
    const scopeIds = CONNECTORS[input.connectorId].scopes.filter((row) => granted.includes(row.oauth) && connection.requestedScopes.includes(row.id)).map((row) => row.id);
    const done = reduceConnectors(state, { ...system(input.tenantId, input.at), type: "oauth.callback", connectorId: input.connectorId, state: input.state, code: "exchanged", accountId: account, accountLabel: account, grantedScopes: scopeIds }, env);
    if (done.error || done.connection?.tokenRef !== tokenRef) {
      await revokeAccess(this.deps, tokenRef); // the account belongs to another company, or the grant does not match: nothing is kept
      return { state, ok: false, status: "refused", ...(done.errorCode ? { code: done.errorCode } : {}), ...(done.error ? { error: done.error } : {}) };
    }
    this.touch(done.connection, (row) => row);
    return { state: done.state, ok: true, ...(done.connection ? { connection: done.connection } : {}) };
  }
  private async identity(connectorId: GoogleConnectorId, tokenRef: string): Promise<string> {
    if (connectorId === "gmail") return (await gmail.profile(this.deps, tokenRef)).emailAddress;
    if (connectorId === "googleCalendar") return (await calendar.calendarIdentity(this.deps, tokenRef)).id;
    return (await drive.driveIdentity(this.deps, tokenRef)).user.emailAddress;
  }

  /** Disconnects: the platform decides first (only an administrator of THAT company), then the access is revoked at Google and the tokens are deleted. */
  async disconnect(state: ConnectorsState, env: ConnectorEnv, input: { tenantId: string; actor: string; at: string; connectionId: string }): Promise<WorkspaceResult<{ revokedAtGoogle: boolean }>> {
    const connection = state.connections.find((row) => row.id === input.connectionId && row.tenantId === input.tenantId);
    const result = reduceConnectors(state, { tenantId: input.tenantId, actor: input.actor, at: input.at, type: "connection.disconnect", connectionId: input.connectionId }, env);
    if (result.error) return { state, ok: false, status: "refused", ...(result.errorCode ? { code: result.errorCode } : {}), error: result.error };
    const revoked = connection?.tokenRef ? await revokeAccess(this.deps, connection.tokenRef) : { revokedAtGoogle: false };
    if (connection) this.activities.delete(connection.id);
    for (const [id, row] of this.pending) if (row.tenantId === input.tenantId) { const action = state.actions.find((item) => item.id === id); if (action?.connectionId === input.connectionId) this.pending.delete(id); }
    return { state: result.state, ok: true, result: revoked, ...(result.connection ? { connection: result.connection } : {}) };
  }

  // ------------------------------------------------------------ the chain: a Worker asks, the connector decides, Google does
  /** A Worker asks for an operation. Reads run at once when the permission is on; anything that leaves the platform waits for a person (see `approve`). */
  async request(state: ConnectorsState, env: ConnectorEnv, input: { tenantId: string; workerId: string; connectionId: string; operation: string; params: Params; at: string }): Promise<WorkspaceResult> {
    const operation = operationById(input.operation);
    if (!operation) return { state, ok: false, status: "refused", code: "unknownOperation", error: "Esa operación no existe." };
    const connection = state.connections.find((row) => row.id === input.connectionId && row.tenantId === input.tenantId);
    if (!connection || connection.connectorId !== operation.connectorId) return { state, ok: false, status: "refused", code: "notFound", error: "No existe esa conexión de la empresa para esta operación." };
    if (connection.tokenRef && !(await this.deps.vault.has(connection.tokenRef))) {
      // the tokens are gone (Google revoked the access): the person must authorize again, and the dashboard shows it
      this.note(connection, "failed", "auth");
      return { state, ok: false, status: "failed", code: "auth", error: "El acceso a Google ya no es válido: hay que autorizar de nuevo." };
    }
    if (connection.tokenRef) {
      const granted = await grantedGoogleScopes(this.deps, connection.tokenRef);
      if (!operation.google.some((scope) => granted.includes(scope))) return { state, ok: false, status: "refused", code: "scopeInsufficient", error: `Google no concedió el permiso que esta operación necesita (${operation.google[0] ?? ""}).` };
    }
    const asked = reduceConnectors(state, { tenantId: input.tenantId, actor: `worker:${input.workerId}`, at: input.at, type: "action.request", connectionId: input.connectionId, workerId: input.workerId, scope: operation.scopeId, operation: operation.id, summary: operation.label }, env);
    if (asked.error || !asked.action) return { state, ok: false, status: "refused", ...(asked.errorCode ? { code: asked.errorCode } : {}), ...(asked.error ? { error: asked.error } : {}) };
    if (asked.action.status === "awaitingApproval") { this.pending.set(asked.action.id, { tenantId: input.tenantId, operation: operation.id, params: input.params }); return { state: asked.state, ok: true, status: "awaitingApproval", action: asked.action }; }
    return this.execute(asked.state, connection, asked.action, operation.id, input.params, input.workerId, input.at);
  }

  /** A person approves a held operation of THEIR company and it runs. A Worker cannot approve (the reducer refuses it). */
  async approve(state: ConnectorsState, env: ConnectorEnv, input: { tenantId: string; actor: string; actionId: string; at: string }): Promise<WorkspaceResult> {
    const approved = reduceConnectors(state, { tenantId: input.tenantId, actor: input.actor, at: input.at, type: "action.approve", actionId: input.actionId }, env);
    if (approved.error || !approved.action) return { state, ok: false, status: "refused", ...(approved.errorCode ? { code: approved.errorCode } : {}), ...(approved.error ? { error: approved.error } : {}) };
    const held = this.pending.get(input.actionId);
    this.pending.delete(input.actionId);
    const connection = approved.state.connections.find((row) => row.id === approved.action?.connectionId);
    if (approved.action.status === "failed" || !held || !connection) return { state: approved.state, ok: false, status: "failed", action: approved.action, error: "La operación no pudo ejecutarse." };
    return this.execute(approved.state, connection, approved.action, held.operation, held.params, approved.action.workerId, input.at);
  }
  async reject(state: ConnectorsState, env: ConnectorEnv, input: { tenantId: string; actor: string; actionId: string; reason: string; at: string }): Promise<WorkspaceResult> {
    const rejected = reduceConnectors(state, { tenantId: input.tenantId, actor: input.actor, at: input.at, type: "action.reject", actionId: input.actionId, reason: input.reason }, env);
    if (rejected.error) return { state, ok: false, status: "refused", ...(rejected.errorCode ? { code: rejected.errorCode } : {}), error: rejected.error };
    this.pending.delete(input.actionId);
    return { state: rejected.state, ok: true, status: "rejected", ...(rejected.action ? { action: rejected.action } : {}) };
  }

  private async execute(state: ConnectorsState, connection: Connection, action: ConnectorAction, operationId: GoogleOperationId, params: Params, workerId: string, at: string): Promise<WorkspaceResult> {
    const started = this.deps.now();
    try {
      if (!connection.tokenRef) throw new GoogleApiError("auth", "La conexión no tiene acceso a Google.");
      const result = await GOOGLE_OPERATIONS[operationId].run(this.deps, connection.tokenRef, params);
      this.log(connection, action, operationId, workerId, at, started, "ok");
      return { state, ok: true, status: "done", action, result };
    } catch (error) {
      const kind = errorKindOf(error);
      this.log(connection, action, operationId, workerId, at, started, "failed", kind);
      return { state, ok: false, status: "failed", code: kind, action, error: error instanceof GoogleApiError ? error.message : "Google no pudo completar la operación." };
    }
  }

  // ------------------------------------------------------------ sync and renewal
  /** Syncs a connection for real: the reducer says whether it may (permission on), Google answers, and only a real success moves the connection's last sync. */
  async sync(state: ConnectorsState, env: ConnectorEnv, input: { tenantId: string; connectionId: string; at: string }): Promise<WorkspaceResult<{ synced: { kind: SyncKind; items: number }[] }>> {
    const connection = state.connections.find((row) => row.id === input.connectionId && row.tenantId === input.tenantId);
    if (!connection || !connection.tokenRef || !isGoogle(connection.connectorId)) return { state, ok: false, status: "refused", code: "notFound", error: "No existe esa conexión de Google de la empresa." };
    let current = state;
    const synced: { kind: SyncKind; items: number }[] = [];
    for (const kind of CONNECTORS[connection.connectorId].syncKinds) {
      const dry = reduceConnectors(current, { ...system(input.tenantId, input.at), type: "sync.run", connectionId: connection.id, kind }, env);
      if (dry.error) { if (dry.errorCode === "permissionOff") continue; return { state, ok: false, status: "refused", ...(dry.errorCode ? { code: dry.errorCode } : {}), error: dry.error }; }
      try {
        const probe = await this.probe(connection.connectorId, connection.tokenRef);
        synced.push({ kind, items: probe.items });
        current = dry.state;
        this.touch(connection, (row) => ({ ...row, lastSyncAt: input.at, ...(probe.last ? (connection.connectorId === "gmail" ? { lastEmail: probe.last } : connection.connectorId === "googleCalendar" ? { lastEvent: probe.last } : { lastFile: probe.last }) : {}) }));
        this.note(connection, "ok");
      } catch (error) {
        const kindOfError = errorKindOf(error);
        this.note(connection, "failed", kindOfError);
        return { state: current, ok: false, status: "failed", code: kindOfError, error: error instanceof GoogleApiError ? error.message : "Google no pudo sincronizar.", result: { synced } };
      }
    }
    return { state: current, ok: true, status: "done", result: { synced } };
  }
  private async probe(connectorId: GoogleConnectorId, tokenRef: string): Promise<{ items: number; last?: Seen }> {
    if (connectorId === "gmail") {
      const found = await gmail.searchMessages(this.deps, tokenRef, { query: "", maxResults: 10 });
      const newest = found.messages[0];
      if (!newest) return { items: 0 };
      const message = await gmail.readMessage(this.deps, tokenRef, { id: newest.id });
      return { items: found.messages.length, last: { id: newest.id, at: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : "" } };
    }
    if (connectorId === "googleCalendar") {
      const list = await googleRequest<{ items?: calendar.CalendarEvent[] }>(this.deps, tokenRef, { url: `${GOOGLE_ENDPOINTS.calendar}/calendars/primary/events`, query: { orderBy: "updated", singleEvents: false, maxResults: 10 } });
      const newest = list.items?.at(-1);
      return { items: list.items?.length ?? 0, ...(newest ? { last: { id: newest.id, at: newest.updated ?? "" } } : {}) };
    }
    const files = await drive.searchFiles(this.deps, tokenRef, { pageSize: 10 });
    const newest = files.files[0];
    return { items: files.files.length, ...(newest ? { last: { id: newest.id, at: newest.modifiedTime ?? "" } } : {}) };
  }

  /** Renews, ahead of time, the access of every Google connection that is within the renewal window. A revocation by Google is kept as "needs authorization" (the tokens are already deleted). */
  async renewDue(state: ConnectorsState, env: ConnectorEnv, at: string, tenantId?: string): Promise<{ state: ConnectorsState; renewed: string[]; failed: { connectionId: string; kind: GoogleErrorKind }[] }> {
    let current = state;
    const renewed: string[] = [];
    const failed: { connectionId: string; kind: GoogleErrorKind }[] = [];
    for (const connection of state.connections.filter((row) => isGoogle(row.connectorId) && (!tenantId || row.tenantId === tenantId) && row.tokenRef && tokenDue(row, at))) {
      try {
        await refreshAccessToken(this.deps, connection.tokenRef as string);
        const result = reduceConnectors(current, { ...system(connection.tenantId, at), type: "token.refresh", connectionId: connection.id }, env);
        if (!result.error) current = result.state;
        renewed.push(connection.id);
        this.note(connection, "ok");
      } catch (error) {
        const kind = errorKindOf(error);
        failed.push({ connectionId: connection.id, kind });
        this.note(connection, "failed", kind);
      }
    }
    return { state: current, renewed, failed };
  }
  /** Whether this connection can still get an access token right now (a quick check the dashboard can use without calling Google). */
  async hasValidAccess(tokenRef: string): Promise<boolean> { try { await accessToken(this.deps, tokenRef); return true; } catch { return false; } }
}
export type { ConnectorsEvent };
