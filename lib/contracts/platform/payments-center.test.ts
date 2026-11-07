import { describe, expect, it } from "vitest";
import { MAX_FAILED_ATTEMPTS, addInterval, createSubscription, invoiceTotals, isOverdue, monthlyEquivalent, nextInvoiceNumber, reduceInvoice, reduceSubscription, validateInvoiceDraft, type Invoice, type Subscription } from "./billing";
import { convertMinor, formatMinor, isCrypto, parseMajor, sumByCurrency, totalIn } from "./currency";
import { PROVIDER_MANIFESTS } from "./integrations";
import { METHOD_CURRENCIES, PAYMENT_METHODS, applyAll, newPaymentsState, reducePayments, suggestMatches, summarize, type PaymentsEvent } from "./ledger";
import { DEMO_RATES, demoEvents } from "./payments-demo";
import { DISPLAY_LIMIT, hiddenNote, latest } from "./display";

const at = "2026-11-02T10:00:00.000Z";
const actor = "u1";

const demo = () => {
  const result = applyAll(newPaymentsState(), demoEvents());
  expect(result.errors).toEqual([]);
  return result.state;
};

describe("currency", () => {
  it("knows decimals per currency and keeps crypto reserved", () => {
    expect(formatMinor({ amountMinor: 123_456, currency: "USD" }, "en-US")).toBe("1,234.56 USD");
    expect(formatMinor({ amountMinor: 1_500, currency: "JPY" }, "en-US")).toBe("1,500 JPY");
    expect(formatMinor({ amountMinor: 150_000_000, currency: "BTC" }, "en-US")).toBe("1.50000000 BTC");
    expect(isCrypto("BTC")).toBe(true);
    expect(isCrypto("USD")).toBe(false);
  });

  it("converts across decimals, by inverse rate, and refuses to guess", () => {
    const rates = [{ from: "USD", to: "JPY", rate: 150 }] as const;
    expect(convertMinor({ amountMinor: 1_000, currency: "USD" }, "JPY", rates)).toEqual({ amountMinor: 1_500, currency: "JPY" }); // $10.00 → ¥1,500
    expect(convertMinor({ amountMinor: 1_500, currency: "JPY" }, "USD", rates)).toEqual({ amountMinor: 1_000, currency: "USD" }); // inverse
    expect(convertMinor({ amountMinor: 5, currency: "EUR" }, "USD", rates)).toBeNull();
    expect(convertMinor({ amountMinor: 5, currency: "USD" }, "USD", [])).toEqual({ amountMinor: 5, currency: "USD" });
  });

  it("totals in one currency and names the ones it could not convert", () => {
    const result = totalIn("USD", [{ amountMinor: 100, currency: "USD" }, { amountMinor: 100, currency: "EUR" }, { amountMinor: 100, currency: "CRC" }], [{ from: "EUR", to: "USD", rate: 2 }]);
    expect(result).toEqual({ total: { amountMinor: 300, currency: "USD" }, missing: ["CRC"] });
    expect(sumByCurrency([{ amountMinor: 1, currency: "USD" }, { amountMinor: 2, currency: "USD" }, { amountMinor: 5, currency: "EUR" }])).toEqual({ USD: 3, EUR: 5 });
  });
});

describe("amount parsing", () => {
  it("turns typed amounts into minor units and rejects anything ambiguous", () => {
    expect(parseMajor("1234.50", "USD")).toBe(123_450);
    expect(parseMajor("1,234", "USD")).toBe(123_400);
    expect(parseMajor("0.5", "USD")).toBe(50);
    expect(parseMajor("1500", "JPY")).toBe(1_500);
    expect(parseMajor("1.5", "JPY")).toBeNull();
    expect(parseMajor("12.345", "USD")).toBeNull();
    expect(parseMajor("-5", "USD")).toBeNull();
    expect(parseMajor("abc", "USD")).toBeNull();
    expect(parseMajor("", "USD")).toBeNull();
    expect(parseMajor("0.00000001", "BTC")).toBe(1);
  });
});

