"use client";

import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ADDONS, ADDON_KEYS, LICENSE_RESOURCES, RESOURCES, analysesOf, auditOf, grantsOf, proposalsOf, addonsOf, type AddonKey, type BillingAuditCategory, type ProposalPayload, type Resource } from "@/lib/contracts/platform/billing-center";
import { label } from "@/lib/contracts/platform/billing-messages";
import { aiUsage, billingDashboard, forecast, limitAlerts, planOf, plansFor, roi, usageRows, type LimitOption, type UsageRow, type UsageStatus } from "@/lib/contracts/platform/koe-billing";
import { hiddenNote, latest } from "@/lib/contracts/platform/display";
import { Kpi, Ranking, Section, money, num, pct, unitValue } from "./InsightsCharts";
import type { BillingTabProps } from "./BillingCenter";

export const STATUS_TONE: Record<UsageStatus, BadgeTone> = { ok: "success", warn: "warning", atLimit: "warning", over: "danger" };
const SEVERITY_TONE: Record<string, BadgeTone> = { normal: "primary", high: "warning" };
export const when = (iso: string) => iso.slice(0, 16).replace("T", " ");
export const day = (iso: string) => iso.slice(0, 10);
export const who = (actor: string) => (actor.startsWith("worker:") ? "NEX (IA)" : actor === "system" ? "Plataforma" : actor);
export const isNex = (actor: string) => actor.startsWith("worker:");
export const quota = (row: UsageRow) => `${num(row.used)} de ${num(row.limit)}`;
const inputClass = "rounded-xl border border-line bg-raised px-3 py-1.5 text-sm text-ink";

const describePayload = (payload: ProposalPayload, planName: (id: string) => string): string =>
  payload.kind === "plan" ? `Cambiar al plan ${planName(payload.toPlanId)}` : `Comprar ${payload.quantity} × ${label("addon", payload.addon)}`;

