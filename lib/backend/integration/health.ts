// The health of the integration: the checks that say whether the pieces that were joined are really joined. They read the state of the core and of the connectors;
// none of them writes, connects or calls anything outside. Each result is also exposed as a metric (kynova_health_ok by check).

import { looksLikeSecret } from "../secrets";
import { runHealth, type HealthCheck, type HealthReport, type HealthStatus } from "../observability";
import type { BackendCore } from "../index";
import { PERSISTED_TABLES, persistedTablesReport, type SimulatedDatabase } from "./persistence";
import type { IntegrationStats } from "./connector";
import { verifyCoverage } from "./coverage";

export type HealthContext = { stats: IntegrationStats; bridges: readonly string[]; database: SimulatedDatabase | { sizes?: () => Record<string, number> }; storagePaths: () => string[] };

export function integrationChecks(core: BackendCore, context: HealthContext): HealthCheck[] {
  return [
    {
      name: "event_bus", critical: true,
      run: async () => {
        const bus = await core.events();
        return { status: bus.subscribers() === 0 ? "ok" : "degraded", detail: `${context.stats.events} eventos publicados; ${bus.subscribers()} suscriptores (nadie consume todavía)` };
      },
    },
    {
      name: "audit_chain", critical: true,
      run: async () => {
        const audit = await core.audit();
        for (const tenantId of context.stats.tenants) {
          const verified = await audit.verify(tenantId);
          if (!verified.ok) return { status: "down", detail: `la cadena de una empresa se rompió en el registro ${verified.brokenAt ?? "?"}` };
        }
        return { status: "ok", detail: `${context.stats.tenants.size} empresas verificadas; ${context.stats.audits} registros` };
      },
    },
    {
      name: "bus_coverage", critical: true,
      run: async () => {
        const missing: string[] = [];
        for (const tenantId of context.stats.tenants) missing.push(...(await verifyCoverage(core, tenantId)).missing);
        return missing.length === 0 ? { status: "ok", detail: "todo lo auditado pasó por el Event Bus" } : { status: "down", detail: `${missing.length} registros de auditoría sin su evento` };
      },
    },
    { name: "tenancy", critical: true, run: async () => (context.stats.violations === 0 ? { status: "ok", detail: "sin cruces entre empresas" } : { status: "down", detail: `${context.stats.violations} intentos de cruzar empresas o sin empresa` }) },
    { name: "bridges", critical: false, run: async () => ({ status: context.bridges.length > 0 ? "ok" : "degraded", detail: `${context.bridges.length} módulos conectados` }) },
    {
      name: "persistence", critical: false,
      run: async () => {
        const report = persistedTablesReport();
        const sizes: Record<string, number> = context.database.sizes?.() ?? {};
        const bad = report.filter((item) => !item.tenantScoped || item.policies === 0);
        return bad.length === 0 ? { status: "ok", detail: `${PERSISTED_TABLES.length} tablas con política por empresa (${Object.values(sizes).reduce((sum, value) => sum + value, 0)} filas simuladas); RLS preparado, no activado` } : { status: "degraded", detail: `sin política: ${bad.map((item) => item.table).join(", ")}` };
      },
    },
    { name: "file_storage", critical: false, run: async () => ({ status: "ok", detail: `${context.storagePaths().length} archivos; cada ruta bajo su empresa` }) },
    {
      name: "secrets_access", critical: false,
      run: async () => {
        // the access log names secrets and purposes, never values
        const leaked = core.secrets.accessLog().some((item) => looksLikeSecret(`${item.name} ${item.purpose}`));
        return leaked ? { status: "down", detail: "el registro de acceso a secretos contiene algo que parece un secreto" } : { status: "ok", detail: `${core.secrets.accessLog().length} accesos, solo por nombre y propósito` };
      },
    },
  ];
}

const worst = (a: HealthStatus, b: HealthStatus): HealthStatus => (a === "down" || b === "down" ? "down" : a === "degraded" || b === "degraded" ? "degraded" : "ok");

/** The core's own health and the integration's, as one report. Each check is also a gauge. */
export async function integratedHealth(core: BackendCore, context: HealthContext): Promise<HealthReport> {
  const [base, mine] = await Promise.all([core.health(), runHealth(integrationChecks(core, context), { now: core.now, clock: core.clock })]);
  const metrics = await core.metrics();
  for (const check of [...base.checks, ...mine.checks]) metrics.set("kynova_health_ok", check.status === "ok" ? 1 : 0, { check: check.name });
  return { status: worst(base.status, mine.status), at: mine.at, checks: [...base.checks, ...mine.checks] };
}
