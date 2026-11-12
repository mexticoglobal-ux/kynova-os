/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, generateEncryptionKey } from "@/lib/backend/crypto";
import { MemorySecretsProvider, SecretsManager } from "@/lib/backend/secrets";
import { FAMILY_SECRETS, configuredFamilies, newConnectorsState, reduceConnectors, type ConnectorsState } from "@/lib/contracts/platform/connectors";
import { EncryptedMemoryVault, GoogleWorkspace, type GoogleDeps } from "@/lib/integrations/google";
import { fakeGoogle } from "@/lib/integrations/google/fake-google";
import {
  CONTRACT_METHODS, DECLARED_MANIFESTS, HEALTH_WEIGHTS, HubEventLog, IntegrationHub, RateLimiter, SimulatedProvider, backoffMs, DEFAULT_RETRY, GOOGLE_HUB_MANIFEST, HealthTracker,
  googleCapabilityMap, googleHubProvider, healthScore, registryWithDeclared, runWithRetry, sanitizeDetail, validateManifest, validateRateLimits, validateWorkflow, failure, ok,
  type Actor, type Caller, type Deps, type HealthInputs, type ProviderManifest, type Workflow,
} from "./index";

const T1 = "tenant-nova";
const T2 = "tenant-vida";
const START = Date.parse("2026-11-12T10:00:00.000Z");
const person = (id: string): Actor => ({ kind: "person", id });
const worker = (workerId: string, tenantId = T1, connectorId = "connector-mail"): Caller => ({ kind: "worker", workerId, tenantId, connectorId });

function manifest(id: string, over: Partial<ProviderManifest> = {}): ProviderManifest {
  return {
    id, name: `Proveedor ${id}`, category: "email", type: "oauth2", version: "1.0.0", permissions: ["mail.read", "mail.send"],
    scopes: [{ id: "mail.read", label: "Leer", effect: "read" }, { id: "mail.send", label: "Enviar", effect: "write" }],
    rateLimits: { perMinute: 60, perHour: 1_000, perDay: 10_000, burst: 10 }, health: { latencyTargetMs: 500, syncMaxAgeMs: 3_600_000 },
    capabilities: [{ id: "mail.search", label: "Buscar", kind: "read", external: false }, { id: "mail.send", label: "Enviar", kind: "write", external: true }], ...over,
  };
}
function world(options: { admins?: Record<string, string[]>; workers?: Record<string, string[]>; timeout?: "never" | "now" } = {}) {
  const clock = { t: START, advance(ms: number) { this.t += ms; } };
  const slept: number[] = [];
  const mode = { timeout: options.timeout ?? "never" };
  const deps: Deps = { now: () => clock.t, sleep: async (ms) => { slept.push(ms); clock.t += ms; }, timeout: () => (mode.timeout === "now" ? Promise.resolve("timeout" as const) : new Promise(() => undefined)) };
  const admins = options.admins ?? { [T1]: ["ana"], [T2]: ["luis"] };
  const workers = options.workers ?? { [T1]: ["sales", "followup"], [T2]: ["sales"] };
  const registry = registryWithDeclared();
  const hub = new IntegrationHub({ registry, deps, policy: { isAdmin: (tenant, actor) => admins[tenant]?.includes(actor) ?? false, isWorkerActive: (tenant, id) => workers[tenant]?.includes(id) ?? false } });
  return { clock, slept, mode, deps, registry, hub, admins, workers };
}
type World = ReturnType<typeof world>;
function provide(w: World, id = "sim-mail", over: Partial<ProviderManifest> = {}) {
  const provider = new SimulatedProvider(manifest(id, over), w.clock);
  const registered = w.registry.register(provider);
  expect(registered, JSON.stringify(registered)).toEqual({ ok: true });
  return provider;
}
/** A company connected to a provider through the Hub: start, then the callback. */
async function connect(w: World, providerId: string, tenantId = T1, actor = person(tenantId === T1 ? "ana" : "luis")) {
  const started = await w.hub.connect(actor, { tenantId, providerId, connectInput: { phase: "start", scopes: ["mail.read"], redirectUri: "https://kynova.example/cb" } });
  expect(started.ok, started.message).toBe(true);
  const done = await w.hub.connect(actor, { tenantId, providerId, connectInput: { phase: "callback", state: "s", code: "c", redirectUri: "https://kynova.example/cb" } });
  expect(done.ok, done.message).toBe(true);
  return done.connection!;
}
const run = (w: World, caller: Caller, input: { capability: string; params?: Record<string, unknown>; providerId?: string; connectionId?: string; allowWriteFallback?: boolean }) => w.hub.execute(caller, { params: {}, ...input });

describe("one contract for every provider", () => {
  it("is the same eight methods for Google and for a simulated provider, and a registered provider must implement all of them", () => {
    expect([...CONTRACT_METHODS]).toEqual(["connect", "disconnect", "refresh", "health", "sync", "execute", "validate", "capabilities"]);
    const w = world();
    const sim = provide(w);
    const google = googleHubProvider(new GoogleWorkspace({} as GoogleDeps), { state: newConnectorsState(), env: { configuredFamilies: [], workers: [] } }, { redirectUri: "https://kynova.example/cb", now: () => START });
    for (const provider of [sim, google]) for (const method of CONTRACT_METHODS) expect(typeof (provider as unknown as Record<string, unknown>)[method], `${provider.manifest.id}.${method}`).toBe("function");
    const incomplete = { manifest: manifest("incomplete"), capabilities: () => manifest("incomplete").capabilities } as never;
    const result = w.registry.register(incomplete);
    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.issues).toEqual(expect.arrayContaining(["contract:connect", "contract:execute"]));
  });
  it("registers id, name, category, permissions, scopes, rate limits, health, capabilities, type and version, and rejects an invalid manifest", () => {
    const m = manifest("acme-mail");
    expect(validateManifest(m)).toEqual([]);
    for (const key of ["id", "name", "category", "type", "version", "permissions", "scopes", "rateLimits", "health", "capabilities"] as const) expect(m, key).toHaveProperty(key);
    expect(validateManifest(manifest("Bad Id"))).toContain("id");
    expect(validateManifest(manifest("ok", { version: "1.0" }))).toContain("version");
    expect(validateManifest(manifest("ok", { category: "nada" as never }))).toContain("category");
    expect(validateManifest(manifest("ok", { type: "magia" as never }))).toContain("type");
    expect(validateManifest(manifest("ok", { capabilities: [] }))).toContain("capabilities");
    expect(validateManifest(manifest("ok", { rateLimits: { perMinute: 100, perHour: 50, perDay: 10, burst: 5 } }))).toContain("rateLimits:order");
    expect(validateManifest(manifest("ok", { rateLimits: { perMinute: 10, perHour: 100, perDay: 1000, burst: 50 } }))).toContain("rateLimits:burst");
    expect(validateManifest(manifest("ok", { capabilities: [{ id: "mail.read", label: "x", kind: "read", external: true }] }))).toContain("capabilities:readExternal");
    expect(validateManifest(manifest("ok", { capabilities: [{ id: "MAIL", label: "x", kind: "read", external: false }] }))).toContain("capabilities:id");
    expect(validateManifest(manifest("ok", { scopes: [{ id: "a", label: "x", effect: "read" }, { id: "a", label: "y", effect: "write" }] }))).toContain("scopes:duplicate");
  });
  it("refuses a provider that promises capabilities it does not declare, and a duplicate", () => {
    const w = world();
    const sim = new SimulatedProvider(manifest("liar"), w.clock);
    (sim as unknown as { capabilities: () => never[] }).capabilities = () => [];
    expect(w.registry.register(sim)).toMatchObject({ ok: false, issues: ["capabilities:mismatch"] });
    provide(w, "twice");
    expect(w.registry.register(new SimulatedProvider(manifest("twice"), w.clock))).toMatchObject({ ok: false, issues: ["duplicate"] });
  });
  it("declares the providers KYNOVA expects (Outlook, WhatsApp, Meta, Stripe, MakaPay, PayPal, LinkedIn, TikTok, YouTube, Slack, Discord, Shopify, HubSpot, Salesforce), valid but with no adapter yet", () => {
    const registry = registryWithDeclared();
    expect(DECLARED_MANIFESTS.map((row) => row.id).sort()).toEqual(["discord", "hubspot", "linkedin", "makapay", "meta", "outlook", "paypal", "salesforce", "shopify", "slack", "stripe", "tiktok", "whatsapp", "youtube"]);
    for (const m of DECLARED_MANIFESTS) expect(validateManifest(m), m.id).toEqual([]);
    expect(registry.list().every((row) => !row.registered)).toBe(true);
    expect(registry.byCapability("payments.charge")).toEqual([]);
    expect(new Set(DECLARED_MANIFESTS.map((row) => row.category)).size).toBeGreaterThanOrEqual(7);
  });
  it("lets any future API plug in without touching the core: register an adapter, connect it, use it", async () => {
    const w = world();
    const acme = provide(w, "acme-crm", { category: "crm", capabilities: [{ id: "contacts.list", label: "Ver contactos", kind: "read", external: false }, { id: "contacts.upsert", label: "Crear contacto", kind: "write", external: true }] });
    expect(w.registry.byCategory("crm").map((row) => row.manifest.id)).toEqual(["acme-crm", "hubspot", "salesforce"]);
    expect(w.registry.byCapability("contacts.list").map((row) => row.manifest.id)).toEqual(["acme-crm"]);
    await connect(w, "acme-crm");
    expect((await run(w, worker("sales"), { capability: "contacts.list" })).status).toBe("done");
    expect(acme.calls.some((row) => row.method === "execute" && row.capability === "contacts.list")).toBe(true);
    expect(w.hub.capabilities("acme-crm").map((row) => row.capability.id)).toEqual(["contacts.list", "contacts.upsert"]);
  });
  it("registers a real adapter over a declared one, and a declared-only provider cannot be connected", async () => {
    const w = world();
    expect((await w.hub.connect(person("ana"), { tenantId: T1, providerId: "slack", connectInput: { phase: "start", scopes: [], redirectUri: "https://k.example/cb" } })).refusal).toBe("notRegistered");
    provide(w, "slack", { category: "chat", capabilities: [{ id: "chat.send", label: "Enviar", kind: "write", external: true }] });
    expect(w.registry.get("slack")!.registered).toBe(true);
    expect((await connect(w, "slack")).status).toBe("connected");
  });
});

