// Persistence: how the events, the audit and the file records the integration produces are written to the tables of the data contract (platform_events,
// platform_audit, storage_objects), under the same tenant_id and the RLS the migration 20261110000100 turns on. Two adapters answer the same port: a simulated
// database (memory, what the tests and the demo use) and the Supabase adapter. The Supabase adapter writes ONLY through the three functions of that migration
// (append_platform_events, append_platform_audit, register_storage_object), as the signed-in user, so Postgres decides who may write what; it has no update and
// no delete; and it writes nothing while the environment admits neither demonstration data nor real data (production, until the ADR-0006 gates are met).

import type { AuditRecord } from "../audit";
import { entityOf, type Entity } from "../entities";
import { ENVIRONMENT_POLICIES, type Environment, type EnvironmentPolicy } from "../env";
import type { StoredEvent } from "../events";
import { RLS_STATE, policiesFor } from "../rls";

export const PERSISTED_TABLES = ["platform_events", "platform_audit", "storage_objects"] as const;
export type PersistedTable = (typeof PERSISTED_TABLES)[number];
export type RowValue = string | number | boolean | null | Record<string, unknown>;
export type Row = Record<string, RowValue>;

export type WriteResult = { inserted: number; skipped: number; blocked?: string };
export type AuditTail = { seq: number; hash: string };
/** Only what the integration needs: add rows, read the rows of ONE company, and find where its audit chain stands. Nothing updates or deletes a row. */
export interface PersistencePort {
  insert(table: PersistedTable, rows: readonly Row[]): Promise<WriteResult>;
  select(table: PersistedTable, tenantId: string): Promise<Row[]>;
  /** The last audit record stored for a company, so a new instance continues the chain instead of restarting it. `null` when it has none. */
  auditTail(tenantId: string): Promise<AuditTail | null>;
}

// ---------------------------------------------------------------- the rows, shaped by the entity contracts
export function eventRow(event: StoredEvent): Row {
  return {
    id: event.id, tenant_id: event.tenantId, organization_id: event.organizationId ?? null, created_at: event.at, updated_at: event.at, created_by: null,
    event_id: event.id, type: event.type, module: event.module, actor: event.actor, correlation_id: event.correlationId ?? null, payload: { ...event.payload }, seq: event.seq,
  };
}
export function auditRow(record: AuditRecord): Row {
  return {
    id: record.id, tenant_id: record.tenantId, organization_id: record.organizationId ?? null, created_at: record.at, updated_at: record.at, created_by: null,
    record_id: record.id, seq: record.seq, actor_id: record.actorId, actor_kind: record.actorKind, module: record.module, action: record.action, category: record.category,
    target: record.target ?? null, detail: record.detail ?? null, outcome: record.outcome, request_id: record.requestId ?? null, prev_hash: record.prevHash, hash: record.hash,
  };
}
export function storageRow(input: { id: string; tenantId: string; bucket: string; path: string; mime: string; bytes: number; at: string }): Row {
  return {
    id: input.id, tenant_id: input.tenantId, organization_id: null, created_at: input.at, updated_at: input.at, created_by: null,
    bucket: input.bucket, path: input.path, mime: input.mime, bytes: input.bytes, scanned: false, retired_at: null,
  };
}

const TYPE_OK: Record<string, (value: RowValue) => boolean> = {
  uuid: (value) => typeof value === "string" && value !== "", // real rows are UUIDs (the database assigns them); the simulation keeps the ids it has
  text: (value) => typeof value === "string",
  int: (value) => typeof value === "number" && Number.isInteger(value),
  bigint: (value) => typeof value === "number" && Number.isInteger(value),
  bool: (value) => typeof value === "boolean",
  timestamptz: (value) => typeof value === "string" && !Number.isNaN(Date.parse(value)),
  jsonb: (value) => typeof value === "object" && value !== null,
};

