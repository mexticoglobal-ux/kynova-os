/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, generateEncryptionKey } from "@/lib/backend/crypto";
import { MemorySecretsProvider, SecretsManager, looksLikeSecret } from "@/lib/backend/secrets";
import {
  CONNECTORS, FAMILY_SECRETS, configuredFamilies, newConnectorsState, reduceConnectors, type ConnectorEnv, type ConnectorsEvent, type ConnectorsState,
} from "@/lib/contracts/platform/connectors";
import { fakeGoogle } from "./fake-google";
import {
  EncryptedMemoryVault, GOOGLE_OPERATIONS, GOOGLE_OPERATION_IDS, GOOGLE_SCOPES, GoogleApiError, GoogleWorkspace, accessToken, authorizableOperations, base64, calendar, drive, gmail, healthScore, minimalScopeIds,
  refreshAccessToken, workspaceView, utf8, type GoogleDeps,
} from "./index";

const T1 = "tenant-nova";
const T2 = "tenant-vida";
const START = Date.parse("2026-11-12T10:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const CLIENT_ID = `client-id-${"a".repeat(20)}`;
const CLIENT_SECRET = `client-secret-${"b".repeat(24)}`;
const REDIRECT = "https://kynova.example/api/google/callback";

function world(over: { secrets?: boolean } = {}) {
  const google = fakeGoogle({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, now: START });
  const key = generateEncryptionKey();
  const vault = new EncryptedMemoryVault({ encrypt: (plain, context) => encrypt(plain, key, context), decrypt: (envelope, context) => decrypt(envelope, key, context) });
  const secrets = new SecretsManager(new MemorySecretsProvider(over.secrets === false ? {} : { [FAMILY_SECRETS.google.clientId]: CLIENT_ID, [FAMILY_SECRETS.google.clientSecret]: CLIENT_SECRET }), () => iso(google.now()));
  const deps: GoogleDeps = { fetchImpl: google.fetch, secrets, vault, now: () => google.now(), sleep: async () => undefined };
  const env: ConnectorEnv = { configuredFamilies: configuredFamilies(secrets), workers: [{ tenantId: T1, id: "sales", status: "active" }, { tenantId: T1, id: "paused", status: "paused" }, { tenantId: T2, id: "sales", status: "active" }] };
  return { google, vault, secrets, deps, env, ws: new GoogleWorkspace(deps), key };
}
type World = ReturnType<typeof world>;
const at = (w: World) => iso(w.google.now());
const enable = (state: ConnectorsState, tenantId: string, owner: string, env: ConnectorEnv, when: string) => { const r = reduceConnectors(state, { tenantId, actor: owner, at: when, type: "tenant.enable" }, env); expect(r.error, r.error).toBeUndefined(); return r.state; };
const apply = (state: ConnectorsState, event: ConnectorsEvent, env: ConnectorEnv) => { const r = reduceConnectors(state, event, env); expect(r.error, r.error).toBeUndefined(); return r.state; };

/** The whole real flow: the person starts it, Google shows its consent (the fake registers the code with the challenge from the URL), the callback finishes it. */
async function authorize(w: World, state: ConnectorsState, o: { tenantId?: string; actor?: string; connectorId?: "gmail" | "googleCalendar" | "googleDrive"; email?: string; scopes?: string[]; grant?: string[]; omitRefresh?: boolean }) {
  const tenantId = o.tenantId ?? T1;
  const connectorId = o.connectorId ?? "gmail";
  const scopes = o.scopes ?? CONNECTORS[connectorId].scopes.filter((row) => row.effect === "read").map((row) => row.id);
  const begun = await w.ws.begin(state, w.env, { tenantId, actor: o.actor ?? "ana", at: at(w), connectorId, scopes, redirectUri: REDIRECT });
  expect(begun.ok, begun.error).toBe(true);
  const url = new URL((begun.result as { url: string }).url);
  const oauthState = url.searchParams.get("state")!;
  const googleScopes = o.grant ?? url.searchParams.get("scope")!.split(" ");
  w.google.grantCode({ code: `code-${oauthState}`, challenge: url.searchParams.get("code_challenge")!, email: o.email ?? "ana@nova.test", scopes: googleScopes, ...(o.omitRefresh ? { omitRefresh: true } : {}) });
  const finished = await w.ws.finish(begun.state, w.env, { tenantId, at: at(w), connectorId, state: oauthState, code: `code-${oauthState}`, redirectUri: REDIRECT });
  return { begun, finished, url, oauthState };
}
async function connected(w: World, connectorId: "gmail" | "googleCalendar" | "googleDrive" = "gmail", over: { tenantId?: string; email?: string; perms?: boolean; scopes?: string[] } = {}) {
  const tenantId = over.tenantId ?? T1;
  let state = enable(newConnectorsState(), tenantId, "ana", w.env, at(w));
  const done = await authorize(w, state, { connectorId, tenantId, ...(over.email ? { email: over.email } : {}), ...(over.scopes ? { scopes: over.scopes } : {}) });
  expect(done.finished.ok, done.finished.error).toBe(true);
  state = done.finished.state;
  const connection = done.finished.connection!;
  if (over.perms !== false) for (const scope of connection.grantedScopes) state = apply(state, { tenantId, actor: "ana", at: at(w), type: "permissions.set", connectionId: connection.id, scope, grant: CONNECTORS[connectorId].scopes.find((row) => row.id === scope)?.effect === "write" ? "approval" : "auto" }, w.env);
  return { state, connection: state.connections.find((row) => row.id === connection.id)! };
}
const ask = (w: World, state: ConnectorsState, connectionId: string, operation: string, params: Record<string, unknown> = {}, workerId = "sales", tenantId = T1) => w.ws.request(state, w.env, { tenantId, workerId, connectionId, operation, params, at: at(w) });
const approve = (w: World, state: ConnectorsState, actionId: string, actor = "ana", tenantId = T1) => w.ws.approve(state, w.env, { tenantId, actor, actionId, at: at(w) });

describe("OAuth with PKCE", () => {
  it("builds the authorization URL with the client id from the Secrets Manager, S256, a state and only the scopes asked for", async () => {
    const w = world();
    const state = enable(newConnectorsState(), T1, "ana", w.env, at(w));
    const begun = await w.ws.begin(state, w.env, { tenantId: T1, actor: "ana", at: at(w), connectorId: "gmail", scopes: ["readMail"], redirectUri: REDIRECT });
    const url = new URL((begun.result as { url: string }).url);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")!.length).toBeGreaterThanOrEqual(43);
    expect(url.searchParams.get("scope")).toBe(GOOGLE_SCOPES.gmailReadonly);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("client_secret")).toBeNull();
    expect(w.secrets.accessLog().map((item) => `${item.name}:${item.purpose}`)).toEqual(["GOOGLE_CLIENT_ID:google:authorize"]);
    expect(begun.connection).toMatchObject({ status: "pending" });
  });
  it("exchanges the code with the verifier of THAT authorization, keeps the tokens only in the encrypted vault, and records only a reference", async () => {
    const w = world();
    const { state, connection } = await connected(w);
    expect(connection).toMatchObject({ status: "active", accountId: "ana@nova.test", grantedScopes: ["readMail"] });
    expect(connection.tokenRef).toMatch(/^secret:oauth-cn_\d{4}$/);
    expect(w.vault.references()).toEqual([connection.tokenRef]);
    const token = w.google.issued()[0]!;
    expect(JSON.stringify(state)).not.toContain(token.access);
    expect(JSON.stringify(state)).not.toContain(token.refresh);
    for (const row of w.vault.rawRows()) { expect(row).not.toContain(token.access); expect(row).not.toContain(token.refresh); expect(looksLikeSecret(row)).toBe(false); }
    expect(w.google.tokenRequests).toEqual([{ grant: "authorization_code" }]);
    expect(w.secrets.accessLog().filter((item) => item.purpose === "google:token-exchange").map((item) => item.name).sort()).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
  });
  it("is single use: the verifier is gone after the callback, a replayed callback or a wrong state does nothing", async () => {
    const w = world();
    const state = enable(newConnectorsState(), T1, "ana", w.env, at(w));
    const { finished, oauthState } = await authorize(w, state, {});
    expect(finished.ok).toBe(true);
    const replay = await w.ws.finish(finished.state, w.env, { tenantId: T1, at: at(w), connectorId: "gmail", state: oauthState, code: "x", redirectUri: REDIRECT });
    expect(replay).toMatchObject({ ok: false, code: "stateMismatch" });
    const bogus = await w.ws.finish(finished.state, w.env, { tenantId: T1, at: at(w), connectorId: "gmail", state: "no-existe-este-estado-1234", code: "x", redirectUri: REDIRECT });
    expect(bogus.ok).toBe(false);
    expect(w.vault.references().filter((ref) => ref.startsWith("pkce:"))).toEqual([]);
  });
  it("refuses an exchange whose verifier does not match the challenge, and keeps nothing", async () => {
    const w = world();
    const state = enable(newConnectorsState(), T1, "ana", w.env, at(w));
    const begun = await w.ws.begin(state, w.env, { tenantId: T1, actor: "ana", at: at(w), connectorId: "gmail", scopes: ["readMail"], redirectUri: REDIRECT });
    const url = new URL((begun.result as { url: string }).url);
    w.google.grantCode({ code: "stolen", challenge: "otro-desafio-que-no-coincide-con-el-verificador-1234567", email: "ana@nova.test", scopes: [GOOGLE_SCOPES.gmailReadonly] });
    const done = await w.ws.finish(begun.state, w.env, { tenantId: T1, at: at(w), connectorId: "gmail", state: url.searchParams.get("state")!, code: "stolen", redirectUri: REDIRECT });
    expect(done).toMatchObject({ ok: false, code: "auth" });
    expect(w.vault.references()).toEqual([]);
  });
  it("needs the permission to renew: without a refresh token the authorization is refused and nothing is stored", async () => {
    const w = world();
    const state = enable(newConnectorsState(), T1, "ana", w.env, at(w));
    const { finished } = await authorize(w, state, { omitRefresh: true });
    expect(finished).toMatchObject({ ok: false, code: "auth" });
    expect(w.vault.references()).toEqual([]);
  });
  it("records a denial as an error the person can retry", async () => {
    const w = world();
    const state = enable(newConnectorsState(), T1, "ana", w.env, at(w));
    const begun = await w.ws.begin(state, w.env, { tenantId: T1, actor: "ana", at: at(w), connectorId: "gmail", scopes: ["readMail"], redirectUri: REDIRECT });
    const denied = await w.ws.finish(begun.state, w.env, { tenantId: T1, at: at(w), connectorId: "gmail", state: new URL((begun.result as { url: string }).url).searchParams.get("state")!, error: "access_denied", redirectUri: REDIRECT });
    expect(denied).toMatchObject({ ok: false, code: "denied", connection: { status: "error" } });
    expect((await authorize(w, denied.state, {})).finished.ok).toBe(true);
  });
  it("does not start without the app's credentials in the Secrets Manager, and says where to put them", async () => {
    const w = world({ secrets: false });
    const state = enable(newConnectorsState(), T1, "ana", w.env, at(w));
    const begun = await w.ws.begin(state, w.env, { tenantId: T1, actor: "ana", at: at(w), connectorId: "gmail", scopes: ["readMail"], redirectUri: REDIRECT });
    expect(begun).toMatchObject({ ok: false, code: "notConfigured" });
    expect(begun.error).toMatch(/Wrangler/);
    await expect(authorizationUrlProbe(w)).rejects.toMatchObject({ kind: "notConfigured" });
  });
  it("asks for an administrator of the company and a secure return address", async () => {
    const w = world();
    const state = enable(newConnectorsState(), T1, "ana", w.env, at(w));
    expect((await w.ws.begin(state, w.env, { tenantId: T1, actor: "intruso", at: at(w), connectorId: "gmail", scopes: ["readMail"], redirectUri: REDIRECT })).code).toBe("forbidden");
    expect((await w.ws.begin(state, w.env, { tenantId: T1, actor: "worker:nex", at: at(w), connectorId: "gmail", scopes: ["readMail"], redirectUri: REDIRECT })).code).toBe("personRequired");
    expect((await w.ws.begin(state, w.env, { tenantId: T1, actor: "ana", at: at(w), connectorId: "gmail", scopes: ["readMail"], redirectUri: "http://evil.example/cb" })).code).toBe("insecureRedirect");
  });
});
async function authorizationUrlProbe(w: World) { const { authorizationUrl } = await import("./core"); return authorizationUrl(w.deps, { baseUrl: "https://accounts.google.com/o/oauth2/v2/auth", params: {}, clientIdSecret: "GOOGLE_CLIENT_ID" }); }

