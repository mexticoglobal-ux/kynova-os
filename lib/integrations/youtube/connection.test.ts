import { describe, expect, it, vi } from "vitest";
import { decrypt, generateEncryptionKey, randomToken, sha256Hex } from "@/lib/backend/crypto";
import { YOUTUBE_READ_SCOPE } from "@/lib/contracts/youtube-connection";
import {
  disconnectYoutubeConnection, finishYoutubeConnection, startYoutubeConnection, verifyYoutubeConnection,
  type ConnectionStore, type YoutubeConfig, type YoutubeDeps,
} from "./connection";
import { youtubeSetup } from "./server";

// Everything here is a fake: no Google, no database. The real rules of the database (who may manage, single-use states, one company per channel, wiping) are proved in supabase/tests/connectors.sql.
const ORIGIN = "https://app.example.test";
const T1 = "51000000-0000-4000-8000-0000000000b1";
const OWNER = "51000000-0000-4000-8000-000000000001";
const OTHER = "51000000-0000-4000-8000-000000000005";
const REFRESH = "1//0gFakeRefreshTokenValue-abcdefghijklmnop";
const ACCESS = "ya29.FakeAccessTokenValue-abcdefghijklmnop";
const CHANNEL = { id: "UCchannelAAAAAAAAAAAAA01", snippet: { title: "Canal de Prueba" } };

type Stored = { tenantId: string; status: "connected" | "expired" | "error" | "disconnected"; accountId: string; label: string; tokenCt: string | null; errorCode: string | null };

function fakeStore(admins: readonly string[] = [OWNER]) {
  const states = new Map<string, { tenantId: string; userId: string; redirectUri: string; used: boolean }>();
  const rows: Stored[] = [];
  const liveOf = (tenantId: string) => rows.find((row) => row.tenantId === tenantId && row.status !== "disconnected");
  const log: string[] = [];
  const store: ConnectionStore = {
    begin: async (input) => {
      if (!admins.includes(input.userId)) throw Object.assign(new Error("forbidden"), { code: "forbidden" });
      states.set(input.stateHash, { tenantId: input.tenantId, userId: input.userId, redirectUri: input.redirectUri, used: false }); log.push("begin");
    },
    peek: async (hash, userId) => {
      const state = states.get(hash);
      if (!state || state.used) return { ok: false, reason: "state_invalid" };
      if (state.userId !== userId) return { ok: false, reason: "user_mismatch" };
      return { ok: true, redirectUri: state.redirectUri, tenantId: state.tenantId };
    },
    complete: async (input) => {
      const state = states.get(input.stateHash);
      if (!state || state.used) return { ok: false, reason: "state_invalid" };
      state.used = true; // single use, even when it fails afterwards
      if (state.userId !== input.userId) return { ok: false, reason: "user_mismatch" };
      if (rows.some((row) => row.status !== "disconnected" && row.accountId === input.accountId && row.tenantId !== state.tenantId)) return { ok: false, reason: "account_taken" };
      const live = liveOf(state.tenantId);
      const next: Stored = { tenantId: state.tenantId, status: "connected", accountId: input.accountId, label: input.accountLabel, tokenCt: input.tokenCt, errorCode: null };
      if (live) Object.assign(live, next); else rows.push(next);
      log.push("complete");
      return { ok: true, tenantId: state.tenantId, accountId: input.accountId, accountLabel: input.accountLabel };
    },
    secret: async (tenantId) => { const live = liveOf(tenantId); return live?.tokenCt ? { accountId: live.accountId, tokenCt: live.tokenCt } : null; },
    mark: async (tenantId, status, errorCode, label) => {
      const live = liveOf(tenantId);
      if (!live) return false;
      live.status = status; live.errorCode = errorCode ?? null; if (status === "expired") live.tokenCt = null; if (label) live.label = label;
      return true;
    },
    disconnect: async (tenantId, userId) => {
      if (!admins.includes(userId)) throw Object.assign(new Error("forbidden"), { code: "forbidden" });
      const live = liveOf(tenantId);
      if (!live) return { ok: false, reason: "not_connected" };
      live.status = "disconnected"; live.tokenCt = null; log.push("disconnect");
      return { ok: true, accountId: live.accountId };
    },
  };
  return { store, states, rows, liveOf, log };
}

