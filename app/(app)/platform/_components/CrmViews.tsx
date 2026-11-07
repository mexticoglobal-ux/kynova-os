"use client";

import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { grantsOf, leadsOf, latestAnalysis, analysesOf, type Stage } from "@/lib/contracts/platform/crm-center";
import { COLD_ANSWERS, HOT_ANSWERS } from "@/lib/contracts/platform/crm-demo";
import { label } from "@/lib/contracts/platform/crm-messages";
import { FUTURE_CRM, OPEN_STAGES, analyzeLead, assistantMessages, contextOf, crmDashboard, pipelineBoard, type Card as PipelineCard, type RiskLevel } from "@/lib/contracts/platform/koe-crm";
import { formatCostMicros } from "@/lib/contracts/platform/koe-registry";
import { Kpi, Section, money, num, pct } from "./InsightsCharts";
import type { CrmTabProps } from "./CrmCenter";

const RISK_TONE: Record<RiskLevel, BadgeTone> = { low: "success", medium: "neutral", high: "warning", critical: "danger" };
const PRIORITY_TONE = { low: "neutral", normal: "primary", high: "warning", critical: "danger" } as const;
const who = (actor: string) => (actor === "" ? "Sin asignar" : actor.startsWith("worker:") ? "NEX (IA)" : actor);
const when = (iso: string) => iso.slice(0, 16).replace("T", " ");
const NEXT_STAGE: Record<string, Stage | undefined> = { prospect: "qualified", qualified: "meeting", meeting: "proposal", proposal: "negotiation" };
const inputClass = "w-full rounded-xl border border-line bg-raised px-3 py-1.5 text-sm text-ink";

// ---------------------------------------------------------------- dashboard
export function DashboardTab({ state, asOf, persona, send, select }: CrmTabProps) {
  const d = crmDashboard(state, persona.tenantId, asOf);
  const grant = grantsOf(state, persona.tenantId).find((item) => item.status === "active");
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Prospectos nuevos" value={num(d.newLeads)} hint="Últimos 7 días" />
        <Kpi label="Prospectos activos" value={num(d.activeLeads)} />
        <Kpi label="Oportunidades" value={num(d.opportunities)} hint="Reunión, propuesta o negociación" />
        <Kpi label="Clientes" value={num(d.customers)} />
        <Kpi label="Ventas estimadas" value={money(d.estimatedSalesMicros)} hint="Valor esperado de lo abierto (estimado por KOE)" tone="good" />
        <Kpi label="Conversión" value={pct(d.conversionRate)} hint="Ganados entre todos los prospectos" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Próximas acciones" aside="Propuestas de NEX y tareas aceptadas">
          {d.nextActions.length === 0 && <p className="text-sm text-ink-muted">No hay acciones pendientes.</p>}
          <ul className="space-y-1.5 text-sm" aria-label="Próximas acciones">
            {d.nextActions.map((item) => <li key={item.taskId} className="flex flex-wrap items-center gap-2"><Badge tone={item.status === "accepted" ? "success" : "accent"}>{label("taskStatus", item.status)}</Badge><span>{item.title}</span><span className="text-xs text-ink-muted">para {when(item.dueAt)}</span></li>)}
          </ul>
        </Section>
        <Section title="Reuniones">
          {d.meetings.length === 0 && <p className="text-sm text-ink-muted">No hay reuniones próximas.</p>}
          <ul className="space-y-1.5 text-sm" aria-label="Reuniones">{d.meetings.map((item) => <li key={item.id}><span className="font-medium">{item.title}</span> <span className="text-xs text-ink-muted">· {when(item.at)} · {item.leadName}</span></li>)}</ul>
        </Section>
        <Section title="Actividad reciente">
          <ul className="space-y-1.5 text-sm" aria-label="Actividad reciente">
            {d.recentActivity.map((entry) => <li key={entry.id}><Badge tone="neutral">{label("timelineKind", entry.kind)}</Badge> <span className="text-ink-soft">{entry.summary}</span> <span className="text-xs text-ink-muted">· {when(entry.at)}</span></li>)}
          </ul>
        </Section>
      </div>
      <Card className="space-y-2 p-4" aria-label="Autorización para mover etapas">
        <h2 className="font-semibold">Autorización para mover etapas ({label("tabs", "pipeline")} · Nivel 2)</h2>
        <p className="text-sm text-ink-muted">NEX puede mover una etapa hacia adelante, de a una y hasta Negociación, solo con una autorización vigente de una persona y cuando las reglas de KOE lo recomiendan. Ganar, perder y convertir en cliente son siempre de una persona.</p>
        {grant
          ? <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="success">Vigente</Badge><span>{grant.maxPerDay ? `hasta ${grant.maxPerDay} movimientos por día` : "sin límite diario"} · concedida por {who(grant.grantedBy)}</span><Button size="sm" variant="ghost" onClick={() => send({ type: "authorization.revoke", grantId: grant.id })}>Revocar autorización</Button></div>
          : <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="warning">Sin autorización</Badge><Button size="sm" variant="secondary" onClick={() => send({ type: "authorization.grant", maxPerDay: 3 })}>Conceder autorización (3 por día)</Button></div>}
      </Card>
      <p className="text-xs text-ink-muted">{leadsOf(state, persona.tenantId).length} prospectos en total. <button type="button" className="underline" onClick={() => select("", "pipeline")}>Ver el pipeline</button></p>
    </div>
  );
}

