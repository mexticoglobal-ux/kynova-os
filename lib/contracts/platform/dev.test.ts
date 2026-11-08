/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  API_VERSIONS, ENDPOINTS, PLAN_RPM, SDKS, analysesOf, appsOf, deliveriesOf, keysOf, logsOf, proposalsOf, publicationsOf, reduceDev, requestsOf, sandboxEventsOf, webhooksOf,
  type DevEnv, type DevEvent, type DevResult, type DevState,
} from "./dev-center";
import { DEMO_NOW, demoDevOk } from "./dev-demo";
import { ERROR_CODES, label, message } from "./dev-messages";
import { FUTURE_PLATFORM, OAUTH_ARCHITECTURE, SDK_CENTER, consumption, devDashboard, fnv, maskKey, planLimit, rateStatus, recommendations, sandboxData, simulateRequest } from "./koe-dev";
import { levelForAction } from "./workers";

const NOVA = "tenant-nova";
const VIDA = "tenant-vida";
const at = (minutes = 0) => new Date(Date.parse(DEMO_NOW) + minutes * 60_000).toISOString();
const ev = (tenantId: string, actor: string, rest: Record<string, unknown>, minutes = 1) => ({ at: at(minutes), tenantId, actor, ...rest }) as DevEvent;
type Source = { state: DevState; env: DevEnv };
const sample = (): Source => demoDevOk();
const run = (source: Source, event: DevEvent, state: DevState = source.state): DevResult => reduceDev(state, event, source.env);
const ok = (source: Source, event: DevEvent, state: DevState = source.state): DevState => {
  const result = reduceDev(state, event, source.env);
  expect(result.error, event.type).toBeUndefined();
  return result.state;
};
const reveal = (source: Source, event: DevEvent, state: DevState = source.state) => {
  const result = reduceDev(state, event, source.env);
  expect(result.error, event.type).toBeUndefined();
  return { state: result.state, secret: result.reveal!.secret, id: result.reveal!.id };
};
const key = (state: DevState, name: string, tenant = NOVA) => state.keys.find((item) => item.name === name && item.tenantId === tenant)!;
const app = (state: DevState, name: string, tenant = NOVA) => state.apps.find((item) => item.name === name && item.tenantId === tenant)!;
const hook = (state: DevState, url: string) => state.webhooks.find((item) => item.url === url && item.tenantId === NOVA)!;
const quiet = (source: Source, state: DevState = source.state): DevState => ok(source, ev(NOVA, "pablo", { type: "sandbox.configure", sandboxId: sandboxId(state), errorRatePercent: 0 }), state); // no simulated errors
const sandboxId = (state: DevState) => state.sandboxes.find((item) => item.tenantId === NOVA)!.id;

describe("the sample", () => {
  it("loads through the reducer with no refusals, for two isolated companies", () => {
    const source = sample();
    expect(source.state.accounts.map((item) => item.tenantId).sort()).toEqual([NOVA, VIDA]);
  });

  it("shows the dashboard: keys, apps, webhooks, events, SDK, sandbox, versions, consumption, rate limits and logs", () => {
    const { state } = sample();
    const nova = devDashboard(state, NOVA, DEMO_NOW)!;
    expect(nova.keys).toEqual({ total: 4, active: 3, revoked: 1, expired: 0 });
    expect(nova.apps).toEqual({ total: 3, draft: 1, active: 2, paused: 0 });
    expect(nova.webhooks).toMatchObject({ total: 2, active: 2 });
    expect(nova.events).toMatchObject({ emitted: 4, deliveries: 7, failed: 3 });
    expect(nova.sdks).toBe(7);
    expect(nova.sandbox).toMatchObject({ name: "Pruebas Nova", latencyMs: 120, errorRatePercent: 5 });
    expect(nova.versions.filter((item) => item.apps > 0).map((item) => item.id)).toEqual(["v0", "v1"]);
    expect(nova.consumption.requests).toBeGreaterThan(5_000);
    expect(nova.planRpm).toBe(300);
    expect(nova.logs).toBeGreaterThan(30);
    expect(nova.health).toBe("attention");
    expect(devDashboard(state, "tenant-unknown", DEMO_NOW)).toBeUndefined();
  });
});

