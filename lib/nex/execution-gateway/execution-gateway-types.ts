// NEX Execution Gateway: the vocabulary. The last layer before real execution. It takes what the Runtime Orchestrator (the approved plan and its steps), the Worker Runtime (how the worker lives) and the
// Worker OS (what the worker may do) say, VALIDATES absolutely everything, and builds an EXECUTION REQUEST: a plain description of one step to be run by one worker. Then it STOPS. It never executes,
// never calls an API, a Connector, the Runtime, a Worker or an AI, never approves and never changes an authorization. It reads no clock (every event carries `at`). Plain data, pure reducers.
// The facts of the other layers come in as plain structural data (below): this layer imports none of them, so a later sprint decides how to feed it.

/** The only states a request can be in. */
export const REQUEST_STATES = ["Pending", "Validated", "WaitingApproval", "Ready", "Blocked", "Rejected", "Cancelled", "Expired"] as const;
export type RequestState = (typeof REQUEST_STATES)[number];
export const TERMINAL: readonly RequestState[] = ["Rejected", "Cancelled", "Expired"];
/** The moves that exist. A request only becomes Ready by being Validated first, and a finished request (Rejected, Cancelled, Expired) never moves again. */
export const REQUEST_TRANSITIONS: Readonly<Record<RequestState, readonly RequestState[]>> = {
  Pending: ["Validated", "Blocked", "Rejected", "Cancelled", "Expired"],
  Validated: ["WaitingApproval", "Ready", "Blocked", "Rejected", "Cancelled", "Expired"],
  WaitingApproval: ["Ready", "Blocked", "Rejected", "Cancelled", "Expired"],
  Ready: ["Blocked", "Rejected", "Cancelled", "Expired"],
  Blocked: ["Validated", "Rejected", "Cancelled", "Expired"],
  Rejected: [], Cancelled: [], Expired: [],
};
export const canTransition = (from: RequestState, to: RequestState): boolean => REQUEST_TRANSITIONS[from].includes(to);

