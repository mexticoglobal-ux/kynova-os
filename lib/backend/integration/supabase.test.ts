/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { newKoeState } from "@/lib/contracts/platform/koe-engine";
import { generateEncryptionKey } from "../crypto";
import { ENTITIES } from "../entities";
import { createBackendCore } from "../index";
import {
  PERSISTED_TABLES, PROVISIONED_BUCKETS, StorageBlockedError, SupabasePersistence, SupabaseStorage, auditRow, connectSupabasePlatform, eventRow, persistedTablesReport, storageRow, validateRow,
  type DatabaseClient, type Row, type StorageClient,
} from "./index";

const T1 = "20000000-0000-4000-8000-0000000000b1";
const T2 = "20000000-0000-4000-8000-0000000000b2";
const SQL = readFileSync(join(process.cwd(), "supabase", "migrations", "20261110000100_backend_integration.sql"), "utf8");

let clockMs = Date.parse("2026-11-10T12:00:00.000Z");
const tick = () => (clockMs += 11);
let counter = 0;
const at = () => new Date(Date.parse("2026-11-10T12:00:00.000Z") + counter++ * 1_000).toISOString();

type Failure = { message: string } | null;

/** A stand-in for the signed-in person's Supabase client. The functions behave like the ones in the migration (idempotent events, a chain the database enforces, a registry
 * that refuses a path outside the company folder), so the whole flow can be checked here without a network. The SQL itself is tested in supabase/tests/backend_integration.sql. */
class FakeSupabase implements DatabaseClient, StorageClient {
  readonly calls: { fn: string; args: Record<string, unknown> }[] = [];
  readonly events: Row[] = [];
  readonly audit: Row[] = [];
  readonly registry: Row[] = [];
  readonly objects = new Map<string, Uint8Array>();
  readonly uploads: string[] = [];
  reachable = true;
  private fail(message: string): { data: null; error: Failure } { return { data: null, error: { message } }; }

  rpc = async (fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: Failure }> => {
    this.calls.push({ fn, args });
    const tenant = String(args["p_tenant"]);
    if (fn === "append_platform_events") {
      let inserted = 0;
      for (const item of args["p_events"] as Row[]) {
        if (this.events.some((row) => row["tenant_id"] === tenant && row["event_id"] === item["event_id"])) continue;
        this.events.push({ ...item, tenant_id: tenant, seq: this.events.length + 1 });
        inserted += 1;
      }
      return { data: inserted, error: null };
    }
    if (fn === "append_platform_audit") {
      let inserted = 0;
      for (const item of args["p_records"] as Row[]) {
        const own = this.audit.filter((row) => row["tenant_id"] === tenant);
        const last = own.at(-1);
        const seq = Number(item["seq"]);
        if (last && seq <= Number(last["seq"])) { if (own.some((row) => row["seq"] === seq && row["hash"] === item["hash"])) continue; return this.fail("audit record conflicts"); }
        if (seq !== (last ? Number(last["seq"]) + 1 : 1) || item["prev_hash"] !== (last ? last["hash"] : "0".repeat(64))) return this.fail("audit chain broken");
        this.audit.push({ ...item, tenant_id: tenant });
        inserted += 1;
      }
      return { data: inserted, error: null };
    }
    if (fn === "register_storage_object") {
      if (!String(args["p_path"]).startsWith(`${tenant}/`)) return this.fail("path outside the company folder");
      if (this.registry.some((row) => row["tenant_id"] === tenant && row["path"] === args["p_path"])) return { data: null, error: null };
      this.registry.push({ tenant_id: tenant, bucket: args["p_bucket"] as string, path: args["p_path"] as string, mime: args["p_mime"] as string, bytes: args["p_bytes"] as number, retired_at: null });
      return { data: `obj-${this.registry.length}`, error: null };
    }
    if (fn === "retire_storage_object") {
      const found = this.registry.find((row) => row["tenant_id"] === tenant && row["path"] === args["p_path"]);
      if (found) found["retired_at"] = "2026-11-10T13:00:00.000Z";
      return { data: null, error: null };
    }
    return this.fail(`unknown function ${fn}`);
  };

