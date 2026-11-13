// Execution Gateway Validator: checks absolutely everything about one request against the facts of the other layers: company, worker, version, state, permissions, capabilities, tools, compatibility,
// approval, priority, dependencies, timeout, retry and policy. ONE failed check blocks the request, and every failure is reported by code. Permanent failures (a dead dependency, a closed plan, a fatal
// retry policy, a company mismatch) can never be fixed by waiting, so they REJECT instead of block. Approval that has not happened yet is not a failure: it is a wait (WaitingApproval).
// The validator reads facts and answers; it executes, approves and changes nothing. Pure: the clock is never read.

import { evaluatePolicy, type Failure } from "./execution-gateway-policy";
import { LEVEL_ROLE, PRIORITY_RANK, ROLE_RANK, compareVersions, isPriority, levelOf, parseVersion, type ExecutionRequest, type GatewayConfig, type GatewaySources } from "./execution-gateway-types";

export type Outcome = "ready" | "waitingApproval" | "blocked" | "rejected";
export type Verdict = { outcome: Outcome; failures: Failure[]; approvedBy: string | null; workerVersion?: string };
const fail = (code: string, permanent = false): Failure => ({ code, permanent });

export function validateRequest(request: ExecutionRequest, sources: GatewaySources, config: GatewayConfig): Verdict {
  // only the company's own facts exist
  const plan = sources.plans.find((row) => row.planId === request.planId && row.tenantId === request.companyId);
  const step = plan?.steps.find((row) => row.stepId === request.stepId);
  const runtime = sources.runtimeWorkers.find((row) => row.workerId === request.workerId && row.tenantId === request.companyId);
  const profile = sources.osWorkers.find((row) => row.workerId === request.workerId && row.companyId === request.companyId);
  const decision = evaluatePolicy({ request, ...(plan ? { plan } : {}), ...(step ? { step } : {}), ...(runtime ? { runtime } : {}), ...(profile ? { profile } : {}), roleOf: sources.roleOf });
  const failures: Failure[] = [...decision.violations];

  if (step) {
    // the request must still say what the plan says
    if (step.actionId !== request.actionId || levelOf(step.level) !== request.executionPolicy.level || step.timeoutMs !== request.timeout) failures.push(fail("request.stale"));
    if (step.state !== "pending" && step.state !== "ready") failures.push(fail("step.state"));
    // dependencies: every one must have finished correctly
    for (const dependency of step.dependsOn) {
      const found = plan?.steps.find((row) => row.stepId === dependency);
      if (!found) failures.push(fail("dependency.missing"));
      else if (found.state === "failed" || found.state === "skipped") failures.push(fail("dependency.failed", true));
      else if (found.state !== "completed") failures.push(fail("dependency.pending"));
    }
    // timeout: minimum, maximum, company, plan and worker
    if (!Number.isInteger(request.timeout) || request.timeout < config.minTimeoutMs) failures.push(fail("timeout.min"));
    if (request.timeout > config.maxTimeoutMs) failures.push(fail("timeout.max"));
    if (request.timeout > config.companyMaxTimeoutMs) failures.push(fail("timeout.company"));
    if (plan?.timeoutMs !== undefined && request.timeout > plan.timeoutMs) failures.push(fail("timeout.plan"));
    if (profile && request.timeout > profile.limits.timeoutMs) failures.push(fail("timeout.worker"));
    // retry: only retryable errors, never fatal; a Level 3 step is never retried
    const retry = request.retryPolicy;
    if (!Number.isInteger(retry.maxAttempts) || retry.maxAttempts < 1 || retry.maxAttempts > config.maxAttempts || !Number.isInteger(retry.backoffMs) || retry.backoffMs < 0) failures.push(fail("retry.bounds"));
    if (step.retry.retryFatal === true || retry.retryOn !== "retryable") failures.push(fail("retry.fatal", true));
    if (request.executionPolicy.level === 3 && retry.maxAttempts > 1) failures.push(fail("retry.level3"));
    // the policy the request carries can never be lower than the step's level asks for
    if (ROLE_RANK[request.executionPolicy.approverRole] < ROLE_RANK[LEVEL_ROLE[levelOf(step.level)]]) failures.push(fail("policy.lowered"));
  }
  // priority: a known one, never above the plan's
  if (!isPriority(request.priority)) failures.push(fail("priority.invalid"));
  else if (plan && PRIORITY_RANK[request.priority] > PRIORITY_RANK[plan.priority]) failures.push(fail("priority.escalation"));
  // plans that must finish first
  if (plan) {
    for (const dependency of plan.dependsOn) {
      const other = sources.plans.find((row) => row.planId === dependency && row.tenantId === request.companyId);
      if (!other) failures.push(fail("dependency.planMissing"));
      else if (other.status === "Rejected" || other.status === "Cancelled" || other.status === "Expired") failures.push(fail("dependency.planFailed", true));
      else if (other.status !== "Completed") failures.push(fail("dependency.planPending"));
    }
  }
  // version: the Worker Runtime and the Worker OS must agree, and the version must be one the platform accepts
  if (runtime && profile) {
    if (!parseVersion(runtime.version) || !parseVersion(profile.version) || compareVersions(runtime.version, profile.version) !== 0) failures.push(fail("version.mismatch"));
    else if (compareVersions(profile.version, config.minWorkerVersion) < 0) failures.push(fail("version.minimum"));
  }

  const unique: Failure[] = [];
  for (const failure of failures) if (!unique.some((row) => row.code === failure.code)) unique.push(failure);
  const workerVersion = profile?.version;
  const base = { failures: unique, approvedBy: decision.approvedBy, ...(workerVersion && parseVersion(workerVersion) ? { workerVersion } : {}) };
  if (unique.some((row) => row.permanent)) return { outcome: "rejected", ...base };
  if (unique.length > 0) return { outcome: "blocked", ...base };
  return { outcome: decision.approval === "pending" ? "waitingApproval" : "ready", ...base };
}
