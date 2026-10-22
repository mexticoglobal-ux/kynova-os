import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Role } from "@/config/roles";
import { CONNECTORS, COMPANY_INTEGRATIONS_DICTIONARIES as D, EMPLOYEE_NEEDS, STATUSES, THRESHOLDS, companyHealth, createCompanyIntegrationsService, createMemoryIntegrationsStore, employeeCheck, levelOf, requirements, tr, totals, type Actor, type ConnectorDef, type HealthInput } from "@/platform/integrations";
import { ROSTER } from "@/modules/team";

const actor = (role: Role, tenantId = "t1"): Actor => ({ tenantId, userId: `${role}-1`, role });
const OWNER = actor("owner"), SALES = actor("sales"), SUPPORT = actor("support"), OTHER = actor("owner", "t2");
const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? `other:${(e as Error).message}`; } };
const LIVE: ConnectorDef[] = CONNECTORS.map((c) => ({ ...c, available: true }));
const svc = (catalog?: readonly ConnectorDef[]) => createCompanyIntegrationsService({ store: createMemoryIntegrationsStore(), ...(catalog ? { catalog } : {}), now: () => 5_000 });
const T = (k: Parameters<typeof tr>[1], v?: Record<string, number | string>) => tr("es", k, v);

describe("states", () => {
  it("only the five allowed states exist", () => expect([...STATUSES]).toEqual(["not_configured", "pending", "connected", "error", "coming_soon"]));
  it("every defined connector is honestly 'coming soon': nothing is connected, nothing has a sync date", async () => {
    const s = svc(), items = await s.list(OWNER);
    expect(items.map((i) => i.key)).toEqual(["google_business", "ga4", "search_console", "meta_business", "facebook_pages", "instagram_business", "google_calendar", "google_workspace", "shopify", "cloudflare", "makawallet"]);
    for (const i of items) expect(i).toMatchObject({ status: "coming_soon", health: "unknown", lastSyncAt: null, config: {} });
    expect(totals(await s.state(OWNER))).toMatchObject({ total: 11, available: 0, connected: 0 });
  });
  it("a connector with an adapter starts as not configured, becomes pending when configured, and connected/error only when an adapter reports it", async () => {
    const s = svc(LIVE); expect((await s.list(OWNER))[0]).toMatchObject({ status: "not_configured", health: "unknown" });
    expect(await s.configure(OWNER, "ga4", { config: { propertyId: "123" } })).toMatchObject({ status: "pending", config: { propertyId: "123" } });
    await s.report(OWNER, "ga4", "connected", 4_000); expect((await s.list(OWNER)).find((i) => i.key === "ga4")).toMatchObject({ status: "connected", health: "ok", lastSyncAt: 4_000 });
    await s.report(OWNER, "ga4", "error"); expect((await s.list(OWNER)).find((i) => i.key === "ga4")).toMatchObject({ status: "error", health: "error" });
  });
  it("cannot configure what does not exist yet, and rejects unknown or secret-looking fields", async () => {
    expect(await code(svc().configure(OWNER, "ga4", { config: { propertyId: "1" } }))).toBe("coming_soon"); expect(await code(svc().report(OWNER, "ga4", "connected"))).toBe("coming_soon");
    const s = svc(LIVE); expect(await code(s.configure(OWNER, "nope", { config: {} }))).toBe("not_found");
    for (const bad of [{ config: { apiToken: "x" } }, { config: { password: "x" } }, { config: { propertyId: "x".repeat(200) } }, { config: {}, extra: 1 }, {}]) expect(await code(s.configure(OWNER, "ga4", bad)), JSON.stringify(bad)).toBe("validation_failed");
  });
  it("stores no secret: the row has only declared identifiers and an empty credential reference", async () => {
    const store = createMemoryIntegrationsStore(), s = createCompanyIntegrationsService({ store, catalog: LIVE }); await s.configure(OWNER, "shopify", { config: { shopDomain: "x.myshopify.com" } });
    expect((await store.list("t1"))[0]).toMatchObject({ credentialRef: null, config: { shopDomain: "x.myshopify.com" } });
  });
  it("respects roles", async () => {
    const s = svc(LIVE); expect(await code(s.list(SALES))).toBe("ok"); expect(await code(s.configure(SALES, "ga4", { config: { propertyId: "1" } }))).toBe("forbidden"); expect(await code(s.list(SUPPORT))).toBe("forbidden");
  });
});

