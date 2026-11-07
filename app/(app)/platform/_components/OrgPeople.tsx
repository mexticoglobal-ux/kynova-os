"use client";

import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { hiddenNote, latest } from "@/lib/contracts/platform/display";
import { LANGUAGES, LEVELS, MODULES, TIMEZONES, departmentsOf, invitationsOf, rolesOf, teamsOf, usersOf, type Level, type OrgModule } from "@/lib/contracts/platform/org-center";
import { label } from "@/lib/contracts/platform/org-messages";
import { assignmentHistory, currentAssignments, membersOf, orgTree, permissionMatrix } from "@/lib/contracts/platform/koe-org";
import { SPECIALTIES } from "@/lib/contracts/platform/koe-registry";
import { Section, num } from "./InsightsCharts";
import type { OrgTabProps } from "./OrgCenter";

const STATUS_TONE: Record<string, BadgeTone> = { pending: "warning", active: "success", suspended: "warning", disabled: "neutral" };
const inputClass = "w-full rounded-xl border border-line bg-raised px-3 py-1.5 text-sm text-ink";
const when = (iso: string) => iso.slice(0, 16).replace("T", " ");
const who = (actor: string) => (actor.startsWith("worker:") ? "NEX (IA)" : actor === "system" ? "Plataforma" : actor);

