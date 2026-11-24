// The commercial periods of a subscription (ADR-0037): a PURE function, no database, no payments, no budget. Given the subscription's original ANCHOR DATE and its fixed TIME ZONE it says
// when any period starts and ends, and which period an instant belongs to.
//
// The rules (approved 2026-11-26), each one covered by a test:
//  - A period runs from its start date to the SAME date of the next month. The anchor date is the day the subscription began and is never changed; every boundary is computed DIRECTLY from it
//    (anchor + n months), never from the previous boundary, so a short month cannot drift the renewal (31 Jan -> 28 Feb -> 31 Mar, not 28 Mar).
//  - Days 29, 30 and 31: in a month that does not have that day the boundary is the LAST day of that month; the next month that has the day goes back to it. (29 Feb of a leap year works the same.)
//  - Boundaries are at 00:00 LOCAL TIME of the time zone fixed in the subscription. Changing a profile never moves a period: the zone is an input of the subscription, not of the user.
//  - A period starts at its start instant (inclusive) and ends at the start of the next one (exclusive): no gaps and no overlaps. An instant exactly at a renewal belongs to the NEW period.
//  - Midnight is not always a single, existing instant. The explicit rule is: a boundary is the FIRST REAL INSTANT OF THE LOCAL DAY.
//      * a midnight that does not exist (the clock jumps from 23:59 to 01:00): the boundary is the instant of the jump (local 01:00);
//      * an ambiguous midnight (00:00 happens twice when the clock goes back): the boundary is the EARLIER 00:00;
//      * a local day that does not exist at all (a zone that skipped a whole date): the boundary is the first instant of the next day that exists.
//    (The search works in whole minutes: offsets with seconds, which only exist in dates before the 20th century, are out of scope.)
//
// Calendar arithmetic reuses `addInterval` (lib/contracts/platform/billing.ts), which already clamps to the last day of a short month; here it is always applied to the ANCHOR with a count of
// months, and never chained. Time-zone conversion uses the platform's `Intl`, with no dependency.

import { addInterval } from "@/lib/contracts/platform/billing";

export type CommercialPeriod = { index: number; /** ISO instant, inclusive */ startsAt: string; /** ISO instant, exclusive: the start of the next period */ endsAt: string };

/** The immutable pair that defines every period of a subscription. */
export type SubscriptionClock = Readonly<{ anchorDate: string; timeZone: string }>;

/** A guard against nonsense (100 years of monthly periods). */
export const MAX_PERIOD_INDEX = 1200;

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MINUTE = 60_000;
const SEARCH_STEP = 30 * MINUTE;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  let created: Intl.DateTimeFormat;
  try {
    created = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    throw new Error(`invalid time zone: ${timeZone}`);
  }
  formatters.set(timeZone, created);
  return created;
}

/** Whether `timeZone` is a time zone the platform knows. */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || timeZone.trim() === "") return false;
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** True for a real calendar date written as YYYY-MM-DD (2026-02-30 is not one). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return year >= 1900 && year <= 2200 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** The clock of a subscription. The anchor date is the LOCAL calendar date (in `timeZone`) on which it began. */
export function subscriptionClock(anchorDate: string, timeZone: string): SubscriptionClock {
  if (!isCalendarDate(anchorDate)) throw new Error(`invalid anchor date: ${String(anchorDate)}`);
  if (!isValidTimeZone(timeZone)) throw new Error(`invalid time zone: ${String(timeZone)}`);
  return Object.freeze({ anchorDate, timeZone });
}

/** The local calendar date (YYYY-MM-DD) of an instant in a time zone. */
const localDateOf = (ms: number, timeZone: string): string => formatterFor(timeZone).format(new Date(ms));

/** The calendar date on which period `index` starts: the ANCHOR plus `index` months, clamped to the last day of a short month. Always computed from the anchor, never from a previous boundary. */
function boundaryDate(anchorDate: string, index: number): string {
  return addInterval(`${anchorDate}T00:00:00.000Z`, "month", index).slice(0, 10);
}

// The first instant of a local day never changes, so it is remembered (a bounded cache: the search below costs about a hundred `Intl` calls).
const dayStarts = new Map<string, number>();

/** The first real instant of a local day (see the rules at the top of the file). */
function startOfLocalDay(date: string, timeZone: string): number {
  const key = `${timeZone}|${date}`;
  const known = dayStarts.get(key);
  if (known !== undefined) return known;
  const found = searchStartOfLocalDay(date, timeZone);
  if (dayStarts.size > 5_000) dayStarts.clear();
  dayStarts.set(key, found);
  return found;
}

function searchStartOfLocalDay(date: string, timeZone: string): number {
  const [year, month, day] = [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
  // 15 hours before UTC midnight of that date every zone (UTC-12 to UTC+14) still reads the previous day
  const low = Date.UTC(year, month - 1, day) - 15 * 60 * MINUTE;
  let at = low;
  while (localDateOf(at, timeZone) < date) {
    at += SEARCH_STEP;
    if (at > low + 48 * 60 * MINUTE) throw new Error(`no instant found for ${date} in ${timeZone}`);
  }
  // `at` is the first coarse step that reads the day (or a later one if the day does not exist): the real first instant is within the previous step
  for (let minute = at - SEARCH_STEP + MINUTE; minute < at; minute += MINUTE) if (localDateOf(minute, timeZone) >= date) return minute;
  return at;
}

function assertIndex(index: number): void {
  if (!Number.isInteger(index) || index < 0 || index > MAX_PERIOD_INDEX) throw new Error(`invalid period index: ${String(index)}`);
}

/** Period number `index` (0 is the first) of a subscription. */
export function periodBounds(clock: SubscriptionClock, index: number): CommercialPeriod {
  assertIndex(index);
  const { anchorDate, timeZone } = subscriptionClock(clock.anchorDate, clock.timeZone);
  return {
    index,
    startsAt: new Date(startOfLocalDay(boundaryDate(anchorDate, index), timeZone)).toISOString(),
    endsAt: new Date(startOfLocalDay(boundaryDate(anchorDate, index + 1), timeZone)).toISOString(),
  };
}

/** The period an instant belongs to, or null when it is before the subscription began. An instant exactly at a renewal belongs to the new period. */
export function periodAt(clock: SubscriptionClock, instant: Date | string | number): CommercialPeriod | null {
  const ms = instant instanceof Date ? instant.getTime() : typeof instant === "number" ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) throw new Error(`invalid instant: ${String(instant)}`);
  const { anchorDate, timeZone } = subscriptionClock(clock.anchorDate, clock.timeZone);
  if (ms < Date.parse(periodBounds({ anchorDate, timeZone }, 0).startsAt)) return null;
  const local = localDateOf(ms, timeZone);
  const estimate = (Number(local.slice(0, 4)) - Number(anchorDate.slice(0, 4))) * 12 + (Number(local.slice(5, 7)) - Number(anchorDate.slice(5, 7)));
  for (const index of [estimate - 1, estimate, estimate + 1]) {
    if (index < 0 || index > MAX_PERIOD_INDEX) continue;
    const period = periodBounds({ anchorDate, timeZone }, index);
    if (ms >= Date.parse(period.startsAt) && ms < Date.parse(period.endsAt)) return period;
  }
  throw new Error("no period contains that instant");
}
