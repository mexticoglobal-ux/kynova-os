"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { API_VERSIONS, APP_KINDS, ENDPOINTS, EVENT_TYPES, logsOf, appsOf, keysOf, publicationsOf, requestsOf, sandboxEventsOf, sandboxesOf, type ApiVersion, type AppKind, type EventType, type LogKind, type Scope } from "@/lib/contracts/platform/dev-center";
import { label } from "@/lib/contracts/platform/dev-messages";
import { FUTURE_PLATFORM, OAUTH_ARCHITECTURE, SDK_CENTER, maskKey, sandboxData } from "@/lib/contracts/platform/koe-dev";
import { hiddenNote, latest } from "@/lib/contracts/platform/display";
import { Section, money, num } from "./InsightsCharts";
import { ScopePicker, day, inputClass, isNex, when, who } from "./DevViews";
import type { DevTabProps } from "./DevCenter";

// ---------------------------------------------------------------- sandbox
export function SandboxTab({ state, persona, send }: DevTabProps) {
  const sandboxes = sandboxesOf(state, persona.tenantId);
  const sandbox = sandboxes.at(-1);
  const events = latest(sandboxEventsOf(state, persona.tenantId), 10);
  const data = sandboxData(state, persona.tenantId);
  const [name, setName] = useState("Pruebas");
  const [latency, setLatency] = useState("120");
  const [errors, setErrors] = useState("0");
  const [emitted, setEmitted] = useState<EventType>("crm.lead.created");
  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">El sandbox es un entorno de pruebas simulado: datos, eventos, errores y latencia inventados. Nada sale de aquí ni toca datos reales.</p>
      {!sandbox
        ? <Card className="space-y-3 p-4" aria-label="Crear el sandbox">
          <p className="font-medium">Crear el entorno de pruebas</p>
          <div className="flex flex-wrap items-center gap-3">
            <input aria-label="Nombre del sandbox" className={`${inputClass} w-48`} value={name} onChange={(event) => setName(event.target.value)} />
            <label className="flex items-center gap-2 text-sm text-ink-muted">Latencia (ms)<input aria-label="Latencia simulada" type="number" className={`${inputClass} w-24`} value={latency} onChange={(event) => setLatency(event.target.value)} /></label>
            <label className="flex items-center gap-2 text-sm text-ink-muted">Errores (%)<input aria-label="Errores simulados" type="number" className={`${inputClass} w-24`} value={errors} onChange={(event) => setErrors(event.target.value)} /></label>
            <Button size="sm" variant="secondary" onClick={() => send({ type: "sandbox.create", name, latencyMs: Number(latency), errorRatePercent: Number(errors) })}>Crear sandbox</Button>
          </div>
        </Card>
        : <>
          <SandboxConfig key={sandbox.updatedAt} sandbox={sandbox} send={send} />

          <Section title="Eventos simulados">
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Evento a emitir" className={inputClass} value={emitted} onChange={(event) => setEmitted(event.target.value as EventType)}>{EVENT_TYPES.map((type) => <option key={type} value={type}>{label("event", type)}</option>)}</select>
              <Button size="sm" variant="secondary" onClick={() => send({ type: "sandbox.emit", event: emitted })}>Emitir evento simulado</Button>
            </div>
            <ul className="space-y-0.5 text-sm text-ink-soft" aria-label="Eventos del sandbox">
              {events.shown.map((item) => <li key={item.id}>{when(item.at)} · {label("event", item.type)} · {item.deliveries} entregas simuladas · {who(item.by)}</li>)}
            </ul>
            {hiddenNote(events.hidden) && <p className="text-xs text-ink-muted">{hiddenNote(events.hidden)}</p>}
          </Section>

          <Section title="Datos simulados" aside="Siempre los mismos para la misma empresa">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left" aria-label="Datos del sandbox">
                <thead><tr className="text-xs text-ink-muted"><th className="px-2 py-1.5">Id</th><th className="px-2 py-1.5">Prospecto</th><th className="px-2 py-1.5">Etapa</th><th className="px-2 py-1.5">Valor</th></tr></thead>
                <tbody>{data.map((row) => <tr key={row.id} className="border-t border-line text-sm"><td className="px-2 py-1.5">{row.id}</td><td className="px-2 py-1.5 font-medium">{row.name}</td><td className="px-2 py-1.5">{row.stage}</td><td className="px-2 py-1.5">{money(row.valueMicros)}</td></tr>)}</tbody>
              </table>
            </div>
          </Section>
        </>}
    </div>
  );
}

