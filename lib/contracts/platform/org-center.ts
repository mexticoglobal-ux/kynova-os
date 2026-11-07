// Organization & Identity store: the whole structure of a company (branches, departments, teams, people, AI Workers, roles, permissions,
// invitations) and the identity of each person. Pure and deterministic, one global state with every record owned by a company
// (tenant): nothing is ever shared between companies. A Worker belongs to a team exactly like a person does. All the intelligence
// (workload, availability, the recommendations such as "overloaded team") is worked out by koe-org.ts from KOE's records; here a
// result is only RECORDED, with the Worker and the model KOE used.
//
// Constitution (ADR-0009), enforced by how the events are built and tested:
// - Level 1 (NEX prepares): propose an invitation, a team or a change (a role or a move). A person approves it; NEX never applies it.
// - Level 2 (a standing authorization): move a person between teams, within a limit and only a non-critical, active person.
// - Level 3 (a person with the right role): NEVER create an administrator, NEVER delete a user, NEVER change a critical permission,
//   NEVER change the owner. There is no event to delete a user, a role, a team or the history: a user is suspended or disabled, and
//   every change stays in the audit trail.

import { isPerson, isWorker } from "./actors";
import { DEFAULT_KOE_ENV, failed, planExecution, type KoeEnv } from "./automation-koe";
import { message, type ErrorCode } from "./org-messages";
import { recommendations, type OrgSignals, type Recommendation } from "./koe-org";
import { SPECIALTIES, type Priority } from "./koe-registry";
import { decide, type Authorization } from "./workers";

export { DEFAULT_KOE_ENV, type KoeEnv } from "./automation-koe";

export const MODULES = ["crm", "academy", "marketplace", "workers", "insights", "payments", "communications", "aiStudio", "automations", "integrations", "developer"] as const;
export type OrgModule = (typeof MODULES)[number];
export const LEVELS = ["none", "read", "write", "manage"] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_RANK: Record<Level, number> = { none: 0, read: 1, write: 2, manage: 3 };
export const CRITICAL_MODULES: readonly OrgModule[] = ["payments", "integrations", "developer", "workers"];
/** A permission is critical when it lets someone manage money, connections, developer access or the Workers. */
export const isCriticalPermission = (module: OrgModule, level: Level): boolean => level === "manage" && CRITICAL_MODULES.includes(module);

export const STATUSES = ["pending", "active", "suspended", "disabled"] as const;
export type UserStatus = (typeof STATUSES)[number];
export const LANGUAGES = ["es", "en", "pt", "fr"] as const;
export const TIMEZONES = ["America/Costa_Rica", "America/Mexico_City", "America/Bogota", "America/New_York", "Europe/Madrid", "UTC"] as const;
export const DIGESTS = ["off", "daily", "weekly"] as const;
export const ORG_AUTH_ACTION = "org.move.auto";
export const INVITATION_DAYS = 14;

export type Permissions = Record<OrgModule, Level>;
const perms = (over: Partial<Permissions>, base: Level = "none"): Permissions => Object.fromEntries(MODULES.map((module) => [module, over[module] ?? base])) as Permissions;
// The nine roles every company starts with. Each company gets its OWN copy: roles are never shared.
export const BUILTIN_ROLES: readonly { key: string; name: string; permissions: Permissions }[] = [
  { key: "administrator", name: "Administrador", permissions: perms({}, "manage") },
  { key: "manager", name: "Gerente", permissions: perms({ crm: "manage", academy: "write", marketplace: "write", workers: "write", insights: "read", payments: "read", communications: "manage", aiStudio: "write", automations: "write", integrations: "read" }) },
  { key: "supervisor", name: "Supervisor", permissions: perms({ crm: "write", academy: "write", marketplace: "read", workers: "read", insights: "read", communications: "write", aiStudio: "read", automations: "read" }) },
  { key: "sales", name: "Ventas", permissions: perms({ crm: "write", academy: "read", marketplace: "read", workers: "read", insights: "read", communications: "write", automations: "read" }) },
  { key: "marketing", name: "Marketing", permissions: perms({ crm: "read", academy: "write", marketplace: "write", insights: "read", communications: "write", aiStudio: "write", automations: "write" }) },
  { key: "finance", name: "Finanzas", permissions: perms({ crm: "read", insights: "read", payments: "write", communications: "read" }) },
  { key: "hr", name: "RRHH", permissions: perms({ academy: "write", insights: "read", communications: "read" }) },
  { key: "support", name: "Soporte", permissions: perms({ crm: "read", academy: "read", workers: "read", communications: "write" }) },
  { key: "readonly", name: "Solo lectura", permissions: perms({ crm: "read", academy: "read", marketplace: "read", workers: "read", insights: "read", communications: "read", aiStudio: "read", automations: "read" }) },
];

export type Org = { tenantId: string; name: string; ownerId: string; status: "active" | "suspended"; createdAt: string };
export type Role = { id: string; tenantId: string; key: string; name: string; builtin: boolean; critical: boolean; permissions: Permissions; createdBy: string; createdAt: string };
export type User = {
  id: string; tenantId: string; name: string; email: string; roleId: string; status: UserStatus; branchId?: string; language: (typeof LANGUAGES)[number]; timezone: (typeof TIMEZONES)[number];
  lastAccessAt?: string; createdAt: string; invitedBy?: string;
  preferences: { notifications: { email: boolean; inApp: boolean; digest: (typeof DIGESTS)[number] } }; security: { mfaRequested: boolean };
};
export type Invitation = { id: string; tenantId: string; userId: string; email: string; name: string; roleId: string; teamId?: string; status: "pending" | "accepted" | "revoked"; invitedBy: string; createdAt: string; expiresAt: string; decidedAt?: string };
export type BranchSettings = { language: (typeof LANGUAGES)[number]; timezone: (typeof TIMEZONES)[number]; currency: string; workHours: string };
export type Branch = { id: string; tenantId: string; name: string; city: string; status: "active" | "inactive"; settings: BranchSettings; createdBy: string; createdAt: string };
export type Department = { id: string; tenantId: string; branchId: string; name: string; headId?: string; createdAt: string };
export type Team = { id: string; tenantId: string; departmentId: string; name: string; specialty?: string; goals: readonly string[]; leadId?: string; createdBy: string; createdAt: string };
export type Subject = { kind: "user" | "worker"; id: string };
// Team membership is an append-only history: the current team of a person or Worker is its latest assignment. Moving never rewrites it.
export type Assignment = { id: string; tenantId: string; subject: Subject; teamId: string | null; at: string; by: string; mode: "person" | "auto"; note?: string };
export type ProposalPayload =
  | { kind: "invite"; email: string; name: string; roleId: string; teamId?: string }
  | { kind: "team"; departmentId: string; name: string; specialty?: string; goals: readonly string[]; leadId?: string }
  | { kind: "move"; userId: string; teamId: string }
  | { kind: "roleChange"; userId: string; roleId: string };
