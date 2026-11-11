/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateEncryptionKey } from "@/lib/backend/crypto";
import type { Entity } from "@/lib/backend/entities";
import { createBackendCore } from "@/lib/backend/index";
import { Connector, newStats, verifyCoverage, type Bridge } from "@/lib/backend/integration";
import { auditPolicies } from "@/lib/backend/rls";
import { newBillingState, reduceBilling, type BillingEvent } from "./billing-center";
import {
  ADAPTERS, MONEY_OPERATIONS, OPERATIONS, PROVIDER_IDS, ROUTER_TABLES, adapterById, billingPaymentFromOperation, chargeFromInvoice, chargeFromPurchase, defaultConfig, newRouterState, payoutFromPartner,
  reduceRouter, routeCandidates, routerHistory, routerMetrics, routerObservations, microsToMinorUsd, applyRouterEvents,
  type MoneyOperation, type RequestInput, type RouterEvent, type RouterState,
} from "./financial-router";

const T1 = "tenant-kynova";
const T2 = "tenant-nova";
const t0 = Date.parse("2026-11-10T10:00:00.000Z");
const at = (minutes = 0) => new Date(t0 + minutes * 60_000).toISOString();
let counter = 0;
const key = () => `key-${String(++counter).padStart(6, "0")}`;
const base = (tenantId = T1, actor = "jeffrey") => ({ tenantId, actor });
const input = (operation: MoneyOperation, amountMinor: number, currency = "USD", over: Partial<RequestInput> = {}): RequestInput => ({
  operation, amount: { amountMinor, currency }, idempotencyKey: key(), description: `Prueba ${operation}`,
  reference: operation === "marketplaceCharge" ? { listingId: "ls_1" } : operation === "partnerPayout" || operation === "commission" ? { partnerId: "pt_1" } : operation === "credit" ? { customerId: "c1" } : { customerId: "c1" }, ...over,
});
const send = (state: RouterState, event: RouterEvent): RouterState => { const result = reduceRouter(state, event); expect(result.error, result.error).toBeUndefined(); return result.state; };
const refused = (state: RouterState, event: RouterEvent): string => { const result = reduceRouter(state, event); expect(result.error, `${event.type} should be refused`).toBeDefined(); expect(result.state).toBe(state); return result.errorCode ?? ""; };
/** Request by a person, then process. Returns the new state and the finished operation. */
function run(state: RouterState, request: RequestInput, tenantId = T1, minute = 0) {
  const asked = reduceRouter(state, { ...base(tenantId), at: at(minute), type: "payment.request", input: request });
  expect(asked.error, asked.error).toBeUndefined();
  // money out and credits wait for a second person, who approves here
  let ready = asked.state;
  if (asked.operation!.status === "awaitingApproval") { const approved = reduceRouter(ready, { ...base(tenantId, "valeria"), at: at(minute), type: "payment.approve", operationId: asked.operation!.id }); expect(approved.error, approved.error).toBeUndefined(); ready = approved.state; }
  const done = reduceRouter(ready, { ...base(tenantId, "system"), at: at(minute + 1), type: "payment.process", operationId: asked.operation!.id });
  expect(done.error, done.error).toBeUndefined();
  return { state: done.state, operation: done.operation! };
}
const incident = (state: RouterState, providerId: string, mode: "down" | "timeout" | "rateLimited" | "slow") => send(state, { ...base(T1, "system"), at: at(), type: "provider.incident", providerId, mode });
const configure = (state: RouterState, over: Omit<Extract<RouterEvent, { type: "router.configure" }>, "type" | "at" | "tenantId" | "actor">, tenantId = T1) => send(state, { ...base(tenantId), at: at(), type: "router.configure", ...over });

describe("the seven adapters share one interface and none is connected", () => {
  it("declares MakaPay, PayPal, Payoneer, Stripe, Apple Pay, Google Pay and Osmo", () => {
    expect([...PROVIDER_IDS].sort()).toEqual(["applePay", "googlePay", "makapay", "osmo", "payoneer", "paypal", "stripe"]);
    expect(ADAPTERS.map((item) => item.id).sort()).toEqual([...PROVIDER_IDS].sort());
  });
  it("gives every adapter the same shape: capabilities, pricing, profile and an `execute` that answers notConnected without touching anything", async () => {
    for (const provider of ADAPTERS) {
      expect(provider.connected, provider.id).toBe(false);
      expect(provider.capabilities.operations.length, provider.id).toBeGreaterThan(0);
      expect(provider.capabilities.currencies.length, provider.id).toBeGreaterThan(0);
      expect(provider.pricing.bps).toBeGreaterThanOrEqual(0);
      expect(provider.profile.reliability).toBeGreaterThan(0.9);
      expect(await provider.execute({ operationId: "op_0001", tenantId: T1, kind: "membershipCharge", amount: { amountMinor: 100, currency: "USD" }, idempotencyKey: "key-000000", reference: {} })).toEqual({ ok: false, kind: "notConnected" });
    }
    expect(adapterById("nope")).toBeUndefined();
  });
  it("supports the ten operations, with money out and credits needing a second person", () => {
    expect([...MONEY_OPERATIONS].sort()).toEqual(["commission", "credit", "invoice", "marketplaceCharge", "membershipCharge", "partnerPayout", "planChange", "refund", "renewal", "subscription"]);
    expect(OPERATIONS.partnerPayout).toMatchObject({ flow: "out", approval: "second" });
    expect(OPERATIONS.refund.approval).toBe("second");
    expect(OPERATIONS.credit.approval).toBe("second");
    expect(OPERATIONS.membershipCharge).toMatchObject({ flow: "in", provider: true, approval: "person" });
    expect(OPERATIONS.invoice).toMatchObject({ provider: false });
  });
});

