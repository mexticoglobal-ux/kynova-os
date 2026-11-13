// RAG Observability: queries, hits and misses, latency, cache hits and misses, memories and nodes used, ranking and Top K, per company. The event log carries no question and no knowledge:
// counts and short identifiers only. The observability only reads the log (and, for the cache, the state).

import type { AuditEntry, RagEventInput, RagEventType, RagState } from "./rag-types";

export type RagLogEvent = Omit<RagEventInput, "detail"> & { id: string; detail?: Readonly<Record<string, string | number | boolean>> };
const SAFE_VALUE = /^[A-Za-z0-9_.:-]{1,40}$/;

/** Numbers, booleans and short identifiers survive; free text never does. */
export function sanitizeDetail(detail: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, string | number | boolean>> | undefined {
  if (!detail) return undefined;
  const clean: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === "number" && Number.isFinite(value)) clean[key] = Math.round(value * 100) / 100;
    else if (typeof value === "boolean") clean[key] = value;
    else if (typeof value === "string" && SAFE_VALUE.test(value)) clean[key] = value;
  }
  return Object.keys(clean).length > 0 ? clean : undefined;
}

export class RagEventLog {
  private readonly events: RagLogEvent[] = [];
  private readonly listeners = new Set<(event: RagLogEvent) => void>();
  emit(input: RagEventInput): RagLogEvent {
    const detail = sanitizeDetail(input.detail);
    const event: RagLogEvent = { id: `re_${String(this.events.length + 1).padStart(6, "0")}`, at: input.at, tenantId: input.tenantId, actorKind: input.actorKind, actorId: input.actorId, type: input.type, ...(detail ? { detail } : {}) };
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
    return event;
  }
  listen(listener: (event: RagLogEvent) => void): () => void { this.listeners.add(listener); return () => void this.listeners.delete(listener); }
  all(): readonly RagLogEvent[] { return this.events; }
  forTenant(tenantId: string): readonly RagLogEvent[] { return this.events.filter((event) => event.tenantId === tenantId); }
  ofType(type: RagEventType): readonly RagLogEvent[] { return this.events.filter((event) => event.type === type); }
  toAudit(tenantId: string): readonly AuditEntry[] {
    return this.forTenant(tenantId).map((event) => ({ at: event.at, actor: event.actorKind === "system" ? "system" : event.actorId, tenantId: event.tenantId, action: event.type, ...(event.detail ? { detail: event.detail } : {}) }));
  }
}

type Counters = { queries: number; hits: number; misses: number; cacheHits: number; cacheMisses: number; memoriesUsed: number; nodesUsed: number; refused: number; feedback: number; invalidations: number; leaked: number };
const zero = (): Counters => ({ queries: 0, hits: 0, misses: 0, cacheHits: 0, cacheMisses: 0, memoriesUsed: 0, nodesUsed: 0, refused: 0, feedback: 0, invalidations: 0, leaked: 0 });
const num = (value: unknown): number => (typeof value === "number" ? value : 0);
const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10);

type Tenant = { counters: Counters; latency: number[]; latencyHit: number[]; latencyMiss: number[]; topScores: number[]; avgScores: number[]; returned: number[]; requested: number[]; intents: Record<string, number>; refusals: Record<string, number> };

export class RagObservability {
  private readonly tenants = new Map<string, Tenant>();
  private detach: (() => void) | undefined;
  constructor(log?: RagEventLog) { if (log) this.detach = log.listen((event) => this.count(event)); }
  stop(): void { this.detach?.(); }

  private row(tenantId: string): Tenant {
    const found = this.tenants.get(tenantId);
    if (found) return found;
    const created: Tenant = { counters: zero(), latency: [], latencyHit: [], latencyMiss: [], topScores: [], avgScores: [], returned: [], requested: [], intents: {}, refusals: {} };
    this.tenants.set(tenantId, created);
    return created;
  }
  count(event: RagLogEvent): void {
    const row = this.row(event.tenantId);
    const c = row.counters;
    const detail = event.detail ?? {};
    switch (event.type) {
      case "rag.cache_hit": c.cacheHits += 1; break;
      case "rag.cache_miss": c.cacheMisses += 1; break;
      case "rag.queried": {
        c.queries += 1;
        if (num(detail["items"]) > 0) c.hits += 1; else c.misses += 1;
        c.memoriesUsed += num(detail["memories"]);
        c.nodesUsed += num(detail["nodes"]);
        c.leaked += num(detail["leaked"]);
        row.returned.push(num(detail["items"]));
        row.requested.push(num(detail["topK"]));
        if (typeof detail["topScore"] === "number") row.topScores.push(detail["topScore"]);
        if (typeof detail["avgScore"] === "number") row.avgScores.push(detail["avgScore"]);
        if (typeof detail["intent"] === "string") row.intents[detail["intent"]] = (row.intents[detail["intent"]] ?? 0) + 1;
        if (typeof detail["latencyMs"] === "number") { row.latency.push(detail["latencyMs"]); (detail["cached"] === true ? row.latencyHit : row.latencyMiss).push(detail["latencyMs"]); }
        break;
      }
      case "rag.refused": { c.refused += 1; const reason = typeof detail["reason"] === "string" ? detail["reason"] : "unknown"; row.refusals[reason] = (row.refusals[reason] ?? 0) + 1; break; }
      case "rag.feedback": c.feedback += 1; break;
      case "rag.invalidated": c.invalidations += 1; break;
      default: break;
    }
  }

  /** One company's numbers; a company never sees another's. `state` adds the cache of that company. */
  snapshot(tenantId: string, state?: RagState) {
    const row = this.row(tenantId);
    const c = row.counters;
    const sorted = [...row.latency].sort((a, b) => a - b);
    const lookups = c.cacheHits + c.cacheMisses;
    return {
      counters: { ...c },
      hitRatePercent: c.queries === 0 ? 0 : Math.round((c.hits / c.queries) * 100),
      cacheHitRatePercent: lookups === 0 ? 0 : Math.round((c.cacheHits / lookups) * 100),
      latency: { count: sorted.length, avgMs: mean(sorted), maxMs: sorted.at(-1) ?? 0, p95Ms: sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] as number), avgCachedMs: mean(row.latencyHit), avgComputedMs: mean(row.latencyMiss) },
      ranking: { queriesRanked: row.topScores.length, avgTopScore: mean(row.topScores), maxTopScore: Math.max(0, ...row.topScores), avgScore: mean(row.avgScores) },
      topK: { avgRequested: mean(row.requested), avgReturned: mean(row.returned), maxReturned: Math.max(0, ...row.returned) },
      intents: { ...row.intents },
      refusals: { ...row.refusals },
      ...(state ? { cache: { entries: state.cache.filter((entry) => entry.tenantId === tenantId).length, itemsTracked: Object.keys(state.stats).filter((key) => key.startsWith(`${tenantId}|`)).length } } : {}),
    };
  }
}
