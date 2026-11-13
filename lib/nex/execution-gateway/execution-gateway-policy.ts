// Execution Gateway Policy: the rules about WHO may be asked to do WHAT, evaluated and never executed. It looks at seven things: the company, the worker, the plan, the action, the tool, the capability and
// the role of whoever approved. Approval is a FACT read from the plan (who decided it and what role that person holds): the gateway never approves and never changes an authorization. Only a PERSON
// whose role reaches the level of the step counts (1 a member, 2 a manager, 3 an administrator); the system, a worker or NEX never do, because they hold no role. Pure.

import { LEVEL_ROLE, ROLE_RANK, levelOf, type ExecutionRequest, type OsWorkerFact, type PlanFact, type Role, type RuntimeWorkerFact, type StepFact } from "./execution-gateway-types";

export type Failure = { code: string; /** can never be fixed by waiting: the request is Rejected instead of Blocked */ permanent: boolean };
export type Approval = "approved" | "pending" | "insufficient" | "closed";
export type PolicyContext = { request: Pick<ExecutionRequest, "companyId" | "workerId" | "actionId">; plan?: PlanFact; step?: StepFact; runtime?: RuntimeWorkerFact; profile?: OsWorkerFact; roleOf(personId: string): Role | undefined };
export type PolicyDecision = { allowed: boolean; violations: Failure[]; approval: Approval; approvedBy: string | null };

/** The Worker Runtime states that may be given work. */
export const WORKING_STATES: readonly string[] = ["Idle", "Reserved", "Busy"];
const fail = (code: string, permanent = false): Failure => ({ code, permanent });

/** `*`, the exact action id, or its family (`crm.*`). */
export const permits = (permissions: readonly string[], action: string): boolean => permissions.some((entry) => entry === "*" || entry === action || (entry.endsWith(".*") && action.startsWith(entry.slice(0, -1))));
/** The role a step really needs: the higher of the one it states and the one its level asks for (it can never be lowered). */
export const requiredRole = (step: Pick<StepFact, "level" | "approverRole">): Role => {
  const byLevel = LEVEL_ROLE[levelOf(step.level)];
  return ROLE_RANK[step.approverRole] >= ROLE_RANK[byLevel] ? step.approverRole : byLevel;
};

/** Evaluates the seven dimensions. Collects EVERY violation; allowed only with none (and a confirmed approval). Nothing is run. */
export function evaluatePolicy(context: PolicyContext): PolicyDecision {
  const { request, plan, step, runtime, profile } = context;
  const violations: Failure[] = [];
  // company: every fact must belong to the request's company
  if ((plan && plan.tenantId !== request.companyId) || (runtime && runtime.tenantId !== request.companyId) || (profile && profile.companyId !== request.companyId)) violations.push(fail("company.mismatch", true));
  // worker: alive, with room, and allowed by the Worker OS
  if (!runtime) violations.push(fail("worker.missing"));
  else {
    if (!WORKING_STATES.includes(runtime.state)) violations.push(fail("worker.state"));
    if (!(runtime.current < runtime.maxConcurrent)) violations.push(fail("worker.capacity"));
  }
  if (!profile) violations.push(fail("worker.profileMissing"));
  else {
    if (profile.status !== "Active") violations.push(fail("worker.blocked"));
    if (step && step.specialty !== profile.specialty) violations.push(fail("worker.specialty"));
  }
  // plan: it must exist and be alive
  let approval: Approval = "approved";
  if (!plan) { violations.push(fail("plan.missing")); approval = "pending"; }
  else if (plan.status === "Paused") violations.push(fail("plan.paused"));
  else if (plan.status === "Rejected" || plan.status === "Cancelled" || plan.status === "Expired" || plan.status === "Completed") { violations.push(fail("plan.closed", true)); approval = "closed"; }
  else if (plan.status === "Draft" || plan.status === "WaitingApproval") approval = "pending";
  // action, tool and capability: only what the worker declares
  if (!step) violations.push(fail("step.missing"));
  else {
    if (profile && !permits(profile.permissions, step.actionId)) violations.push(fail("action.denied"));
    if (profile && step.tools.some((tool) => !profile.tools.includes(tool))) violations.push(fail("tool.missing"));
    if (profile && step.capabilities.some((capability) => !profile.capabilities.includes(capability))) violations.push(fail("capability.missing"));
  }
  // role: the plan must have been approved by a PERSON whose role reaches the level of the step
  let approvedBy: string | null = null;
  if (plan && step && (plan.status === "Approved" || plan.status === "Running" || plan.status === "Paused")) {
    if (!plan.decidedBy) { violations.push(fail("role.noApprover")); approval = "insufficient"; }
    else {
      const role = context.roleOf(plan.decidedBy);
      if (role === undefined) { violations.push(fail("role.notPerson")); approval = "insufficient"; }
      else if (ROLE_RANK[role] < ROLE_RANK[requiredRole(step)]) { violations.push(fail("role.insufficient")); approval = "insufficient"; }
      else approvedBy = plan.decidedBy;
    }
  }
  return { allowed: violations.length === 0 && approval === "approved", violations, approval, approvedBy };
}
