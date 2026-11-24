import { describe, expect, it } from "vitest";
import { addInterval } from "@/lib/contracts/platform/billing";
import { MAX_PERIOD_INDEX, isCalendarDate, isValidTimeZone, periodAt, periodBounds, subscriptionClock } from "./billing-periods";

const startDate = (anchor: string, index: number, timeZone = "UTC") => periodBounds(subscriptionClock(anchor, timeZone), index).startsAt.slice(0, 10);
const starts = (anchor: string, indices: number[], timeZone = "UTC") => indices.map((index) => startDate(anchor, index, timeZone));

describe("same date next month, with the anchor kept (days 8, 12 and 16)", () => {
  it("every period starts on the same day of the month", () => {
    expect(starts("2026-01-08", [0, 1, 2, 5, 11, 12])).toEqual(["2026-01-08", "2026-02-08", "2026-03-08", "2026-06-08", "2026-12-08", "2027-01-08"]);
    expect(starts("2026-12-12", [0, 1, 2, 14])).toEqual(["2026-12-12", "2027-01-12", "2027-02-12", "2028-02-12"]);
    expect(starts("2026-01-16", [0, 1, 2, 3])).toEqual(["2026-01-16", "2026-02-16", "2026-03-16", "2026-04-16"]);
  });
});

describe("days 29, 30 and 31: the last day of a short month, and back to the original day afterwards", () => {
  it("31: 28 Feb (29 in a leap year), 31 Mar, 30 Apr, 31 May, 30 Jun ...", () => {
    expect(starts("2026-01-31", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])).toEqual([
      "2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31", "2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30", "2026-10-31", "2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28",
    ]);
    expect(starts("2028-01-31", [1, 2])).toEqual(["2028-02-29", "2028-03-31"]); // leap year
  });

  it("30: 28 (or 29) Feb, then 30 Mar, 30 Apr, 30 May", () => {
    expect(starts("2026-01-30", [1, 2, 3, 4])).toEqual(["2026-02-28", "2026-03-30", "2026-04-30", "2026-05-30"]);
    expect(starts("2028-01-30", [1, 2])).toEqual(["2028-02-29", "2028-03-30"]);
  });

  it("29: 28 Feb (29 in a leap year), then 29 Mar", () => {
    expect(starts("2026-01-29", [1, 2])).toEqual(["2026-02-28", "2026-03-29"]);
    expect(starts("2028-01-29", [1, 2])).toEqual(["2028-02-29", "2028-03-29"]);
  });

  it("an anchor of 29 February (a leap year) keeps 29: 29 Mar, 29 Apr ... 28 Feb of the next year, 29 Mar, and 29 Feb of the next leap year", () => {
    expect(starts("2028-02-29", [0, 1, 2, 12, 13, 48])).toEqual(["2028-02-29", "2028-03-29", "2028-04-29", "2029-02-28", "2029-03-29", "2032-02-29"]);
  });

  it("is computed DIRECTLY from the anchor: chaining from the previous boundary would drift (31 Jan -> 28 Feb -> 28 Mar), and this never does", () => {
    const chained = addInterval(addInterval("2026-01-31T00:00:00.000Z", "month", 1), "month", 1).slice(0, 10);
    expect(chained).toBe("2026-03-28"); // what the accumulated shift would give
    expect(startDate("2026-01-31", 2)).toBe("2026-03-31");
    // the long run has no accumulated shift either: month 24 of an anchor of 31 is still the 31st (December has 31 days)
    expect(startDate("2026-01-31", 23)).toBe("2027-12-31");
    expect(startDate("2026-01-31", 24)).toBe("2028-01-31");
  });

  it("a short period is not prorated: 31 Jan to 28 Feb is simply a shorter period", () => {
    const short = periodBounds(subscriptionClock("2026-01-31", "UTC"), 0);
    expect((Date.parse(short.endsAt) - Date.parse(short.startsAt)) / 86_400_000).toBe(28);
  });
});

