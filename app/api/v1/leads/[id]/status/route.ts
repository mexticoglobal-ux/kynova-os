import { api, invalid, ok, readBody } from "@/lib/api/handler";
import { parseLeadStatusInput, parseTenantId } from "@/lib/contracts/backend";

export const dynamic = "force-dynamic";

export const PATCH = api<{ id: string }>(async ({ db, request }, { id }) => {
  const input = parseLeadStatusInput(await readBody(request));
  if (!input || !parseTenantId(id)) return invalid();
  await db.advanceLead(id, input.status, input.reason);
  return ok();
});
