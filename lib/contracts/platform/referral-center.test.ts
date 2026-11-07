import { describe, expect, it } from "vitest";
import { DEMO_PROGRAM, DEMO_TENANTS, demoReferralState } from "./referral-demo";
import { ERROR_CODES, label, message } from "./referral-messages";
import {
  BURST_LIMIT, CODE_PATTERN, PAYOUT_LEVEL, applyAllReferrals, isPerson, linkFor, makeCode, newReferralState, reduceReferrals, summarizeReferrals, validateProgram,
  type ProgramInput, type ReferralEvent, type ReferralState,
} from "./referral-center";
import { ACTION_LEVELS, decide, levelForAction } from "./workers";

const T = "tenant-nova";
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T10:00:00.000Z`;
const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });

const demo = (tenantId = T) => {
  const result = demoReferralState(tenantId);
  expect(result.errors).toEqual([]);
  return result.state;
};
const withProgram = (over: Partial<ProgramInput> = {}, tenantId = T) =>
  applyAllReferrals(newReferralState(tenantId), [{ tenantId, at: day(1), type: "program.save", actor: "ana", program: { ...DEMO_PROGRAM, ...over } }]).state;
const send = (state: ReferralState, event: ReferralEvent) => reduceReferrals(state, event);
const enroll = (state: ReferralState, name: string, email: string, extra: Partial<Extract<ReferralEvent, { type: "affiliate.enroll" }>> = {}) =>
  send(state, { tenantId: state.tenantId, at: day(1), type: "affiliate.enroll", actor: "ana", name, email, ...extra }).state;
const codeOf = (state: ReferralState, name: string) => state.affiliates.find((affiliate) => affiliate.name === name)?.code ?? "";
const click = (state: ReferralState, name: string, email: string, at = day(3), extra: { deviceId?: string } = {}) =>
  send(state, { tenantId: state.tenantId, at, type: "referral.click", code: codeOf(state, name), email, ...extra });

describe("the sample loads without a refusal and shows every state", () => {
  it("covers paid, in payout, approved, held, lost attribution and rejected sales", () => {
    const state = demo();
    const byRef = (saleRef: string) => state.commissions.find((commission) => commission.saleRef === saleRef);
    expect(byRef("S-1001")?.status).toBe("inPayout"); // Marta: approved by rule, then a payout was requested
    expect(byRef("S-1002")?.status).toBe("paid"); // Luis: a person reviewed it, a payout was approved and recorded
    expect(byRef("S-1003")?.status).toBe("held"); // Carla referred herself
    expect(byRef("S-1003")?.signals).toEqual(["sameEmail"]);
    expect(byRef("S-1004")).toMatchObject({ status: "approved", affiliateId: state.affiliates.find((a) => a.name === "Carla Mena")?.id });
    expect(state.referrals.find((r) => r.email === "norte@studio.test" && r.status === "rejected")?.rejectReason).toBe("lostAttribution");
  });

  it("summarizes the funnel, the money by status and what needs a person", () => {
    const summary = summarizeReferrals(demo());
    expect(summary.affiliates).toEqual({ total: 3, active: 3, suspended: 0 });
    expect(summary.funnel).toMatchObject({ clicks: 6, converted: 4, rejected: 1 });
    expect(summary.rates.conversion).toBeCloseTo(4 / 6);
    expect(summary.commissions).toMatchObject({ approved: 500, held: 2_000, inPayout: 1_200, paid: 9_000, pending: 0 });
    expect(summary.todo).toEqual({ toReview: 1, payoutsToDecide: 1, payoutsToPay: 0 });
    expect(summary.leaderboard[0].name).toBe("Luis Prado");
    expect(summarizeReferrals(newReferralState(T)).rates).toEqual({ signup: null, conversion: null, closing: null });
  });
});

describe("program", () => {
  it("accepts the sample and rejects what makes no sense", () => {
    expect(validateProgram(DEMO_PROGRAM)).toEqual([]);
    expect(validateProgram({ ...DEMO_PROGRAM, reward: { kind: "percent", basisPoints: 6_000, currency: "USD" } })[0]).toContain("porcentaje");
    expect(validateProgram({ ...DEMO_PROGRAM, reward: { kind: "fixed", amount: { amountMinor: 0, currency: "USD" } } })[0]).toContain("monto fijo");
    expect(validateProgram({ ...DEMO_PROGRAM, reward: { kind: "percent", basisPoints: 500, currency: "EUR" } })[0]).toContain("moneda distinta");
    expect(validateProgram({ ...DEMO_PROGRAM, currency: "BTC" })[0]).toContain("moneda");
    expect(validateProgram({ ...DEMO_PROGRAM, attributionWindowDays: 0 })[0]).toContain("ventana");
    expect(validateProgram({ ...DEMO_PROGRAM, linkBase: "http://x.test" })[0]).toContain("enlace");
    expect(validateProgram({ ...DEMO_PROGRAM, levelsEnabled: true, levels: [] })[0]).toContain("niveles");
    expect(validateProgram({ ...DEMO_PROGRAM, levels: [DEMO_PROGRAM.reward, DEMO_PROGRAM.reward, DEMO_PROGRAM.reward] })[0]).toContain("2 niveles");
  });

  it("is saved only by a person, and a finished program cannot come back", () => {
    const fresh = newReferralState(T);
    expect(send(fresh, { tenantId: T, at: day(1), type: "program.save", actor: "worker:nex", program: DEMO_PROGRAM }).errorCode).toBe("personRequired");
    const state = withProgram();
    const ended = send(state, { tenantId: T, at: day(2), type: "program.status", actor: "ana", status: "ended" }).state;
    expect(send(ended, { tenantId: T, at: day(3), type: "program.status", actor: "ana", status: "active" }).errorCode).toBe("invalidTransition");
    expect(send(ended, { tenantId: T, at: day(3), type: "program.save", actor: "ana", program: DEMO_PROGRAM }).errorCode).toBe("programInactive");
  });

  it("changing the rule later never touches a commission already earned", () => {
    let state = demo();
    const before = state.commissions.find((commission) => commission.saleRef === "S-1001")?.rule;
    state = send(state, { tenantId: T, at: day(25), type: "program.save", actor: "ana", program: { ...DEMO_PROGRAM, reward: { kind: "fixed", amount: usd(100) } } }).state;
    expect(state.commissions.find((commission) => commission.saleRef === "S-1001")?.rule).toEqual(before);
  });
});

describe("codes and links", () => {
  it("makes readable, unique, valid codes, even for 500 people with the same name", () => {
    let state = withProgram();
    for (let index = 0; index < 500; index += 1) state = enroll(state, "María José", `maria${index}@x.test`);
    const codes = state.affiliates.map((affiliate) => affiliate.code);
    expect(new Set(codes).size).toBe(500);
    expect(codes.every((code) => CODE_PATTERN.test(code))).toBe(true);
    expect(codes[0].startsWith("MARI-")).toBe(true);
  });

  it("builds the personal link from the program's base and keeps companies apart", () => {
    const state = enroll(withProgram(), "Luis Prado", "luis@x.test");
    expect(state.affiliates[0].link).toBe(`https://kynova.example/r/${state.affiliates[0].code}`);
    expect(linkFor("https://a.test/", "AB-1234")).toBe("https://a.test/r/AB-1234");
    expect(makeCode("t1", "Ana", 1)).not.toBe(makeCode("t2", "Ana", 1));
    expect(makeCode("t1", "Ana", 1)).toBe(makeCode("t1", "Ana", 1));
  });

  it("refuses a duplicate email, a bad email, a missing name and an unknown sponsor", () => {
    const state = enroll(withProgram(), "Ana", "ana@x.test");
    expect(send(state, { tenantId: T, at: day(1), type: "affiliate.enroll", actor: "a", name: "Otra", email: "ANA@x.test" }).errorCode).toBe("affiliateExists");
    expect(send(state, { tenantId: T, at: day(1), type: "affiliate.enroll", actor: "a", name: "X", email: "no" }).errorCode).toBe("emailInvalid");
    expect(send(state, { tenantId: T, at: day(1), type: "affiliate.enroll", actor: "a", name: " ", email: "x@x.test" }).errorCode).toBe("nameRequired");
    expect(send(state, { tenantId: T, at: day(1), type: "affiliate.enroll", actor: "a", name: "Y", email: "y@x.test", sponsorCode: "NOPE-0000" }).errorCode).toBe("sponsorNotFound");
    expect(send(newReferralState(T), { tenantId: T, at: day(1), type: "affiliate.enroll", actor: "a", name: "Y", email: "y@x.test" }).errorCode).toBe("noProgram");
  });
});

