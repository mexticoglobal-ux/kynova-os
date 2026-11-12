// Memory Search: by text, tags, category, company, worker, type, date and ranking. The company filter runs FIRST and is not optional: what another company wrote is never even a candidate.
// Then the asker's permissions, then the filters, then relevance (text) and rank. Pure: the same state, asker and query always return the same hits in the same order.

import { indexFor, tokenize } from "./memory-index";
import { rankMemory } from "./memory-ranking";
import { canRead, slug } from "./memory-security";
import type { Memory, MemoryState, MemoryType, Principal } from "./memory-types";

export type SearchQuery = {
  text?: string;
  tags?: readonly string[];
  tagMode?: "any" | "all";
  category?: string;
  type?: MemoryType | readonly MemoryType[];
  workerId?: string;
  /** ISO dates, compared with the last update */
  from?: string;
  to?: string;
  limit?: number;
  includeArchived?: boolean;
};
export type SearchHit = { memory: Memory; relevance: number; rank: number; score: number; why: readonly string[] };
export type SearchResult = { hits: readonly SearchHit[]; total: number; miss: boolean; terms: number; issues: readonly string[] };
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;
/** With a text, relevance counts more than rank; without one, rank decides. */
const RELEVANCE_SHARE = 0.65;

export function searchMemories(state: MemoryState, principal: Principal, query: SearchQuery, nowMs: number): SearchResult {
  const issues: string[] = [];
  const from = query.from === undefined ? undefined : Date.parse(query.from);
  const to = query.to === undefined ? undefined : Date.parse(query.to);
  if (from !== undefined && Number.isNaN(from)) issues.push("from");
  if (to !== undefined && Number.isNaN(to)) issues.push("to");
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit < 1)) issues.push("limit");
  if (issues.length > 0) return { hits: [], total: 0, miss: true, terms: 0, issues };

  // 1. the company, then what this asker may read
  const mine = state.memories.filter((memory) => memory.tenantId === principal.tenantId);
  const readable = new Set(mine.filter((memory) => canRead(principal, memory)).map((memory) => memory.id));
  const index = indexFor(state.memories, principal.tenantId);

  // 2. structured filters
  const types = query.type === undefined ? undefined : new Set(Array.isArray(query.type) ? query.type : [query.type]);
  const tags = (query.tags ?? []).map((tag) => slug(tag));
  const category = query.category === undefined ? undefined : slug(query.category, 40);
  const terms = tokenize(query.text ?? "");
  const relevance = terms.length > 0 ? index.score(terms) : undefined;
  const top = relevance ? Math.max(0, ...relevance.values()) : 0;

  const candidates = mine.filter((memory) => {
    if (!readable.has(memory.id)) return false;
    if (memory.status === "expired") return false;
    if (memory.status === "archived" && !query.includeArchived) return false;
    if (types && !types.has(memory.type)) return false;
    if (category !== undefined && memory.category !== category) return false;
    if (query.workerId !== undefined && memory.workerId !== query.workerId) return false;
    if (tags.length > 0) {
      const has = tags.map((tag) => memory.tags.includes(tag));
      if (query.tagMode === "all" ? !has.every(Boolean) : !has.some(Boolean)) return false;
    }
    const touched = Date.parse(memory.updatedAt);
    if (from !== undefined && touched < from) return false;
    if (to !== undefined && touched > to) return false;
    if (relevance && !relevance.has(memory.id)) return false;
    return true;
  });

  const scored: SearchHit[] = candidates.map((memory) => {
    const rank = rankMemory(memory, nowMs).score;
    const fit = relevance && top > 0 ? Math.round(((relevance.get(memory.id) ?? 0) / top) * 1000) / 10 : 0;
    const score = relevance ? Math.round((RELEVANCE_SHARE * fit + (1 - RELEVANCE_SHARE) * rank) * 10) / 10 : rank;
    const why = [...(relevance ? [`texto ${fit}`] : []), `ranking ${rank}`, ...(tags.length ? ["etiquetas"] : []), ...(category ? ["categoría"] : []), ...(types ? ["tipo"] : [])];
    return { memory, relevance: fit, rank, score, why };
  });
  scored.sort((a, b) => b.score - a.score || b.rank - a.rank || a.memory.id.localeCompare(b.memory.id));
  const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  return { hits: scored.slice(0, limit), total: scored.length, miss: scored.length === 0, terms: terms.length, issues };
}
