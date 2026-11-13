// Execution Dashboard: the data a future dashboard will show about the execution plans of ONE company, as plain structures (no screen): plans by state and priority, workers required and available,
// utilization, average times, AI and API costs, bottlenecks and dependencies. It is built only from the plans it is handed (the caller hands in the ones the asker may see) and from that company's
// roster, so nothing hidden, and nothing of another company, can appear in it. Pure: the clock is handed in.

import { PRIORITIES, PLAN_STATUSES, type ExecutionPlan, type PlanStatus, type Priority, type RosterView } from "./execution-types";

const OPEN: readonly PlanStatus[] = ["Draft", "WaitingApproval", "Approved", "Running", "Paused"];
const ACTIVE: readonly PlanStatus[] = ["Approved", "Running", "Paused"];
const PENDING: readonly PlanStatus[] = ["Draft", "WaitingApproval"];
/** A plan waiting for a decision for longer than this is a bottleneck. */
const SLOW_APPROVAL_MS = 86_400_000;
const mean = (values: readonly number[]): number | null => (values.length === 0 ? null : Math.round(values.reduce((a, b) => a + b, 0) / values.length));

export type Bottleneck = { kind: "worker" | "dependency" | "approval" | "blocked" | "unassigned"; id: string; score: number };
export type ExecutionDashboard = {
  tenantId: string; generatedAt: string;
  plans: { total: number; active: number; pending: number; completed: number; cancelled: number; rejected: number; expired: number };
  byStatus: Readonly<Record<PlanStatus, number>>; byPriority: Readonly<Record<Priority, number>>;
  workers: { required: number; requiredBySpecialty: Readonly<Record<string, number>>; available: number; availableBySpecialty: Readonly<Record<string, number>>; unassignedSteps: number; utilizationPercent: number | null; load: readonly { workerId: string; steps: number; estimatedMs: number }[] };
  time: { avgPlannedMs: number | null; avgCompletedMs: number | null };
  cost: { open: { aiMicros: number; apiMicros: number }; completed: { aiMicros: number; apiMicros: number } };
  bottlenecks: readonly Bottleneck[];
  dependencies: { plans: readonly { planId: string; dependsOn: readonly string[] }[]; stepEdges: number; blockedPlans: readonly string[] };
};

