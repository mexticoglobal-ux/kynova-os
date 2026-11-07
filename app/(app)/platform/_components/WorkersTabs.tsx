"use client";

import { useState, type ReactNode } from "react";
import { Inbox } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { hiddenNote, latest } from "@/lib/contracts/platform/display";
import { autonomyOf, definitionOf, delegationGraph, effectivePriority, instanceFor, instanceUsage, koeMetrics, memoryOf } from "@/lib/contracts/platform/koe-engine";
import { label } from "@/lib/contracts/platform/koe-messages";
import { CLEARANCES, MODEL_CLASSES, PRIORITIES, formatCostMicros, modelAvailability, routeModel, validateModel, type Clearance, type ModelClass, type ModelManifest, type Priority, type WorkerDefinition } from "@/lib/contracts/platform/koe-registry";
import { levelForAction, type AutonomyLevel } from "@/lib/contracts/platform/workers";
import type { WorkersTabProps } from "./WorkersCenter";

export const input = "w-full rounded-xl border border-line bg-raised px-3 py-2 text-sm";
export const day = (iso?: string) => (iso ? iso.slice(0, 10) : "—");
const LEVEL_TONE: Record<AutonomyLevel, BadgeTone> = { 1: "success", 2: "warning", 3: "danger" };
const STATUS_TONE: Record<WorkerDefinition["status"], BadgeTone> = { draft: "neutral", pendingReview: "warning", active: "success", retired: "neutral" };

export function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-ink-muted">{name}</span>
      {children}
    </label>
  );
}
export const Empty = ({ title, children }: { title: string; children?: string }) => <EmptyState icon={Inbox} title={title}>{children}</EmptyState>;
export const AdminOnly = () => <Empty title="Solo administración">Elija una persona de la administración en «Actuar como».</Empty>;
export const LevelBadge = ({ level }: { level: AutonomyLevel }) => <Badge tone={LEVEL_TONE[level]}>{label("level", String(level) as "1" | "2" | "3")}</Badge>;

