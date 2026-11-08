"use client";

import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EVENT_TYPES, MAX_DELIVERY_ATTEMPTS, RETRY_BACKOFF_MINUTES, SCOPES, SIGNATURE_ALGORITHM, analysesOf, appsOf, deliveriesOf, grantsOf, keysOf, proposalsOf, webhooksOf, type EventType, type ProposalPayload, type Scope } from "@/lib/contracts/platform/dev-center";
import { label } from "@/lib/contracts/platform/dev-messages";
import { devDashboard, maskKey, type RateStatus } from "@/lib/contracts/platform/koe-dev";
import { hiddenNote, latest } from "@/lib/contracts/platform/display";
import { Kpi, Ranking, Section, num } from "./InsightsCharts";
import type { DevTabProps } from "./DevCenter";

export const SEVERITY_TONE: Record<string, BadgeTone> = { normal: "primary", high: "warning" };
export const RATE_TONE: Record<RateStatus, BadgeTone> = { ok: "success", warn: "warning", atLimit: "warning", over: "danger" };
export const inputClass = "rounded-xl border border-line bg-raised px-3 py-1.5 text-sm text-ink";
export const when = (iso: string) => iso.slice(0, 16).replace("T", " ");
export const day = (iso: string) => iso.slice(0, 10);
export const who = (actor: string) => (actor.startsWith("worker:") ? "NEX (IA)" : actor === "system" ? "Plataforma" : actor);
export const isNex = (actor: string) => actor.startsWith("worker:");

/** A group of checkboxes for the scopes an app or a key may have. */
export function ScopePicker({ value, onChange, allowed = SCOPES, name }: { value: readonly Scope[]; onChange: (next: Scope[]) => void; allowed?: readonly Scope[]; name: string }) {
  return (
    <fieldset className="flex flex-wrap gap-x-4 gap-y-1" aria-label={name}>
      {allowed.map((scope) => (
        <label key={scope} className="flex items-center gap-1.5 text-sm text-ink-soft">
          <input type="checkbox" checked={value.includes(scope)} onChange={(event) => onChange(event.target.checked ? [...value, scope] : value.filter((item) => item !== scope))} />
          {label("scope", scope)}
        </label>
      ))}
    </fieldset>
  );
}

export function EventPicker({ value, onChange, name }: { value: readonly EventType[]; onChange: (next: EventType[]) => void; name: string }) {
  return (
    <fieldset className="flex flex-wrap gap-x-4 gap-y-1" aria-label={name}>
      {EVENT_TYPES.map((type) => (
        <label key={type} className="flex items-center gap-1.5 text-sm text-ink-soft">
          <input type="checkbox" checked={value.includes(type)} onChange={(event) => onChange(event.target.checked ? [...value, type] : value.filter((item) => item !== type))} />
          {label("event", type)}
        </label>
      ))}
    </fieldset>
  );
}

const describePayload = (payload: ProposalPayload, appName: (id: string) => string): string =>
  payload.kind === "key" ? `Crear la API Key «${payload.name}» para ${appName(payload.appId)}` : payload.kind === "webhook" ? `Crear el webhook ${payload.url}` : `Crear la aplicación «${payload.name}» (${label("appKind", payload.appKind)})`;

