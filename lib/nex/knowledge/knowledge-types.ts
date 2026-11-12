// NEX Knowledge Graph: the vocabulary. The graph RELATES what a company already knows; it never copies it. A node holds a reference (`referenceId`) to something that lives elsewhere (a memory,
// a client, a worker…), never its text. Everything is plain data handled by pure reducers: no clock (every event carries `at`), no database, no network, no AI.
// The layer is independent of the NEX Memory Engine: it reads memories through the structural `MemoryRow` shape and imports nothing from it.

export const NODE_TYPES = [
  "company", "person", "customer", "lead", "worker", "agent", "document", "project", "process", "product", "service", "property", "campaign", "conversation", "decision", "preference", "automation", "event", "task", "kpi",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const RELATIONS = ["created", "owns", "belongsTo", "assignedTo", "worksWith", "references", "dependsOn", "relatedTo", "generated", "approved", "rejected", "learned", "uses", "contains", "mentions", "participatesIn"] as const;
export type Relation = (typeof RELATIONS)[number];

/** Where a node or an edge comes from. Every source is READ ONLY for the graph: the graph never writes into them. */
export const SOURCES = ["memory", "organization", "crm", "templates", "architect", "workers", "automations", "insights", "billing", "marketplace", "academy", "manual"] as const;
export type SourceName = (typeof SOURCES)[number];

export const ROLES = ["viewer", "member", "manager", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_RANK: Readonly<Record<Role, number>> = { viewer: 1, member: 2, manager: 3, admin: 4, owner: 5 };

/** Who asks. Every principal belongs to ONE company: another company's graph is never visible to it. */
export type Principal =
  | { kind: "person"; tenantId: string; id: string; role: Role }
  | { kind: "worker"; tenantId: string; id: string }
  | { kind: "system"; tenantId: string };
export const principalId = (principal: Principal): string => (principal.kind === "system" ? "system" : principal.id);

export type Visibility = "tenant" | "restricted" | "private";
export type KnowledgePermissions = { visibility: Visibility; minRole: Role; roles: readonly Role[]; workerIds: readonly string[]; userIds: readonly string[] };

export type KnowledgeNode = {
  /** `n:<type>:<referenceId>`: the same thing is always the same node, so a node can never be duplicated. */
  readonly id: string;
  readonly tenantId: string;
  readonly type: NodeType;
  /** The id of the thing this node stands for, in the module that owns it. */
  readonly referenceId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** 0–100 */
  readonly confidence: number;
  /** 0–100 */
  readonly importance: number;
  readonly permissions: KnowledgePermissions;
  readonly source: SourceName;
  readonly workerId?: string;
  readonly category?: string;
  readonly tags: readonly string[];
  readonly uses: number;
};
export type KnowledgeEdge = {
  /** `e:<from>|<relation>|<to>`: one edge per (from, relation, to). */
  readonly id: string;
  readonly tenantId: string;
  readonly from: string;
  readonly to: string;
  readonly relation: Relation;
  /** 0–100 */
  readonly confidence: number;
  /** 0 < weight ≤ 1: how strong the tie is */
  readonly weight: number;
  readonly createdAt: string;
  /** how many times it was seen again (manual reinforcement) */
  readonly observations: number;
  readonly source: SourceName;
};

export type AuditEntry = { at: string; actor: string; tenantId: string; action: string; detail?: Readonly<Record<string, string | number | boolean>> };
export type KnowledgeState = { readonly nodes: readonly KnowledgeNode[]; readonly edges: readonly KnowledgeEdge[]; readonly audit: readonly AuditEntry[] };

export type NodeInput = { type: NodeType; referenceId: string; confidence?: number; importance?: number; permissions?: Partial<KnowledgePermissions>; workerId?: string; category?: string; tags?: readonly string[] };
export type EdgeInput = { from: string; to: string; relation: Relation; confidence?: number; weight?: number };

/** A fact a source module already holds, handed to the builder as plain data. The graph reads it and never writes back. */
export type SourceLink = { relation: Relation; toType: NodeType; toId: string; direction?: "out" | "in"; confidence?: number; weight?: number };
export type SourceRecord = { tenantId: string; type: NodeType; referenceId: string; importance?: number; confidence?: number; workerId?: string; category?: string; tags?: readonly string[]; permissions?: Partial<KnowledgePermissions>; links?: readonly SourceLink[] };

/** The part of a NEX memory the graph needs. It is structurally what a memory already is: nothing is copied, only referenced. */
export type MemoryRow = {
  readonly id: string; readonly tenantId: string;
  readonly type: "conversation" | "business" | "customer" | "document" | "workflow" | "decision" | "preference" | "learning" | "system";
  readonly importance: number; readonly confidence: number; readonly category: string; readonly tags: readonly string[]; readonly workerId?: string;
  readonly permissions: KnowledgePermissions; readonly createdBy: { readonly kind: "person" | "worker" | "system"; readonly id: string };
  readonly status: "active" | "archived" | "expired"; readonly advisory: boolean; readonly confirmedBy?: string; readonly uses: number;
};

export type Refusal = "tenant" | "forbidden" | "workerInactive" | "invalid" | "sensitive" | "notFound" | "relation" | "cycle" | "self" | "limit";

type Base = { tenantId: string; actor: Principal; at: string };
export type KnowledgeEvent =
  | (Base & { type: "node.upsert"; input: NodeInput })
  | (Base & { type: "node.remove"; id: string })
  | (Base & { type: "node.use"; ids: readonly string[] })
  | (Base & { type: "edge.link"; input: EdgeInput })
  | (Base & { type: "edge.unlink"; id: string })
  | (Base & { type: "build"; source: SourceName; records: readonly SourceRecord[]; replace?: boolean });

export const KNOWLEDGE_EVENT_TYPES = ["node.created", "node.updated", "node.removed", "node.used", "edge.created", "edge.updated", "edge.removed", "graph.built", "graph.refused", "graph.searched", "graph.traversed"] as const;
export type KnowledgeEventType = (typeof KNOWLEDGE_EVENT_TYPES)[number];
/** What happened, without any knowledge: ids, counts and short identifiers. */
export type KnowledgeEventInput = { at: string; tenantId: string; actorKind: Principal["kind"]; actorId: string; type: KnowledgeEventType; detail?: Readonly<Record<string, unknown>> };

export type BuildReport = { source: SourceName; nodes: { created: number; updated: number; removed: number }; edges: { created: number; updated: number; removed: number }; skipped: Readonly<Record<string, number>> };
export type KnowledgeResult = { ok: boolean; refusal?: Refusal; reasons?: readonly string[]; node?: KnowledgeNode; edge?: KnowledgeEdge; created?: boolean; removed?: { nodes: number; edges: number }; used?: readonly string[]; build?: BuildReport; events: readonly KnowledgeEventInput[] };
export type KnowledgeOutcome = { state: KnowledgeState; result: KnowledgeResult };
/** The company decides which workers are active; this layer never guesses. */
export type KnowledgeEnv = { isWorkerActive(tenantId: string, workerId: string): boolean };
