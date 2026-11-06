import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseSpikeRouteClient } from "@/lib/db/supabase-spike-route";
import { getSupabaseSpikeConfig, SPIKE_EMAIL_COOKIE, spikeEmailCookieOptions } from "@/lib/db/supabase-spike";
import { hasSameOrigin, noStore } from "@/lib/db/supabase-spike-http";
import { fail } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return fail("invalid_origin", 403);
  const response = noStore(NextResponse.json({ ok: true }));
  if (getSupabaseSpikeConfig()) {
    try {
      await createSupabaseSpikeRouteClient(request, response).auth.signOut({ scope: "local" });
    } catch {
      return fail("unavailable", 503);
    }
  }
  response.cookies.set(SPIKE_EMAIL_COOKIE, "", spikeEmailCookieOptions(0));
  response.cookies.set("kynova_tenant", "", { path: "/", maxAge: 0 });
  return response;
}
