// Real World Integrations (Sprint 40): the architecture that lets AI agents work on the tools a company already uses (Gmail, Outlook, Google and Microsoft Calendar, Google Drive, OneDrive,
// WhatsApp Business, Facebook Pages, Instagram Business, LinkedIn Company, YouTube and TikTok Business). It is ARCHITECTURE ONLY: every adapter is simulated and none reaches a provider.
// Pure and deterministic like every platform module: `reduceConnectors(state, event)` is the only way the state changes.
//
// What it guarantees:
//   - one interface for every connector (`ConnectorAdapter`) and one manifest per connector: provider, OAuth endpoints and scopes (reference values to verify), what it can sync and what it can do;
//   - four states for people (Connected, Disconnected, Pending Authorization, Error) over the platform's own connection states and transitions (integrations.ts);
//   - OAuth prepared, never credentials typed by hand: a person starts the flow, the provider's callback finishes it, the state is single-use, short-lived and bound to the company; the tokens
//     live outside this state (only a `secret:` reference is kept) and the app's client id and secret come from the Secrets Manager (names only are read here);
//   - each company authorizes only its OWN accounts, and an external account can belong to one company at a time;
//   - AI agents never talk to a provider: Agent -> Worker -> Connector -> Provider. A request must come from a Worker; reading needs a permission; anything that leaves the platform (send, publish,
//     write) is Level 3: it waits for a person, never runs on its own;
//   - sync for emails, events, files, messages, videos, posts, leads and comments (counts and cursors only, never content), renewal of tokens, errors and retries, health per provider group,
//     an append-only audit trail in the shape the Backend Core's Event Bus connector reads, and isolation by company.
// It reuses the platform's connection states and transitions and its grant model, and it touches nothing of KOE, the AI Gateway, the Runtime, the Backend Core, the Financial Router, the Business
// Templates or the Business Architect (ADR-0024).

import { isPerson } from "./actors";
import type { Grant } from "./connection";
import { canTransitionConnection, type ConnectionStatus } from "./integrations";

// ---------------------------------------------------------------- the catalog
export const CONNECTOR_IDS = ["gmail", "outlook", "googleCalendar", "msCalendar", "googleDrive", "onedrive", "whatsapp", "facebook", "instagram", "linkedin", "youtube", "tiktok"] as const;
export type ConnectorId = (typeof CONNECTOR_IDS)[number];
/** Who owns the OAuth app KYNOVA registers: one set of credentials (in the Secrets Manager) per family. */
export const PROVIDER_FAMILIES = ["google", "microsoft", "meta", "linkedin", "tiktok"] as const;
export type ProviderFamily = (typeof PROVIDER_FAMILIES)[number];
/** The health groups people see. */
export const HEALTH_GROUPS = ["google", "microsoft", "meta", "youtube", "whatsapp", "linkedin", "tiktok", "drive"] as const;
export type HealthGroup = (typeof HEALTH_GROUPS)[number];
export const HEALTH_LABELS: Record<HealthGroup, string> = { google: "Google", microsoft: "Microsoft", meta: "Meta", youtube: "YouTube", whatsapp: "WhatsApp", linkedin: "LinkedIn", tiktok: "TikTok", drive: "Drive" };
export const SYNC_KINDS = ["emails", "events", "files", "messages", "videos", "posts", "leads", "comments"] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];

