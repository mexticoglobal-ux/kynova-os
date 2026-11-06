import { api, invalid, ok, readBody, tenantParam } from "@/lib/api/handler";
import { parseClientInput } from "@/lib/contracts/backend";

export const dynamic = "force-dynamic";

export const GET = api(async ({ db, request }) => {
  const tenantId = tenantParam(request);
  if (!tenantId) return invalid();
  const params = new URL(request.url).searchParams;
  const status = params.get("status");
  const search = params.get("search")?.slice(0, 120);
  return ok({ clients: await db.listClients(tenantId, { search: search || undefined, status: status === "active" || status === "inactive" ? status : undefined }) });
});

export const POST = api(async ({ db, request }) => {
  const input = parseClientInput(await readBody(request));
  if (!input) return invalid();
  return ok({ id: await db.createClient(input.tenantId, input) }, 201);
});
