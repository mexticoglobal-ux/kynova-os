"use client";

import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  ACTIONS, ACTION_PARAMS, CONDITION_OPS, DEFAULT_KOE_ENV, MAX_ACTIONS, MAX_CONDITIONS, ROLES, TRIGGERS, actionLevel, automationStats, automationsOf, fieldsOf, needOf, outputsOf, runsOf, validateAutomation, workerIssues,
  type ActionKind, type ActionSpec, type Automation, type AutomationInput, type Condition, type OutputStatus, type RunStatus, type TriggerKind,
} from "@/lib/contracts/platform/automation-center";
import { SAMPLE_PAYLOADS, blankInput } from "@/lib/contracts/platform/automation-demo";
import { fieldLabel, label } from "@/lib/contracts/platform/automation-messages";
import { hiddenNote, latest } from "@/lib/contracts/platform/display";
import { PLATFORM_OWNER, formatCostMicros } from "@/lib/contracts/platform/koe-registry";
import { label as koeLabel } from "@/lib/contracts/platform/koe-messages";
import { PRIORITY_TONE } from "./WorkersTabs";
import type { AutomationsTabProps } from "./AutomationsCenter";
import { INPUT_FULL } from "@/components/ui/form";

const STATUS_TONE: Record<Automation["status"], BadgeTone> = { setupPending: "warning", draft: "neutral", active: "success", paused: "warning" };
const RUN_TONE: Record<RunStatus, BadgeTone> = { completed: "success", testLogged: "primary", skipped: "warning", failed: "danger" };
const OUTPUT_TONE: Record<OutputStatus, BadgeTone> = { open: "accent", done: "success", dismissed: "neutral" };
const time = (iso: string) => iso.slice(0, 16).replace("T", " ");

const workerOf = (id: string | undefined) => DEFAULT_KOE_ENV.workers.find((item) => item.id === id);

/** The Worker that carries an automation out: who, how urgent, and the estimated cost of one run. Nothing here calls a model. */
function WorkerLine({ workerId, tenantId }: { workerId?: string; tenantId: string }) {
  const worker = workerOf(workerId);
  if (!workerId || !worker) return <p className="text-sm text-warning">Sin Worker asignado: asigne uno en «{label("tabs", "build")}» para poder activarla.</p>;
  const issue = workerIssues({ name: "x", description: "", trigger: "manual", conditions: [], actions: [], workerId }, DEFAULT_KOE_ENV, tenantId)[0];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm text-ink-soft">
      <span>Worker: <strong>{worker.name}</strong></span>
      <Badge tone={PRIORITY_TONE[worker.priority]}>Prioridad {koeLabel("priority", worker.priority)}</Badge>
      <Badge tone="neutral">Costo est. {formatCostMicros(worker.costEstimate.perRunMicros)} por ejecución</Badge>
      {issue && <span className="text-xs text-warning">{issue}</span>}
    </div>
  );
}

const summaryOf = (input: AutomationInput) => `${label("trigger", input.trigger)} → ${input.actions.map((item) => label("action", item.kind)).join(" · ")}`;

