import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_ROLES, LEVELS, MODULES, analysesOf, auditOf, authorityOf, branchesOf, currentTeam, grantsOf, invitationsOf, isCriticalPermission, newOrgState, proposalsOf, reduceOrg, rolesOf, teamsOf, usersOf,
  type OrgEnv, type OrgEvent, type OrgState,
} from "./org-center";
import { DEMO_NOW, DEMO_PERSONAS, demoOrgOk } from "./org-demo";
import { ERROR_CODES, label, message } from "./org-messages";
import {
  CAPACITY_PER_PERSON, FUTURE_IDENTITY, PERSON_MONTHLY_COST_MICROS, assignmentHistory, canUser, identityOf, membersOf, orgDashboard, orgTree, permissionMatrix, recommendations, workforce,
  type OrgSignals,
} from "./koe-org";
import { BASE_MODELS } from "./koe-registry";
import { ACTION_LEVELS } from "./workers";

const source = demoOrgOk();
const ENV: OrgEnv = source.env;
const demo = source.state;
const NOW = DEMO_NOW;
const ago = (days: number, hours = 0) => new Date(Date.parse(NOW) - days * 86_400_000 - hours * 3_600_000).toISOString();
const ANA = { tenantId: "tenant-nova", actor: "ana" };
const PABLO = { tenantId: "tenant-nova", actor: "pablo" };
const CARLA = { tenantId: "tenant-nova", actor: "carla" };
const NEX = { tenantId: "tenant-nova", actor: "worker:nex" };
const SYSTEM = { tenantId: "tenant-nova", actor: "system" };
const LUCIA = { tenantId: "tenant-vida", actor: "lucia" };

const step = (state: OrgState, event: OrgEvent, env: OrgEnv = ENV) => reduceOrg(state, event, env);
const must = (state: OrgState, event: OrgEvent, env: OrgEnv = ENV): OrgState => { const result = reduceOrg(state, event, env); expect(result.error, event.type).toBeUndefined(); return result.state; };
const role = (state: OrgState, key: string, tenantId = "tenant-nova") => rolesOf(state, tenantId).find((item) => item.key === key)?.id ?? "";
const team = (state: OrgState, name: string, tenantId = "tenant-nova") => teamsOf(state, tenantId).find((item) => item.name === name)?.id ?? "";
const user = (state: OrgState, id: string, tenantId = "tenant-nova") => usersOf(state, tenantId).find((item) => item.id === id);
const invite = (state: OrgState, who = ANA, email = "nuevo@nova.test", roleKey = "sales") => step(state, { ...who, at: ago(0, 1), type: "invite.create", email, name: "Persona Nueva", roleId: role(state, roleKey) });

/** A small company built by hand, to test rules without the sample: an owner, a manager, a salesperson, one branch, one department. */
const tiny = () => {
  let state = must(newOrgState(), { ...SYSTEM, at: ago(60), type: "org.create", name: "Mini", ownerId: "ana", ownerName: "Ana", ownerEmail: "ana@mini.test" });
  state = must(state, { ...ANA, at: ago(59), type: "branch.create", name: "Central", city: "San José" });
  state = must(state, { ...ANA, at: ago(59), type: "department.create", branchId: state.branches[0].id, name: "Ventas" });
  for (const [id, key] of [["pablo", "manager"], ["carla", "sales"], ["diego", "support"]] as const) {
    state = must(state, { ...ANA, at: ago(58), type: "invite.create", email: `${id}@mini.test`, name: id, roleId: role(state, key) });
    state = must(state, { ...SYSTEM, at: ago(57), type: "invite.accept", invitationId: invitationOf(state, id) });
  }
  return state;
};
const invitationOf = (state: OrgState, userId: string) => invitationsOf(state, "tenant-nova").find((item) => item.userId === userId)?.id ?? "";
const signals = (over: Partial<OrgSignals> = {}): OrgSignals => ({ executions: [], instances: [], activity: [], workers: [], ...over });

describe("the sample loads without a refusal", () => {
  it("has the whole structure: branches, departments, teams, people in every state, Workers, roles, invitations, proposals", () => {
    expect(source.errors).toEqual([]);
    const d = orgDashboard(demo, "tenant-nova", ENV.signals, NOW);
    expect(d).toMatchObject({
      companies: 1, orgName: "Nova Marketing Studio", ownerId: "ana", branches: { total: 2, active: 2 }, departments: 4, teams: 6,
      users: { total: 13, pending: 1, active: 10, suspended: 1, disabled: 1 }, workers: { installed: 5, inTeams: 4, unassigned: 1 }, roles: { builtin: 9, custom: 1 },
      invitations: { pending: 1, expired: 0, accepted: 11, revoked: 0 }, health: "attention",
    });
    expect(proposalsOf(demo, "tenant-nova").map((item) => `${item.payload.kind}:${item.status}`)).toEqual(["invite:approved", "invite:proposed", "move:proposed", "team:proposed"]);
    expect(DEMO_PERSONAS).toHaveLength(5);
  });
});

describe("Organization Tree: company, branches, departments, teams, people and Workers", () => {
  const tree = orgTree(demo, "tenant-nova", ENV.signals);
  it("nests the structure, and a Worker belongs to a team exactly like a person", () => {
    expect(tree.org).toMatchObject({ name: "Nova Marketing Studio", ownerId: "ana" });
    expect(tree.branches.map((item) => item.branch.name)).toEqual(["Sede Central", "Sucursal Norte"]);
    const central = tree.branches[0];
    expect(central.departments.map((item) => item.department.name)).toEqual(["Comercial", "Soporte", "Administración"]);
    const sales = central.departments[0].teams.find((item) => item.team.name === "Ventas Corporativas");
    expect(sales?.people.map((item) => item.id).sort()).toEqual(["carla", "maria", "pablo"]);
    expect(sales?.workers.map((item) => item.name)).toEqual(["Asistente comercial"]);
    expect(tree.branches[1].departments[0].teams[0].team.name).toBe("Ventas Norte");
    expect(membersOf(demo, "tenant-nova", team(demo, "Finanzas")).workers).toEqual(["collections"]);
  });

  it("lists what has no team: people and the Workers the company installed but did not place", () => {
    expect(tree.unassigned.people.map((item) => item.id).sort()).toEqual(["ana", "jorge", "leo"]);
    expect(tree.unassigned.workers.map((item) => item.name)).toEqual(["Coordinador"]);
  });
});

