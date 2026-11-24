// The calls to Google for the YouTube connection (ADR-0038): exchange the authorization code, refresh an access token, read the authorized account's channel and revoke a token. Server only.
// `fetch` is injected so the tests never reach Google. Nothing here logs, throws or returns a provider's body, a token or the client secret: every failure is a short typed result.

import {
  GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL, YOUTUBE_CHANNELS_URL, parseChannelsResponse, parseTokenResponse,
  type TokenResult, type YoutubeChannel,
} from "@/lib/contracts/youtube-connection";

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
const TIMEOUT_MS = 10_000;

const form = (values: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(values).toString(),
  signal: AbortSignal.timeout(TIMEOUT_MS),
  cache: "no-store",
});

async function jsonOf(response: Response): Promise<unknown> {
  try { return await response.json(); } catch { return null; }
}

/** The token endpoint: `invalid_grant` is the one answer that means "this authorization no longer works"; any other failure is the provider's or the network's. */
async function tokenCall(fetcher: Fetcher, values: Record<string, string>): Promise<TokenResult | { ok: false; reason: "provider_unavailable" }> {
  let response: Response;
  try { response = await fetcher(GOOGLE_TOKEN_URL, form(values)); } catch { return { ok: false, reason: "provider_unavailable" }; }
  if (response.status >= 500 || response.status === 429) return { ok: false, reason: "provider_unavailable" };
  return parseTokenResponse(await jsonOf(response));
}

export const exchangeCode = (fetcher: Fetcher, input: { code: string; clientId: string; clientSecret: string; redirectUri: string }) =>
  tokenCall(fetcher, { code: input.code, client_id: input.clientId, client_secret: input.clientSecret, redirect_uri: input.redirectUri, grant_type: "authorization_code" });

export const refreshAccessToken = (fetcher: Fetcher, input: { refreshToken: string; clientId: string; clientSecret: string }) =>
  tokenCall(fetcher, { refresh_token: input.refreshToken, client_id: input.clientId, client_secret: input.clientSecret, grant_type: "refresh_token" });

export type ChannelResult = { ok: true; channel: YoutubeChannel } | { ok: false; reason: "no_channel" | "provider_unavailable" | "channel_lookup_failed" | "invalid_grant" };

/** `channels.list?part=snippet&mine=true`: the channel of the authorized account (quota cost 1). A 401 means the access token no longer works. */
export async function fetchOwnChannel(fetcher: Fetcher, accessToken: string): Promise<ChannelResult> {
  let response: Response;
  try {
    response = await fetcher(`${YOUTUBE_CHANNELS_URL}?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    return { ok: false, reason: "provider_unavailable" };
  }
  if (response.status === 401) return { ok: false, reason: "invalid_grant" };
  if (response.status >= 500 || response.status === 429) return { ok: false, reason: "provider_unavailable" };
  if (!response.ok) return { ok: false, reason: "channel_lookup_failed" };
  const channel = parseChannelsResponse(await jsonOf(response));
  return channel ? { ok: true, channel } : { ok: false, reason: "no_channel" };
}

/** Revokes a token at Google. Best effort: the answer only says whether Google confirmed it, and the caller never depends on it to stop using a credential. */
export async function revokeToken(fetcher: Fetcher, token: string): Promise<boolean> {
  try {
    const response = await fetcher(GOOGLE_REVOKE_URL, form({ token }));
    return response.ok;
  } catch {
    return false;
  }
}
