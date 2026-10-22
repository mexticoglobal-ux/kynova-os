import type { Role } from "@/config/roles";
import type { ActivitySink, SinkEvent } from "@/platform/activity";
import { createRealEstateService, type Actor, type RealEstatePorts } from "../../../src/modules/realestate/service";
import { createMemoryRealEstateStore } from "../../../src/modules/realestate/store-memory";

export const START = Date.UTC(2026, 9, 20, 12), DAY = 86_400_000;
export const actor = (role: Role, tenantId = "t1"): Actor => ({ tenantId, userId: `${role}-1`, role });
export const OWNER = actor("owner"), SALES = actor("sales"), FINANCE = actor("finance"), SUPPORT = actor("support"), OTHER = actor("owner", "t2");
export const code = async (p: Promise<unknown>) => { try { await p; return "ok"; } catch (e) { return (e as { code?: string }).code ?? `other:${(e as Error).message}`; } };
export function harness(o: { bootstrap?: boolean; bp?: import("../../../src/platform/business-profile/knowledge").KnowledgeState | null; ig?: import("../../../src/platform/integrations/status").IntegrationState | null } = {}) {
  const drafts: { title: string; body: string }[] = [], events: (SinkEvent & { tenantId: string })[] = [], clock = { t: START }; let n = 0;
  const ports: RealEstatePorts = {
    member: async (_a, key) => ({ key, name: key, entitled: true, active: true, activityKey: `emp_${key}` }),
    async createDraft(_a, d) { drafts.push(d); return { id: `post${drafts.length}` }; },
    isBootstrap: async () => Boolean(o.bootstrap),
    ...(o.ig !== undefined ? { integrations: async () => o.ig ?? null } : {}),
    ...(o.bp !== undefined ? { businessProfile: async () => o.bp ?? null } : {}),
    timeline: async (_a, q) => events.filter((e) => e.actorKind === "employee" && (e.occurredAt ?? clock.t) >= q.since).map((e) => ({ at: e.occurredAt ?? clock.t, employeeKey: e.employeeKey ?? "", action: e.action, summary: e.summary, subjectKind: e.subjectKind ?? null, subjectId: e.subjectId ?? null })).slice(0, q.limit),
  };
  const activity: ActivitySink = { async record(ctx, e) { events.push({ tenantId: ctx.tenantId, occurredAt: clock.t, ...e }); return { ok: false, error: { code: "test", message: "captured" } }; }, async recordStrict() { throw new Error("captured"); } };
  const svc = createRealEstateService({ store: createMemoryRealEstateStore(), ports, newId: () => `id${String(++n).padStart(5, "0")}`, now: () => clock.t, activity });
  return { svc, drafts, events, clock };
}
export type H = ReturnType<typeof harness>;
export const house = (o: Record<string, unknown> = {}) => ({ title: "Casa en Escazú", operation: "sale", kind: "house", priceMinor: 25_000_000, zone: "Escazú", bedrooms: 3, ...o });
