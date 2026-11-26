import { redirect } from "next/navigation";
import { readSpikeItems } from "@/lib/db/spike-items";
import { createSupabaseSpikeServerClient, getSupabaseSpikeConfig } from "@/lib/db/supabase-spike";
import { SpikeDashboard } from "./SpikeDashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SupabaseSpikePage() {
  const config = getSupabaseSpikeConfig();
  if (!config) redirect("/spike/login?status=setup");

  const supabase = await createSupabaseSpikeServerClient();
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims?.sub) redirect("/spike/login?status=required");

  const result = await readSpikeItems(supabase);
  const email = typeof auth?.claims?.email === "string" ? auth.claims.email : "";

  return <SpikeDashboard email={email} result={result} canaryConfigured={config.canaryConfigured} />;
}
