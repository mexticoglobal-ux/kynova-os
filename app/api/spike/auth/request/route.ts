import { NextResponse, type NextRequest } from "next/server";
import { parseSpikeEmail } from "@/lib/contracts/supabase-spike";
import { createSupabaseSpikeRouteClient } from "@/lib/db/supabase-spike-route";
import { getSupabaseSpikeConfig, SPIKE_EMAIL_COOKIE, spikeEmailCookieOptions } from "@/lib/db/supabase-spike";
import { hasSameOrigin, isWithinBodyLimit, noStore, readSpikeForm } from "@/lib/db/supabase-spike-http";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return noStore(NextResponse.json({ error: "invalid_origin" }, { status: 403 }));
  if (!isWithinBodyLimit(request)) return noStore(NextResponse.json({ error: "request_too_large" }, { status: 413 }));
  const form = await readSpikeForm(request);
  if (!form) return noStore(NextResponse.json({ error: "invalid_request" }, { status: 400 }));
  const email = parseSpikeEmail(form.get("email"));
  const config = getSupabaseSpikeConfig();
  const response = NextResponse.redirect(new URL(`/spike/login?status=${email && config ? "sent" : config ? "error" : "setup"}`, request.url), 303);
  noStore(response);
  if (!email || !config) return response;

  const supabase = createSupabaseSpikeRouteClient(request, response);
  try {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    if (error) {
      response.headers.set("Location", new URL("/spike/login?status=error", request.url).toString());
    }
    else response.cookies.set(SPIKE_EMAIL_COOKIE, email, spikeEmailCookieOptions(10 * 60));
  } catch {
    response.headers.set("Location", new URL("/spike/login?status=error", request.url).toString());
  }

  return response;
}