type Route = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fake Google: the three endpoints, each overridable, with every call recorded. */
function fakeGoogle(overrides: { token?: Route; channels?: Route; revoke?: Route } = {}) {
  const calls: { url: string; body: string; auth: string | null }[] = [];
  const fetcher = async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input);
    calls.push({ url: input, body: typeof init?.body === "string" ? init.body : "", auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null });
    if (url.href.startsWith("https://oauth2.googleapis.com/token")) return (overrides.token ?? (() => json({ access_token: ACCESS, refresh_token: REFRESH, scope: YOUTUBE_READ_SCOPE, token_type: "Bearer", expires_in: 3599 })))(url, init);
    if (url.href.startsWith("https://www.googleapis.com/youtube/v3/channels")) return (overrides.channels ?? (() => json({ items: [CHANNEL] })))(url, init);
    if (url.href.startsWith("https://oauth2.googleapis.com/revoke")) return (overrides.revoke ?? (() => json({})))(url, init);
    throw new Error(`unexpected call to ${input}`);
  };
  return { fetcher, calls, count: (prefix: string) => calls.filter((call) => call.url.startsWith(prefix)).length };
}

const KEY = generateEncryptionKey();
const CONFIG: YoutubeConfig = { clientId: "123-abc.apps.googleusercontent.com", clientSecret: "GOCSPX-fake-client-secret-value", encryptionKey: KEY };

function setup(options: { config?: YoutubeConfig | null; google?: Parameters<typeof fakeGoogle>[0]; admins?: readonly string[] } = {}) {
  const store = fakeStore(options.admins);
  const google = fakeGoogle(options.google);
  const deps: YoutubeDeps = { config: options.config === undefined ? CONFIG : options.config, missing: options.config === null ? ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] : [], store: store.store, fetcher: google.fetcher, newState: () => randomToken(32), sha256Hex };
  return { deps, store, google };
}

/** Starts a connection and returns the state the browser would carry back. */
async function started(ctx: ReturnType<typeof setup>, userId = OWNER) {
  const result = await startYoutubeConnection(ctx.deps, { tenantId: T1, userId, origin: ORIGIN });
  if (!result.ok) throw new Error(`could not start: ${result.code}`);
  return new URL(result.url).searchParams.get("state") as string;
}

describe("without Google credentials nothing starts and nothing is simulated", () => {
  it("answers not_configured with the NAMES that are missing, calls nobody and stores nothing", async () => {
    const ctx = setup({ config: null });
    expect(await startYoutubeConnection(ctx.deps, { tenantId: T1, userId: OWNER, origin: ORIGIN })).toEqual({ ok: false, code: "not_configured", missing: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] });
    expect(await finishYoutubeConnection(ctx.deps, { userId: OWNER, origin: ORIGIN, code: "c", state: "s".repeat(43), error: null })).toEqual({ ok: false, code: "not_configured" });
    expect(ctx.google.calls).toHaveLength(0);
    expect(ctx.store.log).toEqual([]);
  });

  it("youtubeSetup reads names only: it lists what is missing and is configured only when everything is there", () => {
    const full = { GOOGLE_CLIENT_ID: "123-abc.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "GOCSPX-fake-client-secret-value", KYNOVA_ENCRYPTION_KEY: KEY, SUPABASE_SERVICE_ROLE_KEY: "service-role-key-value-0123456789" };
    expect(youtubeSetup(full)).toEqual({ configured: true, missing: [] });
    expect(youtubeSetup({})).toEqual({ configured: false, missing: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "KYNOVA_ENCRYPTION_KEY", "SUPABASE_SERVICE_ROLE_KEY"] });
    expect(youtubeSetup({ ...full, GOOGLE_CLIENT_SECRET: "  " }).missing).toEqual(["GOOGLE_CLIENT_SECRET"]);
    expect(JSON.stringify(youtubeSetup({}))).not.toMatch(/GOCSPX|service-role-key-value/);
  });
});

