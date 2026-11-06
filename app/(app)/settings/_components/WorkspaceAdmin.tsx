"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, ScrollText, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { ROLES, ROLE_LABEL, type ActivityDto, type Role, type TeamEntry } from "@/lib/contracts/backend";
import { apiFetch, errorMessage } from "@/lib/api/client";
import { formatDateTime } from "@/lib/format-money";
import { useSession } from "@/components/session/SessionProvider";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconBadge } from "@/components/ui/IconBadge";
import { LABEL } from "@/components/ui/form";

const LEVEL_LABEL: Record<number, string> = { 1: "Observar y preparar", 2: "Autorizado", 3: "Con tu confirmación" };

// Company, team and activity for a signed-in company. Hidden in demonstration mode (there is nothing to manage).
export function WorkspaceAdmin() {
  const session = useSession();
  if (session.mode !== "backend") return null;
  return (
    <div className="space-y-6">
      <CompanySection />
      <TeamSection />
      <ActivitySection />
    </div>
  );
}

function CompanySection() {
  const session = useSession();
  const [name, setName] = useState(session.mode === "backend" ? session.tenantName : "");
  const [newName, setNewName] = useState("");
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (session.mode !== "backend") return null;
  const canAdmin = session.can("admin");
  const isOwner = session.can("owner");

  async function rename(event: React.FormEvent) {
    event.preventDefault();
    const result = await apiFetch(`/api/v1/companies/${session.tenantId}`, { method: "PATCH", body: { name } });
    if (session.mode !== "backend") return;
    setMessage(result.ok ? "Nombre actualizado." : errorMessage(result.error));
    if (result.ok) window.location.reload();
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const result = await apiFetch<{ tenantId: string }>("/api/v1/companies", { body: { name: newName } });
    if (!result.ok) return setMessage(errorMessage(result.error));
    if (session.mode === "backend") session.selectTenant(result.data.tenantId);
  }

  async function remove(event: React.FormEvent) {
    event.preventDefault();
    const result = await apiFetch(`/api/v1/companies/${session.tenantId}`, { method: "DELETE", body: { confirmName: confirm } });
    if (!result.ok) return setMessage(result.error === "invalid" ? "El nombre no coincide." : errorMessage(result.error));
    window.location.assign("/dashboard");
  }

  return (
    <Card as="section" className="space-y-5 p-5 sm:p-6" aria-labelledby="company-admin">
      <div className="flex items-center gap-3">
        <IconBadge icon={Building2} />
        <div>
          <h2 id="company-admin" className="font-medium">
            Tu empresa
          </h2>
          <p className="text-sm text-ink-muted">{`Eres ${ROLE_LABEL[session.role].toLowerCase()} de ${session.tenantName}.`}</p>
        </div>
      </div>

      {canAdmin && (
        <form onSubmit={rename} className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="company-rename" className={LABEL}>
              Nombre de la empresa
            </label>
            <input id="company-rename" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required className="field min-h-11 text-base" />
          </div>
          <Button type="submit" variant="secondary" disabled={name.trim() === "" || name.trim() === session.tenantName}>
            Guardar nombre
          </Button>
        </form>
      )}

      <form onSubmit={create} className="flex flex-wrap items-end gap-3 border-t border-line-soft pt-5">
        <div className="min-w-0 flex-1">
          <label htmlFor="company-new" className={LABEL}>
            Crear otra empresa
          </label>
          <input id="company-new" value={newName} onChange={(event) => setNewName(event.target.value)} maxLength={120} className="field min-h-11 text-base" />
        </div>
        <Button type="submit" variant="secondary" disabled={newName.trim() === ""}>
          Crear empresa
        </Button>
      </form>

      {isOwner && (
        <div className="border-t border-line-soft pt-5">
          {deleting ? (
            <form onSubmit={remove} className="space-y-3">
              <p className="text-sm text-danger-soft">
                Esto elimina para siempre la empresa y todo lo que contiene: prospectos, clientes, conversaciones y registros. Escribe <strong>{session.tenantName}</strong> para confirmar.
              </p>
              <input aria-label="Confirmar nombre de la empresa" value={confirm} onChange={(event) => setConfirm(event.target.value)} className="field min-h-11 text-base" />
              <div className="flex gap-2">
                <Button type="submit" variant="accent" disabled={confirm.trim() !== session.tenantName}>
                  <Trash2 aria-hidden className="h-4 w-4" />
                  Eliminar empresa
                </Button>
                <Button variant="ghost" onClick={() => { setDeleting(false); setConfirm(""); }}>
                  Cancelar
                </Button>
              </div>
            </form>
          ) : (
            <Button variant="ghost" onClick={() => setDeleting(true)}>
              <Trash2 aria-hidden className="h-4 w-4" />
              Eliminar esta empresa…
            </Button>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="text-sm text-primary-soft">
          {message}
        </p>
      )}
    </Card>
  );
}

function TeamSection() {
  const session = useSession();
  const [team, setTeam] = useState<TeamEntry[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<Role, "owner">>("member");
  const [message, setMessage] = useState<string | null>(null);
  const tenantId = session.mode === "backend" ? session.tenantId : null;

  const load = useCallback(async () => {
    if (!tenantId) return;
    const result = await apiFetch<{ team: TeamEntry[] }>(`/api/v1/team?tenantId=${tenantId}`);
    if (result.ok) setTeam(result.data.team);
    else setMessage(errorMessage(result.error));
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (session.mode !== "backend") return null;
  const canAdmin = session.can("admin");
  const isOwner = session.can("owner");

  async function run(action: Promise<{ ok: boolean; error?: string }>, success?: string) {
    const result = await action;
    setMessage(result.ok ? (success ?? null) : errorMessage(result.error ?? "unavailable"));
    await load();
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    const result = await apiFetch<{ status: "added" | "invited" }>("/api/v1/team", { body: { tenantId, email, role } });
    if (result.ok) {
      setEmail("");
      setMessage(result.data.status === "added" ? "Agregamos a la persona al equipo." : "Invitación creada: se aplica cuando inicie sesión con ese correo.");
    } else setMessage(result.error === "conflict" ? "Esa persona ya está en el equipo." : errorMessage(result.error));
    await load();
  }

  return (
    <Card as="section" className="space-y-5 p-5 sm:p-6" aria-labelledby="team-admin">
      <div className="flex items-center gap-3">
        <IconBadge icon={Users} />
        <div>
          <h2 id="team-admin" className="font-medium">
            Equipo
          </h2>
          <p className="text-sm text-ink-muted">Propietario y administradores gestionan personas; los miembros trabajan los datos; “solo lectura” únicamente consulta.</p>
        </div>
      </div>

      {team === null ? (
        <p className="text-sm text-ink-muted">Cargando equipo…</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {team.map((entry) =>
            entry.kind === "member" ? (
              <li key={entry.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{entry.name}{entry.userId === session.userId && <span className="ml-2 text-xs text-ink-muted">(tú)</span>}</p>
                  <p className="truncate text-sm text-ink-muted">{entry.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {canAdmin && entry.userId !== session.userId && (entry.role !== "owner" || isOwner) ? (
                    <select
                      aria-label={`Rol de ${entry.name}`}
                      value={entry.role}
                      onChange={(event) => void run(apiFetch(`/api/v1/team/${entry.userId}`, { method: "PATCH", body: { tenantId, role: event.target.value } }), "Rol actualizado.")}
                      className="field h-9 w-auto rounded-full py-0 text-sm"
                    >
                      {ROLES.filter((option) => isOwner || (option !== "owner" && option !== "admin")).map((option) => (
                        <option key={option} value={option} className="bg-surface text-ink">
                          {ROLE_LABEL[option]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Badge tone={entry.role === "owner" ? "accent" : "neutral"}>{ROLE_LABEL[entry.role]}</Badge>
                  )}
                  {(canAdmin && entry.userId !== session.userId && (entry.role !== "owner" || isOwner)) || entry.userId === session.userId ? (
                    <Button size="sm" variant="ghost" aria-label={entry.userId === session.userId ? "Salir de la empresa" : `Quitar a ${entry.name}`} onClick={() => void run(apiFetch(`/api/v1/team/${entry.userId}?tenantId=${tenantId}`, { method: "DELETE" }), "Persona quitada.").then(() => { if (entry.userId === session.userId) window.location.assign("/dashboard"); })}>
                      {entry.userId === session.userId ? "Salir" : "Quitar"}
                    </Button>
                  ) : null}
                </div>
              </li>
            ) : (
              <li key={entry.invitationId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{entry.email}</p>
                  <p className="text-sm text-ink-muted">Invitación pendiente · {ROLE_LABEL[entry.role]}</p>
                </div>
                {canAdmin && (
                  <Button size="sm" variant="ghost" onClick={() => void run(apiFetch(`/api/v1/invitations/${entry.invitationId}`, { method: "DELETE" }), "Invitación cancelada.")}>
                    Cancelar invitación
                  </Button>
                )}
              </li>
            ),
          )}
        </ul>
      )}

      {canAdmin && (
        <form onSubmit={invite} className="flex flex-wrap items-end gap-3 border-t border-line-soft pt-5">
          <div className="min-w-0 flex-1">
            <label htmlFor="invite-email" className={LABEL}>
              Invitar por correo
            </label>
            <input id="invite-email" type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className="field min-h-11 text-base" />
          </div>
          <div>
            <label htmlFor="invite-role" className={LABEL}>
              Rol
            </label>
            <select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as Exclude<Role, "owner">)} className="field min-h-11 text-base">
              {(["member", "viewer", ...(isOwner ? (["admin"] as const) : [])] as const).map((option) => (
                <option key={option} value={option} className="bg-surface text-ink">
                  {ROLE_LABEL[option]}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" variant="primary">
            <UserPlus aria-hidden className="h-4 w-4" />
            Invitar
          </Button>
        </form>
      )}
      {message && (
        <p role="status" className="text-sm text-primary-soft">
          {message}
        </p>
      )}
    </Card>
  );
}

function ActivitySection() {
  const session = useSession();
  const [items, setItems] = useState<ActivityDto[] | null>(null);
  const tenantId = session.mode === "backend" ? session.tenantId : null;

  useEffect(() => {
    if (!tenantId) return;
    void apiFetch<{ activity: ActivityDto[] }>(`/api/v1/activity?tenantId=${tenantId}`).then((result) => setItems(result.ok ? result.data.activity : []));
  }, [tenantId]);

  return (
    <Card as="section" className="space-y-4 p-5 sm:p-6" aria-labelledby="activity-log">
      <div className="flex items-center gap-3">
        <IconBadge icon={ScrollText} />
        <div>
          <h2 id="activity-log" className="font-medium">
            Registro de actividad
          </h2>
          <p className="text-sm text-ink-muted">Qué hicieron NEX y las personas, y con qué nivel de autonomía. Solo se agrega; nada se edita ni se borra.</p>
        </div>
      </div>
      {items === null ? (
        <p className="text-sm text-ink-muted">Cargando…</p>
      ) : items.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="Todavía no hay actividad">
          Cada acción importante quedará registrada aquí.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line-soft text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
              <div className="min-w-0">
                <p className="text-ink">{item.summary}</p>
                <p className="text-xs text-ink-muted">{`${item.actor === "nex" ? "NEX" : (item.actorName ?? (item.actor === "system" ? "Sistema" : "Persona"))} · ${LEVEL_LABEL[item.level] ?? ""}${item.reason ? ` · ${item.reason}` : ""}`}</p>
              </div>
              <time dateTime={item.at} className="shrink-0 text-xs text-ink-muted">
                {formatDateTime(item.at)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
