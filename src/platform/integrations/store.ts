import type { IntegrationRecord } from "./domain";

/** Persistence port. EVERY method takes the tenant id; a company only ever sees its own integrations. */
export interface IntegrationsStore {
  list(tenantId: string): Promise<IntegrationRecord[]>;
  put(row: IntegrationRecord): Promise<void>;
}
export function createMemoryIntegrationsStore(): IntegrationsStore {
  const rows = new Map<string, IntegrationRecord>();
  return {
    async list(t) { return [...rows.values()].filter((r) => r.tenantId === t).map((r) => structuredClone(r)); },
    async put(r) { rows.set(`${r.tenantId}:${r.connector}`, structuredClone(r)); },
  };
}
