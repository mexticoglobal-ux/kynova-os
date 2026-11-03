import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseSpikeConfig } from "@/lib/db/supabase-spike-config";

const NO_STORE = "private, no-store, max-age=0";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", NO_STORE);
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");

  const config = getSupabaseSpikeConfig();
  if (!config) return response;

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        response.headers.set("Cache-Control", NO_STORE);
        response.headers.set("Pragma", "no-cache");
        response.headers.set("Expires", "0");
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  try {
    await supabase.auth.getClaims();
  } catch {
    // The protected page or endpoint fails closed if Supabase is unavailable.
  }

  return response;
}

export const config = { matcher: ["/spike/:path*", "/api/spike/:path*", "/api/profile/:path*"] };
