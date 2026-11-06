import { api, invalid, ok, readBody } from "@/lib/api/handler";
import { parseDecisionInput, parseTenantId } from "@/lib/contracts/backend";

export const dynamic = "force-dynamic";

// Approve or reject something NEX prepared. Only owners and admins can decide; nothing leaves the platform yet.
export const POST = api<{ id: string }>(async ({ db, request }, { id }) => {
  const input = parseDecisionInput(await readBody(request));
  if (!input || !parseTenantId(id)) return invalid();
  await db.decideApproval(id, input.approve, input.note);
  return ok();
});
