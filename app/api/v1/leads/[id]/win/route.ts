import { api, invalid, ok, readBody } from "@/lib/api/handler";
import { parseTenantId, parseWinInput } from "@/lib/contracts/backend";

export const dynamic = "force-dynamic";

// Converts a prospect into a customer: creates the opportunity, wins it and creates the customer in one transaction.
export const POST = api<{ id: string }>(async ({ db, request }, { id }) => {
  const body = await readBody(request);
  const input = parseWinInput(body);
  if (!input || !parseTenantId(id)) return invalid();
  return ok(await db.winLead(id, input), 201);
});
