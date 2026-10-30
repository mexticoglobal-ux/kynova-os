export type SupabaseSpikeConfig = {
  url: string;
  publishableKey: string;
  canaryConfigured: boolean;
};

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
