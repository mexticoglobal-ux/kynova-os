// Developer Platform store: each company's apps, API keys, webhooks, sandbox, request history and the log of everything that happened.
// Pure and deterministic, one global state with every record owned by a company (tenant): nothing is ever shared between companies.
// There is NO real API, OAuth, webhook or SDK: a key is a SIMULATED credential, a delivery goes nowhere, a request is answered by KOE's simulation.
// Every figure and outcome (a rate limit, a consumption, a simulated response, a delivery result, a recommendation) is worked out by koe-dev.ts;
// this file only decides who may do what and records the result. The full secret of a key or a signing secret is returned ONCE, in `reveal`,
// and is never kept: the state holds only a prefix, the last four characters and a hash.
//
// Constitution (ADR-0009), enforced by how the events are built and tested:
// - Level 1 (NEX prepares): propose an API key, a webhook or an app. A person approves it; NEX never applies it.
// - Level 2 (a standing authorization): ask for the publication of an app. It is only a request: a person decides, and nothing is published today.
// - Level 3 (a person with the right authority): NEVER create a credential, NEVER activate an app, NEVER publish, NEVER delete a log. There is
//   no event that deletes or edits a log, a request or a delivery: every list only grows.

import { isPerson, isWorker } from "./actors";
import { DEFAULT_KOE_ENV, failed, planExecution, type KoeEnv } from "./automation-koe";
import { API_VERSIONS, APP_KINDS, DEV_AUTH_ACTION, ENDPOINTS, EVENT_TYPES, MAX_DELIVERY_ATTEMPTS, SCOPES, type ApiVersion, type AppKind, type EventType, type Scope } from "./dev-catalog";
import { message, type ErrorCode } from "./dev-messages";
import { fnv, newSecret, recommendations, samplePayload, signatureFor, simulateAttempt, simulateRequest, type DevSignals } from "./koe-dev";
import { decide, type Authorization } from "./workers";

export { DEFAULT_KOE_ENV, type KoeEnv } from "./automation-koe";
export * from "./dev-catalog";

export type DevAccount = { tenantId: string; ownerId: string; developers: readonly string[]; planId: string; createdAt: string };
export type AppStatus = "draft" | "active" | "paused";
export type App = { id: string; tenantId: string; name: string; kind: AppKind; description: string; scopes: readonly Scope[]; apiVersion: ApiVersion; rateLimitRpm: number; status: AppStatus; createdBy: string; createdAt: string; updatedAt: string };
export type KeyStatus = "active" | "revoked" | "expired";
// The state never holds the secret of a key: only its prefix, its last four characters and a hash.
export type ApiKey = {
  id: string; tenantId: string; appId: string; name: string; prefix: string; last4: string; hash: string; scopes: readonly Scope[]; status: KeyStatus; rateLimitRpm: number; expiresAt?: string;
  createdBy: string; createdAt: string; lastUsedAt?: string; revokedAt?: string; revokedBy?: string; replacedBy?: string; replaces?: string;
};
export type WebhookStatus = "active" | "paused" | "deleted";
export type Webhook = { id: string; tenantId: string; appId?: string; url: string; events: readonly EventType[]; status: WebhookStatus; secretHash: string; secretPrefix: string; createdBy: string; createdAt: string; updatedAt: string };
export type Attempt = { at: string; status: number; latencyMs: number; ok: boolean; by: string };
export type DeliveryStatus = "delivered" | "failed" | "exhausted";
export type Delivery = { id: string; tenantId: string; webhookId: string; event: EventType; at: string; by: string; signature: string; attempts: readonly Attempt[]; status: DeliveryStatus };
export type Sandbox = { id: string; tenantId: string; name: string; latencyMs: number; errorRatePercent: number; createdBy: string; createdAt: string; updatedAt: string };
export type SandboxEvent = { id: string; tenantId: string; sandboxId: string; type: EventType; at: string; by: string; payload: string; deliveries: number };
export type RequestRecord = {
  id: string; tenantId: string; at: string; appId?: string; keyId?: string; endpointId: string; method: string; path: string; version: string; status: number; latencyMs: number;
  count: number; errors: number; rateLimited: boolean; by: string; source: "explorer" | "platform"; response?: string;
};
export type Publication = { id: string; tenantId: string; appId: string; status: "requested" | "approved" | "rejected"; via: "person" | "authorized"; requestedBy: string; requestedAt: string; note: string; decidedBy?: string; decidedAt?: string };
export type ProposalPayload =
  | { kind: "key"; appId: string; name: string; scopes: readonly Scope[]; expiresAt?: string }
  | { kind: "webhook"; url: string; events: readonly EventType[]; appId?: string }
  | { kind: "app"; name: string; appKind: AppKind; description: string; scopes: readonly Scope[]; apiVersion: ApiVersion };
export type Proposal = { id: string; tenantId: string; payload: ProposalPayload; status: "proposed" | "approved" | "rejected"; proposedBy: string; proposedAt: string; decidedBy?: string; decidedAt?: string; reason: string };
export type Grant = { id: string; tenantId: string; action: typeof DEV_AUTH_ACTION; status: "active" | "revoked"; maxPerDay?: number; expiresAt?: string; grantedBy: string; grantedAt: string };
export type DevAnalysis = { id: string; tenantId: string; at: string; by: string; workerId: string; workerName: string; model: { id: string; label: string }; modelReason: string; estimatedCostMicros: number; recommendationIds: readonly string[]; counts: Record<string, number> };
export type LogKind = "request" | "error" | "event" | "webhook" | "key" | "app" | "access" | "proposal" | "other";
export type DevLog = { at: string; actor: string; tenantId: string; kind: LogKind; action: string; detail?: string };