// ---------------------------------------------------------------- list
export function ListTab({ state, send, persona, edit }: AutomationsTabProps) {
  const mine = automationsOf(state, persona.tenantId);
  if (mine.length === 0) return <p className="text-sm text-ink-muted">Todavía no hay automatizaciones. Cree una en «{label("tabs", "build")}» o cargue los datos de ejemplo.</p>;
  const stats = automationStats(state, persona.tenantId);
  return (
    <div className="space-y-3">
    <p className="text-sm text-ink-muted">Cada automatización la ejecuta un Worker de KOE y KOE elige el modelo; la automatización nunca llama a un modelo. Costo estimado de las ejecuciones en vivo: <strong>{formatCostMicros(stats.estimatedCostMicros)}</strong> (es una estimación, no una factura).</p>
    <ul className="grid gap-4 lg:grid-cols-2">
      {mine.map((item) => (
        <Card as="li" key={item.id} aria-label={`Automatización ${item.name}`} className="space-y-3 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold">{item.name}</h2>
              {item.description && <p className="text-sm text-ink-muted">{item.description}</p>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone={STATUS_TONE[item.status]}>{label("status", item.status)}</Badge>
              {item.testMode ? <Badge tone="primary">Modo de prueba</Badge> : <Badge tone="accent">En vivo</Badge>}
            </div>
          </div>
          <p className="text-sm text-ink-soft">{summaryOf(item)}</p>
          <WorkerLine workerId={item.workerId} tenantId={item.tenantId} />
          <p className="text-xs text-ink-muted">
            {item.conditions.length === 0 ? "Sin condiciones" : `${item.conditions.length} condición(es)`} · Versión {item.version} · {item.runCount} ejecución(es){item.lastRunAt ? ` · última ${time(item.lastRunAt)}` : ""} · creada por {item.createdBy.startsWith("worker:") ? "NEX (IA)" : item.createdBy}
          </p>
          <div className="flex flex-wrap gap-2">
            {item.status === "active"
              ? <Button size="sm" variant="secondary" onClick={() => send({ type: "automation.pause", automationId: item.id })}>Pausar</Button>
              : <Button size="sm" disabled={item.status === "setupPending"} title={item.status === "setupPending" ? "Asigne un Worker antes de activarla" : undefined} onClick={() => send({ type: "automation.activate", automationId: item.id })}>{item.status === "paused" ? "Reanudar" : "Activar"}</Button>}
            <Button size="sm" variant="secondary" disabled={item.status === "setupPending"} title={item.status === "setupPending" ? "Asigne un Worker antes de probarla" : undefined} onClick={() => send({ type: "automation.test", automationId: item.id, payload: SAMPLE_PAYLOADS[item.trigger] })}>Probar con datos de ejemplo</Button>
            {item.trigger === "manual" && item.status === "active" && <ManualRun item={item} send={send} />}
            <Button size="sm" variant="ghost" onClick={() => edit(item.id)}>Editar</Button>
            <Button size="sm" variant="ghost" onClick={() => send({ type: "automation.duplicate", automationId: item.id })}>Duplicar</Button>
            <Button size="sm" variant="ghost" onClick={() => send({ type: "automation.setTestMode", automationId: item.id, testMode: !item.testMode })}>{item.testMode ? "Pasar a en vivo" : "Volver al modo de prueba"}</Button>
            <Button size="sm" variant="ghost" disabled={item.status === "active"} title={item.status === "active" ? "Pause la automatización antes de eliminarla" : undefined} onClick={() => send({ type: "automation.delete", automationId: item.id })}>Eliminar</Button>
          </div>
        </Card>
      ))}
    </ul>
    </div>
  );
}

function ManualRun({ item, send }: { item: Automation; send: AutomationsTabProps["send"] }) {
  const keys = [...new Set(item.actions.flatMap((action) => Object.values(action.params).flatMap((value) => [...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]))))];
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <span className="flex flex-wrap items-center gap-2">
      {keys.map((key) => (
        <input key={key} aria-label={`${fieldLabel(key)} de ${item.name}`} placeholder={fieldLabel(key)} className="w-32 rounded-xl border border-line bg-raised px-2 py-1 text-sm text-ink" value={values[key] ?? ""} onChange={(event) => setValues({ ...values, [key]: event.target.value })} />
      ))}
      <Button size="sm" variant="secondary" onClick={() => send({ type: "automation.runManual", automationId: item.id, payload: values })}>Ejecutar ahora</Button>
    </span>
  );
}

// ---------------------------------------------------------------- builder
const emptyParams = (kind: ActionKind): Record<string, string> => Object.fromEntries(ACTION_PARAMS[kind].map((spec) => [spec.key, ""]));