describe("API keys", () => {
  it("shows the full key once and never keeps it", () => {
    const source = sample();
    const { state, secret, id } = reveal(source, ev(NOVA, "ana", { type: "key.create", appId: app(source.state, "Nova CRM Sync").id, name: "Nueva", scopes: ["crm.read"] }));
    expect(secret).toMatch(/^kyn_sim_[a-z0-9]{21}$/);
    const stored = state.keys.find((item) => item.id === id)!;
    expect(stored).toMatchObject({ prefix: secret.slice(0, 12), last4: secret.slice(-4), hash: fnv(secret), status: "active" });
    expect(maskKey(stored.prefix, stored.last4)).toBe(`${secret.slice(0, 12)}…${secret.slice(-4)}`);
    expect(JSON.stringify(state)).not.toContain(secret); // not in a key, a log or anywhere else
    expect(JSON.stringify(keysOf(state, NOVA))).not.toContain(secret);
  });

  it("validates a key against its app, its limit and its expiry", () => {
    const source = sample();
    const sync = app(source.state, "Nova CRM Sync").id;
    const base = { type: "key.create", appId: sync, name: "x", scopes: ["crm.read"] };
    expect(run(source, ev(NOVA, "ana", { ...base, scopes: [] })).errorCode).toBe("invalid");
    expect(run(source, ev(NOVA, "ana", { ...base, scopes: ["billing.read"] })).errorCode).toBe("scopeTooWide");
    expect(run(source, ev(NOVA, "ana", { ...base, scopes: ["nope"] })).errorCode).toBe("invalid");
    expect(run(source, ev(NOVA, "ana", { ...base, expiresAt: at(-60) })).errorCode).toBe("invalid");
    expect(run(source, ev(NOVA, "ana", { ...base, rateLimitRpm: 500 })).errorCode).toBe("invalid"); // above the app's own limit
    expect(run(source, ev(NOVA, "ana", { ...base, name: " " })).errorCode).toBe("invalid");
    expect(run(source, ev(NOVA, "ana", { ...base, appId: "app_nope" })).errorCode).toBe("notFound");
  });

  it("edits, regenerates, revokes and expires", () => {
    const source = sample();
    const sync = key(source.state, "Sync CRM");
    const edited = ok(source, ev(NOVA, "pablo", { type: "key.update", keyId: sync.id, name: "Sync CRM 2", rateLimitRpm: 90, scopes: ["crm.read"] }));
    expect(key(edited, "Sync CRM 2")).toMatchObject({ rateLimitRpm: 90, scopes: ["crm.read"] });
    expect(run(source, ev(NOVA, "pablo", { type: "key.update", keyId: sync.id, scopes: ["billing.read"] })).errorCode).toBe("scopeTooWide");
    const regenerated = reveal(source, ev(NOVA, "pablo", { type: "key.regenerate", keyId: sync.id }));
    expect(regenerated.state.keys.find((item) => item.id === sync.id)).toMatchObject({ status: "revoked", replacedBy: regenerated.id });
    const fresh = regenerated.state.keys.find((item) => item.id === regenerated.id)!;
    expect(fresh).toMatchObject({ status: "active", name: "Sync CRM", replaces: sync.id, scopes: sync.scopes });
    expect(fresh.hash).not.toBe(sync.hash);
    expect(run(source, ev(NOVA, "pablo", { type: "key.regenerate", keyId: sync.id }), regenerated.state).errorCode).toBe("notActive");
    const revoked = ok(source, ev(NOVA, "pablo", { type: "key.revoke", keyId: fresh.id }), regenerated.state);
    expect(revoked.keys.find((item) => item.id === fresh.id)?.status).toBe("revoked");
    expect(run(source, ev(NOVA, "pablo", { type: "key.revoke", keyId: fresh.id }), revoked).errorCode).toBe("closed");
    expect(run(source, ev(NOVA, "pablo", { type: "key.update", keyId: fresh.id, name: "x" }), revoked).errorCode).toBe("notActive");
    const reports = key(source.state, "Reportes");
    expect(run(source, ev(NOVA, "system", { type: "key.expire", keyId: reports.id })).errorCode).toBe("notEligible"); // its date has not come
    expect(run(source, ev(NOVA, "ana", { type: "key.expire", keyId: reports.id }, 60 * 24 * 11)).errorCode).toBe("systemOnly");
    const expired = ok(source, ev(NOVA, "system", { type: "key.expire", keyId: reports.id }, 60 * 24 * 11));
    expect(key(expired, "Reportes").status).toBe("expired");
  });
});

describe("apps (a model only: nothing is published)", () => {
  it("creates in draft, activates and pauses only as a person, and never repeats a name", () => {
    const source = sample();
    const made = ok(source, ev(NOVA, "ana", { type: "app.create", name: "Plantilla de bienvenida", appKind: "template", scopes: ["crm.read"] }));
    const created = app(made, "Plantilla de bienvenida");
    expect(created).toMatchObject({ status: "draft", kind: "template", apiVersion: "v1" });
    expect(run(source, ev(NOVA, "ana", { type: "app.create", name: "plantilla de bienvenida", appKind: "app", scopes: ["crm.read"] }), made).errorCode).toBe("exists");
    expect(run(source, ev(NOVA, "ana", { type: "app.create", name: "x", appKind: "robot", scopes: ["crm.read"] })).errorCode).toBe("invalid");
    const active = ok(source, ev(NOVA, "ana", { type: "app.setStatus", appId: created.id, to: "active" }), made);
    expect(app(active, "Plantilla de bienvenida").status).toBe("active");
    expect(run(source, ev(NOVA, "ana", { type: "app.setStatus", appId: created.id, to: "active" }), active).errorCode).toBe("exists");
    expect(app(ok(source, ev(NOVA, "ana", { type: "app.setStatus", appId: created.id, to: "paused" }), active), "Plantilla de bienvenida").status).toBe("paused");
    const updated = ok(source, ev(NOVA, "ana", { type: "app.update", appId: app(source.state, "Reportes Nova").id, apiVersion: "v1" }));
    expect(app(updated, "Reportes Nova").apiVersion).toBe("v1");
  });

  it("covers every kind of marketplace app", () => {
    const source = sample();
    let state = source.state;
    for (const kind of ["app", "plugin", "worker", "prompt", "template", "automation", "connector"]) state = ok(source, ev(NOVA, "ana", { type: "app.create", name: `Modelo ${kind}`, appKind: kind, scopes: ["crm.read"] }), state);
    expect(appsOf(state, NOVA).filter((item) => item.name.startsWith("Modelo ")).map((item) => item.kind)).toEqual(["app", "plugin", "worker", "prompt", "template", "automation", "connector"]);
  });

  it("only records a publication request: nothing is ever published", () => {
    const source = sample();
    const sync = app(source.state, "Nova CRM Sync");
    const open = publicationsOf(source.state, NOVA)[0]!;
    expect(open).toMatchObject({ status: "requested", via: "authorized" });
    expect(run(source, ev(NOVA, "ana", { type: "publication.request", appId: sync.id })).errorCode).toBe("exists"); // one open request per app
    expect(run(source, ev(NOVA, "ana", { type: "publication.request", appId: app(source.state, "Prompt Pack Ventas").id })).errorCode).toBe("notEligible"); // a draft cannot be requested
    expect(run(source, ev(NOVA, "carla", { type: "publication.decide", publicationId: open.id, approve: true })).errorCode).toBe("forbidden");
    const approved = ok(source, ev(NOVA, "ana", { type: "publication.decide", publicationId: open.id, approve: true }));
    expect(publicationsOf(approved, NOVA)[0]).toMatchObject({ status: "approved", decidedBy: "ana" });
    expect(approved.apps).toEqual(source.state.apps); // approving changes no app: nothing is published
    expect(run(source, ev(NOVA, "ana", { type: "publication.decide", publicationId: open.id, approve: false }), approved).errorCode).toBe("closed");
    expect(logsOf(approved, NOVA).at(-1)?.detail).toMatch(/no se publica nada/);
  });
});