describe("starting the connection", () => {
  it("stores only the HASH of the state, bound to the company, the user and the callback address, and sends the person to Google with that state", async () => {
    const ctx = setup();
    const state = await started(ctx);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const hash = await sha256Hex(state);
    expect([...ctx.store.states.keys()]).toEqual([hash]);
    expect(JSON.stringify([...ctx.store.states.entries()])).not.toContain(state); // the plain value never reaches the store
    expect(ctx.store.states.get(hash)).toMatchObject({ tenantId: T1, userId: OWNER, redirectUri: `${ORIGIN}/api/v1/connections/youtube/callback`, used: false });
    expect(ctx.google.calls).toHaveLength(0);
  });

  it("refuses a user who is not owner or administrator (the database decides) and an origin that is not https", async () => {
    const ctx = setup();
    await expect(startYoutubeConnection(ctx.deps, { tenantId: T1, userId: OTHER, origin: ORIGIN })).rejects.toMatchObject({ code: "forbidden" });
    expect(await startYoutubeConnection(ctx.deps, { tenantId: T1, userId: OWNER, origin: "http://app.example.test" })).toEqual({ ok: false, code: "invalid_request" });
    expect(ctx.store.states.size).toBe(0);
  });
});

describe("finishing the connection: the identity comes from Google, for the user who started it", () => {
  it("connects only after Google returned the channel, stores the token ENCRYPTED and returns no credential", async () => {
    const ctx = setup();
    const spy = vi.spyOn(console, "log"); const err = vi.spyOn(console, "error"); const warn = vi.spyOn(console, "warn");
    const state = await started(ctx);
    const result = await finishYoutubeConnection(ctx.deps, { userId: OWNER, origin: ORIGIN, code: "4/0AfakeAuthorizationCode", state, error: null });
    expect(result).toEqual({ ok: true, tenantId: T1, channel: { id: "UCchannelAAAAAAAAAAAAA01", title: "Canal de Prueba" } });
    // the exchange was a POST with the code and the client secret in the BODY, then channels.list with the access token as a header
    const [exchange, lookup] = ctx.google.calls;
    expect(exchange?.url).toBe("https://oauth2.googleapis.com/token");
    expect(new URLSearchParams(exchange?.body).get("code")).toBe("4/0AfakeAuthorizationCode");
    expect(new URLSearchParams(exchange?.body).get("client_secret")).toBe(CONFIG.clientSecret);
    expect(new URLSearchParams(exchange?.body).get("redirect_uri")).toBe(`${ORIGIN}/api/v1/connections/youtube/callback`);
    expect(lookup?.url).toBe("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true");
    expect(lookup?.auth).toBe(`Bearer ${ACCESS}`);
    // what is stored is ciphertext, bound to the company
    const stored = ctx.store.liveOf(T1);
    expect(stored).toMatchObject({ status: "connected", accountId: "UCchannelAAAAAAAAAAAAA01", label: "Canal de Prueba" });
    expect(stored?.tokenCt).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(stored?.tokenCt).not.toContain(REFRESH);
    expect(await decrypt(stored?.tokenCt as string, KEY, `${T1}:youtube`)).toBe(REFRESH);
    await expect(decrypt(stored?.tokenCt as string, KEY, "another-company:youtube")).rejects.toThrow(); // bound to the company
    expect(JSON.stringify(result)).not.toMatch(/ya29|1\/\/0g|GOCSPX|v1\./);
    for (const logged of [spy, err, warn]) expect(logged).not.toHaveBeenCalled();
    spy.mockRestore(); err.mockRestore(); warn.mockRestore();
  });

  it("refuses a state started by ANOTHER user before spending the code, and a state that is unknown, malformed or already used", async () => {
    const ctx = setup({ admins: [OWNER, OTHER] });
    const state = await started(ctx);
    expect(await finishYoutubeConnection(ctx.deps, { userId: OTHER, origin: ORIGIN, code: "c", state, error: null })).toEqual({ ok: false, code: "user_mismatch" });
    expect(await finishYoutubeConnection(ctx.deps, { userId: OWNER, origin: ORIGIN, code: "c", state: randomToken(32), error: null })).toEqual({ ok: false, code: "state_invalid" });
    expect(await finishYoutubeConnection(ctx.deps, { userId: OWNER, origin: ORIGIN, code: "c", state: "short", error: null })).toEqual({ ok: false, code: "state_invalid" });
    expect(await finishYoutubeConnection(ctx.deps, { userId: OWNER, origin: ORIGIN, code: "c", state: null, error: null })).toEqual({ ok: false, code: "state_invalid" });
    expect(ctx.google.calls).toHaveLength(0); // nothing was spent at Google
    expect((await finishYoutubeConnection(ctx.deps, { userId: OWNER, origin: ORIGIN, code: "c", state, error: null })).ok).toBe(true);
    const calls = ctx.google.calls.length;
    expect(await finishYoutubeConnection(ctx.deps, { userId: OWNER, origin: ORIGIN, code: "c", state, error: null })).toEqual({ ok: false, code: "state_invalid" }); // a replay
    expect(ctx.google.calls).toHaveLength(calls);
  });

  it("stops at the person's refusal, at a missing code and at a different callback address, without calling Google", async () => {
    const ctx = setup();
    const state = await started(ctx);
    expect(await finishYoutubeConnection(ctx.deps, { userId: OWNER, origin: ORIGIN, code: null, state, error: "access_denied" })).toEqual({ ok: false, code: "access_denied" });
    expect(await finishYoutubeConnection(ctx.deps, { userId: OWNER, origin: ORIGIN, code: null, state, error: "weird" })).toEqual({ ok: false, code: "invalid_request" });
    expect(await finishYoutubeConnection(ctx.deps, { userId: OWNER, origin: ORIGIN, code: null, state, error: null })).toEqual({ ok: false, code: "invalid_request" });
    expect(await finishYoutubeConnection(ctx.deps, { userId: OWNER, origin: "https://evil.example.test", code: "c", state, error: null })).toEqual({ ok: false, code: "redirect_mismatch" });
    expect(ctx.google.calls).toHaveLength(0);
    expect(ctx.store.liveOf(T1)).toBeUndefined();
  });

  it("does not connect when Google rejects the code or is down, and says which", async () => {
    const rejected = setup({ google: { token: () => json({ error: "invalid_grant" }, 400) } });
    expect(await finishYoutubeConnection(rejected.deps, { userId: OWNER, origin: ORIGIN, code: "c", state: await started(rejected), error: null })).toEqual({ ok: false, code: "token_exchange_failed" });
    const down = setup({ google: { token: () => json({}, 503) } });
    expect(await finishYoutubeConnection(down.deps, { userId: OWNER, origin: ORIGIN, code: "c", state: await started(down), error: null })).toEqual({ ok: false, code: "provider_unavailable" });
    const gone = setup({ google: { token: () => { throw new Error("network down"); } } });
    expect(await finishYoutubeConnection(gone.deps, { userId: OWNER, origin: ORIGIN, code: "c", state: await started(gone), error: null })).toEqual({ ok: false, code: "provider_unavailable" });
    for (const ctx of [rejected, down, gone]) expect(ctx.store.liveOf(T1)).toBeUndefined();
  });

  it("is read only: a grant with any other scope, or without the read one, is refused, REVOKED and never stored", async () => {
    const upload = setup({ google: { token: () => json({ access_token: ACCESS, refresh_token: REFRESH, scope: `${YOUTUBE_READ_SCOPE} https://www.googleapis.com/auth/youtube.upload` }) } });
    expect(await finishYoutubeConnection(upload.deps, { userId: OWNER, origin: ORIGIN, code: "c", state: await started(upload), error: null })).toEqual({ ok: false, code: "unexpected_scope" });
    expect(upload.google.count("https://oauth2.googleapis.com/revoke")).toBe(1);
    expect(new URLSearchParams(upload.google.calls.at(-1)?.body).get("token")).toBe(REFRESH);
    const none = setup({ google: { token: () => json({ access_token: ACCESS, refresh_token: REFRESH, scope: "openid" }) } });
    expect(await finishYoutubeConnection(none.deps, { userId: OWNER, origin: ORIGIN, code: "c", state: await started(none), error: null })).toEqual({ ok: false, code: "unexpected_scope" });
    for (const ctx of [upload, none]) { expect(ctx.store.liveOf(T1)).toBeUndefined(); expect(ctx.google.count("https://www.googleapis.com/youtube/v3/channels")).toBe(0); }
  });

  it("needs a renewable permission: without a refresh token nothing is connected and the access token is revoked", async () => {
    const ctx = setup({ google: { token: () => json({ access_token: ACCESS, scope: YOUTUBE_READ_SCOPE }) } });
    expect(await finishYoutubeConnection(ctx.deps, { userId: OWNER, origin: ORIGIN, code: "c", state: await started(ctx), error: null })).toEqual({ ok: false, code: "no_refresh_token" });
    expect(ctx.google.count("https://oauth2.googleapis.com/revoke")).toBe(1);
    expect(ctx.store.liveOf(T1)).toBeUndefined();
  });

  it("is not connected when the Google account has no channel or the lookup fails: the grant is revoked and nothing is stored", async () => {
    const empty = setup({ google: { channels: () => json({ items: [] }) } });
    expect(await finishYoutubeConnection(empty.deps, { userId: OWNER, origin: ORIGIN, code: "c", state: await started(empty), error: null })).toEqual({ ok: false, code: "no_channel" });
    const failed = setup({ google: { channels: () => json({ error: { code: 403 } }, 403) } });
    expect(await finishYoutubeConnection(failed.deps, { userId: OWNER, origin: ORIGIN, code: "c", state: await started(failed), error: null })).toEqual({ ok: false, code: "channel_lookup_failed" });
    const down = setup({ google: { channels: () => json({}, 500) } });
    expect(await finishYoutubeConnection(down.deps, { userId: OWNER, origin: ORIGIN, code: "c", state: await started(down), error: null })).toEqual({ ok: false, code: "provider_unavailable" });
    for (const ctx of [empty, failed, down]) { expect(ctx.google.count("https://oauth2.googleapis.com/revoke")).toBe(1); expect(ctx.store.liveOf(T1)).toBeUndefined(); }
  });

  it("refuses a channel that another company already has, and revokes the grant", async () => {
    const ctx = setup({ admins: [OWNER] });
    ctx.store.rows.push({ tenantId: "another-company", status: "connected", accountId: "UCchannelAAAAAAAAAAAAA01", label: "x", tokenCt: "v1.AAAAAAAAAA.BBBBBBBBBB", errorCode: null });
    expect(await finishYoutubeConnection(ctx.deps, { userId: OWNER, origin: ORIGIN, code: "c", state: await started(ctx), error: null })).toEqual({ ok: false, code: "account_taken" });
    expect(ctx.google.count("https://oauth2.googleapis.com/revoke")).toBe(1);
    expect(ctx.store.liveOf(T1)).toBeUndefined();
  });
});