export function BuilderTab({ state, send, persona, editingId, edit }: AutomationsTabProps) {
  const current = editingId ? state.automations.find((item) => item.id === editingId && item.tenantId === persona.tenantId) : undefined;
  const [input, setInput] = useState<AutomationInput>(current
    ? { name: current.name, description: current.description, trigger: current.trigger, conditions: current.conditions, actions: current.actions, workerId: current.workerId }
    : blankInput({ name: "", trigger: "newProspect", actions: [{ kind: "createTask", params: emptyParams("createTask") }] }));
  const issues = validateAutomation(input, DEFAULT_KOE_ENV, persona.tenantId);
  const need = needOf(input);
  const chosen = workerOf(input.workerId);
  const offered = DEFAULT_KOE_ENV.workers.filter((item) => item.status === "active" && (item.ownerTenantId === PLATFORM_OWNER || item.ownerTenantId === persona.tenantId));
  const fields = fieldsOf(input.trigger);
  const setCondition = (index: number, patch: Partial<Condition>) => setInput({ ...input, conditions: input.conditions.map((item, at) => (at === index ? { ...item, ...patch } : item)) });
  const setAction = (index: number, action: ActionSpec) => setInput({ ...input, actions: input.actions.map((item, at) => (at === index ? action : item)) });
  const save = () => {
    const error = send(current ? { type: "automation.edit", automationId: current.id, input } : { type: "automation.create", input });
    if (!error) edit(null);
  };

  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-semibold">{current ? `Editar «${current.name}»` : "Nueva automatización"}</h2>
      {current?.status === "active" && <p className="text-sm text-warning">Al guardar, la automatización se pausa para que pueda revisar el cambio antes de reanudarla.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm text-ink-muted">Nombre<input aria-label="Nombre" className={INPUT_FULL} value={input.name} onChange={(event) => setInput({ ...input, name: event.target.value })} /></label>
        <label className="space-y-1 text-sm text-ink-muted">Descripción<input aria-label="Descripción" className={INPUT_FULL} value={input.description} onChange={(event) => setInput({ ...input, description: event.target.value })} /></label>
        <label className="space-y-1 text-sm text-ink-muted">Disparador
          <select aria-label="Disparador" className={INPUT_FULL} value={input.trigger} onChange={(event) => setInput({ ...input, trigger: event.target.value as TriggerKind, conditions: [] })}>
            {TRIGGERS.map((kind) => <option key={kind} value={kind}>{label("trigger", kind)}</option>)}
          </select>
        </label>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Worker que la ejecuta</h3>
        <label className="block space-y-1 text-sm text-ink-muted">Worker
          <select aria-label="Worker" className={INPUT_FULL} value={input.workerId ?? ""} onChange={(event) => setInput({ ...input, workerId: event.target.value || undefined })}>
            <option value="">Sin Worker (queda en «Configuración pendiente»)</option>
            {offered.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        {chosen
          ? <WorkerLine workerId={chosen.id} tenantId={persona.tenantId} />
          : <p className="text-sm text-warning">Sin Worker la automatización queda en «Configuración pendiente» y no se puede activar.</p>}
        <p className="text-xs text-ink-muted">Necesita las herramientas: {need.tools.join(", ") || "ninguna todavía"}. KOE elige el modelo según lo que el Worker necesita; la automatización no llama a ninguno.</p>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Condiciones <span className="font-normal text-ink-muted">(todas deben cumplirse; sin condiciones corre siempre)</span></h3>
        {input.conditions.map((condition, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            {fields === "free"
              ? <input aria-label={`Campo de la condición ${index + 1}`} placeholder="campo" className="w-36 rounded-xl border border-line bg-raised px-2 py-1 text-sm text-ink" value={condition.field} onChange={(event) => setCondition(index, { field: event.target.value })} />
              : <select aria-label={`Campo de la condición ${index + 1}`} className="rounded-xl border border-line bg-raised px-2 py-1 text-sm text-ink" value={condition.field} onChange={(event) => setCondition(index, { field: event.target.value })}>
                  {fields.map((field) => <option key={field} value={field}>{fieldLabel(field)}</option>)}
                </select>}
            <select aria-label={`Operador de la condición ${index + 1}`} className="rounded-xl border border-line bg-raised px-2 py-1 text-sm text-ink" value={condition.op} onChange={(event) => setCondition(index, { op: event.target.value as Condition["op"] })}>
              {CONDITION_OPS.map((op) => <option key={op} value={op}>{label("op", op)}</option>)}
            </select>
            <input aria-label={`Valor de la condición ${index + 1}`} className="w-36 rounded-xl border border-line bg-raised px-2 py-1 text-sm text-ink" value={condition.value} onChange={(event) => setCondition(index, { value: event.target.value })} />
            <Button size="sm" variant="ghost" onClick={() => setInput({ ...input, conditions: input.conditions.filter((_, at) => at !== index) })}>Quitar condición {index + 1}</Button>
          </div>
        ))}
        <Button size="sm" variant="secondary" disabled={input.conditions.length >= MAX_CONDITIONS} onClick={() => setInput({ ...input, conditions: [...input.conditions, { field: fields === "free" ? "" : fields[0], op: "equals", value: "" }] })}>Añadir condición</Button>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Acciones <span className="font-normal text-ink-muted">(solo preparan; nada se envía)</span></h3>
        {input.actions.map((action, index) => (
          <div key={index} className="space-y-2 rounded-xl border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label={`Tipo de la acción ${index + 1}`} className="rounded-xl border border-line bg-raised px-2 py-1 text-sm text-ink" value={action.kind} onChange={(event) => setAction(index, { kind: event.target.value as ActionKind, params: emptyParams(event.target.value as ActionKind) })}>
                {ACTIONS.map((kind) => <option key={kind} value={kind}>{label("action", kind)}</option>)}
              </select>
              <Badge tone="success">Nivel {actionLevel(action.kind)}</Badge>
              <Button size="sm" variant="ghost" onClick={() => setInput({ ...input, actions: input.actions.filter((_, at) => at !== index) })}>Quitar acción {index + 1}</Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {ACTION_PARAMS[action.kind].map((spec) => (
                <label key={spec.key} className="space-y-1 text-xs text-ink-muted">{fieldLabel(spec.key)}{spec.required ? " *" : ""}
                  {spec.kind === "role"
                    ? <select aria-label={`${spec.key} de la acción ${index + 1}`} className={INPUT_FULL} value={action.params[spec.key] ?? ""} onChange={(event) => setAction(index, { ...action, params: { ...action.params, [spec.key]: event.target.value } })}>
                        <option value="">—</option>{ROLES.map((role) => <option key={role} value={role}>{label("role", role)}</option>)}
                      </select>
                    : <input aria-label={`${spec.key} de la acción ${index + 1}`} className={INPUT_FULL} value={action.params[spec.key] ?? ""} onChange={(event) => setAction(index, { ...action, params: { ...action.params, [spec.key]: event.target.value } })} />}
                </label>
              ))}
            </div>
          </div>
        ))}
        <Button size="sm" variant="secondary" disabled={input.actions.length >= MAX_ACTIONS} onClick={() => setInput({ ...input, actions: [...input.actions, { kind: "createTask", params: emptyParams("createTask") }] })}>Añadir acción</Button>
        {fields !== "free" && <p className="text-xs text-ink-muted">Puede usar datos del evento con {"{{campo}}"}: {fields.map((field) => `{{${field}}}`).join(", ")}. Correo y teléfono solo en borradores.</p>}
      </section>

      {issues.length > 0 && <ul aria-label="Pendientes del formulario" className="list-disc space-y-0.5 pl-5 text-sm text-warning">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
      <div className="flex gap-2">
        <Button size="sm" disabled={issues.length > 0} onClick={save}>{current ? "Guardar cambios" : "Crear automatización"}</Button>
        {current && <Button size="sm" variant="ghost" onClick={() => edit(null)}>Cancelar edición</Button>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- simulator
export function SimulateTab({ send }: AutomationsTabProps) {
  const [kind, setKind] = useState<TriggerKind>("newProspect");
  const [payload, setPayload] = useState<Record<string, string>>(SAMPLE_PAYLOADS.newProspect);
  const [eventId, setEventId] = useState("");
  const choose = (next: TriggerKind) => { setKind(next); setPayload(SAMPLE_PAYLOADS[next]); };
  return (
    <Card className="space-y-4 p-5">
      <p className="text-sm text-ink-muted">Simule que ocurrió un evento en la empresa. Solo corren las automatizaciones activas con ese disparador; las que están en modo de prueba solo lo registran.</p>
      <label className="block space-y-1 text-sm text-ink-muted">Evento
        <select aria-label="Evento" className={INPUT_FULL} value={kind} onChange={(event) => choose(event.target.value as TriggerKind)}>
          {TRIGGERS.filter((item) => item !== "manual").map((item) => <option key={item} value={item}>{label("trigger", item)}</option>)}
        </select>
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        {Object.keys(payload).map((key) => (
          <label key={key} className="space-y-1 text-xs text-ink-muted">{fieldLabel(key)}
            <input aria-label={`Dato ${fieldLabel(key)}`} className={INPUT_FULL} value={payload[key]} onChange={(event) => setPayload({ ...payload, [key]: event.target.value })} />
          </label>
        ))}
      </div>
      <label className="block space-y-1 text-xs text-ink-muted">Identificador del evento (opcional; el mismo identificador se procesa una sola vez)
        <input aria-label="Identificador del evento" className={INPUT_FULL} value={eventId} onChange={(event) => setEventId(event.target.value)} />
      </label>
      <Button size="sm" onClick={() => send({ type: "trigger.fire", kind, payload, ...(eventId.trim() ? { eventId: eventId.trim() } : {}) })}>Simular evento</Button>
    </Card>
  );
}

// ---------------------------------------------------------------- results
export function ResultsTab({ state, send, persona }: AutomationsTabProps) {
  const outputs = outputsOf(state, persona.tenantId);
  const runs = runsOf(state, persona.tenantId);
  const shownOutputs = latest(outputs);
  const shownRuns = latest(runs);
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="font-semibold">Lo que prepararon las automatizaciones</h2>
        <p className="text-sm text-ink-muted">Nada de esto se envió. «Hecho» significa que una persona lo atendió fuera de la plataforma.</p>
        {outputs.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay resultados.</p>}
        <ul className="space-y-2">
          {shownOutputs.shown.map((item) => (
            <Card as="li" key={item.id} aria-label={`Resultado ${item.title}`} className="space-y-1 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="neutral">{label("outputKind", item.kind)}</Badge>
                <Badge tone={OUTPUT_TONE[item.status]}>{label("outputStatus", item.status)}</Badge>
                <span className="font-medium">{item.title}</span>
              </div>
              {item.to && <p className="text-xs text-ink-muted">Para: {item.to}</p>}
              {item.body && <p className="text-sm text-ink-soft">{item.body}</p>}
              {item.dueAt && <p className="text-xs text-ink-muted">Fecha: {time(item.dueAt)}</p>}
              {item.status === "open" && (
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="secondary" onClick={() => send({ type: "output.resolve", outputId: item.id, resolution: "done" })}>Marcar como hecho</Button>
                  <Button size="sm" variant="ghost" onClick={() => send({ type: "output.resolve", outputId: item.id, resolution: "dismissed" })}>Descartar</Button>
                </div>
              )}
            </Card>
          ))}
        </ul>
        {hiddenNote(shownOutputs.hidden) && <p className="text-xs text-ink-muted">{hiddenNote(shownOutputs.hidden)}</p>}
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Ejecuciones</h2>
        {runs.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay ejecuciones.</p>}
        <ul className="space-y-2">
          {shownRuns.shown.map((run) => (
            <Card as="li" key={run.id} aria-label={`Ejecución ${run.id}`} className="space-y-1 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={RUN_TONE[run.status]}>{label("runStatus", run.status)}</Badge>
                <span className="font-medium">{run.automationName}</span>
                <span className="text-xs text-ink-muted">{time(run.at)} · {label("trigger", run.trigger)}</span>
              </div>
              {run.workerName && (
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                  <span>Worker: {run.workerName}</span>
                  {run.priority && <Badge tone={PRIORITY_TONE[run.priority]}>Prioridad {koeLabel("priority", run.priority)}</Badge>}
                  <Badge tone="neutral">Costo est. {formatCostMicros(run.estimatedCostMicros)}</Badge>
                  {run.model && <span>Modelo elegido por KOE: {run.model.label} ({run.model.provider}); no se llamó</span>}
                </p>
              )}
              {run.reason && <p className="text-xs text-ink-muted">{run.reason}</p>}
              <ul className="space-y-0.5 text-sm text-ink-soft">
                {run.results.map((result) => (
                  <li key={result.index}>
                    {label("action", result.kind)} · Nivel {result.level}: {Object.values(result.rendered).filter(Boolean).join(" — ") || "—"}
                    {result.error && <span className="text-danger-soft"> · {result.error}</span>}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </ul>
        {hiddenNote(shownRuns.hidden) && <p className="text-xs text-ink-muted">{hiddenNote(shownRuns.hidden)}</p>}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- activity
export function ActivityTab({ state, persona }: AutomationsTabProps) {
  const audit = latest(state.audit.filter((entry) => entry.tenantId === persona.tenantId));
  return (
    <div className="space-y-2">
      <h2 className="font-semibold">Registro de actividad</h2>
      {audit.shown.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay actividad.</p>}
      <ul className="space-y-1 text-sm">
        {audit.shown.map((entry, index) => (
          <li key={`${entry.at}-${index}`} className="text-ink-soft">
            <span className="text-xs text-ink-muted">{time(entry.at)}</span> · {entry.actor.startsWith("worker:") ? "NEX (IA)" : entry.actor} · {entry.action}{entry.detail ? ` — ${entry.detail}` : ""}
          </li>
        ))}
      </ul>
      {hiddenNote(audit.hidden) && <p className="text-xs text-ink-muted">{hiddenNote(audit.hidden)}</p>}
    </div>
  );
}
