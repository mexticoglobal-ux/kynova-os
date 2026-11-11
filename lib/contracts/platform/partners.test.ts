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
  ACTIVE_TIERS, PARTNER_RULES, PARTNER_TABLES, PAYOUT_RAILS, RAIL_IDS, TIERS, applyPartnerEvents, availableMicros, membershipEventsFromBilling, newPartnerState, partnerDashboard, programSummary, reducePartners,
  type PartnerEvent, type PartnerState,
} from "./partners";

const KYN = "tenant-kynova";
const NOVA = "tenant-nova";
const USD = 1_000_000;
const t0 = Date.parse("2026-11-01T10:00:00.000Z");
const at = (days = 0, hours = 0) => new Date(t0 + days * 86_400_000 + hours * 3_600_000).toISOString();
const base = (tenantId = KYN, actor = "jeffrey") => ({ tenantId, actor });

/** A program with an owner, a second administrator and one approved partner (Registered, 7 %). */
function world(tenantId = KYN, prefix = "", from: PartnerState = newPartnerState()) {
  const events: PartnerEvent[] = [
    { ...base(tenantId, "jeffrey"), at: at(), type: "program.create" },
    { ...base(tenantId, "jeffrey"), at: at(), type: "program.admin", userId: "valeria", enabled: true },
    { ...base(tenantId, `${prefix}ana`), at: at(), type: "partner.register", name: "Ana Partner", email: `ana@${prefix}partner.test`, kind: "person" },
  ];
  let { state, errors } = applyPartnerEvents(from, events);
  expect(errors).toEqual([]);
  const partner = state.partners.filter((item) => item.tenantId === tenantId).at(-1)!;
  ({ state, errors } = applyPartnerEvents(state, [{ ...base(tenantId, "jeffrey"), at: at(), type: "partner.approve", partnerId: partner.id }]));
  expect(errors).toEqual([]);
  return { state, partner: state.partners.find((item) => item.id === partner.id)! };
}
const send = (state: PartnerState, event: PartnerEvent): PartnerState => { const result = reducePartners(state, event); expect(result.error, result.error).toBeUndefined(); return result.state; };
const refused = (state: PartnerState, event: PartnerEvent): string => { const result = reducePartners(state, event); expect(result.error, `${event.type} should be refused`).toBeDefined(); expect(result.state).toBe(state); return result.errorCode ?? ""; };
const refer = (state: PartnerState, code: string, ref: string, name = "Cliente Uno", email = `${ref}@cliente.test`, tenantId = KYN): PartnerState => send(state, { ...base(tenantId, "system"), at: at(0, 1), type: "referral.signup", code, clientRef: ref, name, email });
const paid = (state: PartnerState, ref: string, invoiceId: string, amount: number, when: string, planId = "starter", tenantId = KYN): PartnerState => send(state, { ...base(tenantId, "system"), at: when, type: "membership.paid", clientRef: ref, invoiceId, planId, amountMicros: amount, periodStart: when });

describe("the catalog", () => {
  it("has the six tiers: Registered 7 %, Silver 9 %, Gold 12 %, and Platinum, Diamond and Elite defined but locked", () => {
    expect(TIERS.map((item) => `${item.id}:${item.bps}:${item.locked}`)).toEqual(["registered:700:false", "silver:900:false", "gold:1200:false", "platinum:null:true", "diamond:null:true", "elite:null:true"]);
    expect(ACTIVE_TIERS.map((item) => item.id)).toEqual(["registered", "silver", "gold"]);
  });
  it("sets the rules: USD 100 minimum, 15 days of validation", () => {
    expect(PARTNER_RULES).toMatchObject({ minPayoutMicros: 100 * USD, validationDays: 15, defaultTier: "registered" });
  });
  it("declares MakaPay, Payoneer, PayPal, Stripe and Osmo as interfaces that are NOT connected", () => {
    expect(RAIL_IDS).toEqual(["manual", "makapay", "payoneer", "paypal", "stripe", "osmo"]);
    for (const rail of PAYOUT_RAILS.filter((item) => item.id !== "manual")) { expect(rail.connected, rail.id).toBe(false); expect(typeof rail.prepare).toBe("function"); }
    expect(PAYOUT_RAILS.find((item) => item.id === "manual")?.connected).toBe(true);
  });
});