describe("refresh: the access renews itself", () => {
  it("renews the access token on its own when it is about to expire, with no person involved, and keeps working", async () => {
    const w = world();
    const { state, connection } = await connected(w);
    const before = w.google.tokenRequests.length;
    w.google.mailbox["m1"] = { id: "m1", threadId: "t1", labelIds: ["INBOX"], internalDate: String(START), headers: { From: "Cliente <cliente@x.test>", Subject: "Hola" }, text: "hola" };
    expect((await ask(w, state, connection.id, "gmail.search", { query: "is:unread" })).ok).toBe(true);
    expect(w.google.tokenRequests.length).toBe(before);
    w.google.setClock(START + 56 * 60_000);
    expect((await ask(w, state, connection.id, "gmail.search", { query: "is:unread" })).ok).toBe(true);
    expect(w.google.tokenRequests.at(-1)).toEqual({ grant: "refresh_token" });
    expect(w.google.tokenRequests).toHaveLength(before + 1);
  });
  it("renews ahead of time every connection within the window, and mirrors the new expiry in the connector state", async () => {
    const w = world();
    const { state, connection } = await connected(w);
    w.google.setClock(START + 55 * 60_000);
    const result = await w.ws.renewDue(state, w.env, at(w));
    expect(result).toMatchObject({ renewed: [connection.id], failed: [] });
    expect(result.state.connections[0]!.expiresAt).toBe(iso(START + 55 * 60_000 + 3_600_000));
    const none = await w.ws.renewDue(result.state, w.env, at(w));
    expect(none.renewed).toEqual([]);
  });
  it("retries once with a fresh token when Google answers 401 to a token it had not expired yet", async () => {
    const w = world();
    const { state, connection } = await connected(w);
    const token = w.google.issued()[0]!;
    // Google invalidated the access token early: the next call gets a 401, renews and succeeds
    w.google.setClock(w.google.now());
    const stale = await accessToken(w.deps, connection.tokenRef!);
    expect(stale).toBe(token.access);
    w.google.failNext("/profile", 401, 0);
    const forced = await accessToken(w.deps, connection.tokenRef!, true);
    expect(forced).not.toBe(token.access);
    expect((await ask(w, state, connection.id, "gmail.profile")).ok).toBe(true);
  });
  it("treats a refused renewal as a revocation: the tokens are deleted and the person must authorize again", async () => {
    const w = world();
    const { state, connection } = await connected(w);
    w.google.revokeRefresh("ana@nova.test");
    w.google.setClock(START + 56 * 60_000);
    await expect(refreshAccessToken(w.deps, connection.tokenRef!)).rejects.toMatchObject({ kind: "auth", retryable: false });
    expect(await w.vault.has(connection.tokenRef!)).toBe(false);
    const again = await ask(w, state, connection.id, "gmail.search", { query: "x" });
    expect(again).toMatchObject({ ok: false, status: "failed", code: "auth" });
    expect(w.ws.activity(connection.id)).toMatchObject({ needsReauthorization: true });
    const row = workspaceView(state, w.ws.activities_(), T1, at(w)).find((item) => item.connectorId === "gmail")!;
    expect(row).toMatchObject({ display: "Error", needsReauthorization: true });
    expect(row.healthScore).toBeLessThanOrEqual(20);
  });
  it("reports a renewal that Google refuses in the batch, without losing the others", async () => {
    const w = world();
    const first = await connected(w, "gmail", { email: "ana@nova.test" });
    w.google.revokeRefresh("ana@nova.test");
    w.google.setClock(START + 55 * 60_000);
    const result = await w.ws.renewDue(first.state, w.env, at(w));
    expect(result.failed).toEqual([{ connectionId: first.connection.id, kind: "auth" }]);
    expect(result.renewed).toEqual([]);
  });
});