describe("subscriptions", () => {
  const draft = { customerId: "c", planName: "Pro", amount: { amountMinor: 1_200, currency: "USD" }, interval: "month" as const, startedAt: "2026-01-31T10:00:00.000Z" };
  const fresh = (over: Partial<Subscription> = {}): Subscription => ({ ...(createSubscription("s1", draft).subscription as Subscription), ...over });

  it("adds months without spilling into the next one", () => {
    expect(addInterval("2026-01-31T10:00:00.000Z", "month")).toBe("2026-02-28T10:00:00.000Z");
    expect(addInterval("2028-01-31T10:00:00.000Z", "month")).toBe("2028-02-29T10:00:00.000Z");
    expect(addInterval("2026-11-15T10:00:00.000Z", "year")).toBe("2027-11-15T10:00:00.000Z");
  });

  it("starts incomplete (or trialing) and becomes active on the first charge", () => {
    expect(fresh().status).toBe("incomplete");
    expect(createSubscription("s", { ...draft, trialDays: 14 }).subscription?.status).toBe("trialing");
    expect(createSubscription("s", { ...draft, trialDays: 500 }).error).toBeDefined();
    expect(createSubscription("s", { ...draft, amount: { amountMinor: 0, currency: "USD" } }).error).toBeDefined();
    const paid = reduceSubscription(fresh(), { type: "chargeSucceeded", at: "2026-02-01T00:00:00.000Z" }).subscription;
    expect(paid).toMatchObject({ status: "active", failedAttempts: 0, nextBillingAt: "2026-03-01T00:00:00.000Z" });
  });

  it("goes past due on a failed charge and cancels after repeated failures", () => {
    let sub = reduceSubscription(fresh(), { type: "chargeSucceeded", at }).subscription;
    sub = reduceSubscription(sub, { type: "chargeFailed", at }).subscription;
    expect(sub.status).toBe("pastDue");
    for (let attempt = 1; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) sub = reduceSubscription(sub, { type: "chargeFailed", at }).subscription;
    expect(sub).toMatchObject({ status: "cancelled", cancelReason: "unpaid" });
    expect(reduceSubscription(sub, { type: "chargeSucceeded", at }).error).toContain("cancelada");
  });

  it("pauses, resumes and cancels at the end of the period", () => {
    const active = reduceSubscription(fresh(), { type: "chargeSucceeded", at }).subscription;
    const paused = reduceSubscription(active, { type: "pause", at }).subscription;
    expect(paused.status).toBe("paused");
    expect(reduceSubscription(paused, { type: "chargeSucceeded", at }).error).toBeDefined();
    expect(reduceSubscription(paused, { type: "resume", at }).subscription.status).toBe("active");
    const ending = reduceSubscription(active, { type: "cancel", at, atPeriodEnd: true }).subscription;
    expect(ending.status).toBe("active");
    expect(reduceSubscription(ending, { type: "tick", at: active.nextBillingAt }).subscription.status).toBe("cancelled");
    expect(reduceSubscription(active, { type: "pause", at }).error).toBeUndefined();
  });

  it("counts a yearly plan as a twelfth per month, rounded down", () => {
    expect(monthlyEquivalent(fresh({ interval: "year", amount: { amountMinor: 10_000, currency: "USD" } })).amountMinor).toBe(833);
  });
});