describe("the router decides which provider moves the money", () => {
  const cfg = defaultConfig(T1, at());
  const first = (policy: "cost" | "reliability" | "speed" | "balanced", kind: MoneyOperation, amount: number, currency = "USD", method?: string) => routeCandidates({ ...cfg, policy }, kind, { amountMinor: amount, currency }, method)[0]?.provider.id;
  it("follows the company's policy: cost, reliability, speed or balanced", () => {
    expect(first("cost", "membershipCharge", 10_000)).toBe("makapay");
    expect(first("reliability", "membershipCharge", 10_000)).toBe("stripe");
    expect(first("speed", "membershipCharge", 10_000)).toBe("applePay");
    expect(first("balanced", "membershipCharge", 10_000)).toBeDefined();
    expect(first("cost", "partnerPayout", 50_000)).toBe("makapay");
    expect(first("reliability", "partnerPayout", 50_000)).toBe("payoneer");
  });
  it("takes the operation, the currency and the method into account", () => {
    expect(routeCandidates(cfg, "partnerPayout", { amountMinor: 1, currency: "USD" }).map((item) => item.provider.id).sort()).toEqual(["makapay", "osmo", "paypal", "payoneer"].sort());
    expect(routeCandidates(cfg, "membershipCharge", { amountMinor: 100, currency: "CRC" }).map((item) => item.provider.id)).toEqual(["makapay"]);
    expect(routeCandidates(cfg, "membershipCharge", { amountMinor: 100, currency: "JPY" }).map((item) => item.provider.id)).toEqual(["stripe"]);
    expect(routeCandidates(cfg, "membershipCharge", { amountMinor: 100, currency: "USD" }, "applePay").map((item) => item.provider.id)).toEqual(["applePay"]);
    expect(routeCandidates(cfg, "credit", { amountMinor: 100, currency: "USD" })).toEqual([]);
  });
  it("respects the providers a company allows, and sends a charge to the cheapest one it ran", () => {
    let state = configure(newRouterState(), { policy: "cost", allowedProviders: ["paypal", "stripe"] });
    const { operation } = run(state, input("membershipCharge", 10_000));
    expect(operation).toMatchObject({ status: "succeeded", providerId: "stripe", feeMinor: 320, netMinor: 9_680, simulated: true, fallbackUsed: false });
    state = configure(newRouterState(), { allowedProviders: ["payoneer"] });
    expect(refused(state, { ...base(), at: at(), type: "payment.request", input: input("membershipCharge", 100) })).toBe("noProvider");
  });
  it("honors a preferred provider when it can do the operation, and still falls back when it cannot be reached", () => {
    let state = newRouterState();
    const preferred = run(state, input("membershipCharge", 10_000, "USD", { preferredProvider: "paypal" }));
    expect(preferred.operation.providerId).toBe("paypal");
    state = incident(state, "paypal", "down");
    const fallback = run(state, input("membershipCharge", 10_000, "USD", { preferredProvider: "paypal" }));
    expect(fallback.operation).toMatchObject({ status: "succeeded", fallbackUsed: true });
    expect(fallback.operation.providerId).not.toBe("paypal");
  });
  it("uses the company's own history: a provider that keeps failing is ranked lower", () => {
    let state = configure(newRouterState(), { policy: "reliability", limits: { retry: { maxAttempts: 1 }, breaker: { failureThreshold: 99 } } });
    state = incident(state, "stripe", "down");
    for (let index = 0; index < 5; index += 1) state = run(state, input("membershipCharge", 1_000), T1, index * 2).state;
    const stripe = routerMetrics(state, T1).byProvider["stripe"]!;
    expect(stripe.failures).toBe(5);
    state = send(state, { ...base(T1, "system"), at: at(30), type: "provider.recover", providerId: "stripe" });
    expect(run(state, input("membershipCharge", 1_000), T1, 40).operation.providerId).not.toBe("stripe");
  });
});

