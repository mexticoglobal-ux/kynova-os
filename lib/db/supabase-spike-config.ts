export type SupabaseSpikeConfig = {
  url: string;
  publishableKey: string;
  canaryConfigured: boolean;
};

// Origins that may start a sign-in. The magic link in the email returns to `<origin>/api/spike/auth/callback`
// (ADR-0008), so the origin must never come from an untrusted value: request.url is derived from headers.
// Supabase's Redirect URLs allow-list is a second, independent layer; both must list a new origin.
// Browse local runs as `localhost`, never `127.0.0.1`: Next resolves request.url to localhost, so the
// Origin header would not match and the emailed link would open on another host than the PKCE cookie.
export const SPIKE_ALLOWED_ORIGINS: readonly string[] = [
  "http://localhost:3000", // next dev
  "http://localhost:8787", // wrangler dev (npm run preview)
  "https://kynova-os-preview.novamarketingstudiocr.workers.dev", // Preview Worker (ADR-0002)
];

export const SPIKE_CALLBACK_PATH = "/api/spike/auth/callback";

/** The fixed callback URL for a trusted request origin, or null when the origin is not allowed. */
export function spikeCallbackUrl(requestUrl: string): string | null {
  try {
    const { origin } = new URL(requestUrl);
    return SPIKE_ALLOWED_ORIGINS.includes(origin) ? `${origin}${SPIKE_CALLBACK_PATH}` : null;
  } catch {
    return null;
  }
}

export function getSupabaseSpikeConfig(): SupabaseSpikeConfig | null {
  const url = process.env.SUPABASE_URL?.trim();
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") return null;
  } catch {
    return null;
  }

  return { url, publishableKey, canaryConfigured: Boolean(process.env.SPIKE_SECRET_CANARY) };
}