describe("multi-company", () => {
  it("each company keeps its own integrations and never sees another's", async () => {
    const s = svc(LIVE); await s.configure(OWNER, "ga4", { config: { propertyId: "A" } }); await s.report(OWNER, "ga4", "connected", 1);
    expect((await s.state(OTHER)).ga4).toBe("not_configured"); expect((await s.list(OTHER)).find((i) => i.key === "ga4")?.config).toEqual({});
    await s.configure(OTHER, "ga4", { config: { propertyId: "B" } }); expect((await s.list(OWNER)).find((i) => i.key === "ga4")).toMatchObject({ status: "connected", config: { propertyId: "A" } });
  });
  it("a new platform is one more definition: no framework code changes", async () => {
    const s = svc([...LIVE, { key: "tiktok", name: "TikTok", kind: "social", capabilities: ["read_posts"], fields: ["accountId"], available: true }]);
    expect((await s.configure(OWNER, "tiktok", { config: { accountId: "1" } })).status).toBe("pending"); expect(Object.keys(await s.state(OWNER))).toHaveLength(12);
  });
});

describe("Company Health (rules only, explainable)", () => {
  const empty: HealthInput = { profilePct: 0, dnaPct: 0, blueprintPct: 0, teamPct: 0, integrations: { available: 0, connected: 0, pending: 0 } };
  const full: HealthInput = { profilePct: 100, dnaPct: 100, blueprintPct: 100, teamPct: 100, integrations: { available: 11, connected: 11, pending: 0 } };
  it("a company with nothing is critical, and every area is listed as a loss", () => {
    const h = companyHealth(empty); expect(h).toMatchObject({ score: 0, level: "critical" }); expect(h.gaps.map((g) => g.key)).toEqual(["profile", "dna", "team", "blueprint"]);
    expect(h.parts.find((p) => p.key === "integrations")).toMatchObject({ pct: null, weight: 0 });
  });
  it("a fully configured company is excellent at 100% with no gaps", () => { expect(companyHealth(full)).toMatchObject({ score: 100, level: "excellent", gaps: [] }); });
  it("when no integration exists yet, its weight is shared and a complete company can still be excellent", () => { expect(companyHealth({ ...full, integrations: { available: 0, connected: 0, pending: 0 } })).toMatchObject({ score: 100, level: "excellent" }); });
  it("is explainable: points add up to the score and the biggest loss comes first", () => {
    const h = companyHealth({ profilePct: 100, dnaPct: 80, blueprintPct: 100, teamPct: 100, integrations: { available: 10, connected: 4, pending: 2 } });
    expect(h.parts.find((p) => p.key === "integrations")?.pct).toBe(50); expect(Math.round(h.parts.reduce((s, p) => s + p.points, 0))).toBe(h.score);
    expect(h.parts.reduce((s, p) => s + p.points + p.lost, 0)).toBeCloseTo(100, 5); expect(h.gaps[0]?.key).toBe("integrations"); expect(h.gaps.map((g) => g.lost)).toEqual([...h.gaps.map((g) => g.lost)].sort((a, b) => b - a));
    expect(h.score).toBe(Math.round(0.25 * 100 + 0.2 * 80 + 0.2 * 50 + 0.2 * 100 + 0.15 * 100));
  });
  it("levels follow fixed thresholds", () => {
    expect(THRESHOLDS.map(([l]) => l)).toEqual(["excellent", "healthy", "attention", "risk", "critical"]);
    for (const [s, l] of [[100, "excellent"], [90, "excellent"], [89, "healthy"], [75, "healthy"], [74, "attention"], [55, "attention"], [54, "risk"], [35, "risk"], [34, "critical"], [0, "critical"]] as const) expect(levelOf(s), String(s)).toBe(l);
  });
  it("garbage input is clamped, never trusted", () => { expect(companyHealth({ ...full, profilePct: 900, dnaPct: Number.NaN, teamPct: -5 }).parts.map((p) => p.pct)).toEqual([100, 0, 100, 0, 100]); });
});