describe("currencies and conversion", () => {
  it("refuses a currency no allowed provider moves, unless the company authorizes conversion and gives a rate", () => {
    let state = newRouterState();
    const request = input("partnerPayout", 1_000_000, "JPY");
    expect(refused(state, { ...base(), at: at(), type: "payment.request", input: request })).toBe("currencyUnsupported");
    state = send(state, { ...base(), at: at(), type: "router.rates", rates: [{ from: "JPY", to: "USD", rate: 0.0067 }] });
    expect(refused(state, { ...base(), at: at(), type: "payment.request", input: request })).toBe("currencyUnsupported");
    state = configure(state, { allowConversion: true });
    const { operation } = run(state, request);
    expect(operation).toMatchObject({ status: "succeeded", amount: { amountMinor: 1_000_000, currency: "JPY" } });
    expect(operation.settled).toMatchObject({ currency: "USD", amountMinor: 670_000 });
    expect(operation.fx).toMatchObject({ from: "JPY", to: "USD" });
    expect(routerMetrics(state, T1).conversions).toBe(0);
  });
  it("moves a payment in its own currency when a provider supports it (CRC with MakaPay) and sums fees per currency", () => {
    let state = newRouterState();
    const crc = run(state, input("membershipCharge", 500_000, "CRC"));
    state = crc.state;
    expect(crc.operation).toMatchObject({ providerId: "makapay", settled: { amountMinor: 500_000, currency: "CRC" }, feeMinor: 7_500 });
    state = run(state, input("membershipCharge", 10_000), T1, 5).state;
    const metrics = routerMetrics(state, T1);
    expect(Object.keys(metrics.feesByCurrency).sort()).toEqual(["CRC", "USD"]);
    expect(metrics.volumeByCurrency["CRC"]).toBe(500_000);
  });
  it("represents cryptocurrency but never settles it, and refuses bad money", () => {
    const state = newRouterState();
    expect(refused(state, { ...base(), at: at(), type: "payment.request", input: input("membershipCharge", 100, "USDC") })).toBe("cryptoReserved");
    expect(refused(state, { ...base(), at: at(), type: "payment.request", input: input("membershipCharge", 0) })).toBe("invalid");
    expect(refused(state, { ...base(), at: at(), type: "payment.request", input: input("membershipCharge", 10.5) })).toBe("invalid");
    expect(refused(state, { ...base(), at: at(), type: "payment.request", input: input("membershipCharge", 100, "XXX") })).toBe("invalid");
    expect(refused(state, { ...base(), at: at(), type: "router.rates", rates: [{ from: "BTC", to: "USD", rate: 1 }] })).toBe("invalid");
  });
});

describe("only a person decides where money moves", () => {
  it("lets a person start a charge, but NEX or the system only prepare it until a person approves", () => {
    let state = newRouterState();
    const mine = reduceRouter(state, { ...base(), at: at(), type: "payment.request", input: input("membershipCharge", 1_000) });
    expect(mine.operation).toMatchObject({ status: "approved", approvedBy: "jeffrey" });
    const prepared = reduceRouter(state, { ...base(T1, "worker:nex"), at: at(), type: "payment.request", input: input("membershipCharge", 1_000) });
    expect(prepared.operation!.status).toBe("awaitingApproval");
    state = prepared.state;
    expect(refused(state, { ...base(T1, "system"), at: at(), type: "payment.process", operationId: prepared.operation!.id })).toBe("notApproved");
    expect(refused(state, { ...base(T1, "worker:nex"), at: at(), type: "payment.approve", operationId: prepared.operation!.id })).toBe("personRequired");
    state = send(state, { ...base(T1, "valeria"), at: at(1), type: "payment.approve", operationId: prepared.operation!.id });
    expect(state.operations[0]).toMatchObject({ status: "approved", approvedBy: "valeria", requestedBy: "worker:nex" });
  });
  it("needs a DIFFERENT person for refunds, payouts and credits", () => {
    let state = newRouterState();
    for (const request of [input("partnerPayout", 20_000), input("credit", 1_000)]) {
      const asked = reduceRouter(state, { ...base(), at: at(), type: "payment.request", input: request });
      expect(asked.operation!.status, request.operation).toBe("awaitingApproval");
      expect(refused(asked.state, { ...base(), at: at(1), type: "payment.approve", operationId: asked.operation!.id })).toBe("samePerson");
      state = send(asked.state, { ...base(T1, "valeria"), at: at(1), type: "payment.approve", operationId: asked.operation!.id });
      state = send(state, { ...base(T1, "system"), at: at(2), type: "payment.process", operationId: asked.operation!.id });
    }
    expect(state.operations.map((item) => item.status)).toEqual(["succeeded", "succeeded"]);
  });
  it("lets a person reject, and never processes a rejected or already processed operation", () => {
    let state = newRouterState();
    const asked = reduceRouter(state, { ...base(T1, "worker:nex"), at: at(), type: "payment.request", input: input("membershipCharge", 1_000) });
    state = send(asked.state, { ...base(), at: at(1), type: "payment.reject", operationId: asked.operation!.id, reason: "no corresponde" });
    expect(state.operations[0]!.status).toBe("rejected");
    expect(refused(state, { ...base(T1, "system"), at: at(2), type: "payment.process", operationId: asked.operation!.id })).toBe("alreadyDone");
    const done = run(newRouterState(), input("membershipCharge", 1_000));
    expect(refused(done.state, { ...base(T1, "system"), at: at(9), type: "payment.process", operationId: done.operation.id })).toBe("alreadyDone");
  });
});