export type Proposal = { id: string; tenantId: string; payload: ProposalPayload; status: "proposed" | "approved" | "rejected"; proposedBy: string; proposedAt: string; decidedBy?: string; decidedAt?: string; reason: string };
export type Grant = { id: string; tenantId: string; action: typeof ORG_AUTH_ACTION; status: "active" | "revoked"; maxPerDay?: number; expiresAt?: string; grantedBy: string; grantedAt: string };
export type OrgAnalysis = { id: string; tenantId: string; at: string; by: string; workerId: string; workerName: string; model: { id: string; label: string }; modelReason: string; estimatedCostMicros: number; recommendationIds: readonly string[]; counts: Record<string, number> };
export type Session = { id: string; tenantId: string; userId: string; deviceId: string; startedAt: string; lastSeenAt: string; location: string; revokedAt?: string; revokedBy?: string };
export type Device = { id: string; tenantId: string; userId: string; label: string; firstSeenAt: string; trusted: boolean };
export type AuditCategory = "invitations" | "roles" | "permissions" | "teams" | "branches" | "workers" | "users" | "identity" | "other";
export type OrgAudit = { at: string; actor: string; tenantId: string; action: string; category: AuditCategory; detail?: string };
export type OrgLog = { at: string; level: "info" | "warn"; event: string };

export type OrgState = {
  orgs: readonly Org[]; roles: readonly Role[]; users: readonly User[]; invitations: readonly Invitation[]; branches: readonly Branch[]; departments: readonly Department[]; teams: readonly Team[];
  assignments: readonly Assignment[]; proposals: readonly Proposal[]; grants: readonly Grant[]; analyses: readonly OrgAnalysis[]; sessions: readonly Session[]; devices: readonly Device[];
  audit: readonly OrgAudit[]; logs: readonly OrgLog[]; sequence: number;
};
export const newOrgState = (): OrgState => ({ orgs: [], roles: [], users: [], invitations: [], branches: [], departments: [], teams: [], assignments: [], proposals: [], grants: [], analyses: [], sessions: [], devices: [], audit: [], logs: [], sequence: 0 });

/** What KOE tells the organization about the work being done, from the other modules' records: runs, Worker instances and what people have open. */
export type OrgEnv = KoeEnv & { signals: OrgSignals };
export const EMPTY_SIGNALS: OrgSignals = { executions: [], instances: [], activity: [], workers: [] };
export const DEFAULT_ORG_ENV: OrgEnv = { ...DEFAULT_KOE_ENV, signals: EMPTY_SIGNALS };

type Base = { at: string; tenantId: string; actor: string };
export type OrgEvent =
  | (Base & { type: "org.create"; name: string; ownerId: string; ownerName: string; ownerEmail: string })
  | (Base & { type: "branch.create"; name: string; city: string; settings?: Partial<BranchSettings> })
  | (Base & { type: "branch.update"; branchId: string; name?: string; city?: string; settings?: Partial<BranchSettings> })
  | (Base & { type: "branch.setStatus"; branchId: string; to: "active" | "inactive" })
  | (Base & { type: "department.create"; branchId: string; name: string; headId?: string })
  | (Base & { type: "department.setHead"; departmentId: string; headId?: string })
  | (Base & { type: "team.create"; departmentId: string; name: string; specialty?: string; goals?: readonly string[]; leadId?: string })
  | (Base & { type: "team.update"; teamId: string; name?: string; specialty?: string; goals?: readonly string[]; leadId?: string })
  | (Base & { type: "membership.assign"; subject: Subject; teamId: string | null; note?: string })
  | (Base & { type: "invite.create"; email: string; name: string; roleId: string; teamId?: string; branchId?: string })
  | (Base & { type: "invite.accept"; invitationId: string })
  | (Base & { type: "invite.revoke"; invitationId: string })
  | (Base & { type: "user.setStatus"; userId: string; to: UserStatus })
  | (Base & { type: "user.setRole"; userId: string; roleId: string })
  | (Base & { type: "role.create"; name: string; permissions: Partial<Permissions> })
  | (Base & { type: "role.setPermission"; roleId: string; module: OrgModule; level: Level })
  | (Base & { type: "owner.transfer"; toUserId: string })
  | (Base & { type: "proposal.create"; payload: ProposalPayload; reason?: string })
  | (Base & { type: "proposal.approve"; proposalId: string })
  | (Base & { type: "proposal.reject"; proposalId: string })
  | (Base & { type: "org.analyze" })
  | (Base & { type: "authorization.grant"; maxPerDay?: number; expiresAt?: string })
  | (Base & { type: "authorization.revoke"; grantId: string })
  | (Base & { type: "profile.update"; userId: string; name?: string; language?: User["language"]; timezone?: User["timezone"] })
  | (Base & { type: "preferences.set"; userId: string; email: boolean; inApp: boolean; digest: (typeof DIGESTS)[number] })
  | (Base & { type: "security.set"; userId: string; mfaRequested: boolean })
  | (Base & { type: "access.record"; userId: string })
  | (Base & { type: "session.record"; userId: string; deviceLabel: string; location: string })
  | (Base & { type: "session.revoke"; sessionId: string })
  | (Base & { type: "device.trust"; deviceId: string; trusted: boolean });
export type OrgResult = { state: OrgState; error?: string; errorCode?: ErrorCode };

