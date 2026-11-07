"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { label } from "@/lib/contracts/platform/koe-messages";
import { autonomyOf, type WorkerInput } from "@/lib/contracts/platform/koe-engine";
import { CLEARANCES, MODEL_CLASSES, SPECIALTIES, validateTool, validateWorker, type Clearance, type ModelClass, type Specialty, type ToolManifest, type WorkerDefinition } from "@/lib/contracts/platform/koe-registry";
import { levelForAction } from "@/lib/contracts/platform/workers";
import type { WorkersTabProps } from "./WorkersCenter";
import { Field, LevelBadge, input } from "./WorkersTabs";

const csv = (text: string) => text.split(",").map((value) => value.trim()).filter(Boolean);

// A new Worker is only this form: data over the tools and models that already exist. Nothing in the engine changes.
export function BuilderTab({ state, send, persona, admin }: WorkersTabProps) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [specialty, setSpecialty] = useState<Specialty>("custom");
  const [summary, setSummary] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [clearance, setClearance] = useState<Clearance>("business");
  const [maxEntries, setMaxEntries] = useState("20");
  const [maxChars, setMaxChars] = useState("2000");
  const [allowPersonal, setAllowPersonal] = useState(false);
  const [durable, setDurable] = useState(false);
  const [needs, setNeeds] = useState<ModelClass[]>(["fast"]);
  const [denied, setDenied] = useState("");
  const [delegatesTo, setDelegatesTo] = useState("");
  const [acceptsFrom, setAcceptsFrom] = useState("");
  const [runsPerDay, setRunsPerDay] = useState("50");
  const [steps, setSteps] = useState("20");
  const [depth, setDepth] = useState("0");
  const [kynova, setKynova] = useState(false);

  const input_: WorkerInput = {
    id: id.trim(), name, specialty, summary, version: "1.0.0", tools, dataClearance: clearance,
    memory: { maxEntries: Number(maxEntries), maxChars: Number(maxChars), allowPersonal, durable },
    routing: { needs, policy: denied.trim() ? { deniedProviders: csv(denied) } : {} },
    collaboration: { delegatesTo: csv(delegatesTo), acceptsFrom: csv(acceptsFrom) },
    limits: { maxRunsPerDay: Number(runsPerDay), maxStepsPerRun: Number(steps), maxDelegationDepth: Number(depth) },
    origin: kynova ? "kynova" : "tenant",
  };
  const preview: WorkerDefinition = { ...input_, ownerTenantId: persona.tenantId, origin: input_.origin ?? "tenant", status: "draft", createdBy: persona.actor };
  const issues = validateWorker(preview, state.tools);
  const summaryLevel = autonomyOf(preview, state.tools);
  const activeTools = Object.values(state.tools).filter((entry) => entry.status === "active");
  const pendingTools = Object.values(state.tools).filter((entry) => entry.status === "pending");

  // register a new tool (administrators): it stays pending until a second administrator approves it
  const [toolFields, setToolFields] = useState({ id: "", label: "", description: "", required: "", external: false, financial: false, access: "business" as Clearance });
  const [toolError, setToolError] = useState<string | null>(null);
  const registerTool = () => {
    const manifest: ToolManifest = { id: toolFields.id.trim(), label: toolFields.label.trim(), description: toolFields.description.trim(), reads: [], writes: [], externalEffect: toolFields.external, financial: toolFields.financial, dataAccess: toolFields.access, required: csv(toolFields.required) };
    const problems = validateTool(manifest);
    if (problems.length) return setToolError(`Herramienta inválida: ${problems[0]}.`);
    setToolError(null);
    send({ type: "tool.register", manifest });
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <h2 className="font-semibold">Crear un Worker</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="Identificador"><input aria-label="Identificador del Worker" className={input} value={id} onChange={(event) => setId(event.target.value)} placeholder="atencion-reclamos" /></Field>
          <Field name="Nombre"><input aria-label="Nombre del Worker" className={input} value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <Field name="Especialidad"><select aria-label="Especialidad" className={input} value={specialty} onChange={(event) => setSpecialty(event.target.value as Specialty)}>{SPECIALTIES.map((item) => <option key={item} value={item}>{label("specialty", item)}</option>)}</select></Field>
          <Field name="Qué hace"><input aria-label="Resumen del Worker" className={input} value={summary} onChange={(event) => setSummary(event.target.value)} /></Field>
          <Field name="Datos hasta"><select aria-label="Nivel de datos" className={input} value={clearance} onChange={(event) => setClearance(event.target.value as Clearance)}>{CLEARANCES.map((item) => <option key={item} value={item}>{label("clearance", item)}</option>)}</select></Field>
          {admin && <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={kynova} onChange={(event) => setKynova(event.target.checked)} /> Worker oficial de KYNOVA</label>}
        </div>

        <fieldset className="space-y-2"><legend className="text-sm font-semibold">Herramientas permitidas</legend>
          <ul className="grid gap-1 sm:grid-cols-2">
            {activeTools.map((entry) => (
              <li key={entry.manifest.id}>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" aria-label={`Herramienta ${entry.manifest.id}`} checked={tools.includes(entry.manifest.id)} onChange={(event) => setTools(event.target.checked ? [...tools, entry.manifest.id] : tools.filter((value) => value !== entry.manifest.id))} />
                  {entry.manifest.label} <span className="text-xs text-ink-muted">N{levelForAction(entry.manifest.id)}{entry.manifest.externalEffect ? " · externo" : ""}{entry.manifest.financial ? " · dinero" : ""}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-4">
          <Field name="Memoria: entradas"><input aria-label="Entradas de memoria" className={input} inputMode="numeric" value={maxEntries} onChange={(event) => setMaxEntries(event.target.value)} /></Field>
          <Field name="Memoria: caracteres"><input aria-label="Caracteres de memoria" className={input} inputMode="numeric" value={maxChars} onChange={(event) => setMaxChars(event.target.value)} /></Field>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={allowPersonal} onChange={(event) => setAllowPersonal(event.target.checked)} /> Memoria con datos personales</label>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={durable} onChange={(event) => setDurable(event.target.checked)} /> Puede conservar memoria</label>
          <fieldset className="space-y-1 text-sm sm:col-span-2"><legend className="text-ink-muted">Capacidades de modelo que necesita</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">{MODEL_CLASSES.map((item) => <label key={item} className="flex items-center gap-1"><input type="checkbox" checked={needs.includes(item)} onChange={(event) => setNeeds(event.target.checked ? [...needs, item] : needs.filter((value) => value !== item))} />{label("modelClass", item)}</label>)}</div>
          </fieldset>
          <Field name="Proveedores excluidos (comas)"><input aria-label="Proveedores excluidos" className={input} value={denied} onChange={(event) => setDenied(event.target.value)} /></Field>
          <Field name="Delega en (ids, comas)"><input aria-label="Delega en" className={input} value={delegatesTo} onChange={(event) => setDelegatesTo(event.target.value)} /></Field>
          <Field name="Recibe de (ids, comas, * = cualquiera)"><input aria-label="Recibe de" className={input} value={acceptsFrom} onChange={(event) => setAcceptsFrom(event.target.value)} /></Field>
          <Field name="Ejecuciones por día"><input aria-label="Ejecuciones por día" className={input} inputMode="numeric" value={runsPerDay} onChange={(event) => setRunsPerDay(event.target.value)} /></Field>
          <Field name="Pasos por ejecución"><input aria-label="Pasos por ejecución" className={input} inputMode="numeric" value={steps} onChange={(event) => setSteps(event.target.value)} /></Field>
          <Field name="Profundidad de delegación"><input aria-label="Profundidad de delegación" className={input} inputMode="numeric" value={depth} onChange={(event) => setDepth(event.target.value)} /></Field>
        </div>

        <div className="space-y-2 rounded-2xl border border-line p-4 text-sm" role="status" aria-label="Revisión del Worker">
          <div className="flex flex-wrap items-center gap-2"><span className="text-ink-muted">Autonomía máxima:</span><LevelBadge level={summaryLevel.highest} />{summaryLevel.external.length > 0 && <Badge tone="warning">Actúa fuera: {summaryLevel.external.join(", ")}</Badge>}{summaryLevel.financial.length > 0 && <Badge tone="danger">Mueve dinero: {summaryLevel.financial.join(", ")}</Badge>}</div>
          {issues.length === 0 ? <Badge tone="success">Cumple los requisitos</Badge> : <ul className="flex flex-wrap gap-1.5">{issues.slice(0, 6).map((issue) => <li key={issue}><Badge tone="danger">Falta: {issue}</Badge></li>)}</ul>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" onClick={() => send({ type: "worker.draft", input: input_ })}>Crear borrador</Button>
          <p className="text-xs text-ink-muted">Se crea como borrador; después lo envía una persona y lo aprueba otra. NEX también puede dejar borradores.</p>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-2"><h2 className="font-semibold">Herramientas nuevas</h2><Badge>Administración</Badge></div>
        <p className="text-sm text-ink-muted">Una herramienta nueva es solo datos. Su nivel sale del catálogo: si no está allí, es de Nivel 3. Queda pendiente hasta que otro administrador la apruebe.</p>
        {admin ? (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Field name="Identificador (area.accion)"><input aria-label="Identificador de la herramienta" className={input} value={toolFields.id} onChange={(event) => setToolFields({ ...toolFields, id: event.target.value })} /></Field>
              <Field name="Nombre"><input aria-label="Nombre de la herramienta" className={input} value={toolFields.label} onChange={(event) => setToolFields({ ...toolFields, label: event.target.value })} /></Field>
              <Field name="Descripción"><input aria-label="Descripción de la herramienta" className={input} value={toolFields.description} onChange={(event) => setToolFields({ ...toolFields, description: event.target.value })} /></Field>
              <Field name="Datos requeridos (comas)"><input aria-label="Datos requeridos" className={input} value={toolFields.required} onChange={(event) => setToolFields({ ...toolFields, required: event.target.value })} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={toolFields.external} onChange={(event) => setToolFields({ ...toolFields, external: event.target.checked })} /> Actúa fuera de la plataforma</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={toolFields.financial} onChange={(event) => setToolFields({ ...toolFields, financial: event.target.checked })} /> Mueve dinero</label>
              <Field name="Datos que maneja"><select aria-label="Datos que maneja la herramienta" className={input} value={toolFields.access} onChange={(event) => setToolFields({ ...toolFields, access: event.target.value as Clearance })}>{CLEARANCES.map((item) => <option key={item} value={item}>{label("clearance", item)}</option>)}</select></Field>
            </div>
            {toolError && <p role="alert" className="text-sm text-danger-soft">{toolError}</p>}
            <Button size="sm" variant="secondary" onClick={registerTool}>Registrar herramienta</Button>
          </>
        ) : <p className="text-xs text-ink-muted">Solo la administración registra herramientas.</p>}
        {pendingTools.length > 0 && (
          <ul className="space-y-2">
            {pendingTools.map((entry) => (
              <li key={entry.manifest.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{entry.manifest.label} ({entry.manifest.id}) · pendiente · registró {entry.registeredBy} · <LevelBadge level={levelForAction(entry.manifest.id)} /></span>
                {admin && <Button size="sm" variant="primary" onClick={() => send({ type: "tool.approve", toolId: entry.manifest.id })}>Aprobar herramienta</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
