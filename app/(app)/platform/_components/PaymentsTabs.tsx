"use client";

import { useRef, useState, type ReactNode } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Inbox } from "lucide-react";
import { invoiceTotals, isOverdue, type InvoiceStatus, type SubscriptionEvent, type SubscriptionStatus } from "@/lib/contracts/platform/billing";
import { CURRENCY_CODES, formatMinor, isCurrency, isCrypto, parseMajor, type CurrencyCode } from "@/lib/contracts/platform/currency";
import { PROVIDER_MANIFESTS } from "@/lib/contracts/platform/integrations";
import { METHOD_CURRENCIES, PAYMENT_METHODS, confirmsByWebhook, summarize, suggestMatches, type PaymentMethodId, type WebhookType } from "@/lib/contracts/platform/ledger";
import { DEMO_RATES } from "@/lib/contracts/platform/payments-demo";
import type { PaymentStatus } from "@/lib/contracts/platform/payments";
import { ConnectionPanel } from "./ConnectionPanel";
import type { TabProps } from "./PaymentsCenter";

const input = "w-full rounded-xl border border-line bg-raised px-3 py-2 text-sm";

const PAYMENT_LABEL: Record<PaymentStatus, string> = { pending: "Pendiente", succeeded: "Cobrado", failed: "Fallido", refunded: "Reembolsado", partiallyRefunded: "Reembolso parcial", disputed: "En disputa" };
const PAYMENT_TONE: Record<PaymentStatus, BadgeTone> = { pending: "warning", succeeded: "success", failed: "danger", refunded: "neutral", partiallyRefunded: "accent", disputed: "danger" };
const SUB_LABEL: Record<SubscriptionStatus, string> = { incomplete: "Incompleta", trialing: "En prueba", active: "Activa", pastDue: "Pago vencido", paused: "En pausa", cancelled: "Cancelada" };
const INVOICE_LABEL: Record<InvoiceStatus, string> = { draft: "Borrador", open: "Abierta", paid: "Pagada", void: "Anulada", uncollectible: "Incobrable" };

const money = (minor: number, currency: string) => formatMinor({ amountMinor: minor, currency });
const label = (method: PaymentMethodId) => PROVIDER_MANIFESTS[method].label;
const day = (iso?: string) => (iso ? iso.slice(0, 10) : "—");

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-ink-muted">{name}</span>
      {children}
    </label>
  );
}

function MoneyMap({ amounts }: { amounts: Record<string, number> }) {
  const entries = Object.entries(amounts);
  if (entries.length === 0) return <p className="text-xl font-semibold">—</p>;
  return (
    <ul className="space-y-0.5">
      {entries.map(([currency, minor]) => (
        <li key={currency} className="text-xl font-semibold">{money(minor, currency)}</li>
      ))}
    </ul>
  );
}

function Empty({ title, children }: { title: string; children?: string }) {
  return <EmptyState icon={Inbox} title={title}>{children}</EmptyState>;
}

// ---------------------------------------------------------------- 1. dashboard
export function OverviewTab({ state }: TabProps) {
  const [reporting, setReporting] = useState<CurrencyCode>("USD");
  const summary = summarize(state, reporting, DEMO_RATES, new Date());
  const tiles: { title: string; amounts: Record<string, number> }[] = [
    { title: "Cobrado (neto de reembolsos)", amounts: summary.collected },
    { title: "Pendiente de cobro", amounts: summary.pending },
    { title: "Reembolsado", amounts: summary.refunded },
    { title: "Ingreso recurrente mensual", amounts: summary.recurringMonthly },
    { title: "Facturas vencidas", amounts: summary.overdue },
  ];
  const { counts } = summary;
  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="text-sm text-ink-muted">Total cobrado en una sola moneda</p>
          <p className="text-2xl font-semibold">{money(summary.reporting.collected.amountMinor, reporting)}</p>
          {summary.reporting.missingRates.length > 0 && <p className="text-xs text-warning">Sin tasa para {summary.reporting.missingRates.join(", ")}: no se incluyen.</p>}
          <p className="text-xs text-ink-muted">Tasas de ejemplo, solo informativas: nunca se usan para liquidar un pago.</p>
        </div>
        <Field name="Moneda del reporte">
          <select aria-label="Moneda del reporte" className={input} value={reporting} onChange={(event) => setReporting(event.target.value as CurrencyCode)}>
            {CURRENCY_CODES.map((code) => <option key={code} value={code}>{code}{isCrypto(code) ? " (reservada)" : ""}</option>)}
          </select>
        </Field>
      </Card>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tiles.map((tile) => (
          <Card as="li" key={tile.title} className="space-y-2 p-5">
            <h2 className="text-sm text-ink-muted">{tile.title}</h2>
            <MoneyMap amounts={tile.amounts} />
          </Card>
        ))}
      </ul>
      <Card className="flex flex-wrap gap-2 p-5">
        <Badge tone={counts.refundsToApprove ? "warning" : "neutral"}>{counts.refundsToApprove} reembolsos por aprobar</Badge>
        <Badge tone={counts.disputed ? "danger" : "neutral"}>{counts.disputed} en disputa</Badge>
        <Badge tone={counts.failed ? "danger" : "neutral"}>{counts.failed} fallidos</Badge>
        <Badge tone={counts.openStatementLines ? "warning" : "neutral"}>{counts.openStatementLines} líneas por conciliar</Badge>
        <Badge tone={counts.overdueInvoices ? "danger" : "neutral"}>{counts.overdueInvoices} facturas vencidas</Badge>
        <Badge>{counts.activeSubscriptions} suscripciones activas</Badge>
      </Card>
      {counts.payments === 0 && <Empty title="Aún no hay movimientos">Cargue los datos de ejemplo o active un método en la pestaña Métodos.</Empty>}
    </div>
  );
}

