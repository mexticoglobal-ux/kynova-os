// KOE Organization Intelligence: the ONE place where the structure of a company is read and judged. It builds the organization tree,
// the workforce (people and AI Workers in one view, with status, specialty, team, workload, availability and estimated cost), the
// dashboard, the identity view, the permission matrix and every recommendation (an overloaded team, an underused Worker, a user with
// no activity, a department that is a bottleneck). Every screen only formats these answers, and no other module repeats this logic.
// Pure and deterministic. It reads KOE's own records (the Worker runs, the installed Workers) and what the other modules report about
// the work people have open; it never changes anything, and one company never sees another's records.

import type { CommsState } from "./comms-center";
import type { CrmState } from "./crm-center";
import type { KoeState } from "./koe-engine";
import type { ExecutionEvent } from "./koe-ledger";
import type { Assignment, Branch, Department, Level, OrgModule, OrgState, Permissions, Role, Team, User } from "./org-center";

const DAY = 86_400_000;

// ---------------------------------------------------------------- the rules and assumptions (declared, so every figure can be explained)
export const CAPACITY_PER_PERSON = 12; // open items one person can carry
export const OVERLOAD_RATIO = 1.0; // a team above this has more open work than capacity
export const SPARE_RATIO = 0.6; // a team or department below this has room to help
export const UNDERUSED_UTILIZATION = 0.03; // a Worker that used under 3 % of its daily limit over the window
export const WORKER_WINDOW_DAYS = 7;
export const INACTIVE_DAYS = 14;
export const AWAY_DAYS = 7;
export const BUSY_RATIO = 0.8; // a Worker above this share of its daily limit today is busy
// An ASSUMPTION of the simulation, shown as an estimate wherever it is used: what a person in each role costs a company per month.
export const PERSON_MONTHLY_COST_MICROS: Record<string, number> = {
  administrator: 4_500_000_000, manager: 4_000_000_000, supervisor: 3_000_000_000, sales: 2_500_000_000, marketing: 2_500_000_000,
  finance: 2_800_000_000, hr: 2_600_000_000, support: 2_200_000_000, readonly: 1_500_000_000, custom: 2_500_000_000,
};

export type WorkerRef = { id: string; name: string; specialty: string };
/** What KOE knows from the other modules, tenant by tenant. */
export type OrgSignals = {
  executions: readonly ExecutionEvent[];
  instances: readonly { tenantId: string; definitionId: string; status: "active" | "paused" | "disabled"; maxRunsPerDay: number }[];
  activity: readonly { tenantId: string; userId: string; openItems: number; lastActivityAt?: string }[];
  workers: readonly WorkerRef[];
};

// ---------------------------------------------------------------- adapters: KOE's records, in the shape this module reads
const OPEN_STAGES = ["prospect", "qualified", "meeting", "proposal", "negotiation"];
/** What each person has open, from the CRM (their open prospects) and the Communications Hub (their open and pending conversations). */
export function activityFrom(crm: CrmState, comms: CommsState, tenantId: string): OrgSignals["activity"] {
  const ids = new Set<string>([...crm.leads.filter((item) => item.tenantId === tenantId).map((item) => item.owner), ...comms.conversations.filter((item) => item.tenantId === tenantId).map((item) => item.assignee)]);
  return [...ids].filter(Boolean).map((userId) => {
    const leads = crm.leads.filter((item) => item.tenantId === tenantId && item.owner === userId && OPEN_STAGES.includes(item.stage)).length;
    const conversations = comms.conversations.filter((item) => item.tenantId === tenantId && item.assignee === userId && (item.status === "open" || item.status === "pending")).length;
    const touched = [...crm.timeline.filter((item) => item.tenantId === tenantId && item.actor === userId).map((item) => item.at), ...comms.entries.filter((item) => item.tenantId === tenantId && item.actor === userId).map((item) => item.at)].sort();
    return { tenantId, userId, openItems: leads + conversations, ...(touched.length ? { lastActivityAt: touched[touched.length - 1] } : {}) };
  });
}
export function signalsFrom(koe: KoeState, executions: readonly ExecutionEvent[], activity: OrgSignals["activity"]): OrgSignals {
  return {
    executions,
    instances: koe.instances.map((item) => ({ tenantId: item.tenantId, definitionId: item.definitionId, status: item.status, maxRunsPerDay: item.maxRunsPerDay })),
    activity,
    workers: koe.definitions.map((item) => ({ id: item.id, name: item.name, specialty: item.specialty })),
  };
}

