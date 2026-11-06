import { api, invalid, ok } from "@/lib/api/handler";
import { parseTenantId } from "@/lib/contracts/backend";

export const dynamic = "force-dynamic";

export const DELETE = api<{ id: string }>(async ({ db }, { id }) => {
  if (!parseTenantId(id)) return invalid();
  await db.deleteAssistantConversation(id);
  return ok();
});
