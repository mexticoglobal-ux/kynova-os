// Row Level Security, prepared and NOT activated. Each entity gets its policies written as data and can be rendered as SQL for review, but no
// migration applies them and nothing in the database changes. The rules mirror exactly what the existing migrations already do (kinds read, rw,
// rw_delete and admin over private.is_member, private.can_write and private.is_admin): deny everything, then allow by company and by role.
// Nothing is shared between companies: every policy of a company table filters by its tenant_id.
import { ENTITIES, type Entity } from "./entities";

/** Activation is a separate decision (ADR-0006, ADR-0010) with its own migration and tests. This module never activates anything. */
export const RLS_STATE = { activated: false, reason: "Preparado, no activado: la activación es una decisión aparte, con su migración y sus pruebas de aislamiento." } as const;

export type Command = "select" | "insert" | "update" | "delete";
export type PolicySpec = { table: string; name: string; command: Command; using?: string; withCheck?: string };

const MEMBER = "(select private.is_member(tenant_id))";
const WRITE = "(select private.can_write(tenant_id))";
const ADMIN = "(select private.is_admin(tenant_id))";

/** The policies of one entity. A command that has no policy is denied: that is how append-only tables and read-only tables are protected. */
export function policiesFor(entity: Entity): PolicySpec[] {
  const { table } = entity;
  const policy = (command: Command, using?: string, withCheck?: string): PolicySpec => ({ table, name: `${table}_${command}`, command, ...(using ? { using } : {}), ...(withCheck ? { withCheck } : {}) });
  if (entity.scope === "tenant-self") return [policy("select", "(select private.is_member(id))")]; // a company is created and changed only through functions
  if (entity.scope === "user") return [policy("select", "(user_id = (select auth.uid()) or (select private.shares_tenant_with(user_id)))"), policy("update", "(user_id = (select auth.uid()))", "(user_id = (select auth.uid()))")];
  const out = [policy("select", MEMBER)];
  if (entity.appendOnly || entity.rls === "read") return entity.appendOnly ? [...out, ...(entity.rls === "read" ? [] : [policy("insert", undefined, entity.rls === "admin" ? ADMIN : WRITE)])] : out;
  const gate = entity.rls === "admin" ? ADMIN : WRITE;
  out.push(policy("insert", undefined, gate), policy("update", gate, gate));
  if (entity.rls === "rw_delete" || entity.rls === "admin") out.push(policy("delete", gate));
  return out;
}

/** The policies of the entities that do not have them yet. The existing tables already carry theirs in supabase/migrations. */
export const plannedPolicies = (entities: readonly Entity[] = ENTITIES): PolicySpec[] => entities.filter((item) => item.status === "planned").flatMap(policiesFor);

export function renderPolicySql(spec: PolicySpec): string {
  const clauses = [spec.using ? `using (${spec.using})` : "", spec.withCheck ? `with check (${spec.withCheck})` : ""].filter(Boolean).join(" ");
  return `create policy "${spec.name}" on public.${spec.table} for ${spec.command} to authenticated ${clauses};`;
}

/** The SQL that would activate RLS for the planned entities, for review only. It is text: nothing runs it. */
export function renderRlsPreview(entities: readonly Entity[] = ENTITIES): string {
  const planned = entities.filter((item) => item.status === "planned");
  return planned
    .map((item) => [`-- ${item.table}: ${item.description}`, `alter table public.${item.table} enable row level security;`, `revoke all on table public.${item.table} from public, anon, authenticated, service_role;`, ...policiesFor(item).map(renderPolicySql)].join("\n"))
    .join("\n\n");
}

export type RlsFinding = { table: string; problem: string };

/** Checks the rules every policy set must keep. A finding is a defect in the design, found before anything is activated. */
export function auditPolicies(entities: readonly Entity[] = ENTITIES): RlsFinding[] {
  const findings: RlsFinding[] = [];
  for (const item of entities) {
    const specs = policiesFor(item);
    const commands = new Set(specs.map((spec) => spec.command));
    if (!commands.has("select")) findings.push({ table: item.table, problem: "no tiene política de lectura: nadie podría leerla" });
    if (item.appendOnly && (commands.has("update") || commands.has("delete"))) findings.push({ table: item.table, problem: "es de solo agregar pero permite modificar o borrar" });
    if (item.scope === "tenant" && !item.columns.some((column) => column.name === "tenant_id")) findings.push({ table: item.table, problem: "no tiene tenant_id" });
    for (const spec of specs) {
      const text = `${spec.using ?? ""} ${spec.withCheck ?? ""}`;
      if (/\btrue\b/i.test(text)) findings.push({ table: item.table, problem: `${spec.name} deja pasar a todos` });
      if (item.scope === "tenant" && !/tenant_id/.test(text)) findings.push({ table: item.table, problem: `${spec.name} no filtra por empresa` });
      if (/service_role/i.test(text)) findings.push({ table: item.table, problem: `${spec.name} nombra al rol de servicio` });
    }
  }
  return findings;
}
