// Persistence, PREPARED and never real: how the events, the audit and the file records the integration produces would be written to the tables the data contract
// already declares (platform_events, audit_log, storage_objects), under the same tenant_id and the policies already written in rls.ts. Two adapters answer the same
// port: a simulated database (what runs today, in memory) and a Supabase adapter that is lazy, filters every read by company, only inserts into append-only
// tables, has no update and no delete, and writes nothing at all while the environment does not allow real data (it allows none yet).

import type { AuditRecord } from "../audit";
import { entityOf, type Entity } from "../entities";
import { ENVIRONMENT_POLICIES, type Environment, type EnvironmentPolicy } from "../env";
import type { StoredEvent } from "../events";
import { RLS_STATE, policiesFor } from "../rls";

export const PERSISTED_TABLES = ["platform_events", "audit_log", "storage_objects"] as const;
export type PersistedTable = (typeof PERSISTED_TABLES)[number];
export type RowValue = string | number | boolean | null | Record<string, unknown>;
export type Row = Record<string, RowValue>;

export type WriteResult = { inserted: number; skipped: number; blocked?: string };
/** Only what the integration needs: add rows, and read the rows of ONE company. Nothing updates or deletes a row. */
export interface PersistencePort {
  insert(table: PersistedTable, rows: readonly Row[]): Promise<WriteResult>;
  select(table: PersistedTable, tenantId: string): Promise<Row[]>;
}

// ---------------------------------------------------------------- the rows, shaped by the entity contracts
export function eventRow(event: StoredEvent): Row {
  return {
    id: event.id, tenant_id: event.tenantId, organization_id: event.organizationId ?? null, created_at: event.at, updated_at: event.at, created_by: null,
    type: event.type, module: event.module, actor: event.actor, payload: { ...event.payload }, seq: event.seq,
  };
}
export function auditRow(record: AuditRecord): Row {
  return {
    id: record.id, tenant_id: record.tenantId, organization_id: record.organizationId ?? null, created_at: record.at, updated_at: record.at, created_by: null,
    actor_id: record.actorId, module: record.module, action: record.action, category: record.category, outcome: record.outcome, prev_hash: record.prevHash, hash: record.hash,
  };
}
export function storageRow(input: { id: string; tenantId: string; bucket: string; path: string; mime: string; bytes: number; at: string }): Row {
  return {
    id: input.id, tenant_id: input.tenantId, organization_id: null, created_at: input.at, updated_at: input.at, created_by: null,
    bucket: input.bucket, path: input.path, mime: input.mime, bytes: input.bytes, scanned: false,
  };
}

const TYPE_OK: Record<string, (value: RowValue) => boolean> = {
  uuid: (value) => typeof value === "string" && value !== "", // real rows will be UUIDs; the simulation uses the company ids it already has
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

/** What the data contract and the planned policies say about the tables the integration writes. A test reads it; nothing here activates anything. */
export function persistedTablesReport(): { table: PersistedTable; appendOnly: boolean; tenantScoped: boolean; policies: number; activated: boolean }[] {
  return PERSISTED_TABLES.map((table) => {
    const entity = entityOf(table) as Entity;
    return { table, appendOnly: entity.appendOnly, tenantScoped: entity.scope === "tenant", policies: policiesFor(entity).length, activated: RLS_STATE.activated };
  });
}

// ---------------------------------------------------------------- the simulated database (what runs today)
/** In memory. Rows are only added (a repeated id is skipped, never replaced), every row is validated against its entity, and every read names one company. */
export class SimulatedDatabase implements PersistencePort {
  private readonly tables = new Map<PersistedTable, Row[]>();
  private readonly ids = new Map<PersistedTable, Set<string>>();

  async insert(table: PersistedTable, rows: readonly Row[]): Promise<WriteResult> {
    const seen = this.ids.get(table) ?? new Set<string>();
    const stored = this.tables.get(table) ?? [];
    let inserted = 0;
    let skipped = 0;
    for (const row of rows) {
      const problems = validateRow(table, row);
      if (problems.length > 0) throw new Error(`fila no válida para ${table}: ${problems[0]}`);
      const id = String(row["id"]);
      if (seen.has(id)) { skipped += 1; continue; }
      seen.add(id);
      stored.push(Object.freeze({ ...row }) as Row);
      inserted += 1;
    }
    this.ids.set(table, seen);
    this.tables.set(table, stored);
    return { inserted, skipped };
  }

  async select(table: PersistedTable, tenantId: string): Promise<Row[]> {
    return (this.tables.get(table) ?? []).filter((row) => row["tenant_id"] === tenantId).map((row) => ({ ...row }));
  }

  /** How many rows each table holds, for the health check. Never the rows. */
  sizes(): Record<PersistedTable, number> {
    return { platform_events: this.tables.get("platform_events")?.length ?? 0, audit_log: this.tables.get("audit_log")?.length ?? 0, storage_objects: this.tables.get("storage_objects")?.length ?? 0 };
  }
}

// ---------------------------------------------------------------- the Supabase adapter (prepared, blocked while no environment allows real data)
type Failure = { message: string } | null;
/** The small part of a Supabase client the adapter uses. A test gives it a fake; no network is involved. */
export interface DatabaseClient {
  from(table: string): {
    insert(rows: readonly Row[]): Promise<{ error: Failure }>;
    select(columns: string): { eq(column: string, value: string): Promise<{ data: Row[] | null; error: Failure }> };
  };
}

export class SupabasePersistence implements PersistencePort {
  /** `client` is only asked for when a write or a read is really allowed, so a blocked adapter never touches the library. */
  constructor(private readonly options: { environment: Environment; client: () => Promise<DatabaseClient>; policy?: Pick<EnvironmentPolicy, "realData"> }) {}

  private get allowed(): boolean {
    return (this.options.policy ?? ENVIRONMENT_POLICIES[this.options.environment]).realData;
  }

  async insert(table: PersistedTable, rows: readonly Row[]): Promise<WriteResult> {
    if (!(PERSISTED_TABLES as readonly string[]).includes(table)) throw new Error(`la tabla ${table} no se escribe desde la integración`);
    if (!this.allowed) return { inserted: 0, skipped: rows.length, blocked: "este entorno no admite datos reales: no se escribe nada" };
    for (const row of rows) {
      const problems = validateRow(table, row);
      if (problems.length > 0) throw new Error(`fila no válida para ${table}: ${problems[0]}`);
    }
    const { error } = await (await this.options.client()).from(table).insert(rows);
    if (error) throw new Error(`no se pudo escribir en ${table}`);
    return { inserted: rows.length, skipped: 0 };
  }

  async select(table: PersistedTable, tenantId: string): Promise<Row[]> {
    if (!this.allowed) return [];
    const { data, error } = await (await this.options.client()).from(table).select("*").eq("tenant_id", tenantId);
    if (error) throw new Error(`no se pudo leer ${table}`);
    return data ?? [];
  }
}
