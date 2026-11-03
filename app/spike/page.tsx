import { redirect } from "next/navigation";
import { createSupabaseSpikeServerClient, getSupabaseSpikeConfig } from "@/lib/db/supabase-spike";
import { getVerifiedSpikeUser } from "@/lib/db/supabase-spike-auth";
import { SpikeDashboard } from "./SpikeDashboard";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function SupabaseSpikePage() {
  const config = getSupabaseSpikeConfig();
  if (!config) redirect("/spike/login?status=setup");

  const supabase = await createSupabaseSpikeServerClient();
  const user = await getVerifiedSpikeUser(supabase);
  if (!user) redirect("/spike/login?status=required");

  // Deliberately do not filter by tenant_id: the database's RLS policies must isolate these rows.
  const { data: items, error } = await supabase.from("spike_items").select("id, tenant_id, label").order("label");

  return <SpikeDashboard email={user.email} items={items ?? []} hasError={Boolean(error)} canaryConfigured={config.canaryConfigured} />;
}
