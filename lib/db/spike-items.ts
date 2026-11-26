import type { createSupabaseSpikeServerClient } from "./supabase-spike";

type SpikeClient = Awaited<ReturnType<typeof createSupabaseSpikeServerClient>>;

export type SpikeItem = { id: string; tenant_id: string; label: string };
export type SpikeItemsResult = { status: "ok"; items: SpikeItem[] } | { status: "not_provisioned" } | { status: "unavailable" };

// The spike table is optional: no migration creates it (docs/supabase-spike/README.md). PostgREST reports a missing table with one of these:
// PGRST205 (not in the schema cache) or 42P01 (undefined table). Any other failure, permissions included, stays an error.
const MISSING_TABLE_CODES = new Set(["PGRST205", "42P01"]);

// Only the error code, and only when it looks like one: never the message, the details, the row data or the session.
function logFailure(code: unknown) {
  const safeCode = typeof code === "string" && /^[A-Z0-9]{1,12}$/.test(code) ? code : "unknown";
  console.error("spike_items_failed", JSON.stringify({ code: safeCode }));
}

export async function readSpikeItems(client: SpikeClient): Promise<SpikeItemsResult> {
  try {
    // Deliberately no tenant filter: the database's RLS policies must isolate these rows.
    const { data, error } = await client.from("spike_items").select("id, tenant_id, label").order("label");
    if (!error) return { status: "ok", items: (data ?? []) as SpikeItem[] };
    if (MISSING_TABLE_CODES.has(error.code)) return { status: "not_provisioned" };
    logFailure(error.code);
  } catch {
    logFailure(undefined);
  }
  return { status: "unavailable" };
}
