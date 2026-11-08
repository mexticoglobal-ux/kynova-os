"use client";

import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { hiddenNote, latest } from "@/lib/contracts/platform/display";
import { DIGESTS, LANGUAGES, TIMEZONES, analysesOf, auditOf, grantsOf, proposalsOf, usersOf, type AuditCategory, type ProposalPayload } from "@/lib/contracts/platform/org-center";
import { label } from "@/lib/contracts/platform/org-messages";
import { FUTURE_IDENTITY, identityOf, orgDashboard, orgTree, recommendations, workforce, type Availability } from "@/lib/contracts/platform/koe-org";
import { formatCostMicros } from "@/lib/contracts/platform/koe-registry";
import { Kpi, Section, money, num, pct } from "./InsightsCharts";
import type { OrgTabProps } from "./OrgCenter";
import { INPUT_FULL } from "@/components/ui/form";

const SEVERITY_TONE: Record<string, BadgeTone> = { low: "neutral", normal: "primary", high: "warning", critical: "danger" };
const STATUS_TONE: Record<string, BadgeTone> = { pending: "warning", active: "success", suspended: "warning", disabled: "neutral" };
const AVAILABILITY_TONE: Record<Availability, BadgeTone> = { available: "success", busy: "warning", away: "neutral", paused: "warning", disabled: "neutral" };
const when = (iso: string) => iso.slice(0, 16).replace("T", " ");
const who = (actor: string) => (actor.startsWith("worker:") ? "NEX (IA)" : actor === "system" ? "Plataforma" : actor);

const describePayload = (payload: ProposalPayload, names: (id: string) => string, team: (id: string) => string): string => {
  if (payload.kind === "invite") return `Invitar a ${payload.name} (${payload.email})${payload.teamId ? ` al equipo ${team(payload.teamId)}` : ""}`;
  if (payload.kind === "team") return `Crear el equipo «${payload.name}»`;
  if (payload.kind === "move") return `Mover a ${names(payload.userId)} al equipo ${team(payload.teamId)}`;
  return `Cambiar el rol de ${names(payload.userId)}`;
};

