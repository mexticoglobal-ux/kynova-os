// The Payments Center store: one state and one reducer for payment methods, payments, refunds, webhooks, reconciliation,
// subscriptions and invoices. Pure and deterministic (time and ids come in with each event). No provider is contacted:
// a future adapter produces the same events (webhook, statement import) that the local simulation produces today.

import {
  invoiceTotals, createSubscription, monthlyEquivalent, countsAsRecurring, isOverdue, nextInvoiceNumber, reduceInvoice, reduceSubscription, validateInvoiceDraft,
  type Invoice, type InvoiceEvent, type InvoiceLine, type Subscription, type SubscriptionDraft, type SubscriptionEvent,
} from "./billing";
import { newConnection, reduce as reduceConnection, type Connection, type ConnectionAudit, type ConnectionError, type ConnectionEvent, type ConnectionLog, type ErrorKind } from "./connection";
import { CURRENCIES, isCurrency, sumByCurrency, totalIn, type CurrencyCode, type FxRate } from "./currency";
import { PROVIDER_MANIFESTS, type ProviderId } from "./integrations";
import { canTransitionPayment, isMoney, matchTransfer, type MatchResult, type Money, type PaymentStatus } from "./payments";

// ---------------------------------------------------------------- methods
export const PAYMENT_METHODS = ["stripe", "paypal", "makapay", "makawallet", "sinpe", "bankTransfer", "crypto"] as const satisfies readonly ProviderId[];
export type PaymentMethodId = (typeof PAYMENT_METHODS)[number];

// What each method may carry. Crypto is reserved and cannot be activated yet, so its list only documents intent.
export const METHOD_CURRENCIES: Record<PaymentMethodId, readonly CurrencyCode[]> = {
  stripe: ["USD", "EUR", "MXN", "CRC", "JPY"],
  paypal: ["USD", "EUR", "MXN"],
  makapay: ["CRC", "USD"],
  makawallet: ["CRC", "USD"],
  sinpe: ["CRC"],
  bankTransfer: ["USD", "EUR", "CRC", "MXN", "JPY"],
  crypto: ["BTC", "USDC"],
};

/** Methods that charge through a provider and confirm by webhook. The rest are confirmed by a person (reconciliation). */
export const confirmsByWebhook = (method: PaymentMethodId): boolean => PROVIDER_MANIFESTS[method].capabilities.includes("createCharge");

// ---------------------------------------------------------------- records
export type Refund = {
  id: string;
  amount: Money;
  reason: string;
  status: "requested" | "completed" | "rejected";
  requestedBy: string;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
};

export type PaymentRecord = {
  id: string;
  method: PaymentMethodId;
  providerRef?: string;
  amount: Money;
  status: PaymentStatus;
  customerId?: string;
  reference?: string;
  invoiceId?: string;
  subscriptionId?: string;
  createdAt: string;
  paidAt?: string;
  refunds: readonly Refund[];
};

export type StatementLine = { id: string; method: PaymentMethodId; amount: Money; reference?: string; payerName?: string; receivedAt: string; status: "open" | "matched" | "ignored"; paymentId?: string };
export type StatementInput = Omit<StatementLine, "id" | "status" | "paymentId">;

export type WebhookType = "payment.succeeded" | "payment.failed" | "payment.disputed" | "payment.refunded";
// Architecture only: what a verified provider notification looks like once an adapter has normalized it.
export type WebhookEnvelope = { provider: PaymentMethodId; eventId: string; type: WebhookType; paymentRef: string; signature: "valid" | "invalid" | "missing"; receivedAt: string };

export type CenterAudit = { at: string; actor: string; action: string; detail?: string };

export type PaymentsState = {
  connections: Record<PaymentMethodId, Connection>;
  payments: readonly PaymentRecord[];
  subscriptions: readonly Subscription[];
  invoices: readonly Invoice[];
  statement: readonly StatementLine[];
  seenWebhooks: readonly string[];
  logs: readonly ConnectionLog[];
  errors: readonly ConnectionError[];
  audit: readonly CenterAudit[];
  sequence: number;
};

export const newPaymentsState = (): PaymentsState => ({
  connections: Object.fromEntries(PAYMENT_METHODS.map((method) => [method, newConnection(method)])) as Record<PaymentMethodId, Connection>,
  payments: [], subscriptions: [], invoices: [], statement: [], seenWebhooks: [], logs: [], errors: [], audit: [], sequence: 0,
});

