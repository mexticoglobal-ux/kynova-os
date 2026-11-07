"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { DISPLAY_LIMIT, hiddenNote, latest } from "@/lib/contracts/platform/display";
import { Card } from "@/components/ui/Card";
import { CONFIG_FIELDS, activationBlockers, grantsAllowed, type Connection, type ConnectionEvent, type ErrorKind, type Grant } from "@/lib/contracts/platform/connection";
import { PROVIDER_MANIFESTS } from "@/lib/contracts/platform/integrations";

const GRANT_LABEL: Record<Grant, string> = { off: "Apagado", approval: "Con aprobación", auto: "Automático" };
const ERROR_KINDS: ErrorKind[] = ["auth", "rateLimit", "network"];
export const ACTOR = "demo";

// One panel for any provider: configuration, permissions, simulated failures and the three feeds. Shared by the
// Integrations Center and the Payments Center, so both behave the same.
export function ConnectionPanel({ connection, message, send }: { connection: Connection; message: string | null; send: (event: ConnectionEvent) => void }) {
  const manifest = PROVIDER_MANIFESTS[connection.provider];
  const fields = CONFIG_FIELDS[connection.provider];
  const [draft, setDraft] = useState(connection.config);
  const now = () => new Date().toISOString();
  const blockers = activationBlockers(connection);
  const canToggle = connection.status === "active" || connection.status === "degraded";

  return (
    <Card as="section" className="space-y-6 p-5" aria-label={`Administrar ${manifest.label}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{manifest.label}</h2>
        <div className="flex flex-wrap gap-2">
          {canToggle ? (
            <Button size="sm" onClick={() => send({ type: "deactivate", actor: ACTOR, at: now() })}>Desactivar</Button>
          ) : (
            <Button size="sm" variant="primary" disabled={blockers.length > 0 || connection.status === "revoked"} onClick={() => send({ type: "activate", actor: ACTOR, at: now() })}>Activar</Button>
          )}
          <Button size="sm" variant="ghost" disabled={connection.status === "notConnected" || connection.status === "revoked"} onClick={() => send({ type: "revoke", actor: ACTOR, at: now() })}>Revocar</Button>
        </div>
      </div>
      {message && <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">{message}</p>}
      {!canToggle && blockers.length > 0 && <p className="text-xs text-ink-muted">Para activar: {blockers[0]}{blockers.length > 1 ? ` (+${blockers.length - 1})` : ""}</p>}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Configuración</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((field) => (
            <label key={field.key} className="space-y-1 text-sm">
              <span className="text-ink-muted">{field.label}{field.required ? " *" : ""}</span>
              {field.kind === "select" ? (
                <select className="w-full rounded-xl border border-line bg-raised px-3 py-2" value={String(draft[field.key] ?? "")} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })}>
                  <option value="">Elegir…</option>
                  {field.options?.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              ) : (
                <input className="w-full rounded-xl border border-line bg-raised px-3 py-2" placeholder={field.kind === "secretRef" ? "secret:nombre" : undefined} value={String(draft[field.key] ?? "")} onChange={(event) => setDraft({ ...draft, [field.key]: event.target.value })} />
              )}
            </label>
          ))}
        </div>
        <p className="text-xs text-ink-muted">Nunca escriba aquí un secreto: solo una referencia (secret:nombre).</p>
        <Button size="sm" variant="secondary" disabled={connection.status === "revoked"} onClick={() => send({ type: "configure", actor: ACTOR, at: now(), config: draft })}>Guardar configuración</Button>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Permisos</h3>
        <ul className="space-y-2">
          {manifest.capabilities.map((capability) => (
            <li key={capability} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{capability}</span>
              <select aria-label={`Permiso ${capability}`} className="rounded-xl border border-line bg-raised px-3 py-1.5" value={connection.permissions[capability] ?? "off"} onChange={(event) => send({ type: "setPermissions", actor: ACTOR, at: now(), permissions: { [capability]: event.target.value as Grant } })}>
                {grantsAllowed(capability).map((grant) => <option key={grant} value={grant}>{GRANT_LABEL[grant]}</option>)}
              </select>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Simular un fallo</h3>
        <div className="flex flex-wrap gap-2">
          {ERROR_KINDS.map((kind) => (
            <Button key={kind} size="sm" variant="ghost" disabled={connection.status === "notConnected"} onClick={() => send({ type: "fail", at: now(), kind, message: `Fallo simulado (${kind})` })}>{kind}</Button>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Feed title="Registros" empty="Sin registros" items={connection.logs.map((entry) => ({ key: entry.at + entry.event, text: `${entry.level.toUpperCase()} · ${entry.event}`, at: entry.at }))} />
        <Feed title="Errores" empty="Sin errores" items={connection.errors.map((entry) => ({ key: entry.at + entry.message, text: `${entry.kind} · ${entry.message}${entry.retryable ? " (reintentable)" : ""}`, at: entry.at }))} />
        <Feed title="Auditoría" empty="Sin cambios" items={connection.audit.map((entry) => ({ key: entry.at + entry.action, text: `${entry.actor} · ${entry.action}`, at: entry.at }))} />
      </div>
    </Card>
  );
}

function Feed({ title, empty, items }: { title: string; empty: string; items: { key: string; text: string; at: string }[] }) {
  const { shown, hidden } = latest(items, DISPLAY_LIMIT);
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-ink-muted">{empty}</p>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-auto text-xs text-ink-muted">
          {shown.map((item, index) => <li key={`${item.key}-${index}`}>{item.text}</li>)}
        </ul>
      )}
      {hiddenNote(hidden) && <p className="text-xs text-ink-muted">{hiddenNote(hidden)}</p>}
    </section>
  );
}
