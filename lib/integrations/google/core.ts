// Google Workspace Integration (Sprint 41), the core: the dependencies, the encrypted token vault, real OAuth (PKCE, refresh, revoke) and the one HTTP client that talks to Google.
// This is the FIRST real provider behind the Connectors architecture (Sprint 40). It talks to Google only through the injected `fetch`, reads the app's credentials only through the Secrets
// Manager (the `SecretsAccess` it is given), keeps tokens only in the vault (encrypted) and never lets a token, a code or a message body into an error or a log. Nothing here imports the
// Backend Core: the vault's cipher and the secrets are handed in, so this layer is wired to the Backend Core at the composition root (a route), not here.

// ---------------------------------------------------------------- what this layer is given
export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;
/** The Secrets Manager's door, as this layer needs it: a name is asked for the moment it is used, and its access is recorded by name and purpose. */
export interface SecretsAccess {
  has(name: string): boolean;
  use<T>(name: string, purpose: string, work: (secret: string) => Promise<T> | T): Promise<T>;
}
/** The cipher of the Backend Core's crypto (AES-GCM envelope with a context), handed in. */
export interface Cipher {
  encrypt(plain: string, context: string): Promise<string>;
  decrypt(envelope: string, context: string): Promise<string>;
}
export type StoredTokens = { accessToken: string; refreshToken?: string; expiresAt: number; scopes: readonly string[] };
/** Where tokens live. Only ciphertext is ever stored; the reference (`secret:oauth-...`) is all the rest of the platform sees. */
export interface TokenVault {
  put(ref: string, value: string): Promise<void>;
  get(ref: string): Promise<string | undefined>;
  delete(ref: string): Promise<void>;
  has(ref: string): Promise<boolean>;
}
/** A vault for tests and for the simulation: values are encrypted with the cipher, bound to their reference, and never readable in clear from outside. */
export class EncryptedMemoryVault implements TokenVault {
  private readonly rows = new Map<string, string>();
  constructor(private readonly cipher: Cipher) {}
  async put(ref: string, value: string): Promise<void> { this.rows.set(ref, await this.cipher.encrypt(value, ref)); }
  async get(ref: string): Promise<string | undefined> { const row = this.rows.get(ref); return row === undefined ? undefined : this.cipher.decrypt(row, ref); }
  async delete(ref: string): Promise<void> { this.rows.delete(ref); }
  async has(ref: string): Promise<boolean> { return this.rows.has(ref); }
  /** What is physically stored: ciphertext only (for the tests that prove no token is in clear). */
  rawRows(): readonly string[] { return [...this.rows.values()]; }
  references(): readonly string[] { return [...this.rows.keys()]; }
}
export type GoogleDeps = { fetchImpl: FetchLike; secrets: SecretsAccess; vault: TokenVault; now: () => number; sleep: (ms: number) => Promise<void> };

// ---------------------------------------------------------------- errors: a kind and a status, never a token, a code or a body
export const GOOGLE_ERROR_KINDS = ["auth", "scope", "rateLimit", "provider", "network", "notFound", "invalid", "notConfigured"] as const;
export type GoogleErrorKind = (typeof GOOGLE_ERROR_KINDS)[number];
export class GoogleApiError extends Error {
  constructor(readonly kind: GoogleErrorKind, message: string, readonly status?: number, readonly retryable = false) { super(message); this.name = "GoogleApiError"; }
}
export const errorKindOf = (error: unknown): GoogleErrorKind => (error instanceof GoogleApiError ? error.kind : "provider");

// ---------------------------------------------------------------- small encoders
const bytesToBinary = (bytes: Uint8Array) => { const parts: string[] = []; for (let index = 0; index < bytes.length; index += 8_192) parts.push(String.fromCharCode(...bytes.subarray(index, index + 8_192))); return parts.join(""); };
export const utf8 = (text: string) => new TextEncoder().encode(text);
export const base64 = (bytes: Uint8Array): string => btoa(bytesToBinary(bytes));
export const base64Url = (bytes: Uint8Array): string => base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const fromBase64Url = (text: string): Uint8Array => { const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "="); return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)); };
export const decodeUtf8 = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

