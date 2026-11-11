// The integrated platform: the Backend Core joined to every module through its bridge. `connectPlatform(core)` gives one connector per module (wrapping the module's own
// reducer, unchanged), a simulated database and storage, and the checks that say the join holds. It connects to nothing outside the process: every adapter is a simulation,
// and no module imports any of this.

import type { TenantContext } from "../entities";
import type { BackendCore } from "../index";
import { archiveAudit, MemoryStorage, readArchive, type ArchiveResult, type ReadResult } from "./archive";
import { BRIDGES, BRIDGE_IDS, type BridgeId, type EventOf, type ResultOf, type StateOf } from "./bridges";
import { Connector, newStats, type Bridge, type IntegrationStats, type ReduceResult } from "./connector";
import { verifyCoverage, type Coverage } from "./coverage";
import { integratedHealth } from "./health";
import { auditRow, eventRow, SimulatedDatabase, SupabasePersistence, type DatabaseClient, type PersistencePort, type WriteResult } from "./persistence";
import { SupabaseStorage, type StorageClient } from "./supabase-storage";
import type { StorageAdapter } from "../storage";

export * from "./connector";
export * from "./bridges";
export * from "./persistence";
export * from "./archive";
export * from "./supabase-storage";
export * from "./coverage";
export { integrationChecks, integratedHealth } from "./health";

export type PlatformOptions = { database?: PersistencePort; storage?: StorageAdapter; supabase?: { configured: boolean; probe: () => Promise<boolean> } };
const BRIDGE_LIST = Object.values(BRIDGES) as unknown as readonly Bridge<unknown, unknown, ReduceResult<unknown>>[];

export function connectPlatform(core: BackendCore, options: PlatformOptions = {}) {
  const stats: IntegrationStats = newStats();
  const database = options.database ?? new SimulatedDatabase();
  const storage = options.storage ?? new MemoryStorage();
  const connectors = new Map<string, Connector<unknown, unknown, ReduceResult<unknown>>>(BRIDGE_LIST.map((item) => [item.id, new Connector(core, item, stats)]));
  const connectorOf = (id: BridgeId) => connectors.get(id) as Connector<unknown, unknown, ReduceResult<unknown>>;

  return {
    stats,
    database,
    storage,
    bridges: BRIDGE_IDS,
    /** Runs a module's own reducer and carries what it recorded into the Backend Core. The result is the module's, untouched. */
    run: <K extends BridgeId>(id: K, state: StateOf<K>, event: EventOf<K>, context?: TenantContext | null): Promise<ResultOf<K>> => connectorOf(id).reduce(state, event, context) as Promise<ResultOf<K>>,
    /** The first connection of a module that already has history. */
    backfill: <K extends BridgeId>(id: K, state: StateOf<K>): Promise<number> => connectorOf(id).backfill(state),
    tenants: (): string[] => [...stats.tenants].sort(),
    /**
     * Continues the audit chain of a company from the last record stored in the database, so a new instance never restarts it at 1. Call it before the first call
     * for that company in this instance; it does nothing when the company has no stored records, and refuses when this instance already holds some.
     */
    async resume(tenantId: string): Promise<{ resumed: boolean; seq: number }> {
      const tail = await database.auditTail(tenantId);
      if (!tail) return { resumed: false, seq: 0 };
      (await core.audit()).resume(tenantId, tail);
      return { resumed: true, seq: tail.seq };
    },
    /** Writes ONE company's events and audit records to the database port (the simulated one today). Safe to repeat: rows already there are skipped. */
    async persist(tenantId: string): Promise<{ events: WriteResult; audit: WriteResult }> {
      const events = (await core.events()).store.read({ tenantId, after: 0, limit: 100_000 }).map(eventRow);
      const audit = (await core.audit()).list(tenantId).map(auditRow);
      return { events: await database.insert("platform_events", events), audit: await database.insert("platform_audit", audit) };
    },
    archive: (tenantId: string): Promise<ArchiveResult> => archiveAudit(core, storage, database, tenantId),
    readArchive: (tenantId: string, path: string): Promise<ReadResult> => readArchive(core, storage, tenantId, path),
    coverage: (tenantId: string): Promise<Coverage> => verifyCoverage(core, tenantId),
    health: () =>
      integratedHealth(core, {
        stats, bridges: BRIDGE_IDS, database: database instanceof SimulatedDatabase ? database : {}, storagePaths: () => (storage instanceof MemoryStorage ? storage.paths() : []),
        ...(options.supabase ? { supabase: options.supabase } : {}),
      }),
  };
}
export type IntegratedPlatform = ReturnType<typeof connectPlatform>;

const NIL_TENANT = "00000000-0000-0000-0000-000000000000";

/**
 * The platform connected to Supabase, for ONE request: `client` is the signed-in person's client (the cookie client of that request), so RLS and the Storage policies
 * apply to that person and nothing here ever uses the server key. Events, audit and file records are written through the migration's functions; files go to the
 * `documents` bucket. Nothing is written while the environment admits no data (production, until its gates are met).
 */
export function connectSupabasePlatform(core: BackendCore, client: DatabaseClient & StorageClient): IntegratedPlatform {
  const environment = core.config.environment;
  const database = new SupabasePersistence({ environment, client: async () => client });
  const storage = new SupabaseStorage({ environment, client: async () => client });
  const probe = async () => !(await client.from("platform_events").select("id").eq("tenant_id", NIL_TENANT).limit(1)).error;
  return connectPlatform(core, { database, storage, supabase: { configured: core.config.supabase !== null && core.config.supabase !== undefined, probe } });
}
