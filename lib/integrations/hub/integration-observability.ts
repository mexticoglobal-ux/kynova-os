// Observability for the Hub: counters, latency and a trace per request, all derived from the Hub's own events (so there is one source of truth) and from the latencies the engine reports.
// Nothing here holds a token, a message or a provider's words: labels are provider ids, event types and failure kinds.

import type { HubEvent, HubEventLog, HubEventType } from "./integration-events";

export type LatencyStats = { count: number; avgMs: number; p95Ms: number; maxMs: number };
export type MetricsSnapshot = {
  events: number; byType: Readonly<Record<string, number>>; byProvider: Readonly<Record<string, Readonly<Record<string, number>>>>; latency: Readonly<Record<string, LatencyStats>>;
  successRate: Readonly<Record<string, number | null>>; rateLimited: number; retries: number; fallbacks: number; circuitsOpened: number; deadConnectors: number;
};
export class Observability {
  private readonly counts = new Map<string, number>();
  private readonly perProvider = new Map<string, Map<string, number>>();
  private readonly latencies = new Map<string, number[]>();
  private total = 0;
  private detach: (() => void) | undefined;
  constructor(log?: HubEventLog) { if (log) this.detach = log.listen((event) => this.count(event)); }
  private count(event: HubEvent): void {
    this.total += 1;
    this.counts.set(event.type, (this.counts.get(event.type) ?? 0) + 1);
    const row = this.perProvider.get(event.providerId) ?? new Map<string, number>();
    row.set(event.type, (row.get(event.type) ?? 0) + 1);
    this.perProvider.set(event.providerId, row);
  }
  /** The engine reports how long a provider call took. */
  recordLatency(providerId: string, ms: number): void { const row = this.latencies.get(providerId) ?? []; row.push(Math.max(0, ms)); this.latencies.set(providerId, row); }
  stop(): void { this.detach?.(); }
  private latencyStats(values: readonly number[]): LatencyStats {
    const sorted = [...values].sort((a, b) => a - b);
    return { count: sorted.length, avgMs: Math.round(sorted.reduce((total, value) => total + value, 0) / sorted.length), p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] as number, maxMs: sorted.at(-1) as number };
  }
  snapshot(): MetricsSnapshot {
    const get = (type: HubEventType) => this.counts.get(type) ?? 0;
    const successRate: Record<string, number | null> = {};
    for (const [provider, row] of this.perProvider) {
      const done = (row.get("execute.succeeded") ?? 0) + (row.get("execute.failed") ?? 0);
      successRate[provider] = done === 0 ? null : Math.round(((row.get("execute.succeeded") ?? 0) / done) * 100);
    }
    return {
      events: this.total, byType: Object.fromEntries(this.counts), byProvider: Object.fromEntries([...this.perProvider].map(([provider, row]) => [provider, Object.fromEntries(row)])),
      latency: Object.fromEntries([...this.latencies].filter(([, values]) => values.length).map(([provider, values]) => [provider, this.latencyStats(values)])), successRate,
      rateLimited: get("rate.limited"), retries: get("retry.scheduled"), fallbacks: get("fallback.used"), circuitsOpened: get("circuit.opened"), deadConnectors: get("connector.dead"),
    };
  }
}
/** A trace id that ties together everything one request caused. Deterministic from a counter, so a replay produces the same ids. */
export const traceIdFor = (counter: number): string => `tr_${String(counter).padStart(8, "0")}`;