describe("the partner: registration, code, link and state", () => {
  it("registers a partner as pending with a unique code and link, and an administrator approves it", () => {
    let { state } = world();
    const ana = state.partners[0]!;
    expect(ana).toMatchObject({ status: "active", tierId: "registered", decidedBy: "jeffrey" });
    expect(ana.code).toMatch(/^[A-Z]{2,4}-[A-Z0-9]{4}$/);
    expect(ana.link).toBe(`https://kynova.example/r/${ana.code}`);
    state = send(state, { ...base(KYN, "bruno"), at: at(), type: "partner.register", name: "Ana Partner", email: "bruno@partner.test", kind: "company" });
    const codes = state.partners.map((item) => item.code);
    expect(new Set(codes).size).toBe(2);
    expect(state.partners[1]!.status).toBe("pending");
  });
  it("refuses a duplicate email, a bad email, a worker as applicant, and approval by a non-administrator or by NEX", () => {
    const { state, partner } = world();
    expect(refused(state, { ...base(KYN, "otro"), at: at(), type: "partner.register", name: "Otra", email: "ANA@partner.test", kind: "person" })).toBe("duplicate");
    expect(refused(state, { ...base(KYN, "otro"), at: at(), type: "partner.register", name: "Otra", email: "mal", kind: "person" })).toBe("invalid");
    expect(refused(state, { ...base(KYN, "worker:nex"), at: at(), type: "partner.register", name: "NEX", email: "nex@x.test", kind: "person" })).toBe("personRequired");
    const pending = send(state, { ...base(KYN, "otro"), at: at(), type: "partner.register", name: "Otra Persona", email: "otra@x.test", kind: "person" });
    const target = pending.partners.at(-1)!;
    expect(refused(pending, { ...base(KYN, "worker:nex"), at: at(), type: "partner.approve", partnerId: target.id })).toBe("personRequired");
    expect(refused(pending, { ...base(KYN, "intruso"), at: at(), type: "partner.approve", partnerId: target.id })).toBe("forbidden");
    expect(refused(pending, { ...base(KYN, "jeffrey"), at: at(), type: "partner.approve", partnerId: partner.id })).toBe("invalidTransition");
  });
  it("moves a partner through suspended, reinstated and closed, and a suspended partner earns nothing new", () => {
    const start = world();
    let state = start.state;
    const partner = start.partner;
    state = refer(state, partner.code, "c1");
    state = send(state, { ...base(), at: at(1), type: "partner.suspend", partnerId: partner.id, reason: "revisión" });
    expect(state.partners[0]!.status).toBe("suspended");
    expect(refused(state, { ...base(), at: at(1), type: "referral.click", code: partner.code })).toBe("codeUnknown");
    state = paid(state, "c1", "inv-1", 100 * USD, at(2));
    expect(state.commissions).toEqual([]);
    expect(state.clients[0]!.status).toBe("active");
    state = send(state, { ...base(), at: at(3), type: "partner.reinstate", partnerId: partner.id });
    state = send(state, { ...base(), at: at(4), type: "partner.close", partnerId: partner.id, reason: "fin" });
    expect(state.partners[0]!.status).toBe("closed");
    expect(refused(state, { ...base(), at: at(5), type: "partner.reinstate", partnerId: partner.id })).toBe("invalidTransition");
  });
  it("sets the active tiers and refuses the locked ones", () => {
    const start = world();
    let state = start.state;
    const partner = start.partner;
    state = send(state, { ...base(), at: at(), type: "partner.setTier", partnerId: partner.id, tierId: "gold" });
    expect(state.partners[0]!.tierId).toBe("gold");
    for (const tier of ["platinum", "diamond", "elite"]) expect(refused(state, { ...base(), at: at(), type: "partner.setTier", partnerId: partner.id, tierId: tier })).toBe("tierLocked");
    expect(refused(state, { ...base(), at: at(), type: "partner.setTier", partnerId: partner.id, tierId: "nope" })).toBe("invalid");
    expect(refused(state, { ...base(KYN, "worker:nex"), at: at(), type: "partner.setTier", partnerId: partner.id, tierId: "silver" })).toBe("personRequired");
  });
});