describe("Users: invitations, states, last access, language and time zone", () => {
  it("invites a person (pending), who accepts through the platform (active), with a language, a time zone and a last access", () => {
    let state = tiny();
    const invited = must(state, { ...PABLO, at: ago(5), type: "invite.create", email: "nora@mini.test", name: "Nora Campos", roleId: role(state, "sales"), teamId: undefined });
    expect(user(invited, "nora")).toMatchObject({ status: "pending", language: "es", timezone: "America/Costa_Rica", invitedBy: "pablo" });
    expect(user(invited, "nora")?.lastAccessAt).toBeUndefined();
    expect(invitationsOf(invited, "tenant-nova").at(-1)).toMatchObject({ status: "pending", userId: "nora" });
    state = must(invited, { ...SYSTEM, at: ago(4), type: "invite.accept", invitationId: invitationOf(invited, "nora") });
    expect(user(state, "nora")).toMatchObject({ status: "active", lastAccessAt: ago(4) });
    state = must(state, { ...SYSTEM, at: ago(1), type: "access.record", userId: "nora" });
    expect(user(state, "nora")?.lastAccessAt).toBe(ago(1));
    expect(step(state, { ...ANA, at: ago(1), type: "access.record", userId: "nora" }).errorCode).toBe("systemOnly");
    expect(step(state, { ...SYSTEM, at: ago(3), type: "invite.accept", invitationId: invitationOf(invited, "nora") }).errorCode).toBe("closed");
  });

  it("refuses duplicates, bad data and an expired invitation, and a revoked one disables the person", () => {
    const state = tiny();
    expect(invite(state, ANA, "pablo@mini.test").errorCode).toBe("exists");
    expect(invite(state, ANA, "no-es-correo").errorCode).toBe("invalid");
    expect(step(state, { ...ANA, at: ago(1), type: "invite.create", email: "x@mini.test", name: " ", roleId: role(state, "sales") }).errorCode).toBe("invalid");
    expect(step(state, { ...ANA, at: ago(1), type: "invite.create", email: "x@mini.test", name: "X", roleId: "rl_99999" }).errorCode).toBe("notFound");
    const sent = must(state, { ...ANA, at: ago(20), type: "invite.create", email: "tarde@mini.test", name: "Tarde", roleId: role(state, "sales") });
    expect(step(sent, { ...SYSTEM, at: ago(0), type: "invite.accept", invitationId: invitationOf(sent, "tarde") }).errorCode).toBe("invalid"); // 14 days have passed
    const revoked = must(sent, { ...PABLO, at: ago(18), type: "invite.revoke", invitationId: invitationOf(sent, "tarde") });
    expect(user(revoked, "tarde")?.status).toBe("disabled");
    expect(invitationsOf(revoked, "tenant-nova").find((item) => item.userId === "tarde")?.status).toBe("revoked");
    expect(step(revoked, { ...PABLO, at: ago(17), type: "invite.revoke", invitationId: invitationOf(sent, "tarde") }).errorCode).toBe("closed");
    expect(orgDashboard(sent, "tenant-nova", signals(), NOW).invitations.expired).toBe(1);
  });

  it("suspends, disables and reactivates with the right authority, and never deletes anyone", () => {
    const state = tiny();
    const suspended = must(state, { ...PABLO, at: ago(5), type: "user.setStatus", userId: "carla", to: "suspended" });
    expect(user(suspended, "carla")?.status).toBe("suspended");
    expect(step(suspended, { ...PABLO, at: ago(4), type: "user.setStatus", userId: "carla", to: "suspended" }).errorCode).toBe("invalid");
    const disabled = must(suspended, { ...PABLO, at: ago(4), type: "user.setStatus", userId: "carla", to: "disabled" });
    expect(step(disabled, { ...PABLO, at: ago(3), type: "user.setStatus", userId: "carla", to: "active" }).errorCode).toBe("adminRequired"); // bringing someone back is an administrator's
    expect(user(must(disabled, { ...ANA, at: ago(3), type: "user.setStatus", userId: "carla", to: "active" }), "carla")?.status).toBe("active");
    expect(step(state, { ...PABLO, at: ago(3), type: "user.setStatus", userId: "carla", to: "pending" }).errorCode).toBe("invalid");
    expect(step(state, { ...CARLA, at: ago(3), type: "user.setStatus", userId: "diego", to: "suspended" }).errorCode).toBe("forbidden"); // a salesperson manages nobody
    expect(usersOf(disabled, "tenant-nova")).toHaveLength(4); // still all there
    const events = readFileSync(join(__dirname, "org-center.ts"), "utf8").match(/type: "([a-zA-Z.]+)"/g)?.map((item) => item.slice(7, -1)) ?? [];
    expect(events.length).toBeGreaterThan(25);
    expect(events.some((item) => /delete|remove|erase|purge|destroy/.test(item))).toBe(false); // there is no event to delete a user, a role, a team or the history
  });

  it("protects the owner and the last administrator, and a person cannot change their own state", () => {
    let state = tiny();
    expect(step(state, { ...ANA, at: ago(3), type: "user.setStatus", userId: "ana", to: "suspended" }).errorCode).toBe("ownerProtected");
    expect(step(state, { ...ANA, at: ago(3), type: "user.setRole", userId: "ana", roleId: role(state, "sales") }).errorCode).toBe("ownerProtected");
    expect(step(state, { ...PABLO, at: ago(3), type: "user.setStatus", userId: "pablo", to: "suspended" }).errorCode).toBe("invalid");
    state = must(invite(state).state, { ...ANA, at: ago(2), type: "invite.create", email: "adm@mini.test", name: "Otro Admin", roleId: role(state, "administrator") });
    state = must(state, { ...SYSTEM, at: ago(1), type: "invite.accept", invitationId: invitationOf(state, "adm") });
    expect(step(state, { ...ANA, at: ago(1), type: "user.setStatus", userId: "adm", to: "suspended" }).error).toBeUndefined(); // two administrators: one may be suspended
    expect(step(state, { ...ANA, at: ago(1), type: "user.setRole", userId: "adm", roleId: role(state, "sales") }).error).toBeUndefined();
  });

  it("has a language and a time zone per person, and a last access the platform keeps", () => {
    expect(demo.users.every((item) => item.language && item.timezone)).toBe(true);
    expect(user(demo, "ana")?.lastAccessAt).toBeDefined();
    expect(user(demo, "jorge")?.lastAccessAt).toBeUndefined();
    expect(label("status", "suspended")).toBe("Suspendido");
    expect(label("status", "disabled")).toBe("Deshabilitado");
    expect(label("status", "pending")).toBe("Pendiente");
  });
});

