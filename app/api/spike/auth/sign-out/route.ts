import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseSpikeRouteClient } from "@/lib/db/supabase-spike-route";
import { getSupabaseSpikeConfig, SPIKE_EMAIL_COOKIE, spikeEmailCookieOptions } from "@/lib/db/supabase-spike";
import { hasSameOrigin, noStore } from "@/lib/db/supabase-spike-http";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return noStore(NextResponse.json({ error: "invalid_origin" }, { status: 403 }));
  const response = NextResponse.redirect(new URL("/spike/login?status=signed_out", request.url), 303);
  noStore(response);
  if (getSupabaseSpikeConfig()) {
    try {
      const supabase = createSupabaseSpikeRouteClient(request, response);
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      response.headers.set("Location", new URL("/spike/login?status=error", request.url).toString());
    }
  }
  response.cookies.set(SPIKE_EMAIL_COOKIE, "", spikeEmailCookieOptions(0));
  return response;
}
