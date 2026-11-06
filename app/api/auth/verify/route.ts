import { NextResponse, type NextRequest } from "next/server";
import { parseSpikeOtp } from "@/lib/contracts/supabase-spike";
import { createSupabaseSpikeRouteClient } from "@/lib/db/supabase-spike-route";
import { getSupabaseSpikeConfig, SPIKE_EMAIL_COOKIE, spikeEmailCookieOptions } from "@/lib/db/supabase-spike";
import { hasSameOrigin, isWithinBodyLimit, noStore } from "@/lib/db/supabase-spike-http";
import { asText, fail, readBody } from "@/lib/api/handler";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return fail("invalid_origin", 403);
  if (!isWithinBodyLimit(request, 1024)) return fail("request_too_large", 413);
  if (!getSupabaseSpikeConfig()) return fail("not_configured", 503);
  const body = await readBody(request);
  const token = parseSpikeOtp(asText(body, "token"));
  const email = request.cookies.get(SPIKE_EMAIL_COOKIE)?.value;
  if (!token || !email) return fail("code_required", 400);

  const response = noStore(NextResponse.json({ ok: true }));
  try {
    const supabase = createSupabaseSpikeRouteClient(request, response);
    const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    if (error) return fail("invalid_code", 401);
  } catch {
    return fail("unavailable", 503);
  }
  response.cookies.set(SPIKE_EMAIL_COOKIE, "", spikeEmailCookieOptions(0));
  return response;
}
