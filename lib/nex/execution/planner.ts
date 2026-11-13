// Planner: turns ONE Copilot recommendation and the actions it brought into an execution plan whose steps form a DAG (a graph of steps with "must come after" edges and no cycles). It is
// completely deterministic: the same recommendation and actions always give the same plan, with the same ids, the same order and the same dependencies. The steps are ordered by autonomy level
// (preparing before acting: a step depends on the steps of the nearest lower level, plus the actions that are its known prerequisites), so a cycle cannot come out of it, and every edge added
// afterwards is checked. Nothing here runs anything.

import { levelForAction } from "@/lib/contracts/platform/workers";
import { APPROVER_BY_LEVEL, ROLE_RANK } from "@/lib/nex/copilot";
import { ACTION_CONNECTOR, ACTION_PREREQS, API_COST_MICROS, LEVEL_PROFILE, moduleOfAction, rollbackFor, specialtyOfAction } from "./execution-actions";
import type { ExecutionConfig, ExecutionPlan, ExecutionStep, InvolvedModule, Priority, Recommendation, RequiredAuthorization, RequiredWorker, Role, Severity, SuggestedAction } from "./execution-types";

export const planIdFor = (findingId: string, revision: number): string => (revision <= 1 ? `xp:${findingId}` : `xp:${findingId}#${revision}`);
const PRIORITY_OF: Readonly<Record<Severity, Priority>> = { critical: "critical", high: "high", medium: "normal", low: "low" };
export const PRIORITY_RANK: Readonly<Record<Priority, number>> = { critical: 4, high: 3, normal: 2, low: 1 };

/** Plans that need another plan to be completed first (by recommendation). Static, and acyclic: a test keeps it so. */
export const PLAN_DEPENDENCIES: Readonly<Record<string, readonly string[]>> = {
  "crm.retention": ["support.unservedCustomers"], "sales.conversion": ["marketing.noLeads"], "automations.scale": ["ai.errors"], "finance.costExceedsSavings": ["ai.errors"], "ai.dependency": ["ai.errors"], "growth.momentum": ["crm.churn"],
};

// ---------------------------------------------------------------------------------------------- the DAG
type Node = { id: string; dependsOn: readonly string[] };
/** The steps in an order that respects every dependency (ties by their position), or undefined if there is a cycle or a dependency on something that is not there. */
export function topologicalOrder(steps: readonly Node[]): string[] | undefined {
  const known = new Set(steps.map((step) => step.id));
  if (steps.some((step) => step.dependsOn.some((dep) => !known.has(dep) || dep === step.id))) return undefined;
  const remaining = new Map(steps.map((step) => [step.id, new Set(step.dependsOn)]));
  const order: string[] = [];
  while (remaining.size > 0) {
    const next = steps.find((step) => remaining.has(step.id) && (remaining.get(step.id) as Set<string>).size === 0);
    if (!next) return undefined; // what is left depends on itself: a cycle
    order.push(next.id);
    remaining.delete(next.id);
    for (const deps of remaining.values()) deps.delete(next.id);
  }
  return order;
}
/** Would "stepId must come after dependsOn" close a loop? (It does when dependsOn already depends, directly or not, on stepId.) */
export function wouldCreateCycle(steps: readonly Node[], stepId: string, dependsOn: string): boolean {
  if (stepId === dependsOn) return true;
  const byId = new Map(steps.map((step) => [step.id, step]));
  const seen = new Set<string>();
  const stack = [dependsOn];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === stepId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const dep of byId.get(current)?.dependsOn ?? []) stack.push(dep);
  }
  return false;
}
export type AddDependency = { ok: true; steps: readonly ExecutionStep[] } | { ok: false; reason: "unknown" | "self" | "cycle" };
/** Adds an edge to the DAG, refusing what would make it cyclic. Never changes the steps it is given. */
export function addDependency(steps: readonly ExecutionStep[], stepId: string, dependsOn: string): AddDependency {
  if (!steps.some((step) => step.id === stepId) || !steps.some((step) => step.id === dependsOn)) return { ok: false, reason: "unknown" };
  if (stepId === dependsOn) return { ok: false, reason: "self" };
  if (wouldCreateCycle(steps, stepId, dependsOn)) return { ok: false, reason: "cycle" };
  return { ok: true, steps: steps.map((step) => (step.id === stepId && !step.dependsOn.includes(dependsOn) ? { ...step, dependsOn: [...step.dependsOn, dependsOn].sort() } : step)) };
}
/** The time the plan takes if everything that can run together does: the longest path through the DAG. */
export function criticalPathMs(steps: readonly Pick<ExecutionStep, "id" | "dependsOn" | "estimatedMs">[]): number {
  const order = topologicalOrder(steps);
  if (!order) return steps.reduce((total, step) => total + step.estimatedMs, 0);
  const finish = new Map<string, number>();
  for (const id of order) {
    const step = steps.find((row) => row.id === id) as (typeof steps)[number];
    finish.set(id, step.estimatedMs + Math.max(0, ...step.dependsOn.map((dep) => finish.get(dep) ?? 0)));
  }
  return Math.max(0, ...finish.values());
}