describe("tracking and conversion of referrals", () => {
  it("follows the funnel: click, signup, then conversion on the first paid membership", () => {
    const start = world();
    let state = start.state;
    const partner = start.partner;
    state = send(state, { ...base(KYN, "system"), at: at(0, 1), type: "referral.click", code: partner.code, deviceId: "d1" });
    state = refer(state, partner.code, "c1", "Hotel Mar");
    expect(partnerDashboard(state, KYN, partner.id)!.funnel).toMatchObject({ clicks: 1, signups: 1, converted: 0, conversionPercent: 0 });
    expect(state.clients[0]!.status).toBe("signedUp");
    state = paid(state, "c1", "inv-1", 149 * USD, at(1), "professional");
    expect(state.clients[0]).toMatchObject({ status: "active", planId: "professional", convertedAt: at(1) });
    expect(partnerDashboard(state, KYN, partner.id)!.funnel).toMatchObject({ converted: 1, conversionPercent: 100 });
  });
  it("refuses an unknown code, a company referred twice, and rejects a self-referral by the partner's own email", () => {
    const { state, partner } = world();
    expect(refused(state, { ...base(KYN, "system"), at: at(), type: "referral.signup", code: "ZZ-0000", clientRef: "c", name: "Cliente", email: "c@c.test" })).toBe("codeUnknown");
    const one = refer(state, partner.code, "c1");
    expect(refused(one, { ...base(KYN, "system"), at: at(), type: "referral.signup", code: partner.code, clientRef: "c1", name: "Cliente", email: "z@z.test" })).toBe("alreadyReferred");
    const self = refer(state, partner.code, "c2", "Ana Propia", "ana@partner.test");
    expect(self.clients[0]).toMatchObject({ status: "rejected", signals: ["sameEmail"] });
    expect(refused(self, { ...base(KYN, "system"), at: at(), type: "membership.paid", clientRef: "c2", invoiceId: "i", planId: "starter", amountMicros: USD, periodStart: at() })).toBe("invalidTransition");
    expect(partnerDashboard(self, KYN, partner.id)!.funnel.rejected).toBe(1);
  });
});

describe("recurring monthly commissions on the membership paid", () => {
  it("applies 7 %, 9 % and 12 % to what the customer paid, with the rate of that day", () => {
    for (const [tier, expected] of [["registered", 7_000_000], ["silver", 9_000_000], ["gold", 12_000_000]] as const) {
      const start = world();
    let state = start.state;
    const partner = start.partner;
      state = send(state, { ...base(), at: at(), type: "partner.setTier", partnerId: partner.id, tierId: tier });
      state = refer(state, partner.code, "c1");
      state = paid(state, "c1", "inv-1", 100 * USD, at(1));
      expect(state.commissions[0], tier).toMatchObject({ baseMicros: 100 * USD, amountMicros: expected, status: "validating", validUntil: at(16) });
      state = send(state, { ...base(), at: at(2), type: "partner.setTier", partnerId: partner.id, tierId: "gold" });
      expect(state.commissions[0]!.amountMicros, `${tier} unchanged by a later tier change`).toBe(expected);
    }
  });
  it("pays a commission every month while the customer stays active, never twice for the same invoice", () => {
    const start = world();
    let state = start.state;
    const partner = start.partner;
    state = refer(state, partner.code, "c1");
    for (const month of [1, 2, 3]) state = paid(state, "c1", `inv-${month}`, 399 * USD, at(30 * month), "business");
    expect(state.commissions.map((item) => item.amountMicros)).toEqual([27_930_000, 27_930_000, 27_930_000]);
    expect(refused(state, { ...base(KYN, "system"), at: at(91), type: "membership.paid", clientRef: "c1", invoiceId: "inv-3", planId: "business", amountMicros: 399 * USD, periodStart: at(90) })).toBe("duplicate");
    expect(partnerDashboard(state, KYN, partner.id)!.commissions.recurringMonthlyMicros).toBe(27_930_000);
  });
  it("recalculates the commission when the customer changes plan: in place while validating, as a correction after", () => {
    const start = world();
    let state = start.state;
    const partner = start.partner;
    state = refer(state, partner.code, "c1");
    state = paid(state, "c1", "inv-1", 49 * USD, at(1), "starter");
    state = send(state, { ...base(KYN, "system"), at: at(3), type: "membership.planChanged", clientRef: "c1", toPlanId: "professional", monthlyMicros: 149 * USD, currentPeriodPaidMicros: 149 * USD });
    expect(state.commissions[0]).toMatchObject({ baseMicros: 149 * USD, amountMicros: 10_430_000, status: "validating" });
    expect(state.commissions[0]!.history.map((item) => item.reason)).toEqual(["alta", "cambio de plan a professional"]);
    expect(state.clients[0]).toMatchObject({ planId: "professional", monthlyMicros: 149 * USD });
    expect(state.adjustments).toEqual([]);
    state = send(state, { ...base(KYN, "system"), at: at(20), type: "validation.run" });
    expect(state.commissions[0]!.status).toBe("approved");
    state = send(state, { ...base(KYN, "system"), at: at(21), type: "membership.planChanged", clientRef: "c1", toPlanId: "business", monthlyMicros: 399 * USD, currentPeriodPaidMicros: 399 * USD });
    expect(state.adjustments).toHaveLength(1);
    expect(state.adjustments[0]!.amountMicros).toBe(27_930_000 - 10_430_000);
    expect(availableMicros(state, KYN, partner.id)).toBe(27_930_000);
    state = paid(state, "c1", "inv-2", 399 * USD, at(31), "business");
    expect(state.commissions.at(-1)!.amountMicros).toBe(27_930_000);
  });
  it("pauses the commission when the subscription stops being paid and resumes it when it pays again; a cancellation ends it", () => {
    const start = world();
    let state = start.state;
    const partner = start.partner;
    state = refer(state, partner.code, "c1");
    state = paid(state, "c1", "inv-1", 100 * USD, at(1));
    state = send(state, { ...base(KYN, "system"), at: at(32), type: "membership.lapsed", clientRef: "c1" });
    expect(state.clients[0]!.status).toBe("paused");
    expect(partnerDashboard(state, KYN, partner.id)!.clients.paused).toBe(1);
    expect(partnerDashboard(state, KYN, partner.id)!.commissions.recurringMonthlyMicros).toBe(0);
    expect(refused(state, { ...base(KYN, "system"), at: at(33), type: "membership.lapsed", clientRef: "c1" })).toBe("invalidTransition");
    expect(state.commissions).toHaveLength(1);
    state = paid(state, "c1", "inv-2", 100 * USD, at(40));
    expect(state.clients[0]!.status).toBe("active");
    expect(state.commissions).toHaveLength(2);
    state = send(state, { ...base(KYN, "system"), at: at(60), type: "membership.cancelled", clientRef: "c1" });
    expect(state.clients[0]).toMatchObject({ status: "churned", endedAt: at(60) });
    expect(partnerDashboard(state, KYN, partner.id)!.commissions.recurringMonthlyMicros).toBe(0);
  });
});

