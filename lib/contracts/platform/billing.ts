// Subscriptions and invoices for the Payments Center: pure state machines, no provider involved.

import { isMoney, type Money } from "./payments";

// ---------------------------------------------------------------- dates
export function addInterval(iso: string, interval: "month" | "year", count = 1): string {
  const date = new Date(iso);
  const day = date.getUTCDate();
  const months = interval === "year" ? 12 * count : count;
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay)); // Jan 31 + 1 month is Feb 28/29, never March
  return target.toISOString();
}

export const addDays = (iso: string, days: number): string => new Date(Date.parse(iso) + days * 86_400_000).toISOString();

// ---------------------------------------------------------------- subscriptions
export const SUBSCRIPTION_STATUSES = ["incomplete", "trialing", "active", "pastDue", "paused", "cancelled"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const MAX_FAILED_ATTEMPTS = 3;

export type Subscription = {
  id: string;
  customerId: string;
  planName: string;
  amount: Money;
  interval: "month" | "year";
  status: SubscriptionStatus;
  startedAt: string;
  nextBillingAt: string;
  failedAttempts: number;
  cancelAtPeriodEnd: boolean;
  cancelledAt?: string;
  cancelReason?: "customer" | "unpaid";
};

export type SubscriptionDraft = { customerId: string; planName: string; amount: Money; interval: "month" | "year"; startedAt: string; trialDays?: number };

export function createSubscription(id: string, draft: SubscriptionDraft): { subscription?: Subscription; error?: string } {
  if (draft.planName.trim() === "" || draft.customerId.trim() === "") return { error: "Cliente y plan son obligatorios" };
  if (!isMoney(draft.amount) || draft.amount.amountMinor === 0) return { error: "El importe debe ser positivo" };
  if (draft.trialDays !== undefined && (!Number.isInteger(draft.trialDays) || draft.trialDays < 0 || draft.trialDays > 90)) return { error: "La prueba va de 0 a 90 días" };
  const trial = (draft.trialDays ?? 0) > 0;
  return {
    subscription: {
      id, customerId: draft.customerId, planName: draft.planName, amount: draft.amount, interval: draft.interval,
      status: trial ? "trialing" : "incomplete", startedAt: draft.startedAt,
      nextBillingAt: trial ? addDays(draft.startedAt, draft.trialDays ?? 0) : draft.startedAt,
      failedAttempts: 0, cancelAtPeriodEnd: false,
    },
  };
}

export type SubscriptionEvent =
  | { type: "chargeSucceeded"; at: string }
  | { type: "chargeFailed"; at: string }
  | { type: "pause"; at: string }
  | { type: "resume"; at: string }
  | { type: "cancel"; at: string; atPeriodEnd: boolean }
  | { type: "tick"; at: string };

export type SubscriptionResult = { subscription: Subscription; error?: string };

export function reduceSubscription(sub: Subscription, event: SubscriptionEvent): SubscriptionResult {
  const refuse = (error: string): SubscriptionResult => ({ subscription: sub, error });
  if (sub.status === "cancelled") return refuse("La suscripción está cancelada.");
  switch (event.type) {
    case "chargeSucceeded":
      if (sub.status === "paused") return refuse("La suscripción está en pausa.");
      return { subscription: { ...sub, status: "active", failedAttempts: 0, nextBillingAt: addInterval(event.at, sub.interval) } };
    case "chargeFailed": {
      if (sub.status === "paused") return refuse("La suscripción está en pausa.");
      const failedAttempts = sub.failedAttempts + 1;
      if (failedAttempts >= MAX_FAILED_ATTEMPTS) return { subscription: { ...sub, failedAttempts, status: "cancelled", cancelledAt: event.at, cancelReason: "unpaid" } };
      return { subscription: { ...sub, failedAttempts, status: sub.status === "incomplete" ? "incomplete" : "pastDue" } };
    }
    case "pause":
      return sub.status === "active" ? { subscription: { ...sub, status: "paused" } } : refuse("Solo una suscripción activa puede pausarse.");
    case "resume":
      return sub.status === "paused" ? { subscription: { ...sub, status: "active" } } : refuse("La suscripción no está en pausa.");
    case "cancel":
      return event.atPeriodEnd
        ? { subscription: { ...sub, cancelAtPeriodEnd: true } }
        : { subscription: { ...sub, status: "cancelled", cancelledAt: event.at, cancelReason: "customer" } };
    case "tick":
      return sub.cancelAtPeriodEnd && Date.parse(event.at) >= Date.parse(sub.nextBillingAt)
        ? { subscription: { ...sub, status: "cancelled", cancelledAt: event.at, cancelReason: "customer" } }
        : { subscription: sub };
  }
}

/** Monthly recurring revenue of one subscription in its own currency (a yearly plan counts a twelfth, rounded down). */
export const monthlyEquivalent = (sub: Subscription): Money => ({ amountMinor: sub.interval === "month" ? sub.amount.amountMinor : Math.floor(sub.amount.amountMinor / 12), currency: sub.amount.currency });
export const countsAsRecurring = (sub: Subscription): boolean => sub.status === "active" || sub.status === "pastDue";

// ---------------------------------------------------------------- invoices
export const INVOICE_STATUSES = ["draft", "open", "paid", "void", "uncollectible"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export type InvoiceLine = { description: string; quantity: number; unitMinor: number };

export type Invoice = {
  id: string;
  number: string;
  customerId: string;
  currency: string;
  lines: readonly InvoiceLine[];
  taxBps: number;
  status: InvoiceStatus;
  createdAt: string;
  issuedAt?: string;
  dueAt?: string;
  paidAt?: string;
  paymentId?: string;
};

export function invoiceTotals(lines: readonly InvoiceLine[], taxBps: number): { subtotal: number; tax: number; total: number } {
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitMinor, 0);
  const tax = Math.round((subtotal * taxBps) / 10_000);
  return { subtotal, tax, total: subtotal + tax };
}

export function validateInvoiceDraft(input: { customerId: string; currency: string; lines: readonly InvoiceLine[]; taxBps: number }): string[] {
  const issues: string[] = [];
  if (input.customerId.trim() === "") issues.push("El cliente es obligatorio");
  if (!/^[A-Z]{3,5}$/.test(input.currency)) issues.push("Moneda no válida");
  if (input.lines.length === 0) issues.push("Agregue al menos una línea");
  for (const line of input.lines) {
    if (line.description.trim() === "") issues.push("Cada línea necesita descripción");
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) issues.push("La cantidad debe ser un entero positivo");
    if (!Number.isSafeInteger(line.unitMinor) || line.unitMinor < 0) issues.push("El precio debe ser un entero no negativo");
  }
  if (!Number.isInteger(input.taxBps) || input.taxBps < 0 || input.taxBps > 10_000) issues.push("El impuesto va de 0 a 10 000 puntos base");
  return [...new Set(issues)];
}

