// The YouTube connection, end to end (ADR-0038), as plain functions over injected parts so every rule is tested without Google or a database: start the authorization, finish it when Google sends
// the person back, check it again later, and disconnect. Server only.
//
// What it guarantees:
//   - the only permission asked for is read-only (youtube.readonly); a grant with any other scope is refused and revoked, never stored;
//   - the person comes back with a `state` that only the server knows, hashed in the database, bound to the company AND the user that started it, short-lived and single use; the callback must be
//     made by that same signed-in user and to the very same address;
//   - "connected" exists only after Google itself answered with a channel for the authorized account (the id and name come from `channels.list`, never from the request);
//   - the refresh token is encrypted here (AES-GCM, bound to the company) before it reaches the database, is never returned, logged or sent to the browser, and is wiped on disconnect or expiry;
//   - an authorization that Google no longer honours reads as "expired" and its stored credential is wiped; a temporary failure reads as "error" and keeps it;
//   - nothing here publishes, uploads or generates anything.

import { decrypt, encrypt } from "@/lib/backend/crypto";
import {
  YOUTUBE_CONNECTOR_ID, YOUTUBE_READ_SCOPE, buildAuthorizeUrl, callbackUriFor,
  type FailureCode, type YoutubeChannel,
} from "@/lib/contracts/youtube-connection";
import { exchangeCode, fetchOwnChannel, refreshAccessToken, revokeToken, type Fetcher } from "./google";

export type YoutubeConfig = { clientId: string; clientSecret: string; encryptionKey: string };

/** What the database functions answer (lib/db/connector-connections.ts builds this over the server client). */
export interface ConnectionStore {
  begin(input: { tenantId: string; userId: string; stateHash: string; redirectUri: string }): Promise<void>;
  peek(stateHash: string, userId: string): Promise<{ ok: true; redirectUri: string; tenantId: string } | { ok: false; reason: "state_invalid" | "user_mismatch" }>;
  complete(input: { stateHash: string; userId: string; accountId: string; accountLabel: string; scopes: readonly string[]; tokenCt: string }): Promise<
    { ok: true; tenantId: string; accountId: string; accountLabel: string } | { ok: false; reason: "state_invalid" | "user_mismatch" | "forbidden" | "account_taken" }
  >;
  secret(tenantId: string): Promise<{ accountId: string; tokenCt: string } | null>;
  mark(tenantId: string, status: "connected" | "expired" | "error", errorCode?: string, accountLabel?: string): Promise<boolean>;
  disconnect(tenantId: string, userId: string): Promise<{ ok: true; accountId: string | null } | { ok: false; reason: "not_connected" }>;
}

export type YoutubeDeps = {
  /** null when the server lacks Google credentials or the encryption key (the names that are missing are in `missing`) */
  config: YoutubeConfig | null;
  missing: readonly string[];
  store: ConnectionStore;
  fetcher: Fetcher;
  /** a fresh unguessable value (at least 32 random bytes, base64url) */
  newState: () => string;
  sha256Hex: (value: string) => Promise<string>;
};

const STATE_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const aad = (tenantId: string) => `${tenantId}:${YOUTUBE_CONNECTOR_ID}`;

export type StartResult = { ok: true; url: string } | { ok: false; code: FailureCode; missing?: readonly string[] };

/** Starts a connection for the company of a signed-in user: stores the hashed state and returns Google's authorization address. The database refuses anyone who is not owner or administrator. */
export async function startYoutubeConnection(deps: YoutubeDeps, input: { tenantId: string; userId: string; origin: string }): Promise<StartResult> {
  if (!deps.config) return { ok: false, code: "not_configured", missing: deps.missing };
  const redirectUri = callbackUriFor(input.origin);
  if (!redirectUri) return { ok: false, code: "invalid_request" };
  const state = deps.newState();
  if (!STATE_SHAPE.test(state)) return { ok: false, code: "unavailable" };
  await deps.store.begin({ tenantId: input.tenantId, userId: input.userId, stateHash: await deps.sha256Hex(state), redirectUri });
  return { ok: true, url: buildAuthorizeUrl({ clientId: deps.config.clientId, redirectUri, state }) };
}

export type FinishResult = { ok: true; tenantId: string; channel: YoutubeChannel } | { ok: false; code: FailureCode };