describe("idempotency", () => {
  it("returns the same operation for the same key and the same request, and never charges twice", () => {
    const request = input("membershipCharge", 10_000);
    const first = run(newRouterState(), request);
    const again = reduceRouter(first.state, { ...base(), at: at(10), type: "payment.request", input: request });
    expect(again.error).toBeUndefined();
    expect(again.duplicate).toBe(true);
    expect(again.operation!.id).toBe(first.operation.id);
    expect(again.state.operations).toHaveLength(1);
    expect(again.state.audit).toHaveLength(first.state.audit.length);
  });
  it("refuses the same key for a different request", () => {
    const request = input("membershipCharge", 10_000);
    const first = run(newRouterState(), request);
    expect(refused(first.state, { ...base(), at: at(10), type: "payment.request", input: { ...request, amount: { amountMinor: 20_000, currency: "USD" } } })).toBe("idempotencyConflict");
    expect(refused(first.state, { ...base(), at: at(10), type: "payment.request", input: { ...request, idempotencyKey: "corta" } })).toBe("invalid");
  });
  it("scopes the key to the company: the same key in two companies is two operations", () => {
    const request = input("membershipCharge", 10_000);
    const a = run(newRouterState(), request, T1);
    const b = run(a.state, request, T2);
    expect(b.state.operations.map((item) => item.tenantId)).toEqual([T1, T2]);
    expect(a.operation.id).not.toBe(b.operation.id);
  });
});

describe("retries, timeouts, circuit breaker and fallback", () => {
  it("retries a rate limit with the company's backoff, then falls back to another provider", () => {
    let state = configure(newRouterState(), { policy: "cost" });
    state = incident(state, "makapay", "rateLimited");
    const { operation } = run(state, input("membershipCharge", 10_000));
    expect(operation.attempts.map((item) => `${item.providerId}:${item.outcome}`)).toEqual(["makapay:rateLimited", "makapay:rateLimited", "osmo:ok"]);
    expect(operation.attempts[0]!.backoffMs).toBe(200);
    expect(operation).toMatchObject({ status: "succeeded", fallbackUsed: true, providerId: "osmo" });
    expect(routerMetrics(state, T1).byProvider).toEqual({});
  });
  it("does not retry an outage: it falls back at once", () => {
    let state = configure(newRouterState(), { policy: "cost" });
    state = incident(state, "makapay", "down");
    const { operation } = run(state, input("membershipCharge", 10_000));
    expect(operation.attempts.map((item) => `${item.providerId}:${item.outcome}`)).toEqual(["makapay:down", "osmo:ok"]);
  });
  it("applies the time limit: a slow provider is a timeout", () => {
    let state = configure(newRouterState(), { policy: "cost", limits: { timeoutMs: 1_000, retry: { maxAttempts: 1 } } });
    state = incident(state, "makapay", "slow");
    const { operation } = run(state, input("membershipCharge", 10_000));
    expect(operation.attempts[0]).toMatchObject({ providerId: "makapay", outcome: "timeout", latencyMs: 1_000 });
    expect(operation.providerId).not.toBe("makapay");
  });
  it("opens the circuit after repeated failures, skips that provider, and tries it again after the cooldown", () => {
    let state = configure(newRouterState(), { policy: "cost", limits: { retry: { maxAttempts: 1 }, breaker: { failureThreshold: 2, cooldownMs: 600_000 } } });
    state = incident(state, "makapay", "down");
    state = run(state, input("membershipCharge", 1_000), T1, 0).state;
    state = run(state, input("membershipCharge", 1_000), T1, 2).state;
    const open = run(state, input("membershipCharge", 1_000), T1, 4);
    expect(open.operation.attempts[0]).toMatchObject({ providerId: "makapay", outcome: "skipped", note: "cortacircuitos abierto" });
    state = send(open.state, { ...base(T1, "system"), at: at(5), type: "provider.recover", providerId: "makapay" });
    expect(run(state, input("membershipCharge", 1_000), T1, 6).operation.attempts[0]!.outcome).toBe("skipped");
    const later = run(state, input("membershipCharge", 1_000), T1, 20);
    expect(later.operation).toMatchObject({ status: "succeeded", providerId: "makapay" });
  });
  it("fails, recording every reason and costing nothing, when no provider can do it", () => {
    let state = configure(newRouterState(), { allowedProviders: ["stripe", "paypal"], limits: { retry: { maxAttempts: 1 } } });
    state = incident(state, "stripe", "down");
    state = incident(state, "paypal", "timeout");
    const { operation, state: after } = run(state, input("membershipCharge", 10_000));
    expect(operation).toMatchObject({ status: "failed", feeMinor: 0, failureReason: "stripe: down, paypal: timeout" });
    expect(after.audit.at(-1)!.action).toBe("payment.failed");
    expect(routerMetrics(after, T1)).toMatchObject({ successPercent: 0 });
  });
  it("lets only the system declare or end an incident", () => {
    const state = newRouterState();
    expect(refused(state, { ...base(), at: at(), type: "provider.incident", providerId: "stripe", mode: "down" })).toBe("forbidden");
    expect(refused(state, { ...base(T1, "system"), at: at(), type: "provider.incident", providerId: "nope", mode: "down" })).toBe("invalid");
    expect(refused(state, { ...base(), at: at(), type: "provider.recover", providerId: "stripe" })).toBe("forbidden");
  });
});