describe("webhooks (architecture only)", () => {
  it("creates with a signing secret shown once, and accepts only https addresses and known events", () => {
    const source = sample();
    expect(run(source, ev(NOVA, "ana", { type: "webhook.create", url: "http://hooks.nova.example/x", events: ["crm.lead.created"] })).errorCode).toBe("invalid");
    expect(run(source, ev(NOVA, "ana", { type: "webhook.create", url: "https://localhost", events: ["crm.lead.created"] })).errorCode).toBe("invalid");
    expect(run(source, ev(NOVA, "ana", { type: "webhook.create", url: "https://hooks.nova.example/x", events: [] })).errorCode).toBe("invalid");
    expect(run(source, ev(NOVA, "ana", { type: "webhook.create", url: "https://hooks.nova.example/x", events: ["made.up"] })).errorCode).toBe("invalid");
    const { state, secret, id } = reveal(source, ev(NOVA, "ana", { type: "webhook.create", url: "https://hooks.nova.example/x", events: ["crm.lead.created"] }));
    expect(secret).toMatch(/^whsec_sim_/);
    expect(JSON.stringify(state)).not.toContain(secret);
    expect(state.webhooks.find((item) => item.id === id)?.secretHash).toBe(fnv(secret));
    const rotated = reveal(source, ev(NOVA, "ana", { type: "webhook.rotateSecret", webhookId: id }), state);
    expect(rotated.secret).not.toBe(secret);
    expect(rotated.state.webhooks.find((item) => item.id === id)?.secretHash).toBe(fnv(rotated.secret));
  });

  it("edits, pauses and deletes without erasing the history", () => {
    const source = sample();
    const good = hook(source.state, "https://hooks.nova.example/kynova");
    const edited = ok(source, ev(NOVA, "pablo", { type: "webhook.update", webhookId: good.id, url: "https://hooks.nova.example/v2", events: ["crm.lead.created"] }));
    expect(edited.webhooks.find((item) => item.id === good.id)).toMatchObject({ url: "https://hooks.nova.example/v2", events: ["crm.lead.created"] });
    const paused = ok(source, ev(NOVA, "pablo", { type: "webhook.setStatus", webhookId: good.id, to: "paused" }), edited);
    expect(run(source, ev(NOVA, "pablo", { type: "webhook.simulate", webhookId: good.id, event: "crm.lead.created" }), paused).errorCode).toBe("notActive");
    const deliveries = deliveriesOf(source.state, NOVA).length;
    const logs = logsOf(source.state, NOVA).length;
    const deleted = ok(source, ev(NOVA, "pablo", { type: "webhook.delete", webhookId: good.id }), paused);
    expect(deleted.webhooks.find((item) => item.id === good.id)?.status).toBe("deleted");
    expect(deliveriesOf(deleted, NOVA)).toHaveLength(deliveries); // the history stays
    expect(logsOf(deleted, NOVA).length).toBeGreaterThan(logs);
    expect(run(source, ev(NOVA, "pablo", { type: "webhook.update", webhookId: good.id, url: "https://hooks.nova.example/z" }), deleted).errorCode).toBe("notActive");
    expect(run(source, ev(NOVA, "pablo", { type: "webhook.delete", webhookId: good.id }), deleted).errorCode).toBe("closed");
  });

  it("signs each delivery and lets KOE decide how it goes, keeping every attempt", () => {
    const source = sample();
    const state0 = quiet(source);
    const good = hook(state0, "https://hooks.nova.example/kynova");
    const failing = hook(state0, "https://fail.nova.example/hook");
    const delivered = ok(source, ev(NOVA, "pablo", { type: "webhook.simulate", webhookId: good.id, event: "crm.lead.created" }), state0);
    const first = deliveriesOf(delivered, NOVA).at(-1)!;
    expect(first).toMatchObject({ status: "delivered", webhookId: good.id });
    expect(first.attempts[0]).toMatchObject({ status: 200, ok: true });
    expect(first.signature).toMatch(/^v1=[0-9a-f]{16}$/);
    expect(run(source, ev(NOVA, "pablo", { type: "webhook.simulate", webhookId: good.id, event: "billing.invoice.issued" }), delivered).errorCode).toBe("invalid"); // it does not listen to that event
    expect(run(source, ev(NOVA, "pablo", { type: "webhook.retry", deliveryId: first.id }), delivered).errorCode).toBe("closed");
    let state = ok(source, ev(NOVA, "pablo", { type: "webhook.simulate", webhookId: failing.id, event: "comms.message.received" }), delivered);
    const bad = deliveriesOf(state, NOVA).at(-1)!;
    expect(bad).toMatchObject({ status: "failed" });
    expect(bad.attempts[0]).toMatchObject({ status: 500, ok: false });
    for (let attempt = 2; attempt <= 4; attempt += 1) {
      state = ok(source, ev(NOVA, "pablo", { type: "webhook.retry", deliveryId: bad.id }, attempt), state);
      expect(state.deliveries.find((item) => item.id === bad.id)?.attempts).toHaveLength(attempt);
    }
    const spent = state.deliveries.find((item) => item.id === bad.id)!;
    expect(spent.status).toBe("exhausted");
    expect(spent.attempts[0]).toEqual(bad.attempts[0]); // earlier attempts are never rewritten
    expect(run(source, ev(NOVA, "pablo", { type: "webhook.retry", deliveryId: bad.id }, 9), state).errorCode).toBe("exhausted");
  });
});

