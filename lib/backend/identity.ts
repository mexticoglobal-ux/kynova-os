// Identity: the link between what Supabase Auth gives the app and what the Backend Core works with. The sign-in itself (OTP, session cookie, refresh in the middleware,
// sign-out, protected routes) already exists and is not touched here. This only maps its result: the verified claims and the active membership become a
// TenantContext (tenant_id, organization_id, user_id, role_id) and an AuthSession, and the role of that context answers `canUser` / `canUse` with the same
// rules the database uses (private.can_write, private.is_admin) and the module permissions of auth.ts. It never reads or holds a token.
import { can, type MembershipDto, type Role } from "@/lib/contracts/backend";
import { canDo, type AuthSession, type ModuleAction } from "./auth";
import { parseTenantContext, type TenantContext } from "./entities";
import type { ModuleId } from "./events";

/** The claims of a verified Supabase access token that this needs. The middleware verifies them (getClaims); this never checks a signature. */
export type Claims = { sub?: string | undefined; exp?: number | undefined; iat?: number | undefined };

/**
 * Who is acting and for which company, from the person and the membership of the company they work in. Anything missing or malformed gives `null`:
 * there is no default company. The organization of a company is not modelled yet, so it is `null`.
 */
export function tenantContextFrom(userId: string | undefined, active: Pick<MembershipDto, "tenantId" | "role"> | null): TenantContext | null {
  if (!userId || !active) return null;
  return parseTenantContext({ tenantId: active.tenantId, organizationId: null, userId, roleId: active.role });
}

/** The session the route rules reason about, from the verified claims and the active membership. `null` without a person or without a usable expiry. */
export function authSessionFrom(claims: Claims, active: Pick<MembershipDto, "tenantId" | "role"> | null): AuthSession | null {
  if (!claims.sub || typeof claims.exp !== "number") return null;
  return {
    userId: claims.sub, tenantId: active?.tenantId ?? null, role: active?.role ?? null,
    issuedAt: new Date((claims.iat ?? claims.exp) * 1_000).toISOString(), expiresAt: new Date(claims.exp * 1_000).toISOString(),
  };
}

/** Whether the person may do an action in a module of the platform. Without a context nobody may do anything. */
export const canUser = (context: TenantContext | null, module: ModuleId, action: ModuleAction): boolean => context !== null && canDo(context.roleId as Role, module, action);
/** Whether the person may use a module at all: the right to read it. */
export const canUse = (context: TenantContext | null, module: ModuleId): boolean => canUser(context, module, "read");
/** The same question the database asks to let someone write: the roles private.can_write accepts. */
export const canWriteTenant = (context: TenantContext | null): boolean => context !== null && can(context.roleId as Role, "write");

/** Why a call made for `tenantId` is refused for this person, or `null` when it may go on: the company of the call must be the company of the signed-in person. */
export function tenantMismatch(context: TenantContext | null, tenantId: string): string | null {
  if (context === null) return "No hay una sesión con empresa: ninguna operación corre sin ella.";
  return context.tenantId === tenantId ? null : "La operación es de otra empresa que la de la sesión.";
}
