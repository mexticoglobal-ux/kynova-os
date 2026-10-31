// Data access for tenancy and the business profile (ADR-0006). Server only.
// Every function receives the signed-in user's client (the user's JWT travels to the database), so RLS
// decides what is visible and writable. The secret/service-role key is never used here. Each query also
// filters by tenant_id explicitly: RLS is the guarantee, the filter is defense in depth.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  QUESTIONNAIRE_VERSION,
  parseBusinessProfileRow,
  parseMembershipRow,
  type BusinessProfile,
  type BusinessProfileInput,
  type TenantMembership,
} from "@/lib/contracts/tenancy";

export type TenancyFailure = "unavailable" | "forbidden" | "conflict" | "unauthorized";
export type TenancyResult<T> = { ok: true; data: T } | { ok: false; reason: TenancyFailure };

const PROFILE_COLUMNS =
  "tenant_id, trade_name, country, locale, sector, team_size, channel, crm, problem, goal, questionnaire_version, created_at, updated_at";

const ok = <T>(data: T): TenancyResult<T> => ({ ok: true, data });
const fail = <T>(reason: TenancyFailure): TenancyResult<T> => ({ ok: false, reason });

// PostgREST forwards the Postgres SQLSTATE (or its own PGRST code) in `code`.
function failureOf(error: { code?: string } | null | undefined): TenancyFailure {
  const code = error?.code;
  if (code === "42501") return "forbidden"; // RLS violation or missing privilege
  if (code === "23505") return "conflict"; // unique_violation: a profile already exists
  if (typeof code === "string" && code.startsWith("PGRST30")) return "unauthorized"; // expired or invalid JWT
  // Only the code is logged: never the message, which can carry values, and never user data.
  console.error("tenancy_query_failed", { code: code ?? null });
  return "unavailable";
}

function writableColumns(input: BusinessProfileInput) {
  return {
    trade_name: input.tradeName,
    country: input.country,
    locale: input.locale,
    sector: input.sector,
    team_size: input.teamSize,
    channel: input.channel,
    crm: input.crm,
    problem: input.problem,
    goal: input.goal,
    questionnaire_version: QUESTIONNAIRE_VERSION,
  };
}

/**
 * The signed-in user's company: their oldest membership, with tenant_id as a deterministic tiebreak
 * (memberships created in one statement share created_at). Selecting between several is a later feature.
 */
export async function getMyTenant(client: SupabaseClient): Promise<TenancyResult<TenantMembership | null>> {
  const { data, error } = await client
    .from("memberships")
    .select("tenant_id, role, tenants(name)")
    .order("created_at", { ascending: true })
    .order("tenant_id", { ascending: true })
    .limit(1);
  if (error) return fail(failureOf(error));

  const row = data?.[0];
  if (!row) return ok(null);
  const membership = parseMembershipRow(row);
  return membership ? ok(membership) : fail("unavailable");
}

export async function getBusinessProfile(client: SupabaseClient, tenantId: string): Promise<TenancyResult<BusinessProfile | null>> {
  const { data, error } = await client.from("business_profiles").select(PROFILE_COLUMNS).eq("tenant_id", tenantId).maybeSingle();
  if (error) return fail(failureOf(error));
  if (!data) return ok(null);

  const profile = parseBusinessProfileRow(data);
  return profile ? ok(profile) : fail("unavailable");
}

async function insertProfile(
  client: SupabaseClient,
  userId: string,
  tenantId: string,
  input: BusinessProfileInput,
): Promise<TenancyResult<BusinessProfile>> {
  const { data, error } = await client
    .from("business_profiles")
    .insert({ tenant_id: tenantId, ...writableColumns(input), created_by: userId, updated_by: userId })
    .select(PROFILE_COLUMNS)
    .single();
  if (error) return fail(failureOf(error));
  const created = parseBusinessProfileRow(data);
  return created ? ok(created) : fail("unavailable");
}

async function updateProfile(
  client: SupabaseClient,
  userId: string,
  tenantId: string,
  input: BusinessProfileInput,
): Promise<TenancyResult<BusinessProfile>> {
  const { data, error } = await client
    .from("business_profiles")
    .update({ ...writableColumns(input), updated_by: userId })
    .eq("tenant_id", tenantId)
    .select(PROFILE_COLUMNS)
    .maybeSingle();
  if (error) return fail(failureOf(error));
  // RLS hides rows the caller may not update: zero rows affected means "not allowed", not "missing".
  if (!data) return fail("forbidden");
  const updated = parseBusinessProfileRow(data);
  return updated ? ok(updated) : fail("unavailable");
}

/**
 * Creates or updates the tenant's profile. Only an owner can do either: the database rejects the rest
 * ("forbidden"). tenant_id and created_by are written once, on insert, and never updated.
 * The save is idempotent: if a concurrent first save created the profile between the lookup and the
 * insert (unique tenant_id), the same input is applied as an update instead of failing.
 */
export async function saveBusinessProfile(
  client: SupabaseClient,
  userId: string,
  tenantId: string,
  input: BusinessProfileInput,
): Promise<TenancyResult<BusinessProfile>> {
  const existing = await client.from("business_profiles").select("tenant_id").eq("tenant_id", tenantId).maybeSingle();
  if (existing.error) return fail(failureOf(existing.error));
  if (existing.data) return updateProfile(client, userId, tenantId, input);

  const created = await insertProfile(client, userId, tenantId, input);
  if (!created.ok && created.reason === "conflict") return updateProfile(client, userId, tenantId, input);
  return created;
}