async function connected(options: Parameters<typeof setup>[0] = {}) {
  const ctx = setup(options);
  const result = await finishYoutubeConnection(ctx.deps, { userId: OWNER, origin: ORIGIN, code: "c", state: await started(ctx), error: null });
  if (!result.ok) throw new Error(result.code);
  ctx.google.calls.length = 0;
  return ctx;
}

describe("checking the authorization again", () => {
  it("refreshes the token, reads the channel again and keeps the connection (renamed channels are picked up)", async () => {
    const ctx = await connected();
    const google = fakeGoogle({ channels: () => json({ items: [{ id: CHANNEL.id, snippet: { title: "Nombre nuevo" } }] }) });
    expect(await verifyYoutubeConnection({ ...ctx.deps, fetcher: google.fetcher }, { tenantId: T1 })).toEqual({ ok: true, state: "connected", channel: { id: CHANNEL.id, title: "Nombre nuevo" } });
    expect(ctx.store.liveOf(T1)).toMatchObject({ status: "connected", label: "Nombre nuevo", errorCode: null });
    // a refresh (token endpoint, with the DECRYPTED refresh token) and then the channel lookup with the new access token
    expect(google.calls.map((call) => call.url.split("?")[0])).toEqual(["https://oauth2.googleapis.com/token", "https://www.googleapis.com/youtube/v3/channels"]);
    expect(new URLSearchParams(google.calls[0]?.body).get("refresh_token")).toBe(REFRESH);
    expect(new URLSearchParams(google.calls[0]?.body).get("grant_type")).toBe("refresh_token");
  });

  it("an authorization Google no longer honours becomes EXPIRED and the stored credential is wiped", async () => {
    const ctx = await connected({ google: {} });
    const dead = { ...ctx.deps, fetcher: fakeGoogle({ token: () => json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400) }).fetcher };
    expect(await verifyYoutubeConnection(dead, { tenantId: T1 })).toEqual({ ok: false, state: "expired", code: "invalid_grant" });
    expect(ctx.store.liveOf(T1)).toMatchObject({ status: "expired", tokenCt: null, errorCode: "invalid_grant" });
    // and nothing can use it any more
    expect(await ctx.store.store.secret(T1)).toBeNull();
    expect(await verifyYoutubeConnection(ctx.deps, { tenantId: T1 })).toEqual({ ok: false, state: "disconnected", code: "invalid_grant" });
  });

  it("a temporary failure reads as ERROR and keeps the credential; a 401 from the channel lookup is an expiry", async () => {
    const ctx = await connected();
    const down = { ...ctx.deps, fetcher: fakeGoogle({ token: () => json({}, 503) }).fetcher };
    expect(await verifyYoutubeConnection(down, { tenantId: T1 })).toEqual({ ok: false, state: "error", code: "provider_unavailable" });
    expect(ctx.store.liveOf(T1)).toMatchObject({ status: "error", errorCode: "provider_unavailable" });
    expect(ctx.store.liveOf(T1)?.tokenCt).not.toBeNull();
    const unauthorized = { ...ctx.deps, fetcher: fakeGoogle({ channels: () => json({}, 401) }).fetcher };
    expect(await verifyYoutubeConnection(unauthorized, { tenantId: T1 })).toEqual({ ok: false, state: "expired", code: "invalid_grant" });
    expect(ctx.store.liveOf(T1)?.tokenCt).toBeNull();
  });

  it("never switches identity silently: a different channel for the same token is an error", async () => {
    const ctx = await connected();
    const other = { ...ctx.deps, fetcher: fakeGoogle({ channels: () => json({ items: [{ id: "UCotherchannelXXXXXXXX1", snippet: { title: "Otro" } }] }) }).fetcher };
    expect(await verifyYoutubeConnection(other, { tenantId: T1 })).toEqual({ ok: false, state: "error", code: "no_channel" });
    expect(ctx.store.liveOf(T1)).toMatchObject({ status: "error", accountId: CHANNEL.id, label: "Canal de Prueba" });
  });

  it("a credential that cannot be opened (the key changed) is useless: it is wiped and the person authorizes again", async () => {
    const ctx = await connected();
    const rotated = { ...ctx.deps, config: { ...CONFIG, encryptionKey: generateEncryptionKey() } };
    expect(await verifyYoutubeConnection(rotated, { tenantId: T1 })).toEqual({ ok: false, state: "expired", code: "invalid_grant" });
    expect(ctx.store.liveOf(T1)?.tokenCt).toBeNull();
    expect(ctx.google.calls).toHaveLength(0);
  });
});

