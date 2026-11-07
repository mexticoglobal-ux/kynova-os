import type { ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { FUTURE_CAPABILITIES } from "@/lib/contracts/platform/insights-center";
import { label } from "@/lib/contracts/platform/insights-messages";
import { PROCESS_MIN_RUNS, type Insights } from "@/lib/contracts/platform/koe-insights";
import { BarChart, Kpi, Ranking, Section, money, ms, multiple, num, pct, unitValue } from "./InsightsCharts";

// Every view only FORMATS what koe-insights.ts computed. A figure that is not in `Insights` is not shown.
type View = { insights: Insights };
const ASSUMPTION = (rate: number) => `Supuesto: una hora de trabajo manual vale ${money(rate)}. Todo es estimado, no una factura.`;
const th = "px-2 py-1.5 text-left text-xs font-medium text-ink-muted";
const td = "px-2 py-1.5 text-sm";

// ---------------------------------------------------------------- executive
export function ExecutiveView({ insights }: View) {
  const { executive: e } = insights;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="ROI estimado" value={multiple(e.roiMultiple)} hint={e.roiPercent === null ? "Sin costo de IA todavía" : `valor generado frente al costo estimado de la IA (${num(e.roiPercent)} %)`} tone="good" />
        <Kpi label="Horas ahorradas" value={`${num(e.hoursSaved, 1)} h`} hint="Trabajo manual que ya no se hizo a mano" />
        <Kpi label="Automatizaciones ejecutadas" value={num(e.automationsRun)} />
        <Kpi label="Workers activos" value={num(e.activeWorkers)} />
        <Kpi label="Agentes activos" value={num(e.activeAgents)} hint="Agentes IA publicados" />
        <Kpi label="Clientes atendidos" value={num(e.customersServed)} />
        <Kpi label="Prospectos convertidos" value={num(e.prospectsConverted)} />
        <Kpi label="Tareas completadas" value={num(e.tasksCompleted)} />
        <Kpi label="Costo estimado IA" value={money(e.aiCostMicros)} hint="Estimación, no una factura" />
        <Kpi label="Ahorro estimado" value={money(e.savingsMicros)} tone="good" />
        <Kpi label="Tiempo promedio de respuesta" value={ms(e.avgResponseMs)} />
        <Card className="space-y-2 p-4" aria-label="Prompts más utilizados">
          <p className="text-xs uppercase tracking-wide text-ink-muted">Prompts más utilizados</p>
          <Ranking rows={e.topPrompts.map((item) => ({ id: item.id, label: item.name, value: item.runs }))} format={(value) => `${num(value)} usos`} empty="Todavía no se probó ningún prompt." />
        </Card>
      </div>
      <p className="text-xs text-ink-muted">{ASSUMPTION(insights.rateMicros)} Periodo: {insights.period.from.slice(0, 10)} a {insights.period.to.slice(0, 10)}.</p>
    </div>
  );
}