function SandboxConfig({ sandbox, send }: { sandbox: { id: string; name: string; latencyMs: number; errorRatePercent: number }; send: DevTabProps["send"] }) {
  const [latency, setLatency] = useState(String(sandbox.latencyMs));
  const [errors, setErrors] = useState(String(sandbox.errorRatePercent));
  return (
    <Card className="space-y-3 p-4" aria-label="Configuración del sandbox">
      <div className="flex flex-wrap items-center gap-2"><p className="font-medium">{sandbox.name}</p><Badge tone="primary">Simulado</Badge></div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-ink-muted">Latencia (ms)<input aria-label="Latencia simulada" type="number" className={`${inputClass} w-24`} value={latency} onChange={(event) => setLatency(event.target.value)} /></label>
        <label className="flex items-center gap-2 text-sm text-ink-muted">Errores (%)<input aria-label="Errores simulados" type="number" className={`${inputClass} w-24`} value={errors} onChange={(event) => setErrors(event.target.value)} /></label>
        <Button size="sm" variant="secondary" onClick={() => send({ type: "sandbox.configure", sandboxId: sandbox.id, latencyMs: Number(latency), errorRatePercent: Number(errors) })}>Guardar</Button>
      </div>
      <p className="text-xs text-ink-muted">Latencia actual {sandbox.latencyMs} ms · {sandbox.errorRatePercent} % de errores simulados. Afectan a las peticiones del API Explorer y a las entregas de los webhooks.</p>
    </Card>
  );
}

