import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { isUuid, parseBusinessProfileInput } from "@/lib/contracts/tenancy";
import { createSupabaseSpikeServerClient, getSupabaseSpikeConfig } from "@/lib/db/supabase-spike";
import { hasSameOrigin, isWithinBodyLimit, noStore } from "@/lib/db/supabase-spike-http";
import { getBusinessProfile, getMyTenant, saveBusinessProfile, type TenancyFailure } from "@/lib/db/tenancy";

// First real tenant-scoped endpoint (ADR-0006, phase 1b). Handlers only orchestrate: validation lives in
// lib/contracts/tenancy.ts, data access in lib/db/tenancy.ts and isolation in the database (RLS).

export const dynamic = "force-dynamic";
export const revalidate = 0;

const fail = (code: string, status: number) => noStore(NextResponse.json({ error: code }, { status }));

const FAILURES: Record<TenancyFailure, () => NextResponse> = {
  unauthorized: () => fail("unauthorized", 401),
  forbidden: () => fail("forbidden", 403),
  conflict: () => fail("conflict", 409),
  unavailable: () => fail("unavailable", 503),
};

// Explicit discriminated union: inferred object-literal unions get optional `undefined` members and
// would not narrow.
type Session = { ok: true; supabase: SupabaseClient; userId: string } | { ok: false; response: NextResponse };

async function authenticate(): Promise<Session> {
  if (!getSupabaseSpikeConfig()) return { ok: false, response: fail("not_configured", 503) };
  try {
    const supabase = await createSupabaseSpikeServerClient();
    const { data, error } = await supabase.auth.getClaims();
    const userId = data?.claims?.sub;
    if (error || !isUuid(userId)) return { ok: false, response: fail("unauthorized", 401) };
    return { ok: true, supabase, userId };
  } catch {
    return { ok: false, response: fail("unavailable", 503) };
  }
}

export async function GET() {
  const session = await authenticate();
  if (!session.ok) return session.response;

  const tenant = await getMyTenant(session.supabase);
  if (!tenant.ok) return FAILURES[tenant.reason]();
  if (!tenant.data) return fail("no_tenant", 404);

  const profile = await getBusinessProfile(session.supabase, tenant.data.tenantId);
  if (!profile.ok) return FAILURES[profile.reason]();

  const { tenantId, name, role } = tenant.data;
  return noStore(NextResponse.json({ tenant: { id: tenantId, name, role }, profile: profile.data }));
}

export async function PUT(request: NextRequest) {
  if (!hasSameOrigin(request)) return fail("invalid_origin", 403);

  const session = await authenticate();
  if (!session.ok) return session.response;

  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return fail("unsupported_media_type", 415);
  if (!isWithinBodyLimit(request)) return fail("request_too_large", 413);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("invalid_request", 400);
  }
  // The tenant is never taken from the request: it comes from the caller's membership.
  const input = parseBusinessProfileInput(body);
  if (!input) return fail("invalid_profile", 400);

  const tenant = await getMyTenant(session.supabase);
  if (!tenant.ok) return FAILURES[tenant.reason]();
  if (!tenant.data) return fail("no_tenant", 404);

  const saved = await saveBusinessProfile(session.supabase, session.userId, tenant.data.tenantId, input);
  if (!saved.ok) return FAILURES[saved.reason]();

  const { tenantId, name, role } = tenant.data;
  return noStore(NextResponse.json({ tenant: { id: tenantId, name, role }, profile: saved.data }));
}