describe("the validation window, reversals and the payout", () => {
  it("keeps a commission in validation for 15 days and approves it only after", () => {
    const start = world();
    let state = start.state;
    const partner = start.partner;
    state = refer(state, partner.code, "c1");
    state = paid(state, "c1", "inv-1", 1_000 * USD, at(1));
    state = send(state, { ...base(KYN, "system"), at: at(15), type: "validation.run" });
    expect(state.commissions[0]!.status).toBe("validating");
    expect(availableMicros(state, KYN, partner.id)).toBe(0);
    state = send(state, { ...base(KYN, "system"), at: at(16), type: "validation.run" });
    expect(state.commissions[0]).toMatchObject({ status: "approved", validatedAt: at(16) });
    expect(availableMicros(state, KYN, partner.id)).toBe(70 * USD);
  });
  it("voids a commission refunded inside the window, and recovers one already approved or paid", () => {
    const start = world();
    let state = start.state;
    const partner = start.partner;
    state = refer(state, partner.code, "c1");
    state = paid(state, "c1", "inv-1", 100 * USD, at(1));
    state = paid(state, "c1", "inv-2", 100 * USD, at(2));
    state = send(state, { ...base(KYN, "system"), at: at(5), type: "payment.reversed", invoiceId: "inv-1", kind: "refund" });
    expect(state.commissions[0]).toMatchObject({ status: "voided", voidReason: "refund de inv-1" });
    expect(refused(state, { ...base(KYN, "system"), at: at(6), type: "payment.reversed", invoiceId: "inv-1", kind: "refund" })).toBe("invalidTransition");
    expect(state.clients[0]!.status).toBe("active");
    state = send(state, { ...base(KYN, "system"), at: at(20), type: "validation.run" });
    expect(state.commissions[1]!.status).toBe("approved");
    state = send(state, { ...base(KYN, "system"), at: at(21), type: "payment.reversed", invoiceId: "inv-2", kind: "chargeback" });
    expect(state.commissions[1]!.status).toBe("voided");
    expect(state.clients[0]!.status).toBe("paused");
  });
  it("refuses a withdrawal under USD 100 and allows it at USD 100 or more, requested by the partner or an administrator", () => {
    const start = world();
    let state = start.state;
    const partner = start.partner;
    state = refer(state, partner.code, "c1");
    state = paid(state, "c1", "inv-1", 1_000 * USD, at(1));
    state = send(state, { ...base(KYN, "system"), at: at(20), type: "validation.run" });
    expect(availableMicros(state, KYN, partner.id)).toBe(70 * USD);
    expect(refused(state, { ...base(KYN, "ana"), at: at(21), type: "payout.request", partnerId: partner.id })).toBe("belowMinimum");
    expect(partnerDashboard(state, KYN, partner.id)!.balance).toMatchObject({ canRequest: false, missingMicros: 30 * USD });
    state = paid(state, "c1", "inv-2", 500 * USD, at(22));
    state = send(state, { ...base(KYN, "system"), at: at(40), type: "validation.run" });
    expect(availableMicros(state, KYN, partner.id)).toBe(105 * USD);
    expect(refused(state, { ...base(KYN, "intruso"), at: at(41), type: "payout.request", partnerId: partner.id })).toBe("forbidden");
    expect(refused(state, { ...base(KYN, "worker:nex"), at: at(41), type: "payout.request", partnerId: partner.id })).toBe("personRequired");
    state = send(state, { ...base(KYN, "ana"), at: at(41), type: "payout.request", partnerId: partner.id });
    expect(state.payouts[0]).toMatchObject({ status: "requested", amountMicros: 105 * USD, requestedBy: "ana" });
    expect(availableMicros(state, KYN, partner.id)).toBe(0);
    expect(refused(state, { ...base(KYN, "ana"), at: at(42), type: "payout.request", partnerId: partner.id })).toBe("payoutOpen");
  });
  it("needs a different person to approve and a third to mark it paid, and refuses every unconnected rail", () => {
    const start = world();
    let state = start.state;
    const partner = start.partner;
    state = refer(state, partner.code, "c1");
    state = paid(state, "c1", "inv-1", 2_000 * USD, at(1));
    state = send(state, { ...base(KYN, "system"), at: at(20), type: "validation.run" });
    state = send(state, { ...base(KYN, "valeria"), at: at(21), type: "payout.request", partnerId: partner.id });
    expect(refused(state, { ...base(KYN, "valeria"), at: at(22), type: "payout.approve", payoutId: state.payouts[0]!.id })).toBe("samePerson");
    expect(refused(state, { ...base(KYN, "ana"), at: at(22), type: "payout.approve", payoutId: state.payouts[0]!.id })).toBe("forbidden");
    expect(refused(state, { ...base(KYN, "worker:nex"), at: at(22), type: "payout.approve", payoutId: state.payouts[0]!.id })).toBe("personRequired");
    state = send(state, { ...base(KYN, "jeffrey"), at: at(22), type: "payout.approve", payoutId: state.payouts[0]!.id });
    for (const rail of ["makapay", "payoneer", "paypal", "stripe", "osmo"]) expect(refused(state, { ...base(KYN, "bruno-admin"), at: at(23), type: "payout.markPaid", payoutId: state.payouts[0]!.id, rail, reference: "REF-0001" })).toBe("forbidden");
    state = send(state, { ...base(KYN, "jeffrey"), at: at(23), type: "program.admin", userId: "carlos", enabled: true });
    for (const rail of ["makapay", "payoneer", "paypal", "stripe", "osmo"]) expect(refused(state, { ...base(KYN, "carlos"), at: at(23), type: "payout.markPaid", payoutId: state.payouts[0]!.id, rail, reference: "REF-0001" })).toBe("railNotConnected");
    expect(refused(state, { ...base(KYN, "jeffrey"), at: at(23), type: "payout.markPaid", payoutId: state.payouts[0]!.id, rail: "manual", reference: "TRF-1" })).toBe("samePerson");
    state = send(state, { ...base(KYN, "carlos"), at: at(24), type: "payout.markPaid", payoutId: state.payouts[0]!.id, rail: "manual", reference: "TRF-2026-0001" });
    expect(state.payouts[0]).toMatchObject({ status: "paid", rail: "manual", reference: "TRF-2026-0001", paidBy: "carlos" });
    expect(state.commissions[0]!.status).toBe("paid");
    expect(programSummary(state, KYN).paidOutMicros).toBe(140 * USD);
  });
  it("returns the commissions to the balance when a payout is rejected", () => {
    const start = world();
    let state = start.state;
    const partner = start.partner;
    state = refer(state, partner.code, "c1");
    state = paid(state, "c1", "inv-1", 2_000 * USD, at(1));
    state = send(state, { ...base(KYN, "system"), at: at(20), type: "validation.run" });
    state = send(state, { ...base(KYN, "ana"), at: at(21), type: "payout.request", partnerId: partner.id });
    state = send(state, { ...base(KYN, "jeffrey"), at: at(22), type: "payout.reject", payoutId: state.payouts[0]!.id, reason: "datos incompletos" });
    expect(state.payouts[0]!.status).toBe("rejected");
    expect(availableMicros(state, KYN, partner.id)).toBe(140 * USD);
  });
  it("recovers a late chargeback from the next payout", () => {
    const start = world();
    let state = start.state;
    const partner = start.partner;
    state = refer(state, partner.code, "c1");
    state = paid(state, "c1", "inv-1", 2_000 * USD, at(1));
    state = send(state, { ...base(KYN, "system"), at: at(20), type: "validation.run" });
    state = send(state, { ...base(KYN, "ana"), at: at(21), type: "payout.request", partnerId: partner.id });
    state = send(state, { ...base(KYN, "system"), at: at(22), type: "payment.reversed", invoiceId: "inv-1", kind: "fraud" });
    expect(state.adjustments[0]).toMatchObject({ amountMicros: -140 * USD, commissionId: state.commissions[0]!.id });
    expect(availableMicros(state, KYN, partner.id)).toBe(-140 * USD);
  });
});