describe("attribution and the funnel", () => {
  const base = () => enroll(enroll(withProgram(), "Marta Solís", "marta@x.test"), "Luis Prado", "luis@x.test");

  it("moves a referral forward one step at a time", () => {
    let state = click(base(), "Marta Solís", "lead@x.test").state;
    const id = state.referrals[0].id;
    expect(send(state, { tenantId: T, at: day(4), type: "referral.qualify", referralId: id }).errorCode).toBe("invalidTransition");
    state = send(state, { tenantId: T, at: day(4), type: "referral.signup", referralId: id }).state;
    state = send(state, { tenantId: T, at: day(5), type: "referral.qualify", referralId: id }).state;
    expect(state.referrals[0]).toMatchObject({ status: "qualified", stage: 2 });
    expect(send(state, { tenantId: T, at: day(5), type: "referral.signup", referralId: id }).errorCode).toBe("invalidTransition");
  });

  it("a second click from the same person for the same affiliate is one referral with a newer touch", () => {
    let state = click(base(), "Marta Solís", "lead@x.test", day(3)).state;
    state = click(state, "Marta Solís", "LEAD@x.test", day(5)).state;
    expect(state.referrals).toHaveLength(1);
    expect(state.referrals[0].lastTouchAt).toBe(day(5));
    expect(state.touches).toHaveLength(2);
  });

  it("gives the last touch inside the window the sale, and nobody outside it", () => {
    let state = click(base(), "Marta Solís", "lead@x.test", day(2)).state;
    state = click(state, "Luis Prado", "lead@x.test", day(4)).state;
    const converted = send(state, { tenantId: T, at: day(6), type: "referral.convert", email: "lead@x.test", sale: usd(10_000), saleRef: "S-1" }).state;
    expect(converted.referrals.map((r) => r.status).sort()).toEqual(["converted", "rejected"]);
    expect(converted.commissions[0].affiliateId).toBe(converted.affiliates.find((a) => a.name === "Luis Prado")?.id);

    const late = send(state, { tenantId: T, at: "2026-12-30T10:00:00.000Z", type: "referral.convert", email: "lead@x.test", sale: usd(10_000), saleRef: "S-2" });
    expect(late.errorCode).toBe("outsideWindow");
  });

  it("expires stale referrals on a tick and ignores clicks from people who already bought", () => {
    let state = click(base(), "Marta Solís", "old@x.test", day(1)).state;
    state = send(state, { tenantId: T, at: "2026-12-30T10:00:00.000Z", type: "tick" }).state;
    expect(state.referrals[0]).toMatchObject({ status: "expired", rejectReason: "expired" });

    let sold = click(base(), "Marta Solís", "buyer@x.test").state;
    sold = send(sold, { tenantId: T, at: day(4), type: "referral.convert", email: "buyer@x.test", sale: usd(10_000), saleRef: "S-3" }).state;
    const again = click(sold, "Luis Prado", "buyer@x.test", day(5)).state;
    expect(again.referrals).toHaveLength(1);
    expect(send(sold, { tenantId: T, at: day(6), type: "referral.convert", email: "buyer@x.test", sale: usd(10_000), saleRef: "S-4" }).errorCode).toBe("alreadyConverted");
  });

  it("refuses clicks while the program is not active, on unknown codes and from suspended affiliates", () => {
    const state = base();
    const paused = send(state, { tenantId: T, at: day(2), type: "program.status", actor: "ana", status: "paused" }).state;
    expect(click(paused, "Marta Solís", "x@x.test").errorCode).toBe("programInactive");
    expect(send(state, { tenantId: T, at: day(2), type: "referral.click", code: "NOPE-0000", email: "x@x.test" }).errorCode).toBe("codeNotFound");
    const suspended = send(state, { tenantId: T, at: day(2), type: "affiliate.suspend", actor: "ana", affiliateId: state.affiliates[0].id }).state;
    expect(click(suspended, "Marta Solís", "x@x.test").errorCode).toBe("affiliateSuspended");
  });
});

