// RAG Retriever: finds the candidates for a question, in four ways that can be used alone or together (hybrid):
//   keyword  — the words of the question against the memories (the Memory Engine's own search);
//   memory   — the KIND of knowledge the question is about (customer, document, preference…), even when no word matches;
//   graph    — the words and kinds against the Knowledge Graph's nodes;
//   related  — what the graph relates to the best direct matches, up to two hops away.
// A memory that is also a node of the graph is ONE item. Everything goes through the asker's permissions first, so what they cannot see is never a candidate. READ ONLY: nothing is written
// anywhere. The order of everything is fixed, so the same question over the same knowledge finds the same candidates.

import { canRead as canReadMemory, searchMemories, voteCounts, type Memory, type MemoryState, type Principal } from "@/lib/nex/memory";
import { RANK_WEIGHTS as GRAPH_WEIGHTS, rankNodes, relatedKnowledge, searchKnowledge, viewFor, type KnowledgeNode, type KnowledgeState, type View } from "@/lib/nex/knowledge";
import { INTENT_TYPES, type QueryAnalysis, type RagItem, type RetrieveOptions, type Via } from "./rag-types";

export type Sources = { memory: MemoryState; graph: KnowledgeState };

const KEYWORD_LIMIT = 50;
const KIND_LIMIT = 20;
const SEEDS = 5;
const RELATED_DEPTH = 2;
const RELATED_LIMIT = 15;
const MAX_RELATIONS = 3;
/** the graph's placeholders for people, workers and the company are not memories even when a memory build created them */
const NOT_A_MEMORY: readonly string[] = ["company", "person", "worker"];
const uniq = <T>(values: readonly T[]): T[] => [...new Set(values)];

type Ctx = { principal: Principal; analysis: QueryAnalysis; history: boolean; view: View; ranks: ReturnType<typeof rankNodes>; memories: ReadonlyMap<string, Memory>; nodeOfMemory: ReadonlyMap<string, KnowledgeNode> };

/** How well a kind of knowledge matches what the question is about: 1 for the main subject, 0.5 for the others. */
function affinity(analysis: QueryAnalysis, kind: "memory" | "node", type: string): number {
  let best = 0;
  analysis.intents.forEach((intent, index) => {
    const types: readonly string[] = kind === "memory" ? INTENT_TYPES[intent].memory : INTENT_TYPES[intent].nodes;
    if (types.includes(type)) best = Math.max(best, index === 0 ? 1 : 0.5);
  });
  return best;
}
const centralityOf = (ctx: Ctx, nodeId: string | undefined): number => (nodeId ? (ctx.ranks.get(nodeId)?.factors.find((factor) => factor.name === "centrality")?.points ?? 0) / GRAPH_WEIGHTS.centrality : 0);
const latest = (a: string, b?: string): string => (b !== undefined && Date.parse(b) > Date.parse(a) ? b : a);

/** A few readable relations of a node, by kind only (`created←person`); every node belongs to the company, so that one says nothing. */
function relationsOf(view: View, nodeId: string): string[] {
  const label = (id: string) => view.nodes.get(id)?.type ?? "?";
  const out = (view.out.get(nodeId) ?? []).filter((edge) => !(edge.relation === "belongsTo" && label(edge.to) === "company")).map((edge) => `${edge.relation}→${label(edge.to)}`);
  const inn = (view.inn.get(nodeId) ?? []).map((edge) => `${edge.relation}←${label(edge.from)}`);
  return uniq([...out, ...inn]).slice(0, MAX_RELATIONS);
}

function memoryItem(ctx: Ctx, memory: Memory, node: KnowledgeNode | undefined, via: Via, text: number, distance: number): RagItem {
  const votes = voteCounts(memory);
  return {
    key: `memory:${memory.id}`, kind: "memory", tenantId: memory.tenantId, memoryId: memory.id, ...(node ? { nodeId: node.id } : {}), type: memory.type, summary: memory.summary, category: memory.category,
    tags: memory.tags, importance: memory.importance, confidence: memory.confidence, touchedAt: latest(memory.updatedAt, memory.lastUsedAt), advisory: memory.advisory, source: "memory", via: [via],
    relations: node ? relationsOf(ctx.view, node.id) : [],
    signals: { text, affinity: affinity(ctx.analysis, "memory", memory.type), distance, centrality: centralityOf(ctx, node?.id), up: votes.up, down: votes.down, uses: memory.uses },
  };
}
/** A node of the graph as an item: the memory it stands for (if it is a memory), or just the reference (it has no text). A node of a memory that is gone or hidden is skipped. */
function nodeItem(ctx: Ctx, node: KnowledgeNode, via: Via, text: number, distance: number): RagItem | undefined {
  const memory = node.source === "memory" ? ctx.memories.get(node.referenceId) : undefined;
  if (memory) {
    if (!canReadMemory(ctx.principal, memory) || memory.status === "expired" || (memory.status === "archived" && !ctx.history)) return undefined;
    return memoryItem(ctx, memory, node, via, text, distance);
  }
  if (node.source === "memory" && !NOT_A_MEMORY.includes(node.type)) return undefined; // its memory is gone: the graph is stale, and a stale node answers nothing
  return {
    key: `node:${node.id}`, kind: "node", tenantId: node.tenantId, nodeId: node.id, type: node.type, referenceId: node.referenceId, ...(node.category ? { category: node.category } : {}), tags: node.tags,
    importance: node.importance, confidence: node.confidence, touchedAt: node.updatedAt, advisory: false, source: node.source, via: [via], relations: relationsOf(ctx.view, node.id),
    signals: { text, affinity: affinity(ctx.analysis, "node", node.type), distance, centrality: centralityOf(ctx, node.id), up: 0, down: 0, uses: node.uses },
  };
}