/** Finishes the connection when Google sends the person back. `userId` is the signed-in user of THIS request. */
export async function finishYoutubeConnection(
  deps: YoutubeDeps, input: { userId: string; origin: string; code: string | null; state: string | null; error: string | null },
): Promise<FinishResult> {
  if (!deps.config) return { ok: false, code: "not_configured" };
  if (!input.state || !STATE_SHAPE.test(input.state)) return { ok: false, code: "state_invalid" };
  const stateHash = await deps.sha256Hex(input.state);
  // the state must belong to this user and still be valid BEFORE anything is spent at Google
  const pending = await deps.store.peek(stateHash, input.userId);
  if (!pending.ok) return { ok: false, code: pending.reason };
  if (input.error) return { ok: false, code: input.error === "access_denied" ? "access_denied" : "invalid_request" };
  if (!input.code || input.code.length > 2000) return { ok: false, code: "invalid_request" };
  const redirectUri = callbackUriFor(input.origin);
  if (!redirectUri || redirectUri !== pending.redirectUri) return { ok: false, code: "redirect_mismatch" };

  const { clientId, clientSecret, encryptionKey } = deps.config;
  const token = await exchangeCode(deps.fetcher, { code: input.code, clientId, clientSecret, redirectUri });
  if (!token.ok) return { ok: false, code: token.reason === "provider_unavailable" ? "provider_unavailable" : "token_exchange_failed" };
  const revokeAll = async () => { if (token.refreshToken) await revokeToken(deps.fetcher, token.refreshToken); else await revokeToken(deps.fetcher, token.accessToken); };
  // read only: refuse (and revoke) a grant that carries anything beyond the one scope asked for, or that does not carry it
  if (!token.scopes.includes(YOUTUBE_READ_SCOPE) || token.scopes.some((scope) => scope !== YOUTUBE_READ_SCOPE)) { await revokeAll(); return { ok: false, code: "unexpected_scope" }; }
  if (!token.refreshToken) { await revokeToken(deps.fetcher, token.accessToken); return { ok: false, code: "no_refresh_token" }; }

  // the channel comes from Google, for the account that authorized: this is the identity check
  const channel = await fetchOwnChannel(deps.fetcher, token.accessToken);
  if (!channel.ok) { await revokeAll(); return { ok: false, code: channel.reason === "invalid_grant" ? "token_exchange_failed" : channel.reason }; }

  const tokenCt = await encrypt(token.refreshToken, encryptionKey, aad(pending.tenantId));
  const done = await deps.store.complete({ stateHash, userId: input.userId, accountId: channel.channel.id, accountLabel: channel.channel.title, scopes: [YOUTUBE_READ_SCOPE], tokenCt });
  if (!done.ok) { await revokeAll(); return { ok: false, code: done.reason }; }
  if (done.tenantId !== pending.tenantId) { await revokeAll(); return { ok: false, code: "state_invalid" }; }
  return { ok: true, tenantId: done.tenantId, channel: { id: done.accountId, title: done.accountLabel } };
}

export type VerifyResult =
  | { ok: true; state: "connected"; channel: YoutubeChannel }
  | { ok: false; state: "expired" | "error" | "disconnected"; code: FailureCode };

/** Checks the authorization again with Google (refresh, then read the channel). Expired authorizations wipe their credential; temporary failures keep it. */
export async function verifyYoutubeConnection(deps: YoutubeDeps, input: { tenantId: string }): Promise<VerifyResult> {
  if (!deps.config) return { ok: false, state: "error", code: "not_configured" };
  const stored = await deps.store.secret(input.tenantId);
  if (!stored) return { ok: false, state: "disconnected", code: "invalid_grant" };
  const { clientId, clientSecret, encryptionKey } = deps.config;
  let refreshToken: string;
  try { refreshToken = await decrypt(stored.tokenCt, encryptionKey, aad(input.tenantId)); } catch {
    // the credential cannot be opened (the key changed): it is of no use, so it is wiped and the person authorizes again
    await deps.store.mark(input.tenantId, "expired", "credential_unreadable");
    return { ok: false, state: "expired", code: "invalid_grant" };
  }
  const refreshed = await refreshAccessToken(deps.fetcher, { refreshToken, clientId, clientSecret });
  if (!refreshed.ok) {
    if (refreshed.reason === "invalid_grant") { await deps.store.mark(input.tenantId, "expired", "invalid_grant"); return { ok: false, state: "expired", code: "invalid_grant" }; }
    const code = refreshed.reason === "provider_unavailable" ? "provider_unavailable" : "token_exchange_failed";
    await deps.store.mark(input.tenantId, "error", code);
    return { ok: false, state: "error", code };
  }
  const channel = await fetchOwnChannel(deps.fetcher, refreshed.accessToken);
  if (!channel.ok) {
    if (channel.reason === "invalid_grant") { await deps.store.mark(input.tenantId, "expired", "invalid_grant"); return { ok: false, state: "expired", code: "invalid_grant" }; }
    await deps.store.mark(input.tenantId, "error", channel.reason);
    return { ok: false, state: "error", code: channel.reason };
  }
  // the token must still belong to the channel that was connected; anything else is an error, never a silent switch of identity
  if (channel.channel.id !== stored.accountId) { await deps.store.mark(input.tenantId, "error", "channel_changed"); return { ok: false, state: "error", code: "no_channel" }; }
  await deps.store.mark(input.tenantId, "connected", undefined, channel.channel.title);
  return { ok: true, state: "connected", channel: channel.channel };
}

export type DisconnectResult = { ok: true; revoked: boolean } | { ok: false; code: "not_connected" | "forbidden" };

/** Disconnects. The credential is wiped in the database FIRST, so it cannot be used again whatever happens next; revoking it at Google follows, best effort. */
export async function disconnectYoutubeConnection(deps: YoutubeDeps, input: { tenantId: string; userId: string }): Promise<DisconnectResult> {
  const stored = await deps.store.secret(input.tenantId);
  const done = await deps.store.disconnect(input.tenantId, input.userId); // throws forbidden for a user who is not owner or administrator
  if (!done.ok) return { ok: false, code: "not_connected" };
  if (!stored || !deps.config) return { ok: true, revoked: false };
  let refreshToken: string;
  try { refreshToken = await decrypt(stored.tokenCt, deps.config.encryptionKey, aad(input.tenantId)); } catch { return { ok: true, revoked: false }; }
  return { ok: true, revoked: await revokeToken(deps.fetcher, refreshToken) };
}