/** INV-000001, INV-000002… one more than the highest existing number. */
export function nextInvoiceNumber(existing: readonly string[]): string {
  const highest = existing.reduce((max, number) => {
    const match = /^INV-(\d{6})$/.exec(number);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `INV-${String(highest + 1).padStart(6, "0")}`;
}

export const isOverdue = (invoice: Invoice, now: Date): boolean => invoice.status === "open" && invoice.dueAt !== undefined && Date.parse(invoice.dueAt) < now.getTime();

export type InvoiceEvent =
  | { type: "issue"; at: string; dueAt: string }
  | { type: "pay"; at: string; paymentId: string; paid: Money }
  | { type: "void"; at: string }
  | { type: "uncollectible"; at: string };

export type InvoiceResult = { invoice: Invoice; error?: string };

export function reduceInvoice(invoice: Invoice, event: InvoiceEvent): InvoiceResult {
  const refuse = (error: string): InvoiceResult => ({ invoice, error });
  switch (event.type) {
    case "issue": {
      if (invoice.status !== "draft") return refuse("Solo un borrador puede emitirse.");
      if (invoiceTotals(invoice.lines, invoice.taxBps).total <= 0) return refuse("La factura no tiene importe.");
      if (Number.isNaN(Date.parse(event.dueAt)) || Date.parse(event.dueAt) < Date.parse(event.at)) return refuse("El vencimiento no puede ser anterior a la emisión.");
      return { invoice: { ...invoice, status: "open", issuedAt: event.at, dueAt: event.dueAt } };
    }
    case "pay": {
      if (invoice.status !== "open") return refuse("Solo una factura abierta puede pagarse.");
      const { total } = invoiceTotals(invoice.lines, invoice.taxBps);
      if (event.paid.currency !== invoice.currency || event.paid.amountMinor !== total) return refuse("El pago no coincide con el total de la factura.");
      return { invoice: { ...invoice, status: "paid", paidAt: event.at, paymentId: event.paymentId } };
    }
    case "void":
      return invoice.status === "draft" || invoice.status === "open" ? { invoice: { ...invoice, status: "void" } } : refuse("Esta factura ya no puede anularse.");
    case "uncollectible":
      return isOverdue(invoice, new Date(event.at)) ? { invoice: { ...invoice, status: "uncollectible" } } : refuse("Solo una factura vencida puede marcarse incobrable.");
  }
}