// ---------------------------------------------------------------------------------------------- the plan
const highestRole = (roles: readonly Role[]): Role => roles.reduce((best, role) => (ROLE_RANK[role] > ROLE_RANK[best] ? role : best), "member" as Role);

export type BuildInput = {
  tenantId: string; at: string; createdBy: string; recommendation: Recommendation; actions: readonly SuggestedAction[]; revision: number;
  config: Pick<ExecutionConfig, "planTtlMs">; grants?: readonly string[];
};
export function buildPlan(input: BuildInput): ExecutionPlan {
  const { recommendation: rec } = input;
  const id = planIdFor(rec.findingId, input.revision);
  // preparing comes before acting: lowest level first, then by action id, so the order never depends on how the actions were handed in
  const ordered = [...input.actions].map((action) => ({ action, level: levelForAction(action.actionId) })).sort((a, b) => a.level - b.level || a.action.actionId.localeCompare(b.action.actionId) || a.action.id.localeCompare(b.action.id));
  const steps: ExecutionStep[] = ordered.map(({ action, level }, index) => {
    const profile = LEVEL_PROFILE[level];
    const connector = ACTION_CONNECTOR[action.actionId];
    const rollback = rollbackFor(action.actionId, level);
    const lowerLevels = ordered.slice(0, index).map((row) => row.level).filter((value) => value < level);
    const nearest = lowerLevels.length > 0 ? Math.max(...lowerLevels) : undefined;
    const before = ordered.slice(0, index).flatMap((row, position) => (row.level === nearest || (ACTION_PREREQS[action.actionId] ?? []).includes(row.action.actionId) ? [`${id}:s${position + 1}`] : []));
    return {
      id: `${id}:s${index + 1}`, order: index + 1, title: action.label, action: action.actionId, module: moduleOfAction(action.actionId),
      worker: { specialty: specialtyOfAction(action.actionId) }, authorizationLevel: level, approverRole: APPROVER_BY_LEVEL[level], timeoutMs: profile.timeoutMs, retry: profile.retry,
      rollbackPolicy: rollback.policy, ...(rollback.compensationAction ? { compensationAction: rollback.compensationAction } : {}), state: "pending", attempts: 0, dependsOn: [...new Set(before)].sort(),
      ...(connector ? { connector } : {}), costAiMicros: profile.aiMicros, costApiMicros: connector ? API_COST_MICROS : 0, estimatedMs: profile.estimatedMs,
      sourceActionId: action.id, ...(action.status === "approved" && action.decidedBy ? { approvedInCopilot: action.decidedBy } : {}),
    };
  });
  return finalize({
    id, tenantId: input.tenantId, revision: input.revision, recommendationId: rec.id, findingId: rec.findingId, objective: rec.title, priority: PRIORITY_OF[rec.severity], severity: rec.severity,
    expectedImpact: rec.impact, risk: rec.risk, expectedBenefit: rec.benefit, modules: [], workers: [], connectors: [], authorizations: [], dependsOn: [], steps,
    rollback: { policy: "reverse-order", steps: [], requested: false, requestedSteps: [] }, cost: { aiMicros: 0, apiMicros: 0 }, estimatedMs: 0, status: "Draft", needs: rec.needs, requiredRole: "member",
    createdAt: input.at, expiresAt: new Date(Date.parse(input.at) + input.config.planTtlMs).toISOString(), createdBy: input.createdBy, history: [{ at: input.at, from: null, to: "Draft", by: input.createdBy }],
  }, rec.modules, input.grants ?? []);
}