describe("disconnecting", () => {
  it("wipes the credential first, revokes it at Google and makes it unusable", async () => {
    const ctx = await connected();
    expect(await disconnectYoutubeConnection(ctx.deps, { tenantId: T1, userId: OWNER })).toEqual({ ok: true, revoked: true });
    expect(ctx.store.liveOf(T1)).toBeUndefined();
    expect(ctx.store.rows.every((row) => row.tokenCt === null)).toBe(true);
    expect(new URLSearchParams(ctx.google.calls.at(-1)?.body).get("token")).toBe(REFRESH); // the real refresh token, decrypted only to revoke it
    expect(await ctx.store.store.secret(T1)).toBeNull();
    // it can no longer be used: verifying makes no call to Google, and disconnecting again says there is nothing
    ctx.google.calls.length = 0;
    expect(await verifyYoutubeConnection(ctx.deps, { tenantId: T1 })).toMatchObject({ ok: false, state: "disconnected" });
    expect(ctx.google.calls).toHaveLength(0);
    expect(await disconnectYoutubeConnection(ctx.deps, { tenantId: T1, userId: OWNER })).toEqual({ ok: false, code: "not_connected" });
  });

  it("disconnects even when Google cannot be reached, and says the revocation was not confirmed", async () => {
    const ctx = await connected();
    const offline = { ...ctx.deps, fetcher: fakeGoogle({ revoke: () => { throw new Error("offline"); } }).fetcher };
    expect(await disconnectYoutubeConnection(offline, { tenantId: T1, userId: OWNER })).toEqual({ ok: true, revoked: false });
    expect(ctx.store.liveOf(T1)).toBeUndefined();
    expect(ctx.store.rows.every((row) => row.tokenCt === null)).toBe(true);
  });

  it("is refused to anyone who is not owner or administrator, and then nothing changes", async () => {
    const ctx = await connected();
    await expect(disconnectYoutubeConnection(ctx.deps, { tenantId: T1, userId: OTHER })).rejects.toMatchObject({ code: "forbidden" });
    expect(ctx.store.liveOf(T1)?.tokenCt).not.toBeNull();
    expect(ctx.google.calls).toHaveLength(0);
  });
});

describe("the files keep the rules", () => {
  it("nothing in the connection can publish or upload, and no secret is written in the code", async () => {
    const { readFileSync } = await import("node:fs");
    const files = ["lib/contracts/youtube-connection.ts", "lib/integrations/youtube/google.ts", "lib/integrations/youtube/connection.ts", "lib/integrations/youtube/server.ts", "lib/db/connector-connections.ts"];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/youtube\.upload|youtube\.force-ssl|\/upload\/youtube|videos\.insert|auth\/youtube["'`\s]|publishVideos/);
      expect(text, file).not.toMatch(/console\.(log|info|debug|warn|error)\(/);
      expect(text, file).not.toMatch(/GOCSPX-[A-Za-z0-9_-]{10,}|ya29\.[A-Za-z0-9_-]{20,}|1\/\/0[A-Za-z0-9_-]{20,}/);
    }
    // the connection reads its credentials only through the Secrets Manager
    expect(readFileSync("lib/integrations/youtube/server.ts", "utf8")).toContain("secrets.use(\"GOOGLE_CLIENT_SECRET\"");
    expect(readFileSync("lib/integrations/youtube/server.ts", "utf8")).not.toMatch(/process\.env/);
  });
});
