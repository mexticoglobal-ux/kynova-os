import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSupabaseSpikeConfig, createSupabaseSpikeServerClient } from "@/lib/db/supabase-spike";
import type { SupabaseSpikeStatus } from "@/lib/contracts/supabase-spike";
import { SpikeLoginForm } from "./SpikeLoginForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Supabase spike", robots: { index: false, follow: false } };

const STATUSES: readonly SupabaseSpikeStatus[] = ["setup", "sent", "required", "signed_out", "error"];

export default async function SupabaseSpikeLoginPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const config = getSupabaseSpikeConfig();
  const params = await searchParams;
  const status = config && STATUSES.includes(params.status as SupabaseSpikeStatus) ? (params.status as SupabaseSpikeStatus) : config ? "error" : "setup";

  let authenticated = false;
  if (config) {
    try {
      const supabase = await createSupabaseSpikeServerClient();
      const { data, error } = await supabase.auth.getClaims();
      authenticated = !error && Boolean(data?.claims?.sub);
    } catch {
      // Render the login screen; the next request will show a generic error if auth is unavailable.
    }
  }
  // redirect() works by throwing, so it must stay outside the try/catch above.
  if (authenticated) redirect("/spike");

  return <SpikeLoginForm status={status} />;
}