describe("histories and the partner dashboard", () => {
  it("gives the partner its status, rate, funnel, customers with their state, commissions, balance and payments", () => {
    const start = world();
    let state = start.state;
    const partner = start.partner;
    state = send(state, { ...base(), at: at(), type: "partner.setTier", partnerId: partner.id, tierId: "silver" });
    state = send(state, { ...base(KYN, "system"), at: at(0, 1), type: "referral.click", code: partner.code });
    state = refer(state, partner.code, "c1", "Hotel Mar");
    state = refer(state, partner.code, "c2", "Café Aurora");
    state = refer(state, partner.code, "c3", "Boutique Luna");
    state = paid(state, "c1", "inv-1", 1_000 * USD, at(1), "business");
    state = paid(state, "c2", "inv-2", 1_000 * USD, at(1), "business");
    state = send(state, { ...base(KYN, "system"), at: at(40), type: "membership.lapsed", clientRef: "c2" });
    state = send(state, { ...base(KYN, "system"), at: at(40), type: "validation.run" });
    const dashboard = partnerDashboard(state, KYN, partner.id)!;
    expect(dashboard.partner).toMatchObject({ status: "active", tier: "silver", ratePercent: 9, nextTier: "gold", code: partner.code });
    expect(dashboard.funnel).toMatchObject({ clicks: 1, signups: 3, converted: 2, conversionPercent: 67 });
    expect(dashboard.clients).toMatchObject({ active: 1, paused: 1, signedUp: 1, churned: 0 });
    expect(dashboard.clients.list.map((item) => `${item.name}:${item.status}`)).toEqual(["Hotel Mar:active", "Café Aurora:paused", "Boutique Luna:signedUp"]);
    expect(dashboard.commissions).toMatchObject({ approvedMicros: 180 * USD, validatingMicros: 0, paidMicros: 0, recurringMonthlyMicros: 90 * USD });
    expect(dashboard.commissions.list).toHaveLength(2);
    expect(dashboard.balance).toMatchObject({ availableMicros: 180 * USD, canRequest: true, minimumMicros: 100 * USD, missingMicros: 0 });
    expect(dashboard.payouts).toEqual([]);
    expect(partnerDashboard(state, KYN, "pt_9999")).toBeNull();
  });
});

