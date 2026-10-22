import type { D1Database } from "@cloudflare/workers-types";
import type { IntegrationRecord, Stored } from "./domain";
import type { IntegrationsStore } from "./store";

type Row = Record<string, unknown>;
const J = (v: unknown): Record<string, string> => { try { const x = JSON.parse(String(v)) as unknown; return x && typeof x === "object" ? (x as Record<string, string>) : {}; } catch { return {}; } };
/** Plain parameterized SQL, every statement scoped by tenant_id. */
export function createD1IntegrationsStore(d1: D1Database): IntegrationsStore {
  return {
    async list(t) {
      const r = await d1.prepare("SELECT * FROM ci_integrations WHERE tenant_id = ?").bind(t).all<Row>();
      return r.results.map((x) => ({ tenantId: t, connector: String(x.connector), status: String(x.status) as Stored, config: J(x.config), credentialRef: (x.credential_ref as string | null) ?? null, lastSyncAt: (x.last_sync_at as number | null) ?? null, updatedBy: String(x.updated_by), createdAt: Number(x.created_at), updatedAt: Number(x.updated_at) }));
    },
    async put(r) {
      await d1.prepare("INSERT INTO ci_integrations (tenant_id, connector, status, config, credential_ref, last_sync_at, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id, connector) DO UPDATE SET status=excluded.status, config=excluded.config, credential_ref=excluded.credential_ref, last_sync_at=excluded.last_sync_at, updated_by=excluded.updated_by, updated_at=excluded.updated_at")
        .bind(r.tenantId, r.connector, r.status, JSON.stringify(r.config), r.credentialRef, r.lastSyncAt, r.updatedBy, r.createdAt, r.updatedAt).run();
    },
  };
}
