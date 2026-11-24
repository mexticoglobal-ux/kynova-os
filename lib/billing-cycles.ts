// The CYCLES of a subscription (ADR-0037): what happens when a paid period ends and nobody renews. A PURE layer over `billing-periods.ts`: no database, no payments, no budget.
//
// Rules (approved 2026-11-26):
//  - If a paid period ends and no renewal was CONFIRMED, access is SUSPENDED (operational access and automations). Nothing is deleted. Signing in and reactivating stay available.
//  - A payment confirmed after an interruption is a REACTIVATION: it opens a NEW CYCLE whose anchor is the LOCAL DATE of that confirmed payment. Nothing is charged or granted for the suspended
//    interval: the new cycle's first period starts at the confirmation instant, and no period covers the gap.
//  - A renewal paid BEFORE the end keeps the current calendar: the next period of the same cycle, with the same anchor.
//  - Previous cycles and their periods are HISTORY: they are never overwritten. A new cycle is a new record; the old ones are only read.
//  - What decides between a renewal and a reactivation is when the provider says the payment was CONFIRMED, never when the notification ARRIVED: a late notification of a payment confirmed in
//    time is still a renewal and cannot move the anchor on its own. (Telling a payment that was already applied from a new one is the job of the payment identity, in the database.)
//
// A cycle is the snapshot of what the server stored: `paidPeriods` is the number of its periods that have been paid (granted), and the periods of a cycle are contiguous. The time zone is the
// subscription's and never changes, so every cycle of a subscription has the same one.

import { periodAt, periodBounds, subscriptionClock, type CommercialPeriod } from "@/lib/billing-periods";

export type CycleRecord = Readonly<{
  /** the LOCAL date of the confirmed payment that opened the cycle (derived from it, never supplied) */ anchorDate: string;
  timeZone: string;
  /** ISO instant at which the payment that opened the cycle was confirmed */ activatedAt: string;
  /** how many periods of this cycle are paid; the payment that opens a cycle pays its period 0 */ paidPeriods: number;
}>;

export type SubscriptionHistory = readonly CycleRecord[];

const toMs = (instant: Date | string | number): number => {
  const ms = instant instanceof Date ? instant.getTime() : typeof instant === "number" ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) throw new Error(`invalid instant: ${String(instant)}`);
  return ms;
};

/** The local calendar date of an instant in a time zone (the zone is validated by `subscriptionClock`). */
function localDateOf(ms: number, timeZone: string): string {
  subscriptionClock("2026-01-01", timeZone);
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
}

/** Opens a cycle from a CONFIRMED payment: its anchor is that payment's local date. */
export function openCycle(confirmedAt: Date | string | number, timeZone: string): CycleRecord {
  const ms = toMs(confirmedAt);
  return Object.freeze({ anchorDate: localDateOf(ms, timeZone), timeZone, activatedAt: new Date(ms).toISOString(), paidPeriods: 1 });
}

/** Period `index` of a cycle. The first period starts at the confirmation instant (not at the midnight before it): nothing before the payment is covered. */
export function cyclePeriodBounds(cycle: CycleRecord, index: number): CommercialPeriod {
  const period = periodBounds(subscriptionClock(cycle.anchorDate, cycle.timeZone), index);
  return index === 0 ? { ...period, startsAt: new Date(toMs(cycle.activatedAt)).toISOString() } : period;
}

/** The instant at which the paid time of a cycle ends (exclusive). */
export function paidUntil(cycle: CycleRecord): string {
  if (!Number.isInteger(cycle.paidPeriods) || cycle.paidPeriods < 1) throw new Error("a cycle has at least one paid period");
  return cyclePeriodBounds(cycle, cycle.paidPeriods - 1).endsAt;
}

/** Throws when the history is not what the server could have stored: ordered, one time zone, and each cycle opened only AFTER the previous paid time ended (a payment before that is a renewal). */
export function assertHistory(history: SubscriptionHistory): void {
  history.forEach((cycle, index) => {
    const own = subscriptionClock(cycle.anchorDate, cycle.timeZone);
    paidUntil(cycle);
    if (Date.parse(periodBounds(own, 0).startsAt) > toMs(cycle.activatedAt)) throw new Error("the anchor is later than the activation");
    const previous = history[index - 1];
    if (!previous) return;
    if (previous.timeZone !== cycle.timeZone) throw new Error("the time zone of a subscription never changes");
    if (toMs(cycle.activatedAt) <= toMs(paidUntil(previous))) throw new Error("a cycle can only open after the previous paid time ended");
  });
}

export type Access =
  | { state: "none" } // before the first activation
  | { state: "active"; cycleIndex: number; period: CommercialPeriod }
  | { state: "suspended"; cycleIndex: number; /** when the last paid time ended */ since: string };

/** Whether a subscription has operational access at an instant. Outside a paid period it is suspended (never "none" after the first activation). */
export function accessAt(history: SubscriptionHistory, instant: Date | string | number): Access {
  assertHistory(history);
  const ms = toMs(instant);
  for (let cycleIndex = history.length - 1; cycleIndex >= 0; cycleIndex -= 1) {
    const cycle = history[cycleIndex] as CycleRecord;
    if (ms < toMs(cycle.activatedAt)) continue;
    const found = periodAt(subscriptionClock(cycle.anchorDate, cycle.timeZone), ms);
    if (found && found.index < cycle.paidPeriods) return { state: "active", cycleIndex, period: cyclePeriodBounds(cycle, found.index) };
    return { state: "suspended", cycleIndex, since: paidUntil(cycle) };
  }
  return { state: "none" };
}

export type PaymentClassification =
  | { kind: "first_activation"; cycle: CycleRecord }
  /** the next period of the current cycle, with the calendar and the anchor unchanged; `paidAhead` means the next period was already paid (a decision still pending) */
  | { kind: "renewal"; cycleIndex: number; periodIndex: number; period: CommercialPeriod; paidAhead: boolean }
  | { kind: "reactivation"; previousCycleIndex: number; cycle: CycleRecord };

/**
 * What a payment CONFIRMED at `confirmedAt` is: the first activation, a renewal (confirmed up to and including the instant the paid time ends) or a reactivation (confirmed after it, so the
 * subscription was suspended). It reads only the confirmation instant, never the arrival time of the notification, and never changes the history it is given.
 */
export function classifyConfirmedPayment(history: SubscriptionHistory, confirmedAt: Date | string | number, timeZone: string): PaymentClassification {
  assertHistory(history);
  const ms = toMs(confirmedAt);
  const last = history[history.length - 1];
  if (!last) return { kind: "first_activation", cycle: openCycle(ms, timeZone) };
  if (last.timeZone !== timeZone) throw new Error("the time zone of a subscription never changes");
  if (ms <= toMs(paidUntil(last))) {
    const period = cyclePeriodBounds(last, last.paidPeriods);
    const currentStart = cyclePeriodBounds(last, last.paidPeriods - 1).startsAt;
    return { kind: "renewal", cycleIndex: history.length - 1, periodIndex: last.paidPeriods, period, paidAhead: ms < toMs(currentStart) };
  }
  return { kind: "reactivation", previousCycleIndex: history.length - 1, cycle: openCycle(ms, timeZone) };
}