describe("Billing is the only source of what a customer paid", () => {
  const billingAt = (day: number) => new Date(Date.parse("2026-10-01T10:00:00.000Z") + day * 86_400_000).toISOString();
  function billingWorld() {
    let billing = newBillingState();
    const go = (event: BillingEvent) => { const result = reduceBilling(billing, event); expect(result.error, result.error).toBeUndefined(); billing = result.state; };
    go({ tenantId: NOVA, actor: "system", at: billingAt(0), type: "account.create", ownerId: "ana", planId: "professional" });
    go({ tenantId: NOVA, actor: "ana", at: billingAt(1), type: "billing.setAdmin", userId: "pablo", enabled: true });
    go({ tenantId: NOVA, actor: "pablo", at: billingAt(29), type: "renewal.run" });
    const invoice = billing.invoices.find((item) => item.tenantId === NOVA)!;
    go({ tenantId: NOVA, actor: "pablo", at: billingAt(30), type: "payment.record", invoiceId: invoice.id, amountMicros: invoice.totalMicros, method: "simulatedCard" });
    return { billing, invoice };
  }
  it("turns a real payment into a commission, and an overdue invoice into a pause, without Billing changing", () => {
    const { billing, invoice } = billingWorld();
    const before = JSON.stringify(billing);
    const start = world();
    let state = start.state;
    const partner = start.partner;
    state = refer(state, partner.code, NOVA, "Nova Marketing Studio");
    const events = membershipEventsFromBilling(billing, { programTenantId: KYN, clientTenantId: NOVA, clientRef: NOVA, asOf: billingAt(35) });
    expect(events.map((item) => item.type)).toEqual(["membership.paid"]);
    const applied = applyPartnerEvents(state, events);
    expect(applied.errors).toEqual([]);
    expect(applied.state.commissions[0]).toMatchObject({ invoiceId: invoice.id, baseMicros: invoice.totalMicros, amountMicros: Math.floor((invoice.totalMicros * 700) / 10_000) });
    expect(JSON.stringify(billing)).toBe(before);
    const unpaid = { ...billing, payments: [] };
    const lapsed = membershipEventsFromBilling(unpaid, { programTenantId: KYN, clientTenantId: NOVA, clientRef: NOVA, asOf: billingAt(120) });
    expect(lapsed.map((item) => item.type)).toEqual(["membership.lapsed"]);
    expect(membershipEventsFromBilling(billing, { programTenantId: KYN, clientTenantId: "tenant-otra", clientRef: "x", asOf: billingAt(35) })).toEqual([]);
  });
});

