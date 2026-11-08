// KOE Developer Intelligence: the ONE place where the developer platform is worked out. The rate limits (company, app, key and plan), the consumption,
// the answer a simulated API request gets, the outcome of a simulated webhook delivery, the signature, the secrets, the sandbox data, the dashboard and every
// recommendation (a key about to expire, an unused key, a failing webhook, a key near its limit, a version being retired, a high error rate). Every screen
// only formats these answers, and no other module repeats this logic.
// Pure and deterministic, with no real network, no real credential and no model provider. It only reads the records of the Developer Platform; it
// never changes anything, and one company never sees another's records.

import type { ApiKey, DevState } from "./dev-center";
import { API_VERSIONS, FUTURE_SURFACES, KEY_EXPIRY_WARNING_DAYS, OAUTH_FLOWS, PLAN_RPM, SDKS, WINDOW_SECONDS, type Endpoint, type EventType } from "./dev-catalog";
import { label } from "./dev-messages";

const DAY = 86_400_000;

// ---------------------------------------------------------------- the rules and assumptions (declared, so every figure can be explained)
export const NEAR_LIMIT_RATIO = 0.8; // from this share of a limit KOE starts to recommend
export const UNUSED_KEY_DAYS = 30;
export const FAILING_WEBHOOK_MIN = 3; // failed deliveries in the window
export const FAILING_WEBHOOK_DAYS = 7;
export const ERROR_RATE_ALERT_PERCENT = 10;
export const ERROR_RATE_MIN_REQUESTS = 50;
export const CONSUMPTION_DAYS = 30;
export const SERIES_DAYS = 14;
export const BASE_LATENCY_MS = 40;

/** Reserved for what KOE will read from the other modules (for example the Worker runs an API call asked for). Empty today. */
export type DevSignals = Record<string, never>;

// ---------------------------------------------------------------- deterministic pieces (no randomness: the same input always gives the same answer)
/** A small deterministic hash (FNV-1a). It stands in for the real hash a credential store would use: this is a simulation. */
export function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
const number = (text: string): number => Number.parseInt(fnv(text), 16);

/** A SIMULATED secret: recognisable as fake by its prefix, never a real credential, derived only from the company and a counter. */
export function newSecret(tenantId: string, sequence: number, prefix: string): string {
  const part = (salt: number) => number(`${tenantId}|${sequence}|${salt}`).toString(36).padStart(7, "0").slice(-7);
  return `${prefix}${part(1)}${part(2)}${part(3)}`;
}
export const maskKey = (prefix: string, last4: string): string => `${prefix}…${last4}`;
export const signatureFor = (secretHash: string, type: string, deliveryId: string): string => `v1=${fnv(`${secretHash}|${type}|${deliveryId}`)}${fnv(`${deliveryId}|${type}|${secretHash}`)}`;

const sandboxOf = (state: DevState, tenantId: string) => state.sandboxes.filter((item) => item.tenantId === tenantId).at(-1);

// ---------------------------------------------------------------- rate limits (company, app, key, plan)
export type RateStatus = "ok" | "warn" | "atLimit" | "over";
export type RateRow = { level: "company" | "app" | "key"; id: string; name: string; used: number; limit: number; effective: number; ratio: number; status: RateStatus };
const statusOf = (used: number, limit: number): RateStatus => (used > limit ? "over" : used === limit ? "atLimit" : limit > 0 && used / limit >= NEAR_LIMIT_RATIO ? "warn" : "ok");

/** The requests per minute the plan allows the whole company. */
export const planLimit = (state: DevState, tenantId: string): number => PLAN_RPM[state.accounts.find((item) => item.tenantId === tenantId)?.planId ?? ""] ?? PLAN_RPM["starter"] ?? 60;
const inWindow = (state: DevState, tenantId: string, at: string, seconds = WINDOW_SECONDS) => state.requests.filter((item) => item.tenantId === tenantId && Date.parse(item.at) > Date.parse(at) - seconds * 1_000 && Date.parse(item.at) <= Date.parse(at));
const countOf = (rows: readonly { count: number }[]): number => { let total = 0; for (const row of rows) total += row.count; return total; };