describe("Roles and Permissions: per module, per company", () => {
  it("gives every company its own nine roles, plus custom ones, with a permission for each of the eleven modules", () => {
    expect(BUILTIN_ROLES.map((item) => item.name)).toEqual(["Administrador", "Gerente", "Supervisor", "Ventas", "Marketing", "Finanzas", "RRHH", "Soporte", "Solo lectura"]);
    expect(MODULES).toEqual(["crm", "academy", "marketplace", "workers", "insights", "payments", "communications", "aiStudio", "automations", "integrations", "developer"]);
    expect(LEVELS).toEqual(["none", "read", "write", "manage"]);
    const nova = rolesOf(demo, "tenant-nova");
    const vida = rolesOf(demo, "tenant-vida");
    expect(nova.filter((item) => item.builtin)).toHaveLength(9);
    expect(vida).toHaveLength(9);
    expect(nova.some((item) => vida.some((other) => other.id === item.id))).toBe(false); // never shared
    expect(nova.find((item) => item.key === "custom")).toMatchObject({ name: "Analista", builtin: false, critical: false });
    for (const item of nova) expect(Object.keys(item.permissions).sort()).toEqual([...MODULES].sort());
    expect(role(demo, "administrator")).not.toBe(role(demo, "administrator", "tenant-vida"));
  });

  it("answers what a person may do from their own role, in their own company, with an active account", () => {
    expect(canUser(demo, "tenant-nova", "carla", "crm", "write")).toBe(true);
    expect(canUser(demo, "tenant-nova", "carla", "payments", "read")).toBe(false);
    expect(canUser(demo, "tenant-nova", "elena", "payments", "write")).toBe(true);
    expect(canUser(demo, "tenant-nova", "elena", "payments", "manage")).toBe(false);
    expect(canUser(demo, "tenant-nova", "ana", "developer", "manage")).toBe(true);
    expect(canUser(demo, "tenant-nova", "kira", "crm", "read")).toBe(false); // suspended
    expect(canUser(demo, "tenant-nova", "jorge", "crm", "read")).toBe(false); // still pending
    expect(canUser(demo, "tenant-vida", "carla", "crm", "read")).toBe(false); // another company's person
    expect(canUser(demo, "tenant-nova", "lucia", "crm", "read")).toBe(false);
    const matrix = permissionMatrix(demo, "tenant-nova");
    expect(matrix).toHaveLength(10);
    expect(matrix.find((item) => item.role.key === "sales")?.users).toBe(5); // Carla, Kira, María, Nora and Omar
  });

  it("lets only an administrator create roles and change permissions, and flags the critical ones", () => {
    const state = tiny();
    const create = (who: { tenantId: string; actor: string }, permissions = { crm: "write" as const }) => step(state, { ...who, at: ago(2), type: "role.create", name: "Mi rol", permissions });
    expect(create(ANA).error).toBeUndefined();
    expect(create(PABLO).errorCode).toBe("adminRequired");
    expect(create(NEX).errorCode).toBe("personRequired");
    const made = create(ANA, { crm: "write" }).state;
    const id = rolesOf(made, "tenant-nova").find((item) => item.name === "Mi rol")?.id ?? "";
    expect(step(made, { ...ANA, at: ago(2), type: "role.create", name: "mi ROL", permissions: {} }).errorCode).toBe("exists");
    expect(step(made, { ...PABLO, at: ago(1), type: "role.setPermission", roleId: id, module: "crm", level: "manage" }).errorCode).toBe("adminRequired");
    expect(step(made, { ...NEX, at: ago(1), type: "role.setPermission", roleId: id, module: "payments", level: "manage" }).errorCode).toBe("personRequired");
    const critical = must(made, { ...ANA, at: ago(1), type: "role.setPermission", roleId: id, module: "payments", level: "manage" });
    expect(rolesOf(critical, "tenant-nova").find((item) => item.id === id)).toMatchObject({ critical: true });
    expect(critical.audit.at(-1)).toMatchObject({ category: "permissions", actor: "ana" });
    expect(critical.audit.at(-1)?.detail).toContain("payments: none → manage (crítico)");
    expect(step(critical, { ...ANA, at: ago(0), type: "role.setPermission", roleId: id, module: "payments", level: "manage" }).errorCode).toBe("exists");
    expect(step(critical, { ...ANA, at: ago(0), type: "role.setPermission", roleId: role(critical, "administrator"), module: "crm", level: "read" }).errorCode).toBe("immutable");
    expect(isCriticalPermission("payments", "manage")).toBe(true);
    expect(isCriticalPermission("crm", "manage")).toBe(false);
    expect(isCriticalPermission("payments", "write")).toBe(false);
  });

  it("never lets a manager hand out or take away a critical role, and administrators are created only by an administrator", () => {
    const state = tiny();
    expect(invite(state, PABLO, "adm@mini.test", "administrator").errorCode).toBe("adminRequired");
    expect(invite(state, ANA, "adm@mini.test", "administrator").error).toBeUndefined();
    expect(step(state, { ...PABLO, at: ago(1), type: "user.setRole", userId: "carla", roleId: role(state, "administrator") }).errorCode).toBe("adminRequired");
    expect(user(must(state, { ...PABLO, at: ago(1), type: "user.setRole", userId: "carla", roleId: role(state, "marketing") }), "carla")?.roleId).toBe(role(state, "marketing"));
    const customCritical = must(state, { ...ANA, at: ago(3), type: "role.create", name: "Tesorero", permissions: { payments: "manage" } });
    expect(step(customCritical, { ...PABLO, at: ago(1), type: "user.setRole", userId: "carla", roleId: role(customCritical, "custom") }).errorCode).toBe("adminRequired");
    expect(authorityOf(state, "tenant-nova", "ana")).toBe("owner");
    expect(authorityOf(state, "tenant-nova", "pablo")).toBe("manager");
    expect(authorityOf(state, "tenant-nova", "carla")).toBe("none");
    expect(authorityOf(state, "tenant-vida", "ana")).toBe("none");
  });

  it("transfers the company only from the owner to another active administrator", () => {
    let state = tiny();
    expect(step(state, { ...ANA, at: ago(1), type: "owner.transfer", toUserId: "pablo" }).errorCode).toBe("invalid"); // not an administrator
    state = must(state, { ...ANA, at: ago(3), type: "invite.create", email: "adm@mini.test", name: "Otro Admin", roleId: role(state, "administrator") });
    state = must(state, { ...SYSTEM, at: ago(2), type: "invite.accept", invitationId: invitationOf(state, "adm") });
    expect(step(state, { ...PABLO, at: ago(1), type: "owner.transfer", toUserId: "adm" }).errorCode).toBe("adminRequired");
    expect(step(state, { ...NEX, at: ago(1), type: "owner.transfer", toUserId: "adm" }).errorCode).toBe("personRequired");
    const moved = must(state, { ...ANA, at: ago(1), type: "owner.transfer", toUserId: "adm" });
    expect(authorityOf(moved, "tenant-nova", "adm")).toBe("owner");
    expect(authorityOf(moved, "tenant-nova", "ana")).toBe("admin");
    expect(ACTION_LEVELS["org.owner"]).toBe(3);
  });
});