describe("the sandbox", () => {
  it("is created and tuned with a valid latency and error rate", () => {
    const source = sample();
    expect(run(source, ev(VIDA, "lucia", { type: "sandbox.create", name: "Pruebas", latencyMs: 9_000 })).errorCode).toBe("invalid");
    expect(run(source, ev(VIDA, "lucia", { type: "sandbox.create", name: "Pruebas", errorRatePercent: 101 })).errorCode).toBe("invalid");
    const state = ok(source, ev(VIDA, "lucia", { type: "sandbox.create", name: "Pruebas", latencyMs: 300, errorRatePercent: 10 }));
    expect(state.sandboxes.find((item) => item.tenantId === VIDA)).toMatchObject({ latencyMs: 300, errorRatePercent: 10 });
    const tuned = ok(source, ev(VIDA, "lucia", { type: "sandbox.configure", sandboxId: state.sandboxes.find((item) => item.tenantId === VIDA)!.id, latencyMs: 50 }), state);
    expect(tuned.sandboxes.find((item) => item.tenantId === VIDA)).toMatchObject({ latencyMs: 50, errorRatePercent: 10 });
    expect(run(source, ev(VIDA, "lucia", { type: "sandbox.configure", sandboxId: sandboxId(source.state), latencyMs: 50 })).errorCode).toBe("notYours");
  });

  it("emits simulated events to the active webhooks that listen, and only those", () => {
    const source = sample();
    expect(run(source, ev(VIDA, "lucia", { type: "sandbox.emit", event: "crm.lead.created" })).errorCode).toBe("notEligible"); // no sandbox yet
    const state0 = quiet(source);
    const good = hook(state0, "https://hooks.nova.example/kynova");
    const paused = ok(source, ev(NOVA, "pablo", { type: "webhook.setStatus", webhookId: good.id, to: "paused" }), state0);
    const before = deliveriesOf(paused, NOVA).length;
    const emitted = ok(source, ev(NOVA, "pablo", { type: "sandbox.emit", event: "crm.lead.created" }), paused);
    expect(deliveriesOf(emitted, NOVA)).toHaveLength(before); // the only hook that listens is paused
    expect(sandboxEventsOf(emitted, NOVA).at(-1)).toMatchObject({ type: "crm.lead.created", deliveries: 0 });
    const both = ok(source, ev(NOVA, "pablo", { type: "sandbox.emit", event: "comms.message.received" }), state0);
    expect(sandboxEventsOf(both, NOVA).at(-1)?.deliveries).toBe(2);
    expect(deliveriesOf(both, NOVA)).toHaveLength(deliveriesOf(state0, NOVA).length + 2);
  });

  it("has simulated data that is always the same and never another company's", () => {
    const source = sample();
    const data = sandboxData(source.state, NOVA);
    expect(data).toHaveLength(5);
    expect(sandboxData(source.state, NOVA)).toEqual(data);
    expect(sandboxData(source.state, VIDA)).toEqual([]);
  });
});

describe("the API Explorer (never a real API)", () => {
  const request = (source: Source, keyName: string, endpointId: string, state: DevState = source.state, minutes = 1) => {
    const next = ok(source, ev(NOVA, "pablo", { type: "api.request", keyId: key(state, keyName).id, endpointId }, minutes), state);
    return { state: next, record: requestsOf(next, NOVA).at(-1)! };
  };

  it("answers with KOE's simulation, records it and adds the sandbox latency", () => {
    const source = sample();
    const state0 = quiet(source);
    const { state, record } = request(source, "Sync CRM", "leads.list", state0);
    expect(record).toMatchObject({ status: 200, method: "GET", path: "/v1/leads", source: "explorer", count: 1, errors: 0, rateLimited: false });
    expect(record.response).toBe(ENDPOINTS.find((item) => item.id === "leads.list")!.sample);
    expect(record.latencyMs).toBeGreaterThanOrEqual(120 + 40);
    expect(key(state, "Sync CRM").lastUsedAt).toBe(at(1));
    expect(logsOf(state, NOVA).at(-1)).toMatchObject({ kind: "request" });
  });

  it("refuses a wrong scope, a revoked key, an expired key and a paused app, as a gateway would", () => {
    const source = sample();
    const state0 = quiet(source);
    expect(request(source, "Reportes", "leads.list", state0).record).toMatchObject({ status: 403, errors: 1 });
    expect(JSON.parse(request(source, "Reportes", "leads.list", state0).record.response!)).toMatchObject({ error: "insufficient_scope", required: "crm.read" });
    expect(request(source, "Sync lectura", "leads.list", state0).record.status).toBe(401);
    expect(request(source, "Reportes", "insights.summary", state0, 60 * 24 * 11).record.status).toBe(401); // past its expiry date
    const paused = ok(source, ev(NOVA, "ana", { type: "app.setStatus", appId: app(state0, "Nova CRM Sync").id, to: "paused" }), state0);
    expect(request(source, "Sync CRM", "leads.list", paused).record.status).toBe(403);
    expect(logsOf(paused, NOVA).filter((item) => item.kind === "error").length).toBeGreaterThan(0);
  });

  it("answers 429 when a limit is reached, for the key, the app or the plan", () => {
    const source = sample();
    const state0 = quiet(source);
    const tight = reveal(source, ev(NOVA, "pablo", { type: "key.create", appId: app(state0, "Nova CRM Sync").id, name: "Estrecha", scopes: ["crm.read"], rateLimitRpm: 1 }), state0);
    const first = request(source, "Estrecha", "leads.list", tight.state);
    expect(first.record.status).toBe(200);
    const second = request(source, "Estrecha", "leads.list", first.state); // the same minute
    expect(second.record).toMatchObject({ status: 429, rateLimited: true });
    expect(JSON.parse(second.record.response!)).toMatchObject({ error: "rate_limited", level: "key", limitPerMinute: 1 });
    // the key "Sync CRM" has used 85 of its 100 in the last minute: 14 more leave room for exactly one request
    let state = state0;
    for (let index = 0; index < 14; index += 1) state = ok(source, ev(NOVA, "system", { type: "usage.report", keyId: key(state, "Sync CRM").id, endpointId: "leads.list", count: 1 }, 0), state);
    const fit = request(source, "Sync CRM", "leads.list", state, 0);
    expect(fit.record.status).toBe(200);
    const over = request(source, "Sync CRM", "leads.list", fit.state, 0);
    expect(over.record).toMatchObject({ status: 429, rateLimited: true });
    expect(logsOf(over.state, NOVA).at(-1)?.kind).toBe("error");
  });

  it("simulates errors when the sandbox has a rate of errors", () => {
    const source = sample();
    const noisy = ok(source, ev(NOVA, "pablo", { type: "sandbox.configure", sandboxId: sandboxId(source.state), errorRatePercent: 100 }));
    const { record } = request(source, "Sync CRM", "leads.list", noisy);
    expect(record.status).toBe(500);
    expect(JSON.parse(record.response!)).toMatchObject({ error: "simulated_error" });
    // the same input always gives the same answer
    const key1 = key(noisy, "Sync CRM");
    const endpoint = ENDPOINTS[0]!;
    expect(simulateRequest(noisy, NOVA, key1, endpoint, at(5))).toEqual(simulateRequest(noisy, NOVA, key1, endpoint, at(5)));
  });

  it("refuses an unknown endpoint and a key of another company", () => {
    const source = sample();
    expect(run(source, ev(NOVA, "pablo", { type: "api.request", keyId: key(source.state, "Sync CRM").id, endpointId: "nope" })).errorCode).toBe("invalid");
    expect(run(source, ev(VIDA, "lucia", { type: "api.request", keyId: key(source.state, "Sync CRM").id, endpointId: "leads.list" })).errorCode).toBe("notYours");
  });
});

