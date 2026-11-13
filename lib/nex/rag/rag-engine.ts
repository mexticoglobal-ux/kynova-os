// RAG Engine: the pipeline  question → Query Analyzer → Memory Retrieval → Knowledge Graph Retrieval → Ranking → Context Builder → answer context.
// `reduceRag(state, event, sources, config)` is a pure reducer (no clock, no database, no AI, no embeddings): the same state, event and knowledge always give the same result. It is READ ONLY
// over the Memory Engine and the Knowledge Graph: it receives their states as values, calls their pure search functions, and writes nothing into either. Its own state is only the cache, what
// it has learned by serving items (how often, and the feedback it was given) and an audit trail. Permissions come first: knowledge the asker cannot see is not a candidate, so for them it
// does not exist. Level 3 (ADR-0009): only people (or the system) grade knowledge; a worker only asks.

import { canRead as canReadMemory, type MemoryState } from "@/lib/nex/memory";
import { canReadNode, type KnowledgeState } from "@/lib/nex/knowledge";
import { cacheKey, dataStamp, dropTenant, dropWithItem, lookup, recordHit, store, sweepExpired } from "./rag-cache";
import { buildContext } from "./rag-context";
import { RagEventLog, RagObservability } from "./rag-observability";
import { analyzeQuery, canonicalTerms } from "./rag-query";
import { rankCandidates, statsKey } from "./rag-ranking";
import { retrieveCandidates } from "./rag-retriever";
import { authorize, canGiveFeedback, canInvalidate, onlyTenant, validateQuery } from "./rag-security";
import {
  DEFAULT_CONFIG, MAX_TOP_K,
  type AuditEntry, type CachedValue, type ItemStats, type Principal, type RagConfig, type RagEnv, type RagEvent, type RagEventInput, type RagEventType, type RagOutcome, type RagResult, type RagState, type Refusal,
  type RetrieveOptions, type Vote,
} from "./rag-types";

export type RagSources = { memory: MemoryState; graph: KnowledgeState; env: RagEnv };
export const newRagState = (): RagState => ({ cache: [], stats: {}, audit: [] });
const MAX_AUDIT = 2_000;
const ID = /^[\w.:-]{1,64}$/;
const MODES = ["hybrid", "keyword", "memory", "graph", "related"];

export function resolveConfig(partial: Partial<RagConfig> = {}): RagConfig {
  const pick = (value: number | undefined, fallback: number, min: number, max: number) => (value !== undefined && Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback);
  return {
    ttlMs: pick(partial.ttlMs, DEFAULT_CONFIG.ttlMs, 1, 86_400_000), topK: pick(partial.topK, DEFAULT_CONFIG.topK, 1, MAX_TOP_K), maxChars: pick(partial.maxChars, DEFAULT_CONFIG.maxChars, 80, 20_000),
    cacheMax: pick(partial.cacheMax, DEFAULT_CONFIG.cacheMax, 1, 1_000), minScore: pick(partial.minScore, DEFAULT_CONFIG.minScore, 0, 100),
  };
}

const principalName = (principal: Principal): string => (principal.kind === "system" ? "system" : principal.id);
const note = (event: RagEvent, type: RagEventType, detail?: Readonly<Record<string, unknown>>): RagEventInput => ({
  at: event.at, tenantId: event.actor.tenantId, actorKind: event.actor.kind, actorId: principalName(event.actor), type, ...(detail ? { detail } : {}),
});
function finish(state: RagState, event: RagEvent, result: Omit<RagResult, "events">, events: readonly RagEventInput[], detail: Record<string, string | number | boolean> = {}): RagOutcome {
  // the audit trail names the action and counts, never the question or the knowledge; it is written in the ACTOR's company
  const entry: AuditEntry = { at: event.at, actor: principalName(event.actor), tenantId: event.actor.tenantId, action: `${event.type}${result.ok ? "" : ".refused"}`, detail: { ok: result.ok, ...(result.refusal ? { reason: result.refusal } : {}), ...detail } };
  return { state: { ...state, audit: [...state.audit, entry].slice(-MAX_AUDIT) }, result: { ...result, events } };
}
const empty = { cached: false, items: [], memoriesUsed: [], nodesUsed: [] } as const;
const refuse = (state: RagState, event: RagEvent, refusal: Refusal, reasons: readonly string[] = []): RagOutcome =>
  finish(state, event, { ok: false, refusal, ...(reasons.length > 0 ? { reasons } : {}), ...empty }, [note(event, "rag.refused", { reason: refusal, action: event.type })]);

