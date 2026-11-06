import { cookies } from "next/headers";
import { createBackend } from "@/lib/db/backend";
import { createSupabaseSpikeServerClient, getSupabaseSpikeConfig } from "@/lib/db/supabase-spike";
import { can, type MembershipDto, type Role, type SessionDto } from "@/lib/contracts/backend";
import { TENANT_COOKIE } from "./paths";

export type ServerSession =
  | { kind: "demo" }
  | { kind: "anonymous" }
  | { kind: "unavailable" }
  | { kind: "backend"; session: SessionDto; active: MembershipDto | null };

// The active company is a preference kept in a cookie and always re-checked against the memberships the database returns.
export function pickActive(memberships: readonly MembershipDto[], preferred: string | undefined): MembershipDto | null {
  return memberships.find((membership) => membership.tenantId === preferred) ?? memberships[0] ?? null;
}

export async function loadServerSession(): Promise<ServerSession> {
  if (!getSupabaseSpikeConfig()) return { kind: "demo" };
  try {
    const client = await createSupabaseSpikeServerClient();
    const { data, error } = await client.auth.getUser();
    if (error && (error.name === "AuthRetryableFetchError" || (typeof error.status === "number" && error.status >= 500))) return { kind: "unavailable" };
    if (error || !data.user) return { kind: "anonymous" };
    const session = await createBackend(client).bootstrap();
    const preferred = (await cookies()).get(TENANT_COOKIE)?.value;
    return { kind: "backend", session, active: pickActive(session.memberships, preferred) };
  } catch {
    return { kind: "unavailable" };
  }
}

export const roleCan = (role: Role | null, permission: Parameters<typeof can>[1]) => can(role, permission);
