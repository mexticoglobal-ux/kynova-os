import { NextResponse } from "next/server";
import { readSpikeItems } from "@/lib/db/spike-items";
import { createSupabaseSpikeServerClient, getSupabaseSpikeConfig } from "@/lib/db/supabase-spike";
import { noStore } from "@/lib/db/supabase-spike-http";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  if (!getSupabaseSpikeConfig()) return noStore(NextResponse.json({ error: "spike_not_configured" }, { status: 503 }));

  try {
    const supabase = await createSupabaseSpikeServerClient();
    const { data: auth, error: authError } = await supabase.auth.getClaims();
    if (authError || !auth?.claims?.sub) return noStore(NextResponse.json({ error: "unauthorized" }, { status: 401 }));

    const result = await readSpikeItems(supabase);
    if (result.status === "unavailable") return noStore(NextResponse.json({ error: "spike_data_unavailable" }, { status: 503 }));
    // A valid session in an environment without the optional table: not a failure, and explicitly not an isolation result.
    if (result.status === "not_provisioned") return noStore(NextResponse.json({ items: [], provisioned: false }, { status: 200 }));
    return noStore(NextResponse.json({ items: result.items }, { status: 200 }));
  } catch {
    return noStore(NextResponse.json({ error: "spike_data_unavailable" }, { status: 503 }));
  }
}
