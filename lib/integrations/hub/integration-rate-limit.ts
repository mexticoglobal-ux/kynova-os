// The Rate Limit Engine: every provider declares requests per minute, hour and day and a burst, and the Hub never exceeds them. Two buckets guard every call: the CONNECTION's own (so one
// company cannot starve another) and the PROVIDER's (the app's shared quota, the one a provider really enforces). A provider that reports what is left (headers) can lower the limit further
// with `observe`. Pure and deterministic: it holds no clock, it is handed `now`.

import type { RateLimitSpec } from "./integration-types";

export type Window = "minute" | "hour" | "day" | "burst";
export type RateStatus = {
  allowed: boolean; limitedBy?: Window; retryAfterMs: number;
  remaining: { minute: number; hour: number; day: number; burst: number };
  /** when each window frees its oldest request (epoch ms); the burst bucket refills continuously */
  resetAt: { minute: number; hour: number; day: number };
};
export const WINDOW_MS = { minute: 60_000, hour: 3_600_000, day: 86_400_000 } as const;
export const validateRateLimits = (spec: RateLimitSpec): string[] => {
  const issues: string[] = [];
  for (const key of ["perMinute", "perHour", "perDay", "burst"] as const) if (!Number.isInteger(spec[key]) || spec[key] < 1) issues.push(key);
  if (issues.length === 0 && (spec.perMinute > spec.perHour || spec.perHour > spec.perDay)) issues.push("order");
  if (issues.length === 0 && spec.burst > spec.perMinute) issues.push("burst");
  return issues;
};

type Bucket = { stamps: number[]; tokens: number; refilledAt: number; observed?: { remaining: number; resetAt: number } };

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  constructor(private readonly now: () => number) {}

  private bucket(key: string, spec: RateLimitSpec, at: number): Bucket {
    let row = this.buckets.get(key);
    if (!row) { row = { stamps: [], tokens: spec.burst, refilledAt: at }; this.buckets.set(key, row); }
    // the day is the longest window: older stamps can never matter again
    const cutoff = at - WINDOW_MS.day;
    while (row.stamps.length && (row.stamps[0] as number) <= cutoff) row.stamps.shift();
    const refill = ((at - row.refilledAt) / 60_000) * spec.perMinute;
    row.tokens = Math.min(spec.burst, row.tokens + Math.max(0, refill));
    row.refilledAt = at;
    return row;
  }
  private inWindow(row: Bucket, at: number, ms: number): number[] { return row.stamps.filter((stamp) => stamp > at - ms); }

  /** Where this key stands, without spending anything. */
  check(key: string, spec: RateLimitSpec): RateStatus {
    const at = this.now();
    const row = this.bucket(key, spec, at);
    const minute = this.inWindow(row, at, WINDOW_MS.minute);
    const hour = this.inWindow(row, at, WINDOW_MS.hour);
    const day = row.stamps;
    const remaining = { minute: Math.max(0, spec.perMinute - minute.length), hour: Math.max(0, spec.perHour - hour.length), day: Math.max(0, spec.perDay - day.length), burst: Math.floor(row.tokens) };
    const resetAt = { minute: (minute[0] ?? at) + WINDOW_MS.minute, hour: (hour[0] ?? at) + WINDOW_MS.hour, day: (day[0] ?? at) + WINDOW_MS.day };
    const blocked: { window: Window; retry: number }[] = [];
    if (remaining.minute === 0) blocked.push({ window: "minute", retry: resetAt.minute - at });
    if (remaining.hour === 0) blocked.push({ window: "hour", retry: resetAt.hour - at });
    if (remaining.day === 0) blocked.push({ window: "day", retry: resetAt.day - at });
    if (remaining.burst < 1) blocked.push({ window: "burst", retry: Math.ceil(((1 - row.tokens) / spec.perMinute) * 60_000) });
    if (row.observed && row.observed.remaining <= 0 && row.observed.resetAt > at) blocked.push({ window: "minute", retry: row.observed.resetAt - at });
    // the window that frees LAST is the one the caller must wait for
    const worst = blocked.sort((a, b) => b.retry - a.retry)[0];
    return { allowed: !worst, ...(worst ? { limitedBy: worst.window } : {}), retryAfterMs: worst ? Math.max(1, worst.retry) : 0, remaining, resetAt };
  }
  /** Spends one request if the key may make it. Returns the status after (or the reason it was refused). */
  acquire(key: string, spec: RateLimitSpec): RateStatus {
    const before = this.check(key, spec);
    if (!before.allowed) return before;
    const row = this.bucket(key, spec, this.now());
    row.stamps.push(this.now());
    row.tokens -= 1;
    if (row.observed) row.observed.remaining = Math.max(0, row.observed.remaining - 1);
    // `allowed` says THIS request was granted; what is left (and when it frees) describes the state after it
    return { ...this.check(key, spec), allowed: true, retryAfterMs: 0 };
  }
  /** The provider said how much is left and when it resets (rate-limit headers): believe it when it is stricter than ours. */
  observe(key: string, spec: RateLimitSpec, report: { remaining: number; resetAt: number }): void { this.bucket(key, spec, this.now()).observed = report; }
  /** How much of the tightest window is used, 0 to 1: the health score reads this. */
  pressure(key: string, spec: RateLimitSpec): number {
    const status = this.check(key, spec);
    return Math.max(1 - status.remaining.minute / spec.perMinute, 1 - status.remaining.hour / spec.perHour, 1 - status.remaining.day / spec.perDay, 1 - status.remaining.burst / spec.burst);
  }
  reset(key: string): void { this.buckets.delete(key); }
}