/** What each level has used in the last minute, against its limit. A key can only be limited further than its app, and an app further than the plan. */
export function rateStatus(state: DevState, tenantId: string, asOf: string): RateRow[] {
  const recent = inWindow(state, tenantId, asOf);
  const company = planLimit(state, tenantId);
  const rows: RateRow[] = [{ level: "company", id: tenantId, name: "Empresa", used: countOf(recent), limit: company, effective: company, ratio: 0, status: "ok" }];
  const appLimits = new Map<string, number>();
  for (const app of state.apps.filter((item) => item.tenantId === tenantId && item.status !== "paused")) {
    const limit = Math.min(app.rateLimitRpm, company);
    appLimits.set(app.id, limit);
    rows.push({ level: "app", id: app.id, name: app.name, used: countOf(recent.filter((item) => item.appId === app.id)), limit: app.rateLimitRpm, effective: limit, ratio: 0, status: "ok" });
  }
  for (const key of state.keys.filter((item) => item.tenantId === tenantId && item.status === "active")) {
    const effective = Math.min(key.rateLimitRpm, appLimits.get(key.appId) ?? company, company);
    rows.push({ level: "key", id: key.id, name: key.name, used: countOf(recent.filter((item) => item.keyId === key.id)), limit: key.rateLimitRpm, effective, ratio: 0, status: "ok" });
  }
  return rows.map((row) => ({ ...row, ratio: row.effective > 0 ? row.used / row.effective : 0, status: statusOf(row.used, row.effective) }));
}

// ---------------------------------------------------------------- the simulated API
export type SimulatedAnswer = { status: number; latencyMs: number; body: string; rateLimited: boolean };
/** The answer KOE simulates for an API Explorer request. Nothing is ever sent anywhere. The same rules a real gateway would apply, decided here. */
export function simulateRequest(state: DevState, tenantId: string, key: ApiKey, endpoint: Endpoint, at: string): SimulatedAnswer {
  const sandbox = sandboxOf(state, tenantId);
  const latencyMs = BASE_LATENCY_MS + number(`${key.id}|${endpoint.id}|${at}`) % 60 + (sandbox?.latencyMs ?? 0);
  const reply = (status: number, body: Record<string, unknown>, rateLimited = false): SimulatedAnswer => ({ status, latencyMs, body: JSON.stringify(body), rateLimited });
  const app = state.apps.find((item) => item.id === key.appId && item.tenantId === tenantId);
  if (key.status !== "active" || (key.expiresAt && Date.parse(key.expiresAt) <= Date.parse(at))) return reply(401, { error: "invalid_api_key", message: "La llave no está activa." });
  if (!key.scopes.includes(endpoint.scope)) return reply(403, { error: "insufficient_scope", required: endpoint.scope });
  if (app?.status === "paused") return reply(403, { error: "app_paused", message: "La aplicación está pausada." });
  const recent = inWindow(state, tenantId, at);
  const used = { key: countOf(recent.filter((item) => item.keyId === key.id)), app: countOf(recent.filter((item) => item.appId === key.appId)), company: countOf(recent) };
  const limits = { key: key.rateLimitRpm, app: app?.rateLimitRpm ?? key.rateLimitRpm, company: planLimit(state, tenantId) };
  const hit = (["key", "app", "company"] as const).find((level) => used[level] + 1 > limits[level]);
  if (hit) return reply(429, { error: "rate_limited", level: hit, limitPerMinute: limits[hit], retryAfterSeconds: WINDOW_SECONDS }, true);
  if (sandbox && sandbox.errorRatePercent > 0 && number(`${key.id}|${at}|${state.sequence}`) % 100 < sandbox.errorRatePercent) return reply(500, { error: "simulated_error", message: "Error simulado por el sandbox." });
  return { status: 200, latencyMs, body: endpoint.sample, rateLimited: false };
}