  from = (table: string) => ({
    select: (_columns: string) => ({
      eq: (column: string, value: string) => {
        let rows = (table === "platform_events" ? this.events : table === "platform_audit" ? this.audit : this.registry).filter((row) => row[column] === value);
        const answer = () => ({ data: this.reachable ? rows : null, error: this.reachable ? null : { message: "unreachable" } });
        const query = {
          order: (_column: string, options: { ascending: boolean }) => { rows = [...rows].sort((a, b) => (Number(a["seq"]) - Number(b["seq"])) * (options.ascending ? 1 : -1)); return query; },
          limit: (count: number) => { rows = rows.slice(0, count); return query; },
          then: <T>(resolve: (value: ReturnType<typeof answer>) => T) => Promise.resolve(answer()).then(resolve),
        };
        return query as never;
      },
    }),
  });

  storage = {
    from: (bucket: string) => ({
      upload: async (path: string, body: Uint8Array, _options: { contentType: string; upsert: boolean }): Promise<{ error: Failure }> => {
        if (bucket !== "documents") return { error: { message: "no bucket" } };
        if (this.objects.has(path)) return { error: { message: "exists" } };
        this.objects.set(path, Uint8Array.from(body));
        this.uploads.push(path);
        return { error: null };
      },
      download: async (path: string) => {
        const found = this.objects.get(path);
        return found ? { data: { arrayBuffer: async () => found.buffer.slice(found.byteOffset, found.byteOffset + found.byteLength) as ArrayBuffer }, error: null } : { data: null, error: { message: "missing" } };
      },
      createSignedUrl: async (path: string, expiresIn: number) => ({ data: { signedUrl: `https://signed.example.test/${path}?t=${expiresIn}` }, error: null }),
    }),
  };
}

const coreIn = (environment: "development" | "preview" | "production" = "development") =>
  createBackendCore({ vars: { KYNOVA_ENV: environment, KYNOVA_ENCRYPTION_KEY: generateEncryptionKey(), KYNOVA_HASH_PEPPER: "p".repeat(40) }, now: tick, clock: () => new Date(tick()).toISOString() });
const enable = (tenantId: string, id = "sales") => ({ type: "worker.enable", at: at(), tenantId, actor: "ana", definitionId: id }) as const;

