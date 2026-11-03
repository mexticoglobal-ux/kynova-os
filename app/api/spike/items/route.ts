import { NextResponse } from "next/server";
import { createSupabaseSpikeServerClient, getSupabaseSpikeConfig } from "@/lib/db/supabase-spike";
import { getVerifiedSpikeUser } from "@/lib/db/supabase-spike-auth";
import { noStore } from "@/lib/db/supabase-spike-http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  if (!getSupabaseSpikeConfig()) return noStore(NextResponse.json({ error: "spike_not_configured" }, { status: 503 }));

  try {
    const supabase = await createSupabaseSpikeServerClient();
    if (!(await getVerifiedSpikeUser(supabase))) return noStore(NextResponse.json({ error: "unauthorized" }, { status: 401 }));

    // No tenant filter: this endpoint exists to exercise the database RLS policies.
    const { data, error } = await supabase.from("spike_items").select("id, tenant_id, label").order("label");
    if (error) return noStore(NextResponse.json({ error: "spike_data_unavailable" }, { status: 503 }));
    return noStore(NextResponse.json({ items: data ?? [] }, { status: 200 }));
  } catch {
    return noStore(NextResponse.json({ error: "spike_data_unavailable" }, { status: 503 }));
  }
}
