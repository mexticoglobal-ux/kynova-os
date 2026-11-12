/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateEncryptionKey } from "@/lib/backend/crypto";
import type { Entity } from "@/lib/backend/entities";
import { createBackendCore } from "@/lib/backend/index";
import { Connector, newStats, verifyCoverage, type Bridge } from "@/lib/backend/integration";
import { auditPolicies } from "@/lib/backend/rls";
import { MemorySecretsProvider, SecretsManager, looksLikeSecret } from "@/lib/backend/secrets";
import { reduceCrm, newCrmState } from "./crm-center";
import {
  ADAPTERS, CONNECTORS, CONNECTOR_IDS, CONNECTOR_SECRET_NAMES, CONNECTOR_TABLES, FAMILY_SECRETS, HEALTH_GROUPS, PROVIDER_FAMILIES, SYNC_KINDS, applyConnectorsEvents, configuredFamilies, connectedApps,
  connectorHealth, connectorHealthChecks, displayStatus, isSecureRedirect, missingSecretNames, newConnectorsState, reduceConnectors, tokenDue,
  type ConnectorEnv, type ConnectorId, type ConnectorsEvent, type ConnectorsState,
} from "./connectors";

const T1 = "tenant-nova";
const T2 = "tenant-vida";
const t0 = Date.parse("2026-11-12T10:00:00.000Z");
const at = (minutes = 0) => new Date(t0 + minutes * 60_000).toISOString();
const ALL: ConnectorEnv = { configuredFamilies: [...PROVIDER_FAMILIES], workers: [{ tenantId: T1, id: "sales", status: "active" }, { tenantId: T1, id: "followup", status: "paused" }, { tenantId: T2, id: "sales", status: "active" }] };
let counter = 0;
const nonce = () => `state-${String(++counter).padStart(10, "0")}-abcdef`;
const challenge = () => `challenge-${String(counter).padStart(10, "0")}-abcdefghijklmnopqrstuvwxyz`.padEnd(43, "x");
const send = (state: ConnectorsState, event: ConnectorsEvent, env: ConnectorEnv = ALL) => { const result = reduceConnectors(state, event, env); expect(result.error, result.error).toBeUndefined(); return result; };
const refused = (state: ConnectorsState, event: ConnectorsEvent, env: ConnectorEnv = ALL): string => { const result = reduceConnectors(state, event, env); expect(result.error, `${event.type} should be refused`).toBeDefined(); expect(result.state).toBe(state); return result.errorCode ?? ""; };
const enabled = (tenantId = T1, owner = "ana") => send(newConnectorsState(), { tenantId, actor: owner, at: at(), type: "tenant.enable" }).state;
const readScopes = (id: ConnectorId) => CONNECTORS[id].scopes.filter((item) => item.effect === "read").map((item) => item.id);

/** Starts and finishes the whole authorization, the way the provider's callback would, and returns the connection. */
function connect(state: ConnectorsState, id: ConnectorId, over: { tenantId?: string; actor?: string; account?: string; scopes?: string[]; minute?: number } = {}) {
  const tenantId = over.tenantId ?? T1;
  const actor = over.actor ?? "ana";
  const minute = over.minute ?? 1;
  const code = nonce();
  const scopes = over.scopes ?? readScopes(id);
  const started = send(state, { tenantId, actor, at: at(minute), type: "connect.start", connectorId: id, scopes, redirectUri: "https://kynova.example/oauth/callback", state: code, codeChallenge: challenge() });
  const done = send(started.state, { tenantId, actor: "system", at: at(minute + 1), type: "oauth.callback", connectorId: id, state: code, code: "provider-code", accountId: over.account ?? `${id}-${tenantId}`, accountLabel: `${tenantId}@${id}.test`, grantedScopes: scopes });
  return { state: done.state, connection: done.connection!, authorization: started.authorization! };
}
const grantRead = (state: ConnectorsState, connectionId: string, id: ConnectorId, tenantId = T1, actor = "ana") =>
  readScopes(id).reduce((current, scope) => send(current, { tenantId, actor, at: at(5), type: "permissions.set", connectionId, scope, grant: "auto" }).state, state);