describe("Worker → Connector → Integration Hub → Provider", () => {
  it("lets only a Worker (through its Connector) reach a provider: an agent, a module, a person or a screen cannot", async () => {
    const w = world();
    const sim = provide(w);
    await connect(w, "sim-mail");
    for (const caller of [{ kind: "agent", agentId: "comercial", tenantId: T1 }, { kind: "module", name: "crm", tenantId: T1 }, { kind: "person", id: "ana", tenantId: T1 }, { kind: "screen", tenantId: T1 }] as unknown as Caller[]) {
      expect((await run(w, caller, { capability: "mail.search" })).refusal, JSON.stringify(caller)).toBe("workerRequired");
      expect((await w.hub.sync(caller, { kind: "emails" })).status).toBe("refused");
    }
    expect(sim.calls.filter((row) => row.method === "execute" || row.method === "sync")).toEqual([]);
    expect((await run(w, worker("sales"), { capability: "mail.search" })).status).toBe("done");
    expect(sim.calls.find((row) => row.method === "execute")).toMatchObject({ workerId: "sales", tenantId: T1 });
  });
  it("refuses a Worker that is not active in the company, and never calls the provider", async () => {
    const w = world();
    const sim = provide(w);
    await connect(w, "sim-mail");
    expect((await run(w, worker("intruso"), { capability: "mail.search" })).refusal).toBe("workerInactive");
    expect((await run(w, worker("intruso", T2), { capability: "mail.search" })).refusal).toBe("workerInactive");
    expect(sim.calls.filter((row) => row.method === "execute")).toEqual([]);
  });
  it("picks the connection from the capability, and refuses a capability nobody offers or no connected app offers", async () => {
    const w = world();
    provide(w);
    expect((await run(w, worker("sales"), { capability: "mail.search" })).refusal).toBe("noProvider");
    await connect(w, "sim-mail");
    expect((await run(w, worker("sales"), { capability: "nada.nada" })).refusal).toBe("unknownCapability");
    expect((await run(w, worker("sales"), { capability: "mail.search" })).usedProvider).toBe("sim-mail");
  });
  it("validates through the provider before calling it: bad parameters never reach the provider", async () => {
    const w = world();
    const sim = provide(w);
    sim.required = { "mail.search": ["query"] };
    await connect(w, "sim-mail");
    const bad = await run(w, worker("sales"), { capability: "mail.search", params: {} });
    expect(bad).toMatchObject({ status: "refused", refusal: "invalid" });
    expect(bad.message).toContain("query");
    expect(sim.calls.filter((row) => row.method === "execute")).toEqual([]);
    expect((await run(w, worker("sales"), { capability: "mail.search", params: { query: "x" } })).status).toBe("done");
  });
  it("holds everything that leaves the platform for a person of THAT company: a Worker, another company's administrator and the system cannot approve", async () => {
    const w = world();
    const sim = provide(w);
    await connect(w, "sim-mail");
    const held = await run(w, worker("sales"), { capability: "mail.send", params: { to: "a@b.test" } });
    expect(held).toMatchObject({ status: "awaitingApproval" });
    expect(sim.calls.filter((row) => row.method === "execute")).toEqual([]);
    expect(w.hub.pendingFor(T1)).toMatchObject([{ id: held.approvalId, capability: "mail.send", workerId: "sales" }]);
    expect(w.hub.pendingFor(T2)).toEqual([]);
    for (const actor of [{ kind: "worker", id: "sales" }, { kind: "system", id: "system" }, { kind: "agent", id: "x" }] as Actor[]) expect((await w.hub.approve(actor, { tenantId: T1, approvalId: held.approvalId! })).refusal, actor.kind).toBe("personRequired");
    expect((await w.hub.approve(person("luis"), { tenantId: T1, approvalId: held.approvalId! })).refusal).toBe("forbidden");
    expect((await w.hub.approve(person("luis"), { tenantId: T2, approvalId: held.approvalId! })).refusal).toBe("notPending");
    const done = await w.hub.approve(person("ana"), { tenantId: T1, approvalId: held.approvalId! });
    expect(done).toMatchObject({ ok: true, status: "done" });
    expect(sim.calls.find((row) => row.method === "execute")).toMatchObject({ capability: "mail.send", approvedBy: "ana", workerId: "sales" });
    expect((await w.hub.approve(person("ana"), { tenantId: T1, approvalId: held.approvalId! })).refusal).toBe("notPending");
  });
  it("lets a person reject a held operation: nothing is sent", async () => {
    const w = world();
    const sim = provide(w);
    await connect(w, "sim-mail");
    const held = await run(w, worker("sales"), { capability: "mail.send", params: {} });
    expect(w.hub.reject(person("ana"), { tenantId: T1, approvalId: held.approvalId!, reason: "no" }).status).toBe("rejected");
    expect(w.hub.pendingFor(T1)).toEqual([]);
    expect(sim.calls.filter((row) => row.method === "execute")).toEqual([]);
    expect(w.hub.log.ofType("execute.rejected")).toHaveLength(1);
  });
});

