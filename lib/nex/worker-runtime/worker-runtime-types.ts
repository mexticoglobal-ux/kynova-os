// NEX Worker Runtime Engine: the vocabulary. The Runtime Orchestrator (Sprint 48) decides WHAT to run; this layer decides HOW each Worker LIVES: its fourteen states and the closed table of moves between
// them, its heartbeat, its health, its capacity, its retries, and who may start, pause, resume, stop, put in maintenance or recover it (only people, Level 3). It runs no action, calls no API, no AI, no
// database and no Runtime, and reads no clock: every event carries `at` and every heartbeat carries its own timestamp. Plain data, pure reducers.

/** The only states a Worker can be in. */
export const WORKER_STATES = ["Created", "Starting", "Idle", "Reserved", "Busy", "Paused", "WaitingApproval", "Retrying", "Recovering", "Stopping", "Stopped", "Failed", "Offline", "Maintenance"] as const;
export type WorkerState = (typeof WORKER_STATES)[number];

/** The moves that exist. Anything else (Busy → Created, Offline → Busy, Stopped → Busy, Failed → Busy, Maintenance → Busy…) is refused. */
export const WORKER_TRANSITIONS: Readonly<Record<WorkerState, readonly WorkerState[]>> = {
  Created: ["Starting"],
  Starting: ["Idle", "Failed", "Stopping"],
  Idle: ["Reserved", "WaitingApproval", "Paused", "Stopping", "Offline", "Maintenance", "Failed"],
  Reserved: ["Busy", "Idle", "WaitingApproval", "Paused", "Stopping", "Maintenance", "Failed"],
  Busy: ["Idle", "Reserved", "WaitingApproval", "Retrying", "Recovering", "Paused", "Maintenance", "Stopping", "Failed"],
  WaitingApproval: ["Reserved", "Idle", "Paused", "Stopping", "Maintenance", "Failed"],
  Paused: ["Idle", "Stopping", "Maintenance"],
  Retrying: ["Busy", "Idle", "Reserved", "WaitingApproval", "Recovering", "Paused", "Maintenance", "Stopping", "Failed"],
  Recovering: ["Idle", "Offline", "Failed", "Stopping"],
  Stopping: ["Stopped", "Failed"],
  Stopped: ["Starting"],
  Failed: ["Recovering", "Stopping"],
  Offline: ["Recovering", "Maintenance", "Stopping"],
  Maintenance: ["Idle", "Stopping"],
};
export const canTransition = (from: WorkerState, to: WorkerState): boolean => WORKER_TRANSITIONS[from].includes(to);

export type Role = "viewer" | "member" | "manager" | "admin" | "owner";
export const ROLE_RANK: Readonly<Record<Role, number>> = { viewer: 0, member: 1, manager: 2, admin: 3, owner: 4 };
/** Who is acting. Workers, the system and NEX can report and schedule, but can never change how a Worker lives. */
export type Principal =
  | { kind: "person"; tenantId: string; id: string; role: Role }
  | { kind: "worker"; tenantId: string; id: string }
  | { kind: "system"; tenantId: string }
  | { kind: "nex"; tenantId: string };
/** Level 3: only a person whose role reaches administrator may start, stop, pause, resume, put in maintenance, recover, register or approve. */
export const isLevel3 = (principal: Principal): boolean => principal.kind === "person" && ROLE_RANK[principal.role] >= ROLE_RANK.admin;
/** Scheduling and ticking: the system or a manager. */
export const canOperate = (principal: Principal): boolean => principal.kind === "system" || (principal.kind === "person" && ROLE_RANK[principal.role] >= ROLE_RANK.manager);