describe("refunds, credits, invoices, subscriptions and payment states", () => {
  it("refunds through the SAME provider that took the payment, never through a fallback, and follows the payment states", () => {
    let state = configure(newRouterState(), { policy: "cost" });
    const charge = run(state, input("membershipCharge", 10_000));
    state = charge.state;
    expect(charge.operation.providerId).toBe("makapay");
    const refundRequest = (amount: number) => input("refund", amount, "USD", { reference: { originalOperationId: charge.operation.id } });
    const ask = (amount: number, minute: number) => {
      const asked = reduceRouter(state, { ...base(), at: at(minute), type: "payment.request", input: refundRequest(amount) });
      expect(asked.error, asked.error).toBeUndefined();
      state = send(asked.state, { ...base(T1, "valeria"), at: at(minute + 1), type: "payment.approve", operationId: asked.operation!.id });
      return asked.operation!.id;
    };
    const partial = ask(4_000, 10);
    state = incident(state, "makapay", "down");
    state = send(state, { ...base(T1, "system"), at: at(12), type: "payment.process", operationId: partial });
    expect(state.operations.find((item) => item.id === partial)).toMatchObject({ status: "failed", attempts: [{ providerId: "makapay", outcome: "down" }] });
    expect(state.operations.find((item) => item.id === charge.operation.id)!.status).toBe("succeeded");
    state = send(state, { ...base(T1, "system"), at: at(13), type: "provider.recover", providerId: "makapay" });
    const retry = ask(4_000, 20);
    state = send(state, { ...base(T1, "system"), at: at(22), type: "payment.process", operationId: retry });
    expect(state.operations.find((item) => item.id === retry)).toMatchObject({ status: "succeeded", providerId: "makapay", feeMinor: 0 });
    expect(state.operations.find((item) => item.id === charge.operation.id)!.status).toBe("partiallyRefunded");
    const rest = ask(6_000, 30);
    state = send(state, { ...base(T1, "system"), at: at(32), type: "payment.process", operationId: rest });
    expect(state.operations.find((item) => item.id === charge.operation.id)!.status).toBe("refunded");
    expect(refused(state, { ...base(), at: at(40), type: "payment.request", input: refundRequest(1) })).toBe("notRefundable");
  });
  it("refuses a refund over what was charged, in another currency, of another company's payment, or of something not paid", () => {
    const charge = run(newRouterState(), input("membershipCharge", 10_000));
    const original = charge.operation.id;
    expect(refused(charge.state, { ...base(), at: at(10), type: "payment.request", input: input("refund", 10_001, "USD", { reference: { originalOperationId: original } }) })).toBe("refundExceeds");
    expect(refused(charge.state, { ...base(), at: at(10), type: "payment.request", input: input("refund", 100, "EUR", { reference: { originalOperationId: original } }) })).toBe("invalid");
    expect(refused(charge.state, { ...base(T2), at: at(10), type: "payment.request", input: input("refund", 100, "USD", { reference: { originalOperationId: original } }) })).toBe("notRefundable");
    const pending = reduceRouter(charge.state, { ...base(T1, "worker:nex"), at: at(10), type: "payment.request", input: input("membershipCharge", 500) });
    expect(refused(pending.state, { ...base(), at: at(11), type: "payment.request", input: input("refund", 100, "USD", { reference: { originalOperationId: pending.operation!.id } }) })).toBe("notRefundable");
  });
  it("posts credits, invoices and commissions to the ledger, with no provider", () => {
    let state = newRouterState();
    const credit = reduceRouter(state, { ...base(), at: at(), type: "payment.request", input: input("credit", 2_500) });
    state = send(credit.state, { ...base(T1, "valeria"), at: at(1), type: "payment.approve", operationId: credit.operation!.id });
    state = send(state, { ...base(T1, "system"), at: at(2), type: "payment.process", operationId: credit.operation!.id });
    expect(state.credits).toEqual([{ id: "cr_0001", tenantId: T1, customerId: "c1", amount: { amountMinor: 2_500, currency: "USD" }, operationId: credit.operation!.id, at: at(2) }]);
    const invoice = run(state, input("invoice", 14_900));
    expect(invoice.operation).toMatchObject({ status: "succeeded", providerId: "ledger", providerRef: "FAC-0001", attempts: [] });
    const commission = run(invoice.state, input("commission", 1_043), T1, 10);
    expect(commission.operation).toMatchObject({ status: "succeeded", providerId: "ledger" });
    expect(commission.state.invoiceNumbers).toHaveLength(1);
  });
  it("handles subscriptions, renewals and plan changes as charges, with the next renewal date", () => {
    let state = newRouterState();
    const sub = run(state, input("subscription", 14_900, "USD", { recurring: true }));
    state = sub.state;
    expect(sub.operation).toMatchObject({ status: "succeeded", recurring: { interval: "month", nextAt: "2026-12-10T10:00:00.000Z" } });
    const renewal = run(state, input("renewal", 14_900, "USD", { reference: { invoiceId: "inv_2" } }), T1, 5);
    const change = run(renewal.state, input("planChange", 25_000, "USD", { reference: { invoiceId: "inv_3" } }), T1, 8);
    expect([sub.operation.kind, renewal.operation.kind, change.operation.kind]).toEqual(["subscription", "renewal", "planChange"]);
    expect([renewal.operation.status, change.operation.status]).toEqual(["succeeded", "succeeded"]);
  });
  it("follows the Payments state machine when a provider reports a dispute or a late result, and refuses impossible jumps", () => {
    const charge = run(newRouterState(), input("membershipCharge", 10_000));
    let state = send(charge.state, { ...base(T1, "system"), at: at(20), type: "webhook.receive", operationId: charge.operation.id, status: "disputed" });
    expect(state.operations[0]!.status).toBe("disputed");
    expect(refused(state, { ...base(T1, "system"), at: at(21), type: "webhook.receive", operationId: charge.operation.id, status: "failed" })).toBe("invalidTransition");
    expect(refused(state, { ...base(), at: at(21), type: "webhook.receive", operationId: charge.operation.id, status: "succeeded" })).toBe("forbidden");
    state = send(state, { ...base(T1, "system"), at: at(22), type: "webhook.receive", operationId: charge.operation.id, status: "succeeded" });
    expect(state.operations[0]!.history.map((item) => item.status)).toEqual(["approved", "succeeded", "disputed", "succeeded"]);
  });
});

