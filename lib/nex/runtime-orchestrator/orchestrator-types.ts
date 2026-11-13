// NEX Autonomous Runtime Orchestration: the vocabulary. This layer takes an APPROVED Execution Plan (Sprint 47) and orchestrates it for the Runtime: it builds the execution queue, respects the DAG, the
// priorities and the authorizations, assigns the right Workers, controls retries, timeouts and backoff, detects blockages, and leaves everything ready for a later sprint to connect real execution.
// It produces STRUCTURES only: it executes no action, calls no API, no Connector, no provider and no Worker, and reads no clock (every event carries `at`). "Running" is the state the orchestrator
// records when it tells the Runtime to start a step, and "Completed" or "Failed" is what a future runtime reports back; nothing is run here. Plain data, pure reducers: no network, no database, no AI.

import type { AutonomyLevel, ExecutionPlan, Principal, Priority, Role } from "@/lib/nex/execution";

export type { AutonomyLevel, ExecutionPlan, Principal, Priority, Role };

/** The only states an item of the execution queue can be in. */
export const ITEM_STATES = ["Pending", "Assigned", "WaitingDependencies", "WaitingApproval", "Ready", "Running", "Paused", "Completed", "Failed", "Cancelled", "Expired"] as const;
export type ItemState = (typeof ITEM_STATES)[number];
export const TERMINAL_ITEM: readonly ItemState[] = ["Completed", "Failed", "Cancelled", "Expired"];
export type RunStatus = "Queued" | "Running" | "Paused" | "Completed" | "Failed" | "Cancelled" | "Expired";
export const TERMINAL_RUN: readonly RunStatus[] = ["Completed", "Failed", "Cancelled", "Expired"];

/** A worker the company has, as the orchestrator sees it: only data. Nobody is ever called. */
export type OrchestratorWorker = {
  id: string; tenantId: string; name: string; specialty: string; status: "active" | "paused" | "disabled";
  /** how many steps it may hold at once (assigned or running) */ capacity: number;
  /** the actions it is permitted to do: action ids, a family like \`crm.*\`, or \`*\` */ permissions: readonly string[];
};

/** One step of an approved plan, waiting in the queue. Its id is the step's id. */
export type QueueItem = {
  readonly id: string; readonly tenantId: string; readonly planId: string; readonly stepId: string;
  readonly action: string; readonly level: AutonomyLevel; readonly approverRole: Role; readonly priority: Priority; /** the plan's expected impact, 0–100 */ readonly impact: number;
  readonly needs: "general" | "finance"; readonly specialty: string; readonly connector?: string;
  readonly state: ItemState; readonly workerId?: string; readonly attempts: number; readonly maxAttempts: number; readonly backoffMs: number; readonly timeoutMs: number; readonly estimatedMs: number;
  /** items of the same plan that must be Completed first */ readonly dependsOn: readonly string[]; /** plans that must be Completed first */ readonly planDependsOn: readonly string[];
  readonly enqueuedAt: string; /** the item may not start before this instant (epoch ms): the backoff of a retry */ readonly notBeforeMs?: number;
  readonly startedAt?: string; readonly deadlineAt?: string; readonly completedAt?: string; readonly pausedFrom?: ItemState; readonly lastFailure?: "timeout" | "failed";
};

export type RunRecord = {
  readonly planId: string; readonly tenantId: string; readonly priority: Priority; readonly impact: number; readonly needs: "general" | "finance";
  readonly status: RunStatus; readonly paused: boolean; /** who approved the plan, and the role they hold: the authorization every step is checked against */ readonly approvedBy: string; readonly approverRole?: Role;
  readonly enqueuedAt: string; readonly planExpiresAt: string; readonly startedAt?: string; readonly completedAt?: string; readonly pausedAtMs?: number;
  readonly itemIds: readonly string[]; readonly planDependsOn: readonly string[];
};

export type AuditEntry = { at: string; actor: string; tenantId: string; action: string; detail?: Readonly<Record<string, string | number | boolean>> };
export type RuntimeState = { readonly runs: readonly RunRecord[]; readonly queue: readonly QueueItem[]; readonly audit: readonly AuditEntry[] };

export type OrchestratorConfig = {
  /** start the items that are ready, assigned and within their worker's capacity at every tick (default: only report them) */ autoStart: boolean;
  maxBackoffMs: number; /** how long a plan may wait for approval or a worker before it counts as a bottleneck */ blockedAfterMs: number; throughputWindowMs: number; maxRuns: number;
};
export const DEFAULT_CONFIG: OrchestratorConfig = { autoStart: false, maxBackoffMs: 600_000, blockedAfterMs: 3_600_000, throughputWindowMs: 86_400_000, maxRuns: 200 };

export type OrchestratorEnv = { isWorkerActive(tenantId: string, workerId: string): boolean };
export type RuntimeSources = {
  env: OrchestratorEnv; workers: readonly OrchestratorWorker[];
  /** the role a person holds in the company (read only): the approval of a plan is worth what its approver's role is worth */ roleOf(personId: string): Role | undefined;
};

export type Refusal = "tenant" | "forbidden" | "workerInactive" | "invalid" | "notFound" | "state" | "dependency" | "authorization" | "worker" | "cycle" | "limit";

type Base = { tenantId: string; actor: Principal; at: string };
export type RuntimeEvent =
  | (Base & { type: "enqueue"; plan: ExecutionPlan })
  | (Base & { type: "tick"; autoStart?: boolean })
  | (Base & { type: "start"; itemId: string })
  | (Base & { type: "finish"; itemId: string; outcome: "completed" | "failed" })
  | (Base & { type: "pause"; planId: string })
  | (Base & { type: "resume"; planId: string })
  | (Base & { type: "cancel"; planId: string });

export const ORCHESTRATOR_EVENT_TYPES = [
  "queue.enqueued", "queue.assigned", "queue.unassigned", "execution.started", "execution.paused", "execution.resumed", "execution.timeout", "execution.retry", "execution.cancelled", "execution.finished",
  "execution.failed", "run.completed", "run.failed", "run.expired", "orchestrator.tick", "orchestrator.blocked", "orchestrator.dashboard", "orchestrator.refused",
] as const;
export type OrchestratorEventType = (typeof ORCHESTRATOR_EVENT_TYPES)[number];
/** What happened, with ids and numbers only: no prompt, answer, context, secret, token or content. */
export type OrchestratorEventInput = { at: string; tenantId: string; actorKind: Principal["kind"]; actorId: string; type: OrchestratorEventType; planId?: string; itemId?: string; detail?: Readonly<Record<string, unknown>> };

export type Dispatch = { order: number; itemId: string; planId: string; workerId: string; action: string; level: AutonomyLevel };
export type BlockageKind = "dependencyFailed" | "dependencyNotQueued" | "noWorker" | "waitingApproval" | "cycle";
export type Blockage = { kind: BlockageKind; planId: string; itemId?: string; /** how long it has been waiting, in ms */ waitedMs: number };
export type RuntimeResult = {
  ok: boolean; refusal?: Refusal; reasons?: readonly string[]; unchanged?: boolean; run?: RunRecord; items?: readonly QueueItem[]; item?: QueueItem;
  /** what the Runtime would be asked to start now, in order: a list, never an order that was carried out */ dispatch?: readonly Dispatch[]; blockages?: readonly Blockage[];
  events: readonly OrchestratorEventInput[];
};
export type RuntimeOutcome = { state: RuntimeState; result: RuntimeResult };
