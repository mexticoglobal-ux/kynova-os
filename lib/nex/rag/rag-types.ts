// NEX RAG Engine: the vocabulary. Before NEX answers, it retrieves the best context available: only what is RELEVANT, only what the asker may see, never the whole memory. The engine reads the
// NEX Memory Engine and the NEX Knowledge Graph (and, through the graph, whatever Organization, Workers, Templates, Architect, Insights, CRM, Billing, Marketplace, Academy and Automations
// already put there) and nothing else. It is READ ONLY: it never writes into any of them. Pure reducers: no clock (every event carries `at`), no database, no network, no AI, no embeddings.

import type { MemoryType, Principal } from "@/lib/nex/memory";
import type { NodeType } from "@/lib/nex/knowledge";

export type { Principal };

/** What a question is about. A question can be about several things; the first is the primary. */
export const INTENTS = ["information", "customer", "company", "document", "workflow", "finance", "sales", "marketing", "operations", "preferences", "history"] as const;
export type Intent = (typeof INTENTS)[number];
/** Which kinds of memory and of node each intent points at. `information` points at nothing in particular. */
export const INTENT_TYPES: Readonly<Record<Intent, { memory: readonly MemoryType[]; nodes: readonly NodeType[] }>> = {
  information: { memory: [], nodes: [] },
  customer: { memory: ["customer", "conversation"], nodes: ["customer", "lead", "conversation", "person"] },
  company: { memory: ["business", "decision"], nodes: ["company", "project", "service", "product", "process"] },
  document: { memory: ["document"], nodes: ["document"] },
  workflow: { memory: ["workflow", "business"], nodes: ["process", "automation", "task", "project"] },
  finance: { memory: ["business", "decision", "customer"], nodes: ["kpi", "product", "service", "event", "customer"] },
  sales: { memory: ["customer", "conversation", "decision"], nodes: ["lead", "customer", "campaign", "product", "service"] },
  marketing: { memory: ["document", "conversation", "preference"], nodes: ["campaign", "document", "conversation", "service"] },
  operations: { memory: ["workflow", "business", "conversation"], nodes: ["process", "task", "automation", "project", "event"] },
  preferences: { memory: ["preference", "learning"], nodes: ["preference", "decision"] },
  history: { memory: ["conversation", "decision"], nodes: ["conversation", "decision", "event"] },
};

export type QueryAnalysis = {
  /** the meaningful words of the question: lower case, no accents, plurals folded, no stop words */
  readonly terms: readonly string[];
  readonly intents: readonly Intent[];
  readonly primary: Intent;
  /** the question asks about the past: older knowledge counts and archived knowledge may answer */
  readonly history: boolean;
};

/** How the candidates are found. `hybrid` does everything. */
export type RetrievalMode = "hybrid" | "keyword" | "memory" | "graph" | "related";
export type Via = "keyword" | "memory" | "graph" | "related";
export type RetrieveOptions = { topK?: number; mode?: RetrievalMode; workerId?: string; tags?: readonly string[]; from?: string; to?: string; includeArchived?: boolean };

export type RagConfig = {
  /** how long a cached answer lives, in milliseconds */
  ttlMs: number;
  /** how many items the context holds by default */
  topK: number;
  /** the most characters the context text may have */
  maxChars: number;
  /** the most cached answers per company */
  cacheMax: number;
  /** below this score (0–100) an item is not relevant enough to be retrieved */
  minScore: number;
};
export const DEFAULT_CONFIG: RagConfig = { ttlMs: 60_000, topK: 8, maxChars: 1_200, cacheMax: 100, minScore: 15 };
export const MAX_TOP_K = 25;
export const MAX_QUERY_CHARS = 500;

