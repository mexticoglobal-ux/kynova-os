// Sample data for the local simulation of the Payments Center. Fictional customers and amounts; every event goes through
// the same reducer a real adapter will use, so loading it also proves the rules hold together.

import type { PaymentsEvent } from "./ledger";

const at = "2026-11-01T10:00:00.000Z";
const actor = "demo";

const connect = (method: "stripe" | "sinpe" | "bankTransfer", config: Record<string, string>): PaymentsEvent[] => [
  { type: "connection", method, event: { type: "configure", actor, at, config } },
  { type: "connection", method, event: { type: "activate", actor, at } },
];

/** Ids are deterministic (one shared counter), so the events below can refer to the records they create. */
export function demoEvents(): PaymentsEvent[] {
  return [
    ...connect("stripe", { displayName: "Stripe (prueba)", mode: "test", credential: "secret:stripe-demo" }),
    { type: "connection", method: "stripe", event: { type: "setPermissions", actor, at, permissions: { createCharge: "approval", refund: "approval", receivePayments: "auto" } } },
    ...connect("sinpe", { displayName: "SINPE Móvil", reconciliation: "asistida" }),
    ...connect("bankTransfer", { displayName: "Cuenta en dólares", accountAlias: "Cuenta principal USD", reconciliation: "asistida" }),

    { type: "payment.create", actor, at, method: "stripe", amount: { amountMinor: 12_000, currency: "USD" }, customerId: "Clínica Vida", reference: "NOVA-0001" }, // pay_0001
    { type: "webhook", envelope: { provider: "stripe", eventId: "evt_demo_1", type: "payment.succeeded", paymentRef: "pay_0001", signature: "valid", receivedAt: at } },
    { type: "payment.create", actor, at, method: "stripe", amount: { amountMinor: 4_500, currency: "EUR" }, customerId: "Studio Norte", reference: "NOVA-0002" }, // pay_0002
    { type: "webhook", envelope: { provider: "stripe", eventId: "evt_demo_2", type: "payment.succeeded", paymentRef: "pay_0002", signature: "valid", receivedAt: at } },
    { type: "refund.request", actor: "demo-ops", at, paymentId: "pay_0002", amount: { amountMinor: 1_500, currency: "EUR" }, reason: "Servicio parcial no entregado" }, // ref_0003

    { type: "payment.create", actor, at, method: "sinpe", amount: { amountMinor: 7_500_000, currency: "CRC" }, customerId: "Café Aurora", reference: "NOVA-0003" }, // pay_0004
    { type: "statement.import", actor, at, method: "sinpe", lines: [{ method: "sinpe", amount: { amountMinor: 7_500_000, currency: "CRC" }, reference: "NOVA-0003", payerName: "Café Aurora", receivedAt: at }] }, // line_0005
    { type: "payment.create", actor, at, method: "bankTransfer", amount: { amountMinor: 90_000, currency: "USD" }, customerId: "Hotel Mar", reference: "NOVA-0004" }, // pay_0006
    { type: "statement.import", actor, at, method: "bankTransfer", lines: [{ method: "bankTransfer", amount: { amountMinor: 90_000, currency: "USD" }, payerName: "Hotel Mar S.A.", receivedAt: at }] }, // line_0007

    { type: "subscription.create", actor, at, draft: { customerId: "Clínica Vida", planName: "Plan Pro", amount: { amountMinor: 4_900, currency: "USD" }, interval: "month", startedAt: at } }, // sub_0008
    { type: "payment.create", actor, at, method: "stripe", amount: { amountMinor: 4_900, currency: "USD" }, customerId: "Clínica Vida", subscriptionId: "sub_0008" }, // pay_0009
    { type: "webhook", envelope: { provider: "stripe", eventId: "evt_demo_3", type: "payment.succeeded", paymentRef: "pay_0009", signature: "valid", receivedAt: at } },

    { type: "invoice.create", actor, at: "2026-09-15T10:00:00.000Z", customerId: "Nova Studio", currency: "USD", lines: [{ description: "Auditoría comercial", quantity: 2, unitMinor: 25_000 }], taxBps: 1_300 }, // inv_0010
    { type: "invoice.event", actor, invoiceId: "inv_0010", event: { type: "issue", at: "2026-09-15T10:00:00.000Z", dueAt: "2026-10-01T10:00:00.000Z" } },
  ];
}

/** Rates used only to total different currencies in one report. Illustrative, never used to settle. */
export const DEMO_RATES = [
  { from: "EUR", to: "USD", rate: 1.08 },
  { from: "USD", to: "CRC", rate: 510 },
] as const;
