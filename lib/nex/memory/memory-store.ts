// Memory Store: the state and the small pure operations on it. There is no database: the state is a plain value that a reducer returns. Every lookup carries the company.

import { tokenize } from "./memory-index";
import type { AuditEntry, Memory, MemoryState } from "./memory-types";

/** Most memories a company may keep alive. The knowledge must stay useful, not become a log. */
export const MAX_MEMORIES_PER_TENANT = 5_000;
export const MAX_AUDIT = 2_000;

export const newMemoryState = (): MemoryState => ({ memories: [], seq: {}, audit: [] });
export const forTenant = (state: MemoryState, tenantId: string): readonly Memory[] => state.memories.filter((memory) => memory.tenantId === tenantId);
/** A memory by id INSIDE a company: the same id in another company is another memory. */
export const getIn = (state: MemoryState, tenantId: string, id: string): Memory | undefined => state.memories.find((memory) => memory.tenantId === tenantId && memory.id === id);
export const aliveCount = (state: MemoryState, tenantId: string): number => state.memories.filter((memory) => memory.tenantId === tenantId && memory.status !== "expired").length;

export function nextId(state: MemoryState, tenantId: string): { id: string; seq: Readonly<Record<string, number>> } {
  const n = (state.seq[tenantId] ?? 0) + 1;
  return { id: `mem_${String(n).padStart(6, "0")}`, seq: { ...state.seq, [tenantId]: n } };
}
/** Two memories say the same thing when their type and the meaningful words of their summary are the same. */
export const dedupKey = (type: string, summary: string): string => `${type}|${tokenize(summary).join(" ")}`;

export const withMemories = (state: MemoryState, memories: readonly Memory[]): MemoryState => ({ ...state, memories });
export const replaceOne = (state: MemoryState, next: Memory): MemoryState => withMemories(state, state.memories.map((memory) => (memory.tenantId === next.tenantId && memory.id === next.id ? next : memory)));
export const removeMany = (state: MemoryState, tenantId: string, ids: ReadonlySet<string>): MemoryState => withMemories(state, state.memories.filter((memory) => !(memory.tenantId === tenantId && ids.has(memory.id))));
export const withAudit = (state: MemoryState, entry: AuditEntry): MemoryState => ({ ...state, audit: [...state.audit, entry].slice(-MAX_AUDIT) });
