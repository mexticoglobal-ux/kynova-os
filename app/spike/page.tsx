import { redirect } from "next/navigation";
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

  // Deliberately do not filter by tenant_id: the database's RLS policies must isolate these rows.
  const { data: items, error } = await supabase.from("spike_items").select("id, tenant_id, label").order("label");
  const email = typeof auth?.claims?.email === "string" ? auth.claims.email : "";

  return <SpikeDashboard email={email} items={items ?? []} hasError={Boolean(error)} canaryConfigured={config.canaryConfigured} />;
}
