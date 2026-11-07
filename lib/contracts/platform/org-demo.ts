// Sample data for the local simulation of the Organization Center. Fictional companies and people. Built by applying events through the
// same reducer a real adapter will use, so loading it also proves the rules hold together. The workload and the Workers' activity come
// from KOE's own sample records (Worker runs, installed Workers) and from the CRM and Communications samples.

import { demoCommsOk } from "./comms-demo";
import { DEMO_NOW, demoCrmOk } from "./crm-demo";
import { simulateExecutions } from "./insights-demo";
import { demoKoeOk } from "./koe-demo";
import { executionsFromKoe } from "./koe-ledger";
import { activityFrom, signalsFrom } from "./koe-org";
import { DEFAULT_KOE_ENV, newOrgState, reduceOrg, type OrgEnv, type OrgEvent, type OrgState } from "./org-center";

export { DEMO_NOW };
export const DEMO_TENANTS = [
  { id: "tenant-nova", name: "Nova Marketing Studio" },
  { id: "tenant-vida", name: "Clínica Vida" },
] as const;

export const DEMO_PERSONAS = [
  { id: "nova-ana", label: "Nova · Ana (propietaria)", tenantId: "tenant-nova", actor: "ana" },
  { id: "nova-pablo", label: "Nova · Pablo (gerente)", tenantId: "tenant-nova", actor: "pablo" },
  { id: "nova-carla", label: "Nova · Carla (ventas)", tenantId: "tenant-nova", actor: "carla" },
  { id: "vida-lucia", label: "Clínica Vida · Lucía (propietaria)", tenantId: "tenant-vida", actor: "lucia" },
  { id: "nex", label: "NEX (IA) en Nova", tenantId: "tenant-nova", actor: "worker:nex" },
] as const;

const ago = (days: number, hours = 0) => new Date(Date.parse(DEMO_NOW) - days * 86_400_000 - hours * 3_600_000).toISOString();

export type OrgSource = { state: OrgState; env: OrgEnv; errors: string[] };