// ---------------------------------------------------------------- users
export function UsersTab({ state, persona, send, sendAsPlatform }: OrgTabProps) {
  const users = usersOf(state, persona.tenantId);
  const roles = rolesOf(state, persona.tenantId);
  const teams = teamsOf(state, persona.tenantId);
  const invitations = invitationsOf(state, persona.tenantId);
  const current = currentAssignments(state, persona.tenantId);
  const [form, setForm] = useState({ name: "", email: "", roleId: "", teamId: "" });
  const roleName = (id: string) => roles.find((item) => item.id === id)?.name ?? "";
  const defaultRole = form.roleId || roles.find((item) => item.key === "sales")?.id || "";
  return (
    <div className="space-y-5">
      <Card className="space-y-3 p-4" aria-label="Invitar a una persona">
        <h2 className="font-semibold">Invitar a una persona</h2>
        <p className="text-xs text-ink-muted">La persona queda «Pendiente» hasta que acepte la invitación por la plataforma; la invitación vence en 14 días.</p>
        <div className="grid gap-2 sm:grid-cols-4">
          <input aria-label="Nombre de la persona invitada" placeholder="Nombre" className={inputClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <input aria-label="Correo de la persona invitada" placeholder="Correo" className={inputClass} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          <select aria-label="Rol de la persona invitada" className={inputClass} value={defaultRole} onChange={(event) => setForm({ ...form, roleId: event.target.value })}>{roles.map((item) => <option key={item.id} value={item.id}>{item.name}{item.critical ? " (crítico)" : ""}</option>)}</select>
          <select aria-label="Equipo de la persona invitada" className={inputClass} value={form.teamId} onChange={(event) => setForm({ ...form, teamId: event.target.value })}><option value="">Sin equipo</option>{teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        </div>
        <Button size="sm" onClick={() => { if (!send({ type: "invite.create", email: form.email, name: form.name, roleId: defaultRole, ...(form.teamId ? { teamId: form.teamId } : {}) })) setForm({ name: "", email: "", roleId: "", teamId: "" }); }}>Enviar invitación</Button>
      </Card>

      <div className="overflow-x-auto">
        <table className="w-full" aria-label="Usuarios">
          <thead><tr>{["Nombre", "Correo", "Rol", "Estado", "Equipo", "Último acceso", "Idioma", "Zona horaria", "Acciones"].map((head) => <th key={head} className="px-2 py-1.5 text-left text-xs font-medium text-ink-muted">{head}</th>)}</tr></thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} aria-label={`Usuario ${user.name}`} className="border-t border-line">
                <td className="px-2 py-1.5 text-sm font-medium">{user.name}</td>
                <td className="px-2 py-1.5 text-sm text-ink-soft">{user.email}</td>
                <td className="px-2 py-1.5 text-sm">
                  <select aria-label={`Rol de ${user.name}`} className="rounded-xl border border-line bg-raised px-2 py-1 text-sm text-ink" value={user.roleId} onChange={(event) => send({ type: "user.setRole", userId: user.id, roleId: event.target.value })}>{roles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                </td>
                <td className="px-2 py-1.5 text-sm"><Badge tone={STATUS_TONE[user.status]}>{label("status", user.status)}</Badge></td>
                <td className="px-2 py-1.5 text-sm">{teams.find((item) => item.id === current.get(`user:${user.id}`))?.name ?? "Sin equipo"}</td>
                <td className="px-2 py-1.5 text-sm">{user.lastAccessAt ? when(user.lastAccessAt) : "nunca"}</td>
                <td className="px-2 py-1.5 text-sm">{user.language}</td>
                <td className="px-2 py-1.5 text-sm">{user.timezone}</td>
                <td className="px-2 py-1.5 text-sm">
                  <div className="flex flex-wrap gap-1">
                    {user.status === "active" && <Button size="sm" variant="ghost" onClick={() => send({ type: "user.setStatus", userId: user.id, to: "suspended" })}>Suspender {user.name}</Button>}
                    {user.status === "active" && <Button size="sm" variant="ghost" onClick={() => send({ type: "user.setStatus", userId: user.id, to: "disabled" })}>Deshabilitar {user.name}</Button>}
                    {(user.status === "suspended" || user.status === "disabled") && <Button size="sm" variant="secondary" onClick={() => send({ type: "user.setStatus", userId: user.id, to: "active" })}>Reactivar {user.name}</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-muted">Nadie se elimina: una persona se suspende o se deshabilita, y todo queda en la auditoría. El rol «{roleName(roles.find((item) => item.key === "administrator")?.id ?? "")}» y los cambios críticos los hace solo un administrador.</p>

      <Section title="Invitaciones">
        {invitations.length === 0 && <p className="text-sm text-ink-muted">No hay invitaciones.</p>}
        <ul className="space-y-1 text-sm" aria-label="Invitaciones">
          {invitations.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2"><span>{item.name} · {item.email} · {roleName(item.roleId)} · enviada {when(item.createdAt)}</span><Badge tone={item.status === "accepted" ? "success" : item.status === "revoked" ? "neutral" : "warning"}>{label("invitationStatus", item.status)}</Badge>
              {item.status === "pending" && <><Button size="sm" variant="secondary" onClick={() => sendAsPlatform({ type: "invite.accept", invitationId: item.id })}>Simular aceptación de {item.name} (plataforma)</Button><Button size="sm" variant="ghost" onClick={() => send({ type: "invite.revoke", invitationId: item.id })}>Revocar</Button></>}</li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- teams
export function TeamsTab({ state, env, persona, send }: OrgTabProps) {
  const teams = teamsOf(state, persona.tenantId);
  const departments = departmentsOf(state, persona.tenantId);
  const users = usersOf(state, persona.tenantId).filter((item) => item.status !== "disabled");
  const [form, setForm] = useState({ name: "", departmentId: "", specialty: "", goals: "", leadId: "" });
  const tree = orgTree(state, persona.tenantId, env.signals);
  const history = latest(assignmentHistory(state, persona.tenantId), 12);
  const workers = env.signals.workers.filter((item) => env.signals.instances.some((instance) => instance.tenantId === persona.tenantId && instance.definitionId === item.id && instance.status !== "disabled"));
  const dept = form.departmentId || departments[0]?.id || "";
  const subjectName = (kind: string, id: string) => (kind === "worker" ? env.signals.workers.find((item) => item.id === id)?.name ?? id : users.find((item) => item.id === id)?.name ?? id);
  return (
    <div className="space-y-5">
      <Card className="space-y-3 p-4" aria-label="Crear un equipo">
        <h2 className="font-semibold">Crear un equipo</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <input aria-label="Nombre del equipo" placeholder="Nombre" className={inputClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <select aria-label="Departamento del equipo" className={inputClass} value={dept} onChange={(event) => setForm({ ...form, departmentId: event.target.value })}>{departments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <select aria-label="Especialidad del equipo" className={inputClass} value={form.specialty} onChange={(event) => setForm({ ...form, specialty: event.target.value })}><option value="">Sin especialidad</option>{SPECIALTIES.map((item) => <option key={item} value={item}>{item}</option>)}</select>
          <input aria-label="Objetivos del equipo" placeholder="Objetivos separados por punto y coma" className={`${inputClass} sm:col-span-2`} value={form.goals} onChange={(event) => setForm({ ...form, goals: event.target.value })} />
          <select aria-label="Responsable del equipo" className={inputClass} value={form.leadId} onChange={(event) => setForm({ ...form, leadId: event.target.value })}><option value="">Sin responsable</option>{users.filter((item) => item.status === "active").map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        </div>
        <Button size="sm" onClick={() => { if (!send({ type: "team.create", departmentId: dept, name: form.name, specialty: form.specialty || undefined, goals: form.goals.split(";").map((item) => item.trim()).filter(Boolean), leadId: form.leadId || undefined })) setForm({ name: "", departmentId: "", specialty: "", goals: "", leadId: "" }); }}>Crear equipo</Button>
      </Card>

      <ul className="grid gap-4 lg:grid-cols-2" aria-label="Equipos">
        {teams.map((team) => {
          const members = membersOf(state, persona.tenantId, team.id);
          const place = tree.branches.flatMap((branch) => branch.departments.filter((item) => item.department.id === team.departmentId).map((item) => `${branch.branch.name} · ${item.department.name}`))[0];
          return (
            <Card as="li" key={team.id} aria-label={`Equipo ${team.name}`} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{team.name}</h2>{team.specialty && <Badge tone="primary">{team.specialty}</Badge>}<span className="text-xs text-ink-muted">{place}</span></div>
              <p className="text-xs text-ink-muted">Responsable: {team.leadId ? users.find((item) => item.id === team.leadId)?.name ?? team.leadId : "sin responsable"}</p>
              {team.goals.length > 0 && <ul className="list-disc pl-5 text-sm text-ink-soft">{team.goals.map((goal) => <li key={goal}>{goal}</li>)}</ul>}
              <div className="flex flex-wrap gap-1.5">
                {members.users.map((user) => <Badge key={user.id} tone={STATUS_TONE[user.status]}>{user.name}</Badge>)}
                {members.workers.map((id) => <Badge key={id} tone="accent">IA · {subjectName("worker", id)}</Badge>)}
                {members.users.length + members.workers.length === 0 && <span className="text-xs text-ink-muted">Sin integrantes</span>}
              </div>
            </Card>
          );
        })}
      </ul>

      <Card className="space-y-3 p-4" aria-label="Mover integrantes">
        <h2 className="font-semibold">Asignar personas y Workers a un equipo</h2>
        <p className="text-xs text-ink-muted">Mover es un cambio con historial: nada se reescribe. NEX solo mueve a una persona con una autorización vigente (pestaña Panel); los Workers los mueve siempre una persona.</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <select aria-label="Integrante" id="org-subject" className={inputClass} defaultValue="">
            <option value="">Elija a quién…</option>
            {users.map((item) => <option key={`u-${item.id}`} value={`user:${item.id}`}>{item.name} (persona)</option>)}
            {workers.map((item) => <option key={`w-${item.id}`} value={`worker:${item.id}`}>{item.name} (Worker IA)</option>)}
          </select>
          <select aria-label="Equipo de destino" id="org-target" className={inputClass} defaultValue=""><option value="">Elija el equipo…</option><option value="__none__">Sin equipo</option>{teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          <Button size="sm" variant="secondary" onClick={() => {
            const subject = (document.getElementById("org-subject") as HTMLSelectElement | null)?.value ?? "";
            const target = (document.getElementById("org-target") as HTMLSelectElement | null)?.value ?? "";
            const [kind, id] = subject.split(":");
            if (kind && id && target) send({ type: "membership.assign", subject: { kind: kind as "user" | "worker", id }, teamId: target === "__none__" ? null : target });
          }}>Asignar al equipo</Button>
        </div>
      </Card>
      <Section title="Historial de equipos">
        <ol className="space-y-1 text-sm" aria-label="Historial de equipos">
          {history.shown.map((item) => <li key={item.id} className="text-ink-soft"><span className="text-xs text-ink-muted">{when(item.at)}</span> · {subjectName(item.subject.kind, item.subject.id)} → {teams.find((t) => t.id === item.teamId)?.name ?? "sin equipo"} · {who(item.by)}{item.mode === "auto" ? " (automático, con autorización)" : ""}{item.note ? ` · ${item.note}` : ""}</li>)}
        </ol>
        {hiddenNote(history.hidden) && <p className="text-xs text-ink-muted">{hiddenNote(history.hidden)}</p>}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- roles
export function RolesTab({ state, persona, send }: OrgTabProps) {
  const matrix = permissionMatrix(state, persona.tenantId);
  const [name, setName] = useState("");
  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-muted">Cada empresa tiene sus propios roles: nunca se comparten. Un rol es crítico si es el de administrador o si administra pagos, integraciones, el Developer Center o los Workers; los roles críticos solo los asigna un administrador.</p>
      <Card className="space-y-2 p-4" aria-label="Crear un rol personalizado">
        <h2 className="font-semibold">Crear un rol personalizado</h2>
        <div className="flex flex-wrap items-end gap-2"><label className="min-w-64 space-y-1 text-sm text-ink-muted">Nombre del rol<input aria-label="Nombre del rol" className={inputClass} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <Button size="sm" onClick={() => { if (!send({ type: "role.create", name, permissions: { crm: "read" } })) setName(""); }}>Crear rol</Button></div>
        <p className="text-xs text-ink-muted">Nace con lectura del CRM; sus permisos se ajustan en «Permisos».</p>
      </Card>
      <ul className="grid gap-3 lg:grid-cols-2" aria-label="Roles">
        {matrix.map(({ role, users }) => (
          <Card as="li" key={role.id} aria-label={`Rol ${role.name}`} className="space-y-1 p-4">
            <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{role.name}</span><Badge tone={role.builtin ? "neutral" : "accent"}>{role.builtin ? "Base" : "Personalizado"}</Badge>{role.critical && <Badge tone="danger">Crítico</Badge>}</div>
            <p className="text-xs text-ink-muted">{num(users)} persona(s) · {MODULES.filter((module) => role.permissions[module] !== "none").length} módulos con acceso</p>
          </Card>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- permissions
export function PermissionsTab({ state, persona, send }: OrgTabProps) {
  const matrix = permissionMatrix(state, persona.tenantId);
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">Permisos por módulo y por rol, siempre dentro de la empresa. Solo un administrador los cambia; el rol de administrador no se puede modificar y NEX nunca cambia un permiso.</p>
      <div className="overflow-x-auto">
        <table className="w-full" aria-label="Matriz de permisos">
          <thead><tr><th className="px-2 py-1.5 text-left text-xs font-medium text-ink-muted">Rol</th>{MODULES.map((module) => <th key={module} className="px-2 py-1.5 text-left text-xs font-medium text-ink-muted">{label("module", module)}</th>)}</tr></thead>
          <tbody>
            {matrix.map(({ role, permissions }) => (
              <tr key={role.id} aria-label={`Permisos de ${role.name}`} className="border-t border-line">
                <td className="px-2 py-1.5 text-sm font-medium">{role.name}{role.critical ? " ⚠" : ""}</td>
                {MODULES.map((module) => (
                  <td key={module} className="px-2 py-1.5">
                    <select aria-label={`Permiso ${role.name} ${label("module", module)}`} disabled={role.key === "administrator"} className="rounded-xl border border-line bg-raised px-1.5 py-1 text-xs text-ink" value={permissions[module]} onChange={(event) => send({ type: "role.setPermission", roleId: role.id, module: module as OrgModule, level: event.target.value as Level })}>
                      {LEVELS.map((level) => <option key={level} value={level}>{label("level", level)}</option>)}
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- branches
export function BranchesTab({ state, env, persona, send }: OrgTabProps) {
  const tree = orgTree(state, persona.tenantId, env.signals);
  const [form, setForm] = useState({ name: "", city: "" });
  return (
    <div className="space-y-5">
      <Card className="space-y-2 p-4" aria-label="Crear una sucursal">
        <h2 className="font-semibold">Crear una sucursal</h2>
        <div className="flex flex-wrap items-end gap-2">
          <input aria-label="Nombre de la sucursal" placeholder="Nombre" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-sm text-ink" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <input aria-label="Ciudad de la sucursal" placeholder="Ciudad" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-sm text-ink" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
          <Button size="sm" onClick={() => { if (!send({ type: "branch.create", name: form.name, city: form.city })) setForm({ name: "", city: "" }); }}>Crear sucursal</Button>
        </div>
      </Card>
      <ul className="grid gap-4 lg:grid-cols-2" aria-label="Sucursales">
        {tree.branches.map(({ branch, departments }) => {
          const teams = departments.flatMap((item) => item.teams);
          const people = teams.flatMap((item) => item.people);
          const workers = teams.flatMap((item) => item.workers);
          return (
            <Card as="li" key={branch.id} aria-label={`Sucursal ${branch.name}`} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{branch.name}</h2><span className="text-sm text-ink-muted">{branch.city}</span><Badge tone={branch.status === "active" ? "success" : "neutral"}>{branch.status === "active" ? "Activa" : "Inactiva"}</Badge></div>
              <p className="text-sm text-ink-soft">{num(departments.length)} departamentos · {num(teams.length)} equipos · {num(people.length)} personas · {num(workers.length)} Workers IA</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-ink-muted">Idioma
                  <select aria-label={`Idioma de ${branch.name}`} className={inputClass} value={branch.settings.language} onChange={(event) => send({ type: "branch.update", branchId: branch.id, settings: { language: event.target.value as (typeof LANGUAGES)[number] } })}>{LANGUAGES.map((item) => <option key={item} value={item}>{item}</option>)}</select>
                </label>
                <label className="space-y-1 text-xs text-ink-muted">Zona horaria
                  <select aria-label={`Zona horaria de ${branch.name}`} className={inputClass} value={branch.settings.timezone} onChange={(event) => send({ type: "branch.update", branchId: branch.id, settings: { timezone: event.target.value as (typeof TIMEZONES)[number] } })}>{TIMEZONES.map((item) => <option key={item} value={item}>{item}</option>)}</select>
                </label>
              </div>
              <p className="text-xs text-ink-muted">Moneda {branch.settings.currency} · Horario {branch.settings.workHours}</p>
              <Button size="sm" variant="ghost" onClick={() => send({ type: "branch.setStatus", branchId: branch.id, to: branch.status === "active" ? "inactive" : "active" })}>{branch.status === "active" ? `Desactivar ${branch.name}` : `Activar ${branch.name}`}</Button>
            </Card>
          );
        })}
      </ul>
    </div>
  );
}