// ---------------------------------------------------------------- helpers
// Nothing is ever trimmed or deleted: every list only grows (a status changes; history stays). Limits belong to the view (display.ts).
const append = <T,>(items: readonly T[], item: T): readonly T[] => [...items, item];
const replace = <T extends { id: string }>(items: readonly T[], item: T): readonly T[] => items.map((existing) => (existing.id === item.id ? item : existing));
const nextId = (state: OrgState, prefix: string): { id: string; state: OrgState } => {
  const sequence = state.sequence + 1;
  return { id: `${prefix}_${String(sequence).padStart(5, "0")}`, state: { ...state, sequence } };
};
const note = (state: OrgState, event: { at: string; actor: string; tenantId: string }, action: string, category: AuditCategory, detail?: string, level: OrgLog["level"] = "info"): OrgState => ({
  ...state,
  audit: append(state.audit, { at: event.at, actor: event.actor, tenantId: event.tenantId, action, category, detail }),
  logs: append(state.logs, { at: event.at, level, event: detail ? `${action}: ${detail}` : action }),
});
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const HANDLE = /^[a-z0-9][a-z0-9._-]{0,29}$/;
const sameDay = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10);
const roleCritical = (permissions: Permissions, key: string) => key === "administrator" || MODULES.some((module) => isCriticalPermission(module, permissions[module]));

export type Authority = "owner" | "admin" | "manager" | "none";
const AUTH_RANK: Record<Authority, number> = { none: 0, manager: 1, admin: 2, owner: 3 };
/** What a person may do in the organization: the owner and administrators everything, a manager the day-to-day, everyone else only read. */
export function authorityOf(state: OrgState, tenantId: string, actor: string): Authority {
  const user = state.users.find((item) => item.id === actor && item.tenantId === tenantId);
  const org = state.orgs.find((item) => item.tenantId === tenantId);
  if (!user || user.status !== "active" || !org || org.status !== "active") return "none";
  if (org.ownerId === user.id) return "owner";
  const role = state.roles.find((item) => item.id === user.roleId && item.tenantId === tenantId);
  return role?.key === "administrator" ? "admin" : role?.key === "manager" ? "manager" : "none";
}

export function currentTeam(state: OrgState, tenantId: string, subject: Subject): string | null {
  const latest = state.assignments.filter((item) => item.tenantId === tenantId && item.subject.kind === subject.kind && item.subject.id === subject.id).at(-1);
  return latest?.teamId ?? null;
}

const validateGoals = (goals: readonly string[] | undefined) => (goals ?? []).length > 5 || (goals ?? []).some((goal) => goal.trim() === "" || goal.length > 120);