export type DevState = {
  accounts: readonly DevAccount[]; apps: readonly App[]; keys: readonly ApiKey[]; webhooks: readonly Webhook[]; deliveries: readonly Delivery[]; sandboxes: readonly Sandbox[]; sandboxEvents: readonly SandboxEvent[];
  requests: readonly RequestRecord[]; publications: readonly Publication[]; proposals: readonly Proposal[]; grants: readonly Grant[]; analyses: readonly DevAnalysis[]; logs: readonly DevLog[]; sequence: number;
};
export const newDevState = (): DevState => ({ accounts: [], apps: [], keys: [], webhooks: [], deliveries: [], sandboxes: [], sandboxEvents: [], requests: [], publications: [], proposals: [], grants: [], analyses: [], logs: [], sequence: 0 });

/** What KOE reads besides the records of this module: the other modules' records, if any. */
export type DevEnv = KoeEnv & { signals: DevSignals };
export const EMPTY_SIGNALS: DevSignals = {};
export const DEFAULT_DEV_ENV: DevEnv = { ...DEFAULT_KOE_ENV, signals: EMPTY_SIGNALS };

type Base = { at: string; tenantId: string; actor: string };
export type DevEvent =
  | (Base & { type: "dev.create"; ownerId: string; planId: string })
  | (Base & { type: "dev.setDeveloper"; userId: string; enabled: boolean })
  | (Base & { type: "app.create"; name: string; appKind: AppKind; description?: string; scopes: readonly Scope[]; apiVersion?: ApiVersion; rateLimitRpm?: number })
  | (Base & { type: "app.update"; appId: string; name?: string; description?: string; scopes?: readonly Scope[]; apiVersion?: ApiVersion; rateLimitRpm?: number })
  | (Base & { type: "app.setStatus"; appId: string; to: "active" | "paused" })
  | (Base & { type: "publication.request"; appId: string; note?: string })
  | (Base & { type: "publication.decide"; publicationId: string; approve: boolean })
  | (Base & { type: "key.create"; appId: string; name: string; scopes: readonly Scope[]; expiresAt?: string; rateLimitRpm?: number })
  | (Base & { type: "key.update"; keyId: string; name?: string; scopes?: readonly Scope[]; expiresAt?: string; rateLimitRpm?: number })
  | (Base & { type: "key.revoke"; keyId: string })
  | (Base & { type: "key.regenerate"; keyId: string })
  | (Base & { type: "key.expire"; keyId: string })
  | (Base & { type: "webhook.create"; url: string; events: readonly EventType[]; appId?: string })
  | (Base & { type: "webhook.update"; webhookId: string; url?: string; events?: readonly EventType[] })
  | (Base & { type: "webhook.setStatus"; webhookId: string; to: "active" | "paused" })
  | (Base & { type: "webhook.delete"; webhookId: string })
  | (Base & { type: "webhook.rotateSecret"; webhookId: string })
  | (Base & { type: "webhook.simulate"; webhookId: string; event: EventType })
  | (Base & { type: "webhook.retry"; deliveryId: string })
  | (Base & { type: "sandbox.create"; name: string; latencyMs?: number; errorRatePercent?: number })
  | (Base & { type: "sandbox.configure"; sandboxId: string; latencyMs?: number; errorRatePercent?: number })
  | (Base & { type: "sandbox.emit"; event: EventType })
  | (Base & { type: "api.request"; keyId: string; endpointId: string })
  | (Base & { type: "usage.report"; keyId: string; endpointId: string; count: number; errors?: number; rateLimited?: boolean })
  | (Base & { type: "proposal.create"; payload: ProposalPayload; reason?: string })
  | (Base & { type: "proposal.approve"; proposalId: string })
  | (Base & { type: "proposal.reject"; proposalId: string })
  | (Base & { type: "dev.analyze" })
  | (Base & { type: "authorization.grant"; maxPerDay?: number; expiresAt?: string })
  | (Base & { type: "authorization.revoke"; grantId: string });
/** The one time a secret is shown: right after it is created or regenerated. It is never stored. */
export type Reveal = { kind: "apiKey" | "webhookSecret"; id: string; secret: string };
export type DevResult = { state: DevState; error?: string; errorCode?: ErrorCode; reveal?: Reveal };

// ---------------------------------------------------------------- helpers
// Nothing is ever trimmed or deleted: every list only grows (a status changes; history stays). Limits belong to the view (display.ts).
const append = <T,>(items: readonly T[], item: T): readonly T[] => [...items, item];
const replace = <T extends { id: string }>(items: readonly T[], item: T): readonly T[] => items.map((existing) => (existing.id === item.id ? item : existing));
const nextId = (state: DevState, prefix: string): { id: string; state: DevState } => {
  const sequence = state.sequence + 1;
  return { id: `${prefix}_${String(sequence).padStart(5, "0")}`, state: { ...state, sequence } };
};
const log = (state: DevState, event: { at: string; actor: string; tenantId: string }, kind: LogKind, action: string, detail?: string): DevState => ({ ...state, logs: append(state.logs, { at: event.at, actor: event.actor, tenantId: event.tenantId, kind, action, detail }) });
const HANDLE = /^[a-z0-9][a-z0-9._-]{0,29}$/;
const URL_OK = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{2,5})?(\/[^\s]*)?$/i;
const sameDay = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10);
const validScopes = (scopes: readonly string[] | undefined): boolean => !!scopes && scopes.length > 0 && scopes.every((item) => (SCOPES as readonly string[]).includes(item)) && new Set(scopes).size === scopes.length;
const validEvents = (events: readonly string[] | undefined): boolean => !!events && events.length > 0 && events.every((item) => (EVENT_TYPES as readonly string[]).includes(item)) && new Set(events).size === events.length;