describe("invoices", () => {
  const lines = [{ description: "Auditoría", quantity: 2, unitMinor: 25_000 }];
  const draft = (over: Partial<Invoice> = {}): Invoice => ({ id: "i1", number: "INV-000001", customerId: "c", currency: "USD", lines, taxBps: 1_300, status: "draft", createdAt: at, ...over });

  it("computes totals in integers", () => {
    expect(invoiceTotals(lines, 1_300)).toEqual({ subtotal: 50_000, tax: 6_500, total: 56_500 });
    expect(invoiceTotals([{ description: "x", quantity: 1, unitMinor: 333 }], 1_300).tax).toBe(43);
  });

  it("validates the draft and numbers invoices in sequence", () => {
    expect(validateInvoiceDraft({ customerId: "c", currency: "USD", lines, taxBps: 0 })).toEqual([]);
    expect(validateInvoiceDraft({ customerId: " ", currency: "usd", lines: [], taxBps: 20_000 })).toHaveLength(4);
    expect(validateInvoiceDraft({ customerId: "c", currency: "USD", lines: [{ description: "x", quantity: 1.5, unitMinor: -1 }], taxBps: 0 })).toHaveLength(2);
    expect(nextInvoiceNumber([])).toBe("INV-000001");
    expect(nextInvoiceNumber(["INV-000009", "INV-000002", "junk"])).toBe("INV-000010");
  });

  it("issues, gets paid only by the exact total, and voids only before payment", () => {
    const open = reduceInvoice(draft(), { type: "issue", at, dueAt: "2026-12-01T00:00:00.000Z" }).invoice;
    expect(open.status).toBe("open");
    expect(reduceInvoice(draft(), { type: "issue", at, dueAt: "2026-01-01T00:00:00.000Z" }).error).toContain("vencimiento");
    expect(reduceInvoice(open, { type: "pay", at, paymentId: "p", paid: { amountMinor: 56_000, currency: "USD" } }).error).toContain("no coincide");
    const paid = reduceInvoice(open, { type: "pay", at, paymentId: "p", paid: { amountMinor: 56_500, currency: "USD" } }).invoice;
    expect(paid.status).toBe("paid");
    expect(reduceInvoice(paid, { type: "void", at }).error).toBeDefined();
  });

  it("marks uncollectible only when overdue", () => {
    const open = draft({ status: "open", dueAt: "2026-10-01T00:00:00.000Z" });
    expect(isOverdue(open, new Date(at))).toBe(true);
    expect(reduceInvoice(open, { type: "uncollectible", at }).invoice.status).toBe("uncollectible");
    expect(reduceInvoice(draft({ status: "open", dueAt: "2027-01-01T00:00:00.000Z" }), { type: "uncollectible", at }).error).toBeDefined();
  });
});

describe("payment methods", () => {
  it("every payment method has a manifest of the payment category and a currency list", () => {
    for (const method of PAYMENT_METHODS) {
      expect(PROVIDER_MANIFESTS[method].category).toBe("payment");
      expect(METHOD_CURRENCIES[method].length).toBeGreaterThan(0);
    }
  });

  it("cannot activate the providers whose API is unknown, crypto included", () => {
    for (const method of ["makapay", "makawallet", "crypto"] as const) {
      const result = reducePayments(newPaymentsState(), { type: "connection", method, event: { type: "activate", actor, at } });
      expect(result.error).toBeDefined();
    }
  });
});