describe("Teams and Branches", () => {
  it("lets a manager create and update teams, with a specialty, goals and a responsible person, and keeps what changed", () => {
    let state = tiny();
    const departmentId = state.departments[0].id;
    expect(step(state, { ...CARLA, at: ago(2), type: "team.create", departmentId, name: "Mi equipo" }).errorCode).toBe("forbidden");
    state = must(state, { ...PABLO, at: ago(2), type: "team.create", departmentId, name: "Cuentas", specialty: "sales", goals: ["Cerrar 5 cuentas", "Responder rápido"], leadId: "carla" });
    expect(teamsOf(state, "tenant-nova")[0]).toMatchObject({ name: "Cuentas", specialty: "sales", leadId: "carla", goals: ["Cerrar 5 cuentas", "Responder rápido"] });
    const id = teamsOf(state, "tenant-nova")[0].id;
    const updated = must(state, { ...PABLO, at: ago(1), type: "team.update", teamId: id, name: "Cuentas clave", goals: ["Cerrar 8 cuentas"] });
    expect(updated.audit.at(-1)?.detail).toContain("Cuentas → Cuentas clave");
    expect(step(state, { ...PABLO, at: ago(1), type: "team.create", departmentId, name: "cuentas" }).errorCode).toBe("exists");
    expect(step(state, { ...PABLO, at: ago(1), type: "team.create", departmentId, name: "Otro", specialty: "magia" }).errorCode).toBe("invalid");
    expect(step(state, { ...PABLO, at: ago(1), type: "team.create", departmentId, name: "Otro", goals: ["a", "b", "c", "d", "e", "f"] }).errorCode).toBe("invalid");
    expect(step(state, { ...PABLO, at: ago(1), type: "team.create", departmentId, name: "Otro", leadId: "nadie" }).errorCode).toBe("invalid");
    expect(step(state, { ...PABLO, at: ago(1), type: "team.create", departmentId: "dp_99999", name: "Otro" }).errorCode).toBe("notFound");
  });

  it("assigns people and Workers to teams as one history that is never rewritten", () => {
    let state = tiny();
    state = must(state, { ...PABLO, at: ago(5), type: "team.create", departmentId: state.departments[0].id, name: "Uno" });
    state = must(state, { ...PABLO, at: ago(5), type: "team.create", departmentId: state.departments[0].id, name: "Dos" });
    const [one, two] = teamsOf(state, "tenant-nova").map((item) => item.id);
    state = must(state, { ...PABLO, at: ago(4), type: "membership.assign", subject: { kind: "user", id: "carla" }, teamId: one });
    state = must(state, { ...PABLO, at: ago(4), type: "membership.assign", subject: { kind: "worker", id: "sales" }, teamId: one });
    const before = JSON.stringify(state.assignments);
    state = must(state, { ...PABLO, at: ago(3), type: "membership.assign", subject: { kind: "user", id: "carla" }, teamId: two, note: "Cambio de enfoque" });
    state = must(state, { ...PABLO, at: ago(2), type: "membership.assign", subject: { kind: "user", id: "carla" }, teamId: null });
    expect(currentTeam(state, "tenant-nova", { kind: "user", id: "carla" })).toBeNull();
    expect(currentTeam(state, "tenant-nova", { kind: "worker", id: "sales" })).toBe(one);
    expect(assignmentHistory(state, "tenant-nova", { kind: "user", id: "carla" }).map((item) => item.teamId)).toEqual([one, two, null]);
    expect(JSON.stringify(state.assignments.slice(0, JSON.parse(before).length))).toBe(before); // the earlier records are exactly as they were
    expect(step(state, { ...PABLO, at: ago(1), type: "membership.assign", subject: { kind: "worker", id: "sales" }, teamId: one }).errorCode).toBe("exists");
    expect(step(state, { ...PABLO, at: ago(1), type: "membership.assign", subject: { kind: "worker", id: "inexistente" }, teamId: one }).errorCode).toBe("notFound");
    expect(step(state, { ...PABLO, at: ago(1), type: "membership.assign", subject: { kind: "user", id: "carla" }, teamId: "tm_99999" }).errorCode).toBe("notFound");
    expect(step(state, { ...CARLA, at: ago(1), type: "membership.assign", subject: { kind: "user", id: "diego" }, teamId: one }).errorCode).toBe("forbidden");
  });

  it("keeps branches with their own settings, teams, people and Workers, and deactivates instead of deleting", () => {
    let state = tiny();
    expect(step(state, { ...PABLO, at: ago(2), type: "branch.create", name: "Norte", city: "Alajuela" }).errorCode).toBe("adminRequired");
    state = must(state, { ...ANA, at: ago(2), type: "branch.create", name: "Norte", city: "Alajuela", settings: { workHours: "07:00-16:00", currency: "CRC" } });
    const norte = branchesOf(state, "tenant-nova")[1];
    expect(norte.settings).toEqual({ language: "es", timezone: "America/Costa_Rica", currency: "CRC", workHours: "07:00-16:00" });
    expect(step(state, { ...ANA, at: ago(2), type: "branch.create", name: "norte", city: "x" }).errorCode).toBe("exists");
    expect(step(state, { ...ANA, at: ago(2), type: "branch.create", name: "Otra", city: "x", settings: { timezone: "Marte/Olympus" as never } }).errorCode).toBe("invalid");
    expect(step(state, { ...ANA, at: ago(2), type: "branch.create", name: "Otra", city: "x", settings: { workHours: "todo el día" } }).errorCode).toBe("invalid");
    const updated = must(state, { ...ANA, at: ago(1), type: "branch.update", branchId: norte.id, settings: { language: "en" } });
    expect(updated.audit.at(-1)?.detail).toContain('"language":"es"');
    expect(updated.audit.at(-1)?.detail).toContain('"language":"en"');
    const inactive = must(updated, { ...ANA, at: ago(0), type: "branch.setStatus", branchId: norte.id, to: "inactive" });
    expect(branchesOf(inactive, "tenant-nova")).toHaveLength(2);
    expect(branchesOf(inactive, "tenant-nova")[1].status).toBe("inactive");
    expect(step(inactive, { ...NEX, at: ago(0), type: "branch.update", branchId: norte.id, name: "X" }).errorCode).toBe("personRequired");
    const tree = orgTree(demo, "tenant-nova", ENV.signals);
    expect(tree.branches[0].departments.flatMap((item) => item.teams).some((item) => item.workers.length > 0)).toBe(true);
    expect(tree.branches[1].departments[0].teams[0].people.map((item) => item.id).sort()).toEqual(["kira", "nora", "omar"]);
  });
});

