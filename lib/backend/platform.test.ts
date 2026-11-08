import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ROLES } from "@/lib/contracts/backend";
import { demoBillingOk } from "@/lib/contracts/platform/billing-demo";
import { demoDevOk } from "@/lib/contracts/platform/dev-demo";
import { demoOrgOk } from "@/lib/contracts/platform/org-demo";
import { APP_PATHS } from "@/lib/auth/paths";
import { AuditLog, GENESIS_HASH, actorKindOf, auditFromModuleEntry } from "./audit";
import { AUTH_FLOWS, ROUTE_RULES, authorizeRoute, canDo, isProtectedPath, permissionFor, permissionMatrix, requiredPermission, sessionState, type AuthSession } from "./auth";
import { DATA_AREAS, ENTITIES, ROLE_IDS, entitiesOf, entityOf, parseTenantContext, tenantFilter, withTenant } from "./entities";
import { EVENT_CATALOG, EventBus, InMemoryEventStore, MODULE_IDS, eventDef, eventFromEntry, publisherFor, validateEvent, type PlatformEvent } from "./events";
import { RLS_STATE, auditPolicies, plannedPolicies, policiesFor, renderPolicySql, renderRlsPreview } from "./rls";
import { BUCKETS, BUCKET_IDS, canAccessPath, parseStoragePath, signedUrlTtl, storagePath, validateUpload } from "./storage";

const T1 = "tenant-nova";
const T2 = "tenant-vida";
const AT = "2026-11-07T12:00:00.000Z";
const event = (over: Partial<PlatformEvent> = {}): PlatformEvent => ({ id: "evt_1", type: "crm.lead.created", version: 1, module: "crm", tenantId: T1, actor: "carla", at: AT, payload: { leadId: "ld_1", source: "web" }, ...over });
const migrations = () => readdirSync(join(process.cwd(), "supabase", "migrations")).filter((name) => name.endsWith(".sql")).map((name) => readFileSync(join(process.cwd(), "supabase", "migrations", name), "utf8"));
const sql = () => migrations().join("\n");

