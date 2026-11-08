// The catalog of the Developer Platform: scopes, webhook events, API versions, the endpoints the explorer knows, the rate limits of each plan, the kinds of
// marketplace apps, the SDKs and the future surfaces. It is declarative data; every figure derived from it (a rate limit, a consumption, an outcome)
// is worked out only by koe-dev.ts. Everything is SIMULATED: there is no real API, no real OAuth, no real webhook and no real SDK.

export const SCOPES = ["crm.read", "crm.write", "comms.read", "comms.write", "insights.read", "org.read", "billing.read", "workers.read", "workers.write", "automations.write"] as const;
export type Scope = (typeof SCOPES)[number];

export const EVENT_TYPES = ["crm.lead.created", "crm.deal.updated", "comms.message.received", "billing.invoice.issued", "org.user.invited", "workers.run.completed", "automations.run.failed"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const API_VERSIONS = [
  { id: "v0", status: "deprecated", note: "Se retirará: migre a v1." },
  { id: "v1", status: "stable", note: "Versión estable." },
  { id: "v2", status: "preview", note: "Vista previa: puede cambiar." },
] as const;
export type ApiVersion = (typeof API_VERSIONS)[number]["id"];

export type Method = "GET" | "POST" | "PUT" | "DELETE";
export type Endpoint = { id: string; method: Method; path: string; scope: Scope; summary: string; body?: string; sample: string };
/** What the API Explorer knows. The responses are invented examples: nothing here is ever sent anywhere. */
export const ENDPOINTS: readonly Endpoint[] = [
  { id: "leads.list", method: "GET", path: "/v1/leads", scope: "crm.read", summary: "Lista los prospectos de la empresa", sample: '{"data":[{"id":"ld_1","name":"Prospecto de ejemplo","stage":"qualified"}],"hasMore":false}' },
  { id: "leads.create", method: "POST", path: "/v1/leads", scope: "crm.write", summary: "Crea un prospecto", body: '{"name":"Prospecto nuevo","source":"web"}', sample: '{"id":"ld_2","name":"Prospecto nuevo","stage":"prospect"}' },
  { id: "conversations.list", method: "GET", path: "/v1/conversations", scope: "comms.read", summary: "Lista las conversaciones", sample: '{"data":[{"id":"cv_1","channel":"email","status":"open"}],"hasMore":false}' },
  { id: "messages.draft", method: "POST", path: "/v1/messages", scope: "comms.write", summary: "Prepara un borrador de mensaje (nunca se envía)", body: '{"conversationId":"cv_1","text":"Hola"}', sample: '{"id":"dr_1","status":"draft"}' },
  { id: "insights.summary", method: "GET", path: "/v1/insights/summary", scope: "insights.read", summary: "Resumen de métricas del negocio", sample: '{"tasks":128,"timeSavedMinutes":940}' },
  { id: "org.users", method: "GET", path: "/v1/org/users", scope: "org.read", summary: "Lista las personas de la empresa", sample: '{"data":[{"id":"u_1","name":"Persona de ejemplo","status":"active"}]}' },
  { id: "billing.invoices", method: "GET", path: "/v1/billing/invoices", scope: "billing.read", summary: "Lista las facturas", sample: '{"data":[{"number":"F-0001","status":"paid"}]}' },
  { id: "workers.list", method: "GET", path: "/v1/workers", scope: "workers.read", summary: "Lista los Workers instalados", sample: '{"data":[{"id":"w_1","name":"Worker de ejemplo","status":"active"}]}' },
  { id: "workers.run", method: "POST", path: "/v1/workers/{id}/runs", scope: "workers.write", summary: "Pide una ejecución a un Worker (pasa por KOE)", body: '{"goal":"Resumir la semana"}', sample: '{"id":"rn_1","status":"queued"}' },
  { id: "automations.trigger", method: "POST", path: "/v1/automations/{id}/trigger", scope: "automations.write", summary: "Dispara una automatización", body: "{}", sample: '{"id":"ar_1","status":"queued"}' },
];

/** Requests per minute each plan allows the whole company. An app and a key can only be limited further. */
export const PLAN_RPM: Record<string, number> = { starter: 60, professional: 300, business: 1_200, enterprise: 6_000 };
export const DEFAULT_PLAN = "starter";
export const WINDOW_SECONDS = 60;
export const KEY_EXPIRY_WARNING_DAYS = 14;
export const MAX_DELIVERY_ATTEMPTS = 4; // the first attempt and three retries
export const RETRY_BACKOFF_MINUTES = [1, 5, 30] as const; // declared: the simulation retries when a person asks
export const SIGNATURE_ALGORITHM = "HMAC-SHA256 (simulada)";
export const DEV_AUTH_ACTION = "dev.publish.request.auto";

export const APP_KINDS = ["app", "plugin", "worker", "prompt", "template", "automation", "connector"] as const;
export type AppKind = (typeof APP_KINDS)[number];

export const SDKS = [
  { id: "javascript", name: "JavaScript" }, { id: "typescript", name: "TypeScript" }, { id: "python", name: "Python" }, { id: "php", name: "PHP" },
  { id: "csharp", name: "C#" }, { id: "java", name: "Java" }, { id: "go", name: "Go" },
] as const;
export const OAUTH_FLOWS = [
  { id: "authorizationCode", name: "Authorization Code" }, { id: "pkce", name: "PKCE" }, { id: "clientCredentials", name: "Client Credentials" },
  { id: "refreshTokens", name: "Refresh Tokens" }, { id: "scopes", name: "Scopes" },
] as const;
export const FUTURE_SURFACES = [
  { id: "graphql", name: "GraphQL" }, { id: "grpc", name: "gRPC" }, { id: "openapi", name: "OpenAPI" }, { id: "asyncapi", name: "AsyncAPI" },
  { id: "cli", name: "CLI" }, { id: "terraform", name: "Terraform" }, { id: "githubApps", name: "GitHub Apps" }, { id: "vscode", name: "Extensión de VS Code" },
] as const;