// ---------------------------------------------------------------- the structure
const key = (kind: string, id: string) => `${kind}:${id}`;
/** The current team of every person and Worker: the latest assignment of each (the history itself is never touched). */
export function currentAssignments(state: OrgState, tenantId: string): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const item of state.assignments.filter((entry) => entry.tenantId === tenantId)) map.set(key(item.subject.kind, item.subject.id), item.teamId);
  return map;
}
export const membersOf = (state: OrgState, tenantId: string, teamId: string): { users: User[]; workers: string[] } => {
  const current = currentAssignments(state, tenantId);
  return {
    users: state.users.filter((item) => item.tenantId === tenantId && current.get(key("user", item.id)) === teamId),
    workers: [...current.entries()].filter(([k, team]) => k.startsWith("worker:") && team === teamId).map(([k]) => k.slice(7)),
  };
};

export type TreeTeam = { team: Team; people: User[]; workers: { id: string; name: string; specialty: string }[] };
export type TreeDepartment = { department: Department; teams: TreeTeam[] };
export type TreeBranch = { branch: Branch; departments: TreeDepartment[] };
export type OrgTree = { org: { name: string; ownerId: string } | null; branches: TreeBranch[]; unassigned: { people: User[]; workers: { id: string; name: string; specialty: string }[] } };

/** Company → branches → departments → teams → people and AI Workers: a Worker is in a team just like a person. */
export function orgTree(state: OrgState, tenantId: string, signals: OrgSignals): OrgTree {
  const workers = signals.workers;
  const org = state.orgs.find((item) => item.tenantId === tenantId);
  const ref = (id: string) => workers.find((item) => item.id === id) ?? { id, name: id, specialty: "custom" };
  const current = currentAssignments(state, tenantId);
  const teamIds = new Set(state.teams.filter((item) => item.tenantId === tenantId).map((item) => item.id));
  return {
    org: org ? { name: org.name, ownerId: org.ownerId } : null,
    branches: state.branches.filter((item) => item.tenantId === tenantId).map((branch) => ({
      branch,
      departments: state.departments.filter((item) => item.tenantId === tenantId && item.branchId === branch.id).map((department) => ({
        department,
        teams: state.teams.filter((item) => item.tenantId === tenantId && item.departmentId === department.id).map((team) => {
          const members = membersOf(state, tenantId, team.id);
          return { team, people: members.users, workers: members.workers.map(ref) };
        }),
      })),
    })),
    unassigned: {
      people: state.users.filter((item) => item.tenantId === tenantId && !teamIds.has(current.get(key("user", item.id)) ?? "")),
      workers: signals.instances.filter((item) => item.tenantId === tenantId && item.status !== "disabled" && !teamIds.has(current.get(key("worker", item.definitionId)) ?? "")).map((item) => ref(item.definitionId)),
    },
  };
}

// ---------------------------------------------------------------- the workforce: people and Workers in one view
export type Availability = "available" | "busy" | "away" | "paused" | "disabled";
export type WorkforceRow = {
  kind: "user" | "worker"; id: string; name: string; status: string; specialty: string; roleName?: string; teamId: string | null; teamName: string; branchName: string;
  openItems: number; load: number; availability: Availability; estimatedCostMicros: number; lastActivityAt?: string;
};
const teamPlace = (state: OrgState, tenantId: string, teamId: string | null) => {
  const team = teamId ? state.teams.find((item) => item.id === teamId && item.tenantId === tenantId) : undefined;
  const department = team ? state.departments.find((item) => item.id === team.departmentId) : undefined;
  const branch = department ? state.branches.find((item) => item.id === department.branchId) : undefined;
  return { team, teamName: team?.name ?? "Sin equipo", branchName: branch?.name ?? "—" };
};