export const accountOf = (state: DevState, tenantId: string) => state.accounts.find((item) => item.tenantId === tenantId);
/** Who may build on the platform: the owner and the people the owner named. A Worker, the platform or anyone else never. */
export function canDevelop(state: DevState, tenantId: string, actor: string): boolean {
  const account = accountOf(state, tenantId);
  return !!account && isPerson(actor) && (account.ownerId === actor || account.developers.includes(actor));
}

// ---------------------------------------------------------------- the reducer
export function reduceDev(state: DevState, event: DevEvent, env: DevEnv = DEFAULT_DEV_ENV): DevResult {
  const person = isPerson(event.actor);
  const tenant = event.tenantId;
  const refuse = (code: ErrorCode, params?: Record<string, string | number>): DevResult => ({ state, error: message(code, params), errorCode: code });
  const needSystem = (): DevResult | null => (event.actor === "system" ? null : refuse("systemOnly"));
  const needDrafter = (): DevResult | null => (person || isWorker(event.actor) ? null : refuse("personRequired"));
  const account = accountOf(state, tenant);
  /** A person who is the owner or builds for the company. Level 3: a Worker never reaches this. */
  const needDeveloper = (): DevResult | null => {
    if (!person) return refuse("personRequired");
    return canDevelop(state, tenant, event.actor) ? null : refuse("forbidden");
  };
  const needOwner = (): DevResult | null => {
    if (!person) return refuse("personRequired");
    return account?.ownerId === event.actor ? null : refuse("ownerRequired");
  };
  const appOf = (id: string) => state.apps.find((item) => item.id === id && item.tenantId === tenant);
  const keyOf = (id: string) => state.keys.find((item) => item.id === id && item.tenantId === tenant);
  const hookOf = (id: string) => state.webhooks.find((item) => item.id === id && item.tenantId === tenant);
  const missing = (list: readonly { id: string }[], id: string): DevResult => refuse(list.some((item) => item.id === id) ? "notYours" : "notFound");
  const sandboxOf = (st: DevState) => st.sandboxes.filter((item) => item.tenantId === tenant).at(-1);
  const autoAllowed = (st: DevState): boolean => {
    const grant = st.grants.find((item) => item.tenantId === tenant && item.status === "active" && (!item.expiresAt || Date.parse(item.expiresAt) > Date.parse(event.at)));
    if (!grant) return false;
    const usedToday = st.logs.filter((entry) => entry.tenantId === tenant && entry.action === "publication.request.auto" && sameDay(entry.at, event.at)).length;
    const authorization: Authorization = { action: DEV_AUTH_ACTION, status: "active", maxPerDay: grant.maxPerDay, usedToday, expiresAt: grant.expiresAt };
    return decide(DEV_AUTH_ACTION, authorization, new Date(event.at)).allowed;
  };
  /** One simulated delivery of an event to a webhook: KOE decides how it goes; nothing leaves the simulation. */
  const deliver = (st: DevState, hook: Webhook, type: EventType, by: string): DevState => {
    const made = nextId(st, "dl");
    const attempt = simulateAttempt(made.state, tenant, hook.url, made.state.sequence);
    const delivery: Delivery = {
      id: made.id, tenantId: tenant, webhookId: hook.id, event: type, at: event.at, by, signature: signatureFor(hook.secretHash, type, made.id),
      attempts: [{ at: event.at, status: attempt.status, latencyMs: attempt.latencyMs, ok: attempt.ok, by }], status: attempt.ok ? "delivered" : "failed",
    };
    return log({ ...made.state, deliveries: append(made.state.deliveries, delivery) }, event, attempt.ok ? "webhook" : "error", "webhook.delivery", `${made.id} · ${type} → ${attempt.status}`);
  };

  if (event.type !== "dev.create" && !account) return refuse("notFound");

  switch (event.type) {
    // ---- the company joins the developer platform: the platform sets it up
    case "dev.create": {
      const denied = needSystem();
      if (denied) return denied;
      if (account) return refuse("exists", { detail: "la cuenta de desarrollo" });
      if (!HANDLE.test(event.ownerId)) return refuse("invalid", { detail: "propietario" });
      return { state: log({ ...state, accounts: append(state.accounts, { tenantId: tenant, ownerId: event.ownerId, developers: [], planId: event.planId, createdAt: event.at }) }, event, "access", "dev.create", `propietario ${event.ownerId} · plan ${event.planId}`) };
    }

    case "dev.setDeveloper": {
      const denied = needOwner();
      if (denied) return denied;
      if (!HANDLE.test(event.userId) || event.userId === account?.ownerId) return refuse("invalid", { detail: "la persona" });
      const developers = event.enabled ? (account?.developers.includes(event.userId) ? account.developers : [...(account?.developers ?? []), event.userId]) : (account?.developers ?? []).filter((item) => item !== event.userId);
      return { state: log({ ...state, accounts: state.accounts.map((item) => (item.tenantId === tenant ? { ...item, developers } : item)) }, event, "access", "dev.setDeveloper", `${event.userId} · ${event.enabled ? "desarrolla" : "ya no desarrolla"}`) };
    }

    // ---- apps: a person builds them, a person activates them
    case "app.create": {
      const denied = needDeveloper();
      if (denied) return denied;
      if (event.name.trim() === "" || event.name.length > 60 || !APP_KINDS.includes(event.appKind) || !validScopes(event.scopes)) return refuse("invalid", { detail: "nombre, tipo y permisos" });
      if (event.apiVersion && !API_VERSIONS.some((item) => item.id === event.apiVersion)) return refuse("invalid", { detail: "versión" });
      if (event.rateLimitRpm !== undefined && (!Number.isInteger(event.rateLimitRpm) || event.rateLimitRpm < 1 || event.rateLimitRpm > 100_000)) return refuse("invalid", { detail: "el límite de peticiones" });
      if (state.apps.some((item) => item.tenantId === tenant && item.name.toLowerCase() === event.name.trim().toLowerCase())) return refuse("exists", { detail: "una aplicación con ese nombre" });
      const made = nextId(state, "app");
      const app: App = {
        id: made.id, tenantId: tenant, name: event.name.trim(), kind: event.appKind, description: (event.description ?? "").trim(), scopes: event.scopes, apiVersion: event.apiVersion ?? "v1",
        rateLimitRpm: event.rateLimitRpm ?? 60, status: "draft", createdBy: event.actor, createdAt: event.at, updatedAt: event.at,
      };
      return { state: log({ ...made.state, apps: append(made.state.apps, app) }, event, "app", "app.create", `${made.id} · ${app.name} (${app.kind})`) };
    }

    case "app.update": {
      const denied = needDeveloper();
      if (denied) return denied;
      const app = appOf(event.appId);
      if (!app) return missing(state.apps, event.appId);
      if ((event.name !== undefined && (event.name.trim() === "" || event.name.length > 60)) || (event.scopes !== undefined && !validScopes(event.scopes))) return refuse("invalid", { detail: "nombre o permisos" });
      if (event.apiVersion && !API_VERSIONS.some((item) => item.id === event.apiVersion)) return refuse("invalid", { detail: "versión" });
      if (event.rateLimitRpm !== undefined && (!Number.isInteger(event.rateLimitRpm) || event.rateLimitRpm < 1 || event.rateLimitRpm > 100_000)) return refuse("invalid", { detail: "el límite de peticiones" });
      const updated: App = { ...app, name: event.name?.trim() ?? app.name, description: event.description?.trim() ?? app.description, scopes: event.scopes ?? app.scopes, apiVersion: event.apiVersion ?? app.apiVersion, rateLimitRpm: event.rateLimitRpm ?? app.rateLimitRpm, updatedAt: event.at };
      return { state: log({ ...state, apps: replace(state.apps, updated) }, event, "app", "app.update", `${app.id} · versión ${app.apiVersion} → ${updated.apiVersion}; límite ${app.rateLimitRpm} → ${updated.rateLimitRpm}`) };
    }

    case "app.setStatus": {
      const denied = needDeveloper(); // Level 3: only a person activates an app
      if (denied) return denied;
      const app = appOf(event.appId);
      if (!app) return missing(state.apps, event.appId);
      if (app.status === event.to) return refuse("exists", { detail: "ya está en ese estado" });
      return { state: log({ ...state, apps: replace(state.apps, { ...app, status: event.to, updatedAt: event.at }) }, event, "app", "app.setStatus", `${app.id} · ${app.status} → ${event.to}`) };
    }

    // ---- publication: only a request is ever recorded; nothing is published
    case "publication.request": {
      const app = appOf(event.appId);
      if (!app) return missing(state.apps, event.appId);
      let via: Publication["via"] = "person";
      if (person) { const denied = needDeveloper(); if (denied) return denied; }
      else if (isWorker(event.actor)) { if (!autoAllowed(state)) return refuse("needsAuthorization"); via = "authorized"; }
      else return refuse("personRequired");
      if (app.status !== "active") return refuse("notEligible", { detail: "solo una app activa se puede solicitar" });
      if (state.publications.some((item) => item.tenantId === tenant && item.appId === app.id && item.status === "requested")) return refuse("exists", { detail: "ya hay una solicitud abierta" });
      const made = nextId(state, "pub");
      const publication: Publication = { id: made.id, tenantId: tenant, appId: app.id, status: "requested", via, requestedBy: event.actor, requestedAt: event.at, note: event.note ?? "" };
      return { state: log({ ...made.state, publications: append(made.state.publications, publication) }, event, "app", via === "authorized" ? "publication.request.auto" : "publication.request", `${made.id} · ${app.name}`) };
    }

    case "publication.decide": {
      const denied = needDeveloper();
      if (denied) return denied;
      const publication = state.publications.find((item) => item.id === event.publicationId);
      if (!publication) return refuse("notFound");
      if (publication.tenantId !== tenant) return refuse("notYours");
      if (publication.status !== "requested") return refuse("closed");
      const status = event.approve ? "approved" : "rejected";
      return { state: log({ ...state, publications: replace(state.publications, { ...publication, status, decidedBy: event.actor, decidedAt: event.at }) }, event, "app", "publication.decide", `${publication.id} · ${status}${event.approve ? " (no se publica nada)" : ""}`) };
    }

    // ---- API keys: simulated credentials; only a person creates them
    case "key.create":
    case "key.regenerate": {
      const denied = needDeveloper();
      if (denied) return denied;
      let source: ApiKey | undefined;
      let appId = "";
      let name = "";
      let scopes: readonly Scope[] = [];
      let expiresAt: string | undefined;
      let rate = 0;
      if (event.type === "key.regenerate") {
        source = keyOf(event.keyId);
        if (!source) return missing(state.keys, event.keyId);
        if (source.status !== "active") return refuse("notActive", { detail: source.status === "revoked" ? "revocada" : "expirada" });
        ({ appId, name, scopes, expiresAt, rateLimitRpm: rate } = { ...source, rateLimitRpm: source.rateLimitRpm });
      } else {
        const app = appOf(event.appId);
        if (!app) return missing(state.apps, event.appId);
        if (event.name.trim() === "" || event.name.length > 60 || !validScopes(event.scopes)) return refuse("invalid", { detail: "nombre y permisos" });
        if (!event.scopes.every((item) => app.scopes.includes(item))) return refuse("scopeTooWide", { detail: app.name });
        if (event.expiresAt !== undefined && !(Date.parse(event.expiresAt) > Date.parse(event.at))) return refuse("invalid", { detail: "la fecha de expiración debe ser futura" });
        if (event.rateLimitRpm !== undefined && (!Number.isInteger(event.rateLimitRpm) || event.rateLimitRpm < 1 || event.rateLimitRpm > app.rateLimitRpm)) return refuse("invalid", { detail: "el límite de la llave no puede superar el de la aplicación" });
        appId = app.id; name = event.name.trim(); scopes = event.scopes; expiresAt = event.expiresAt; rate = event.rateLimitRpm ?? app.rateLimitRpm;
      }
      const made = nextId(state, "key");
      const secret = newSecret(tenant, made.state.sequence, "kyn_sim_");
      const key: ApiKey = {
        id: made.id, tenantId: tenant, appId, name, prefix: secret.slice(0, 12), last4: secret.slice(-4), hash: fnv(secret), scopes, status: "active", rateLimitRpm: rate, ...(expiresAt ? { expiresAt } : {}),
        createdBy: event.actor, createdAt: event.at, ...(source ? { replaces: source.id } : {}),
      };
      let next: DevState = { ...made.state, keys: append(made.state.keys, key) };
      if (source) next = { ...next, keys: replace(next.keys, { ...source, status: "revoked", revokedAt: event.at, revokedBy: event.actor, replacedBy: key.id }) };
      next = log(next, event, "key", source ? "key.regenerate" : "key.create", `${key.id} · ${name} · ${key.prefix}…${key.last4}${source ? ` (reemplaza ${source.id})` : ""}`);
      return { state: next, reveal: { kind: "apiKey", id: key.id, secret } };
    }

    case "key.update": {
      const denied = needDeveloper();
      if (denied) return denied;
      const key = keyOf(event.keyId);
      if (!key) return missing(state.keys, event.keyId);
      if (key.status !== "active") return refuse("notActive", { detail: key.status === "revoked" ? "revocada" : "expirada" });
      const app = appOf(key.appId);
      const scopes = event.scopes ?? key.scopes;
      if ((event.name !== undefined && (event.name.trim() === "" || event.name.length > 60)) || !validScopes(scopes)) return refuse("invalid", { detail: "nombre y permisos" });
      if (app && !scopes.every((item) => app.scopes.includes(item))) return refuse("scopeTooWide", { detail: app.name });
      if (event.expiresAt !== undefined && !(Date.parse(event.expiresAt) > Date.parse(event.at))) return refuse("invalid", { detail: "la fecha de expiración debe ser futura" });
      if (event.rateLimitRpm !== undefined && (!Number.isInteger(event.rateLimitRpm) || event.rateLimitRpm < 1 || (app !== undefined && event.rateLimitRpm > app.rateLimitRpm))) return refuse("invalid", { detail: "el límite de la llave no puede superar el de la aplicación" });
      const updated: ApiKey = { ...key, name: event.name?.trim() ?? key.name, scopes, expiresAt: event.expiresAt ?? key.expiresAt, rateLimitRpm: event.rateLimitRpm ?? key.rateLimitRpm };
      return { state: log({ ...state, keys: replace(state.keys, updated) }, event, "key", "key.update", `${key.id} · permisos ${key.scopes.join(",")} → ${scopes.join(",")}`) };
    }

    case "key.revoke": {
      const denied = needDeveloper();
      if (denied) return denied;
      const key = keyOf(event.keyId);
      if (!key) return missing(state.keys, event.keyId);
      if (key.status !== "active") return refuse("closed");
      return { state: log({ ...state, keys: replace(state.keys, { ...key, status: "revoked", revokedAt: event.at, revokedBy: event.actor }) }, event, "key", "key.revoke", `${key.id} · ${key.name}`) };
    }

    case "key.expire": {
      const denied = needSystem(); // the platform expires a key when its date arrives
      if (denied) return denied;
      const key = keyOf(event.keyId);
      if (!key) return missing(state.keys, event.keyId);
      if (key.status !== "active" || !key.expiresAt || Date.parse(key.expiresAt) > Date.parse(event.at)) return refuse("notEligible", { detail: "la llave no ha llegado a su fecha de expiración" });
      return { state: log({ ...state, keys: replace(state.keys, { ...key, status: "expired" }) }, event, "key", "key.expire", `${key.id} · ${key.name}`) };
    }

    // ---- webhooks: architecture only, nothing leaves the simulation
    case "webhook.create": {
      const denied = needDeveloper();
      if (denied) return denied;
      if (!URL_OK.test(event.url) || !validEvents(event.events)) return refuse("invalid", { detail: "la dirección (https) y los eventos" });
      if (event.appId !== undefined && !appOf(event.appId)) return missing(state.apps, event.appId);
      const made = nextId(state, "wh");
      const secret = newSecret(tenant, made.state.sequence, "whsec_sim_");
      const hook: Webhook = { id: made.id, tenantId: tenant, ...(event.appId ? { appId: event.appId } : {}), url: event.url, events: event.events, status: "active", secretHash: fnv(secret), secretPrefix: secret.slice(0, 14), createdBy: event.actor, createdAt: event.at, updatedAt: event.at };
      return { state: log({ ...made.state, webhooks: append(made.state.webhooks, hook) }, event, "webhook", "webhook.create", `${made.id} · ${event.url}`), reveal: { kind: "webhookSecret", id: made.id, secret } };
    }

    case "webhook.update": {
      const denied = needDeveloper();
      if (denied) return denied;
      const hook = hookOf(event.webhookId);
      if (!hook) return missing(state.webhooks, event.webhookId);
      if (hook.status === "deleted") return refuse("notActive", { detail: "eliminado" });
      if ((event.url !== undefined && !URL_OK.test(event.url)) || (event.events !== undefined && !validEvents(event.events))) return refuse("invalid", { detail: "la dirección (https) y los eventos" });
      const updated: Webhook = { ...hook, url: event.url ?? hook.url, events: event.events ?? hook.events, updatedAt: event.at };
      return { state: log({ ...state, webhooks: replace(state.webhooks, updated) }, event, "webhook", "webhook.update", `${hook.id} · ${hook.url} → ${updated.url}; eventos ${hook.events.length} → ${updated.events.length}`) };
    }

    case "webhook.setStatus": {
      const denied = needDeveloper();
      if (denied) return denied;
      const hook = hookOf(event.webhookId);
      if (!hook) return missing(state.webhooks, event.webhookId);
      if (hook.status === "deleted") return refuse("notActive", { detail: "eliminado" });
      if (hook.status === event.to) return refuse("exists", { detail: "ya está en ese estado" });
      return { state: log({ ...state, webhooks: replace(state.webhooks, { ...hook, status: event.to, updatedAt: event.at }) }, event, "webhook", "webhook.setStatus", `${hook.id} · ${hook.status} → ${event.to}`) };
    }

    case "webhook.delete": {
      const denied = needDeveloper();
      if (denied) return denied;
      const hook = hookOf(event.webhookId);
      if (!hook) return missing(state.webhooks, event.webhookId);
      if (hook.status === "deleted") return refuse("closed");
      // the webhook stops working, but its deliveries and its log stay: nothing about the history is erased
      return { state: log({ ...state, webhooks: replace(state.webhooks, { ...hook, status: "deleted", updatedAt: event.at }) }, event, "webhook", "webhook.delete", `${hook.id} · ${hook.url}`) };
    }

    case "webhook.rotateSecret": {
      const denied = needDeveloper();
      if (denied) return denied;
      const hook = hookOf(event.webhookId);
      if (!hook) return missing(state.webhooks, event.webhookId);
      if (hook.status === "deleted") return refuse("notActive", { detail: "eliminado" });
      const made = nextId(state, "sec");
      const secret = newSecret(tenant, made.state.sequence, "whsec_sim_");
      return { state: log({ ...made.state, webhooks: replace(made.state.webhooks, { ...hook, secretHash: fnv(secret), secretPrefix: secret.slice(0, 14), updatedAt: event.at }) }, event, "webhook", "webhook.rotateSecret", hook.id), reveal: { kind: "webhookSecret", id: hook.id, secret } };
    }

    case "webhook.simulate": {
      const denied = needDeveloper();
      if (denied) return denied;
      const hook = hookOf(event.webhookId);
      if (!hook) return missing(state.webhooks, event.webhookId);
      if (hook.status !== "active") return refuse("notActive", { detail: hook.status === "paused" ? "pausado" : "eliminado" });
      if (!hook.events.includes(event.event)) return refuse("invalid", { detail: "el webhook no escucha ese evento" });
      return { state: deliver(state, hook, event.event, event.actor) };
    }

    case "webhook.retry": {
      const denied = needDeveloper();
      if (denied) return denied;
      const delivery = state.deliveries.find((item) => item.id === event.deliveryId);
      if (!delivery) return refuse("notFound");
      if (delivery.tenantId !== tenant) return refuse("notYours");
      const hook = hookOf(delivery.webhookId);
      if (!hook || hook.status !== "active") return refuse("notActive", { detail: "el webhook no está activo" });
      if (delivery.status === "delivered") return refuse("closed");
      if (delivery.attempts.length >= MAX_DELIVERY_ATTEMPTS) return refuse("exhausted");
      const attempt = simulateAttempt(state, tenant, hook.url, state.sequence + delivery.attempts.length + 1);
      const attempts = append(delivery.attempts, { at: event.at, status: attempt.status, latencyMs: attempt.latencyMs, ok: attempt.ok, by: event.actor });
      const status: DeliveryStatus = attempt.ok ? "delivered" : attempts.length >= MAX_DELIVERY_ATTEMPTS ? "exhausted" : "failed";
      return { state: log({ ...state, sequence: state.sequence + 1, deliveries: replace(state.deliveries, { ...delivery, attempts, status }) }, event, attempt.ok ? "webhook" : "error", "webhook.retry", `${delivery.id} · intento ${attempts.length} → ${attempt.status}`) };
    }

    // ---- sandbox: simulated data, events, errors and latency
    case "sandbox.create":
    case "sandbox.configure": {
      const denied = needDeveloper();
      if (denied) return denied;
      const existing = event.type === "sandbox.configure" ? state.sandboxes.find((item) => item.id === event.sandboxId && item.tenantId === tenant) : undefined;
      if (event.type === "sandbox.configure" && !existing) return missing(state.sandboxes, event.sandboxId);
      const latencyMs = event.latencyMs ?? existing?.latencyMs ?? 120;
      const errorRatePercent = event.errorRatePercent ?? existing?.errorRatePercent ?? 0;
      const name = (event.type === "sandbox.create" ? event.name : existing?.name ?? "").trim();
      if (name === "" || name.length > 60 || !Number.isInteger(latencyMs) || latencyMs < 0 || latencyMs > 5_000 || !Number.isInteger(errorRatePercent) || errorRatePercent < 0 || errorRatePercent > 100) return refuse("invalid", { detail: "nombre, latencia (0 a 5000 ms) y errores (0 a 100 %)" });
      if (existing) return { state: log({ ...state, sandboxes: replace(state.sandboxes, { ...existing, latencyMs, errorRatePercent, updatedAt: event.at }) }, event, "other", "sandbox.configure", `${existing.id} · latencia ${existing.latencyMs} → ${latencyMs}; errores ${existing.errorRatePercent} → ${errorRatePercent}`) };
      const made = nextId(state, "sbx");
      return { state: log({ ...made.state, sandboxes: append(made.state.sandboxes, { id: made.id, tenantId: tenant, name, latencyMs, errorRatePercent, createdBy: event.actor, createdAt: event.at, updatedAt: event.at }) }, event, "other", "sandbox.create", `${made.id} · ${name}`) };
    }

    case "sandbox.emit": {
      const denied = needDeveloper();
      if (denied) return denied;
      const sandbox = sandboxOf(state);
      if (!sandbox) return refuse("notEligible", { detail: "primero cree un sandbox" });
      if (!EVENT_TYPES.includes(event.event)) return refuse("invalid", { detail: "evento" });
      const made = nextId(state, "evt");
      const targets = made.state.webhooks.filter((item) => item.tenantId === tenant && item.status === "active" && item.events.includes(event.event));
      let next: DevState = { ...made.state, sandboxEvents: append(made.state.sandboxEvents, { id: made.id, tenantId: tenant, sandboxId: sandbox.id, type: event.event, at: event.at, by: event.actor, payload: samplePayload(event.event, tenant, made.state.sequence), deliveries: targets.length }) };
      next = log(next, event, "event", "sandbox.emit", `${made.id} · ${event.event} → ${targets.length} webhooks`);
      for (const hook of targets) next = deliver(next, hook, event.event, event.actor);
      return { state: next };
    }

    // ---- requests: the explorer asks KOE for a simulated answer; the platform reports aggregated use
    case "api.request": {
      const denied = needDeveloper();
      if (denied) return denied;
      const key = keyOf(event.keyId);
      if (!key) return missing(state.keys, event.keyId);
      const endpoint = ENDPOINTS.find((item) => item.id === event.endpointId);
      if (!endpoint) return refuse("invalid", { detail: "endpoint" });
      const answer = simulateRequest(state, tenant, key, endpoint, event.at);
      const made = nextId(state, "req");
      const record: RequestRecord = {
        id: made.id, tenantId: tenant, at: event.at, appId: key.appId, keyId: key.id, endpointId: endpoint.id, method: endpoint.method, path: endpoint.path, version: appOf(key.appId)?.apiVersion ?? "v1", status: answer.status,
        latencyMs: answer.latencyMs, count: 1, errors: answer.status >= 400 ? 1 : 0, rateLimited: answer.rateLimited, by: event.actor, source: "explorer", response: answer.body,
      };
      const used = answer.status === 401 ? made.state.keys : replace(made.state.keys, { ...key, lastUsedAt: event.at });
      return { state: log({ ...made.state, keys: used, requests: append(made.state.requests, record) }, event, answer.status >= 400 ? "error" : "request", "api.request", `${endpoint.method} ${endpoint.path} → ${answer.status} (${answer.latencyMs} ms, simulado)`) };
    }

    case "usage.report": {
      const denied = needSystem();
      if (denied) return denied;
      const key = keyOf(event.keyId);
      if (!key) return missing(state.keys, event.keyId);
      const endpoint = ENDPOINTS.find((item) => item.id === event.endpointId);
      const errors = event.errors ?? 0;
      if (!endpoint || !Number.isInteger(event.count) || event.count < 1 || !Number.isInteger(errors) || errors < 0 || errors > event.count) return refuse("invalid", { detail: "endpoint y cantidades" });
      const made = nextId(state, "req");
      const record: RequestRecord = {
        id: made.id, tenantId: tenant, at: event.at, appId: key.appId, keyId: key.id, endpointId: endpoint.id, method: endpoint.method, path: endpoint.path, version: appOf(key.appId)?.apiVersion ?? "v1", status: 200,
        latencyMs: 0, count: event.count, errors, rateLimited: event.rateLimited ?? false, by: event.actor, source: "platform",
      };
      const lastUsedAt = key.lastUsedAt && Date.parse(key.lastUsedAt) > Date.parse(event.at) ? key.lastUsedAt : event.at; // a late report never makes a key look older
      return { state: { ...made.state, keys: replace(made.state.keys, { ...key, lastUsedAt }), requests: append(made.state.requests, record) } };
    }

    // ---- Level 1: NEX prepares, a person approves
    case "proposal.create": {
      const denied = needDrafter();
      if (denied) return denied;
      const kind = (event.payload as { kind: string }).kind;
      if (kind !== "key" && kind !== "webhook" && kind !== "app") return refuse("criticalForHuman"); // credentials, activating, publishing and logs are never prepared by NEX
      const payload = event.payload;
      if (payload.kind === "key") {
        const app = appOf(payload.appId);
        if (!app) return missing(state.apps, payload.appId);
        if (payload.name.trim() === "" || !validScopes(payload.scopes)) return refuse("invalid", { detail: "nombre y permisos" });
        if (!payload.scopes.every((item) => app.scopes.includes(item))) return refuse("scopeTooWide", { detail: app.name });
      } else if (payload.kind === "webhook") {
        if (!URL_OK.test(payload.url) || !validEvents(payload.events)) return refuse("invalid", { detail: "la dirección (https) y los eventos" });
        if (payload.appId !== undefined && !appOf(payload.appId)) return missing(state.apps, payload.appId);
      } else if (payload.name.trim() === "" || !APP_KINDS.includes(payload.appKind) || !validScopes(payload.scopes)) return refuse("invalid", { detail: "nombre, tipo y permisos" });
      const made = nextId(state, "pr");
      return { state: log({ ...made.state, proposals: append(made.state.proposals, { id: made.id, tenantId: tenant, payload, status: "proposed", proposedBy: event.actor, proposedAt: event.at, reason: event.reason ?? "Propuesta de NEX" }) }, event, "proposal", "proposal.create", `${made.id} · ${payload.kind}`) };
    }

    case "proposal.approve":
    case "proposal.reject": {
      const denied = needDeveloper();
      if (denied) return denied;
      const proposal = state.proposals.find((item) => item.id === event.proposalId);
      if (!proposal) return refuse("notFound");
      if (proposal.tenantId !== tenant) return refuse("notYours");
      if (proposal.status !== "proposed") return refuse("closed");
      if (event.type === "proposal.reject") return { state: log({ ...state, proposals: replace(state.proposals, { ...proposal, status: "rejected", decidedBy: event.actor, decidedAt: event.at }) }, event, "proposal", "proposal.reject", proposal.id) };
      // approving applies the change as the approver, through the same rules as if the person had done it; a secret is shown to the approver once
      const base = { at: event.at, tenantId: tenant, actor: event.actor };
      const p = proposal.payload;
      const applied = p.kind === "key" ? reduceDev(state, { ...base, type: "key.create", appId: p.appId, name: p.name, scopes: p.scopes, expiresAt: p.expiresAt }, env)
        : p.kind === "webhook" ? reduceDev(state, { ...base, type: "webhook.create", url: p.url, events: p.events, appId: p.appId }, env)
        : reduceDev(state, { ...base, type: "app.create", name: p.name, appKind: p.appKind, description: p.description, scopes: p.scopes, apiVersion: p.apiVersion }, env);
      if (applied.error) return applied;
      return { state: log({ ...applied.state, proposals: replace(applied.state.proposals, { ...proposal, status: "approved", decidedBy: event.actor, decidedAt: event.at }) }, event, "proposal", "proposal.approve", `${proposal.id} · ${p.kind}`), ...(applied.reveal ? { reveal: applied.reveal } : {}) };
    }

    // ---- KOE's own analysis: recorded with the Worker and the model it used, never overwritten
    case "dev.analyze": {
      const denied = needDrafter();
      if (denied) return denied;
      const plan = planExecution(env, tenant, "reporter", { tools: ["summary.prepare"], clearance: "business" });
      if (failed(plan)) return refuse("noWorker", { detail: plan.problem });
      const found = recommendations(state, tenant, event.at);
      const counts: Record<string, number> = {};
      for (const item of found) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
      const made = nextId(state, "an");
      const analysis: DevAnalysis = { id: made.id, tenantId: tenant, at: event.at, by: event.actor, workerId: plan.worker.id, workerName: plan.worker.name, model: { id: plan.model.id, label: plan.model.label }, modelReason: plan.modelReason, estimatedCostMicros: plan.estimatedCostMicros, recommendationIds: found.map((item) => item.id), counts };
      return { state: log({ ...made.state, analyses: append(made.state.analyses, analysis) }, event, "other", "dev.analyze", `${made.id} · ${found.length} recomendaciones`) };
    }

    case "authorization.grant": {
      const denied = needDeveloper();
      if (denied) return denied;
      if (event.maxPerDay !== undefined && (!Number.isInteger(event.maxPerDay) || event.maxPerDay < 1 || event.maxPerDay > 20)) return refuse("invalid", { detail: "solicitudes por día de 1 a 20" });
      if (event.expiresAt !== undefined && !(Date.parse(event.expiresAt) > Date.parse(event.at))) return refuse("invalid", { detail: "la fecha de vencimiento debe ser futura" });
      const made = nextId(state, "gr");
      return { state: log({ ...made.state, grants: append(made.state.grants, { id: made.id, tenantId: tenant, action: DEV_AUTH_ACTION, status: "active", maxPerDay: event.maxPerDay, expiresAt: event.expiresAt, grantedBy: event.actor, grantedAt: event.at }) }, event, "access", "authorization.grant", `${made.id} · ${DEV_AUTH_ACTION}`) };
    }

    case "authorization.revoke": {
      const denied = needDeveloper();
      if (denied) return denied;
      const grant = state.grants.find((item) => item.id === event.grantId);
      if (!grant) return refuse("notFound");
      if (grant.tenantId !== tenant) return refuse("notYours");
      if (grant.status === "revoked") return refuse("closed");
      return { state: log({ ...state, grants: replace(state.grants, { ...grant, status: "revoked" }) }, event, "access", "authorization.revoke", grant.id) };
    }
  }
}

