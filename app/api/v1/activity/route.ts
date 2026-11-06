import { api, invalid, ok, tenantParam } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

// The trail of what NEX and people did, with the level of each action and why.
export const GET = api(async ({ db, request }) => {
  const tenantId = tenantParam(request);
  const before = new URL(request.url).searchParams.get("before") ?? undefined;
  return tenantId ? ok({ activity: await db.listActivity(tenantId, 50, before) }) : invalid();
});