// ---------------------------------------------------------------- the reducer
export function reduceOrg(state: OrgState, event: OrgEvent, env: OrgEnv = DEFAULT_ORG_ENV): OrgResult {
  const person = isPerson(event.actor);
  const refuse = (code: ErrorCode, params?: Record<string, string | number>): OrgResult => ({ state, error: message(code, params), errorCode: code });
  const authority = authorityOf(state, event.tenantId, event.actor);
  const needSystem = (): OrgResult | null => (event.actor === "system" ? null : refuse("systemOnly"));
  const needDrafter = (): OrgResult | null => (person || isWorker(event.actor) ? null : refuse("personRequired"));
  /** A person with at least this authority. A Worker or the platform never qualifies, and neither does a person without the right role. */
  const need = (min: Exclude<Authority, "none">): OrgResult | null => {
    if (!person) return refuse("personRequired");
    if (AUTH_RANK[authority] >= AUTH_RANK[min]) return null;
    return refuse(min === "manager" ? "forbidden" : "adminRequired");
  };
  const tenant = event.tenantId;
  const org = state.orgs.find((item) => item.tenantId === tenant);
  const roleOf = (id: string) => state.roles.find((item) => item.id === id && item.tenantId === tenant);
  const userOf = (id: string) => state.users.find((item) => item.id === id && item.tenantId === tenant);
  const teamOf = (id: string) => state.teams.find((item) => item.id === id && item.tenantId === tenant);
  const activeAdmins = (st: OrgState) => st.users.filter((item) => item.tenantId === tenant && item.status === "active" && st.roles.find((role) => role.id === item.roleId)?.key === "administrator");
  const isAdminUser = (user: User) => roleOf(user.roleId)?.key === "administrator";
  const autoAllowed = (st: OrgState): boolean => {
    const grant = st.grants.find((item) => item.tenantId === tenant && item.status === "active" && (!item.expiresAt || Date.parse(item.expiresAt) > Date.parse(event.at)));
    if (!grant) return false;
    const usedToday = st.audit.filter((entry) => entry.tenantId === tenant && entry.action === "membership.auto" && sameDay(entry.at, event.at)).length;
    const authorization: Authorization = { action: ORG_AUTH_ACTION, status: "active", maxPerDay: grant.maxPerDay, usedToday, expiresAt: grant.expiresAt };
    return decide(ORG_AUTH_ACTION, authorization, new Date(event.at)).allowed;
  };
  const SELF_OR_ADMIN = (userId: string): OrgResult | null => (!person ? refuse("personRequired") : event.actor === userId || AUTH_RANK[authority] >= AUTH_RANK.admin ? null : refuse("notYourOwn"));

  if (event.type !== "org.create" && !org) return refuse("notFound");

  switch (event.type) {
    case "org.create": {
      const denied = needSystem(); // a company is created when it joins the platform, never from inside
      if (denied) return denied;
      if (org) return refuse("exists", { detail: "la empresa" });
      if (event.name.trim() === "" || event.name.length > 80 || !HANDLE.test(event.ownerId) || !EMAIL.test(event.ownerEmail) || event.ownerName.trim() === "") return refuse("invalid", { detail: "empresa y propietario" });
      let next: OrgState = { ...state, orgs: append(state.orgs, { tenantId: tenant, name: event.name.trim(), ownerId: event.ownerId, status: "active", createdAt: event.at }) };
      let adminRole = "";
      for (const template of BUILTIN_ROLES) {
        const made = nextId(next, "rl");
        if (template.key === "administrator") adminRole = made.id;
        next = { ...made.state, roles: append(made.state.roles, { id: made.id, tenantId: tenant, key: template.key, name: template.name, builtin: true, critical: roleCritical(template.permissions, template.key), permissions: { ...template.permissions }, createdBy: "system", createdAt: event.at }) };
      }
      const owner: User = { id: event.ownerId, tenantId: tenant, name: event.ownerName.trim(), email: event.ownerEmail, roleId: adminRole, status: "active", language: "es", timezone: "America/Costa_Rica", lastAccessAt: event.at, createdAt: event.at, preferences: { notifications: { email: true, inApp: true, digest: "daily" } }, security: { mfaRequested: false } };
      return { state: note({ ...next, users: append(next.users, owner) }, event, "org.create", "other", `${event.name.trim()} · propietario ${owner.id}`) };
    }

    // ---- the structure: branches and departments are an administrator's, teams a manager's
    case "branch.create": {
      const denied = need("admin");
      if (denied) return denied;
      if (event.name.trim() === "" || event.name.length > 60 || event.city.length > 60) return refuse("invalid", { detail: "nombre y ciudad" });
      if (state.branches.some((item) => item.tenantId === tenant && item.name.toLowerCase() === event.name.trim().toLowerCase())) return refuse("exists", { detail: "una sucursal con ese nombre" });
      const settings: BranchSettings = { language: "es", timezone: "America/Costa_Rica", currency: "USD", workHours: "08:00-17:00", ...event.settings };
      if (!LANGUAGES.includes(settings.language) || !TIMEZONES.includes(settings.timezone) || !/^[A-Z]{3}$/.test(settings.currency) || !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(settings.workHours)) return refuse("invalid", { detail: "la configuración de la sucursal" });
      const made = nextId(state, "br");
      return { state: note({ ...made.state, branches: append(made.state.branches, { id: made.id, tenantId: tenant, name: event.name.trim(), city: event.city.trim(), status: "active", settings, createdBy: event.actor, createdAt: event.at }) }, event, "branch.create", "branches", `${made.id} · ${event.name.trim()}`) };
    }

    case "branch.update":
    case "branch.setStatus": {
      const denied = need("admin");
      if (denied) return denied;
      const branch = state.branches.find((item) => item.id === event.branchId && item.tenantId === tenant);
      if (!branch) return refuse(state.branches.some((item) => item.id === event.branchId) ? "notYours" : "notFound");
      if (event.type === "branch.setStatus") return { state: note({ ...state, branches: replace(state.branches, { ...branch, status: event.to }) }, event, "branch.setStatus", "branches", `${branch.id} · ${branch.status} → ${event.to}`, event.to === "inactive" ? "warn" : "info") }; // deactivated, never deleted
      const settings = { ...branch.settings, ...event.settings };
      if ((event.name !== undefined && (event.name.trim() === "" || event.name.length > 60)) || !LANGUAGES.includes(settings.language) || !TIMEZONES.includes(settings.timezone) || !/^[A-Z]{3}$/.test(settings.currency) || !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(settings.workHours)) return refuse("invalid", { detail: "la sucursal" });
      const updated: Branch = { ...branch, name: event.name?.trim() ?? branch.name, city: event.city?.trim() ?? branch.city, settings };
      return { state: note({ ...state, branches: replace(state.branches, updated) }, event, "branch.update", "branches", `${branch.id} · ${branch.name} → ${updated.name}; configuración ${JSON.stringify(branch.settings)} → ${JSON.stringify(settings)}`) };
    }

    case "department.create": {
      const denied = need("admin");
      if (denied) return denied;
      const branch = state.branches.find((item) => item.id === event.branchId && item.tenantId === tenant);
      if (!branch) return refuse("notFound");
      if (event.name.trim() === "" || event.name.length > 60) return refuse("invalid", { detail: "nombre" });
      if (event.headId && !userOf(event.headId)) return refuse("invalid", { detail: "el responsable debe ser una persona de la empresa" });
      if (state.departments.some((item) => item.tenantId === tenant && item.branchId === branch.id && item.name.toLowerCase() === event.name.trim().toLowerCase())) return refuse("exists", { detail: "un departamento con ese nombre en la sucursal" });
      const made = nextId(state, "dp");
      return { state: note({ ...made.state, departments: append(made.state.departments, { id: made.id, tenantId: tenant, branchId: branch.id, name: event.name.trim(), ...(event.headId ? { headId: event.headId } : {}), createdAt: event.at }) }, event, "department.create", "teams", `${made.id} · ${event.name.trim()}`) };
    }

    case "department.setHead": {
      const denied = need("admin");
      if (denied) return denied;
      const department = state.departments.find((item) => item.id === event.departmentId && item.tenantId === tenant);
      if (!department) return refuse("notFound");
      if (event.headId && userOf(event.headId)?.status !== "active") return refuse("invalid", { detail: "el responsable debe ser una persona activa" });
      return { state: note({ ...state, departments: replace(state.departments, { ...department, headId: event.headId }) }, event, "department.setHead", "teams", `${department.id} · ${department.headId ?? "nadie"} → ${event.headId ?? "nadie"}`) };
    }

    case "team.create":
    case "team.update": {
      const denied = need("manager");
      if (denied) return denied;
      const existing = event.type === "team.update" ? teamOf(event.teamId) : undefined;
      if (event.type === "team.update" && !existing) return refuse("notFound");
      const departmentId = existing?.departmentId ?? (event as { departmentId: string }).departmentId;
      if (!state.departments.some((item) => item.id === departmentId && item.tenantId === tenant)) return refuse("notFound");
      const name = (event.name ?? existing?.name ?? "").trim();
      if (name === "" || name.length > 60) return refuse("invalid", { detail: "nombre" });
      if (event.specialty !== undefined && event.specialty !== "" && !(SPECIALTIES as readonly string[]).includes(event.specialty)) return refuse("invalid", { detail: "especialidad" });
      if (validateGoals(event.goals)) return refuse("invalid", { detail: "objetivos (hasta 5, hasta 120 caracteres)" });
      if (event.leadId && userOf(event.leadId)?.status !== "active") return refuse("invalid", { detail: "el responsable debe ser una persona activa" });
      if (state.teams.some((item) => item.tenantId === tenant && item.departmentId === departmentId && item.name.toLowerCase() === name.toLowerCase() && item.id !== existing?.id)) return refuse("exists", { detail: "un equipo con ese nombre en el departamento" });
      if (existing) {
        const updated: Team = { ...existing, name, specialty: event.specialty ?? existing.specialty, goals: event.goals ?? existing.goals, leadId: event.leadId ?? existing.leadId };
        return { state: note({ ...state, teams: replace(state.teams, updated) }, event, "team.update", "teams", `${existing.id} · ${existing.name} → ${updated.name}; responsable ${existing.leadId ?? "nadie"} → ${updated.leadId ?? "nadie"}; objetivos ${existing.goals.length} → ${updated.goals.length}`) };
      }
      const made = nextId(state, "tm");
      const team: Team = { id: made.id, tenantId: tenant, departmentId, name, ...(event.specialty ? { specialty: event.specialty } : {}), goals: event.goals ?? [], ...(event.leadId ? { leadId: event.leadId } : {}), createdBy: event.actor, createdAt: event.at };
      return { state: note({ ...made.state, teams: append(made.state.teams, team) }, event, "team.create", "teams", `${made.id} · ${name}`) };
    }

    case "membership.assign": {
      const denied = needDrafter();
      if (denied) return denied;
      const team = event.teamId === null ? null : teamOf(event.teamId);
      if (event.teamId !== null && !team) return refuse("notFound");
      if (event.subject.kind === "user") {
        const user = userOf(event.subject.id);
        if (!user) return refuse("notFound");
        if (user.status === "disabled") return refuse("notEligible", { detail: "la persona está deshabilitada" });
      } else {
        const worker = env.workers.find((item) => item.id === event.subject.id && (item.ownerTenantId === "platform" || item.ownerTenantId === tenant));
        if (!worker || worker.status !== "active") return refuse("notFound");
      }
      if (currentTeam(state, tenant, event.subject) === event.teamId) return refuse("exists", { detail: "ya está en ese equipo" });
      let mode: Assignment["mode"] = "person";
      if (person) { const gate = need("manager"); if (gate) return gate; }
      else {
        // Level 2: NEX moves a person between teams only with a standing authorization, and never an administrator, the owner or someone suspended
        const user = event.subject.kind === "user" ? userOf(event.subject.id) : undefined;
        if (!user || event.teamId === null) return refuse("personRequired");
        if (!autoAllowed(state)) return refuse("needsAuthorization");
        if (user.status !== "active" || roleOf(user.roleId)?.critical || org?.ownerId === user.id) return refuse("notEligible", { detail: "solo se mueve a una persona activa con un rol no crítico" });
        mode = "auto";
      }
      const made = nextId(state, "as");
      const assignment: Assignment = { id: made.id, tenantId: tenant, subject: event.subject, teamId: event.teamId, at: event.at, by: event.actor, mode, ...(event.note ? { note: event.note.slice(0, 200) } : {}) };
      const from = currentTeam(state, tenant, event.subject);
      return { state: note({ ...made.state, assignments: append(made.state.assignments, assignment) }, event, mode === "auto" ? "membership.auto" : "membership.assign", event.subject.kind === "worker" ? "workers" : "teams", `${event.subject.kind}:${event.subject.id} · ${from ?? "sin equipo"} → ${event.teamId ?? "sin equipo"}`) };
    }

    // ---- people: invitations, roles and status (a person is never deleted)
    case "invite.create": {
      const denied = need("manager");
      if (denied) return denied;
      const role = roleOf(event.roleId);
      if (!role) return refuse("notFound");
      if (role.critical && AUTH_RANK[authority] < AUTH_RANK.admin) return refuse("adminRequired"); // creating an administrator is an administrator's
      if (event.name.trim() === "" || event.name.length > 80 || !EMAIL.test(event.email)) return refuse("invalid", { detail: "nombre y correo" });
      if (event.teamId && !teamOf(event.teamId)) return refuse("notFound");
      if (event.branchId && !state.branches.some((item) => item.id === event.branchId && item.tenantId === tenant)) return refuse("notFound");
      const handle = event.email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "");
      if (!HANDLE.test(handle)) return refuse("invalid", { detail: "el correo" });
      if (userOf(handle) || state.users.some((item) => item.tenantId === tenant && item.email.toLowerCase() === event.email.toLowerCase())) return refuse("exists", { detail: "esa persona o ese correo" });
      const made = nextId(state, "iv");
      const invitation: Invitation = { id: made.id, tenantId: tenant, userId: handle, email: event.email, name: event.name.trim(), roleId: role.id, ...(event.teamId ? { teamId: event.teamId } : {}), status: "pending", invitedBy: event.actor, createdAt: event.at, expiresAt: new Date(Date.parse(event.at) + INVITATION_DAYS * 86_400_000).toISOString() };
      const user: User = { id: handle, tenantId: tenant, name: event.name.trim(), email: event.email, roleId: role.id, status: "pending", ...(event.branchId ? { branchId: event.branchId } : {}), language: "es", timezone: "America/Costa_Rica", createdAt: event.at, invitedBy: event.actor, preferences: { notifications: { email: true, inApp: true, digest: "daily" } }, security: { mfaRequested: false } };
      let next: OrgState = { ...made.state, invitations: append(made.state.invitations, invitation), users: append(made.state.users, user) };
      if (event.teamId) { const a = nextId(next, "as"); next = { ...a.state, assignments: append(a.state.assignments, { id: a.id, tenantId: tenant, subject: { kind: "user", id: handle }, teamId: event.teamId, at: event.at, by: event.actor, mode: "person", note: "Invitación" }) }; }
      return { state: note(next, event, "invite.create", "invitations", `${made.id} · ${event.email} · rol ${role.name}`) };
    }

    case "invite.accept": {
      const denied = needSystem(); // the invited person accepts through the platform's sign-in, never anyone on their behalf
      if (denied) return denied;
      const invitation = state.invitations.find((item) => item.id === event.invitationId && item.tenantId === tenant);
      if (!invitation) return refuse(state.invitations.some((item) => item.id === event.invitationId) ? "notYours" : "notFound");
      if (invitation.status !== "pending") return refuse("closed");
      if (Date.parse(invitation.expiresAt) <= Date.parse(event.at)) return refuse("invalid", { detail: "la invitación venció" });
      const user = userOf(invitation.userId) as User;
      const next = { ...state, invitations: replace(state.invitations, { ...invitation, status: "accepted" as const, decidedAt: event.at }), users: replace(state.users, { ...user, status: "active" as const, lastAccessAt: event.at }) };
      return { state: note(next, event, "invite.accept", "invitations", `${invitation.id} · ${user.id}`) };
    }

    case "invite.revoke": {
      const denied = need("manager");
      if (denied) return denied;
      const invitation = state.invitations.find((item) => item.id === event.invitationId && item.tenantId === tenant);
      if (!invitation) return refuse(state.invitations.some((item) => item.id === event.invitationId) ? "notYours" : "notFound");
      if (invitation.status !== "pending") return refuse("closed");
      const user = userOf(invitation.userId) as User;
      const next = { ...state, invitations: replace(state.invitations, { ...invitation, status: "revoked" as const, decidedAt: event.at }), users: replace(state.users, { ...user, status: "disabled" as const }) };
      return { state: note(next, event, "invite.revoke", "invitations", `${invitation.id} · ${user.id}`, "warn") };
    }

    case "user.setStatus": {
      const denied = need("manager");
      if (denied) return denied;
      const user = userOf(event.userId);
      if (!user) return refuse("notFound");
      if (!STATUSES.includes(event.to) || event.to === "pending" || event.to === user.status) return refuse("invalid", { detail: "estado" });
      if (org?.ownerId === user.id) return refuse("ownerProtected");
      if (user.id === event.actor) return refuse("invalid", { detail: "no puede cambiar su propio estado" });
      if ((roleOf(user.roleId)?.critical ?? false) && AUTH_RANK[authority] < AUTH_RANK.admin) return refuse("adminRequired");
      if (user.status === "disabled" && AUTH_RANK[authority] < AUTH_RANK.admin) return refuse("adminRequired"); // bringing someone back is an administrator's
      if (isAdminUser(user) && user.status === "active" && event.to !== "active" && activeAdmins(state).length <= 1) return refuse("lastAdmin");
      return { state: note({ ...state, users: replace(state.users, { ...user, status: event.to }) }, event, "user.setStatus", "users", `${user.id} · ${user.status} → ${event.to}`, event.to === "active" ? "info" : "warn") }; // disabled is final enough: there is no delete
    }

    case "user.setRole": {
      const denied = need("manager");
      if (denied) return denied;
      const user = userOf(event.userId);
      const role = roleOf(event.roleId);
      if (!user || !role) return refuse("notFound");
      if (org?.ownerId === user.id) return refuse("ownerProtected");
      const current = roleOf(user.roleId);
      if ((role.critical || current?.critical) && AUTH_RANK[authority] < AUTH_RANK.admin) return refuse("adminRequired");
      if (role.id === user.roleId) return refuse("exists", { detail: "ya tiene ese rol" });
      if (isAdminUser(user) && user.status === "active" && role.key !== "administrator" && activeAdmins(state).length <= 1) return refuse("lastAdmin");
      return { state: note({ ...state, users: replace(state.users, { ...user, roleId: role.id }) }, event, "user.setRole", "roles", `${user.id} · ${current?.name ?? user.roleId} → ${role.name}`, role.critical ? "warn" : "info") };
    }

    // ---- roles and permissions: an administrator's, and never NEX's
    case "role.create": {
      const denied = need("admin");
      if (denied) return denied;
      const name = event.name.trim();
      if (name === "" || name.length > 40) return refuse("invalid", { detail: "nombre del rol" });
      if (state.roles.some((item) => item.tenantId === tenant && item.name.toLowerCase() === name.toLowerCase())) return refuse("exists", { detail: "un rol con ese nombre" });
      const permissions = perms(event.permissions);
      if (MODULES.some((module) => !LEVELS.includes(permissions[module]))) return refuse("invalid", { detail: "permisos" });
      const made = nextId(state, "rl");
      const role: Role = { id: made.id, tenantId: tenant, key: "custom", name, builtin: false, critical: roleCritical(permissions, "custom"), permissions, createdBy: event.actor, createdAt: event.at };
      return { state: note({ ...made.state, roles: append(made.state.roles, role) }, event, "role.create", "permissions", `${made.id} · ${name}${role.critical ? " (crítico)" : ""}`, role.critical ? "warn" : "info") };
    }

    case "role.setPermission": {
      const denied = need("admin");
      if (denied) return denied;
      const role = roleOf(event.roleId);
      if (!role) return refuse("notFound");
      if (role.key === "administrator") return refuse("immutable");
      if (!MODULES.includes(event.module) || !LEVELS.includes(event.level)) return refuse("invalid", { detail: "módulo o nivel" });
      if (role.permissions[event.module] === event.level) return refuse("exists", { detail: "ya tiene ese nivel" });
      const permissions = { ...role.permissions, [event.module]: event.level };
      const critical = roleCritical(permissions, role.key);
      return { state: note({ ...state, roles: replace(state.roles, { ...role, permissions, critical }) }, event, "role.setPermission", "permissions", `${role.id} (${role.name}) · ${event.module}: ${role.permissions[event.module]} → ${event.level}${isCriticalPermission(event.module, event.level) ? " (crítico)" : ""}`, isCriticalPermission(event.module, event.level) ? "warn" : "info") };
    }

    case "owner.transfer": {
      if (!person) return refuse("personRequired");
      if (authority !== "owner") return refuse("adminRequired"); // only the owner hands the company over
      const target = userOf(event.toUserId);
      if (!target || target.status !== "active" || !isAdminUser(target) || target.id === event.actor) return refuse("invalid", { detail: "el nuevo propietario debe ser otro administrador activo" });
      return { state: note({ ...state, orgs: state.orgs.map((item) => (item.tenantId === tenant ? { ...item, ownerId: target.id } : item)) }, event, "owner.transfer", "roles", `${event.actor} → ${target.id}`, "warn") };
    }

    // ---- Level 1: NEX prepares proposals; a person decides
    case "proposal.create": {
      const denied = needDrafter();
      if (denied) return denied;
      const p = event.payload;
      let problem: string | null = null;
      if (p.kind === "invite") { const role = roleOf(p.roleId); if (!role || !EMAIL.test(p.email) || p.name.trim() === "") problem = "invitación"; else if (!person && role.critical) return refuse("criticalForHuman"); else if (p.teamId && !teamOf(p.teamId)) problem = "equipo"; }
      else if (p.kind === "team") { if (!state.departments.some((item) => item.id === p.departmentId && item.tenantId === tenant) || p.name.trim() === "" || validateGoals(p.goals)) problem = "equipo"; }
      else if (p.kind === "move") { const user = userOf(p.userId); if (!user || !teamOf(p.teamId)) problem = "movimiento"; else if (!person && (roleOf(user.roleId)?.critical || org?.ownerId === user.id)) return refuse("criticalForHuman"); }
      else if (p.kind === "roleChange") { const user = userOf(p.userId); const role = roleOf(p.roleId); if (!user || !role) problem = "cambio de rol"; else if (!person && (role.critical || roleOf(user.roleId)?.critical || org?.ownerId === user.id)) return refuse("criticalForHuman"); }
      if (problem) return refuse("invalid", { detail: problem });
      const made = nextId(state, "pr");
      const proposal: Proposal = { id: made.id, tenantId: tenant, payload: p, status: "proposed", proposedBy: event.actor, proposedAt: event.at, reason: (event.reason ?? "").slice(0, 200) };
      return { state: note({ ...made.state, proposals: append(made.state.proposals, proposal) }, event, "proposal.create", p.kind === "invite" ? "invitations" : p.kind === "roleChange" ? "roles" : "teams", `${made.id} · ${p.kind}`) };
    }

    case "proposal.approve":
    case "proposal.reject": {
      const denied = need("manager");
      if (denied) return denied;
      const proposal = state.proposals.find((item) => item.id === event.proposalId && item.tenantId === tenant);
      if (!proposal) return refuse(state.proposals.some((item) => item.id === event.proposalId) ? "notYours" : "notFound");
      if (proposal.status !== "proposed") return refuse("closed");
      if (event.type === "proposal.reject") return { state: note({ ...state, proposals: replace(state.proposals, { ...proposal, status: "rejected", decidedBy: event.actor, decidedAt: event.at }) }, event, "proposal.reject", "other", proposal.id) };
      const p = proposal.payload;
      // approving applies the change AS the approver: the same checks as if the person had done it themselves
      const applied = reduceOrg(state, p.kind === "invite" ? { type: "invite.create", at: event.at, tenantId: tenant, actor: event.actor, email: p.email, name: p.name, roleId: p.roleId, teamId: p.teamId }
        : p.kind === "team" ? { type: "team.create", at: event.at, tenantId: tenant, actor: event.actor, departmentId: p.departmentId, name: p.name, specialty: p.specialty, goals: p.goals, leadId: p.leadId }
        : p.kind === "move" ? { type: "membership.assign", at: event.at, tenantId: tenant, actor: event.actor, subject: { kind: "user", id: p.userId }, teamId: p.teamId, note: `Propuesta ${proposal.id}` }
        : { type: "user.setRole", at: event.at, tenantId: tenant, actor: event.actor, userId: p.userId, roleId: p.roleId }, env);
      if (applied.error) return applied;
      return { state: note({ ...applied.state, proposals: replace(applied.state.proposals, { ...proposal, status: "approved", decidedBy: event.actor, decidedAt: event.at }) }, event, "proposal.approve", "other", `${proposal.id} · ${p.kind} · propuesta de ${proposal.proposedBy}`) };
    }

    case "org.analyze": {
      const denied = needDrafter();
      if (denied) return denied;
      const plan = planExecution(env, tenant, "reporter", { tools: ["summary.prepare"], clearance: "business" });
      if (failed(plan)) return refuse("noWorker", { detail: plan.problem });
      const found: Recommendation[] = recommendations(state, tenant, env.signals, event.at);
      const counts: Record<string, number> = {};
      for (const item of found) counts[item.kind] = (counts[item.kind] ?? 0) + 1;
      const made = nextId(state, "an");
      const analysis: OrgAnalysis = { id: made.id, tenantId: tenant, at: event.at, by: event.actor, workerId: plan.worker.id, workerName: plan.worker.name, model: { id: plan.model.id, label: plan.model.label }, modelReason: plan.modelReason, estimatedCostMicros: plan.estimatedCostMicros, recommendationIds: found.map((item) => item.id), counts };
      return { state: note({ ...made.state, analyses: append(made.state.analyses, analysis) }, event, "org.analyze", "other", `${made.id} · ${found.length} recomendaciones`) };
    }

    // ---- Level 2 authorization
    case "authorization.grant": {
      const denied = need("admin");
      if (denied) return denied;
      if (event.maxPerDay !== undefined && (!Number.isInteger(event.maxPerDay) || event.maxPerDay < 1 || event.maxPerDay > 100)) return refuse("invalid", { detail: "usos por día de 1 a 100" });
      if (event.expiresAt !== undefined && !(Date.parse(event.expiresAt) > Date.parse(event.at))) return refuse("invalid", { detail: "la fecha de vencimiento debe ser futura" });
      const made = nextId(state, "gr");
      return { state: note({ ...made.state, grants: append(made.state.grants, { id: made.id, tenantId: tenant, action: ORG_AUTH_ACTION, status: "active", maxPerDay: event.maxPerDay, expiresAt: event.expiresAt, grantedBy: event.actor, grantedAt: event.at }) }, event, "authorization.grant", "teams", `${made.id} · ${ORG_AUTH_ACTION}`) };
    }

    case "authorization.revoke": {
      const denied = need("admin");
      if (denied) return denied;
      const grant = state.grants.find((item) => item.id === event.grantId);
      if (!grant) return refuse("notFound");
      if (grant.tenantId !== tenant) return refuse("notYours");
      return { state: note({ ...state, grants: replace(state.grants, { ...grant, status: "revoked" }) }, event, "authorization.revoke", "teams", grant.id, "warn") };
    }

    // ---- Identity Center: profile, preferences, security, sessions and devices (architecture: nothing real is connected)
    case "profile.update": {
      const user = userOf(event.userId);
      if (!user) return refuse(state.users.some((item) => item.id === event.userId) ? "notYours" : "notFound");
      const denied = SELF_OR_ADMIN(user.id);
      if (denied) return denied;
      if ((event.name !== undefined && (event.name.trim() === "" || event.name.length > 80)) || (event.language !== undefined && !LANGUAGES.includes(event.language)) || (event.timezone !== undefined && !TIMEZONES.includes(event.timezone))) return refuse("invalid", { detail: "perfil" });
      const updated: User = { ...user, name: event.name?.trim() ?? user.name, language: event.language ?? user.language, timezone: event.timezone ?? user.timezone };
      return { state: note({ ...state, users: replace(state.users, updated) }, event, "profile.update", "identity", `${user.id} · ${user.name}/${user.language}/${user.timezone} → ${updated.name}/${updated.language}/${updated.timezone}`) };
    }

    case "preferences.set":
    case "security.set": {
      const user = userOf(event.userId);
      if (!user) return refuse(state.users.some((item) => item.id === event.userId) ? "notYours" : "notFound");
      if (!person || event.actor !== user.id) return refuse(person ? "notYourOwn" : "personRequired"); // a person's own preferences and security are theirs alone
      if (event.type === "preferences.set") {
        if (!DIGESTS.includes(event.digest)) return refuse("invalid", { detail: "resumen" });
        return { state: note({ ...state, users: replace(state.users, { ...user, preferences: { notifications: { email: event.email, inApp: event.inApp, digest: event.digest } } }) }, event, "preferences.set", "identity", user.id) };
      }
      return { state: note({ ...state, users: replace(state.users, { ...user, security: { mfaRequested: event.mfaRequested } }) }, event, "security.set", "identity", `${user.id} · verificación en dos pasos ${event.mfaRequested ? "solicitada" : "no solicitada"} (arquitectura)`) };
    }

    case "access.record": {
      const denied = needSystem();
      if (denied) return denied;
      const user = userOf(event.userId);
      if (!user) return refuse("notFound");
      return { state: { ...state, users: replace(state.users, { ...user, lastAccessAt: event.at }) } };
    }

    case "session.record": {
      const denied = needSystem(); // the platform reports a sign-in; nobody types one in
      if (denied) return denied;
      const user = userOf(event.userId);
      if (!user) return refuse("notFound");
      if (event.deviceLabel.trim() === "" || event.deviceLabel.length > 60 || event.location.length > 60) return refuse("invalid", { detail: "dispositivo y lugar" });
      let next = state;
      let device = next.devices.find((item) => item.tenantId === tenant && item.userId === user.id && item.label === event.deviceLabel.trim());
      if (!device) { const d = nextId(next, "dv"); device = { id: d.id, tenantId: tenant, userId: user.id, label: event.deviceLabel.trim(), firstSeenAt: event.at, trusted: false }; next = { ...d.state, devices: append(d.state.devices, device) }; }
      const s = nextId(next, "se");
      next = { ...s.state, sessions: append(s.state.sessions, { id: s.id, tenantId: tenant, userId: user.id, deviceId: device.id, startedAt: event.at, lastSeenAt: event.at, location: event.location.trim() }), users: replace(s.state.users, { ...user, lastAccessAt: event.at }) };
      return { state: note(next, event, "session.record", "identity", `${s.id} · ${user.id} · ${device.label}`) };
    }

    case "session.revoke": {
      const session = state.sessions.find((item) => item.id === event.sessionId && item.tenantId === tenant);
      if (!session) return refuse(state.sessions.some((item) => item.id === event.sessionId) ? "notYours" : "notFound");
      const denied = SELF_OR_ADMIN(session.userId);
      if (denied) return denied;
      if (session.revokedAt) return refuse("closed");
      return { state: note({ ...state, sessions: replace(state.sessions, { ...session, revokedAt: event.at, revokedBy: event.actor }) }, event, "session.revoke", "identity", `${session.id} · ${session.userId}`, "warn") };
    }

    case "device.trust": {
      const device = state.devices.find((item) => item.id === event.deviceId && item.tenantId === tenant);
      if (!device) return refuse(state.devices.some((item) => item.id === event.deviceId) ? "notYours" : "notFound");
      if (!person || event.actor !== device.userId) return refuse(person ? "notYourOwn" : "personRequired");
      return { state: note({ ...state, devices: replace(state.devices, { ...device, trusted: event.trusted }) }, event, "device.trust", "identity", `${device.id} · ${event.trusted ? "de confianza" : "sin confianza"}`) };
    }
  }
}

