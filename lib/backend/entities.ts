// The database contract of the platform: every entity of every module, with its columns, who owns it and how it is protected. Contracts only, no
// migrations: a table that already exists in supabase/migrations is marked `existing` (a test keeps that honest), and every other one is `planned`.
// Every row belongs to a company (tenant_id), and an organization of that company when it has one. Secrets are never stored: a credential is a hash.
import type { ModuleId } from "./events";

export type ColumnType = "uuid" | "text" | "int" | "bigint" | "bool" | "timestamptz" | "jsonb";
export type Column = { name: string; type: ColumnType; nullable: boolean; pii: boolean; ref?: string };

/** `tenant`: rows of a company (tenant_id). `tenant-self`: the company itself (its own id). `user`: rows of a person, visible to people who share a company. */
export type EntityScope = "tenant" | "tenant-self" | "user";
/** The same kinds the migrations already use: `read` (members read, writes go through functions), `rw` (writers insert and update), `rw_delete`, `admin` (administrators write). */
export type RlsKind = "read" | "rw" | "rw_delete" | "admin";

export type Entity = {
  table: string;
  module: ModuleId;
  scope: EntityScope;
  status: "existing" | "planned";
  rls: RlsKind;
  /** Rows are only ever added: no update and no delete policy exists. */
  appendOnly: boolean;
  columns: readonly Column[];
  description: string;
};

// "name:type" plus optional "?" (nullable), "*" (personal data) and "->table" (reference).
function column(spec: string): Column {
  const match = /^(\w+):(\w+)(\?)?(\*)?(?:->(\w+(?:\.\w+)?))?$/.exec(spec);
  if (!match) throw new Error(`columna no válida: ${spec}`);
  return { name: match[1] as string, type: match[2] as ColumnType, nullable: match[3] === "?", pii: match[4] === "*", ...(match[5] ? { ref: match[5] } : {}) };
}
const BASE = ["id:uuid", "tenant_id:uuid->tenants.id", "organization_id:uuid?->organizations.id", "created_at:timestamptz", "updated_at:timestamptz", "created_by:uuid?"];

type Options = { scope?: EntityScope; status?: "existing" | "planned"; rls?: RlsKind; appendOnly?: boolean };
const entity = (module: ModuleId, table: string, description: string, extra: string[], options: Options = {}): Entity => {
  const scope = options.scope ?? "tenant";
  const base = scope === "tenant" ? BASE : scope === "tenant-self" ? ["id:uuid", "created_at:timestamptz", "updated_at:timestamptz"] : ["user_id:uuid->auth.users", "created_at:timestamptz", "updated_at:timestamptz"];
  return { table, module, scope, status: options.status ?? "planned", rls: options.rls ?? "read", appendOnly: options.appendOnly ?? false, columns: [...base, ...extra].map(column), description };
};

