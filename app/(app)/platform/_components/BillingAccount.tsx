"use client";

import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { TRIAL_DAYS, accountOf, auditOf, changesOf, creditsOf, invoicesOf, paymentsOf, type PlanChange } from "@/lib/contracts/platform/billing-center";
import { label } from "@/lib/contracts/platform/billing-messages";
import { FUTURE_PAYMENT_CONNECTORS, accountBalance, creditBalance, invoiceBalance, nextPlanUp, planOf, plansFor, type InvoiceState } from "@/lib/contracts/platform/koe-billing";
import { hiddenNote, latest } from "@/lib/contracts/platform/display";
import { Kpi, Section, money } from "./InsightsCharts";
import { day, isNex, when, who } from "./BillingViews";
import type { BillingTabProps } from "./BillingCenter";

const INVOICE_TONE: Record<InvoiceState, BadgeTone> = { open: "warning", paid: "success", overdue: "danger" };

// ---------------------------------------------------------------- invoices, receipts, renewals and credits (architecture only: nothing is charged)
export function InvoicesTab({ state, asOf, persona, send }: BillingTabProps) {
  const account = accountOf(state, persona.tenantId);
  const invoices = invoicesOf(state, persona.tenantId);
  const payments = paymentsOf(state, persona.tenantId);
  const credits = creditsOf(state, persona.tenantId);
  const balance = accountBalance(state, persona.tenantId, asOf);
  const history = latest([...changesOf(state, persona.tenantId)].reverse(), 12);
  const log = latest(auditOf(state, persona.tenantId, "invoices"), 10);
  if (!account) return <p className="text-sm text-ink-muted">Esta empresa todavía no tiene una cuenta de facturación.</p>;
  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">Todo es arquitectura: las facturas y los recibos solo se registran, no hay pasarela y no se cobra a nadie. Una factura emitida nunca se modifica; si hubo un error se corrige con un crédito.</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Saldo pendiente" value={money(balance.outstandingMicros)} hint={`${balance.openInvoices} facturas abiertas`} tone={balance.overdueMicros > 0 ? "warn" : "good"} />
        <Kpi label="Crédito disponible" value={money(creditBalance(state, persona.tenantId))} hint="se aplica solo en la próxima renovación" />
        <Kpi label="Próxima renovación" value={day(account.renewsAt)} hint={label("accountStatus", account.status)} />
        <Kpi label="Facturas emitidas" value={String(invoices.length)} hint={`${payments.length} recibos`} />
      </div>

      <Section title="Renovación" aside="Siempre la corre una persona; NEX nunca renueva">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" onClick={() => send({ type: "renewal.run" })}>Renovar ahora (simulado)</Button>
          <span className="text-xs text-ink-muted">Se puede correr hasta 3 días antes de la fecha; emite la factura del periodo con el plan y los add-ons activos.</span>
        </div>
      </Section>

      <Section title="Facturas">
        {invoices.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay facturas.</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left" aria-label="Facturas">
            <thead><tr className="text-xs text-ink-muted"><th className="px-2 py-1.5">Factura</th><th className="px-2 py-1.5">Emitida</th><th className="px-2 py-1.5">Periodo</th><th className="px-2 py-1.5">Total</th><th className="px-2 py-1.5">Pendiente</th><th className="px-2 py-1.5">Estado</th><th className="px-2 py-1.5">Pago</th></tr></thead>
            <tbody>
              {[...invoices].reverse().map((invoice) => {
                const b = invoiceBalance(state, invoice.id, asOf);
                return (
                  <tr key={invoice.id} className="border-t border-line align-top text-sm">
                    <td className="px-2 py-1.5 font-medium">{invoice.number}<ul className="text-xs font-normal text-ink-muted">{invoice.lines.map((line, index) => <li key={index}>{line.description}{line.quantity > 1 ? ` ×${line.quantity}` : ""}: {money(line.totalMicros)}</li>)}</ul></td>
                    <td className="px-2 py-1.5">{day(invoice.issuedAt)}</td><td className="px-2 py-1.5">{day(invoice.periodStart)} a {day(invoice.periodEnd)}</td>
                    <td className="px-2 py-1.5">{money(invoice.totalMicros)}</td><td className="px-2 py-1.5">{money(b.outstandingMicros)}</td>
                    <td className="px-2 py-1.5"><Badge tone={INVOICE_TONE[b.status]}>{label("invoiceStatus", b.status)}</Badge></td>
                    <td className="px-2 py-1.5">{b.outstandingMicros > 0 && <div className="flex flex-wrap gap-1"><Button size="sm" variant="secondary" aria-label={`Pagar ${invoice.number} con tarjeta`} onClick={() => send({ type: "payment.record", invoiceId: invoice.id, amountMicros: b.outstandingMicros, method: "simulatedCard" })}>Registrar pago (tarjeta simulada)</Button><Button size="sm" variant="ghost" aria-label={`Pagar ${invoice.number} por transferencia`} onClick={() => send({ type: "payment.record", invoiceId: invoice.id, amountMicros: b.outstandingMicros, method: "simulatedTransfer" })}>Transferencia simulada</Button></div>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Recibos y pagos">
          {payments.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay pagos.</p>}
          <ul className="space-y-1 text-sm text-ink-soft" aria-label="Recibos">
            {[...payments].reverse().map((item) => <li key={item.id}>{item.receipt} · {when(item.at)} · {money(item.amountMicros)} · {label("method", item.method)} · {state.invoices.find((invoice) => invoice.id === item.invoiceId)?.number} · {who(item.by)}</li>)}
          </ul>
        </Section>
        <Section title="Créditos" aside="Un movimiento por cada cambio; el saldo es su suma">
          <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="secondary" onClick={() => send({ type: "credit.add", amountMicros: 10_000_000, reason: "Crédito de cortesía" })}>Agregar un crédito de US$ 10</Button></div>
          <ul className="space-y-1 text-sm text-ink-soft" aria-label="Créditos">
            {[...credits].reverse().map((item) => <li key={item.id}>{when(item.at)} · {money(item.amountMicros)} · {item.reason}</li>)}
          </ul>
        </Section>
      </div>

      <Section title="Historial" aside="Nunca se borra">
        <ul className="space-y-0.5 text-sm text-ink-soft" aria-label="Historial de cambios de plan">
          {history.shown.map((item: PlanChange) => <li key={item.id}>{when(item.at)} · {label("changeKind", item.kind)} · {item.fromPlanId ? planOf(state, persona.tenantId, item.fromPlanId)?.name ?? item.fromPlanId : "—"} → {item.toPlanId ? planOf(state, persona.tenantId, item.toPlanId)?.name ?? item.toPlanId : "—"} · {who(item.by)}</li>)}
        </ul>
        {hiddenNote(history.hidden) && <p className="text-xs text-ink-muted">{hiddenNote(history.hidden)}</p>}
        <ul className="space-y-0.5 text-sm text-ink-soft" aria-label="Historial de facturas">
          {[...log.shown].reverse().map((entry, index) => <li key={`${entry.at}-${index}`}>{when(entry.at)} · {who(entry.actor)} · {entry.action} · {entry.detail}</li>)}
        </ul>
      </Section>

      <Card className="space-y-2 p-4" aria-label="Métodos de pago futuros">
        <p className="font-medium">Métodos de pago preparados para el futuro</p>
        <p className="text-xs text-ink-muted">Solo están declarados: ninguno existe hoy. Cada uno pasará por KOE, nunca directo, y cada cobro lo aprobará una persona.</p>
        <ul className="flex flex-wrap gap-2">
          {FUTURE_PAYMENT_CONNECTORS.map((item) => <li key={item.id}><Badge tone="neutral">{item.name} · no construido</Badge></li>)}
        </ul>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- the Upgrade Center
export function UpgradeTab({ state, persona, send, sendAsPlatform }: BillingTabProps) {
  const account = accountOf(state, persona.tenantId);
  if (!account) return <p className="text-sm text-ink-muted">Esta empresa todavía no tiene una cuenta de facturación.</p>;
  const current = planOf(state, persona.tenantId, account.planId);
  const plans = plansFor(state, persona.tenantId);
  const up = nextPlanUp(state, persona.tenantId);
  const nex = isNex(persona.actor);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="primary">Plan {current?.name ?? account.planId}</Badge>
        <Badge tone={account.status === "cancelled" ? "danger" : account.status === "trialing" ? "warning" : "success"}>{label("accountStatus", account.status)}</Badge>
        {account.trialEndsAt && <span className="text-sm text-ink-muted">La prueba termina el {day(account.trialEndsAt)}</span>}
        {account.endsAt && account.status === "cancelled" && <span className="text-sm text-ink-muted">Acceso incluido hasta el {day(account.endsAt)}; los datos no se borran</span>}
      </div>

      <Section title="Cambiar de plan" aside="Un downgrade se rechaza si el uso actual no cabe; nunca se toca ningún dato">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((plan) => {
            const kind = plan.id === account.planId ? "current" : plan.custom ? "custom" : plan.id === "enterprise" ? "enterprise" : plan.tier > (current?.tier ?? 0) ? "upgrade" : "downgrade";
            return (
              <Card key={plan.id} as="article" aria-label={`Cambiar a ${plan.name}`} className="space-y-2 p-4">
                <div className="flex items-center gap-2"><p className="font-semibold">{plan.name}</p>{kind === "current" && <Badge tone="success">Actual</Badge>}</div>
                <p className="text-sm text-ink-soft">{money(plan.monthlyMicros)} al mes</p>
                {kind !== "current" && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => send(nex ? { type: "proposal.create", payload: { kind: "plan", toPlanId: plan.id }, reason: "Propuesta de NEX" } : { type: "plan.change", toPlanId: plan.id })}>
                      {nex ? `Preparar ${label("changeKind", kind).toLowerCase()}` : kind === "enterprise" ? "Pasar a Enterprise" : kind === "custom" ? "Pasar al plan personalizado" : kind === "upgrade" ? "Hacer upgrade" : "Hacer downgrade"}
                    </Button>
                    {kind === "upgrade" && !account.trialUsed && account.status === "active" && <Button size="sm" variant="ghost" onClick={() => send({ type: "plan.trial", planId: plan.id })}>Probar {TRIAL_DAYS} días</Button>}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
        {account.trialUsed && <p className="text-xs text-ink-muted">El periodo de prueba de la empresa ya se usó.</p>}
      </Section>

      <Section title="Suscripción">
        <div className="flex flex-wrap items-center gap-2">
          {account.status !== "cancelled" && <Button size="sm" variant="ghost" onClick={() => send({ type: "plan.cancel", reason: "Pedido desde el Upgrade Center" })}>Cancelar suscripción</Button>}
          {account.status === "cancelled" && <Button size="sm" variant="secondary" onClick={() => send({ type: "plan.reactivate" })}>Reactivar suscripción</Button>}
          {account.status === "trialing" && <Button size="sm" variant="ghost" onClick={() => sendAsPlatform({ type: "trial.expire" })}>Simular el fin de la prueba (plataforma)</Button>}
        </div>
        <p className="text-xs text-ink-muted">Cancelar nunca borra datos y solo lo decide una persona con autoridad sobre la facturación; NEX nunca cancela.</p>
      </Section>

      <Card className="space-y-2 p-4" aria-label="Solicitud de upgrade de NEX">
        <p className="font-medium">Solicitar un upgrade (Nivel 2)</p>
        <p className="text-sm text-ink-soft">{up ? `Con una autorización vigente, NEX puede solicitar el plan inmediatamente superior (${up.name}). Es solo una solicitud: una persona la aprueba.` : "No hay un plan superior que se pueda pedir por esta vía."}</p>
        {up && <Button size="sm" variant="secondary" onClick={() => send({ type: "upgrade.request", toPlanId: up.id })}>Solicitar upgrade a {up.name} (como NEX)</Button>}
      </Card>
    </div>
  );
}