describe("the catalog: twelve connectors, one interface", () => {
  it("declares Gmail, Outlook, Google and Microsoft Calendar, Drive, OneDrive, WhatsApp, Facebook, Instagram, LinkedIn, YouTube and TikTok", () => {
    expect([...CONNECTOR_IDS].sort()).toEqual(["facebook", "gmail", "googleCalendar", "googleDrive", "instagram", "linkedin", "msCalendar", "onedrive", "outlook", "tiktok", "whatsapp", "youtube"]);
    expect(CONNECTOR_IDS.map((id) => CONNECTORS[id].label)).toEqual(["Gmail", "Outlook", "Google Calendar", "Microsoft Calendar", "Google Drive", "OneDrive", "WhatsApp Business", "Facebook Pages", "Instagram Business", "LinkedIn Company", "YouTube", "TikTok Business"]);
  });
  it("gives every connector a provider, OAuth endpoint, scopes (reading and writing), sync kinds and what to verify", () => {
    for (const id of CONNECTOR_IDS) {
      const item = CONNECTORS[id];
      expect(item.provider.length, id).toBeGreaterThan(2);
      expect(item.authorizeUrl, id).toMatch(/^https:\/\//);
      expect(item.scopes.some((scope) => scope.effect === "read"), id).toBe(true);
      expect(item.scopes.some((scope) => scope.effect === "write"), id).toBe(true);
      expect(item.syncKinds.length, id).toBeGreaterThan(0);
      expect(item.toVerify.length, id).toBeGreaterThan(1);
      expect(PROVIDER_FAMILIES, id).toContain(item.family);
      expect(HEALTH_GROUPS, id).toContain(item.group);
    }
  });
  it("syncs emails, events, files, messages, videos, posts, leads and comments, each through the connectors that have them", () => {
    const covered = new Set(CONNECTOR_IDS.flatMap((id) => CONNECTORS[id].syncKinds));
    expect([...covered].sort()).toEqual([...SYNC_KINDS].sort());
    expect(CONNECTORS.gmail.syncKinds).toEqual(["emails"]);
    expect(CONNECTORS.googleCalendar.syncKinds).toEqual(["events"]);
    expect(CONNECTORS.youtube.syncKinds).toEqual(["videos", "comments"]);
    expect(CONNECTORS.whatsapp.syncKinds).toEqual(["messages", "leads"]);
  });
  it("runs every adapter through the same interface, and every adapter is simulated: none connects", async () => {
    expect(ADAPTERS.map((item) => item.id)).toEqual([...CONNECTOR_IDS]);
    for (const adapter of ADAPTERS) {
      expect(adapter.connected, adapter.id).toBe(false);
      for (const method of ["exchangeCode", "refreshToken", "revoke", "sync", "perform"] as const) expect(typeof adapter[method], `${adapter.id}.${method}`).toBe("function");
      expect(await adapter.sync({ tokenRef: "secret:oauth-cn_0001", kind: "emails" })).toEqual({ ok: false, kind: "notConnected" });
      expect(await adapter.exchangeCode({ code: "x", codeVerifier: "y", redirectUri: "https://kynova.example/cb" })).toEqual({ ok: false, kind: "notConnected" });
    }
  });
  it("maps the platform's connection states to the four a person sees", () => {
    expect([displayStatus("active"), displayStatus("notConnected"), displayStatus("pending"), displayStatus("error"), displayStatus("degraded"), displayStatus("revoked")]).toEqual(["Connected", "Disconnected", "Pending Authorization", "Error", "Error", "Disconnected"]);
  });
});

describe("OAuth is prepared, and nothing is typed by hand", () => {
  it("starts the authorization with a code challenge, a single-use state and the provider's own scope names, and gives back no credential", () => {
    const { authorization, connection } = connect(enabled(), "gmail");
    expect(connection.status).toBe("active");
    const started = send(enabled(), { tenantId: T1, actor: "ana", at: at(1), type: "connect.start", connectorId: "gmail", scopes: ["readMail", "sendMail"], redirectUri: "https://kynova.example/oauth/callback", state: nonce(), codeChallenge: challenge() });
    expect(started.authorization).toMatchObject({ baseUrl: "https://accounts.google.com/o/oauth2/v2/auth", clientIdSecret: "GOOGLE_CLIENT_ID" });
    expect(started.authorization!.params).toMatchObject({ response_type: "code", code_challenge_method: "S256", access_type: "offline", scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send" });
    expect(started.authorization!.params).not.toHaveProperty("client_id");
    expect(started.authorization!.params).not.toHaveProperty("client_secret");
    expect(authorization.params["scope"]).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(started.connection).toMatchObject({ status: "pending", requestedScopes: ["readMail", "sendMail"] });
  });
  it("uses each provider's own endpoint and refuses weak state, weak challenge, insecure redirects and unknown scopes", () => {
    const state = enabled();
    const base = { tenantId: T1, actor: "ana", at: at(1), type: "connect.start" as const, connectorId: "outlook", scopes: ["readMail"], redirectUri: "https://kynova.example/cb", state: nonce(), codeChallenge: challenge() };
    expect(send(state, base).authorization!.baseUrl).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(refused(state, { ...base, state: "corta" })).toBe("weakState");
    expect(refused(state, { ...base, codeChallenge: "corto" })).toBe("weakState");
    expect(refused(state, { ...base, redirectUri: "http://evil.example/cb" })).toBe("insecureRedirect");
    expect(refused(state, { ...base, redirectUri: "https://kynova.example/cb?token=abc" })).toBe("insecureRedirect");
    expect(refused(state, { ...base, redirectUri: "https://user:pass@kynova.example/cb" })).toBe("insecureRedirect");
    expect(refused(state, { ...base, scopes: ["deleteEverything"] })).toBe("invalid");
    expect(refused(state, { ...base, scopes: [] })).toBe("invalid");
    expect(refused(state, { ...base, connectorId: "fax" })).toBe("invalid");
    expect(isSecureRedirect("http://localhost:3000/cb")).toBe(true);
    expect(isSecureRedirect("https://kynova.example/oauth")).toBe(true);
  });
  it("finishes only with the same state, for the same company, once, and inside ten minutes", () => {
    const state = enabled();
    const code = nonce();
    const started = send(state, { tenantId: T1, actor: "ana", at: at(1), type: "connect.start", connectorId: "gmail", scopes: ["readMail"], redirectUri: "https://kynova.example/cb", state: code, codeChallenge: challenge() }).state;
    const callback = (over: Partial<Extract<ConnectorsEvent, { type: "oauth.callback" }>> = {}): ConnectorsEvent => ({ tenantId: T1, actor: "system", at: at(2), type: "oauth.callback", connectorId: "gmail", state: code, code: "c", accountId: "acc-1", grantedScopes: ["readMail"], ...over });
    expect(refused(started, callback({ state: "otro-estado-distinto-1234" }))).toBe("stateMismatch");
    expect(refused(started, callback({ tenantId: T2 }))).toBe("notEnabled");
    const other = send(started, { tenantId: T2, actor: "luis", at: at(), type: "tenant.enable" }).state;
    expect(refused(other, callback({ tenantId: T2 }))).toBe("stateMismatch"); // a state belongs to the company that started it
    expect(refused(started, callback({ connectorId: "outlook" }))).toBe("stateMismatch");
    const done = send(started, callback()).state;
    expect(refused(done, callback())).toBe("stateMismatch"); // single use
    const late = reduceConnectors(started, callback({ at: at(1 + 11) }));
    expect(late.errorCode).toBe("flowExpired");
    expect(late.state.connections[0]).toMatchObject({ status: "error" });
    expect(late.state.connections[0]!.flow).toBeUndefined();
  });
  it("records a denied authorization as an error the person can retry", () => {
    const state = enabled();
    const code = nonce();
    const started = send(state, { tenantId: T1, actor: "ana", at: at(1), type: "connect.start", connectorId: "tiktok", scopes: ["readAccount"], redirectUri: "https://kynova.example/cb", state: code, codeChallenge: challenge() }).state;
    const denied = send(started, { tenantId: T1, actor: "system", at: at(2), type: "oauth.callback", connectorId: "tiktok", state: code, error: "access_denied" });
    expect(denied.connection).toMatchObject({ status: "error", lastError: { kind: "auth", retryable: false } });
    expect(displayStatus(denied.connection!.status)).toBe("Error");
    expect(connect(denied.state, "tiktok", { minute: 10 }).connection.status).toBe("active");
  });
  it("accepts only the scopes that were asked for, and none of the tokens or secrets ever appear in the state", () => {
    const state = enabled();
    const code = nonce();
    const started = send(state, { tenantId: T1, actor: "ana", at: at(1), type: "connect.start", connectorId: "gmail", scopes: ["readMail"], redirectUri: "https://kynova.example/cb", state: code, codeChallenge: challenge() }).state;
    expect(refused(started, { tenantId: T1, actor: "system", at: at(2), type: "oauth.callback", connectorId: "gmail", state: code, code: "c", accountId: "a", grantedScopes: ["sendMail"] })).toBe("invalid");
    expect(refused(started, { tenantId: T1, actor: "system", at: at(2), type: "oauth.callback", connectorId: "gmail", state: code, code: "c" })).toBe("invalid");
    const { state: done, connection } = connect(enabled(), "gmail");
    expect(connection.tokenRef).toMatch(/^secret:[a-z0-9][a-z0-9-_]{1,62}$/);
    const dump = JSON.stringify(done);
    expect(looksLikeSecret(dump)).toBe(false);
    expect(dump).not.toMatch(/access_token|refresh_token|client_secret|"code":"provider-code"|codeVerifier/i);
  });
});

describe("the app's credentials come from the Secrets Manager", () => {
  const fake = (name: string) => `${name.toLowerCase()}-${"k".repeat(24)}`;
  const manager = (names: readonly string[]) => new SecretsManager(new MemorySecretsProvider(Object.fromEntries(names.map((name) => [name, fake(name)]))));
  it("needs both halves of a family's app credentials, and reads names only: the values never reach the module", () => {
    expect(CONNECTOR_SECRET_NAMES).toHaveLength(10);
    expect(FAMILY_SECRETS.google).toEqual({ clientId: "GOOGLE_CLIENT_ID", clientSecret: "GOOGLE_CLIENT_SECRET" });
    const secrets = manager([FAMILY_SECRETS.google.clientId, FAMILY_SECRETS.google.clientSecret, FAMILY_SECRETS.meta.clientId]);
    expect(configuredFamilies(secrets)).toEqual(["google"]);
    expect(missingSecretNames(secrets)).not.toContain("GOOGLE_CLIENT_SECRET");
    expect(missingSecretNames(secrets)).toContain("META_APP_SECRET");
    expect(secrets.accessLog()).toEqual([]);
    expect(configuredFamilies(manager(CONNECTOR_SECRET_NAMES))).toEqual([...PROVIDER_FAMILIES]);
    expect(configuredFamilies(manager([]))).toEqual([]);
  });
  it("refuses to start an authorization for a provider KYNOVA has no app credentials for, and says which kind of secret is missing", () => {
    const env: ConnectorEnv = { configuredFamilies: configuredFamilies(manager([FAMILY_SECRETS.google.clientId, FAMILY_SECRETS.google.clientSecret])), workers: [] };
    const state = enabled();
    const start = (id: string): ConnectorsEvent => ({ tenantId: T1, actor: "ana", at: at(1), type: "connect.start", connectorId: id, scopes: ["readMail"], redirectUri: "https://kynova.example/cb", state: nonce(), codeChallenge: challenge() });
    expect(reduceConnectors(state, start("gmail"), env).error).toBeUndefined();
    const result = reduceConnectors(state, start("outlook"), env);
    expect(result.errorCode).toBe("notConfigured");
    expect(result.error).toMatch(/Wrangler/);
    expect(JSON.stringify(result)).not.toContain(fake("GOOGLE_CLIENT_ID"));
  });
  it("keeps the secrets' values out of every state and of the Connected Apps view", () => {
    const secrets = manager(CONNECTOR_SECRET_NAMES);
    const env: ConnectorEnv = { configuredFamilies: configuredFamilies(secrets), workers: [] };
    const { state } = connect(enabled(), "gmail");
    const view = JSON.stringify([connectedApps(state, T1, env, at(3)), connectorHealth(state, env), state]);
    for (const name of CONNECTOR_SECRET_NAMES) { expect(view).not.toContain(fake(name)); expect(view).not.toContain(name.toLowerCase()); }
    expect(secrets.accessLog()).toEqual([]);
  });
});

describe("connecting, disconnecting and the company that owns each account", () => {
  it("needs the company to enable the apps, and only its owner or an administrator to connect", () => {
    const start = (actor: string, tenantId = T1): ConnectorsEvent => ({ tenantId, actor, at: at(1), type: "connect.start", connectorId: "gmail", scopes: ["readMail"], redirectUri: "https://kynova.example/cb", state: nonce(), codeChallenge: challenge() });
    expect(refused(newConnectorsState(), start("ana"))).toBe("notEnabled");
    const state = enabled();
    expect(refused(state, start("intruso"))).toBe("forbidden");
    expect(refused(state, start("worker:nex"))).toBe("personRequired");
    expect(refused(state, start("system"))).toBe("personRequired");
    expect(refused(state, { tenantId: T1, actor: "ana", at: at(), type: "tenant.enable" })).toBe("alreadyEnabled");
    expect(refused(state, { tenantId: T1, actor: "otro", at: at(), type: "tenant.admin", userId: "pablo", enabled: true })).toBe("forbidden");
    const withAdmin = send(state, { tenantId: T1, actor: "ana", at: at(), type: "tenant.admin", userId: "pablo", enabled: true }).state;
    expect(reduceConnectors(withAdmin, start("pablo"), ALL).error).toBeUndefined();
  });
  it("walks Disconnected → Pending Authorization → Connected → Disconnected, with its history", () => {
    const state = enabled();
    expect(connectedApps(state, T1, ALL).find((row) => row.connectorId === "gmail")!.display).toBe("Disconnected");
    const started = send(state, { tenantId: T1, actor: "ana", at: at(1), type: "connect.start", connectorId: "gmail", scopes: ["readMail"], redirectUri: "https://kynova.example/cb", state: nonce(), codeChallenge: challenge() });
    expect(displayStatus(started.connection!.status)).toBe("Pending Authorization");
    expect(refused(started.state, { tenantId: T1, actor: "ana", at: at(1), type: "connect.start", connectorId: "gmail", scopes: ["readMail"], redirectUri: "https://kynova.example/cb", state: nonce(), codeChallenge: challenge() })).toBe("alreadyConnected");
    const { state: live, connection } = connect(state, "gmail");
    expect(displayStatus(connection.status)).toBe("Connected");
    const off = send(live, { tenantId: T1, actor: "ana", at: at(20), type: "connection.disconnect", connectionId: connection.id });
    expect(off.connection).toMatchObject({ status: "notConnected", grantedScopes: [], grants: {} });
    expect(off.connection!.tokenRef).toBeUndefined();
    expect(off.connection!.accountId).toBeUndefined();
    expect(off.connection!.history.map((item) => item.status)).toEqual(["pending", "active", "revoked", "notConnected"]);
    expect(off.state.audit.at(-1)!.detail).toContain(`revoke:${connection.tokenRef}`);
    expect(refused(off.state, { tenantId: T1, actor: "ana", at: at(21), type: "connection.disconnect", connectionId: connection.id })).toBe("invalidTransition");
    expect(refused(live, { tenantId: T1, actor: "intruso", at: at(21), type: "connection.disconnect", connectionId: connection.id })).toBe("forbidden");
    expect(connect(off.state, "gmail", { minute: 30 }).connection).toMatchObject({ id: connection.id, status: "active" });
  });
  it("lets each company authorize only its own accounts: an external account belongs to one company at a time", () => {
    let state = enabled(T1, "ana");
    state = send(state, { tenantId: T2, actor: "luis", at: at(), type: "tenant.enable" }).state;
    const first = connect(state, "gmail", { tenantId: T1, account: "shared-account" });
    const code = nonce();
    const started = send(first.state, { tenantId: T2, actor: "luis", at: at(3), type: "connect.start", connectorId: "gmail", scopes: ["readMail"], redirectUri: "https://kynova.example/cb", state: code, codeChallenge: challenge() }).state;
    expect(refused(started, { tenantId: T2, actor: "system", at: at(4), type: "oauth.callback", connectorId: "gmail", state: code, code: "c", accountId: "shared-account", grantedScopes: ["readMail"] })).toBe("accountInUse");
    const released = send(started, { tenantId: T1, actor: "ana", at: at(5), type: "connection.disconnect", connectionId: first.connection.id }).state;
    expect(reduceConnectors(released, { tenantId: T2, actor: "system", at: at(6), type: "oauth.callback", connectorId: "gmail", state: code, code: "c", accountId: "shared-account", grantedScopes: ["readMail"] }, ALL).error).toBeUndefined();
  });
});

describe("renewal and errors", () => {
  it("renews the access before it expires, and says who is due", () => {
    const { state, connection } = connect(enabled(), "gmail");
    expect(tokenDue(connection, at(5))).toBe(false);
    expect(tokenDue(connection, at(55))).toBe(true);
    const renewed = send(state, { tenantId: T1, actor: "system", at: at(55), type: "token.refresh", connectionId: connection.id });
    expect(renewed.connection).toMatchObject({ renewedAt: at(55), expiresAt: at(55 + 60) });
    expect(tokenDue(renewed.connection!, at(56))).toBe(false);
    expect(refused(state, { tenantId: T1, actor: "worker:nex", at: at(55), type: "token.refresh", connectionId: connection.id })).toBe("personRequired");
  });
  it("fails a sync on an expired access as retryable, and recovers once it is renewed", () => {
    const { state, connection } = connect(enabled(), "gmail");
    const live = grantRead(state, connection.id, "gmail");
    const late = send(live, { tenantId: T1, actor: "system", at: at(130), type: "sync.run", connectionId: connection.id, kind: "emails" });
    expect(late.sync).toMatchObject({ outcome: "failed", error: "auth" });
    expect(late.connection).toMatchObject({ status: "degraded", lastError: { retryable: true } });
    const renewed = send(late.state, { tenantId: T1, actor: "system", at: at(131), type: "token.refresh", connectionId: connection.id });
    const healed = send(renewed.state, { tenantId: T1, actor: "system", at: at(132), type: "sync.run", connectionId: connection.id, kind: "emails" });
    expect(healed.sync!.outcome).toBe("ok");
    expect(healed.connection).toMatchObject({ status: "active", consecutiveFailures: 0 });
    expect(healed.connection!.lastError).toBeUndefined();
  });
  it("turns a revoked grant into an error that needs the person to authorize again, and drops the token reference", () => {
    const { state, connection } = connect(enabled(), "gmail");
    const revoked = send(state, { tenantId: "tenant-nova", actor: "system", at: at(10), type: "provider.incident", group: "google", mode: "authRevoked" });
    const refreshed = send(revoked.state, { tenantId: T1, actor: "system", at: at(11), type: "token.refresh", connectionId: connection.id });
    expect(refreshed.connection).toMatchObject({ status: "error", lastError: { kind: "auth", retryable: false } });
    expect(refreshed.connection!.tokenRef).toBeUndefined();
    const again = send(refreshed.state, { tenantId: T1, actor: "system", at: at(12), type: "provider.recover", group: "google" }).state;
    expect(connect(again, "gmail", { minute: 20 }).connection.status).toBe("active");
  });
  it("degrades on a provider failure, goes to error after three, and recovers when the provider does", () => {
    const { state, connection } = connect(enabled(), "youtube");
    let current = grantRead(state, connection.id, "youtube");
    current = send(current, { tenantId: T1, actor: "system", at: at(10), type: "provider.incident", group: "youtube", mode: "rateLimited" }).state;
    const sync = (minute: number) => send(current, { tenantId: T1, actor: "system", at: at(minute), type: "sync.run", connectionId: connection.id, kind: "videos" });
    let result = sync(11);
    expect(result.connection).toMatchObject({ status: "degraded", consecutiveFailures: 1 });
    current = result.state;
    result = sync(12); current = result.state;
    result = sync(13); current = result.state;
    expect(result.connection).toMatchObject({ status: "error", consecutiveFailures: 3 });
    expect(displayStatus(result.connection!.status)).toBe("Error");
    current = send(current, { tenantId: T1, actor: "system", at: at(14), type: "provider.recover", group: "youtube" }).state;
    const back = connect(current, "youtube", { minute: 20, account: "youtube-new" });
    expect(back.connection.status).toBe("active");
  });
  it("lets only the system declare or end a provider incident", () => {
    const state = enabled();
    expect(refused(state, { tenantId: T1, actor: "ana", at: at(), type: "provider.incident", group: "google", mode: "down" })).toBe("forbidden");
    expect(refused(state, { tenantId: T1, actor: "system", at: at(), type: "provider.incident", group: "nope", mode: "down" })).toBe("invalid");
    expect(refused(state, { tenantId: T1, actor: "system", at: at(), type: "provider.incident", group: "google", mode: "explosion" })).toBe("invalid");
    expect(refused(state, { tenantId: T1, actor: "ana", at: at(), type: "provider.recover", group: "google" })).toBe("forbidden");
  });
});

describe("permissions", () => {
  it("starts everything off, and grants only what the provider granted, never writing on its own", () => {
    const { state, connection } = connect(enabled(), "gmail", { scopes: ["readMail", "sendMail"] });
    expect(connection.grants).toEqual({ readMail: "off", sendMail: "off" });
    expect(connectedApps(state, T1, ALL).find((row) => row.connectorId === "gmail")!.permissions).toEqual([
      { scope: "readMail", label: "Leer correos", effect: "read", grant: "off" }, { scope: "sendMail", label: "Enviar correos", effect: "write", grant: "off" },
    ]);
    const set = (scope: string, grant: "off" | "approval" | "auto", actor = "ana"): ConnectorsEvent => ({ tenantId: T1, actor, at: at(5), type: "permissions.set", connectionId: connection.id, scope, grant });
    expect(refused(state, set("sendMail", "auto"))).toBe("grantNotAllowed");
    expect(refused(state, set("readMail", "approval"))).toBe("grantNotAllowed");
    expect(refused(state, set("deleteMail", "off"))).toBe("scopeNotGranted");
    expect(refused(state, set("readMail", "auto", "intruso"))).toBe("forbidden");
    expect(refused(state, set("readMail", "auto", "worker:nex"))).toBe("personRequired");
    const granted = send(state, set("sendMail", "approval")).state;
    expect(granted.connections[0]!.grants["sendMail"]).toBe("approval");
    const narrow = connect(enabled(), "gmail", { scopes: ["readMail"], minute: 2 });
    expect(refused(narrow.state, { tenantId: T1, actor: "ana", at: at(5), type: "permissions.set", connectionId: narrow.connection.id, scope: "sendMail", grant: "approval" })).toBe("scopeNotGranted");
  });
  it("refuses to sync without a read permission, an unsupported kind, or a connection that is not connected", () => {
    const { state, connection } = connect(enabled(), "gmail");
    const sync = (kind: string, id = connection.id): ConnectorsEvent => ({ tenantId: T1, actor: "system", at: at(6), type: "sync.run", connectionId: id, kind });
    expect(refused(state, sync("emails"))).toBe("permissionOff");
    const live = grantRead(state, connection.id, "gmail");
    expect(refused(live, sync("videos"))).toBe("unsupported");
    expect(refused(live, sync("nada"))).toBe("unsupported");
    expect(refused(live, sync("emails", "cn_9999"))).toBe("notFound");
    const off = send(live, { tenantId: T1, actor: "ana", at: at(7), type: "connection.disconnect", connectionId: connection.id }).state;
    expect(refused(off, sync("emails"))).toBe("notActive");
  });
});

describe("sync of emails, events, files, messages, videos, posts, leads and comments", () => {
  it("syncs every kind of every connector, moving a cursor and counting items, and never storing content", () => {
    let state = enabled();
    for (const id of CONNECTOR_IDS) {
      const connected = connect(state, id, { minute: 2 });
      state = grantRead(connected.state, connected.connection.id, id);
      for (const kind of CONNECTORS[id].syncKinds) {
        const first = send(state, { tenantId: T1, actor: "system", at: at(10), type: "sync.run", connectionId: connected.connection.id, kind });
        expect(first.sync, `${id}:${kind}`).toMatchObject({ outcome: "ok", kind, connectorId: id });
        expect(first.sync!.items).toBeGreaterThan(0);
        const second = send(first.state, { tenantId: T1, actor: "system", at: at(11), type: "sync.run", connectionId: connected.connection.id, kind });
        expect(second.sync!.cursor, `${id}:${kind}`).not.toBe(first.sync!.cursor);
        expect(second.connection!.synced[kind], `${id}:${kind}`).toBe(first.sync!.items + second.sync!.items);
        expect(second.connection!.lastSyncAt).toBe(at(11));
        state = second.state;
      }
    }
    expect(state.syncs.length).toBe(CONNECTOR_IDS.reduce((total, id) => total + CONNECTORS[id].syncKinds.length * 2, 0));
    expect(JSON.stringify(state.syncs)).not.toMatch(/subject|body|text|content|@/i);
    expect(connectedApps(state, T1, ALL).every((row) => row.lastSyncAt === at(11))).toBe(true);
  });
});

describe("AI agents never talk to a provider: Agent → Worker → Connector → Provider", () => {
  function world() {
    const { state, connection } = connect(enabled(), "gmail", { scopes: ["readMail", "sendMail"] });
    let current = send(state, { tenantId: T1, actor: "ana", at: at(5), type: "permissions.set", connectionId: connection.id, scope: "readMail", grant: "auto" }).state;
    current = send(current, { tenantId: T1, actor: "ana", at: at(5), type: "permissions.set", connectionId: connection.id, scope: "sendMail", grant: "approval" }).state;
    return { state: current, connection };
  }
  const request = (connectionId: string, actor: string, over: Partial<Extract<ConnectorsEvent, { type: "action.request" }>> = {}): ConnectorsEvent => ({ tenantId: T1, actor, at: at(8), type: "action.request", connectionId, workerId: actor.replace("worker:", ""), scope: "readMail", operation: "listUnread", summary: "Listar correos sin leer", ...over });
  it("takes a request only from a Worker of the company: an agent, a person or the system cannot ask the connector directly", () => {
    const { state, connection } = world();
    expect(refused(state, request(connection.id, "agent:comercial", { workerId: "comercial" }))).toBe("workerRequired");
    expect(refused(state, request(connection.id, "ana", { workerId: "ana" }))).toBe("workerRequired");
    expect(refused(state, request(connection.id, "system", { workerId: "system" }))).toBe("workerRequired");
    expect(refused(state, request(connection.id, "worker:sales", { workerId: "followup" }))).toBe("workerRequired");
    expect(refused(state, request(connection.id, "worker:followup"))).toBe("workerInactive");
    expect(refused(state, request(connection.id, "worker:inventado"))).toBe("workerInactive");
    expect(refused(state, { ...request(connection.id, "worker:sales"), tenantId: T2 })).toBe("notEnabled");
  });
  it("lets a Worker read with an automatic permission, and nothing else without one", () => {
    const { state, connection } = world();
    const read = send(state, request(connection.id, "worker:sales"));
    expect(read.action).toMatchObject({ status: "done", workerId: "sales", scope: "readMail", connectorId: "gmail" });
    const off = send(state, { tenantId: T1, actor: "ana", at: at(9), type: "permissions.set", connectionId: connection.id, scope: "readMail", grant: "off" }).state;
    expect(refused(off, request(connection.id, "worker:sales"))).toBe("permissionOff");
    expect(refused(state, request(connection.id, "worker:sales", { scope: "deleteMail" }))).toBe("scopeNotGranted");
  });
  it("holds everything that leaves the platform for a person: it never runs on its own, and a Worker cannot approve it", () => {
    const { state, connection } = world();
    const asked = send(state, request(connection.id, "worker:sales", { scope: "sendMail", operation: "sendDraft", summary: "Enviar el borrador aprobado" }));
    expect(asked.action!.status).toBe("awaitingApproval");
    expect(refused(asked.state, { tenantId: T1, actor: "worker:sales", at: at(9), type: "action.approve", actionId: asked.action!.id })).toBe("personRequired");
    expect(refused(asked.state, { tenantId: T1, actor: "intruso", at: at(9), type: "action.approve", actionId: asked.action!.id })).toBe("forbidden");
    const approved = send(asked.state, { tenantId: T1, actor: "ana", at: at(9), type: "action.approve", actionId: asked.action!.id });
    expect(approved.action).toMatchObject({ status: "done", decidedBy: "ana" });
    expect(refused(approved.state, { tenantId: T1, actor: "ana", at: at(10), type: "action.approve", actionId: asked.action!.id })).toBe("invalidTransition");
    const second = send(approved.state, request(connection.id, "worker:sales", { scope: "sendMail", operation: "sendDraft", summary: "Otro envío" }));
    const rejected = send(second.state, { tenantId: T1, actor: "ana", at: at(11), type: "action.reject", actionId: second.action!.id, reason: "no corresponde" });
    expect(rejected.action).toMatchObject({ status: "rejected", failure: "no corresponde" });
  });
  it("fails an approved action when the provider is down, and keeps another company's actions out of reach", () => {
    const { state, connection } = world();
    const asked = send(state, request(connection.id, "worker:sales", { scope: "sendMail", operation: "sendDraft" }));
    const down = send(asked.state, { tenantId: T1, actor: "system", at: at(8), type: "provider.incident", group: "google", mode: "down" }).state;
    expect(send(down, { tenantId: T1, actor: "ana", at: at(9), type: "action.approve", actionId: asked.action!.id }).action!.status).toBe("failed");
    const other = send(asked.state, { tenantId: T2, actor: "luis", at: at(), type: "tenant.enable" }).state;
    expect(refused(other, { tenantId: T2, actor: "luis", at: at(9), type: "action.approve", actionId: asked.action!.id })).toBe("notFound");
    expect(refused(other, { ...request(connection.id, "worker:sales"), tenantId: T2 })).toBe("notFound");
  });
  it("keeps the chain visible: every request, approval and result is in the company's audit trail", () => {
    const { state, connection } = world();
    const asked = send(state, request(connection.id, "worker:sales", { scope: "sendMail", operation: "sendDraft" }));
    const done = send(asked.state, { tenantId: T1, actor: "ana", at: at(9), type: "action.approve", actionId: asked.action!.id }).state;
    expect(done.audit.slice(-2).map((item) => `${item.actor}:${item.action}`)).toEqual(["worker:sales:action.request", "ana:action.approve"]);
    expect(done.audit.every((item) => item.tenantId === T1)).toBe(true);
  });
});

describe("the Connected Apps view and the health", () => {
  it("shows for each app its name, provider, last sync, state, permissions and owning company, plus the buttons that apply", () => {
    const { state, connection } = connect(enabled(), "gmail");
    const live = grantRead(state, connection.id, "gmail");
    const synced = send(live, { tenantId: T1, actor: "system", at: at(9), type: "sync.run", connectionId: connection.id, kind: "emails" }).state;
    const rows = connectedApps(synced, T1, ALL, at(10));
    expect(rows).toHaveLength(12);
    expect(rows.find((row) => row.connectorId === "gmail")).toMatchObject({ label: "Gmail", provider: "Google", display: "Connected", lastSyncAt: at(9), tenantId: T1, canConnect: false, canDisconnect: true, accountLabel: `${T1}@gmail.test` });
    expect(rows.find((row) => row.connectorId === "outlook")).toMatchObject({ display: "Disconnected", canConnect: true, canDisconnect: false, permissions: [] });
    expect(connectedApps(synced, T1, { configuredFamilies: [], workers: [] }).every((row) => !row.canConnect)).toBe(true);
    expect(connectedApps(synced, T1, ALL, at(58)).find((row) => row.connectorId === "gmail")!.renewalDue).toBe(true);
  });
  it("reports the health of Google, Microsoft, Meta, YouTube, WhatsApp, LinkedIn, TikTok and Drive", () => {
    expect(connectorHealth(newConnectorsState(), ALL).map((row) => row.label)).toEqual(["Google", "Microsoft", "Meta", "YouTube", "WhatsApp", "LinkedIn", "TikTok", "Drive"]);
    expect(connectorHealth(newConnectorsState(), ALL).every((row) => row.status === "operational")).toBe(true);
    expect(connectorHealth(newConnectorsState()).every((row) => row.status === "notConfigured")).toBe(true);
    const google: ConnectorEnv = { configuredFamilies: ["google"], workers: [] };
    const partial = connectorHealth(newConnectorsState(), google).reduce<Record<string, string>>((all, row) => ({ ...all, [row.group]: row.status }), {});
    expect(partial).toMatchObject({ google: "operational", youtube: "operational", drive: "operational", microsoft: "notConfigured", meta: "notConfigured", whatsapp: "notConfigured" });
  });
  it("shows an outage as down, a limit or a revoked grant as degraded, and a company's connection errors as degraded", () => {
    let state = enabled();
    const group = (rows: ReturnType<typeof connectorHealth>, name: string) => rows.find((row) => row.group === name)!;
    state = send(state, { tenantId: T1, actor: "system", at: at(), type: "provider.incident", group: "meta", mode: "down" }).state;
    state = send(state, { tenantId: T1, actor: "system", at: at(), type: "provider.incident", group: "linkedin", mode: "rateLimited" }).state;
    const rows = connectorHealth(state, ALL);
    expect(group(rows, "meta")).toMatchObject({ status: "down", incident: "down" });
    expect(group(rows, "linkedin")).toMatchObject({ status: "degraded", incident: "rateLimited" });
    expect(group(rows, "google").status).toBe("operational");
    const { state: connected, connection } = connect(enabled(), "outlook");
    const live = grantRead(connected, connection.id, "outlook");
    const failed = send(send(live, { tenantId: T1, actor: "system", at: at(10), type: "provider.incident", group: "microsoft", mode: "down" }).state, { tenantId: T1, actor: "system", at: at(11), type: "sync.run", connectionId: connection.id, kind: "emails" }).state;
    const recovered = send(failed, { tenantId: T1, actor: "system", at: at(12), type: "provider.recover", group: "microsoft" }).state;
    expect(group(connectorHealth(recovered, ALL), "microsoft")).toMatchObject({ status: "degraded", errors: 1 });
    expect(group(connectorHealth(recovered, ALL, T2), "microsoft")).toMatchObject({ status: "operational", errors: 0 });
    expect(connectorHealthChecks(rows).find((item) => item.name === "connector_meta")).toMatchObject({ status: "down" });
    expect(connectorHealthChecks(rows).find((item) => item.name === "connector_google")).toMatchObject({ status: "up" });
  });
});

describe("every company stays apart, and every step is audited", () => {
  it("keeps two companies' connections, permissions, syncs and actions separate, and refuses what crosses", () => {
    let state = enabled(T1, "ana");
    state = send(state, { tenantId: T2, actor: "luis", at: at(), type: "tenant.enable" }).state;
    const a = connect(state, "gmail", { tenantId: T1, actor: "ana", account: "a@nova.test" });
    const b = connect(a.state, "gmail", { tenantId: T2, actor: "luis", account: "b@vida.test", minute: 4 });
    expect(a.connection.id).not.toBe(b.connection.id);
    expect(connectedApps(b.state, T1, ALL).find((row) => row.connectorId === "gmail")!.accountLabel).toBe(`${T1}@gmail.test`);
    expect(connectedApps(b.state, T2, ALL).find((row) => row.connectorId === "gmail")!.accountLabel).toBe(`${T2}@gmail.test`);
    expect(refused(b.state, { tenantId: T2, actor: "luis", at: at(8), type: "connection.disconnect", connectionId: a.connection.id })).toBe("notFound");
    expect(refused(b.state, { tenantId: T2, actor: "luis", at: at(8), type: "permissions.set", connectionId: a.connection.id, scope: "readMail", grant: "auto" })).toBe("notFound");
    expect(refused(b.state, { tenantId: T1, actor: "ana", at: at(8), type: "connection.disconnect", connectionId: b.connection.id })).toBe("notFound");
    expect(refused(b.state, { tenantId: T2, actor: "ana", at: at(8), type: "tenant.admin", userId: "x", enabled: true })).toBe("forbidden");
    expect(refused(b.state, { tenantId: "", actor: "ana", at: at(), type: "tenant.enable" })).toBe("tenantRequired");
    expect(b.state.audit.filter((item) => item.tenantId === T1).every((item) => !item.detail?.includes(b.connection.id))).toBe(true);
  });
  it("audits every accepted event once, with no content, and nothing for a refused one", () => {
    const { state } = connect(enabled(), "gmail");
    expect(state.audit.map((item) => item.action)).toEqual(["tenant.enable", "connect.start", "oauth.callback"]);
    expect(JSON.stringify(state.audit)).not.toMatch(/@|token|secret:/i);
    const bad = reduceConnectors(state, { tenantId: T1, actor: "intruso", at: at(9), type: "connection.disconnect", connectionId: "cn_0001" }, ALL);
    expect(bad.state.audit).toHaveLength(state.audit.length);
  });
  it("is deterministic", () => {
    const run = () => { const { state, connection } = connect(enabled(), "gmail"); return send(grantRead(state, connection.id, "gmail"), { tenantId: T1, actor: "system", at: at(10), type: "sync.run", connectionId: connection.id, kind: "emails" }).state; };
    const strip = (value: ConnectorsState) => JSON.stringify(value).replace(/state-\d+-abcdef|challenge-\d+-[a-z]+x*/g, "");
    expect(strip(run())).toBe(strip(run()));
    expect(applyConnectorsEvents(newConnectorsState(), []).errors).toEqual([]);
  });
});

describe("it goes through the Event Bus and respects the RLS design, without touching the Backend Core", () => {
  const bridge: Bridge<ConnectorsState, ConnectorsEvent, ReturnType<typeof reduceConnectors>> = {
    id: "connectors", label: "Connected Apps", modules: ["organizations"], reduce: (state, event) => reduceConnectors(state, event, ALL),
    streams: (state) => [{ name: "audit", module: "organizations", entries: state.audit }], tenantOf: (event) => event.tenantId, actorOf: (event) => event.actor, typeOf: (event) => event.type,
  };
  it("publishes every accepted step on the bus under its company and covers every audit record", async () => {
    let clock = Date.parse("2026-11-12T12:00:00.000Z");
    const core = createBackendCore({ vars: { KYNOVA_ENCRYPTION_KEY: generateEncryptionKey(), KYNOVA_HASH_PEPPER: "p".repeat(40) }, now: () => (clock += 7), clock: () => new Date((clock += 7)).toISOString() });
    const connector = new Connector(core, bridge, newStats());
    let state = newConnectorsState();
    const go = async (event: ConnectorsEvent) => { const result = await connector.reduce(state, event); state = result.state; return result; };
    await go({ tenantId: T1, actor: "ana", at: at(), type: "tenant.enable" });
    await go({ tenantId: T2, actor: "luis", at: at(), type: "tenant.enable" });
    const code = nonce();
    await go({ tenantId: T1, actor: "ana", at: at(1), type: "connect.start", connectorId: "gmail", scopes: ["readMail"], redirectUri: "https://kynova.example/cb", state: code, codeChallenge: challenge() });
    expect((await go({ tenantId: T1, actor: "worker:nex", at: at(2), type: "connect.start", connectorId: "outlook", scopes: ["readMail"], redirectUri: "https://kynova.example/cb", state: nonce(), codeChallenge: challenge() })).error).toBeDefined();
    await go({ tenantId: T1, actor: "system", at: at(3), type: "oauth.callback", connectorId: "gmail", state: code, code: "c", accountId: "a", grantedScopes: ["readMail"] });
    const events = (await core.events()).store.read({ tenantId: T1, after: 0, limit: 100 });
    expect(events.map((item) => item.payload["action"])).toEqual(["tenant.enable", "connect.start", "oauth.callback"]);
    expect(events.every((item) => item.tenantId === T1)).toBe(true);
    expect((await core.events()).store.read({ tenantId: T2, after: 0, limit: 100 })).toHaveLength(1);
    expect(await verifyCoverage(core, T1)).toMatchObject({ ok: true });
    expect(await verifyCoverage(core, T2)).toMatchObject({ ok: true });
  });
  it("describes five company tables whose policies filter by company, with syncs and the trail append-only and no token column", () => {
    const columns = ["id:uuid", "tenant_id:uuid", "created_at:timestamptz"].map((spec) => { const [name, type] = spec.split(":"); return { name: name!, type: type as "uuid", nullable: false, pii: false }; });
    const entities: Entity[] = CONNECTOR_TABLES.map((item) => ({ table: item.table, module: "organizations" as const, scope: "tenant" as const, status: "planned" as const, rls: "read" as const, appendOnly: item.appendOnly, columns, description: "connectors" }));
    expect(auditPolicies(entities)).toEqual([]);
    expect(CONNECTOR_TABLES.filter((item) => item.appendOnly).map((item) => item.table)).toEqual(["connector_syncs", "connector_audit"]);
  });
});

describe("it adds nothing to the architecture and connects nothing real", () => {
  const source = readFileSync(join(process.cwd(), "lib/contracts/platform/connectors.ts"), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  it("imports only platform contracts, makes no network call and reads no environment", () => {
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(imports.sort()).toEqual(["./actors", "./connection", "./integrations"]);
    expect(source).not.toMatch(/\bfetch\(|process\.env|XMLHttpRequest|WebSocket|node:https?|lib\/backend|supabase/);
    expect(source).not.toMatch(/export function reduce(?!Connectors)/);
  });
  it("does not touch another module's records", () => {
    expect(reduceCrm(newCrmState(), { tenantId: T1, actor: "ana", at: at(), type: "lead.create", input: { name: "Ana Prueba", company: "X", source: "Formulario web", estimatedValueMicros: 1, fit: 50 } }).state.leads).toHaveLength(1);
    expect(Object.keys(newConnectorsState()).sort()).toEqual(["actions", "audit", "connections", "incidents", "sequence", "syncs", "tenants"]);
  });
});
