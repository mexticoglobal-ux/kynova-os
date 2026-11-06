"use client";

import { useMemo, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Plug } from "lucide-react";
import {
  CONFIG_FIELDS,
  activationBlockers,
  grantsAllowed,
  newConnection,
  reduce,
  type Connection,
  type ConnectionEvent,
  type ErrorKind,
  type Grant,
} from "@/lib/contracts/platform/connection";
import { PROVIDER_IDS, PROVIDER_MANIFESTS, type ConnectionStatus, type ProviderId } from "@/lib/contracts/platform/integrations";

const STATUS_LABEL: Record<ConnectionStatus, string> = { notConnected: "No conectado", pending: "Pendiente", active: "Activo", degraded: "Degradado", paused: "Pausado", error: "Con error", revoked: "Revocado" };
const STATUS_TONE: Record<ConnectionStatus, BadgeTone> = { notConnected: "neutral", pending: "warning", active: "success", degraded: "warning", paused: "neutral", error: "danger", revoked: "danger" };
const GRANT_LABEL: Record<Grant, string> = { off: "Apagado", approval: "Con aprobación", auto: "Automático" };
const ERROR_KINDS: ErrorKind[] = ["auth", "rateLimit", "network"];
const ACTOR = "demo";

// Demo state only: nothing here reaches a provider. The same reducer will run on the server once adapters exist.
export function IntegrationsCenter() {
  const [connections, setConnections] = useState<Record<ProviderId, Connection>>(() => Object.fromEntries(PROVIDER_IDS.map((id) => [id, newConnection(id)])) as Record<ProviderId, Connection>);
  const [selected, setSelected] = useState<ProviderId | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const send = (provider: ProviderId, event: ConnectionEvent) => {
    const result = reduce(connections[provider], event);
    setConnections((current) => ({ ...current, [provider]: result.connection }));
    setMessage(result.error ?? null);
  };

  const active = useMemo(() => PROVIDER_IDS.filter((id) => connections[id].status === "active").length, [connections]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted" aria-live="polite">
        {active} de {PROVIDER_IDS.length} activos · simulación local: no se contacta a ningún proveedor.
      </p>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {PROVIDER_IDS.map((id) => {
          const connection = connections[id];
          return (
            <Card as="li" key={id} className="space-y-3 p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">{PROVIDER_MANIFESTS[id].label}</h2>
                <Badge tone={STATUS_TONE[connection.status]}>{STATUS_LABEL[connection.status]}</Badge>
              </div>
              {connection.errors.length > 0 && <p className="text-xs text-danger">{connection.errors.length} errores registrados</p>}
              <Button size="sm" variant={selected === id ? "primary" : "secondary"} onClick={() => { setSelected(selected === id ? null : id); setMessage(null); }}>
                {selected === id ? "Cerrar" : "Administrar"}
              </Button>
            </Card>
          );
        })}
      </ul>
      {selected ? (
        <Detail connection={connections[selected]} message={message} send={(event) => send(selected, event)} />
      ) : (
        <EmptyState icon={Plug} title="Elija una integración">Aquí verá su configuración, permisos, registros, errores y auditoría.</EmptyState>
      )}
    </div>
  );
}

function Detail({ connection, message, send }: { connection: Connection; message: string | null; send: (event: ConnectionEvent) => void }) {
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
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-ink-muted">{empty}</p>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-auto text-xs text-ink-muted">
          {items.slice(-20).reverse().map((item, index) => <li key={`${item.key}-${index}`}>{item.text}</li>)}
        </ul>
      )}
    </section>
  );
}
