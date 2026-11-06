import { NextResponse, type NextRequest } from "next/server";
import { CHANNEL_STATUS, type ConversationChannel, type PaymentRail } from "@/lib/contracts/pipeline";
import { fail } from "@/lib/api/handler";
import { getChannelAdapter, getPaymentAdapter, isKnownProvider } from "@/lib/integrations/registry";
import { noStore } from "@/lib/db/supabase-spike-http";

export const dynamic = "force-dynamic";

// The single door for channel webhooks and payment notifications. It exists so integrations plug in without changing
// anything else; until an adapter is registered every provider answers 501 and nothing is read or stored.
export async function POST(_request: NextRequest, route: { params: Promise<{ provider: string }> }) {
  const { provider } = await route.params;
  if (!isKnownProvider(provider)) return fail("unknown_provider", 404);
  if (!getChannelAdapter(provider) && !getPaymentAdapter(provider)) {
    return noStore(NextResponse.json({ error: "not_implemented", provider, status: CHANNEL_STATUS[provider as ConversationChannel | PaymentRail] }, { status: 501 }));
  }
  return fail("not_implemented", 501);
}