// ---------------------------------------------------------------- analytics
export function AnalyticsView({ insights }: View) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {insights.analytics.map((chart) => (
        <Card key={chart.module} as="section" aria-label={`Analítica de ${label("module", chart.module)}`} className="space-y-3 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold">{label("module", chart.module)}</h2><span className="text-sm text-ink-soft">{chart.headline}: <strong>{unitValue(chart.unit, chart.total)}</strong></span></div>
          <BarChart points={chart.series} unit={chart.unit} title={`${label("module", chart.module)}: ${chart.headline} por semana`} />
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">{chart.metrics.map((metric) => <li key={metric.id}>{metric.label}: {unitValue(metric.unit, metric.total)}</li>)}</ul>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- AI
export function AiView({ insights }: View) {
  const { ai } = insights;
  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">Todo sale de eventos simulados que KOE registró; no hay llamadas reales a ningún modelo.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Ejecuciones" value={num(ai.executions)} />
        <Kpi label="Tiempo promedio" value={ms(ai.avgMs)} />
        <Kpi label="Costo promedio" value={money(ai.avgCostMicros ?? 0)} hint="por ejecución, estimado" />
        <Kpi label="Éxito" value={pct(ai.successRate)} tone="good" />
        <Kpi label="Errores y respaldos" value={`${num(ai.errors)} · ${num(ai.fallbacks)}`} hint="errores · veces que KOE usó un modelo de respaldo" />
      </div>
      <Section title="Uso por Worker">
        <div className="overflow-x-auto"><table className="w-full" aria-label="Uso por Worker"><thead><tr><th className={th}>Worker</th><th className={th}>Especialidad</th><th className={th}>Usos</th><th className={th}>Costo</th><th className={th}>Tiempo prom.</th><th className={th}>Éxito</th></tr></thead>
          <tbody>{ai.byWorker.map((row) => <tr key={row.workerId} className="border-t border-line"><td className={td}>{row.name}</td><td className={td}>{row.specialty}</td><td className={td}>{num(row.runs)}</td><td className={td}>{money(row.costMicros)}</td><td className={td}>{ms(row.avgMs)}</td><td className={td}>{pct(row.successRate)}</td></tr>)}</tbody></table></div>
      </Section>
      <Section title="Uso por modelo" aside="El modelo lo elige KOE por cada tarea">
        <div className="overflow-x-auto"><table className="w-full" aria-label="Uso por modelo"><thead><tr><th className={th}>Modelo</th><th className={th}>Usos</th><th className={th}>Participación</th><th className={th}>Costo prom.</th><th className={th}>Tiempo prom.</th><th className={th}>Éxito</th><th className={th}>Respaldos</th></tr></thead>
          <tbody>{ai.byModel.map((row) => <tr key={row.modelId} className="border-t border-line"><td className={td}>{row.label}</td><td className={td}>{num(row.runs)}</td><td className={td}>{pct(row.share)}</td><td className={td}>{money(row.avgCostMicros)}</td><td className={td}>{ms(row.avgMs)}</td><td className={td}>{pct(row.successRate)}</td><td className={td}>{num(row.fallbacks)}</td></tr>)}</tbody></table></div>
      </Section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Uso por especialidad"><Ranking rows={ai.bySpecialty.map((item) => ({ id: item.specialty, label: item.specialty, value: item.runs, note: `Costo ${money(item.costMicros)}` }))} format={(value) => `${num(value)} usos`} /></Section>
        <Section title="Modelos preferidos por KOE"><Ranking rows={ai.preferredModels.map((item) => ({ id: item.modelId, label: item.label, value: item.runs }))} format={(value) => `${num(value)} elecciones`} /></Section>
      </div>
      <Section title="Comparaciones" aside="Las que se hicieron en AI Studio">
        {ai.comparisons.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay comparaciones.</p>}
        <ul className="space-y-1 text-sm">{ai.comparisons.map((item) => <li key={item.group} className="text-ink-soft">{item.left.label} frente a {item.right.label}: costo {item.costDeltaMicros >= 0 ? "+" : "−"}{money(Math.abs(item.costDeltaMicros))}{item.msDelta === null ? "" : `, tiempo ${item.msDelta >= 0 ? "+" : "−"}${ms(Math.abs(item.msDelta))}`}</li>)}</ul>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- productivity
export function ProductivityView({ insights }: View) {
  const p = insights.productivity;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi label="Horas ahorradas" value={`${num(p.hoursSaved, 1)} h`} tone="good" />
        <Kpi label="Tiempo automatizado" value={`${num(p.automatedMinutes)} min`} hint="Lo que una persona habría tardado" />
        <Kpi label="Procesos manuales eliminados" value={num(p.eliminatedProcesses)} hint={`Procesos con al menos ${PROCESS_MIN_RUNS} ejecuciones automáticas exitosas`} />
      </div>
      <Section title="Ranking de procesos" aside="Por horas ahorradas">
        <Ranking rows={p.ranking.map((item) => ({ id: item.process, label: item.label, value: item.hoursSaved, note: `${label("department", item.department)} · ${num(item.runs)} ejecuciones` }))} format={(value) => `${num(value, 1)} h`} />
      </Section>
      <Section title="Tiempo invertido por departamento" aside="Trabajo manual que sigue haciendo el equipo frente a lo automatizado">
        <div className="overflow-x-auto"><table className="w-full" aria-label="Tiempo por departamento"><thead><tr><th className={th}>Departamento</th><th className={th}>Tiempo manual</th><th className={th}>Tiempo automatizado</th></tr></thead>
          <tbody>{p.byDepartment.map((row) => <tr key={row.department} className="border-t border-line"><td className={td}>{label("department", row.department)}</td><td className={td}>{num(row.manualMinutes / 60, 1)} h</td><td className={td}>{num(row.automatedMinutes / 60, 1)} h</td></tr>)}</tbody></table></div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- financial
export function FinancialView({ insights }: View) {
  const f = insights.financial;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="ROI" value={multiple(f.roiMultiple)} hint={f.roiPercent === null ? "Sin costo de IA todavía" : `${num(f.roiPercent)} %`} tone="good" />
        <Kpi label="Costo IA" value={money(f.aiCostMicros)} hint="Estimado" />
        <Kpi label="Valor generado" value={money(f.valueMicros)} hint="Ahorro más ingresos atribuidos" tone="good" />
        <Kpi label="Ingresos estimados" value={money(f.estimatedRevenueMicros)} hint="Total cobrado en el periodo" />
        <Kpi label="Ahorro estimado" value={money(f.savingsMicros)} />
        <Kpi label="Ingresos atribuidos" value={money(f.attributedRevenueMicros)} hint="Ventas que el trabajo automático ayudó a cerrar" />
        <Kpi label="Costo de la empresa" value={money(f.companyCostMicros)} hint="Solo esta empresa" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Costo por Worker"><Ranking rows={f.costByWorker.map((item) => ({ id: item.id, label: item.name, value: item.costMicros, note: `${num(item.runs)} ejecuciones` }))} format={money} /></Section>
        <Section title="Costo por agente"><Ranking rows={f.costByAgent.map((item) => ({ id: item.id, label: item.name, value: item.costMicros, note: `${num(item.runs)} pruebas` }))} format={money} empty="Todavía no se probó ningún agente." /></Section>
        <Section title="Costo por automatización"><Ranking rows={f.costByAutomation.map((item) => ({ id: item.id, label: item.name, value: item.costMicros, note: `${num(item.runs)} ejecuciones` }))} format={money} /></Section>
      </div>
      <Section title="Costo por mes"><BarChart points={f.costByMonth} unit="money" title="Costo estimado de la IA por mes" /></Section>
      <p className="text-xs text-ink-muted">{ASSUMPTION(insights.rateMicros)} Aquí nunca aparecen datos bancarios, cuentas ni tarjetas: solo totales estimados.</p>
    </div>
  );
}

// ---------------------------------------------------------------- customers
export function CustomersView({ insights }: View) {
  const c = insights.customers;
  const top = Math.max(1, ...c.funnel.map((item) => item.count));
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Clientes nuevos" value={num(c.newCustomers)} />
        <Kpi label="Clientes activos" value={num(c.activeCustomers)} hint="Al cierre del periodo" />
        <Kpi label="Clientes perdidos" value={num(c.lostCustomers)} tone={c.lostCustomers > 0 ? "warn" : undefined} />
        <Kpi label="Conversión" value={pct(c.conversionRate)} hint="Prospectos convertidos entre prospectos nuevos" />
        <Kpi label="Retención" value={pct(c.retentionRate)} tone="good" />
      </div>
      <Section title="Embudo y pipeline">
        <ol className="space-y-2" aria-label="Embudo">
          {c.funnel.map((stage) => (
            <li key={stage.id} className="space-y-0.5">
              <div className="flex items-baseline justify-between text-sm"><span className="font-medium">{stage.label}</span><span className="text-ink-soft">{num(stage.count)}{stage.fromPrevious === null ? "" : ` · ${pct(stage.fromPrevious)} de la etapa anterior`}</span></div>
              <div className="h-2.5 overflow-hidden rounded-full bg-raised-strong"><div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(2, (stage.count / top) * 100)}%` }} /></div>
            </li>
          ))}
        </ol>
      </Section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Clientes nuevos por semana"><BarChart points={c.weekly.map((item) => ({ label: item.label, value: item.created }))} unit="count" title="Clientes nuevos por semana" /></Section>
        <Section title="Clientes perdidos por semana"><BarChart points={c.weekly.map((item) => ({ label: item.label, value: item.lost }))} unit="count" title="Clientes perdidos por semana" /></Section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- KOE intelligence
export function KoeView({ insights }: View) {
  const k = insights.koe;
  const worker = (stat: Insights["koe"]["mostUsedWorker"], detail: (item: NonNullable<Insights["koe"]["mostUsedWorker"]>) => string) => (stat ? <><strong>{stat.name}</strong><span className="block text-xs text-ink-muted">{detail(stat)}</span></> : <span className="text-ink-muted">Sin datos</span>);
  const ranked = (item: Insights["koe"]["topPrompt"], noun: string) => (item ? <><strong>{item.name}</strong><span className="block text-xs text-ink-muted">{num(item.runs)} {noun} · {money(item.costMicros)}</span></> : <span className="text-ink-muted">Sin datos</span>);
  const cell = (title: string, body: ReactNode) => <Card key={title} className="space-y-1 p-4" aria-label={title}><p className="text-xs uppercase tracking-wide text-ink-muted">{title}</p><p className="text-sm">{body}</p></Card>;
  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">KOE es la única fuente de estas respuestas: salen del mismo registro de ejecuciones y eventos, sin otro motor de estadísticas.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cell("Worker más eficiente", worker(k.mostEfficientWorker, (item) => `${money(item.costPerSuccessMicros ?? 0)} por éxito`))}
        {cell("Worker más utilizado", worker(k.mostUsedWorker, (item) => `${num(item.runs)} ejecuciones`))}
        {cell("Worker más costoso", worker(k.mostCostlyWorker, (item) => money(item.costMicros)))}
        {cell("Worker más rápido", worker(k.fastestWorker, (item) => ms(item.avgMs)))}
        {cell("Automatización más usada", ranked(k.topAutomation, "ejecuciones"))}
        {cell("Prompt más utilizado", ranked(k.topPrompt, "usos"))}
        {cell("Agente más utilizado", ranked(k.topAgent, "pruebas"))}
        {cell("Modelo recomendado", k.recommendedModel ? <><strong>{k.recommendedModel.model.label}</strong><span className="block text-xs text-ink-muted">{k.recommendedModel.reason}</span></> : <span className="text-ink-muted">Sin datos suficientes</span>)}
        {cell("Especialidad más utilizada", k.topSpecialty ? <><strong>{k.topSpecialty.specialty}</strong><span className="block text-xs text-ink-muted">{num(k.topSpecialty.runs)} ejecuciones</span></> : <span className="text-ink-muted">Sin datos</span>)}
        {cell("Eventos procesados", <><strong>{num(k.eventsProcessed.total)}</strong><span className="block text-xs text-ink-muted">{num(k.eventsProcessed.executions)} ejecuciones · {num(k.eventsProcessed.facts)} hechos de los módulos</span></>)}
      </div>
      <Section title="Arquitectura preparada, todavía no construida" aside="Cada una será un Worker de KOE que lea este mismo registro">
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Capacidades futuras">
          {FUTURE_CAPABILITIES.map((item) => (
            <Card as="li" key={item.id} className="space-y-1 p-3"><div className="flex items-center gap-2"><span className="font-medium">{item.label}</span><Badge tone="neutral">No construido</Badge></div><p className="text-xs text-ink-muted">Necesita: {item.needs}</p></Card>
          ))}
        </ul>
      </Section>
    </div>
  );
}