/** Derives everything that summarizes the steps: modules, workers, connectors, authorizations, rollback, costs, time and the role the plan needs. Called whenever the steps change. */
export function finalize(plan: ExecutionPlan, recommendationModules: readonly InvolvedModule[], grants: readonly string[]): ExecutionPlan {
  const bySpecialty = new Map<string, RequiredWorker>();
  for (const step of plan.steps) {
    const key = `${step.worker.specialty}|${step.worker.workerId ?? ""}`;
    const row = bySpecialty.get(key);
    bySpecialty.set(key, { specialty: step.worker.specialty, ...(step.worker.workerId ? { workerId: step.worker.workerId } : {}), steps: (row?.steps ?? 0) + 1 });
  }
  const byAction = new Map<string, RequiredAuthorization>();
  for (const step of plan.steps) {
    const row = byAction.get(step.action);
    byAction.set(step.action, { action: step.action, level: step.authorizationLevel, approverRole: step.approverRole, steps: (row?.steps ?? 0) + 1, standing: step.authorizationLevel === 2 && grants.includes(step.action) });
  }
  const order = topologicalOrder(plan.steps) ?? plan.steps.map((step) => step.id);
  return {
    ...plan,
    modules: [...new Set([...recommendationModules, ...plan.steps.map((step) => step.module)])].sort(),
    workers: [...bySpecialty.values()].sort((a, b) => a.specialty.localeCompare(b.specialty) || (a.workerId ?? "").localeCompare(b.workerId ?? "")),
    connectors: [...new Set(plan.steps.flatMap((step) => (step.connector ? [step.connector] : [])))].sort(),
    authorizations: [...byAction.values()].sort((a, b) => b.level - a.level || a.action.localeCompare(b.action)),
    rollback: { ...plan.rollback, steps: [...order].reverse().flatMap((id) => { const step = plan.steps.find((row) => row.id === id) as ExecutionStep; return step.rollbackPolicy === "none" ? [] : [{ stepId: step.id, policy: step.rollbackPolicy, ...(step.compensationAction ? { compensationAction: step.compensationAction } : {}) }]; }) },
    cost: { aiMicros: plan.steps.reduce((total, step) => total + step.costAiMicros, 0), apiMicros: plan.steps.reduce((total, step) => total + step.costApiMicros, 0) },
    estimatedMs: criticalPathMs(plan.steps),
    requiredRole: highestRole(plan.steps.map((step) => step.approverRole)),
  };
}

/** The ids of the plans a plan waits for: the latest plan of each recommendation it depends on that is still alive or finished (a cancelled, rejected or expired one no longer blocks it). */
export function planDependencies(findingId: string, plans: readonly ExecutionPlan[], tenantId: string): string[] {
  const wanted = PLAN_DEPENDENCIES[findingId] ?? [];
  return wanted.flatMap((dep) => {
    const latest = plans.filter((plan) => plan.tenantId === tenantId && plan.findingId === dep).sort((a, b) => b.revision - a.revision)[0];
    return latest && (latest.status !== "Rejected" && latest.status !== "Cancelled" && latest.status !== "Expired") ? [latest.id] : [];
  }).sort();
}
