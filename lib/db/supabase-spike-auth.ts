import type { SupabaseClient } from "@supabase/supabase-js";

export type VerifiedSpikeUser = { id: string; email: string };

// Authorization must ask Supabase Auth whether the session still exists. getClaims() verifies asymmetric JWTs
// locally (signature and exp only), so a copied access token from a session that was already signed out would keep
// authorizing requests until it expires (A1/B4). getUser() sends the token to Auth, which rejects a revoked session.
// Costs one Auth round trip per protected request; middleware keeps using getClaims() only to refresh cookies.
//
// An Auth outage is not a sign-out: network and 5xx failures throw (callers map that to 503 or an error page)
// instead of returning null, so the person is not told they are unauthenticated. Both outcomes fail closed.
export async function getVerifiedSpikeUser(supabase: Pick<SupabaseClient, "auth">): Promise<VerifiedSpikeUser | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    const status = (error as { status?: unknown }).status;
    if (error.name === "AuthRetryableFetchError" || (typeof status === "number" && status >= 500)) {
      throw new Error("Supabase Auth is unavailable.");
    }
    return null;
  }
  const user = data?.user;
  if (!user?.id) return null;
  return { id: user.id, email: user.email ?? "" };
}
