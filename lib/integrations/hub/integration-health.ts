// The Health Engine: a score from 0 to 100 for every connection, from what really happened (latency, errors, timeouts), what the provider says (token and OAuth state), how fresh the last
// sync is, how close the rate limit is, and what the circuit breaker is doing. The same function scores every provider: nothing here knows which one it is. Pure.

import type { BreakerState } from "./integration-retry";

export type TokenState = "valid" | "expiringSoon" | "expired" | "revoked" | "none";
export type OAuthState = "authorized" | "pending" | "revoked" | "none" | "n/a";
export type HealthInputs = {
  hasSamples: boolean; latencyP95Ms?: number; latencyTargetMs: number; errorRate: number; timeoutRate: number; tokenState: TokenState; oauth: OAuthState;
  lastSyncAgeMs?: number; syncMaxAgeMs: number; rateLimitPressure: number; breaker: BreakerState;
};
export type HealthFactor = { name: string; points: number; max: number; note: string };
export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "dead";
export type HealthReport = { score: number; status: HealthStatus; factors: readonly HealthFactor[] };
/** The most each factor can give: they add up to 100. */
export const HEALTH_WEIGHTS = { latency: 15, errors: 20, timeouts: 15, token: 15, sync: 10, oauth: 10, rateLimit: 5, breaker: 10 } as const;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export function healthScore(input: HealthInputs): HealthReport {
  const w = HEALTH_WEIGHTS;
  // latency: full inside the target, nothing at four times the target
  const latency = input.latencyP95Ms === undefined ? w.latency : w.latency * clamp(1 - (input.latencyP95Ms - input.latencyTargetMs) / (3 * input.latencyTargetMs));
  // errors: lose everything at a 50 % error rate; timeouts: at 30 %
  const errors = w.errors * clamp(1 - input.errorRate / 0.5);
  const timeouts = w.timeouts * clamp(1 - input.timeoutRate / 0.3);
  const token = { valid: w.token, expiringSoon: w.token * 0.55, expired: 0, revoked: 0, none: w.token }[input.tokenState];
  const sync = input.lastSyncAgeMs === undefined ? w.sync * 0.5 : w.sync * clamp(1 - (input.lastSyncAgeMs - input.syncMaxAgeMs) / (2 * input.syncMaxAgeMs));
  const oauth = { authorized: w.oauth, "n/a": w.oauth, pending: w.oauth * 0.3, none: 0, revoked: 0 }[input.oauth];
  const rate = w.rateLimit * clamp(1 - input.rateLimitPressure);
  const breaker = { closed: w.breaker, halfOpen: w.breaker * 0.5, open: 0, dead: 0 }[input.breaker];
  const factors: HealthFactor[] = [
    { name: "latency", points: latency, max: w.latency, note: input.latencyP95Ms === undefined ? "sin llamadas todavía" : `p95 ${Math.round(input.latencyP95Ms)} ms (objetivo ${input.latencyTargetMs})` },
    { name: "errors", points: errors, max: w.errors, note: `${Math.round(input.errorRate * 100)} % de errores` },
    { name: "timeouts", points: timeouts, max: w.timeouts, note: `${Math.round(input.timeoutRate * 100)} % de tiempos agotados` },
    { name: "token", points: token, max: w.token, note: input.tokenState },
    { name: "sync", points: sync, max: w.sync, note: input.lastSyncAgeMs === undefined ? "sin sincronizar" : `hace ${Math.round(input.lastSyncAgeMs / 60_000)} min` },
    { name: "oauth", points: oauth, max: w.oauth, note: input.oauth },
    { name: "rateLimit", points: rate, max: w.rateLimit, note: `${Math.round(input.rateLimitPressure * 100)} % del límite` },
    { name: "breaker", points: breaker, max: w.breaker, note: input.breaker },
  ].map((row) => ({ ...row, points: Math.round(row.points * 10) / 10 }));
  let score = Math.round(factors.reduce((total, row) => total + row.points, 0));
  // a connection that cannot work must not look healthy because everything else is fine
  if (input.breaker === "dead") score = 0;
  else if (input.breaker === "open") score = Math.min(score, 40);
  if (input.tokenState === "expired" || input.tokenState === "revoked" || input.oauth === "revoked") score = Math.min(score, 45);
  score = Math.max(0, Math.min(100, score));
  const status: HealthStatus = input.breaker === "dead" ? "dead" : score >= 80 ? "healthy" : score >= 50 ? "degraded" : "unhealthy";
  return { score, status, factors };
}

type Sample = { latencyMs: number; ok: boolean; kind?: string };
/** Keeps the last calls of every connection (a short window, so health follows what is happening now) and turns them into the inputs of the score. */
export class HealthTracker {
  private readonly samples = new Map<string, Sample[]>();
  constructor(private readonly window = 50) {}
  record(key: string, sample: Sample): void { const row = this.samples.get(key) ?? []; row.push(sample); if (row.length > this.window) row.shift(); this.samples.set(key, row); }
  summary(key: string): { count: number; p95Ms?: number; errorRate: number; timeoutRate: number } {
    const row = this.samples.get(key) ?? [];
    if (row.length === 0) return { count: 0, errorRate: 0, timeoutRate: 0 };
    const sorted = row.map((item) => item.latencyMs).sort((a, b) => a - b);
    // auth and scope failures are not the provider being unhealthy: they are counted in the token and OAuth factors
    const countable = row.filter((item) => item.kind !== "auth" && item.kind !== "scope" && item.kind !== "invalid" && item.kind !== "unsupported");
    return { count: row.length, p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] as number, errorRate: countable.length === 0 ? 0 : countable.filter((item) => !item.ok).length / countable.length, timeoutRate: countable.length === 0 ? 0 : countable.filter((item) => item.kind === "timeout").length / countable.length };
  }
  forget(key: string): void { this.samples.delete(key); }
}
