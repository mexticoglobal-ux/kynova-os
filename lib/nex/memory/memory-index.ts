// Memory Index: a derived inverted index (text, tags, category, type, worker) built from the memories of ONE company. It holds no state of its own: it can always be rebuilt from the memories.
// Relevance is BM25 over the summary, tags and category, so the same memories and the same query always give the same numbers.

import type { Memory } from "./memory-types";

const STOPWORDS = new Set(["a", "al", "con", "de", "del", "el", "en", "es", "la", "las", "lo", "los", "para", "por", "que", "se", "su", "un", "una", "y", "o", "the", "of", "and", "to", "in", "is", "for", "on", "with", "an", "as", "at", "by", "it", "be"]);

/** lower case, no accents, plural endings folded, stop words removed */
export function tokenize(text: string): string[] {
  return text
    .normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1 && !STOPWORDS.has(word))
    .map((word) => (word.length > 4 && word.endsWith("es") ? word.slice(0, -2) : word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word));
}

const K1 = 1.2;
const B = 0.75;
const add = <K>(map: Map<K, Set<string>>, key: K, id: string) => { const set = map.get(key) ?? new Set<string>(); set.add(id); map.set(key, set); };

export class MemoryIndex {
  private readonly postings = new Map<string, Map<string, number>>();
  private readonly lengths = new Map<string, number>();
  private readonly byTag = new Map<string, Set<string>>();
  private readonly byCategory = new Map<string, Set<string>>();
  private readonly byType = new Map<string, Set<string>>();
  private readonly byWorker = new Map<string, Set<string>>();
  private total = 0;

  /** Only the memories of `tenantId` are indexed: an index never mixes companies. */
  static build(tenantId: string, memories: readonly Memory[]): MemoryIndex {
    const index = new MemoryIndex();
    for (const memory of memories) if (memory.tenantId === tenantId) index.add(memory);
    return index;
  }

  private add(memory: Memory): void {
    // tags and category count double: they are what somebody chose to file the memory under
    const terms = [...tokenize(memory.summary), ...memory.tags.flatMap((tag) => tokenize(tag)), ...memory.tags.flatMap((tag) => tokenize(tag)), ...tokenize(memory.category)];
    this.lengths.set(memory.id, terms.length);
    this.total += terms.length;
    for (const term of terms) { const row = this.postings.get(term) ?? new Map<string, number>(); row.set(memory.id, (row.get(memory.id) ?? 0) + 1); this.postings.set(term, row); }
    for (const tag of memory.tags) add(this.byTag, tag, memory.id);
    add(this.byCategory, memory.category, memory.id);
    add(this.byType, memory.type, memory.id);
    if (memory.workerId) add(this.byWorker, memory.workerId, memory.id);
  }

  get size(): number { return this.lengths.size; }
  withTag(tag: string): ReadonlySet<string> { return this.byTag.get(tag) ?? new Set(); }
  withCategory(category: string): ReadonlySet<string> { return this.byCategory.get(category) ?? new Set(); }
  withType(type: string): ReadonlySet<string> { return this.byType.get(type) ?? new Set(); }
  ofWorker(workerId: string): ReadonlySet<string> { return this.byWorker.get(workerId) ?? new Set(); }

  /** BM25 score of every memory that contains at least one query term. */
  score(terms: readonly string[]): Map<string, number> {
    const scores = new Map<string, number>();
    const average = this.lengths.size === 0 ? 1 : Math.max(1, this.total / this.lengths.size);
    for (const term of new Set(terms)) {
      const row = this.postings.get(term);
      if (!row) continue;
      const idf = Math.log(1 + (this.lengths.size - row.size + 0.5) / (row.size + 0.5));
      for (const [id, frequency] of row) {
        const length = this.lengths.get(id) ?? average;
        scores.set(id, (scores.get(id) ?? 0) + (idf * frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * length) / average)));
      }
    }
    return scores;
  }
}

const cache = new WeakMap<readonly Memory[], Map<string, MemoryIndex>>();
/** The index of one company for this exact list of memories (rebuilt whenever the list changes). */
export function indexFor(memories: readonly Memory[], tenantId: string): MemoryIndex {
  const perTenant = cache.get(memories) ?? new Map<string, MemoryIndex>();
  cache.set(memories, perTenant);
  const found = perTenant.get(tenantId);
  if (found) return found;
  const built = MemoryIndex.build(tenantId, memories);
  perTenant.set(tenantId, built);
  return built;
}