describe("connecting, disconnecting and who owns an account", () => {
  it("needs a person who administers the company, and refuses NEX, the system and strangers", async () => {
    const w = world();
    provide(w);
    const start = (actor: Actor, tenantId = T1) => w.hub.connect(actor, { tenantId, providerId: "sim-mail", connectInput: { phase: "start", scopes: ["mail.read"], redirectUri: "https://k.example/cb" } });
    expect((await start({ kind: "worker", id: "worker:nex" })).refusal).toBe("personRequired");
    expect((await start({ kind: "system", id: "system" })).refusal).toBe("personRequired");
    expect((await start(person("intruso"))).refusal).toBe("forbidden");
    expect((await start(person("luis"), T1)).refusal).toBe("forbidden");
    const started = await start(person("ana"));
    expect(started).toMatchObject({ ok: true, connection: { status: "pending" }, value: { authorizationUrl: expect.stringContaining("sim.example") } });
    expect((await start(person("ana"))).refusal).toBe("alreadyConnected");
  });
  it("walks disconnected → pending → connected → disconnected, keeps only an opaque token reference, and forgets everything on disconnect", async () => {
    const w = world();
    provide(w);
    const connection = await connect(w, "sim-mail");
    expect(connection).toMatchObject({ status: "connected", tokenRef: expect.stringMatching(/^secret:/), accountRef: expect.stringContaining("sim-mail-account") });
    const off = await w.hub.disconnect(person("ana"), { tenantId: T1, connectionId: connection.id });
    expect(off).toMatchObject({ ok: true, value: { revoked: true }, connection: { status: "disconnected" } });
    expect(off.connection!.tokenRef).toBeUndefined();
    expect(off.connection!.accountRef).toBeUndefined();
    expect((await w.hub.disconnect(person("intruso"), { tenantId: T1, connectionId: connection.id })).refusal).toBe("forbidden");
    expect((await w.hub.disconnect(person("luis"), { tenantId: T2, connectionId: connection.id })).refusal).toBe("notFound");
    expect(w.hub.log.ofType("connection.disconnected")).toHaveLength(1);
    expect((await run(w, worker("sales"), { capability: "mail.search" })).refusal).toBe("noProvider");
  });
  it("records a denied authorization as an error", async () => {
    const w = world();
    provide(w);
    await w.hub.connect(person("ana"), { tenantId: T1, providerId: "sim-mail", connectInput: { phase: "start", scopes: [], redirectUri: "https://k.example/cb" } });
    const denied = await w.hub.connect(person("ana"), { tenantId: T1, providerId: "sim-mail", connectInput: { phase: "callback", state: "s", error: "access_denied", redirectUri: "https://k.example/cb" } });
    expect(denied).toMatchObject({ ok: false, failure: "auth", connection: { status: "error" } });
  });
  it("lets an external account belong to ONE company: a second company that claims it is refused and the grant is dropped", async () => {
    const w = world();
    const sim = provide(w);
    sim.nextAccount = "shared@x.test";
    await connect(w, "sim-mail", T1);
    await w.hub.connect(person("luis"), { tenantId: T2, providerId: "sim-mail", connectInput: { phase: "start", scopes: [], redirectUri: "https://k.example/cb" } });
    const second = await w.hub.connect(person("luis"), { tenantId: T2, providerId: "sim-mail", connectInput: { phase: "callback", state: "s", code: "c", redirectUri: "https://k.example/cb" } });
    expect(second).toMatchObject({ ok: false, refusal: "accountInUse" });
    expect(sim.calls.filter((row) => row.method === "disconnect")).toHaveLength(1);
    expect(w.hub.connections(T2)[0]).toMatchObject({ status: "error" });
    expect(w.hub.connections(T1)[0]).toMatchObject({ status: "connected" });
  });
  it("renews the access (a person or the platform) and reports a refused renewal as an error to fix", async () => {
    const w = world();
    const sim = provide(w);
    const connection = await connect(w, "sim-mail");
    expect(await w.hub.refresh({ kind: "system", id: "system" }, { tenantId: T1, connectionId: connection.id })).toMatchObject({ ok: true, value: { renewed: true } });
    expect((await w.hub.refresh({ kind: "worker", id: "sales" }, { tenantId: T1, connectionId: connection.id })).refusal).toBe("forbidden");
    sim.script("refresh", [failure("auth", "revocado", { retryable: false })]);
    const failed = await w.hub.refresh(person("ana"), { tenantId: T1, connectionId: connection.id });
    expect(failed).toMatchObject({ ok: false, failure: "auth", connection: { status: "error" } });
    expect(w.hub.log.ofType("connection.refresh_failed")).toHaveLength(1);
    expect((await w.hub.refresh(person("ana"), { tenantId: T1, connectionId: connection.id })).ok).toBe(true);
  });
});

describe("the Rate Limit Engine", () => {
  const spec = { perMinute: 5, perHour: 20, perDay: 40, burst: 3 };
  it("validates a rate limit spec", () => {
    expect(validateRateLimits(spec)).toEqual([]);
    expect(validateRateLimits({ ...spec, perMinute: 0 })).toContain("perMinute");
    expect(validateRateLimits({ ...spec, perHour: 2 })).toContain("order");
    expect(validateRateLimits({ ...spec, burst: 9 })).toContain("burst");
  });
  it("lets a burst through, then waits for the refill, and reports remaining and reset", () => {
    let now = START;
    const limiter = new RateLimiter(() => now);
    for (let index = 0; index < 3; index += 1) expect(limiter.acquire("k", spec).allowed).toBe(true);
    const blocked = limiter.acquire("k", spec);
    expect(blocked).toMatchObject({ allowed: false, limitedBy: "burst", remaining: { burst: 0 } });
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(blocked.remaining).toMatchObject({ minute: 2, hour: 17, day: 37 });
    expect(blocked.resetAt.minute).toBe(START + 60_000);
    now += blocked.retryAfterMs;
    expect(limiter.acquire("k", spec).allowed).toBe(true);
  });
  it("enforces the minute, hour and day windows and frees them as time passes", () => {
    let now = START;
    const limiter = new RateLimiter(() => now);
    const wide = { perMinute: 600, perHour: 6, perDay: 8, burst: 600 };
    for (let index = 0; index < 6; index += 1) { expect(limiter.acquire("k", wide).allowed).toBe(true); now += 1_000; }
    expect(limiter.check("k", wide)).toMatchObject({ allowed: false, limitedBy: "hour" });
    now += 3_600_000;
    expect(limiter.acquire("k", wide).allowed).toBe(true);
    expect(limiter.acquire("k", wide).allowed).toBe(true);
    expect(limiter.check("k", wide)).toMatchObject({ allowed: false, limitedBy: "day" });
    now += 86_400_000;
    expect(limiter.check("k", wide).allowed).toBe(true);
  });
  it("believes the provider when it says how much is left", () => {
    let now = START;
    const limiter = new RateLimiter(() => now);
    expect(limiter.check("k", spec).allowed).toBe(true);
    limiter.observe("k", spec, { remaining: 0, resetAt: START + 30_000 });
    expect(limiter.check("k", spec)).toMatchObject({ allowed: false, retryAfterMs: 30_000 });
    now = START + 30_001;
    expect(limiter.check("k", spec).allowed).toBe(true);
  });
  it("never exceeds the limit through the Hub: a call over the limit is refused without calling the provider", async () => {
    const w = world();
    const sim = provide(w, "sim-mail", { rateLimits: { perMinute: 4, perHour: 100, perDay: 1000, burst: 4 } });
    await connect(w, "sim-mail");
    const results: string[] = [];
    for (let index = 0; index < 6; index += 1) results.push((await run(w, worker("sales"), { capability: "mail.search" })).status);
    expect(results.filter((row) => row === "done").length).toBeLessThanOrEqual(4);
    expect(results.at(-1)).toBe("failed");
    expect(sim.calls.filter((row) => row.method === "execute").length).toBeLessThanOrEqual(4);
    expect(w.hub.log.ofType("rate.limited").length).toBeGreaterThan(0);
    expect(w.hub.log.ofType("rate.limited")[0]!.detail).toMatchObject({ limitedBy: expect.any(String), retryAfterMs: expect.any(Number) });
  });
  it("shares the provider's quota across companies while keeping each company's own bucket", async () => {
    const w = world();
    provide(w, "sim-mail", { rateLimits: { perMinute: 4, perHour: 100, perDay: 1000, burst: 4 } });
    await connect(w, "sim-mail", T1);
    await connect(w, "sim-mail", T2);
    // connecting already spends the shared quota of the app; every call after that counts for everyone
    const a = await run(w, worker("sales", T1), { capability: "mail.search" });
    const b = await run(w, worker("sales", T2), { capability: "mail.search" });
    const c = await run(w, worker("sales", T1), { capability: "mail.search" });
    const d = await run(w, worker("sales", T2), { capability: "mail.search" });
    expect([a, b, c, d].map((row) => row.status).filter((row) => row === "done").length).toBeLessThan(4);
  });
});