export function applyAllOrg(state: OrgState, events: readonly OrgEvent[], env: OrgEnv = DEFAULT_ORG_ENV): { state: OrgState; errors: string[] } {
  const errors: string[] = [];
  let current = state;
  for (const event of events) {
    const result = reduceOrg(current, event, env);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    current = result.state;
  }
  return { state: current, errors };
}

export const orgOf = (state: OrgState, tenantId: string) => state.orgs.find((item) => item.tenantId === tenantId);
export const usersOf = (state: OrgState, tenantId: string) => state.users.filter((item) => item.tenantId === tenantId);
export const rolesOf = (state: OrgState, tenantId: string) => state.roles.filter((item) => item.tenantId === tenantId);
export const branchesOf = (state: OrgState, tenantId: string) => state.branches.filter((item) => item.tenantId === tenantId);
export const departmentsOf = (state: OrgState, tenantId: string) => state.departments.filter((item) => item.tenantId === tenantId);
export const teamsOf = (state: OrgState, tenantId: string) => state.teams.filter((item) => item.tenantId === tenantId);
export const invitationsOf = (state: OrgState, tenantId: string) => state.invitations.filter((item) => item.tenantId === tenantId);
export const proposalsOf = (state: OrgState, tenantId: string) => state.proposals.filter((item) => item.tenantId === tenantId);
export const grantsOf = (state: OrgState, tenantId: string) => state.grants.filter((item) => item.tenantId === tenantId);
export const auditOf = (state: OrgState, tenantId: string, category?: AuditCategory) => state.audit.filter((item) => item.tenantId === tenantId && (!category || item.category === category));
export const analysesOf = (state: OrgState, tenantId: string) => state.analyses.filter((item) => item.tenantId === tenantId);
export type { Priority };