// ================================================================ the adapter
describe("the Supabase adapter writes only through the migration's functions, as the signed-in person", () => {
  const event = (tenantId: string, id: string) => eventRow({ id, type: "crm.audit.recorded", version: 1, module: "crm", tenantId, actor: "ana", at: "2026-11-10T12:00:00.000Z", correlationId: "c1", payload: { action: "a", category: "b" }, seq: 1 });

  it("writes nothing in production, and never even asks for the client; development and preview accept demonstration data only", async () => {
    let asked = false;
    const blocked = new SupabasePersistence({ environment: "production", client: async () => { asked = true; return new FakeSupabase(); } });
    expect(await blocked.insert("platform_events", [event(T1, "e1")])).toMatchObject({ inserted: 0, skipped: 1, blocked: expect.stringMatching(/no admite datos/) });
    expect(await blocked.select("platform_events", T1)).toEqual([]);
    expect(await blocked.auditTail(T1)).toBeNull();
    expect(asked).toBe(false);
    for (const environment of ["development", "preview"] as const) {
      const fake = new FakeSupabase();
      const adapter = new SupabasePersistence({ environment, client: async () => fake });
      expect(await adapter.insert("platform_events", [event(T1, "e1")])).toMatchObject({ inserted: 1 });
      expect(fake.calls.map((call) => call.fn)).toEqual(["append_platform_events"]);
    }
  });

  it("calls the migration's functions with the arguments they declare, one call per company", async () => {
    const fake = new FakeSupabase();
    const adapter = new SupabasePersistence({ environment: "development", client: async () => fake });
    await adapter.insert("platform_events", [event(T1, "e1"), event(T2, "e1"), event(T1, "e2")]);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls.map((call) => String(call.args["p_tenant"]))).toEqual([T1, T2]);
    expect((fake.calls[0]!.args["p_events"] as Row[]).map((item) => item["event_id"])).toEqual(["e1", "e2"]);
    const declared = (name: string) => [...(new RegExp(`create function public\\.${name}\\(([^)]*)\\)`).exec(SQL)?.[1] ?? "").matchAll(/\b(p_\w+)\b/g)].map((match) => match[1]);
    expect(Object.keys(fake.calls[0]!.args).sort()).toEqual(declared("append_platform_events").sort());
    await adapter.insert("platform_audit", [auditRow({ id: "aud_1", seq: 1, prevHash: "0".repeat(64), hash: "a".repeat(64), tenantId: T1, actorId: "ana", actorKind: "person", module: "crm", action: "x", category: "c", outcome: "success", at: at() })]);
    expect(Object.keys(fake.calls[2]!.args).sort()).toEqual(declared("append_platform_audit").sort());
    await adapter.insert("storage_objects", [storageRow({ id: "o", tenantId: T1, bucket: "documents", path: `${T1}/documents/system/a.txt`, mime: "text/plain", bytes: 9, at: at() })]);
    expect(Object.keys(fake.calls[3]!.args).sort()).toEqual(declared("register_storage_object").sort());
  });

  it("checks every row first, redacts the failure of a call, reads only by company, and has no way to update or delete", async () => {
    const fake = new FakeSupabase();
    const adapter = new SupabasePersistence({ environment: "development", client: async () => fake });
    await expect(adapter.insert("platform_events", [{ ...event(T1, "e1"), tenant_id: null }])).rejects.toThrow(/fila no válida/);
    expect(fake.calls).toHaveLength(0);
    await expect(adapter.insert("users" as never, [event(T1, "e1")])).rejects.toThrow();
    const broken = new SupabasePersistence({ environment: "development", client: async () => ({ ...fake, rpc: async () => ({ data: null, error: { message: "secret detail of the database" } }), from: fake.from, storage: fake.storage }) });
    await expect(broken.insert("platform_events", [event(T1, "e1")])).rejects.toThrow(/no se pudo escribir en platform_events$/);
    await adapter.insert("platform_events", [event(T1, "e1"), event(T2, "e9")]);
    expect((await adapter.select("platform_events", T1)).every((row) => row["tenant_id"] === T1)).toBe(true);
    expect(Object.getOwnPropertyNames(SupabasePersistence.prototype).filter((name) => /update|delete|remove|upsert/i.test(name))).toEqual([]);
  });
});

