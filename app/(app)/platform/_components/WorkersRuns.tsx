"use client";

import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { canDelegate, childrenOf, definitionOf, effectiveTools, explainRun, instanceFor, instancesOf, pendingApprovals, rootRunsOf, type Run } from "@/lib/contracts/platform/koe-engine";
import { label } from "@/lib/contracts/platform/koe-messages";
import { CLEARANCES, type Clearance } from "@/lib/contracts/platform/koe-registry";
import { levelForAction } from "@/lib/contracts/platform/workers";
import type { WorkersTabProps } from "./WorkersCenter";
import { Empty, Field, LevelBadge, input } from "./WorkersTabs";

const RUN_TONE: Record<Run["status"], BadgeTone> = { running: "primary", waitingApproval: "warning", completed: "success", failed: "danger", cancelled: "neutral" };

const tree = (state: WorkersTabProps["state"], run: Run): Run[] => [run, ...childrenOf(state, run.id).flatMap((child) => tree(state, child))];

export function RunsTab({ state, send, persona }: WorkersTabProps) {
  const mine = instancesOf(state, persona.tenantId);
  const [instanceId, setInstanceId] = useState("");
  const [goal, setGoal] = useState("");
  const [reason, setReason] = useState("");
  const approvals = pendingApprovals(state, persona.tenantId);
  const roots = rootRunsOf(state, persona.tenantId);

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Iniciar una ejecución</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="Worker"><select aria-label="Worker a ejecutar" className={input} value={instanceId} onChange={(event) => setInstanceId(event.target.value)}><option value="">Elegir…</option>{mine.map((instance) => <option key={instance.id} value={instance.id}>{definitionOf(state, instance.definitionId)?.name ?? instance.definitionId}</option>)}</select></Field>
          <Field name="Objetivo"><input aria-label="Objetivo" className={input} value={goal} onChange={(event) => setGoal(event.target.value)} /></Field>
          <div className="flex items-end"><Button size="sm" variant="primary" onClick={() => { if (!send({ type: "run.start", instanceId, goal })) setGoal(""); }}>Iniciar ejecución</Button></div>
        </div>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Pendientes de una persona ({approvals.length})</h2>
        <input aria-label="Motivo de la decisión" className={input} placeholder="Motivo (opcional)" value={reason} onChange={(event) => setReason(event.target.value)} />
        {approvals.length === 0 ? <p className="text-xs text-ink-muted">Nada espera su aprobación.</p> : (
          <ul className="space-y-2">
            {approvals.map((approval) => {
              const run = state.runs.find((item) => item.id === approval.runId);
              return (
                <li key={approval.id} className="space-y-2 rounded-xl bg-raised p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{state.tools[approval.tool]?.manifest.label ?? approval.tool}</span>
                    <LevelBadge level={approval.level} />
                    {approval.financial && <Badge tone="danger">Mueve dinero: lo aprueba otra persona</Badge>}
                  </div>
                  <p className="text-xs text-ink-muted">{definitionOf(state, run?.workerId ?? "")?.name} · «{run?.goal}» · {Object.entries(approval.input).map(([key, value]) => `${key}: ${value}`).join(" · ")}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="primary" onClick={() => send({ type: "approval.decide", approvalId: approval.id, approve: true, reason })}>Aprobar acción</Button>
                    <Button size="sm" variant="ghost" onClick={() => send({ type: "approval.decide", approvalId: approval.id, approve: false, reason })}>Rechazar acción</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {roots.length === 0 ? <Empty title="Sin ejecuciones">Inicie una arriba, o cargue los datos de ejemplo para ver a un coordinador delegar en especialistas.</Empty> : (
        <ul className="space-y-3">
          {[...roots].reverse().map((root) => (
            <Card as="li" key={root.id} className="space-y-3 p-5" aria-label={`Ejecución ${root.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{definitionOf(state, root.workerId)?.name} · «{root.goal}»</p>
                <Badge tone={RUN_TONE[root.status]}>{label("runStatus", root.status)}</Badge>
              </div>
              <details open>
                <summary className="cursor-pointer text-xs text-ink-muted">Trazabilidad ({tree(state, root).length} ejecuciones)</summary>
                <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded-xl bg-raised p-3 text-xs text-ink-muted">{explainRun(state, root.id).join("\n")}</pre>
              </details>
              {tree(state, root).filter((run) => run.status === "running" || run.status === "waitingApproval").map((run) => <RunControls key={run.id} run={run} state={state} send={send} />)}
              {(root.status === "running" || root.status === "waitingApproval") && <Button size="sm" variant="ghost" onClick={() => send({ type: "run.cancel", runId: root.id })}>Cancelar ejecución y lo delegado</Button>}
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}

// Takes a step AS the run's Worker. The engine only lets that Worker move its own run, and applies every rule to it.
function RunControls({ run, state, send }: { run: Run; state: WorkersTabProps["state"]; send: WorkersTabProps["send"] }) {
  const definition = definitionOf(state, run.workerId);
  const tools = definition ? effectiveTools(definition, run) : [];
  const [toolId, setToolId] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [memKey, setMemKey] = useState("");
  const [memValue, setMemValue] = useState("");
  const [memSensitivity, setMemSensitivity] = useState<Clearance>("business");
  const [target, setTarget] = useState("");
  const [grant, setGrant] = useState<string[]>([]);
  const [subGoal, setSubGoal] = useState("");
  const [keys, setKeys] = useState("");
  const [result, setResult] = useState("");
  if (!definition) return null;

  const manifest = state.tools[toolId]?.manifest;
  const targets = state.definitions.filter((candidate) => candidate.status === "active" && canDelegate(definition, candidate) && instanceFor(state, run.tenantId, candidate.id)?.status === "active");
  const targetDefinition = targets.find((candidate) => candidate.id === target);
  const as = definition.id;

  return (
    <details className="rounded-2xl border border-line p-4" aria-label={`Mover ${run.id}`}>
      <summary className="cursor-pointer text-sm font-medium">Mover como {definition.name} · {run.id}{run.status === "waitingApproval" ? " (esperando aprobación)" : ""}</summary>
      {run.status === "waitingApproval" ? <p className="mt-2 text-xs text-ink-muted">Esta ejecución espera la decisión de una persona; mientras tanto no puede dar otro paso.</p> : (
        <div className="mt-3 space-y-4">
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Herramienta</h3>
            <div className="grid gap-2 sm:grid-cols-3">
              <select aria-label={`Herramienta de ${run.id}`} className={input} value={toolId} onChange={(event) => { setToolId(event.target.value); setFields({}); }}>
                <option value="">Elegir…</option>
                {definition.tools.map((id) => <option key={id} value={id}>{state.tools[id]?.manifest.label ?? id} · N{levelForAction(id)}{tools.includes(id) ? "" : " (no concedida)"}</option>)}
              </select>
              {manifest?.required.map((field) => <input key={field} aria-label={`${run.id} ${field}`} className={input} placeholder={field} value={fields[field] ?? ""} onChange={(event) => setFields({ ...fields, [field]: event.target.value })} />)}
            </div>
            <Button size="sm" variant="secondary" onClick={() => send({ type: "run.tool", runId: run.id, tool: toolId, input: fields }, as)}>Usar herramienta</Button>
          </div>
          <div className="flex flex-wrap gap-2"><Button size="sm" variant="secondary" onClick={() => send({ type: "run.model", runId: run.id }, as)}>Consultar un modelo (KOE)</Button></div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Memoria de trabajo</h3>
            <div className="grid gap-2 sm:grid-cols-4">
              <input aria-label={`Clave de memoria de ${run.id}`} className={input} placeholder="clave" value={memKey} onChange={(event) => setMemKey(event.target.value)} />
              <input aria-label={`Valor de memoria de ${run.id}`} className={`${input} sm:col-span-2`} placeholder="valor" value={memValue} onChange={(event) => setMemValue(event.target.value)} />
              <select aria-label={`Sensibilidad de ${run.id}`} className={input} value={memSensitivity} onChange={(event) => setMemSensitivity(event.target.value as Clearance)}>{CLEARANCES.map((item) => <option key={item} value={item}>{label("clearance", item)}</option>)}</select>
            </div>
            <Button size="sm" variant="ghost" onClick={() => send({ type: "memory.put", runId: run.id, key: memKey, value: memValue, sensitivity: memSensitivity }, as)}>Guardar en memoria</Button>
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Delegar en un especialista</h3>
            {targets.length === 0 ? <p className="text-xs text-ink-muted">Este Worker no tiene a quién delegar en su empresa.</p> : (
              <>
                <div className="grid gap-2 sm:grid-cols-3">
                  <select aria-label={`Delegar ${run.id} en`} className={input} value={target} onChange={(event) => { setTarget(event.target.value); setGrant([]); }}><option value="">Elegir…</option>{targets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                  <input aria-label={`Objetivo delegado de ${run.id}`} className={input} placeholder="qué debe hacer" value={subGoal} onChange={(event) => setSubGoal(event.target.value)} />
                  <input aria-label={`Contexto a compartir de ${run.id}`} className={input} placeholder="claves de memoria a compartir" value={keys} onChange={(event) => setKeys(event.target.value)} />
                </div>
                {targetDefinition && <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">{targetDefinition.tools.map((id) => <label key={id} className="flex items-center gap-1"><input type="checkbox" checked={grant.includes(id)} onChange={(event) => setGrant(event.target.checked ? [...grant, id] : grant.filter((value) => value !== id))} />{id} · N{levelForAction(id)}</label>)}</div>}
                <Button size="sm" variant="secondary" onClick={() => send({ type: "run.delegate", runId: run.id, toWorker: target, goal: subGoal, grant, contextKeys: keys.split(",").map((value) => value.trim()).filter(Boolean) }, as)}>Delegar</Button>
              </>
            )}
          </div>
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Terminar</h3>
            <input aria-label={`Resultado de ${run.id}`} className={input} placeholder="resultado" value={result} onChange={(event) => setResult(event.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={() => send({ type: "run.finish", runId: run.id, outcome: "completed", result }, as)}>Terminar con éxito</Button>
              <Button size="sm" variant="ghost" onClick={() => send({ type: "run.finish", runId: run.id, outcome: "failed", result }, as)}>Marcar fallida</Button>
            </div>
          </div>
        </div>
      )}
    </details>
  );
}
