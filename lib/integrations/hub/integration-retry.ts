// The Retry Engine: exponential backoff (with a deterministic jitter, so tests and replays are exact), a circuit breaker per connection, a cooldown, a "dead connector" state for one that keeps
// failing even when probed again, and recovery. It decides nothing about WHAT to call: the engine hands it a function and it says whether, when and how often to try again.

import { RETRYABLE_KINDS, type BreakerSpec, type ProviderFailure, type ProviderResult, type RetrySpec } from "./integration-types";

export const DEFAULT_RETRY: RetrySpec = { maxAttempts: 3, baseMs: 200, factor: 2, maxMs: 5_000, jitter: 0.2 };
export const DEFAULT_BREAKER: BreakerSpec = { failureThreshold: 5, cooldownMs: 30_000, deadAfterOpens: 3 };
export const mergeRetry = (over?: Partial<RetrySpec>): RetrySpec => ({ ...DEFAULT_RETRY, ...over });
export const mergeBreaker = (over?: Partial<BreakerSpec>): BreakerSpec => ({ ...DEFAULT_BREAKER, ...over });

function fnv(text: string): number { let hash = 0x811c9dc5; for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; } return hash; }
/** The wait before retry number `attempt` (1 = after the first failure): base × factor^(attempt-1), capped, with a deterministic jitter of ±`jitter` seeded by the call. */
export function backoffMs(attempt: number, policy: RetrySpec, seed: string): number {
  const raw = Math.min(policy.maxMs, policy.baseMs * policy.factor ** Math.max(0, attempt - 1));
  const unit = (fnv(`${seed}|${attempt}`) % 10_000) / 10_000; // 0..1, same for the same call
  return Math.max(0, Math.round(raw * (1 + (unit * 2 - 1) * policy.jitter)));
}

export type AttemptRecord = { attempt: number; ok: boolean; kind?: string; waitedMs: number };
export type RetryOutcome<T> = { result: ProviderResult<T>; attempts: readonly AttemptRecord[] };
/**
 * Runs `call` until it works, fails for a reason that retrying cannot fix, or runs out of attempts. It waits `backoffMs` between attempts (or the provider's own `retryAfterMs` when that is longer,
 * still capped) and never retries what is not retryable. `onRetry` lets the engine record the wait.
 */
export async function runWithRetry<T>(call: (attempt: number) => Promise<ProviderResult<T>>, input: { policy: RetrySpec; seed: string; sleep: (ms: number) => Promise<void>; onRetry?: (attempt: number, waitMs: number, failure: ProviderFailure) => void }): Promise<RetryOutcome<T>> {
  const attempts: AttemptRecord[] = [];
  let last: ProviderResult<T> | undefined;
  for (let attempt = 1; attempt <= input.policy.maxAttempts; attempt += 1) {
    last = await call(attempt);
    if (last.ok) { attempts.push({ attempt, ok: true, waitedMs: 0 }); return { result: last, attempts }; }
    const failed = last.error;
    const more = attempt < input.policy.maxAttempts && failed.retryable && RETRYABLE_KINDS.includes(failed.kind);
    const waitMs = more ? Math.min(input.policy.maxMs, Math.max(backoffMs(attempt, input.policy, input.seed), failed.retryAfterMs ?? 0)) : 0;
    attempts.push({ attempt, ok: false, kind: failed.kind, waitedMs: waitMs });
    if (!more) return { result: last, attempts };
    input.onRetry?.(attempt, waitMs, failed);
    await input.sleep(waitMs);
  }
  return { result: last as ProviderResult<T>, attempts };
}

// ---------------------------------------------------------------- the circuit breaker
export type BreakerState = "closed" | "open" | "halfOpen" | "dead";
export type BreakerInfo = { state: BreakerState; consecutiveFailures: number; opens: number; openedAt?: number; retryAt?: number };
export type BreakerDecision = { allowed: boolean; state: BreakerState; retryAt?: number; transition?: "half_open" };
/**
 * Closed: calls flow, consecutive failures are counted. At the threshold it OPENS: no call is made until the cooldown passes. Then it is HALF-OPEN: one probe is allowed; a success closes it,
 * a failure opens it again. After `deadAfterOpens` openings in a row it is DEAD: nothing is called until a person (or a healthy probe) recovers it.
 */
export class CircuitBreaker {
  private state: BreakerState = "closed";
  private failures = 0;
  private opens = 0;
  private openedAt: number | undefined;
  private probing = false;
  constructor(private readonly spec: BreakerSpec) {}

  allow(now: number): BreakerDecision {
    if (this.state === "dead") return { allowed: false, state: "dead" };
    if (this.state === "open") {
      const retryAt = (this.openedAt ?? now) + this.spec.cooldownMs;
      if (now < retryAt) return { allowed: false, state: "open", retryAt };
      this.state = "halfOpen";
      this.probing = true;
      return { allowed: true, state: "halfOpen", transition: "half_open" };
    }
    if (this.state === "halfOpen") { if (this.probing) return { allowed: false, state: "halfOpen" }; this.probing = true; return { allowed: true, state: "halfOpen" }; }
    return { allowed: true, state: "closed" };
  }
  /** returns the transition that happened, if any */
  success(): "closed" | undefined {
    const was = this.state;
    this.failures = 0;
    this.probing = false;
    if (was === "halfOpen") { this.state = "closed"; this.opens = 0; this.openedAt = undefined; return "closed"; }
    return undefined;
  }
  failure(now: number): "open" | "dead" | undefined {
    this.probing = false;
    if (this.state === "halfOpen") return this.trip(now);
    this.failures += 1;
    if (this.state === "closed" && this.failures >= this.spec.failureThreshold) return this.trip(now);
    return undefined;
  }
  private trip(now: number): "open" | "dead" {
    this.opens += 1;
    this.failures = 0;
    if (this.opens >= this.spec.deadAfterOpens) { this.state = "dead"; this.openedAt = now; return "dead"; }
    this.state = "open";
    this.openedAt = now;
    return "open";
  }
  /** Brings a dead (or open) connector back to half-open, so the next call is a single probe. Only a person or a healthy probe does this. */
  recover(): void { this.state = "halfOpen"; this.failures = 0; this.opens = Math.max(0, this.spec.deadAfterOpens - 1); this.probing = false; }
  info(): BreakerInfo { return { state: this.state, consecutiveFailures: this.failures, opens: this.opens, ...(this.openedAt !== undefined ? { openedAt: this.openedAt, retryAt: this.openedAt + this.spec.cooldownMs } : {}) }; }
}
