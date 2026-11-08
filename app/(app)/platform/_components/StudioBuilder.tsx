"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { formatCostMicros, PLATFORM_OWNER } from "@/lib/contracts/platform/koe-registry";
import {
  CATEGORIES, LANGUAGES, MAX_BODY, MEMORY_MODES, TONES, assetsOf, declareVariables, diffLines, latestOf, publishedOf, testsOf, validateContent, validateMeta, versionOf,
  type AgentContent, type Category, type Clearance, type Content, type Kind, type PromptContent, type VariableSpec,
} from "@/lib/contracts/platform/studio-center";
import { label } from "@/lib/contracts/platform/studio-messages";
import type { BuilderTarget, StudioTabProps } from "./StudioCenter";
import { KoePanel } from "./StudioTabs";
import { INPUT_FULL } from "@/components/ui/form";

const CLEARANCES = ["public", "business", "personal"] as const;
const parseTags = (text: string) => text.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);

// ---------------------------------------------------------------- builder
export function BuilderTab({ state, send, persona, env, target }: StudioTabProps & { target: BuilderTarget }) {
  const existing = target.assetId ? state.assets.find((item) => item.id === target.assetId && item.tenantId === persona.tenantId) : undefined;
  const first = existing ? latestOf(existing).content : undefined;
  const [kind, setKind] = useState<Kind>(existing?.kind ?? target.kind);
  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [category, setCategory] = useState<Category>(existing?.category ?? "sales");
  const [tags, setTags] = useState((existing?.tags ?? []).join(", "));
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState<string | null>(null);

  const prompt0 = first?.kind === "prompt" ? first : undefined;
  const agent0 = first?.kind === "agent" ? first : undefined;
  const [body, setBody] = useState(prompt0?.body ?? "");
  const [clearance, setClearance] = useState<Clearance>(first?.clearance ?? "business");
  const [described, setDescribed] = useState<Record<string, { description: string; example: string }>>(Object.fromEntries((prompt0?.variables ?? []).map((item) => [item.name, { description: item.description, example: item.example }])));
  const [promptId, setPromptId] = useState(agent0?.promptId ?? "");
  const [workerIds, setWorkerIds] = useState<readonly string[]>(agent0?.workerIds ?? []);
  const [automationIds, setAutomationIds] = useState<readonly string[]>(agent0?.automationIds ?? []);
  const [courseIds, setCourseIds] = useState<readonly string[]>(agent0?.courseIds ?? []);
  const [memory, setMemory] = useState(agent0?.memory ?? { mode: "session" as const, maxEntries: 20, maxChars: 2_000 });
  const [personality, setPersonality] = useState(agent0?.personality ?? { tone: "friendly" as const, language: "es" as const, style: "" });
  const [limits, setLimits] = useState(agent0?.limits ?? { maxRunsPerDay: 50, maxStepsPerRun: 10, maxCostMicrosPerRun: 20_000 });

  const variables: VariableSpec[] = declareVariables(body).map((item) => ({ ...item, ...(described[item.name] ?? {}) }));
  const promptContent: PromptContent = { kind: "prompt", body, variables, clearance };
  const agentContent: AgentContent = { kind: "agent", promptId, workerIds, automationIds, courseIds, memory, personality, limits, clearance };
  const content: Content = kind === "prompt" ? promptContent : agentContent;
  const meta = { name, description, category, tags: parseTags(tags) };
  const issues = [...validateMeta(meta), ...validateContent(kind, content, { assets: state.assets, env, tenantId: persona.tenantId })];

  const workers = env.workers.filter((item) => item.status === "active" && (item.ownerTenantId === PLATFORM_OWNER || item.ownerTenantId === persona.tenantId));
  const automations = env.refs.automations.filter((item) => item.tenantId === persona.tenantId);
  const courses = env.refs.courses.filter((item) => item.tenantId === persona.tenantId);
  const prompts = assetsOf(state, persona.tenantId, "prompt").filter((item) => !item.archived);
  const toggle = (list: readonly string[], set: (value: readonly string[]) => void, id: string) => set(list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);

  const save = () => {
    let error: string | undefined;
    if (existing) {
      const changed = existing.name !== name.trim() || existing.description !== description || existing.category !== category || existing.tags.join(",") !== meta.tags.join(",");
      if (changed) error = send({ type: "asset.update", assetId: existing.id, meta });
      if (!error) error = send({ type: "asset.save", assetId: existing.id, content, note });
    } else error = send({ type: "asset.create", kind, meta, content, note });
    setSaved(error ? null : existing ? `Se guardó una nueva versión de «${name}»; las anteriores no cambian.` : `Se creó «${name}» como borrador.`);
  };

  return (
    <Card className="space-y-4 p-5">
      <h2 className="font-semibold">{existing ? `Editar «${existing.name}» (se guarda como nueva versión)` : kind === "prompt" ? "Nuevo prompt" : "Nuevo agente IA"}</h2>
      {existing && <p className="text-sm text-ink-muted">Las versiones nunca se sobrescriben: guardar crea la versión {existing.versions.length + 1} y deja las anteriores como están.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {!existing && (
          <label className="space-y-1 text-sm text-ink-muted">Tipo
            <select aria-label="Tipo" className={INPUT_FULL} value={kind} onChange={(event) => setKind(event.target.value as Kind)}>
              <option value="prompt">{label("kind", "prompt")}</option><option value="agent">{label("kind", "agent")}</option>
            </select>
          </label>
        )}
        <label className="space-y-1 text-sm text-ink-muted">Nombre<input aria-label="Nombre" className={INPUT_FULL} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="space-y-1 text-sm text-ink-muted">Descripción<input aria-label="Descripción" className={INPUT_FULL} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
        <label className="space-y-1 text-sm text-ink-muted">Categoría
          <select aria-label="Categoría" className={INPUT_FULL} value={category} onChange={(event) => setCategory(event.target.value as Category)}>{CATEGORIES.map((key) => <option key={key} value={key}>{label("category", key)}</option>)}</select>
        </label>
        <label className="space-y-1 text-sm text-ink-muted">Etiquetas (separadas por comas)<input aria-label="Etiquetas" className={INPUT_FULL} value={tags} onChange={(event) => setTags(event.target.value)} /></label>
        <label className="space-y-1 text-sm text-ink-muted">Nivel de datos
          <select aria-label="Nivel de datos" className={INPUT_FULL} value={clearance} onChange={(event) => setClearance(event.target.value as Clearance)}>{CLEARANCES.map((key) => <option key={key} value={key}>{label("clearance", key)}</option>)}</select>
        </label>
      </div>

      {kind === "prompt" ? (
        <section className="space-y-3">
          <label className="block space-y-1 text-sm text-ink-muted">Texto del prompt (use {"{{variable}}"} para datos dinámicos)
            <textarea aria-label="Texto del prompt" rows={7} className={INPUT_FULL} value={body} onChange={(event) => setBody(event.target.value)} />
          </label>
          <p className="text-xs text-ink-muted">{body.length} de {MAX_BODY} caracteres</p>
          <div className="space-y-2" aria-label="Variables">
            <h3 className="text-sm font-semibold">Variables</h3>
            {variables.length === 0 && <p className="text-sm text-ink-muted">El texto no usa variables todavía.</p>}
            {variables.map((item) => (
              <div key={item.name} className="grid gap-2 sm:grid-cols-3">
                <Badge tone="primary">{`{{${item.name}}}`}</Badge>
                <input aria-label={`Descripción de ${item.name}`} placeholder="Qué es" className={INPUT_FULL} value={item.description} onChange={(event) => setDescribed({ ...described, [item.name]: { description: event.target.value, example: item.example } })} />
                <input aria-label={`Ejemplo de ${item.name}`} placeholder="Ejemplo" className={INPUT_FULL} value={item.example} onChange={(event) => setDescribed({ ...described, [item.name]: { description: item.description, example: event.target.value } })} />
              </div>
            ))}
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          <label className="block space-y-1 text-sm text-ink-muted">Prompt principal
            <select aria-label="Prompt principal" className={INPUT_FULL} value={promptId} onChange={(event) => setPromptId(event.target.value)}>
              <option value="">Elija un prompt…</option>{prompts.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <p className="text-xs text-ink-muted">Conectar Workers, automatizaciones o cursos es {label("level", "2").toLowerCase()}: necesita una autorización vigente de una persona (pestaña Panel).</p>
          <fieldset className="space-y-1"><legend className="text-sm font-semibold">Workers (KOE elige entre ellos)</legend>
            {workers.map((item) => <label key={item.id} className="mr-4 inline-flex items-center gap-1.5 text-sm"><input type="checkbox" aria-label={`Worker ${item.name}`} checked={workerIds.includes(item.id)} onChange={() => toggle(workerIds, setWorkerIds, item.id)} />{item.name}</label>)}
          </fieldset>
          <fieldset className="space-y-1"><legend className="text-sm font-semibold">Automatizaciones</legend>
            {automations.length === 0 && <p className="text-xs text-ink-muted">Su empresa no tiene automatizaciones.</p>}
            {automations.map((item) => <label key={item.id} className="mr-4 inline-flex items-center gap-1.5 text-sm"><input type="checkbox" aria-label={`Automatización ${item.name}`} checked={automationIds.includes(item.id)} onChange={() => toggle(automationIds, setAutomationIds, item.id)} />{item.name}</label>)}
          </fieldset>
          <fieldset className="space-y-1"><legend className="text-sm font-semibold">Cursos (Academia)</legend>
            {courses.length === 0 && <p className="text-xs text-ink-muted">Su empresa no tiene cursos.</p>}
            {courses.map((item) => <label key={item.id} className="mr-4 inline-flex items-center gap-1.5 text-sm"><input type="checkbox" aria-label={`Curso ${item.name}`} checked={courseIds.includes(item.id)} onChange={() => toggle(courseIds, setCourseIds, item.id)} />{item.name}</label>)}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-sm text-ink-muted">Memoria
              <select aria-label="Memoria" className={INPUT_FULL} value={memory.mode} onChange={(event) => setMemory({ ...memory, mode: event.target.value as typeof memory.mode })}>{MEMORY_MODES.map((key) => <option key={key} value={key}>{label("memory", key)}</option>)}</select>
            </label>
            <label className="space-y-1 text-sm text-ink-muted">Entradas de memoria<input type="number" aria-label="Entradas de memoria" className={INPUT_FULL} value={memory.maxEntries} onChange={(event) => setMemory({ ...memory, maxEntries: Number(event.target.value) })} /></label>
            <label className="space-y-1 text-sm text-ink-muted">Caracteres de memoria<input type="number" aria-label="Caracteres de memoria" className={INPUT_FULL} value={memory.maxChars} onChange={(event) => setMemory({ ...memory, maxChars: Number(event.target.value) })} /></label>
            <label className="space-y-1 text-sm text-ink-muted">Tono
              <select aria-label="Tono" className={INPUT_FULL} value={personality.tone} onChange={(event) => setPersonality({ ...personality, tone: event.target.value as typeof personality.tone })}>{TONES.map((key) => <option key={key} value={key}>{label("tone", key)}</option>)}</select>
            </label>
            <label className="space-y-1 text-sm text-ink-muted">Idioma
              <select aria-label="Idioma" className={INPUT_FULL} value={personality.language} onChange={(event) => setPersonality({ ...personality, language: event.target.value as typeof personality.language })}>{LANGUAGES.map((key) => <option key={key} value={key}>{key}</option>)}</select>
            </label>
            <label className="space-y-1 text-sm text-ink-muted">Estilo<input aria-label="Estilo" className={INPUT_FULL} value={personality.style} onChange={(event) => setPersonality({ ...personality, style: event.target.value })} /></label>
            <label className="space-y-1 text-sm text-ink-muted">Ejecuciones por día<input type="number" aria-label="Ejecuciones por día" className={INPUT_FULL} value={limits.maxRunsPerDay} onChange={(event) => setLimits({ ...limits, maxRunsPerDay: Number(event.target.value) })} /></label>
            <label className="space-y-1 text-sm text-ink-muted">Pasos por ejecución<input type="number" aria-label="Pasos por ejecución" className={INPUT_FULL} value={limits.maxStepsPerRun} onChange={(event) => setLimits({ ...limits, maxStepsPerRun: Number(event.target.value) })} /></label>
            <label className="space-y-1 text-sm text-ink-muted">Costo máximo por ejecución (millonésimas de US$)<input type="number" aria-label="Costo máximo por ejecución" className={INPUT_FULL} value={limits.maxCostMicrosPerRun} onChange={(event) => setLimits({ ...limits, maxCostMicrosPerRun: Number(event.target.value) })} /></label>
          </div>
        </section>
      )}

      <label className="block space-y-1 text-sm text-ink-muted">Nota de la versión (opcional)<input aria-label="Nota de la versión" className={INPUT_FULL} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      {issues.length > 0 && <ul aria-label="Pendientes del formulario" className="list-disc space-y-0.5 pl-5 text-sm text-warning">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
      {saved && <p role="status" className="text-sm text-success">{saved}</p>}
      <Button size="sm" disabled={issues.length > 0} onClick={save}>{existing ? "Guardar nueva versión" : kind === "prompt" ? "Crear prompt" : "Crear agente"}</Button>
    </Card>
  );
}

// ---------------------------------------------------------------- playground
export function PlaygroundTab({ state, send, persona, env, testTarget }: StudioTabProps) {
  const assets = assetsOf(state, persona.tenantId).filter((item) => !item.archived);
  const [assetId, setAssetId] = useState(testTarget.assetId && assets.some((item) => item.id === testTarget.assetId) ? testTarget.assetId : assets[0]?.id ?? "");
  const asset = assets.find((item) => item.id === assetId);
  const [version, setVersion] = useState<number>(testTarget.version ?? (asset ? latestOf(asset).number : 1));
  const [other, setOther] = useState<number | "">("");
  const [workerId, setWorkerId] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});

  const chosenVersion = asset ? versionOf(asset, version) ?? latestOf(asset) : undefined;
  const content = chosenVersion?.content;
  const promptOf = (c: Content | undefined): PromptContent | undefined => {
    if (c?.kind === "prompt") return c;
    if (c?.kind === "agent") { const p = state.assets.find((item) => item.id === c.promptId); const published = p && publishedOf(p)?.content; return published && published.kind === "prompt" ? published : undefined; }
    return undefined;
  };
  const variables = promptOf(content)?.variables ?? [];
  const mine = testsOf(state, persona.tenantId).filter((run) => run.assetId === assetId);
  const last = mine.at(-1);
  const shown = last ? (last.compareGroup ? mine.filter((run) => run.compareGroup === last.compareGroup) : [last]) : [];
  const run = () => { if (asset) send({ type: "test.run", assetId: asset.id, versionNumber: version, inputs, ...(workerId ? { workerId } : {}) }); };
  const compare = () => { if (asset && other !== "") send({ type: "test.compare", assetId: asset.id, a: version, b: other, inputs }); };
  const bodyA = shown[0] && asset ? promptOf(versionOf(asset, shown[0].versionNumber)?.content)?.body : undefined;
  const bodyB = shown[1] && asset ? promptOf(versionOf(asset, shown[1].versionNumber)?.content)?.body : undefined;

  if (assets.length === 0) return <p className="text-sm text-ink-muted">Cree un prompt o un agente para probarlo aquí.</p>;
  return (
    <div className="space-y-5">
      <Card className="space-y-4 p-5">
        <p className="text-sm text-ink-muted">La prueba pasa por KOE: KOE elige el Worker y el Worker el modelo. La salida es una simulación; no se llama a ningún modelo.</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="space-y-1 text-sm text-ink-muted">Qué probar
            <select aria-label="Qué probar" className={INPUT_FULL} value={assetId} onChange={(event) => { const next = assets.find((item) => item.id === event.target.value); setAssetId(event.target.value); setVersion(next ? latestOf(next).number : 1); setOther(""); }}>
              {assets.map((item) => <option key={item.id} value={item.id}>{item.name} ({label("kind", item.kind)})</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm text-ink-muted">Versión
            <select aria-label="Versión" className={INPUT_FULL} value={version} onChange={(event) => setVersion(Number(event.target.value))}>
              {asset?.versions.map((item) => <option key={item.id} value={item.number}>v{item.number} · {label("versionState", item.state)}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm text-ink-muted">Worker
            <select aria-label="Worker" className={INPUT_FULL} value={workerId} onChange={(event) => setWorkerId(event.target.value)}>
              <option value="">Que KOE elija</option>
              {env.workers.filter((item) => item.status === "active" && (item.ownerTenantId === PLATFORM_OWNER || item.ownerTenantId === persona.tenantId)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-sm text-ink-muted">Comparar con
            <select aria-label="Comparar con" className={INPUT_FULL} value={other} onChange={(event) => setOther(event.target.value === "" ? "" : Number(event.target.value))}>
              <option value="">Sin comparar</option>
              {asset?.versions.filter((item) => item.number !== version).map((item) => <option key={item.id} value={item.number}>v{item.number}</option>)}
            </select>
          </label>
        </div>
        {variables.length === 0 && <p className="text-sm text-ink-muted">Esta versión no necesita datos de entrada.</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          {variables.map((item) => (
            <label key={item.name} className="space-y-1 text-xs text-ink-muted">{item.name}{item.description ? ` · ${item.description}` : ""}
              <input aria-label={`Entrada ${item.name}`} placeholder={item.example || "Valor de prueba"} className={INPUT_FULL} value={inputs[item.name] ?? ""} onChange={(event) => setInputs({ ...inputs, [item.name]: event.target.value })} />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={run}>Probar</Button>
          <Button size="sm" variant="secondary" disabled={other === ""} onClick={compare}>Comparar versiones</Button>
        </div>
      </Card>

      {shown.length > 0 && (
        <section className="space-y-3" aria-label="Resultado de la prueba">
          <h2 className="font-semibold">{shown.length > 1 ? "Comparación de versiones" : "Resultado de la prueba"}</h2>
          <div className={shown.length > 1 ? "grid gap-3 lg:grid-cols-2" : ""}>
            {shown.map((item) => (
              <Card key={item.id} className="space-y-2 p-4" aria-label={`Resultado v${item.versionNumber}`}>
                <div className="flex flex-wrap items-center gap-2"><Badge tone="primary">v{item.versionNumber}</Badge><span className="text-xs text-ink-muted">{item.id}</span></div>
                <p className="text-xs text-ink-muted">Texto enviado: {item.rendered}</p>
                <p className="text-sm">{item.output}</p>
                <KoePanel run={item} />
              </Card>
            ))}
          </div>
          {shown.length > 1 && (
            <>
              <p className="text-sm text-ink-soft">Diferencia: costo {formatCostMicros(Math.abs(shown[1].estimatedCostMicros - shown[0].estimatedCostMicros))} {shown[1].estimatedCostMicros >= shown[0].estimatedCostMicros ? "más" : "menos"} en v{shown[1].versionNumber}; tiempo {Math.abs(shown[1].estimatedMs - shown[0].estimatedMs)} ms {shown[1].estimatedMs >= shown[0].estimatedMs ? "más" : "menos"}. Ambas pasaron por el mismo Worker.</p>
              {bodyA !== undefined && bodyB !== undefined && (
                <pre aria-label="Diferencias del texto" className="overflow-x-auto rounded-xl bg-raised p-3 text-xs">
                  {diffLines(bodyA, bodyB).map((line, index) => <div key={index} className={line.type === "added" ? "text-success" : line.type === "removed" ? "text-danger-soft" : "text-ink-muted"}>{line.type === "added" ? "+ " : line.type === "removed" ? "- " : "  "}{line.text}</div>)}
                </pre>
              )}
            </>
          )}
        </section>
      )}
      <section className="space-y-1">
        <h2 className="font-semibold">Pruebas de este elemento</h2>
        {mine.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay pruebas.</p>}
        <ul className="space-y-1 text-sm text-ink-soft">{[...mine].reverse().slice(0, 8).map((item) => <li key={item.id}>{item.at.slice(0, 16).replace("T", " ")} · v{item.versionNumber} · {item.workerName} · {item.model.label} · {formatCostMicros(item.estimatedCostMicros)}</li>)}</ul>
      </section>
    </div>
  );
}
