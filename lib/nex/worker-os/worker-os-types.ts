// NEX Worker Operating System: the vocabulary. The Worker Runtime Engine (Sprint 49) manages how a Worker LIVES; this layer manages what a Worker is CAPABLE of doing: its version and the versions it
// needs, its specialty, the capabilities it declares, its skills (0–100), the tools it may use, the permissions it holds and its limits. Capabilities, tools and permissions are three different things and
// are never mixed. It executes nothing, calls no API, no AI, no database and no Runtime, and reads no clock: every event carries `at`. Plain data, pure reducers.
// The ONE global catalog (specialties, capabilities and their versions, skills, tools, versions) lives here, once; nothing else repeats it.

/** The fifteen specialties and nothing else. */
export const SPECIALTIES = ["General", "Sales", "Marketing", "Support", "Finance", "CRM", "SEO", "Content", "Video", "Automation", "Developer", "Operations", "Analytics", "Research", "Administration"] as const;
export type Specialty = (typeof SPECIALTIES)[number];
/** The capabilities, each with the version of the capability contract the platform offers. Nothing is assumed: a worker has only what it declares. */
export const CAPABILITY_VERSIONS = {
  read: "1.0.0", write: "1.0.0", search: "1.0.0", analyze: "1.0.0", execute: "1.0.0", schedule: "1.0.0", communicate: "1.0.0", calculate: "1.0.0", monitor: "1.0.0", report: "1.0.0", organize: "1.0.0", generate: "1.0.0",
  validate: "1.0.0", approve: "1.0.0",
} as const;
export type CapabilityId = keyof typeof CAPABILITY_VERSIONS;
export const CAPABILITY_IDS = Object.keys(CAPABILITY_VERSIONS) as CapabilityId[];
/** Tools are only REGISTERED here; nothing is ever run. (`AIStudio` is the id of AI Studio.) */
export const TOOL_IDS = ["CRM", "Billing", "Marketplace", "Academy", "Calendar", "Drive", "Email", "Docs", "Storage", "Analytics", "AIStudio", "Automations"] as const;
export type ToolId = (typeof TOOL_IDS)[number];
/** Skills are named after the specialties: SEO 85, Marketing 90, CRM 60. */
export const SKILL_IDS = SPECIALTIES;
export type SkillId = Specialty;
export const CATALOG = {
  specialties: SPECIALTIES, capabilities: CAPABILITY_VERSIONS, skills: SKILL_IDS, tools: TOOL_IDS,
  versions: { platform: "1.0.0", runtime: "1.0.0", minWorker: "1.0.0" },
} as const;

export const parseVersion = (version: string): [number, number, number] | undefined => {
  const match = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
};
/** <0, 0, >0; an invalid version is older than any valid one. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

export type Role = "viewer" | "member" | "manager" | "admin" | "owner";
export const ROLE_RANK: Readonly<Record<Role, number>> = { viewer: 0, member: 1, manager: 2, admin: 3, owner: 4 };
/** Who is acting. Workers, the system and NEX never change what a Worker is. */
export type Principal =
  | { kind: "person"; tenantId: string; id: string; role: Role }
  | { kind: "worker"; tenantId: string; id: string }
  | { kind: "system"; tenantId: string }
  | { kind: "nex"; tenantId: string };
/** Level 3: only a person whose role reaches administrator. */
export const isLevel3 = (principal: Principal): boolean => principal.kind === "person" && ROLE_RANK[principal.role] >= ROLE_RANK.admin;

export type Capability = { id: string; version: string };
export type Skill = { id: string; level: number };
export type Limits = { maxConcurrent: number; queueLimit: number; timeoutMs: number; maxActionsPerDay: number };
/** Active: compatible and usable. Blocked: something it needs is incompatible (a worker version, the runtime, the platform or a capability version). */
export type OsStatus = "Active" | "Blocked";

/** What a worker IS: exactly these fields, nothing outside the schema. */
export type WorkerDefinition = {
  readonly workerId: string; readonly companyId: string; readonly version: string; readonly build: string; readonly runtimeVersion: string; readonly platformVersion: string; readonly status: OsStatus;
  readonly specialty: string; readonly capabilities: readonly Capability[]; readonly skills: readonly Skill[]; readonly tools: readonly string[]; readonly permissions: readonly string[]; readonly limits: Limits;
  /** reported by the runtime, never invented: absent until a first report */ readonly health?: { score: number; reportedAt: string };
};
/** What a person gives to create one. Status and health are decided here, never given. */
export type WorkerInput = Omit<WorkerDefinition, "status" | "health">;
export type WorkerChanges = { specialty?: string; skills?: readonly Skill[]; limits?: Limits };
/** One release of a worker: the four versions that go together. */
export type ReleaseTarget = { version: string; build: string; runtimeVersion: string; platformVersion: string };
export type Release = ReleaseTarget & { /** when it was replaced */ replacedAt: string };
export type UpgradeRequest = { state: "requested" | "approved"; to: ReleaseTarget; requestedBy: string; requestedAt: string; approvedBy?: string; approvedAt?: string };
export type WorkerRecord = WorkerDefinition & { readonly revision: number; readonly createdAt: string; readonly updatedAt: string; /** never installed automatically */ readonly upgrade?: UpgradeRequest; /** the releases it can go back to, newest last */ readonly releases: readonly Release[] };