describe("rate limits and consumption (all KOE)", () => {
  it("limits the company by its plan, and each app and key further", () => {
    const { state } = sample();
    expect(PLAN_RPM["starter"]).toBeLessThan(PLAN_RPM["professional"]!);
    expect(PLAN_RPM["professional"]).toBeLessThan(PLAN_RPM["business"]!);
    expect(PLAN_RPM["business"]).toBeLessThan(PLAN_RPM["enterprise"]!);
    expect(planLimit(state, NOVA)).toBe(300);
    expect(planLimit(state, VIDA)).toBe(60);
    const rows = rateStatus(state, NOVA, DEMO_NOW);
    expect(rows.find((item) => item.level === "company")).toMatchObject({ limit: 300, effective: 300, used: 85 });
    expect(rows.find((item) => item.name === "Nova CRM Sync")).toMatchObject({ level: "app", limit: 120, effective: 120, used: 85 });
    expect(rows.find((item) => item.name === "Sync CRM")).toMatchObject({ level: "key", limit: 100, effective: 100, used: 85, status: "warn" });
    expect(rows.find((item) => item.name === "Reportes")).toMatchObject({ limit: 40, effective: 40, used: 0, status: "ok" });
    const vida = rateStatus(state, VIDA, DEMO_NOW);
    expect(vida.find((item) => item.level === "key")).toMatchObject({ limit: 30, effective: 30 }); // the app's limit is below the plan's
    expect(rateStatus(state, NOVA, at(10)).every((item) => item.used === 0)).toBe(true); // a minute later the window is empty
  });

  it("adds up the consumption by app, key, endpoint and version, and never mixes companies", () => {
    const { state } = sample();
    const usage = consumption(state, NOVA, DEMO_NOW);
    const sum = (rows: readonly { requests: number }[]) => rows.reduce((total, row) => total + row.requests, 0);
    expect(sum(usage.byApp)).toBe(usage.requests);
    expect(sum(usage.byKey)).toBe(usage.requests);
    expect(sum(usage.byEndpoint)).toBe(usage.requests);
    expect(sum(usage.byVersion)).toBe(usage.requests);
    expect(usage.errorRatePercent).toBe(Math.round((usage.errors / usage.requests) * 1_000) / 10);
    expect(usage.series).toHaveLength(14);
    expect(usage.byApp.map((item) => item.label)).toContain("Nova CRM Sync");
    const vida = consumption(state, VIDA, DEMO_NOW);
    expect(vida.byApp.map((item) => item.label)).toEqual(["Vida Citas"]);
    expect(vida.requests).toBe(31 + 32 + 33 + 34 + 35);
    expect(consumption(state, "tenant-unknown", DEMO_NOW).requests).toBe(0);
  });
});

describe("recommendations (all KOE)", () => {
  it("flags a key about to expire, an unused key, a failing webhook, a key near its limit and a version being retired", () => {
    const { state } = sample();
    const kinds = recommendations(state, NOVA, DEMO_NOW).map((item) => item.kind).sort();
    expect(kinds).toEqual(["deprecatedVersion", "keyExpiring", "keyUnused", "nearLimit", "webhookFailing"]);
    const high = recommendations(state, NOVA, DEMO_NOW).find((item) => item.kind === "webhookFailing")!;
    expect(high).toMatchObject({ severity: "high" });
    expect(recommendations(state, VIDA, DEMO_NOW)).toEqual([]);
  });

  it("stops recommending once the cause is fixed", () => {
    const source = sample();
    let state = ok(source, ev(NOVA, "ana", { type: "key.revoke", keyId: key(source.state, "Prueba antigua").id }));
    state = ok(source, ev(NOVA, "ana", { type: "app.update", appId: app(state, "Reportes Nova").id, apiVersion: "v1" }), state);
    state = ok(source, ev(NOVA, "ana", { type: "webhook.setStatus", webhookId: hook(state, "https://fail.nova.example/hook").id, to: "paused" }), state);
    const kinds = recommendations(state, NOVA, DEMO_NOW).map((item) => item.kind).sort();
    expect(kinds).toEqual(["keyExpiring", "nearLimit"]);
  });

  it("records each analysis with the Worker, the model and its cost, and never overwrites it", () => {
    const source = sample();
    const first = analysesOf(source.state, NOVA);
    expect(first).toHaveLength(1);
    const state = ok(source, ev(NOVA, "worker:nex", { type: "dev.analyze" }));
    const after = analysesOf(state, NOVA);
    expect(after).toHaveLength(2);
    expect(after.slice(0, 1)).toEqual(first);
    expect(after.at(-1)).toMatchObject({ workerId: expect.any(String), model: { id: expect.any(String), label: expect.any(String) }, recommendationIds: expect.any(Array) });
    expect(after.at(-1)?.estimatedCostMicros).toBeGreaterThan(0);
    expect(analysesOf(state, VIDA)).toHaveLength(0);
  });
});

