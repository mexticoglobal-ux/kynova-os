"use client";

import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { hiddenNote, latest } from "@/lib/contracts/platform/display";
import { formatCostMicros } from "@/lib/contracts/platform/koe-registry";
import {
  assetsOf, grantsOf, latestOf, publishedOf, sharesOf, statusOf, studioStats, templatesOf, testsOf, toMarketplaceDraft,
  type Asset, type AssetStatus, type Kind, type TestRun, type VersionState,
} from "@/lib/contracts/platform/studio-center";
import { DEMO_TENANTS } from "@/lib/contracts/platform/studio-demo";
import { label } from "@/lib/contracts/platform/studio-messages";
import type { StudioTabProps } from "./StudioCenter";

const STATUS_TONE: Record<AssetStatus, BadgeTone> = { draft: "neutral", inReview: "warning", published: "success", archived: "neutral" };
const VERSION_TONE: Record<VersionState, BadgeTone> = { draft: "neutral", pendingApproval: "warning", published: "success", rejected: "danger", superseded: "neutral" };
const time = (iso: string) => iso.slice(0, 16).replace("T", " ");
const who = (actor: string) => (actor.startsWith("worker:") ? "NEX (IA)" : actor);
const inputClass = "w-full rounded-xl border border-line bg-raised px-3 py-1.5 text-sm text-ink";

/** What KOE decided for a test: the Worker and why, the model and why, the estimated cost and time. Nothing was called. */
export function KoePanel({ run }: { run: TestRun }) {
  return (
    <dl aria-label={`KOE ${run.id}`} className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
      <div><dt className="inline text-ink-muted">Worker utilizado: </dt><dd className="inline font-medium">{run.workerName}</dd></div>
      <div><dt className="inline text-ink-muted">Motivo del Worker: </dt><dd className="inline">{run.workerReason}</dd></div>
      <div><dt className="inline text-ink-muted">Modelo seleccionado por KOE: </dt><dd className="inline font-medium">{run.model.label}</dd></div>
      <div><dt className="inline text-ink-muted">Motivo de la selección: </dt><dd className="inline">{run.modelReason}</dd></div>
      <div><dt className="inline text-ink-muted">Costo estimado: </dt><dd className="inline font-medium">{formatCostMicros(run.estimatedCostMicros)}</dd></div>
      <div><dt className="inline text-ink-muted">Tiempo estimado: </dt><dd className="inline font-medium">{(run.estimatedMs / 1000).toFixed(2)} s</dd></div>
      <div className="sm:col-span-2 text-xs text-ink-muted">{label("level", "1")} · {run.tokensIn + run.tokensOut} tokens estimados · son estimaciones, no mediciones ni una factura · no se llamó a ningún modelo</div>
    </dl>
  );
}