// ---------------------------------------------------------------- pipeline
function CardView({ card, props }: { card: PipelineCard; props: CrmTabProps }) {
  const next = NEXT_STAGE[card.stage];
  const open = (OPEN_STAGES as readonly string[]).includes(card.stage);
  return (
    <li>
      <Card as="div" aria-label={`Tarjeta ${card.name}`} className="space-y-2 p-3">
        <div><p className="font-medium">{card.name}</p><p className="text-xs text-ink-muted">{card.company || "Sin empresa"}</p></div>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="primary">Lead {card.leadScore}</Badge>
          <Badge tone="accent">Oportunidad {card.opportunityScore}</Badge>
          <Badge tone={RISK_TONE[card.risk]}>Riesgo {label("risk", card.risk)}</Badge>
        </div>
        <p className="text-xs text-ink-soft">Valor {money(card.valueMicros)} · esperado {money(card.expectedValueMicros)}</p>
        <p className="text-xs text-ink-muted">{num(card.daysInStage)} días en la etapa · Responsable: {who(card.owner)}</p>
        {card.nextAction && <p className="text-xs text-ink-soft"><strong>{label("taskKind", card.nextAction.kind)}</strong>: {card.nextAction.reason}</p>}
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => props.select(card.leadId, "opportunity")}>Ver</Button>
          {next && <Button size="sm" variant="secondary" onClick={() => props.send({ type: "stage.move", leadId: card.leadId, to: next })}>Mover a {label("stage", next)}</Button>}
          {card.stage === "negotiation" && <Button size="sm" onClick={() => props.send({ type: "stage.move", leadId: card.leadId, to: "won" })}>Marcar ganado</Button>}
          {open && <Button size="sm" variant="ghost" onClick={() => props.send({ type: "stage.move", leadId: card.leadId, to: "lost", note: (document.getElementById("crm-lost-reason") as HTMLInputElement | null)?.value ?? "" })}>Marcar perdido</Button>}
          {card.stage === "lost" && <Button size="sm" variant="ghost" onClick={() => props.send({ type: "stage.move", leadId: card.leadId, to: "prospect" })}>Reabrir</Button>}
        </div>
      </Card>
    </li>
  );
}

