import { api, invalid, ok, readBody } from "@/lib/api/handler";
import { parseClientPatch, parseTenantId } from "@/lib/contracts/backend";

export const dynamic = "force-dynamic";

// Edits and archiving: a client is never deleted, it becomes inactive (its history stays).
export const PATCH = api<{ id: string }>(async ({ db, request }, { id }) => {
  const patch = parseClientPatch(await readBody(request));
  if (!patch || !parseTenantId(id)) return invalid();
  await db.updateClient(id, patch.fields);
  return ok();
});
