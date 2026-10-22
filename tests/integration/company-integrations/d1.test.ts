import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONNECTORS, createCompanyIntegrationsService, createD1IntegrationsStore, type Actor } from "../../../src/platform/integrations";
import { createTestDb, newCompany, newUser } from "../db/helpers";

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => { t = await createTestDb(); }, 60_000);
afterAll(async () => { await t.dispose(); });
const fresh = async (): Promise<Actor> => { const u = await newUser(t.db), c = await newCompany(t.db, u.id); return { tenantId: c.companyId, userId: u.id, role: "owner" }; };
const svc = () => createCompanyIntegrationsService({ store: createD1IntegrationsStore(t.d1), catalog: CONNECTORS.map((c) => ({ ...c, available: true })) });

describe("Company Integrations on D1", () => {
  it("round-trips configuration and adapter reports", async () => {
    const a = await fresh(), s = svc(); await s.configure(a, "search_console", { config: { siteUrl: "https://kynova.example" } }); await s.report(a, "search_console", "connected", 1234);
    expect((await s.list(a)).find((i) => i.key === "search_console")).toMatchObject({ status: "connected", lastSyncAt: 1234, config: { siteUrl: "https://kynova.example" } });
  });
  it("two companies never see each other's integrations", async () => {
    const a = await fresh(), b = await fresh(), s = svc(); await s.configure(a, "ga4", { config: { propertyId: "1" } });
    expect((await s.state(b)).ga4).toBe("not_configured"); expect((await s.list(b)).find((i) => i.key === "ga4")?.config).toEqual({});
  });
  it("rows cannot be deleted, an invalid state is refused, and a row needs a real company", async () => {
    const a = await fresh(); await svc().configure(a, "ga4", { config: { propertyId: "1" } });
    await expect(t.d1.prepare("DELETE FROM ci_integrations WHERE tenant_id = ?").bind(a.tenantId).run()).rejects.toThrow();
    await expect(t.d1.prepare("UPDATE ci_integrations SET status = 'coming_soon' WHERE tenant_id = ?").bind(a.tenantId).run()).rejects.toThrow();
    await expect(t.d1.prepare("INSERT INTO ci_integrations (tenant_id, connector, status, updated_by, created_at, updated_at) VALUES ('ghost','ga4','pending','u',1,1)").run()).rejects.toThrow();
  });
});