describe("the Retry Engine, the circuit breaker, fallback and recovery", () => {
  it("backs off exponentially with a deterministic jitter, capped", () => {
    const policy = { ...DEFAULT_RETRY, jitter: 0 };
    expect([1, 2, 3, 4, 5, 6].map((attempt) => backoffMs(attempt, policy, "seed"))).toEqual([200, 400, 800, 1600, 3200, 5000]);
    const jittered = [1, 2, 3].map((attempt) => backoffMs(attempt, DEFAULT_RETRY, "seed"));
    expect(jittered).toEqual([1, 2, 3].map((attempt) => backoffMs(attempt, DEFAULT_RETRY, "seed")));
    expect(backoffMs(1, DEFAULT_RETRY, "a")).not.toBe(backoffMs(1, DEFAULT_RETRY, "b"));
    jittered.forEach((value, index) => { const base = 200 * 2 ** index; expect(value).toBeGreaterThanOrEqual(base * 0.8); expect(value).toBeLessThanOrEqual(base * 1.2); });
  });
  it("retries only what is worth retrying, waits the backoff (or the provider's own retry-after), and stops at the attempts limit", async () => {
    const waits: number[] = [];
    let calls = 0;
    const flaky = await runWithRetry(async () => { calls += 1; return calls < 3 ? failure("provider", "x") : ok("listo"); }, { policy: { ...DEFAULT_RETRY, jitter: 0 }, seed: "s", sleep: async (ms) => void waits.push(ms) });
    expect(flaky.result).toEqual({ ok: true, value: "listo" });
    expect(waits).toEqual([200, 400]);
    expect(flaky.attempts.map((row) => row.ok)).toEqual([false, false, true]);
    calls = 0;
    const fatal = await runWithRetry(async () => { calls += 1; return failure("auth", "x"); }, { policy: DEFAULT_RETRY, seed: "s", sleep: async () => undefined });
    expect(calls).toBe(1);
    expect(fatal.result.ok).toBe(false);
    calls = 0;
    const waits2: number[] = [];
    await runWithRetry(async () => { calls += 1; return failure("rateLimit", "x", { retryAfterMs: 3_000 }); }, { policy: { ...DEFAULT_RETRY, jitter: 0 }, seed: "s", sleep: async (ms) => void waits2.push(ms) });
    expect(calls).toBe(3);
    expect(waits2).toEqual([3_000, 3_000]);
  });
  it("retries a transient failure through the Hub, then succeeds, and records the retries", async () => {
    const w = world();
    const sim = provide(w);
    await connect(w, "sim-mail");
    sim.script("execute", [failure("network", "x"), failure("provider", "x")]);
    const result = await run(w, worker("sales"), { capability: "mail.search" });
    expect(result).toMatchObject({ ok: true, status: "done", attempts: 3 });
    expect(w.slept).toHaveLength(2);
    expect(w.slept[1]!).toBeGreaterThan(w.slept[0]!);
    expect(w.hub.log.ofType("retry.scheduled")).toHaveLength(2);
    expect(sim.calls.filter((row) => row.method === "execute")).toHaveLength(3);
  });
  it("does not retry an authorization failure and marks the connection as an error the person must fix", async () => {
    const w = world();
    const sim = provide(w);
    await connect(w, "sim-mail");
    sim.script("execute", [failure("auth", "revocado", { retryable: false })]);
    const result = await run(w, worker("sales"), { capability: "mail.search" });
    expect(result).toMatchObject({ ok: false, status: "failed", failure: "auth", attempts: 1 });
    expect(w.hub.connections(T1)[0]).toMatchObject({ status: "error", lastError: { kind: "auth" } });
    expect(w.slept).toEqual([]);
  });
  it("opens the circuit after repeated failures, calls nothing while it is open, probes after the cooldown, and closes on success", async () => {
    const w = world();
    const sim = provide(w, "sim-mail", { breaker: { failureThreshold: 2, cooldownMs: 60_000, deadAfterOpens: 3 }, retry: { maxAttempts: 1 } });
    await connect(w, "sim-mail");
    sim.script("execute", [failure("provider", "x"), failure("provider", "x")]);
    await run(w, worker("sales"), { capability: "mail.search" });
    await run(w, worker("sales"), { capability: "mail.search" });
    expect(w.hub.log.ofType("circuit.opened")).toHaveLength(1);
    const before = sim.calls.filter((row) => row.method === "execute").length;
    const blocked = await run(w, worker("sales"), { capability: "mail.search" });
    expect(blocked).toMatchObject({ ok: false, status: "failed" });
    expect(sim.calls.filter((row) => row.method === "execute")).toHaveLength(before);
    w.clock.advance(61_000);
    const probe = await run(w, worker("sales"), { capability: "mail.search" });
    expect(probe).toMatchObject({ ok: true, status: "done" });
    expect(w.hub.log.ofType("circuit.half_open")).toHaveLength(1);
    expect(w.hub.log.ofType("circuit.closed")).toHaveLength(1);
    expect((await run(w, worker("sales"), { capability: "mail.search" })).ok).toBe(true);
  });
  it("reopens when the probe fails, declares the connector dead after repeated openings, and only a person recovers it", async () => {
    const w = world();
    const sim = provide(w, "sim-mail", { breaker: { failureThreshold: 1, cooldownMs: 10_000, deadAfterOpens: 2 }, retry: { maxAttempts: 1 } });
    const connection = await connect(w, "sim-mail");
    sim.script("execute", [failure("provider", "x"), failure("provider", "x")]);
    await run(w, worker("sales"), { capability: "mail.search" });
    w.clock.advance(11_000);
    await run(w, worker("sales"), { capability: "mail.search" });
    expect(w.hub.log.ofType("connector.dead")).toHaveLength(1);
    expect(w.hub.connections(T1)[0]!.status).toBe("dead");
    w.clock.advance(1_000_000);
    const calls = sim.calls.filter((row) => row.method === "execute").length;
    expect((await run(w, worker("sales"), { capability: "mail.search" })).refusal).toBe("noProvider");
    const dead = await w.hub.health(T1, connection.id);
    expect(dead.value!.report).toMatchObject({ score: 0, status: "dead" });
    expect(sim.calls.filter((row) => row.method === "execute")).toHaveLength(calls);
    expect(w.hub.recover(person("intruso"), { tenantId: T1, connectionId: connection.id }).refusal).toBe("forbidden");
    expect(w.hub.recover({ kind: "worker", id: "sales" }, { tenantId: T1, connectionId: connection.id }).refusal).toBe("personRequired");
    expect(w.hub.recover(person("ana"), { tenantId: T1, connectionId: connection.id })).toMatchObject({ ok: true });
    expect(w.hub.log.ofType("connector.recovered")).toHaveLength(1);
    w.hub.engine.limiter.reset(`${T1}:${connection.id}`);
    expect((await w.hub.sync({ kind: "system", tenantId: T1, reason: "probe" }, { connectionId: connection.id, kind: "emails" })).status).toBe("refused");
  });
  it("applies the timeout: a provider that never answers is a timeout failure that counts against the circuit", async () => {
    const w = world({ timeout: "now" });
    const sim = provide(w, "sim-mail", { retry: { maxAttempts: 1 }, timeoutMs: 500, breaker: { failureThreshold: 2, cooldownMs: 60_000, deadAfterOpens: 3 } });
    await connect(w, "sim-mail");
    sim.script("execute", ["hang", "hang"]);
    expect(await run(w, worker("sales"), { capability: "mail.search" })).toMatchObject({ ok: false, failure: "timeout" });
    await run(w, worker("sales"), { capability: "mail.search" });
    expect(w.hub.log.ofType("circuit.opened")).toHaveLength(1);
  });
  it("falls back to another connected provider with the same capability for a read, and records it", async () => {
    const w = world();
    const first = provide(w, "mail-a");
    const second = provide(w, "mail-b");
    await connect(w, "mail-a");
    await connect(w, "mail-b");
    first.script("execute", [failure("provider", "x"), failure("provider", "x"), failure("provider", "x")]);
    const result = await run(w, worker("sales"), { capability: "mail.search" });
    expect(result).toMatchObject({ ok: true, status: "done", usedProvider: "mail-b", fallbackUsed: true });
    expect(second.calls.filter((row) => row.method === "execute")).toHaveLength(1);
    expect(w.hub.log.ofType("fallback.used")[0]!.detail).toMatchObject({ from: "mail-a", to: "mail-b" });
  });
  it("never sends an external write to another provider unless the request allows it", async () => {
    const w = world();
    const first = provide(w, "mail-a");
    const second = provide(w, "mail-b");
    await connect(w, "mail-a");
    await connect(w, "mail-b");
    first.script("execute", Array.from({ length: 6 }, () => failure("provider", "x")));
    const held = await run(w, worker("sales"), { capability: "mail.send", params: {} });
    const failed = await w.hub.approve(person("ana"), { tenantId: T1, approvalId: held.approvalId! });
    expect(failed).toMatchObject({ ok: false, status: "failed", usedProvider: "mail-a" });
    expect(second.calls.filter((row) => row.method === "execute")).toEqual([]);
    const second2 = await run(w, worker("sales"), { capability: "mail.send", params: {}, allowWriteFallback: true });
    const sent = await w.hub.approve(person("ana"), { tenantId: T1, approvalId: second2.approvalId! });
    expect(sent).toMatchObject({ ok: true, usedProvider: "mail-b", fallbackUsed: true });
  });
  it("prefers a connection whose circuit is closed over one that is open", async () => {
    const w = world();
    const first = provide(w, "mail-a", { breaker: { failureThreshold: 1, cooldownMs: 600_000, deadAfterOpens: 3 }, retry: { maxAttempts: 1 } });
    provide(w, "mail-b");
    await connect(w, "mail-a");
    await connect(w, "mail-b");
    first.script("execute", [failure("provider", "x")]);
    await run(w, worker("sales"), { capability: "mail.search" });
    const next = await run(w, worker("sales"), { capability: "mail.search" });
    expect(next.usedProvider).toBe("mail-b");
    expect(next.fallbackUsed).toBe(false);
  });
});

