import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseSpikeRouteClient } from "@/lib/db/supabase-spike-route";
import {
  getSupabaseSpikeConfig,
  SPIKE_EMAIL_COOKIE,
  spikeEmailCookieOptions,
} from "@/lib/db/supabase-spike";
import { noStore } from "@/lib/db/supabase-spike-http";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const config = getSupabaseSpikeConfig();
  const response = NextResponse.redirect(
    new URL(
      `/spike/login?status=${code && config ? "error" : config ? "required" : "setup"}`,
      request.url,
    ),
  );
  noStore(response);

  if (!code || !config) return response;

  const supabase = createSupabaseSpikeRouteClient(request, response);
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      response.headers.set(
        "Location",
        new URL("/spike/login?status=error", request.url).toString(),
      );
    } else {
      response.headers.set("Location", new URL("/spike", request.url).toString());
      response.cookies.set(SPIKE_EMAIL_COOKIE, "", spikeEmailCookieOptions(0));
    }
  } catch {
    response.headers.set("Location", new URL("/spike/login?status=error", request.url).toString());
  }

  return response;
}
