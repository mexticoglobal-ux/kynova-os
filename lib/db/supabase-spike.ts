import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseSpikeConfig } from "./supabase-spike-config";

export { getSupabaseSpikeConfig } from "./supabase-spike-config";
export const SPIKE_EMAIL_COOKIE = "kynova_spike_email_v2";
export const SPIKE_EMAIL_COOKIE_PATH = "/";

// One definition for setting and clearing the temporary email cookie: a cookie is only removed
// when the clearing Set-Cookie uses the same name and path it was created with.
export function spikeEmailCookieOptions(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: SPIKE_EMAIL_COOKIE_PATH, maxAge };
}

export async function createSupabaseSpikeServerClient() {
  const config = getSupabaseSpikeConfig();
  if (!config) throw new Error("Supabase spike is not configured.");

  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Components cannot write cookies; middleware refreshes the session for this spike.
        }
      },
    },
  });
}