// ---------------------------------------------------------------- dashboard
export function DashboardTab({ state, asOf, persona, send }: DevTabProps) {
  const d = devDashboard(state, persona.tenantId, asOf);
  const proposals = proposalsOf(state, persona.tenantId);
  const analyses = analysesOf(state, persona.tenantId);
  const grant = grantsOf(state, persona.tenantId).find((item) => item.status === "active");
  if (!d) return <p className="text-sm text-ink-muted">Esta empresa todavía no tiene una cuenta de desarrollo.</p>;
  const appName = (id: string) => state.apps.find((item) => item.id === id)?.name ?? id;
  const worst = d.rate.filter((row) => row.status !== "ok");
  const rank = (rows: readonly { id: string; label: string; requests: number; errors: number }[]) => rows.map((row) => ({ id: row.id, label: row.label, value: row.requests, note: row.errors > 0 ? `${num(row.errors)} errores` : undefined }));
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Kpi label="API Keys" value={num(d.keys.active)} hint={`activas de ${d.keys.total} · ${d.keys.revoked} revocadas · ${d.keys.expired} expiradas`} />
        <Kpi label="Aplicaciones" value={num(d.apps.total)} hint={`${d.apps.active} activas · ${d.apps.draft} borradores · ${d.apps.paused} pausadas`} />
        <Kpi label="Webhooks" value={num(d.webhooks.active)} hint={`activos de ${d.webhooks.total} · ${d.webhooks.paused} pausados · ${d.webhooks.deleted} eliminados`} />
        <Kpi label="Eventos" value={num(d.events.emitted)} hint={`${d.events.deliveries} entregas simuladas · ${d.events.failed} fallidas`} tone={d.events.failed > 0 ? "warn" : "good"} />
        <Kpi label="SDK" value={num(d.sdks)} hint="declarados · ninguno implementado" />
        <Kpi label="Sandbox" value={d.sandbox ? d.sandbox.name : "Sin sandbox"} hint={d.sandbox ? `latencia ${d.sandbox.latencyMs} ms · ${d.sandbox.errorRatePercent} % de errores simulados` : "créelo en la pestaña Sandbox"} />
        <Kpi label="Versiones" value={d.versions.filter((item) => item.apps > 0).map((item) => item.id).join(", ") || "—"} hint="en uso por las aplicaciones" />
        <Kpi label="Consumo" value={`${num(d.consumption.requests)} peticiones`} hint={`${d.consumption.windowDays} días · ${d.consumption.errorRatePercent === null ? "sin datos" : `${d.consumption.errorRatePercent} % de errores`}`} />
        <Kpi label="Rate Limits" value={`${num(d.planRpm)} por minuto`} hint={worst.length > 0 ? `${worst.length} por revisar` : "todo en orden"} tone={worst.length > 0 ? "warn" : "good"} />
        <Kpi label="Logs" value={num(d.logs)} hint="nunca se borran" />
      </div>

      <Section title="Recomendaciones de KOE" aside="Todas salen del mismo motor; ninguna se aplica sola">
        {d.recommendations.length === 0 && <p className="text-sm text-ink-muted">KOE no tiene recomendaciones por ahora.</p>}
        <ul className="space-y-2" aria-label="Recomendaciones de KOE">
          {d.recommendations.map((item) => (
            <Card as="li" key={item.id} className="flex flex-wrap items-center gap-3 p-4">
              <Badge tone={SEVERITY_TONE[item.severity]}>{label("severity", item.severity)}</Badge>
              <Badge tone="neutral">{label("recommendation", item.kind)}</Badge>
              <div className="min-w-0 flex-1"><p className="font-medium">{item.text}</p><p className="text-xs text-ink-muted">{item.reason}</p></div>
            </Card>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => send({ type: "dev.analyze" })}>Pedir un análisis a KOE</Button>
          <span className="text-xs text-ink-muted">Cada análisis guarda el Worker, el modelo y su costo estimado; no se sobrescribe.</span>
        </div>
        <ul className="space-y-0.5 text-sm text-ink-soft" aria-label="Historial de análisis de KOE">
          {[...analyses].reverse().slice(0, 4).map((item) => <li key={item.id}>{when(item.at)} · {item.workerName} · modelo {item.model.label} · {item.recommendationIds.length} recomendaciones</li>)}
        </ul>
      </Section>

      <Section title="Rate limits" aside="Por empresa, aplicación y API Key; el plan fija el tope de la empresa">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left" aria-label="Rate limits">
            <thead><tr className="text-xs text-ink-muted"><th className="px-2 py-1.5">Nivel</th><th className="px-2 py-1.5">Nombre</th><th className="px-2 py-1.5">Último minuto</th><th className="px-2 py-1.5">Límite propio</th><th className="px-2 py-1.5">Límite efectivo</th><th className="px-2 py-1.5">Estado</th></tr></thead>
            <tbody>
              {d.rate.map((row) => (
                <tr key={`${row.level}-${row.id}`} className="border-t border-line text-sm">
                  <td className="px-2 py-1.5">{label("rateLevel", row.level)}</td><td className="px-2 py-1.5 font-medium">{row.name}</td><td className="px-2 py-1.5">{num(row.used)}</td><td className="px-2 py-1.5">{num(row.limit)}</td><td className="px-2 py-1.5">{num(row.effective)}</td>
                  <td className="px-2 py-1.5"><Badge tone={RATE_TONE[row.status]}>{label("rateStatus", row.status)}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Consumo por aplicación"><Ranking rows={rank(d.consumption.byApp)} format={num} empty="Todavía no hay consumo." /></Section>
        <Section title="Consumo por endpoint"><Ranking rows={rank(d.consumption.byEndpoint)} format={num} empty="Todavía no hay consumo." /></Section>
      </div>

      <Section title="Versiones de la API">
        <ul className="space-y-1 text-sm text-ink-soft" aria-label="Versiones">
          {d.versions.map((version) => <li key={version.id}><span className="font-medium">{version.id}</span> · {label("versionStatus", version.status as "stable")} · {version.apps} aplicaciones · {version.note}</li>)}
        </ul>
      </Section>

      <Section title="Propuestas de NEX" aside="Nivel 1 prepara; una persona aprueba y se aplica como esa persona">
        {proposals.length === 0 && <p className="text-sm text-ink-muted">No hay propuestas.</p>}
        <ul className="space-y-2" aria-label="Propuestas">
          {proposals.map((item) => (
            <Card as="li" key={item.id} aria-label={`Propuesta ${item.id}`} className="space-y-1 p-4">
              <div className="flex flex-wrap items-center gap-2"><Badge tone="primary">{label("proposalKind", item.payload.kind)}</Badge><Badge tone={item.status === "approved" ? "success" : item.status === "rejected" ? "neutral" : "warning"}>{label("proposalStatus", item.status)}</Badge><span className="font-medium">{describePayload(item.payload, appName)}</span></div>
              <p className="text-xs text-ink-muted">Propuesta de {who(item.proposedBy)} · {item.reason}</p>
              {item.status === "proposed" && <div className="flex gap-2"><Button size="sm" onClick={() => send({ type: "proposal.approve", proposalId: item.id })}>Aprobar</Button><Button size="sm" variant="ghost" onClick={() => send({ type: "proposal.reject", proposalId: item.id })}>Rechazar</Button></div>}
            </Card>
          ))}
        </ul>
      </Section>

      <Card className="space-y-2 p-4" aria-label="Autorización para solicitar publicaciones">
        <p className="font-medium">Autorización para que NEX solicite una publicación (Nivel 2)</p>
        {grant
          ? <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="success">Vigente</Badge><span>{grant.maxPerDay ? `hasta ${grant.maxPerDay} solicitud por día` : "sin límite diario"} · concedida por {who(grant.grantedBy)}{grant.expiresAt ? ` · vence el ${day(grant.expiresAt)}` : ""}</span><Button size="sm" variant="ghost" onClick={() => send({ type: "authorization.revoke", grantId: grant.id })}>Revocar</Button></div>
          : <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="warning">Sin autorización</Badge><Button size="sm" variant="secondary" onClick={() => send({ type: "authorization.grant", maxPerDay: 1 })}>Conceder una solicitud por día</Button></div>}
        <p className="text-xs text-ink-muted">Solo es una solicitud: una persona la decide y hoy no se publica nada. NEX nunca crea credenciales, activa apps, publica ni borra logs.</p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- API keys
export function KeysTab({ state, persona, send, sendAsPlatform }: DevTabProps) {
  const apps = appsOf(state, persona.tenantId);
  const keys = keysOf(state, persona.tenantId);
  const nex = isNex(persona.actor);
  const [appId, setAppId] = useState("");
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [editing, setEditing] = useState<{ id: string; name: string; rate: string } | null>(null);
  const chosen = apps.find((item) => item.id === (appId || apps[0]?.id));
  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">Las llaves son simuladas (empiezan por «kyn_sim_»). La llave completa se muestra una sola vez, al crearla o regenerarla; después solo se ve su prefijo y sus últimos cuatro caracteres.</p>
      <Card className="space-y-3 p-4" aria-label="Nueva API Key">
        <p className="font-medium">{nex ? "Preparar una API Key" : "Crear una API Key"}</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-muted">Aplicación
            <select aria-label="Aplicación de la llave" className={inputClass} value={chosen?.id ?? ""} onChange={(event) => { setAppId(event.target.value); setScopes([]); }}>
              {apps.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <input aria-label="Nombre de la llave" className={`${inputClass} w-56`} placeholder="Nombre de la llave" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        {chosen && <ScopePicker name="Permisos de la llave" value={scopes} allowed={chosen.scopes} onChange={setScopes} />}
        <Button size="sm" variant="secondary" disabled={!chosen} onClick={() => { if (chosen) send(nex ? { type: "proposal.create", payload: { kind: "key", appId: chosen.id, name, scopes }, reason: "Propuesta de NEX" } : { type: "key.create", appId: chosen.id, name, scopes }); }}>{nex ? "Preparar propuesta" : "Crear API Key"}</Button>
      </Card>

      <ul className="space-y-2" aria-label="API Keys">
        {keys.map((key) => (
          <Card as="li" key={key.id} aria-label={`API Key ${key.name}`} className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{key.name}</p><Badge tone={key.status === "active" ? "success" : key.status === "revoked" ? "danger" : "neutral"}>{label("keyStatus", key.status)}</Badge>
              <code className="text-xs text-ink-soft">{maskKey(key.prefix, key.last4)}</code>
            </div>
            <p className="text-xs text-ink-muted">{state.apps.find((item) => item.id === key.appId)?.name} · {key.scopes.map((scope) => label("scope", scope)).join(", ")} · {key.rateLimitRpm} peticiones por minuto · creada el {day(key.createdAt)} por {who(key.createdBy)}{key.expiresAt ? ` · expira el ${day(key.expiresAt)}` : ""}{key.lastUsedAt ? ` · último uso ${day(key.lastUsedAt)}` : " · sin uso"}{key.revokedAt ? ` · revocada el ${day(key.revokedAt)}` : ""}</p>
            {key.status === "active" && (
              <div className="flex flex-wrap items-center gap-2">
                {editing?.id === key.id
                  ? <>
                    <input aria-label="Nuevo nombre" className={`${inputClass} w-44`} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
                    <input aria-label="Nuevo límite por minuto" type="number" min={1} className={`${inputClass} w-24`} value={editing.rate} onChange={(event) => setEditing({ ...editing, rate: event.target.value })} />
                    <Button size="sm" onClick={() => { send({ type: "key.update", keyId: key.id, name: editing.name, rateLimitRpm: Number(editing.rate) }); setEditing(null); }}>Guardar</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button>
                  </>
                  : <Button size="sm" variant="secondary" onClick={() => setEditing({ id: key.id, name: key.name, rate: String(key.rateLimitRpm) })}>Editar</Button>}
                <Button size="sm" variant="secondary" onClick={() => send({ type: "key.regenerate", keyId: key.id })}>Regenerar</Button>
                <Button size="sm" variant="ghost" onClick={() => send({ type: "key.revoke", keyId: key.id })}>Revocar</Button>
                {key.expiresAt && <Button size="sm" variant="ghost" onClick={() => sendAsPlatform({ type: "key.expire", keyId: key.id })}>Simular su expiración (plataforma)</Button>}
              </div>
            )}
          </Card>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- webhooks (architecture only)
export function WebhooksTab({ state, persona, send }: DevTabProps) {
  const hooks = webhooksOf(state, persona.tenantId);
  const deliveries = latest(deliveriesOf(state, persona.tenantId), 20); // the newest first
  const nex = isNex(persona.actor);
  const [url, setUrl] = useState("https://");
  const [events, setEvents] = useState<EventType[]>([]);
  const [editing, setEditing] = useState<{ id: string; url: string } | null>(null);
  const [simulated, setSimulated] = useState<EventType>("crm.lead.created");
  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">Todo es arquitectura: ningún webhook sale de la simulación. Cada entrega la decide KOE y va firmada ({SIGNATURE_ALGORITHM}); si falla, se puede reintentar hasta {MAX_DELIVERY_ATTEMPTS} intentos en total (espera declarada de {RETRY_BACKOFF_MINUTES.join(", ")} minutos).</p>
      <Card className="space-y-3 p-4" aria-label="Nuevo webhook">
        <p className="font-medium">{nex ? "Preparar un webhook" : "Crear un webhook"}</p>
        <input aria-label="Dirección del webhook" className={`${inputClass} w-full max-w-md`} value={url} onChange={(event) => setUrl(event.target.value)} />
        <EventPicker name="Eventos del webhook" value={events} onChange={setEvents} />
        <Button size="sm" variant="secondary" onClick={() => send(nex ? { type: "proposal.create", payload: { kind: "webhook", url, events }, reason: "Propuesta de NEX" } : { type: "webhook.create", url, events })}>{nex ? "Preparar propuesta" : "Crear webhook"}</Button>
      </Card>

      <Section title="Webhooks">
        <label className="flex items-center gap-2 text-sm text-ink-muted">Evento a simular
          <select aria-label="Evento a simular" className={inputClass} value={simulated} onChange={(event) => setSimulated(event.target.value as EventType)}>
            {EVENT_TYPES.map((type) => <option key={type} value={type}>{label("event", type)}</option>)}
          </select>
        </label>
        <ul className="space-y-2" aria-label="Webhooks">
          {hooks.map((hook) => (
            <Card as="li" key={hook.id} aria-label={`Webhook ${hook.url}`} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2"><p className="font-medium break-all">{hook.url}</p><Badge tone={hook.status === "active" ? "success" : hook.status === "paused" ? "warning" : "neutral"}>{label("webhookStatus", hook.status)}</Badge><code className="text-xs text-ink-soft">{hook.secretPrefix}…</code></div>
              <p className="text-xs text-ink-muted">{hook.events.map((type) => label("event", type)).join(", ")}</p>
              {hook.status !== "deleted" && (
                <div className="flex flex-wrap items-center gap-2">
                  {editing?.id === hook.id
                    ? <><input aria-label="Nueva dirección" className={`${inputClass} w-72`} value={editing.url} onChange={(event) => setEditing({ ...editing, url: event.target.value })} /><Button size="sm" onClick={() => { send({ type: "webhook.update", webhookId: hook.id, url: editing.url }); setEditing(null); }}>Guardar</Button><Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancelar</Button></>
                    : <Button size="sm" variant="secondary" onClick={() => setEditing({ id: hook.id, url: hook.url })}>Editar</Button>}
                  <Button size="sm" variant="secondary" onClick={() => send({ type: "webhook.setStatus", webhookId: hook.id, to: hook.status === "active" ? "paused" : "active" })}>{hook.status === "active" ? "Pausar" : "Reanudar"}</Button>
                  <Button size="sm" variant="secondary" onClick={() => send({ type: "webhook.simulate", webhookId: hook.id, event: simulated })}>Simular un evento</Button>
                  <Button size="sm" variant="secondary" onClick={() => send({ type: "webhook.rotateSecret", webhookId: hook.id })}>Rotar el secreto</Button>
                  <Button size="sm" variant="ghost" onClick={() => send({ type: "webhook.delete", webhookId: hook.id })}>Eliminar</Button>
                </div>
              )}
            </Card>
          ))}
        </ul>
      </Section>

      <Section title="Historial de entregas" aside="Cada intento se conserva; un webhook eliminado deja de funcionar pero su historial no se borra">
        {deliveries.shown.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay entregas.</p>}
        <ul className="space-y-2" aria-label="Entregas">
          {deliveries.shown.map((item) => (
            <Card as="li" key={item.id} aria-label={`Entrega ${item.id}`} className="space-y-1 p-4">
              <div className="flex flex-wrap items-center gap-2"><Badge tone={item.status === "delivered" ? "success" : item.status === "failed" ? "warning" : "danger"}>{label("deliveryStatus", item.status)}</Badge><span className="text-sm font-medium">{label("event", item.event)}</span><span className="text-xs text-ink-muted">{when(item.at)} · {state.webhooks.find((hook) => hook.id === item.webhookId)?.url}</span></div>
              <p className="text-xs text-ink-muted">Firma {item.signature} · {item.attempts.map((attempt, index) => `intento ${index + 1}: ${attempt.status} (${attempt.latencyMs} ms)`).join(" · ")}</p>
              {item.status === "failed" && <Button size="sm" variant="secondary" onClick={() => send({ type: "webhook.retry", deliveryId: item.id })}>Reintentar</Button>}
            </Card>
          ))}
        </ul>
        {hiddenNote(deliveries.hidden) && <p className="text-xs text-ink-muted">{hiddenNote(deliveries.hidden)}</p>}
      </Section>
    </div>
  );
}
