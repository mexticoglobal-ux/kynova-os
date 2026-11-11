/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newKoeState } from "@/lib/contracts/platform/koe-engine";
import { APP_PATHS } from "@/lib/auth/paths";
import { ROLES, can, type MembershipDto, type Role } from "@/lib/contracts/backend";
import { ROUTE_RULES, SESSION_REFRESH_SKEW_SECONDS, authorizeRoute, canDo, isProtectedPath, permissionMatrix, sessionState, requiredPermission } from "./auth";
import { DATA_AREAS, parseTenantContext, tenantFilter, type TenantContext } from "./entities";
import { EventBus, InMemoryEventStore, MODULE_IDS } from "./events";
import { authSessionFrom, canUse, canUser, canWriteTenant, tenantContextFrom, tenantMismatch } from "./identity";
import { createBackendCore } from "./index";
import { connectPlatform } from "./integration";
import { policiesFor } from "./rls";
import { entityOf } from "./entities";

const T1 = "20000000-0000-4000-8000-0000000000b1";
const T2 = "20000000-0000-4000-8000-0000000000b2";
const USER = "20000000-0000-4000-8000-000000000001";
const NOW = "2026-11-10T12:00:00.000Z";
const membership = (tenantId: string, role: Role): MembershipDto => ({ tenantId, name: "Empresa", slug: null, role });
const SQL = readdirSync(join(process.cwd(), "supabase", "migrations")).map((name) => readFileSync(join(process.cwd(), "supabase", "migrations", name), "utf8")).join("\n");
const claims = (secondsLeft: number) => ({ sub: USER, iat: Date.parse(NOW) / 1_000 - 100, exp: Date.parse(NOW) / 1_000 + secondsLeft });

