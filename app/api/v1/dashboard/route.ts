import { api, invalid, ok, tenantParam } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export const GET = api(async ({ db, request }) => {
  const tenantId = tenantParam(request);
  return tenantId ? ok(await db.dashboard(tenantId)) : invalid();
});
