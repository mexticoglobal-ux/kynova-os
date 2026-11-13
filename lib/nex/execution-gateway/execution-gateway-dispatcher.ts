// Execution Gateway Dispatcher: builds EXECUTION REQUESTS and nothing else. It copies from the facts of the plan, the step and the worker what would be run, by whom and under which rules, gives the request a
// deterministic id, and lists the requests that are Ready in a deterministic order (priority, then who waited longest, then id). It never executes, never calls the Runtime, never calls a Worker, and a
// request holds no prompt, no context, no memory and no answer. Pure.

import { PRIORITIES, PRIORITY_RANK, levelOf, type ExecutionRequest, type GatewayRecord, type GatewaySources, type RequestSpec } from "./execution-gateway-types";
import { requiredRole } from "./execution-gateway-policy";

const SAFE = /^[A-Za-z0-9_.:-]{1,60}$/;
export const requestIdFor = (planId: string, stepId: string): string => `er:${planId}:${stepId}`;
export const validSpec = (spec: RequestSpec): boolean =>
  typeof spec === "object" && spec !== null && SAFE.test(spec.planId) && SAFE.test(spec.stepId) && SAFE.test(spec.workerId) && (spec.priority === undefined || (PRIORITIES as readonly string[]).includes(spec.priority)) &&
  Object.keys(spec).every((key) => ["planId", "stepId", "workerId", "priority"].includes(key));

export type Built = { ok: true; request: ExecutionRequest } | { ok: false; reason: "plan" | "step" | "worker" | "shape" };
/** Builds the request for one step, one worker, in one company. Only what exists in the company's own facts can be built. */
export function buildRequest(spec: RequestSpec, tenantId: string, at: string, sources: Pick<GatewaySources, "plans" | "runtimeWorkers" | "osWorkers">): Built {
  const plan = sources.plans.find((row) => row.planId === spec.planId && row.tenantId === tenantId);
  if (!plan) return { ok: false, reason: "plan" };
  const step = plan.steps.find((row) => row.stepId === spec.stepId);
  if (!step) return { ok: false, reason: "step" };
  if (!sources.runtimeWorkers.some((row) => row.workerId === spec.workerId && row.tenantId === tenantId) || !sources.osWorkers.some((row) => row.workerId === spec.workerId && row.companyId === tenantId)) return { ok: false, reason: "worker" };
  if (typeof step.timeoutMs !== "number" || typeof step.retry?.maxAttempts !== "number" || typeof step.retry?.backoffMs !== "number") return { ok: false, reason: "shape" };
  const level = levelOf(step.level);
  return {
    ok: true,
    request: {
      requestId: requestIdFor(plan.planId, step.stepId), companyId: tenantId, workerId: spec.workerId, planId: plan.planId, stepId: step.stepId, actionId: step.actionId, priority: spec.priority ?? plan.priority, requestedAt: at,
      approvedBy: plan.decidedBy ?? null, timeout: step.timeoutMs, retryPolicy: { maxAttempts: step.retry.maxAttempts, backoffMs: step.retry.backoffMs, retryOn: "retryable" },
      executionPolicy: { level, approverRole: requiredRole(step), requiresApproval: true, mode: "request-only" }, toolRequirements: [...step.tools].sort(), capabilityRequirements: [...step.capabilities].sort(),
    },
  };
}

/** The order requests are served in: priority, then who asked first, then id (so ties never change). */
export function requestOrder<T extends { request: Pick<ExecutionRequest, "priority" | "requestedAt" | "requestId"> }>(records: readonly T[]): T[] {
  return [...records].sort((a, b) => PRIORITY_RANK[b.request.priority] - PRIORITY_RANK[a.request.priority] || a.request.requestedAt.localeCompare(b.request.requestedAt) || a.request.requestId.localeCompare(b.request.requestId));
}
/** The requests that may be handed on, in order: the Ready ones. A list of what would be asked; nothing is asked. */
export const readyRequests = (records: readonly GatewayRecord[]): ExecutionRequest[] => requestOrder(records.filter((row) => row.state === "Ready")).map((row) => row.request);