describe("the Event Bus", () => {
  it("has events for every module, each with a generic audit event", () => {
    for (const area of MODULE_IDS) {
      const own = EVENT_CATALOG.filter((item) => item.module === area);
      expect(own.length, area).toBeGreaterThanOrEqual(2);
      expect(eventDef(`${area}.audit.recorded`), area).toBeTruthy();
    }
    expect(new Set(EVENT_CATALOG.map((item) => item.type)).size).toBe(EVENT_CATALOG.length);
    for (const item of EVENT_CATALOG) expect(item.type.startsWith(`${item.module}.`), item.type).toBe(true);
  });

  it("validates an event: it must be known, of its module, for a company, and carry the right data", () => {
    expect(validateEvent(event())).toEqual([]);
    expect(validateEvent(event({ type: "crm.nope" }))).toEqual(["el evento «crm.nope» no está en el catálogo"]);
    expect(validateEvent(event({ module: "billing" }))[0]).toMatch(/es del módulo crm/);
    expect(validateEvent(event({ tenantId: "" }))).toContain("falta la empresa (tenantId)");
    expect(validateEvent(event({ payload: { leadId: "ld_1" } }))).toContain("falta el dato «source»");
    expect(validateEvent(event({ payload: { leadId: 7, source: "web" } }))).toContain("el dato «leadId» debe ser string");
    expect(validateEvent(event({ payload: { leadId: "a", source: "b", extra: 1 } }))).toContain("el dato «extra» no existe en crm.lead.created");
    expect(validateEvent(event({ at: "ayer" }))).toContain("la fecha no es válida");
    expect(validateEvent(event({ actor: " " }))).toContain("falta quién lo hizo");
  });

  it("never lets a credential travel in an event", () => {
    const problems = validateEvent(event({ type: "developer.key.created", module: "developer", payload: { keyId: "k", appId: "a", apiKey: "x" } }));
    expect(problems.some((item) => item.includes("parece una credencial"))).toBe(true);
    const audit = validateEvent(event({ type: "crm.audit.recorded", payload: { action: "a", category: "b", token: "x" } }));
    expect(audit.some((item) => item.includes("parece una credencial"))).toBe(true);
  });

  it("records events in order, once each, and reads them one company at a time", () => {
    const bus = new EventBus(new InMemoryEventStore(), () => AT, () => "evt_auto");
    const a = bus.publish({ type: "crm.lead.created", module: "crm", tenantId: T1, actor: "carla", payload: { leadId: "1", source: "web" }, id: "e1" });
    const b = bus.publish({ type: "crm.lead.created", module: "crm", tenantId: T2, actor: "lucia", payload: { leadId: "9", source: "web" }, id: "e2" });
    const c = bus.publish({ type: "crm.deal.won", module: "crm", tenantId: T1, actor: "carla", payload: { opportunityId: "o", valueMicros: 5 }, id: "e3" });
    expect([a, b, c].map((item) => (item.ok ? item.seq : 0))).toEqual([1, 2, 3]);
    expect(bus.store.read({ tenantId: T1 }).map((item) => item.id)).toEqual(["e1", "e3"]);
    expect(bus.store.read({ tenantId: T2 }).map((item) => item.id)).toEqual(["e2"]);
    expect(bus.store.read({ tenantId: T1, after: 1 }).map((item) => item.id)).toEqual(["e3"]); // a cursor: how KOE will consume
    expect(bus.store.read({ tenantId: T1, types: ["crm.deal.won"] })).toHaveLength(1);
    expect(bus.store.read({ tenantId: "other" })).toEqual([]);
    const again = bus.publish({ type: "crm.lead.created", module: "crm", tenantId: T1, actor: "carla", payload: { leadId: "1", source: "web" }, id: "e1" });
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(bus.store.size).toBe(3); // the same event twice is one
    expect(bus.publish({ type: "crm.lead.created", module: "crm", tenantId: T1, actor: "carla", payload: {}, id: "bad" })).toMatchObject({ ok: false });
  });

  it("is append-only: stored events are frozen and the store has no way to change or remove one", () => {
    const store = new InMemoryEventStore();
    store.append(event());
    const [stored] = store.read({ tenantId: T1 });
    expect(() => { (stored as { actor: string }).actor = "other"; }).toThrow();
    expect(() => { (stored?.payload as Record<string, unknown>)["leadId"] = "x"; }).toThrow();
    const methods = Object.getOwnPropertyNames(InMemoryEventStore.prototype);
    expect(methods.filter((name) => /delete|remove|clear|update|edit|purge/i.test(name))).toEqual([]);
  });

  it("lets a module publish only its own events, always for one company", () => {
    const bus = new EventBus(new InMemoryEventStore(), () => AT);
    const billing = publisherFor(bus, "billing", { tenantId: T1 });
    expect(billing.publish("invoice.issued", { invoiceId: "f1", totalMicros: 10 }, { actor: "ana" })).toMatchObject({ ok: true });
    expect(billing.publish("lead.created", { leadId: "1", source: "x" }, { actor: "ana" })).toMatchObject({ ok: false }); // a CRM event is not billing's
    expect(bus.store.read({ tenantId: T1 }).map((item) => item.type)).toEqual(["billing.invoice.issued"]);
  });

  it("has subscribers only when someone subscribes, and a failing subscriber never breaks the publisher", () => {
    const bus = new EventBus(new InMemoryEventStore(), () => AT);
    expect(bus.subscribers()).toBe(0); // nothing consumes yet
    const seen = vi.fn();
    const stop = bus.subscribe("crm.lead.created", seen);
    bus.subscribe("*", () => { throw new Error("falla"); });
    expect(bus.publish({ type: "crm.lead.created", module: "crm", tenantId: T1, actor: "c", payload: { leadId: "1", source: "w" }, id: "a" })).toMatchObject({ ok: true });
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
    bus.publish({ type: "crm.lead.created", module: "crm", tenantId: T1, actor: "c", payload: { leadId: "2", source: "w" }, id: "b" });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("lets every module publish through the one contract: the real audit entries of Organization, Billing and Developer all become valid events", () => {
    const org = demoOrgOk().state.audit;
    const billing = demoBillingOk().state.audit;
    const dev = demoDevOk().state.logs;
    const bus = new EventBus(new InMemoryEventStore(), () => AT);
    let counter = 0;
    const publish = (module: "organizations" | "billing" | "developer", entries: readonly { at: string; actor: string; tenantId: string; action: string; category?: string; kind?: string; detail?: string }[]) => {
      for (const entry of entries) {
        const result = bus.publish({ ...eventFromEntry(module, entry.tenantId, entry), id: `evt_${(counter += 1)}` });
        expect(result.ok, JSON.stringify(result)).toBe(true);
      }
      return entries.length;
    };
    expect(publish("organizations", org) + publish("billing", billing) + publish("developer", dev)).toBe(bus.store.size);
    expect(bus.store.read({ tenantId: "tenant-nova" }).length).toBeGreaterThan(50);
    expect(bus.store.read({ tenantId: "tenant-vida" }).every((item) => item.tenantId === "tenant-vida")).toBe(true);
  });
});

describe("the central audit", () => {
  const input = (over = {}) => ({ tenantId: T1, actorId: "ana", actorKind: "person" as const, module: "billing" as const, action: "plan.change", category: "plan", outcome: "success" as const, at: AT, ...over });

  it("chains each record to the previous one of its company, and verifies the chain", async () => {
    const log = new AuditLog();
    const first = await log.record(input());
    const second = await log.record(input({ action: "plan.cancel" }));
    await log.record(input({ tenantId: T2 }));
    expect(first).toMatchObject({ seq: 1, prevHash: GENESIS_HASH });
    expect(second).toMatchObject({ seq: 2, prevHash: first.hash });
    expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await log.verify(T1)).toEqual({ ok: true, records: 2 });
    expect(await log.verify(T2)).toEqual({ ok: true, records: 1 });
    expect(await log.verify("none")).toEqual({ ok: true, records: 0 });
  });

  it("is append-only and detects any change to history", async () => {
    const log = new AuditLog();
    const record = await log.record(input());
    await log.record(input({ action: "plan.cancel" }));
    expect(() => { (record as { action: string }).action = "otra"; }).toThrow();
    expect(Object.getOwnPropertyNames(AuditLog.prototype).filter((name) => /delete|remove|clear|update|edit|purge/i.test(name))).toEqual([]);
    const tampered = (log as unknown as { records: unknown[] }).records;
    tampered[0] = { ...(tampered[0] as object), action: "plan.free" }; // someone rewrites history behind the API
    expect(await log.verify(T1)).toEqual({ ok: false, records: 2, brokenAt: 1 });
  });

  it("cleans a secret out of a detail and keeps each company's records apart", async () => {
    const log = new AuditLog();
    const leak = ["sk", "_live_", "A1b2C3d4E5f6G7h8I9j0"].join("");
    const saved = await log.record(input({ detail: `llave ${leak} usada` }));
    expect(saved.detail).not.toContain(leak);
    await log.record(input({ tenantId: T2, module: "crm", outcome: "refused" }));
    expect(log.list(T1)).toHaveLength(1);
    expect(log.list(T2, { module: "crm", outcome: "refused" })).toHaveLength(1);
    expect(log.list(T1, { module: "crm" })).toHaveLength(0);
  });

  it("tells people, Workers and the platform apart", () => {
    expect(actorKindOf("ana")).toBe("person");
    expect(actorKindOf("worker:nex")).toBe("worker");
    expect(actorKindOf("system")).toBe("system");
  });

  it("takes the audit trail of every module into the one contract, and every chain verifies", async () => {
    const log = new AuditLog();
    const org = demoOrgOk().state.audit;
    const billing = demoBillingOk().state.audit;
    const dev = demoDevOk().state.logs;
    for (const entry of org) await log.record(auditFromModuleEntry("organizations", entry.tenantId, entry));
    for (const entry of billing) await log.record(auditFromModuleEntry("billing", entry.tenantId, entry));
    for (const entry of dev) await log.record(auditFromModuleEntry("developer", entry.tenantId, entry));
    expect(log.size).toBe(org.length + billing.length + dev.length);
    expect(new Set(log.list("tenant-nova").map((item) => item.module))).toEqual(new Set(["organizations", "billing", "developer"]));
    expect(log.list("tenant-nova", { module: "developer" }).some((item) => item.actorKind === "worker")).toBe(true);
    for (const tenant of ["tenant-nova", "tenant-vida"]) expect((await log.verify(tenant)).ok, tenant).toBe(true);
  });
});

describe("storage", () => {
  it("declares the six spaces, each with its limits, and makes only avatars and marketplace public", () => {
    expect([...BUCKET_IDS].sort()).toEqual(["academy", "avatars", "documents", "images", "marketplace", "videos"]);
    expect(BUCKET_IDS.filter((id) => BUCKETS[id].visibility === "public").sort()).toEqual(["avatars", "marketplace"]);
    for (const id of BUCKET_IDS) {
      expect(BUCKETS[id].maxBytes, id).toBeGreaterThan(0);
      expect(BUCKETS[id].mime.length, id).toBeGreaterThan(0);
      expect(BUCKETS[id].scan, id).toBe(true);
    }
    expect(new Set(BUCKET_IDS.map((id) => BUCKETS[id].folder)).size).toBe(BUCKET_IDS.length);
  });

  it("puts every file under its company, and refuses a name that could climb out of its folder", () => {
    expect(storagePath({ bucket: "documents", tenantId: T1, owner: "u1", name: "contrato.pdf" })).toBe("tenant-nova/documents/u1/contrato.pdf");
    for (const name of ["../x.pdf", "a/b.pdf", "..", ".hidden", "", "a..b"]) expect(storagePath({ bucket: "documents", tenantId: T1, owner: "u1", name }), name).toBeNull();
    expect(storagePath({ bucket: "documents", tenantId: "../other", owner: "u1", name: "a.pdf" })).toBeNull();
    expect(storagePath({ bucket: "documents", tenantId: T1, owner: "../u", name: "a.pdf" })).toBeNull();
  });

  it("reads a path back, and lets a company reach only its own", () => {
    const path = storagePath({ bucket: "academy", tenantId: T1, owner: "course-1", name: "clase-1.mp4" }) as string;
    expect(parseStoragePath(path)).toEqual({ tenantId: T1, bucket: "academy", owner: "course-1", name: "clase-1.mp4" });
    expect(canAccessPath(T1, path)).toBe(true);
    expect(canAccessPath(T2, path)).toBe(false);
    expect(parseStoragePath("tenant-nova/unknown/u/a.pdf")).toBeNull();
    expect(parseStoragePath("tenant-nova/documents/u")).toBeNull();
    expect(canAccessPath(T1, "tenant-nova/documents/u/../../tenant-vida/documents/u/a.pdf")).toBe(false);
  });

  it("checks an upload against the space: type, size and name", () => {
    expect(validateUpload({ bucket: "avatars", mime: "image/png", bytes: 1_000, name: "yo.png" })).toEqual({ ok: true });
    expect(validateUpload({ bucket: "avatars", mime: "video/mp4", bytes: 1_000, name: "yo.mp4" })).toMatchObject({ ok: false });
    expect(validateUpload({ bucket: "avatars", mime: "image/png", bytes: 3 * 1024 * 1024, name: "yo.png" })).toMatchObject({ ok: false, reason: expect.stringContaining("2 MB") });
    expect(validateUpload({ bucket: "documents", mime: "application/pdf", bytes: 0, name: "a.pdf" })).toMatchObject({ ok: false });
    expect(validateUpload({ bucket: "documents", mime: "application/pdf", bytes: 10, name: "../a.pdf" })).toMatchObject({ ok: false });
  });

  it("keeps signed addresses short", () => {
    expect(signedUrlTtl()).toBe(300);
    expect(signedUrlTtl(5)).toBe(30);
    expect(signedUrlTtl(999_999)).toBe(3_600);
  });
});

describe("the database contracts", () => {
  it("covers the eleven areas, with unique tables", () => {
    for (const area of DATA_AREAS) expect(entitiesOf(area).length, area).toBeGreaterThan(0);
    expect(DATA_AREAS).toHaveLength(11);
    expect(new Set(ENTITIES.map((item) => item.table)).size).toBe(ENTITIES.length);
  });

  it("gives every company table a company, an optional organization and its dates", () => {
    for (const item of ENTITIES.filter((entity) => entity.scope === "tenant")) {
      const names = item.columns.map((column) => column.name);
      expect(names, item.table).toEqual(expect.arrayContaining(["id", "tenant_id", "organization_id", "created_at", "updated_at"]));
      expect(item.columns.find((column) => column.name === "tenant_id"), item.table).toMatchObject({ type: "uuid", nullable: false, ref: "tenants.id" });
      expect(item.columns.find((column) => column.name === "organization_id"), item.table).toMatchObject({ nullable: true });
    }
    expect(entityOf("tenants")?.scope).toBe("tenant-self");
    expect(entityOf("user_profiles")?.scope).toBe("user");
  });

  it("marks as existing exactly the tables that are in the migrations, and as planned the ones that are not", () => {
    const text = sql();
    const real = new Set([...text.matchAll(/create table (?:if not exists )?public\.(\w+)/g)].map((match) => match[1]));
    for (const item of ENTITIES) expect(real.has(item.table), `${item.table} (${item.status})`).toBe(item.status === "existing");
  });

  it("mirrors the kind of protection the migrations already apply to the tables that exist", () => {
    const applied = [...sql().matchAll(/apply_tenant_rls\('(\w+)', '(\w+)'\)/g)];
    expect(applied.length).toBeGreaterThan(20);
    let checked = 0;
    for (const [, table, kind] of applied) {
      const item = entityOf(table as string);
      if (!item) continue;
      expect(item.rls, table).toBe(kind);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("never stores a secret or a plain token: a credential is a hash, and personal data is flagged", () => {
    for (const item of ENTITIES) for (const column of item.columns.filter((candidate) => !candidate.name.endsWith("_hash"))) expect(column.name, `${item.table}.${column.name}`).not.toMatch(/(secret|password|token|private_key)/i);
    expect(entityOf("api_keys")?.columns.map((column) => column.name)).toEqual(expect.arrayContaining(["prefix", "last4", "key_hash"]));
    expect(entityOf("api_keys")?.columns.some((column) => column.name === "key")).toBe(false);
    expect(entityOf("webhooks")?.columns.some((column) => column.name === "secret_hash")).toBe(true);
    for (const [table, name] of [["contacts", "email"], ["contacts", "phone"], ["invitations", "email"], ["messages", "body"]] as const) expect(entityOf(table)?.columns.find((column) => column.name === name)?.pii, `${table}.${name}`).toBe(true);
  });

  it("reads who is acting from untrusted input, and refuses anything incomplete", () => {
    const ok = { tenantId: "11111111-1111-4111-8111-111111111111", organizationId: "22222222-2222-4222-8222-222222222222", userId: "33333333-3333-4333-8333-333333333333", roleId: "admin" };
    expect(parseTenantContext(ok)).toEqual(ok);
    expect(parseTenantContext({ ...ok, organizationId: null })).toEqual({ ...ok, organizationId: null });
    for (const bad of [null, "x", {}, { ...ok, tenantId: "no" }, { ...ok, userId: undefined }, { ...ok, roleId: "root" }, { ...ok, organizationId: "x" }]) expect(parseTenantContext(bad)).toBeNull();
    expect([...ROLE_IDS]).toEqual([...ROLES]); // the same roles the API and the database use
  });

  it("carries the company filter into any query", () => {
    const context = { tenantId: "11111111-1111-4111-8111-111111111111", organizationId: null, userId: "33333333-3333-4333-8333-333333333333", roleId: "member" };
    expect(tenantFilter(context)).toEqual({ tenant_id: context.tenantId });
    const calls: [string, string][] = [];
    const query = { eq(column: string, value: string) { calls.push([column, value]); return query; } };
    expect(withTenant(query, context)).toBe(query);
    expect(calls).toEqual([["tenant_id", context.tenantId]]);
  });
});

describe("Row Level Security (prepared, not active)", () => {
  it("is declared as not activated, and no migration carries any of its policies", () => {
    expect(RLS_STATE.activated).toBe(false);
    const text = sql();
    for (const policy of plannedPolicies()) expect(text, policy.name).not.toContain(`"${policy.name}"`);
    for (const item of ENTITIES.filter((entity) => entity.status === "planned")) expect(text, item.table).not.toMatch(new RegExp(`public\\.${item.table}\\b`));
  });

  it("has no design defect: every policy filters by company, none lets everybody in, none names the service role", () => {
    expect(auditPolicies()).toEqual([]);
  });

  it("denies by default: a command without a policy is denied, so append-only and read-only tables cannot be changed", () => {
    for (const item of ENTITIES.filter((entity) => entity.scope === "tenant")) {
      const commands = policiesFor(item).map((spec) => spec.command);
      expect(commands, item.table).toContain("select");
      if (item.appendOnly) expect(commands.filter((command) => command === "update" || command === "delete"), item.table).toEqual([]);
      if (item.rls === "read") expect(commands, item.table).toEqual(["select"]);
      if (item.rls === "admin" && !item.appendOnly) expect(policiesFor(item).filter((spec) => spec.command !== "select").every((spec) => (spec.using ?? spec.withCheck ?? "").includes("is_admin")), item.table).toBe(true);
      if (item.rls === "rw") expect(commands, item.table).toEqual(["select", "insert", "update"]);
    }
  });

  it("uses the helper functions the database already has, and writes them as SQL for review only", () => {
    const [spec] = policiesFor(entityOf("automations") as never);
    expect(renderPolicySql(spec as never)).toBe('create policy "automations_select" on public.automations for select to authenticated using ((select private.is_member(tenant_id)));');
    for (const name of ["is_member", "can_write", "is_admin"]) expect(sql()).toContain(`function private.${name}(`);
    const preview = renderRlsPreview();
    expect(preview).toContain("alter table public.worker_runs enable row level security;");
    expect(preview).toContain("revoke all on table public.api_keys");
    expect(preview).not.toMatch(/\bdisable row level security\b|bypassrls|using \(true\)/i);
    expect(preview).not.toContain("public.contacts"); // existing tables already carry their policies
  });
});

describe("Auth architecture", () => {
  const session = (over: Partial<AuthSession> = {}): AuthSession => ({ userId: "u1", tenantId: "t1", role: "member", issuedAt: "2026-11-07T10:00:00Z", expiresAt: "2026-11-07T13:00:00Z", ...over });
  const NOW = "2026-11-07T12:00:00Z";

  it("tells a valid session from one that must be renewed and one that has ended", () => {
    expect(sessionState(session(), NOW)).toBe("valid");
    expect(sessionState(session({ expiresAt: "2026-11-07T12:01:00Z" }), NOW)).toBe("refresh");
    expect(sessionState(session({ expiresAt: "2026-11-07T11:59:59Z" }), NOW)).toBe("expired");
    expect(sessionState(session({ expiresAt: "no" }), NOW)).toBe("expired");
  });

  it("declares the login, refresh and logout flows", () => {
    for (const flow of Object.values(AUTH_FLOWS)) expect(flow.length).toBeGreaterThan(2);
    expect(AUTH_FLOWS.login.join(" ")).toMatch(/origen permitido/);
    expect(AUTH_FLOWS.logout.join(" ")).toMatch(/revocar/);
  });

  it("sends a person to sign in, to create their company, or lets them through", () => {
    expect(authorizeRoute("/", null, NOW)).toEqual({ action: "allow" });
    expect(authorizeRoute("/pricing", null, NOW)).toEqual({ action: "allow" });
    expect(authorizeRoute("/sales", null, NOW)).toEqual({ action: "login", redirectTo: "/login?next=%2Fsales" });
    expect(authorizeRoute("/sales", session({ expiresAt: "2026-11-07T11:00:00Z" }), NOW)).toMatchObject({ action: "login" });
    expect(authorizeRoute("/dashboard", session({ tenantId: null, role: null }), NOW)).toEqual({ action: "onboarding" });
    expect(authorizeRoute("/sales", session(), NOW)).toEqual({ action: "allow" });
    expect(authorizeRoute("/login", null, NOW)).toEqual({ action: "allow" });
  });

  it("asks more of the roles in the sensitive screens", () => {
    expect(authorizeRoute("/settings", session({ role: "viewer" }), NOW)).toEqual({ action: "forbidden", needs: "admin" });
    expect(authorizeRoute("/platform/billing", session({ role: "member" }), NOW)).toEqual({ action: "forbidden", needs: "admin" });
    expect(authorizeRoute("/platform/billing/invoices", session({ role: "admin" }), NOW)).toEqual({ action: "allow" });
    expect(authorizeRoute("/platform/developers", session({ role: "owner" }), NOW)).toEqual({ action: "allow" });
    expect(authorizeRoute("/platform/crm", session({ role: "viewer" }), NOW)).toEqual({ action: "allow" });
    expect(requiredPermission("/nex")).toBe("read");
  });

  it("agrees with the protected paths the middleware already uses", () => {
    for (const prefix of APP_PATHS) expect(isProtectedPath(`/${prefix}`) && isProtectedPath(`/${prefix}/x`), prefix).toBe(true);
    expect(isProtectedPath("/login")).toBe(false);
    expect(isProtectedPath("/dashboardx")).toBe(false);
    for (const rule of ROUTE_RULES) expect(isProtectedPath(rule.prefix), rule.prefix).toBe(true);
  });

  it("gives each role its rights in each module, reusing the roles that exist", () => {
    const matrix = permissionMatrix(MODULE_IDS);
    for (const area of MODULE_IDS) {
      expect(matrix[area].viewer, area).toEqual({ read: true, write: false, admin: false });
      expect(matrix[area].owner.read, area).toBe(true);
    }
    expect(canDo("member", "crm", "write")).toBe(true);
    expect(canDo("member", "billing", "write")).toBe(false);
    expect(canDo("admin", "billing", "write")).toBe(true);
    expect(canDo("admin", "billing", "admin")).toBe(false); // only the owner decides who administers the money
    expect(canDo("owner", "billing", "admin")).toBe(true);
    expect(canDo("member", "developer", "write")).toBe(false);
    expect(canDo(null, "crm", "read")).toBe(false);
    expect(permissionFor("crm", "write")).toBe("write");
  });
});
