// The real connection of a YouTube channel (ADR-0038): what is shared between the server and the screen. Pure: no network, no secret, no clock.
// Read only: the single permission requested is `youtube.readonly` (it lets `channels.list?mine=true` name the channel the person authorized). Nothing here can upload, schedule or publish.
// Verified against Google's official documentation (2026-11): OAuth 2.0 for web server applications (authorization code + client secret, `access_type=offline` for a refresh token, `state` against forgery),
// `channels.list` (quota cost 1; `mine=true` accepts `youtube.readonly`) and the token revocation endpoint.

export const YOUTUBE_CONNECTOR_ID = "youtube";
/** The only scope ever requested. */
export const YOUTUBE_READ_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const YOUTUBE_CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels";
export const YOUTUBE_CALLBACK_PATH = "/api/v1/connections/youtube/callback";

/** What the person sees. `not_configured` is not a state of the connection: the server has no Google credentials yet. */
export const CONNECTION_STATES = ["disconnected", "connected", "expired", "error"] as const;
export type ConnectionState = (typeof CONNECTION_STATES)[number];

export type YoutubeChannel = { id: string; title: string };
export type YoutubeStatus = {
  /** whether the server has what it needs to start a real connection (Google credentials and the encryption key) */
  configured: boolean;
  /** the names (never the values) of what is missing */
  missing: readonly string[];
  state: ConnectionState;
  channel: YoutubeChannel | null;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
};

/** Failure codes of the OAuth return and of a verification: stable words, never a provider message. */
export const FAILURE_CODES = [
  "not_configured", "access_denied", "invalid_request", "state_invalid", "user_mismatch", "forbidden", "redirect_mismatch", "token_exchange_failed", "no_refresh_token", "unexpected_scope",
  "channel_lookup_failed", "no_channel", "account_taken", "provider_unavailable", "invalid_grant", "unavailable",
] as const;
export type FailureCode = (typeof FAILURE_CODES)[number];
export const isFailureCode = (value: unknown): value is FailureCode => typeof value === "string" && (FAILURE_CODES as readonly string[]).includes(value);

const CHANNEL_ID = /^[A-Za-z0-9_-]{1,100}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T/;

/** The callback address of an origin: only https, or http on localhost for development. Anything else is refused. */
export function callbackUriFor(origin: string): string | null {
  let url: URL;
  try { url = new URL(origin); } catch { return null; }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.endsWith(".localhost");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.username || url.password) return null;
  return `${url.origin}${YOUTUBE_CALLBACK_PATH}`;
}

/** The address the person is sent to, to authorize. The `state` is the server's single-use value; the client secret never appears here. */
export function buildAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_READ_SCOPE);
  url.searchParams.set("access_type", "offline"); // a refresh token, so the authorization can be checked later without the person
  url.searchParams.set("prompt", "consent"); // Google only returns a refresh token when it asks for consent
  url.searchParams.set("state", input.state);
  return url.toString();
}

export type TokenResult = { ok: true; accessToken: string; refreshToken: string | null; scopes: readonly string[] } | { ok: false; reason: "invalid_grant" | "bad_response" };

/** Reads the answer of Google's token endpoint. A refresh token may be absent (it is only sent when consent was asked for). */
export function parseTokenResponse(json: unknown): TokenResult {
  if (typeof json !== "object" || json === null) return { ok: false, reason: "bad_response" };
  const body = json as Record<string, unknown>;
  if (typeof body.error === "string") return { ok: false, reason: body.error === "invalid_grant" ? "invalid_grant" : "bad_response" };
  const accessToken = body.access_token;
  if (typeof accessToken !== "string" || accessToken.length < 10 || accessToken.length > 4096) return { ok: false, reason: "bad_response" };
  const refresh = body.refresh_token;
  const refreshToken = typeof refresh === "string" && refresh.length >= 10 && refresh.length <= 2048 ? refresh : null;
  const scopes = typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [];
  return { ok: true, accessToken, refreshToken, scopes };
}

/** The channel the authorized account owns: the first item of `channels.list?mine=true`, or null when the Google account has no YouTube channel. */
export function parseChannelsResponse(json: unknown): YoutubeChannel | null {
  if (typeof json !== "object" || json === null) return null;
  const items = (json as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const first = items[0] as { id?: unknown; snippet?: { title?: unknown } } | null;
  const id = first?.id;
  const title = first?.snippet?.title;
  if (typeof id !== "string" || !CHANNEL_ID.test(id) || typeof title !== "string" || title.trim().length === 0) return null;
  return { id, title: title.trim().slice(0, 200) };
}

/** The status answer of the database, shaped for the screen. Anything unexpected reads as disconnected: the screen never shows "connected" on a guess. */
export function parseConnectionStatus(raw: unknown, server: { configured: boolean; missing: readonly string[] }): YoutubeStatus {
  const base: YoutubeStatus = { configured: server.configured, missing: server.missing, state: "disconnected", channel: null, connectedAt: null, lastVerifiedAt: null, lastErrorCode: null };
  if (typeof raw !== "object" || raw === null) return base;
  const row = raw as Record<string, unknown>;
  const state = row.state;
  if (state !== "connected" && state !== "expired" && state !== "error") return base;
  const id = row.accountId;
  const title = row.accountLabel;
  const channel = typeof id === "string" && CHANNEL_ID.test(id) && typeof title === "string" && title.length > 0 ? { id, title } : null;
  // "connected" without a channel is not a connection
  if (state === "connected" && !channel) return base;
  const when = (value: unknown) => (typeof value === "string" && ISO.test(value) ? value : null);
  return { ...base, state, channel, connectedAt: when(row.connectedAt), lastVerifiedAt: when(row.lastVerifiedAt), lastErrorCode: typeof row.lastErrorCode === "string" && /^[a-z0-9_]{1,60}$/.test(row.lastErrorCode) ? row.lastErrorCode : null };
}

/** Sentences for the screen, by failure code. */
export const FAILURE_MESSAGES: Record<FailureCode, string> = {
  not_configured: "Faltan las credenciales de Google en el servidor.",
  access_denied: "No se autorizó el acceso en Google. Puedes intentarlo de nuevo.",
  invalid_request: "La respuesta de Google no era válida. Inténtalo de nuevo.",
  state_invalid: "La autorización expiró o ya se usó. Inicia la conexión de nuevo.",
  user_mismatch: "La autorización la inició otra persona. Inicia la conexión de nuevo.",
  forbidden: "Solo el propietario o un administrador puede conectar o desconectar el canal.",
  redirect_mismatch: "La dirección de retorno no coincide con la de la autorización.",
  token_exchange_failed: "Google no aceptó la autorización. Inicia la conexión de nuevo.",
  no_refresh_token: "Google no entregó un permiso renovable. Inicia la conexión de nuevo y acepta el acceso.",
  unexpected_scope: "Google concedió permisos distintos de los solicitados. No se conectó nada.",
  channel_lookup_failed: "No se pudo consultar el canal en YouTube. Inténtalo de nuevo.",
  no_channel: "La cuenta de Google que autorizaste no tiene un canal de YouTube.",
  account_taken: "Ese canal ya está conectado a otra empresa de KYNOVA.",
  provider_unavailable: "YouTube no respondió. Inténtalo de nuevo en unos minutos.",
  invalid_grant: "La autorización venció o fue revocada. Autoriza de nuevo.",
  unavailable: "No pudimos completar la operación. Inténtalo de nuevo.",
};