/** Deterministic priorities, highest first. */
export const PRIORITIES = ["critical", "high", "normal", "low", "background"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_RANK: Readonly<Record<Priority, number>> = { critical: 5, high: 4, normal: 3, low: 2, background: 1 };
export const isPriority = (value: unknown): value is Priority => typeof value === "string" && (PRIORITIES as readonly string[]).includes(value);

export type Role = "viewer" | "member" | "manager" | "admin" | "owner";
export const ROLE_RANK: Readonly<Record<Role, number>> = { viewer: 0, member: 1, manager: 2, admin: 3, owner: 4 };
export type Level = 1 | 2 | 3;
/** The role a level of authorization asks for: 1 a member, 2 a manager, 3 an administrator. An unknown level is 3 (fails closed). */
export const LEVEL_ROLE: Readonly<Record<Level, Role>> = { 1: "member", 2: "manager", 3: "admin" };
export const levelOf = (value: unknown): Level => (value === 1 || value === 2 || value === 3 ? value : 3);
/** Who is acting. Only people approve, and approval is a FACT the gateway reads: nobody here approves anything. */
export type Principal =
  | { kind: "person"; tenantId: string; id: string; role: Role }
  | { kind: "worker"; tenantId: string; id: string }
  | { kind: "system"; tenantId: string }
  | { kind: "nex"; tenantId: string };
/** Submitting, validating, cancelling and ticking: the system or a manager. Workers and NEX never. */
export const canOperate = (principal: Principal): boolean => principal.kind === "system" || (principal.kind === "person" && ROLE_RANK[principal.role] >= ROLE_RANK.manager);

// ---------------------------------------------------------------------------------------------- what the other layers say (plain data)
export type PlanStatus = "Draft" | "WaitingApproval" | "Approved" | "Rejected" | "Running" | "Paused" | "Completed" | "Cancelled" | "Expired";
export type StepState = "pending" | "ready" | "running" | "completed" | "failed" | "skipped";
export type StepFact = {
  stepId: string; actionId: string; level: number; approverRole: Role; specialty: string; state: StepState; dependsOn: readonly string[]; timeoutMs: number;
  retry: { maxAttempts: number; backoffMs: number; retryFatal?: boolean }; tools: readonly string[]; capabilities: readonly string[];
};
/** From the Runtime Orchestrator: an approved plan and its steps. */
export type PlanFact = {
  planId: string; tenantId: string; status: PlanStatus; priority: Priority; /** who approved it, if anyone */ decidedBy?: string; /** the longest any step of the plan may take */ timeoutMs?: number;
  dependsOn: readonly string[]; steps: readonly StepFact[];
};
/** From the Worker Runtime: how the worker lives right now (state, version, capacity). */
export type RuntimeWorkerFact = { workerId: string; tenantId: string; state: string; version: string; maxConcurrent: number; current: number };
/** From the Worker OS: what the worker is capable of (status, specialty, version, capabilities, tools, permissions, limits). */
export type OsWorkerFact = {
  workerId: string; companyId: string; status: "Active" | "Blocked"; specialty: string; version: string; capabilities: readonly string[]; tools: readonly string[]; permissions: readonly string[];
  limits: { timeoutMs: number };
};
export type GatewaySources = {
  plans: readonly PlanFact[]; runtimeWorkers: readonly RuntimeWorkerFact[]; osWorkers: readonly OsWorkerFact[];
  /** the role a PERSON holds in the company; anything that is not a person (system, worker, NEX) has none */ roleOf(personId: string): Role | undefined;
};

// ---------------------------------------------------------------------------------------------- the request
export type RetryPolicy = { maxAttempts: number; backoffMs: number; /** only retryable errors are ever retried; a fatal one never is */ retryOn: "retryable" };
export type ExecutionPolicy = { level: Level; approverRole: Role; requiresApproval: true; /** a request describes work; it is never run by this layer */ mode: "request-only" };
/** What would be run, by whom, under which rules. Never a prompt, a context, a memory or an answer. */
export type ExecutionRequest = {
  readonly requestId: string; readonly companyId: string; readonly workerId: string; readonly planId: string; readonly stepId: string; readonly actionId: string; readonly priority: Priority;
  readonly requestedAt: string; readonly approvedBy: string | null; readonly timeout: number; readonly retryPolicy: RetryPolicy; readonly executionPolicy: ExecutionPolicy;
  readonly toolRequirements: readonly string[]; readonly capabilityRequirements: readonly string[];
};
export type GatewayRecord = {
  readonly request: ExecutionRequest; readonly state: RequestState; /** why it is Blocked or Rejected (codes only) */ readonly reasons: readonly string[]; readonly revision: number; readonly createdAt: string;
  readonly updatedAt: string; readonly validatedAt?: string; readonly expiresAt: string; readonly workerVersion?: string;
};
export type RequestSpec = { planId: string; stepId: string; workerId: string; priority?: Priority };

export type AuditEntry = { at: string; actor: string; tenantId: string; action: string; detail?: Readonly<Record<string, string | number | boolean>> };
export type GatewayState = { readonly requests: readonly GatewayRecord[]; readonly audit: readonly AuditEntry[] };
export type GatewayConfig = { requestTtlMs: number; minTimeoutMs: number; maxTimeoutMs: number; companyMaxTimeoutMs: number; maxAttempts: number; minWorkerVersion: string; maxRequests: number };
export const DEFAULT_CONFIG: GatewayConfig = { requestTtlMs: 3_600_000, minTimeoutMs: 1_000, maxTimeoutMs: 3_600_000, companyMaxTimeoutMs: 1_800_000, maxAttempts: 5, minWorkerVersion: "1.0.0", maxRequests: 2_000 };

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

export type Refusal = "tenant" | "forbidden" | "invalid" | "notFound" | "exists" | "state" | "limit";
type Base = { tenantId: string; actor: Principal; at: string };
export type GatewayEvent =
  | (Base & { type: "submit"; spec: RequestSpec })
  | (Base & { type: "validate" | "cancel"; requestId: string })
  | (Base & { type: "tick" });

export const GATEWAY_EVENT_TYPES = [
  "request.created", "request.validated", "request.transition", "request.failure", "request.ready", "request.blocked", "request.rejected", "request.cancelled", "request.expired", "gateway.dispatched",
  "gateway.dashboard", "gateway.refused",
] as const;
export type GatewayEventType = (typeof GATEWAY_EVENT_TYPES)[number];
/** What happened, with ids and numbers only: no prompt, context, memory or answer. */
export type GatewayEventInput = { at: string; tenantId: string; actorKind: Principal["kind"]; actorId: string; type: GatewayEventType; requestId?: string; detail?: Readonly<Record<string, unknown>> };
export type GatewayResult = { ok: boolean; refusal?: Refusal; reasons?: readonly string[]; unchanged?: boolean; record?: GatewayRecord; records?: readonly GatewayRecord[]; events: readonly GatewayEventInput[] };
export type GatewayOutcome = { state: GatewayState; result: GatewayResult };

/** The tables a later sprint will create (NOT created here: there is no migration). Every one is scoped by company and protected by row level security. */
export const FUTURE_TABLES: readonly { name: string; tenantScoped: true; policy: string }[] = [
  { name: "gateway_requests", tenantScoped: true, policy: "select: members of the company; insert/update: the gateway service of the company; delete: never" },
  { name: "gateway_validations", tenantScoped: true, policy: "select: members of the company; insert: the gateway service; update/delete: never (append only)" },
  { name: "gateway_audit", tenantScoped: true, policy: "select: admins of the company; insert: the gateway service; update/delete: never (append only)" },
];