describe("the Health Engine", () => {
  const perfect: HealthInputs = { hasSamples: true, latencyP95Ms: 100, latencyTargetMs: 500, errorRate: 0, timeoutRate: 0, tokenState: "valid", oauth: "authorized", lastSyncAgeMs: 60_000, syncMaxAgeMs: 3_600_000, rateLimitPressure: 0, breaker: "closed" };
  it("scores 0 to 100 from latency, errors, timeouts, token, last sync, OAuth, rate limits and the circuit breaker", () => {
    const report = healthScore(perfect);
    expect(report).toMatchObject({ score: 100, status: "healthy" });
    expect(report.factors.map((row) => row.name)).toEqual(["latency", "errors", "timeouts", "token", "sync", "oauth", "rateLimit", "breaker"]);
    expect(Object.values(HEALTH_WEIGHTS).reduce((total, value) => total + value, 0)).toBe(100);
    expect(report.factors.every((row) => row.points <= row.max)).toBe(true);
  });
  it("loses points for each problem, and caps what a connection that cannot work can show", () => {
    expect(healthScore({ ...perfect, latencyP95Ms: 2_000 }).score).toBeLessThan(100);
    expect(healthScore({ ...perfect, latencyP95Ms: 2_000 }).factors[0]!.points).toBe(0);
    expect(healthScore({ ...perfect, errorRate: 0.25 }).factors[1]!.points).toBe(10);
    expect(healthScore({ ...perfect, timeoutRate: 0.3 }).factors[2]!.points).toBe(0);
    expect(healthScore({ ...perfect, lastSyncAgeMs: 4 * 3_600_000 }).factors[4]!.points).toBe(0);
    expect(healthScore({ ...perfect, rateLimitPressure: 1 }).factors[6]!.points).toBe(0);
    expect(healthScore({ ...perfect, tokenState: "expiringSoon" }).score).toBeLessThan(100);
    expect(healthScore({ ...perfect, tokenState: "expired" }).score).toBeLessThanOrEqual(45);
    expect(healthScore({ ...perfect, oauth: "revoked" }).score).toBeLessThanOrEqual(45);
    expect(healthScore({ ...perfect, breaker: "open" }).score).toBeLessThanOrEqual(40);
    expect(healthScore({ ...perfect, breaker: "halfOpen" }).score).toBe(95);
    expect(healthScore({ ...perfect, breaker: "dead" })).toMatchObject({ score: 0, status: "dead" });
    expect(healthScore({ ...perfect, errorRate: 0.5, timeoutRate: 0.3, latencyP95Ms: 5_000, tokenState: "expired", oauth: "none", rateLimitPressure: 1 }).score).toBe(20); // only the fresh sync (10) and the closed circuit (10) are left
  });
  it("labels the score healthy, degraded or unhealthy", () => {
    expect(healthScore(perfect).status).toBe("healthy");
    expect(healthScore({ ...perfect, errorRate: 0.3, timeoutRate: 0.15, latencyP95Ms: 1_500 }).status).toBe("degraded");
    expect(healthScore({ ...perfect, errorRate: 0.5, timeoutRate: 0.3, latencyP95Ms: 3_000, rateLimitPressure: 1, tokenState: "expired" }).status).toBe("unhealthy");
  });
  it("tracks the recent calls (a short window), ignoring authorization problems as the provider being unhealthy", () => {
    const tracker = new HealthTracker(5);
    for (const sample of [{ latencyMs: 100, ok: true }, { latencyMs: 200, ok: true }, { latencyMs: 900, ok: false, kind: "timeout" }, { latencyMs: 50, ok: false, kind: "auth" }]) tracker.record("k", sample);
    const summary = tracker.summary("k");
    expect(summary).toMatchObject({ count: 4, p95Ms: 900 });
    expect(summary.errorRate).toBeCloseTo(1 / 3, 5);
    expect(summary.timeoutRate).toBeCloseTo(1 / 3, 5);
    for (let index = 0; index < 10; index += 1) tracker.record("k", { latencyMs: 10, ok: true });
    expect(tracker.summary("k")).toMatchObject({ count: 5, errorRate: 0 });
    expect(tracker.summary("nada")).toEqual({ count: 0, errorRate: 0, timeoutRate: 0 });
  });
  it("scores a live connection through the Hub: healthy at first, worse after errors and timeouts, and says when the status changes", async () => {
    const w = world();
    const sim = provide(w, "sim-mail", { retry: { maxAttempts: 1 } });
    const connection = await connect(w, "sim-mail");
    await run(w, worker("sales"), { capability: "mail.search" });
    await w.hub.sync({ kind: "system", tenantId: T1, reason: "t" }, { connectionId: connection.id, kind: "emails" });
    const first = await w.hub.health(T1, connection.id);
    expect(first.value!.report.score).toBeGreaterThanOrEqual(90);
    expect(first.value!.report.status).toBe("healthy");
    sim.tokenState = "expired";
    sim.oauth = "revoked";
    const second = await w.hub.health(T1, connection.id);
    expect(second.value!.report.score).toBeLessThanOrEqual(45);
    expect(w.hub.log.ofType("health.changed").map((row) => row.detail!["to"])).toEqual(["healthy", expect.stringMatching(/degraded|unhealthy/)]);
    expect((await w.hub.health(T2, connection.id)).refusal).toBe("notFound");
  });
});