describe("payments, refunds and webhooks (local simulation)", () => {
  it("loads the whole sample through the reducer without a single refusal", () => {
    const state = demo();
    expect(state.payments.map((payment) => [payment.id, payment.status])).toEqual([["pay_0001", "succeeded"], ["pay_0002", "succeeded"], ["pay_0004", "pending"], ["pay_0006", "pending"], ["pay_0009", "succeeded"]]);
  });

  it("refuses a payment on an inactive method, in an unsupported currency, or without the charge permission", () => {
    const fresh = newPaymentsState();
    const create = (method: "stripe" | "sinpe", currency: string): PaymentsEvent => ({ type: "payment.create", actor, at, method, amount: { amountMinor: 1_000, currency } });
    expect(reducePayments(fresh, create("stripe", "USD")).error).toContain("no está activo");
    const active = applyAll(fresh, demoEvents().slice(0, 7)).state; // stripe, permissions, sinpe, bankTransfer
    expect(reducePayments(active, create("sinpe", "USD")).error).toContain("no admite USD");
    expect(reducePayments(active, create("stripe", "BTC")).error).toContain("no admite BTC");
    const off = applyAll(active, [{ type: "connection", method: "stripe", event: { type: "setPermissions", actor, at, permissions: { createCharge: "off" } } }]).state;
    expect(reducePayments(off, create("stripe", "USD")).error).toContain("permiso");
    expect(reducePayments(active, { type: "payment.create", actor, at, method: "stripe", amount: { amountMinor: 10.5, currency: "USD" } }).error).toBeDefined();
  });

  it("confirms card payments only by a verified webhook, and transfers only by a person", () => {
    const state = demo();
    expect(reducePayments(state, { type: "payment.paid", actor, at, paymentId: "pay_0001", source: "manual" }).error).toContain("webhook");
    const transfer = reducePayments(state, { type: "payment.paid", actor, at, paymentId: "pay_0006", source: "manual" });
    expect(transfer.error).toBeUndefined();
    expect(transfer.state.payments.find((payment) => payment.id === "pay_0006")?.status).toBe("succeeded");
  });

  it("rejects an unsigned webhook, ignores a duplicate and an out-of-order event, and never changes money for them", () => {
    const base = demo();
    const create = reducePayments(base, { type: "payment.create", actor, at, method: "stripe", amount: { amountMinor: 700, currency: "USD" } }).state; // pay_0011
    const hook = (eventId: string, type: "payment.succeeded" | "payment.failed", signature: "valid" | "invalid" | "missing" = "valid"): PaymentsEvent => ({ type: "webhook", envelope: { provider: "stripe", eventId, type, paymentRef: "pay_0011", signature, receivedAt: at } });

    const forged = reducePayments(create, hook("e1", "payment.succeeded", "invalid")).state;
    expect(forged.payments.find((payment) => payment.id === "pay_0011")?.status).toBe("pending");
    expect(forged.errors.at(-1)?.kind).toBe("auth");

    const once = reducePayments(create, hook("e2", "payment.succeeded")).state;
    const twice = reducePayments(once, hook("e2", "payment.succeeded")).state;
    expect(twice.payments).toEqual(once.payments);
    expect(twice.audit.at(-1)?.action).toBe("webhook.duplicate");

    const late = reducePayments(once, hook("e3", "payment.failed")).state; // succeeded → failed is not allowed
    expect(late.payments.find((payment) => payment.id === "pay_0011")?.status).toBe("succeeded");
    expect(late.audit.at(-1)?.action).toBe("webhook.outOfOrder");

    expect(reducePayments(base, { type: "webhook", envelope: { provider: "sinpe", eventId: "x", type: "payment.succeeded", paymentRef: "p", signature: "valid", receivedAt: at } }).error).toContain("no emite webhooks");
    const unknown = reducePayments(base, { type: "webhook", envelope: { provider: "stripe", eventId: "nope", type: "payment.succeeded", paymentRef: "ghost", signature: "valid", receivedAt: at } }).state;
    expect(unknown.errors.at(-1)?.kind).toBe("provider");
  });

  it("requires a second person to approve a refund and never refunds more than was collected", () => {
    const state = demo(); // pay_0002 has ref_0003 requested by demo-ops for 1 500 of 4 500
    const refund = (amountMinor: number, requester = actor): PaymentsEvent => ({ type: "refund.request", actor: requester, at, paymentId: "pay_0002", amount: { amountMinor, currency: "EUR" }, reason: "Duplicado" });
    expect(reducePayments(state, refund(3_100)).error).toContain("superar"); // 1 500 reserved + 3 100 > 4 500
    expect(reducePayments(state, refund(3_000)).error).toBeUndefined();
    expect(reducePayments(state, { type: "refund.decide", actor: "demo-ops", at, paymentId: "pay_0002", refundId: "ref_0003", approve: true }).error).toContain("no puede aprobarlo");
    const approved = reducePayments(state, { type: "refund.decide", actor, at, paymentId: "pay_0002", refundId: "ref_0003", approve: true }).state;
    expect(approved.payments.find((payment) => payment.id === "pay_0002")?.status).toBe("partiallyRefunded");
    const full = applyAll(approved, [refund(3_000), { type: "refund.decide", actor: "u2", at, paymentId: "pay_0002", refundId: "ref_0011", approve: true }]);
    expect(full.errors).toEqual([]);
    expect(full.state.payments.find((payment) => payment.id === "pay_0002")?.status).toBe("refunded");
    expect(reducePayments(full.state, { type: "refund.decide", actor, at, paymentId: "pay_0002", refundId: "ref_0003", approve: false }).error).toContain("ya fue resuelto");
  });

  it("refuses refunds on methods that do not offer them", () => {
    const state = demo();
    const paid = reducePayments(state, { type: "payment.paid", actor, at, paymentId: "pay_0004", source: "reconciliation" }).state;
    expect(reducePayments(paid, { type: "refund.request", actor, at, paymentId: "pay_0004", amount: { amountMinor: 100, currency: "CRC" }, reason: "x" }).error).toContain("no ofrece reembolsos");
  });

  it("feeds subscriptions and invoices from payments", () => {
    const state = demo();
    expect(state.subscriptions[0].status).toBe("active"); // pay_0009 confirmed by webhook
    const withInvoice = applyAll(state, [
      { type: "payment.create", actor, at, method: "bankTransfer", amount: { amountMinor: 56_500, currency: "USD" }, invoiceId: "inv_0010" }, // pay_0011
      { type: "payment.paid", actor, at, paymentId: "pay_0011", source: "manual" },
    ]);
    expect(withInvoice.errors).toEqual([]);
    expect(withInvoice.state.invoices[0]).toMatchObject({ status: "paid", paymentId: "pay_0011" });
  });
});