/** The problems of a row against its entity: a missing required column, a column that does not exist, a wrong type. Empty when the row is valid. */
export function validateRow(table: PersistedTable, row: Row): string[] {
  const entity: Entity | undefined = entityOf(table);
  if (!entity) return [`la tabla ${table} no está en el contrato de datos`];
  const problems: string[] = [];
  const names = new Set(entity.columns.map((column) => column.name));
  for (const column of entity.columns) {
    const value = row[column.name];
    if (value === undefined) { problems.push(`falta la columna ${column.name}`); continue; }
    if (value === null) { if (!column.nullable) problems.push(`${column.name} no admite nulo`); continue; }
    if (!TYPE_OK[column.type]?.(value)) problems.push(`${column.name} debe ser ${column.type}`);
  }
  for (const key of Object.keys(row)) if (!names.has(key)) problems.push(`la columna ${key} no existe en ${table}`);
  return problems;
}

/** What the data contract and the migration say about the tables the integration writes. A test reads it. */
export function persistedTablesReport(): { table: PersistedTable; appendOnly: boolean; tenantScoped: boolean; policies: number; existing: boolean; activated: boolean }[] {
  return PERSISTED_TABLES.map((table) => {
    const entity = entityOf(table) as Entity;
    return { table, appendOnly: entity.appendOnly, tenantScoped: entity.scope === "tenant", policies: policiesFor(entity).length, existing: entity.status === "existing", activated: RLS_STATE.activated };
  });
}

/** What makes two rows of a table the same row for a company. */
const IDENTITY: Record<PersistedTable, string> = { platform_events: "event_id", platform_audit: "seq", storage_objects: "path" };

// ---------------------------------------------------------------- the simulated database (what the tests and the demo use)
/** In memory. Rows are only added (a repeated row is skipped, never replaced), every row is validated against its entity, and every read names one company. */
export class SimulatedDatabase implements PersistencePort {
  private readonly tables = new Map<PersistedTable, Row[]>();
  private readonly seen = new Map<PersistedTable, Set<string>>();

  async insert(table: PersistedTable, rows: readonly Row[]): Promise<WriteResult> {
    const known = this.seen.get(table) ?? new Set<string>();
    const stored = this.tables.get(table) ?? [];
    let inserted = 0;
    let skipped = 0;
    for (const row of rows) {
      const problems = validateRow(table, row);
      if (problems.length > 0) throw new Error(`fila no válida para ${table}: ${problems[0]}`);
      const key = `${String(row["tenant_id"])}|${String(row[IDENTITY[table]])}`;
      if (known.has(key)) { skipped += 1; continue; }
      known.add(key);
      stored.push(Object.freeze({ ...row }) as Row);
      inserted += 1;
    }
    this.seen.set(table, known);
    this.tables.set(table, stored);
    return { inserted, skipped };
  }

  async select(table: PersistedTable, tenantId: string): Promise<Row[]> {
    return (this.tables.get(table) ?? []).filter((row) => row["tenant_id"] === tenantId).map((row) => ({ ...row }));
  }

  async auditTail(tenantId: string): Promise<AuditTail | null> {
    const rows = await this.select("platform_audit", tenantId);
    const last = rows.reduce<Row | null>((best, row) => (best === null || Number(row["seq"]) > Number(best["seq"]) ? row : best), null);
    return last ? { seq: Number(last["seq"]), hash: String(last["hash"]) } : null;
  }

  /** How many rows each table holds, for the health check. Never the rows. */
  sizes(): Record<PersistedTable, number> {
    return { platform_events: this.tables.get("platform_events")?.length ?? 0, platform_audit: this.tables.get("platform_audit")?.length ?? 0, storage_objects: this.tables.get("storage_objects")?.length ?? 0 };
  }
}

// ---------------------------------------------------------------- the Supabase adapter
type Failure = { message: string } | null;
type Answer<T> = { data: T | null; error: Failure };
type Query = PromiseLike<Answer<Row[]>> & { order(column: string, options: { ascending: boolean }): Query; limit(count: number): Query };
/** The small part of a Supabase client the adapter uses: call a function, and read a table filtered by company. A test gives it a fake; no network is involved. */
export interface DatabaseClient {
  rpc(fn: string, args: Record<string, unknown>): Promise<Answer<unknown>>;
  from(table: string): { select(columns: string): { eq(column: string, value: string): Query } };
}

