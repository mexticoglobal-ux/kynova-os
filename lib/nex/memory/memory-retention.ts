// Retention Engine: TTL, archive, expiry, deletion, compression and automatic summaries. One rule above the others: NEVER delete an important memory. An important memory (pinned, or importance
// 80 or more) that reaches its TTL is archived, kept forever and still searchable on request. Pure: the clock is handed in.

import { tokenize } from "./memory-index";
import { removeMany, replaceOne, withMemories } from "./memory-store";
import type { Memory, MemoryState, MemoryType, SweepReport } from "./memory-types";

export const RETENTION = {
  /** how long a memory lives without being touched; null never expires */
  defaultTtlDays: { conversation: 30, business: null, customer: 365, document: 180, workflow: 365, decision: null, preference: 365, learning: 180, system: null } as Readonly<Record<MemoryType, number | null>>,
  defaultImportance: { conversation: 30, business: 70, customer: 60, document: 50, workflow: 60, decision: 80, preference: 55, learning: 45, system: 90 } as Readonly<Record<MemoryType, number>>,
  importantAt: 80,
  /** an expired memory stays this long (hidden from search) before it is removed */
  graceDays: 30,
  /** an active, unused, unimportant memory goes to the archive */
  archiveAfterUnusedDays: 90,
  archiveBelowImportance: 50,
  /** an old summary is squeezed to this many characters */
  compressAfterDays: 60,
  compressTo: 160,
  summaryMax: 280,
} as const;
const DAY = 86_400_000;

export const isImportant = (memory: Pick<Memory, "pinned" | "importance">): boolean => memory.pinned || memory.importance >= RETENTION.importantAt;
export const expiryFor = (touchedAtIso: string, ttlDays: number | null): string | null => (ttlDays === null ? null : new Date(Date.parse(touchedAtIso) + ttlDays * DAY).toISOString());

const cut = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const room = text.slice(0, max - 1);
  const space = room.lastIndexOf(" ");
  return `${(space > max * 0.5 ? room.slice(0, space) : room).trimEnd()}…`;
};

/** An extractive summary: the sentences whose words are the most repeated, in their original order, within `max` characters. Deterministic. */
export function summarize(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const sentences = (clean.match(/[^.!?…]+[.!?…]*/g) ?? [clean]).map((sentence) => sentence.trim()).filter(Boolean);
  const frequency = new Map<string, number>();
  for (const sentence of sentences) for (const term of tokenize(sentence)) frequency.set(term, (frequency.get(term) ?? 0) + 1);
  const scored = sentences.map((sentence, position) => {
    const terms = tokenize(sentence);
    return { sentence, position, score: terms.reduce((total, term) => total + (frequency.get(term) ?? 0), 0) / Math.max(1, terms.length) + (position === 0 ? 0.5 : 0) };
  });
  const chosen: typeof scored = [];
  let length = 0;
  for (const item of [...scored].sort((a, b) => b.score - a.score || a.position - b.position)) {
    const extra = item.sentence.length + (chosen.length > 0 ? 1 : 0);
    if (length + extra <= max) { chosen.push(item); length += extra; }
  }
  if (chosen.length === 0) return cut(clean, max);
  return chosen.sort((a, b) => a.position - b.position).map((item) => item.sentence).join(" ");
}

export type Action = "keep" | "compress" | "archive" | "expire" | "delete";
/** What the retention rules say about one memory right now. */
export function decide(memory: Memory, nowMs: number): Action {
  if (memory.status === "expired") return memory.expiredAt && nowMs >= Date.parse(memory.expiredAt) + RETENTION.graceDays * DAY && !isImportant(memory) ? "delete" : "keep";
  if (memory.status === "archived") return "keep"; // an archive is never deleted and never expires
  if (memory.expiresAt && nowMs >= Date.parse(memory.expiresAt)) return isImportant(memory) ? "archive" : "expire";
  const idleDays = (nowMs - Math.max(Date.parse(memory.updatedAt), memory.lastUsedAt ? Date.parse(memory.lastUsedAt) : 0)) / DAY;
  if (!isImportant(memory) && memory.importance < RETENTION.archiveBelowImportance && idleDays >= RETENTION.archiveAfterUnusedDays) return "archive";
  if (!memory.pinned && !memory.compressed && memory.summary.length > RETENTION.compressTo && (nowMs - Date.parse(memory.updatedAt)) / DAY >= RETENTION.compressAfterDays) return "compress";
  return "keep";
}

/** Applies the retention rules to ONE company's memories. */
export function sweepTenant(state: MemoryState, tenantId: string, nowMs: number): { state: MemoryState; report: SweepReport } {
  const at = new Date(nowMs).toISOString();
  const archived: string[] = [];
  const expired: string[] = [];
  const deleted: string[] = [];
  const compressed: string[] = [];
  let kept = 0;
  let next = state;
  for (const memory of state.memories.filter((row) => row.tenantId === tenantId)) {
    const action = decide(memory, nowMs);
    if (action === "keep") { kept += 1; continue; }
    if (action === "delete") { deleted.push(memory.id); continue; }
    if (action === "archive") { archived.push(memory.id); next = replaceOne(next, { ...memory, status: "archived", archivedAt: at, expiresAt: null }); }
    else if (action === "expire") { expired.push(memory.id); next = replaceOne(next, { ...memory, status: "expired", expiredAt: at }); }
    else { compressed.push(memory.id); next = replaceOne(next, { ...memory, summary: summarize(memory.summary, RETENTION.compressTo), compressed: true, originalLength: memory.summary.length }); }
  }
  if (deleted.length > 0) next = removeMany(next, tenantId, new Set(deleted));
  return { state: next === state ? withMemories(state, state.memories) : next, report: { archived, expired, deleted, compressed, kept } };
}
