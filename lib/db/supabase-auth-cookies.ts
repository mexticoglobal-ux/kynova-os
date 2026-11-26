// The two kinds of cookie Supabase Auth keeps, and the rule that keeps an OLD session from destroying a NEW sign-in. Pure: used by the middleware and by the server clients.
//
// The defect (Preview, 2026-11-25): when a browser held a session that could no longer be renewed, the auth library removed it AND the PKCE verifier of the attempt in progress, so the emailed link could
// not be exchanged. The two rules:
//   1. keeping a session alive (middleware, server client) may remove a session, never a PKCE verifier: only the sign-in routes manage verifiers;
//   2. a sign-in route does not read the old session at all (nothing in it needs one), so there is nothing to renew or remove; when it writes the new session, whatever is left of the old one expires.
// Neither rule grants anything: a verifier is useless without the single-use code sent to the person's email, every protected page and route still asks the Auth server for the user, and an old session
// is still removed.

/** A session cookie, whole or split in chunks: `sb-<project>-auth-token` or `…-auth-token.0`. */
export const isSessionCookie = (name: string): boolean => /^sb-.+-auth-token(?:\.\d+)?$/.test(name);

/** A PKCE verifier of a sign-in in progress, in any of the library's forms (single, per flow, index of flows, chunked). */
export const isVerifierCookie = (name: string): boolean => /^sb-.+-auth-token(?:-flows|-flow-[A-Za-z0-9]+)?-code-verifier(?:\.\d+)?$/.test(name);

/** Rule 1: drops the removals of verifiers from a batch of cookie writes. Everything else (including the removal of a session) goes through. */
export const keepPendingSignIn = <T extends { name: string; value: string }>(cookies: readonly T[]): T[] =>
  cookies.filter((cookie) => !(isVerifierCookie(cookie.name) && cookie.value === ""));