describe("the NEX Constitution", () => {
  const NEX = "worker:nex";

  it("Level 3: NEX never creates a credential, activates an app, publishes, deletes or decides", () => {
    const source = sample();
    const sync = app(source.state, "Nova CRM Sync").id;
    const attempts: Record<string, unknown>[] = [
      { type: "key.create", appId: sync, name: "x", scopes: ["crm.read"] }, { type: "key.regenerate", keyId: key(source.state, "Sync CRM").id }, { type: "key.revoke", keyId: key(source.state, "Sync CRM").id },
      { type: "app.create", name: "x", appKind: "app", scopes: ["crm.read"] }, { type: "app.setStatus", appId: app(source.state, "Prompt Pack Ventas").id, to: "active" },
      { type: "webhook.create", url: "https://hooks.nova.example/x", events: ["crm.lead.created"] }, { type: "webhook.delete", webhookId: webhooksOf(source.state, NOVA)[0]!.id },
      { type: "sandbox.emit", event: "crm.lead.created" }, { type: "api.request", keyId: key(source.state, "Sync CRM").id, endpointId: "leads.list" },
      { type: "publication.decide", publicationId: publicationsOf(source.state, NOVA)[0]!.id, approve: true }, { type: "proposal.approve", proposalId: proposalsOf(source.state, NOVA)[0]!.id },
      { type: "dev.setDeveloper", userId: "carla", enabled: true }, { type: "authorization.grant", maxPerDay: 5 },
    ];
    for (const attempt of attempts) {
      const result = run(source, ev(NOVA, NEX, attempt));
      expect(result.errorCode, String(attempt.type)).toBe("personRequired");
      expect(result.state, String(attempt.type)).toBe(source.state);
    }
  });

  it("Level 3: there is no event to delete or edit a log, a request or a delivery, and NEX never prepares one", () => {
    const events = readFileSync(join(__dirname, "dev-center.ts"), "utf8").match(/type: "([a-zA-Z.]+)"/g)?.map((item) => item.slice(7, -1)) ?? [];
    expect(events.length).toBeGreaterThan(20);
    for (const type of events) expect(type, type).not.toMatch(/(^|.)(logs?|purge|erase|clear)(.|$)/i);
    const source = sample();
    for (const kind of ["credential", "activate", "publish", "deleteLogs", "secret"]) expect(run(source, ev(NOVA, NEX, { type: "proposal.create", payload: { kind } })).errorCode, kind).toBe("criticalForHuman");
    expect(levelForAction("dev.credential")).toBe(3);
    expect(levelForAction("dev.activate")).toBe(3);
    expect(levelForAction("dev.publish")).toBe(3);
    expect(levelForAction("dev.logs.delete")).toBe(3);
    expect(levelForAction("dev.draft")).toBe(1);
    expect(levelForAction("dev.publish.request.auto")).toBe(2);
    expect(levelForAction("dev.purge")).toBe(3); // not in the catalog: fails closed
  });

  it("Level 1: NEX prepares a key, a webhook or an app; a person approves, sees the secret once, and it is applied as that person", () => {
    const source = sample();
    const keyProposal = proposalsOf(source.state, NOVA).find((item) => item.payload.kind === "key")!;
    expect(keyProposal).toMatchObject({ status: "proposed", proposedBy: "worker:nex" });
    expect(keysOf(source.state, NOVA)).toHaveLength(4); // preparing created nothing
    expect(run(source, ev(NOVA, "carla", { type: "proposal.approve", proposalId: keyProposal.id })).errorCode).toBe("forbidden");
    const approved = reveal(source, ev(NOVA, "pablo", { type: "proposal.approve", proposalId: keyProposal.id }));
    expect(approved.secret).toMatch(/^kyn_sim_/);
    expect(keysOf(approved.state, NOVA).at(-1)).toMatchObject({ name: "Reportes v1", createdBy: "pablo", status: "active" });
    expect(JSON.stringify(approved.state)).not.toContain(approved.secret);
    expect(proposalsOf(approved.state, NOVA).find((item) => item.id === keyProposal.id)).toMatchObject({ status: "approved", decidedBy: "pablo" });
    expect(run(source, ev(NOVA, "pablo", { type: "proposal.approve", proposalId: keyProposal.id }), approved.state).errorCode).toBe("closed");
    const hookProposal = proposalsOf(source.state, NOVA).find((item) => item.payload.kind === "webhook")!;
    const hooked = reveal(source, ev(NOVA, "ana", { type: "proposal.approve", proposalId: hookProposal.id }));
    expect(hooked.secret).toMatch(/^whsec_sim_/);
    expect(webhooksOf(hooked.state, NOVA).at(-1)).toMatchObject({ url: "https://hooks.nova.example/reportes", createdBy: "ana" });
    const rejected = ok(source, ev(NOVA, "ana", { type: "proposal.reject", proposalId: hookProposal.id }));
    expect(proposalsOf(rejected, NOVA).find((item) => item.id === hookProposal.id)?.status).toBe("rejected");
  });

  it("Level 1: refuses a proposal that is invalid, and an approval that breaks a rule leaves it open", () => {
    const source = sample();
    expect(run(source, ev(NOVA, "worker:nex", { type: "proposal.create", payload: { kind: "key", appId: app(source.state, "Reportes Nova").id, name: "x", scopes: ["crm.write"] } })).errorCode).toBe("scopeTooWide");
    expect(run(source, ev(NOVA, "worker:nex", { type: "proposal.create", payload: { kind: "webhook", url: "http://x.example", events: ["crm.lead.created"] } })).errorCode).toBe("invalid");
    const made = ok(source, ev(NOVA, "worker:nex", { type: "proposal.create", payload: { kind: "app", name: "Nova CRM Sync", appKind: "app", description: "", scopes: ["crm.read"], apiVersion: "v1" } }));
    const proposal = proposalsOf(made, NOVA).at(-1)!;
    const refused = run(source, ev(NOVA, "ana", { type: "proposal.approve", proposalId: proposal.id }), made);
    expect(refused.errorCode).toBe("exists");
    expect(proposalsOf(refused.state, NOVA).at(-1)?.status).toBe("proposed");
  });

  it("Level 2: with a standing authorization NEX asks for a publication; it is only a request and has a daily limit and an expiry", () => {
    const source = sample();
    const sync = app(source.state, "Nova CRM Sync").id;
    const grant = source.state.grants.find((item) => item.tenantId === NOVA)!;
    const revoked = ok(source, ev(NOVA, "ana", { type: "authorization.revoke", grantId: grant.id }));
    expect(run(source, ev(NOVA, "worker:nex", { type: "publication.request", appId: sync }), revoked).errorCode).toBe("needsAuthorization");
    // the open request is already decided; today's single request is already used
    const decided = ok(source, ev(NOVA, "ana", { type: "publication.decide", publicationId: publicationsOf(source.state, NOVA)[0]!.id, approve: false }));
    expect(run(source, ev(NOVA, "worker:nex", { type: "publication.request", appId: sync }), decided).errorCode).toBe("needsAuthorization");
    const tomorrow = ok(source, ev(NOVA, "worker:nex", { type: "publication.request", appId: sync, note: "otra vez" }, 60 * 24), decided);
    expect(publicationsOf(tomorrow, NOVA).at(-1)).toMatchObject({ via: "authorized", status: "requested" });
    expect(tomorrow.apps).toEqual(source.state.apps); // a request changes no app
    expect(run(source, ev(NOVA, "worker:nex", { type: "publication.request", appId: sync }, 60 * 24 * 60), decided).errorCode).toBe("needsAuthorization"); // the authorization expired
  });

  it("lets only the owner name who builds, and only the owner or a developer act", () => {
    const source = sample();
    expect(run(source, ev(NOVA, "pablo", { type: "dev.setDeveloper", userId: "carla", enabled: true })).errorCode).toBe("ownerRequired");
    expect(run(source, ev(NOVA, "carla", { type: "key.revoke", keyId: key(source.state, "Sync CRM").id })).errorCode).toBe("forbidden");
    const state = ok(source, ev(NOVA, "ana", { type: "dev.setDeveloper", userId: "carla", enabled: true }));
    ok(source, ev(NOVA, "carla", { type: "key.revoke", keyId: key(source.state, "Sync CRM").id }), state);
    const removed = ok(source, ev(NOVA, "ana", { type: "dev.setDeveloper", userId: "carla", enabled: false }), state);
    expect(run(source, ev(NOVA, "carla", { type: "key.revoke", keyId: key(source.state, "Sync CRM").id }), removed).errorCode).toBe("forbidden");
  });
});