describe("Constitution: NEX prepares, an authorization lets it move people, a person decides", () => {
  it("prepares invitations, teams and changes as proposals, and a person approves them (Level 1)", () => {
    const state = tiny();
    const propose = (payload: Parameters<typeof reduceOrg>[1] extends infer E ? E extends { type: "proposal.create"; payload: infer P } ? P : never : never) => step(state, { ...NEX, at: ago(2), type: "proposal.create", payload, reason: "Porque hace falta" });
    const invited = propose({ kind: "invite", email: "rosa@mini.test", name: "Rosa", roleId: role(state, "sales") });
    expect(invited.error).toBeUndefined();
    expect(proposalsOf(invited.state, "tenant-nova")[0]).toMatchObject({ status: "proposed", proposedBy: "worker:nex", reason: "Porque hace falta" });
    expect(usersOf(invited.state, "tenant-nova")).toHaveLength(4); // proposing changed nothing
    expect(propose({ kind: "team", departmentId: state.departments[0].id, name: "Nuevo", goals: ["Meta"] }).error).toBeUndefined();
    expect(propose({ kind: "move", userId: "carla", teamId: "tm_99999" }).errorCode).toBe("invalid");
    expect(propose({ kind: "invite", email: "x", name: "X", roleId: role(state, "sales") }).errorCode).toBe("invalid");
    expect(step(state, { ...NEX, at: ago(2), type: "invite.create", email: "rosa@mini.test", name: "Rosa", roleId: role(state, "sales") }).errorCode).toBe("personRequired"); // never directly
    const id = proposalsOf(invited.state, "tenant-nova")[0].id;
    expect(step(invited.state, { ...NEX, at: ago(1), type: "proposal.approve", proposalId: id }).errorCode).toBe("personRequired");
    expect(step(invited.state, { ...CARLA, at: ago(1), type: "proposal.approve", proposalId: id }).errorCode).toBe("forbidden");
    const approved = must(invited.state, { ...PABLO, at: ago(1), type: "proposal.approve", proposalId: id });
    expect(user(approved, "rosa")).toMatchObject({ status: "pending", invitedBy: "pablo" }); // applied AS the approver
    expect(approved.audit.at(-1)?.detail).toContain("propuesta de worker:nex");
    expect(step(approved, { ...PABLO, at: ago(0), type: "proposal.approve", proposalId: id }).errorCode).toBe("closed");
    const another = propose({ kind: "team", departmentId: state.departments[0].id, name: "Otro", goals: [] }).state;
    const rejected = must(another, { ...PABLO, at: ago(1), type: "proposal.reject", proposalId: proposalsOf(another, "tenant-nova").at(-1)?.id ?? "" });
    expect(proposalsOf(rejected, "tenant-nova").some((item) => item.status === "rejected")).toBe(true);
    expect([ACTION_LEVELS["org.draft"], ACTION_LEVELS["org.move.auto"], ACTION_LEVELS["org.admin"], ACTION_LEVELS["org.permissions"], ACTION_LEVELS["org.owner"]]).toEqual([1, 2, 3, 3, 3]);
  });

  it("never creates an administrator, never touches a critical role, the owner or a critical permission: not even as a proposal", () => {
    const state = tiny();
    const adminRole = role(state, "administrator");
    expect(step(state, { ...NEX, at: ago(2), type: "proposal.create", payload: { kind: "invite", email: "adm@mini.test", name: "Adm", roleId: adminRole } }).errorCode).toBe("criticalForHuman");
    expect(step(state, { ...NEX, at: ago(2), type: "proposal.create", payload: { kind: "roleChange", userId: "carla", roleId: adminRole } }).errorCode).toBe("criticalForHuman");
    expect(step(state, { ...NEX, at: ago(2), type: "proposal.create", payload: { kind: "roleChange", userId: "ana", roleId: role(state, "sales") } }).errorCode).toBe("criticalForHuman"); // the owner
    expect(step(state, { ...NEX, at: ago(2), type: "proposal.create", payload: { kind: "move", userId: "ana", teamId: "tm_1" } }).errorCode).toBe("invalid");
    for (const event of [
      { ...NEX, at: ago(1), type: "user.setRole", userId: "carla", roleId: adminRole }, { ...NEX, at: ago(1), type: "user.setStatus", userId: "carla", to: "disabled" },
      { ...NEX, at: ago(1), type: "role.setPermission", roleId: role(state, "sales"), module: "payments", level: "manage" }, { ...NEX, at: ago(1), type: "owner.transfer", toUserId: "pablo" },
      { ...NEX, at: ago(1), type: "authorization.grant" }, { ...NEX, at: ago(1), type: "branch.create", name: "Z", city: "Z" }, { ...NEX, at: ago(1), type: "team.create", departmentId: state.departments[0].id, name: "Z" },
    ] as OrgEvent[]) expect(step(state, event).errorCode, event.type).toBe("personRequired");
  });

  it("moves a person between teams automatically only with a vigente authorization, and only an active, non-critical person", () => {
    let state = tiny();
    const dep = state.departments[0].id;
    state = must(state, { ...PABLO, at: ago(5), type: "team.create", departmentId: dep, name: "Uno" });
    state = must(state, { ...PABLO, at: ago(5), type: "team.create", departmentId: dep, name: "Dos" });
    const [one, two] = teamsOf(state, "tenant-nova").map((item) => item.id);
    state = must(state, { ...PABLO, at: ago(4), type: "membership.assign", subject: { kind: "user", id: "carla" }, teamId: one });
    const move = (s: OrgState, userId = "carla", to: string | null = two, at = ago(1)) => step(s, { ...NEX, at, type: "membership.assign", subject: { kind: "user", id: userId }, teamId: to });
    expect(move(state).errorCode).toBe("needsAuthorization");
    const granted = must(state, { ...ANA, at: ago(3), type: "authorization.grant", maxPerDay: 1, expiresAt: ago(0, -24) });
    const moved = move(granted);
    expect(moved.error).toBeUndefined();
    expect(assignmentHistory(moved.state, "tenant-nova", { kind: "user", id: "carla" }).at(-1)).toMatchObject({ mode: "auto", by: "worker:nex", teamId: two });
    expect(moved.state.audit.at(-1)?.action).toBe("membership.auto");
    expect(move(moved.state, "diego", one).errorCode).toBe("needsAuthorization"); // the limit is one a day
    expect(move(moved.state, "diego", one, ago(0, -1)).error).toBeUndefined(); // a new day
    expect(move(granted, "carla", null).errorCode).toBe("personRequired"); // taking someone out of every team is a person's
    expect(move(granted, "ana", two).errorCode).toBe("notEligible"); // the owner
    expect(step(granted, { ...NEX, at: ago(1), type: "membership.assign", subject: { kind: "worker", id: "sales" }, teamId: two }).errorCode).toBe("personRequired"); // Workers are moved by people
    const suspended = must(granted, { ...ANA, at: ago(2), type: "user.setStatus", userId: "diego", to: "suspended" });
    expect(move(suspended, "diego", two).errorCode).toBe("notEligible");
    const revoked = must(granted, { ...ANA, at: ago(2), type: "authorization.revoke", grantId: grantsOf(granted, "tenant-nova")[0].id });
    expect(move(revoked).errorCode).toBe("needsAuthorization");
    expect(move(must(state, { ...ANA, at: ago(3), type: "authorization.grant", expiresAt: ago(2) })).errorCode).toBe("needsAuthorization"); // expired
    expect(step(state, { ...ANA, at: ago(3), type: "authorization.grant", maxPerDay: 0 }).errorCode).toBe("invalid");
    expect(step(granted, { ...LUCIA, at: ago(1), type: "authorization.revoke", grantId: grantsOf(granted, "tenant-nova")[0].id }).errorCode).toBe("notFound");
  });
});

