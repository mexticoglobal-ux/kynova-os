import { api, asText, invalid, ok, readBody } from "@/lib/api/handler";
import { YOUTUBE_CONNECTOR_ID, parseConnectionStatus } from "@/lib/contracts/youtube-connection";
import { verifyYoutubeConnection } from "@/lib/integrations/youtube/connection";
import { youtubeDepsFromEnv, youtubeSetup } from "@/lib/integrations/youtube/server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Checks the authorization again with Google (owners and administrators). An authorization Google no longer honours becomes "expired" and its stored credential is wiped.
export const POST = api(async ({ db, request }) => {
  const tenantId = asText(await readBody(request), "tenantId");
  if (!tenantId || !UUID.test(tenantId)) return invalid();
  await db.connectorStatus(tenantId, YOUTUBE_CONNECTOR_ID); // refuses a user who is not owner or administrator
  const result = await verifyYoutubeConnection(await youtubeDepsFromEnv(process.env), { tenantId });
  const status = parseConnectionStatus(await db.connectorStatus(tenantId, YOUTUBE_CONNECTOR_ID), youtubeSetup(process.env));
  return ok({ status, code: result.ok ? null : result.code });
});
