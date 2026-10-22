import type { Role } from "@/config/roles";
import type { ActivitySink } from "@/platform/activity";
import { CONNECTORS } from "./catalog";
import { allows, configureInput, type Capability, type ConnectorDef, type Health, type IntegrationRecord, type Kind, type Status, type Stored } from "./domain";
import { effectiveStatus, healthOf, totals, type IntegrationState } from "./status";
import type { IntegrationsStore } from "./store";

export interface Actor { tenantId: string; userId: string; role: Role; requestId?: string }
export class IntegrationsFrameworkError extends Error {
  readonly status: number;
  constructor(readonly code: "forbidden" | "not_found" | "validation_failed" | "coming_soon", message: string, readonly details?: Record<string, unknown>) { super(message); this.name = "IntegrationsFrameworkError"; this.status = { forbidden: 403, not_found: 404, validation_failed: 422, coming_soon: 409 }[code]; }
}
export const isIntegrationsFrameworkError = (e: unknown): e is IntegrationsFrameworkError => e instanceof IntegrationsFrameworkError || (typeof e === "object" && e !== null && (e as { name?: string }).name === "IntegrationsFrameworkError");
export interface CompanyIntegration { key: string; name: string; kind: Kind; capabilities: readonly string[]; fields: readonly string[]; status: Status; health: Health; lastSyncAt: number | null; config: Record<string, string> }
export interface IntegrationsDeps { store: IntegrationsStore; catalog?: readonly ConnectorDef[]; now?: () => number; activity?: ActivitySink }
export type CompanyIntegrationsService = ReturnType<typeof createCompanyIntegrationsService>;

export function createCompanyIntegrationsService(deps: IntegrationsDeps) {
  const { store } = deps, catalog = deps.catalog ?? CONNECTORS, now = deps.now ?? Date.now;
  const need = (a: Actor, c: Capability): void => { if (!allows(a.role, c)) throw new IntegrationsFrameworkError("forbidden", "Your role cannot do this."); };
  const def = (key: string): ConnectorDef => catalog.find((d) => d.key === key) ?? (() => { throw new IntegrationsFrameworkError("not_found", "That integration does not exist."); })();
  const rec = async (a: Actor, action: string, summary: string) => { await deps.activity?.record({ tenantId: a.tenantId, ...(a.requestId ? { requestId: a.requestId } : {}) }, { module: "company-integrations", source: "company_integrations", action, summary, actorKind: "user", actorId: a.userId, mode: "production", idempotencyKey: `ci:${a.tenantId}:${action}:${now()}` }); };

  async function list(a: Actor): Promise<CompanyIntegration[]> {
    need(a, "view"); const rows = new Map((await store.list(a.tenantId)).map((r) => [r.connector, r]));
    return catalog.map((d) => { const r = rows.get(d.key) ?? null, status = effectiveStatus(d, r); return { key: d.key, name: d.name, kind: d.kind, capabilities: d.capabilities, fields: d.fields, status, health: healthOf(status), lastSyncAt: status === "coming_soon" ? null : (r?.lastSyncAt ?? null), config: status === "coming_soon" ? {} : (r?.config ?? {}) }; });
  }
  /** The plain map other systems read. */
  async function state(a: Actor): Promise<IntegrationState> { return Object.fromEntries((await list(a)).map((i) => [i.key, i.status])); }
  async function summary(a: Actor) { const s = await state(a); return { state: s, totals: totals(s) }; }
  /** Saves the non-secret identifiers of a connector. A connector without an adapter cannot be configured: it is "coming soon". */
  async function configure(a: Actor, key: string, input: unknown): Promise<CompanyIntegration> {
    need(a, "manage"); const d = def(key);
    if (!d.available) throw new IntegrationsFrameworkError("coming_soon", "This integration is coming soon.");
    const p = configureInput.safeParse(input);
    if (!p.success) throw new IntegrationsFrameworkError("validation_failed", "The request is not valid.", { fields: p.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    const bad = Object.keys(p.data.config).filter((k) => !d.fields.includes(k));
    if (bad.length) throw new IntegrationsFrameworkError("validation_failed", "Unknown field.", { fields: bad.map((field) => ({ field: `config.${field}`, message: "Not a field of this integration." })) });
    const cur = (await store.list(a.tenantId)).find((r) => r.connector === key) ?? null, t = now();
    const config = Object.fromEntries(Object.entries({ ...(cur?.config ?? {}), ...p.data.config }).filter(([, v]) => v !== ""));
    const status: Stored = cur && cur.status !== "not_configured" ? cur.status : Object.keys(config).length ? "pending" : "not_configured";
    await store.put({ tenantId: a.tenantId, connector: key, status, config, credentialRef: cur?.credentialRef ?? null, lastSyncAt: cur?.lastSyncAt ?? null, updatedBy: a.userId, createdAt: cur?.createdAt ?? t, updatedAt: t } satisfies IntegrationRecord);
    await rec(a, "integrations.configured", `Integration configured: ${d.name}`);
    return (await list(a)).find((i) => i.key === key)!;
  }
  /** Adapter hook (future): an adapter reports what it really observed. Never reachable from the API. */
  async function report(a: Actor, key: string, status: Stored, lastSyncAt: number | null = null): Promise<void> {
    need(a, "manage"); const d = def(key); if (!d.available) throw new IntegrationsFrameworkError("coming_soon", "This integration is coming soon.");
    const cur = (await store.list(a.tenantId)).find((r) => r.connector === key) ?? null, t = now();
    await store.put({ tenantId: a.tenantId, connector: key, status, config: cur?.config ?? {}, credentialRef: cur?.credentialRef ?? null, lastSyncAt, updatedBy: a.userId, createdAt: cur?.createdAt ?? t, updatedAt: t });
  }
  return { list, state, summary, configure, report, permissions: (a: Actor) => ({ capabilities: (["view", "manage"] as const).filter((c) => allows(a.role, c)) }) };
}
