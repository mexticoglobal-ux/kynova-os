// Memory Observability: memories created and used, searches, hits and misses, latency, ranking, TTL and expirations, per company. It only reads the event log (and, for TTL, the state).

import { forTenant } from "./memory-store";
import type { MemoryLogEvent, MemoryEventLog } from "./memory-events";
import type { MemoryState } from "./memory-types";

type Counters = { created: number; merged: number; updated: number; used: number; searches: number; hits: number; misses: number; refused: number; feedback: number; learned: number; archived: number; expired: number; deleted: number; compressed: number; restored: number };
const zero = (): Counters => ({ created: 0, merged: 0, updated: 0, used: 0, searches: 0, hits: 0, misses: 0, refused: 0, feedback: 0, learned: 0, archived: 0, expired: 0, deleted: 0, compressed: 0, restored: 0 });
const num = (value: unknown): number => (typeof value === "number" ? value : 0);

type Tenant = { counters: Counters; latency: number[]; topScores: number[]; refusals: Record<string, number> };

export class MemoryObservability {
  private readonly tenants = new Map<string, Tenant>();
  private detach: (() => void) | undefined;
  constructor(log?: MemoryEventLog) { if (log) this.detach = log.listen((event) => this.count(event)); }
  stop(): void { this.detach?.(); }

  private row(tenantId: string): Tenant {
    const found = this.tenants.get(tenantId);
    if (found) return found;
    const created: Tenant = { counters: zero(), latency: [], topScores: [], refusals: {} };
    this.tenants.set(tenantId, created);
    return created;
  }
  count(event: MemoryLogEvent): void {
    const row = this.row(event.tenantId);
    const c = row.counters;
    const detail = event.detail ?? {};
    switch (event.type) {
      case "memory.created": c.created += 1; break;
      case "memory.merged": c.merged += 1; break;
      case "memory.updated": c.updated += 1; break;
      case "memory.used": c.used += Math.max(1, num(detail["count"])); break;
      case "memory.searched": {
        c.searches += 1;
        if (num(detail["hits"]) > 0) c.hits += 1; else c.misses += 1;
        if (typeof detail["latencyMs"] === "number") row.latency.push(detail["latencyMs"]);
        if (typeof detail["topScore"] === "number") row.topScores.push(detail["topScore"]);
        break;
      }
      case "memory.refused": { c.refused += 1; const reason = typeof detail["reason"] === "string" ? detail["reason"] : "unknown"; row.refusals[reason] = (row.refusals[reason] ?? 0) + 1; break; }
      case "memory.feedback": c.feedback += 1; break;
      case "memory.learned": c.learned += 1; break;
      case "memory.archived": c.archived += 1; break;
      case "memory.expired": c.expired += 1; break;
      case "memory.deleted": c.deleted += 1; break;
      case "memory.compressed": c.compressed += 1; break;
      case "memory.restored": c.restored += 1; break;
      default: break;
    }
  }

  /** One company's numbers. A company never sees another's. `state` adds what is about to expire. */
  snapshot(tenantId: string, state?: MemoryState, nowMs?: number) {
    const row = this.row(tenantId);
    const sorted = [...row.latency].sort((a, b) => a - b);
    const total = row.counters.hits + row.counters.misses;
    const ttl = state && nowMs !== undefined ? this.ttl(state, tenantId, nowMs) : undefined;
    return {
      counters: { ...row.counters },
      hitRatePercent: total === 0 ? 0 : Math.round((row.counters.hits / total) * 100),
      latency: { count: sorted.length, avgMs: sorted.length === 0 ? 0 : Math.round((sorted.reduce((a, b) => a + b, 0) / sorted.length) * 10) / 10, maxMs: sorted.at(-1) ?? 0, p95Ms: sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] as number) },
      ranking: { searchesRanked: row.topScores.length, avgTopScore: row.topScores.length === 0 ? 0 : Math.round((row.topScores.reduce((a, b) => a + b, 0) / row.topScores.length) * 10) / 10, maxTopScore: Math.max(0, ...row.topScores) },
      refusals: { ...row.refusals },
      ...(ttl ? { ttl } : {}),
    };
  }
  private ttl(state: MemoryState, tenantId: string, nowMs: number) {
    const mine = forTenant(state, tenantId);
    const soon = nowMs + 7 * 86_400_000;
    return {
      active: mine.filter((memory) => memory.status === "active").length,
      archived: mine.filter((memory) => memory.status === "archived").length,
      expired: mine.filter((memory) => memory.status === "expired").length,
      neverExpire: mine.filter((memory) => memory.status === "active" && memory.expiresAt === null).length,
      expiringIn7Days: mine.filter((memory) => memory.status === "active" && memory.expiresAt !== null && Date.parse(memory.expiresAt) <= soon).length,
    };
  }
}
