// NEX Autonomous Execution Engine: the vocabulary. This layer turns the Copilot's recommendations into EXECUTION PLANS: structured, deterministic, auditable and ready for a person to approve.
// It PREPARES and it RECORDS; it does not run anything: no action is executed, no Runtime, Worker or Connector is called, and the "Running", "Paused" and "Completed" states are only what a future
// runtime REPORTS to this layer. Everything is plain data handled by pure reducers: no clock (every event carries `at`), no database, no network, no AI.

import type { ConnectorId } from "@/lib/contracts/platform/connectors";
import type { AutonomyLevel } from "@/lib/contracts/platform/workers";
import type { InvolvedModule, Principal, Recommendation, Role, Severity, SuggestedAction } from "@/lib/nex/copilot";

export type { AutonomyLevel, ConnectorId, InvolvedModule, Principal, Recommendation, Role, Severity, SuggestedAction };

/** The only states a plan can be in. */
export const PLAN_STATUSES = ["Draft", "WaitingApproval", "Approved", "Rejected", "Running", "Paused", "Completed", "Cancelled", "Expired"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const TERMINAL: readonly PlanStatus[] = ["Rejected", "Completed", "Cancelled", "Expired"];

export const PRIORITIES = ["critical", "high", "normal", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];
export type StepState = "pending" | "ready" | "running" | "completed" | "failed" | "skipped";
export type RollbackPolicy = "none" | "compensate" | "manual";

export type RetryPolicy = { maxAttempts: number; backoffMs: number };
/** One step of a plan: a catalog action, who would do it, what it needs and what undoes it. A step is a node of the plan's DAG. */
export type ExecutionStep = {
  id: string; order: number; title: string;
  /** the platform's own action id (its autonomy level is decided in code, workers.ts) */
  action: string; module: InvolvedModule; worker: { specialty: string; workerId?: string };
  authorizationLevel: AutonomyLevel; approverRole: Role; timeoutMs: number; retry: RetryPolicy;
  rollbackPolicy: RollbackPolicy; compensationAction?: string; state: StepState; attempts: number;
  /** ids of the steps that must be completed first */ dependsOn: readonly string[];
  connector?: ConnectorId; costAiMicros: number; costApiMicros: number; estimatedMs: number;
  /** the id of the Copilot suggestion this step comes from, and who already agreed to it there (if anyone) */
  sourceActionId: string; approvedInCopilot?: string;
};

export type RequiredWorker = { specialty: string; workerId?: string; steps: number };
export type RequiredAuthorization = { action: string; level: AutonomyLevel; approverRole: Role; steps: number; /** a standing authorization covers it (Level 2 only) */ standing: boolean };
export type RollbackPlan = { policy: "reverse-order"; steps: readonly { stepId: string; policy: RollbackPolicy; compensationAction?: string }[]; requested: boolean; requestedSteps: readonly string[] };
export type HistoryEntry = { at: string; from: PlanStatus | null; to: PlanStatus; by: string };

export type ExecutionPlan = {
  readonly id: string; readonly tenantId: string; readonly revision: number;
  readonly recommendationId: string; readonly findingId: string;
  readonly objective: string; readonly priority: Priority; readonly severity: Severity;
  readonly expectedImpact: { level: "high" | "medium" | "low"; score: number }; readonly risk: { level: "high" | "medium" | "low"; note: string }; readonly expectedBenefit: string;
  readonly modules: readonly InvolvedModule[]; readonly workers: readonly RequiredWorker[]; readonly connectors: readonly ConnectorId[]; readonly authorizations: readonly RequiredAuthorization[];
  /** plans that must be completed before this one may start */ readonly dependsOn: readonly string[];
  readonly steps: readonly ExecutionStep[]; readonly rollback: RollbackPlan;
  readonly cost: { aiMicros: number; apiMicros: number }; readonly estimatedMs: number;
  readonly status: PlanStatus; readonly needs: "general" | "finance"; /** the role the highest authorization level asks for */ readonly requiredRole: Role;
  readonly createdAt: string; readonly expiresAt: string; readonly createdBy: string;
  readonly startedAt?: string; readonly completedAt?: string; readonly decidedBy?: string; readonly decidedAt?: string; readonly blockedBy?: string;
  readonly history: readonly HistoryEntry[];
};

export type IssueSeverity = "error" | "warning";
export type ValidationIssue = { code: string; severity: IssueSeverity; stepId?: string };
export type ValidationReport = { valid: boolean; issues: readonly ValidationIssue[] };

export type AuditEntry = { at: string; actor: string; tenantId: string; action: string; detail?: Readonly<Record<string, string | number | boolean>> };
export type ExecutionState = { readonly plans: readonly ExecutionPlan[]; readonly seq: Readonly<Record<string, number>>; readonly audit: readonly AuditEntry[] };

export type ExecutionConfig = {
  /** how long a plan waits for a decision, in ms */ planTtlMs: number;
  /** the most plans a company keeps; finished ones go first */ maxPlans: number;
};
export const DEFAULT_CONFIG: ExecutionConfig = { planTtlMs: 604_800_000, maxPlans: 200 };

/** The workers a company has: the roster KOE already keeps. Only active workers can be assigned. */
export type RosterView = { workers: readonly { id: string; name: string; specialty: string; status: "active" | "paused" | "disabled" }[] };
export type ExecutionEnv = { isWorkerActive(tenantId: string, workerId: string): boolean };
export type ExecutionSources = {
  env: ExecutionEnv; roster: RosterView;
  /** the connectors the company has connected (plain data: nothing is called) */ connected: readonly ConnectorId[];
  /** the actions a standing authorization covers (Level 2) */ grants: readonly string[];
};

export type Refusal = "tenant" | "forbidden" | "workerInactive" | "invalid" | "notFound" | "level" | "state" | "dependency" | "expired" | "blocked";

type Base = { tenantId: string; actor: Principal; at: string };
export type ExecutionEvent =
  | (Base & { type: "prepare"; recommendations: readonly Recommendation[]; actions: readonly SuggestedAction[] })
  | (Base & { type: "submit"; planId: string })
  | (Base & { type: "approve"; planId: string })
  | (Base & { type: "reject"; planId: string })
  | (Base & { type: "cancel"; planId: string })
  | (Base & { type: "start"; planId: string })
  | (Base & { type: "pause"; planId: string })
  | (Base & { type: "resume"; planId: string })
  | (Base & { type: "assign"; planId: string })
  | (Base & { type: "report"; planId: string; stepId: string; outcome: "started" | "completed" | "failed" })
  | (Base & { type: "sweep" });

export const EXECUTION_EVENT_TYPES = [
  "plan.prepared", "plan.validated", "plan.assigned", "plan.submitted", "plan.approved", "plan.rejected", "plan.started", "plan.paused", "plan.resumed", "plan.completed", "plan.cancelled", "plan.expired",
  "plan.rollback_requested", "step.reported", "step.retried", "step.failed", "execution.scheduled", "execution.dashboard", "execution.refused",
] as const;
export type ExecutionEventType = (typeof EXECUTION_EVENT_TYPES)[number];
/** What happened, with no prompt, answer, context, address or content: ids and numbers only. */
export type ExecutionEventInput = { at: string; tenantId: string; actorKind: Principal["kind"]; actorId: string; type: ExecutionEventType; planId?: string; detail?: Readonly<Record<string, unknown>> };

export type DroppedCounts = { crossTenant: number; hidden: number; notSuggested: number; noActions: number; unknownAction: number };
export type ExecutionResult = {
  ok: boolean; refusal?: Refusal; reasons?: readonly string[]; plans?: readonly ExecutionPlan[]; plan?: ExecutionPlan; unchanged?: number; dropped?: DroppedCounts;
  /** the compensations a cancellation asks for, in order: prepared, never run */ rollback?: readonly { stepId: string; policy: RollbackPolicy; compensationAction?: string }[];
  events: readonly ExecutionEventInput[];
};
export type ExecutionOutcome = { state: ExecutionState; result: ExecutionResult };
