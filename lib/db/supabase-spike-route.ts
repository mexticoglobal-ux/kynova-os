import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { isSessionCookie } from "./supabase-auth-cookies";
import { getSupabaseSpikeConfig } from "./supabase-spike-config";

/** `signingIn`: for the routes that establish a session (ask for a code or link, verify it, exchange it). They do not read the old session (see supabase-auth-cookies.ts, rule 2). Signing out must read it. */
export function createSupabaseSpikeRouteClient(request: NextRequest, response: NextResponse, options: { signingIn?: boolean } = {}) {
  const config = getSupabaseSpikeConfig();
  if (!config) throw new Error("Supabase spike is not configured.");
  const old = new Set(options.signingIn ? request.cookies.getAll().map(({ name }) => name).filter(isSessionCookie) : []);

  return createServerClient(config.url, config.publishableKey, {
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll().filter(({ name }) => !old.has(name)),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options: cookieOptions }) => {
          old.delete(name);
          request.cookies.set(name, value);
          response.cookies.set(name, value, cookieOptions);
        });
        // a new session was written: what is left of the old one expires, so it can never shadow the new one
        if (cookiesToSet.some(({ name, value }) => value !== "" && isSessionCookie(name))) {
          for (const name of old) {
            request.cookies.delete(name);
            response.cookies.set(name, "", { path: "/", maxAge: 0 });
          }
          old.clear();
        }
      },
    },
  });
}