describe("Workforce: people and AI Workers in one view, from KOE's data", () => {
  const rows = workforce(demo, "tenant-nova", ENV.signals, NOW);
  const row = (id: string, kind: "user" | "worker" = "user") => rows.find((item) => item.id === id && item.kind === kind);

  it("shows people and Workers together with status, specialty, team, workload, availability and estimated cost", () => {
    expect(rows.filter((item) => item.kind === "user")).toHaveLength(13);
    expect(rows.filter((item) => item.kind === "worker").map((item) => item.name).sort()).toEqual(["Analista de reportes", "Asistente comercial", "Cobranza", "Coordinador", "Seguimiento", "Tutor de cursos"]);
    expect(row("carla")).toMatchObject({ teamName: "Ventas Corporativas", branchName: "Sede Central", status: "active", specialty: "sales", roleName: "Ventas", openItems: 24, availability: "busy" });
    expect(row("carla")?.load).toBeCloseTo(2, 5);
    expect(row("pablo")?.estimatedCostMicros).toBe(PERSON_MONTHLY_COST_MICROS.manager);
    expect(row("sales", "worker")).toMatchObject({ teamName: "Ventas Corporativas", specialty: "sales", availability: "available", status: "active" });
    expect(row("coordinator", "worker")).toMatchObject({ teamName: "Sin equipo" });
  });

  it("decides availability from the status, the last access and the load", () => {
    expect(row("jorge")?.availability).toBe("away"); // pending
    expect(row("kira")?.availability).toBe("paused"); // suspended
    expect(row("leo")?.availability).toBe("disabled");
    expect(row("maria")?.availability).toBe("away"); // nobody has seen her in weeks
    expect(row("diego")?.availability).toBe("available");
    expect(row("tutor", "worker")?.availability).toBe("disabled");
    expect(row("kira")?.estimatedCostMicros).toBe(0); // a suspended person is not an estimated cost
  });

  it("takes a Worker's cost and activity from KOE's own runs, and counts a Worker's day against its daily limit", () => {
    const sales = ENV.signals.executions.filter((item) => item.tenantId === "tenant-nova" && item.workerId === "sales");
    expect(row("sales", "worker")?.estimatedCostMicros).toBe(sales.filter((item) => Date.parse(NOW) - Date.parse(item.at) <= 30 * 86_400_000).reduce((sum, item) => sum + item.costMicros, 0));
    const busyEnv = signals({ workers: [{ id: "sales", name: "Ventas", specialty: "sales" }], instances: [{ tenantId: "tenant-nova", definitionId: "sales", status: "active", maxRunsPerDay: 10 }], executions: Array.from({ length: 9 }, (_, i) => ({ id: `e${i}`, tenantId: "tenant-nova", at: NOW, source: "koe" as const, workerId: "sales", workerName: "Ventas", specialty: "sales", fallback: false, outcome: "success" as const, costMicros: 100 })) });
    expect(workforce(demo, "tenant-nova", busyEnv, NOW).find((item) => item.id === "sales" && item.kind === "worker")).toMatchObject({ availability: "busy", openItems: 9 });
    expect(workforce(demo, "tenant-nova", signals({ instances: [{ tenantId: "tenant-nova", definitionId: "sales", status: "paused", maxRunsPerDay: 10 }], workers: [{ id: "sales", name: "Ventas", specialty: "sales" }] }), NOW).find((item) => item.kind === "worker")?.availability).toBe("paused");
    expect(workforce(demo, "tenant-nova", signals(), NOW).filter((item) => item.kind === "worker")).toEqual([]);
    expect(workforce(demo, "tenant-nadie", ENV.signals, NOW)).toEqual([]);
  });
});

describe("recommendations: all of them come from KOE, and from one place", () => {
  const found = recommendations(demo, "tenant-nova", ENV.signals, NOW);
  const byKind = (kind: string) => found.filter((item) => item.kind === kind);

  it("says an overloaded team, an underused Worker, a Worker without a team and a user without activity, each with its reason", () => {
    expect(byKind("overloadedTeam")).toHaveLength(1);
    expect(byKind("overloadedTeam")[0]).toMatchObject({ severity: "high", subject: { kind: "team", id: team(demo, "Ventas Corporativas") } });
    expect(byKind("overloadedTeam")[0].reason).toContain("125 %");
    expect(byKind("overloadedTeam")[0].suggestedMove).toMatchObject({ toTeamId: team(demo, "Ventas Corporativas") });
    expect(byKind("underusedWorker").map((item) => item.subject.id)).toEqual(["reporter"]);
    expect(byKind("unassignedWorker").map((item) => item.subject.id)).toEqual(["coordinator"]);
    expect(byKind("inactiveUser").map((item) => item.subject.id)).toEqual(["maria"]);
    expect(byKind("inactiveUser")[0].reason).toContain("55 días");
    expect(found[0].severity).toBe("high"); // most severe first
    expect(found.every((item) => item.text.length > 10 && item.reason.length > 10 && item.id.includes(":"))).toBe(true);
  });

  it("flags a department that is a bottleneck while another in the same branch has room", () => {
    let state = tiny();
    const branch = state.branches[0].id;
    state = must(state, { ...ANA, at: ago(30), type: "department.create", branchId: branch, name: "Soporte" });
    const [ventas, soporte] = state.departments.map((item) => item.id);
    state = must(state, { ...PABLO, at: ago(29), type: "team.create", departmentId: ventas, name: "A" });
    state = must(state, { ...PABLO, at: ago(29), type: "team.create", departmentId: soporte, name: "B" });
    const [a, b] = teamsOf(state, "tenant-nova").map((item) => item.id);
    state = must(state, { ...PABLO, at: ago(28), type: "membership.assign", subject: { kind: "user", id: "carla" }, teamId: a });
    state = must(state, { ...PABLO, at: ago(28), type: "membership.assign", subject: { kind: "user", id: "diego" }, teamId: b });
    state = must(state, { ...PABLO, at: ago(28), type: "membership.assign", subject: { kind: "user", id: "pablo" }, teamId: b });
    const sig = signals({ activity: [{ tenantId: "tenant-nova", userId: "carla", openItems: CAPACITY_PER_PERSON * 2 }, { tenantId: "tenant-nova", userId: "diego", openItems: 1 }, { tenantId: "tenant-nova", userId: "pablo", openItems: 1 }] });
    const result = recommendations(state, "tenant-nova", sig, NOW);
    const bottleneck = result.find((item) => item.kind === "bottleneckDepartment");
    expect(bottleneck).toMatchObject({ severity: "high", subject: { kind: "department", id: ventas } });
    expect(bottleneck?.reason).toContain("«Soporte»");
    expect(result.find((item) => item.kind === "overloadedTeam")).toMatchObject({ severity: "critical", suggestedMove: { toTeamId: a, fromTeamId: b } });
    expect(recommendations(state, "tenant-nova", signals(), NOW).filter((item) => item.kind === "overloadedTeam")).toEqual([]);
  });

  it("holds the rules in koe-org.ts alone, and the screens only format", () => {
    const owners = readdirSync(__dirname).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).filter((name) => /CAPACITY_PER_PERSON|OVERLOAD_RATIO|UNDERUSED_UTILIZATION|INACTIVE_DAYS|SPARE_RATIO/.test(readFileSync(join(__dirname, name), "utf8")));
    expect(owners).toEqual(["koe-org.ts"]);
    const dir = join(__dirname, "../../../app/(app)/platform/_components");
    const screens = readdirSync(dir).filter((name) => /^Org.*\.tsx$/.test(name) && !name.endsWith(".test.tsx"));
    expect(screens.length).toBeGreaterThanOrEqual(3);
    for (const name of screens) expect(readFileSync(join(dir, name), "utf8"), name).not.toMatch(/\.reduce\(|Math\.round|CAPACITY_PER_PERSON/);
  });

  it("records every KOE analysis with the Worker and the model it used, and keeps them all", () => {
    expect(analysesOf(demo, "tenant-nova")).toHaveLength(1);
    expect(analysesOf(demo, "tenant-nova")[0]).toMatchObject({ workerId: "reporter", workerName: "Analista de reportes", model: { label: expect.any(String) } });
    expect(analysesOf(demo, "tenant-nova")[0].recommendationIds).toEqual(found.map((item) => item.id).filter((id) => analysesOf(demo, "tenant-nova")[0].recommendationIds.includes(id)));
    const again = must(demo, { ...ANA, at: ago(0, 1), type: "org.analyze" });
    expect(analysesOf(again, "tenant-nova")).toHaveLength(2);
    expect(analysesOf(again, "tenant-nova")[0]).toEqual(analysesOf(demo, "tenant-nova")[0]);
    expect(analysesOf(again, "tenant-nova")[1].counts).toMatchObject({ overloadedTeam: 1, inactiveUser: 1 });
    const noModels: OrgEnv = { ...ENV, models: BASE_MODELS.map((model) => ({ ...model, enabled: false })) };
    const refused = step(demo, { ...ANA, at: ago(0, 1), type: "org.analyze" }, noModels);
    expect(refused.errorCode).toBe("noWorker");
    expect(refused.state.analyses).toHaveLength(analysesOf(demo, "tenant-nova").length + analysesOf(demo, "tenant-vida").length);
  });
});