function validateOptions(options: RetrieveOptions): string[] {
  const issues: string[] = [];
  if (options.topK !== undefined && (!Number.isInteger(options.topK) || options.topK < 1)) issues.push("topK");
  if (options.mode !== undefined && !MODES.includes(options.mode)) issues.push("mode");
  if (options.workerId !== undefined && !ID.test(options.workerId)) issues.push("workerId");
  if (options.tags !== undefined && (!Array.isArray(options.tags) || options.tags.length > 8 || options.tags.some((tag) => typeof tag !== "string" || tag.length > 64))) issues.push("tags");
  for (const key of ["from", "to"] as const) { const value = options[key]; if (value !== undefined && Number.isNaN(Date.parse(value))) issues.push(key); }
  return issues;
}
function bump(stats: Readonly<Record<string, ItemStats>>, tenantId: string, keys: readonly string[]): Readonly<Record<string, ItemStats>> {
  const next: Record<string, ItemStats> = { ...stats };
  for (const key of keys) { const id = statsKey(tenantId, key); const own = next[id]; next[id] = { retrieved: (own?.retrieved ?? 0) + 1, votes: own?.votes ?? {} }; }
  return next;
}

function retrieve(state: RagState, event: Extract<RagEvent, { type: "retrieve" }>, sources: RagSources, config: RagConfig): RagOutcome {
  const valid = validateQuery(event.query);
  if (!valid.ok) return refuse(state, event, valid.refusal, valid.reasons);
  const options = event.options ?? {};
  const issues = validateOptions(options);
  if (issues.length > 0) return refuse(state, event, "invalid", issues);
  const { tenantId, actor } = event;
  const nowMs = Date.parse(event.at);
  const topK = Math.min(options.topK ?? config.topK, MAX_TOP_K);
  const analysis = analyzeQuery(valid.text);

  let cache = sweepExpired(state.cache, tenantId, nowMs);
  const key = cacheKey({ tenantId, principal: actor, terms: canonicalTerms(analysis), options, topK, stamp: dataStamp(sources.memory, sources.graph, tenantId), config });
  const hit = lookup(cache, tenantId, key, nowMs).entry;
  let value: CachedValue;
  let leaked = 0;
  if (hit) {
    value = hit.value;
    cache = recordHit(cache, tenantId, key);
  } else {
    // permissions first (inside the searches), then a last guard on the company, then ranking and the context
    const found = onlyTenant(retrieveCandidates(sources, actor, analysis, options, nowMs), tenantId);
    leaked = found.leaked;
    const built = buildContext(rankCandidates(found.kept, analysis, state.stats, nowMs, config.minScore), topK, config.maxChars);
    value = { analysis, items: built.included, context: built.context, topK };
    cache = store(cache, tenantId, key, value, nowMs, config);
  }
  const cached = hit !== undefined;
  const items = value.items;
  const memoriesUsed = items.flatMap((item) => (item.memoryId ? [item.memoryId] : []));
  const nodesUsed = [...new Set(items.flatMap((item) => (item.nodeId ? [item.nodeId] : [])))];
  const scores = items.map((item) => item.score);
  const events = [
    note(event, cached ? "rag.cache_hit" : "rag.cache_miss"),
    note(event, "rag.queried", {
      intent: value.analysis.primary, terms: value.analysis.terms.length, topK: value.topK, items: items.length, memories: memoriesUsed.length, nodes: nodesUsed.length, cached, leaked,
      ...(scores.length > 0 ? { topScore: scores[0], avgScore: scores.reduce((a, b) => a + b, 0) / scores.length } : {}),
    }),
  ];
  const next: RagState = { ...state, cache, stats: bump(state.stats, tenantId, items.map((item) => item.key)) };
  return finish(next, event, { ok: true, cached, analysis: value.analysis, topK: value.topK, items, context: value.context, memoriesUsed, nodesUsed }, events, { cached, items: items.length });
}

