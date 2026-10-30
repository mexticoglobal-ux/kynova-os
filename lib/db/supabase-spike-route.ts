import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { getSupabaseSpikeConfig } from "./supabase-spike-config";

export function createSupabaseSpikeRouteClient(request: NextRequest, response: NextResponse) {
  const config = getSupabaseSpikeConfig();
  if (!config) throw new Error("Supabase spike is not configured.");

  return createServerClient(config.url, config.publishableKey, {
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
      },
    },
  });
}