// ---------------------------------------------------------------- Google's endpoints (REFERENCE values: verified against the documentation at the first real connection)
export const GOOGLE_ENDPOINTS = { token: "https://oauth2.googleapis.com/token", revoke: "https://oauth2.googleapis.com/revoke", gmail: "https://gmail.googleapis.com/gmail/v1", calendar: "https://www.googleapis.com/calendar/v3", drive: "https://www.googleapis.com/drive/v3", driveUpload: "https://www.googleapis.com/upload/drive/v3" } as const;
export const CLIENT_ID_SECRET = "GOOGLE_CLIENT_ID";
export const CLIENT_SECRET_SECRET = "GOOGLE_CLIENT_SECRET";
export const REFRESH_SKEW_MS = 5 * 60_000;

// ---------------------------------------------------------------- OAuth with PKCE
export type Pkce = { verifier: string; challenge: string };
/** A PKCE pair: a random verifier and its S256 challenge. The verifier stays on the server (in the vault) until the callback. */
export async function generatePkce(): Promise<Pkce> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", utf8(verifier))));
  return { verifier, challenge };
}
export const randomState = (): string => base64Url(crypto.getRandomValues(new Uint8Array(24)));
const pkceKey = (state: string) => `pkce:${state}`;

/** Remembers the PKCE verifier for the one state of this authorization, so only the callback that carries that state can finish it. */
export async function rememberVerifier(deps: GoogleDeps, state: string, verifier: string): Promise<void> { await deps.vault.put(pkceKey(state), JSON.stringify({ verifier, at: deps.now() })); }

/** The authorization URL the person is sent to: the connector reducer's parameters plus the client id, which is read from the Secrets Manager only now. */
export async function authorizationUrl(deps: GoogleDeps, authorization: { baseUrl: string; params: Readonly<Record<string, string>>; clientIdSecret: string }): Promise<string> {
  if (!deps.secrets.has(authorization.clientIdSecret)) throw new GoogleApiError("notConfigured", "Falta configurar la aplicación de KYNOVA con Google (secretos en Wrangler).");
  return deps.secrets.use(authorization.clientIdSecret, "google:authorize", (clientId) => {
    const url = new URL(authorization.baseUrl);
    for (const [key, value] of Object.entries({ client_id: clientId, ...authorization.params })) url.searchParams.set(key, value);
    return url.toString();
  });
}

async function tokenRequest(deps: GoogleDeps, params: Record<string, string>, purpose: string): Promise<Record<string, unknown>> {
  if (!deps.secrets.has(CLIENT_ID_SECRET) || !deps.secrets.has(CLIENT_SECRET_SECRET)) throw new GoogleApiError("notConfigured", "Falta configurar la aplicación de KYNOVA con Google (secretos en Wrangler).");
  const body = await deps.secrets.use(CLIENT_ID_SECRET, purpose, (clientId) => deps.secrets.use(CLIENT_SECRET_SECRET, purpose, (clientSecret) => new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }).toString()));
  let response: Response;
  try { response = await deps.fetchImpl(GOOGLE_ENDPOINTS.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body }); } catch { throw new GoogleApiError("network", "No se pudo contactar a Google.", undefined, true); }
  let json: Record<string, unknown> = {};
  try { json = (await response.json()) as Record<string, unknown>; } catch { json = {}; }
  if (!response.ok) {
    const code = typeof json["error"] === "string" ? json["error"] : "";
    if (code === "invalid_grant" || code === "invalid_client" || code === "unauthorized_client") throw new GoogleApiError("auth", "Google ya no acepta este acceso: hay que autorizar de nuevo.", response.status, false);
    throw new GoogleApiError(response.status === 429 ? "rateLimit" : response.status >= 500 ? "provider" : "invalid", "Google rechazó la solicitud de acceso.", response.status, response.status === 429 || response.status >= 500);
  }
  return json;
}
const parseTokens = (json: Record<string, unknown>, now: number, previous?: StoredTokens): StoredTokens => {
  const accessToken = typeof json["access_token"] === "string" ? json["access_token"] : "";
  const expiresIn = typeof json["expires_in"] === "number" ? json["expires_in"] : 3_600;
  const refreshToken = typeof json["refresh_token"] === "string" ? json["refresh_token"] : previous?.refreshToken;
  const scopes = typeof json["scope"] === "string" ? json["scope"].split(" ").filter(Boolean) : (previous?.scopes ?? []);
  if (!accessToken) throw new GoogleApiError("invalid", "Google no entregó un acceso válido.");
  return { accessToken, ...(refreshToken ? { refreshToken } : {}), expiresAt: now + expiresIn * 1_000, scopes };
};
const readTokens = async (deps: GoogleDeps, ref: string): Promise<StoredTokens | undefined> => { const raw = await deps.vault.get(ref); if (!raw) return undefined; try { return JSON.parse(raw) as StoredTokens; } catch { return undefined; } };