/** The options KOE recommends for a limit. A person applies one; NEX can only prepare a proposal for a person to approve. */
export function OptionButtons({ options, persona, send }: { options: readonly LimitOption[]; persona: BillingTabProps["persona"]; send: BillingTabProps["send"] }) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Opciones de KOE">
      {options.map((option) => {
        const nex = isNex(persona.actor);
        const payload: ProposalPayload = option.kind === "addon" ? { kind: "addon", addon: option.addon, quantity: option.quantity } : { kind: "plan", toPlanId: option.toPlanId };
        const cost = option.kind === "addon" ? money(option.monthlyMicros) : `+${money(option.deltaMonthlyMicros)}`;
        return (
          <li key={option.kind === "addon" ? option.addon : option.toPlanId}>
            <Button size="sm" variant="secondary" onClick={() => send(nex ? { type: "proposal.create", payload, reason: "Opción recomendada por KOE" } : option.kind === "addon" ? { type: "addon.purchase", addon: option.addon, quantity: option.quantity } : { type: "plan.change", toPlanId: option.toPlanId })}>
              {nex ? "Preparar: " : ""}{option.text} ({cost} al mes)
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- dashboard
export function DashboardTab({ state, env, asOf, persona, send }: BillingTabProps) {
  const d = billingDashboard(state, env.signals, persona.tenantId, asOf);
  const alerts = limitAlerts(state, env.signals, persona.tenantId, asOf);
  const proposals = proposalsOf(state, persona.tenantId);
  const analyses = analysesOf(state, persona.tenantId);
  const grant = grantsOf(state, persona.tenantId).find((item) => item.status === "active");
  const [category, setCategory] = useState<BillingAuditCategory | "">("");
  const audit = latest(auditOf(state, persona.tenantId, category || undefined), 40);
  if (!d) return <p className="text-sm text-ink-muted">Esta empresa todavía no tiene una cuenta de facturación.</p>;
  const planName = (id: string) => planOf(state, persona.tenantId, id)?.name ?? id;
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <Kpi label="Plan actual" value={d.planName} hint={`${label("accountStatus", d.status as "active")} · ${money(d.monthlyBill.planMicros)} al mes`} />
        <Kpi label="Estado de la suscripción" value={label("accountStatus", d.status as "active")} tone={d.status === "cancelled" ? "warn" : "good"} hint={d.trialEndsAt ? `La prueba termina el ${day(d.trialEndsAt)}` : undefined} />
        <Kpi label="Próxima renovación" value={day(d.renewsAt)} hint={d.daysToRenewal >= 0 ? `en ${d.daysToRenewal} días` : "vencida"} />
        <Kpi label="Usuarios activos" value={quota(d.users)} hint={label("usageStatus", d.users.status)} />
        <Kpi label="Workers activos" value={quota(d.workers)} hint={label("usageStatus", d.workers.status)} />
        <Kpi label="Consumo IA" value={`${num(d.ai.tasks)} tareas`} hint={`${money(d.ai.costMicros)} estimados · ${quota(d.ai.limit)} del plan`} />
        <Kpi label="Storage" value={`${quota(d.storage)} GB`} hint={label("usageStatus", d.storage.status)} />
        <Kpi label="Automatizaciones" value={quota(d.automations)} hint={label("usageStatus", d.automations.status)} />
        <Kpi label="Integraciones" value={quota(d.integrations)} hint={label("usageStatus", d.integrations.status)} />
        <Kpi label="Marketplace" value={quota(d.marketplace)} hint="publicaciones" />
        <Kpi label="Academy" value={quota(d.academy)} hint="cursos" />
        <Kpi label="Facturación mensual" value={money(d.monthlyBill.totalMicros)} hint={`plan ${money(d.monthlyBill.planMicros)} + add-ons ${money(d.monthlyBill.addonsMicros)}`} />
        <Kpi label="ROI estimado" value={d.roi.returnPercent === null ? "—" : `${num(d.roi.returnPercent)} %`} hint="con supuestos documentados (ver Forecast)" tone={d.roi.netMicros >= 0 ? "good" : "warn"} />
        <Kpi label="Crédito de la cuenta" value={money(d.creditMicros)} hint={d.outstandingMicros > 0 ? `${money(d.outstandingMicros)} por pagar` : "sin saldo pendiente"} />
      </div>

      <Section title="Límites y recomendaciones de KOE" aside="KOE recomienda; nunca bloquea ni borra lo que ya existe">
        {alerts.length === 0 && <p className="text-sm text-ink-muted">Ningún límite está cerca de su tope.</p>}
        <ul className="space-y-2" aria-label="Alertas de límites">
          {alerts.map((item) => (
            <Card as="li" key={item.resource} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center gap-2"><Badge tone={SEVERITY_TONE[item.severity]}>{label("severity", item.severity)}</Badge><p className="font-medium">{item.text}</p></div>
              <p className="text-xs text-ink-muted">{item.note}</p>
              <OptionButtons options={item.options} persona={persona} send={send} />
            </Card>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => send({ type: "billing.analyze" })}>Pedir un análisis a KOE</Button>
          <span className="text-xs text-ink-muted">Cada análisis guarda el Worker, el modelo y su costo estimado; no se sobrescribe.</span>
        </div>
        <ul className="space-y-0.5 text-sm text-ink-soft" aria-label="Historial de análisis de KOE">
          {[...analyses].reverse().slice(0, 4).map((item) => <li key={item.id}>{when(item.at)} · {item.workerName} · modelo {item.model.label} · {label("recommendation", item.recommendation)} · costo del análisis {money(item.estimatedCostMicros)}</li>)}
        </ul>
      </Section>

      <Section title="Propuestas de NEX" aside="Nivel 1 prepara; Nivel 2 solicita un upgrade con autorización; una persona siempre aprueba">
        {proposals.length === 0 && <p className="text-sm text-ink-muted">No hay propuestas.</p>}
        <ul className="space-y-2" aria-label="Propuestas">
          {proposals.map((item) => (
            <Card as="li" key={item.id} aria-label={`Propuesta ${item.id}`} className="space-y-1 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="primary">{label("proposalKind", item.payload.kind)}</Badge>
                {item.via === "authorized" && <Badge tone="accent">Solicitud autorizada</Badge>}
                <Badge tone={item.status === "approved" ? "success" : item.status === "rejected" ? "neutral" : "warning"}>{label("proposalStatus", item.status)}</Badge>
                <span className="font-medium">{describePayload(item.payload, planName)}</span>
              </div>
              <p className="text-xs text-ink-muted">Propuesta de {who(item.proposedBy)} · {item.reason}</p>
              {item.status === "proposed" && <div className="flex gap-2"><Button size="sm" onClick={() => send({ type: "proposal.approve", proposalId: item.id })}>Aprobar</Button><Button size="sm" variant="ghost" onClick={() => send({ type: "proposal.reject", proposalId: item.id })}>Rechazar</Button></div>}
            </Card>
          ))}
        </ul>
      </Section>

      <Card className="space-y-2 p-4" aria-label="Autorización para solicitar upgrades">
        <p className="font-medium">Autorización para que NEX solicite un upgrade (Nivel 2)</p>
        {grant
          ? <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="success">Vigente</Badge><span>{grant.maxPerDay ? `hasta ${grant.maxPerDay} solicitud por día` : "sin límite diario"} · concedida por {who(grant.grantedBy)}{grant.expiresAt ? ` · vence el ${day(grant.expiresAt)}` : ""}</span><Button size="sm" variant="ghost" onClick={() => send({ type: "authorization.revoke", grantId: grant.id })}>Revocar</Button></div>
          : <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="warning">Sin autorización</Badge><Button size="sm" variant="secondary" onClick={() => send({ type: "authorization.grant", maxPerDay: 1 })}>Conceder una solicitud por día</Button></div>}
        <p className="text-xs text-ink-muted">Solo es una solicitud al plan inmediatamente superior: una persona la aprueba. NEX nunca cobra, cancela, renueva, emite pagos ni modifica facturas.</p>
      </Card>

      <Section title="Auditoría" aside="Nunca se borra">
        <label className="flex items-center gap-2 text-sm text-ink-muted">Categoría
          <select aria-label="Categoría de auditoría" className={inputClass} value={category} onChange={(event) => setCategory(event.target.value as BillingAuditCategory | "")}>
            <option value="">Todas</option>
            {(["plan", "addons", "invoices", "payments", "credits", "proposals", "access", "other"] as const).map((key) => <option key={key} value={key}>{label("auditCategory", key)}</option>)}
          </select>
        </label>
        <ul className="space-y-0.5 text-sm text-ink-soft" aria-label="Auditoría">
          {[...audit.shown].reverse().map((entry, index) => <li key={`${entry.at}-${index}`}>{when(entry.at)} · {who(entry.actor)} · {entry.action} · {entry.detail}</li>)}
        </ul>
        {hiddenNote(audit.hidden) && <p className="text-xs text-ink-muted">{hiddenNote(audit.hidden)}</p>}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- plans
export function PlansTab({ state, persona }: BillingTabProps) {
  const plans = plansFor(state, persona.tenantId);
  const current = state.accounts.find((item) => item.tenantId === persona.tenantId)?.planId;
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">Cada plan declara lo que incluye. Los add-ons se compran aparte y no dependen del plan. Los precios son de ejemplo.</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => (
          <Card key={plan.id} as="article" aria-label={`Plan ${plan.name}`} className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{plan.name}</h3>{plan.id === current && <Badge tone="success">Plan actual</Badge>}{plan.custom && <Badge tone="accent">Personalizado</Badge>}{!plan.selfServe && !plan.custom && <Badge tone="neutral">Se acuerda con KYNOVA</Badge>}</div>
            <p className="text-2xl font-semibold">{money(plan.monthlyMicros)}<span className="text-sm font-normal text-ink-muted"> al mes</span></p>
            <p className="text-xs text-ink-muted">{plan.summary}</p>
            <ul className="space-y-0.5 text-sm text-ink-soft">
              {RESOURCES.map((resource) => <li key={resource} className="flex justify-between gap-2"><span>{label("resource", resource)}</span><span>{num(plan.limits[resource])}</span></li>)}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- licenses and limits
export function LicensesTab({ state, env, asOf, persona, send }: BillingTabProps) {
  const rows = usageRows(state, env.signals, persona.tenantId, asOf);
  const alerts = limitAlerts(state, env.signals, persona.tenantId, asOf);
  const table = (items: readonly UsageRow[], name: string) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left" aria-label={name}>
        <thead><tr className="text-xs text-ink-muted"><th className="px-2 py-1.5">Recurso</th><th className="px-2 py-1.5">En uso</th><th className="px-2 py-1.5">Del plan</th><th className="px-2 py-1.5">Add-ons</th><th className="px-2 py-1.5">Límite</th><th className="px-2 py-1.5">Estado</th></tr></thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.resource} className="border-t border-line text-sm">
              <td className="px-2 py-1.5 font-medium">{label("resource", row.resource)}</td><td className="px-2 py-1.5">{num(row.used)}</td><td className="px-2 py-1.5">{num(row.included)}</td><td className="px-2 py-1.5">{row.extra > 0 ? `+${num(row.extra)}` : "—"}</td><td className="px-2 py-1.5">{num(row.limit)}</td>
              <td className="px-2 py-1.5"><Badge tone={STATUS_TONE[row.status]}>{label("usageStatus", row.status)}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="space-y-6">
      <Section title="Licencias" aside="El límite es el del plan más los add-ons activos">{table(rows.filter((row) => LICENSE_RESOURCES.includes(row.resource)), "Licencias")}</Section>
      <Section title="Otros límites del plan">{table(rows.filter((row) => !LICENSE_RESOURCES.includes(row.resource)), "Otros límites")}</Section>
      <Section title="Cuando un límite se alcanza" aside="KOE recomienda opciones; nunca bloquea datos existentes">
        {alerts.length === 0 && <p className="text-sm text-ink-muted">Ningún límite está cerca de su tope.</p>}
        <ul className="space-y-2" aria-label="Opciones por límite">
          {alerts.map((item) => (
            <Card as="li" key={item.resource} className="space-y-2 p-4"><p className="font-medium">{item.text}</p><p className="text-xs text-ink-muted">{item.note}</p><OptionButtons options={item.options} persona={persona} send={send} /></Card>
          ))}
        </ul>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- add-ons
export function AddonsTab({ state, persona, send }: BillingTabProps) {
  const purchases = addonsOf(state, persona.tenantId);
  const [quantity, setQuantity] = useState(1);
  const nex = isNex(persona.actor);
  return (
    <div className="space-y-6">
      <Section title="Catálogo de add-ons" aside="Desacoplados del plan: se compran por paquetes y suman a lo que el plan incluye">
        <label className="flex items-center gap-2 text-sm text-ink-muted">Paquetes
          <input aria-label="Paquetes" type="number" min={1} max={20} className={`${inputClass} w-20`} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} />
        </label>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ADDON_KEYS.map((key: AddonKey) => (
            <Card key={key} as="article" aria-label={label("addon", key)} className="space-y-2 p-4">
              <p className="font-medium">{label("addon", key)}</p>
              <p className="text-sm text-ink-soft">{money(ADDONS[key].monthlyMicros)} al mes por paquete · suma {num(ADDONS[key].units)} a «{label("resource", ADDONS[key].resource as Resource)}»</p>
              <Button size="sm" variant="secondary" onClick={() => send(nex ? { type: "proposal.create", payload: { kind: "addon", addon: key, quantity }, reason: "Propuesta de NEX" } : { type: "addon.purchase", addon: key, quantity })}>{nex ? "Preparar propuesta" : "Comprar (simulado)"}</Button>
            </Card>
          ))}
        </div>
      </Section>
      <Section title="Add-ons de la empresa" aside="Cancelar un add-on nunca borra datos; se rechaza si el uso quedaría por encima del límite">
        {purchases.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay add-ons.</p>}
        <ul className="space-y-2" aria-label="Add-ons comprados">
          {purchases.map((item) => (
            <Card as="li" key={item.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1"><p className="font-medium">{item.quantity} × {label("addon", item.addon)}</p><p className="text-xs text-ink-muted">{money(item.unitMonthlyMicros)} al mes por paquete · comprado el {day(item.purchasedAt)} por {who(item.by)}{item.cancelledAt ? ` · cancelado el ${day(item.cancelledAt)}` : ""}</p></div>
              <Badge tone={item.status === "active" ? "success" : "neutral"}>{item.status === "active" ? "Activo" : "Cancelado"}</Badge>
              {item.status === "active" && <Button size="sm" variant="ghost" onClick={() => send({ type: "addon.cancel", purchaseId: item.id })}>Cancelar add-on</Button>}
            </Card>
          ))}
        </ul>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- AI usage
export function AiTab({ env, asOf, persona }: BillingTabProps) {
  const usage = aiUsage(env.signals, persona.tenantId, asOf);
  const rank = (rows: readonly { id: string; label: string; tasks: number; costMicros: number }[]) => rows.map((row) => ({ id: row.id, label: row.label, value: row.costMicros, note: `${num(row.tasks)} tareas` }));
  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">KOE AI Usage: lo que KOE hizo por la empresa en los últimos {usage.windowDays} días. No se muestran proveedores ni modelos: solo tareas, costo y tiempo ahorrado, todo calculado por KOE.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Tareas ejecutadas" value={num(usage.tasks)} hint={`${num(usage.successes)} terminaron bien`} />
        <Kpi label="Costo estimado" value={money(usage.costMicros)} />
        <Kpi label="Costo promedio por tarea" value={money(usage.averageCostMicros)} />
        <Kpi label="Tiempo ahorrado" value={unitValue("minutes", usage.savedMinutes)} hint={`valor estimado ${money(usage.savedMicros)}`} tone="good" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Costo por departamento"><Ranking rows={rank(usage.byDepartment)} format={money} /></Section>
        <Section title="Costo por Worker"><Ranking rows={rank(usage.byWorker)} format={money} /></Section>
        <Section title="Costo por automatización"><Ranking rows={rank(usage.byAutomation)} format={money} empty="Ninguna automatización ejecutó tareas en este periodo." /></Section>
        <Section title="Costo por agente IA"><Ranking rows={rank(usage.byAgent)} format={money} empty="Ningún agente IA ejecutó tareas en este periodo." /></Section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- forecast and ROI
export function ForecastTab({ state, env, asOf, persona, send }: BillingTabProps) {
  const f = forecast(state, env.signals, persona.tenantId, asOf);
  const r = roi(state, env.signals, persona.tenantId, asOf);
  const planName = (id?: string) => (id ? planOf(state, persona.tenantId, id)?.name ?? id : "");
  const rec = f.recommendation;
  const nex = isNex(persona.actor);
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Consumo proyectado" value={`${num(f.projectedTasks)} tareas`} hint={`próximos ${f.windowDays} días · ritmo ×${num(f.growth, 2)}`} />
        <Kpi label="Costo proyectado de IA" value={money(f.projectedAiCostMicros)} />
        <Kpi label="Costo proyectado total" value={money(f.projectedTotalMicros)} hint={`plataforma ${money(f.platformMicros)} + IA`} />
        <Kpi label="Recomendación" value={label("recommendation", rec.kind)} tone={rec.kind === "upgrade" ? "warn" : "good"} hint={rec.toPlanId ? planName(rec.toPlanId) : undefined} />
      </div>

      <Card className="space-y-2 p-4" aria-label="Recomendación de KOE">
        <div className="flex flex-wrap items-center gap-2"><Badge tone={rec.kind === "upgrade" ? "warning" : "success"}>{label("recommendation", rec.kind)}</Badge><p className="font-medium">{rec.text}</p></div>
        {rec.addonAlternativeMicros !== undefined && <p className="text-xs text-ink-muted">Alternativa: cubrirlo solo con add-ons costaría {money(rec.addonAlternativeMicros)} al mes.</p>}
        {rec.toPlanId && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => send(nex ? { type: "proposal.create", payload: { kind: "plan", toPlanId: rec.toPlanId ?? "" }, reason: rec.text } : { type: "plan.change", toPlanId: rec.toPlanId ?? "" })}>
              {nex ? "Preparar propuesta de cambio de plan" : `Cambiar a ${planName(rec.toPlanId)}`}
            </Button>
            <span className="text-xs text-ink-muted">{rec.deltaMonthlyMicros >= 0 ? `+${money(rec.deltaMonthlyMicros)}` : money(rec.deltaMonthlyMicros)} al mes</span>
          </div>
        )}
      </Card>

      <Section title="Uso proyectado por recurso" aside="Los recursos sin historial se proyectan sin crecimiento">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left" aria-label="Uso proyectado">
            <thead><tr className="text-xs text-ink-muted"><th className="px-2 py-1.5">Recurso</th><th className="px-2 py-1.5">Hoy</th><th className="px-2 py-1.5">Proyectado</th><th className="px-2 py-1.5">Límite</th><th className="px-2 py-1.5">Proyectado / límite</th></tr></thead>
            <tbody>
              {f.rows.map((row) => <tr key={row.resource} className="border-t border-line text-sm"><td className="px-2 py-1.5 font-medium">{label("resource", row.resource)}</td><td className="px-2 py-1.5">{num(row.used)}</td><td className="px-2 py-1.5">{num(row.projected)}</td><td className="px-2 py-1.5">{num(row.limit)}</td><td className="px-2 py-1.5">{pct(row.ratio)}</td></tr>)}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="ROI" aside="Estimado, con supuestos documentados">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Resumen del ROI">
          <Kpi label="Tiempo ahorrado" value={unitValue("minutes", r.savedMinutes)} />
          <Kpi label="Costo IA" value={money(r.aiCostMicros)} />
          <Kpi label="Costo plataforma" value={money(r.platformCostMicros)} />
          <Kpi label="Ahorro estimado" value={money(r.savedMicros)} tone="good" />
          <Kpi label="ROI" value={r.returnPercent === null ? "—" : `${num(r.returnPercent)} %`} tone={r.netMicros >= 0 ? "good" : "warn"} hint={`neto ${money(r.netMicros)}`} />
        </div>
        <p className="text-xs text-ink-muted">{r.assumption}</p>
      </Section>
    </div>
  );
}