const eventArgs = (row: Row) => ({ event_id: row["event_id"], type: row["type"], module: row["module"], actor: row["actor"], correlation_id: row["correlation_id"], payload: row["payload"], at: row["created_at"], organization_id: row["organization_id"] });
const auditArgs = (row: Row) => ({
  record_id: row["record_id"], seq: row["seq"], actor_id: row["actor_id"], actor_kind: row["actor_kind"], module: row["module"], action: row["action"], category: row["category"], target: row["target"],
  detail: row["detail"], outcome: row["outcome"], request_id: row["request_id"], prev_hash: row["prev_hash"], hash: row["hash"], at: row["created_at"],
});

export class SupabasePersistence implements PersistencePort {
  /** `client` is the signed-in user's client of the request (so RLS applies) and is only asked for when a write or a read is really allowed. */
  constructor(private readonly options: { environment: Environment; client: () => Promise<DatabaseClient>; policy?: Pick<EnvironmentPolicy, "realData" | "demoData"> }) {}

  /** Demonstration data may be stored in development and preview; real data in none yet; production allows neither until its gates are met. */
  private get allowed(): boolean {
    const policy = this.options.policy ?? ENVIRONMENT_POLICIES[this.options.environment];
    return policy.demoData || policy.realData;
  }

  async insert(table: PersistedTable, rows: readonly Row[]): Promise<WriteResult> {
    if (!(PERSISTED_TABLES as readonly string[]).includes(table)) throw new Error(`la tabla ${table} no se escribe desde la integración`);
    if (!this.allowed) return { inserted: 0, skipped: rows.length, blocked: "este entorno no admite datos: no se escribe nada" };
    for (const row of rows) {
      const problems = validateRow(table, row);
      if (problems.length > 0) throw new Error(`fila no válida para ${table}: ${problems[0]}`);
    }
    if (rows.length === 0) return { inserted: 0, skipped: 0 };
    const client = await this.options.client();
    // one call per company: the function checks the right to write in THAT company
    const byTenant = new Map<string, Row[]>();
    for (const row of rows) byTenant.set(String(row["tenant_id"]), [...(byTenant.get(String(row["tenant_id"])) ?? []), row]);
    let inserted = 0;
    for (const [tenantId, own] of byTenant) {
      if (table === "storage_objects") {
        for (const row of own) {
          const { data, error } = await client.rpc("register_storage_object", { p_tenant: tenantId, p_bucket: row["bucket"], p_path: row["path"], p_mime: row["mime"], p_bytes: row["bytes"] });
          if (error) throw new Error("no se pudo registrar el archivo");
          if (data) inserted += 1;
        }
        continue;
      }
      const { data, error } = table === "platform_events"
        ? await client.rpc("append_platform_events", { p_tenant: tenantId, p_events: own.map(eventArgs) })
        : await client.rpc("append_platform_audit", { p_tenant: tenantId, p_records: own.map(auditArgs) });
      if (error) throw new Error(`no se pudo escribir en ${table}`);
      inserted += typeof data === "number" ? data : 0;
    }
    return { inserted, skipped: rows.length - inserted };
  }

  async select(table: PersistedTable, tenantId: string): Promise<Row[]> {
    if (!this.allowed) return [];
    const { data, error } = await (await this.options.client()).from(table).select("*").eq("tenant_id", tenantId);
    if (error) throw new Error(`no se pudo leer ${table}`);
    return data ?? [];
  }

  async auditTail(tenantId: string): Promise<AuditTail | null> {
    if (!this.allowed) return null;
    const { data, error } = await (await this.options.client()).from("platform_audit").select("seq,hash").eq("tenant_id", tenantId).order("seq", { ascending: false }).limit(1);
    if (error) throw new Error("no se pudo leer la cadena de auditoría");
    const last = data?.[0];
    return last ? { seq: Number(last["seq"]), hash: String(last["hash"]) } : null;
  }
}