describe("one company never sees or changes another", () => {
  it("keeps apps, keys, logs and webhooks apart", () => {
    const source = sample();
    const novaKey = key(source.state, "Sync CRM");
    expect(run(source, ev(VIDA, "lucia", { type: "key.revoke", keyId: novaKey.id })).errorCode).toBe("notYours");
    expect(run(source, ev(VIDA, "lucia", { type: "key.create", appId: app(source.state, "Nova CRM Sync").id, name: "x", scopes: ["crm.read"] })).errorCode).toBe("notYours");
    expect(run(source, ev(VIDA, "lucia", { type: "webhook.delete", webhookId: webhooksOf(source.state, NOVA)[0]!.id })).errorCode).toBe("notYours");
    expect(run(source, ev(VIDA, "lucia", { type: "webhook.retry", deliveryId: deliveriesOf(source.state, NOVA)[0]!.id })).errorCode).toBe("notYours");
    expect(run(source, ev(VIDA, "lucia", { type: "proposal.approve", proposalId: proposalsOf(source.state, NOVA)[0]!.id })).errorCode).toBe("notYours");
    expect(run(source, ev(VIDA, "lucia", { type: "publication.decide", publicationId: publicationsOf(source.state, NOVA)[0]!.id, approve: true })).errorCode).toBe("notYours");
    expect(run(source, ev(VIDA, "ana", { type: "key.revoke", keyId: key(source.state, "Citas", VIDA).id })).errorCode).toBe("forbidden"); // Nova's owner has no authority in Vida
    expect(run(source, ev(VIDA, "system", { type: "dev.create", ownerId: "lucia", planId: "starter" })).errorCode).toBe("exists");
    for (const log of logsOf(source.state, VIDA)) expect(log.tenantId).toBe(VIDA);
    expect(keysOf(source.state, VIDA).map((item) => item.name)).toEqual(["Citas"]);
    expect(webhooksOf(source.state, VIDA)).toEqual([]);
  });

  it("does not move a figure of one company when another acts", () => {
    const source = sample();
    const snapshot = (state: DevState) => JSON.stringify([devDashboard(state, NOVA, DEMO_NOW), recommendations(state, NOVA, DEMO_NOW), logsOf(state, NOVA), consumption(state, NOVA, DEMO_NOW)]);
    const before = snapshot(source.state);
    let state = reveal(source, ev(VIDA, "lucia", { type: "key.create", appId: app(source.state, "Vida Citas", VIDA).id, name: "Otra", scopes: ["crm.read"] })).state;
    state = ok(source, ev(VIDA, "lucia", { type: "app.setStatus", appId: app(state, "Vida Citas", VIDA).id, to: "active" }), state);
    state = ok(source, ev(VIDA, "lucia", { type: "sandbox.create", name: "Pruebas" }), state);
    state = ok(source, ev(VIDA, "worker:nex", { type: "dev.analyze" }), state);
    expect(snapshot(state)).toBe(before);
  });
});