// ---------------------------------------------------------------- events
export type PaymentsEvent =
  | { type: "connection"; method: PaymentMethodId; event: ConnectionEvent }
  | { type: "payment.create"; actor: string; at: string; method: PaymentMethodId; amount: Money; customerId?: string; reference?: string; invoiceId?: string; subscriptionId?: string }
  | { type: "payment.paid"; actor: string; at: string; paymentId: string; source: "reconciliation" | "manual" }
  | { type: "payment.fail"; actor: string; at: string; paymentId: string; message: string }
  | { type: "refund.request"; actor: string; at: string; paymentId: string; amount: Money; reason: string }
  | { type: "refund.decide"; actor: string; at: string; paymentId: string; refundId: string; approve: boolean }
  | { type: "webhook"; envelope: WebhookEnvelope }
  | { type: "statement.import"; actor: string; at: string; method: PaymentMethodId; lines: readonly StatementInput[] }
  | { type: "reconcile.confirm"; actor: string; at: string; lineId: string; paymentId: string }
  | { type: "reconcile.ignore"; actor: string; at: string; lineId: string }
  | { type: "subscription.create"; actor: string; at: string; draft: SubscriptionDraft }
  | { type: "subscription.event"; actor: string; subscriptionId: string; event: SubscriptionEvent }
  | { type: "invoice.create"; actor: string; at: string; customerId: string; currency: string; lines: readonly InvoiceLine[]; taxBps: number }
  | { type: "invoice.event"; actor: string; invoiceId: string; event: InvoiceEvent };

export type StoreResult = { state: PaymentsState; error?: string };

// ---------------------------------------------------------------- helpers
// Records, logs and the audit trail are never trimmed. Any limit belongs to the view (display.ts).
const append = <T,>(items: readonly T[], item: T): readonly T[] => [...items, item];
const label = (method: PaymentMethodId) => PROVIDER_MANIFESTS[method].label;
const refundedMinor = (payment: PaymentRecord) => payment.refunds.filter((refund) => refund.status === "completed").reduce((sum, refund) => sum + refund.amount.amountMinor, 0);
const reservedMinor = (payment: PaymentRecord) => payment.refunds.filter((refund) => refund.status !== "rejected").reduce((sum, refund) => sum + refund.amount.amountMinor, 0);

const note = (state: PaymentsState, at: string, actor: string, action: string, detail?: string, level: ConnectionLog["level"] = "info"): PaymentsState => ({
  ...state,
  audit: append(state.audit, { at, actor, action, detail }),
  logs: append(state.logs, { at, level, event: detail ? `${action}: ${detail}` : action }),
});
const problem = (state: PaymentsState, at: string, kind: ErrorKind, message: string): PaymentsState => ({
  ...state,
  errors: append(state.errors, { at, kind, message, retryable: kind === "provider" || kind === "network" || kind === "rateLimit" }),
  logs: append(state.logs, { at, level: "error", event: message }),
});
const nextId = (state: PaymentsState, prefix: string): { id: string; state: PaymentsState } => {
  const sequence = state.sequence + 1;
  return { id: `${prefix}_${String(sequence).padStart(4, "0")}`, state: { ...state, sequence } };
};
const replacePayment = (state: PaymentsState, payment: PaymentRecord): PaymentsState => ({ ...state, payments: state.payments.map((item) => (item.id === payment.id ? payment : item)) });
const isLive = (connection: Connection) => connection.enabled && (connection.status === "active" || connection.status === "degraded");

/** A payment changed status: its subscription and invoice follow. A mismatch is logged, never forced. */
function afterPayment(state: PaymentsState, payment: PaymentRecord, at: string): PaymentsState {
  let next = state;
  if (payment.subscriptionId) {
    const sub = next.subscriptions.find((item) => item.id === payment.subscriptionId);
    const event: SubscriptionEvent | null = payment.status === "succeeded" ? { type: "chargeSucceeded", at } : payment.status === "failed" ? { type: "chargeFailed", at } : null;
    if (sub && event) {
      const result = reduceSubscription(sub, event);
      next = { ...next, subscriptions: next.subscriptions.map((item) => (item.id === sub.id ? result.subscription : item)) };
      if (result.error) next = note(next, at, "system", "subscription", result.error, "warn");
    }
  }
  if (payment.invoiceId && payment.status === "succeeded") {
    const invoice = next.invoices.find((item) => item.id === payment.invoiceId);
    if (invoice) {
      const result = reduceInvoice(invoice, { type: "pay", at, paymentId: payment.id, paid: payment.amount });
      next = { ...next, invoices: next.invoices.map((item) => (item.id === invoice.id ? result.invoice : item)) };
      if (result.error) next = note(next, at, "system", "invoice", result.error, "warn");
    }
  }
  return next;
}