describe("reconciliation", () => {
  it("suggests an exact and a probable match, and a person confirms", () => {
    const state = demo();
    const suggestions = suggestMatches(state);
    expect(suggestions.map((suggestion) => suggestion.match.kind)).toEqual(["exact", "probable"]);
    const confirmed = reducePayments(state, { type: "reconcile.confirm", actor, at, lineId: "line_0005", paymentId: "pay_0004" }).state;
    expect(confirmed.payments.find((payment) => payment.id === "pay_0004")?.status).toBe("succeeded");
    expect(confirmed.statement.find((line) => line.id === "line_0005")).toMatchObject({ status: "matched", paymentId: "pay_0004" });
    expect(reducePayments(confirmed, { type: "reconcile.confirm", actor, at, lineId: "line_0005", paymentId: "pay_0004" }).error).toContain("ya fue resuelta");
  });

  it("refuses to match a line to a payment of another amount or method", () => {
    const state = demo();
    expect(reducePayments(state, { type: "reconcile.confirm", actor, at, lineId: "line_0005", paymentId: "pay_0006" }).error).toBeDefined();
  });

  it("importing the same statement twice adds nothing", () => {
    const state = demo();
    const again = reducePayments(state, { type: "statement.import", actor, at, method: "sinpe", lines: [{ method: "sinpe", amount: { amountMinor: 7_500_000, currency: "CRC" }, reference: "NOVA-0003", payerName: "Café Aurora", receivedAt: "2026-11-01T10:00:00.000Z" }] }).state;
    expect(again.statement).toHaveLength(state.statement.length);
  });

  it("ignores a line without touching any payment", () => {
    const state = demo();
    const ignored = reducePayments(state, { type: "reconcile.ignore", actor, at, lineId: "line_0007" }).state;
    expect(ignored.statement.find((line) => line.id === "line_0007")?.status).toBe("ignored");
    expect(ignored.payments).toEqual(state.payments);
  });
});

