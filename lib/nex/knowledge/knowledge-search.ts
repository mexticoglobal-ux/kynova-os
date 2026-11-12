// Knowledge Search: by node, relation, type, company, worker, category, depth and ranking, plus "related knowledge" around a node. The company and the asker's permissions come first: only what
// the asker can see is ever a candidate. Pure: the same graph, asker and query always return the same hits in the same order.

import { bfs, neighborIds, viewFor, viewEdges, type Direction } from "./knowledge-graph";
import { KnowledgeIndex, indexFor, nodeWords, wordsOf } from "./knowledge-index";
import { companyDistances, rankNodes } from "./knowledge-ranking";
import { nodeId } from "./knowledge-node";
import { slug } from "./knowledge-security";
import { NODE_TYPES, RELATIONS, type KnowledgeNode, type KnowledgeState, type NodeType, type Principal, type Relation } from "./knowledge-types";

export type KnowledgeQuery = {
  text?: string;
  nodeId?: string;
  referenceId?: string;
  types?: readonly NodeType[];
  /** nodes with a visible edge of one of these relations; with `from`, the only relations the walk may follow */
  relations?: readonly Relation[];
  workerId?: string;
  category?: string;
  tags?: readonly string[];
  /** search around this node, up to `depth` hops */
  from?: string;
  /** hops from `from`, or from the company when there is no `from` (default 2 with `from`) */
  depth?: number;
  direction?: Direction;
  minConfidence?: number;
  limit?: number;
};
export type KnowledgeHit = { node: KnowledgeNode; score: number; rank: number; relevance: number; distance?: number; via?: Relation; why: readonly string[] };
export type KnowledgeSearchResult = { hits: readonly KnowledgeHit[]; total: number; miss: boolean; issues: readonly string[] };
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;
const TEXT_SHARE = 0.6;
const empty = (issues: string[]): KnowledgeSearchResult => ({ hits: [], total: 0, miss: true, issues });
const round = (value: number) => Math.round(value * 10) / 10;

export function searchKnowledge(state: KnowledgeState, principal: Principal, query: KnowledgeQuery): KnowledgeSearchResult {
  const issues: string[] = [];
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1)) issues.push("limit");
  if (query.depth !== undefined && (!Number.isInteger(query.depth) || query.depth < 0 || query.depth > 10)) issues.push("depth");
  if (query.minConfidence !== undefined && (!Number.isInteger(query.minConfidence) || query.minConfidence < 0 || query.minConfidence > 100)) issues.push("minConfidence");
  if (query.types?.some((type) => !NODE_TYPES.includes(type))) issues.push("types");
  if (query.relations?.some((relation) => !RELATIONS.includes(relation))) issues.push("relations");
  if (query.direction !== undefined && !["out", "in", "both"].includes(query.direction)) issues.push("direction");
  if (issues.length > 0) return empty(issues);

  // 1. the company and what this asker may see
  const view = viewFor(state, principal);
  const index = indexFor(state, principal.tenantId);

  // 2. around a node, or the whole visible graph
  let anchor: Map<string, number> | undefined;
  const via = new Map<string, Relation>();
  let pool: string[];
  if (query.from !== undefined) {
    if (!view.nodes.has(query.from)) return empty(["from"]);
    const walk = bfs(view, query.from, { maxDepth: query.depth ?? 2, direction: query.direction ?? "both", ...(query.relations ? { relations: query.relations } : {}) });
    anchor = new Map(walk.map((visit) => [visit.id, visit.depth]));
    for (const visit of walk) if (visit.via) via.set(visit.id, visit.via.relation);
    pool = walk.filter((visit) => visit.depth > 0).map((visit) => visit.id);
  } else {
    pool = [...view.nodes.keys()];
    if (query.depth !== undefined) {
      const hops = companyDistances(view);
      pool = pool.filter((id) => (hops.get(id) ?? Number.POSITIVE_INFINITY) <= (query.depth as number));
    }
  }

  // 3. structured filters, narrowed with the index
  const narrow = (ids: ReadonlySet<string>) => { pool = pool.filter((id) => ids.has(id)); };
  if (query.types) narrow(new Set(query.types.flatMap((type) => [...index.ofType(type)])));
  if (query.workerId !== undefined) narrow(index.ofWorker(query.workerId));
  if (query.category !== undefined) narrow(index.ofCategory(slug(query.category, 40)));
  if (query.tags && query.tags.length > 0) narrow(new Set(query.tags.flatMap((tag) => [...index.withTag(slug(tag))])));
  if (query.relations && query.from === undefined) narrow(new Set(query.relations.flatMap((relation) => [...index.withRelation(relation)])));
  if (query.nodeId !== undefined) pool = pool.filter((id) => id === query.nodeId);
  if (query.referenceId !== undefined) pool = pool.filter((id) => view.nodes.get(id)?.referenceId === query.referenceId);
  if (query.minConfidence !== undefined) pool = pool.filter((id) => (view.nodes.get(id)?.confidence ?? 0) >= (query.minConfidence as number));

  // 4. text over the words a node is filed under (its reference, category and tags: a node holds no text)
  const terms = [...new Set(wordsOf(query.text ?? ""))];
  const relevance = new Map<string, number>();
  if (terms.length > 0) {
    for (const id of pool) {
      const words = new Set(nodeWords(view.nodes.get(id) as KnowledgeNode));
      const matched = terms.filter((term) => words.has(term)).length;
      if (matched > 0) relevance.set(id, matched / terms.length);
    }
    pool = pool.filter((id) => relevance.has(id));
  }

  // 5. rank (closeness to the anchor when there is one)
  const ranks = rankNodes(view, anchor);
  const hits: KnowledgeHit[] = pool.map((id) => {
    const node = view.nodes.get(id) as KnowledgeNode;
    const rank = ranks.get(id)?.score ?? 0;
    const fit = round((relevance.get(id) ?? 0) * 100);
    const distance = anchor?.get(id);
    return {
      node, rank, relevance: fit, score: terms.length > 0 ? round(TEXT_SHARE * fit + (1 - TEXT_SHARE) * rank) : rank, ...(distance !== undefined ? { distance } : {}), ...(via.has(id) ? { via: via.get(id) as Relation } : {}),
      why: [...(terms.length > 0 ? [`texto ${fit}`] : []), `ranking ${rank}`, ...(distance !== undefined ? [`distancia ${distance}`] : [])],
    };
  });
  hits.sort((a, b) => b.score - a.score || b.rank - a.rank || a.node.id.localeCompare(b.node.id));
  return { hits: hits.slice(0, Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)), total: hits.length, miss: hits.length === 0, issues };
}