function merge(a: RagItem, b: RagItem): RagItem {
  const nodeId = a.nodeId ?? b.nodeId;
  return {
    ...a, ...(nodeId !== undefined ? { nodeId } : {}), via: uniq([...a.via, ...b.via]), relations: a.relations.length > 0 ? a.relations : b.relations,
    signals: { ...a.signals, text: Math.max(a.signals.text, b.signals.text), affinity: Math.max(a.signals.affinity, b.signals.affinity), distance: Math.min(a.signals.distance, b.signals.distance), centrality: Math.max(a.signals.centrality, b.signals.centrality) },
  };
}

/** The candidates for a question. Only items of the asker's company, only what the asker may read. */
export function retrieveCandidates(sources: Sources, principal: Principal, analysis: QueryAnalysis, options: RetrieveOptions, nowMs: number): RagItem[] {
  const mode = options.mode ?? "hybrid";
  const history = analysis.history || options.includeArchived === true;
  const tenant = principal.tenantId;
  const view = viewFor(sources.graph, principal);
  const nodeOfMemory = new Map<string, KnowledgeNode>();
  for (const node of view.nodes.values()) if (node.source === "memory") nodeOfMemory.set(node.referenceId, node);
  const ctx: Ctx = {
    principal, analysis, history, view, ranks: rankNodes(view), nodeOfMemory,
    memories: new Map(sources.memory.memories.filter((memory) => memory.tenantId === tenant).map((memory) => [memory.id, memory])),
  };
  const found = new Map<string, RagItem>();
  const add = (item: RagItem | undefined) => { if (item) { const previous = found.get(item.key); found.set(item.key, previous ? merge(previous, item) : item); } };

  const text = analysis.terms.join(" ");
  const memoryFilters = { ...(options.workerId !== undefined ? { workerId: options.workerId } : {}), ...(options.tags ? { tags: options.tags } : {}), ...(options.from !== undefined ? { from: options.from } : {}), ...(options.to !== undefined ? { to: options.to } : {}), includeArchived: history };
  const graphFilters = { ...(options.workerId !== undefined ? { workerId: options.workerId } : {}), ...(options.tags ? { tags: options.tags } : {}) };
  const memoryTypes = uniq(analysis.intents.flatMap((intent) => INTENT_TYPES[intent].memory));
  const nodeTypes = uniq(analysis.intents.flatMap((intent) => INTENT_TYPES[intent].nodes));

  if ((mode === "hybrid" || mode === "keyword" || mode === "related") && text !== "") {
    for (const hit of searchMemories(sources.memory, principal, { text, ...memoryFilters, limit: KEYWORD_LIMIT }, nowMs).hits) add(memoryItem(ctx, hit.memory, nodeOfMemory.get(hit.memory.id), "keyword", hit.relevance, 0));
  }
  if ((mode === "hybrid" || mode === "memory") && memoryTypes.length > 0) {
    for (const hit of searchMemories(sources.memory, principal, { type: memoryTypes, ...memoryFilters, limit: KIND_LIMIT }, nowMs).hits) add(memoryItem(ctx, hit.memory, nodeOfMemory.get(hit.memory.id), "memory", 0, 0));
  }
  if (mode === "hybrid" || mode === "graph" || mode === "related") {
    if (text !== "") for (const hit of searchKnowledge(sources.graph, principal, { text, ...graphFilters, limit: KEYWORD_LIMIT }).hits) add(nodeItem(ctx, hit.node, "graph", hit.relevance, 0));
    if (nodeTypes.length > 0 && mode !== "related") for (const hit of searchKnowledge(sources.graph, principal, { types: nodeTypes, ...graphFilters, limit: KIND_LIMIT }).hits) add(nodeItem(ctx, hit.node, "graph", 0, 0));
  }
  if (mode === "hybrid" || mode === "related") {
    // what the graph relates to the best direct matches
    const seeds = [...found.values()].filter((item) => item.nodeId !== undefined && item.signals.text > 0)
      .sort((a, b) => b.signals.text - a.signals.text || b.importance - a.importance || a.key.localeCompare(b.key)).slice(0, SEEDS);
    for (const seed of seeds) {
      for (const hit of relatedKnowledge(sources.graph, principal, seed.nodeId as string, { depth: RELATED_DEPTH, limit: RELATED_LIMIT }).hits) add(nodeItem(ctx, hit.node, "related", 0, hit.distance ?? 1));
    }
  }

  const wanted: Partial<Record<typeof mode, Via>> = { keyword: "keyword", memory: "memory", graph: "graph", related: "related" };
  const only = wanted[mode];
  return [...found.values()]
    // relevant means: a word matched, the kind of knowledge fits, or the graph relates it to what matched
    .filter((item) => item.signals.text > 0 || item.signals.affinity > 0 || item.via.includes("related"))
    .filter((item) => only === undefined || item.via.includes(only))
    .sort((a, b) => a.key.localeCompare(b.key));
}
