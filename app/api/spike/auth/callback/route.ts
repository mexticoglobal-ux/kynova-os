import { NextResponse, type NextRequest } from "next/server";
import { logAuthFailure } from "@/lib/db/supabase-auth-diagnostics";
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

  // Whether the browser that opened the link carries the PKCE verifier of the request (read BEFORE the exchange): without it the link was opened in another browser or profile. Only a yes/no is logged.
  const withVerifier = request.cookies.getAll().some(({ name }) => name.endsWith("-code-verifier"));
  const where = `spike.callback.${withVerifier ? "with" : "without"}_verifier`;
  const supabase = createSupabaseSpikeRouteClient(request, response);
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      logAuthFailure(where, error);
      response.headers.set(
        "Location",
        new URL("/spike/login?status=error", request.url).toString(),
      );
    } else {
      response.headers.set("Location", new URL("/spike", request.url).toString());
      response.cookies.set(SPIKE_EMAIL_COOKIE, "", spikeEmailCookieOptions(0));
    }
  } catch (error) {
    logAuthFailure(`${where}.thrown`, error);
    response.headers.set("Location", new URL("/spike/login?status=error", request.url).toString());
  }

  return response;
}