function settle(state: PaymentsState, payment: PaymentRecord, status: PaymentStatus, at: string): StoreResult {
  if (!canTransitionPayment(payment.status, status)) return { state, error: `Un pago ${payment.status} no puede pasar a ${status}.` };
  const updated = { ...payment, status, paidAt: status === "succeeded" ? at : payment.paidAt };
  return { state: afterPayment(replacePayment(state, updated), updated, at) };
}

// ---------------------------------------------------------------- the reducer
export function reducePayments(state: PaymentsState, event: PaymentsEvent): StoreResult {
  const refuse = (error: string): StoreResult => ({ state, error });

  switch (event.type) {
    case "connection": {
      const result = reduceConnection(state.connections[event.method], event.event);
      const next = { ...state, connections: { ...state.connections, [event.method]: result.connection } };
      return result.error ? { state, error: result.error } : { state: next };
    }

    case "payment.create": {
      const connection = state.connections[event.method];
      if (!connection || !isLive(connection)) return refuse(`${label(event.method)} no está activo.`);
      if (!isMoney(event.amount) || event.amount.amountMinor === 0) return refuse("El monto debe ser un entero positivo en unidades menores.");
      if (!isCurrency(event.amount.currency)) return refuse(`Moneda no soportada: ${event.amount.currency}.`);
      if (!METHOD_CURRENCIES[event.method].includes(event.amount.currency)) return refuse(`${label(event.method)} no admite ${event.amount.currency}.`);
      if (confirmsByWebhook(event.method) && (connection.permissions.createCharge ?? "off") === "off") return refuse("El permiso para crear cobros está apagado.");
      if (event.invoiceId && !state.invoices.some((invoice) => invoice.id === event.invoiceId)) return refuse("La factura no existe.");
      if (event.subscriptionId && !state.subscriptions.some((sub) => sub.id === event.subscriptionId)) return refuse("La suscripción no existe.");
      const { id, state: sequenced } = nextId(state, "pay");
      const payment: PaymentRecord = { id, method: event.method, amount: event.amount, status: "pending", customerId: event.customerId, reference: event.reference ?? id.toUpperCase(), invoiceId: event.invoiceId, subscriptionId: event.subscriptionId, createdAt: event.at, refunds: [] };
      return { state: note({ ...sequenced, payments: append(sequenced.payments, payment) }, event.at, event.actor, "payment.create", `${id} · ${label(event.method)}`) };
    }

    case "payment.paid": {
      const payment = state.payments.find((item) => item.id === event.paymentId);
      if (!payment) return refuse("El pago no existe.");
      if (confirmsByWebhook(payment.method)) return refuse(`${label(payment.method)} confirma sus pagos por webhook, no a mano.`);
      const result = settle(state, payment, "succeeded", event.at);
      return result.error ? result : { state: note(result.state, event.at, event.actor, "payment.paid", `${payment.id} · ${event.source}`) };
    }

    case "payment.fail": {
      const payment = state.payments.find((item) => item.id === event.paymentId);
      if (!payment) return refuse("El pago no existe.");
      const result = settle(state, payment, "failed", event.at);
      return result.error ? result : { state: note(result.state, event.at, event.actor, "payment.fail", `${payment.id} · ${event.message}`, ) };
    }

    case "refund.request": {
      const payment = state.payments.find((item) => item.id === event.paymentId);
      if (!payment) return refuse("El pago no existe.");
      if (!PROVIDER_MANIFESTS[payment.method].capabilities.includes("refund")) return refuse(`${label(payment.method)} no ofrece reembolsos desde la plataforma.`);
      if ((state.connections[payment.method].permissions.refund ?? "off") === "off") return refuse("El permiso de reembolsos está apagado.");
      if (payment.status !== "succeeded" && payment.status !== "partiallyRefunded") return refuse("Solo un pago cobrado puede reembolsarse.");
      if (!isMoney(event.amount) || event.amount.amountMinor === 0 || event.amount.currency !== payment.amount.currency) return refuse("El reembolso debe ser positivo y en la moneda del pago.");
      if (reservedMinor(payment) + event.amount.amountMinor > payment.amount.amountMinor) return refuse("Los reembolsos no pueden superar lo cobrado.");
      if (event.reason.trim() === "") return refuse("Indique el motivo del reembolso.");
      const { id, state: sequenced } = nextId(state, "ref");
      const refund: Refund = { id, amount: event.amount, reason: event.reason, status: "requested", requestedBy: event.actor, requestedAt: event.at };
      return { state: note(replacePayment(sequenced, { ...payment, refunds: [...payment.refunds, refund] }), event.at, event.actor, "refund.request", `${id} · ${payment.id}`) };
    }

    case "refund.decide": {
      const payment = state.payments.find((item) => item.id === event.paymentId);
      const refund = payment?.refunds.find((item) => item.id === event.refundId);
      if (!payment || !refund) return refuse("El reembolso no existe.");
      if (refund.status !== "requested") return refuse("Este reembolso ya fue resuelto.");
      if (event.approve && event.actor === refund.requestedBy) return refuse("Quien solicita un reembolso no puede aprobarlo.");
      const decided: Refund = { ...refund, status: event.approve ? "completed" : "rejected", decidedBy: event.actor, decidedAt: event.at };
      let updated: PaymentRecord = { ...payment, refunds: payment.refunds.map((item) => (item.id === refund.id ? decided : item)) };
      if (event.approve) {
        const status: PaymentStatus = refundedMinor(updated) === payment.amount.amountMinor ? "refunded" : "partiallyRefunded";
        if (!canTransitionPayment(payment.status, status)) return refuse("El pago no admite este reembolso en su estado actual.");
        updated = { ...updated, status };
      }
      return { state: note(replacePayment(state, updated), event.at, event.actor, event.approve ? "refund.approve" : "refund.reject", `${refund.id} · ${payment.id}`) };
    }

    case "webhook": {
      const { envelope } = event;
      const at = envelope.receivedAt;
      const manifest = PROVIDER_MANIFESTS[envelope.provider];
      if (manifest.webhook !== "signedHmac" && manifest.webhook !== "providerVerified") return refuse(`${manifest.label} no emite webhooks.`);
      if (envelope.signature !== "valid") return { state: problem(note(state, at, "system", "webhook.rejected", `${envelope.eventId} · firma ${envelope.signature}`, "warn"), at, "auth", `Webhook rechazado: firma ${envelope.signature}`) };
      if (!isLive(state.connections[envelope.provider])) return { state: problem(state, at, "config", `Webhook de ${manifest.label} recibido con el método inactivo`) };
      const dedupKey = `${envelope.provider}:${envelope.eventId}`;
      if (state.seenWebhooks.includes(dedupKey)) return { state: note(state, at, "system", "webhook.duplicate", envelope.eventId) }; // idempotent
      const seen = { ...state, seenWebhooks: append(state.seenWebhooks, dedupKey) };
      const payment = seen.payments.find((item) => item.method === envelope.provider && (item.id === envelope.paymentRef || item.providerRef === envelope.paymentRef));
      if (!payment) return { state: problem(seen, at, "provider", `Webhook ${envelope.eventId}: pago desconocido (${envelope.paymentRef})`) };
      const target: PaymentStatus = { "payment.succeeded": "succeeded", "payment.failed": "failed", "payment.disputed": "disputed", "payment.refunded": "refunded" }[envelope.type] as PaymentStatus;
      if (payment.status === target) return { state: note(seen, at, "system", "webhook.nochange", envelope.eventId) };
      if (!canTransitionPayment(payment.status, target)) return { state: note(seen, at, "system", "webhook.outOfOrder", `${envelope.eventId} · ${payment.status} → ${target}`, "warn") };
      let updated: PaymentRecord = { ...payment, status: target, paidAt: target === "succeeded" ? at : payment.paidAt };
      if (target === "refunded") {
        const remaining = payment.amount.amountMinor - refundedMinor(payment);
        const closed = payment.refunds.map((refund) => (refund.status === "requested" ? { ...refund, status: "rejected" as const } : refund));
        const { id, state: sequenced } = nextId(seen, "ref");
        updated = { ...updated, refunds: [...closed, { id, amount: { amountMinor: remaining, currency: payment.amount.currency }, reason: "Reembolso notificado por el proveedor", status: "completed", requestedBy: "provider", requestedAt: at, decidedBy: "provider", decidedAt: at }] };
        return { state: note(afterPayment(replacePayment(sequenced, updated), updated, at), at, "system", `webhook.${envelope.type}`, `${envelope.eventId} · ${payment.id}`) };
      }
      return { state: note(afterPayment(replacePayment(seen, updated), updated, at), at, "system", `webhook.${envelope.type}`, `${envelope.eventId} · ${payment.id}`) };
    }

    case "statement.import": {
      const connection = state.connections[event.method];
      if (!connection || !isLive(connection)) return refuse(`${label(event.method)} no está activo.`);
      if (confirmsByWebhook(event.method)) return refuse(`${label(event.method)} no usa extractos: concilia por webhook.`);
      let next = state;
      let added = 0;
      for (const line of event.lines) {
        if (!isMoney(line.amount) || line.amount.amountMinor === 0) return refuse("Una línea del extracto tiene un monto inválido.");
        const duplicate = next.statement.some((item) => item.method === event.method && item.amount.amountMinor === line.amount.amountMinor && item.amount.currency === line.amount.currency && item.receivedAt === line.receivedAt && (item.reference ?? "") === (line.reference ?? ""));
        if (duplicate) continue; // importing the same statement twice changes nothing
        const { id, state: sequenced } = nextId(next, "line");
        next = { ...sequenced, statement: append(sequenced.statement, { ...line, id, status: "open" }) };
        added += 1;
      }
      return { state: note(next, event.at, event.actor, "statement.import", `${added} de ${event.lines.length} líneas nuevas`) };
    }

    case "reconcile.confirm": {
      const line = state.statement.find((item) => item.id === event.lineId);
      const payment = state.payments.find((item) => item.id === event.paymentId);
      if (!line || !payment) return refuse("La línea o el pago no existen.");
      if (line.status !== "open") return refuse("Esta línea ya fue resuelta.");
      if (payment.method !== line.method) return refuse("La línea y el pago son de métodos distintos.");
      if (payment.amount.currency !== line.amount.currency || payment.amount.amountMinor !== line.amount.amountMinor) return refuse("El monto de la línea no coincide con el del pago.");
      const result = settle(state, payment, "succeeded", event.at);
      if (result.error) return result;
      const matched = { ...result.state, statement: result.state.statement.map((item) => (item.id === line.id ? { ...item, status: "matched" as const, paymentId: payment.id } : item)) };
      return { state: note(matched, event.at, event.actor, "reconcile.confirm", `${line.id} ↔ ${payment.id}`) };
    }

    case "reconcile.ignore": {
      const line = state.statement.find((item) => item.id === event.lineId);
      if (!line || line.status !== "open") return refuse("La línea no existe o ya fue resuelta.");
      return { state: note({ ...state, statement: state.statement.map((item) => (item.id === line.id ? { ...item, status: "ignored" as const } : item)) }, event.at, event.actor, "reconcile.ignore", line.id) };
    }

    case "subscription.create": {
      const { id, state: sequenced } = nextId(state, "sub");
      const result = createSubscription(id, event.draft);
      if (!result.subscription) return refuse(result.error ?? "Suscripción inválida.");
      if (!isCurrency(result.subscription.amount.currency)) return refuse("Moneda no soportada.");
      return { state: note({ ...sequenced, subscriptions: append(sequenced.subscriptions, result.subscription) }, event.at, event.actor, "subscription.create", id) };
    }

    case "subscription.event": {
      const sub = state.subscriptions.find((item) => item.id === event.subscriptionId);
      if (!sub) return refuse("La suscripción no existe.");
      const result = reduceSubscription(sub, event.event);
      if (result.error) return refuse(result.error);
      return { state: note({ ...state, subscriptions: state.subscriptions.map((item) => (item.id === sub.id ? result.subscription : item)) }, event.event.at, event.actor, `subscription.${event.event.type}`, sub.id) };
    }

    case "invoice.create": {
      const issues = validateInvoiceDraft(event);
      if (issues.length) return refuse(issues[0]);
      const { id, state: sequenced } = nextId(state, "inv");
      const invoice: Invoice = { id, number: nextInvoiceNumber(sequenced.invoices.map((item) => item.number)), customerId: event.customerId, currency: event.currency, lines: event.lines, taxBps: event.taxBps, status: "draft", createdAt: event.at };
      return { state: note({ ...sequenced, invoices: append(sequenced.invoices, invoice) }, event.at, event.actor, "invoice.create", invoice.number) };
    }

    case "invoice.event": {
      const invoice = state.invoices.find((item) => item.id === event.invoiceId);
      if (!invoice) return refuse("La factura no existe.");
      const result = reduceInvoice(invoice, event.event);
      if (result.error) return refuse(result.error);
      return { state: note({ ...state, invoices: state.invoices.map((item) => (item.id === invoice.id ? result.invoice : item)) }, event.event.at, event.actor, `invoice.${event.event.type}`, invoice.number) };
    }
  }
}

