// Safe diagnostics for a failed call to Supabase Auth (the sign-in routes). The person only sees a generic answer; the server log keeps what is needed to find the cause: the error's NAME, HTTP STATUS and
// CODE, the host the app is configured to call and the SHAPE of the publishable key. Never a key, a token, a one-time code, an email or the provider's message (a message can quote a header value).

export type SupabaseKeyKind = "publishable" | "secret" | "anon_jwt" | "service_role_jwt" | "other_jwt" | "unknown" | "missing";

/** Only printable ASCII without spaces can travel in an HTTP header: anything else makes the request fail before it leaves. */
const HEADER_SAFE = /^[\x21-\x7e]+$/;

export function describeSupabaseKey(key: string | undefined): SupabaseKeyKind {
  if (!key) return "missing";
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("sb_secret_")) return "secret";
  const parts = key.split(".");
  if (parts.length !== 3) return "unknown";
  try {
    const payload = JSON.parse(atob((parts[1] as string).replace(/-/g, "+").replace(/_/g, "/"))) as { role?: unknown };
    return payload.role === "anon" ? "anon_jwt" : payload.role === "service_role" ? "service_role_jwt" : "other_jwt";
  } catch {
    return "unknown";
  }
}

export type AuthFailureReport = {
  where: string; name: string | null; status: number | null; code: string | null;
  urlHost: string | null; urlHeaderSafe: boolean; keyKind: SupabaseKeyKind; keyHeaderSafe: boolean;
  /** the SHAPE of the other configured values (never the values): enough to tell a badly pasted one */
  others: { serviceKeyKind: SupabaseKeyKind; serviceKeyHeaderSafe: boolean; googleClientIdShape: boolean; googleClientSecretShape: boolean; encryptionKeyShape: boolean };
};

function otherShapes(vars: Readonly<Record<string, string | undefined>>): AuthFailureReport["others"] {
  const read = (name: string) => vars[name]?.trim() ?? "";
  const service = read("SUPABASE_SERVICE_ROLE_KEY");
  const secret = read("GOOGLE_CLIENT_SECRET");
  return {
    serviceKeyKind: describeSupabaseKey(service || undefined),
    serviceKeyHeaderSafe: HEADER_SAFE.test(service),
    googleClientIdShape: /^[A-Za-z0-9._-]{10,200}\.apps\.googleusercontent\.com$/.test(read("GOOGLE_CLIENT_ID")),
    googleClientSecretShape: HEADER_SAFE.test(secret) && secret.length >= 10 && secret.length <= 200 && !secret.endsWith("apps.googleusercontent.com"),
    encryptionKeyShape: /^[A-Za-z0-9+/]{43}=$/.test(read("KYNOVA_ENCRYPTION_KEY")),
  };
}

export function authFailureReport(where: string, error: unknown, vars: Readonly<Record<string, string | undefined>> = process.env): AuthFailureReport {
  const source = (typeof error === "object" && error !== null ? error : {}) as { name?: unknown; status?: unknown; code?: unknown };
  const url = vars.SUPABASE_URL?.trim() ?? "";
  const key = vars.SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  let urlHost: string | null = null;
  try { urlHost = new URL(url).host; } catch { urlHost = null; }
  return {
    where,
    name: typeof source.name === "string" && /^[A-Za-z]{1,60}$/.test(source.name) ? source.name : null,
    status: typeof source.status === "number" && Number.isInteger(source.status) ? source.status : null,
    code: typeof source.code === "string" && /^[a-z0-9_]{1,60}$/i.test(source.code) ? source.code : null,
    urlHost,
    urlHeaderSafe: HEADER_SAFE.test(url),
    keyKind: describeSupabaseKey(key || undefined),
    keyHeaderSafe: HEADER_SAFE.test(key),
    others: otherShapes(vars),
  };
}

/** One line in the server log, nothing in the response. */
export function logAuthFailure(where: string, error: unknown): void {
  console.error("supabase_auth_failed", JSON.stringify(authFailureReport(where, error)));
}