export type RelatedOptions = { depth?: number; limit?: number; relations?: readonly Relation[] };
const NEAR_SHARE = 0.3;
const SHARED_SHARE = 0.2;
/**
 * Knowledge related to a node: what is close to it, what it shares neighbors with, and what ranks high. Only what the asker can see.
 * score = 50 % rank + 30 % closeness (1 / hops) + 20 % shared neighbors (three or more count as full).
 */
export function relatedKnowledge(state: KnowledgeState, principal: Principal, id: string, options: RelatedOptions = {}): KnowledgeSearchResult {
  const view = viewFor(state, principal);
  if (!view.nodes.has(id)) return empty(["id"]);
  const walk = bfs(view, id, { maxDepth: options.depth ?? 2, ...(options.relations ? { relations: options.relations } : {}) }).filter((visit) => visit.depth > 0);
  const anchor = new Map<string, number>([[id, 0], ...walk.map((visit): [string, number] => [visit.id, visit.depth])]);
  const ranks = rankNodes(view, anchor);
  const mine = new Set(neighborIds(view, id));
  const hits: KnowledgeHit[] = walk.map((visit) => {
    const node = view.nodes.get(visit.id) as KnowledgeNode;
    const shared = neighborIds(view, visit.id).filter((other) => mine.has(other)).length;
    const rank = ranks.get(visit.id)?.score ?? 0;
    const score = round((1 - NEAR_SHARE - SHARED_SHARE) * rank + NEAR_SHARE * (100 / visit.depth) + SHARED_SHARE * 100 * Math.min(1, shared / 3));
    return { node, rank, relevance: 0, score, distance: visit.depth, ...(visit.via ? { via: visit.via.relation } : {}), why: [`ranking ${rank}`, `distancia ${visit.depth}`, `vecinos en común ${shared}`] };
  });
  hits.sort((a, b) => b.score - a.score || b.rank - a.rank || a.node.id.localeCompare(b.node.id));
  return { hits: hits.slice(0, Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT)), total: hits.length, miss: hits.length === 0, issues: [] };
}
export { nodeId, viewEdges, KnowledgeIndex };