describe("commissions", () => {
  const converted = (reward: ProgramInput["reward"], saleMinor: number, over: Partial<ProgramInput> = {}) => {
    let state = enroll(withProgram({ reward, ...over }), "Marta Solís", "marta@x.test");
    state = click(state, "Marta Solís", "lead@x.test").state;
    return send(state, { tenantId: T, at: day(5), type: "referral.convert", email: "lead@x.test", sale: usd(saleMinor), saleRef: "S-1" }).state;
  };

  it("pays a percentage or a fixed amount, rounded down, with a cap and a minimum sale", () => {
    expect(converted({ kind: "percent", basisPoints: 1_000, currency: "USD" }, 33_333).commissions[0].amount.amountMinor).toBe(3_333);
    expect(converted({ kind: "percent", basisPoints: 1_000, currency: "USD", capMinor: 2_000 }, 33_333).commissions[0].amount.amountMinor).toBe(2_000);
    expect(converted({ kind: "fixed", amount: usd(5_000) }, 33_333).commissions[0].amount.amountMinor).toBe(5_000);
    const small = converted({ kind: "fixed", amount: usd(5_000) }, 500);
    expect(small.commissions).toHaveLength(0); // below the minimum sale: converted, but no commission
    expect(small.referrals[0].status).toBe("converted");
  });

  it("refuses a sale in another currency, an invalid amount and a repeated sale", () => {
    let state = enroll(withProgram(), "Marta Solís", "marta@x.test");
    state = click(state, "Marta Solís", "lead@x.test").state;
    const convert = (sale: { amountMinor: number; currency: string }, saleRef = "S-1") => send(state, { tenantId: T, at: day(5), type: "referral.convert", email: "lead@x.test", sale, saleRef });
    expect(convert({ amountMinor: 1_000, currency: "EUR" }).errorCode).toBe("currencyMismatch");
    expect(convert({ amountMinor: 10.5, currency: "USD" }).errorCode).toBe("saleInvalid");
    expect(convert(usd(10_000), " ").errorCode).toBe("saleInvalid");
    const done = convert(usd(10_000)).state;
    expect(send(done, { tenantId: T, at: day(6), type: "referral.convert", email: "other@x.test", sale: usd(10_000), saleRef: "S-1" }).errorCode).toBe("saleDuplicate");
  });

  it("holds a commission when the signals say so, and releases it only after the hold and by a person", () => {
    const state = demo();
    const held = state.commissions.find((commission) => commission.saleRef === "S-1003");
    expect(held?.status).toBe("held");
    expect(reduceReferrals(state, { tenantId: T, at: day(25), type: "commission.review", actor: "worker:nex", commissionId: held?.id ?? "", approve: true }).errorCode).toBe("personRequired");
    expect(reduceReferrals(state, { tenantId: T, at: day(25), type: "commission.review", actor: "bruno", commissionId: held?.id ?? "", approve: false }).state.commissions.find((c) => c.id === held?.id)?.status).toBe("rejected");
    const early = reduceReferrals(state, { tenantId: T, at: day(8), type: "commission.review", actor: "bruno", commissionId: held?.id ?? "", approve: true });
    expect(early.errorCode).toBe("holdNotElapsed");
    const released = reduceReferrals(state, { tenantId: T, at: day(25), type: "commission.review", actor: "bruno", commissionId: held?.id ?? "", approve: true }).state;
    expect(released.commissions.find((c) => c.id === held?.id)?.status).toBe("approved");
    expect(reduceReferrals(released, { tenantId: T, at: day(26), type: "commission.review", actor: "bruno", commissionId: held?.id ?? "", approve: true }).errorCode).toBe("commissionNotReviewable");
  });

  it("approves by rule only what is small, clean and past its hold; a large sale always waits for a person", () => {
    let state = enroll(withProgram(), "Marta Solís", "marta@x.test");
    state = click(state, "Marta Solís", "small@x.test").state;
    state = send(state, { tenantId: T, at: day(4), type: "referral.convert", email: "small@x.test", sale: usd(10_000), saleRef: "S-S" }).state;
    state = click(state, "Marta Solís", "big@x.test").state;
    state = send(state, { tenantId: T, at: day(4), type: "referral.convert", email: "big@x.test", sale: usd(900_000), saleRef: "S-B" }).state;
    const early = send(state, { tenantId: T, at: day(6), type: "tick" }).state;
    expect(early.commissions.map((c) => c.status)).toEqual(["pending", "pending"]); // still inside the 7-day hold
    const later = send(state, { tenantId: T, at: day(20), type: "tick" }).state;
    expect(later.commissions.map((c) => c.status)).toEqual(["approved", "pending"]);
  });

  it("flags an affiliate's burst of referrals, the same device and the same email", () => {
    let state = withProgram();
    state = enroll(state, "Marta Solís", "marta@x.test", { deviceId: "dev-1" });
    for (let index = 0; index < BURST_LIMIT; index += 1) state = click(state, "Marta Solís", `lead${index}@x.test`, day(3), { deviceId: index === 0 ? "dev-1" : undefined }).state;
    state = send(state, { tenantId: T, at: day(5), type: "referral.convert", email: "lead0@x.test", sale: usd(10_000), saleRef: "S-D" }).state;
    expect(state.commissions[0].signals).toEqual(expect.arrayContaining(["sameDevice", "burst"]));
    expect(state.commissions[0].status).toBe("held");
  });

  it("records a rejected commission for a suspended affiliate instead of paying it", () => {
    let state = enroll(withProgram(), "Marta Solís", "marta@x.test");
    state = click(state, "Marta Solís", "lead@x.test").state;
    state = send(state, { tenantId: T, at: day(2), type: "affiliate.suspend", actor: "ana", affiliateId: state.affiliates[0].id }).state;
    state = send(state, { tenantId: T, at: day(5), type: "referral.convert", email: "lead@x.test", sale: usd(10_000), saleRef: "S-X" }).state;
    expect(state.commissions[0]).toMatchObject({ status: "rejected", signals: ["suspendedAffiliate"] });
  });

  it("reverses a commission when the sale is refunded, but not once it is in a payout, and flags a clawback after payment", () => {
    const state = demo();
    expect(reduceReferrals(state, { tenantId: T, at: day(26), type: "sale.refunded", saleRef: "S-1001" }).errorCode).toBe("commissionInPayout");
    const approved = reduceReferrals(state, { tenantId: T, at: day(26), type: "sale.refunded", saleRef: "S-1004" }).state;
    expect(approved.commissions.find((c) => c.saleRef === "S-1004")?.status).toBe("reversed");
    const paid = reduceReferrals(state, { tenantId: T, at: day(26), type: "sale.refunded", saleRef: "S-1002" }).state;
    expect(paid.commissions.find((c) => c.saleRef === "S-1002")).toMatchObject({ status: "paid", clawback: true });
    expect(summarizeReferrals(paid).commissions.clawback).toBe(1);
    expect(reduceReferrals(state, { tenantId: T, at: day(26), type: "sale.refunded", saleRef: "nope" }).errorCode).toBe("saleNotFound");
  });
});