/** Applies events in order, collecting the refusals instead of stopping at the first one. */
export function applyAll(state: PaymentsState, events: readonly PaymentsEvent[]): { state: PaymentsState; errors: string[] } {
  const errors: string[] = [];
  let current = state;
  for (const event of events) {
    const result = reducePayments(current, event);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    current = result.state;
  }
  return { state: current, errors };
}

// ---------------------------------------------------------------- reconciliation view
export type Suggestion = { line: StatementLine; match: MatchResult };

/** For each open statement line: the matching open payment, if the match is unambiguous. A person always confirms. */
export function suggestMatches(state: PaymentsState): Suggestion[] {
  return state.statement
    .filter((line) => line.status === "open")
    .map((line) => {
      const open = state.payments
        .filter((payment) => payment.method === line.method && payment.status === "pending")
        .map((payment) => ({ paymentId: payment.id, expected: payment.amount, reference: payment.reference, payerName: payment.customerId }));
      return { line, match: matchTransfer({ amount: line.amount, reference: line.reference, payerName: line.payerName, receivedAt: line.receivedAt }, open) };
    });
}

// ---------------------------------------------------------------- dashboard
export type FinancialSummary = {
  collected: Record<string, number>; // net of completed refunds
  pending: Record<string, number>;
  refunded: Record<string, number>;
  recurringMonthly: Record<string, number>;
  overdue: Record<string, number>;
  counts: { payments: number; failed: number; disputed: number; refundsToApprove: number; overdueInvoices: number; activeSubscriptions: number; openStatementLines: number };
  reporting: { currency: CurrencyCode; collected: Money; recurringMonthly: Money; missingRates: string[] };
};

