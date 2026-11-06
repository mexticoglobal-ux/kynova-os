import { api, invalid, ok, readBody, tenantParam } from "@/lib/api/handler";
import { parseInviteInput } from "@/lib/contracts/backend";

export const dynamic = "force-dynamic";

export const GET = api(async ({ db, request }) => {
  const tenantId = tenantParam(request);
  return tenantId ? ok({ team: await db.listTeam(tenantId) }) : invalid();
});

export const POST = api(async ({ db, request }) => {
  const input = parseInviteInput(await readBody(request));
  if (!input) return invalid();
  return ok(await db.invite(input.tenantId, input.email, input.role), 201);
});