describe("the subscription's fixed time zone, at 00:00 local", () => {
  it("a renewal is local midnight of the subscription's zone, not UTC midnight", () => {
    const costaRica = subscriptionClock("2026-03-08", "America/Costa_Rica"); // UTC-6, no daylight saving time
    expect(periodBounds(costaRica, 0).startsAt).toBe("2026-03-08T06:00:00.000Z");
    expect(periodBounds(costaRica, 1).startsAt).toBe("2026-04-08T06:00:00.000Z");
    expect(periodBounds(subscriptionClock("2026-03-08", "UTC"), 0).startsAt).toBe("2026-03-08T00:00:00.000Z");
  });

  it("the same dates in a different zone give different instants: the zone is an input of the subscription, so changing a profile cannot move a period", () => {
    const a = periodBounds(subscriptionClock("2026-03-08", "America/Costa_Rica"), 1);
    const b = periodBounds(subscriptionClock("2026-03-08", "Asia/Tokyo"), 1);
    expect(a.startsAt.slice(0, 10)).not.toBe(b.startsAt.slice(0, 10)); // 06:00Z vs the previous day 15:00Z
    expect(periodBounds(subscriptionClock("2026-03-08", "America/Costa_Rica"), 1)).toEqual(a); // same inputs, same answer
  });

  it("daylight saving time changes the offset but not the local date of the renewal", () => {
    const newYork = subscriptionClock("2026-02-08", "America/New_York");
    expect(periodBounds(newYork, 1).startsAt).toBe("2026-03-08T05:00:00.000Z"); // 00:00 EST (UTC-5): the clocks change at 02:00 that day
    expect(periodBounds(newYork, 2).startsAt).toBe("2026-04-08T04:00:00.000Z"); // 00:00 EDT (UTC-4)
  });
});

describe("midnight that does not exist, is ambiguous, or whose whole day does not exist: the first real instant of the local day", () => {
  it("a midnight that does not exist (the clock jumps from 23:59 to 01:00) starts the period at the jump", () => {
    const saoPaulo = subscriptionClock("2018-10-04", "America/Sao_Paulo");
    const period = periodBounds(saoPaulo, 1); // 4 Nov 2018: 00:00 did not exist
    expect(period.startsAt).toBe("2018-11-04T03:00:00.000Z"); // local 01:00, the first real instant of that day
    expect(periodAt(saoPaulo, "2018-11-04T02:59:59.999Z")?.index).toBe(0);
    expect(periodAt(saoPaulo, "2018-11-04T03:00:00.000Z")?.index).toBe(1);
  });

  it("an ambiguous midnight (00:00 happens twice) uses the EARLIER one, and both occurrences belong to the same new period", () => {
    const havana = subscriptionClock("2026-10-01", "America/Havana"); // 1 Nov 2026: the clock goes from 01:00 back to 00:00
    expect(periodBounds(havana, 1).startsAt).toBe("2026-11-01T04:00:00.000Z"); // the first 00:00 (UTC-4), not the second (05:00Z, UTC-5)
    expect(periodAt(havana, "2026-11-01T03:59:59.999Z")?.index).toBe(0);
    expect(periodAt(havana, "2026-11-01T04:30:00.000Z")?.index).toBe(1); // first 00:30
    expect(periodAt(havana, "2026-11-01T05:30:00.000Z")?.index).toBe(1); // second 00:30
  });

  it("a local day that does not exist (a zone skipped a whole date) starts at the first instant of the next day that exists", () => {
    const apia = subscriptionClock("2011-11-30", "Pacific/Apia"); // 30 Dec 2011 never happened in Samoa
    expect(periodBounds(apia, 1).startsAt).toBe("2011-12-30T10:00:00.000Z"); // 31 Dec 00:00 local
    expect(periodBounds(apia, 2).startsAt).toBe("2012-01-29T10:00:00.000Z"); // 30 Jan 2012 00:00 local (UTC+14)
  });
});