describe("financial dashboard", () => {
  it("summarizes by currency and in one reporting currency, naming the rates it lacks", () => {
    const summary = summarize(demo(), "USD", DEMO_RATES, new Date("2026-11-02T10:00:00.000Z"));
    expect(summary.collected).toEqual({ USD: 16_900, EUR: 4_500 });
    expect(summary.pending).toEqual({ CRC: 7_500_000, USD: 90_000 });
    expect(summary.recurringMonthly).toEqual({ USD: 4_900 });
    expect(summary.overdue).toEqual({ USD: 56_500 });
    expect(summary.counts).toMatchObject({ payments: 5, refundsToApprove: 1, overdueInvoices: 1, activeSubscriptions: 1, openStatementLines: 2 });
    expect(summary.reporting.collected).toEqual({ amountMinor: 16_900 + 4_860, currency: "USD" }); // 4 500 EUR × 1.08
    expect(summary.reporting.missingRates).toEqual([]);
    expect(summarize(demo(), "JPY", [], new Date(at)).reporting.missingRates).toEqual(["EUR", "USD"]);
  });

  it("subtracts completed refunds from what was collected", () => {
    const state = applyAll(demo(), [{ type: "refund.decide", actor, at, paymentId: "pay_0002", refundId: "ref_0003", approve: true }]).state;
    const summary = summarize(state, "USD", DEMO_RATES, new Date(at));
    expect(summary.collected.EUR).toBe(3_000);
    expect(summary.refunded).toEqual({ EUR: 1_500 });
  });
});

describe("history is never trimmed: limits belong to the view", () => {
  const manyPayments = (count: number) => {
    const events: PaymentsEvent[] = Array.from({ length: count }, (_, index) => ({ type: "payment.create", actor, at, method: "bankTransfer", amount: { amountMinor: 1_000 + index, currency: "USD" }, reference: `R-${index}` }));
    return applyAll(demo(), events);
  };

  it("keeps every payment, log and audit entry well past the old limit of 300", () => {
    const result = manyPayments(350);
    expect(result.errors).toEqual([]);
    expect(result.state.payments).toHaveLength(5 + 350);
    expect(result.state.payments[0].id).toBe("pay_0001"); // the oldest is still there
    expect(result.state.audit.length).toBeGreaterThan(350);
    expect(result.state.logs.length).toBeGreaterThan(350);
  });

  it("keeps invoices, subscriptions and statement lines too", () => {
    let state = demo();
    const events: PaymentsEvent[] = [];
    for (let index = 0; index < 320; index += 1) {
      events.push({ type: "invoice.create", actor, at, customerId: `c${index}`, currency: "USD", lines: [{ description: "x", quantity: 1, unitMinor: 100 }], taxBps: 0 });
      events.push({ type: "subscription.create", actor, at, draft: { customerId: `c${index}`, planName: "P", amount: { amountMinor: 100, currency: "USD" }, interval: "month", startedAt: at } });
      events.push({ type: "statement.import", actor, at, method: "bankTransfer", lines: [{ method: "bankTransfer", amount: { amountMinor: 100 + index, currency: "USD" }, receivedAt: at }] });
    }
    const result = applyAll(state, events);
    state = result.state;
    expect(result.errors).toEqual([]);
    expect(state.invoices).toHaveLength(321);
    expect(state.subscriptions).toHaveLength(321);
    expect(state.statement).toHaveLength(322);
  });

  it("still ignores a replayed webhook after hundreds of later events (idempotency is not forgotten)", () => {
    const base = manyPayments(350).state;
    const replay = reducePayments(base, { type: "webhook", envelope: { provider: "stripe", eventId: "evt_demo_1", type: "payment.succeeded", paymentRef: "pay_0001", signature: "valid", receivedAt: at } }).state;
    expect(replay.audit.at(-1)?.action).toBe("webhook.duplicate");
    expect(replay.payments).toEqual(base.payments);
  });

  it("limits only what the view shows, and says how much is hidden", () => {
    const items = Array.from({ length: 100 }, (_, index) => index);
    const { shown, hidden } = latest(items);
    expect(shown).toHaveLength(DISPLAY_LIMIT);
    expect(shown[0]).toBe(99);
    expect(hidden).toBe(100 - DISPLAY_LIMIT);
    expect(items).toHaveLength(100);
    expect(hiddenNote(0)).toBeNull();
    expect(hiddenNote(60)).toContain("60");
    expect(latest([1, 2, 3]).hidden).toBe(0);
  });
});
