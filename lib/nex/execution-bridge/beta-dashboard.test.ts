import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runInternalBeta, BETA_NOW } from "@/lib/contracts/platform/internal-beta";
import { applyConnectorsEvents, newConnectorsState, PROVIDER_FAMILIES, type ConnectorEnv } from "@/lib/contracts/platform/connectors";
import { betaDashboard, liveDashboard, viewerOfMemberships, NO_INFO, type BetaSources } from "./beta-dashboard";

const beta = runInternalBeta();
const ids = beta.tenants.map((row) => row.spec.id);
const [first = "", second = ""] = ids;
const all = { tenantIds: ids, role: "owner" };
const env: ConnectorEnv = { configuredFamilies: [...PROVIDER_FAMILIES], workers: [] };
const connectors = () => applyConnectorsEvents(newConnectorsState(), [{ tenantId: first, actor: "owner", at: BETA_NOW, type: "tenant.enable" }], env).state;
const sources: BetaSources = { beta };

const view = (viewer = all, tenantId = first, source: BetaSources = sources) => {
  const result = betaDashboard(source, viewer, tenantId, BETA_NOW);
  if (!result.ok) throw new Error(result.refusal);
  return result.dashboard;
};

describe("Beta Dashboard", () => {
  it("reads the existing records: counts, health, KPIs and recent activity of the company", () => {
    const data = view();
    const own = beta.tenants.find((row) => row.spec.id === first);
    expect(data.name).toBe(own?.spec.name);
    expect(data.counts.workers).toBe(own?.dashboard.people.workers);
    expect(data.counts.workflows).toBe(own?.dashboard.automation.active);
    expect(data.health).toEqual(own?.dashboard.health);
    expect(data.companies).toHaveLength(ids.length);
    expect(data.activity === null || data.activity.length <= 8).toBe(true);
  });

  it("is deterministic: the same sources and instant give the same screen", () => {
    expect(view()).toEqual(view());
    expect(JSON.stringify(view(all, second))).toBe(JSON.stringify(view(all, second)));
  });

  it("says Sin información (null) where nothing exists, and invents nothing", () => {
    const data = view();
    expect(data.approvals).toBeNull();
    expect(data.google).toBeNull();
    expect(data.execution).toBeNull();
    expect(NO_INFO).toBe("Sin información");
  });

  it("multi-company: a viewer only sees and opens the companies they belong to", () => {
    const one = { tenantIds: [first], role: "owner" };
    const data = view(one);
    expect(data.companies.map((row) => row.id)).toEqual([first]);
    expect(betaDashboard(sources, one, second, BETA_NOW)).toEqual({ ok: false, refusal: "forbidden" });
    expect(betaDashboard(sources, { tenantIds: ["tenant-ghost"], role: "owner" }, "tenant-ghost", BETA_NOW)).toEqual({ ok: false, refusal: "unknownCompany" });
    const shown = view(all, first).activity;
    const activity = Array.isArray(shown) ? shown : [];
    const other = new Set(beta.parts.crm.timeline.filter((row) => row.tenantId === second).map((row) => row.at + row.actor));
    for (const item of activity) expect(other.has(item.at + item.actor) && !beta.parts.crm.timeline.some((row) => row.tenantId === first && row.at === item.at && row.actor === item.actor)).toBe(false);
  });

  it("the approvals inbox is for people who administer the company; Google Workspace is read from the connectors", () => {
    const withApps: BetaSources = { beta, connectors: connectors() };
    expect(view(all, first, withApps).approvals).toEqual([]);
    expect(view({ tenantIds: ids, role: "member" }, first, withApps).approvals).toBeNull();
    const google = view(all, first, withApps).google;
    expect(google).toHaveLength(3);
    expect(google?.every((row) => row.display === "Disconnected")).toBe(true);
  });

  it("the viewer comes from the session's memberships: a requested company that is not theirs is ignored, and the role is the one of the company shown", () => {
    const memberships = [{ tenantId: "t1", role: "viewer" as const }, { tenantId: "t2", role: "admin" as const }];
    expect(viewerOfMemberships(memberships, "t1", "t2")).toEqual({ viewer: { tenantIds: ["t1", "t2"], role: "admin" }, tenantId: "t2" });
    expect(viewerOfMemberships(memberships, "t1", "t-other")).toEqual({ viewer: { tenantIds: ["t1", "t2"], role: "viewer" }, tenantId: "t1" });
    expect(viewerOfMemberships(memberships, undefined, undefined)?.tenantId).toBe("t1");
    expect(viewerOfMemberships([], "t1", "t1")).toBeNull();
    const own = viewerOfMemberships([{ tenantId: first, role: "viewer" }], first, second);
    expect(own?.tenantId).toBe(first);
    expect(betaDashboard(sources, own?.viewer ?? { tenantIds: [], role: "viewer" }, second, BETA_NOW)).toEqual({ ok: false, refusal: "forbidden" });
  });

  it("a viewer or member never gets the approvals inbox, an owner or admin does", () => {
    const withApps: BetaSources = { beta, connectors: connectors() };
    for (const role of ["viewer", "member"]) expect(view({ tenantIds: ids, role }, first, withApps).approvals).toBeNull();
    for (const role of ["owner", "admin"]) expect(view({ tenantIds: ids, role }, first, withApps).approvals).toEqual([]);
  });

  it("a signed-in company reads its persisted activity only after its membership is checked; a foreign company is refused before any read", async () => {
    const memberships = [{ tenantId: "t1", name: "Uno", role: "owner" as const }, { tenantId: "t2", name: "Dos", role: "viewer" as const }];
    const asked: string[] = [];
    const rows = [{ at: "2026-11-12T10:00:00.000Z", kind: "assessment.saved", actor: "user" }];
    const read = { activity: async (id: string) => { asked.push(id); return rows; }, pending: async (id: string) => { asked.push(id); return { count: 3, items: [{ kind: "lead.outreach", createdAt: "2026-11-12T09:00:00.000Z" }] }; } };
    const result = await liveDashboard(memberships, "t2", BETA_NOW, read);
    expect(result.ok && result.dashboard.counts.pendingRequests).toBe(3);
    expect(result.ok && result.dashboard.activity).toEqual(rows);
    expect(result.ok && result.dashboard.companies.map((row) => row.id)).toEqual(["t1", "t2"]);
    expect(await liveDashboard(memberships, "t-foreign", BETA_NOW, read)).toEqual({ ok: false, refusal: "forbidden" });
    expect(asked).toEqual(["t2", "t2"]);
  });

  it("keeps apart a missing source (null), a failed read (error) and an empty result ([]); other sections stay Sin información", async () => {
    const memberships = [{ tenantId: "t1", name: "Uno", role: "owner" as const }];
    const empty = await liveDashboard(memberships, "t1", BETA_NOW, { activity: async () => [], pending: async () => ({ count: 0, items: [] }) });
    const failed = await liveDashboard(memberships, "t1", BETA_NOW, { activity: async () => { throw new Error("unavailable"); }, pending: async () => { throw new Error("unavailable"); } });
    expect(empty.ok && empty.dashboard.counts.pendingRequests).toBe(0);
    expect(failed.ok && failed.dashboard.counts.pendingRequests).toBe("error");
    expect(empty.ok && empty.dashboard.activity).toEqual([]);
    expect(failed.ok && failed.dashboard.activity).toBe("error");
    expect(view().activity === null).toBe(false);
    if (empty.ok) expect([empty.dashboard.counts.workers, empty.dashboard.approvals, empty.dashboard.google, empty.dashboard.health, empty.dashboard.kpis, empty.dashboard.execution]).toEqual([null, null, null, null, null, null]);
  });

  it("CRM requests: the list (kind and date) is for owner or admin, members only get the count; a partial list says so", async () => {
    const row = (n: number) => ({ kind: "lead.outreach", createdAt: "2026-11-12T0" + n + ":00:00.000Z", leadId: "lead-secret", contactName: "Ana Perez", id: "req-" + n });
    const pending = async () => ({ count: 12, items: [row(1), row(2)] });
    const readers = { activity: async () => [], pending };
    const as = (role: "owner" | "admin" | "member" | "viewer") => liveDashboard([{ tenantId: "t1", name: "Uno", role }], "t1", BETA_NOW, readers);
    for (const role of ["owner", "admin"] as const) {
      const result = await as(role);
      expect(result.ok && result.dashboard.crmRequests).toEqual({ items: [{ kind: "lead.outreach", createdAt: "2026-11-12T01:00:00.000Z" }, { kind: "lead.outreach", createdAt: "2026-11-12T02:00:00.000Z" }], partial: true });
      expect(JSON.stringify(result)).not.toMatch(/lead-secret|Ana Perez|req-/);
    }
    for (const role of ["member", "viewer"] as const) {
      const result = await as(role);
      expect(result.ok && result.dashboard.crmRequests).toBeNull();
      expect(result.ok && result.dashboard.counts.pendingRequests).toBe(12);
    }
    const whole = await liveDashboard([{ tenantId: "t1", name: "Uno", role: "owner" }], "t1", BETA_NOW, { activity: async () => [], pending: async () => ({ count: 2, items: [row(1), row(2)] }) });
    expect(whole.ok && whole.dashboard.crmRequests).toMatchObject({ partial: false });
    const none = await liveDashboard([{ tenantId: "t1", name: "Uno", role: "owner" }], "t1", BETA_NOW, { activity: async () => [], pending: async () => ({ count: 0, items: [] }) });
    expect(none.ok && none.dashboard.crmRequests).toEqual({ items: [], partial: false });
    const failed = await liveDashboard([{ tenantId: "t1", name: "Uno", role: "owner" }], "t1", BETA_NOW, { activity: async () => [], pending: async () => { throw new Error("x"); } });
    expect(failed.ok && failed.dashboard.crmRequests).toBe("error");
    expect(view().crmRequests).toBeNull();
  });

  it("carries only kind, actor type and time from the persisted rows: no summary, reason or name", async () => {
    const dirty = [{ at: "2026-11-12T10:00:00.000Z", kind: "lead.created", actor: "user", summary: "secret@example.com", reason: "private", actorName: "Ana" }];
    const result = await liveDashboard([{ tenantId: "t1", name: "Uno", role: "owner" }], "t1", BETA_NOW, { activity: async () => dirty, pending: async () => ({ count: 1, items: [] }) });
    const text = JSON.stringify(result);
    for (const leaked of ["secret@example.com", "private", "Ana"]) expect(text).not.toContain(leaked);
  });

  it("carries no sensitive data: only kinds, ids and times, never a summary, address or text", () => {
    const text = JSON.stringify(view(all, first, { beta, connectors: connectors() }));
    for (const lead of beta.parts.crm.leads.filter((row) => row.tenantId === first)) {
      if (lead.email) expect(text).not.toContain(lead.email);
      if (lead.phone) expect(text).not.toContain(lead.phone);
    }
    for (const entry of beta.parts.crm.timeline.filter((row) => row.tenantId === first)) expect(text).not.toContain(entry.summary);
  });

  it("is a pure view: no clock, network, database, AI or new engine in the file", () => {
    const source = readFileSync(new URL("./beta-dashboard.ts", import.meta.url), "utf8").split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    for (const forbidden of ["Date.now", "new Date()", "Math.random", "fetch(", "process.env", "lib/db", "lib/ai"]) expect(source, forbidden).not.toContain(forbidden);
  });
});