export function workforce(state: OrgState, tenantId: string, signals: OrgSignals, asOf: string): WorkforceRow[] {
  const current = currentAssignments(state, tenantId);
  const activity = signals.activity.filter((item) => item.tenantId === tenantId);
  const rows: WorkforceRow[] = state.users.filter((item) => item.tenantId === tenantId).map((user) => {
    const teamId = current.get(key("user", user.id)) ?? null;
    const place = teamPlace(state, tenantId, teamId);
    const role = state.roles.find((item) => item.id === user.roleId && item.tenantId === tenantId);
    const mine = activity.find((item) => item.userId === user.id);
    const openItems = mine?.openItems ?? 0;
    const seen = user.lastAccessAt ?? mine?.lastActivityAt;
    const stale = !seen || Date.parse(asOf) - Date.parse(seen) > AWAY_DAYS * DAY;
    const availability: Availability = user.status === "disabled" ? "disabled" : user.status === "suspended" ? "paused" : user.status === "pending" || stale ? "away" : openItems >= CAPACITY_PER_PERSON ? "busy" : "available";
    return {
      kind: "user", id: user.id, name: user.name, status: user.status, specialty: place.team?.specialty ?? "—", roleName: role?.name, teamId, teamName: place.teamName, branchName: place.branchName, openItems,
      load: openItems / CAPACITY_PER_PERSON, availability, estimatedCostMicros: user.status === "active" ? PERSON_MONTHLY_COST_MICROS[role?.key ?? "custom"] ?? PERSON_MONTHLY_COST_MICROS.custom : 0, ...(seen ? { lastActivityAt: seen } : {}),
    };
  });
  const day = asOf.slice(0, 10);
  for (const ref of signals.workers) {
    const instance = signals.instances.find((item) => item.tenantId === tenantId && item.definitionId === ref.id);
    const teamId = current.get(key("worker", ref.id)) ?? null;
    if (!instance && teamId === null) continue; // a Worker the company never installed and never put in a team is not part of its workforce
    const place = teamPlace(state, tenantId, teamId);
    const runs = signals.executions.filter((item) => item.tenantId === tenantId && item.workerId === ref.id);
    const today = runs.filter((item) => item.at.slice(0, 10) === day).length;
    const month = runs.filter((item) => Date.parse(asOf) - Date.parse(item.at) <= 30 * DAY && Date.parse(item.at) <= Date.parse(asOf));
    const load = instance ? today / instance.maxRunsPerDay : 0;
    const availability: Availability = !instance || instance.status === "disabled" ? "disabled" : instance.status === "paused" ? "paused" : load >= BUSY_RATIO ? "busy" : "available";
    const last = runs.map((item) => item.at).sort().at(-1);
    rows.push({ kind: "worker", id: ref.id, name: ref.name, status: instance?.status ?? "disabled", specialty: ref.specialty, teamId, teamName: place.teamName, branchName: place.branchName, openItems: today, load, availability, estimatedCostMicros: month.reduce((sum, item) => sum + item.costMicros, 0), ...(last ? { lastActivityAt: last } : {}) });
  }
  return rows;
}

// ---------------------------------------------------------------- recommendations: all of them come from here
export type Severity = "low" | "normal" | "high" | "critical";
export type Recommendation = {
  id: string; kind: "overloadedTeam" | "underusedWorker" | "unassignedWorker" | "inactiveUser" | "bottleneckDepartment"; severity: Severity; text: string; reason: string;
  subject: { kind: "team" | "worker" | "user" | "department"; id: string }; suggestedMove?: { userId: string; fromTeamId: string; toTeamId: string };
};
const SEVERITY_RANK: Record<Severity, number> = { critical: 3, high: 2, normal: 1, low: 0 };

type TeamLoad = { team: Team; people: User[]; load: number; capacity: number; ratio: number };
const teamLoads = (state: OrgState, tenantId: string, signals: OrgSignals): TeamLoad[] => {
  const activity = signals.activity.filter((item) => item.tenantId === tenantId);
  return state.teams.filter((item) => item.tenantId === tenantId).map((team) => {
    const people = membersOf(state, tenantId, team.id).users.filter((user) => user.status === "active");
    const load = people.reduce((sum, user) => sum + (activity.find((item) => item.userId === user.id)?.openItems ?? 0), 0);
    const capacity = people.length * CAPACITY_PER_PERSON;
    return { team, people, load, capacity, ratio: capacity > 0 ? load / capacity : 0 };
  });
};