describe("multi-level commissions (prepared)", () => {
  const chain = (levelsEnabled: boolean) => {
    let state = withProgram({ levelsEnabled, levels: [{ kind: "percent", basisPoints: 500, currency: "USD" }, { kind: "percent", basisPoints: 200, currency: "USD" }] });
    state = enroll(state, "Abuela Ana", "a@x.test");
    state = enroll(state, "Madre Maria", "m@x.test", { sponsorCode: codeOf(state, "Abuela Ana") });
    state = enroll(state, "Hija Hilda", "h@x.test", { sponsorCode: codeOf(state, "Madre Maria") });
    state = click(state, "Hija Hilda", "lead@x.test").state;
    return send(state, { tenantId: T, at: day(5), type: "referral.convert", email: "lead@x.test", sale: usd(100_000), saleRef: "S-ML" }).state;
  };

  it("pays only the seller while levels are off (the default)", () => {
    expect(chain(false).commissions.map((c) => [c.level, c.amount.amountMinor])).toEqual([[1, 10_000]]);
  });

  it("pays two levels up the chain when switched on, with the rule of each level", () => {
    const state = chain(true);
    expect(state.commissions.map((c) => [c.level, c.amount.amountMinor])).toEqual([[1, 10_000], [2, 5_000], [3, 2_000]]);
    expect(new Set(state.commissions.map((c) => c.affiliateId)).size).toBe(3);
  });
});