export type ConnectorScope = { id: string; label: string; effect: "read" | "write"; oauth: string; syncs: readonly SyncKind[] };
export type ConnectorManifest = {
  id: ConnectorId; label: string; provider: string; family: ProviderFamily; group: HealthGroup; category: "email" | "calendar" | "files" | "messaging" | "social" | "video";
  authKind: "oauth2" | "embeddedSignup"; authorizeUrl: string; scopes: readonly ConnectorScope[]; syncKinds: readonly SyncKind[]; toVerify: readonly string[];
};
const read = (id: string, label: string, oauth: string, syncs: readonly SyncKind[]): ConnectorScope => ({ id, label, effect: "read", oauth, syncs });
const write = (id: string, label: string, oauth: string): ConnectorScope => ({ id, label, effect: "write", oauth, syncs: [] });
const GOOGLE = "https://accounts.google.com/o/oauth2/v2/auth";
const MICROSOFT = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const META = "https://www.facebook.com/dialog/oauth";
const LINKEDIN = "https://www.linkedin.com/oauth/v2/authorization";
const TIKTOK = "https://www.tiktok.com/v2/auth/authorize/";
const manifest = (value: Omit<ConnectorManifest, "syncKinds">): ConnectorManifest => ({ ...value, syncKinds: [...new Set(value.scopes.flatMap((item) => item.syncs))] });
/** Endpoints, scope names and review requirements are REFERENCE values taken from each provider's public documentation as known today: verify them in each provider's own sprint. */
export const CONNECTORS: Record<ConnectorId, ConnectorManifest> = {
  gmail: manifest({ id: "gmail", label: "Gmail", provider: "Google", family: "google", group: "google", category: "email", authKind: "oauth2", authorizeUrl: GOOGLE,
    scopes: [read("readMail", "Leer correos", "https://www.googleapis.com/auth/gmail.readonly", ["emails"]), write("sendMail", "Enviar correos", "https://www.googleapis.com/auth/gmail.send")],
    toVerify: ["Verificación de la app de Google para permisos restringidos", "Auditoría de seguridad anual para leer correo", "Cuotas y notificaciones push (Pub/Sub)"] }),
  outlook: manifest({ id: "outlook", label: "Outlook", provider: "Microsoft", family: "microsoft", group: "microsoft", category: "email", authKind: "oauth2", authorizeUrl: MICROSOFT,
    scopes: [read("readMail", "Leer correos", "Mail.Read", ["emails"]), write("sendMail", "Enviar correos", "Mail.Send")], toVerify: ["Consentimiento del administrador del tenant de la empresa", "Verificación del editor", "Suscripciones (webhooks) y su renovación"] }),
  googleCalendar: manifest({ id: "googleCalendar", label: "Google Calendar", provider: "Google", family: "google", group: "google", category: "calendar", authKind: "oauth2", authorizeUrl: GOOGLE,
    scopes: [read("readEvents", "Leer eventos", "https://www.googleapis.com/auth/calendar.readonly", ["events"]), write("writeEvents", "Crear y cambiar eventos", "https://www.googleapis.com/auth/calendar.events")], toVerify: ["Canales de notificación y su renovación", "Zonas horarias y eventos recurrentes"] }),
  msCalendar: manifest({ id: "msCalendar", label: "Microsoft Calendar", provider: "Microsoft", family: "microsoft", group: "microsoft", category: "calendar", authKind: "oauth2", authorizeUrl: MICROSOFT,
    scopes: [read("readEvents", "Leer eventos", "Calendars.Read", ["events"]), write("writeEvents", "Crear y cambiar eventos", "Calendars.ReadWrite")], toVerify: ["Suscripciones de cambios y su renovación", "Calendarios compartidos"] }),
  googleDrive: manifest({ id: "googleDrive", label: "Google Drive", provider: "Google", family: "google", group: "drive", category: "files", authKind: "oauth2", authorizeUrl: GOOGLE,
    scopes: [read("readFiles", "Leer archivos", "https://www.googleapis.com/auth/drive.readonly", ["files"]), write("writeFiles", "Crear y cambiar archivos", "https://www.googleapis.com/auth/drive.file")], toVerify: ["Alcances restringidos y su verificación", "Cambios por token de página", "Archivos compartidos y permisos"] }),
  onedrive: manifest({ id: "onedrive", label: "OneDrive", provider: "Microsoft", family: "microsoft", group: "drive", category: "files", authKind: "oauth2", authorizeUrl: MICROSOFT,
    scopes: [read("readFiles", "Leer archivos", "Files.Read", ["files"]), write("writeFiles", "Crear y cambiar archivos", "Files.ReadWrite")], toVerify: ["Delta de cambios", "Archivos de SharePoint de la empresa"] }),
  whatsapp: manifest({ id: "whatsapp", label: "WhatsApp Business", provider: "Meta", family: "meta", group: "whatsapp", category: "messaging", authKind: "embeddedSignup", authorizeUrl: META,
    scopes: [read("receiveMessages", "Recibir mensajes", "whatsapp_business_management", ["messages", "leads"]), write("sendMessages", "Enviar mensajes y plantillas", "whatsapp_business_messaging")],
    toVerify: ["Alta con el registro integrado de Meta y verificación del negocio", "Ventana de 24 h y plantillas aprobadas", "Opt-in del contacto", "Límites de calidad y de tasa"] }),
  facebook: manifest({ id: "facebook", label: "Facebook Pages", provider: "Meta", family: "meta", group: "meta", category: "social", authKind: "oauth2", authorizeUrl: META,
    scopes: [read("readPages", "Leer la página, mensajes, comentarios y leads", "pages_read_engagement", ["messages", "posts", "comments", "leads"]), write("publishPosts", "Publicar y responder", "pages_manage_posts")],
    toVerify: ["Revisión de la app y acceso avanzado", "Verificación del negocio", "Tokens de página de larga duración"] }),
  instagram: manifest({ id: "instagram", label: "Instagram Business", provider: "Meta", family: "meta", group: "meta", category: "social", authKind: "oauth2", authorizeUrl: META,
    scopes: [read("readAccount", "Leer publicaciones, mensajes y comentarios", "instagram_basic", ["messages", "posts", "comments"]), write("publishPosts", "Publicar y responder", "instagram_content_publish")],
    toVerify: ["Cuenta profesional vinculada a una página de Facebook", "Misma revisión de Meta", "Límites de publicación por día"] }),
  linkedin: manifest({ id: "linkedin", label: "LinkedIn Company", provider: "LinkedIn", family: "linkedin", group: "linkedin", category: "social", authKind: "oauth2", authorizeUrl: LINKEDIN,
    scopes: [read("readCompany", "Leer publicaciones, comentarios y leads de la empresa", "r_organization_social", ["posts", "comments", "leads"]), write("publishPosts", "Publicar en la página", "w_organization_social")],
    toVerify: ["Acceso a la plataforma de marketing (programa de partners)", "Rol de administrador de la página", "Formularios de captación de leads"] }),
  youtube: manifest({ id: "youtube", label: "YouTube", provider: "Google", family: "google", group: "youtube", category: "video", authKind: "oauth2", authorizeUrl: GOOGLE,
    scopes: [read("readChannel", "Leer videos y comentarios", "https://www.googleapis.com/auth/youtube.readonly", ["videos", "comments"]), write("publishVideos", "Subir y programar videos", "https://www.googleapis.com/auth/youtube.upload")],
    toVerify: ["Auditoría de la API para subir videos públicos", "Cuota diaria de la API", "Analítica por el API de YouTube Analytics"] }),
  tiktok: manifest({ id: "tiktok", label: "TikTok Business", provider: "TikTok", family: "tiktok", group: "tiktok", category: "video", authKind: "oauth2", authorizeUrl: TIKTOK,
    scopes: [read("readAccount", "Leer videos, comentarios y leads", "video.list", ["videos", "comments", "leads"]), write("publishVideos", "Publicar videos", "video.publish")],
    toVerify: ["Aprobación de la app y de cada permiso", "Diferencias entre la API de contenido y la de marketing", "Auditoría para publicar públicamente"] }),
};
export const connectorById = (id: string): ConnectorManifest | undefined => (CONNECTOR_IDS as readonly string[]).includes(id) ? CONNECTORS[id as ConnectorId] : undefined;