describe("logs only ever grow", () => {
  it("records every kind of event, keeps every earlier entry and ignores refusals", () => {
    const source = sample();
    const kinds = new Set(logsOf(source.state, NOVA).map((item) => item.kind));
    for (const kind of ["error", "event", "webhook", "key", "app", "access", "proposal", "other"]) expect(kinds.has(kind as never), kind).toBe(true);
    const refused = run(source, ev(NOVA, "carla", { type: "key.revoke", keyId: key(source.state, "Sync CRM").id }));
    expect(refused.state.logs).toBe(source.state.logs); // a refusal writes nothing
    let state = source.state;
    for (const event of [
      ev(NOVA, "ana", { type: "key.revoke", keyId: key(source.state, "Sync CRM").id }), ev(NOVA, "ana", { type: "webhook.delete", webhookId: webhooksOf(source.state, NOVA)[0]!.id }, 2),
      ev(NOVA, "ana", { type: "app.setStatus", appId: app(source.state, "Nova CRM Sync").id, to: "paused" }, 3), ev(NOVA, "pablo", { type: "sandbox.emit", event: "crm.lead.created" }, 4),
    ]) {
      const before = state.logs;
      state = ok(source, event, state);
      expect(state.logs.length).toBeGreaterThan(before.length);
      expect(state.logs.slice(0, before.length)).toEqual(before);
    }
    expect(state.deliveries.length).toBeGreaterThanOrEqual(source.state.deliveries.length);
    expect(state.requests).toEqual(source.state.requests);
    expect(logsOf(state, NOVA, "key").length).toBeGreaterThan(0);
  });

  it("never writes a secret in a log", () => {
    const source = sample();
    const made = reveal(source, ev(NOVA, "ana", { type: "key.create", appId: app(source.state, "Nova CRM Sync").id, name: "Secreta", scopes: ["crm.read"] }));
    const hooked = reveal(source, ev(NOVA, "ana", { type: "webhook.create", url: "https://hooks.nova.example/s", events: ["crm.lead.created"] }), made.state);
    const text = JSON.stringify(hooked.state.logs);
    expect(text).not.toContain(made.secret);
    expect(text).not.toContain(hooked.secret);
  });
});

describe("what is declared and not built", () => {
  it("declares the SDKs, the OAuth flows and the future surfaces without building any", () => {
    expect(SDKS.map((item) => item.name)).toEqual(["JavaScript", "TypeScript", "Python", "PHP", "C#", "Java", "Go"]);
    expect(OAUTH_ARCHITECTURE.map((item) => item.id)).toEqual(["authorizationCode", "pkce", "clientCredentials", "refreshTokens", "scopes"]);
    expect(FUTURE_PLATFORM.map((item) => item.id)).toEqual(["graphql", "grpc", "openapi", "asyncapi", "cli", "terraform", "githubApps", "vscode"]);
    for (const item of [...SDK_CENTER, ...OAUTH_ARCHITECTURE, ...FUTURE_PLATFORM]) expect(item).toMatchObject({ status: "notBuilt", goesThrough: "KOE", direct: false });
    expect(API_VERSIONS.map((item) => item.status)).toEqual(["deprecated", "stable", "preview"]);
  });

  it("speaks Spanish for every error, scope and event", () => {
    for (const code of ERROR_CODES) expect(message(code, { detail: "x" }), code).toMatch(/\S/);
    expect(label("scope", "crm.read")).toBe("CRM · leer");
    expect(label("event", "crm.lead.created")).toBe("Prospecto creado");
  });
});

describe("where the rules live", () => {
  const dir = __dirname;
  const read = (name: string) => readFileSync(join(dir, name), "utf8");
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("holds the rules in koe-dev.ts alone, and the store only records", () => {
    const rules = /NEAR_LIMIT_RATIO|UNUSED_KEY_DAYS|FAILING_WEBHOOK_MIN|ERROR_RATE_ALERT_PERCENT|BASE_LATENCY_MS/;
    const owners = readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).filter((name) => rules.test(strip(read(name))));
    expect(owners).toEqual(["koe-dev.ts"]);
    expect(strip(read("dev-center.ts"))).not.toMatch(/\.reduce\(|Math\./);
  });

  it("has screens that only format: no arithmetic, no network, no provider", () => {
    const folder = join(dir, "..", "..", "..", "app", "(app)", "platform", "_components");
    const screens = readdirSync(folder).filter((name) => /^Dev.*\.tsx$/.test(name) && !name.endsWith(".test.tsx"));
    expect(screens.length).toBeGreaterThanOrEqual(3);
    for (const name of screens) {
      const code = strip(readFileSync(join(folder, name), "utf8"));
      expect(code, name).not.toMatch(/\.reduce\(|Math\.|NEAR_LIMIT_RATIO|BASE_LATENCY_MS|fetch\(|XMLHttpRequest|WebSocket|lib\/ai|lib\/db|process\.env/);
      expect(code, name).not.toMatch(/\b(openai|anthropic|llama|gemini|mistral)\b/i);
    }
    for (const name of ["dev-center.ts", "dev-demo.ts", "koe-dev.ts", "dev-catalog.ts", "dev-messages.ts"]) {
      expect(strip(read(name)), name).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|node:crypto|from "crypto"|lib\/ai|lib\/db|process\.env/);
    }
  });
});
