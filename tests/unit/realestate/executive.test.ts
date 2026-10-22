import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REALESTATE_DICTIONARIES } from "../../../src/modules/realestate/i18n";
import { MINUTES_EACH } from "../../../src/modules/realestate/executive";
import { knowledge } from "../../../src/platform/business-profile/knowledge";
import { DAY, OTHER, OWNER, SUPPORT, code, harness, house } from "./helpers";

const LONG = "Casa amplia y luminosa con jardín, cerca de comercios y colegios, lista para estrenar.";
const buyer = (o: Record<string, unknown> = {}) => ({ name: "Ana", intent: "sale", budgetMaxMinor: 30_000_000, zones: ["Escazú"], phone: "8888-8888", ...o });

describe("Executive intelligence · Real Estate", () => {
  it("an empty company gets an honest empty brief: nothing invented", async () => {
    const h = harness(), e = await h.svc.executive(OWNER);
    expect(e.engine).toBe("rules"); expect(e.ai).toBe(false); expect(e.summary).toEqual([]); expect(e.ceo).toEqual({ today: [], priority: null, opportunity: null, risk: null });
    expect(e.insights).toMatchObject({ potential: null, risk: null, opportunity: null, activity: null, drop: null, growth: null }); expect(e.forecast).toBeNull(); expect(e.trends).toEqual([]);
    expect(e.timeSaved.total.minutes).toBe(0); expect(e.value).toEqual({ opportunities: 0, followups: 0, publications: 0, matchings: 0 }); expect(e.ranking).toEqual({ buyers: [], owners: [], properties: [] });
  });
  it("the CEO answers from the open work, each with a confidence and the reasons behind it", async () => {
    const h = harness(); await h.svc.createBuyer(OWNER, buyer()); await h.svc.createProperty(OWNER, house({ description: LONG, address: "Calle 1" }));
    const e = await h.svc.executive(OWNER);
    expect(e.ceo.priority).toMatchObject({ kind: "action", code: "buyer_matches", employee: "buyer_specialist" }); expect(e.ceo.today.length).toBeGreaterThan(0);
    const c = e.ceo.priority!.confidence; expect(c.pct).toBeGreaterThan(50); expect(c.pct).toBeLessThan(100); expect(c.signals.some((s) => s.code === "strong_match")).toBe(true);
    expect(e.ceo.opportunity).toMatchObject({ kind: "opportunity" }); expect(e.summary.map((s) => s.key)).toEqual(expect.arrayContaining(["w_matches", "w_drafts"]));
  });
  it("ranks buyers, owners and properties with level, heat and the reasons", async () => {
    const h = harness(); const hot = await h.svc.createBuyer(OWNER, buyer({ name: "Hot" })); await h.svc.updateBuyer(OWNER, hot.id, { stage: "negotiating" }); await h.svc.createBuyer(OWNER, buyer({ name: "Cold", zones: ["Limón"] }));
    await h.svc.createOwner(OWNER, { name: "Luis", phone: "1" }); await h.svc.createProperty(OWNER, house());
    const r = (await h.svc.executive(OWNER)).ranking; expect(r.buyers[0]).toMatchObject({ name: "Hot", level: "high", heat: "hot" }); expect(r.buyers[0]!.reasons.map((x) => x.code)).toContain("stage_negotiating");
    expect(r.buyers.every((b) => b.name !== "Cold" || b.level === "low")).toBe(true); expect(r.properties[0]!.heat).toMatch(/hot|warm|cold/); expect(r.owners[0]!.confidence.signals.length).toBeGreaterThan(0);
  });
  it("detects the biggest risk (a stale listing with no visits) and a hot buyer going idle", async () => {
    const h = harness(); const p = await h.svc.createProperty(OWNER, house({ title: "Vieja" })); const b = await h.svc.createBuyer(OWNER, buyer({ name: "Hot" })); await h.svc.updateBuyer(OWNER, b.id, { stage: "negotiating" });
    h.clock.t += 40 * DAY; const e = await h.svc.executive(OWNER);
    expect(e.insights.risk).toMatchObject({ kind: "risk" }); expect(["risk_stale", "risk_hot_idle"]).toContain(e.insights.risk!.code);
    const stale = (await h.svc.executive(OWNER)).ceo.risk; expect(stale!.confidence.signals.length).toBeGreaterThan(0); expect(p.id).toBeTruthy();
  });
  it("trends compare 7 days with the 7 before, forecast shows its formula inputs, and the weekly report counts real facts", async () => {
    const h = harness(); const p = await h.svc.createProperty(OWNER, house({ description: LONG }));
    h.clock.t += 10 * DAY; await h.svc.updateProperty(OWNER, p.id, { status: "sold", closedPriceMinor: 24_000_000 }); await h.svc.createBuyer(OWNER, buyer({ zones: [] }));
    const e = await h.svc.executive(OWNER);
    expect(e.forecast).toMatchObject({ count: 1, windowDays: 28, horizonDays: 30, projected: 1.1 }); expect(e.forecast!.confidence.pct).toBeLessThan(100);
    const row = (k: string) => e.weekly.rows.find((r) => r.key === k)!; expect(row("closings")).toMatchObject({ cur: 1, prev: 0 }); expect(row("buyers")).toMatchObject({ cur: 1, prev: 0 }); expect(row("properties")).toMatchObject({ cur: 0, prev: 1 });
    expect(e.trends.find((t) => t.metric === "closings")).toMatchObject({ direction: "up" }); expect(e.insights.growth).toBeTruthy();
    expect(e.weekly.conversionPct).toBe(0);
  });
  it("time saved is an estimate built from the work that exists, accumulated and for the last 24 hours", async () => {
    const h = harness(); await h.svc.createBuyer(OWNER, buyer()); await h.svc.createProperty(OWNER, house({ description: LONG }));
    let e = await h.svc.executive(OWNER); const m = MINUTES_EACH.buyer_matching + MINUTES_EACH.publication; expect(e.timeSaved.estimated).toBe(true);
    expect(e.timeSaved.last24h.minutes).toBeGreaterThanOrEqual(m); expect(e.value).toMatchObject({ publications: 5, matchings: 1 });
    h.clock.t += 3 * DAY; e = await h.svc.executive(OWNER); expect(e.timeSaved.last24h.minutes).toBeLessThan(e.timeSaved.total.minutes); expect(e.timeSaved.total.minutes).toBeGreaterThanOrEqual(m);
  });
  it("is isolated by company and respects roles; computing it writes nothing", async () => {
    const h = harness(); await h.svc.createBuyer(OWNER, buyer()); await h.svc.createProperty(OWNER, house());
    expect((await h.svc.executive(OTHER)).value.matchings).toBe(0); expect(await code(h.svc.executive(SUPPORT))).toBe("forbidden");
    const n = h.events.length, items = (await h.svc.listWorkflowItems(OWNER)).length; await h.svc.executive(OWNER); await h.svc.executive(OWNER); expect(h.events.length).toBe(n); expect((await h.svc.listWorkflowItems(OWNER)).length).toBe(items);
  });
  it("every text the UI needs exists in both languages, and the adapter is pure", () => {
    const es = REALESTATE_DICTIONARIES.es, src = readFileSync("src/modules/realestate/executive.ts", "utf8");
    for (const m of src.matchAll(/sig\("([a-z_0-9]+)"/g)) expect(es[`ex.s.${m[1]}` as keyof typeof es], m[1]).toBeTruthy();
    for (const m of readFileSync("src/modules/realestate/scores.ts", "utf8").matchAll(/\["([a-z_]+)", /g)) if (m[1] !== "media") expect(es[`ex.r.${m[1]}` as keyof typeof es], m[1]).toBeTruthy();
    for (const k of ["clients", "captation", "activity", "closings", "properties", "buyers", "matching", "followups", "publications"]) expect(es[`ex.m.${k}` as keyof typeof es]).toBeTruthy();
    expect(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")).not.toMatch(/Date\.now|new Date\(|fetch\(|Math\.random|process\.env/);
  });
});

describe("The CEO AI uses the Business Profile as context (rules, no AI)", () => {
  const basics = { name: "NOVA", industry: "real_estate", country: "CR", locale: "es", currency: "CRC", timezone: "UTC" };
  const profile = (o: Record<string, unknown> = {}) => ({ tenantId: "t1", logoUrl: "https://a.co/l.png", website: "https://a.co", socials: { x: "@a" }, email: "a@a.co", phone: "+506 1111 1111", location: "CR", basicsConfirmedAt: 1, updatedBy: "u", createdAt: 1, updatedAt: 1, ...o });
  const dna = (o: Record<string, unknown> = {}) => ({ tenantId: "t1", objectives: ["x"], valueProposition: "v", customerType: "c", tone: "t", industries: ["i"], products: ["p"], services: ["s"], competitors: ["c"], keywords: ["k"], priorities: [] as string[], updatedBy: "u", createdAt: 1, updatedAt: 1, ...o });
  const seed = async (h: ReturnType<typeof harness>) => { const b = await h.svc.createBuyer(OWNER, buyer()); await h.svc.createProperty(OWNER, house({ description: LONG })); return b; };

  it("without any profile source nothing changes; with an empty profile the CEO asks to complete it, naming what is missing", async () => {
    const a = harness(); await seed(a); expect((await a.svc.executive(OWNER)).context).toBeNull(); expect((await a.svc.executive(OWNER)).ceo.today.some((f) => f.code === "profile_incomplete")).toBe(false);
    const b = harness({ bp: knowledge(basics, null, null) }); await seed(b); const e = await b.svc.executive(OWNER), f = e.ceo.today.find((x) => x.code === "profile_incomplete");
    expect(e.context).toMatchObject({ profilePct: 9, dnaPct: 0 }); expect(String(f?.params.missing)).toContain("profile.logo"); expect(f?.params).toMatchObject({ profile: 9, dna: 0 });
  });
  it("a complete profile adds no nagging and no missing information", async () => {
    const h = harness({ bp: knowledge(basics, profile(), dna({ priorities: ["sales"] })) }); await seed(h); const e = await h.svc.executive(OWNER);
    expect(e.context).toMatchObject({ profilePct: 100, dnaPct: 100, pending: [] }); expect(e.ceo.today.some((f) => f.code === "profile_incomplete")).toBe(false); expect(e.ceo.today.every((f) => !f.needs)).toBe(true);
  });
  it("a priority chosen in the Business DNA lifts the work that serves it and shows up as evidence in the confidence", async () => {
    const plain = harness({ bp: knowledge(basics, profile(), dna({ priorities: [] })) }); await seed(plain);
    const pri = harness({ bp: knowledge(basics, profile(), dna({ priorities: ["sales"] })) }); await seed(pri);
    const a = (await plain.svc.executive(OWNER)).ceo.priority!, b = (await pri.svc.executive(OWNER)).ceo.priority!;
    expect(a.code).toBe("buyer_matches"); expect(b.points).toBe(a.points + 50); expect(a.confidence.signals.some((s) => s.code === "dna_priority")).toBe(false); expect(b.confidence.signals.find((s) => s.code === "dna_priority")?.met).toBe(true);
    const other = harness({ bp: knowledge(basics, profile(), dna({ priorities: ["brand"] })) }); await seed(other); expect((await other.svc.executive(OWNER)).ceo.priority!.confidence.signals.find((s) => s.code === "dna_priority")?.met).toBe(false);
  });
  it("a recommendation that needs information the company has not registered lists exactly that, never inventing it", async () => {
    const h = harness({ bootstrap: true, bp: knowledge(basics, profile({ website: "", location: "" }), dna({ tone: "", keywords: [] })) }); await h.svc.createProperty(OWNER, house({ description: LONG })); await h.svc.sweep(OWNER);
    const e = await h.svc.executive(OWNER), all = [...e.ceo.today], content = all.find((f) => f.code === "growth_content"), local = all.find((f) => f.code === "growth_local");
    expect(content?.needs).toEqual(["dna.tone", "dna.keywords"]); expect(local?.needs).toEqual(["profile.website", "profile.location", "dna.keywords"]);
  });
});

describe("The CEO AI consults the Company Integrations Framework (rules, no AI)", () => {
  const seed = async (h: ReturnType<typeof harness>) => { await h.svc.createProperty(OWNER, house({ description: LONG })); await h.svc.sweep(OWNER); };
  const none = { search_console: "coming_soon", ga4: "coming_soon", google_business: "coming_soon" } as const;
  it("without the framework nothing is claimed about any platform (backward compatible)", async () => {
    const h = harness({ bootstrap: true }); await seed(h); const e = await h.svc.executive(OWNER);
    expect(e.integrations).toBeNull(); expect(e.ceo.today.every((f) => !f.blocked)).toBe(true);
  });
  it("with nothing connected it says exactly which platforms are missing, in their real state, and blocks what needs them", async () => {
    const h = harness({ bootstrap: true, ig: { ...none, google_business: "pending" } }); await seed(h); const e = await h.svc.executive(OWNER);
    expect(e.integrations).toEqual(["search_console:coming_soon", "ga4:coming_soon", "google_business:pending"]);
    expect(e.ceo.today.find((f) => f.code === "growth_content")?.blocked).toEqual(["search_console:coming_soon"]); expect(e.ceo.today.find((f) => f.code === "growth_local")?.blocked).toEqual(["google_business:pending"]);
  });
  it("when the platforms are connected nothing is blocked", async () => {
    const h = harness({ bootstrap: true, ig: { search_console: "connected", ga4: "connected", google_business: "connected" } }); await seed(h); const e = await h.svc.executive(OWNER);
    expect(e.integrations).toEqual([]); expect(e.ceo.today.every((f) => !f.blocked)).toBe(true);
  });
  it("the sentences exist in both languages and say it plainly", () => {
    const d = REALESTATE_DICTIONARIES; expect(d.es["ex.ig.search_console"]).toMatch(/No puedo recomendar mejoras SEO porque Search Console no está conectado/); expect(d.es["ex.ig.ga4"]).toMatch(/No existen métricas de Analytics/); expect(d.es["ex.ig.google_business"]).toMatch(/Google Business todavía no está configurado/);
    for (const k of ["ex.blocked", "ex.ig.search_console", "ex.ig.ga4", "ex.ig.google_business"] as const) expect(d.en[k]).toBeTruthy();
  });
});