describe("inclusive start, exclusive end, no gaps and no overlaps", () => {
  const clocks = [
    subscriptionClock("2026-01-31", "UTC"),
    subscriptionClock("2026-01-30", "America/Costa_Rica"),
    subscriptionClock("2028-02-29", "America/New_York"),
    subscriptionClock("2026-10-29", "America/Havana"),
    subscriptionClock("2018-09-30", "America/Sao_Paulo"),
    subscriptionClock("2011-10-31", "Pacific/Apia"),
    subscriptionClock("2026-05-16", "Asia/Kolkata"),
  ];

  it("each period ends exactly where the next one starts, and the starts strictly increase", () => {
    for (const clock of clocks) {
      let previous = periodBounds(clock, 0);
      for (let index = 1; index <= 60; index += 1) {
        const current = periodBounds(clock, index);
        expect(current.startsAt, `${clock.anchorDate} ${clock.timeZone} #${index}`).toBe(previous.endsAt);
        expect(Date.parse(current.endsAt)).toBeGreaterThan(Date.parse(current.startsAt));
        previous = current;
      }
    }
  });

  it("an instant exactly at a renewal belongs to the NEW period; one millisecond earlier, to the old one; and the end is never inside its own period", () => {
    for (const clock of clocks) {
      for (const index of [0, 1, 2, 13]) {
        const period = periodBounds(clock, index);
        const start = Date.parse(period.startsAt);
        expect(periodAt(clock, start)?.index).toBe(index);
        expect(periodAt(clock, start + 1)?.index).toBe(index);
        expect(periodAt(clock, Date.parse(period.endsAt) - 1)?.index).toBe(index);
        expect(periodAt(clock, Date.parse(period.endsAt))?.index).toBe(index + 1);
        if (index > 0) expect(periodAt(clock, start - 1)?.index).toBe(index - 1);
      }
    }
  });

  it("every instant of a long sweep belongs to exactly the period whose bounds contain it", () => {
    const clock = subscriptionClock("2026-01-31", "America/New_York");
    const from = Date.parse("2026-01-31T05:00:00Z"); // the anchor's first instant in New York
    for (let at = from; at < from + 400 * 86_400_000; at += 5 * 3_600_000 + 7 * 60_000) {
      const period = periodAt(clock, at);
      expect(period).not.toBeNull();
      expect(at).toBeGreaterThanOrEqual(Date.parse(period?.startsAt ?? ""));
      expect(at).toBeLessThan(Date.parse(period?.endsAt ?? ""));
    }
  });

  it("an instant before the subscription began belongs to no period", () => {
    const clock = subscriptionClock("2026-01-31", "UTC");
    expect(periodAt(clock, "2026-01-30T23:59:59.999Z")).toBeNull();
    expect(periodAt(clock, "2026-01-31T00:00:00.000Z")?.index).toBe(0);
  });
});

describe("the anchor is immutable and the inputs are validated", () => {
  it("the clock is frozen: its anchor and zone cannot be changed after it is created", () => {
    const clock = subscriptionClock("2026-01-31", "UTC");
    expect(Object.isFrozen(clock)).toBe(true);
    expect(() => { (clock as { anchorDate: string }).anchorDate = "2026-02-01"; }).toThrow();
    expect(clock.anchorDate).toBe("2026-01-31");
  });

  it("refuses a date that does not exist, a malformed one, an unknown zone, a bad index and a bad instant", () => {
    expect(() => subscriptionClock("2026-02-30", "UTC")).toThrow(/anchor/);
    expect(() => subscriptionClock("2026-2-3", "UTC")).toThrow(/anchor/);
    expect(() => subscriptionClock("2026-01-31", "Marte/Base")).toThrow(/time zone/);
    expect(() => subscriptionClock("2026-01-31", "")).toThrow(/time zone/);
    const clock = subscriptionClock("2026-01-31", "UTC");
    for (const index of [-1, 1.5, MAX_PERIOD_INDEX + 1, Number.NaN]) expect(() => periodBounds(clock, index)).toThrow(/index/);
    expect(() => periodAt(clock, "no es una fecha")).toThrow(/instant/);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2027-02-29")).toBe(false);
    expect(isValidTimeZone("America/Costa_Rica")).toBe(true);
    expect(isValidTimeZone("Nope/Nope")).toBe(false);
  });

  it("is pure: it reads no database, no clock and no payment (the file imports only the date helper)", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("lib/billing-periods.ts", "utf8");
    expect(source.match(/^import .*$/gm)).toEqual(['import { addInterval } from "@/lib/contracts/platform/billing";']);
    expect(source).not.toMatch(/Date\.now\(|new Date\(\)|process\.env|fetch\(/);
  });
});