export function reduceRag(state: RagState, event: RagEvent, sources: RagSources, config: RagConfig = DEFAULT_CONFIG): RagOutcome {
  const { actor } = event;
  const refusal = authorize(actor, event.tenantId, sources.env);
  if (refusal) return refuse(state, event, refusal);
  if (Number.isNaN(Date.parse(event.at))) return refuse(state, event, "invalid", ["at"]);
  const { tenantId } = event;

  switch (event.type) {
    case "retrieve": return retrieve(state, event, sources, config);
    case "feedback": {
      if (!canGiveFeedback(actor)) return refuse(state, event, "forbidden");
      if (event.value !== "up" && event.value !== "down") return refuse(state, event, "invalid", ["value"]);
      const [kind, ...rest] = event.key.split(":");
      const id = rest.join(":");
      // what the asker cannot read does not exist for them: it cannot be graded either
      const readable = kind === "memory" ? sources.memory.memories.some((memory) => memory.tenantId === tenantId && memory.id === id && canReadMemory(actor, memory))
        : kind === "node" ? sources.graph.nodes.some((node) => node.tenantId === tenantId && node.id === id && canReadNode(actor, node)) : undefined;
      if (readable === undefined) return refuse(state, event, "invalid", ["key"]);
      if (!readable) return refuse(state, event, "notFound");
      const id2 = statsKey(tenantId, event.key);
      const own = state.stats[id2];
      const vote: Vote = event.value;
      const stats = { ...state.stats, [id2]: { retrieved: own?.retrieved ?? 0, votes: { ...(own?.votes ?? {}), [`${actor.kind}:${principalName(actor)}`]: vote } } };
      // the answers that used this item are outdated now
      return finish({ ...state, stats, cache: dropWithItem(state.cache, tenantId, event.key) }, event, { ok: true, ...empty }, [note(event, "rag.feedback", { value: vote })]);
    }
    case "invalidate": {
      if (!canInvalidate(actor)) return refuse(state, event, "forbidden");
      const dropped = state.cache.filter((entry) => entry.tenantId === tenantId).length;
      return finish({ ...state, cache: dropTenant(state.cache, tenantId) }, event, { ok: true, ...empty }, [note(event, "rag.invalidated", { entries: dropped })], { entries: dropped });
    }
  }
}

// ------------------------------------------------------------------------------------------ the engine: state + log + observability around the reducer
export type EngineOptions = {
  env: RagEnv;
  /** milliseconds; injected so nothing here reads a clock */
  now: () => number;
  /** read-only access to the knowledge: the engine asks for the CURRENT state of each at every question and never writes to either */
  memory: () => MemoryState;
  graph: () => KnowledgeState;
  config?: Partial<RagConfig>;
  state?: RagState;
};

export class RagEngine {
  state: RagState;
  readonly config: RagConfig;
  readonly log = new RagEventLog();
  readonly observability = new RagObservability(this.log);
  constructor(private readonly options: EngineOptions) {
    this.state = options.state ?? newRagState();
    this.config = resolveConfig(options.config);
  }

  private iso(ms: number): string { return new Date(ms).toISOString(); }
  private run(event: RagEvent, latencyMs?: number): RagResult {
    const { state, result } = reduceRag(this.state, event, { memory: this.options.memory(), graph: this.options.graph(), env: this.options.env }, this.config);
    this.state = state;
    for (const input of result.events) this.log.emit(input.type === "rag.queried" && latencyMs !== undefined ? { ...input, detail: { ...input.detail, latencyMs } } : input);
    return result;
  }

  /** Retrieves the context for a question. The latency of the whole pipeline (cache hit or not) is recorded. */
  retrieve(actor: Principal, query: string, options: RetrieveOptions = {}): RagResult {
    const started = this.options.now();
    const event: RagEvent = { type: "retrieve", tenantId: actor.tenantId, actor, at: this.iso(started), query, options };
    // the question is never kept: the reducer receives it, the event log and the audit trail never do
    const { state, result } = reduceRag(this.state, event, { memory: this.options.memory(), graph: this.options.graph(), env: this.options.env }, this.config);
    this.state = state;
    const latencyMs = Math.max(0, this.options.now() - started);
    for (const input of result.events) this.log.emit(input.type === "rag.queried" ? { ...input, detail: { ...input.detail, latencyMs } } : input);
    return result;
  }
  feedback(actor: Principal, key: string, value: Vote): RagResult { return this.run({ type: "feedback", tenantId: actor.tenantId, actor, at: this.iso(this.options.now()), key, value }); }
  invalidate(actor: Principal): RagResult { return this.run({ type: "invalidate", tenantId: actor.tenantId, actor, at: this.iso(this.options.now()) }); }
  snapshot(tenantId: string) { return this.observability.snapshot(tenantId, this.state); }
}
