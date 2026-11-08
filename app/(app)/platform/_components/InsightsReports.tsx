"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { hiddenNote, latest } from "@/lib/contracts/platform/display";
import { FORMATS, FREQUENCIES, FUTURE_CAPABILITIES, VIEWS, correctionsOf, effectiveValue, exportsOf, factsOf, reportsOf, type Format, type Frequency, type InsightsState, type ViewKey } from "@/lib/contracts/platform/insights-center";
import { label } from "@/lib/contracts/platform/insights-messages";
import { metricOf } from "@/lib/contracts/platform/koe-ledger";
import type { InsightsTabProps } from "./InsightsCenter";
import { INPUT_FULL } from "@/components/ui/form";

const who = (actor: string) => (actor.startsWith("worker:") ? "NEX (IA)" : actor);
const time = (iso: string) => iso.slice(0, 16).replace("T", " ");

export function ReportsTab({ state, send, persona }: InsightsTabProps & { state: InsightsState }) {
  const reports = reportsOf(state, persona.tenantId);
  const exports = latest(exportsOf(state, persona.tenantId), 10);
  const corrections = correctionsOf(state, persona.tenantId);
  const facts = latest(factsOf(state, persona.tenantId).filter((fact) => !fact.correctionOf && fact.metric === "tasksCompleted" || fact.metric === "customersServed"), 20);
  const [name, setName] = useState("");
  const [sections, setSections] = useState<readonly ViewKey[]>(["executive"]);
  const [format, setFormat] = useState<Format>("pdf");
  const [recipients, setRecipients] = useState<Record<string, string>>({});
  const [factId, setFactId] = useState("");
  const [newValue, setNewValue] = useState("");
  const [reason, setReason] = useState("");
  const chosen = factId || facts.shown[0]?.id || "";
  const chosenFact = facts.shown.find((fact) => fact.id === chosen);

  return (
    <div className="space-y-8">
      <section className="space-y-3" aria-label="Reportes ejecutivos">
        <h2 className="font-semibold">Reportes ejecutivos</h2>
        <p className="text-sm text-ink-muted">Hoy solo existe la arquitectura: un reporte es una definición, y la exportación a PDF o Excel es una <strong>descripción simulada</strong> (no se genera ningún archivo). NEX puede preparar borradores y exportaciones simuladas; aprobar, programar y compartir lo decide una persona. Programar y compartir son registros: nada se envía.</p>
        <Card className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-sm text-ink-muted">Nombre del reporte<input aria-label="Nombre del reporte" className={INPUT_FULL} value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className="space-y-1 text-sm text-ink-muted">Formato
              <select aria-label="Formato" className={INPUT_FULL} value={format} onChange={(event) => setFormat(event.target.value as Format)}>{FORMATS.map((item) => <option key={item} value={item}>{item === "pdf" ? "PDF" : "Excel"}</option>)}</select>
            </label>
          </div>
          <fieldset className="flex flex-wrap gap-x-4 gap-y-1"><legend className="text-sm font-semibold">Secciones</legend>
            {VIEWS.map((view) => <label key={view} className="inline-flex items-center gap-1.5 text-sm"><input type="checkbox" aria-label={`Sección ${label("view", view)}`} checked={sections.includes(view)} onChange={() => setSections(sections.includes(view) ? sections.filter((item) => item !== view) : [...sections, view])} />{label("view", view)}</label>)}
          </fieldset>
          <Button size="sm" onClick={() => send({ type: "report.draft", input: { name, sections, format } })}>Preparar borrador de reporte</Button>
        </Card>
        {reports.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay reportes.</p>}
        <ul className="grid gap-3 lg:grid-cols-2">
          {reports.map((report) => (
            <Card as="li" key={report.id} aria-label={`Reporte ${report.name}`} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{report.name}</span><Badge tone={report.status === "approved" ? "success" : "neutral"}>{label("reportStatus", report.status)}</Badge><Badge>{report.format === "pdf" ? "PDF" : "Excel"}</Badge><Badge tone="primary">{label("frequency", report.frequency)}</Badge></div>
              <p className="text-xs text-ink-muted">Secciones: {report.sections.map((view) => label("view", view)).join(", ")} · creado por {who(report.createdBy)}{report.approvedBy ? ` · aprobado por ${who(report.approvedBy)}` : ""}{report.recipients.length ? ` · compartido con ${report.recipients.join(", ")}` : ""}</p>
              <div className="flex flex-wrap items-center gap-2">
                {report.status === "draft" && <Button size="sm" onClick={() => send({ type: "report.approve", reportId: report.id })}>Aprobar</Button>}
                <Button size="sm" variant="secondary" onClick={() => send({ type: "report.export", reportId: report.id })}>Exportar (simulado)</Button>
                <select aria-label={`Frecuencia de ${report.name}`} className="rounded-xl border border-line bg-raised px-2 py-1 text-sm text-ink" value={report.frequency} onChange={(event) => send({ type: "report.schedule", reportId: report.id, frequency: event.target.value as Frequency })}>
                  {FREQUENCIES.map((item) => <option key={item} value={item}>{label("frequency", item)}</option>)}
                </select>
                <input aria-label={`Compartir ${report.name} con`} placeholder="Personas del equipo, separadas por comas" className="w-56 rounded-xl border border-line bg-raised px-2 py-1 text-sm text-ink" value={recipients[report.id] ?? ""} onChange={(event) => setRecipients({ ...recipients, [report.id]: event.target.value })} />
                <Button size="sm" variant="ghost" onClick={() => send({ type: "report.share", reportId: report.id, recipients: (recipients[report.id] ?? "").split(",") })}>Compartir</Button>
              </div>
            </Card>
          ))}
        </ul>
        <h3 className="text-sm font-semibold">Exportaciones simuladas</h3>
        {exports.shown.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay exportaciones.</p>}
        <ul className="space-y-1 text-sm" aria-label="Exportaciones simuladas">{exports.shown.map((item) => <li key={item.id} className="text-ink-soft">{time(item.at)} · {item.filename} · {item.sections.length} secciones · por {who(item.by)} · <Badge tone="neutral">Simulada, sin archivo</Badge></li>)}</ul>
        {hiddenNote(exports.hidden) && <p className="text-xs text-ink-muted">{hiddenNote(exports.hidden)}</p>}
      </section>

      <section className="space-y-3" aria-label="Correcciones de métricas">
        <h2 className="font-semibold">Correcciones de métricas</h2>
        <p className="text-sm text-ink-muted">Las métricas las registra la plataforma y nadie puede editarlas ni borrarlas. Si una cifra está mal, se propone una corrección con su motivo; solo una persona la aprueba, y se guarda como un nuevo registro que compensa la diferencia. El original y el historial se conservan.</p>
        {facts.shown.length === 0 ? <p className="text-sm text-ink-muted">No hay métricas para corregir.</p> : (
          <Card className="space-y-3 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-sm text-ink-muted">Métrica
                <select aria-label="Métrica a corregir" className={INPUT_FULL} value={chosen} onChange={(event) => setFactId(event.target.value)}>
                  {facts.shown.map((fact) => <option key={fact.id} value={fact.id}>{metricOf(fact.metric)?.label ?? fact.metric} · {fact.at.slice(0, 10)} · {fact.value}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-sm text-ink-muted">Valor correcto<input type="number" aria-label="Valor correcto" className={INPUT_FULL} value={newValue} onChange={(event) => setNewValue(event.target.value)} /></label>
              <label className="space-y-1 text-sm text-ink-muted">Motivo<input aria-label="Motivo de la corrección" className={INPUT_FULL} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
            </div>
            <Button size="sm" variant="secondary" disabled={!chosenFact} onClick={() => send({ type: "correction.propose", factId: chosen, newValue: Number(newValue), reason })}>Proponer corrección</Button>
          </Card>
        )}
        {corrections.length === 0 && <p className="text-sm text-ink-muted">No hay correcciones.</p>}
        <ul className="space-y-2">
          {corrections.map((correction) => {
            const fact = state.facts.find((item) => item.id === correction.factId);
            return (
              <Card as="li" key={correction.id} aria-label={`Corrección ${correction.id}`} className="space-y-1 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{metricOf(fact?.metric ?? "")?.label ?? fact?.metric}</span><Badge tone={correction.status === "approved" ? "success" : correction.status === "rejected" ? "neutral" : "warning"}>{label("correctionStatus", correction.status)}</Badge><span className="text-ink-soft">{fact?.value} → {correction.newValue}</span><span className="text-xs text-ink-muted">propuesta por {who(correction.proposedBy)} · «{correction.reason}»</span></div>
                {correction.status === "approved" && <p className="text-xs text-ink-muted">Aprobada por {who(correction.decidedBy ?? "")}; hoy vale {effectiveValue(state, correction.factId)}. El valor original se conserva.</p>}
                {correction.status === "proposed" && <div className="flex gap-2"><Button size="sm" onClick={() => send({ type: "correction.approve", correctionId: correction.id })}>Aprobar corrección</Button><Button size="sm" variant="ghost" onClick={() => send({ type: "correction.reject", correctionId: correction.id })}>Rechazar</Button></div>}
              </Card>
            );
          })}
        </ul>
      </section>

      <section className="space-y-2" aria-label="Preparado para el futuro">
        <h2 className="font-semibold">Preparado para el futuro</h2>
        <p className="text-sm text-ink-muted">{FUTURE_CAPABILITIES.map((item) => item.label).join(", ")}: declarados, no construidos. Cuando existan, serán Workers de KOE que lean el mismo registro.</p>
      </section>
    </div>
  );
}