/** Finishes the authorization: exchanges the code (with the PKCE verifier remembered for THIS state, once) and puts the tokens in the vault under `tokenRef`. Returns only the scopes Google granted. */
export async function completeAuthorization(deps: GoogleDeps, input: { state: string; code: string; redirectUri: string; tokenRef: string }): Promise<{ grantedScopes: readonly string[]; expiresAt: number }> {
  const remembered = await deps.vault.get(pkceKey(input.state));
  if (!remembered) throw new GoogleApiError("auth", "La autorización no existe o ya se usó.");
  await deps.vault.delete(pkceKey(input.state)); // single use, even when the exchange fails
  const { verifier } = JSON.parse(remembered) as { verifier: string };
  const json = await tokenRequest(deps, { grant_type: "authorization_code", code: input.code, code_verifier: verifier, redirect_uri: input.redirectUri }, "google:token-exchange");
  const tokens = parseTokens(json, deps.now());
  if (!tokens.refreshToken) throw new GoogleApiError("auth", "Google no entregó el permiso para renovar el acceso: hay que autorizar de nuevo con consentimiento.");
  await deps.vault.put(input.tokenRef, JSON.stringify(tokens));
  return { grantedScopes: tokens.scopes, expiresAt: tokens.expiresAt };
}

/** Renews the access token with the refresh token. A refused grant means Google revoked the access: the tokens are deleted and the caller must send the person to authorize again. */
export async function refreshAccessToken(deps: GoogleDeps, tokenRef: string): Promise<{ expiresAt: number }> {
  const current = await readTokens(deps, tokenRef);
  if (!current?.refreshToken) throw new GoogleApiError("auth", "No hay un acceso que renovar: hay que autorizar de nuevo.");
  try {
    const json = await tokenRequest(deps, { grant_type: "refresh_token", refresh_token: current.refreshToken }, "google:token-refresh");
    const next = parseTokens(json, deps.now(), current);
    await deps.vault.put(tokenRef, JSON.stringify(next));
    return { expiresAt: next.expiresAt };
  } catch (error) {
    if (error instanceof GoogleApiError && error.kind === "auth") await deps.vault.delete(tokenRef);
    throw error;
  }
}

/** The access token to use now: renewed automatically when it expires within five minutes. */
export async function accessToken(deps: GoogleDeps, tokenRef: string, force = false): Promise<string> {
  let tokens = await readTokens(deps, tokenRef);
  if (!tokens) throw new GoogleApiError("auth", "No hay acceso a Google para esta conexión: hay que autorizar.");
  if (force || tokens.expiresAt - deps.now() <= REFRESH_SKEW_MS) { await refreshAccessToken(deps, tokenRef); tokens = await readTokens(deps, tokenRef); }
  if (!tokens) throw new GoogleApiError("auth", "No hay acceso a Google para esta conexión: hay que autorizar.");
  return tokens.accessToken;
}
export const grantedGoogleScopes = async (deps: GoogleDeps, tokenRef: string): Promise<readonly string[]> => (await readTokens(deps, tokenRef))?.scopes ?? [];

