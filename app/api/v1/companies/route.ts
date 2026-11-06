import { api, invalid, ok, readBody } from "@/lib/api/handler";
import { parseCompanyInput } from "@/lib/contracts/backend";

export const dynamic = "force-dynamic";

export const POST = api(async ({ db, request }) => {
  const input = parseCompanyInput(await readBody(request));
  if (!input) return invalid();
  return ok({ tenantId: await db.createCompany(input.name) }, 201);
});
