import { api, invalid, ok, readBody } from "@/lib/api/handler";
import { parseMessageInput, parseTenantId } from "@/lib/contracts/backend";

export const dynamic = "force-dynamic";

export const GET = api<{ id: string }>(async ({ db }, { id }) => (parseTenantId(id) ? ok({ messages: await db.listMessages(id) }) : invalid()));

export const POST = api<{ id: string }>(async ({ db, request }, { id }) => {
  const input = parseMessageInput(await readBody(request));
  if (!input || !parseTenantId(id)) return invalid();
  return ok(await db.appendMessage(id, input), 201);
});