// ---------------------------------------------------------------- dashboard
export function DashboardTab({ state, env, asOf, persona, send }: OrgTabProps) {
  const d = orgDashboard(state, persona.tenantId, env.signals, asOf);
  const recs = recommendations(state, persona.tenantId, env.signals, asOf);
  const proposals = proposalsOf(state, persona.tenantId);
  const analyses = analysesOf(state, persona.tenantId);
  const grant = grantsOf(state, persona.tenantId).find((item) => item.status === "active");
  const [category, setCategory] = useState<AuditCategory | "">("");
  const audit = latest(auditOf(state, persona.tenantId, category || undefined), 40);
  const nameOf = (id: string) => usersOf(state, persona.tenantId).find((item) => item.id === id)?.name ?? id;
  const teamOf = (id: string) => state.teams.find((item) => item.id === id)?.name ?? id;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Empresas" value={num(d.companies)} hint={`${d.orgName} (cada empresa está aislada)`} />
        <Kpi label="Sucursales" value={num(d.branches.total)} hint={`${d.branches.active} activas`} />
        <Kpi label="Departamentos" value={num(d.departments)} />
        <Kpi label="Equipos" value={num(d.teams)} />
        <Kpi label="Usuarios" value={num(d.users.total)} hint={`${d.users.active} activos · ${d.users.pending} pendientes · ${d.users.suspended} suspendidos · ${d.users.disabled} deshabilitados`} />
        <Kpi label="Workers IA" value={num(d.workers.installed)} hint={`${d.workers.inTeams} en equipos · ${d.workers.unassigned} sin equipo`} />
        <Kpi label="Roles" value={num(d.roles.builtin + d.roles.custom)} hint={`${d.roles.builtin} base · ${d.roles.custom} personalizados`} />
        <Kpi label="Invitaciones" value={num(d.invitations.pending)} hint={`pendientes · ${d.invitations.accepted} aceptadas · ${d.invitations.revoked} revocadas · ${d.invitations.expired} vencidas`} />
        <Kpi label="Estado general" value={d.health === "ok" ? "En orden" : d.health === "attention" ? "Requiere atención" : "Crítico"} tone={d.health === "ok" ? "good" : "warn"} hint={`${d.recommendations.critical + d.recommendations.high} recomendaciones importantes`} />
      </div>

      <Section title="Recomendaciones de KOE" aside="Todas salen del mismo motor; ninguna se aplica sola">
        {recs.length === 0 && <p className="text-sm text-ink-muted">KOE no tiene recomendaciones por ahora.</p>}
        <ul className="space-y-2" aria-label="Recomendaciones de KOE">
          {recs.map((item) => (
            <Card as="li" key={item.id} className="flex flex-wrap items-center gap-3 p-4">
              <Badge tone={SEVERITY_TONE[item.severity]}>{label("severity", item.severity)}</Badge>
              <div className="min-w-0 flex-1"><p className="font-medium">{item.text}</p><p className="text-xs text-ink-muted">{item.reason}</p></div>
              {item.suggestedMove && (
                <Button size="sm" variant="secondary" onClick={() => send({ type: "proposal.create", payload: { kind: "move", userId: item.suggestedMove?.userId ?? "", teamId: item.suggestedMove?.toTeamId ?? "" }, reason: item.reason })}>Preparar propuesta: mover a {nameOf(item.suggestedMove.userId)}</Button>
              )}
            </Card>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => send({ type: "org.analyze" })}>Pedir un análisis a KOE</Button>
          <span className="text-xs text-ink-muted">Cada análisis guarda el Worker, el modelo y su costo estimado; no se sobrescribe.</span>
        </div>
        <ul className="space-y-0.5 text-sm text-ink-soft" aria-label="Historial de análisis de KOE">
          {[...analyses].reverse().slice(0, 4).map((item) => <li key={item.id}>{when(item.at)} · {item.workerName} · modelo {item.model.label} · {item.recommendationIds.length} recomendaciones · {formatCostMicros(item.estimatedCostMicros)}</li>)}
        </ul>
      </Section>

      <Section title="Propuestas de NEX" aside="Nivel 1: NEX prepara; una persona aprueba">
        {proposals.length === 0 && <p className="text-sm text-ink-muted">No hay propuestas.</p>}
        <ul className="space-y-2" aria-label="Propuestas">
          {proposals.map((item) => (
            <Card as="li" key={item.id} aria-label={`Propuesta ${item.id}`} className="space-y-1 p-4">
              <div className="flex flex-wrap items-center gap-2"><Badge tone="primary">{label("proposalKind", item.payload.kind)}</Badge><Badge tone={item.status === "approved" ? "success" : item.status === "rejected" ? "neutral" : "warning"}>{label("proposalStatus", item.status)}</Badge><span className="font-medium">{describePayload(item.payload, nameOf, teamOf)}</span></div>
              <p className="text-xs text-ink-muted">Propuesta de {who(item.proposedBy)} · {item.reason}</p>
              {item.status === "proposed" && <div className="flex gap-2"><Button size="sm" onClick={() => send({ type: "proposal.approve", proposalId: item.id })}>Aprobar</Button><Button size="sm" variant="ghost" onClick={() => send({ type: "proposal.reject", proposalId: item.id })}>Rechazar</Button></div>}
            </Card>
          ))}
        </ul>
      </Section>

      <Card className="space-y-2 p-4" aria-label="Autorización para mover personas">
        <h2 className="font-semibold">Autorización para mover personas entre equipos (Nivel 2)</h2>
        <p className="text-sm text-ink-muted">NEX puede mover a una persona activa con un rol no crítico solo con una autorización vigente de un administrador, con sus límites.</p>
        {grant
          ? <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="success">Vigente</Badge><span>{grant.maxPerDay ? `hasta ${grant.maxPerDay} movimientos por día` : "sin límite diario"} · concedida por {who(grant.grantedBy)}</span><Button size="sm" variant="ghost" onClick={() => send({ type: "authorization.revoke", grantId: grant.id })}>Revocar autorización</Button></div>
          : <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="warning">Sin autorización</Badge><Button size="sm" variant="secondary" onClick={() => send({ type: "authorization.grant", maxPerDay: 3 })}>Conceder autorización (3 por día)</Button></div>}
      </Card>

      <Section title="Auditoría" aside="Nunca se borra el historial">
        <select aria-label="Categoría de auditoría" className="max-w-xs rounded-xl border border-line bg-raised px-3 py-1.5 text-sm text-ink" value={category} onChange={(event) => setCategory(event.target.value as AuditCategory | "")}>
          <option value="">Todas las categorías</option>{(["invitations", "roles", "permissions", "teams", "branches", "workers", "users", "identity", "other"] as const).map((key) => <option key={key} value={key}>{label("auditCategory", key)}</option>)}
        </select>
        <ul className="space-y-1 text-sm" aria-label="Registro de auditoría">{audit.shown.map((entry, index) => <li key={`${entry.at}-${index}`} className="text-ink-soft"><span className="text-xs text-ink-muted">{when(entry.at)}</span> · <Badge tone="neutral">{label("auditCategory", entry.category)}</Badge> {who(entry.actor)} · {entry.action}{entry.detail ? ` — ${entry.detail}` : ""}</li>)}</ul>
        {hiddenNote(audit.hidden) && <p className="text-xs text-ink-muted">{hiddenNote(audit.hidden)}</p>}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- organization tree
export function TreeTab({ state, env, persona }: OrgTabProps) {
  const tree = orgTree(state, persona.tenantId, env.signals);
  const roleName = (id: string) => state.roles.find((item) => item.id === id)?.name ?? "";
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">Empresa → sucursales → departamentos → equipos → personas y Workers IA. Un Worker pertenece al equipo igual que una persona.</p>
      <Card className="space-y-4 p-5" aria-label={`Empresa ${tree.org?.name ?? ""}`}>
        <h2 className="text-lg font-semibold">{tree.org?.name} <span className="text-sm font-normal text-ink-muted">· propietario {tree.org?.ownerId}</span></h2>
        <ul className="space-y-4 border-l-2 border-line pl-4">
          {tree.branches.map(({ branch, departments }) => (
            <li key={branch.id} aria-label={`Sucursal ${branch.name}`} className="space-y-2">
              <p className="font-semibold">{branch.name} <span className="text-sm font-normal text-ink-muted">· {branch.city}{branch.status === "inactive" ? " · inactiva" : ""}</span></p>
              <ul className="space-y-3 border-l-2 border-line pl-4">
                {departments.map(({ department, teams }) => (
                  <li key={department.id} aria-label={`Departamento ${department.name}`} className="space-y-1">
                    <p className="font-medium">{department.name}</p>
                    <ul className="space-y-2 border-l-2 border-line pl-4">
                      {teams.map(({ team, people, workers }) => (
                        <li key={team.id} aria-label={`Equipo ${team.name}`} className="space-y-1">
                          <p className="text-sm font-medium">{team.name}{team.specialty ? <span className="font-normal text-ink-muted"> · {team.specialty}</span> : null}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {people.map((person) => <Badge key={person.id} tone={STATUS_TONE[person.status]}>{person.name} · {roleName(person.roleId)}</Badge>)}
                            {workers.map((worker) => <Badge key={worker.id} tone="accent">IA · {worker.name}</Badge>)}
                            {people.length + workers.length === 0 && <span className="text-xs text-ink-muted">Sin integrantes</span>}
                          </div>
                        </li>
                      ))}
                      {teams.length === 0 && <li className="text-xs text-ink-muted">Sin equipos</li>}
                    </ul>
                  </li>
                ))}
                {departments.length === 0 && <li className="text-xs text-ink-muted">Sin departamentos</li>}
              </ul>
            </li>
          ))}
        </ul>
        <div className="space-y-1" aria-label="Sin equipo">
          <p className="text-sm font-medium">Sin equipo</p>
          <div className="flex flex-wrap gap-1.5">
            {tree.unassigned.people.map((person) => <Badge key={person.id} tone={STATUS_TONE[person.status]}>{person.name}</Badge>)}
            {tree.unassigned.workers.map((worker) => <Badge key={worker.id} tone="accent">IA · {worker.name}</Badge>)}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- workforce
export function WorkforceTab({ state, env, asOf, persona }: OrgTabProps) {
  const [kind, setKind] = useState<"" | "user" | "worker">("");
  const [availability, setAvailability] = useState<"" | Availability>("");
  const all = workforce(state, persona.tenantId, env.signals, asOf);
  const rows = all.filter((row) => (kind === "" || row.kind === kind) && (availability === "" || row.availability === availability));
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">Personas y Workers IA en una sola vista, con datos de KOE. Los costos son estimaciones (el de las personas es un supuesto por rol; el de los Workers es la suma de sus ejecuciones de los últimos 30 días), no una nómina ni una factura.</p>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Tipo" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-sm text-ink" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="">Personas y Workers</option><option value="user">Solo personas</option><option value="worker">Solo Workers IA</option></select>
        <select aria-label="Disponibilidad" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-sm text-ink" value={availability} onChange={(event) => setAvailability(event.target.value as typeof availability)}>
          <option value="">Toda la disponibilidad</option>{(["available", "busy", "away", "paused", "disabled"] as const).map((key) => <option key={key} value={key}>{label("availability", key)}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full" aria-label="Fuerza de trabajo">
          <thead><tr>{["Nombre", "Tipo", "Estado", "Especialidad", "Equipo", "Sucursal", "Carga", "Disponibilidad", "Costo estimado"].map((head) => <th key={head} className="px-2 py-1.5 text-left text-xs font-medium text-ink-muted">{head}</th>)}</tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.kind}-${row.id}`} aria-label={`Fila ${row.name}`} className="border-t border-line">
                <td className="px-2 py-1.5 text-sm font-medium">{row.name}{row.roleName ? <span className="font-normal text-ink-muted"> · {row.roleName}</span> : null}</td>
                <td className="px-2 py-1.5 text-sm">{row.kind === "user" ? "Persona" : "Worker IA"}</td>
                <td className="px-2 py-1.5 text-sm">{row.kind === "user" ? label("status", row.status as "active") : row.status === "active" ? "Activo" : row.status === "paused" ? "En pausa" : "Deshabilitado"}</td>
                <td className="px-2 py-1.5 text-sm">{row.specialty}</td>
                <td className="px-2 py-1.5 text-sm">{row.teamName}</td>
                <td className="px-2 py-1.5 text-sm">{row.branchName}</td>
                <td className="px-2 py-1.5 text-sm">{row.kind === "user" ? `${num(row.openItems)} abiertos` : `${num(row.openItems)} hoy`} · {pct(row.load)}</td>
                <td className="px-2 py-1.5 text-sm"><Badge tone={AVAILABILITY_TONE[row.availability]}>{label("availability", row.availability)}</Badge></td>
                <td className="px-2 py-1.5 text-sm">{row.estimatedCostMicros > 0 ? (row.kind === "user" ? `${money(row.estimatedCostMicros)} al mes` : formatCostMicros(row.estimatedCostMicros)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="text-sm text-ink-muted">Nadie coincide con ese filtro.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- identity center
export function IdentityTab({ state, persona, send, sendAsPlatform }: OrgTabProps) {
  const people = usersOf(state, persona.tenantId);
  const own = people.find((item) => item.id === persona.actor)?.id ?? people[0]?.id ?? "";
  const [userId, setUserId] = useState(own);
  const identity = identityOf(state, persona.tenantId, userId);
  const [form, setForm] = useState<{ name: string; language: string; timezone: string } | null>(null);
  if (!identity) return <p className="text-sm text-ink-muted">Esta empresa todavía no tiene personas.</p>;
  const { user } = identity;
  const profile = form ?? { name: user.name, language: user.language, timezone: user.timezone };
  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-muted">Perfil, preferencias, idioma, zona horaria, notificaciones, seguridad, sesiones y dispositivos. Todo es arquitectura: no hay un proveedor de identidad conectado, y cada quien cambia sus propias preferencias y seguridad.</p>
      <label className="block max-w-sm space-y-1 text-sm text-ink-muted">Persona
        <select aria-label="Persona" className={INPUT_FULL} value={userId} onChange={(event) => { setUserId(event.target.value); setForm(null); }}>{people.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </label>
      <Card className="space-y-3 p-4" aria-label="Perfil">
        <h2 className="font-semibold">Perfil</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-sm text-ink-muted">Nombre<input aria-label="Nombre del perfil" className={INPUT_FULL} value={profile.name} onChange={(event) => setForm({ ...profile, name: event.target.value })} /></label>
          <label className="space-y-1 text-sm text-ink-muted">Idioma<select aria-label="Idioma" className={INPUT_FULL} value={profile.language} onChange={(event) => setForm({ ...profile, language: event.target.value })}>{LANGUAGES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="space-y-1 text-sm text-ink-muted">Zona horaria<select aria-label="Zona horaria" className={INPUT_FULL} value={profile.timezone} onChange={(event) => setForm({ ...profile, timezone: event.target.value })}>{TIMEZONES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        </div>
        <p className="text-xs text-ink-muted">{user.email} · rol {identity.role?.name} · estado {label("status", user.status)} · último acceso {user.lastAccessAt ? when(user.lastAccessAt) : "nunca"}</p>
        <Button size="sm" variant="secondary" onClick={() => send({ type: "profile.update", userId: user.id, name: profile.name, language: profile.language as typeof user.language, timezone: profile.timezone as typeof user.timezone })}>Guardar perfil</Button>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-2 p-4" aria-label="Notificaciones"><h2 className="font-semibold">Notificaciones</h2>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="Notificar por correo" checked={user.preferences.notifications.email} onChange={(event) => send({ type: "preferences.set", userId: user.id, email: event.target.checked, inApp: user.preferences.notifications.inApp, digest: user.preferences.notifications.digest })} />Por correo</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="Notificar dentro de la plataforma" checked={user.preferences.notifications.inApp} onChange={(event) => send({ type: "preferences.set", userId: user.id, email: user.preferences.notifications.email, inApp: event.target.checked, digest: user.preferences.notifications.digest })} />Dentro de la plataforma</label>
          <label className="flex items-center gap-2 text-sm">Resumen
            <select aria-label="Resumen de notificaciones" className="rounded-xl border border-line bg-raised px-2 py-1 text-sm text-ink" value={user.preferences.notifications.digest} onChange={(event) => send({ type: "preferences.set", userId: user.id, email: user.preferences.notifications.email, inApp: user.preferences.notifications.inApp, digest: event.target.value as (typeof DIGESTS)[number] })}>{DIGESTS.map((item) => <option key={item} value={item}>{item === "off" ? "Sin resumen" : item === "daily" ? "Diario" : "Semanal"}</option>)}</select>
          </label>
        </Card>
        <Card className="space-y-2 p-4" aria-label="Seguridad"><h2 className="font-semibold">Seguridad</h2>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label="Solicitar verificación en dos pasos" checked={user.security.mfaRequested} onChange={(event) => send({ type: "security.set", userId: user.id, mfaRequested: event.target.checked })} />Solicitar verificación en dos pasos</label>
          <p className="text-xs text-ink-muted">Arquitectura: se registra la preferencia; todavía no existe una verificación real.</p>
        </Card>
      </div>
      <Section title="Sesiones y dispositivos">
        <Button size="sm" variant="secondary" onClick={() => sendAsPlatform({ type: "session.record", userId: user.id, deviceLabel: "Dispositivo nuevo", location: "San José, Costa Rica" })}>Simular un inicio de sesión (plataforma)</Button>
        {identity.sessions.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay sesiones.</p>}
        <ul className="space-y-1 text-sm" aria-label="Sesiones">
          {identity.sessions.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2"><span>{when(item.startedAt)} · {identity.devices.find((d) => d.id === item.deviceId)?.label} · {item.location}</span>
              {item.revokedAt ? <Badge tone="neutral">Revocada por {who(item.revokedBy ?? "")}</Badge> : <Button size="sm" variant="ghost" onClick={() => send({ type: "session.revoke", sessionId: item.id })}>Cerrar sesión</Button>}</li>
          ))}
        </ul>
        <ul className="space-y-1 text-sm" aria-label="Dispositivos">
          {identity.devices.map((item) => <li key={item.id} className="flex flex-wrap items-center gap-2"><span>{item.label}</span><Badge tone={item.trusted ? "success" : "neutral"}>{item.trusted ? "De confianza" : "Sin confianza"}</Badge><Button size="sm" variant="ghost" onClick={() => send({ type: "device.trust", deviceId: item.id, trusted: !item.trusted })}>{item.trusted ? "Quitar confianza" : "Marcar de confianza"}</Button></li>)}
        </ul>
      </Section>
      <Section title="Arquitectura preparada, todavía no construida" aside="Cada conector pasará por KOE, nunca directo a un proveedor">
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Conectores de identidad futuros">
          {FUTURE_IDENTITY.map((item) => <Card as="li" key={item.id} className="space-y-1 p-3"><div className="flex items-center gap-2"><span className="font-medium">{item.label}</span><Badge tone="neutral">No construido</Badge></div><p className="text-xs text-ink-muted">Necesita: {item.needs}</p></Card>)}
        </ul>
      </Section>
    </div>
  );
}