describe("Identity Center: profile, preferences, language, time zone, notifications, security, sessions, devices (architecture)", () => {
  it("lets a person change their own profile, preferences and security flag, and an administrator the profile", () => {
    const state = tiny();
    const updated = must(state, { ...CARLA, at: ago(1), type: "profile.update", userId: "carla", name: "Carla J.", language: "en", timezone: "America/New_York" });
    expect(user(updated, "carla")).toMatchObject({ name: "Carla J.", language: "en", timezone: "America/New_York" });
    expect(updated.audit.at(-1)).toMatchObject({ category: "identity", actor: "carla" });
    expect(user(must(state, { ...ANA, at: ago(1), type: "profile.update", userId: "carla", language: "pt" }), "carla")?.language).toBe("pt");
    expect(step(state, { ...PABLO, at: ago(1), type: "profile.update", userId: "carla", language: "pt" }).errorCode).toBe("notYourOwn");
    expect(step(state, { ...NEX, at: ago(1), type: "profile.update", userId: "carla", language: "pt" }).errorCode).toBe("personRequired");
    expect(step(state, { ...CARLA, at: ago(1), type: "profile.update", userId: "carla", language: "xx" as never }).errorCode).toBe("invalid");
    expect(step(state, { ...CARLA, at: ago(1), type: "profile.update", userId: "carla", timezone: "Mordor/Gondor" as never }).errorCode).toBe("invalid");
    const prefs = must(state, { ...CARLA, at: ago(1), type: "preferences.set", userId: "carla", email: false, inApp: true, digest: "weekly" });
    expect(user(prefs, "carla")?.preferences.notifications).toEqual({ email: false, inApp: true, digest: "weekly" });
    expect(step(state, { ...ANA, at: ago(1), type: "preferences.set", userId: "carla", email: true, inApp: true, digest: "off" }).errorCode).toBe("notYourOwn"); // not even an administrator
    expect(step(state, { ...CARLA, at: ago(1), type: "preferences.set", userId: "carla", email: true, inApp: true, digest: "hourly" as never }).errorCode).toBe("invalid");
    expect(user(must(state, { ...CARLA, at: ago(1), type: "security.set", userId: "carla", mfaRequested: true }), "carla")?.security.mfaRequested).toBe(true);
    expect(step(state, { ...ANA, at: ago(1), type: "security.set", userId: "carla", mfaRequested: true }).errorCode).toBe("notYourOwn");
  });

  it("records sessions and devices through the platform, and lets the person or an administrator revoke a session", () => {
    let state = tiny();
    expect(step(state, { ...CARLA, at: ago(2), type: "session.record", userId: "carla", deviceLabel: "Portátil", location: "San José" }).errorCode).toBe("systemOnly");
    state = must(state, { ...SYSTEM, at: ago(2), type: "session.record", userId: "carla", deviceLabel: "Portátil de Carla", location: "San José" });
    state = must(state, { ...SYSTEM, at: ago(1), type: "session.record", userId: "carla", deviceLabel: "Portátil de Carla", location: "San José" });
    const identity = identityOf(state, "tenant-nova", "carla");
    expect(identity?.devices).toHaveLength(1); // the same device is not duplicated
    expect(identity?.sessions).toHaveLength(2);
    expect(user(state, "carla")?.lastAccessAt).toBe(ago(1));
    const [first] = identity?.sessions ?? [];
    expect(step(state, { ...PABLO, at: ago(0), type: "session.revoke", sessionId: first.id }).errorCode).toBe("notYourOwn");
    const revoked = must(state, { ...CARLA, at: ago(0), type: "session.revoke", sessionId: first.id });
    expect(identityOf(revoked, "tenant-nova", "carla")?.sessions[0]).toMatchObject({ revokedBy: "carla" });
    expect(step(revoked, { ...ANA, at: ago(0), type: "session.revoke", sessionId: first.id }).errorCode).toBe("closed");
    expect(user(must(state, { ...ANA, at: ago(0), type: "session.revoke", sessionId: first.id }), "carla")).toBeDefined(); // an administrator may too
    const device = identity?.devices[0];
    expect(step(state, { ...PABLO, at: ago(0), type: "device.trust", deviceId: device?.id ?? "", trusted: true }).errorCode).toBe("notYourOwn");
    expect(identityOf(must(state, { ...CARLA, at: ago(0), type: "device.trust", deviceId: device?.id ?? "", trusted: true }), "tenant-nova", "carla")?.devices[0].trusted).toBe(true);
    expect(identityOf(state, "tenant-nova", "nadie")).toBeNull();
  });
});