// ---------------------------------------------------------------- the uniform adapter interface (every adapter is simulated: none connects)
export type ConnectorResult<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; kind: "notConnected" | "auth" | "rateLimit" | "provider" | "network" };
/** The contract every connector will implement. Today every adapter answers `notConnected`: nothing in this module calls one, and real tokens never pass through the state. */
export interface ConnectorAdapter {
  readonly id: ConnectorId;
  readonly label: string;
  readonly provider: string;
  readonly connected: boolean;
  readonly manifest: ConnectorManifest;
  /** Exchanges the code of the callback (with the PKCE verifier) and hands the tokens to the vault; returns only the account and the scopes the provider granted. */
  exchangeCode(input: { code: string; codeVerifier: string; redirectUri: string }): Promise<ConnectorResult<{ accountId: string; accountLabel: string; grantedScopes: readonly string[] }>>;
  refreshToken(input: { tokenRef: string }): Promise<ConnectorResult<{ expiresAt: string }>>;
  revoke(input: { tokenRef: string }): Promise<ConnectorResult>;
  sync(input: { tokenRef: string; kind: SyncKind; cursor?: string }): Promise<ConnectorResult<{ items: number; cursor: string }>>;
  perform(input: { tokenRef: string; scope: string; operation: string }): Promise<ConnectorResult>;
}
const simulated = (item: ConnectorManifest): ConnectorAdapter => {
  const refuse = async (): Promise<{ ok: false; kind: "notConnected" }> => ({ ok: false, kind: "notConnected" });
  return { id: item.id, label: item.label, provider: item.provider, connected: false, manifest: item, exchangeCode: refuse, refreshToken: refuse, revoke: refuse, sync: refuse, perform: refuse };
};
export const ADAPTERS: readonly ConnectorAdapter[] = CONNECTOR_IDS.map((id) => simulated(CONNECTORS[id]));

// ---------------------------------------------------------------- the app's credentials come from the Secrets Manager (names only are read here)
export const FAMILY_SECRETS: Record<ProviderFamily, { clientId: string; clientSecret: string }> = {
  google: { clientId: "GOOGLE_CLIENT_ID", clientSecret: "GOOGLE_CLIENT_SECRET" }, microsoft: { clientId: "MICROSOFT_CLIENT_ID", clientSecret: "MICROSOFT_CLIENT_SECRET" },
  meta: { clientId: "META_APP_ID", clientSecret: "META_APP_SECRET" }, linkedin: { clientId: "LINKEDIN_CLIENT_ID", clientSecret: "LINKEDIN_CLIENT_SECRET" }, tiktok: { clientId: "TIKTOK_CLIENT_KEY", clientSecret: "TIKTOK_CLIENT_SECRET" },
};
export const CONNECTOR_SECRET_NAMES: readonly string[] = PROVIDER_FAMILIES.flatMap((family) => [FAMILY_SECRETS[family].clientId, FAMILY_SECRETS[family].clientSecret]);
/** What the Secrets Manager can answer: only whether a name is configured. The values never reach this module. */
export type SecretsView = { has(name: string): boolean };
export type ConnectorEnv = { configuredFamilies: readonly ProviderFamily[]; workers: readonly { tenantId: string; id: string; status: string }[] };
export const noConnectorEnv: ConnectorEnv = { configuredFamilies: [], workers: [] };
/** Which provider families have BOTH halves of their app credentials configured. Names only. */
export const configuredFamilies = (secrets: SecretsView): ProviderFamily[] => PROVIDER_FAMILIES.filter((family) => secrets.has(FAMILY_SECRETS[family].clientId) && secrets.has(FAMILY_SECRETS[family].clientSecret));
export const missingSecretNames = (secrets: SecretsView): string[] => CONNECTOR_SECRET_NAMES.filter((name) => !secrets.has(name));

// ---------------------------------------------------------------- state
export type DisplayStatus = "Connected" | "Disconnected" | "Pending Authorization" | "Error";
/** The four states people see, over the platform's own connection states. */
export function displayStatus(status: ConnectionStatus): DisplayStatus {
  if (status === "active") return "Connected";
  if (status === "pending") return "Pending Authorization";
  if (status === "error" || status === "degraded") return "Error";
  return "Disconnected";
}
export type ConnectorError = { at: string; kind: "auth" | "rateLimit" | "provider" | "network"; message: string; retryable: boolean };
export type OAuthFlow = { state: string; codeChallenge: string; redirectUri: string; startedAt: string; expiresAt: string };
export type Connection = {
  id: string; tenantId: string; connectorId: ConnectorId; status: ConnectionStatus; requestedScopes: readonly string[]; grantedScopes: readonly string[]; grants: Readonly<Record<string, Grant>>;
  accountId?: string; accountLabel?: string; tokenRef?: string; expiresAt?: string; renewedAt?: string; lastSyncAt?: string; consecutiveFailures: number; lastError?: ConnectorError;
  flow?: OAuthFlow; cursors: Readonly<Partial<Record<SyncKind, string>>>; synced: Readonly<Partial<Record<SyncKind, number>>>; connectedBy: string; createdAt: string; history: readonly { at: string; status: ConnectionStatus; note: string }[];
};
export type ActionStatus = "awaitingApproval" | "rejected" | "done" | "failed";
export type ConnectorAction = { id: string; tenantId: string; connectionId: string; connectorId: ConnectorId; workerId: string; scope: string; operation: string; summary: string; status: ActionStatus; requestedAt: string; decidedBy?: string; decidedAt?: string; failure?: string };
export type SyncRecord = { id: string; tenantId: string; connectionId: string; connectorId: ConnectorId; kind: SyncKind; at: string; items: number; cursor: string; outcome: "ok" | "failed"; error?: string };
export type IncidentMode = "down" | "rateLimited" | "authRevoked";
export const INCIDENT_MODES: readonly IncidentMode[] = ["down", "rateLimited", "authRevoked"];
export type Incident = { group: HealthGroup; mode: IncidentMode; since: string };
export type ConnectorTenant = { tenantId: string; ownerId: string; admins: readonly string[]; enabledAt: string };
export type ConnectorAudit = { at: string; actor: string; tenantId: string; action: string; detail?: string };
export type ConnectorsState = { tenants: readonly ConnectorTenant[]; connections: readonly Connection[]; actions: readonly ConnectorAction[]; syncs: readonly SyncRecord[]; incidents: readonly Incident[]; audit: readonly ConnectorAudit[]; sequence: number };
export const newConnectorsState = (): ConnectorsState => ({ tenants: [], connections: [], actions: [], syncs: [], incidents: [], audit: [], sequence: 0 });