describe("history and observability", () => {
  function busy() {
    let state = configure(newRouterState(), { policy: "cost" });
    state = run(state, input("membershipCharge", 10_000, "USD", { reference: { customerId: "c1" } }), T1, 0).state;
    state = incident(state, "makapay", "down");
    state = run(state, input("marketplaceCharge", 4_900), T1, 5).state;
    state = send(state, { ...base(T1, "system"), at: at(20), type: "provider.recover", providerId: "makapay" });
    state = run(state, input("partnerPayout", 50_000), T1, 30).state;
    return state;
  }
  it("keeps a full history that can be narrowed by kind, status, provider and reference, newest first", () => {
    const state = busy();
    expect(routerHistory(state, T1).map((item) => item.kind)).toEqual(["partnerPayout", "marketplaceCharge", "membershipCharge"]);
    expect(routerHistory(state, T1, { kind: "marketplaceCharge" })).toHaveLength(1);
    expect(routerHistory(state, T1, { providerId: "makapay" }).map((item) => item.kind)).toEqual(["partnerPayout", "membershipCharge"]);
    expect(routerHistory(state, T1, { status: "failed" })).toEqual([]);
    expect(routerHistory(state, T1, { reference: { customerId: "c1" } }).length).toBe(1);
    expect(routerHistory(state, T2)).toEqual([]);
  });
  it("measures operations, status, providers, fallbacks, fees, volume and latency", () => {
    const metrics = routerMetrics(busy(), T1);
    expect(metrics).toMatchObject({ operations: 3, successPercent: 100, fallbacks: 1, conversions: 0, awaitingApproval: 0 });
    expect(metrics.byStatus).toEqual({ succeeded: 3 });
    expect(metrics.byProvider["makapay"]).toMatchObject({ operations: 2, failures: 1 });
    expect(metrics.feesByCurrency["USD"]).toBeGreaterThan(0);
    expect(metrics.avgLatencyMs).toBeGreaterThan(0);
    expect(routerMetrics(busy(), T2)).toMatchObject({ operations: 0, successPercent: null });
  });
  it("turns what changed into events and counters a Backend Core bridge can publish, without sending anything", () => {
    const before = newRouterState();
    const after = run(before, input("membershipCharge", 10_000)).state;
    const observed = routerObservations(before, after);
    expect(observed.find((item) => item.kind === "event")).toMatchObject({ name: "payment.operation.recorded", tenantId: T1, payload: { kind: "membershipCharge", status: "succeeded", currency: "USD" } });
    expect(observed.some((item) => item.kind === "metric" && item.name === "kynova_payment_fees_minor")).toBe(true);
    expect(routerObservations(after, after)).toEqual([]);
    expect(JSON.stringify(observed)).not.toMatch(/@/);
  });
});

