import { api, invalid, ok, readBody } from "@/lib/api/handler";
import { parseCompanyInput, parseTenantId } from "@/lib/contracts/backend";

export const dynamic = "force-dynamic";

export const PATCH = api<{ id: string }>(async ({ db, request }, { id }) => {
  const tenantId = parseTenantId(id);
  const input = parseCompanyInput(await readBody(request));
  if (!tenantId || !input) return invalid();
  await db.renameCompany(tenantId, input.name);
  return ok();
});

// Owner only, and only with the company name typed as confirmation. Deletes every row of the company.
export const DELETE = api<{ id: string }>(async ({ db, request }, { id }) => {
  const tenantId = parseTenantId(id);
  const body = await readBody(request);
  const confirmName = typeof body === "object" && body !== null ? (body as { confirmName?: unknown }).confirmName : null;
  if (!tenantId || typeof confirmName !== "string") return invalid();
  await db.deleteCompany(tenantId, confirmName);
  return ok();
});