export type AuditEntry = { at: string; actor: string; tenantId: string; action: string; detail?: Readonly<Record<string, string | number | boolean>> };
export type WorkerOsState = { readonly workers: readonly WorkerRecord[]; readonly audit: readonly AuditEntry[] };
export type WorkerOsConfig = { runtimeVersion: string; platformVersion: string; minWorkerVersion: string; maxWorkers: number; maxReleases: number };
/** What compatibility needs to know about the platform. */
export type WorkerConfigLike = Pick<WorkerOsConfig, "runtimeVersion" | "platformVersion" | "minWorkerVersion">;
export const DEFAULT_CONFIG: WorkerOsConfig = { runtimeVersion: CATALOG.versions.runtime, platformVersion: CATALOG.versions.platform, minWorkerVersion: CATALOG.versions.minWorker, maxWorkers: 200, maxReleases: 10 };

export type Refusal = "tenant" | "forbidden" | "invalid" | "notFound" | "exists" | "state" | "incompatible" | "limit";
type Base = { tenantId: string; actor: Principal; at: string };
export type WorkerOsEvent =
  | (Base & { type: "create"; worker: WorkerInput })
  | (Base & { type: "update"; workerId: string; changes: WorkerChanges })
  | (Base & { type: "setCapabilities"; workerId: string; capabilities: readonly Capability[] })
  | (Base & { type: "setPermissions"; workerId: string; permissions: readonly string[] })
  | (Base & { type: "setTools"; workerId: string; tools: readonly string[] })
  | (Base & { type: "upgradeRequested"; workerId: string; to: ReleaseTarget })
  | (Base & { type: "upgradeApproved" | "upgradeInstalled" | "rollback"; workerId: string })
  | (Base & { type: "health"; workerId: string; score: number });

export const OS_EVENT_TYPES = [
  "worker.created", "worker.updated", "worker.capabilities", "worker.permissions", "worker.tools", "worker.blocked", "worker.unblocked", "upgrade.requested", "upgrade.approved", "upgrade.installed",
  "worker.rolledback", "health.reported", "policy.checked", "os.dashboard", "os.refused",
] as const;
export type OsEventType = (typeof OS_EVENT_TYPES)[number];
/** What happened, with ids and numbers only: no prompt, context, memory or answer. */
export type OsEventInput = { at: string; tenantId: string; actorKind: Principal["kind"]; actorId: string; type: OsEventType; workerId?: string; detail?: Readonly<Record<string, unknown>> };
export type WorkerOsResult = { ok: boolean; refusal?: Refusal; reasons?: readonly string[]; unchanged?: boolean; worker?: WorkerRecord; events: readonly OsEventInput[] };
export type WorkerOsOutcome = { state: WorkerOsState; result: WorkerOsResult };

/** The question the policy answers: may this worker be given this? Anything left out is not asked. */
export type PolicyRequest = { tenantId: string; capability?: string; skill?: { id: string; min: number }; tool?: string; permission?: string };
export type PolicyDecision = { allowed: boolean; violations: readonly string[] };

/** The tables a later sprint will create (NOT created here: there is no migration). Every one is scoped by company and protected by row level security; only people at Level 3 write. */
export const FUTURE_TABLES: readonly { name: string; tenantScoped: true; policy: string }[] = [
  { name: "worker_os_workers", tenantScoped: true, policy: "select: members of the company; insert/update: Level 3 people of the company; delete: never" },
  { name: "worker_os_releases", tenantScoped: true, policy: "select: members of the company; insert: Level 3 people of the company; update/delete: never (append only)" },
  { name: "worker_os_upgrades", tenantScoped: true, policy: "select: members of the company; insert/update: Level 3 people of the company; delete: never" },
  { name: "worker_os_audit", tenantScoped: true, policy: "select: admins of the company; insert: the worker operating system; update/delete: never (append only)" },
];
