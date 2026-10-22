import { createMemoryIntegrationsStore, type IntegrationsStore } from "./store";

let override: IntegrationsStore | null = null;
export const setIntegrationsStore = (s: IntegrationsStore | null): void => { override = s; };
const g = globalThis as unknown as { __kynovaCiDevStore?: IntegrationsStore };
const isDevLike = (): boolean => process.env.APP_ENV === "local" || process.env.NODE_ENV === "test" || process.env.NODE_ENV === "development";
export async function getIntegrationsStore(): Promise<IntegrationsStore> {
  if (override) return override;
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const d1 = getCloudflareContext().env.DB;
    if (d1) { const { createD1IntegrationsStore } = await import("./store-d1"); return createD1IntegrationsStore(d1); }
  } catch { /* no Cloudflare context */ }
  if (!isDevLike()) throw new Error("The integrations database is not available. Check the D1 binding.");
  return (g.__kynovaCiDevStore ??= createMemoryIntegrationsStore());
}
