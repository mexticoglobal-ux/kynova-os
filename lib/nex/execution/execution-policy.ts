// Execution Policy: who may do what with a plan, and which state changes are allowed. Permissions are applied BEFORE a plan is built: what the asker may not see (the money behind a finance
// recommendation, any operational figure for a viewer) does not exist inside their plans. Level 3 (ADR-0009): the system, workers and NEX prepare; only a person with the role the plan's highest
// authorization level asks for approves or rejects; only the system reports what a runtime did. Pure.

import { ROLE_RANK, authorize, canSeeAction, canSeeFinance, canSeeOperations } from "@/lib/nex/copilot";
import type { ExecutionEnv, ExecutionPlan, PlanStatus, Principal, Recommendation, Role, SuggestedAction } from "./execution-types";
import { TERMINAL } from "./execution-types";

export { authorize, canSeeAction };
const atLeast = (principal: Principal, role: Role): boolean => principal.kind === "person" && ROLE_RANK[principal.role] >= ROLE_RANK[role];

/** Preparing plans: any person who is not a viewer, an active worker, or the system. Preparing is not acting. */
export const canPrepare = (principal: Principal): boolean => principal.kind !== "person" || atLeast(principal, "member");
/** What a plan's author may see: the money needs a manager or above; operations a member or above (and workers and the system). */
export const canSeePlan = (principal: Principal, plan: Pick<ExecutionPlan, "needs" | "tenantId">): boolean =>
  principal.tenantId === plan.tenantId && (plan.needs === "finance" ? canSeeFinance(principal) : canSeeOperations(principal));
export const canSeeRecommendation = (principal: Principal, rec: Pick<Recommendation, "needs">): boolean => (rec.needs === "finance" ? canSeeFinance(principal) : canSeeOperations(principal));
/** Approving or rejecting: a person whose role reaches the plan's required role. */
export const canDecide = (principal: Principal, plan: Pick<ExecutionPlan, "requiredRole">): boolean => atLeast(principal, plan.requiredRole);
/** Submitting a draft for approval: whoever may prepare. */
export const canSubmit = canPrepare;
/** Cancelling, pausing, resuming and re-assigning: a manager or above, or the system. */
export const canOperate = (principal: Principal): boolean => principal.kind === "system" || atLeast(principal, "manager");
/** Starting a plan and reporting what a runtime did: only the system (a future runtime reports through it). This layer runs nothing. */
export const canReport = (principal: Principal): boolean => principal.kind === "system";

/** The state changes that exist. Anything else is refused. */
export const TRANSITIONS: Readonly<Record<PlanStatus, readonly PlanStatus[]>> = {
  Draft: ["WaitingApproval", "Cancelled", "Expired"],
  WaitingApproval: ["Approved", "Rejected", "Cancelled", "Expired"],
  Approved: ["Running", "Cancelled", "Expired"],
  Running: ["Paused", "Completed", "Cancelled"],
  Paused: ["Running", "Cancelled", "Expired"],
  Rejected: [], Completed: [], Cancelled: [], Expired: [],
};
export const canTransition = (from: PlanStatus, to: PlanStatus): boolean => TRANSITIONS[from].includes(to);
export const isTerminal = (status: PlanStatus): boolean => TERMINAL.includes(status);
/** A plan that is waiting, or paused, and past its expiry is over. A plan that is Running is in progress and does not expire. */
export const isExpired = (plan: Pick<ExecutionPlan, "status" | "expiresAt">, nowMs: number): boolean => (plan.status === "Draft" || plan.status === "WaitingApproval" || plan.status === "Approved" || plan.status === "Paused") && nowMs >= Date.parse(plan.expiresAt);

export const stepPermission = (principal: Principal, env: ExecutionEnv, claimedTenant: string) => authorize(principal, claimedTenant, env);
export const roleRank = (role: Role): number => ROLE_RANK[role];
export const visibleActions = (principal: Principal, actions: readonly SuggestedAction[]): SuggestedAction[] => actions.filter((action) => canSeeAction(principal, action));