export const PRIORITIES = ["critical", "high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_RANK: Readonly<Record<Priority, number>> = { critical: 4, high: 3, normal: 2, low: 1 };

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

export type WorkerRecord = {
  readonly id: string; readonly tenantId: string; readonly name: string; readonly specialty: string; readonly permissions: readonly string[];
  readonly state: WorkerState; /** when it entered this state */ readonly stateSince: string; readonly createdAt: string;
  readonly version: string; readonly build: string; readonly capabilities: readonly string[];
  /** how many tasks it may hold at once, how many it holds now (running, reserved, awaiting approval or retrying), and how many more may wait behind them */
  readonly maxConcurrent: number; readonly current: number; readonly queueLimit: number;
  readonly lastHeartbeatAt?: string; readonly cpu?: number; readonly memory?: number; readonly reportedQueue?: number; readonly reportedRunning?: number;
  /** where silence is measured from when no heartbeat is newer: starting, recovering or coming back from maintenance */ readonly watchFrom?: string;
  readonly activeSince?: string; readonly errors: number; readonly retries: number; readonly recoveries: number;
  /** a pause or maintenance asked while it still has work in hand: it finishes only the current task(s) and then goes there */ readonly pending?: "pause" | "maintenance";
};

export const TASK_STATUSES = ["pending", "awaitingApproval", "reserved", "queued", "running", "retrying", "completed", "failed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
/** The statuses in which a task is held by a worker. */
export const HELD: readonly TaskStatus[] = ["awaitingApproval", "reserved", "queued", "running", "retrying"];
export type ErrorKind = "retryable" | "fatal";
export type Task = {
  readonly id: string; readonly tenantId: string; readonly specialty: string; readonly action: string; readonly priority: Priority; readonly requiresApproval: boolean;
  readonly minVersion?: string; readonly capabilities: readonly string[]; readonly status: TaskStatus; readonly workerId?: string; readonly attempts: number; readonly maxAttempts: number;
  readonly submittedAt: string; readonly notBeforeMs?: number; readonly startedAt?: string; readonly lastError?: ErrorKind | "heartbeatLost";
};

export type AuditEntry = { at: string; actor: string; tenantId: string; action: string; detail?: Readonly<Record<string, string | number | boolean>> };
export type WorkerRuntimeState = { readonly workers: readonly WorkerRecord[]; readonly tasks: readonly Task[]; readonly audit: readonly AuditEntry[] };

export type WorkerRuntimeConfig = {
  heartbeatIntervalMs: number; heartbeatTimeoutMs: number; startTimeoutMs: number; maxAttempts: number; backoffMs: number; maxBackoffMs: number;
  /** the oldest worker version the runtime still gives work to */ minWorkerVersion: string; /** how long a worker must be active to count fully for health */ uptimeFullMs: number; maxWorkers: number; maxTasks: number;
};
export const DEFAULT_CONFIG: WorkerRuntimeConfig = {
  heartbeatIntervalMs: 30_000, heartbeatTimeoutMs: 90_000, startTimeoutMs: 120_000, maxAttempts: 3, backoffMs: 1_000, maxBackoffMs: 60_000, minWorkerVersion: "1.0.0", uptimeFullMs: 3_600_000, maxWorkers: 200, maxTasks: 2_000,
};

export type WorkerSpec = { id: string; name: string; specialty: string; permissions: readonly string[]; version: string; build: string; capabilities: readonly string[]; maxConcurrent: number; queueLimit: number };
export type TaskSpec = { id: string; specialty: string; action: string; priority: Priority; requiresApproval?: boolean; minVersion?: string; capabilities?: readonly string[]; maxAttempts?: number };
export type Heartbeat = { workerId: string; companyId: string; timestamp: string; cpu: number; memory: number; queueLength: number; runningTasks: number; version: string };

export type Refusal = "tenant" | "forbidden" | "invalid" | "notFound" | "exists" | "transition" | "state" | "stale" | "limit" | "backoff";

type Base = { tenantId: string; actor: Principal; at: string };
export type WorkerRuntimeEvent =
  | (Base & { type: "register"; worker: WorkerSpec })
  | (Base & { type: "start" | "stop" | "pause" | "resume" | "maintenance" | "endMaintenance" | "recover"; workerId: string })
  | (Base & { type: "approve" | "reject" | "taskStart"; taskId: string })
  | (Base & { type: "heartbeat"; heartbeat: Heartbeat })
  | (Base & { type: "submit"; task: TaskSpec })
  | (Base & { type: "schedule" | "tick" })
  | (Base & { type: "taskFinish"; taskId: string; outcome: "completed" | "failed"; error?: ErrorKind });

export const WORKER_EVENT_TYPES = [
  "worker.registered", "worker.transition", "worker.heartbeat", "worker.timeout", "worker.recovered", "worker.version", "task.submitted", "task.assigned", "task.queued", "task.started", "task.completed", "task.failed",
  "task.retry", "task.released", "task.approved", "task.rejected", "runtime.scheduled", "runtime.tick", "runtime.dashboard", "runtime.refused",
] as const;
export type WorkerEventType = (typeof WORKER_EVENT_TYPES)[number];
/** What happened, with ids and numbers only: no prompt, context, memory or answer. */
export type WorkerEventInput = { at: string; tenantId: string; actorKind: Principal["kind"]; actorId: string; type: WorkerEventType; workerId?: string; taskId?: string; detail?: Readonly<Record<string, unknown>> };

export type Placement = { taskId: string; workerId: string; slot: "reserved" | "awaitingApproval" | "queued" };
export type WorkerRuntimeResult = {
  ok: boolean; refusal?: Refusal; reasons?: readonly string[]; unchanged?: boolean; worker?: WorkerRecord; task?: Task; placements?: readonly Placement[]; unplaced?: readonly { taskId: string; reasons: readonly string[] }[];
  events: readonly WorkerEventInput[];
};
export type WorkerRuntimeOutcome = { state: WorkerRuntimeState; result: WorkerRuntimeResult };

/** The tables a later sprint will create (NOT created here: there is no migration). Every one is scoped by company and protected by row level security; only people at Level 3 write lifecycle changes. */
export const FUTURE_TABLES: readonly { name: string; tenantScoped: true; policy: string }[] = [
  { name: "worker_runtime_workers", tenantScoped: true, policy: "select: members of the company; insert/update: Level 3 people of the company; delete: never" },
  { name: "worker_runtime_heartbeats", tenantScoped: true, policy: "select: members of the company; insert: the worker's own service identity; update/delete: never" },
  { name: "worker_runtime_tasks", tenantScoped: true, policy: "select: members of the company; insert/update: system and managers of the company; delete: never" },
  { name: "worker_runtime_audit", tenantScoped: true, policy: "select: admins of the company; insert: the runtime; update/delete: never (append only)" },
];
