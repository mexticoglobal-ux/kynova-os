import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseSpikeConfig } from "@/lib/db/supabase-spike-config";
import { APP_PATHS } from "@/lib/auth/paths";

const NO_STORE = "private, no-store, max-age=0";

const noStore = (response: NextResponse) => {
  response.headers.set("Cache-Control", NO_STORE);
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
};

const isAppPath = (pathname: string) => APP_PATHS.some((prefix) => pathname === `/${prefix}` || pathname.startsWith(`/${prefix}/`));

export async function middleware(request: NextRequest) {
  let response = noStore(NextResponse.next({ request }));

  const config = getSupabaseSpikeConfig();
  // Without a Supabase project the app runs in demonstration mode: nothing to guard.
  if (!config) return response;

  const supabase = createServerClient(config.url, config.publishableKey, {
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = noStore(NextResponse.next({ request }));
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // Refreshes the session cookie. getClaims verifies the token locally and cheaply: this is only the first gate.
  // Server pages and /api/v1 routes still ask the Auth server (getUser), so a revoked session does not get through.
  let signedIn = false;
  try {
    const { data } = await supabase.auth.getClaims();
    signedIn = Boolean(data?.claims?.sub);
  } catch {
    // Supabase unavailable: protected pages fail closed below.
  }

  const { pathname } = request.nextUrl;
  const redirect = (path: string) => {
    const target = noStore(NextResponse.redirect(new URL(path, request.url), 307));
    response.cookies.getAll().forEach((cookie) => target.cookies.set(cookie));
    return target;
  };

  if (!signedIn && isAppPath(pathname)) return redirect(`/login?next=${encodeURIComponent(pathname)}`);
  if (signedIn && pathname === "/login") return redirect("/dashboard");
  return response;
}

export const config = {
  matcher: [
    "/spike/:path*",
    "/api/spike/:path*",
    "/api/profile/:path*",
    "/api/auth/:path*",
    "/api/v1/:path*",
    "/login",
    ...APP_PATHS.flatMap((prefix) => [`/${prefix}`, `/${prefix}/:path*`]),
  ],
};