export function PipelineTab(props: CrmTabProps) {
  const board = pipelineBoard(props.state, props.persona.tenantId, props.asOf);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">Cada tarjeta muestra lo que KOE calculó. Mover una etapa lo decide una persona (o NEX con autorización vigente); nada se cierra solo.</p>
        <label className="flex items-center gap-2 text-sm text-ink-muted">Motivo si se pierde<input id="crm-lost-reason" aria-label="Motivo de la pérdida" className="w-56 rounded-xl border border-line bg-raised px-3 py-1.5 text-sm text-ink" placeholder="Por qué se pierde" /></label>
      </div>
      <div className="grid gap-3 overflow-x-auto pb-2 lg:grid-cols-7" role="group" aria-label="Pipeline">
        {board.map((column) => (
          <section key={column.stage} aria-label={`Columna ${label("stage", column.stage)}`} className="min-w-52 space-y-2">
            <div className="rounded-xl bg-raised-strong px-3 py-2"><h2 className="text-sm font-semibold">{label("stage", column.stage)} <span className="text-ink-muted">({column.count})</span></h2><p className="text-xs text-ink-muted">{money(column.valueMicros)}</p></div>
            <ul className="space-y-2">{column.cards.map((card) => <CardView key={card.leadId} card={card} props={props} />)}</ul>
            {column.cards.length === 0 && <p className="px-1 text-xs text-ink-muted">Sin tarjetas.</p>}
          </section>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- opportunity intelligence
export function OpportunityTab({ state, asOf, persona, selected, select, send, sendAsPlatform }: CrmTabProps) {
  const leads = leadsOf(state, persona.tenantId);
  const lead = leads.find((item) => item.id === selected) ?? leads[0];
  const [answers, setAnswers] = useState<"hot" | "cold">("hot");
  if (!lead) return <p className="text-sm text-ink-muted">Todavía no hay prospectos.</p>;
  const insight = analyzeLead(contextOf(state, lead), asOf);
  const last = latestAnalysis(state, persona.tenantId, lead.id);
  const history = analysesOf(state, persona.tenantId, lead.id);
  const audits = state.audits.filter((item) => item.tenantId === persona.tenantId && item.leadId === lead.id);
  return (
    <div className="space-y-5">
      <label className="block max-w-sm space-y-1 text-sm text-ink-muted">Prospecto
        <select aria-label="Prospecto" className={inputClass} value={lead.id} onChange={(event) => select(event.target.value)}>
          {leads.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.company} · {label("stage", item.stage)}</option>)}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Inteligencia de la oportunidad">
        <Kpi label="Probabilidad de cierre" value={pct(insight.probability)} tone={insight.probability >= 0.7 ? "good" : undefined} />
        <Kpi label="Nivel de riesgo" value={label("risk", insight.risk)} tone={insight.risk === "high" || insight.risk === "critical" ? "warn" : undefined} />
        <Kpi label="Valor esperado" value={money(insight.expectedValueMicros)} hint={`de ${money(lead.estimatedValueMicros)}`} />
        <Kpi label="Tiempo esperado" value={insight.expectedCloseAt ? `${num(insight.expectedDays)} días` : "—"} hint={insight.expectedCloseAt ? `hasta el ${insight.expectedCloseAt.slice(0, 10)}` : "Negocio cerrado"} />
        <Kpi label="Puntajes" value={`${insight.leadScore} · ${insight.opportunityScore}`} hint="Lead · Oportunidad" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-2 p-4" aria-label="Siguiente mejor acción">
          <h2 className="font-semibold">Siguiente mejor acción</h2>
          {insight.nextBest
            ? <><p className="text-sm"><Badge tone={PRIORITY_TONE[insight.priority]}>Prioridad {label("priority", insight.priority)}</Badge> <strong>{label("taskKind", insight.nextBest.kind)}</strong></p><p className="text-sm text-ink-soft">Motivo: {insight.nextBest.reason}.</p></>
            : <p className="text-sm text-ink-muted">El negocio está cerrado: no hay siguiente acción.</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => send({ type: "analysis.refresh", leadId: lead.id })}>Actualizar análisis de KOE</Button>
            <Button size="sm" variant="secondary" onClick={() => send({ type: "task.generate", leadId: lead.id })}>Preparar tareas (propuestas)</Button>
          </div>
        </Card>
        <Card className="space-y-2 p-4" aria-label="Por qué">
          <h2 className="font-semibold">Por qué lo recomienda KOE</h2>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink-soft">{insight.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          {insight.riskReasons.length > 0 && <><p className="pt-1 text-sm font-medium">Riesgos</p><ul className="list-disc space-y-0.5 pl-5 text-sm text-warning">{insight.riskReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></>}
        </Card>
      </div>
      <Card className="space-y-2 p-4" aria-label="Análisis de KOE">
        <h2 className="font-semibold">Análisis de KOE</h2>
        {last ? (
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            <div><dt className="inline text-ink-muted">Worker utilizado: </dt><dd className="inline font-medium">{last.workerName}</dd></div>
            <div><dt className="inline text-ink-muted">Modelo seleccionado por KOE: </dt><dd className="inline font-medium">{last.model.label}</dd></div>
            <div><dt className="inline text-ink-muted">Motivo de la selección: </dt><dd className="inline">{last.modelReason}</dd></div>
            <div><dt className="inline text-ink-muted">Costo estimado: </dt><dd className="inline">{formatCostMicros(last.estimatedCostMicros)}</dd></div>
          </dl>
        ) : <p className="text-sm text-ink-muted">Todavía no hay un análisis de KOE para este prospecto.</p>}
        <h3 className="pt-2 text-sm font-semibold">Historial de análisis (nunca se sobrescribe)</h3>
        <ul className="space-y-0.5 text-sm text-ink-soft" aria-label="Historial de análisis">
          {[...history].reverse().slice(0, 8).map((item) => <li key={item.id}>{when(item.at)} · {item.trigger === "audit" ? "Business Audit" : item.trigger === "stage" ? "cambio de etapa" : item.trigger === "interaction" ? "contacto" : "actualización"} · oportunidad {item.opportunityScore}{item.previousOpportunityScore === undefined ? "" : ` (antes ${item.previousOpportunityScore})`} · riesgo {label("risk", item.risk)}</li>)}
        </ul>
      </Card>
      <Card className="space-y-2 p-4" aria-label="Business Audit">
        <h2 className="font-semibold">Business Audit</h2>
        {audits.length === 0 && <p className="text-sm text-ink-muted">Este prospecto todavía no tiene Business Audit.</p>}
        <ul className="space-y-0.5 text-sm text-ink-soft">{audits.map((audit) => <li key={audit.id}>{when(audit.at)} · ajuste {audit.fitScore}/100 · recomienda {audit.recommended.join(", ")}</li>)}</ul>
        <p className="text-xs text-ink-muted">Cada Business Audit actualiza el puntaje, las recomendaciones, la prioridad y el riesgo; los anteriores se conservan. El resultado lo reporta la plataforma:</p>
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Resultado simulado del audit" className="rounded-xl border border-line bg-raised px-2 py-1 text-sm text-ink" value={answers} onChange={(event) => setAnswers(event.target.value as "hot" | "cold")}><option value="hot">Respuestas con mucha necesidad</option><option value="cold">Respuestas con poca necesidad</option></select>
          <Button size="sm" variant="secondary" onClick={() => sendAsPlatform({ type: "audit.record", leadId: lead.id, answers: answers === "hot" ? HOT_ANSWERS : COLD_ANSWERS })}>Simular un Business Audit (plataforma)</Button>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- sales assistant
export function AssistantTab({ state, asOf, persona, select }: CrmTabProps) {
  const messages = assistantMessages(state, persona.tenantId, asOf);
  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-muted">Esto es lo que KOE le diría a un vendedor hoy. Son recomendaciones: nada se hace solo.</p>
      {messages.length === 0 && <p className="text-sm text-ink-muted">Por ahora no hay recomendaciones.</p>}
      <ul className="space-y-2" aria-label="Recomendaciones del asistente">
        {messages.map((item) => (
          <Card as="li" key={item.id} className="flex flex-wrap items-center gap-3 p-4">
            <Badge tone={PRIORITY_TONE[item.priority]}>{label("priority", item.priority)}</Badge>
            <div className="min-w-0 flex-1"><p className="font-medium">{item.text}</p><p className="text-xs text-ink-muted">{item.reason}</p></div>
            {item.leadId && <Button size="sm" variant="ghost" onClick={() => select(item.leadId ?? "", "opportunity")}>Ver prospecto</Button>}
            {item.customerId && <Button size="sm" variant="ghost" onClick={() => select(item.customerId ?? "", "customer")}>Ver cliente</Button>}
          </Card>
        ))}
      </ul>
      <Section title="Arquitectura preparada, todavía no construida" aside="Cada una será un Worker de KOE sobre los mismos registros">
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Capacidades futuras del CRM">
          {FUTURE_CRM.map((item) => <Card as="li" key={item.id} className="space-y-1 p-3"><div className="flex items-center gap-2"><span className="font-medium">{item.label}</span><Badge tone="neutral">No construido</Badge></div><p className="text-xs text-ink-muted">Necesita: {item.needs}</p></Card>)}
        </ul>
      </Section>
    </div>
  );
}