describe("Billing -> Financial Router -> provider", () => {
  const billingAt = (day: number) => new Date(Date.parse("2026-10-01T10:00:00.000Z") + day * 86_400_000).toISOString();
  it("charges an invoice Billing issued, through a provider, and hands Billing back the payment to record", () => {
    let billing = newBillingState();
    const go = (event: BillingEvent) => { const result = reduceBilling(billing, event); expect(result.error, result.error).toBeUndefined(); billing = result.state; };
    go({ tenantId: T2, actor: "system", at: billingAt(0), type: "account.create", ownerId: "ana", planId: "professional" });
    go({ tenantId: T2, actor: "ana", at: billingAt(1), type: "billing.setAdmin", userId: "pablo", enabled: true });
    go({ tenantId: T2, actor: "pablo", at: billingAt(29), type: "renewal.run" });
    const invoice = billing.invoices.find((item) => item.tenantId === T2)!;
    const before = JSON.stringify(billing);
    const request = chargeFromInvoice(invoice, { actor: "pablo", at: billingAt(30), method: "card" });
    const finished = run(newRouterState(), (request as Extract<RouterEvent, { type: "payment.request" }>).input, T2, 0);
    expect(finished.operation).toMatchObject({ status: "succeeded", amount: { amountMinor: microsToMinorUsd(invoice.totalMicros), currency: "USD" }, reference: { invoiceId: invoice.id } });
    expect(["stripe", "paypal", "makapay", "osmo"]).toContain(finished.operation.providerId);
    const record = billingPaymentFromOperation(finished.operation)!;
    expect(record).toMatchObject({ type: "payment.record", invoiceId: invoice.id, amountMicros: invoice.totalMicros, method: "simulatedCard" });
    expect(JSON.stringify(billing)).toBe(before);
    go({ tenantId: T2, actor: "pablo", at: billingAt(31), ...record });
    expect(billing.payments.filter((item) => item.tenantId === T2)).toHaveLength(1);
    // the same invoice asked twice is the same operation
    const again = reduceRouter(finished.state, { ...(request as Extract<RouterEvent, { type: "payment.request" }>), tenantId: T2 });
    expect(again.duplicate).toBe(true);
    expect(billingPaymentFromOperation({ ...finished.operation, status: "failed" })).toBeNull();
  });
  it("builds the requests of Partners (money out) and Marketplace (a charge) in the same entrance", () => {
    const payout = payoutFromPartner({ id: "po_0001", tenantId: T1, partnerId: "pt_0001", amountMicros: 105_000_000 }, { actor: "jeffrey", at: at() });
    expect(payout).toMatchObject({ type: "payment.request", input: { operation: "partnerPayout", amount: { amountMinor: 10_500, currency: "USD" }, idempotencyKey: "payout:po_0001" } });
    const asked = reduceRouter(newRouterState(), payout);
    expect(asked.operation!.status).toBe("awaitingApproval");
    const purchase = chargeFromPurchase({ id: "pu_1", listingId: "ls_1", buyerTenantId: T2, pricing: { amountMinor: 4_900 }, currency: "USD" }, { tenantId: T1, actor: "jeffrey", at: at() })!;
    expect(purchase).toMatchObject({ input: { operation: "marketplaceCharge", amount: { amountMinor: 4_900 } } });
    expect(chargeFromPurchase({ id: "pu_2", listingId: "ls_2", buyerTenantId: T2, pricing: {}, currency: "USD" }, { tenantId: T1, actor: "jeffrey", at: at() })).toBeNull();
    expect(run(newRouterState(), (purchase as Extract<RouterEvent, { type: "payment.request" }>).input).operation.status).toBe("succeeded");
  });
});

describe("every company's money stays its own, and every step is audited", () => {
  it("keeps two companies apart in operations, configuration, breakers and metrics, and refuses what crosses", () => {
    let state = configure(newRouterState(), { policy: "cost", allowedProviders: ["paypal"] });
    state = configure(state, { policy: "reliability" }, T2);
    const a = run(state, input("membershipCharge", 10_000), T1);
    const b = run(a.state, input("membershipCharge", 10_000), T2, 10);
    expect(a.operation.providerId).toBe("paypal");
    expect(b.operation.providerId).toBe("stripe");
    expect(refused(b.state, { ...base(T2, "system"), at: at(30), type: "payment.process", operationId: a.operation.id })).toBe("notFound");
    expect(refused(b.state, { ...base(T2), at: at(30), type: "payment.request", input: input("refund", 100, "USD", { reference: { originalOperationId: a.operation.id } }) })).toBe("notRefundable");
    expect(refused(b.state, { ...base(T2, "mallory"), at: at(30), type: "router.configure", policy: "cost" })).toBe("forbidden");
    expect(routerMetrics(b.state, T1).operations).toBe(1);
    expect(routerMetrics(b.state, T2).operations).toBe(1);
    expect(refused(b.state, { tenantId: "", actor: "jeffrey", at: at(), type: "payment.process", operationId: "op_0001" })).toBe("tenantRequired");
    expect(b.state.audit.filter((item) => item.tenantId === T1).every((item) => item.tenantId === T1)).toBe(true);
  });
  it("audits every accepted event once, in the append-only shape the Event Bus connector reads, and nothing for a refused or repeated one", () => {
    const first = run(newRouterState(), input("membershipCharge", 10_000));
    expect(first.state.audit.map((item) => item.action)).toEqual(["payment.request", "payment.process"]);
    expect(first.state.audit.every((item) => item.tenantId === T1 && item.actor && item.at)).toBe(true);
    expect(JSON.stringify(first.state.audit)).not.toMatch(/@/);
    const bad = reduceRouter(first.state, { ...base(), at: at(9), type: "payment.approve", operationId: "op_9999" });
    expect(bad.state.audit).toHaveLength(2);
  });
  it("is deterministic", () => {
    const events: RouterEvent[] = [{ ...base(), at: at(), type: "payment.request", input: { ...input("membershipCharge", 10_000), idempotencyKey: "fixed-key-0001" } }, { ...base(T1, "system"), at: at(1), type: "payment.process", operationId: "op_0001" }];
    expect(JSON.stringify(applyRouterEvents(newRouterState(), events))).toBe(JSON.stringify(applyRouterEvents(newRouterState(), events)));
  });
});