// ---------------------------------------------------------------- 2-4. methods, connection, configuration
export function MethodsTab({ state, dispatch }: TabProps) {
  const [selected, setSelected] = useState<PaymentMethodId | null>(null);
  return (
    <div className="space-y-4">
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {PAYMENT_METHODS.map((method) => {
          const connection = state.connections[method];
          const manifest = PROVIDER_MANIFESTS[method];
          const pending = manifest.authKinds.includes("undefined");
          return (
            <Card as="li" key={method} className="space-y-3 p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">{manifest.label}</h2>
                <Badge tone={connection.status === "active" ? "success" : connection.status === "error" ? "danger" : "neutral"}>{connection.status === "active" ? "Activo" : connection.status === "notConnected" ? "No conectado" : connection.status}</Badge>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {method === "crypto" && <Badge tone="accent">Reservado</Badge>}
                {pending && <Badge tone="warning">Documentación pendiente</Badge>}
                <Badge tone="primary">{confirmsByWebhook(method) ? "Confirma por webhook" : "Confirma por conciliación"}</Badge>
              </div>
              <p className="text-xs text-ink-muted">Monedas: {METHOD_CURRENCIES[method].join(", ")}</p>
              <Button size="sm" variant={selected === method ? "primary" : "secondary"} onClick={() => setSelected(selected === method ? null : method)}>{selected === method ? "Cerrar" : "Administrar"}</Button>
            </Card>
          );
        })}
      </ul>
      {selected ? (
        <ConnectionPanel connection={state.connections[selected]} message={null} send={(event) => dispatch({ type: "connection", method: selected, event })} />
      ) : (
        <Empty title="Elija un método">Aquí verá su configuración, permisos, registros, errores y auditoría.</Empty>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 5. payment history
export function PaymentsTab({ state, dispatch, actor, now }: TabProps) {
  const live = PAYMENT_METHODS.filter((method) => state.connections[method].enabled);
  const [method, setMethod] = useState<PaymentMethodId>("stripe");
  const [currency, setCurrency] = useState<CurrencyCode>("USD");
  const [amount, setAmount] = useState("");
  const [customer, setCustomer] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [refunding, setRefunding] = useState<{ id: string; amount: string; reason: string } | null>(null);
  const counter = useRef(0);
  const eventId = () => `evt_sim_${(counter.current += 1)}`;

  const create = () => {
    const minor = parseMajor(amount, currency);
    if (minor === null || minor === 0) return setFormError("Monto inválido: use solo números y los decimales de la moneda.");
    setFormError(null);
    dispatch({ type: "payment.create", actor, at: now(), method, amount: { amountMinor: minor, currency }, customerId: customer.trim() || undefined });
    setAmount("");
  };
  const hook = (provider: PaymentMethodId, paymentRef: string, type: WebhookType) =>
    dispatch({ type: "webhook", envelope: { provider, eventId: eventId(), type, paymentRef, signature: "valid", receivedAt: now() } });

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Registrar un cobro</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field name="Método">
            <select aria-label="Método" className={input} value={method} onChange={(event) => { const next = event.target.value as PaymentMethodId; setMethod(next); setCurrency(METHOD_CURRENCIES[next][0]); }}>
              {PAYMENT_METHODS.map((id) => <option key={id} value={id}>{label(id)}{live.includes(id) ? "" : " (inactivo)"}</option>)}
            </select>
          </Field>
          <Field name="Monto">
            <input aria-label="Monto" className={input} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" />
          </Field>
          <Field name="Moneda">
            <select aria-label="Moneda" className={input} value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode)}>
              {CURRENCY_CODES.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </Field>
          <Field name="Cliente">
            <input aria-label="Cliente" className={input} value={customer} onChange={(event) => setCustomer(event.target.value)} />
          </Field>
        </div>
        {formError && <p role="alert" className="text-sm text-danger-soft">{formError}</p>}
        <Button size="sm" variant="primary" onClick={create}>Registrar cobro</Button>
      </Card>

      {state.payments.length === 0 ? (
        <Empty title="Sin pagos">Los cobros registrados aparecen aquí con su estado y sus acciones.</Empty>
      ) : (
        <ul className="space-y-3">
          {[...state.payments].reverse().map((payment) => {
            const byWebhook = confirmsByWebhook(payment.method);
            const canRefund = (payment.status === "succeeded" || payment.status === "partiallyRefunded") && PROVIDER_MANIFESTS[payment.method].capabilities.includes("refund");
            return (
              <Card as="li" key={payment.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{payment.id} · {label(payment.method)} · {formatMinor(payment.amount)}</p>
                  <Badge tone={PAYMENT_TONE[payment.status]}>{PAYMENT_LABEL[payment.status]}</Badge>
                </div>
                <p className="text-xs text-ink-muted">{payment.customerId ?? "Sin cliente"} · ref. {payment.reference} · {day(payment.createdAt)}</p>
                <div className="flex flex-wrap gap-2">
                  {payment.status === "pending" && byWebhook && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => hook(payment.method, payment.id, "payment.succeeded")}>Webhook: cobrado</Button>
                      <Button size="sm" variant="ghost" onClick={() => hook(payment.method, payment.id, "payment.failed")}>Webhook: fallido</Button>
                    </>
                  )}
                  {payment.status === "pending" && !byWebhook && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "payment.paid", actor, at: now(), paymentId: payment.id, source: "manual" })}>Marcar cobrado</Button>
                      <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "payment.fail", actor, at: now(), paymentId: payment.id, message: "Marcado como fallido" })}>Marcar fallido</Button>
                    </>
                  )}
                  {payment.status === "succeeded" && byWebhook && <Button size="sm" variant="ghost" onClick={() => hook(payment.method, payment.id, "payment.disputed")}>Webhook: disputa</Button>}
                  {canRefund && <Button size="sm" variant="ghost" onClick={() => setRefunding({ id: payment.id, amount: "", reason: "" })}>Reembolsar…</Button>}
                </div>
                {refunding?.id === payment.id && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input aria-label="Monto del reembolso" className={input} placeholder="Monto" value={refunding.amount} onChange={(event) => setRefunding({ ...refunding, amount: event.target.value })} />
                    <input aria-label="Motivo del reembolso" className={input} placeholder="Motivo" value={refunding.reason} onChange={(event) => setRefunding({ ...refunding, reason: event.target.value })} />
                    <Button size="sm" variant="secondary" onClick={() => {
                      const currencyCode = payment.amount.currency;
                      const minor = isCurrency(currencyCode) ? parseMajor(refunding.amount, currencyCode) : null;
                      dispatch({ type: "refund.request", actor, at: now(), paymentId: payment.id, amount: { amountMinor: minor ?? 0, currency: currencyCode }, reason: refunding.reason });
                      setRefunding(null);
                    }}>Solicitar reembolso</Button>
                  </div>
                )}
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 6. refunds
export function RefundsTab({ state, dispatch, actor, now }: TabProps) {
  const rows = state.payments.flatMap((payment) => payment.refunds.map((refund) => ({ payment, refund })));
  if (rows.length === 0) return <Empty title="Sin reembolsos">Se solicitan desde un pago cobrado. Quien lo solicita no puede aprobarlo.</Empty>;
  const tone = { requested: "warning", completed: "success", rejected: "neutral" } as const;
  const text = { requested: "Por aprobar", completed: "Completado", rejected: "Rechazado" } as const;
  return (
    <ul className="space-y-3">
      {rows.map(({ payment, refund }) => (
        <Card as="li" key={refund.id} className="space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{refund.id} · {payment.id} · {formatMinor(refund.amount)}</p>
            <Badge tone={tone[refund.status]}>{text[refund.status]}</Badge>
          </div>
          <p className="text-xs text-ink-muted">{refund.reason} · solicitado por {refund.requestedBy}{refund.decidedBy ? ` · resuelto por ${refund.decidedBy}` : ""}</p>
          {refund.status === "requested" && (
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={() => dispatch({ type: "refund.decide", actor, at: now(), paymentId: payment.id, refundId: refund.id, approve: true })}>Aprobar</Button>
              <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "refund.decide", actor, at: now(), paymentId: payment.id, refundId: refund.id, approve: false })}>Rechazar</Button>
            </div>
          )}
        </Card>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- 7. subscriptions
export function SubscriptionsTab({ state, dispatch, actor, now }: TabProps) {
  const [customer, setCustomer] = useState("");
  const [plan, setPlan] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>("USD");
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [trial, setTrial] = useState("0");
  const [formError, setFormError] = useState<string | null>(null);

  const create = () => {
    const minor = parseMajor(amount, currency);
    if (minor === null) return setFormError("Monto inválido.");
    setFormError(null);
    dispatch({ type: "subscription.create", actor, at: now(), draft: { customerId: customer.trim(), planName: plan.trim(), amount: { amountMinor: minor, currency }, interval, startedAt: now(), trialDays: Number(trial) || 0 } });
  };
  const act = (subscriptionId: string, event: SubscriptionEvent) => dispatch({ type: "subscription.event", actor, subscriptionId, event });

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Nueva suscripción</h2>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field name="Cliente"><input aria-label="Cliente de la suscripción" className={input} value={customer} onChange={(event) => setCustomer(event.target.value)} /></Field>
          <Field name="Plan"><input aria-label="Plan" className={input} value={plan} onChange={(event) => setPlan(event.target.value)} /></Field>
          <Field name="Importe"><input aria-label="Importe de la suscripción" className={input} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
          <Field name="Moneda"><select aria-label="Moneda de la suscripción" className={input} value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode)}>{CURRENCY_CODES.filter((code) => !isCrypto(code)).map((code) => <option key={code} value={code}>{code}</option>)}</select></Field>
          <Field name="Periodo"><select aria-label="Periodo" className={input} value={interval} onChange={(event) => setInterval(event.target.value as "month" | "year")}><option value="month">Mensual</option><option value="year">Anual</option></select></Field>
          <Field name="Días de prueba"><input aria-label="Días de prueba" className={input} inputMode="numeric" value={trial} onChange={(event) => setTrial(event.target.value)} /></Field>
        </div>
        {formError && <p role="alert" className="text-sm text-danger-soft">{formError}</p>}
        <Button size="sm" variant="primary" onClick={create}>Crear suscripción</Button>
      </Card>
      {state.subscriptions.length === 0 ? (
        <Empty title="Sin suscripciones">Una suscripción nace incompleta y se activa con su primer cobro confirmado.</Empty>
      ) : (
        <ul className="space-y-3">
          {state.subscriptions.map((sub) => (
            <Card as="li" key={sub.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{sub.planName} · {sub.customerId} · {formatMinor(sub.amount)}/{sub.interval === "month" ? "mes" : "año"}</p>
                <Badge tone={sub.status === "active" ? "success" : sub.status === "pastDue" || sub.status === "cancelled" ? "danger" : "warning"}>{SUB_LABEL[sub.status]}</Badge>
              </div>
              <p className="text-xs text-ink-muted">Próximo cobro {day(sub.nextBillingAt)} · intentos fallidos {sub.failedAttempts}{sub.cancelAtPeriodEnd ? " · se cancela al final del periodo" : ""}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => act(sub.id, { type: "chargeSucceeded", at: now() })}>Simular cobro exitoso</Button>
                <Button size="sm" variant="ghost" onClick={() => act(sub.id, { type: "chargeFailed", at: now() })}>Simular cobro fallido</Button>
                <Button size="sm" variant="ghost" onClick={() => act(sub.id, { type: "pause", at: now() })}>Pausar</Button>
                <Button size="sm" variant="ghost" onClick={() => act(sub.id, { type: "resume", at: now() })}>Reanudar</Button>
                <Button size="sm" variant="ghost" onClick={() => act(sub.id, { type: "cancel", at: now(), atPeriodEnd: true })}>Cancelar al final</Button>
                <Button size="sm" variant="ghost" onClick={() => act(sub.id, { type: "cancel", at: now(), atPeriodEnd: false })}>Cancelar ya</Button>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 8. invoicing
export function InvoicesTab({ state, dispatch, actor, now }: TabProps) {
  const [customer, setCustomer] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>("USD");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("");
  const [tax, setTax] = useState("13");
  const [formError, setFormError] = useState<string | null>(null);

  const create = () => {
    const unitMinor = parseMajor(unit, currency);
    const taxPercent = parseMajor(tax, "USD"); // two decimals of a percent → basis points
    if (unitMinor === null || taxPercent === null) return setFormError("Precio o impuesto inválido.");
    setFormError(null);
    dispatch({ type: "invoice.create", actor, at: now(), customerId: customer.trim(), currency, lines: [{ description, quantity: Number(quantity), unitMinor }], taxBps: taxPercent });
  };
  const charge = (invoiceId: string, total: number, invoiceCurrency: string) => {
    const method = PAYMENT_METHODS.find((id) => state.connections[id].enabled && (METHOD_CURRENCIES[id] as readonly string[]).includes(invoiceCurrency));
    if (!method) return dispatch({ type: "payment.create", actor, at: now(), method: "bankTransfer", amount: { amountMinor: total, currency: invoiceCurrency }, invoiceId });
    dispatch({ type: "payment.create", actor, at: now(), method, amount: { amountMinor: total, currency: invoiceCurrency }, invoiceId });
  };

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Nueva factura</h2>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field name="Cliente"><input aria-label="Cliente de la factura" className={input} value={customer} onChange={(event) => setCustomer(event.target.value)} /></Field>
          <Field name="Moneda"><select aria-label="Moneda de la factura" className={input} value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode)}>{CURRENCY_CODES.filter((code) => !isCrypto(code)).map((code) => <option key={code} value={code}>{code}</option>)}</select></Field>
          <Field name="Descripción"><input aria-label="Descripción de la línea" className={input} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
          <Field name="Cantidad"><input aria-label="Cantidad" className={input} inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field>
          <Field name="Precio unitario"><input aria-label="Precio unitario" className={input} inputMode="decimal" value={unit} onChange={(event) => setUnit(event.target.value)} /></Field>
          <Field name="Impuesto %"><input aria-label="Impuesto" className={input} inputMode="decimal" value={tax} onChange={(event) => setTax(event.target.value)} /></Field>
        </div>
        {formError && <p role="alert" className="text-sm text-danger-soft">{formError}</p>}
        <Button size="sm" variant="primary" onClick={create}>Crear borrador</Button>
      </Card>
      {state.invoices.length === 0 ? (
        <Empty title="Sin facturas">Una factura se emite, se cobra y queda pagada solo si el cobro coincide con su total.</Empty>
      ) : (
        <ul className="space-y-3">
          {[...state.invoices].reverse().map((invoice) => {
            const totals = invoiceTotals(invoice.lines, invoice.taxBps);
            const overdue = isOverdue(invoice, new Date());
            return (
              <Card as="li" key={invoice.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{invoice.number} · {invoice.customerId} · {money(totals.total, invoice.currency)}</p>
                  <Badge tone={invoice.status === "paid" ? "success" : overdue || invoice.status === "uncollectible" ? "danger" : "neutral"}>{overdue ? "Vencida" : INVOICE_LABEL[invoice.status]}</Badge>
                </div>
                <p className="text-xs text-ink-muted">Subtotal {money(totals.subtotal, invoice.currency)} · impuesto {money(totals.tax, invoice.currency)} · vence {day(invoice.dueAt)}</p>
                <div className="flex flex-wrap gap-2">
                  {invoice.status === "draft" && <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "invoice.event", actor, invoiceId: invoice.id, event: { type: "issue", at: now(), dueAt: new Date(Date.now() + 30 * 86_400_000).toISOString() } })}>Emitir (30 días)</Button>}
                  {invoice.status === "open" && <Button size="sm" variant="ghost" onClick={() => charge(invoice.id, totals.total, invoice.currency)}>Crear cobro por el total</Button>}
                  {overdue && <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "invoice.event", actor, invoiceId: invoice.id, event: { type: "uncollectible", at: now() } })}>Marcar incobrable</Button>}
                  {(invoice.status === "draft" || invoice.status === "open") && <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "invoice.event", actor, invoiceId: invoice.id, event: { type: "void", at: now() } })}>Anular</Button>}
                </div>
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 9. reconciliation
export function ReconciliationTab({ state, dispatch, actor, now }: TabProps) {
  const transferMethods = PAYMENT_METHODS.filter((id) => !confirmsByWebhook(id));
  const [method, setMethod] = useState<PaymentMethodId>("sinpe");
  const [currency, setCurrency] = useState<CurrencyCode>("CRC");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [payer, setPayer] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const suggestions = suggestMatches(state);

  const add = () => {
    const minor = parseMajor(amount, currency);
    if (minor === null || minor === 0) return setFormError("Monto inválido.");
    setFormError(null);
    dispatch({ type: "statement.import", actor, at: now(), method, lines: [{ method, amount: { amountMinor: minor, currency }, reference: reference.trim() || undefined, payerName: payer.trim() || undefined, receivedAt: now() }] });
  };
  const kind = { exact: ["Coincidencia exacta", "success"], probable: ["Coincidencia probable", "warning"], ambiguous: ["Ambigua: elija a mano", "danger"], none: ["Sin coincidencia", "neutral"] } as const;

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Importar una línea del extracto</h2>
        <div className="grid gap-3 sm:grid-cols-5">
          <Field name="Método"><select aria-label="Método del extracto" className={input} value={method} onChange={(event) => { const next = event.target.value as PaymentMethodId; setMethod(next); setCurrency(METHOD_CURRENCIES[next][0]); }}>{transferMethods.map((id) => <option key={id} value={id}>{label(id)}</option>)}</select></Field>
          <Field name="Monto"><input aria-label="Monto de la línea" className={input} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
          <Field name="Moneda"><select aria-label="Moneda de la línea" className={input} value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode)}>{CURRENCY_CODES.filter((code) => !isCrypto(code)).map((code) => <option key={code} value={code}>{code}</option>)}</select></Field>
          <Field name="Referencia"><input aria-label="Referencia" className={input} value={reference} onChange={(event) => setReference(event.target.value)} /></Field>
          <Field name="Pagador"><input aria-label="Pagador" className={input} value={payer} onChange={(event) => setPayer(event.target.value)} /></Field>
        </div>
        {formError && <p role="alert" className="text-sm text-danger-soft">{formError}</p>}
        <Button size="sm" variant="primary" onClick={add}>Importar línea</Button>
      </Card>
      {state.statement.length === 0 ? (
        <Empty title="Sin líneas de extracto">Importe lo que llegó al banco; el sistema propone con qué cobro coincide y una persona confirma.</Empty>
      ) : (
        <ul className="space-y-3">
          {state.statement.map((line) => {
            const suggestion = suggestions.find((item) => item.line.id === line.id);
            const [text, tone] = suggestion ? kind[suggestion.match.kind] : [line.status === "matched" ? `Conciliada con ${line.paymentId}` : "Ignorada", "neutral" as const];
            return (
              <Card as="li" key={line.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{line.id} · {label(line.method)} · {formatMinor(line.amount)}</p>
                  <Badge tone={tone}>{text}</Badge>
                </div>
                <p className="text-xs text-ink-muted">{line.payerName ?? "Sin pagador"} · ref. {line.reference ?? "—"} · {day(line.receivedAt)}</p>
                {line.status === "open" && (
                  <div className="flex flex-wrap gap-2">
                    {suggestion?.match.paymentId && <Button size="sm" variant="primary" onClick={() => dispatch({ type: "reconcile.confirm", actor, at: now(), lineId: line.id, paymentId: suggestion.match.paymentId as string })}>Confirmar con {suggestion.match.paymentId}</Button>}
                    {suggestion?.match.kind === "ambiguous" && suggestion.match.candidates.map((id) => <Button key={id} size="sm" variant="secondary" onClick={() => dispatch({ type: "reconcile.confirm", actor, at: now(), lineId: line.id, paymentId: id })}>Asignar a {id}</Button>)}
                    <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "reconcile.ignore", actor, at: now(), lineId: line.id })}>Ignorar</Button>
                  </div>
                )}
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- 10. webhooks (architecture + simulator)
export function WebhooksTab({ state, dispatch, now }: TabProps) {
  const providers = PAYMENT_METHODS.filter((id) => confirmsByWebhook(id));
  const [provider, setProvider] = useState<PaymentMethodId>("stripe");
  const [type, setType] = useState<WebhookType>("payment.succeeded");
  const [signature, setSignature] = useState<"valid" | "invalid" | "missing">("valid");
  const [paymentRef, setPaymentRef] = useState("");
  const [eventId, setEventId] = useState("evt_sim_a");
  const recent = state.audit.filter((entry) => entry.action.startsWith("webhook")).slice(-8).reverse();

  const send = () => dispatch({ type: "webhook", envelope: { provider, eventId, type, paymentRef, signature, receivedAt: now() } });
  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-5">
        <h2 className="font-semibold">Cómo llegará un webhook real</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-muted">
          <li>El proveedor llama a <code>/api/v1/inbound/&#123;proveedor&#125;</code> (hoy responde 501: no hay adaptador).</li>
          <li>El adaptador verifica la firma y normaliza el evento a esta misma forma; una firma inválida se rechaza y se registra.</li>
          <li>El evento se deduplica por identificador: repetirlo no cambia nada.</li>
          <li>Un evento fuera de orden no puede retroceder un pago; queda en el registro.</li>
        </ol>
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Simulador</h2>
        <div className="grid gap-3 sm:grid-cols-5">
          <Field name="Proveedor"><select aria-label="Proveedor del webhook" className={input} value={provider} onChange={(event) => setProvider(event.target.value as PaymentMethodId)}>{providers.map((id) => <option key={id} value={id}>{label(id)}</option>)}</select></Field>
          <Field name="Evento"><select aria-label="Evento" className={input} value={type} onChange={(event) => setType(event.target.value as WebhookType)}>{(["payment.succeeded", "payment.failed", "payment.disputed", "payment.refunded"] as const).map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
          <Field name="Pago"><select aria-label="Pago del webhook" className={input} value={paymentRef} onChange={(event) => setPaymentRef(event.target.value)}><option value="">Elegir…</option>{state.payments.filter((payment) => payment.method === provider).map((payment) => <option key={payment.id} value={payment.id}>{payment.id}</option>)}</select></Field>
          <Field name="Firma"><select aria-label="Firma" className={input} value={signature} onChange={(event) => setSignature(event.target.value as "valid" | "invalid" | "missing")}><option value="valid">Válida</option><option value="invalid">Inválida</option><option value="missing">Ausente</option></select></Field>
          <Field name="Identificador"><input aria-label="Identificador del evento" className={input} value={eventId} onChange={(event) => setEventId(event.target.value)} /></Field>
        </div>
        <Button size="sm" variant="primary" onClick={send}>Enviar webhook simulado</Button>
      </Card>
      <Card className="space-y-2 p-5">
        <h2 className="font-semibold">Recibidos</h2>
        {recent.length === 0 ? <p className="text-xs text-ink-muted">Ninguno todavía.</p> : <ul className="space-y-1 text-xs text-ink-muted">{recent.map((entry, index) => <li key={`${entry.at}-${index}`}>{entry.action} · {entry.detail}</li>)}</ul>}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- 11-13. audit, logs, errors
export function ActivityTab({ state }: TabProps) {
  const feeds = [
    { title: "Auditoría", empty: "Sin cambios", rows: state.audit.map((entry) => `${entry.actor} · ${entry.action}${entry.detail ? ` · ${entry.detail}` : ""}`) },
    { title: "Registros", empty: "Sin registros", rows: state.logs.map((entry) => `${entry.level.toUpperCase()} · ${entry.event}`) },
    { title: "Errores", empty: "Sin errores", rows: state.errors.map((entry) => `${entry.kind} · ${entry.message}${entry.retryable ? " (reintentable)" : ""}`) },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {feeds.map((feed) => (
        <Card key={feed.title} className="space-y-2 p-5">
          <h2 className="font-semibold">{feed.title}</h2>
          {feed.rows.length === 0 ? <p className="text-xs text-ink-muted">{feed.empty}</p> : <ul className="max-h-80 space-y-1 overflow-auto text-xs text-ink-muted">{feed.rows.slice(-40).reverse().map((row, index) => <li key={`${row}-${index}`}>{row}</li>)}</ul>}
        </Card>
      ))}
    </div>
  );
}