describe("payouts are Level 3: requested by one person, approved by another, recorded with an external reference", () => {
  it("is Level 3 in the worker catalog, and no authorization can lower it", () => {
    expect(PAYOUT_LEVEL).toBe(3);
    expect(ACTION_LEVELS["referral.payout"]).toBe(3);
    expect(levelForAction("referral.payout")).toBe(3);
    expect(decide("referral.payout", { action: "referral.payout", status: "active" }).allowed).toBe(false);
    expect(isPerson("worker:nex")).toBe(false);
    expect(isPerson("system")).toBe(false);
    expect(isPerson("ana")).toBe(true);
  });

  const approvedFor = () => {
    // the sample asks for at least 10.00 to pay out; Carla's approved commission is 5.00, so lower the minimum for these cases
    const state = reduceReferrals(demo(), { tenantId: T, at: day(25), type: "program.save", actor: "ana", program: { ...DEMO_PROGRAM, approval: { ...DEMO_PROGRAM.approval, minPayoutMinor: 100 } } }).state;
    return { state, carla: state.affiliates.find((a) => a.name === "Carla Mena")?.id ?? "", marta: state.affiliates.find((a) => a.name === "Marta Solís")?.id ?? "" };
  };

  it("refuses a request from NEX, below the minimum, with nothing to pay or in a crypto currency", () => {
    const { state, carla } = approvedFor();
    const request = (actor: string, affiliateId: string, currency = "USD") => reduceReferrals(state, { tenantId: T, at: day(26), type: "payout.request", actor, affiliateId, currency });
    expect(request("worker:nex", carla).errorCode).toBe("personRequired");
    expect(request("ana", carla, "BTC").errorCode).toBe("currencyInvalid");
    expect(request("ana", carla, "EUR").errorCode).toBe("nothingToPay");
    const raised = reduceReferrals(state, { tenantId: T, at: day(26), type: "program.save", actor: "ana", program: { ...DEMO_PROGRAM, approval: { ...DEMO_PROGRAM.approval, minPayoutMinor: 100_000 } } }).state;
    expect(reduceReferrals(raised, { tenantId: T, at: day(27), type: "payout.request", actor: "ana", affiliateId: carla, currency: "USD" }).errorCode).toBe("payoutBelowMinimum");
  });

  it("goes request → approval by someone else → paid with a reference, and the commissions follow", () => {
    const { state, carla } = approvedFor();
    let current = reduceReferrals(state, { tenantId: T, at: day(26), type: "payout.request", actor: "ana", affiliateId: carla, currency: "USD" }).state;
    const payout = current.payouts.at(-1);
    expect(payout).toMatchObject({ status: "requested", total: usd(500) });
    expect(current.commissions.find((c) => c.saleRef === "S-1004")?.status).toBe("inPayout");
    expect(reduceReferrals(current, { tenantId: T, at: day(26), type: "payout.decide", actor: "ana", payoutId: payout?.id ?? "", approve: true }).errorCode).toBe("selfApproval");
    expect(reduceReferrals(current, { tenantId: T, at: day(26), type: "payout.decide", actor: "worker:nex", payoutId: payout?.id ?? "", approve: true }).errorCode).toBe("personRequired");
    expect(reduceReferrals(current, { tenantId: T, at: day(26), type: "payout.markPaid", actor: "bruno", payoutId: payout?.id ?? "", paymentRef: "X" }).errorCode).toBe("payoutNotApproved");
    current = reduceReferrals(current, { tenantId: T, at: day(26), type: "payout.decide", actor: "bruno", payoutId: payout?.id ?? "", approve: true }).state;
    expect(reduceReferrals(current, { tenantId: T, at: day(27), type: "payout.markPaid", actor: "bruno", payoutId: payout?.id ?? "", paymentRef: " " }).errorCode).toBe("paymentRefRequired");
    current = reduceReferrals(current, { tenantId: T, at: day(27), type: "payout.markPaid", actor: "bruno", payoutId: payout?.id ?? "", paymentRef: "TRANSFERENCIA-0099" }).state;
    expect(current.payouts.at(-1)).toMatchObject({ status: "paid", paymentRef: "TRANSFERENCIA-0099" });
    expect(current.commissions.find((c) => c.saleRef === "S-1004")?.status).toBe("paid");
    expect(reduceReferrals(current, { tenantId: T, at: day(28), type: "payout.decide", actor: "bruno", payoutId: payout?.id ?? "", approve: false }).errorCode).toBe("payoutResolved");
  });

  it("a rejected payout gives its commissions back to approved", () => {
    const { state, carla } = approvedFor();
    let current = reduceReferrals(state, { tenantId: T, at: day(26), type: "payout.request", actor: "ana", affiliateId: carla, currency: "USD" }).state;
    current = reduceReferrals(current, { tenantId: T, at: day(26), type: "payout.decide", actor: "bruno", payoutId: current.payouts.at(-1)?.id ?? "", approve: false }).state;
    expect(current.commissions.find((c) => c.saleRef === "S-1004")).toMatchObject({ status: "approved", payoutId: undefined });
    expect(current.payouts.at(-1)?.status).toBe("rejected");
  });
});