describe("it goes through the Event Bus and the central audit without touching the Backend Core", () => {
  const bridge: Bridge<RouterState, RouterEvent, ReturnType<typeof reduceRouter>> = {
    id: "financial-router", label: "Financial Router", modules: ["billing"], reduce: reduceRouter,
    streams: (state) => [{ name: "audit", module: "billing", entries: state.audit }], tenantOf: (event) => event.tenantId, actorOf: (event) => event.actor, typeOf: (event) => event.type,
  };
  it("publishes every accepted event on the bus under its company, audits it and covers every audit record", async () => {
    let clock = Date.parse("2026-11-10T12:00:00.000Z");
    const core = createBackendCore({ vars: { KYNOVA_ENCRYPTION_KEY: generateEncryptionKey(), KYNOVA_HASH_PEPPER: "p".repeat(40) }, now: () => (clock += 7), clock: () => new Date((clock += 7)).toISOString() });
    const connector = new Connector(core, bridge, newStats());
    let state = newRouterState();
    const go = async (event: RouterEvent) => { const result = await connector.reduce(state, event); state = result.state; return result; };
    await go({ ...base(T1), at: at(), type: "payment.request", input: { ...input("membershipCharge", 10_000), idempotencyKey: "bus-key-0001" } });
    await go({ ...base(T1, "system"), at: at(1), type: "payment.process", operationId: "op_0001" });
    const bad = await go({ ...base(T1, "worker:nex"), at: at(2), type: "payment.approve", operationId: "op_0001" });
    expect(bad.error).toBeDefined();
    await go({ ...base(T2), at: at(3), type: "payment.request", input: { ...input("membershipCharge", 5_000), idempotencyKey: "bus-key-0002" } });
    const events = (await core.events()).store.read({ tenantId: T1, after: 0, limit: 1_000 });
    expect(events.map((item) => item.payload["action"])).toEqual(["payment.request", "payment.process"]);
    expect(events.every((item) => item.tenantId === T1)).toBe(true);
    expect((await core.events()).store.read({ tenantId: T2, after: 0, limit: 1_000 })).toHaveLength(1);
    expect(await verifyCoverage(core, T1)).toMatchObject({ ok: true });
    expect(await verifyCoverage(core, T2)).toMatchObject({ ok: true });
  });
});

describe("it respects the RLS design of the platform", () => {
  const columns = ["id:uuid", "tenant_id:uuid", "created_at:timestamptz"].map((spec) => { const [name, type] = spec.split(":"); return { name: name!, type: type as "uuid", nullable: false, pii: false }; });
  const entities: Entity[] = ROUTER_TABLES.map((item) => ({ table: item.table, module: "billing" as const, scope: "tenant" as const, status: "planned" as const, rls: "read" as const, appendOnly: item.appendOnly, columns, description: "financial router" }));
  it("describes six company tables whose policies filter by company, with attempts, credits and the trail append-only", () => {
    expect(ROUTER_TABLES.map((item) => item.table)).toEqual(["router_configs", "router_operations", "router_attempts", "router_breakers", "router_credits", "router_audit"]);
    expect(auditPolicies(entities)).toEqual([]);
    expect(ROUTER_TABLES.filter((item) => item.appendOnly).map((item) => item.table)).toEqual(["router_attempts", "router_credits", "router_audit"]);
  });
  it("gives every record of the state its company", () => {
    const state = run(configure(newRouterState(), { policy: "cost" }), input("membershipCharge", 10_000)).state;
    for (const list of [state.configs, state.operations, state.audit]) { expect(list.length).toBeGreaterThan(0); expect((list as readonly { tenantId: string }[]).every((item) => item.tenantId === T1)).toBe(true); }
  });
});

describe("it connects to nothing, and no module bypasses it", () => {
  const source = readFileSync(join(process.cwd(), "lib/contracts/platform/financial-router.ts"), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  it("imports only platform contracts, makes no network call and reads no secret", () => {
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(imports.every((item) => item.startsWith("./"))).toBe(true);
    expect(imports.filter((item) => /gateway|koe-ai|agent|lib\/ai|backend|\/db/.test(item))).toEqual([]);
    expect(source).not.toMatch(/\bfetch\(|process\.env|XMLHttpRequest|WebSocket|apiKey|api_key|secret/i);
  });
  it("is the only place in the platform that names the seven payment providers as adapters", () => {
    const folder = join(process.cwd(), "lib/contracts/platform");
    const names = /\b(makapay|payoneer|osmo|applePay|googlePay)\b/;
    const others = ["billing-center.ts", "billing-catalog.ts", "partners.ts", "marketplace-center.ts", "payments.ts"].filter((file) => /new PaymentAdapter|implements PaymentAdapter/.test(readFileSync(join(folder, file), "utf8")));
    expect(others).toEqual([]);
    expect(names.test(source)).toBe(true);
  });
});
