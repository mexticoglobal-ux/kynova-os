"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, Pencil, Plus, RotateCcw, Search, UserPlus, Users } from "lucide-react";
import type { ClientDto } from "@/lib/contracts/backend";
import { apiFetch, errorMessage } from "@/lib/api/client";
import { formatDate, formatMoney } from "@/lib/format-money";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { LABEL } from "@/components/ui/form";

type Form = { name: string; email: string; phone: string; company: string; notes: string };
const EMPTY: Form = { name: "", email: "", phone: "", company: "", notes: "" };

// Real clients of the company: customers with their contact and organization. A client is never deleted:
// archiving keeps the history (opportunities, conversations) and can be undone.
export function ClientsManager({ tenantId, canWrite }: { tenantId: string; canWrite: boolean }) {
  const [clients, setClients] = useState<ClientDto[] | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("active");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ tenantId });
    if (search.trim()) params.set("search", search.trim());
    if (status !== "all") params.set("status", status);
    const result = await apiFetch<{ clients: ClientDto[] }>(`/api/v1/clients?${params}`);
    if (result.ok) {
      setClients(result.data.clients);
      setError(null);
    } else setError(errorMessage(result.error));
  }, [tenantId, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), search ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [load, search]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    const { id, form } = editing;
    const result = id
      ? await apiFetch(`/api/v1/clients/${id}`, { method: "PATCH", body: { tenantId, name: form.name, email: form.email, phone: form.phone, organization: form.company, notes: form.notes } })
      : await apiFetch("/api/v1/clients", { body: { tenantId, ...Object.fromEntries(Object.entries(form).filter(([, value]) => value.trim() !== "")) } });
    setSaving(false);
    if (!result.ok) return setError(errorMessage(result.error));
    setEditing(null);
    await load();
  }

  async function setClientStatus(client: ClientDto, next: "active" | "inactive") {
    const result = await apiFetch(`/api/v1/clients/${client.id}`, { method: "PATCH", body: { tenantId, status: next } });
    if (!result.ok) return setError(errorMessage(result.error));
    await load();
  }

  const field = (key: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <label htmlFor={`client-${key}`} className={LABEL}>
        {label}
      </label>
      <input
        id={`client-${key}`}
        value={editing?.form[key] ?? ""}
        onChange={(event) => setEditing((current) => (current ? { ...current, form: { ...current.form, [key]: event.target.value } } : current))}
        className="field min-h-11 text-base"
        {...props}
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        eyebrow="Tu empresa"
        title="Clientes"
        subtitle="Las personas y empresas que ya te compran. Todo se guarda y cada cambio queda en el registro de actividad."
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => setEditing({ id: null, form: EMPTY })}>
              <Plus aria-hidden className="h-4 w-4" />
              Nuevo cliente
            </Button>
          )
        }
      />

      {editing && (
        <Card as="section" className="p-5 sm:p-6" aria-label={editing.id ? "Editar cliente" : "Nuevo cliente"}>
          <h2 className="font-medium">{editing.id ? "Editar cliente" : "Nuevo cliente"}</h2>
          <form onSubmit={save} className="mt-4 grid gap-4 sm:grid-cols-2">
            {field("name", "Nombre", { required: true, maxLength: 120, autoFocus: true })}
            {field("company", "Empresa", { maxLength: 200 })}
            {field("email", "Correo", { type: "email", maxLength: 254 })}
            {field("phone", "Teléfono", { maxLength: 40 })}
            <div className="sm:col-span-2">
              <label htmlFor="client-notes" className={LABEL}>
                Notas
              </label>
              <textarea
                id="client-notes"
                rows={3}
                maxLength={2000}
                value={editing.form.notes}
                onChange={(event) => setEditing((current) => (current ? { ...current, form: { ...current.form, notes: event.target.value } } : current))}
                className="field text-base"
              />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" variant="primary" disabled={saving || editing.form.name.trim() === ""}>
                {saving ? "Guardando…" : "Guardar"}
              </Button>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card as="section" className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
            <input aria-label="Buscar clientes" placeholder="Buscar por nombre o empresa" value={search} onChange={(event) => setSearch(event.target.value)} className="field min-h-11 pl-9 text-base" />
          </div>
          <div role="group" aria-label="Estado" className="inline-flex rounded-full border border-line bg-raised p-1 text-sm">
            {(["active", "inactive", "all"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={status === option}
                onClick={() => setStatus(option)}
                className={`rounded-full px-3 py-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft ${status === option ? "bg-primary text-on-primary" : "text-ink-soft hover:text-ink"}`}
              >
                {option === "active" ? "Activos" : option === "inactive" ? "Archivados" : "Todos"}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            {error}
          </p>
        )}

        <div className="mt-5">
          {clients === null ? (
            <div className="space-y-2" aria-busy="true" aria-label="Cargando clientes">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} className="h-16" />
              ))}
            </div>
          ) : clients.length === 0 ? (
            <EmptyState icon={UserPlus} title={search || status !== "active" ? "No hay clientes con ese filtro" : "Todavía no tienes clientes"}>
              {search || status !== "active" ? "Prueba con otra búsqueda." : "Registra uno nuevo o convierte un prospecto desde el Pipeline: aparecerá aquí."}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line-soft">
              {clients.map((client) => (
                <li key={client.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {client.name ?? "Sin nombre"}
                      <Badge tone={client.status === "active" ? "success" : "neutral"}>{client.status === "active" ? "Activo" : "Archivado"}</Badge>
                    </p>
                    <p className="truncate text-sm text-ink-muted">{[client.company, client.email, client.phone].filter(Boolean).join(" · ") || "Sin datos de contacto"}</p>
                    <p className="text-xs text-ink-muted">{`Cliente desde ${formatDate(client.since)}${client.wonAmountMinor > 0 ? ` · Ventas ganadas: ${formatMoney(client.wonAmountMinor)}` : ""}`}</p>
                  </div>
                  {canWrite && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        aria-label={`Editar ${client.name ?? "cliente"}`}
                        onClick={() => setEditing({ id: client.id, form: { name: client.name ?? "", email: client.email ?? "", phone: client.phone ?? "", company: client.company ?? "", notes: client.notes ?? "" } })}
                      >
                        <Pencil aria-hidden className="h-4 w-4" />
                        Editar
                      </Button>
                      {client.status === "active" ? (
                        <Button size="sm" variant="ghost" aria-label={`Archivar ${client.name ?? "cliente"}`} onClick={() => void setClientStatus(client, "inactive")}>
                          <Archive aria-hidden className="h-4 w-4" />
                          Archivar
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" aria-label={`Reactivar ${client.name ?? "cliente"}`} onClick={() => void setClientStatus(client, "active")}>
                          <RotateCcw aria-hidden className="h-4 w-4" />
                          Reactivar
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
