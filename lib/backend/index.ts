// The Backend Core of the platform, assembled. Everything is created the first time it is asked for (lazy), takes its configuration from the Environment
// Manager, and does nothing on its own: no connection, no external API, no provider. It is the base every module and KOE will connect to later.
// `koeView` is the read-only face KOE will use: it can read events, the audit trail, the data contracts and the health, and it can change nothing.
import { SupabaseClients, type ClientLoader, defaultLoader } from "@/lib/db/core-clients";
import { AuditLog } from "./audit";
import { ENTITIES } from "./entities";
import { loadConfig, type BackendConfig, type EnvSource } from "./env";
import { EventBus, InMemoryEventStore } from "./events";
import { Logger, MemoryLogSink, Metrics, MemorySpanSink, Tracer, runHealth, type HealthCheck, type HealthReport } from "./observability";
import { Lazy, TtlCache } from "./performance";
import { RLS_STATE, auditPolicies } from "./rls";
import { EnvSecretsProvider, SecretsManager } from "./secrets";
import { BUCKET_IDS } from "./storage";

export type BackendOptions = { vars: EnvSource; clock?: () => string; now?: () => number; loader?: ClientLoader; isServer?: () => boolean };

/** Which of the pieces of the Backend Core exist, and what state each one is in. The README and a test read this list. */
export const BACKEND_MANIFEST = [
  { id: "supabase", title: "Supabase: conexión, variables, clientes y helpers", status: "prepared", file: "lib/db/core-clients.ts", note: "Perezoso: no conecta hasta que se pide un cliente, y no se usan datos reales." },
  { id: "auth", title: "Auth: sesión, refresco, rutas protegidas, roles y permisos", status: "prepared", file: "lib/backend/auth.ts", note: "Reutiliza el inicio de sesión que funciona; no lo reemplaza." },
  { id: "organization", title: "Organización: tenant, organización, persona y rol", status: "built", file: "lib/backend/entities.ts", note: "El contexto de cada petición y el filtro por empresa." },
  { id: "rls", title: "RLS: políticas por empresa", status: "prepared", file: "lib/backend/rls.ts", note: "Escritas y auditadas, sin activar." },
  { id: "database", title: "Base de datos: contratos de las once áreas", status: "prepared", file: "lib/backend/entities.ts", note: "Solo contratos, sin migraciones nuevas." },
  { id: "storage", title: "Storage: documentos, imágenes, videos, avatares, Academy y Marketplace", status: "prepared", file: "lib/backend/storage.ts", note: "Rutas por empresa, límites y tipos; sin servicio de archivos." },
  { id: "events", title: "Event Bus interno", status: "built", file: "lib/backend/events.ts", note: "Todos publican; nada consume todavía." },
  { id: "audit", title: "Auditoría central encadenada", status: "built", file: "lib/backend/audit.ts", note: "Un solo contrato para todos los módulos; solo crece." },
  { id: "environment", title: "Environment Manager", status: "built", file: "lib/backend/env.ts", note: "Development, Preview y Production." },
  { id: "security", title: "Secrets Manager, cifrado y hashes", status: "built", file: "lib/backend/secrets.ts", note: "Ningún secreto en el código." },
  { id: "performance", title: "Pool de conexiones, caché y arranque perezoso", status: "built", file: "lib/backend/performance.ts", note: "Genéricos: no conectan a nada por sí solos." },
  { id: "observability", title: "Logging, trazas, salud y métricas", status: "prepared", file: "lib/backend/observability.ts", note: "Solo arquitectura: sin servicio de destino." },
  { id: "integration", title: "Integración con los módulos", status: "built", file: "lib/backend/integration/index.ts", note: "Envuelve el reductor de cada módulo sin cambiarlo: lo que registra pasa al Event Bus, a la auditoría, a las métricas y a las trazas." },
  { id: "koe", title: "Vista de solo lectura para KOE", status: "built", file: "lib/backend/index.ts", note: "KOE no se modifica." },
] as const;

export function createBackendCore(options: BackendOptions) {
  const now = options.now ?? Date.now;
  const clock = options.clock ?? (() => new Date(now()).toISOString());
  const config: BackendConfig = loadConfig(options.vars);
  const secrets = new SecretsManager(new EnvSecretsProvider(options.vars), clock);
  const logs = new MemoryLogSink();
  const spans = new MemorySpanSink();
  const lazy = {
    events: new Lazy(() => new EventBus(new InMemoryEventStore(), clock)),
    audit: new Lazy(() => new AuditLog()),
    clients: new Lazy(() => new SupabaseClients(config, secrets, options.loader ?? defaultLoader, options.isServer)),
    metrics: new Lazy(() => new Metrics()),
    cache: new Lazy(() => new TtlCache<unknown>({ ttlMs: 60_000, maxEntries: 500, now })),
  };
  const logger = new Logger({ level: config.logLevel, sink: logs, clock, base: { environment: config.environment } });
  const tracer = new Tracer({ sample: config.traceSample, sink: spans, now });

  const checks = (): HealthCheck[] => [
    {
      name: "environment", critical: true,
      run: async () => (config.report.ok ? { status: "ok" } : { status: config.environment === "production" ? "down" : "degraded", detail: `faltan: ${config.report.missing.join(", ") || "—"}; no válidas: ${config.report.invalid.join(", ") || "—"}` }),
    },
    { name: "secrets", critical: config.environment === "production", run: async () => ({ status: secrets.has("KYNOVA_ENCRYPTION_KEY") && secrets.has("KYNOVA_HASH_PEPPER") ? "ok" : config.environment === "production" ? "down" : "degraded", detail: "cifrado y pimienta" }) },
    { name: "supabase", critical: false, run: async () => ({ status: config.supabase ? "ok" : "degraded", detail: config.supabase ? "configurado (no se conecta en esta comprobación)" : "sin configurar" }) },
    { name: "rls", critical: false, run: async () => ({ status: auditPolicies().length === 0 ? "ok" : "degraded", detail: RLS_STATE.activated ? "activado" : "preparado, no activado" }) },
    { name: "storage", critical: false, run: async () => ({ status: "ok", detail: `${BUCKET_IDS.length} espacios declarados` }) },
  ];

  return {
    config,
    clock,
    now,
    secrets,
    logger,
    tracer,
    logs,
    spans,
    events: () => lazy.events.get(),
    audit: () => lazy.audit.get(),
    clients: () => lazy.clients.get(),
    metrics: () => lazy.metrics.get(),
    cache: () => lazy.cache.get(),
    health: (): Promise<HealthReport> => runHealth(checks(), { now, clock }),
    /** Which lazy pieces have been created so far. */
    initialized: () => ({ events: lazy.events.initialized, audit: lazy.audit.initialized, clients: lazy.clients.initialized, metrics: lazy.metrics.initialized, cache: lazy.cache.initialized }),
  };
}
export type BackendCore = ReturnType<typeof createBackendCore>;

/** What KOE will be able to use of the Backend Core: everything it needs to read, and nothing that changes a thing. */
export function koeView(core: BackendCore) {
  return {
    environment: core.config.environment,
    entities: ENTITIES,
    async readEvents(tenantId: string, after = 0, limit = 100) {
      return (await core.events()).store.read({ tenantId, after, limit });
    },
    async readAudit(tenantId: string, filter?: Parameters<AuditLog["list"]>[1]) {
      return (await core.audit()).list(tenantId, filter);
    },
    async verifyAudit(tenantId: string) {
      return (await core.audit()).verify(tenantId);
    },
    health: () => core.health(),
  };
}
export type BackendForKoe = ReturnType<typeof koeView>;
