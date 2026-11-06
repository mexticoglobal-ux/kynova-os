import { NextResponse, type NextRequest } from "next/server";
import { parseSpikeEmail } from "@/lib/contracts/supabase-spike";
import { createSupabaseSpikeRouteClient } from "@/lib/db/supabase-spike-route";
import { getSupabaseSpikeConfig, SPIKE_EMAIL_COOKIE, spikeEmailCookieOptions } from "@/lib/db/supabase-spike";
import { hasSameOrigin, isWithinBodyLimit, noStore } from "@/lib/db/supabase-spike-http";
import { asText, fail, readBody } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

// Sends a one-time code to the email. Signing in creates the account on the first use: whoever receives the code
// owns the address. The email is remembered in a short-lived HttpOnly cookie so the next step needs only the code.
export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return fail("invalid_origin", 403);
  if (!isWithinBodyLimit(request, 1024)) return fail("request_too_large", 413);
  if (!getSupabaseSpikeConfig()) return fail("not_configured", 503);
  const body = await readBody(request);
  const email = parseSpikeEmail(asText(body, "email"));
  if (!email) return fail("invalid_email", 400);

  const response = noStore(NextResponse.json({ ok: true }));
  try {
    const supabase = createSupabaseSpikeRouteClient(request, response);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) return fail("send_failed", error.status === 429 ? 429 : 502);
  } catch {
    return fail("unavailable", 503);
  }
  response.cookies.set(SPIKE_EMAIL_COOKIE, email, spikeEmailCookieOptions(10 * 60));
  return response;
}