describe("observability and the event log", () => {
  it("counts events by type and by provider, measures latency and success, and ties everything one request caused to one trace", async () => {
    const w = world();
    const sim = provide(w, "sim-mail", { retry: { maxAttempts: 1 } });
    await connect(w, "sim-mail");
    sim.latencyMs = 100;
    await run(w, worker("sales"), { capability: "mail.search" });
    sim.latencyMs = 300;
    await run(w, worker("sales"), { capability: "mail.search" });
    sim.script("execute", [failure("provider", "x")]);
    const failed = await run(w, worker("sales"), { capability: "mail.search" });
    const snapshot = w.hub.observability.snapshot();
    expect(snapshot.byProvider["sim-mail"]).toMatchObject({ "execute.succeeded": 2, "execute.failed": 1, "connection.connected": 1 });
    expect(snapshot.successRate["sim-mail"]).toBe(67);
    expect(snapshot.latency["sim-mail"]).toMatchObject({ count: expect.any(Number), maxMs: 300 });
    expect(snapshot.byType["execute.requested"]).toBe(3);
    const trace = w.hub.log.byTrace(failed.traceId!);
    expect(trace.map((row) => row.type)).toEqual(["execute.requested", "execute.failed"]);
  });
  it("keeps nothing sensitive in an event: keys that smell of content or credentials are dropped", () => {
    expect(sanitizeDetail({ capability: "mail.send", token: "abc", accessToken: "x", subject: "Privado", body: "hola", to: 5, email: "a@b.test", authorization: "Bearer x", ok: true, text: "t", code: "c", kind: "auth" })).toEqual({ capability: "mail.send", to: 5, ok: true, kind: "auth" });
    expect(sanitizeDetail({ long: "x".repeat(500) })!["long"]).toHaveLength(120);
    expect(sanitizeDetail(undefined)).toBeUndefined();
    expect(sanitizeDetail({ token: "x" })).toBeUndefined();
    const log = new HubEventLog();
    const event = log.emit({ at: "2026-11-12T10:00:00.000Z", tenantId: T1, providerId: "p", type: "execute.succeeded", detail: { password: "x", items: 3 } });
    expect(JSON.stringify(event)).not.toContain("password");
  });
  it("keeps every company's events apart, and gives the trail in the shape of the platform's other modules", async () => {
    const w = world();
    provide(w);
    await connect(w, "sim-mail", T1);
    await connect(w, "sim-mail", T2);
    await run(w, worker("sales", T1), { capability: "mail.search" });
    expect(w.hub.log.forTenant(T1).every((row) => row.tenantId === T1)).toBe(true);
    expect(w.hub.log.forTenant(T2).some((row) => row.type.startsWith("execute"))).toBe(false);
    const audit = w.hub.log.toAudit(T1);
    expect(audit.length).toBeGreaterThan(0);
    expect(audit[0]).toMatchObject({ actor: "system", tenantId: T1, action: expect.any(String) });
    expect(JSON.stringify(audit)).not.toMatch(/@|token|secret/i);
    expect(w.hub.log.all().map((row) => row.id)).toEqual([...new Set(w.hub.log.all().map((row) => row.id))]);
  });
  it("lets other parts subscribe to the events (the Event Bus bridge of a later step)", async () => {
    const w = world();
    provide(w);
    const seen: string[] = [];
    const stop = w.hub.log.listen((event) => seen.push(event.type));
    await connect(w, "sim-mail");
    stop();
    const count = seen.length;
    await run(w, worker("sales"), { capability: "mail.search" });
    expect(seen).toContain("connection.connected");
    expect(seen).toHaveLength(count);
  });
});

describe("the Workflow Engine: sync, push, pull, webhook, manual and scheduled", () => {
  const flow = (over: Partial<Workflow> = {}): Omit<Workflow, "createdBy" | "createdAt" | "lastRunAt"> => ({
    id: "wf-1", tenantId: T1, name: "Resumen del correo", providerId: "sim-mail", workerId: "sales", trigger: { kind: "manual" }, enabled: true,
    steps: [{ id: "s1", kind: "sync", syncKind: "emails" }, { id: "s2", kind: "pull", capability: "mail.search", params: { query: "is:unread" } }], ...over,
  });
  it("validates a definition and lets only an administrator define one", () => {
    const w = world();
    provide(w);
    expect(validateWorkflow({ ...flow(), createdBy: "x", createdAt: "x" }, () => true)).toEqual([]);
    expect(validateWorkflow({ ...flow({ name: "x", steps: [] }), createdBy: "x", createdAt: "x" }, () => false)).toEqual(expect.arrayContaining(["name", "provider", "steps"]));
    expect(validateWorkflow({ ...flow({ trigger: { kind: "scheduled" } }), createdBy: "x", createdAt: "x" }, () => true)).toContain("schedule");
    expect(validateWorkflow({ ...flow({ steps: [{ id: "a", kind: "sync" }, { id: "a", kind: "push" }] }), createdBy: "x", createdAt: "x" }, () => true)).toEqual(expect.arrayContaining(["step:a:syncKind", "step:a:capability", "steps:duplicate"]));
    expect(w.hub.defineWorkflow({ kind: "worker", id: "sales" }, flow()).refusal).toBe("personRequired");
    expect(w.hub.defineWorkflow(person("luis"), flow()).refusal).toBe("forbidden");
    expect(w.hub.defineWorkflow(person("ana"), flow({ providerId: "no-existe" }))).toMatchObject({ ok: false, value: { issues: ["provider"] } });
    expect(w.hub.defineWorkflow(person("ana"), flow()).ok).toBe(true);
  });
  it("runs by hand as the Worker: sync then pull, with a trace, and records the run", async () => {
    const w = world();
    const sim = provide(w);
    await connect(w, "sim-mail");
    w.hub.defineWorkflow(person("ana"), flow());
    const result = await w.hub.runWorkflow(person("ana"), { tenantId: T1, workflowId: "wf-1" });
    expect(result).toMatchObject({ status: "completed", trigger: "manual", steps: [{ id: "s1", status: "ok", items: 3 }, { id: "s2", status: "ok" }] });
    expect(sim.calls.filter((row) => row.method === "sync" || row.method === "execute").every((row) => row.workerId === "sales")).toBe(true);
    expect(w.hub.workflows.runs(T1)).toHaveLength(1);
    expect(w.hub.workflows.runs(T2)).toEqual([]);
    expect(await w.hub.runWorkflow(person("intruso"), { tenantId: T1, workflowId: "wf-1" })).toBeUndefined();
    expect(w.hub.log.byTrace(result!.traceId).map((row) => row.type)).toEqual(["workflow.started", "workflow.step", "workflow.step", "workflow.finished"]);
  });
  it("stops at a failed step and skips the rest, and leaves a run waiting when a push needs a person", async () => {
    const w = world();
    const sim = provide(w, "sim-mail", { retry: { maxAttempts: 1 } });
    await connect(w, "sim-mail");
    w.hub.defineWorkflow(person("ana"), flow());
    sim.script("sync", [failure("provider", "x")]);
    expect(await w.hub.runWorkflow(person("ana"), { tenantId: T1, workflowId: "wf-1" })).toMatchObject({ status: "failed", steps: [{ id: "s1", status: "failed", kind: "provider" }, { id: "s2", status: "skipped" }] });
    w.hub.defineWorkflow(person("ana"), flow({ id: "wf-2", steps: [{ id: "p1", kind: "push", capability: "mail.send", params: { to: "a@b.test" } }] }));
    const waiting = await w.hub.runWorkflow(person("ana"), { tenantId: T1, workflowId: "wf-2" });
    expect(waiting).toMatchObject({ status: "awaitingApproval", steps: [{ id: "p1", status: "awaitingApproval", approvalId: expect.any(String) }] });
    expect(w.hub.pendingFor(T1)).toHaveLength(1);
    expect(sim.calls.filter((row) => row.method === "execute" && row.capability === "mail.send")).toEqual([]);
  });
  it("skips a disabled workflow and one whose trigger does not match, and runs scheduled workflows only when due", async () => {
    const w = world();
    provide(w);
    await connect(w, "sim-mail");
    w.hub.defineWorkflow(person("ana"), flow({ id: "wf-off", enabled: false }));
    expect((await w.hub.runWorkflow(person("ana"), { tenantId: T1, workflowId: "wf-off" }))!.status).toBe("skipped");
    w.hub.defineWorkflow(person("ana"), flow({ id: "wf-sched", trigger: { kind: "scheduled", everyMinutes: 30 } }));
    expect((await w.hub.runScheduled(T1)).map((row) => `${row.workflowId}:${row.status}`)).toEqual(["wf-sched:completed"]);
    expect(await w.hub.runScheduled(T1)).toEqual([]);
    w.clock.advance(31 * 60_000);
    expect((await w.hub.runScheduled(T1)).map((row) => row.workflowId)).toEqual(["wf-sched"]);
    expect(await w.hub.runScheduled(T2)).toEqual([]);
    expect(await w.hub.workflows.run("wf-sched", T1, "webhook")).toMatchObject({ status: "skipped" });
  });
  it("runs a webhook workflow only after the provider validates the signature, and drops a bad one", async () => {
    const w = world();
    const sim = provide(w);
    await connect(w, "sim-mail");
    w.hub.defineWorkflow(person("ana"), flow({ id: "wf-hook", trigger: { kind: "webhook" }, steps: [{ id: "s1", kind: "pull", capability: "mail.search", params: {} }] }));
    const rejected = await w.hub.webhook({ tenantId: T1, providerId: "sim-mail", headers: { "x-signature": "falsa" }, body: "{}" });
    expect(rejected).toMatchObject({ ok: false, refusal: "invalid" });
    expect(w.hub.workflows.runs(T1)).toEqual([]);
    expect(w.hub.log.ofType("webhook.rejected")).toHaveLength(1);
    const accepted = await w.hub.webhook({ tenantId: T1, providerId: "sim-mail", headers: { "x-signature": sim.webhookSecret }, body: "{}" });
    expect(accepted).toMatchObject({ ok: true, value: { runs: 1 } });
    expect(w.hub.workflows.runs(T1)[0]).toMatchObject({ trigger: "webhook", status: "completed" });
    expect((await w.hub.webhook({ tenantId: T2, providerId: "sim-mail", headers: { "x-signature": sim.webhookSecret }, body: "{}" })).refusal).toBe("notConnected");
  });
  it("supports every trigger kind and fires the workflows of a trigger for one provider", async () => {
    const w = world();
    provide(w);
    await connect(w, "sim-mail");
    for (const kind of ["sync", "push", "pull", "webhook", "manual", "scheduled"] as const) {
      const trigger = kind === "scheduled" ? { kind, everyMinutes: 5 } : { kind };
      expect(w.hub.defineWorkflow(person("ana"), flow({ id: `wf-${kind}`, trigger })).ok, kind).toBe(true);
    }
    expect(w.hub.workflows.list(T1)).toHaveLength(6);
    expect((await w.hub.workflows.fire(T1, "sim-mail", "sync")).map((row) => row.workflowId)).toEqual(["wf-sync"]);
    expect(await w.hub.workflows.fire(T1, "otro", "sync")).toEqual([]);
  });
});