/** What was found, before it is scored. A memory that is also a node of the graph is ONE item. */
export type RagItem = {
  /** `memory:<id>` or `node:<id>`: the same knowledge always has the same key */
  readonly key: string;
  readonly kind: "memory" | "node";
  readonly tenantId: string;
  readonly memoryId?: string;
  readonly nodeId?: string;
  /** the memory type, or the node type */
  readonly type: string;
  /** a memory's summary (already masked); a graph-only node has no text, only a reference */
  readonly summary?: string;
  readonly referenceId?: string;
  readonly category?: string;
  readonly tags: readonly string[];
  readonly importance: number;
  readonly confidence: number;
  /** the last time it was changed or used */
  readonly touchedAt: string;
  readonly advisory: boolean;
  /** `memory`, or the graph source (organization, crm, billing…) of a node */
  readonly source: string;
  readonly via: readonly Via[];
  /** a few readable relations such as `created←person` */
  readonly relations: readonly string[];
  readonly signals: {
    /** 0–100: how well the words of the question match */
    readonly text: number;
    /** 0–1: how well its kind matches what the question is about */
    readonly affinity: number;
    /** hops in the graph from what matched directly (0 = matched directly) */
    readonly distance: number;
    /** 0–1 */
    readonly centrality: number;
    readonly up: number;
    readonly down: number;
    readonly uses: number;
  };
};
export type ScoreFactor = { name: string; points: number; max: number };
export type RankedItem = RagItem & { readonly score: number; readonly factors: readonly ScoreFactor[] };

export type ContextEntry = { position: number; key: string; kind: "memory" | "node"; memoryId?: string; nodeId?: string; score: number; line: string };
export type RagContext = { text: string; entries: readonly ContextEntry[]; chars: number; truncated: boolean; dropped: { duplicate: number; sensitive: number; budget: number } };

export type CachedValue = { analysis: QueryAnalysis; items: readonly RankedItem[]; context: RagContext; topK: number };
export type CacheEntry = { key: string; tenantId: string; createdAt: string; expiresAt: string; hits: number; value: CachedValue };
export type Vote = "up" | "down";
/** What the engine has learned about an item by serving it. */
export type ItemStats = { retrieved: number; votes: Readonly<Record<string, Vote>> };
export type AuditEntry = { at: string; actor: string; tenantId: string; action: string; detail?: Readonly<Record<string, string | number | boolean>> };
export type RagState = { readonly cache: readonly CacheEntry[]; readonly stats: Readonly<Record<string, ItemStats>>; readonly audit: readonly AuditEntry[] };

export type Refusal = "tenant" | "forbidden" | "workerInactive" | "invalid" | "sensitive" | "notFound";

type Base = { tenantId: string; actor: Principal; at: string };
export type RagEvent =
  | (Base & { type: "retrieve"; query: string; options?: RetrieveOptions })
  | (Base & { type: "feedback"; key: string; value: Vote })
  | (Base & { type: "invalidate" });

export const RAG_EVENT_TYPES = ["rag.queried", "rag.cache_hit", "rag.cache_miss", "rag.refused", "rag.feedback", "rag.invalidated"] as const;
export type RagEventType = (typeof RAG_EVENT_TYPES)[number];
/** What happened, without the question or the knowledge: counts and short identifiers. */
export type RagEventInput = { at: string; tenantId: string; actorKind: Principal["kind"]; actorId: string; type: RagEventType; detail?: Readonly<Record<string, unknown>> };

export type RagResult = {
  ok: boolean;
  refusal?: Refusal;
  reasons?: readonly string[];
  cached: boolean;
  analysis?: QueryAnalysis;
  topK?: number;
  items: readonly RankedItem[];
  context?: RagContext;
  /** ids of the memories and nodes that ended up in the context: the caller may mark them used */
  memoriesUsed: readonly string[];
  nodesUsed: readonly string[];
  events: readonly RagEventInput[];
};
export type RagOutcome = { state: RagState; result: RagResult };
/** The company decides which workers are active; this layer never guesses. */
export type RagEnv = { isWorkerActive(tenantId: string, workerId: string): boolean };