/** The tools of a Worker with what a person should know about each: its level, and whether it acts outside or moves money. */
export function ToolChips({ state, tools }: { state: WorkersTabProps["state"]; tools: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {tools.map((id) => {
        const manifest = state.tools[id]?.manifest;
        return (
          <li key={id}>
            <Badge tone={LEVEL_TONE[levelForAction(id)]}>{manifest?.label ?? id} · N{levelForAction(id)}{manifest?.externalEffect ? " · externo" : ""}{manifest?.financial ? " · dinero" : ""}</Badge>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- Workers: installed, available, status, models, configuration
const INSTANCE_TONE = { active: "success", paused: "warning", disabled: "danger" } as const;
export const PRIORITY_TONE = { low: "neutral", normal: "primary", high: "warning", critical: "danger" } as const;

export function WorkersTab({ state, send, persona, admin }: WorkersTabProps) {
  const [reason, setReason] = useState("");
  const visible = state.definitions.filter((definition) => definition.ownerTenantId === persona.tenantId || (definition.origin === "kynova" && (definition.status === "active" || admin)));
  const hasInstance = (definition: WorkerDefinition) => Boolean(instanceFor(state, persona.tenantId, definition.id));
  const installed = visible.filter(hasInstance);
  const available = visible.filter((definition) => !hasInstance(definition) && definition.status === "active");
  const preparing = visible.filter((definition) => !hasInstance(definition) && definition.status !== "active");
  const edges = delegationGraph(state, persona.tenantId);
  const metrics = koeMetrics(state, persona.tenantId);

  const section = (title: string, items: WorkerDefinition[], empty: string) => (
    <section className="space-y-3" aria-label={title}>
      <h2 className="font-semibold">{title} ({items.length})</h2>
      {items.length === 0 ? <p className="text-xs text-ink-muted">{empty}</p> : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {items.map((definition) => <WorkerCard key={definition.id} definition={definition} state={state} send={send} persona={persona} admin={admin} reason={reason} />)}
        </ul>
      )}
    </section>
  );

  return (
    <div className="space-y-6">
      <Card className="space-y-2 p-5">
        <h2 className="font-semibold">Motivo</h2>
        <input aria-label="Motivo" className={input} placeholder="Obligatorio para rechazar un Worker" value={reason} onChange={(event) => setReason(event.target.value)} />
        <p className="text-xs text-ink-muted">Un Worker nuevo es solo datos: especialidad, herramientas, memoria, modelos y colaboración. Lo envía una persona y lo aprueba otra distinta.</p>
      </Card>
      <Card className="space-y-1 p-5" aria-label="Métricas de KOE">
        <h2 className="font-semibold">Costo estimado de sus ejecuciones</h2>
        <p className="text-xl font-semibold">{formatCostMicros(metrics.estimatedCostMicros)}</p>
        <p className="text-xs text-ink-muted">{metrics.runs} ejecuciones · {metrics.steps} pasos · {metrics.tokens.toLocaleString("es-CR")} tokens simulados. Es una estimación para futuras métricas de KOE: no es una factura ni limita nada.</p>
      </Card>
      {section("Instalados en su empresa", installed, "Todavía no instaló ningún Worker: elija uno de los disponibles.")}
      {section("Disponibles para instalar", available, "No hay más Workers disponibles para su empresa.")}
      {section("En preparación y retirados", preparing, "Aquí aparecen los borradores, los que esperan revisión y los retirados.")}

      <Card className="space-y-2 p-5">
        <h2 className="font-semibold">Colaboración en su empresa</h2>
        <p className="text-xs text-ink-muted">Una flecha existe solo si ambos Workers están activados y se aceptan entre sí. Delegar nunca amplía lo que un Worker puede hacer.</p>
        {edges.length === 0 ? <p className="text-xs text-ink-muted">Todavía no hay colaboración posible: active más de un Worker.</p> : (
          <ul className="flex flex-wrap gap-2">{edges.map((edge) => <li key={`${edge.from}>${edge.to}`}><Badge tone="accent">{definitionOf(state, edge.from)?.name} → {definitionOf(state, edge.to)?.name}</Badge></li>)}</ul>
        )}
      </Card>
    </div>
  );
}

function WorkerCard({ definition, state, send, persona, admin, reason }: { definition: WorkerDefinition; state: WorkersTabProps["state"]; send: WorkersTabProps["send"]; persona: WorkersTabProps["persona"]; admin: boolean; reason: string }) {
  const instance = instanceFor(state, persona.tenantId, definition.id);
  const [limits, setLimits] = useState<Record<string, string>>({});
  const [runs, setRuns] = useState(String(instance?.maxRunsPerDay ?? definition.limits.maxRunsPerDay));
  const [excluded, setExcluded] = useState((instance?.deniedProviders ?? []).join(", "));
  const [priority, setPriority] = useState<Priority>(effectivePriority(definition, instance));
  const names = (ids: readonly string[]) => (ids.length === 0 ? "nadie" : ids.map((id) => (id === "*" ? "cualquiera" : definitionOf(state, id)?.name ?? id)).join(", "));
  const summary = autonomyOf(definition, state.tools);
  const usage = instance ? instanceUsage(state, instance, new Date().toISOString()) : null;
  const owner = definition.origin === "kynova" ? admin : definition.ownerTenantId === persona.tenantId;
  const level2 = definition.tools.filter((id) => levelForAction(id) === 2);
  const models = modelAvailability(state.models, definition, instance?.deniedProviders ?? []);
  const usable = models.filter((entry) => entry.usable);
  const blocked = models.filter((entry) => !entry.usable);

  return (
    <Card as="li" className="space-y-3 p-5" aria-label={`Worker ${definition.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{definition.name}</h2>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="primary">{label("specialty", definition.specialty)}</Badge>
          <Badge>{label("origin", definition.origin)}</Badge>
          <Badge tone={STATUS_TONE[definition.status]}>{label("definitionStatus", definition.status)}</Badge>
          {instance && <Badge tone={INSTANCE_TONE[instance.status]}>{label("instanceStatus", instance.status)}</Badge>}
          <Badge tone={PRIORITY_TONE[effectivePriority(definition, instance)]}>Prioridad {label("priority", effectivePriority(definition, instance))}</Badge>
        </div>
      </div>
      <p className="text-sm text-ink-muted">{definition.summary}</p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted"><span>Autonomía máxima:</span><LevelBadge level={summary.highest} /></div>
      <ToolChips state={state} tools={definition.tools} />
      <ul className="space-y-0.5 text-xs text-ink-muted">
        <li>Datos hasta: {label("clearance", definition.dataClearance)}</li>
        <li>Memoria: {definition.memory.maxEntries} entradas, {definition.memory.maxChars} caracteres{definition.memory.durable ? " · puede conservar" : " · solo de la ejecución"}{definition.memory.allowPersonal ? " · admite datos personales" : ""}</li>
        <li>Modelos que necesita: {definition.routing.needs.map((need) => label("modelClass", need)).join(", ")}</li>
        <li>Delega en: {names(definition.collaboration.delegatesTo)} · Recibe de: {names(definition.collaboration.acceptsFrom)}</li>
        <li>Límites: {definition.limits.maxRunsPerDay} ejecuciones al día · {definition.limits.maxStepsPerRun} pasos · delegación hasta {definition.limits.maxDelegationDepth}</li>
        <li>Costo estimado por ejecución: {formatCostMicros(definition.costEstimate.perRunMicros)} (estimado)</li>
      </ul>

      <div className="space-y-1 rounded-2xl border border-line p-3 text-xs" aria-label={`Modelos de ${definition.name}`}>
        <p><span className="font-medium">Puede usar:</span> {usable.length ? usable.map((entry) => entry.model.label).join(", ") : "ningún modelo (revise sus capacidades o su política de datos)"}</p>
        {blocked.length > 0 && <p className="text-ink-muted">No puede usar: {blocked.map((entry) => `${entry.model.label} (${entry.reasons[0]})`).join("; ")}</p>}
        <p className="text-ink-muted">Lo decide KOE por capacidad y política de datos, no por proveedor. Aquí no se conecta ninguna API.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {definition.status === "active" && !instance && <Button size="sm" variant="primary" onClick={() => send({ type: "worker.enable", definitionId: definition.id })}>Activar en mi empresa</Button>}
        {instance?.status === "active" && <Button size="sm" variant="ghost" onClick={() => send({ type: "instance.pause", instanceId: instance.id })}>Pausar</Button>}
        {instance?.status === "paused" && <Button size="sm" variant="ghost" onClick={() => send({ type: "instance.resume", instanceId: instance.id })}>Reanudar</Button>}
        {instance && instance.status !== "disabled" && <Button size="sm" variant="ghost" onClick={() => send({ type: "instance.disable", instanceId: instance.id })}>Deshabilitar</Button>}
        {instance?.status === "disabled" && <Button size="sm" variant="secondary" onClick={() => send({ type: "instance.enable", instanceId: instance.id })}>Habilitar</Button>}
        {definition.status === "draft" && owner && <Button size="sm" variant="primary" onClick={() => send({ type: "worker.submit", definitionId: definition.id })}>Enviar a revisión</Button>}
        {definition.status === "pendingReview" && owner && (
          <>
            <Button size="sm" variant="primary" onClick={() => send({ type: "worker.review", definitionId: definition.id, approve: true })}>Aprobar Worker</Button>
            <Button size="sm" variant="ghost" onClick={() => send({ type: "worker.review", definitionId: definition.id, approve: false, reason })}>Rechazar Worker</Button>
          </>
        )}
        {definition.status === "active" && owner && <Button size="sm" variant="ghost" onClick={() => send({ type: "worker.retire", definitionId: definition.id })}>Retirar</Button>}
      </div>
      {definition.status === "pendingReview" && <p className="text-xs text-ink-muted">Enviado por {definition.submittedBy}. Lo aprueba otra persona.</p>}
      {definition.createdBy.startsWith("worker:") && <p className="text-xs text-ink-muted">Borrador preparado por {definition.createdBy} (Nivel 1).</p>}

      {instance && usage && (
        <div className="space-y-3 rounded-2xl border border-line p-3 text-sm">
          <p className="text-xs text-ink-muted">{instance.status === "active" ? "Activo en su empresa" : "Instalado en su empresa"} · {usage.runsToday} de {Math.min(instance.maxRunsPerDay, definition.limits.maxRunsPerDay)} ejecuciones hoy · {label("instanceStatus", instance.status)}</p>
          <div className="space-y-2">
            <h3 className="text-xs font-semibold">Configuración de su empresa</h3>
            <div className="grid gap-2 sm:grid-cols-4">
              <select aria-label={`Prioridad de ${definition.id}`} className={input} value={priority} onChange={(event) => setPriority(event.target.value as Priority)}>{PRIORITIES.map((item) => <option key={item} value={item}>{label("priority", item)}</option>)}</select>
              <input aria-label={`Máximo de ejecuciones de ${definition.id}`} className={input} inputMode="numeric" value={runs} onChange={(event) => setRuns(event.target.value)} />
              <input aria-label={`Proveedores excluidos de ${definition.id}`} className={input} placeholder="proveedores excluidos (comas)" value={excluded} onChange={(event) => setExcluded(event.target.value)} />
              <Button size="sm" variant="secondary" onClick={() => send({ type: "instance.configure", instanceId: instance.id, maxRunsPerDay: Number(runs), deniedProviders: excluded.split(",").map((value) => value.trim()).filter(Boolean), priority })}>Guardar configuración</Button>
            </div>
            <p className="text-xs text-ink-muted">Su empresa puede bajar el límite diario, excluir proveedores de modelos y cambiar la prioridad (ordena lo que espera; no cambia lo que el Worker puede hacer); nunca ampliar lo que la definición permite.</p>
          </div>
          {level2.map((action) => (
            <div key={action} className="grid gap-2 sm:grid-cols-3">
              <span className="self-center text-xs">{state.tools[action]?.manifest.label ?? action} (Nivel 2)</span>
              <input aria-label={`Máximo por día de ${action}`} className={input} inputMode="numeric" placeholder="máx. por día" value={limits[`${instance.id}:${action}`] ?? ""} onChange={(event) => setLimits({ ...limits, [`${instance.id}:${action}`]: event.target.value })} />
              <Button size="sm" variant="secondary" onClick={() => send({ type: "authorization.grant", instanceId: instance.id, action, maxPerDay: Number(limits[`${instance.id}:${action}`] ?? 0) })}>Autorizar {action}</Button>
            </div>
          ))}
          {usage.authorizations.map(({ authorization, usedToday }) => (
            <div key={authorization.id} className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
              <span>Autorizado: {authorization.action} · {usedToday} de {authorization.maxPerDay} hoy · por {authorization.grantedBy}</span>
              <Button size="sm" variant="ghost" onClick={() => send({ type: "authorization.revoke", authorizationId: authorization.id })}>Revocar</Button>
            </div>
          ))}
          {level2.length === 0 && <p className="text-xs text-ink-muted">Este Worker no tiene acciones de Nivel 2. Las de Nivel 3 nunca se autorizan: siempre piden confirmación.</p>}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- models: the router, health and registration
const HEALTH_TONE = { healthy: "success", degraded: "warning", down: "danger" } as const;

export function ModelsTab({ state, send, admin }: WorkersTabProps) {
  const [needs, setNeeds] = useState<ModelClass[]>(["fast"]);
  const [clearance, setClearance] = useState<Clearance>("business");
  const [tokens, setTokens] = useState("2000");
  const [needsTools, setNeedsTools] = useState(true);
  const [region, setRegion] = useState("");
  const result = routeModel(state.models, { needs, dataClearance: clearance, contextTokens: Number(tokens) || 0, needsTools, region: region || undefined });

  const [fields, setFields] = useState({ id: "", provider: "", label: "", classes: "fast", context: "32000", cost: "200", region: "us" });
  const [formError, setFormError] = useState<string | null>(null);
  const register = () => {
    const model: ModelManifest = {
      id: fields.id.trim(), provider: fields.provider.trim(), label: fields.label.trim(), classes: fields.classes.split(",").map((value) => value.trim()).filter((value): value is ModelClass => (MODEL_CLASSES as readonly string[]).includes(value)),
      maxContextTokens: Number(fields.context), costMicrosPer1k: Number(fields.cost), dataPolicy: "noTraining", regions: fields.region.split(",").map((value) => value.trim()).filter(Boolean), supportsTools: true, health: "healthy", enabled: true,
    };
    const issues = validateModel(model);
    if (issues.length) return setFormError(`Modelo inválido: ${issues[0]}.`);
    setFormError(null);
    send({ type: "model.register", model });
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-5">
        <h2 className="font-semibold">KOE elige el modelo, no el proveedor</h2>
        <p className="text-sm text-ink-muted">Cada tarea pide capacidades y un nivel de datos. KOE elige el modelo más barato y sano que cumple, con la política de datos como regla dura, y pasa al siguiente si uno cae. Cambiar de proveedor o sumar uno nuevo es editar esta lista, no el motor.</p>
      </Card>
      <ul className="grid gap-4 lg:grid-cols-2">
        {state.models.map((model) => (
          <Card as="li" key={model.id} className="space-y-2 p-5" aria-label={`Modelo ${model.label}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">{model.label} <span className="text-xs font-normal text-ink-muted">· {model.provider}</span></h2>
              <div className="flex gap-1.5"><Badge tone={HEALTH_TONE[model.health]}>{label("health", model.health)}</Badge>{!model.enabled && <Badge>Desactivado</Badge>}</div>
            </div>
            <div className="flex flex-wrap gap-1.5">{model.classes.map((item) => <Badge key={item} tone="primary">{label("modelClass", item)}</Badge>)}</div>
            <p className="text-xs text-ink-muted">{label("dataPolicy", model.dataPolicy)} · contexto {model.maxContextTokens.toLocaleString("es-CR")} · {model.costMicrosPer1k} µUSD por 1 000 tokens · {model.regions.join(", ")}{model.supportsTools ? " · herramientas" : ""}</p>
            {admin && (
              <div className="flex flex-wrap gap-2">
                <select aria-label={`Salud de ${model.id}`} className="rounded-xl border border-line bg-raised px-3 py-1.5 text-sm" value={model.health} onChange={(event) => send({ type: "model.update", modelId: model.id, health: event.target.value as ModelManifest["health"] })}>
                  {(["healthy", "degraded", "down"] as const).map((item) => <option key={item} value={item}>{label("health", item)}</option>)}
                </select>
                <Button size="sm" variant="ghost" onClick={() => send({ type: "model.update", modelId: model.id, enabled: !model.enabled })}>{model.enabled ? "Desactivar" : "Activar"}</Button>
              </div>
            )}
          </Card>
        ))}
      </ul>

      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Probar el enrutador</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <fieldset className="space-y-1 text-sm sm:col-span-2"><legend className="text-ink-muted">Capacidades que necesita</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">{MODEL_CLASSES.map((item) => <label key={item} className="flex items-center gap-1"><input type="checkbox" checked={needs.includes(item)} onChange={(event) => setNeeds(event.target.checked ? [...needs, item] : needs.filter((value) => value !== item))} />{label("modelClass", item)}</label>)}</div>
          </fieldset>
          <Field name="Datos de la tarea"><select aria-label="Datos de la tarea" className={input} value={clearance} onChange={(event) => setClearance(event.target.value as Clearance)}>{CLEARANCES.map((item) => <option key={item} value={item}>{label("clearance", item)}</option>)}</select></Field>
          <Field name="Contexto (tokens)"><input aria-label="Contexto en tokens" className={input} inputMode="numeric" value={tokens} onChange={(event) => setTokens(event.target.value)} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={needsTools} onChange={(event) => setNeedsTools(event.target.checked)} /> Usa herramientas</label>
          <Field name="Región (opcional)"><input aria-label="Región" className={input} value={region} onChange={(event) => setRegion(event.target.value)} placeholder="us, eu…" /></Field>
        </div>
        <p role="status" className="rounded-xl bg-raised px-3 py-2 text-sm">{result.chosen ? `Elegido: ${result.reason}` : `Ningún modelo: ${result.reason}`}</p>
        <ul className="space-y-1 text-xs text-ink-muted">{result.candidates.map((candidate) => <li key={candidate.model.id}>{candidate.model.label}: {candidate.accepted ? "cumple" : candidate.reasons.join("; ")}</li>)}</ul>
      </Card>

      {admin ? (
        <Card className="space-y-3 p-5">
          <h2 className="font-semibold">Registrar un modelo</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            {(["id", "provider", "label", "classes", "context", "cost", "region"] as const).map((key) => (
              <Field key={key} name={{ id: "Identificador", provider: "Proveedor", label: "Nombre", classes: "Capacidades (separadas por comas)", context: "Contexto máximo", cost: "Costo (µUSD por 1 000 tokens)", region: "Regiones" }[key]}>
                <input aria-label={`Nuevo modelo: ${key}`} className={input} value={fields[key]} onChange={(event) => setFields({ ...fields, [key]: event.target.value })} />
              </Field>
            ))}
          </div>
          {formError && <p role="alert" className="text-sm text-danger-soft">{formError}</p>}
          <Button size="sm" variant="primary" onClick={register}>Registrar modelo</Button>
        </Card>
      ) : <p className="text-xs text-ink-muted">Solo la administración registra o cambia modelos.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- working memory
export function MemoryTab({ state, send, persona }: WorkersTabProps) {
  const entries = memoryOf(state, persona.tenantId);
  return (
    <div className="space-y-4">
      <Card className="space-y-1 p-5">
        <h2 className="font-semibold">Memoria de trabajo</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
          <li>Es de la ejecución: al terminar o cancelarse se borran los valores y solo queda la huella de que existieron.</li>
          <li>Una persona puede conservar una entrada (30 días) si el Worker puede conservar memoria. Los datos personales nunca se conservan: viven en el CRM.</li>
          <li>Nunca se guardan secretos, claves ni datos de pago. Cada Worker tiene tope de entradas y de caracteres.</li>
          <li>Entre Workers solo viaja lo que el delegador comparte, y lo personal no llega a quien no está habilitado para ello.</li>
        </ul>
      </Card>
      {entries.length === 0 ? <Empty title="Sin memoria">Aparece cuando un Worker guarda algo durante una ejecución.</Empty> : (
        <ul className="space-y-3">
          {[...entries].reverse().map((entry) => {
            const instance = state.instances.find((item) => item.id === entry.instanceId);
            return (
              <Card as="li" key={entry.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{definitionOf(state, instance?.definitionId ?? "")?.name ?? "Worker"} · «{entry.key}»</p>
                  <div className="flex gap-1.5"><Badge tone={entry.scope === "durable" ? "accent" : "neutral"}>{label("memoryScope", entry.scope)}</Badge><Badge tone={entry.sensitivity === "personal" ? "danger" : "primary"}>{label("clearance", entry.sensitivity)}</Badge>{entry.cleared && <Badge>Borrada</Badge>}</div>
                </div>
                <p className="text-sm text-ink-muted">{entry.cleared ? "(el valor fue borrado)" : entry.value}</p>
                <p className="text-xs text-ink-muted">{day(entry.createdAt)}{entry.expiresAt ? ` · vence ${day(entry.expiresAt)}` : ""}</p>
                {!entry.cleared && (
                  <div className="flex gap-2">
                    {entry.scope === "run" && <Button size="sm" variant="secondary" onClick={() => send({ type: "memory.promote", entryId: entry.id })}>Conservar</Button>}
                    <Button size="sm" variant="ghost" onClick={() => send({ type: "memory.forget", entryId: entry.id })}>Olvidar</Button>
                  </div>
                )}
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- audit and logs
export function ActivityTab({ state }: WorkersTabProps) {
  const feeds = [
    { title: "Auditoría", empty: "Sin cambios", rows: state.audit.map((entry) => `${day(entry.at)} · ${entry.tenantId} · ${entry.actor} · ${entry.action}${entry.detail ? ` · ${entry.detail}` : ""}${entry.runId ? ` · ${entry.runId}` : ""}`) },
    { title: "Registros", empty: "Sin registros", rows: state.logs.map((entry) => `${entry.level.toUpperCase()} · ${entry.event}`) },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {feeds.map((feed) => {
        const { shown, hidden } = latest(feed.rows);
        return (
          <Card key={feed.title} className="space-y-2 p-5">
            <h2 className="font-semibold">{feed.title} ({feed.rows.length})</h2>
            {feed.rows.length === 0 ? <p className="text-xs text-ink-muted">{feed.empty}</p> : <ul className="max-h-96 space-y-1 overflow-auto text-xs text-ink-muted">{shown.map((row, index) => <li key={`${row}-${index}`}>{row}</li>)}</ul>}
            {hiddenNote(hidden) && <p className="text-xs text-ink-muted">{hiddenNote(hidden)}</p>}
          </Card>
        );
      })}
    </div>
  );
}
