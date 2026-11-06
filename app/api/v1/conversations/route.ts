import { api, invalid, ok, readBody, tenantParam } from "@/lib/api/handler";
import { parseTenantId } from "@/lib/contracts/backend";

export const dynamic = "force-dynamic";

export const GET = api(async ({ db, request }) => {
  const tenantId = tenantParam(request);
  const kind = new URL(request.url).searchParams.get("kind") === "contact" ? "contact" : "assistant";
  return tenantId ? ok({ conversations: await db.listConversations(tenantId, kind) }) : invalid();
});

// Starts a private conversation with NEX for the signed-in user.
export const POST = api(async ({ db, request }) => {
  const body = await readBody(request);
  const record = typeof body === "object" && body !== null ? (body as { tenantId?: unknown; title?: unknown }) : {};
  const tenantId = parseTenantId(record.tenantId);
  if (!tenantId) return invalid();
  const title = typeof record.title === "string" ? record.title.slice(0, 200) : undefined;
  return ok({ id: await db.startAssistantConversation(tenantId, title) }, 201);
});