// ================================================================ the audit chain survives a new instance
describe("the audit chain across instances", () => {
  it("continues where it was left when an instance resumes, and the database refuses a chain that restarts", async () => {
    const fake = new FakeSupabase();
    const first = connectSupabasePlatform(coreIn(), fake);
    await first.run("workers", newKoeState(["admin:ana"]), enable(T1));
    const stored = await first.persist(T1);
    expect(stored.audit.inserted).toBeGreaterThan(0);
    const last = fake.audit.filter((row) => row["tenant_id"] === T1).at(-1)!;

    // a new Worker instance (a new request): without resuming, its chain would start at 1 again and the database refuses it
    const core = coreIn();
    const naive = connectSupabasePlatform(core, fake);
    await naive.run("workers", newKoeState(["admin:ana"]), enable(T1, "followup"));
    await expect(naive.persist(T1)).rejects.toThrow(/platform_audit/);

    const resumedCore = coreIn();
    const resumed = connectSupabasePlatform(resumedCore, fake);
    expect(await resumed.resume(T1)).toEqual({ resumed: true, seq: Number(last["seq"]) });
    await resumed.run("workers", newKoeState(["admin:ana"]), enable(T1, "followup"));
    const next = await resumed.persist(T1);
    expect(next.audit.inserted).toBeGreaterThan(0);
    const chain = fake.audit.filter((row) => row["tenant_id"] === T1);
    expect(chain.map((row) => row["seq"])).toEqual(chain.map((_, index) => index + 1));
    chain.slice(1).forEach((row, index) => expect(row["prev_hash"]).toBe(chain[index]!["hash"]));
    expect(await (await resumed.resume(T2))).toEqual({ resumed: false, seq: 0 });
  });

  it("does not resume over records an instance already holds", async () => {
    const fake = new FakeSupabase();
    const platform = connectSupabasePlatform(coreIn(), fake);
    await platform.run("workers", newKoeState(["admin:ana"]), enable(T1));
    await platform.persist(T1);
    await expect(platform.resume(T1)).rejects.toThrow(/ya tiene registros/);
  });

  it("keeps every company's chain on its own", async () => {
    const fake = new FakeSupabase();
    const platform = connectSupabasePlatform(coreIn(), fake);
    await platform.run("workers", newKoeState(["admin:ana"]), enable(T1));
    await platform.run("workers", newKoeState(["admin:ana"]), enable(T2));
    await platform.persist(T1);
    await platform.persist(T2);
    for (const tenant of [T1, T2]) expect(fake.audit.filter((row) => row["tenant_id"] === tenant)[0]).toMatchObject({ seq: 1, prev_hash: "0".repeat(64) });
    expect(fake.events.every((row) => row["tenant_id"] === T1 || row["tenant_id"] === T2)).toBe(true);
    expect(fake.events.filter((row) => row["tenant_id"] === T1).every((row) => !String(row["event_id"]).includes(T2))).toBe(true);
  });
});