describe("revocation", () => {
  it("revokes at Google, deletes the tokens and clears the connection, only for an administrator of that company", async () => {
    const w = world();
    const { state, connection } = await connected(w);
    const refresh = w.google.issued()[0]!.refresh;
    expect((await w.ws.disconnect(state, w.env, { tenantId: T1, actor: "intruso", at: at(w), connectionId: connection.id })).code).toBe("forbidden");
    expect(w.google.revoked).toEqual([]);
    expect(await w.vault.has(connection.tokenRef!)).toBe(true);
    const off = await w.ws.disconnect(state, w.env, { tenantId: T1, actor: "ana", at: at(w), connectionId: connection.id });
    expect(off).toMatchObject({ ok: true, result: { revokedAtGoogle: true }, connection: { status: "notConnected" } });
    expect(w.google.revoked).toEqual([refresh]);
    expect(w.vault.references()).toEqual([]);
    expect(w.ws.activity(connection.id)).toBeUndefined();
    expect(off.state.audit.at(-1)!.detail).toContain("revoke:secret:oauth-");
  });
  it("deletes the tokens even when Google cannot be reached", async () => {
    const w = world();
    const { state, connection } = await connected(w);
    w.google.throwNext("/revoke");
    const off = await w.ws.disconnect(state, w.env, { tenantId: T1, actor: "ana", at: at(w), connectionId: connection.id });
    expect(off).toMatchObject({ ok: true, result: { revokedAtGoogle: false } });
    expect(w.vault.references()).toEqual([]);
  });
  it("lets the company connect again afterwards, and frees the account", async () => {
    const w = world();
    const { state, connection } = await connected(w);
    const off = await w.ws.disconnect(state, w.env, { tenantId: T1, actor: "ana", at: at(w), connectionId: connection.id });
    const again = await authorize(w, off.state, {});
    expect(again.finished).toMatchObject({ ok: true, connection: { id: connection.id, status: "active" } });
  });
  it("drops the operations that were waiting for approval when the connection is disconnected", async () => {
    const w = world();
    const { state, connection } = await connected(w, "gmail", { scopes: ["readMail", "sendMail"] });
    const held = await ask(w, state, connection.id, "gmail.send", { to: ["a@b.test"], subject: "x", text: "y" });
    expect(w.ws.pendingCount(T1)).toBe(1);
    const off = await w.ws.disconnect(held.state, w.env, { tenantId: T1, actor: "ana", at: at(w), connectionId: connection.id });
    expect(w.ws.pendingCount(T1)).toBe(0);
    expect((await approve(w, off.state, held.action!.id)).ok).toBe(false);
  });
});

describe("scopes: the minimum, and nothing wider on its own", () => {
  it("asks Google for only the scopes the company chose, per app", async () => {
    const w = world();
    const state = enable(newConnectorsState(), T1, "ana", w.env, at(w));
    const params = async (connectorId: "gmail" | "googleCalendar" | "googleDrive", scopes: string[]) => new URL(((await w.ws.begin(state, w.env, { tenantId: T1, actor: "ana", at: at(w), connectorId, scopes, redirectUri: REDIRECT })).result as { url: string }).url).searchParams.get("scope");
    expect(await params("gmail", ["readMail"])).toBe(GOOGLE_SCOPES.gmailReadonly);
    expect(await params("googleCalendar", ["readEvents", "writeEvents"])).toBe(`${GOOGLE_SCOPES.calendarReadonly} ${GOOGLE_SCOPES.calendarEvents}`);
    expect(await params("googleDrive", ["readFiles"])).toBe(GOOGLE_SCOPES.driveReadonly);
  });
  it("lists what the Sprint 40 manifest can authorize and what would need a wider Google scope, and computes the least scopes for a set of operations", () => {
    const { available, needsWiderScope } = authorizableOperations();
    expect(needsWiderScope.sort()).toEqual(["gmail.createDraft", "gmail.createLabel", "gmail.modifyLabels"]);
    expect(available).toHaveLength(GOOGLE_OPERATION_IDS.length - 3);
    expect(minimalScopeIds(["gmail.search", "gmail.read", "calendar.freeBusy"])).toEqual({ gmail: ["readMail"], googleCalendar: ["readEvents"] });
    expect(minimalScopeIds(["gmail.send", "drive.upload"])).toEqual({ gmail: ["sendMail"], googleDrive: ["writeFiles"] });
  });
  it("refuses an operation Google did not grant the scope for, before calling Google, and never widens the request by itself", async () => {
    const w = world();
    const { state, connection } = await connected(w, "gmail", { scopes: ["readMail", "sendMail"] });
    const calls = w.google.calls.length;
    for (const operation of ["gmail.createDraft", "gmail.createLabel", "gmail.modifyLabels"]) {
      const result = await ask(w, state, connection.id, operation, { name: "x", messageId: "m1", to: ["a@b.test"], subject: "s", text: "t" });
      expect(result, operation).toMatchObject({ ok: false, status: "refused", code: "scopeInsufficient" });
    }
    expect(w.google.calls.length).toBe(calls);
    const readOnly = await connected(world(), "gmail", { scopes: ["readMail"] });
    expect(readOnly.connection.grantedScopes).toEqual(["readMail"]);
  });
  it("has the real Gmail draft and label functions ready for the day the manifest asks for the wider scope, and Google enforces scopes either way", async () => {
    const w = world();
    const { connection } = await connected(w, "gmail", { scopes: ["readMail"] });
    await expect(gmail.createDraft(w.deps, connection.tokenRef!, { to: ["a@b.test"], subject: "s", text: "t" })).rejects.toMatchObject({ kind: "scope" });
    const wide = world();
    const state = enable(newConnectorsState(), T1, "ana", wide.env, at(wide));
    const done = await authorize(wide, state, { grant: [GOOGLE_SCOPES.gmailReadonly, GOOGLE_SCOPES.gmailCompose, GOOGLE_SCOPES.gmailModify] });
    const ref = done.finished.connection!.tokenRef!;
    expect((await gmail.createDraft(wide.deps, ref, { to: ["a@b.test"], subject: "Borrador", text: "t" })).id).toBe("draft-1");
    expect((await gmail.createLabel(wide.deps, ref, { name: "Seguimiento" })).name).toBe("Seguimiento");
    wide.google.mailbox["m1"] = { id: "m1", threadId: "t", labelIds: ["INBOX"], internalDate: "1", headers: {}, text: "x" };
    expect((await gmail.modifyLabels(wide.deps, ref, { messageId: "m1", add: ["Label_1"], remove: ["INBOX"] })).labelIds).toEqual(["Label_1"]);
  });
});