export function buildExecutionDashboard(input: { tenantId: string; at: string; plans: readonly ExecutionPlan[]; roster: RosterView }): ExecutionDashboard {
  // one company only: a plan of another is never counted
  const plans = input.plans.filter((plan) => plan.tenantId === input.tenantId).sort((a, b) => a.id.localeCompare(b.id));
  const byStatus = Object.fromEntries(PLAN_STATUSES.map((status) => [status, plans.filter((plan) => plan.status === status).length])) as Record<PlanStatus, number>;
  const byPriority = Object.fromEntries(PRIORITIES.map((priority) => [priority, plans.filter((plan) => plan.priority === priority).length])) as Record<Priority, number>;
  const open = plans.filter((plan) => OPEN.includes(plan.status));
  const completed = plans.filter((plan) => plan.status === "Completed");

  // workers: who the open plans need, who the company has, how loaded each is
  const steps = open.flatMap((plan) => plan.steps);
  const requiredBySpecialty: Record<string, number> = {};
  for (const step of steps) requiredBySpecialty[step.worker.specialty] = (requiredBySpecialty[step.worker.specialty] ?? 0) + 1;
  const active = input.roster.workers.filter((worker) => worker.status === "active");
  const availableBySpecialty: Record<string, number> = {};
  for (const worker of active) availableBySpecialty[worker.specialty] = (availableBySpecialty[worker.specialty] ?? 0) + 1;
  const loadMap = new Map<string, { steps: number; estimatedMs: number }>();
  for (const step of steps) if (step.worker.workerId) { const row = loadMap.get(step.worker.workerId) ?? { steps: 0, estimatedMs: 0 }; loadMap.set(step.worker.workerId, { steps: row.steps + 1, estimatedMs: row.estimatedMs + step.estimatedMs }); }
  const load = [...loadMap.entries()].map(([workerId, row]) => ({ workerId, ...row })).sort((a, b) => b.estimatedMs - a.estimatedMs || a.workerId.localeCompare(b.workerId));
  const unassignedSteps = steps.filter((step) => !step.worker.workerId).length;

  // bottlenecks
  const bottlenecks: Bottleneck[] = [];
  const totalMs = load.reduce((total, row) => total + row.estimatedMs, 0);
  if (load[0] && load.reduce((total, row) => total + row.steps, 0) >= 3 && load[0].estimatedMs / totalMs > 0.5) bottlenecks.push({ kind: "worker", id: load[0].workerId, score: Math.round((load[0].estimatedMs / totalMs) * 100) });
  const dependents = new Map<string, number>();
  for (const step of steps) for (const dep of step.dependsOn) dependents.set(dep, (dependents.get(dep) ?? 0) + 1);
  for (const [id, count] of dependents) if (count >= 2) bottlenecks.push({ kind: "dependency", id, score: count });
  for (const plan of open.filter((row) => row.status === "WaitingApproval")) {
    const since = plan.history.filter((entry) => entry.to === "WaitingApproval").at(-1)?.at;
    const waited = since ? Date.parse(input.at) - Date.parse(since) : 0;
    if (waited >= SLOW_APPROVAL_MS) bottlenecks.push({ kind: "approval", id: plan.id, score: Math.round(waited / 3_600_000) });
  }
  for (const plan of open.filter((row) => row.status === "Paused" && row.blockedBy)) bottlenecks.push({ kind: "blocked", id: plan.id, score: 100 });
  for (const [specialty, count] of Object.entries(requiredBySpecialty)) { const missing = steps.filter((step) => step.worker.specialty === specialty && !step.worker.workerId).length; if (missing > 0 && count > 0) bottlenecks.push({ kind: "unassigned", id: specialty, score: missing }); }
  bottlenecks.sort((a, b) => b.score - a.score || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

  const sum = (list: readonly ExecutionPlan[], key: "aiMicros" | "apiMicros") => list.reduce((total, plan) => total + plan.cost[key], 0);
  return {
    tenantId: input.tenantId, generatedAt: input.at,
    plans: { total: plans.length, active: plans.filter((plan) => ACTIVE.includes(plan.status)).length, pending: plans.filter((plan) => PENDING.includes(plan.status)).length, completed: byStatus.Completed, cancelled: byStatus.Cancelled, rejected: byStatus.Rejected, expired: byStatus.Expired },
    byStatus, byPriority,
    workers: { required: load.length, requiredBySpecialty, available: active.length, availableBySpecialty, unassignedSteps, utilizationPercent: active.length === 0 ? null : Math.round((load.length / active.length) * 100), load },
    time: { avgPlannedMs: mean(open.map((plan) => plan.estimatedMs)), avgCompletedMs: mean(completed.flatMap((plan) => (plan.startedAt && plan.completedAt ? [Date.parse(plan.completedAt) - Date.parse(plan.startedAt)] : []))) },
    cost: { open: { aiMicros: sum(open, "aiMicros"), apiMicros: sum(open, "apiMicros") }, completed: { aiMicros: sum(completed, "aiMicros"), apiMicros: sum(completed, "apiMicros") } },
    bottlenecks,
    dependencies: { plans: plans.filter((plan) => plan.dependsOn.length > 0).map((plan) => ({ planId: plan.id, dependsOn: plan.dependsOn })), stepEdges: steps.reduce((total, step) => total + step.dependsOn.length, 0), blockedPlans: plans.filter((plan) => plan.status === "Paused" && plan.blockedBy).map((plan) => plan.id) },
  };
}
