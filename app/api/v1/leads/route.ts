import { api, invalid, ok, tenantParam } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = api(async ({ db, request }) => {
  const tenantId = tenantParam(request);
  if (!tenantId) return invalid();
  const params = new URL(request.url).searchParams;
  const status = params.get("status") ?? undefined;
  const afterId = params.get("afterId");
  const afterCreatedAt = params.get("afterCreatedAt");
  return ok({
    leads: await db.listLeads(tenantId, { status, ...(afterId && afterCreatedAt ? { after: { id: afterId, createdAt: afterCreatedAt } } : {}) }),
  });
});
