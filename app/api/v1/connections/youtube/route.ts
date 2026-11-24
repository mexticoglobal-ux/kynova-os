import { api, invalid, ok, tenantParam } from "@/lib/api/handler";
import { YOUTUBE_CONNECTOR_ID, parseConnectionStatus } from "@/lib/contracts/youtube-connection";
import { youtubeSetup } from "@/lib/integrations/youtube/server";

export const dynamic = "force-dynamic";

// The status of the company's YouTube connection, for owners and administrators (the database function checks the role). It never carries a credential, and a status that is not exactly what the
// database said reads as disconnected: this route cannot answer "connected" on a guess.
export const GET = api(async ({ db, request }) => {
  const tenantId = tenantParam(request);
  if (!tenantId) return invalid();
  const raw = await db.connectorStatus(tenantId, YOUTUBE_CONNECTOR_ID);
  return ok(parseConnectionStatus(raw, youtubeSetup(process.env)));
});