export type DeliveryAttempt = { status: number; latencyMs: number; ok: boolean };
/** How a simulated delivery to a webhook goes: an address with "fail" always fails, one with "slow" times out, and otherwise the sandbox decides. */
export function simulateAttempt(state: DevState, tenantId: string, url: string, seed: number): DeliveryAttempt {
  const sandbox = sandboxOf(state, tenantId);
  const host = url.replace(/^https:\/\//i, "").split("/")[0]?.toLowerCase() ?? "";
  const jitter = number(`${seed}|${url}`) % 60;
  if (host.includes("fail")) return { status: 500, latencyMs: BASE_LATENCY_MS + jitter + (sandbox?.latencyMs ?? 0), ok: false };
  if (host.includes("slow")) return { status: 504, latencyMs: 5_000, ok: false };
  const failed = !!sandbox && sandbox.errorRatePercent > 0 && number(`${seed}|${url}|e`) % 100 < sandbox.errorRatePercent;
  return { status: failed ? 500 : 200, latencyMs: BASE_LATENCY_MS + jitter + (sandbox?.latencyMs ?? 0), ok: !failed };
}

export const samplePayload = (type: EventType, tenantId: string, sequence: number): string =>
  JSON.stringify({ id: `evt_${fnv(`${tenantId}|${sequence}`)}`, type, sandbox: true, data: { example: true, note: "Datos simulados del sandbox" } });

export type SandboxLead = { id: string; name: string; stage: string; valueMicros: number };
/** The simulated data of a sandbox: always the same for the same company. */
export function sandboxData(state: DevState, tenantId: string): SandboxLead[] {
  if (!sandboxOf(state, tenantId)) return [];
  const names = ["Café del Valle", "Estudio Aurora", "Clínica Brisa", "Taller Nimbo", "Librería Faro"];
  const stages = ["prospect", "qualified", "meeting", "proposal"];
  return names.map((name, index) => ({ id: `ld_sbx_${index + 1}`, name, stage: stages[number(`${tenantId}|${name}`) % stages.length] ?? "prospect", valueMicros: (2 + number(`${name}|${tenantId}`) % 18) * 1_000_000 }));
}

// ---------------------------------------------------------------- consumption
export type UsageRow = { id: string; label: string; requests: number; errors: number };
export type Consumption = {
  windowDays: number; requests: number; errors: number; rateLimited: number; errorRatePercent: number | null;
  byApp: UsageRow[]; byKey: UsageRow[]; byEndpoint: UsageRow[]; byVersion: UsageRow[]; series: { day: string; requests: number; errors: number }[];
};
const rank = (rows: Map<string, UsageRow>): UsageRow[] => [...rows.values()].sort((a, b) => b.requests - a.requests || a.label.localeCompare(b.label));
export function consumption(state: DevState, tenantId: string, asOf: string): Consumption {
  const start = Date.parse(asOf) - CONSUMPTION_DAYS * DAY;
  const rows = state.requests.filter((item) => item.tenantId === tenantId && Date.parse(item.at) > start && Date.parse(item.at) <= Date.parse(asOf));
  const group = (key: (row: (typeof rows)[number]) => { id: string; label: string } | undefined) => {
    const map = new Map<string, UsageRow>();
    for (const row of rows) {
      const k = key(row);
      if (!k) continue;
      const entry = map.get(k.id) ?? { id: k.id, label: k.label, requests: 0, errors: 0 };
      entry.requests += row.count;
      entry.errors += row.errors;
      map.set(k.id, entry);
    }
    return rank(map);
  };
  let requests = 0;
  let errors = 0;
  let rateLimited = 0;
  for (const row of rows) { requests += row.count; errors += row.errors; if (row.rateLimited) rateLimited += row.count; }
  const series: Consumption["series"] = [];
  for (let back = SERIES_DAYS - 1; back >= 0; back -= 1) {
    const day = new Date(Date.parse(asOf) - back * DAY).toISOString().slice(0, 10);
    const dayRows = rows.filter((row) => row.at.slice(0, 10) === day);
    series.push({ day, requests: countOf(dayRows), errors: dayRows.map((row) => row.errors).reduce((a, b) => a + b, 0) });
  }
  return {
    windowDays: CONSUMPTION_DAYS, requests, errors, rateLimited, errorRatePercent: requests > 0 ? Math.round((errors / requests) * 1_000) / 10 : null,
    byApp: group((row) => (row.appId ? { id: row.appId, label: state.apps.find((item) => item.id === row.appId)?.name ?? row.appId } : undefined)),
    byKey: group((row) => (row.keyId ? { id: row.keyId, label: state.keys.find((item) => item.id === row.keyId)?.name ?? row.keyId } : undefined)),
    byEndpoint: group((row) => ({ id: row.endpointId, label: `${row.method} ${row.path}` })),
    byVersion: group((row) => ({ id: row.version, label: row.version })),
    series,
  };
}

// ---------------------------------------------------------------- recommendations
export type Recommendation = { id: string; kind: "keyExpiring" | "keyUnused" | "webhookFailing" | "nearLimit" | "deprecatedVersion" | "errorRate"; severity: "normal" | "high"; text: string; reason: string; target?: string };
export function recommendations(state: DevState, tenantId: string, asOf: string): Recommendation[] {
  const now = Date.parse(asOf);
  const found: Recommendation[] = [];
  for (const key of state.keys.filter((item) => item.tenantId === tenantId && item.status === "active")) {
    if (key.expiresAt) {
      const days = Math.floor((Date.parse(key.expiresAt) - now) / DAY);
      if (days >= 0 && days <= KEY_EXPIRY_WARNING_DAYS) found.push({ id: `keyExpiring:${key.id}`, kind: "keyExpiring", severity: days <= 3 ? "high" : "normal", text: `La API Key «${key.name}» expira en ${days} días.`, reason: "Regenerarla a tiempo evita que la aplicación deje de funcionar.", target: key.id });
    }
    const idle = Math.floor((now - Date.parse(key.lastUsedAt ?? key.createdAt)) / DAY);
    if (idle >= UNUSED_KEY_DAYS) found.push({ id: `keyUnused:${key.id}`, kind: "keyUnused", severity: "normal", text: `La API Key «${key.name}» lleva ${idle} días sin usarse.`, reason: "Una llave sin uso es un riesgo innecesario: conviene revocarla.", target: key.id });
  }
  for (const hook of state.webhooks.filter((item) => item.tenantId === tenantId && item.status === "active")) {
    const failures = state.deliveries.filter((item) => item.webhookId === hook.id && item.status !== "delivered" && Date.parse(item.at) > now - FAILING_WEBHOOK_DAYS * DAY).length;
    if (failures >= FAILING_WEBHOOK_MIN) found.push({ id: `webhookFailing:${hook.id}`, kind: "webhookFailing", severity: "high", text: `El webhook ${hook.url} falló ${failures} veces en ${FAILING_WEBHOOK_DAYS} días.`, reason: "Revise la dirección o páusalo hasta corregirla.", target: hook.id });
  }
  for (const row of rateStatus(state, tenantId, asOf).filter((item) => item.status !== "ok")) {
    found.push({ id: `nearLimit:${row.id}`, kind: "nearLimit", severity: row.status === "warn" ? "normal" : "high", text: `${label("rateLevel", row.level)} «${row.name}»: ${row.used} de ${row.effective} peticiones por minuto.`, reason: "Un plan mayor o un límite mejor repartido evita respuestas 429.", target: row.id });
  }
  for (const app of state.apps.filter((item) => item.tenantId === tenantId && item.status !== "paused")) {
    if (API_VERSIONS.find((item) => item.id === app.apiVersion)?.status === "deprecated") found.push({ id: `deprecatedVersion:${app.id}`, kind: "deprecatedVersion", severity: "normal", text: `La aplicación «${app.name}» usa la versión ${app.apiVersion}, que se retirará.`, reason: "Migrar a una versión estable evita interrupciones.", target: app.id });
  }
  const usage = consumption(state, tenantId, asOf);
  if (usage.errorRatePercent !== null && usage.requests >= ERROR_RATE_MIN_REQUESTS && usage.errorRatePercent >= ERROR_RATE_ALERT_PERCENT) {
    found.push({ id: `errorRate:${tenantId}`, kind: "errorRate", severity: "high", text: `La tasa de errores es del ${usage.errorRatePercent} % en ${usage.windowDays} días.`, reason: "Revise los logs de errores para encontrar el endpoint que falla.", target: tenantId });
  }
  return found.sort((a, b) => (a.severity === b.severity ? a.id.localeCompare(b.id) : a.severity === "high" ? -1 : 1));
}

// ---------------------------------------------------------------- the dashboard
export type DevDashboard = {
  keys: { total: number; active: number; revoked: number; expired: number }; apps: { total: number; draft: number; active: number; paused: number };
  webhooks: { total: number; active: number; paused: number; deleted: number }; events: { emitted: number; deliveries: number; failed: number };
  sdks: number; sandbox?: { name: string; latencyMs: number; errorRatePercent: number }; versions: { id: string; status: string; apps: number; note: string }[];
  consumption: Consumption; rate: RateRow[]; planRpm: number; logs: number; recommendations: Recommendation[]; health: "ok" | "attention";
};
export function devDashboard(state: DevState, tenantId: string, asOf: string): DevDashboard | undefined {
  if (!state.accounts.some((item) => item.tenantId === tenantId)) return undefined;
  const keys = state.keys.filter((item) => item.tenantId === tenantId);
  const apps = state.apps.filter((item) => item.tenantId === tenantId);
  const hooks = state.webhooks.filter((item) => item.tenantId === tenantId);
  const deliveries = state.deliveries.filter((item) => item.tenantId === tenantId);
  const sandbox = sandboxOf(state, tenantId);
  const recs = recommendations(state, tenantId, asOf);
  return {
    keys: { total: keys.length, active: keys.filter((item) => item.status === "active").length, revoked: keys.filter((item) => item.status === "revoked").length, expired: keys.filter((item) => item.status === "expired").length },
    apps: { total: apps.length, draft: apps.filter((item) => item.status === "draft").length, active: apps.filter((item) => item.status === "active").length, paused: apps.filter((item) => item.status === "paused").length },
    webhooks: { total: hooks.length, active: hooks.filter((item) => item.status === "active").length, paused: hooks.filter((item) => item.status === "paused").length, deleted: hooks.filter((item) => item.status === "deleted").length },
    events: { emitted: state.sandboxEvents.filter((item) => item.tenantId === tenantId).length, deliveries: deliveries.length, failed: deliveries.filter((item) => item.status !== "delivered").length },
    sdks: SDKS.length, ...(sandbox ? { sandbox: { name: sandbox.name, latencyMs: sandbox.latencyMs, errorRatePercent: sandbox.errorRatePercent } } : {}),
    versions: API_VERSIONS.map((version) => ({ id: version.id, status: version.status, apps: apps.filter((item) => item.apiVersion === version.id).length, note: version.note })),
    consumption: consumption(state, tenantId, asOf), rate: rateStatus(state, tenantId, asOf), planRpm: planLimit(state, tenantId), logs: state.logs.filter((item) => item.tenantId === tenantId).length,
    recommendations: recs, health: recs.some((item) => item.severity === "high") ? "attention" : "ok",
  };
}

// ---------------------------------------------------------------- what is declared for the future (nothing here exists)
export type Declared = { id: string; name: string; status: "notBuilt"; goesThrough: "KOE"; direct: false };
const declared = (items: readonly { id: string; name: string }[]): Declared[] => items.map((item) => ({ ...item, status: "notBuilt" as const, goesThrough: "KOE" as const, direct: false as const }));
export const SDK_CENTER = declared(SDKS);
export const OAUTH_ARCHITECTURE = declared(OAUTH_FLOWS);
export const FUTURE_PLATFORM = declared(FUTURE_SURFACES);