export const ENTITIES: readonly Entity[] = [
  // ---- users
  entity("users", "user_profiles", "El perfil de cada persona.", ["display_name:text*", "locale:text?", "last_seen_at:timestamptz?"], { scope: "user", status: "existing" }),
  entity("users", "memberships", "Qué persona pertenece a qué empresa y con qué rol.", ["user_id:uuid->auth.users", "role_id:text"], { status: "existing", rls: "read" }),
  entity("users", "roles", "Los roles de cada empresa y sus permisos.", ["key:text", "name:text", "permissions:jsonb"], { rls: "admin" }),
  entity("users", "invitations", "Invitaciones a unirse a una empresa.", ["email:text*", "role_id:text", "status:text", "expires_at:timestamptz"], { status: "existing" }),
  // ---- organizations
  entity("organizations", "tenants", "La empresa.", ["name:text", "slug:text?"], { scope: "tenant-self", status: "existing", rls: "read" }),
  entity("organizations", "organizations", "Las organizaciones (sucursales y compañías hermanas) de una empresa.", ["name:text", "parent_id:uuid?->organizations.id"], { status: "existing", rls: "rw" }),
  // ---- workers
  entity("workers", "worker_instances", "Los Workers instalados por una empresa.", ["definition_id:text", "status:text", "max_runs_per_day:int"], { rls: "admin" }),
  entity("workers", "worker_runs", "Cada ejecución de un Worker, con su costo estimado.", ["instance_id:uuid->worker_instances.id", "outcome:text", "cost_micros:bigint", "model_label:text?"], { appendOnly: true }),
  // ---- automations
  entity("automations", "automations", "Las automatizaciones de una empresa.", ["name:text", "status:text", "definition:jsonb"], { rls: "rw" }),
  entity("automations", "automation_runs", "Cada corrida de una automatización.", ["automation_id:uuid->automations.id", "outcome:text", "mode:text"], { appendOnly: true }),
  // ---- marketplace
  entity("marketplace", "listings", "Lo que una empresa ofrece en el Marketplace.", ["kind:text", "title:text", "status:text", "price_minor:bigint?"], { rls: "rw" }),
  entity("marketplace", "purchases", "Compras del Marketplace.", ["listing_id:uuid->listings.id", "status:text"]),
  entity("marketplace", "charges", "Cobros y la parte de la plataforma.", ["purchase_id:uuid->purchases.id", "gross_minor:bigint", "fee_minor:bigint"], { appendOnly: true }),
  // ---- academy
  entity("academy", "courses", "Los cursos de una empresa.", ["title:text", "status:text", "content:jsonb"], { rls: "rw" }),
  entity("academy", "enrollments", "Quién cursa qué.", ["course_id:uuid->courses.id", "user_id:uuid->auth.users", "progress:jsonb"], { rls: "rw" }),
  entity("academy", "certificates", "Los certificados emitidos.", ["course_id:uuid->courses.id", "user_id:uuid->auth.users", "code:text", "holder_name:text*"], { appendOnly: true }),
  // ---- crm
  entity("crm", "contacts", "Personas con las que la empresa se relaciona.", ["name:text*", "email:text?*", "phone:text?*"], { status: "existing", rls: "rw" }),
  entity("crm", "leads", "Prospectos.", ["contact_id:uuid->contacts.id", "status:text", "source:text?"], { status: "existing", rls: "rw" }),
  entity("crm", "customers", "Clientes.", ["contact_id:uuid->contacts.id", "status:text"], { status: "existing", rls: "rw" }),
  entity("crm", "opportunities", "Oportunidades de venta.", ["contact_id:uuid->contacts.id", "stage:text", "amount_minor:bigint?"], { status: "existing", rls: "rw" }),
  entity("crm", "tasks", "Tareas de seguimiento.", ["title:text", "due_at:timestamptz?", "done:bool"], { status: "existing", rls: "rw_delete" }),
  // ---- billing
  entity("billing", "subscriptions", "El plan y la suscripción de cada empresa.", ["plan_id:text", "status:text", "renews_at:timestamptz"], { rls: "admin" }),
  entity("billing", "invoices", "Facturas emitidas: nunca se modifican.", ["number:text", "total_micros:bigint", "period_start:timestamptz", "period_end:timestamptz"], { appendOnly: true }),
  entity("billing", "payments", "Pagos y recibos registrados.", ["invoice_id:uuid->invoices.id", "amount_micros:bigint", "method:text"], { appendOnly: true }),
  entity("billing", "credits", "El libro de créditos de la cuenta.", ["amount_micros:bigint", "reason:text"], { appendOnly: true }),
  // ---- insights
  entity("insights", "metrics_daily", "Cifras diarias por empresa.", ["day:text", "metric:text", "value:bigint"], { status: "existing" }),
  entity("insights", "reports", "Reportes y sus destinatarios.", ["title:text", "status:text", "definition:jsonb"], { rls: "rw" }),
  // ---- developer
  entity("developer", "api_keys", "API Keys: solo un prefijo, los últimos cuatro y un hash; nunca la llave.", ["app_id:uuid", "name:text", "prefix:text", "last4:text", "key_hash:text", "scopes:jsonb", "status:text", "expires_at:timestamptz?"], { rls: "admin" }),
  entity("developer", "webhooks", "Webhooks de una empresa.", ["url:text", "events:jsonb", "status:text", "secret_hash:text"], { rls: "admin" }),
  entity("developer", "webhook_deliveries", "Cada entrega de un webhook y sus intentos.", ["webhook_id:uuid->webhooks.id", "event:text", "status:text", "attempts:jsonb"]),
  entity("developer", "api_requests", "El consumo de la API.", ["key_id:uuid->api_keys.id", "endpoint:text", "status:int", "count:int"], { appendOnly: true }),
  // ---- communications
  entity("communications", "conversations", "Conversaciones de todos los canales.", ["channel:text", "status:text", "assignee_id:uuid?"], { status: "existing" }),
  entity("communications", "messages", "Mensajes de una conversación.", ["conversation_id:uuid->conversations.id", "direction:text", "body:text*"], { status: "existing", appendOnly: true }),
  entity("communications", "integration_accounts", "Las cuentas de canales conectadas.", ["provider:text", "status:text"], { status: "existing", rls: "admin" }),
  // ---- the platform itself
  entity("organizations", "audit_log", "La auditoría central: solo crece.", ["actor_id:text", "module:text", "action:text", "category:text", "outcome:text", "prev_hash:text", "hash:text"], { status: "existing", appendOnly: true }),
  entity("koe", "platform_events", "El Event Bus: lo que publica cada módulo y KOE leerá.", ["type:text", "module:text", "actor:text", "payload:jsonb", "seq:bigint"], { appendOnly: true }),
  entity("organizations", "storage_objects", "Los archivos de la empresa: ruta, tipo y tamaño.", ["bucket:text", "path:text", "mime:text", "bytes:bigint", "scanned:bool"], { rls: "rw" }),
];