export function applyAllDev(state: DevState, events: readonly DevEvent[], env: DevEnv = DEFAULT_DEV_ENV): { state: DevState; errors: string[] } {
  const errors: string[] = [];
  let current = state;
  for (const event of events) {
    const result = reduceDev(current, event, env);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    current = result.state;
  }
  return { state: current, errors };
}

const mine = <T extends { tenantId: string }>(items: readonly T[], tenantId: string) => items.filter((item) => item.tenantId === tenantId);
export const appsOf = (state: DevState, tenantId: string) => mine(state.apps, tenantId);
export const keysOf = (state: DevState, tenantId: string) => mine(state.keys, tenantId);
export const webhooksOf = (state: DevState, tenantId: string) => mine(state.webhooks, tenantId);
export const deliveriesOf = (state: DevState, tenantId: string) => mine(state.deliveries, tenantId);
export const sandboxesOf = (state: DevState, tenantId: string) => mine(state.sandboxes, tenantId);
export const sandboxEventsOf = (state: DevState, tenantId: string) => mine(state.sandboxEvents, tenantId);
export const requestsOf = (state: DevState, tenantId: string) => mine(state.requests, tenantId);
export const publicationsOf = (state: DevState, tenantId: string) => mine(state.publications, tenantId);
export const proposalsOf = (state: DevState, tenantId: string) => mine(state.proposals, tenantId);
export const grantsOf = (state: DevState, tenantId: string) => mine(state.grants, tenantId);
export const analysesOf = (state: DevState, tenantId: string) => mine(state.analyses, tenantId);
export const logsOf = (state: DevState, tenantId: string, kind?: LogKind) => state.logs.filter((item) => item.tenantId === tenantId && (!kind || item.kind === kind));
