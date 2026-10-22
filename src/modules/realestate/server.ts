import { getActivityService, getActivitySink } from "@/platform/activity";
import { getWorkflowStore } from "@/platform/workflows";
import { getBlueprintsService } from "@/modules/blueprints";
import { getBusinessProfileService } from "@/platform/business-profile";
import { getEmployeeFramework } from "@/platform/ai-employees";
import { getDb, plansRepo, tenantDb } from "@/platform/db";
import { ROSTER_BY_KEY, employeeKeyOf, isEntitled, teamOf } from "@/modules/team";
import { getMarketingService } from "@/modules/marketing";
import { getCompanyIntegrationsService } from "@/platform/integrations";
import { getRealEstateStore } from "./runtime";
import { createRealEstateService, type Actor, type RealEstatePorts, type RealEstateService } from "./service";

/** Composition root: the only file that meets Marketing, the Team roster and the AI Employees framework. Marketing is used to create DRAFT posts only. */
async function planOf(a: Actor): Promise<string | null> {
  const db = await getDb(), sub = await tenantDb(db, { tenantId: a.tenantId }).subscriptions.current();
  return sub ? ((await plansRepo(db).findById(sub.planId))?.code ?? null) : null;
}
export const realEstatePorts: RealEstatePorts = {
  async member(a, key) {
    const r = ROSTER_BY_KEY.get(key);
    if (!r) return null;
    const bp = r.blueprint ?? r.key, [records, plan] = await Promise.all([getEmployeeFramework().employees.list(a).catch(() => []), planOf(a).catch(() => null)]);
    const rec = records.find((e) => e.blueprint === bp && e.status !== "retired");
    return { key, name: r.name, entitled: isEntitled(teamOf(plan), key), active: Boolean(rec), activityKey: rec ? employeeKeyOf(rec.id) : key };
  },
  async businessProfile(a) { return (await getBusinessProfileService()).state(a); },
  async integrations(a) { return (await getCompanyIntegrationsService()).state(a); },
  async isBootstrap(a) { return Boolean((await (await getBlueprintsService()).current(a))?.bootstrap); },
  async members(a, keys) {
    const [records, plan] = await Promise.all([getEmployeeFramework().employees.list(a).catch(() => []), planOf(a).catch(() => null)]);
    return keys.flatMap((key) => {
      const r = ROSTER_BY_KEY.get(key); if (!r) return [];
      const bp = r.blueprint ?? r.key, rec = records.find((e) => e.blueprint === bp && e.status !== "retired");
      return [{ key, name: r.name, entitled: isEntitled(teamOf(plan), key), active: Boolean(rec), activityKey: rec ? employeeKeyOf(rec.id) : key }];
    });
  },
  async timeline(a, q) {
    const page = await (await getActivityService()).list(a, { module: "realestate", actorKind: "employee", since: q.since, limit: q.limit });
    return page.items.map((e) => ({ at: e.occurredAt, employeeKey: e.employeeKey ?? "", action: e.action, summary: e.summary, subjectKind: e.subjectKind, subjectId: e.subjectId }));
  },
  async createDraft(a, d) { return { id: (await (await getMarketingService()).posts.create(a, { title: d.title, body: d.body })).id }; },
};
export async function getRealEstateService(): Promise<RealEstateService> {
  return createRealEstateService({ store: await getRealEstateStore(), ports: realEstatePorts, newId: () => crypto.randomUUID().replace(/-/g, ""), activity: await getActivitySink("realestate"), workflows: await getWorkflowStore() });
}
