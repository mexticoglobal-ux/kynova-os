// NEX Memory Engine: the vocabulary. NEX remembers USEFUL KNOWLEDGE per company, never whole conversations, prompts, credentials or restricted personal data. Everything is plain data
// handled by pure reducers: no clock (every event carries `at`), no database, no network, no AI.

export const MEMORY_TYPES = ["conversation", "business", "customer", "document", "workflow", "decision", "preference", "learning", "system"] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const ROLES = ["viewer", "member", "manager", "admin", "owner"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_RANK: Readonly<Record<Role, number>> = { viewer: 1, member: 2, manager: 3, admin: 4, owner: 5 };

/** Who asks. Every principal belongs to ONE company: a memory of another company is never visible to it. */
export type Principal =
  | { kind: "person"; tenantId: string; id: string; role: Role }
  | { kind: "worker"; tenantId: string; id: string }
  | { kind: "system"; tenantId: string };
export const principalId = (principal: Principal): string => (principal.kind === "system" ? "system" : principal.id);

export type Visibility = "tenant" | "restricted" | "private";
export type MemoryPermissions = { visibility: Visibility; minRole: Role; roles: readonly Role[]; workerIds: readonly string[]; userIds: readonly string[] };
export type MemorySource = { kind: "worker" | "person" | "system" | "import"; ref?: string };
export type MemoryStatus = "active" | "archived" | "expired";
export type Vote = "up" | "down";

export type Memory = {
  readonly id: string; // unique INSIDE a company; always looked up together with the company
  readonly tenantId: string;
  readonly workerId?: string;
  readonly type: MemoryType;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: { kind: "person" | "worker" | "system"; id: string };
  readonly source: MemorySource;
  /** 0–100: how much it matters. From 80 (or pinned) a memory is IMPORTANT and is never deleted. */
  readonly importance: number;
  /** 0–100: how sure we are it is true. */
  readonly confidence: number;
  readonly category: string;
  readonly tags: readonly string[];
  readonly ttlDays: number | null;
  readonly expiresAt: string | null;
  readonly permissions: MemoryPermissions;
  /** The knowledge itself, short. Never a transcript. */
  readonly summary: string;
  /** An opaque reference to an embedding kept elsewhere; this layer never stores vectors. */
  readonly embeddingRef?: string;
  readonly status: MemoryStatus;
  readonly pinned: boolean;
  /** Learned memories advise; they never change a rule of the system. */
  readonly advisory: boolean;
  readonly observations: number;
  readonly compressed: boolean;
  readonly originalLength?: number;
  readonly uses: number;
  readonly lastUsedAt?: string;
  readonly votes: Readonly<Record<string, Vote>>;
  readonly archivedAt?: string;
  readonly expiredAt?: string;
  readonly confirmedBy?: string;
};

export type AuditEntry = { at: string; actor: string; tenantId: string; action: string; detail?: Readonly<Record<string, string | number | boolean>> };
export type MemoryState = { readonly memories: readonly Memory[]; readonly seq: Readonly<Record<string, number>>; readonly audit: readonly AuditEntry[] };

export type RememberInput = {
  type: MemoryType;
  /** The knowledge, already short. */
  summary?: string;
  /** Longer raw text: it is summarized and then DROPPED, never stored. */
  notes?: string;
  category: string;
  tags?: readonly string[];
  importance?: number;
  confidence?: number;
  ttlDays?: number | null;
  source?: MemorySource;
  embeddingRef?: string;
  permissions?: Partial<MemoryPermissions>;
  workerId?: string;
  /** The caller says the text is restricted personal information: it is refused. */
  restricted?: boolean;
};
export const LEARN_KINDS = ["preference", "decision", "process", "workstyle"] as const;
export type LearnKind = (typeof LEARN_KINDS)[number];
export type LearnInput = { kind: LearnKind; summary?: string; notes?: string; tags?: readonly string[]; workerId?: string; source?: MemorySource };

export type Refusal = "tenant" | "forbidden" | "workerInactive" | "invalid" | "secret" | "prompt" | "transcript" | "restricted" | "rules" | "notFound" | "important" | "limit";

type Base = { tenantId: string; actor: Principal; at: string };
export type MemoryEvent =
  | (Base & { type: "remember"; input: RememberInput })
  | (Base & { type: "learn"; input: LearnInput })
  | (Base & { type: "use"; ids: readonly string[] })
  | (Base & { type: "feedback"; id: string; value: Vote })
  | (Base & { type: "confirm"; id: string })
  | (Base & { type: "pin"; id: string; pinned: boolean })
  | (Base & { type: "archive"; id: string })
  | (Base & { type: "restore"; id: string })
  | (Base & { type: "forget"; id: string })
  | (Base & { type: "permissions.set"; id: string; permissions: Partial<MemoryPermissions> })
  | (Base & { type: "sweep" });

export const MEMORY_EVENT_TYPES = [
  "memory.created", "memory.updated", "memory.merged", "memory.refused", "memory.used", "memory.searched", "memory.feedback", "memory.confirmed", "memory.pinned",
  "memory.archived", "memory.restored", "memory.expired", "memory.deleted", "memory.compressed", "memory.permissions_changed", "memory.learned", "memory.swept",
] as const;
export type MemoryEventType = (typeof MEMORY_EVENT_TYPES)[number];
/** What happened, without the knowledge itself: ids, counts and short identifiers. */
export type MemoryEventInput = { at: string; tenantId: string; actorKind: Principal["kind"]; actorId: string; type: MemoryEventType; memoryId?: string; detail?: Readonly<Record<string, unknown>> };

export type SweepReport = { archived: readonly string[]; expired: readonly string[]; deleted: readonly string[]; compressed: readonly string[]; kept: number };
export type MemoryResult = { ok: boolean; refusal?: Refusal; reasons?: readonly string[]; memory?: Memory; merged?: boolean; sweep?: SweepReport; used?: readonly string[]; events: readonly MemoryEventInput[] };
export type MemoryOutcome = { state: MemoryState; result: MemoryResult };
/** The company decides which workers are active; this layer never guesses. */
export type MemoryEnv = { isWorkerActive(tenantId: string, workerId: string): boolean };