describe("nothing is trimmed", () => {
  it("keeps every audit entry and log line, however many there are", () => {
    let state = demo();
    const before = state.audit.length;
    for (let index = 0; index < 600; index += 1) state = reduceReferrals(state, { tenantId: T, at: day(26), type: "tick" }).state;
    expect(state.audit).toHaveLength(before + 600);
    expect(state.logs.length).toBeGreaterThanOrEqual(before + 600);
    expect(state.audit[0].action).toBe("program.save"); // the first thing that ever happened is still there
  });
});

describe("multi-tenant, audit and language", () => {
  it("never lets an event from one company touch another's state", () => {
    const nova = demo(DEMO_TENANTS[0].id);
    const vida = demo(DEMO_TENANTS[1].id);
    const crossed = reduceReferrals(vida, { tenantId: DEMO_TENANTS[0].id, at: day(26), type: "tick" });
    expect(crossed.errorCode).toBe("tenantMismatch");
    expect(crossed.state).toBe(vida);
    expect(nova.affiliates.every((affiliate) => affiliate.tenantId === DEMO_TENANTS[0].id)).toBe(true);
    expect(vida.commissions.every((commission) => commission.tenantId === DEMO_TENANTS[1].id)).toBe(true);
    expect(nova.affiliates[0].code).not.toBe(vida.affiliates[0].code);
  });

  it("audits who did what, and keeps a history on every commission", () => {
    const state = demo();
    expect(state.audit.some((entry) => entry.actor === "bruno" && entry.action === "payout.approve")).toBe(true);
    expect(state.audit.some((entry) => entry.action === "payout.paid" && entry.detail?.includes("TRANSFERENCIA-0042"))).toBe(true);
    const paid = state.commissions.find((c) => c.saleRef === "S-1002");
    expect(paid?.history.map((h) => h.event)).toEqual(["created", "approved", "payout.requested", "paid"]);
  });

  it("keeps every text in a dictionary keyed by code, with no code left without a message", () => {
    for (const code of ERROR_CODES) expect(message(code, { detail: "x", from: "a", to: "b", currency: "USD", status: "s", date: "d", min: 1 })).not.toMatch(/\{\w+\}/);
    expect(label("commissionStatus", "inPayout")).toBe("En pago");
    expect(message("programInvalid", { detail: "nombre" })).toBe("Programa inválido: nombre.");
    expect(message("saleDuplicate", {}, "es")).toContain("ya fue registrada");
  });
});
