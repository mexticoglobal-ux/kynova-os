// RAG Cache: a deterministic cache. The key holds the company, the asker (kind, role and id: what they may see), the question's terms in a fixed order, the filters, Top K and a STAMP of
// the knowledge it was computed from (so a changed memory, node, relation, permission or vote is a different key and a stale answer is never served). A lookup compares the WHOLE key, never
// a hash of it, so two keys cannot be confused. Entries expire after a configurable TTL and each company keeps a bounded number. Pure: the clock is handed in.

import type { KnowledgeState } from "@/lib/nex/knowledge";
import type { MemoryState, Principal } from "@/lib/nex/memory";
import type { CacheEntry, CachedValue, RagConfig, RetrieveOptions } from "./rag-types";

function fnv(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, "0");
}
/** A fingerprint of everything of ONE company that can change an answer. Every asker of that company gets the same stamp: it reveals nothing. */
export function dataStamp(memory: MemoryState, graph: KnowledgeState, tenantId: string): string {
  const parts: string[] = [];
  // the timestamp alone is not enough (two changes can share a millisecond), and a permission that changed must never be missed: the fields that decide WHAT is served and TO WHOM are in it too
  for (const m of memory.memories) {
    if (m.tenantId === tenantId) parts.push(`m|${m.id}|${m.updatedAt}|${m.status}|${m.importance}|${m.confidence}|${m.pinned}|${m.uses}|${m.lastUsedAt ?? ""}|${Object.values(m.votes).join("")}|${m.summary}|${m.tags.join(",")}|${JSON.stringify(m.permissions)}`);
  }
  for (const n of graph.nodes) {
    if (n.tenantId === tenantId) parts.push(`n|${n.id}|${n.updatedAt}|${n.importance}|${n.confidence}|${n.uses}|${n.category ?? ""}|${n.tags.join(",")}|${JSON.stringify(n.permissions)}`);
  }
  for (const e of graph.edges) if (e.tenantId === tenantId) parts.push(`e:${e.id}:${e.weight}:${e.confidence}:${e.observations}`);
  return `${parts.length}.${fnv(parts.join("|"))}`;
}

export const askerKey = (principal: Principal): string => (principal.kind === "person" ? `person:${principal.role}:${principal.id}` : principal.kind === "worker" ? `worker:${principal.id}` : "system");

export function cacheKey(input: { tenantId: string; principal: Principal; terms: string; options: RetrieveOptions; topK: number; stamp: string; config: RagConfig }): string {
  const { options } = input;
  // JSON keeps the parts unambiguous whatever characters an id has
  return JSON.stringify([
    input.tenantId, askerKey(input.principal), input.terms, [options.workerId ?? null, [...(options.tags ?? [])].sort(), options.from ?? null, options.to ?? null, options.includeArchived === true, options.mode ?? "hybrid"],
    input.topK, input.config.maxChars, input.config.minScore, input.stamp,
  ]);
}

export type Lookup = { entry?: CacheEntry; expired: boolean };
/** The live entry of this key, if any. An entry of another company is never returned, even for an identical key. */
export function lookup(cache: readonly CacheEntry[], tenantId: string, key: string, nowMs: number): Lookup {
  const entry = cache.find((row) => row.key === key && row.tenantId === tenantId);
  if (!entry) return { expired: false };
  if (nowMs >= Date.parse(entry.expiresAt)) return { expired: true };
  return { entry, expired: false };
}
export const sweepExpired = (cache: readonly CacheEntry[], tenantId: string, nowMs: number): CacheEntry[] => cache.filter((row) => !(row.tenantId === tenantId && nowMs >= Date.parse(row.expiresAt)));
export const recordHit = (cache: readonly CacheEntry[], tenantId: string, key: string): CacheEntry[] => cache.map((row) => (row.key === key && row.tenantId === tenantId ? { ...row, hits: row.hits + 1 } : row));
/** Stores an entry; a company keeps at most `max`, the oldest going first. */
export function store(cache: readonly CacheEntry[], tenantId: string, key: string, value: CachedValue, nowMs: number, config: RagConfig): CacheEntry[] {
  const entry: CacheEntry = { key, tenantId, createdAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + config.ttlMs).toISOString(), hits: 0, value };
  let next = [...cache.filter((row) => !(row.key === key && row.tenantId === tenantId)), entry];
  const mine = next.filter((row) => row.tenantId === tenantId);
  if (mine.length > config.cacheMax) {
    const drop = new Set(mine.slice(0, mine.length - config.cacheMax));
    next = next.filter((row) => !drop.has(row));
  }
  return next;
}
export const dropTenant = (cache: readonly CacheEntry[], tenantId: string): CacheEntry[] => cache.filter((row) => row.tenantId !== tenantId);
/** Drops every answer of a company that used this item (its feedback changed, so those answers are outdated). */
export const dropWithItem = (cache: readonly CacheEntry[], tenantId: string, itemKey: string): CacheEntry[] => cache.filter((row) => !(row.tenantId === tenantId && row.value.items.some((item) => item.key === itemKey)));