describe("Worker → Connector → Google: nobody reaches Google directly", () => {
  it("refuses a request from a Worker that is not active in the company, and never calls Google", async () => {
    const w = world();
    const { state, connection } = await connected(w);
    const calls = w.google.calls.length;
    expect(await ask(w, state, connection.id, "gmail.search", { query: "x" }, "paused")).toMatchObject({ ok: false, code: "workerInactive" });
    expect(await ask(w, state, connection.id, "gmail.search", { query: "x" }, "inventado")).toMatchObject({ ok: false, code: "workerInactive" });
    expect(w.google.calls.length).toBe(calls);
  });
  it("refuses when the permission is off, and when the operation belongs to another app or does not exist", async () => {
    const w = world();
    const { state, connection } = await connected(w, "gmail", { perms: false });
    expect(await ask(w, state, connection.id, "gmail.search", { query: "x" })).toMatchObject({ ok: false, code: "permissionOff" });
    const live = await connected(w);
    expect(await ask(w, live.state, live.connection.id, "calendar.list", {})).toMatchObject({ ok: false, code: "notFound" });
    expect(await ask(w, live.state, live.connection.id, "gmail.exfiltrate", {})).toMatchObject({ ok: false, code: "unknownOperation" });
  });
  it("lets a Worker read at once, with the connection's own token, and records the run without any content", async () => {
    const w = world();
    const { state, connection } = await connected(w);
    w.google.mailbox["m1"] = { id: "m1", threadId: "t1", labelIds: ["INBOX"], internalDate: String(START), headers: { From: "Cliente <cliente@x.test>", Subject: "Contrato confidencial", "Message-ID": "<abc@x.test>" }, text: "Texto privado del correo", attachments: [{ filename: "cotizacion.pdf", mimeType: "application/pdf", attachmentId: "att1", data: "PDF-DATA" }] };
    const found = await ask(w, state, connection.id, "gmail.search", { query: "from:cliente" });
    expect(found).toMatchObject({ ok: true, status: "done", result: { messages: [{ id: "m1" }] } });
    const read = await ask(w, found.state, connection.id, "gmail.read", { id: "m1", withText: true });
    expect(read.result).toMatchObject({ subject: "Contrato confidencial", text: "Texto privado del correo", attachments: [{ filename: "cotizacion.pdf", attachmentId: "att1" }] });
    expect(w.google.calls.at(-1)!.headers["authorization"]).toMatch(/^Bearer at-/);
    const dump = JSON.stringify([read.state, w.ws.executions, w.ws.activities_()]);
    expect(dump).not.toMatch(/Contrato confidencial|Texto privado|cliente@x\.test/);
    expect(w.ws.executions.map((row) => `${row.workerId}:${row.operation}:${row.outcome}`)).toEqual(["sales:gmail.search:ok", "sales:gmail.read:ok"]);
    expect(read.state.audit.at(-1)).toMatchObject({ actor: "worker:sales", action: "action.request" });
  });
  it("holds every write for a person: nothing reaches Google until a person approves, and a Worker cannot approve", async () => {
    const w = world();
    const { state, connection } = await connected(w, "gmail", { scopes: ["readMail", "sendMail"] });
    const calls = w.google.calls.length;
    const held = await ask(w, state, connection.id, "gmail.send", { to: ["cliente@x.test"], subject: "Propuesta", text: "Adjunto la propuesta" });
    expect(held).toMatchObject({ ok: true, status: "awaitingApproval" });
    expect(w.google.calls.length).toBe(calls);
    expect(w.google.sent).toEqual([]);
    expect((await approve(w, held.state, held.action!.id, "worker:sales")).code).toBe("personRequired");
    expect((await approve(w, held.state, held.action!.id, "intruso")).code).toBe("forbidden");
    expect((await approve(w, held.state, held.action!.id, "ana", T2)).code).toBeDefined();
    const done = await approve(w, held.state, held.action!.id);
    expect(done).toMatchObject({ ok: true, status: "done", action: { status: "done", decidedBy: "ana" } });
    expect(w.google.sent).toHaveLength(1);
    expect(w.google.sent[0]!.raw).toContain("To: cliente@x.test");
    expect(JSON.stringify(done.state.audit)).not.toMatch(/Propuesta|cliente@x\.test/);
    expect((await approve(w, done.state, held.action!.id)).ok).toBe(false);
  });
  it("lets a person reject a held operation, and nothing is sent", async () => {
    const w = world();
    const { state, connection } = await connected(w, "gmail", { scopes: ["readMail", "sendMail"] });
    const held = await ask(w, state, connection.id, "gmail.send", { to: ["a@b.test"], subject: "s", text: "t" });
    const rejected = await w.ws.reject(held.state, w.env, { tenantId: T1, actor: "ana", actionId: held.action!.id, reason: "no corresponde", at: at(w) });
    expect(rejected).toMatchObject({ ok: true, status: "rejected" });
    expect(w.google.sent).toEqual([]);
    expect(w.ws.pendingCount(T1)).toBe(0);
  });
});