describe("every company is its own world", () => {
  it("keeps connections, breakers, health samples, approvals and workflows apart", async () => {
    const w = world();
    const sim = provide(w, "sim-mail", { breaker: { failureThreshold: 1, cooldownMs: 600_000, deadAfterOpens: 5 }, retry: { maxAttempts: 1 } });
    const a = await connect(w, "sim-mail", T1);
    const b = await connect(w, "sim-mail", T2);
    expect(a.id).not.toBe(b.id);
    sim.script("execute", [failure("provider", "x")]);
    await run(w, worker("sales", T1), { capability: "mail.search" });
    expect((await run(w, worker("sales", T1), { capability: "mail.search" })).ok).toBe(false);
    expect((await run(w, worker("sales", T2), { capability: "mail.search" })).ok).toBe(true);
    expect(w.hub.connections(T1)).toHaveLength(1);
    expect(w.hub.connection(T1, b.id)).toBeUndefined();
    expect((await run(w, worker("sales", T1), { capability: "mail.search", connectionId: b.id })).refusal).toBe("noProvider");
    const held = await run(w, worker("sales", T1), { capability: "mail.send", params: {} });
    expect(w.hub.pendingFor(T2)).toEqual([]);
    expect((await w.hub.approve(person("luis"), { tenantId: T2, approvalId: held.approvalId! })).refusal).toBe("notPending");
    w.hub.defineWorkflow(person("ana"), { id: "wf-1", tenantId: T1, name: "Solo Nova", providerId: "sim-mail", workerId: "sales", trigger: { kind: "manual" }, enabled: true, steps: [{ id: "s", kind: "sync", syncKind: "emails" }] });
    expect(w.hub.workflows.get("wf-1", T2)).toBeUndefined();
    expect(await w.hub.runWorkflow(person("luis"), { tenantId: T2, workflowId: "wf-1" })).toBeUndefined();
  });
  it("does not spend one company's rate limit on another company's calls", async () => {
    const w = world();
    provide(w, "sim-mail", { rateLimits: { perMinute: 100, perHour: 1000, perDay: 10_000, burst: 12 } });
    await connect(w, "sim-mail", T1);
    await connect(w, "sim-mail", T2);
    for (let index = 0; index < 5; index += 1) await run(w, worker("sales", T1), { capability: "mail.search" });
    const key = (tenant: string, id: string) => `${tenant}:${id}`;
    const t1 = w.hub.engine.limiter.check(key(T1, w.hub.connections(T1)[0]!.id), { perMinute: 100, perHour: 1000, perDay: 10_000, burst: 12 });
    const t2 = w.hub.engine.limiter.check(key(T2, w.hub.connections(T2)[0]!.id), { perMinute: 100, perHour: 1000, perDay: 10_000, burst: 12 });
    expect(t1.remaining.burst).toBeLessThan(t2.remaining.burst);
  });
});