// ================================================================ storage
describe("Storage on Supabase", () => {
  const path = `${T1}/documents/system/audit-2026-11-10.txt`;
  const storage = (fake: FakeSupabase, environment: "development" | "production" = "development") => new SupabaseStorage({ environment, client: async () => fake });

  it("stores, reads, signs and retires through the contract, never erases, and clamps the lifetime of a signed address", async () => {
    const fake = new FakeSupabase();
    const adapter = storage(fake);
    await adapter.put(path, new TextEncoder().encode("sellado"), { mime: "text/plain" });
    expect(new TextDecoder().decode((await adapter.get(path))!)).toBe("sellado");
    expect(await adapter.signedUrl(path, 99_999)).toContain("t=3600");
    expect(await adapter.signedUrl(path, 1)).toContain("t=30");
    await adapter.retire(path);
    expect(fake.calls.at(-1)).toMatchObject({ fn: "retire_storage_object", args: { p_tenant: T1, p_path: path } });
    expect(Object.getOwnPropertyNames(SupabaseStorage.prototype).filter((name) => /delete|remove|erase/i.test(name))).toEqual([]);
    await expect(adapter.put(path, new Uint8Array([1]), { mime: "text/plain" })).rejects.toThrow(/no se pudo guardar/);
  });

  it("refuses a bad path, a bucket the migration does not provision, and an environment that admits no files", async () => {
    const fake = new FakeSupabase();
    await expect(storage(fake).put("../x", new Uint8Array([1]), { mime: "text/plain" })).rejects.toThrow(/ruta no válida/);
    await expect(storage(fake).put(`${T1}/images/system/a.png`, new Uint8Array([1]), { mime: "image/png" })).rejects.toBeInstanceOf(StorageBlockedError);
    await expect(storage(fake, "production").put(path, new Uint8Array([1]), { mime: "text/plain" })).rejects.toBeInstanceOf(StorageBlockedError);
    expect(fake.uploads).toEqual([]);
    expect([...PROVISIONED_BUCKETS]).toEqual(["documents"]);
    expect(SQL).toMatch(/values \('documents', 'documents', false/);
  });

  it("archives a company's audit through Supabase Storage, registers it, and no other company can open it", async () => {
    const fake = new FakeSupabase();
    const platform = connectSupabasePlatform(coreIn(), fake);
    await platform.run("workers", newKoeState(["admin:ana"]), enable(T1));
    const archived = await platform.archive(T1);
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    expect(fake.uploads).toEqual([archived.path]);
    expect(fake.calls.at(-1)).toMatchObject({ fn: "register_storage_object", args: { p_tenant: T1, p_bucket: "documents", p_path: archived.path, p_mime: "text/plain" } });
    expect((await platform.readArchive(T1, archived.path)).ok).toBe(true);
    expect((await platform.readArchive(T2, archived.path)).ok).toBe(false);
    expect(new TextDecoder().decode(fake.objects.get(archived.path)!)).not.toMatch(/worker\.enable|tenant/);
  });

  it("archives nothing in production", async () => {
    const fake = new FakeSupabase();
    const platform = connectSupabasePlatform(coreIn("production"), fake);
    await platform.run("workers", newKoeState(["admin:ana"]), enable(T1));
    expect(await platform.archive(T1)).toMatchObject({ ok: false });
    expect(fake.uploads).toEqual([]);
    expect(fake.calls).toEqual([]);
  });
});

// ================================================================ real health
describe("health checks that ask Supabase", () => {
  it("is reachable when the project answers, down when it does not, and degraded when it is not configured", async () => {
    const fake = new FakeSupabase();
    const platform = connectSupabasePlatform(coreIn(), fake);
    const reachable = async () => (await platform.health()).checks.find((item) => item.name === "supabase_reachable")!;
    // development without a project: configured is false, so it reports it instead of calling anything
    expect((await reachable()).status).toBe("degraded");
    const configured = createBackendCore({ vars: { KYNOVA_ENV: "development", SUPABASE_URL: "https://example.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_" + "x".repeat(24) }, now: tick });
    const connected = connectSupabasePlatform(configured, fake);
    const check = async () => (await connected.health()).checks.find((item) => item.name === "supabase_reachable")!;
    expect((await check()).status).toBe("ok");
    fake.reachable = false;
    expect((await check()).status).toBe("down");
    expect(JSON.stringify(await check())).not.toMatch(/sb_publishable/);
    // the probe is a read filtered to a company that does not exist: it can never return a company's data
    expect(fake.calls).toEqual([]);
  });
});

// ================================================================ the migration and the contract agree
describe("the migration and the data contract", () => {
  const tableBody = (table: string): string => {
    const start = SQL.indexOf(`create table public.${table} (`);
    expect(start, table).toBeGreaterThanOrEqual(0);
    return SQL.slice(start, SQL.indexOf("\n);", start));
  };
  const columnsOf = (table: string): string[] =>
    tableBody(table).split("\n").slice(1).map((line) => /^ {2}([a-z_]+) /.exec(line)?.[1]).filter((name): name is string => Boolean(name) && !["primary", "unique", "check", "foreign"].includes(name as string));

  it.each(PERSISTED_TABLES)("%s has exactly the columns of its entity contract, and the contract says it exists", (table) => {
    const entity = ENTITIES.find((item) => item.table === table)!;
    expect(entity.status).toBe("existing");
    expect(columnsOf(table).sort()).toEqual(entity.columns.map((column) => column.name).sort());
    expect(entity.scope).toBe("tenant");
  });

  it("shapes its rows by the contract: complete, typed, and nothing the table does not have", () => {
    const row = eventRow({ id: "e1", type: "crm.audit.recorded", version: 1, module: "crm", tenantId: T1, actor: "ana", at: "2026-11-10T12:00:00.000Z", payload: { action: "x", category: "y" }, seq: 1 });
    expect(validateRow("platform_events", row)).toEqual([]);
    expect(validateRow("platform_events", { ...row, extra: "x" })).toEqual(["la columna extra no existe en platform_events"]);
    const { event_id: _eventId, ...missing } = row;
    expect(validateRow("platform_events", missing)).toContain("falta la columna event_id");
    expect(validateRow("storage_objects", storageRow({ id: "o", tenantId: T1, bucket: "documents", path: `${T1}/documents/system/a.txt`, mime: "text/plain", bytes: 3, at: "2026-11-10T12:00:00.000Z" }))).toEqual([]);
  });

  it("turns RLS on for every table at creation, lets members only read, and takes every privilege from the API roles first", () => {
    for (const table of PERSISTED_TABLES) {
      expect(SQL).toContain(`alter table public.${table} enable row level security;`);
      expect(SQL).toMatch(new RegExp(`create policy ${table}_select on public\\.${table}\\s+for select to authenticated using \\(\\(select private\\.is_member\\(tenant_id\\)\\)\\);`));
    }
    expect(SQL).toMatch(/revoke all on table public\.platform_events, public\.platform_audit, public\.storage_objects from public, anon, authenticated, service_role;/);
    expect(SQL).toMatch(/grant select on table public\.platform_events, public\.platform_audit, public\.storage_objects to authenticated;/);
    expect(SQL).not.toMatch(/grant (insert|update|delete)[^;]*(platform_events|platform_audit|storage_objects)/i);
    expect(SQL).not.toMatch(/create policy \w+ on public\.\w+\s+for (insert|update|delete)/);
    expect(SQL).not.toMatch(/to anon|to service_role/);
  });

  it("writes through functions that check the right to write, never trust the caller's company, and are not open to the API roles by default", () => {
    for (const fn of ["append_platform_events", "append_platform_audit", "register_storage_object", "retire_storage_object"]) {
      const start = SQL.indexOf(`create function public.${fn}(`);
      expect(start, fn).toBeGreaterThanOrEqual(0);
      const body = SQL.slice(start, SQL.indexOf("\n$$;", start));
      expect(body, fn).toContain("security definer");
      expect(body, fn).toContain("set search_path = ''");
      expect(body, fn).toContain("perform private.require_write(p_tenant);");
    }
    expect(SQL).toMatch(/revoke execute on function[\s\S]*?from public, anon, authenticated, service_role;/);
    expect(SQL).toMatch(/grant execute on function[\s\S]*?to authenticated;/);
    expect(SQL).toContain("perform pg_advisory_xact_lock(");
    expect(SQL).toContain("'audit chain broken'");
  });

  it("makes the events and the audit append-only, and leaves a company's deletion able to remove them", () => {
    expect(SQL).toMatch(/create trigger platform_events_append_only before update or delete on public\.platform_events\s+for each row execute function private\.reject_mutation\(\);/);
    expect(SQL).toMatch(/create trigger platform_audit_append_only before update or delete on public\.platform_audit\s+for each row execute function private\.reject_mutation\(\);/);
    const deletion = SQL.slice(SQL.indexOf("create or replace function public.delete_company"));
    for (const table of PERSISTED_TABLES) expect(deletion, table).toContain(`delete from public.${table} where tenant_id = p_tenant;`);
  });

  it("ties Storage to the company folder, with no update and no delete policy, and only where the storage schema exists", () => {
    expect(SQL).toContain("if to_regnamespace('storage') is null then");
    expect(SQL).toMatch(/create policy documents_select on storage\.objects for select to authenticated/);
    expect(SQL).toMatch(/create policy documents_insert on storage\.objects for insert to authenticated/);
    expect(SQL).not.toMatch(/on storage\.objects for (update|delete)/);
    expect(SQL.match(/storage\.foldername\(name\)\)\[1\]/g)?.length).toBeGreaterThanOrEqual(4);
    expect(SQL).toContain("private.is_member(((storage.foldername(name))[1])::uuid)");
    expect(SQL).toContain("private.can_write(((storage.foldername(name))[1])::uuid)");
  });

  it("plans RLS for these tables from the contract that already exists, and none of them is a planned table any more", () => {
    const report = persistedTablesReport();
    for (const item of report) {
      expect(item).toMatchObject({ tenantScoped: true, existing: true });
      expect(item.policies).toBeGreaterThan(0);
    }
    expect(report.find((item) => item.table === "platform_audit")?.appendOnly).toBe(true);
  });
});