// ---------------------------------------------------------------- dashboard
export function DashboardTab({ state, send, persona }: StudioTabProps) {
  const stats = studioStats(state, persona.tenantId);
  const pending = assetsOf(state, persona.tenantId).flatMap((asset) => asset.versions.filter((version) => version.state === "pendingApproval").map((version) => ({ asset, version })));
  const grant = grantsOf(state, persona.tenantId).find((item) => item.status === "active");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const recent = latest(testsOf(state, persona.tenantId), 5);
  const card = "space-y-1 p-4";
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className={card}><p className="text-sm text-ink-muted">Prompts</p><p className="text-sm">{stats.prompts.published} publicados · {stats.prompts.inReview} en revisión · {stats.prompts.draft} en borrador</p></Card>
        <Card className={card}><p className="text-sm text-ink-muted">Agentes IA</p><p className="text-sm">{stats.agents.published} publicados · {stats.agents.inReview} en revisión · {stats.agents.draft} en borrador</p></Card>
        <Card className={card}><p className="text-sm text-ink-muted">Versiones guardadas</p><p className="text-lg font-semibold">{stats.versions}</p><p className="text-xs text-ink-muted">Nunca se sobrescriben</p></Card>
        <Card className={card}><p className="text-sm text-ink-muted">Pendientes de aprobación</p><p className="text-lg font-semibold">{stats.pendingApprovals}</p></Card>
        <Card className={card}><p className="text-sm text-ink-muted">Pruebas</p><p className="text-lg font-semibold">{stats.tests}</p><p className="text-xs text-ink-muted">Costo estimado: {formatCostMicros(stats.estimatedCostMicros)} (estimación, no factura)</p></Card>
        <Card className={card}><p className="text-sm text-ink-muted">Plantillas</p><p className="text-lg font-semibold">{stats.templates}</p></Card>
        <Card className={card}><p className="text-sm text-ink-muted">Compartir entre empresas</p><p className="text-sm">{stats.shares.proposed} propuestos · {stats.shares.approved} aprobados · {stats.shares.revoked} revocados</p></Card>
        <Card className={card}>
          <p className="text-sm text-ink-muted">Niveles de la Constitución</p>
          <ul className="text-xs text-ink-soft"><li>{label("level", "1")}</li><li>{label("level", "2")}</li><li>{label("level", "3")}</li></ul>
        </Card>
      </div>

      <Card className="space-y-2 p-4" aria-label="Autorización de asignaciones">
        <h2 className="font-semibold">Autorización para conectar agentes ({label("level", "2")})</h2>
        <p className="text-sm text-ink-muted">Conectar un agente con Workers, automatizaciones o cursos necesita una autorización vigente de una persona. Con ella, NEX y el equipo pueden hacerlo dentro de sus límites.</p>
        {grant
          ? <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="success">Vigente</Badge><span>{grant.maxPerDay ? `hasta ${grant.maxPerDay} usos por día` : "sin límite diario"} · concedida por {who(grant.grantedBy)}</span><Button size="sm" variant="ghost" onClick={() => send({ type: "authorization.revoke", grantId: grant.id })}>Revocar autorización</Button></div>
          : <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="warning">Sin autorización</Badge><Button size="sm" variant="secondary" onClick={() => send({ type: "authorization.grant", maxPerDay: 10 })}>Conceder autorización (10 usos por día)</Button></div>}
      </Card>

      <section className="space-y-2">
        <h2 className="font-semibold">Pendientes de aprobación ({label("level", "3")})</h2>
        {pending.length === 0 && <p className="text-sm text-ink-muted">No hay versiones esperando aprobación.</p>}
        <ul className="space-y-2">
          {pending.map(({ asset, version }) => (
            <Card as="li" key={`${asset.id}-${version.number}`} aria-label={`Pendiente ${asset.name} v${version.number}`} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{asset.name}</span><Badge>{label("kind", asset.kind)}</Badge><span className="text-sm text-ink-muted">v{version.number} · enviada por {who(version.submittedBy ?? version.createdBy)}{version.note ? ` · ${version.note}` : ""}</span></div>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => send({ type: "version.approve", assetId: asset.id, versionNumber: version.number })}>Aprobar y publicar</Button>
                <input aria-label={`Motivo del rechazo de ${asset.name} v${version.number}`} placeholder="Motivo del rechazo" className="w-56 rounded-xl border border-line bg-raised px-2 py-1 text-sm text-ink" value={reasons[`${asset.id}-${version.number}`] ?? ""} onChange={(event) => setReasons({ ...reasons, [`${asset.id}-${version.number}`]: event.target.value })} />
                <Button size="sm" variant="ghost" onClick={() => send({ type: "version.reject", assetId: asset.id, versionNumber: version.number, note: reasons[`${asset.id}-${version.number}`] ?? "" })}>Rechazar</Button>
              </div>
            </Card>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Últimas pruebas</h2>
        {recent.shown.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay pruebas.</p>}
        <ul className="space-y-1 text-sm">{recent.shown.map((run) => <li key={run.id} className="text-ink-soft">{time(run.at)} · {run.assetName} v{run.versionNumber} · {run.workerName} · {run.model.label} · {formatCostMicros(run.estimatedCostMicros)}</li>)}</ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- library
function AssetCard({ asset, ...props }: StudioTabProps & { asset: Asset }) {
  const { send, edit, test, state } = props;
  const status = statusOf(asset);
  const published = publishedOf(asset);
  const prompt = (id: string) => state.assets.find((item) => item.id === id)?.name ?? id;
  const content = latestOf(asset).content;
  return (
    <Card as="li" aria-label={`${label("kind", asset.kind)} ${asset.name}`} className="space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{asset.name}</h2>
          {asset.description && <p className="text-sm text-ink-muted">{asset.description}</p>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={STATUS_TONE[status]}>{label("status", status)}</Badge>
          <Badge>{label("category", asset.category)}</Badge>
          {asset.tags.map((tag) => <Badge key={tag} tone="primary">#{tag}</Badge>)}
        </div>
      </div>
      <p className="text-xs text-ink-muted">
        Creado por {who(asset.createdBy)} · {published ? `publicada v${published.number}` : "sin versión publicada"}
        {asset.source.origin !== "own" ? ` · origen: ${asset.source.origin === "template" ? "plantilla" : asset.source.origin === "duplicate" ? "copia" : "compartido"} ${asset.source.ref ?? ""}` : ""}
      </p>
      {content.kind === "agent" && (
        <p className="text-xs text-ink-soft">Prompt principal: {prompt(content.promptId)} · Workers: {content.workerIds.length} · Automatizaciones: {content.automationIds.length} · Cursos: {content.courseIds.length} · Memoria: {label("memory", content.memory.mode)} · Tono: {label("tone", content.personality.tone)}</p>
      )}
      <ul className="space-y-1.5" aria-label={`Versiones de ${asset.name}`}>
        {[...asset.versions].reverse().map((version) => (
          <li key={version.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">v{version.number}</span>
            <Badge tone={VERSION_TONE[version.state]}>{label("versionState", version.state)}</Badge>
            <span className="text-xs text-ink-muted">{who(version.createdBy)} · {time(version.createdAt)}{version.note ? ` · ${version.note}` : ""}{version.decisionNote ? ` · «${version.decisionNote}»` : ""}</span>
            <Button size="sm" variant="ghost" onClick={() => test(asset.id, version.number)}>Probar v{version.number}</Button>
            {version.state === "draft" && <Button size="sm" variant="secondary" disabled={asset.archived} onClick={() => send({ type: "version.submit", assetId: asset.id, versionNumber: version.number })}>Enviar v{version.number} a revisión</Button>}
            {version.state === "pendingApproval" && <Button size="sm" onClick={() => send({ type: "version.approve", assetId: asset.id, versionNumber: version.number })}>Aprobar v{version.number}</Button>}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={asset.archived} onClick={() => edit({ assetId: asset.id, kind: asset.kind })}>Editar (nueva versión)</Button>
        <Button size="sm" variant="ghost" onClick={() => send({ type: "asset.duplicate", assetId: asset.id })}>Duplicar</Button>
        <Button size="sm" variant="ghost" onClick={() => send({ type: "asset.archive", assetId: asset.id, archived: !asset.archived })}>{asset.archived ? "Restaurar" : "Archivar"}</Button>
      </div>
    </Card>
  );
}

export function LibraryTab({ kind, ...props }: StudioTabProps & { kind: Kind }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const all = assetsOf(props.state, props.persona.tenantId, kind);
  const shown = all.filter((asset) => (category === "" || asset.category === category) && `${asset.name} ${asset.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const title = kind === "prompt" ? "Biblioteca de Prompts" : "Biblioteca de Agentes IA";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <Button size="sm" onClick={() => props.edit({ kind })}>{kind === "prompt" ? "Nuevo prompt" : "Nuevo agente"}</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <input aria-label={`Buscar en ${title}`} placeholder="Buscar por nombre o etiqueta" className="w-64 rounded-xl border border-line bg-raised px-3 py-1.5 text-sm text-ink" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="Filtrar por categoría" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-sm text-ink" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="">Todas las categorías</option>
          {(["sales", "support", "marketing", "education", "operations", "analysis", "other"] as const).map((key) => <option key={key} value={key}>{label("category", key)}</option>)}
        </select>
      </div>
      {all.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay {kind === "prompt" ? "prompts" : "agentes"}. Cree uno o cargue los datos de ejemplo.</p>}
      {all.length > 0 && shown.length === 0 && <p className="text-sm text-ink-muted">Nada coincide con la búsqueda.</p>}
      <ul className="grid gap-4 lg:grid-cols-2">{shown.map((asset) => <AssetCard key={asset.id} asset={asset} {...props} />)}</ul>
    </div>
  );
}

// ---------------------------------------------------------------- history
export function HistoryTab({ state, persona }: StudioTabProps) {
  const tests = latest(testsOf(state, persona.tenantId));
  const audit = latest(state.audit.filter((entry) => entry.tenantId === persona.tenantId));
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="font-semibold">Historial de pruebas</h2>
        {tests.shown.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay pruebas.</p>}
        <ul className="space-y-2">
          {tests.shown.map((run) => (
            <Card as="li" key={run.id} aria-label={`Prueba ${run.id}`} className="space-y-1 p-4">
              <p className="text-sm"><span className="font-medium">{run.assetName} v{run.versionNumber}</span> · {time(run.at)} · {who(run.by)}{run.compareGroup ? " · comparación" : ""}</p>
              <p className="text-xs text-ink-muted">Entrada: {Object.entries(run.inputs).map(([key, value]) => `${key}=${value}`).join(", ") || "—"}</p>
              <p className="text-sm text-ink-soft">{run.output}</p>
              <KoePanel run={run} />
            </Card>
          ))}
        </ul>
        {hiddenNote(tests.hidden) && <p className="text-xs text-ink-muted">{hiddenNote(tests.hidden)}</p>}
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Registro de actividad</h2>
        {audit.shown.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay actividad.</p>}
        <ul className="space-y-1 text-sm">{audit.shown.map((entry, index) => <li key={`${entry.at}-${index}`} className="text-ink-soft"><span className="text-xs text-ink-muted">{time(entry.at)}</span> · {who(entry.actor)} · {entry.action}{entry.detail ? ` — ${entry.detail}` : ""}</li>)}</ul>
        {hiddenNote(audit.hidden) && <p className="text-xs text-ink-muted">{hiddenNote(audit.hidden)}</p>}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- templates and sharing
export function TemplatesTab({ state, send, persona, env, tenantName }: StudioTabProps) {
  const published = assetsOf(state, persona.tenantId).flatMap((asset) => asset.versions.filter((version) => version.state === "published").map((version) => ({ asset, version })));
  const templates = templatesOf(state, persona.tenantId);
  const shares = sharesOf(state, persona.tenantId);
  const prompts = assetsOf(state, persona.tenantId, "prompt").filter((asset) => !asset.archived);
  const [pick, setPick] = useState("");
  const [promptId, setPromptId] = useState("");
  const [target, setTarget] = useState(DEMO_TENANTS.find((tenant) => tenant.id !== persona.tenantId)?.id ?? "");
  void env;
  const choice = published.find((item) => `${item.asset.id}:${item.version.number}` === (pick || `${published[0]?.asset.id}:${published[0]?.version.number}`));
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="font-semibold">Plantillas</h2>
        <p className="text-sm text-ink-muted">Una plantilla guarda el autor, la empresa, el origen y la versión, lista para una futura biblioteca. Todavía no hay Marketplace de prompts: nada se publica fuera de su empresa.</p>
        {published.length === 0 ? <p className="text-sm text-ink-muted">Publique una versión para poder crear una plantilla.</p> : (
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm text-ink-muted">Versión publicada
              <select aria-label="Versión publicada" className={inputClass} value={pick || `${published[0].asset.id}:${published[0].version.number}`} onChange={(event) => setPick(event.target.value)}>
                {published.map(({ asset, version }) => <option key={`${asset.id}:${version.number}`} value={`${asset.id}:${version.number}`}>{asset.name} v{version.number}</option>)}
              </select>
            </label>
            <Button size="sm" disabled={!choice} onClick={() => choice && send({ type: "template.create", assetId: choice.asset.id, versionNumber: choice.version.number })}>Crear plantilla</Button>
            <Button size="sm" variant="secondary" disabled={!choice} onClick={() => choice && send({ type: "share.propose", assetId: choice.asset.id, versionNumber: choice.version.number, toTenantId: target })}>Proponer compartir</Button>
            <label className="space-y-1 text-sm text-ink-muted">Empresa destinataria
              <select aria-label="Empresa destinataria" className={inputClass} value={target} onChange={(event) => setTarget(event.target.value)}>
                {DEMO_TENANTS.filter((tenant) => tenant.id !== persona.tenantId).map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
              </select>
            </label>
          </div>
        )}
        {templates.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay plantillas.</p>}
        <ul className="grid gap-3 lg:grid-cols-2">
          {templates.map((template) => {
            const draft = toMarketplaceDraft(template);
            return (
              <Card as="li" key={template.id} aria-label={`Plantilla ${template.name}`} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{template.name}</span><Badge>{template.kind === "prompt" ? "PromptTemplate" : "AgentTemplate"}</Badge></div>
                <p className="text-xs text-ink-muted">Versión {template.version} · autor {who(template.author)} · empresa {tenantName(template.company)} · origen {template.source.origin} {template.source.ref}@{template.source.version}</p>
                <p className="text-xs text-ink-muted">Listo para el Marketplace como «{draft.kind === "aiAgent" ? "agente IA" : "recurso digital"}»; todavía no se publica nada.</p>
                <div className="flex flex-wrap items-center gap-2">
                  {template.kind === "agent" && (
                    <select aria-label={`Prompt principal para ${template.name}`} className="rounded-xl border border-line bg-raised px-2 py-1 text-sm text-ink" value={promptId} onChange={(event) => setPromptId(event.target.value)}>
                      <option value="">Prompt principal…</option>
                      {prompts.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                    </select>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => send({ type: "asset.fromTemplate", templateId: template.id, ...(promptId ? { promptId } : {}) })}>Crear borrador desde la plantilla</Button>
                </div>
              </Card>
            );
          })}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Compartir entre empresas <span className="text-sm font-normal text-ink-muted">({label("level", "3")}; solo arquitectura)</span></h2>
        <p className="text-sm text-ink-muted">Un acuerdo aprobado es un registro: todavía no se copia nada ni la otra empresa ve algo. Lo aprueba una persona de la empresa dueña.</p>
        {shares.length === 0 && <p className="text-sm text-ink-muted">No hay acuerdos de compartir.</p>}
        <ul className="space-y-2">
          {shares.map((share) => {
            const asset = state.assets.find((item) => item.id === share.assetId);
            return (
              <Card as="li" key={share.id} aria-label={`Acuerdo ${share.id}`} className="flex flex-wrap items-center gap-2 p-3 text-sm">
                <span className="font-medium">{asset?.name ?? share.assetId} v{share.versionNumber}</span><span>→ {tenantName(share.toTenantId)}</span>
                <Badge tone={share.status === "approved" ? "success" : share.status === "revoked" ? "neutral" : "warning"}>{label("shareStatus", share.status)}</Badge>
                <span className="text-xs text-ink-muted">propuesto por {who(share.proposedBy)}</span>
                {share.status === "proposed" && <Button size="sm" onClick={() => send({ type: "share.approve", shareId: share.id })}>Aprobar acuerdo</Button>}
                {share.status !== "revoked" && <Button size="sm" variant="ghost" onClick={() => send({ type: "share.revoke", shareId: share.id })}>Revocar</Button>}
              </Card>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