describe("what other systems read", () => {
  it("requirements(): only 'connected' is ready; every other state is reported as it really is", () => {
    const st = { ga4: "connected", search_console: "pending", meta_business: "coming_soon", google_business: "error" } as const;
    expect(requirements(st, ["ga4"])).toEqual({ ready: true, missing: [] });
    expect(requirements(st, ["ga4", "search_console", "meta_business", "google_business", "shopify"]).missing).toEqual([{ key: "search_console", status: "pending" }, { key: "meta_business", status: "coming_soon" }, { key: "google_business", status: "error" }, { key: "shopify", status: "not_configured" }]);
    expect(requirements(null, ["ga4"])).toEqual({ ready: false, missing: [{ key: "ga4", status: "not_configured" }] });
  });
  it("every AI Employee that needs a platform checks first and is blocked until it is connected", () => {
    const none = Object.fromEntries(CONNECTORS.map((c) => [c.key, "coming_soon"])), all = Object.fromEntries(CONNECTORS.map((c) => [c.key, "connected"]));
    expect(employeeCheck(none as never, "seo_manager")).toEqual({ ready: false, missing: [{ key: "search_console", status: "coming_soon" }] });
    expect(employeeCheck(none as never, "marketing_manager").missing[0]?.key).toBe("meta_business"); expect(employeeCheck(none as never, "analytics_advisor").missing[0]?.key).toBe("ga4");
    expect(employeeCheck(none as never, "property_manager").ready).toBe(true);
    for (const k of Object.keys(EMPLOYEE_NEEDS)) { expect(employeeCheck(all as never, k).ready, k).toBe(true); expect(employeeCheck(none as never, k).ready, k).toBe(false); expect(ROSTER.some((r) => r.key === k), `${k} is a real roster key`).toBe(true); for (const n of EMPLOYEE_NEEDS[k]!) expect(CONNECTORS.some((c) => c.key === n), n).toBe(true); }
  });
});

describe("screens", () => {
  const src = (f: string) => readFileSync(`src/components/company-integrations/${f}`, "utf8");
  it("the table shows name, status, last sync, health, type and Configure; a missing integration says 'Disponible próximamente'", () => {
    const t = src("IntegrationsTable.tsx"); for (const k of ["col.name", "col.status", "col.sync", "col.health", "col.kind", "col.action"]) expect(t).toContain(k);
    expect(t).toContain("ConfigureButton"); expect(src("ConfigureButton.tsx")).toMatch(/disabled[\s\S]*configure\.soon/); expect(D.es["status.coming_soon"]).toBe("Disponible próximamente"); expect(D.es["status.not_configured"]).toBe("Sin configurar"); expect(D.es["status.pending"]).toBe("Pendiente");
  });
  it("Mission Control cards: real states with the colors asked for, and an explanation of the score", () => {
    const st = src("StatusCard.tsx"), hl = src("HealthCard.tsx"), tb = src("IntegrationsTable.tsx");
    expect(tb).toMatch(/connected: "🟢"[\s\S]*pending: "🟡"[\s\S]*error: "🔴"[\s\S]*not_configured: "⚪"/); expect(st).toContain("mc.none"); expect(hl).toContain("hl.explain"); expect(hl).toContain("hl.part");
    for (const l of ["excellent", "healthy", "attention", "risk", "critical"]) expect(D.es[`level.${l}` as keyof typeof D.es]).toBeTruthy(); expect(D.es["level.attention"]).toBe("Requiere atención");
  });
  it("Mission Control and the Business Profile page are wired to the framework", () => {
    const mc = readFileSync("src/app/(app)/app/mission-control/layout.tsx", "utf8"), bp = readFileSync("src/app/(app)/app/business-profile/page.tsx", "utf8"), ig = readFileSync("src/app/(app)/app/integrations/page.tsx", "utf8");
    expect(mc).toMatch(/IntegrationsStatusCard[\s\S]*HealthCard/); for (const a of ['id="perfil"', 'id="dna"', 'id="integraciones"', 'id="health"']) expect(bp).toContain(a); expect(ig).toContain("IntegrationsTable");
  });
});

describe("architecture and honesty", () => {
  const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  it("the framework depends on none of the systems that depend on it, and calls no provider", () => {
    const src = files("src/platform/integrations").filter((f) => !f.endsWith("i18n.ts")).map((f) => strip(readFileSync(f, "utf8"))).join("\n");
    expect(src).not.toMatch(/@\/modules\/|business-profile|blueprints|ai-employees|ai-kernel|realestate|real_estate/i); expect(src).not.toMatch(/\bfetch\(|oauth|authorize\?|@anthropic|openai|googleapis|stripe\b|cron|setInterval|schedule/i);
  });
  it("only the composition root meets the other systems", () => { const src = readFileSync("src/composition/company-health.ts", "utf8"); for (const m of ["blueprints", "ai-employees", "business-profile", "integrations"]) expect(src).toContain(m); });
  it("Spanish and English match, and nothing is simulated", () => {
    expect(Object.keys(D.es).sort()).toEqual(Object.keys(D.en).sort()); for (const k of Object.keys(D.es)) { expect(D.es[k as keyof typeof D.es], k).toBeTruthy(); expect(D.en[k as keyof typeof D.en], k).toBeTruthy(); }
    const ui = [...files("src/components/company-integrations"), ...files("src/platform/integrations")].map((f) => strip(readFileSync(f, "utf8"))).join("\n");
    expect(ui).not.toMatch(/test company|sample|fake|mock|simulat|lorem|ejemplo de datos/i);
  });
});
