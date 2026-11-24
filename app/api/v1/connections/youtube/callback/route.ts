import { NextResponse } from "next/server";
import { api } from "@/lib/api/handler";
import { BackendError } from "@/lib/db/backend";
import { noStore } from "@/lib/db/supabase-spike-http";
import { finishYoutubeConnection } from "@/lib/integrations/youtube/connection";
import { youtubeDepsFromEnv } from "@/lib/integrations/youtube/server";

export const dynamic = "force-dynamic";

const SCREEN = "/platform/connected-apps";

// Where Google sends the person back. The signed-in user of THIS request must be the one who started the authorization (the database binds the `state` to company and user). The result goes to the
// screen as a short word in the address; nothing sensitive (no code, no token) is ever put in it.
export const GET = api(async ({ userId, request }) => {
  const origin = request.nextUrl.origin;
  const go = (query: string) => noStore(NextResponse.redirect(new URL(`${SCREEN}?${query}`, origin), 303));
  const params = request.nextUrl.searchParams;
  try {
    const deps = await youtubeDepsFromEnv(process.env);
    const result = await finishYoutubeConnection(deps, { userId, origin, code: params.get("code"), state: params.get("state"), error: params.get("error") });
    return result.ok ? go("youtube=connected") : go(`youtube_error=${result.code}`);
  } catch (error) {
    return go(`youtube_error=${error instanceof BackendError && error.code === "forbidden" ? "forbidden" : "unavailable"}`);
  }
});