// ================================================================ from Supabase Auth to the Backend Core
describe("identity: what Supabase Auth gives, as what the Backend Core works with", () => {
  it("turns a person and the company they work in into a tenant context, and refuses anything incomplete or malformed", () => {
    const context = tenantContextFrom(USER, membership(T1, "admin"))!;
    expect(context).toEqual({ tenantId: T1, organizationId: null, userId: USER, roleId: "admin" });
    expect(parseTenantContext(context)).toEqual(context);
    expect(tenantFilter(context)).toEqual({ tenant_id: T1 });
    expect(tenantContextFrom(undefined, membership(T1, "admin"))).toBeNull();
    expect(tenantContextFrom(USER, null)).toBeNull();
    expect(tenantContextFrom("not-a-uuid", membership(T1, "admin"))).toBeNull();
    expect(tenantContextFrom(USER, membership("not-a-uuid", "admin"))).toBeNull();
    expect(tenantContextFrom(USER, { tenantId: T1, role: "boss" as Role })).toBeNull();
  });

  it("builds the session the route rules reason about from verified claims, and never from a token", () => {
    const session = authSessionFrom(claims(900), membership(T1, "member"))!;
    expect(session).toMatchObject({ userId: USER, tenantId: T1, role: "member", expiresAt: new Date(Date.parse(NOW) + 900_000).toISOString() });
    expect(authSessionFrom(claims(900), null)).toMatchObject({ tenantId: null, role: null });
    expect(authSessionFrom({ sub: undefined, exp: 1 }, null)).toBeNull();
    expect(authSessionFrom({ sub: USER }, null)).toBeNull();
    expect(JSON.stringify(session)).not.toMatch(/token|jwt|secret/i);
    expect(readFileSync(join(process.cwd(), "lib", "backend", "identity.ts"), "utf8").replace(/\/\/.*$/gm, "")).not.toMatch(/access_token|refresh_token|cookies\(|getSession|setSession/);
  });

  it("follows the life of a session: valid, to refresh shortly before it ends, and expired", () => {
    expect(sessionState(authSessionFrom(claims(3_600), null)!, NOW)).toBe("valid");
    expect(sessionState(authSessionFrom(claims(SESSION_REFRESH_SKEW_SECONDS), null)!, NOW)).toBe("refresh");
    expect(sessionState(authSessionFrom(claims(-1), null)!, NOW)).toBe("expired");
  });
});

// ================================================================ canUser / canUse, with the same rules the database uses
describe("canUser and canUse", () => {
  it("answer for every role in every module exactly as the permission matrix says", () => {
    const matrix = permissionMatrix(MODULE_IDS);
    for (const role of ROLES) {
      const context = tenantContextFrom(USER, membership(T1, role));
      for (const area of MODULE_IDS) {
        for (const action of ["read", "write", "admin"] as const) expect(canUser(context, area, action), `${role}/${area}/${action}`).toBe(matrix[area][role][action]);
        expect(canUse(context, area), `${role}/${area}`).toBe(matrix[area][role].read);
      }
    }
  });

  it("let nobody do anything without a company, and keep money and credentials for administrators and the owner", () => {
    for (const area of MODULE_IDS) { expect(canUse(null, area)).toBe(false); expect(canUser(null, area, "read")).toBe(false); }
    const as = (role: Role) => tenantContextFrom(USER, membership(T1, role));
    expect(canUser(as("viewer"), "billing", "read")).toBe(true);
    expect(canUser(as("viewer"), "crm", "write")).toBe(false);
    expect(canUser(as("member"), "crm", "write")).toBe(true);
    expect(canUser(as("member"), "billing", "write")).toBe(false);
    expect(canUser(as("admin"), "billing", "write")).toBe(true);
    expect(canUser(as("admin"), "billing", "admin")).toBe(false);
    expect(canUser(as("owner"), "billing", "admin")).toBe(true);
    expect(canUser(as("member"), "developer", "write")).toBe(false);
    expect(canUser(as("admin"), "developer", "admin")).toBe(true);
  });

  it("agree with the roles the database accepts: private.can_write and private.is_admin list the same roles as the code", () => {
    const rolesOf = (fn: string) => [...(new RegExp(`create function private\\.${fn}\\([^)]*\\)[\\s\\S]*?array\\[([^\\]]*)\\]`).exec(SQL)?.[1] ?? "").matchAll(/'(\w+)'/g)].map((match) => match[1] as Role);
    const writers = rolesOf("can_write");
    const admins = rolesOf("is_admin");
    expect(writers.sort()).toEqual(ROLES.filter((role) => can(role, "write")).sort());
    expect(admins.sort()).toEqual(ROLES.filter((role) => can(role, "admin")).sort());
    for (const role of ROLES) expect(canWriteTenant(tenantContextFrom(USER, membership(T1, role))), role).toBe(writers.includes(role));
    expect(canWriteTenant(null)).toBe(false);
    // the database knows the same four roles: together, the role checks of its tables name exactly the roles of the code
    const named = new Set([...SQL.matchAll(/role (?:text )?(?:not null )?(?:default '\w+' )?check \(role in \(([^)]*)\)/g)].flatMap((match) => [...(match[1] ?? "").matchAll(/'(\w+)'/g)].map((item) => item[1]!)));
    expect([...named].sort()).toEqual([...ROLES].sort());
  });

  it("use the module names of the data contract: every area of the platform has its answer", () => {
    for (const area of DATA_AREAS) expect(MODULE_IDS).toContain(area);
    for (const role of ROLES) expect(canDo(role, "billing", "read")).toBe(true);
  });
});

// ================================================================ the whole chain of authentication
describe("the chain: sign-in, session, protected routes, company, role, Backend Core, RLS", () => {
  it("protects every screen of the app, sends a person without a session to sign in, a person without a company to onboarding, and refuses a role that lacks the right", () => {
    const owner = authSessionFrom(claims(3_600), membership(T1, "owner"));
    const viewer = authSessionFrom(claims(3_600), membership(T1, "viewer"));
    const noCompany = authSessionFrom(claims(3_600), null);
    for (const prefix of APP_PATHS) {
      const path = `/${prefix}`;
      expect(isProtectedPath(path), path).toBe(true);
      expect(authorizeRoute(path, null, NOW), path).toEqual({ action: "login", redirectTo: `/login?next=${encodeURIComponent(path === "/onboarding" ? "/dashboard" : path)}` });
      expect(authorizeRoute(path, authSessionFrom(claims(-5), membership(T1, "owner")), NOW).action, path).toBe("login");
      expect(authorizeRoute(path, noCompany, NOW), path).toEqual({ action: "onboarding" });
      expect(authorizeRoute(path, owner, NOW).action, path).toBe("allow");
    }
    for (const rule of ROUTE_RULES) {
      expect(authorizeRoute(rule.prefix, owner, NOW).action).toBe("allow");
      expect(authorizeRoute(rule.prefix, viewer, NOW).action).toBe(rule.needs === "read" ? "allow" : "forbidden");
      expect(requiredPermission(`${rule.prefix}/anything`)).toBe(rule.needs);
    }
    for (const open of ["/", "/login", "/design-system", "/api/health"]) expect(authorizeRoute(open, null, NOW)).toEqual({ action: "allow" });
  });

  it("keeps the middleware matcher and the protected paths in step: every protected path is guarded", () => {
    const middleware = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
    for (const prefix of APP_PATHS) expect(middleware, prefix).toContain(`"/${prefix}"`);
    expect(middleware).toContain("getClaims");
    expect(middleware).toContain("redirect(`/login?next=");
  });

  it("carries the company of the session through every call: a call for another company, or without a session, is refused before the module is touched", async () => {
    const core = createBackendCore({ vars: {}, now: () => Date.parse(NOW) });
    const platform = connectPlatform(core);
    const context = tenantContextFrom(USER, membership(T1, "admin"))!;
    const event = (tenantId: string) => ({ type: "worker.enable", at: NOW, tenantId, actor: "ana", definitionId: "sales" }) as const;
    const state = newKoeState(["admin:ana"]);
    const allowed = await platform.run("workers", state, event(T1), context);
    expect(allowed.error).toBeUndefined();
    const other = await platform.run("workers", state, event(T2), context);
    expect(other).toMatchObject({ errorCode: "tenantMismatch" });
    expect(other.state).toBe(state);
    expect(await platform.run("workers", state, event(T1), null)).toMatchObject({ errorCode: "tenantMismatch" });
    expect(platform.stats.violations).toBe(2);
    expect((await core.events()).store.read({ tenantId: T2, after: 0, limit: 10 })).toHaveLength(0);
    expect((await core.audit()).list(T1).length).toBeGreaterThan(0);
    expect(tenantMismatch(context, T1)).toBeNull();
    expect(tenantMismatch(context, T2)).toMatch(/otra empresa/);
    expect(tenantMismatch(null, T1)).toMatch(/sin ella/);
  });

  it("ends in RLS: the tables the Backend Core writes are per company, members read them, and their policy is the company membership the session came from", () => {
    for (const table of ["platform_events", "platform_audit", "storage_objects"]) {
      const entity = entityOf(table)!;
      expect(entity.scope).toBe("tenant");
      const select = policiesFor(entity).find((policy) => policy.command === "select")!;
      expect(select.using).toContain("private.is_member(tenant_id)");
      expect(policiesFor(entity).every((policy) => policy.command === "select" || entity.rls !== "read")).toBe(true);
    }
    // the function every policy reads: membership of the signed-in user, in an active company
    expect(SQL).toMatch(/create function private\.is_member\(target_tenant uuid\)[\s\S]*?m\.user_id = \(select auth\.uid\(\)\)[\s\S]*?t\.status = 'active'/);
  });

  it("gives one company's event no power over another's: the same event id in two companies is two events", () => {
    const bus = new EventBus(new InMemoryEventStore(), () => NOW);
    const publish = (tenantId: string) => bus.publish({ id: "same-id", type: "crm.audit.recorded", module: "crm", tenantId, actor: "ana", payload: { action: "a", category: "b" } });
    expect(publish(T1)).toMatchObject({ ok: true, duplicate: false });
    expect(publish(T2)).toMatchObject({ ok: true, duplicate: false });
    expect(publish(T1)).toMatchObject({ ok: true, duplicate: true });
    expect(bus.store.read({ tenantId: T1 })).toHaveLength(1);
    expect(bus.store.read({ tenantId: T2 })).toHaveLength(1);
  });
});

// ================================================================ the rules, in the code
describe("identity in the code", () => {
  it("is read by no module: nothing outside the Backend Core imports it, and it touches no token, cookie or network", () => {
    const source = readFileSync(join(process.cwd(), "lib", "backend", "identity.ts"), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(source).not.toMatch(/\bfetch\(|process\.env|next\/headers|supabase-js|@supabase\/ssr/);
    const context: TenantContext = tenantContextFrom(USER, membership(T1, "owner"))!;
    expect(Object.keys(context).sort()).toEqual(["organizationId", "roleId", "tenantId", "userId"]);
  });
});