/** Revokes the access at Google and deletes the tokens. The tokens are deleted even if Google cannot be reached: a disconnected company must hold nothing. */
export async function revokeAccess(deps: GoogleDeps, tokenRef: string): Promise<{ revokedAtGoogle: boolean }> {
  const tokens = await readTokens(deps, tokenRef);
  let revokedAtGoogle = false;
  const token = tokens?.refreshToken ?? tokens?.accessToken;
  if (token) {
    try { const response = await deps.fetchImpl(GOOGLE_ENDPOINTS.revoke, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }).toString() }); revokedAtGoogle = response.ok; } catch { revokedAtGoogle = false; }
  }
  await deps.vault.delete(tokenRef);
  return { revokedAtGoogle };
}

// ---------------------------------------------------------------- the one HTTP client
export type RequestOptions = { method?: string; url: string; query?: Record<string, string | number | boolean | undefined>; json?: unknown; rawBody?: string; headers?: Record<string, string>; as?: "json" | "none" };
const reasonOf = (json: unknown): string => {
  const error = (json as { error?: { errors?: { reason?: string }[]; status?: string } } | undefined)?.error;
  return `${error?.errors?.[0]?.reason ?? ""} ${error?.status ?? ""}`.trim();
};
function mapStatus(status: number, json: unknown): GoogleApiError {
  const reason = reasonOf(json);
  if (status === 401) return new GoogleApiError("auth", "Google no aceptó el acceso.", status);
  if (status === 403 && /rateLimit|quota|RESOURCE_EXHAUSTED/i.test(reason)) return new GoogleApiError("rateLimit", "Google pidió esperar (cuota).", status, true);
  if (status === 403) return new GoogleApiError("scope", "El acceso concedido no permite esta operación.", status);
  if (status === 404) return new GoogleApiError("notFound", "Google no encontró el elemento.", status);
  if (status === 429) return new GoogleApiError("rateLimit", "Google pidió esperar.", status, true);
  if (status >= 500) return new GoogleApiError("provider", "Google no pudo responder.", status, true);
  return new GoogleApiError("invalid", "Google rechazó la solicitud.", status);
}
const MAX_ATTEMPTS = 3;
/** Calls Google as the connection: the access token is renewed on its own, a 401 renews it once and retries, a rate limit or a Google failure is retried with a short wait, and an error never carries a body. */
export async function googleRequest<T = unknown>(deps: GoogleDeps, tokenRef: string, options: RequestOptions): Promise<T> {
  const url = new URL(options.url);
  for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) url.searchParams.set(key, String(value));
  let refreshedOn401 = false;
  for (let attempt = 1; ; attempt += 1) {
    const token = await accessToken(deps, tokenRef);
    let response: Response;
    try {
      response = await deps.fetchImpl(url.toString(), { method: options.method ?? "GET", headers: { authorization: `Bearer ${token}`, ...(options.json !== undefined ? { "content-type": "application/json" } : {}), ...options.headers }, ...(options.json !== undefined ? { body: JSON.stringify(options.json) } : options.rawBody !== undefined ? { body: options.rawBody } : {}) });
    } catch {
      if (attempt < MAX_ATTEMPTS) { await deps.sleep(200 * attempt); continue; }
      throw new GoogleApiError("network", "No se pudo contactar a Google.", undefined, true);
    }
    if (response.ok) { if (options.as === "none" || response.status === 204) return undefined as T; try { return (await response.json()) as T; } catch { throw new GoogleApiError("provider", "Google respondió algo ilegible.", response.status, true); } }
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    const mapped = mapStatus(response.status, body);
    if (mapped.kind === "auth" && !refreshedOn401) { refreshedOn401 = true; await accessToken(deps, tokenRef, true); continue; }
    if (mapped.retryable && attempt < MAX_ATTEMPTS) { await deps.sleep(200 * attempt); continue; }
    throw mapped;
  }
}