describe("Audit: invitations, role changes, permission changes, teams, branches, Workers; the history is never deleted", () => {
  it("records every kind of change with who, what and when, and only ever grows", () => {
    const categories = new Set(auditOf(demo, "tenant-nova").map((item) => item.category));
    for (const category of ["invitations", "roles", "permissions", "teams", "branches", "workers", "users", "identity"]) expect(categories.has(category as never), category).toBe(true);
    expect(auditOf(demo, "tenant-nova", "invitations").length).toBeGreaterThan(20);
    expect(auditOf(demo, "tenant-nova", "workers").every((item) => item.detail?.startsWith("worker:"))).toBe(true);
    expect(auditOf(demo, "tenant-nova").every((item) => item.at && item.actor && item.action)).toBe(true);
    const before = demo.audit.length;
    const after = must(demo, { ...ANA, at: ago(0), type: "user.setStatus", userId: "nora", to: "suspended" });
    expect(after.audit).toHaveLength(before + 1);
    expect(JSON.stringify(after.audit.slice(0, before))).toBe(JSON.stringify(demo.audit)); // nothing before was touched
    const refused = step(demo, { ...CARLA, at: ago(0), type: "user.setStatus", userId: "nora", to: "suspended" });
    expect(refused.state.audit).toHaveLength(before); // a refusal writes nothing
  });
});

describe("one company never shares anything with another", () => {
  it("keeps users, Workers, roles, teams and settings apart, with its own owner", () => {
    const vida = orgDashboard(demo, "tenant-vida", ENV.signals, NOW);
    expect(vida).toMatchObject({ orgName: "Clínica Vida", ownerId: "lucia", branches: { total: 1 }, teams: 1, users: { total: 2, active: 2 }, roles: { builtin: 9, custom: 0 } });
    expect(usersOf(demo, "tenant-vida").map((item) => item.id).sort()).toEqual(["lucia", "sara"]);
    expect(JSON.stringify(workforce(demo, "tenant-vida", ENV.signals, NOW))).not.toMatch(/Carla|Pablo|Asistente comercial/);
    expect(orgTree(demo, "tenant-vida", ENV.signals).branches.map((item) => item.branch.name)).toEqual(["Clínica Central"]);
    expect(recommendations(demo, "tenant-vida", ENV.signals, NOW).every((item) => !item.text.includes("Ventas"))).toBe(true);
    const sameUserId = must(demo, { tenantId: "tenant-vida", actor: "lucia", at: ago(0), type: "invite.create", email: "carla@vida.test", name: "Carla de Vida", roleId: role(demo, "support", "tenant-vida") });
    expect(user(sameUserId, "carla", "tenant-vida")).toBeDefined(); // the same handle in another company is another person
    expect(user(sameUserId, "carla", "tenant-nova")?.name).toBe("Carla Jiménez");
  });

  it("is unchanged by any amount of another company's work", () => {
    const before = JSON.stringify([orgDashboard(demo, "tenant-vida", ENV.signals, NOW), workforce(demo, "tenant-vida", ENV.signals, NOW), recommendations(demo, "tenant-vida", ENV.signals, NOW)]);
    let noisy = demo;
    for (let n = 0; n < 5; n += 1) noisy = must(noisy, { ...ANA, at: ago(0, n), type: "invite.create", email: `ruido${n}@nova.test`, name: `Ruido ${n}`, roleId: role(noisy, "sales") });
    expect(JSON.stringify([orgDashboard(noisy, "tenant-vida", ENV.signals, NOW), workforce(noisy, "tenant-vida", ENV.signals, NOW), recommendations(noisy, "tenant-vida", ENV.signals, NOW)])).toBe(before);
  });

  it("refuses every change on another company's records, and a person of one company has no authority in the other", () => {
    const events: OrgEvent[] = [
      { ...LUCIA, at: ago(0), type: "user.setStatus", userId: "carla", to: "suspended" }, { ...LUCIA, at: ago(0), type: "user.setRole", userId: "carla", roleId: role(demo, "support", "tenant-vida") },
      { ...LUCIA, at: ago(0), type: "team.update", teamId: team(demo, "Ventas Corporativas"), name: "X" }, { ...LUCIA, at: ago(0), type: "membership.assign", subject: { kind: "user", id: "carla" }, teamId: null },
      { ...LUCIA, at: ago(0), type: "role.setPermission", roleId: role(demo, "sales"), module: "crm", level: "none" }, { ...LUCIA, at: ago(0), type: "branch.update", branchId: demo.branches[0].id, name: "X" },
      { ...LUCIA, at: ago(0), type: "invite.revoke", invitationId: invitationOf(demo, "jorge") }, { ...LUCIA, at: ago(0), type: "proposal.approve", proposalId: demo.proposals[1].id },
      { ...LUCIA, at: ago(0), type: "session.revoke", sessionId: demo.sessions[0].id }, { ...LUCIA, at: ago(0), type: "device.trust", deviceId: demo.devices[0].id, trusted: true },
      { tenantId: "tenant-vida", actor: "system", at: ago(0), type: "invite.accept", invitationId: invitationOf(demo, "jorge") },
    ];
    for (const event of events) expect(["notYours", "notFound"], event.type).toContain(step(demo, event).errorCode);
    expect(authorityOf(demo, "tenant-nova", "lucia")).toBe("none");
    expect(step(demo, { ...SYSTEM, at: ago(0), type: "org.create", name: "Otra", ownerId: "x", ownerName: "X", ownerEmail: "x@x.test" }).errorCode).toBe("exists");
    expect(step(demo, { ...ANA, at: ago(0), type: "org.create", name: "Otra", ownerId: "x", ownerName: "X", ownerEmail: "x@x.test" }).errorCode).toBe("systemOnly");
  });
});

describe("the future is declared and not built", () => {
  it("lists SSO, Azure AD, Google Workspace, Microsoft Entra, LDAP, SCIM, Okta and Auth0, all through KOE and unbuilt", () => {
    expect(FUTURE_IDENTITY.map((item) => item.id)).toEqual(["sso", "azureAd", "googleWorkspace", "entra", "ldap", "scim", "okta", "auth0"]);
    for (const item of FUTURE_IDENTITY) expect(item).toMatchObject({ status: "notBuilt", goesThrough: "KOE", direct: false });
    const files = readdirSync(__dirname).filter((name) => /^(org-|koe-org)/.test(name) && !name.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const name of files) {
      const code = readFileSync(join(__dirname, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, name).not.toMatch(/fetch\(|XMLHttpRequest|process\.env|import\(|lib\/ai|new WebSocket|openai|anthropic|gemini|mistral/i);
      expect(code, name).not.toMatch(/function\s+(login|signIn|authenticate|syncDirectory|provision)/i);
    }
  });
});

describe("language", () => {
  it("has a message for every error code and Spanish labels", () => {
    for (const code of ERROR_CODES) expect(message(code, { detail: "x" }), code).not.toMatch(/\{\w+\}/);
    expect(label("module", "developer")).toBe("Developer Center");
    expect(label("level", "manage")).toBe("Administración");
    expect(label("availability", "busy")).toBe("Ocupado");
    expect(label("tabs", "workforce")).toBe("Fuerza de trabajo");
    expect(label("auditCategory", "roles")).toBe("Cambios de rol");
    expect(message("exists", { detail: "la empresa" })).toBe("Ya existe: la empresa.");
  });
});