describe("every company's program stays its own, and every step is audited", () => {
  it("keeps two companies' partners, customers, commissions and money apart, and refuses events across them", () => {
    const a = world(KYN, "a-");
    const b = world(NOVA, "b-", a.state);
    expect(b.partner.id).not.toBe(a.partner.id);
    let state: PartnerState = b.state;
    state = refer(state, a.partner.code, "c1", "Cliente A", "a@x.test", KYN);
    state = paid(state, "c1", "inv-1", 1_000 * USD, at(1));
    expect(refused(state, { ...base(NOVA, "system"), at: at(1), type: "membership.paid", clientRef: "c1", invoiceId: "inv-9", planId: "starter", amountMicros: USD, periodStart: at() })).toBe("notFound");
    expect(refused(state, { ...base(NOVA, "jeffrey"), at: at(1), type: "partner.suspend", partnerId: a.partner.id, reason: "x" })).toBe("notFound");
    expect(refused(state, { ...base(NOVA, "system"), at: at(1), type: "referral.signup", code: a.partner.code, clientRef: "z", name: "Zeta", email: "z@z.test" })).toBe("codeUnknown");
    expect(partnerDashboard(state, NOVA, a.partner.id)).toBeNull();
    expect(programSummary(state, NOVA)).toMatchObject({ clientsActive: 0, liabilityMicros: 0 });
    expect(programSummary(state, KYN).liabilityMicros).toBe(70 * USD);
    expect(refused(state, { tenantId: "", actor: "jeffrey", at: at(), type: "validation.run" })).toBe("tenantRequired");
    expect(refused(newPartnerState(), { ...base(), at: at(), type: "partner.register", name: "Ana", email: "a@a.test", kind: "person" })).toBe("noProgram");
    expect(state.audit.filter((item) => item.tenantId === NOVA).every((item) => item.actor !== "system")).toBe(true);
  });
  it("leaves one audit entry per accepted event, in the shape the Event Bus connector reads, and none for a refused one", () => {
    const { state, partner } = world();
    const events = state.audit.length;
    expect(state.audit.every((item) => item.tenantId === KYN && item.actor && item.action && item.at)).toBe(true);
    const next = send(state, { ...base(KYN, "system"), at: at(1), type: "referral.click", code: partner.code });
    expect(next.audit).toHaveLength(events + 1);
    expect(next.audit.at(-1)).toMatchObject({ action: "referral.click", actor: "system", tenantId: KYN });
    const bad = reducePartners(next, { ...base(KYN, "system"), at: at(2), type: "referral.click", code: "NO-CODE" });
    expect(bad.state.audit).toHaveLength(next.audit.length);
    expect(JSON.stringify(next.audit)).not.toMatch(/@/);
  });
  it("is deterministic", () => {
    const run = () => { const { state, partner } = world(); return paid(refer(state, partner.code, "c1"), "c1", "inv-1", 100 * USD, at(1)); };
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});

describe("it goes through the Event Bus and the central audit without touching the Backend Core", () => {
  const bridge: Bridge<PartnerState, PartnerEvent, ReturnType<typeof reducePartners>> = {
    id: "partners", label: "Partners", modules: ["billing"], reduce: reducePartners,
    streams: (state) => [{ name: "audit", module: "billing", entries: state.audit }], tenantOf: (event) => event.tenantId, actorOf: (event) => event.actor, typeOf: (event) => event.type,
  };
  it("publishes every accepted event on the bus under its company, audits it, and covers every audit record", async () => {
    let clock = Date.parse("2026-11-10T12:00:00.000Z");
    const core = createBackendCore({ vars: { KYNOVA_ENCRYPTION_KEY: generateEncryptionKey(), KYNOVA_HASH_PEPPER: "p".repeat(40) }, now: () => (clock += 7), clock: () => new Date((clock += 7)).toISOString() });
    const connector = new Connector(core, bridge, newStats());
    let state = newPartnerState();
    const run = async (event: PartnerEvent) => { const result = await connector.reduce(state, event); state = result.state; return result; };
    await run({ ...base(KYN), at: at(), type: "program.create" });
    await run({ ...base(KYN, "ana"), at: at(), type: "partner.register", name: "Ana Partner", email: "ana@p.test", kind: "person" });
    await run({ ...base(KYN), at: at(), type: "partner.approve", partnerId: state.partners[0]!.id });
    const bad = await run({ ...base(KYN, "worker:nex"), at: at(), type: "partner.setTier", partnerId: state.partners[0]!.id, tierId: "gold" });
    expect(bad.error).toBeDefined();
    await run({ ...base(NOVA), at: at(), type: "program.create" });
    const events = (await core.events()).store.read({ tenantId: KYN, after: 0, limit: 1_000 });
    expect(events.map((item) => item.payload["action"])).toEqual(["program.create", "partner.register", "partner.approve"]);
    expect(events.every((item) => item.tenantId === KYN)).toBe(true);
    expect((await core.events()).store.read({ tenantId: NOVA, after: 0, limit: 1_000 })).toHaveLength(1);
    expect((await core.audit()).list(KYN).length).toBeGreaterThanOrEqual(4);
    expect(await verifyCoverage(core, KYN)).toMatchObject({ ok: true });
    expect(await verifyCoverage(core, NOVA)).toMatchObject({ ok: true });
  });
});

describe("it respects the RLS design of the platform", () => {
  const columns = ["id:uuid", "tenant_id:uuid", "created_at:timestamptz"].map((spec) => { const [name, type] = spec.split(":"); return { name: name!, type: type as "uuid", nullable: false, pii: false }; });
  const entities: Entity[] = PARTNER_TABLES.map((item) => ({ table: item.table, module: "billing" as const, scope: "tenant" as const, status: "planned" as const, rls: "read" as const, appendOnly: item.appendOnly, columns, description: "partners" }));
  it("describes eight company tables whose policies filter by company, read for members and write only through functions", () => {
    expect(PARTNER_TABLES).toHaveLength(8);
    expect(auditPolicies(entities)).toEqual([]);
    expect(PARTNER_TABLES.filter((item) => item.appendOnly).map((item) => item.table)).toEqual(["partner_clicks", "partner_adjustments", "partner_audit"]);
  });
  it("gives every record of the state its company", () => {
    const { state, partner } = world();
    const full = paid(refer(send(state, { ...base(KYN, "system"), at: at(0, 1), type: "referral.click", code: partner.code }), partner.code, "c1"), "c1", "inv-1", 100 * USD, at(1));
    for (const list of [full.programs, full.partners, full.clicks, full.clients, full.commissions, full.audit]) expect(list.length).toBeGreaterThan(0);
    for (const list of [full.programs, full.partners, full.clicks, full.clients, full.commissions, full.audit]) expect((list as readonly { tenantId: string }[]).every((item) => item.tenantId === KYN)).toBe(true);
  });
});

describe("the module connects to nothing and adds no dependency", () => {
  const source = readFileSync(join(process.cwd(), "lib/contracts/platform/partners.ts"), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  it("imports only platform contracts, makes no network call and names no payment provider outside the rail list", () => {
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(imports.every((item) => item.startsWith("./"))).toBe(true);
    expect(source).not.toMatch(/\bfetch\(|process\.env|XMLHttpRequest|WebSocket|lib\/backend|supabase/);
    const lines = source.split("\n").filter((line) => /makapay|payoneer|paypal|stripe|osmo/i.test(line));
    expect(lines.every((line) => /RAIL_IDS|prepared\(|label/.test(line))).toBe(true);
  });
});
