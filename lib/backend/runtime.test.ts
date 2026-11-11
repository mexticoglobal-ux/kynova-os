import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SupabaseClientError, SupabaseClients, type ClientFactory } from "@/lib/db/core-clients";
import { generateEncryptionKey } from "./crypto";
import { loadConfig } from "./env";
import { BACKEND_MANIFEST, createBackendCore, koeView } from "./index";
import { ALLOWED_LABELS, Logger, MemoryLogSink, MemorySpanSink, Metrics, Tracer, formatTraceparent, parseTraceparent, runHealth, sanitize } from "./observability";
import { Lazy, Pool, TtlCache } from "./performance";
import { MemorySecretsProvider, SecretMissingError, SecretsManager, looksLikeSecret } from "./secrets";

const fake = (...parts: string[]) => parts.join("");
const JWT = fake("eyJ", "hbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", ".", "c2lnbmF0dXJlLXZhbHVlLXRlc3Q");

describe("logging", () => {
  it("hides credentials and personal data, replaces secret-looking strings, and limits depth and length", () => {
    const clean = sanitize({ user: "ana", password: "p", apiKey: "k", Authorization: "Bearer x", email: "a@b.co", note: `token ${JWT}`, nested: { cookie: "c", ok: 1, deep: { a: { b: { c: { d: 1 } } } } }, long: "x".repeat(900), list: [1, 2, 3] }) as Record<string, unknown>;
    expect(clean["password"]).toBe("[oculto]");
    expect(clean["apiKey"]).toBe("[oculto]");
    expect(clean["Authorization"]).toBe("[oculto]");
    expect(clean["email"]).toBe("[oculto]");
    expect(JSON.stringify(clean)).not.toContain(JWT);
    expect((clean["nested"] as Record<string, unknown>)["cookie"]).toBe("[oculto]");
    expect(JSON.stringify(clean["nested"])).toContain("[…]");
    expect((clean["long"] as string).length).toBeLessThan(510);
    expect(clean["user"]).toBe("ana");
  });

  it("keeps only what the level asks for, adds fields from its parents and never records a secret", () => {
    const sink = new MemoryLogSink();
    const logger = new Logger({ level: "info", sink, clock: () => "2026-11-07T00:00:00Z", base: { environment: "preview" } });
    logger.debug("no se guarda");
    logger.info("hola", { module: "billing" });
    logger.child({ requestId: "r1" }, { traceId: "t".repeat(32), spanId: "s".repeat(16) }).error(`falló con ${JWT}`, { password: "x" });
    expect(sink.entries).toHaveLength(2);
    expect(sink.entries[0]).toMatchObject({ level: "info", message: "hola", fields: { environment: "preview", module: "billing" } });
    expect(sink.entries[1]).toMatchObject({ level: "error", fields: { requestId: "r1", password: "[oculto]" }, traceId: "t".repeat(32) });
    expect(JSON.stringify(sink.entries)).not.toContain(JWT);
  });
});

