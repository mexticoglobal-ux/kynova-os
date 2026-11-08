// Auth architecture: the session lifecycle (login, refresh, logout), which routes are protected and by whom, and the permission of each role in each
// module. It PREPARES the rules and reuses what already exists: the roles and `can` of lib/contracts/backend.ts and the protected paths of
// lib/auth/paths.ts. It changes neither the middleware nor the login that works today, and it never touches a token: it only reasons about a
// session that someone else holds.
import { APP_PATHS, safeNext } from "@/lib/auth/paths";
import { ROLES, can, type Permission, type Role } from "@/lib/contracts/backend";
import type { ModuleId } from "./events";

export type AuthSession = { userId: string; tenantId: string | null; role: Role | null; issuedAt: string; expiresAt: string };

export const SESSION_REFRESH_SKEW_SECONDS = 120; // a session is renewed this long before it ends

/** valid: use it. refresh: still good but about to end, renew it. expired: the person must sign in again. */
export type SessionState = "valid" | "refresh" | "expired";
export function sessionState(session: Pick<AuthSession, "expiresAt">, now: string): SessionState {
  const left = Date.parse(session.expiresAt) - Date.parse(now);
  if (Number.isNaN(left) || left <= 0) return "expired";
  return left <= SESSION_REFRESH_SKEW_SECONDS * 1_000 ? "refresh" : "valid";
}

/** The steps of each flow, declared. They are carried out by the sign-in that exists; this is the contract any replacement must keep. */
export const AUTH_FLOWS = {
  login: ["pedir el enlace o código al correo", "validar el origen permitido", "intercambiar el código por una sesión", "guardar la sesión en una cookie httpOnly", "elegir la empresa activa"],
  refresh: ["comprobar el estado de la sesión", "renovar con el token de refresco", "reemplazar la cookie", "si falla, tratarla como expirada"],
  logout: ["revocar la sesión en el servidor", "borrar la cookie", "volver a /login"],
} as const;

// ---------------------------------------------------------------- permissions by module
export type ModuleAction = "read" | "write" | "admin";
/** The lowest permission each action needs in each module. A module that is not listed follows the default: read, write and admin. */
const MODULE_PERMISSIONS: Partial<Record<ModuleId, Partial<Record<ModuleAction, Permission>>>> = {
  billing: { write: "admin", admin: "owner" }, // money: administrators change it, only the owner decides who administers it
  developer: { write: "admin", admin: "admin" }, // credentials
  organizations: { write: "admin", admin: "admin" },
  users: { write: "admin", admin: "admin" },
  workers: { write: "write", admin: "admin" },
};
export const permissionFor = (module: ModuleId, action: ModuleAction): Permission => MODULE_PERMISSIONS[module]?.[action] ?? action;
/** Whether a role may do an action in a module. No role (not signed in, or not in the company) may do nothing. */
export const canDo = (role: Role | null | undefined, module: ModuleId, action: ModuleAction): boolean => can(role, permissionFor(module, action));

export type PermissionMatrix = Record<ModuleId, Record<Role, Record<ModuleAction, boolean>>>;
export function permissionMatrix(modules: readonly ModuleId[]): PermissionMatrix {
  const out = {} as PermissionMatrix;
  for (const area of modules) {
    out[area] = {} as PermissionMatrix[ModuleId];
    for (const role of ROLES) out[area][role] = { read: canDo(role, area, "read"), write: canDo(role, area, "write"), admin: canDo(role, area, "admin") };
  }
  return out;
}

// ---------------------------------------------------------------- protected routes
export type RouteRule = { prefix: string; needs: Permission };
/** More specific rules first. A path under a protected area that is not listed here needs the right to read. */
export const ROUTE_RULES: readonly RouteRule[] = [
  { prefix: "/platform/billing", needs: "admin" },
  { prefix: "/platform/developers", needs: "admin" },
  { prefix: "/platform/org", needs: "read" },
  { prefix: "/settings", needs: "admin" },
];

export const isProtectedPath = (pathname: string): boolean => APP_PATHS.some((prefix) => pathname === `/${prefix}` || pathname.startsWith(`/${prefix}/`));
export const requiredPermission = (pathname: string): Permission => ROUTE_RULES.find((rule) => pathname === rule.prefix || pathname.startsWith(`${rule.prefix}/`))?.needs ?? "read";

export type RouteDecision =
  | { action: "allow" }
  | { action: "login"; redirectTo: string }
  | { action: "onboarding" }
  | { action: "forbidden"; needs: Permission };

/** What to do with a request: let it through, send the person to sign in, to create their company, or refuse it. */
export function authorizeRoute(pathname: string, session: AuthSession | null, now: string): RouteDecision {
  if (!isProtectedPath(pathname)) return { action: "allow" };
  if (!session || sessionState(session, now) === "expired") return { action: "login", redirectTo: `/login?next=${encodeURIComponent(safeNext(pathname))}` };
  if (!session.tenantId || !session.role) return { action: "onboarding" };
  const needs = requiredPermission(pathname);
  return can(session.role, needs) ? { action: "allow" } : { action: "forbidden", needs };
}