describe("Gmail", () => {
  async function mail() {
    const w = world();
    const c = await connected(w, "gmail", { scopes: ["readMail", "sendMail"] });
    w.google.mailbox["m1"] = { id: "m1", threadId: "t1", labelIds: ["INBOX"], internalDate: String(START), headers: { From: "Ana Cliente <ana@cliente.test>", "Reply-To": "", Subject: "Consulta", "Message-ID": "<orig@cliente.test>", References: "<prev@cliente.test>" }, text: "Hola", attachments: [{ filename: "a.pdf", mimeType: "application/pdf", attachmentId: "att1", data: "contenido" }] };
    return { w, ...c };
  }
  it("searches, reads with the attachment list, downloads an attachment and lists labels", async () => {
    const { w, state, connection } = await mail();
    expect((await ask(w, state, connection.id, "gmail.search", { query: "has:attachment", maxResults: 5 })).result).toMatchObject({ messages: [{ id: "m1", threadId: "t1" }] });
    expect(w.google.calls.at(-1)!.query.get("q")).toBe("has:attachment");
    expect((await ask(w, state, connection.id, "gmail.attachment", { messageId: "m1", attachmentId: "att1" })).result).toMatchObject({ dataBase64: base64(utf8("contenido")) });
    expect((await ask(w, state, connection.id, "gmail.listLabels")).result).toEqual(expect.arrayContaining([{ id: "INBOX", name: "INBOX", type: "system" }]));
    expect((await ask(w, state, connection.id, "gmail.profile")).result).toMatchObject({ emailAddress: "ana@nova.test" });
  });
  it("sends a message with every header checked, a non-ASCII subject encoded and attachments as multipart", async () => {
    const { w, state, connection } = await mail();
    const held = await ask(w, state, connection.id, "gmail.send", { to: ["cliente@x.test"], cc: ["otro@x.test"], subject: "Cotización ñandú", text: "Hola, adjunto", attachments: [{ filename: "cotización.pdf", mimeType: "application/pdf", dataBase64: base64(utf8("PDFBYTES")) }] });
    await approve(w, held.state, held.action!.id);
    const raw = w.google.sent[0]!.raw;
    expect(raw).toContain("To: cliente@x.test");
    expect(raw).toContain("Cc: otro@x.test");
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    expect(raw).toContain("Content-Type: multipart/mixed");
    expect(raw).toMatch(/Content-Disposition: attachment; filename="=\?UTF-8\?B\?/);
    expect(raw).toContain(base64(utf8("PDFBYTES")));
  });
  it("refuses header injection, bad recipients, too many recipients and a message that is too large", { timeout: 30_000 }, () => {
    const base = { to: ["a@b.test"], subject: "s", text: "t" };
    expect(() => gmail.buildRawMessage({ ...base, subject: "hola\r\nBcc: atacante@x.test" })).toThrow(GoogleApiError);
    expect(() => gmail.buildRawMessage({ ...base, to: ["a@b.test\r\nBcc: x@y.test"] })).toThrow(GoogleApiError);
    expect(() => gmail.buildRawMessage({ ...base, to: ["no-es-correo"] })).toThrow(GoogleApiError);
    expect(() => gmail.buildRawMessage({ ...base, to: [] })).toThrow(GoogleApiError);
    expect(() => gmail.buildRawMessage({ ...base, to: Array.from({ length: 51 }, (_, i) => `u${i}@x.test`) })).toThrow(GoogleApiError);
    expect(() => gmail.buildRawMessage({ ...base, attachments: [{ filename: "a\r\nX: y", mimeType: "text/plain", dataBase64: "QQ==" }] })).toThrow(GoogleApiError);
    expect(() => gmail.buildRawMessage({ ...base, text: "x".repeat(gmail.MAX_MESSAGE_BYTES) })).toThrow(GoogleApiError);
  });
  it("replies inside the same thread: Re: subject, In-Reply-To and References of the original, to the original sender", async () => {
    const { w, state, connection } = await mail();
    const held = await ask(w, state, connection.id, "gmail.reply", { messageId: "m1", text: "Gracias, le respondo hoy" });
    await approve(w, held.state, held.action!.id);
    expect(w.google.sent[0]).toMatchObject({ threadId: "t1" });
    const raw = w.google.sent[0]!.raw;
    expect(raw).toContain("To: ana@cliente.test");
    expect(raw).toContain("Subject: Re: Consulta");
    expect(raw).toContain("In-Reply-To: <orig@cliente.test>");
    expect(raw).toContain("References: <prev@cliente.test> <orig@cliente.test>");
  });
  it("validates ids so a request cannot reach another path", async () => {
    const { w, state, connection } = await mail();
    expect(await ask(w, state, connection.id, "gmail.read", { id: "../labels" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await ask(w, state, connection.id, "gmail.read", { id: "no-existe" })).toMatchObject({ ok: false, code: "notFound" });
  });
});

describe("Google Calendar", () => {
  async function cal() { const w = world(); const c = await connected(w, "googleCalendar", { scopes: ["readEvents", "writeEvents"] }); return { w, ...c }; }
  it("reads events, creates one with guests, updates it and cancels it, every write only after a person approves", async () => {
    const { w, state, connection } = await cal();
    const held = await ask(w, state, connection.id, "calendar.create", { summary: "Reunión con Marta", start: "2026-11-13T15:00:00Z", end: "2026-11-13T16:00:00Z", attendees: ["marta@clinica.test"], sendUpdates: "all" });
    expect(held.status).toBe("awaitingApproval");
    expect(Object.keys(w.google.events)).toEqual([]);
    const created = await approve(w, held.state, held.action!.id);
    const eventId = (created.result as { id: string }).id;
    expect(w.google.events[eventId]).toMatchObject({ summary: "Reunión con Marta", attendees: [{ email: "marta@clinica.test" }] });
    expect(w.google.calls.at(-1)!.query.get("sendUpdates")).toBe("all");
    expect((await ask(w, created.state, connection.id, "calendar.list", { timeMin: "2026-11-13T00:00:00Z", timeMax: "2026-11-14T00:00:00Z" })).result).toHaveLength(1);
    const updateHeld = await ask(w, created.state, connection.id, "calendar.update", { eventId, summary: "Reunión movida", start: "2026-11-13T17:00:00Z", end: "2026-11-13T18:00:00Z" });
    const updated = await approve(w, updateHeld.state, updateHeld.action!.id);
    expect(w.google.events[eventId]).toMatchObject({ summary: "Reunión movida" });
    const cancelHeld = await ask(w, updated.state, connection.id, "calendar.cancel", { eventId, sendUpdates: "all" });
    await approve(w, cancelHeld.state, cancelHeld.action!.id);
    expect(w.google.events[eventId]).toBeUndefined();
  });
  it("reports availability and proposes free slots from Google's busy blocks", async () => {
    const { w, state, connection } = await cal();
    w.google.busy.push({ start: "2026-11-13T14:00:00Z", end: "2026-11-13T15:00:00Z" }, { start: "2026-11-13T16:00:00Z", end: "2026-11-13T17:00:00Z" });
    const busy = await ask(w, state, connection.id, "calendar.freeBusy", { timeMin: "2026-11-13T13:00:00Z", timeMax: "2026-11-13T18:00:00Z" });
    expect(busy.result).toEqual({ primary: [{ start: "2026-11-13T14:00:00Z", end: "2026-11-13T15:00:00Z" }, { start: "2026-11-13T16:00:00Z", end: "2026-11-13T17:00:00Z" }] });
    const slots = await ask(w, state, connection.id, "calendar.availability", { timeMin: "2026-11-13T13:00:00Z", timeMax: "2026-11-13T18:00:00Z", minutes: 60 });
    expect(slots.result).toEqual([{ start: "2026-11-13T13:00:00.000Z", end: "2026-11-13T14:00:00.000Z" }, { start: "2026-11-13T15:00:00.000Z", end: "2026-11-13T16:00:00.000Z" }, { start: "2026-11-13T17:00:00.000Z", end: "2026-11-13T18:00:00.000Z" }]);
    expect(calendar.findFreeSlots([], { start: "2026-11-13T09:00:00Z", end: "2026-11-13T09:30:00Z" }, 60)).toEqual([]);
  });
  it("refuses bad times, an event that ends before it starts, bad guests and bad ids", async () => {
    const { w, state, connection } = await cal();
    const create = async (params: Record<string, unknown>) => { const held = await ask(w, state, connection.id, "calendar.create", params); return approve(w, held.state, held.action!.id); };
    expect(await create({ summary: "x", start: "mañana", end: "pasado" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await create({ summary: "x", start: "2026-11-13T16:00:00Z", end: "2026-11-13T15:00:00Z" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await create({ summary: "x", start: "2026-11-13T15:00:00Z", end: "2026-11-13T16:00:00Z", attendees: ["no-es-correo"] })).toMatchObject({ ok: false, code: "invalid" });
    expect(await create({ summary: "  ", start: "2026-11-13T15:00:00Z", end: "2026-11-13T16:00:00Z" })).toMatchObject({ ok: false, code: "invalid" });
    const held = await ask(w, state, connection.id, "calendar.cancel", { eventId: "../calendars" });
    expect(await approve(w, held.state, held.action!.id)).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("Google Drive", () => {
  async function files() { const w = world(); const c = await connected(w, "googleDrive", { scopes: ["readFiles", "writeFiles"] }); return { w, ...c }; }
  it("searches with an escaped query, so a name can never change it, and reads a file", async () => {
    const { w, state, connection } = await files();
    w.google.files["f1"] = { id: "f1", name: "Contrato", mimeType: "text/plain", parents: ["root"] };
    await ask(w, state, connection.id, "drive.search", { nameContains: "O'Brien\\ o' or name contains '", mimeType: "application/pdf", parentId: "abc123" });
    expect(w.google.calls.at(-1)!.query.get("q")).toBe("trashed = false and name contains 'O\\'Brien\\\\ o\\' or name contains \\'' and mimeType = 'application/pdf' and 'abc123' in parents");
    expect((await ask(w, state, connection.id, "drive.get", { fileId: "f1" })).result).toMatchObject({ id: "f1", name: "Contrato" });
    expect(drive.driveQuote("a'b")).toBe("'a\\'b'");
  });
  it("creates a folder, uploads a file into it, moves it and shares it with one person, each write after approval", async () => {
    const { w, state, connection } = await files();
    const run = async (current: ConnectorsState, operation: string, params: Record<string, unknown>) => { const held = await ask(w, current, connection.id, operation, params); expect(held.status).toBe("awaitingApproval"); return approve(w, held.state, held.action!.id); };
    const folder = await run(state, "drive.createFolder", { name: "Clientes 2026" });
    const folderId = (folder.result as { id: string }).id;
    expect(w.google.files[folderId]).toMatchObject({ name: "Clientes 2026", mimeType: drive.FOLDER_MIME });
    const upload = await run(folder.state, "drive.upload", { name: "propuesta.txt", mimeType: "text/plain", dataBase64: base64(utf8("Propuesta comercial")), parentId: folderId });
    const fileId = (upload.result as { id: string }).id;
    expect(w.google.files[fileId]).toMatchObject({ name: "propuesta.txt", parents: [folderId], content: "Propuesta comercial" });
    const other = await run(upload.state, "drive.createFolder", { name: "Archivo" });
    const moved = await run(other.state, "drive.move", { fileId, toFolderId: (other.result as { id: string }).id });
    expect(w.google.files[fileId]!["parents"]).toEqual([(other.result as { id: string }).id]);
    const shared = await run(moved.state, "drive.share", { fileId, email: "marta@clinica.test", role: "reader" });
    expect(shared.ok).toBe(true);
    expect(w.google.permissions[0]).toMatchObject({ fileId, type: "user", role: "reader", emailAddress: "marta@clinica.test" });
    expect(JSON.stringify(w.google.permissions)).not.toContain("anyone");
  });
  it("refuses to share with anyone, to give the owner role, to upload an oversized file, or to use a bad id", async () => {
    const { w, state, connection } = await files();
    w.google.files["f1"] = { id: "f1", name: "x", mimeType: "text/plain" };
    const run = async (operation: string, params: Record<string, unknown>) => { const held = await ask(w, state, connection.id, operation, params); return approve(w, held.state, held.action!.id); };
    expect(await run("drive.share", { fileId: "f1", email: "cualquiera", role: "reader" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await run("drive.share", { fileId: "f1", email: "a@b.test", role: "owner" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await run("drive.upload", { name: "grande.bin", mimeType: "application/octet-stream", dataBase64: "A".repeat(drive.MAX_UPLOAD_BYTES * 2) })).toMatchObject({ ok: false, code: "invalid" });
    expect(await run("drive.move", { fileId: "../x", toFolderId: "y" })).toMatchObject({ ok: false, code: "invalid" });
    expect(await run("drive.createFolder", { name: "" })).toMatchObject({ ok: false, code: "invalid" });
  });
  it("does not let read-only access write: Google's scope check comes back as a scope error", async () => {
    const w = world();
    const { connection } = await connected(w, "googleDrive", { scopes: ["readFiles"] });
    await expect(drive.createFolder(w.deps, connection.tokenRef!, { name: "no" })).rejects.toMatchObject({ kind: "scope" });
  });
});

describe("errors", () => {
  it("retries a rate limit and a Google failure, and gives up with a kind and no content", async () => {
    const w = world();
    const { state, connection } = await connected(w);
    w.google.mailbox["m1"] = { id: "m1", threadId: "t", labelIds: [], internalDate: "1", headers: {}, text: "" };
    w.google.failNext("/messages", 429, 2);
    expect((await ask(w, state, connection.id, "gmail.search", { query: "x" })).ok).toBe(true);
    w.google.failNext("/messages", 503, 3);
    const failed = await ask(w, state, connection.id, "gmail.search", { query: "x" });
    expect(failed).toMatchObject({ ok: false, status: "failed", code: "provider" });
    expect(failed.error).not.toMatch(/at-|rt-|Bearer|503/);
    w.google.throwNext("/messages", 3);
    expect(await ask(w, state, connection.id, "gmail.search", { query: "x" })).toMatchObject({ ok: false, code: "network" });
    w.google.failNext("/messages", 403, 3);
    expect(await ask(w, state, connection.id, "gmail.search", { query: "x" })).toMatchObject({ ok: false, code: "rateLimit" });
  });
  it("maps a missing item to notFound and a missing permission to scope, and keeps the real outcome in the execution log", async () => {
    const w = world();
    const { state, connection } = await connected(w);
    const missing = await ask(w, state, connection.id, "gmail.read", { id: "ghost" });
    expect(missing).toMatchObject({ ok: false, code: "notFound" });
    expect(w.ws.executions.at(-1)).toMatchObject({ outcome: "failed", errorKind: "notFound", operation: "gmail.read", workerId: "sales" });
    expect(w.ws.executions.every((row) => !JSON.stringify(row).match(/ghost|at-|rt-/))).toBe(true);
    expect(w.ws.activity(connection.id)).toMatchObject({ consecutiveFailures: 1, recent: ["failed"] });
  });
  it("never lets a token, a code or a client secret into an error", async () => {
    const w = world();
    const { connection } = await connected(w);
    const token = w.google.issued()[0]!;
    w.google.failNext("/profile", 500, 5);
    const error = (await gmail.profile(w.deps, connection.tokenRef!).catch((e: unknown) => e)) as GoogleApiError;
    for (const secret of [token.access, token.refresh, CLIENT_SECRET, CLIENT_ID]) expect(`${error.message} ${error.name} ${JSON.stringify(error)}`).not.toContain(secret);
  });
});

describe("sync, the Connected Apps view and the health score", () => {
  it("syncs Gmail, Calendar and Drive for real and shows the last email, event and file, without content", async () => {
    const w = world();
    let state = enable(newConnectorsState(), T1, "ana", w.env, at(w));
    const ids: Record<string, string> = {};
    for (const [connectorId, email] of [["gmail", "a@nova.test"], ["googleCalendar", "b@nova.test"], ["googleDrive", "c@nova.test"]] as const) {
      const done = await authorize(w, state, { connectorId, email });
      state = done.finished.state;
      const connection = done.finished.connection!;
      for (const scope of connection.grantedScopes) state = apply(state, { tenantId: T1, actor: "ana", at: at(w), type: "permissions.set", connectionId: connection.id, scope, grant: "auto" }, w.env);
      ids[connectorId] = connection.id;
    }
    w.google.mailbox["m9"] = { id: "m9", threadId: "t", labelIds: [], internalDate: String(START - 3_600_000), headers: { Subject: "Privado" }, text: "x" };
    w.google.events["e9"] = { id: "e9", updated: iso(START - 7_200_000), summary: "Reunión privada" };
    w.google.files["f9"] = { id: "f9", name: "Archivo privado", modifiedTime: iso(START - 1_800_000) };
    for (const connectorId of ["gmail", "googleCalendar", "googleDrive"]) {
      const result = await w.ws.sync(state, w.env, { tenantId: T1, connectionId: ids[connectorId]!, at: at(w) });
      expect(result, connectorId).toMatchObject({ ok: true, status: "done" });
      state = result.state;
    }
    const rows = workspaceView(state, w.ws.activities_(), T1, at(w));
    expect(rows.map((row) => row.label)).toEqual(["Gmail", "Google Calendar", "Google Drive"]);
    expect(rows[0]).toMatchObject({ account: "a@nova.test", display: "Connected", lastSyncAt: at(w), lastEmail: { id: "m9", at: iso(START - 3_600_000) } });
    expect(rows[1]).toMatchObject({ account: "b@nova.test", lastEvent: { id: "e9" } });
    expect(rows[2]).toMatchObject({ account: "c@nova.test", lastFile: { id: "f9" } });
    expect(rows.every((row) => row.healthScore >= 90)).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/Privado|privada|privado/);
    expect(state.connections.every((row) => row.lastSyncAt === at(w))).toBe(true);
  });
  it("skips a sync whose permission is off, and a failed real sync does not move the last sync", async () => {
    const w = world();
    const { state, connection } = await connected(w, "gmail", { perms: false });
    const off = await w.ws.sync(state, w.env, { tenantId: T1, connectionId: connection.id, at: at(w) });
    expect(off).toMatchObject({ ok: true, result: { synced: [] } });
    expect(off.state.connections[0]!.lastSyncAt).toBeUndefined();
    const on = await connected(w);
    w.google.failNext("/messages", 503, 9);
    const failed = await w.ws.sync(on.state, w.env, { tenantId: T1, connectionId: on.connection.id, at: at(w) });
    expect(failed).toMatchObject({ ok: false, code: "provider" });
    expect(failed.state.connections[0]!.lastSyncAt).toBeUndefined();
    expect(w.ws.activity(on.connection.id)).toMatchObject({ consecutiveFailures: 1 });
  });
  it("scores health from the state, the renewal, the freshness of the sync and the recent success rate", () => {
    const base = { at: "2026-11-12T12:00:00.000Z" };
    const connection = (over: Record<string, unknown> = {}) => ({ id: "cn_0001", tenantId: T1, connectorId: "gmail", status: "active", requestedScopes: [], grantedScopes: [], grants: {}, consecutiveFailures: 0, cursors: {}, synced: {}, connectedBy: "ana", createdAt: base.at, history: [], expiresAt: "2026-11-12T12:50:00.000Z", ...over }) as never;
    const activity = (recent: ("ok" | "failed")[], over: Record<string, unknown> = {}) => ({ connectionId: "cn_0001", tenantId: T1, recent, consecutiveFailures: 0, needsReauthorization: false, lastSyncAt: "2026-11-12T11:00:00.000Z", ...over }) as never;
    expect(healthScore({ ...base })).toBe(0);
    expect(healthScore({ ...base, connection: connection({ status: "notConnected" }) })).toBe(0);
    expect(healthScore({ ...base, connection: connection({ status: "pending" }) })).toBe(10);
    expect(healthScore({ ...base, connection: connection(), activity: activity(["ok", "ok"]) })).toBe(100);
    expect(healthScore({ ...base, connection: connection({ expiresAt: "2026-11-12T12:05:00.000Z" }), activity: activity(["ok", "ok"]) })).toBe(90);
    expect(healthScore({ ...base, connection: connection(), activity: activity(["ok", "failed"]) })).toBe(90);
    expect(healthScore({ ...base, connection: connection(), activity: activity(["ok"], { lastSyncAt: "2026-11-08T12:00:00.000Z" }) })).toBe(80);
    expect(healthScore({ ...base, connection: connection({ status: "degraded" }), activity: activity(["ok"]) })).toBe(80);
    expect(healthScore({ ...base, connection: connection(), activity: activity(["failed"], { needsReauthorization: true }) })).toBeLessThanOrEqual(20);
    expect(healthScore({ ...base, connection: connection({ status: "error" }), activity: activity([]) })).toBe(0);
    expect(healthScore({ ...base, connection: connection(), activity: activity(["ok"]), incident: { group: "google", mode: "down", since: base.at } })).toBe(70);
    expect(healthScore({ ...base, connection: connection({ expiresAt: "2026-11-12T11:00:00.000Z" }), activity: activity(["ok"]) })).toBe(80);
  });
});

describe("every company has its own Google accounts and its own tokens", () => {
  it("keeps two companies' accounts, tokens, activity and views apart", async () => {
    const w = world();
    let state = enable(enable(newConnectorsState(), T1, "ana", w.env, at(w)), T2, "luis", w.env, at(w));
    const a = await authorize(w, state, { tenantId: T1, actor: "ana", email: "ana@nova.test" });
    const b = await authorize(w, a.finished.state, { tenantId: T2, actor: "luis", email: "luis@vida.test" });
    state = b.finished.state;
    expect(a.finished.connection!.tokenRef).not.toBe(b.finished.connection!.tokenRef);
    expect(w.vault.references().filter((ref) => ref.startsWith("secret:")).length).toBe(2);
    const rowsOf = (tenantId: string) => workspaceView(state, w.ws.activities_(), tenantId, at(w)).find((row) => row.connectorId === "gmail")!;
    expect(rowsOf(T1).account).toBe("ana@nova.test");
    expect(rowsOf(T2).account).toBe("luis@vida.test");
    const bConn = b.finished.connection!;
    expect(await ask(w, state, bConn.id, "gmail.search", { query: "x" }, "sales", T1)).toMatchObject({ ok: false, code: "notFound" });
    expect((await w.ws.disconnect(state, w.env, { tenantId: T1, actor: "ana", at: at(w), connectionId: bConn.id })).code).toBe("notFound");
    expect((await w.ws.sync(state, w.env, { tenantId: T1, connectionId: bConn.id, at: at(w) })).code).toBe("notFound");
    expect(await w.vault.has(bConn.tokenRef!)).toBe(true);
  });
  it("lets one Google account belong to one company: a second company is refused and the tokens it just obtained are thrown away at Google", async () => {
    const w = world();
    let state = enable(enable(newConnectorsState(), T1, "ana", w.env, at(w)), T2, "luis", w.env, at(w));
    const first = await authorize(w, state, { tenantId: T1, actor: "ana", email: "compartida@x.test" });
    state = first.finished.state;
    const second = await authorize(w, state, { tenantId: T2, actor: "luis", email: "compartida@x.test" });
    expect(second.finished).toMatchObject({ ok: false, code: "accountInUse" });
    expect(w.google.revoked).toHaveLength(1);
    expect(w.vault.references().filter((ref) => ref.startsWith("secret:"))).toEqual([first.finished.connection!.tokenRef]);
    expect(second.finished.state.connections.find((row) => row.tenantId === T2)?.status).toBe("pending");
    const normalized = await authorize(w, state, { tenantId: T2, actor: "luis", email: "COMPARTIDA@x.test" });
    expect(normalized.finished).toMatchObject({ ok: false, code: "accountInUse" });
  });
  it("uses a state only for the company that started it", async () => {
    const w = world();
    const state = enable(enable(newConnectorsState(), T1, "ana", w.env, at(w)), T2, "luis", w.env, at(w));
    const begun = await w.ws.begin(state, w.env, { tenantId: T1, actor: "ana", at: at(w), connectorId: "gmail", scopes: ["readMail"], redirectUri: REDIRECT });
    const url = new URL((begun.result as { url: string }).url);
    w.google.grantCode({ code: "c1", challenge: url.searchParams.get("code_challenge")!, email: "ana@nova.test", scopes: [GOOGLE_SCOPES.gmailReadonly] });
    const crossed = await w.ws.finish(begun.state, w.env, { tenantId: T2, at: at(w), connectorId: "gmail", state: url.searchParams.get("state")!, code: "c1", redirectUri: REDIRECT });
    expect(crossed).toMatchObject({ ok: false, code: "stateMismatch" });
    expect(w.vault.references().filter((ref) => ref.startsWith("secret:"))).toEqual([]);
  });
});

describe("secrets and the vault", () => {
  it("reads the app's credentials only by name and purpose, and none of their values is in a state, a vault row, a log or the view", async () => {
    const w = world();
    const { state, connection } = await connected(w);
    await ask(w, state, connection.id, "gmail.profile");
    const dump = JSON.stringify([state, w.vault.rawRows(), w.ws.executions, w.ws.activities_(), w.secrets.accessLog(), workspaceView(state, w.ws.activities_(), T1, at(w))]);
    expect(dump).not.toContain(CLIENT_SECRET);
    expect(dump).not.toContain(CLIENT_ID);
    expect(w.secrets.accessLog().every((row) => ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"].includes(row.name) && row.purpose.startsWith("google:"))).toBe(true);
  });
  it("encrypts every vault row, bound to its reference: a row moved to another reference cannot be read", async () => {
    const w = world();
    const { connection } = await connected(w);
    const raw = w.vault.rawRows()[0]!;
    expect(raw.startsWith("{")).toBe(false);
    const other = new EncryptedMemoryVault({ encrypt: async (plain, ctx) => encrypt(plain, w.key, ctx), decrypt: async (envelope, ctx) => decrypt(envelope, w.key, ctx) });
    await other.put("secret:oauth-cn_0001", "valor");
    expect(await other.get("secret:oauth-cn_0001")).toBe("valor");
    const moved = (other as unknown as { rows: Map<string, string> }).rows;
    moved.set("secret:oauth-cn_9999", moved.get("secret:oauth-cn_0001")!);
    await expect(other.get("secret:oauth-cn_9999")).rejects.toBeDefined();
    expect(connection.tokenRef).toBe("secret:oauth-cn_0001");
  });
});

describe("the layer is the only place that talks to Google, and it connects to nothing else", () => {
  const folder = join(process.cwd(), "lib/integrations/google");
  const sources = readdirSync(folder).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "fake-google.ts");
  const code = (name: string) => readFileSync(join(folder, name), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  it("calls the network in core.ts only, and reads no environment", () => {
    expect(sources.filter((name) => /fetchImpl\(/.test(code(name)))).toEqual(["core.ts"]);
    for (const name of sources) { expect(code(name), name).not.toMatch(/process\.env|XMLHttpRequest|WebSocket|node:https?|(?<!fetchImpl)\bfetch\(/); }
  });
  it("imports no Backend Core, database or AI layer: the cipher and the secrets are handed in", () => {
    for (const name of sources) expect(code(name), name).not.toMatch(/from "@\/lib\/(backend|db|ai)|lib\/backend|supabase/);
  });
  it("names Google's hosts only in core.ts", () => {
    for (const name of sources.filter((item) => item !== "core.ts")) expect(code(name), name).not.toMatch(/accounts\.google\.com|oauth2\.googleapis\.com|gmail\.googleapis\.com/);
  });
  it("covers every operation with a connector scope that exists", () => {
    for (const id of GOOGLE_OPERATION_IDS) { const operation = GOOGLE_OPERATIONS[id]; expect(CONNECTORS[operation.connectorId].scopes.some((row) => row.id === operation.scopeId && row.effect === operation.effect), id).toBe(true); }
    expect(GOOGLE_OPERATION_IDS.filter((id) => GOOGLE_OPERATIONS[id].effect === "write").every((id) => ["gmail.send", "gmail.reply", "gmail.createDraft", "gmail.createLabel", "gmail.modifyLabels", "calendar.create", "calendar.update", "calendar.cancel", "drive.createFolder", "drive.upload", "drive.move", "drive.share"].includes(id))).toBe(true);
  });
});