describe("tracing", () => {
  it("reads and writes the W3C trace header, and refuses a broken one", () => {
    const header = `00-${"a".repeat(32)}-${"b".repeat(16)}-01`;
    expect(parseTraceparent(header)).toEqual({ traceId: "a".repeat(32), spanId: "b".repeat(16), sampled: true });
    expect(formatTraceparent({ traceId: "a".repeat(32), spanId: "b".repeat(16), sampled: false })).toBe(`00-${"a".repeat(32)}-${"b".repeat(16)}-00`);
    for (const bad of [null, undefined, "", "xx", `00-${"0".repeat(32)}-${"b".repeat(16)}-01`, `01-${"a".repeat(32)}-${"b".repeat(16)}-01`]) expect(parseTraceparent(bad)).toBeNull();
  });

  it("records a span with its timing, parent and cleaned attributes, and keeps or drops a whole trace together", async () => {
    let clock = 1_000;
    const sink = new MemorySpanSink();
    const tracer = new Tracer({ sample: 1, sink, now: () => clock, random: () => 0.5 });
    const root = tracer.start("request", { attributes: { route: "/api/v1/leads", token: "x" } });
    clock = 1_040;
    const child = tracer.start("query", { parent: root.context });
    clock = 1_100;
    child.end("ok");
    root.end("ok");
    expect(sink.spans.map((span) => span.name)).toEqual(["query", "request"]);
    expect(sink.spans[0]).toMatchObject({ parentId: root.context.spanId, durationMs: 60, status: "ok", traceId: root.context.traceId });
    expect(sink.spans[1]?.attributes).toMatchObject({ route: "/api/v1/leads", token: "[oculto]" });
    const off = new MemorySpanSink();
    const quiet = new Tracer({ sample: 0, sink: off });
    quiet.start("x").end();
    expect(off.spans).toEqual([]);
    const follows = new Tracer({ sample: 0, sink }).start("y", { parent: { traceId: "c".repeat(32), spanId: "d".repeat(16), sampled: true } });
    expect(follows.context.sampled).toBe(true); // the decision of the trace's first service is followed
  });

  it("ends a traced task with its error status and rethrows", async () => {
    const sink = new MemorySpanSink();
    const tracer = new Tracer({ sample: 1, sink });
    expect(await tracer.trace("ok", () => 7)).toBe(7);
    await expect(tracer.trace("falla", () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(sink.spans.map((span) => span.status)).toEqual(["ok", "error"]);
  });
});

describe("health checks", () => {
  const check = (name: string, status: "ok" | "degraded" | "down", critical = false) => ({ name, critical, run: async () => ({ status, detail: name }) });

  it("is ok, degraded or down, and only a critical check that is down takes the whole service down", async () => {
    expect((await runHealth([check("a", "ok"), check("b", "ok")])).status).toBe("ok");
    expect((await runHealth([check("a", "ok"), check("b", "degraded")])).status).toBe("degraded");
    expect((await runHealth([check("a", "ok"), check("b", "down")])).status).toBe("degraded");
    expect((await runHealth([check("a", "ok"), check("b", "down", true)])).status).toBe("down");
    const report = await runHealth([check("a", "ok")], { clock: () => "T" });
    expect(report).toMatchObject({ at: "T", checks: [{ name: "a", status: "ok", critical: false }] });
  });

  it("turns a slow or failing check into down, and never exposes its error message", async () => {
    const report = await runHealth([
      { name: "slow", critical: false, timeoutMs: 20, run: () => new Promise(() => undefined) },
      { name: "boom", critical: false, run: async () => { throw new Error("password=hunter2 at db.internal:5432"); } },
    ]);
    expect(report.checks.map((item) => [item.name, item.status, item.detail])).toEqual([["slow", "down", "tiempo agotado"], ["boom", "down", "la comprobación falló"]]);
    expect(JSON.stringify(report)).not.toContain("hunter2");
  });
});

describe("metrics", () => {
  it("counts, sets and measures, and keeps series apart by their labels", () => {
    const metrics = new Metrics();
    metrics.inc("kynova_requests_total", { module: "crm", outcome: "ok" });
    metrics.inc("kynova_requests_total", { module: "crm", outcome: "ok" }, 2);
    metrics.inc("kynova_requests_total", { module: "crm", outcome: "error" });
    metrics.set("kynova_pool_idle", 3, { check: "supabase" });
    metrics.observe("kynova_latency_ms", 30, { route: "/api" });
    metrics.observe("kynova_latency_ms", 700, { route: "/api" });
    const snapshot = metrics.snapshot();
    expect(snapshot.find((item) => item.labels.outcome === "ok")?.value).toBe(3);
    expect(snapshot.find((item) => item.labels.outcome === "error")?.value).toBe(1);
    const histogram = snapshot.find((item) => item.kind === "histogram");
    expect(histogram).toMatchObject({ sum: 730, count: 2 });
    expect(metrics.render()).toContain('kynova_requests_total{module="crm",outcome="ok"} 3');
    expect(metrics.render()).toContain("kynova_latency_ms_count");
  });

  it("never lets a company or a person become a label, and refuses a bad name or a negative count", () => {
    const metrics = new Metrics();
    expect(() => metrics.inc("kynova_requests_total", { tenantId: "t1" } as never)).toThrow(/no está permitida/);
    expect(() => metrics.inc("kynova_requests_total", { userId: "u1" } as never)).toThrow();
    expect(() => metrics.inc("requests")).toThrow(/no válido/);
    expect(() => metrics.inc("kynova_requests_total", {}, -1)).toThrow(/solo sube/);
    expect([...ALLOWED_LABELS]).not.toEqual(expect.arrayContaining(["tenant", "tenantId", "user", "userId", "email"]));
  });

  it("hands out copies, so a reader cannot change the numbers", () => {
    const metrics = new Metrics();
    metrics.inc("kynova_requests_total");
    const first = metrics.snapshot();
    (first[0] as { value: number }).value = 99;
    expect(metrics.snapshot()[0]?.value).toBe(1);
  });
});

describe("performance", () => {
  it("initializes lazily, once, even when many ask at the same time, and tries again after a failure", async () => {
    const factory = vi.fn(async () => ({ ready: true }));
    const lazy = new Lazy(factory);
    expect(lazy.initialized).toBe(false);
    expect(factory).not.toHaveBeenCalled();
    const [a, b, c] = await Promise.all([lazy.get(), lazy.get(), lazy.get()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(lazy.initialized).toBe(true);
    let attempts = 0;
    const flaky = new Lazy(async () => { attempts += 1; if (attempts === 1) throw new Error("falló"); return "ok"; });
    await expect(flaky.get()).rejects.toThrow("falló");
    expect(await flaky.get()).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("creates pool connections on demand, never above the limit, and shares them in turn", async () => {
    let id = 0;
    const destroyed: number[] = [];
    const pool = new Pool<number>({ create: () => (id += 1), destroy: (item) => void destroyed.push(item), max: 2, acquireTimeoutMs: 500 });
    expect(pool.stats()).toMatchObject({ size: 0, created: 0 }); // nothing is created until it is asked for
    const first = await pool.acquire();
    const second = await pool.acquire();
    expect(pool.stats()).toMatchObject({ busy: 2, created: 2 });
    const third = pool.acquire(); // waits: the limit is 2
    await Promise.resolve();
    expect(pool.stats().waiting).toBe(1);
    pool.release(first);
    expect(await third).toBe(first); // handed straight to the one who waited
    pool.release(second);
    expect(pool.stats()).toMatchObject({ idle: 1, busy: 1, created: 2 });
    await pool.drain();
    expect(destroyed).toEqual([second]);
    await expect(pool.acquire()).rejects.toThrow(/cerrado/);
  });

  it("gives up waiting for a connection, recycles one that is no longer valid and always gives back what it lent", async () => {
    const pool = new Pool<{ ok: boolean }>({ create: () => ({ ok: true }), validate: (item) => item.ok, max: 1, acquireTimeoutMs: 20 });
    const held = await pool.acquire();
    await expect(pool.acquire()).rejects.toThrow(/a tiempo/);
    pool.release(held);
    held.ok = false;
    const fresh = await pool.acquire();
    expect(fresh).not.toBe(held); // the broken one was dropped
    pool.release(fresh);
    await expect(pool.use(() => { throw new Error("x"); })).rejects.toThrow("x");
    expect(pool.stats()).toMatchObject({ busy: 0, idle: 1 });
  });

  it("caches by company: it expires, evicts the oldest and never mixes two companies", () => {
    let clock = 0;
    const cache = new TtlCache<string>({ ttlMs: 100, maxEntries: 3, now: () => clock });
    cache.set("a", "plan", "pro");
    cache.set("b", "plan", "starter");
    expect(cache.get("a", "plan")).toBe("pro");
    expect(cache.get("b", "plan")).toBe("starter");
    expect(cache.get("c", "plan")).toBeUndefined();
    clock = 101;
    expect(cache.get("a", "plan")).toBeUndefined(); // expired
    clock = 0;
    cache.set("a", "k1", "1");
    cache.set("a", "k2", "2");
    cache.set("a", "k3", "3"); // over the limit: the oldest goes
    expect(cache.stats().evictions).toBe(1);
    expect(cache.get("b", "plan")).toBeUndefined();
    expect(() => cache.get("", "x")).toThrow(/exige una empresa/);
  });

  it("drops everything of one company without touching another's", () => {
    const cache = new TtlCache<number>({ ttlMs: 1_000, maxEntries: 50 });
    for (const key of ["x", "y", "z"]) { cache.set("a", key, 1); cache.set("b", key, 2); }
    expect(cache.invalidateTenant("a")).toBe(3);
    expect(cache.get("a", "x")).toBeUndefined();
    expect(cache.get("b", "x")).toBe(2);
    cache.invalidate("b", "x");
    expect(cache.get("b", "x")).toBeUndefined();
    expect(cache.get("b", "y")).toBe(2);
    expect(cache.stats()).toMatchObject({ hits: 2 });
  });
});

describe("the Supabase connection", () => {
  const vars = { KYNOVA_ENV: "preview", SUPABASE_URL: "https://project.supabase.co", SUPABASE_PUBLISHABLE_KEY: "p".repeat(30), SUPABASE_SERVICE_ROLE_KEY: fake("svc", "z".repeat(30)) };
  const setup = (over: Partial<typeof vars> = {}, server = true) => {
    const made: { url: string; key: string; options?: Record<string, unknown> }[] = [];
    const factory = vi.fn((url: string, key: string, options?: Record<string, unknown>) => { made.push({ url, key, options }); return { from: vi.fn() }; }) as unknown as ClientFactory;
    const loader = vi.fn(async () => factory);
    const config = loadConfig({ ...vars, ...over });
    const serviceKey = "SUPABASE_SERVICE_ROLE_KEY" in over ? over.SUPABASE_SERVICE_ROLE_KEY : vars.SUPABASE_SERVICE_ROLE_KEY;
    const secrets = new SecretsManager(new MemorySecretsProvider(serviceKey ? { SUPABASE_SERVICE_ROLE_KEY: serviceKey } : {}));
    return { clients: new SupabaseClients(config, secrets, loader, () => server), loader, made, secrets };
  };

  it("loads nothing and connects to nothing until a client is asked for", async () => {
    const { clients, loader } = setup();
    expect(clients.isConfigured()).toBe(true);
    expect(clients.describe()).toMatchObject({ configured: true, host: "project.supabase.co", publishableClientCreated: false, serviceClientCreated: false });
    expect(loader).not.toHaveBeenCalled();
    await clients.publishableClient();
    await clients.publishableClient();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(clients.describe().publishableClientCreated).toBe(true);
  });

  it("builds the publishable client with no session of its own", async () => {
    const { clients, made } = setup();
    await clients.publishableClient();
    expect(made[0]).toMatchObject({ url: "https://project.supabase.co", key: "p".repeat(30), options: { auth: { persistSession: false, autoRefreshToken: false } } });
  });

  it("uses the service key only on the server, only when it exists, and only through the Secrets Manager", async () => {
    const browser = setup({}, false);
    await expect(browser.clients.serviceClient()).rejects.toThrow(/nunca se usa en el navegador/);
    expect(browser.loader).not.toHaveBeenCalled();
    const server = setup();
    await server.clients.serviceClient();
    expect(server.made[0]?.key).toBe(vars.SUPABASE_SERVICE_ROLE_KEY);
    expect(server.secrets.accessLog()).toEqual([expect.objectContaining({ name: "SUPABASE_SERVICE_ROLE_KEY", purpose: "cliente de servicio del Backend Core" })]);
    expect(JSON.stringify(server.secrets.accessLog())).not.toContain(vars.SUPABASE_SERVICE_ROLE_KEY);
    const noKey = setup({ SUPABASE_SERVICE_ROLE_KEY: "" });
    await expect(noKey.clients.serviceClient()).rejects.toBeInstanceOf(SecretMissingError);
  });

  it("says plainly when Supabase is not configured, and never prints a key", async () => {
    const config = loadConfig({});
    const clients = new SupabaseClients(config, new SecretsManager(new MemorySecretsProvider({})), vi.fn() as never);
    expect(clients.isConfigured()).toBe(false);
    await expect(clients.publishableClient()).rejects.toBeInstanceOf(SupabaseClientError);
    const { clients: ready } = setup();
    expect(JSON.stringify(ready.describe())).not.toContain("p".repeat(30));
    expect(JSON.stringify(ready.describe())).not.toContain(vars.SUPABASE_SERVICE_ROLE_KEY);
  });
});

describe("the assembled Backend Core", () => {
  const production = () => ({ KYNOVA_ENV: "production", SUPABASE_URL: "https://project.supabase.co", SUPABASE_PUBLISHABLE_KEY: "p".repeat(30), KYNOVA_ENCRYPTION_KEY: generateEncryptionKey(), KYNOVA_HASH_PEPPER: "h".repeat(40) });

  it("creates every piece only when it is first used", async () => {
    const core = createBackendCore({ vars: {} });
    expect(core.initialized()).toEqual({ events: false, audit: false, clients: false, metrics: false, cache: false });
    const bus = await core.events();
    expect(core.initialized().events).toBe(true);
    expect(core.initialized().audit).toBe(false);
    expect(bus.subscribers()).toBe(0); // nothing consumes yet
    await core.audit();
    expect(await core.events()).toBe(bus); // the same one every time
  });

  it("reports its health: fine when complete, degraded in development, and down in production when something critical is missing", async () => {
    const complete = await createBackendCore({ vars: production() }).health();
    expect(complete.status).toBe("ok");
    expect(complete.checks.map((item) => item.name)).toEqual(["environment", "secrets", "supabase", "rls", "storage"]);
    expect(complete.checks.find((item) => item.name === "rls")?.detail).toBe("preparado, no activado");
    const development = await createBackendCore({ vars: {} }).health();
    expect(development.status).toBe("degraded");
    const broken = await createBackendCore({ vars: { KYNOVA_ENV: "production" } }).health();
    expect(broken.status).toBe("down");
    expect(JSON.stringify(broken)).not.toContain(production().KYNOVA_HASH_PEPPER);
  });

  it("gives KOE a read-only view: it can read events, the audit trail, the contracts and the health, and nothing else", async () => {
    const core = createBackendCore({ vars: production(), clock: () => "2026-11-07T12:00:00.000Z" });
    (await core.events()).publish({ type: "crm.lead.created", module: "crm", tenantId: "tenant-nova", actor: "carla", payload: { leadId: "1", source: "web" } });
    (await core.events()).publish({ type: "crm.lead.created", module: "crm", tenantId: "tenant-vida", actor: "lucia", payload: { leadId: "9", source: "web" } });
    await (await core.audit()).record({ tenantId: "tenant-nova", actorId: "ana", actorKind: "person", module: "billing", action: "plan.change", category: "plan", outcome: "success", at: "2026-11-07T12:00:00.000Z" });
    const koe = koeView(core);
    expect((await koe.readEvents("tenant-nova")).map((item) => item.payload["leadId"])).toEqual(["1"]); // one company at a time
    expect((await koe.readAudit("tenant-nova")).length).toBe(1);
    expect((await koe.readAudit("tenant-vida")).length).toBe(0);
    expect(await koe.verifyAudit("tenant-nova")).toEqual({ ok: true, records: 1 });
    expect(koe.entities.length).toBeGreaterThan(30);
    expect((await koe.health()).status).toBe("ok");
    expect(Object.keys(koe).sort()).toEqual(["entities", "environment", "health", "readAudit", "readEvents", "verifyAudit"]);
  });

  it("lists every piece of the Backend Core, with the file that holds it", () => {
    expect(BACKEND_MANIFEST.map((item) => item.id)).toEqual(["supabase", "auth", "organization", "rls", "database", "storage", "events", "audit", "environment", "security", "performance", "observability", "integration", "koe"]);
    for (const item of BACKEND_MANIFEST) expect(existsSync(join(process.cwd(), item.file)), item.file).toBe(true);
    expect(BACKEND_MANIFEST.filter((item) => item.status === "prepared").map((item) => item.id)).toEqual(["supabase", "auth", "rls", "database", "storage", "observability"]);
  });
});

// ---------------------------------------------------------------- the rules of this sprint, kept by tests
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".open-next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const ROOT = process.cwd();
const rel = (file: string) => relative(ROOT, file).split("\\").join("/");
const isTest = (file: string) => /\.test\.(ts|tsx)$/.test(file);
const source = ["app", "components", "lib", "config"].flatMap((dir) => walk(join(ROOT, dir))).filter((file) => /\.(ts|tsx)$/.test(file) && !isTest(file));
const text = (file: string) => readFileSync(file, "utf8");

describe("the rules of the Backend Core", () => {
  it("keeps no secret in the code: nothing in the source, the migrations or the seed looks like one", () => {
    const files = [...source, ...walk(join(ROOT, "supabase")).filter((file) => /\.sql$/.test(file)), ...walk(join(ROOT, "docs")).filter((file) => /\.md$/.test(file))];
    const found = files.filter((file) => looksLikeSecret(text(file))).map(rel);
    expect(found).toEqual([]);
  });

  it("connects to no outside provider: the Backend Core has no network call and names no AI, payment or messaging service", () => {
    const core = [...walk(join(ROOT, "lib", "backend")), join(ROOT, "lib", "db", "core-clients.ts")].filter((file) => file.endsWith(".ts") && !isTest(file));
    expect(core.length).toBeGreaterThan(10);
    for (const file of core) {
      const code = text(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, rel(file)).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|node:https?|node:net/);
      expect(code, rel(file)).not.toMatch(/\b(openai|anthropic|claude|gemini|stripe|twilio|whatsapp|gmail|outlook|googleapis|sendgrid|paypal)\b/i);
    }
  });

  it("adds no migration besides the Backend Core Integration one, and no dependency: the migrations are the six that existed plus 20261110000100", () => {
    expect(readdirSync(join(ROOT, "supabase", "migrations")).sort()).toEqual([
      "20261031000000_tenancy_core.sql", "20261102000000_upgrade_disposable_tenancy.sql", "20261106000100_backend_foundations.sql",
      "20261106000200_crm_core.sql", "20261106000300_messaging_and_governance.sql", "20261106000400_business_functions.sql", "20261110000100_backend_integration.sql",
    ]);
  });

  it("has nothing that consumes the events yet: no module subscribes, and KOE does not import the Backend Core", () => {
    const subscribers = source.filter((file) => /\.subscribe\(/.test(text(file))).map(rel);
    expect(subscribers).toEqual([]);
    const koe = source.filter((file) => /koe-/.test(rel(file)));
    for (const file of koe) expect(text(file), rel(file)).not.toContain("lib/backend");
  });

  it("keeps the modules as they were: none of them imports the Backend Core yet", () => {
    const importers = source.filter((file) => !rel(file).startsWith("lib/backend/") && rel(file) !== "lib/db/core-clients.ts" && !rel(file).startsWith("lib/ai/") && /from "@\/lib\/backend/.test(text(file))).map(rel);
    expect(importers).toEqual(["lib/db/core-clients.ts"].filter(() => false));
  });

  it("builds the Supabase client for the core in one place only", () => {
    const owners = source.filter((file) => /@supabase\/supabase-js"\)/.test(text(file)) && /createClient/.test(text(file))).map(rel);
    expect(owners).toContain("lib/db/core-clients.ts");
  });
});