export const entityOf = (table: string): Entity | undefined => ENTITIES.find((item) => item.table === table);
export const entitiesOf = (module: ModuleId): Entity[] => ENTITIES.filter((item) => item.module === module);

/** The eleven areas of the platform's data. */
export const DATA_AREAS = ["users", "organizations", "workers", "automations", "marketplace", "academy", "crm", "billing", "insights", "developer", "communications"] as const satisfies readonly ModuleId[];

// ---------------------------------------------------------------- the identity of a request
/** Who is acting and for which company. Every query of every module carries one. */
export type TenantContext = { tenantId: string; organizationId: string | null; userId: string; roleId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ROLE_IDS = ["owner", "admin", "member", "viewer"] as const;

/** Reads a context from untrusted input. Anything missing or malformed is refused: there is no default company. */
export function parseTenantContext(value: unknown): TenantContext | null {
  if (typeof value !== "object" || value === null) return null;
  const input = value as Record<string, unknown>;
  const { tenantId, organizationId, userId, roleId } = input;
  if (typeof tenantId !== "string" || !UUID.test(tenantId) || typeof userId !== "string" || !UUID.test(userId)) return null;
  if (organizationId !== null && organizationId !== undefined && (typeof organizationId !== "string" || !UUID.test(organizationId))) return null;
  if (typeof roleId !== "string" || !(ROLE_IDS as readonly string[]).includes(roleId)) return null;
  return { tenantId, organizationId: typeof organizationId === "string" ? organizationId : null, userId, roleId };
}

/** The filter every query of a tenant table must carry (the database enforces the same with RLS once it is activated). */
export const tenantFilter = (context: TenantContext): { tenant_id: string } => ({ tenant_id: context.tenantId });

/** Adds the company filter to a query builder of any client library. */
export function withTenant<Query extends { eq(column: string, value: string): Query }>(query: Query, context: TenantContext): Query {
  return query.eq("tenant_id", context.tenantId);
}