export const OAUTH_FLOW_MINUTES = 10;
export const TOKEN_MINUTES = 60;
export const REFRESH_WINDOW_MINUTES = 10;
export const FAILURES_BEFORE_ERROR = 3;

// ---------------------------------------------------------------- events
type Base = { at: string; tenantId: string; actor: string };
export type ConnectorsEvent =
  | (Base & { type: "tenant.enable" })
  | (Base & { type: "tenant.admin"; userId: string; enabled: boolean })
  | (Base & { type: "connect.start"; connectorId: string; scopes: readonly string[]; redirectUri: string; state: string; codeChallenge: string })
  | (Base & { type: "oauth.callback"; connectorId: string; state: string; code?: string; error?: string; accountId?: string; accountLabel?: string; grantedScopes?: readonly string[] })
  | (Base & { type: "permissions.set"; connectionId: string; scope: string; grant: Grant })
  | (Base & { type: "token.refresh"; connectionId: string })
  | (Base & { type: "connection.disconnect"; connectionId: string })
  | (Base & { type: "sync.run"; connectionId: string; kind: string })
  | (Base & { type: "action.request"; connectionId: string; workerId: string; scope: string; operation: string; summary: string })
  | (Base & { type: "action.approve"; actionId: string })
  | (Base & { type: "action.reject"; actionId: string; reason: string })
  | (Base & { type: "provider.incident"; group: string; mode: string })
  | (Base & { type: "provider.recover"; group: string });
export type Authorization = { baseUrl: string; params: Readonly<Record<string, string>>; clientIdSecret: string };
export type ConnectorsResult = { state: ConnectorsState; error?: string; errorCode?: string; connection?: Connection; authorization?: Authorization; action?: ConnectorAction; sync?: SyncRecord };

export const ERRORS = {
  tenantRequired: "Falta la empresa (tenant_id).", personRequired: "Solo una persona puede hacerlo: NEX y el sistema no.", forbidden: "No tienes permiso para hacerlo.", invalid: "Dato no válido.", notFound: "No existe.",
  notEnabled: "La empresa todavía no activó las apps conectadas.", alreadyEnabled: "La empresa ya activó las apps conectadas.", notConfigured: "KYNOVA todavía no tiene configurada su aplicación con ese proveedor (faltan secretos en Wrangler).",
  alreadyConnected: "Esa app ya está conectada o en proceso.", stateMismatch: "La autorización no corresponde a esta empresa o ya se usó.", flowExpired: "La autorización venció: empieza de nuevo.", accountInUse: "Esa cuenta ya pertenece a otra empresa.",
  invalidTransition: "Ese cambio de estado no es posible.", notActive: "La app no está conectada.", scopeNotGranted: "Ese permiso no fue concedido por el proveedor.", permissionOff: "Ese permiso está apagado.",
  workerRequired: "Los Agentes IA no hablan con el proveedor: solo un Worker pide la acción, y el conector la ejecuta.", workerInactive: "Ese Worker no está activo en la empresa.", unsupported: "Esa app no sincroniza eso.",
  grantNotAllowed: "Lo que sale de la plataforma nunca es automático: pide aprobación.", insecureRedirect: "La dirección de retorno debe ser https (o localhost) y sin datos.", weakState: "El código de seguridad es demasiado corto.",
  tokenExpired: "El acceso venció: hay que renovarlo.",
} as const;
export type ConnectorsErrorCode = keyof typeof ERRORS;

