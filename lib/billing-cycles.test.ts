import { describe, expect, it } from "vitest";
import { accessAt, assertHistory, classifyConfirmedPayment, cyclePeriodBounds, openCycle, paidUntil, type CycleRecord, type SubscriptionHistory } from "./billing-cycles";

const TZ = "America/Costa_Rica"; // UTC-6, no daylight saving time: 06:00Z is 00:00 local
const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) { Object.freeze(value); Object.values(value).forEach(deepFreeze); }
  return value;
};

// the first activation: paid at 09:00 local on 8 Jan 2026
const first = openCycle("2026-01-08T15:00:00Z", TZ);

describe("a cycle opens from a CONFIRMED payment: its anchor is that payment's local date", () => {
  it("the anchor is derived from the payment, in the subscription's zone (never supplied)", () => {
    expect(first).toMatchObject({ anchorDate: "2026-01-08", timeZone: TZ, activatedAt: "2026-01-08T15:00:00.000Z", paidPeriods: 1 });
    expect(openCycle("2026-02-08T03:00:00Z", TZ).anchorDate).toBe("2026-02-07"); // 21:00 local the day before
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("the first period starts at the confirmation instant, not at the midnight before it; the next ones start at local midnight of the anchor's day", () => {
    expect(cyclePeriodBounds(first, 0)).toEqual({ index: 0, startsAt: "2026-01-08T15:00:00.000Z", endsAt: "2026-02-08T06:00:00.000Z" });
    expect(cyclePeriodBounds(first, 1)).toEqual({ index: 1, startsAt: "2026-02-08T06:00:00.000Z", endsAt: "2026-03-08T06:00:00.000Z" });
    expect(paidUntil(first)).toBe("2026-02-08T06:00:00.000Z");
  });
});

describe("a renewal paid BEFORE the end keeps the current calendar", () => {
  it("is the next period of the same cycle, with the same anchor and the calendar dates unchanged, however early it is paid", () => {
    for (const confirmedAt of ["2026-01-20T10:00:00Z", "2026-02-03T12:00:00Z", "2026-02-08T05:59:59.999Z"]) {
      const result = classifyConfirmedPayment([first], confirmedAt, TZ);
      expect(result).toMatchObject({ kind: "renewal", cycleIndex: 0, periodIndex: 1, paidAhead: false });
      if (result.kind === "renewal") expect(result.period).toEqual({ index: 1, startsAt: "2026-02-08T06:00:00.000Z", endsAt: "2026-03-08T06:00:00.000Z" });
    }
  });

  it("a payment confirmed exactly at the instant the paid time ends still renews (in time); one millisecond later it is a reactivation", () => {
    expect(classifyConfirmedPayment([first], "2026-02-08T06:00:00.000Z", TZ).kind).toBe("renewal");
    expect(classifyConfirmedPayment([first], "2026-02-08T06:00:00.001Z", TZ).kind).toBe("reactivation");
  });

  it("a late NOTIFICATION of a payment confirmed in time is still a renewal: only the confirmation instant counts, and the anchor does not move", () => {
    // the notification may arrive on 20 Feb, but the provider confirmed the payment on 5 Feb: the function is given the confirmation, not the arrival
    const result = classifyConfirmedPayment([first], "2026-02-05T18:00:00Z", TZ);
    expect(result).toMatchObject({ kind: "renewal", cycleIndex: 0, periodIndex: 1 });
    expect("cycle" in result).toBe(false); // no new cycle, so no new anchor
  });

  it("flags a payment made when the next period is already paid (a decision still pending)", () => {
    const paidTwo: CycleRecord = { ...first, paidPeriods: 2 };
    const result = classifyConfirmedPayment([paidTwo], "2026-01-20T10:00:00Z", TZ);
    expect(result).toMatchObject({ kind: "renewal", periodIndex: 2, paidAhead: true });
  });

  it("the calendar of a cycle opened on day 31 keeps going back to 31", () => {
    const cycle = openCycle("2026-01-31T20:00:00Z", TZ); // 14:00 local
    expect([1, 2, 3].map((index) => cyclePeriodBounds(cycle, index).startsAt)).toEqual(["2026-02-28T06:00:00.000Z", "2026-03-31T06:00:00.000Z", "2026-04-30T06:00:00.000Z"]);
  });
});

describe("a paid period ends without a confirmed renewal: access is suspended", () => {
  it("is active inside the paid time, and suspended from the instant it ends (exclusive end), with the date it was suspended since", () => {
    expect(accessAt([first], "2026-01-08T14:59:59.999Z")).toEqual({ state: "none" }); // before the activation
    expect(accessAt([first], "2026-01-08T15:00:00Z")).toMatchObject({ state: "active", cycleIndex: 0, period: { index: 0 } });
    expect(accessAt([first], "2026-02-08T05:59:59.999Z")).toMatchObject({ state: "active" });
    expect(accessAt([first], "2026-02-08T06:00:00Z")).toEqual({ state: "suspended", cycleIndex: 0, since: "2026-02-08T06:00:00.000Z" });
    expect(accessAt([first], "2027-01-01T00:00:00Z")).toEqual({ state: "suspended", cycleIndex: 0, since: "2026-02-08T06:00:00.000Z" }); // stays suspended; it never goes back to "none"
  });

  it("a renewal paid in time makes the next period active at the renewal instant, with no suspension in between", () => {
    const renewed: CycleRecord = { ...first, paidPeriods: 2 };
    expect(accessAt([renewed], "2026-02-08T05:59:59.999Z")).toMatchObject({ state: "active", period: { index: 0 } });
    expect(accessAt([renewed], "2026-02-08T06:00:00Z")).toMatchObject({ state: "active", period: { index: 1 } });
    expect(accessAt([renewed], "2026-03-08T06:00:00Z")).toMatchObject({ state: "suspended", since: "2026-03-08T06:00:00.000Z" });
  });

  it("a cancelled subscription simply stops getting new periods: it is suspended after the paid time and a later payment is a reactivation", () => {
    expect(accessAt([first], "2026-02-09T00:00:00Z").state).toBe("suspended");
    expect(classifyConfirmedPayment([first], "2026-03-15T20:00:00Z", TZ).kind).toBe("reactivation");
  });
});

describe("a payment after an interruption opens a NEW cycle from the reactivation; nothing is granted for the suspended interval", () => {
  const reactivation = classifyConfirmedPayment([first], "2026-02-20T18:00:00Z", TZ); // 12:00 local on 20 Feb
  if (reactivation.kind !== "reactivation") throw new Error("expected a reactivation");
  const second = reactivation.cycle;
  const history: SubscriptionHistory = [first, second];

  it("the new anchor is the local date of the confirmed payment, and its first period starts at the confirmation", () => {
    expect(second).toMatchObject({ anchorDate: "2026-02-20", activatedAt: "2026-02-20T18:00:00.000Z", paidPeriods: 1 });
    expect(cyclePeriodBounds(second, 0)).toEqual({ index: 0, startsAt: "2026-02-20T18:00:00.000Z", endsAt: "2026-03-20T06:00:00.000Z" });
    expect(cyclePeriodBounds(second, 1).startsAt).toBe("2026-03-20T06:00:00.000Z");
    expect(reactivation.previousCycleIndex).toBe(0);
  });

  it("no period covers the suspended interval: it is suspended from the end of the old paid time until the confirmation instant", () => {
    assertHistory(history);
    for (const gap of ["2026-02-08T06:00:00Z", "2026-02-12T00:00:00Z", "2026-02-20T17:59:59.999Z"]) {
      expect(accessAt(history, gap), gap).toEqual({ state: "suspended", cycleIndex: 0, since: "2026-02-08T06:00:00.000Z" });
    }
    expect(accessAt(history, "2026-02-20T18:00:00Z")).toMatchObject({ state: "active", cycleIndex: 1, period: { index: 0 } });
  });

  it("the old cycle and its period stay as HISTORY, untouched, and still answer for their own time", () => {
    expect(history[0]).toBe(first);
    expect(first).toMatchObject({ anchorDate: "2026-01-08", paidPeriods: 1 });
    expect(accessAt(history, "2026-01-30T00:00:00Z")).toMatchObject({ state: "active", cycleIndex: 0 });
    expect(history.map((cycle) => cycle.anchorDate)).toEqual(["2026-01-08", "2026-02-20"]);
  });

  it("classifying a payment never changes the history it is given (even a deeply frozen one)", () => {
    const frozen = deepFreeze([{ ...first }]) as SubscriptionHistory;
    expect(() => classifyConfirmedPayment(frozen, "2026-02-20T18:00:00Z", TZ)).not.toThrow();
    expect(() => accessAt(frozen, "2026-02-20T18:00:00Z")).not.toThrow();
    expect(frozen).toHaveLength(1);
  });

  it("after the reactivation, the next payment confirmed in time is a renewal of the NEW cycle (its calendar), not of the old one", () => {
    const result = classifyConfirmedPayment(history, "2026-03-10T12:00:00Z", TZ);
    expect(result).toMatchObject({ kind: "renewal", cycleIndex: 1, periodIndex: 1 });
    if (result.kind === "renewal") expect(result.period.startsAt).toBe("2026-03-20T06:00:00.000Z");
  });

  it("a second interruption opens a third cycle, again from the local date of its confirmed payment, and everything before is kept", () => {
    const third = classifyConfirmedPayment(history, "2026-06-30T20:00:00Z", TZ);
    expect(third.kind).toBe("reactivation");
    if (third.kind === "reactivation") {
      expect(third.previousCycleIndex).toBe(1);
      expect(third.cycle.anchorDate).toBe("2026-06-30");
      expect([...history, third.cycle].map((cycle) => cycle.anchorDate)).toEqual(["2026-01-08", "2026-02-20", "2026-06-30"]);
    }
  });
});

describe("a reactivation starts at the effective payment instant (19:00 case)", () => {
  // 19:00 local on 20 Feb 2026 in Costa Rica (UTC-6) is 01:00Z on the 21st: the local DATE (20th) is the anchor day, the INSTANT is what starts access
  const payment = "2026-02-21T01:00:00Z";
  const result = classifyConfirmedPayment([first], payment, TZ);
  if (result.kind !== "reactivation") throw new Error("expected a reactivation");
  const history: SubscriptionHistory = [first, result.cycle];

  it("anchors on the LOCAL day (the 20th, not the UTC 21st) but activates at the payment instant", () => {
    expect(result.cycle).toMatchObject({ anchorDate: "2026-02-20", activatedAt: "2026-02-21T01:00:00.000Z" });
    expect(cyclePeriodBounds(result.cycle, 0).startsAt).toBe("2026-02-21T01:00:00.000Z");
  });

  it("grants nothing backwards: still suspended at 18:59:59.999 local and at 00:00 local of the anchor day; active from exactly 19:00", () => {
    expect(accessAt(history, "2026-02-20T06:00:00Z")).toMatchObject({ state: "suspended" }); // 00:00 local on the 20th: the anchor day began, but nothing is covered yet
    expect(accessAt(history, "2026-02-21T00:59:59.999Z")).toMatchObject({ state: "suspended" });
    expect(accessAt(history, "2026-02-21T01:00:00Z")).toMatchObject({ state: "active", cycleIndex: 1, period: { index: 0 } });
  });

  it("period 0 ends at 00:00 local of the 20th of next month (a short first period, not discounted or extended), and the renewal then starts at midnight", () => {
    expect(cyclePeriodBounds(result.cycle, 0).endsAt).toBe("2026-03-20T06:00:00.000Z");
    expect(accessAt(history, "2026-03-20T05:59:59.999Z")).toMatchObject({ state: "active", period: { index: 0 } });
    expect(cyclePeriodBounds(result.cycle, 1)).toEqual({ index: 1, startsAt: "2026-03-20T06:00:00.000Z", endsAt: "2026-04-20T06:00:00.000Z" });
  });

  it("LIMIT, not a guarantee: evaluating the same payment again against the history that already contains it reads as a renewal, so the pure function does NOT prevent a double application", () => {
    // Preventing it needs the payment identity (provider, payment_id, concept) stored and checked before classifying: persistence that does not exist yet
    expect(classifyConfirmedPayment(history, payment, TZ).kind).toBe("renewal");
  });
});

describe("paidAhead is only a flag", () => {
  it("flags an early payment without granting anything or changing the cycle, the history or the access", () => {
    const paidTwo: CycleRecord = deepFreeze({ ...first, paidPeriods: 2 });
    const before = JSON.stringify(accessAt([paidTwo], "2026-02-10T00:00:00Z"));
    const result = classifyConfirmedPayment([paidTwo], "2026-01-20T10:00:00Z", TZ);
    expect(result).toMatchObject({ kind: "renewal", paidAhead: true });
    expect("cycle" in result).toBe(false); // no new cycle
    expect(paidTwo.paidPeriods).toBe(2); // not incremented
    expect(JSON.stringify(accessAt([paidTwo], "2026-02-10T00:00:00Z"))).toBe(before);
  });
});

describe("the first activation and the validation of the history", () => {
  it("with no history, the first confirmed payment opens the first cycle", () => {
    const result = classifyConfirmedPayment([], "2026-01-08T15:00:00Z", TZ);
    expect(result.kind).toBe("first_activation");
    if (result.kind === "first_activation") expect(result.cycle).toEqual(first);
    expect(accessAt([], "2026-01-08T15:00:00Z")).toEqual({ state: "none" });
  });

  it("refuses a history the server could not have stored: overlapping cycles, a changed time zone, an unpaid cycle, a later anchor", () => {
    const overlapping = openCycle("2026-02-01T18:00:00Z", TZ); // before the first cycle's paid time ended: that was a renewal
    expect(() => assertHistory([first, overlapping])).toThrow(/after the previous paid time ended/);
    expect(() => assertHistory([first, openCycle("2026-03-01T18:00:00Z", "America/New_York")])).toThrow(/time zone/);
    expect(() => assertHistory([{ ...first, paidPeriods: 0 }])).toThrow(/paid period/);
    expect(() => assertHistory([{ ...first, anchorDate: "2026-02-01" }])).toThrow(/anchor/);
    expect(() => classifyConfirmedPayment([first], "2026-03-01T00:00:00Z", "America/New_York")).toThrow(/time zone/);
    expect(() => classifyConfirmedPayment([], "no es una fecha", TZ)).toThrow(/instant/);
  });

  it("is pure: it imports only the period function (no database, no payments, no budget, no clock)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/billing-cycles.ts", "utf8");
    expect(source.match(/^import .*$/gm)).toEqual(['import { periodAt, periodBounds, subscriptionClock, type CommercialPeriod } from "@/lib/billing-periods";']);
    expect(source).not.toMatch(/Date\.now\(|new Date\(\)|process\.env|fetch\(/);
  });
});
