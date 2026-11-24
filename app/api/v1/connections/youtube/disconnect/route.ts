import { api, asText, fail, invalid, ok, readBody } from "@/lib/api/handler";
import { disconnectYoutubeConnection } from "@/lib/integrations/youtube/connection";
import { youtubeDepsFromEnv } from "@/lib/integrations/youtube/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Disconnects (owners and administrators; the database checks the user the server names). The stored credential is wiped first, so it cannot be used again; revoking it at Google follows, best effort.
export const POST = api(async ({ userId, request }) => {
  const tenantId = asText(await readBody(request), "tenantId");
  if (!tenantId || !UUID.test(tenantId)) return invalid();
  const result = await disconnectYoutubeConnection(await youtubeDepsFromEnv(process.env), { tenantId, userId });
  return result.ok ? ok({ ok: true, revoked: result.revoked }) : fail("not_found", 404);
});