const pad = (value: number) => String(value).padStart(4, "0");
const addMinutes = (iso: string, minutes: number) => new Date(Date.parse(iso) + minutes * 60_000).toISOString();
function fnv(text: string): number { let hash = 0x811c9dc5; for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; } return hash; }
const STATE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
export const isSecureRedirect = (uri: string): boolean => /^https:\/\/[^\s?#@]+$/.test(uri) || /^http:\/\/localhost(:\d+)?(\/[^\s?#@]*)?$/.test(uri);
/** Whether a connection's access is within the renewal window: the scheduler asks this to know who to renew. */
export const tokenDue = (connection: Connection, at: string): boolean => !!connection.expiresAt && (connection.status === "active" || connection.status === "degraded") && Date.parse(connection.expiresAt) - Date.parse(at) <= REFRESH_WINDOW_MINUTES * 60_000;
const scopeGrants = (effect: "read" | "write"): readonly Grant[] => (effect === "write" ? ["off", "approval"] : ["off", "auto"]);

export function reduceConnectors(state: ConnectorsState, event: ConnectorsEvent, env: ConnectorEnv = noConnectorEnv): ConnectorsResult {
  const refuse = (code: ConnectorsErrorCode, detail?: string): ConnectorsResult => ({ state, error: detail ? `${ERRORS[code]} ${detail}` : ERRORS[code], errorCode: code });
  if (!event.tenantId || event.tenantId.trim() === "" || !event.actor || event.actor.trim() === "") return refuse("tenantRequired");
  const { tenantId, at } = event;
  const tenant = state.tenants.find((item) => item.tenantId === tenantId);
  const isAdmin = (actor: string) => !!tenant && isPerson(actor) && (tenant.ownerId === actor || tenant.admins.includes(actor));
  const record = (next: ConnectorsState, action: string, detail?: string): ConnectorsState => ({ ...next, audit: [...next.audit, { at, actor: event.actor, tenantId, action, ...(detail ? { detail } : {}) }] });
  const connectionOf = (id: string) => state.connections.find((item) => item.id === id && item.tenantId === tenantId);
  const put = (current: ConnectorsState, connection: Connection): ConnectorsState => ({ ...current, connections: current.connections.map((item) => (item.id === connection.id ? connection : item)) });
  const move = (connection: Connection, to: ConnectionStatus, note: string): Connection | null => (canTransitionConnection(connection.status, to) || connection.status === to ? { ...connection, status: to, history: [...connection.history, { at, status: to, note }] } : null);
  const incidentOf = (connectorId: ConnectorId) => state.incidents.find((item) => item.group === CONNECTORS[connectorId].group);

  if (event.type === "tenant.enable") {
    if (!isPerson(event.actor)) return refuse("personRequired");
    if (tenant) return refuse("alreadyEnabled");
    return { state: record({ ...state, tenants: [...state.tenants, { tenantId, ownerId: event.actor, admins: [], enabledAt: at }] }, "tenant.enable") };
  }
  if (event.type === "provider.incident" || event.type === "provider.recover") {
    if (event.actor !== "system") return refuse("forbidden");
    if (!(HEALTH_GROUPS as readonly string[]).includes(event.group)) return refuse("invalid", "grupo");
    if (event.type === "provider.incident") {
      if (!(INCIDENT_MODES as readonly string[]).includes(event.mode)) return refuse("invalid", "incidente");
      return { state: record({ ...state, incidents: [...state.incidents.filter((item) => item.group !== event.group), { group: event.group as HealthGroup, mode: event.mode as IncidentMode, since: at }] }, "provider.incident", `${event.group} · ${event.mode}`) };
    }
    return { state: record({ ...state, incidents: state.incidents.filter((item) => item.group !== event.group) }, "provider.recover", event.group) };
  }
  if (!tenant) return refuse("notEnabled");

  switch (event.type) {
    case "tenant.admin": {
      if (tenant.ownerId !== event.actor) return refuse("forbidden");
      if (!isPerson(event.userId)) return refuse("personRequired");
      const admins = event.enabled ? [...new Set([...tenant.admins, event.userId])] : tenant.admins.filter((item) => item !== event.userId);
      return { state: record({ ...state, tenants: state.tenants.map((item) => (item.tenantId === tenantId ? { ...item, admins } : item)) }, "tenant.admin", `${event.userId} · ${event.enabled ? "alta" : "baja"}`) };
    }
    case "connect.start": {
      if (!isAdmin(event.actor)) return refuse(isPerson(event.actor) ? "forbidden" : "personRequired");
      const item = connectorById(event.connectorId);
      if (!item) return refuse("invalid", "app");
      if (!env.configuredFamilies.includes(item.family)) return refuse("notConfigured", item.provider);
      if (!STATE_PATTERN.test(event.state) || !CHALLENGE_PATTERN.test(event.codeChallenge)) return refuse("weakState");
      if (!isSecureRedirect(event.redirectUri)) return refuse("insecureRedirect");
      const known = new Set(item.scopes.map((scope) => scope.id));
      if (event.scopes.length === 0 || event.scopes.some((scope) => !known.has(scope))) return refuse("invalid", "permisos");
      const existing = state.connections.find((row) => row.tenantId === tenantId && row.connectorId === item.id);
      if (existing && !["notConnected", "error"].includes(existing.status)) return refuse("alreadyConnected");
      if (state.connections.some((row) => row.flow?.state === event.state)) return refuse("weakState");
      const flow: OAuthFlow = { state: event.state, codeChallenge: event.codeChallenge, redirectUri: event.redirectUri, startedAt: at, expiresAt: addMinutes(at, OAUTH_FLOW_MINUTES) };
      const base: Connection = existing ?? { id: `cn_${pad(state.sequence + 1)}`, tenantId, connectorId: item.id, status: "notConnected", requestedScopes: [], grantedScopes: [], grants: {}, consecutiveFailures: 0, cursors: {}, synced: {}, connectedBy: event.actor, createdAt: at, history: [] };
      const pending = move({ ...base, requestedScopes: event.scopes, flow, connectedBy: event.actor }, "pending", "autorización iniciada");
      if (!pending) return refuse("invalidTransition", base.status);
      const { lastError: _cleared, ...clean } = pending; void _cleared;
      const connection = clean as Connection;
      const next = existing ? put(state, connection) : { ...state, connections: [...state.connections, connection], sequence: state.sequence + 1 };
      const authorization: Authorization = {
        baseUrl: item.authorizeUrl, clientIdSecret: FAMILY_SECRETS[item.family].clientId,
        params: { response_type: "code", redirect_uri: event.redirectUri, scope: item.scopes.filter((scope) => event.scopes.includes(scope.id)).map((scope) => scope.oauth).join(" "), state: event.state, code_challenge: event.codeChallenge, code_challenge_method: "S256", ...(item.family === "google" ? { access_type: "offline", prompt: "consent" } : {}) },
      };
      return { state: record(next, "connect.start", `${connection.id} · ${item.id}`), connection, authorization };
    }
    case "oauth.callback": {
      const item = connectorById(event.connectorId);
      if (!item) return refuse("invalid", "app");
      const connection = state.connections.find((row) => row.tenantId === tenantId && row.connectorId === item.id && row.flow?.state === event.state);
      if (!connection || !connection.flow) return refuse("stateMismatch");
      if (Date.parse(at) > Date.parse(connection.flow.expiresAt)) {
        const expired = move({ ...connection }, "error", "la autorización venció");
        const { flow: _gone, ...rest } = (expired ?? connection) as Connection; void _gone;
        return { state: record(put(state, { ...rest, lastError: { at, kind: "auth", message: "La autorización venció.", retryable: false } } as Connection), "oauth.expired", connection.id), error: ERRORS.flowExpired, errorCode: "flowExpired", connection };
      }
      const { flow: _used, ...withoutFlow } = connection; void _used;
      if (event.error || !event.code) {
        const failed = move(withoutFlow as Connection, "error", "el proveedor no concedió el acceso");
        if (!failed) return refuse("invalidTransition", connection.status);
        const connectionError: Connection = { ...failed, lastError: { at, kind: "auth", message: "El acceso no fue concedido.", retryable: false } };
        return { state: record(put(state, connectionError), "oauth.denied", connection.id), connection: connectionError };
      }
      if (!event.accountId || !event.accountId.trim()) return refuse("invalid", "cuenta");
      if (state.connections.some((row) => row.connectorId === item.id && row.accountId === event.accountId && row.id !== connection.id && !["notConnected", "revoked", "error"].includes(row.status))) return refuse("accountInUse");
      const granted = event.grantedScopes ?? connection.requestedScopes;
      if (granted.length === 0 || granted.some((scope) => !connection.requestedScopes.includes(scope))) return refuse("invalid", "permisos concedidos");
      const active = move(withoutFlow as Connection, "active", "autorizada");
      if (!active) return refuse("invalidTransition", connection.status);
      const { lastError: _old, ...cleaned } = active; void _old;
      const done: Connection = { ...(cleaned as Connection), accountId: event.accountId, accountLabel: (event.accountLabel ?? event.accountId).slice(0, 80), grantedScopes: granted, grants: Object.fromEntries(granted.map((scope) => [scope, "off" as Grant])), tokenRef: `secret:oauth-${connection.id}`, expiresAt: addMinutes(at, TOKEN_MINUTES), renewedAt: at, consecutiveFailures: 0 };
      return { state: record(put(state, done), "oauth.callback", `${done.id} · ${item.id}`), connection: done };
    }
    case "permissions.set": {
      if (!isAdmin(event.actor)) return refuse(isPerson(event.actor) ? "forbidden" : "personRequired");
      const connection = connectionOf(event.connectionId);
      if (!connection) return refuse("notFound");
      if (connection.status !== "active" && connection.status !== "degraded") return refuse("notActive");
      const scope = CONNECTORS[connection.connectorId].scopes.find((row) => row.id === event.scope);
      if (!scope || !connection.grantedScopes.includes(scope.id)) return refuse("scopeNotGranted");
      if (!scopeGrants(scope.effect).includes(event.grant)) return refuse("grantNotAllowed");
      const next: Connection = { ...connection, grants: { ...connection.grants, [scope.id]: event.grant } };
      return { state: record(put(state, next), "permissions.set", `${connection.id} · ${scope.id} · ${event.grant}`), connection: next };
    }
    case "token.refresh": {
      if (!isAdmin(event.actor) && event.actor !== "system") return refuse(isPerson(event.actor) ? "forbidden" : "personRequired");
      const connection = connectionOf(event.connectionId);
      if (!connection) return refuse("notFound");
      if ((connection.status !== "active" && connection.status !== "degraded") || !connection.tokenRef) return refuse("notActive");
      const incident = incidentOf(connection.connectorId);
      if (incident?.mode === "authRevoked") {
        const failed = move(connection, "error", "el proveedor revocó el acceso");
        if (!failed) return refuse("invalidTransition", connection.status);
        const { tokenRef: _t, ...rest } = failed; void _t;
        const errored: Connection = { ...(rest as Connection), lastError: { at, kind: "auth", message: "El proveedor revocó el acceso: hay que autorizar de nuevo.", retryable: false } };
        return { state: record(put(state, errored), "token.refresh.failed", connection.id), connection: errored };
      }
      if (incident?.mode === "down") return { state: record(put(state, { ...connection, lastError: { at, kind: "provider", message: "El proveedor no respondió.", retryable: true } }), "token.refresh.failed", `${connection.id} · reintentable`), connection };
      const renewed: Connection = { ...connection, expiresAt: addMinutes(at, TOKEN_MINUTES), renewedAt: at };
      return { state: record(put(state, renewed), "token.refresh", connection.id), connection: renewed };
    }
    case "connection.disconnect": {
      if (!isAdmin(event.actor)) return refuse(isPerson(event.actor) ? "forbidden" : "personRequired");
      const connection = connectionOf(event.connectionId);
      if (!connection) return refuse("notFound");
      if (connection.status === "notConnected") return refuse("invalidTransition", "ya está desconectada");
      const revoked = move(connection, "revoked", "desconectada por una persona") ?? { ...connection, status: "revoked" as ConnectionStatus, history: [...connection.history, { at, status: "revoked" as ConnectionStatus, note: "desconectada por una persona" }] };
      const closed = move(revoked, "notConnected", "token revocado") as Connection;
      const { tokenRef: gone, flow: _flow, accountId: _account, accountLabel: _label, expiresAt: _expires, lastError: _error, ...rest } = closed; void _flow; void _account; void _label; void _expires; void _error;
      const cleaned: Connection = { ...(rest as Connection), grantedScopes: [], grants: {}, consecutiveFailures: 0 };
      // the token reference is carried to the audit so the vault can delete the token it points to
      return { state: record(put(state, cleaned), "connection.disconnect", `${connection.id}${gone ? ` · revoke:${gone}` : ""}`), connection: cleaned };
    }
    case "sync.run": {
      if (!isAdmin(event.actor) && event.actor !== "system") return refuse(isPerson(event.actor) ? "forbidden" : "personRequired");
      const connection = connectionOf(event.connectionId);
      if (!connection) return refuse("notFound");
      if (connection.status !== "active" && connection.status !== "degraded") return refuse("notActive");
      const item = CONNECTORS[connection.connectorId];
      if (!(SYNC_KINDS as readonly string[]).includes(event.kind) || !item.syncKinds.includes(event.kind as SyncKind)) return refuse("unsupported", event.kind);
      const kind = event.kind as SyncKind;
      const enabling = item.scopes.filter((scope) => scope.effect === "read" && scope.syncs.includes(kind) && connection.grantedScopes.includes(scope.id));
      if (!enabling.some((scope) => (connection.grants[scope.id] ?? "off") !== "off")) return refuse("permissionOff");
      const incident = incidentOf(connection.connectorId);
      const expired = !!connection.expiresAt && Date.parse(connection.expiresAt) <= Date.parse(at);
      const failure: { kind: ConnectorError["kind"]; message: string; retryable: boolean } | null = expired ? { kind: "auth", message: ERRORS.tokenExpired, retryable: true }
        : incident?.mode === "down" ? { kind: "provider", message: "El proveedor no respondió.", retryable: true } : incident?.mode === "rateLimited" ? { kind: "rateLimit", message: "El proveedor pidió esperar.", retryable: true }
        : incident?.mode === "authRevoked" ? { kind: "auth", message: "El proveedor revocó el acceso.", retryable: false } : null;
      const id = `sy_${pad(state.sequence + 1)}`;
      if (failure) {
        const failures = connection.consecutiveFailures + 1;
        const toError = !failure.retryable || failures >= FAILURES_BEFORE_ERROR;
        const moved = move(connection, toError ? "error" : "degraded", failure.message) ?? connection;
        const failedConnection: Connection = { ...moved, consecutiveFailures: failures, lastError: { at, ...failure } };
        const sync: SyncRecord = { id, tenantId, connectionId: connection.id, connectorId: connection.connectorId, kind, at, items: 0, cursor: connection.cursors[kind] ?? "", outcome: "failed", error: failure.kind };
        return { state: record({ ...put(state, failedConnection), syncs: [...state.syncs, sync], sequence: state.sequence + 1 }, "sync.failed", `${connection.id} · ${kind} · ${failure.kind}`), connection: failedConnection, sync };
      }
      const previous = connection.cursors[kind] ?? "";
      const cursor = `c${(fnv(`${connection.id}|${kind}|${previous}`) % 1_000_000).toString(36)}`;
      const items = (fnv(`${connection.id}|${kind}|${cursor}`) % 8) + 1;
      const recovered = connection.status === "degraded" ? (move(connection, "active", "sincronización recuperada") ?? connection) : connection;
      const { lastError: _recovered, ...healthy } = recovered; void _recovered;
      const synced: Connection = { ...(healthy as Connection), consecutiveFailures: 0, lastSyncAt: at, cursors: { ...connection.cursors, [kind]: cursor }, synced: { ...connection.synced, [kind]: (connection.synced[kind] ?? 0) + items } };
      const sync: SyncRecord = { id, tenantId, connectionId: connection.id, connectorId: connection.connectorId, kind, at, items, cursor, outcome: "ok" };
      return { state: record({ ...put(state, synced), syncs: [...state.syncs, sync], sequence: state.sequence + 1 }, "sync.run", `${connection.id} · ${kind} · ${items}`), connection: synced, sync };
    }
    case "action.request": {
      // Agent -> Worker -> Connector -> Provider: the agent never reaches the provider; only a Worker of this company asks, and the connector decides
      if (!event.actor.startsWith("worker:") || event.actor.slice("worker:".length) !== event.workerId) return refuse("workerRequired");
      if (!env.workers.some((row) => row.tenantId === tenantId && row.id === event.workerId && row.status === "active")) return refuse("workerInactive");
      const connection = connectionOf(event.connectionId);
      if (!connection) return refuse("notFound");
      if (connection.status !== "active" && connection.status !== "degraded") return refuse("notActive");
      const scope = CONNECTORS[connection.connectorId].scopes.find((row) => row.id === event.scope);
      if (!scope || !connection.grantedScopes.includes(scope.id)) return refuse("scopeNotGranted");
      if ((connection.grants[scope.id] ?? "off") === "off") return refuse("permissionOff");
      if (event.operation.trim() === "" || event.operation.length > 60 || event.summary.length > 200) return refuse("invalid", "operación");
      const id = `ac_${pad(state.sequence + 1)}`;
      const external = scope.effect === "write";
      const action: ConnectorAction = { id, tenantId, connectionId: connection.id, connectorId: connection.connectorId, workerId: event.workerId, scope: scope.id, operation: event.operation.trim(), summary: event.summary.trim(), status: external ? "awaitingApproval" : "done", requestedAt: at };
      return { state: record({ ...state, actions: [...state.actions, action], sequence: state.sequence + 1 }, "action.request", `${id} · ${connection.connectorId} · ${scope.id}${external ? " · espera aprobación" : ""}`), action };
    }
    case "action.approve": case "action.reject": {
      if (!isAdmin(event.actor)) return refuse(isPerson(event.actor) ? "forbidden" : "personRequired");
      const action = state.actions.find((row) => row.id === event.actionId && row.tenantId === tenantId);
      if (!action) return refuse("notFound");
      if (action.status !== "awaitingApproval") return refuse("invalidTransition", action.status);
      const replace = (updated: ConnectorAction): ConnectorsState => ({ ...state, actions: state.actions.map((row) => (row.id === updated.id ? updated : row)) });
      if (event.type === "action.reject") { const rejected: ConnectorAction = { ...action, status: "rejected", decidedBy: event.actor, decidedAt: at, failure: event.reason }; return { state: record(replace(rejected), "action.reject", `${action.id} · ${event.reason}`), action: rejected }; }
      const connection = connectionOf(action.connectionId);
      const incident = connection ? incidentOf(connection.connectorId) : undefined;
      const down = !connection || (connection.status !== "active" && connection.status !== "degraded") || incident?.mode === "down" || incident?.mode === "authRevoked" || (!!connection.expiresAt && Date.parse(connection.expiresAt) <= Date.parse(at));
      const finished: ConnectorAction = { ...action, status: down ? "failed" : "done", decidedBy: event.actor, decidedAt: at, ...(down ? { failure: "El proveedor no pudo ejecutarla." } : {}) };
      return { state: record(replace(finished), down ? "action.failed" : "action.approve", `${action.id}`), action: finished };
    }
    default: return refuse("invalid");
  }
}

export function applyConnectorsEvents(state: ConnectorsState, events: readonly ConnectorsEvent[], env: ConnectorEnv = noConnectorEnv): { state: ConnectorsState; errors: string[] } {
  const errors: string[] = [];
  let current = state;
  for (const event of events) { const result = reduceConnectors(current, event, env); if (result.error) errors.push(`${event.type}: ${result.error}`); current = result.state; }
  return { state: current, errors };
}

// ---------------------------------------------------------------- the Connected Apps view and the health: readings, nothing stored
export type AppRow = {
  connectorId: ConnectorId; connectionId?: string; label: string; provider: string; group: HealthGroup; status: ConnectionStatus; display: DisplayStatus; lastSyncAt?: string; accountLabel?: string; tenantId: string; configured: boolean;
  permissions: readonly { scope: string; label: string; effect: "read" | "write"; grant: Grant }[]; syncKinds: readonly SyncKind[]; expiresAt?: string; error?: string; canConnect: boolean; canDisconnect: boolean; renewalDue: boolean;
};
/** Every app, for ONE company: its own connection if it has one, and what it can still do. */
export function connectedApps(state: ConnectorsState, tenantId: string, env: ConnectorEnv = noConnectorEnv, at = "1970-01-01T00:00:00.000Z"): AppRow[] {
  return CONNECTOR_IDS.map((id) => {
    const item = CONNECTORS[id];
    const connection = state.connections.find((row) => row.tenantId === tenantId && row.connectorId === id);
    const status: ConnectionStatus = connection?.status ?? "notConnected";
    const configured = env.configuredFamilies.includes(item.family);
    return {
      connectorId: id, ...(connection ? { connectionId: connection.id } : {}), label: item.label, provider: item.provider, group: item.group, status, display: displayStatus(status), ...(connection?.lastSyncAt ? { lastSyncAt: connection.lastSyncAt } : {}),
      ...(connection?.accountLabel ? { accountLabel: connection.accountLabel } : {}), tenantId, configured,
      permissions: connection ? item.scopes.filter((def) => connection.grantedScopes.includes(def.id)).map((def) => ({ scope: def.id, label: def.label, effect: def.effect, grant: connection.grants[def.id] ?? "off" })) : [],
      syncKinds: item.syncKinds, ...(connection?.expiresAt ? { expiresAt: connection.expiresAt } : {}), ...(connection?.lastError ? { error: connection.lastError.message } : {}),
      canConnect: configured && (status === "notConnected" || status === "error"), canDisconnect: status !== "notConnected", renewalDue: !!connection && tokenDue(connection, at),
    };
  });
}

export type HealthStatus = "operational" | "degraded" | "down" | "notConfigured";
export type HealthRow = { group: HealthGroup; label: string; status: HealthStatus; connections: number; errors: number; incident?: IncidentMode; detail: string };
const GROUP_FAMILIES: Record<HealthGroup, readonly ProviderFamily[]> = { google: ["google"], microsoft: ["microsoft"], meta: ["meta"], youtube: ["google"], whatsapp: ["meta"], linkedin: ["linkedin"], tiktok: ["tiktok"], drive: ["google", "microsoft"] };
/** The health of each provider group, platform-wide (a provider is down for everyone) with the companies' own connection errors counted. Optionally for one company only. */
export function connectorHealth(state: ConnectorsState, env: ConnectorEnv = noConnectorEnv, tenantId?: string): HealthRow[] {
  return HEALTH_GROUPS.map((group) => {
    const connectors = CONNECTOR_IDS.filter((id) => CONNECTORS[id].group === group);
    const rows = state.connections.filter((row) => connectors.includes(row.connectorId) && (!tenantId || row.tenantId === tenantId) && row.status !== "notConnected" && row.status !== "revoked");
    const errors = rows.filter((row) => row.status === "error" || row.status === "degraded").length;
    const incident = state.incidents.find((row) => row.group === group);
    const configured = GROUP_FAMILIES[group].some((family) => env.configuredFamilies.includes(family));
    const status: HealthStatus = incident?.mode === "down" ? "down" : incident ? "degraded" : !configured ? "notConfigured" : errors > 0 ? "degraded" : "operational";
    const detail = incident ? `incidente: ${incident.mode}` : !configured ? "faltan los secretos de la app en Wrangler" : errors > 0 ? `${errors} conexión(es) con error` : "sin novedades";
    return { group, label: HEALTH_LABELS[group], status, connections: rows.length, errors, ...(incident ? { incident: incident.mode } : {}), detail };
  });
}
/** The same readings in the shape of the Backend Core's health checks, for a bridge to carry later. */
export const connectorHealthChecks = (rows: readonly HealthRow[]): { name: string; status: "up" | "degraded" | "down"; detail: string }[] =>
  rows.map((row) => ({ name: `connector_${row.group}`, status: row.status === "operational" ? "up" : row.status === "down" ? "down" : "degraded", detail: row.detail }));

// ---------------------------------------------------------------- the tables this module will need (a contract only: no migration)
/** Every table is a company's (tenant_id); members read and writes go through functions; syncs and the trail are append-only. Tokens are never a column: only the `secret:` reference. */
export const CONNECTOR_TABLES = [
  { table: "connector_tenants", appendOnly: false }, { table: "connector_connections", appendOnly: false }, { table: "connector_actions", appendOnly: false },
  { table: "connector_syncs", appendOnly: true }, { table: "connector_audit", appendOnly: true },
] as const;