describe("Google Workspace is the first provider behind the Hub, unchanged", () => {
  const REDIRECT = "https://kynova.example/api/google/callback";
  async function googleWorld() {
    const w = world();
    const google = fakeGoogle({ clientId: `client-id-${"a".repeat(20)}`, clientSecret: `client-secret-${"b".repeat(24)}`, now: START });
    const key = generateEncryptionKey();
    const vault = new EncryptedMemoryVault({ encrypt: (plain, context) => encrypt(plain, key, context), decrypt: (envelope, context) => decrypt(envelope, key, context) });
    const secrets = new SecretsManager(new MemorySecretsProvider({ [FAMILY_SECRETS.google.clientId]: `client-id-${"a".repeat(20)}`, [FAMILY_SECRETS.google.clientSecret]: `client-secret-${"b".repeat(24)}` }));
    const deps: GoogleDeps = { fetchImpl: google.fetch, secrets, vault, now: () => w.clock.t, sleep: async () => undefined };
    google.setClock(START);
    const env = { configuredFamilies: configuredFamilies(secrets), workers: [{ tenantId: T1, id: "sales", status: "active" }] };
    let state: ConnectorsState = reduceConnectors(newConnectorsState(), { tenantId: T1, actor: "ana", at: new Date(START).toISOString(), type: "tenant.enable" }, env).state;
    const store = { get state() { return state; }, set state(value: ConnectorsState) { state = value; }, env };
    const workspace = new GoogleWorkspace(deps);
    expect(w.registry.register(googleHubProvider(workspace, store, { redirectUri: REDIRECT, now: () => w.clock.t }))).toEqual({ ok: true });
    return { ...w, google, vault, store, workspace };
  }
  it("registers with the same manifest shape as every provider and offers its capabilities through the universal verbs", async () => {
    const g = await googleWorld();
    expect(validateManifest(GOOGLE_HUB_MANIFEST)).toEqual([]);
    expect(g.registry.get("google-workspace")).toMatchObject({ registered: true, manifest: { name: "Google Workspace", type: "oauth2" } });
    expect(g.registry.byCapability("mail.send").map((row) => row.manifest.id)).toEqual(["google-workspace"]);
    expect(googleCapabilityMap().find((row) => row.capability === "files.upload")).toMatchObject({ operation: "drive.upload", connectorId: "googleDrive" });
    expect(g.hub.capabilities("google-workspace").filter((row) => row.capability.external).map((row) => row.capability.id)).toEqual(expect.arrayContaining(["mail.send", "calendar.create", "files.share"]));
  });
  it("connects through the Hub's OAuth, reads through a Worker, and holds a send for a person before Google sees it", async () => {
    const g = await googleWorld();
    const started = await g.hub.connect(person("ana"), { tenantId: T1, providerId: "google-workspace", connectInput: { phase: "start", scopes: ["readMail", "sendMail"], redirectUri: REDIRECT, target: "gmail" } });
    expect(started).toMatchObject({ ok: true, connection: { status: "pending" } });
    const url = new URL(started.value!.authorizationUrl!);
    expect(url.origin).toBe("https://accounts.google.com");
    g.google.grantCode({ code: "code-1", challenge: url.searchParams.get("code_challenge")!, email: "ana@nova.test", scopes: url.searchParams.get("scope")!.split(" ") });
    const done = await g.hub.connect(person("ana"), { tenantId: T1, providerId: "google-workspace", connectInput: { phase: "callback", state: url.searchParams.get("state")!, code: "code-1", redirectUri: REDIRECT, target: "gmail" } });
    expect(done).toMatchObject({ ok: true, connection: { status: "connected", accountRef: "ana@nova.test" } });
    // the company turns the permissions on in the connectors architecture (unchanged)
    const connection = g.store.state.connections[0]!;
    for (const [scope, grant] of [["readMail", "auto"], ["sendMail", "approval"]] as const) g.store.state = reduceConnectors(g.store.state, { tenantId: T1, actor: "ana", at: new Date(START).toISOString(), type: "permissions.set", connectionId: connection.id, scope, grant }, g.store.env).state;
    g.google.mailbox["m1"] = { id: "m1", threadId: "t1", labelIds: ["INBOX"], internalDate: String(START), headers: { From: "Cliente <c@x.test>", Subject: "Hola" }, text: "Hola, necesito una cotización" };
    const read = await run(g, worker("sales"), { capability: "mail.search", params: { query: "is:unread" } });
    expect(read).toMatchObject({ ok: true, status: "done", usedProvider: "google-workspace", value: { messages: [{ id: "m1" }] } });
    const held = await run(g, worker("sales"), { capability: "mail.send", params: { to: ["cliente@x.test"], subject: "Cotización", text: "Adjunto" } });
    expect(held.status).toBe("awaitingApproval");
    expect(g.google.sent).toEqual([]);
    expect((await g.hub.approve({ kind: "worker", id: "sales" }, { tenantId: T1, approvalId: held.approvalId! })).refusal).toBe("personRequired");
    const sent = await g.hub.approve(person("ana"), { tenantId: T1, approvalId: held.approvalId! });
    expect(sent).toMatchObject({ ok: true, status: "done" });
    expect(g.google.sent).toHaveLength(1);
    expect(g.google.sent[0]!.raw).toContain("To: cliente@x.test");
    // what the Hub keeps: events with no content and a connection with only an opaque token reference
    const dump = JSON.stringify([g.hub.log.all(), g.hub.connections(T1)]);
    expect(dump).not.toMatch(/Cotización|cliente@x\.test|necesito/);
    expect(g.hub.connections(T1)[0]!.tokenRef).toMatch(/^secret:oauth-/);
    for (const row of g.vault.rawRows()) expect(row).not.toContain(g.google.issued()[0]!.access);
  });
  it("syncs and reports health through the same universal calls, and disconnects by revoking at Google", async () => {
    const g = await googleWorld();
    const started = await g.hub.connect(person("ana"), { tenantId: T1, providerId: "google-workspace", connectInput: { phase: "start", scopes: ["readMail"], redirectUri: REDIRECT, target: "gmail" } });
    const url = new URL(started.value!.authorizationUrl!);
    g.google.grantCode({ code: "c", challenge: url.searchParams.get("code_challenge")!, email: "ana@nova.test", scopes: url.searchParams.get("scope")!.split(" ") });
    const done = await g.hub.connect(person("ana"), { tenantId: T1, providerId: "google-workspace", connectInput: { phase: "callback", state: url.searchParams.get("state")!, code: "c", redirectUri: REDIRECT, target: "gmail" } });
    g.store.state = reduceConnectors(g.store.state, { tenantId: T1, actor: "ana", at: new Date(START).toISOString(), type: "permissions.set", connectionId: g.store.state.connections[0]!.id, scope: "readMail", grant: "auto" }, g.store.env).state;
    g.google.mailbox["m1"] = { id: "m1", threadId: "t", labelIds: [], internalDate: String(START - 60_000), headers: {}, text: "x" };
    const synced = await g.hub.sync({ kind: "system", tenantId: T1, reason: "scheduled" }, { providerId: "google-workspace", kind: "emails" });
    expect(synced).toMatchObject({ status: "done", items: 1 });
    expect(g.hub.connections(T1)[0]!.lastSyncAt).toBeDefined();
    const health = await g.hub.health(T1, done.connection!.id);
    expect(health.value!.report.score).toBeGreaterThanOrEqual(80);
    const off = await g.hub.disconnect(person("ana"), { tenantId: T1, connectionId: done.connection!.id });
    expect(off).toMatchObject({ ok: true, value: { revoked: true } });
    expect(g.google.revoked).toHaveLength(1);
    expect(g.vault.references()).toEqual([]);
  });
  it("is the same contract the simulated providers pass: the Hub treats Google and a simulated Outlook alike", async () => {
    const g = await googleWorld();
    const outlook = new SimulatedProvider({ ...manifest("outlook", { category: "email" }), capabilities: [{ id: "mail.search", label: "Buscar", kind: "read", external: false }, { id: "mail.send", label: "Enviar", kind: "write", external: true }] }, g.clock);
    expect(g.registry.register(outlook)).toEqual({ ok: true });
    expect(g.registry.byCapability("mail.search").map((row) => row.manifest.id).sort()).toEqual(["google-workspace", "outlook"]);
    expect((await connect(g, "outlook")).status).toBe("connected");
    expect((await run(g, worker("sales"), { capability: "mail.search" })).usedProvider).toBe("outlook");
  });
});

describe("the layer is new, provider-agnostic, and connects to nothing by itself", () => {
  const folder = join(process.cwd(), "lib/integrations/hub");
  const code = (name: string) => readFileSync(join(folder, name), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const core = ["integration-hub.ts", "integration-registry.ts", "integration-engine.ts", "integration-types.ts", "integration-events.ts", "integration-health.ts", "integration-retry.ts", "integration-rate-limit.ts", "integration-observability.ts"];
  it("has the nine files of the layer", () => {
    for (const name of core) expect(existsSync(join(folder, name)), name).toBe(true);
    expect(readdirSync(folder).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).sort()).toEqual([...core, "index.ts", "integration-providers.ts"].sort());
  });
  it("never names or imports a specific provider outside the providers file and the list of declared providers", () => {
    for (const name of core.filter((item) => item !== "integration-registry.ts")) {
      expect(code(name), name).not.toMatch(/google|gmail|outlook|stripe|whatsapp|slack|discord|shopify|hubspot|salesforce|makapay|paypal|tiktok|youtube|linkedin/i);
      expect(code(name), name).not.toMatch(/from "@\/lib\/(integrations\/google|contracts\/platform\/connectors)/);
    }
  });
  it("makes no network call, reads no environment, and imports no Backend Core, database, AI layer or other module", () => {
    for (const name of [...core, "integration-providers.ts", "index.ts"]) {
      expect(code(name), name).not.toMatch(/\bfetch\(|process\.env|XMLHttpRequest|WebSocket|node:https?/);
      expect(code(name), name).not.toMatch(/from "@\/lib\/(backend|db|ai|contracts\/platform\/(?!connectors))/);
    }
    expect([...code("integration-providers.ts").matchAll(/from "([^"]+)"/g)].map((row) => row[1]).filter((value) => value!.startsWith("@/")).sort()).toEqual(["@/lib/contracts/platform/connectors", "@/lib/integrations/google"]);
  });
});