export function summarize(state: PaymentsState, reporting: CurrencyCode, rates: readonly FxRate[], now: Date): FinancialSummary {
  const collectedAmounts: Money[] = [];
  const pendingAmounts: Money[] = [];
  const refundedAmounts: Money[] = [];
  for (const payment of state.payments) {
    const refunded = refundedMinor(payment);
    if (refunded > 0) refundedAmounts.push({ amountMinor: refunded, currency: payment.amount.currency });
    if (payment.status === "succeeded" || payment.status === "partiallyRefunded") collectedAmounts.push({ amountMinor: payment.amount.amountMinor - refunded, currency: payment.amount.currency });
    else if (payment.status === "pending") pendingAmounts.push(payment.amount);
  }
  const recurring = state.subscriptions.filter(countsAsRecurring).map(monthlyEquivalent);
  const overdueInvoices = state.invoices.filter((invoice) => isOverdue(invoice, now));
  const overdueAmounts = overdueInvoices.map((invoice) => ({ amountMinor: invoiceTotals(invoice.lines, invoice.taxBps).total, currency: invoice.currency }));

  const collectedTotal = totalIn(reporting, collectedAmounts, rates);
  const recurringTotal = totalIn(reporting, recurring, rates);
  return {
    collected: sumByCurrency(collectedAmounts),
    pending: sumByCurrency(pendingAmounts),
    refunded: sumByCurrency(refundedAmounts),
    recurringMonthly: sumByCurrency(recurring),
    overdue: sumByCurrency(overdueAmounts),
    counts: {
      payments: state.payments.length,
      failed: state.payments.filter((payment) => payment.status === "failed").length,
      disputed: state.payments.filter((payment) => payment.status === "disputed").length,
      refundsToApprove: state.payments.reduce((sum, payment) => sum + payment.refunds.filter((refund) => refund.status === "requested").length, 0),
      overdueInvoices: overdueInvoices.length,
      activeSubscriptions: state.subscriptions.filter((sub) => sub.status === "active").length,
      openStatementLines: state.statement.filter((line) => line.status === "open").length,
    },
    reporting: { currency: reporting, collected: collectedTotal.total, recurringMonthly: recurringTotal.total, missingRates: [...new Set([...collectedTotal.missing, ...recurringTotal.missing])].sort() },
  };
}

export const knownCurrencies = Object.keys(CURRENCIES) as CurrencyCode[];
export type { ConnectionAudit };
