import { api, invalid, ok, readBody, tenantParam } from "@/lib/api/handler";
import { parseRoleInput, parseTenantId } from "@/lib/contracts/backend";

export const dynamic = "force-dynamic";

export const PATCH = api<{ userId: string }>(async ({ db, request }, { userId }) => {
  const input = parseRoleInput(await readBody(request));
  if (!input || !parseTenantId(userId)) return invalid();
  await db.setRole(input.tenantId, userId, input.role);
  return ok();
});

export const DELETE = api<{ userId: string }>(async ({ db, request }, { userId }) => {
  const tenantId = tenantParam(request);
  if (!tenantId || !parseTenantId(userId)) return invalid();
  await db.removeMember(tenantId, userId);
  return ok();
});