// ---------------------------------------------------------------- logs (they only ever grow)
export function LogsTab({ state, persona }: DevTabProps) {
  const [kind, setKind] = useState<LogKind | "">("");
  const all = logsOf(state, persona.tenantId);
  const shown = latest(logsOf(state, persona.tenantId, kind || undefined), 40);
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">Historial de peticiones, errores, eventos, webhooks y API Keys. Los logs nunca se borran: solo crecen.</p>
      <label className="flex items-center gap-2 text-sm text-ink-muted">Tipo
        <select aria-label="Tipo de log" className={inputClass} value={kind} onChange={(event) => setKind(event.target.value as LogKind | "")}>
          <option value="">Todos ({all.length})</option>
          {(["request", "error", "event", "webhook", "key", "app", "access", "proposal", "other"] as const).map((item) => <option key={item} value={item}>{label("logKind", item)}</option>)}
        </select>
      </label>
      <ul className="space-y-0.5 text-sm text-ink-soft" aria-label="Logs">
        {shown.shown.map((entry, index) => <li key={`${entry.at}-${index}`}><Badge tone={entry.kind === "error" ? "danger" : "neutral"}>{label("logKind", entry.kind)}</Badge> {when(entry.at)} · {who(entry.actor)} · {entry.action} · {entry.detail}</li>)}
      </ul>
      {hiddenNote(shown.hidden) && <p className="text-xs text-ink-muted">{hiddenNote(shown.hidden)}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- marketplace apps (a model only: nothing is published)
export function AppsTab({ state, persona, send }: DevTabProps) {
  const apps = appsOf(state, persona.tenantId);
  const publications = publicationsOf(state, persona.tenantId);
  const nex = isNex(persona.actor);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AppKind>("app");
  const [version, setVersion] = useState<ApiVersion>("v1");
  const [scopes, setScopes] = useState<Scope[]>([]);
  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">El modelo de lo que se podrá ofrecer en el Marketplace: apps, plugins, Workers, prompts, templates, automatizaciones y conectores. Es solo arquitectura: no se publica nada.</p>
      <Card className="space-y-3 p-4" aria-label="Nueva aplicación">
        <p className="font-medium">{nex ? "Preparar una aplicación" : "Crear una aplicación"}</p>
        <div className="flex flex-wrap items-center gap-3">
          <input aria-label="Nombre de la aplicación" className={`${inputClass} w-56`} placeholder="Nombre" value={name} onChange={(event) => setName(event.target.value)} />
          <select aria-label="Tipo de aplicación" className={inputClass} value={kind} onChange={(event) => setKind(event.target.value as AppKind)}>{APP_KINDS.map((item) => <option key={item} value={item}>{label("appKind", item)}</option>)}</select>
          <select aria-label="Versión de la API" className={inputClass} value={version} onChange={(event) => setVersion(event.target.value as ApiVersion)}>{API_VERSIONS.map((item) => <option key={item.id} value={item.id}>{item.id} · {label("versionStatus", item.status)}</option>)}</select>
        </div>
        <ScopePicker name="Permisos de la aplicación" value={scopes} onChange={setScopes} />
        <Button size="sm" variant="secondary" onClick={() => send(nex ? { type: "proposal.create", payload: { kind: "app", name, appKind: kind, description: "", scopes, apiVersion: version }, reason: "Propuesta de NEX" } : { type: "app.create", name, appKind: kind, scopes, apiVersion: version })}>{nex ? "Preparar propuesta" : "Crear aplicación"}</Button>
      </Card>

      <ul className="space-y-2" aria-label="Aplicaciones">
        {apps.map((app) => (
          <Card as="li" key={app.id} aria-label={`Aplicación ${app.name}`} className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2"><p className="font-medium">{app.name}</p><Badge tone="primary">{label("appKind", app.kind)}</Badge><Badge tone={app.status === "active" ? "success" : app.status === "paused" ? "warning" : "neutral"}>{label("appStatus", app.status)}</Badge></div>
            <p className="text-xs text-ink-muted">{app.description || "Sin descripción"} · versión {app.apiVersion} · {app.rateLimitRpm} peticiones por minuto · {app.scopes.map((scope) => label("scope", scope)).join(", ")} · {keysOf(state, persona.tenantId).filter((key) => key.appId === app.id && key.status === "active").length} llaves activas</p>
            <div className="flex flex-wrap items-center gap-2">
              {app.status !== "active" && <Button size="sm" variant="secondary" onClick={() => send({ type: "app.setStatus", appId: app.id, to: "active" })}>Activar</Button>}
              {app.status === "active" && <Button size="sm" variant="ghost" onClick={() => send({ type: "app.setStatus", appId: app.id, to: "paused" })}>Pausar</Button>}
              <Button size="sm" variant="secondary" onClick={() => send({ type: "publication.request", appId: app.id })}>Solicitar publicación</Button>
            </div>
          </Card>
        ))}
      </ul>

      <Section title="Solicitudes de publicación" aside="Aprobar una solicitud no publica nada hoy">
        {publications.length === 0 && <p className="text-sm text-ink-muted">No hay solicitudes.</p>}
        <ul className="space-y-2" aria-label="Solicitudes de publicación">
          {publications.map((item) => (
            <Card as="li" key={item.id} aria-label={`Solicitud ${item.id}`} className="space-y-1 p-4">
              <div className="flex flex-wrap items-center gap-2"><Badge tone={item.status === "approved" ? "success" : item.status === "rejected" ? "neutral" : "warning"}>{label("publicationStatus", item.status)}</Badge>{item.via === "authorized" && <Badge tone="accent">Solicitud autorizada</Badge>}<span className="font-medium">{state.apps.find((app) => app.id === item.appId)?.name}</span></div>
              <p className="text-xs text-ink-muted">Pedida por {who(item.requestedBy)} el {day(item.requestedAt)}{item.note ? ` · ${item.note}` : ""}</p>
              {item.status === "requested" && <div className="flex gap-2"><Button size="sm" onClick={() => send({ type: "publication.decide", publicationId: item.id, approve: true })}>Aprobar</Button><Button size="sm" variant="ghost" onClick={() => send({ type: "publication.decide", publicationId: item.id, approve: false })}>Rechazar</Button></div>}
            </Card>
          ))}
        </ul>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- API Explorer (never calls a real API)
export function ExplorerTab({ state, persona, send }: DevTabProps) {
  const keys = keysOf(state, persona.tenantId).filter((item) => item.status === "active");
  const [keyId, setKeyId] = useState("");
  const [endpointId, setEndpointId] = useState(ENDPOINTS[0]?.id ?? "");
  const key = keys.find((item) => item.id === (keyId || keys[0]?.id));
  const endpoint = ENDPOINTS.find((item) => item.id === endpointId) ?? ENDPOINTS[0];
  const app = state.apps.find((item) => item.id === key?.appId);
  const last = requestsOf(state, persona.tenantId).filter((item) => item.source === "explorer").at(-1);
  const parsed = last?.response ? safeJson(last.response) : "";
  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">Explorador visual de la API. Cada petición se responde con una simulación de KOE: nunca se contacta una API real y la llave solo se identifica, no se envía.</p>
      <Card className="space-y-3 p-4" aria-label="Petición">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-muted">API Key
            <select aria-label="API Key de la petición" className={inputClass} value={key?.id ?? ""} onChange={(event) => setKeyId(event.target.value)}>{keys.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted">Endpoint
            <select aria-label="Endpoint" className={inputClass} value={endpoint?.id ?? ""} onChange={(event) => setEndpointId(event.target.value)}>{ENDPOINTS.map((item) => <option key={item.id} value={item.id}>{item.method} {item.path}</option>)}</select>
          </label>
        </div>
        {endpoint && (
          <div className="space-y-2 text-sm">
            <p><Badge tone="primary">{endpoint.method}</Badge> <code>{endpoint.path}</code> · {endpoint.summary}</p>
            <p className="text-xs text-ink-muted">Permiso necesario: {label("scope", endpoint.scope)}</p>
            <ul className="space-y-0.5 text-xs text-ink-soft" aria-label="Headers">
              <li><code>Authorization: Bearer {key ? maskKey(key.prefix, key.last4) : "—"}</code></li>
              <li><code>Content-Type: application/json</code></li>
              <li><code>KYNOVA-Version: {app?.apiVersion ?? "v1"}</code></li>
            </ul>
            <label className="block text-xs text-ink-muted">Body
              <textarea aria-label="Body" readOnly rows={3} className={`${inputClass} mt-1 w-full font-mono text-xs`} value={endpoint.body ?? "(sin body)"} />
            </label>
          </div>
        )}
        <Button size="sm" variant="secondary" disabled={!key || !endpoint} onClick={() => { if (key && endpoint) send({ type: "api.request", keyId: key.id, endpointId: endpoint.id }); }}>Enviar petición simulada</Button>
      </Card>

      <Card className="space-y-2 p-4" aria-label="Respuesta simulada">
        <p className="font-medium">Respuesta simulada</p>
        {last
          ? <><div className="flex flex-wrap items-center gap-2"><Badge tone={last.status < 400 ? "success" : "danger"}>{last.status}</Badge><span className="text-sm">{last.method} {last.path} · {last.latencyMs} ms · versión {last.version}</span>{last.rateLimited && <Badge tone="warning">Límite de peticiones</Badge>}</div><pre className="overflow-x-auto rounded-xl bg-raised p-3 text-xs">{parsed}</pre></>
          : <p className="text-sm text-ink-muted">Todavía no hay respuestas.</p>}
        <p className="text-xs text-ink-muted">{num(requestsOf(state, persona.tenantId).length)} registros de consumo en el historial.</p>
      </Card>
    </div>
  );
}

const safeJson = (text: string): string => {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
};

// ---------------------------------------------------------------- SDK Center, OAuth and the future (all declared, nothing built)
export function SdkTab() {
  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">Todo lo de esta pestaña está declarado y ninguna pieza existe: no hay SDK, OAuth ni superficies futuras. Cada una pasará por KOE, nunca directo.</p>
      <Section title="SDK Center">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="SDK">
          {SDK_CENTER.map((item) => <Card as="li" key={item.id} className="flex items-center justify-between gap-2 p-4"><span className="font-medium">{item.name}</span><Badge tone="neutral">Declarado · no implementado</Badge></Card>)}
        </ul>
      </Section>
      <Section title="OAuth" aside="Arquitectura declarada">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Flujos de OAuth">
          {OAUTH_ARCHITECTURE.map((item) => <Card as="li" key={item.id} className="flex items-center justify-between gap-2 p-4"><span className="font-medium">{item.name}</span><Badge tone="neutral">Sin implementar</Badge></Card>)}
        </ul>
      </Section>
      <Section title="Preparado para el futuro">
        <ul className="flex flex-wrap gap-2" aria-label="Superficies futuras">
          {FUTURE_PLATFORM.map((item) => <li key={item.id}><Badge tone="neutral">{item.name} · no construido</Badge></li>)}
        </ul>
      </Section>
    </div>
  );
}