export function demoOrgSource(): OrgSource {
  const koe = demoKoeOk();
  const crm = demoCrmOk();
  const comms = demoCommsOk().state;
  const executions = [...executionsFromKoe(koe), ...simulateExecutions("tenant-nova", 1, 20_261_001), ...simulateExecutions("tenant-vida", 0.45, 20_261_002)];
  // what each person has open: the CRM and the Communications Hub say it for those who use them; the rest of the sample sets it by hand
  const manual = [
    { tenantId: "tenant-nova", userId: "carla", openItems: 24, lastActivityAt: ago(0, 3) }, { tenantId: "tenant-nova", userId: "maria", openItems: 16 },
    { tenantId: "tenant-nova", userId: "nora", openItems: 2, lastActivityAt: ago(0, 6) }, { tenantId: "tenant-nova", userId: "omar", openItems: 3, lastActivityAt: ago(1) },
    { tenantId: "tenant-nova", userId: "diego", openItems: 5, lastActivityAt: ago(0, 2) }, { tenantId: "tenant-nova", userId: "elena", openItems: 2, lastActivityAt: ago(0, 5) },
    { tenantId: "tenant-nova", userId: "hector", openItems: 3, lastActivityAt: ago(0, 8) }, { tenantId: "tenant-nova", userId: "irene", openItems: 1, lastActivityAt: ago(1) },
  ];
  const activity = [...activityFrom(crm, comms, "tenant-nova"), ...manual, ...activityFrom(crm, comms, "tenant-vida")];
  const env: OrgEnv = { ...DEFAULT_KOE_ENV, signals: signalsFrom(koe, executions, activity) };

  const errors: string[] = [];
  let state = newOrgState();
  const send = (event: OrgEvent) => {
    const result = reduceOrg(state, event, env);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    state = result.state;
  };
  const system = { tenantId: "tenant-nova", actor: "system" };
  const ana = { tenantId: "tenant-nova", actor: "ana" };
  const pablo = { tenantId: "tenant-nova", actor: "pablo" };
  const nex = { tenantId: "tenant-nova", actor: "worker:nex" };
  const role = (key: string, tenantId = "tenant-nova") => state.roles.find((item) => item.key === key && item.tenantId === tenantId)?.id ?? "";
  const branch = (name: string) => state.branches.find((item) => item.name === name && item.tenantId === "tenant-nova")?.id ?? "";
  const dept = (name: string) => state.departments.find((item) => item.name === name && item.tenantId === "tenant-nova")?.id ?? "";
  const team = (name: string) => state.teams.find((item) => item.name === name && item.tenantId === "tenant-nova")?.id ?? "";
  const invitation = (userId: string) => state.invitations.find((item) => item.userId === userId && item.tenantId === "tenant-nova")?.id ?? "";

  send({ ...system, at: ago(60), type: "org.create", name: "Nova Marketing Studio", ownerId: "ana", ownerName: "Ana Rojas", ownerEmail: "ana@nova.test" });
  send({ ...ana, at: ago(59), type: "branch.create", name: "Sede Central", city: "San José" });
  send({ ...ana, at: ago(59), type: "branch.create", name: "Sucursal Norte", city: "Alajuela", settings: { workHours: "07:00-16:00" } });
  for (const [name, b] of [["Comercial", "Sede Central"], ["Soporte", "Sede Central"], ["Administración", "Sede Central"], ["Comercial Norte", "Sucursal Norte"]] as const) send({ ...ana, at: ago(58), type: "department.create", branchId: branch(b), name });
  send({ ...ana, at: ago(57), type: "role.create", name: "Analista", permissions: { insights: "manage", crm: "read", communications: "read" } });

  // people: invited by the owner, accepted through the platform; one still pending, one suspended, one disabled
  const people: [string, string, string, number][] = [["pablo", "Pablo Mora", "manager", 50], ["carla", "Carla Jiménez", "sales", 45], ["diego", "Diego Solano", "support", 45], ["elena", "Elena Vargas", "finance", 40], ["hector", "Héctor Pérez", "marketing", 40],
    ["irene", "Irene Castro", "hr", 35], ["jorge", "Jorge Ureña", "readonly", 1], ["kira", "Kira Matamoros", "sales", 30], ["leo", "Leo Salas", "support", 30], ["maria", "María Quesada", "sales", 55], ["nora", "Nora Campos", "sales", 20]];
  for (const [id, name, key, days] of people) send({ ...ana, at: ago(days + 1), type: "invite.create", email: `${id}@nova.test`, name, roleId: role(key), branchId: branch(id === "nora" ? "Sucursal Norte" : "Sede Central") });
  for (const [id, , , days] of people) if (id !== "jorge") send({ ...system, at: ago(days), type: "invite.accept", invitationId: invitation(id) });
  send({ ...ana, at: ago(10), type: "user.setStatus", userId: "kira", to: "suspended" });
  send({ ...ana, at: ago(9), type: "user.setStatus", userId: "leo", to: "disabled" });
  send({ ...pablo, at: ago(8), type: "user.setRole", userId: "irene", roleId: role("supervisor") }); // a manager changes a non-critical role
  for (const [id, hours] of [["ana", 1], ["pablo", 2], ["carla", 3], ["diego", 2], ["elena", 5], ["hector", 8], ["irene", 24], ["nora", 6]] as const) send({ ...system, at: ago(0, hours), type: "access.record", userId: id });

  // a Worker proposal of NEX that a manager approved: Omar joins
  send({ ...nex, at: ago(15), type: "proposal.create", payload: { kind: "invite", email: "omar@nova.test", name: "Omar Brenes", roleId: role("sales") }, reason: "Ventas Norte necesita una persona más." });
  send({ ...pablo, at: ago(14), type: "proposal.approve", proposalId: state.proposals[0]?.id ?? "" });
  send({ ...system, at: ago(13), type: "invite.accept", invitationId: invitation("omar") });
  send({ ...system, at: ago(1), type: "access.record", userId: "omar" });

  // teams, people and Workers: a Worker belongs to a team exactly like a person
  const makeTeam = (name: string, department: string, specialty: string, goals: string[], leadId?: string) => send({ ...pablo, at: ago(40), type: "team.create", departmentId: dept(department), name, specialty, goals, leadId });
  makeTeam("Ventas Corporativas", "Comercial", "sales", ["Cerrar 8 cuentas este trimestre", "Responder prospectos en menos de 2 horas"], "pablo");
  makeTeam("Marketing", "Comercial", "sales", ["Publicar 12 contenidos al mes"], "hector");
  makeTeam("Atención al Cliente", "Soporte", "followup", ["Primera respuesta en menos de 1 hora"], "diego");
  makeTeam("Finanzas", "Administración", "collections", ["Cobrar el 95 % a tiempo"], "elena");
  makeTeam("Analítica", "Administración", "analysis", ["Un reporte ejecutivo por semana"]);
  makeTeam("Ventas Norte", "Comercial Norte", "sales", ["Abrir 20 prospectos nuevos"]);
  for (const [id, name] of [["pablo", "Ventas Corporativas"], ["carla", "Ventas Corporativas"], ["maria", "Ventas Corporativas"], ["hector", "Marketing"], ["diego", "Atención al Cliente"], ["irene", "Atención al Cliente"], ["elena", "Finanzas"], ["nora", "Ventas Norte"], ["omar", "Ventas Norte"], ["kira", "Ventas Norte"]] as const) send({ ...pablo, at: ago(39), type: "membership.assign", subject: { kind: "user", id }, teamId: team(name) });
  for (const [id, name] of [["sales", "Ventas Corporativas"], ["followup", "Atención al Cliente"], ["collections", "Finanzas"], ["reporter", "Analítica"]] as const) send({ ...pablo, at: ago(38), type: "membership.assign", subject: { kind: "worker", id }, teamId: team(name) });

  // Level 2: with the owner's authorization NEX moves Irene (an active, non-critical person) to Finanzas
  send({ ...ana, at: ago(0, 12), type: "authorization.grant", maxPerDay: 3 });
  send({ ...nex, at: ago(0, 11), type: "membership.assign", subject: { kind: "user", id: "irene" }, teamId: team("Finanzas"), note: "Finanzas necesita apoyo y Atención tiene capacidad" });

  // Level 1: more proposals, waiting for a person
  send({ ...nex, at: ago(0, 10), type: "proposal.create", payload: { kind: "invite", email: "rosa@nova.test", name: "Rosa Mena", roleId: role("sales"), teamId: team("Ventas Norte") }, reason: "Cubrir la demanda de la sucursal Norte." });
  send({ ...nex, at: ago(0, 10), type: "proposal.create", payload: { kind: "move", userId: "nora", teamId: team("Ventas Corporativas") }, reason: "Ventas Corporativas está sobrecargado y Ventas Norte tiene capacidad." });
  send({ ...nex, at: ago(0, 9), type: "proposal.create", payload: { kind: "team", departmentId: dept("Soporte"), name: "Soporte Nocturno", specialty: "followup", goals: ["Cubrir el horario de 6 p. m. a 10 p. m."] }, reason: "Hay mensajes sin respuesta por la noche." });
  send({ ...nex, at: ago(0, 8), type: "org.analyze" });

  // identity: sessions and devices reported by the platform
  send({ ...system, at: ago(0, 1), type: "session.record", userId: "ana", deviceLabel: "MacBook de Ana", location: "San José, Costa Rica" });
  send({ ...system, at: ago(0, 3), type: "session.record", userId: "ana", deviceLabel: "iPhone de Ana", location: "San José, Costa Rica" });
  send({ ...system, at: ago(0, 2), type: "session.record", userId: "pablo", deviceLabel: "Portátil de Pablo", location: "Heredia, Costa Rica" });
  send({ ...ana, at: ago(0, 1), type: "device.trust", deviceId: state.devices[0]?.id ?? "", trusted: true });
  send({ ...ana, at: ago(0, 1), type: "preferences.set", userId: "ana", email: true, inApp: true, digest: "weekly" });
  send({ ...ana, at: ago(0, 1), type: "security.set", userId: "ana", mfaRequested: true });

  // a second company: its own owner, branch, roles and team, never mixed with Nova's
  const vida = { tenantId: "tenant-vida", actor: "system" };
  const lucia = { tenantId: "tenant-vida", actor: "lucia" };
  send({ ...vida, at: ago(30), type: "org.create", name: "Clínica Vida", ownerId: "lucia", ownerName: "Lucía Pineda", ownerEmail: "lucia@vida.test" });
  send({ ...lucia, at: ago(29), type: "branch.create", name: "Clínica Central", city: "Escazú" });
  send({ ...lucia, at: ago(29), type: "department.create", branchId: state.branches.find((item) => item.tenantId === "tenant-vida")?.id ?? "", name: "Atención" });
  send({ ...lucia, at: ago(28), type: "team.create", departmentId: state.departments.find((item) => item.tenantId === "tenant-vida")?.id ?? "", name: "Recepción", specialty: "followup", goals: ["Confirmar todas las citas"] });
  send({ ...lucia, at: ago(27), type: "invite.create", email: "sara@vida.test", name: "Sara Cordero", roleId: role("support", "tenant-vida"), teamId: state.teams.find((item) => item.tenantId === "tenant-vida")?.id });
  send({ ...vida, at: ago(26), type: "invite.accept", invitationId: state.invitations.find((item) => item.tenantId === "tenant-vida")?.id ?? "" });
  send({ ...vida, at: ago(0, 4), type: "access.record", userId: "sara" });
  return { state, env, errors };
}

export const demoOrgOk = (): OrgSource => {
  const source = demoOrgSource();
  if (source.errors.length) throw new Error(source.errors.join("; "));
  return source;
};