export function recommendations(state: OrgState, tenantId: string, signals: OrgSignals, asOf: string): Recommendation[] {
  const out: Recommendation[] = [];
  const loads = teamLoads(state, tenantId, signals);
  const activity = signals.activity.filter((item) => item.tenantId === tenantId);
  const roleOf = (user: User) => state.roles.find((item) => item.id === user.roleId && item.tenantId === tenantId);
  const departmentOf = (team: Team) => state.departments.find((item) => item.id === team.departmentId && item.tenantId === tenantId);
  const spareFor = (over: TeamLoad): TeamLoad | undefined => loads.filter((item) => item.team.id !== over.team.id && item.people.length > 1 && item.ratio < SPARE_RATIO && state.departments.find((d) => d.id === item.team.departmentId)?.branchId === departmentOf(over.team)?.branchId)
    .sort((a, b) => a.ratio - b.ratio || a.team.id.localeCompare(b.team.id))[0];

  for (const item of loads.filter((entry) => entry.people.length > 0 && entry.ratio > OVERLOAD_RATIO)) {
    const spare = spareFor(item);
    const movable = spare?.people.filter((user) => !roleOf(user)?.critical).sort((a, b) => (activity.find((x) => x.userId === a.id)?.openItems ?? 0) - (activity.find((x) => x.userId === b.id)?.openItems ?? 0) || a.id.localeCompare(b.id))[0];
    out.push({
      id: `overloadedTeam:${item.team.id}`, kind: "overloadedTeam", severity: item.ratio > 1.5 ? "critical" : item.ratio > 1.2 ? "high" : "normal",
      text: `El equipo «${item.team.name}» está sobrecargado: ${item.load} elementos abiertos para ${item.people.length} persona(s).`,
      reason: `Capacidad ${item.capacity} (${CAPACITY_PER_PERSON} por persona); la carga es ${Math.round(item.ratio * 100)} % de lo que puede atender.${spare && movable ? ` «${spare.team.name}» tiene espacio (${Math.round(spare.ratio * 100)} %).` : ""}`,
      subject: { kind: "team", id: item.team.id }, ...(spare && movable ? { suggestedMove: { userId: movable.id, fromTeamId: spare.team.id, toTeamId: item.team.id } } : {}),
    });
  }

  const departments = state.departments.filter((item) => item.tenantId === tenantId).map((department) => {
    const mine = loads.filter((item) => item.team.departmentId === department.id);
    const load = mine.reduce((sum, item) => sum + item.load, 0);
    const capacity = mine.reduce((sum, item) => sum + item.capacity, 0);
    return { department, load, capacity, ratio: capacity > 0 ? load / capacity : 0 };
  });
  for (const item of departments.filter((entry) => entry.capacity > 0 && entry.ratio > OVERLOAD_RATIO)) {
    const other = departments.filter((entry) => entry.department.id !== item.department.id && entry.department.branchId === item.department.branchId && entry.capacity > 0 && entry.ratio < SPARE_RATIO).sort((a, b) => a.ratio - b.ratio)[0];
    if (other) out.push({
      id: `bottleneckDepartment:${item.department.id}`, kind: "bottleneckDepartment", severity: "high", text: `El departamento «${item.department.name}» es un cuello de botella.`,
      reason: `Carga ${Math.round(item.ratio * 100)} % de su capacidad, mientras «${other.department.name}» de la misma sucursal está en ${Math.round(other.ratio * 100)} %.`, subject: { kind: "department", id: item.department.id },
    });
  }

  const current = currentAssignments(state, tenantId);
  for (const ref of signals.workers) {
    const instance = signals.instances.find((item) => item.tenantId === tenantId && item.definitionId === ref.id);
    if (!instance || instance.status !== "active") continue;
    const teamId = current.get(key("worker", ref.id)) ?? null;
    if (teamId === null) { out.push({ id: `unassignedWorker:${ref.id}`, kind: "unassignedWorker", severity: "low", text: `El Worker «${ref.name}» está instalado pero no pertenece a ningún equipo.`, reason: "Un Worker rinde más cuando está en un equipo con objetivos y personas que lo supervisen.", subject: { kind: "worker", id: ref.id } }); continue; }
    const runs = signals.executions.filter((item) => item.tenantId === tenantId && item.workerId === ref.id && Date.parse(asOf) - Date.parse(item.at) <= WORKER_WINDOW_DAYS * DAY && Date.parse(item.at) <= Date.parse(asOf)).length;
    const utilization = runs / (instance.maxRunsPerDay * WORKER_WINDOW_DAYS);
    if (utilization < UNDERUSED_UTILIZATION) out.push({ id: `underusedWorker:${ref.id}`, kind: "underusedWorker", severity: "low", text: `El Worker «${ref.name}» está infrautilizado.`, reason: `${runs} ejecución(es) en ${WORKER_WINDOW_DAYS} días: ${(utilization * 100).toFixed(1)} % de su límite diario (menos del ${UNDERUSED_UTILIZATION * 100} %).`, subject: { kind: "worker", id: ref.id } });
  }

  for (const user of state.users.filter((item) => item.tenantId === tenantId && item.status === "active")) {
    const seen = user.lastAccessAt ?? activity.find((item) => item.userId === user.id)?.lastActivityAt;
    const days = seen ? Math.floor((Date.parse(asOf) - Date.parse(seen)) / DAY) : null;
    if (days === null || days > INACTIVE_DAYS) out.push({ id: `inactiveUser:${user.id}`, kind: "inactiveUser", severity: days === null || days > 30 ? "normal" : "low", text: `${user.name} no tiene actividad.`, reason: days === null ? "Nunca ha ingresado." : `Su último acceso fue hace ${days} días (más de ${INACTIVE_DAYS}).`, subject: { kind: "user", id: user.id } });
  }
  return out.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- the dashboard
export type OrgDashboard = {
  companies: number; orgName: string; ownerId: string; branches: { total: number; active: number }; departments: number; teams: number;
  users: Record<User["status"], number> & { total: number }; workers: { installed: number; inTeams: number; unassigned: number }; roles: { builtin: number; custom: number };
  invitations: { pending: number; expired: number; accepted: number; revoked: number }; recommendations: Record<Severity, number>; health: "ok" | "attention" | "critical";
};
export function orgDashboard(state: OrgState, tenantId: string, signals: OrgSignals, asOf: string): OrgDashboard {
  const org = state.orgs.find((item) => item.tenantId === tenantId);
  const users = state.users.filter((item) => item.tenantId === tenantId);
  const invitations = state.invitations.filter((item) => item.tenantId === tenantId);
  const current = currentAssignments(state, tenantId);
  const installed = signals.instances.filter((item) => item.tenantId === tenantId && item.status !== "disabled");
  const inTeams = installed.filter((item) => current.get(key("worker", item.definitionId)) != null).length;
  const recs = recommendations(state, tenantId, signals, asOf);
  const count = (severity: Severity) => recs.filter((item) => item.severity === severity).length;
  const expired = (invitation: OrgState["invitations"][number]) => invitation.status === "pending" && Date.parse(invitation.expiresAt) <= Date.parse(asOf);
  return {
    companies: org ? 1 : 0, orgName: org?.name ?? "", ownerId: org?.ownerId ?? "",
    branches: { total: state.branches.filter((item) => item.tenantId === tenantId).length, active: state.branches.filter((item) => item.tenantId === tenantId && item.status === "active").length },
    departments: state.departments.filter((item) => item.tenantId === tenantId).length, teams: state.teams.filter((item) => item.tenantId === tenantId).length,
    users: { total: users.length, pending: users.filter((item) => item.status === "pending").length, active: users.filter((item) => item.status === "active").length, suspended: users.filter((item) => item.status === "suspended").length, disabled: users.filter((item) => item.status === "disabled").length },
    workers: { installed: installed.length, inTeams, unassigned: installed.length - inTeams },
    roles: { builtin: state.roles.filter((item) => item.tenantId === tenantId && item.builtin).length, custom: state.roles.filter((item) => item.tenantId === tenantId && !item.builtin).length },
    invitations: { pending: invitations.filter((item) => item.status === "pending" && !expired(item)).length, expired: invitations.filter(expired).length, accepted: invitations.filter((item) => item.status === "accepted").length, revoked: invitations.filter((item) => item.status === "revoked").length },
    recommendations: { critical: count("critical"), high: count("high"), normal: count("normal"), low: count("low") }, health: count("critical") > 0 ? "critical" : count("high") > 0 ? "attention" : "ok",
  };
}

// ---------------------------------------------------------------- permissions and identity
/** Whether a person may do something in a module: their role's level, the same company, and an active account. */
export function canUser(state: OrgState, tenantId: string, userId: string, module: OrgModule, level: Level): boolean {
  const user = state.users.find((item) => item.id === userId && item.tenantId === tenantId);
  const role = user ? state.roles.find((item) => item.id === user.roleId && item.tenantId === tenantId) : undefined;
  if (!user || !role || user.status !== "active") return false;
  const rank: Record<Level, number> = { none: 0, read: 1, write: 2, manage: 3 };
  return rank[role.permissions[module]] >= rank[level];
}
export const permissionMatrix = (state: OrgState, tenantId: string): { role: Role; permissions: Permissions; users: number }[] =>
  state.roles.filter((item) => item.tenantId === tenantId).map((role) => ({ role, permissions: role.permissions, users: state.users.filter((user) => user.tenantId === tenantId && user.roleId === role.id).length }));

export function identityOf(state: OrgState, tenantId: string, userId: string) {
  const user = state.users.find((item) => item.id === userId && item.tenantId === tenantId);
  if (!user) return null;
  return {
    user, role: state.roles.find((item) => item.id === user.roleId && item.tenantId === tenantId),
    sessions: state.sessions.filter((item) => item.tenantId === tenantId && item.userId === userId), devices: state.devices.filter((item) => item.tenantId === tenantId && item.userId === userId),
  };
}
export const assignmentHistory = (state: OrgState, tenantId: string, subject?: { kind: "user" | "worker"; id: string }): Assignment[] =>
  state.assignments.filter((item) => item.tenantId === tenantId && (!subject || (item.subject.kind === subject.kind && item.subject.id === subject.id)));

// ---------------------------------------------------------------- the future, declared and NOT built
export type FutureIdentity = { id: "sso" | "azureAd" | "googleWorkspace" | "entra" | "ldap" | "scim" | "okta" | "auth0"; label: string; status: "notBuilt"; goesThrough: "KOE"; direct: false; needs: string };
/** Each will be an identity connector that goes through KOE: a provider is never reached from a screen or a Worker. None exists yet. */
export const FUTURE_IDENTITY: readonly FutureIdentity[] = [
  { id: "sso", label: "SSO", status: "notBuilt", goesThrough: "KOE", direct: false, needs: "un estándar de federación (SAML u OpenID Connect) y un proveedor configurado por empresa" },
  { id: "azureAd", label: "Azure AD", status: "notBuilt", goesThrough: "KOE", direct: false, needs: "consentimiento del administrador del directorio y alcance mínimo" },
  { id: "googleWorkspace", label: "Google Workspace", status: "notBuilt", goesThrough: "KOE", direct: false, needs: "dominio verificado y consentimiento del administrador" },
  { id: "entra", label: "Microsoft Entra", status: "notBuilt", goesThrough: "KOE", direct: false, needs: "aplicación registrada y asignación de usuarios por grupo" },
  { id: "ldap", label: "LDAP", status: "notBuilt", goesThrough: "KOE", direct: false, needs: "acceso al directorio de la empresa por un canal seguro y de solo lectura" },
  { id: "scim", label: "SCIM", status: "notBuilt", goesThrough: "KOE", direct: false, needs: "aprovisionamiento automático con aprobación humana para roles críticos" },
  { id: "okta", label: "Okta", status: "notBuilt", goesThrough: "KOE", direct: false, needs: "aplicación configurada en el directorio de la empresa" },
  { id: "auth0", label: "Auth0", status: "notBuilt", goesThrough: "KOE", direct: false, needs: "inquilino del proveedor y reglas de asignación de roles" },
];
