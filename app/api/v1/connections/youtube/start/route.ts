import { api, asText, fail, invalid, ok, readBody } from "@/lib/api/handler";
import { startYoutubeConnection } from "@/lib/integrations/youtube/connection";
import { youtubeDepsFromEnv } from "@/lib/integrations/youtube/server";
import { noStore } from "@/lib/db/supabase-spike-http";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Starts the authorization: the database refuses anyone who is not owner or administrator of the company, stores only the hash of the `state`, and the answer is Google's address for the browser to go to.
export const POST = api(async ({ userId, request }) => {
  const tenantId = asText(await readBody(request), "tenantId");
  if (!tenantId || !UUID.test(tenantId)) return invalid();
  const deps = await youtubeDepsFromEnv(process.env);
  const result = await startYoutubeConnection(deps, { tenantId, userId, origin: request.nextUrl.origin });
  if (result.ok) return ok({ url: result.url });
  if (result.code === "not_configured") return noStore(NextResponse.json({ error: "not_configured", missing: result.missing ?? [] }, { status: 503 }));
  return fail(result.code, result.code === "invalid_request" ? 400 : 503);
});
