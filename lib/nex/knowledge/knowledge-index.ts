// Knowledge Index: a derived index of ONE company's graph (by type, worker, category, tag, relation and word). It holds no state of its own and can always be rebuilt from the graph.

import type { KnowledgeNode, KnowledgeState } from "./knowledge-types";

/** lower case, no accents, words of two letters or more */
export const wordsOf = (text: string): string[] => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 1);
export const nodeWords = (node: KnowledgeNode): string[] => [...new Set([...wordsOf(node.referenceId), ...wordsOf(node.category ?? ""), ...node.tags.flatMap((tag) => wordsOf(tag))])];

const add = (map: Map<string, Set<string>>, key: string, id: string) => { const set = map.get(key) ?? new Set<string>(); set.add(id); map.set(key, set); };

export class KnowledgeIndex {
  private readonly types = new Map<string, Set<string>>();
  private readonly workers = new Map<string, Set<string>>();
  private readonly categories = new Map<string, Set<string>>();
  private readonly tags = new Map<string, Set<string>>();
  private readonly relations = new Map<string, Set<string>>();
  private readonly words = new Map<string, Set<string>>();
  private count = 0;

  /** Only the nodes and edges of `tenantId` are indexed: an index never mixes companies. */
  static build(tenantId: string, state: KnowledgeState): KnowledgeIndex {
    const index = new KnowledgeIndex();
    for (const node of state.nodes) {
      if (node.tenantId !== tenantId) continue;
      index.count += 1;
      add(index.types, node.type, node.id);
      if (node.workerId) add(index.workers, node.workerId, node.id);
      if (node.category) add(index.categories, node.category, node.id);
      for (const tag of node.tags) add(index.tags, tag, node.id);
      for (const word of nodeWords(node)) add(index.words, word, node.id);
    }
    for (const edge of state.edges) if (edge.tenantId === tenantId) { add(index.relations, edge.relation, edge.from); add(index.relations, edge.relation, edge.to); }
    return index;
  }
  get size(): number { return this.count; }
  ofType(type: string): ReadonlySet<string> { return this.types.get(type) ?? new Set(); }
  ofWorker(workerId: string): ReadonlySet<string> { return this.workers.get(workerId) ?? new Set(); }
  ofCategory(category: string): ReadonlySet<string> { return this.categories.get(category) ?? new Set(); }
  withTag(tag: string): ReadonlySet<string> { return this.tags.get(tag) ?? new Set(); }
  /** nodes that are an end of at least one edge of this relation */
  withRelation(relation: string): ReadonlySet<string> { return this.relations.get(relation) ?? new Set(); }
  withWord(word: string): ReadonlySet<string> { return this.words.get(word) ?? new Set(); }
}

const cache = new WeakMap<readonly KnowledgeNode[], WeakMap<object, Map<string, KnowledgeIndex>>>();
/** The index of one company for this exact graph (rebuilt whenever the nodes or the edges change). */
export function indexFor(state: KnowledgeState, tenantId: string): KnowledgeIndex {
  const byEdges = cache.get(state.nodes) ?? new WeakMap<object, Map<string, KnowledgeIndex>>();
  cache.set(state.nodes, byEdges);
  const perTenant = byEdges.get(state.edges) ?? new Map<string, KnowledgeIndex>();
  byEdges.set(state.edges, perTenant);
  const found = perTenant.get(tenantId);
  if (found) return found;
  const built = KnowledgeIndex.build(tenantId, state);
  perTenant.set(tenantId, built);
  return built;
}
