import { NextResponse, type NextRequest } from "next/server";
import { BackendError, createBackend, type Backend, type BackendErrorCode } from "@/lib/db/backend";
import { createSupabaseSpikeServerClient, getSupabaseSpikeConfig } from "@/lib/db/supabase-spike";
import { hasSameOrigin, noStore } from "@/lib/db/supabase-spike-http";

// One wrapper for every /api/v1 route: configuration, same-origin writes, a verified user, a typed backend,
// and a single place that turns failures into status codes. Handlers only validate input and call the backend.

export type ApiContext = { db: Backend; userId: string; email: string | null; request: NextRequest };

const STATUS: Record<BackendErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  invalid: 422,
  limit: 429,
  unavailable: 503,
};

export const fail = (code: string, status: number) => noStore(NextResponse.json({ error: code }, { status }));
export const ok = (data: unknown = { ok: true }, status = 200) => noStore(NextResponse.json(data, { status }));

const MAX_BODY_BYTES = 262_144;

/** The JSON body, or undefined when it is missing, too large, not JSON or the wrong content type. */
export async function readBody(request: Request): Promise<unknown | undefined> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return undefined;
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) return undefined;
  try {
    const text = await request.text();
    return text.length > MAX_BODY_BYTES ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const invalid = () => fail("invalid_request", 400);

export function tenantParam(request: Request): string | null {
  const value = new URL(request.url).searchParams.get("tenantId");
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

type Params = Record<string, string>;

export function api<P extends Params = Params>(handler: (ctx: ApiContext, params: P) => Promise<Response>) {
  return async (request: NextRequest, route: { params: Promise<P> }): Promise<Response> => {
    if (!getSupabaseSpikeConfig()) return fail("not_configured", 503);
    if (request.method !== "GET" && request.method !== "HEAD" && !hasSameOrigin(request)) return fail("invalid_origin", 403);
    try {
      const client = await createSupabaseSpikeServerClient();
      // getUser asks the Auth server: a revoked session stops working here even if its token has not expired.
      const { data, error } = await client.auth.getUser();
      if (error && (error.name === "AuthRetryableFetchError" || (typeof error.status === "number" && error.status >= 500))) return fail("unavailable", 503);
      if (error || !data.user) return fail("unauthorized", 401);
      return await handler({ db: createBackend(client), userId: data.user.id, email: data.user.email ?? null, request }, await route.params);
    } catch (error) {
      if (error instanceof BackendError) return fail(error.code, STATUS[error.code]);
      return fail("unavailable", 503);
    }
  };
}

/** A string field of a parsed JSON body, or null. */
export function asText(body: unknown, key: string): string | null {
  if (typeof body !== "object" || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}
