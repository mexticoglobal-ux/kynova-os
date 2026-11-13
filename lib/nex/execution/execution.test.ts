/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CONNECTOR_IDS } from "@/lib/contracts/platform/connectors";
import type { InsightsInput } from "@/lib/contracts/platform/koe-insights";
import { metricOf, type BusinessFact, type ExecutionEvent as LedgerExecution } from "@/lib/contracts/platform/koe-ledger";
import { ACTION_LEVELS, isKnownAction, levelForAction } from "@/lib/contracts/platform/workers";
import { CopilotEngine, RULES, type Principal as CopilotPrincipal } from "@/lib/nex/copilot";
import {
  ACTION_CONNECTOR, ACTION_PREREQS, DEFAULT_CONFIG, ExecutionEngine, LEVEL_PROFILE, PLAN_DEPENDENCIES, PLAN_STATUSES, PRIORITIES, TRANSITIONS, addDependency, assignWorkers, buildExecutionDashboard, buildPlan,
  canTransition, criticalPathMs, dagIsValid, moduleOfAction, newExecutionState, planDependencies, planIdFor, prepareExecution, reduceExecution, rollbackFor, scheduleExecution, specialtyOfAction, topologicalOrder,
  refreshPlan, validateExecution, wouldCreateCycle, type CopilotOutput, type ExecutionEvent, type ExecutionPlan, type ExecutionStep, type Principal, type RosterView,
} from "./index";

const T1 = "tenant-nova";
const T2 = "tenant-vida";
const START = Date.parse("2026-11-12T10:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 86_400_000;
const person = (tenantId: string, id: string, role: "viewer" | "member" | "manager" | "admin" | "owner"): Principal => ({ kind: "person", tenantId, id, role });
const ana = person(T1, "ana", "owner");
const adela = person(T1, "adela", "admin");
const marta = person(T1, "marta", "manager");
const mario = person(T1, "mario", "member");
const vera = person(T1, "vera", "viewer");
const luis = person(T2, "luis", "owner");
const sales: Principal = { kind: "worker", tenantId: T1, id: "sales" };
const ghost: Principal = { kind: "worker", tenantId: T1, id: "ghost" };
const system = (tenantId = T1): Principal => ({ kind: "system", tenantId });
const ACTIVE: Record<string, string[]> = { [T1]: ["sales", "followup"], [T2]: ["sales"] };
const env = { isWorkerActive: (tenantId: string, workerId: string) => ACTIVE[tenantId]?.includes(workerId) ?? false };

// ---------------------------------------------------------------------------------------------- the Copilot's real output as input
let counter = 0;
const run = (tenantId: string, over: Partial<LedgerExecution> = {}): LedgerExecution => { counter += 1; return { id: `e${counter}`, tenantId, at: "2026-11-05T10:00:00.000Z", source: "koe", workerId: "sales", workerName: "Ventas", specialty: "sales", fallback: false, outcome: "success", costMicros: 1_000_000, ...over }; };
const fact = (tenantId: string, metric: string, value: number): BusinessFact => { counter += 1; return { id: `f${counter}`, tenantId, at: "2026-11-06T10:00:00.000Z", module: metricOf(metric)!.module, metric, value }; };
const troubled = (tenantId = T1): InsightsInput => ({
  tenantId, roster: { workers: ["sales", "support", "ops"].map((id) => ({ id, name: id, specialty: "sales", status: "active" as const })), agents: [] },
  executions: [...Array.from({ length: 3 }, () => run(tenantId, { costMicros: 5_000_000 })), ...Array.from({ length: 3 }, () => run(tenantId, { outcome: "error", costMicros: 5_000_000 }))],
  facts: [["customersNew", 2], ["customersLost", 5], ["customersActive", 3], ["leadsNew", 100], ["leadsQualified", 40], ["proposalsSent", 10], ["leadsConverted", 2]].map(([metric, value]) => fact(tenantId, metric as string, value as number)),
});
const EMPTY_MEMORY = { memories: [], seq: {}, audit: [] } as never;
const EMPTY_GRAPH = { nodes: [], edges: [], audit: [] } as never;
const ROSTER: RosterView = {
  workers: [
    { id: "w-sales", name: "Ventas", specialty: "sales", status: "active" }, { id: "w-sales2", name: "Ventas 2", specialty: "sales", status: "active" }, { id: "w-paused", name: "Pausado", specialty: "sales", status: "paused" },
    { id: "w-sup", name: "Soporte", specialty: "support", status: "active" }, { id: "w-fin", name: "Finanzas", specialty: "finance", status: "active" }, { id: "w-ops", name: "Operaciones", specialty: "operations", status: "active" },
  ],
};
const ROSTER_T2: RosterView = { workers: [{ id: "v-ops", name: "Ops", specialty: "operations", status: "active" }] };

function world(options: { roster?: Record<string, RosterView>; connected?: Record<string, readonly (typeof CONNECTOR_IDS)[number][]>; grants?: Record<string, readonly string[]>; config?: Partial<typeof DEFAULT_CONFIG> } = {}) {
  const clock = { t: START, step: 0, advance(ms: number) { this.t += ms; } };
  const now = () => { const value = clock.t; clock.t += clock.step; return value; };
  const rosters = options.roster ?? { [T1]: ROSTER, [T2]: ROSTER_T2 };
  const copilot = new CopilotEngine({ env, now, memory: () => EMPTY_MEMORY, graph: () => EMPTY_GRAPH, koe: (tenantId) => (tenantId === T1 ? troubled() : undefined), config: { maxRecommendations: 20, maxActions: 200 } });
  const exec = new ExecutionEngine({
    env, now, roster: (tenantId) => rosters[tenantId] ?? { workers: [] }, connected: (tenantId) => options.connected?.[tenantId] ?? ["gmail"], grants: (tenantId) => options.grants?.[tenantId] ?? [],
    ...(options.config ? { config: options.config } : {}),
  });
  return { clock, copilot, exec };
}
type World = ReturnType<typeof world>;
/** What the Copilot produced for this asker: recommendations and suggested actions. */
const outputOf = (w: World, actor: Principal): CopilotOutput => {
  const result = w.copilot.ask(actor as CopilotPrincipal, "cómo vamos");
  expect(result.ok, `${result.refusal}`).toBe(true);
  return { recommendations: result.response!.recommendations, actions: result.response!.actions };
};
const prepared = (w: World, actor: Principal = ana, from?: CopilotOutput) => {
  const result = w.exec.prepare(actor, from ?? outputOf(w, ana));
  expect(result.ok, `${result.refusal} ${result.reasons}`).toBe(true);
  return result;
};
const planOf = (w: World, finding: string, actor: Principal = ana) => w.exec.plansFor(actor).find((plan) => plan.findingId === finding)!;
const ok = (result: { ok: boolean; refusal?: string; reasons?: readonly string[] }, label = "") => expect(result.ok, `${label} ${result.refusal} ${result.reasons}`).toBe(true);
/** A plan in a given state, by the real path. */
function advance(w: World, finding: string, to: "Draft" | "WaitingApproval" | "Approved" | "Running") {
  const id = planOf(w, finding).id;
  if (to === "Draft") return id;
  ok(w.exec.submit(mario, id), "submit");
  if (to === "WaitingApproval") return id;
  ok(w.exec.approve(ana, id), "approve");
  if (to === "Approved") return id;
  ok(w.exec.start(system(), id), "start");
  return id;
}

const step = (over: Partial<ExecutionStep> & { id: string }): ExecutionStep => ({
  order: 1, title: "paso", action: "task.create", module: "organization", worker: { specialty: "operations" }, authorizationLevel: 1, approverRole: "member", timeoutMs: 30_000, retry: { maxAttempts: 3, backoffMs: 1_000 },
  rollbackPolicy: "none", state: "pending", attempts: 0, dependsOn: [], costAiMicros: 20_000, costApiMicros: 0, estimatedMs: 5_000, sourceActionId: "act:x", ...over,
});
const shell = (steps: ExecutionStep[], over: Partial<ExecutionPlan> = {}): ExecutionPlan => ({
  id: "xp:demo", tenantId: T1, revision: 1, recommendationId: "rec:demo", findingId: "demo", objective: "Demo", priority: "normal", severity: "medium", expectedImpact: { level: "medium", score: 50 }, risk: { level: "low", note: "poco" },
  expectedBenefit: "algo", modules: [], workers: [], connectors: [], authorizations: [], dependsOn: [], steps, rollback: { policy: "reverse-order", steps: [], requested: false, requestedSteps: [] },
  cost: { aiMicros: 0, apiMicros: 0 }, estimatedMs: 0, status: "Draft", needs: "general", requiredRole: "member", createdAt: new Date(START).toISOString(), expiresAt: new Date(START + DAY).toISOString(), createdBy: "ana", history: [], ...over,
});

describe("the planner: recommendations into a DAG", () => {
  it("builds a plan with every field the Execution Plan promises", () => {
    const w = world();
    prepared(w);
    const plan = planOf(w, "crm.churn");
    for (const key of ["id", "tenantId", "objective", "priority", "severity", "expectedImpact", "risk", "expectedBenefit", "modules", "workers", "connectors", "authorizations", "dependsOn", "steps", "rollback", "cost", "estimatedMs", "status", "createdAt", "expiresAt"]) expect(plan, key).toHaveProperty(key);
    expect(plan).toMatchObject({
      id: "xp:crm.churn", tenantId: T1, revision: 1, objective: "Frenar la pérdida de clientes", priority: "critical", severity: "critical", status: "Draft", expectedImpact: { level: "high", score: 85 }, risk: { level: "high" },
      createdAt: new Date(START).toISOString(), expiresAt: new Date(START + DEFAULT_CONFIG.planTtlMs).toISOString(), requiredRole: "admin", connectors: ["gmail"],
    });
    expect(plan.expectedBenefit.length).toBeGreaterThan(10);
    expect(plan.modules).toEqual(expect.arrayContaining(["crm", "sales", "comms"]));
    expect(plan.history).toEqual([{ at: new Date(START).toISOString(), from: null, to: "Draft", by: "ana" }]);
  });
  it("turns each action into a step with its action, module, worker, level, timeout, retry, rollback, compensation and state", () => {
    const w = world();
    prepared(w);
    const plan = planOf(w, "crm.churn");
    expect(plan.steps.map((row) => row.action)).toEqual(["crm.task", "followup.send"]);
    for (const row of plan.steps) {
      expect(row).toMatchObject({ state: "pending", attempts: 0, timeoutMs: LEVEL_PROFILE[row.authorizationLevel].timeoutMs, retry: LEVEL_PROFILE[row.authorizationLevel].retry, authorizationLevel: levelForAction(row.action) });
      for (const key of ["action", "module", "worker", "authorizationLevel", "timeoutMs", "retry", "rollbackPolicy", "state"]) expect(row, key).toHaveProperty(key);
    }
    expect(plan.steps[0]).toMatchObject({ module: "crm", rollbackPolicy: "none", authorizationLevel: 1 });
    expect(plan.steps[0]).not.toHaveProperty("compensationAction");
    expect(plan.steps[1]).toMatchObject({ module: "comms", authorizationLevel: 3, approverRole: "admin", rollbackPolicy: "manual", compensationAction: "followup.send.manual-review", connector: "gmail", costApiMicros: 2_000 });
  });
  it("orders preparing before acting and builds the dependencies of the DAG", () => {
    const w = world();
    prepared(w);
    const plan = planOf(w, "crm.churn");
    expect(plan.steps[0]!.dependsOn).toEqual([]);
    expect(plan.steps[1]!.dependsOn).toEqual([plan.steps[0]!.id]);
    const levels = (finding: string) => (w.exec.plansFor(ana).find((plan) => plan.findingId === finding)?.steps ?? []).map((row) => row.authorizationLevel);
    for (const rule of RULES) { const list = levels(rule.id); if (list.length > 0) expect(list, rule.id).toEqual([...list].sort((a, b) => a - b)); }
    const dependency = planOf(w, "ai.dependency");
    expect(dependency.steps.map((row) => [row.action, row.authorizationLevel])).toEqual([["org.draft", 1], ["studio.assign", 2]]);
    expect(dependency.steps[1]!.dependsOn).toEqual([dependency.steps[0]!.id]);
  });
  it("never produces a cycle: every plan is a valid DAG, and its estimated time is the longest path", () => {
    const w = world();
    prepared(w);
    expect(w.exec.plansFor(ana).length).toBeGreaterThan(10);
    for (const plan of w.exec.plansFor(ana)) {
      expect(topologicalOrder(plan.steps), plan.id).toBeDefined();
      expect(dagIsValid(plan), plan.id).toBe(true);
      expect(plan.estimatedMs).toBe(criticalPathMs(plan.steps));
      expect(plan.estimatedMs).toBeLessThanOrEqual(plan.steps.reduce((total, row) => total + row.estimatedMs, 0));
      const order = topologicalOrder(plan.steps)!;
      for (const row of plan.steps) for (const dep of row.dependsOn) expect(order.indexOf(dep), `${plan.id} ${row.id}`).toBeLessThan(order.indexOf(row.id));
    }
  });
  it("is completely deterministic: the same recommendation and actions give the same plan, whatever the order they arrive in", () => {
    const w = world();
    const output = outputOf(w, ana);
    const rec = output.recommendations.find((row) => row.findingId === "ai.errors")!;
    const actions = output.actions.filter((row) => row.recommendationId === rec.id);
    const input = { tenantId: T1, at: new Date(START).toISOString(), createdBy: "ana", recommendation: rec, revision: 1, config: DEFAULT_CONFIG };
    const a = buildPlan({ ...input, actions });
    expect(buildPlan({ ...input, actions: [...actions].reverse() })).toEqual(a);
    expect(buildPlan({ ...input, actions })).toEqual(a);
    expect(a.steps.map((row) => row.id)).toEqual(["xp:ai.errors:s1", "xp:ai.errors:s2"]);
  });
  it("computes costs, time, authorizations and the role a plan needs from its steps", () => {
    const w = world();
    prepared(w);
    const plan = planOf(w, "crm.churn");
    expect(plan.cost).toEqual({ aiMicros: LEVEL_PROFILE[1].aiMicros + LEVEL_PROFILE[3].aiMicros, apiMicros: 2_000 });
    expect(plan.estimatedMs).toBe(LEVEL_PROFILE[1].estimatedMs + LEVEL_PROFILE[3].estimatedMs);
    expect(plan.authorizations).toEqual([
      { action: "followup.send", level: 3, approverRole: "admin", steps: 1, standing: false }, { action: "crm.task", level: 1, approverRole: "member", steps: 1, standing: false },
    ]);
    expect(planOf(w, "crm.retention").requiredRole).toBe("member");
    expect(planOf(w, "ai.dependency").requiredRole).toBe("manager");
    expect(plan.rollback).toEqual({ policy: "reverse-order", steps: [{ stepId: plan.steps[1]!.id, policy: "manual", compensationAction: "followup.send.manual-review" }], requested: false, requestedSteps: [] });
  });
  it("maps severity to priority and numbers the plans' revisions", () => {
    const w = world();
    prepared(w);
    expect(w.exec.plansFor(ana).filter((plan) => plan.severity === "critical").every((plan) => plan.priority === "critical")).toBe(true);
    expect(w.exec.plansFor(ana).some((plan) => plan.priority === "normal")).toBe(true);
    expect([...PRIORITIES]).toEqual(["critical", "high", "normal", "low"]);
    expect([planIdFor("crm.churn", 1), planIdFor("crm.churn", 2)]).toEqual(["xp:crm.churn", "xp:crm.churn#2"]);
  });
  it("detects dependencies between steps, refuses cycles and loops, and never changes what it is given", () => {
    const steps = [step({ id: "a" }), step({ id: "b", dependsOn: ["a"] }), step({ id: "c", dependsOn: ["b"] })] as ExecutionStep[];
    expect(topologicalOrder(steps)).toEqual(["a", "b", "c"]);
    expect(topologicalOrder([step({ id: "a", dependsOn: ["c"] }), ...steps.slice(1)])).toBeUndefined();
    expect(topologicalOrder([step({ id: "a", dependsOn: ["a"] })])).toBeUndefined();
    expect(topologicalOrder([step({ id: "a", dependsOn: ["nada"] })])).toBeUndefined();
    expect(wouldCreateCycle(steps, "a", "c")).toBe(true);
    expect(wouldCreateCycle(steps, "a", "a")).toBe(true);
    expect(wouldCreateCycle(steps, "c", "a")).toBe(false);
    const before = JSON.stringify(steps);
    expect(addDependency(steps, "a", "c")).toEqual({ ok: false, reason: "cycle" });
    expect(addDependency(steps, "a", "a")).toEqual({ ok: false, reason: "self" });
    expect(addDependency(steps, "a", "zzz")).toEqual({ ok: false, reason: "unknown" });
    const extra = addDependency([...steps, step({ id: "d" })], "d", "a");
    expect(extra).toMatchObject({ ok: true });
    expect(extra.ok && extra.steps.find((row) => row.id === "d")!.dependsOn).toEqual(["a"]);
    expect(JSON.stringify(steps)).toBe(before);
    expect(criticalPathMs([step({ id: "a", estimatedMs: 10 }), step({ id: "b", estimatedMs: 5 }), step({ id: "c", dependsOn: ["a"], estimatedMs: 7 })])).toBe(17);
  });
  it("keeps the dependencies between plans acyclic, and waits only for plans that are alive or finished", () => {
    const reaches = (from: string, target: string, seen = new Set<string>()): boolean => (PLAN_DEPENDENCIES[from] ?? []).some((dep) => dep === target || (!seen.has(dep) && (seen.add(dep), reaches(dep, target, seen))));
    for (const finding of Object.keys(PLAN_DEPENDENCIES)) expect(reaches(finding, finding), finding).toBe(false);
    for (const [finding, deps] of Object.entries(PLAN_DEPENDENCIES)) { expect(RULES.some((rule) => rule.id === finding)).toBe(true); for (const dep of deps) expect(RULES.some((rule) => rule.id === dep)).toBe(true); }
    const mk = (finding: string, status: ExecutionPlan["status"], revision = 1): ExecutionPlan => shell([], { id: planIdFor(finding, revision), findingId: finding, status, revision });
    expect(planDependencies("crm.retention", [mk("support.unservedCustomers", "WaitingApproval")], T1)).toEqual(["xp:support.unservedCustomers"]);
    expect(planDependencies("crm.retention", [mk("support.unservedCustomers", "Cancelled")], T1)).toEqual([]);
    expect(planDependencies("crm.retention", [mk("support.unservedCustomers", "Rejected"), mk("support.unservedCustomers", "Draft", 2)], T1)).toEqual(["xp:support.unservedCustomers#2"]);
    expect(planDependencies("crm.retention", [{ ...mk("support.unservedCustomers", "Completed"), tenantId: T2 }], T1)).toEqual([]);
    expect(planDependencies("crm.churn", [], T1)).toEqual([]);
  });
});

describe("the action catalog of the planner", () => {
  it("uses the platform's own autonomy levels, which fail closed", () => {
    expect(levelForAction("followup.send")).toBe(3);
    expect(levelForAction("nada.nada")).toBe(3);
    for (const rule of RULES) for (const action of rule.actions) expect(isKnownAction(action.actionId) && ACTION_LEVELS[action.actionId as keyof typeof ACTION_LEVELS] === levelForAction(action.actionId)).toBe(true);
  });
  it("knows the module, the worker, the connector, the prerequisites and the way back of every action of the Copilot", () => {
    for (const rule of RULES) for (const action of rule.actions) {
      expect(moduleOfAction(action.actionId), action.actionId).toBeTruthy();
      expect(specialtyOfAction(action.actionId), action.actionId).toBeTruthy();
      const level = levelForAction(action.actionId);
      const back = rollbackFor(action.actionId, level);
      if (level === 1) expect(back).toEqual({ policy: "none" });
      else expect(back.compensationAction, action.actionId).toBeTruthy();
    }
    expect(Object.values(ACTION_CONNECTOR).every((connector) => (CONNECTOR_IDS as readonly string[]).includes(connector))).toBe(true);
    expect(rollbackFor("studio.assign", 2)).toEqual({ policy: "compensate", compensationAction: "studio.assign.undo" });
    expect(rollbackFor("followup.send", 3)).toEqual({ policy: "manual", compensationAction: "followup.send.manual-review" });
    expect(ACTION_PREREQS["followup.send"]).toContain("crm.task");
    expect(moduleOfAction("desconocida.cosa")).toBe("organization");
  });
  it("gives the riskier levels more time and fewer retries", () => {
    expect(LEVEL_PROFILE[3].timeoutMs).toBeGreaterThan(LEVEL_PROFILE[1].timeoutMs);
    expect(LEVEL_PROFILE[3].retry.maxAttempts).toBeLessThan(LEVEL_PROFILE[1].retry.maxAttempts);
    expect(LEVEL_PROFILE[3].aiMicros).toBeGreaterThan(LEVEL_PROFILE[1].aiMicros);
  });
});

describe("the runtime adapter prepares, it never runs", () => {
  it("assigns the least loaded ACTIVE worker whose specialty fits, ties by id, and leaves a step unassigned when nobody fits", () => {
    const plan = shell([step({ id: "a", worker: { specialty: "sales" } }), step({ id: "b", worker: { specialty: "sales" } }), step({ id: "c", worker: { specialty: "sales" } }), step({ id: "d", worker: { specialty: "legal" } })]);
    const assigned = assignWorkers(plan, ROSTER);
    expect(assigned.steps.map((row) => row.worker.workerId)).toEqual(["w-sales", "w-sales2", "w-sales", undefined]);
    expect(assigned.workers).toEqual(expect.arrayContaining([{ specialty: "legal", steps: 1 }, { specialty: "sales", workerId: "w-sales", steps: 2 }]));
    expect(assignWorkers(plan, ROSTER, new Map([["w-sales", 5]])).steps[0]!.worker.workerId).toBe("w-sales2");
    expect(JSON.stringify(assigned)).not.toContain("w-paused");
    expect(assignWorkers(plan, { workers: [] }).steps.every((row) => row.worker.workerId === undefined)).toBe(true);
    expect(plan.steps[0]!.worker.workerId).toBeUndefined(); // the plan it was given is untouched
    expect(assignWorkers(plan, ROSTER)).toEqual(assigned);
  });
  type Ctx = Parameters<typeof validateExecution>[1];
  const codes = (plan: ExecutionPlan, context: Ctx = { connected: ["gmail"], grants: [], nowMs: START }) => validateExecution(plan, context).issues.map((issue) => `${issue.severity}:${issue.code}`);
  it("validates a plan: what is an error and what is only a warning", () => {
    const good = shell([step({ id: "a", worker: { specialty: "operations", workerId: "w-ops" } })]);
    expect(validateExecution(good, { connected: [], grants: [], nowMs: START })).toEqual({ valid: true, issues: [] });
    expect(codes(shell([]))).toContain("error:plan.empty");
    expect(codes(shell([step({ id: "a", dependsOn: ["b"] }), step({ id: "b", dependsOn: ["a"] })]))).toContain("error:plan.cycle");
    expect(codes(shell([step({ id: "a", dependsOn: ["zzz"] })]))).toContain("error:step.dependencyMissing");
    expect(codes(shell([step({ id: "a", action: "mágica.total" })]))).toContain("error:step.unknownAction");
    expect(codes(shell([step({ id: "a", timeoutMs: 0 })]))).toContain("error:step.timeout");
    expect(codes(shell([step({ id: "a", retry: { maxAttempts: 0, backoffMs: 0 } })]))).toContain("error:step.retry");
    expect(codes(shell([step({ id: "a", action: "studio.assign", authorizationLevel: 2, approverRole: "manager", rollbackPolicy: "none" })]))).toContain("error:step.rollbackMissing");
    expect(codes(shell([step({ id: "a", action: "studio.assign", authorizationLevel: 2, rollbackPolicy: "compensate" })]))).toContain("error:step.compensationMissing");
    expect(codes(shell([step({ id: "a", connector: "nada" as never })]))).toContain("error:step.connectorUnknown");
    expect(codes(shell([step({ id: "a", connector: "outlook" })]))).toContain("warning:step.connectorNotConnected");
    expect(codes(shell([step({ id: "a" })]))).toContain("warning:step.workerMissing");
    expect(codes(shell([step({ id: "a", action: "studio.assign", authorizationLevel: 2, rollbackPolicy: "compensate", compensationAction: "studio.assign.undo" })]))).toContain("warning:step.standingAuthorizationMissing");
    expect(codes(shell([step({ id: "a", action: "studio.assign", authorizationLevel: 2, rollbackPolicy: "compensate", compensationAction: "studio.assign.undo" })], {}), { connected: [], grants: ["studio.assign"], nowMs: START })).not.toContain("warning:step.standingAuthorizationMissing");
    expect(codes(shell([step({ id: "a" })], { expiresAt: new Date(START - 1).toISOString() }))).toContain("error:plan.expired");
    const report = validateExecution(shell([]), { connected: [], grants: [] });
    expect(report.valid).toBe(false);
    expect(report.issues.every((issue, index, all) => index === 0 || !(issue.severity === "error" && all[index - 1]!.severity === "warning"))).toBe(true);
  });
  it("schedules the steps as offsets: dependencies first, a worker one step at a time, critical plans first, and a plan waits for the plans it depends on", () => {
    const a = shell([step({ id: "a1", worker: { specialty: "ops", workerId: "w1" }, estimatedMs: 10 }), step({ id: "a2", worker: { specialty: "ops", workerId: "w1" }, estimatedMs: 10, dependsOn: ["a1"] })], { id: "xp:a", priority: "normal" });
    const b = shell([step({ id: "b1", worker: { specialty: "ops", workerId: "w1" }, estimatedMs: 5 })], { id: "xp:b", priority: "critical" });
    const c = shell([step({ id: "c1", worker: { specialty: "ops" }, estimatedMs: 4 })], { id: "xp:c", priority: "low", dependsOn: ["xp:a"] });
    const schedule = scheduleExecution([a, b, c]);
    expect(schedule.queue).toEqual(["xp:b", "xp:a", "xp:c"]);
    const at = (id: string) => schedule.items.find((item) => item.stepId === id)!;
    expect(at("b1")).toMatchObject({ startMs: 0, endMs: 5, workerId: "w1" });
    expect(at("a1")).toMatchObject({ startMs: 5, endMs: 15 });
    expect(at("a2")).toMatchObject({ startMs: 15, endMs: 25 });
    expect(at("c1")).toMatchObject({ startMs: 25, endMs: 29, workerId: null });
    expect(schedule.totalMs).toBe(29);
    expect(scheduleExecution([c, b, a])).toEqual(schedule);
    expect(scheduleExecution([])).toEqual({ queue: [], items: [], totalMs: 0 });
  });
  it("prepares execution from the Copilot's output: permissions first, then plans, with workers assigned and the dependencies between plans", () => {
    const w = world();
    const output = outputOf(w, ana);
    const result = prepareExecution({ tenantId: T1, actor: ana, at: new Date(START).toISOString(), createdBy: "ana", ...output, existing: [], sources: { roster: ROSTER, connected: ["gmail"], grants: [] }, config: DEFAULT_CONFIG });
    expect(result.plans.length).toBe(new Set(output.actions.map((row) => row.recommendationId)).size);
    expect(result.unchanged).toBe(0);
    expect(result.plans.find((plan) => plan.findingId === "ai.dependency")!.dependsOn).toEqual(["xp:ai.errors"]);
    expect(result.plans.find((plan) => plan.findingId === "crm.retention")!.dependsOn).toEqual(["xp:support.unservedCustomers"]);
    expect(result.plans.every((plan) => plan.steps.every((row) => row.worker.workerId !== "w-paused"))).toBe(true);
  });
  it("runs nothing: preparing, validating, assigning and scheduling only return structures, and the inputs are never changed", () => {
    const deepFreeze = <T,>(value: T): T => { if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
    const w = world();
    const output = deepFreeze(outputOf(w, ana));
    const roster = deepFreeze(structuredClone(ROSTER));
    const result = prepareExecution({ tenantId: T1, actor: ana, at: new Date(START).toISOString(), createdBy: "ana", ...output, existing: [], sources: { roster, connected: ["gmail"], grants: [] }, config: DEFAULT_CONFIG });
    const plan = deepFreeze(result.plans[0]!);
    expect(() => { validateExecution(plan, { connected: [], grants: [] }); assignWorkers(plan, roster); scheduleExecution(result.plans); }).not.toThrow();
    expect(result.plans.every((row) => row.status === "Draft" && row.steps.every((entry) => entry.state === "pending" && entry.attempts === 0))).toBe(true);
  });
});

describe("the states", () => {
  it("has exactly the nine states, and exactly the changes between them that make sense", () => {
    expect([...PLAN_STATUSES]).toEqual(["Draft", "WaitingApproval", "Approved", "Rejected", "Running", "Paused", "Completed", "Cancelled", "Expired"]);
    expect(TRANSITIONS).toEqual({
      Draft: ["WaitingApproval", "Cancelled", "Expired"], WaitingApproval: ["Approved", "Rejected", "Cancelled", "Expired"], Approved: ["Running", "Cancelled", "Expired"], Running: ["Paused", "Completed", "Cancelled"],
      Paused: ["Running", "Cancelled", "Expired"], Rejected: [], Completed: [], Cancelled: [], Expired: [],
    });
    for (const from of PLAN_STATUSES) for (const to of PLAN_STATUSES) expect(canTransition(from, to), `${from}→${to}`).toBe(TRANSITIONS[from].includes(to));
  });
  it("walks the whole path: Draft → WaitingApproval → Approved → Running → Completed, writing every change into the plan's history", () => {
    const w = world();
    prepared(w);
    const id = advance(w, "ai.errors", "Running");
    let plan = w.exec.planFor(ana, id)!;
    expect(plan.status).toBe("Running");
    expect(plan.steps.map((row) => row.state)).toEqual(["ready", "ready"]); // both are Level 1 drafts: neither waits for the other
    for (const row of plan.steps) {
      ok(w.exec.report(system(), id, row.id, "started"), "started");
      ok(w.exec.report(system(), id, row.id, "completed"), "completed");
    }
    plan = w.exec.planFor(ana, id)!;
    expect(plan.status).toBe("Completed");
    expect(plan.completedAt).toBeDefined();
    expect(plan.steps.every((row) => row.state === "completed")).toBe(true);
    expect(plan.history.map((entry) => entry.to)).toEqual(["Draft", "WaitingApproval", "Approved", "Running", "Completed"]);
    expect(plan.history.map((entry) => entry.by)).toEqual(["ana", "mario", "ana", "system", "system"]);
  });
  it("refuses a change that does not exist, and a terminal state never moves again", () => {
    const w = world();
    prepared(w);
    const id = planOf(w, "ai.errors").id;
    for (const [label, result] of [["approve a draft", w.exec.approve(ana, id)], ["reject a draft", w.exec.reject(ana, id)], ["start a draft", w.exec.start(system(), id)], ["pause a draft", w.exec.pause(marta, id)], ["resume a draft", w.exec.resume(marta, id)]] as const) {
      expect(result, label).toMatchObject({ ok: false, refusal: "state" });
    }
    ok(w.exec.submit(mario, id));
    expect(w.exec.submit(mario, id).refusal).toBe("state");
    ok(w.exec.reject(ana, id));
    for (const result of [w.exec.approve(ana, id), w.exec.cancel(marta, id), w.exec.submit(mario, id), w.exec.start(system(), id)]) expect(result.refusal).toBe("state");
    expect(w.exec.planFor(ana, id)!.status).toBe("Rejected");
  });
  it("lets a person who may decide approve or reject, by the highest autonomy level of the plan, and nobody else", () => {
    const w = world();
    prepared(w);
    const light = advance(w, "ai.errors", "WaitingApproval"); // Level 1 only: a member is enough
    expect(w.exec.approve(vera, light).refusal).toBe("notFound"); // a viewer does not even see it
    expect(w.exec.approve(sales, light).refusal).toBe("forbidden");
    expect(w.exec.approve(system(), light).refusal).toBe("forbidden");
    expect(w.exec.approve(mario, light)).toMatchObject({ ok: true, plan: { status: "Approved", decidedBy: "mario" } });
    const medium = advance(w, "ai.dependency", "WaitingApproval"); // Level 2: a manager
    expect(w.exec.approve(mario, medium)).toMatchObject({ ok: false, refusal: "level", reasons: ["requires:manager"] });
    expect(w.exec.approve(marta, medium).ok).toBe(true);
    const heavy = advance(w, "crm.churn", "WaitingApproval"); // Level 3: an administrator
    expect(w.exec.approve(marta, heavy)).toMatchObject({ ok: false, refusal: "level", reasons: ["requires:admin"] });
    expect(w.exec.reject(mario, heavy).refusal).toBe("level");
    expect(w.exec.reject(adela, heavy)).toMatchObject({ ok: true, plan: { status: "Rejected", decidedBy: "adela" } });
  });
  it("refuses to submit a plan with errors, and lists them", () => {
    const w = world();
    prepared(w);
    const id = planOf(w, "ai.errors").id;
    const broken = { ...w.exec.state.plans.find((plan) => plan.id === id)!, steps: [] };
    w.exec.state = { ...w.exec.state, plans: w.exec.state.plans.map((plan) => (plan.id === id ? broken : plan)) };
    expect(w.exec.submit(mario, id)).toMatchObject({ ok: false, refusal: "invalid", reasons: ["plan.empty"] });
    expect(w.exec.planFor(ana, id)!.status).toBe("Draft");
    expect(w.exec.submit(vera, id).refusal).toBe("forbidden");
  });
  it("cancels only by a manager or the system", () => {
    const w = world();
    prepared(w);
    const id = advance(w, "crm.churn", "Running");
    expect(w.exec.cancel(mario, id).refusal).toBe("forbidden");
    expect(w.exec.cancel(sales, id).refusal).toBe("forbidden");
    expect(w.exec.cancel(vera, id).refusal).toBe("forbidden");
    expect(w.exec.cancel(system(), id).ok).toBe(true);
  });
  it("prepares the way back of what was already done, in reverse order and only for the completed steps, when a running plan is cancelled: prepared, never run", () => {
    const steps = [
      step({ id: "a", order: 1, action: "studio.assign", authorizationLevel: 2, approverRole: "manager", rollbackPolicy: "compensate", compensationAction: "studio.assign.undo", state: "completed", worker: { specialty: "operations", workerId: "w-ops" } }),
      step({ id: "b", order: 2, action: "followup.send", authorizationLevel: 3, approverRole: "admin", rollbackPolicy: "manual", compensationAction: "followup.send.manual-review", dependsOn: ["a"], state: "completed", worker: { specialty: "sales", workerId: "w-sales" } }),
      step({ id: "c", order: 3, action: "studio.assign", authorizationLevel: 2, approverRole: "manager", rollbackPolicy: "compensate", compensationAction: "studio.assign.undo", dependsOn: ["b"], state: "ready", worker: { specialty: "operations", workerId: "w-ops" } }),
      step({ id: "d", order: 4, action: "task.create", state: "completed", worker: { specialty: "operations", workerId: "w-ops" } }),
    ];
    const plan = refreshPlan(shell(steps, { status: "Running", startedAt: new Date(START).toISOString() }));
    expect(plan.rollback.steps.map((entry) => entry.stepId)).toEqual(["c", "b", "a"]); // reverse order; the Level 1 draft has nothing to undo
    const sources = { env, roster: ROSTER, connected: ["gmail"] as never[], grants: [] as string[] };
    const outcome = reduceExecution({ plans: [plan], seq: {}, audit: [] }, { type: "cancel", tenantId: T1, actor: marta, at: new Date(START + HOUR).toISOString(), planId: plan.id }, sources);
    expect(outcome.result).toMatchObject({ ok: true, plan: { status: "Cancelled" } });
    expect(outcome.result.rollback).toEqual([{ stepId: "b", policy: "manual", compensationAction: "followup.send.manual-review" }, { stepId: "a", policy: "compensate", compensationAction: "studio.assign.undo" }]);
    expect(outcome.result.plan!.rollback).toMatchObject({ requested: true, requestedSteps: ["b", "a"] });
    expect(outcome.result.events.map((event) => event.type)).toEqual(["plan.cancelled", "plan.rollback_requested"]);
    // nothing was run to undo it: the steps keep the state the runtime last reported
    expect(outcome.result.plan!.steps.map((row) => row.state)).toEqual(["completed", "completed", "ready", "completed"]);
  });
  it("starts only by the system, only when approved, only when the plans it depends on are completed and every step has a worker", () => {
    const w = world();
    prepared(w);
    const dependent = advance(w, "ai.dependency", "Approved");
    expect(w.exec.start(marta, dependent).refusal).toBe("forbidden");
    expect(w.exec.start(ana, dependent).refusal).toBe("forbidden");
    expect(w.exec.start(system(), dependent)).toMatchObject({ ok: false, refusal: "dependency", reasons: ["xp:ai.errors"] });
    const base = advance(w, "ai.errors", "Running");
    for (const row of w.exec.planFor(ana, base)!.steps) { ok(w.exec.report(system(), base, row.id, "started")); ok(w.exec.report(system(), base, row.id, "completed")); }
    expect(w.exec.start(system(), dependent).ok).toBe(true);
    const lonely = world({ roster: { [T1]: { workers: [] }, [T2]: ROSTER_T2 } });
    prepared(lonely);
    const id = advance(lonely, "ai.errors", "Approved");
    expect(lonely.exec.start(system(), id)).toMatchObject({ ok: false, refusal: "blocked", reasons: ["step.workerMissing"] });
    expect(lonely.exec.assign(marta, id).ok).toBe(true);
  });
  it("lets a manager pause and resume a running plan", () => {
    const w = world();
    prepared(w);
    const id = advance(w, "ai.errors", "Running");
    expect(w.exec.pause(mario, id).refusal).toBe("forbidden");
    expect(w.exec.pause(marta, id)).toMatchObject({ ok: true, plan: { status: "Paused" } });
    expect(w.exec.report(system(), id, w.exec.planFor(ana, id)!.steps[0]!.id, "started").refusal).toBe("state"); // nothing is reported to a paused plan
    expect(w.exec.resume(mario, id).refusal).toBe("forbidden");
    expect(w.exec.resume(marta, id)).toMatchObject({ ok: true, plan: { status: "Running" } });
    expect(w.exec.planFor(ana, id)!.history.map((entry) => entry.to).slice(-3)).toEqual(["Running", "Paused", "Running"]);
  });
  it("lets a plan expire when nobody decides in time (but not while it is Running), and refuses to decide an expired one", () => {
    const w = world();
    prepared(w);
    const waiting = advance(w, "ai.errors", "WaitingApproval");
    const approved = advance(w, "crm.retention", "Approved");
    const running = advance(w, "crm.churn", "Running");
    const draft = planOf(w, "marketing.noLeads").id;
    w.clock.advance(DEFAULT_CONFIG.planTtlMs + 1);
    expect(w.exec.approve(ana, waiting)).toMatchObject({ ok: false, refusal: "state", reasons: ["Expired"] });
    const status = (id: string) => w.exec.planFor(ana, id)!.status;
    expect([status(waiting), status(approved), status(draft)]).toEqual(["Expired", "Expired", "Expired"]);
    expect(status(running)).toBe("Running");
    expect(w.exec.planFor(ana, waiting)!.history.at(-1)).toMatchObject({ to: "Expired", by: "system" });
    expect(w.exec.log.ofType("plan.expired").length).toBeGreaterThanOrEqual(3);
    expect(w.exec.sweep(ana).ok).toBe(true);
  });
  it("expires a paused plan too", () => {
    const w = world();
    prepared(w);
    const id = advance(w, "ai.errors", "Running");
    w.exec.pause(marta, id);
    w.clock.advance(DEFAULT_CONFIG.planTtlMs + 1);
    w.exec.sweep(ana);
    expect(w.exec.planFor(ana, id)!.status).toBe("Expired");
  });
});

describe("retries and failures", () => {
  it("retries a failing step as many times as its policy allows, then pauses the plan for a person", () => {
    const w = world();
    prepared(w);
    const id = advance(w, "ai.errors", "Running");
    const first = w.exec.planFor(ana, id)!.steps[0]!;
    expect(first.retry.maxAttempts).toBe(3);
    ok(w.exec.report(system(), id, first.id, "started"));
    expect(w.exec.report(system(), id, first.id, "failed")).toMatchObject({ ok: true });
    expect(w.exec.planFor(ana, id)!.steps[0]).toMatchObject({ state: "ready", attempts: 1 });
    ok(w.exec.report(system(), id, first.id, "started"));
    ok(w.exec.report(system(), id, first.id, "failed"));
    expect(w.exec.planFor(ana, id)!.steps[0]).toMatchObject({ state: "ready", attempts: 2 });
    ok(w.exec.report(system(), id, first.id, "started"));
    ok(w.exec.report(system(), id, first.id, "failed"));
    const plan = w.exec.planFor(ana, id)!;
    expect(plan).toMatchObject({ status: "Paused", blockedBy: first.id });
    expect(plan.steps[0]).toMatchObject({ state: "failed", attempts: 3 });
    expect(w.exec.log.ofType("step.retried")).toHaveLength(2);
    expect(w.exec.log.ofType("step.failed")).toHaveLength(1);
  });
  it("stops at once for a Level 3 step, which is never retried", () => {
    const w = world();
    prepared(w);
    const id = advance(w, "crm.churn", "Running");
    const [one, two] = w.exec.planFor(ana, id)!.steps as [ExecutionStep, ExecutionStep];
    ok(w.exec.report(system(), id, one.id, "started"));
    ok(w.exec.report(system(), id, one.id, "completed"));
    ok(w.exec.report(system(), id, two.id, "started"));
    ok(w.exec.report(system(), id, two.id, "failed"));
    expect(two.retry.maxAttempts).toBe(1);
    expect(w.exec.planFor(ana, id)).toMatchObject({ status: "Paused", blockedBy: two.id });
  });
  it("gives a failed step fresh attempts when a person resumes the plan", () => {
    const w = world();
    prepared(w);
    const id = advance(w, "crm.churn", "Running");
    const [one, two] = w.exec.planFor(ana, id)!.steps as [ExecutionStep, ExecutionStep];
    ok(w.exec.report(system(), id, one.id, "started"));
    ok(w.exec.report(system(), id, one.id, "completed"));
    ok(w.exec.report(system(), id, two.id, "started"));
    ok(w.exec.report(system(), id, two.id, "failed"));
    ok(w.exec.resume(marta, id));
    const plan = w.exec.planFor(ana, id)!;
    expect(plan.status).toBe("Running");
    expect(plan).not.toHaveProperty("blockedBy");
    expect(plan.steps[1]).toMatchObject({ state: "ready", attempts: 0 });
  });
  it("accepts a report only from the system, only for a running plan, and only in the order a step goes through", () => {
    const w = world();
    prepared(w);
    const id = advance(w, "crm.churn", "Running");
    const [one, two] = w.exec.planFor(ana, id)!.steps as [ExecutionStep, ExecutionStep];
    expect(w.exec.report(ana, id, one.id, "started").refusal).toBe("forbidden");
    expect(w.exec.report(marta, id, one.id, "started").refusal).toBe("forbidden");
    expect(w.exec.report(sales, id, one.id, "started").refusal).toBe("forbidden");
    expect(w.exec.report(system(), id, one.id, "completed").refusal).toBe("state"); // never started
    expect(w.exec.report(system(), id, two.id, "started").refusal).toBe("state"); // still waiting for its dependency
    expect(w.exec.report(system(), id, "zzz", "started").refusal).toBe("notFound");
    expect(w.exec.report(system(), "xp:nada", one.id, "started").refusal).toBe("notFound");
    ok(w.exec.report(system(), id, one.id, "started"));
    expect(w.exec.report(system(), id, one.id, "started").refusal).toBe("state");
    ok(w.exec.report(system(), id, one.id, "completed"));
    expect(w.exec.report(system(), id, one.id, "completed").refusal).toBe("state"); // a step completes once
    expect(w.exec.planFor(ana, id)!.steps[1]!.state).toBe("ready");
  });
});

describe("permissions: what a person cannot see does not exist in the plan", () => {
  it("lets any person who is not a viewer, an active worker or the system prepare, and nobody else", () => {
    const w = world();
    const output = outputOf(w, ana);
    expect(w.exec.prepare(vera, output)).toMatchObject({ ok: false, refusal: "forbidden" });
    expect(w.exec.prepare(ghost, output).refusal).toBe("workerInactive");
    expect(w.exec.prepare(sales, output).ok).toBe(true);
    expect(w.exec.prepare(system(), output)).toMatchObject({ ok: true, unchanged: expect.any(Number) });
    expect(w.exec.prepare(mario, output).ok).toBe(true);
  });
  it("builds a member's plans without the money: the finance recommendations and their actions are dropped, counted, and nowhere in the plan", () => {
    const w = world();
    const owner = outputOf(w, ana);
    expect(owner.recommendations.some((rec) => rec.needs === "finance")).toBe(true);
    const result = w.exec.prepare(mario, owner);
    ok(result);
    expect(result.dropped!.hidden).toBeGreaterThan(0);
    expect(result.plans!.some((plan) => plan.needs === "finance")).toBe(false);
    expect(JSON.stringify(result.plans)).not.toMatch(/finance\.roi|finance\.costExceeds/);
    expect(w.exec.plansFor(mario).every((plan) => plan.needs === "general")).toBe(true);
    const full = world();
    ok(full.exec.prepare(ana, owner));
    expect(full.exec.plansFor(ana).some((plan) => plan.needs === "finance")).toBe(true);
    expect(full.exec.plansFor(mario).some((plan) => plan.needs === "finance")).toBe(false);
    expect(full.exec.planFor(mario, "xp:finance.roiNegative")).toBeUndefined();
    expect(full.exec.approve(adela, "xp:finance.roiNegative").refusal).not.toBe("notFound");
    expect(full.exec.submit(mario, "xp:finance.roiNegative").refusal).toBe("notFound");
  });
  it("shows a viewer nothing, and a worker the plans of operations but not the money", () => {
    const w = world();
    prepared(w);
    expect(w.exec.plansFor(vera)).toEqual([]);
    expect(w.exec.plansFor(sales).every((plan) => plan.needs === "general")).toBe(true);
    expect(w.exec.plansFor(sales).length).toBeGreaterThan(0);
    expect(w.exec.plansFor(system()).length).toBe(w.exec.plansFor(ana).length);
    expect(w.exec.dashboard(vera)!.plans.total).toBe(0);
  });
  it("only plans actions that wait for a person (or were approved in the Copilot): rejected, expired and unknown actions are dropped", () => {
    const w = world();
    const output = outputOf(w, ana);
    const [a, b, c, d] = output.actions as [CopilotOutput["actions"][number], ...CopilotOutput["actions"][number][]];
    const tampered: CopilotOutput = { recommendations: output.recommendations, actions: output.actions.map((action) => (action === a ? { ...action, status: "rejected" as const } : action === b ? { ...action, status: "expired" as const } : action === c ? { ...action, actionId: "mágica.total" } : action)) };
    const result = w.exec.prepare(ana, tampered);
    expect(result.dropped).toMatchObject({ notSuggested: 2, unknownAction: 1, crossTenant: 0 });
    expect(JSON.stringify(result.plans)).not.toContain(a.id);
    expect(JSON.stringify(result.plans)).not.toContain("mágica.total");
    expect(d).toBeDefined();
  });
  it("carries over who already approved an action in the Copilot, as evidence only", () => {
    const w = world();
    const output = outputOf(w, ana);
    const one = output.actions.find((action) => action.level === 1 && action.recommendationId === "rec:ai.errors")!;
    const approved = { ...one, status: "approved" as const, decidedBy: "mario" };
    ok(w.exec.prepare(ana, { ...output, actions: output.actions.map((action) => (action === one ? approved : action)) }));
    const row = planOf(w, "ai.errors").steps.find((entry) => entry.sourceActionId === one.id)!;
    expect(row.approvedInCopilot).toBe("mario");
    expect(planOf(w, "ai.errors").status).toBe("Draft"); // that does not approve the PLAN
  });
  it("does not trust the level an action claims: it uses the platform's catalog", () => {
    const w = world();
    const output = outputOf(w, ana);
    const lying = { ...output, actions: output.actions.map((action) => (action.actionId === "followup.send" ? { ...action, level: 1 as const, approverRole: "member" as const } : action)) };
    ok(w.exec.prepare(ana, lying));
    expect(planOf(w, "crm.churn").steps.find((row) => row.action === "followup.send")).toMatchObject({ authorizationLevel: 3, approverRole: "admin" });
    expect(planOf(w, "crm.churn").requiredRole).toBe("admin");
  });
});

describe("every company is its own world", () => {
  it("drops another company's actions, creates nothing for them, and never shares plans", () => {
    const w = world();
    const novaOutput = outputOf(w, ana);
    const result = w.exec.prepare(luis, novaOutput);
    ok(result);
    expect(result.plans).toEqual([]);
    expect(result.dropped!.crossTenant).toBe(novaOutput.actions.length);
    expect(w.exec.plansFor(luis)).toEqual([]);
    ok(w.exec.prepare(ana, novaOutput));
    expect(w.exec.plansFor(luis)).toEqual([]);
    expect(w.exec.plansFor(ana).every((plan) => plan.tenantId === T1)).toBe(true);
  });
  it("keeps plans with the same id apart, and refuses to touch another company's plan", () => {
    const w = world();
    const output = outputOf(w, ana);
    ok(w.exec.prepare(ana, output));
    const theirs = output.actions.map((action) => ({ ...action, tenantId: T2 }));
    ok(w.exec.prepare(luis, { recommendations: output.recommendations, actions: theirs }));
    expect(w.exec.state.plans.filter((plan) => plan.id === "xp:crm.churn").map((plan) => plan.tenantId).sort()).toEqual([T1, T2]);
    const id = "xp:crm.churn";
    expect(w.exec.submit(luis, id).ok).toBe(true); // his own plan of that id
    expect(w.exec.state.plans.find((plan) => plan.id === id && plan.tenantId === T2)!.status).toBe("WaitingApproval");
    expect(w.exec.state.plans.find((plan) => plan.id === id && plan.tenantId === T1)!.status).toBe("Draft");
    expect(w.exec.state.plans.find((plan) => plan.id === "xp:ai.errors" && plan.tenantId === T1)!.steps.every((row) => row.worker.workerId === undefined || ROSTER.workers.some((worker) => worker.id === row.worker.workerId))).toBe(true);
  });
  it("assigns workers from the company's own roster only", () => {
    const w = world();
    const output = outputOf(w, ana);
    ok(w.exec.prepare(ana, output));
    ok(w.exec.prepare(luis, { recommendations: output.recommendations, actions: output.actions.map((action) => ({ ...action, tenantId: T2 })) }));
    const workersOf = (tenant: string) => new Set(w.exec.state.plans.filter((plan) => plan.tenantId === tenant).flatMap((plan) => plan.steps.flatMap((row) => (row.worker.workerId ? [row.worker.workerId] : []))));
    expect([...workersOf(T1)].every((id) => ROSTER.workers.some((worker) => worker.id === id))).toBe(true);
    expect([...workersOf(T2)].every((id) => id === "v-ops")).toBe(true);
    expect(workersOf(T1).has("v-ops")).toBe(false);
  });
  it("refuses a claimed company that is not the actor's, and a bad time", () => {
    const w = world();
    prepared(w);
    const at = new Date(START).toISOString();
    const sources = { env, roster: ROSTER, connected: [] as never[], grants: [] as string[] };
    expect(reduceExecution(w.exec.state, { type: "submit", tenantId: T1, actor: luis, at, planId: "xp:ai.errors" }, sources).result.refusal).toBe("tenant");
    expect(reduceExecution(w.exec.state, { type: "sweep", tenantId: T1, actor: ana, at: "ayer" }, sources).result).toMatchObject({ ok: false, refusal: "invalid", reasons: ["at"] });
  });
  it("keeps the dashboard, the schedule, the numbers and the audit trail of each company apart", () => {
    const w = world();
    const output = outputOf(w, ana);
    ok(w.exec.prepare(ana, output));
    ok(w.exec.prepare(luis, { recommendations: output.recommendations, actions: output.actions.map((action) => ({ ...action, tenantId: T2 })) }));
    w.exec.submit(luis, "xp:ai.errors");
    const mine = w.exec.dashboard(ana)!;
    const theirs = w.exec.dashboard(luis)!;
    expect(mine.tenantId).toBe(T1);
    expect(theirs.tenantId).toBe(T2);
    expect(mine.plans.total).toBe(w.exec.state.plans.filter((plan) => plan.tenantId === T1).length);
    expect(theirs.workers.available).toBe(1);
    expect(w.exec.schedule(luis)!.queue.every((id) => w.exec.state.plans.some((plan) => plan.id === id && plan.tenantId === T2))).toBe(true);
    expect(w.exec.snapshot(T1).counters.prepared).toBe(mine.plans.total);
    expect(w.exec.snapshot(T2).counters.submitted).toBe(1);
    expect(w.exec.state.audit.filter((entry) => entry.tenantId === T1).every((entry) => entry.actor !== "luis")).toBe(true);
    expect(w.exec.log.forTenant(T2).every((event) => event.tenantId === T2)).toBe(true);
  });
  it("never counts another company's plan in a dashboard, even if one is handed in by mistake", () => {
    const own = shell([step({ id: "a" })], { id: "xp:own" });
    const foreign = shell([step({ id: "b" })], { id: "xp:foreign", tenantId: T2 });
    expect(buildExecutionDashboard({ tenantId: T1, at: new Date(START).toISOString(), plans: [own, foreign], roster: ROSTER }).plans.total).toBe(1);
  });
});

describe("the data for a future dashboard", () => {
  it("counts plans by state and priority: active, pending, completed, cancelled, expired", () => {
    const w = world();
    prepared(w);
    advance(w, "ai.errors", "WaitingApproval");
    const approved = advance(w, "crm.retention", "Approved");
    const doneId = advance(w, "crm.churn", "Running");
    w.exec.cancel(marta, approved);
    for (const row of w.exec.planFor(ana, doneId)!.steps) { ok(w.exec.report(system(), doneId, row.id, "started")); ok(w.exec.report(system(), doneId, row.id, "completed")); }
    w.exec.cancel(marta, planOf(w, "marketing.noLeads").id);
    const data = w.exec.dashboard(ana)!;
    expect(data.byStatus.Completed).toBe(1);
    expect(data.byStatus.Cancelled).toBe(2);
    expect(data.byStatus.WaitingApproval).toBe(1);
    expect(data.plans).toMatchObject({ completed: 1, cancelled: 2, pending: data.byStatus.Draft + 1, active: 0, rejected: 0, expired: 0 });
    expect(data.plans.total).toBe(Object.values(data.byStatus).reduce((a, b) => a + b, 0));
    expect(Object.keys(data.byStatus).sort()).toEqual([...PLAN_STATUSES].sort());
    expect(Object.values(data.byPriority).reduce((a, b) => a + b, 0)).toBe(data.plans.total);
    expect(Object.keys(data.byPriority).sort()).toEqual([...PRIORITIES].sort());
    w.clock.advance(DEFAULT_CONFIG.planTtlMs + 1);
    w.exec.sweep(ana);
    expect(w.exec.dashboard(ana)!.plans.expired).toBeGreaterThan(0);
  });
  it("reports the workers required and available, the utilization and the load of each worker", () => {
    const w = world();
    prepared(w);
    const data = w.exec.dashboard(ana)!;
    expect(data.workers.available).toBe(5);
    expect(data.workers.availableBySpecialty).toEqual({ sales: 2, support: 1, finance: 1, operations: 1 });
    expect(data.workers.requiredBySpecialty["sales"]).toBeGreaterThan(0);
    expect(data.workers.required).toBe(data.workers.load.length);
    expect(data.workers.utilizationPercent).toBe(Math.round((data.workers.required / 5) * 100));
    expect(data.workers.load.map((row) => row.estimatedMs)).toEqual([...data.workers.load.map((row) => row.estimatedMs)].sort((a, b) => b - a));
    expect(data.workers.load.every((row) => ROSTER.workers.some((worker) => worker.id === row.workerId && worker.status === "active"))).toBe(true);
    const none = world({ roster: { [T1]: { workers: [] }, [T2]: ROSTER_T2 } });
    prepared(none);
    const empty = none.exec.dashboard(ana)!;
    expect(empty.workers).toMatchObject({ available: 0, utilizationPercent: null, required: 0 });
    expect(empty.workers.unassignedSteps).toBeGreaterThan(0);
  });
  it("reports the average time and the AI and API costs of what is open and what is completed", () => {
    const w = world();
    prepared(w);
    const open = w.exec.dashboard(ana)!;
    const plans = w.exec.plansFor(ana);
    expect(open.cost.open).toEqual({ aiMicros: plans.reduce((t, p) => t + p.cost.aiMicros, 0), apiMicros: plans.reduce((t, p) => t + p.cost.apiMicros, 0) });
    expect(open.cost.completed).toEqual({ aiMicros: 0, apiMicros: 0 });
    expect(open.time.avgPlannedMs).toBe(Math.round(plans.reduce((t, p) => t + p.estimatedMs, 0) / plans.length));
    expect(open.time.avgCompletedMs).toBeNull();
    const id = advance(w, "ai.errors", "Running");
    w.clock.advance(90_000);
    for (const row of w.exec.planFor(ana, id)!.steps) { ok(w.exec.report(system(), id, row.id, "started")); ok(w.exec.report(system(), id, row.id, "completed")); }
    const after = w.exec.dashboard(ana)!;
    expect(after.time.avgCompletedMs).toBeGreaterThanOrEqual(90_000);
    expect(after.cost.completed.aiMicros).toBe(w.exec.planFor(ana, id)!.cost.aiMicros);
  });
  it("finds the bottlenecks: an overloaded worker, a step many wait for, a slow approval, a blocked plan and steps nobody can do", () => {
    const hot = shell([step({ id: "a", worker: { specialty: "ops", workerId: "w1" }, estimatedMs: 100 }), step({ id: "b", worker: { specialty: "ops", workerId: "w1" }, estimatedMs: 100, dependsOn: ["a"] }), step({ id: "c", worker: { specialty: "ops", workerId: "w1" }, estimatedMs: 100, dependsOn: ["a"] }), step({ id: "d", worker: { specialty: "legal" } })], { id: "xp:hot", status: "Running" });
    const slow = shell([step({ id: "z" })], { id: "xp:slow", status: "WaitingApproval", history: [{ at: new Date(START - 2 * DAY).toISOString(), from: "Draft", to: "WaitingApproval", by: "ana" }] });
    const blocked = shell([step({ id: "y", state: "failed" })], { id: "xp:blocked", status: "Paused", blockedBy: "y" });
    const data = buildExecutionDashboard({ tenantId: T1, at: new Date(START).toISOString(), plans: [hot, slow, blocked], roster: ROSTER });
    const kinds = data.bottlenecks.map((row) => `${row.kind}:${row.id}`);
    expect(kinds).toEqual(expect.arrayContaining(["worker:w1", "dependency:a", "approval:xp:slow", "blocked:xp:blocked", "unassigned:legal"]));
    expect(data.bottlenecks[0]).toMatchObject({ kind: "blocked", score: 100 });
    expect(data.bottlenecks.map((row) => row.score)).toEqual([...data.bottlenecks.map((row) => row.score)].sort((a, b) => b - a));
    expect(data.dependencies.blockedPlans).toEqual(["xp:blocked"]);
  });
  it("lists the dependencies between plans and between steps", () => {
    const w = world();
    prepared(w);
    const data = w.exec.dashboard(ana)!;
    expect(data.dependencies.plans).toEqual(expect.arrayContaining([{ planId: "xp:ai.dependency", dependsOn: ["xp:ai.errors"] }, { planId: "xp:crm.retention", dependsOn: ["xp:support.unservedCustomers"] }]));
    expect(data.dependencies.stepEdges).toBe(w.exec.plansFor(ana).flatMap((plan) => plan.steps).reduce((total, row) => total + row.dependsOn.length, 0));
    expect(w.exec.dashboard(ana)).toEqual(w.exec.dashboard(ana));
  });
  it("shows the data of an empty company without failing", () => {
    const w = world();
    const data = w.exec.dashboard(ana)!;
    expect(data.plans.total).toBe(0);
    expect(data.bottlenecks).toEqual([]);
    expect(data.time).toEqual({ avgPlannedMs: null, avgCompletedMs: null });
    expect(w.exec.schedule(ana)).toEqual({ queue: [], items: [], totalMs: 0 });
    expect(w.exec.dashboard(ghost)).toBeUndefined();
    expect(w.exec.schedule(ghost)).toBeUndefined();
  });
  it("schedules the plans still to run from the engine, critical first", () => {
    const w = world();
    prepared(w);
    const schedule = w.exec.schedule(ana)!;
    expect(schedule.queue.length).toBe(w.exec.plansFor(ana).length);
    const priorities = schedule.queue.map((id) => w.exec.planFor(ana, id)!.priority);
    const order = ["critical", "high", "normal", "low"];
    expect(priorities.map((p) => order.indexOf(p))).toEqual([...priorities.map((p) => order.indexOf(p))].sort((a, b) => a - b));
    expect(schedule.totalMs).toBeGreaterThan(0);
    for (const item of schedule.items) expect(item.endMs).toBeGreaterThan(item.startMs);
  });
});

describe("idempotence", () => {
  it("prepares the same recommendations again without duplicating or changing a plan", () => {
    const w = world();
    const output = outputOf(w, ana);
    const first = prepared(w, ana, output);
    const before = JSON.stringify(w.exec.state.plans);
    const second = w.exec.prepare(ana, output);
    expect(second).toMatchObject({ ok: true, plans: [], unchanged: first.plans!.length });
    expect(JSON.stringify(w.exec.state.plans)).toBe(before);
    expect(w.exec.plansFor(ana)).toHaveLength(first.plans!.length);
    expect(new Set(w.exec.state.plans.map((plan) => `${plan.tenantId}|${plan.id}`)).size).toBe(w.exec.state.plans.length);
  });
  it("leaves a plan in progress alone when its recommendation comes back, and makes a new revision when the old plan ended", () => {
    const w = world();
    const output = outputOf(w, ana);
    prepared(w, ana, output);
    const id = advance(w, "ai.errors", "WaitingApproval");
    ok(w.exec.prepare(ana, output));
    expect(w.exec.planFor(ana, id)!.status).toBe("WaitingApproval");
    ok(w.exec.reject(ana, id));
    const again = w.exec.prepare(ana, output);
    expect(again.plans!.map((plan) => plan.id)).toEqual(["xp:ai.errors#2"]);
    expect(w.exec.planFor(ana, "xp:ai.errors")!.status).toBe("Rejected");
    expect(w.exec.planFor(ana, "xp:ai.errors#2")).toMatchObject({ status: "Draft", revision: 2 });
    ok(w.exec.prepare(ana, output));
    expect(w.exec.plansFor(ana).filter((plan) => plan.findingId === "ai.errors")).toHaveLength(2);
  });
  it("keeps a bounded number of plans per company, finished ones going first", () => {
    const w = world({ config: { maxPlans: 14 } });
    const output = outputOf(w, ana);
    ok(w.exec.prepare(ana, output));
    const count = w.exec.plansFor(ana).length;
    expect(count).toBeLessThanOrEqual(14);
    const small = world({ config: { maxPlans: 3 } });
    expect(small.exec.prepare(ana, output)).toMatchObject({ ok: false, refusal: "invalid", reasons: ["maxPlans"] });
  });
});

describe("observability: ids and numbers, never content", () => {
  it("counts plans prepared, validated, assigned, submitted, approved, started, completed, cancelled, retries, rollbacks, costs, latency and refusals, per company", () => {
    const w = world();
    w.clock.step = 5;
    prepared(w);
    const id = advance(w, "ai.errors", "Running");
    const [one] = w.exec.planFor(ana, id)!.steps as [ExecutionStep, ExecutionStep];
    ok(w.exec.report(system(), id, one.id, "started"));
    ok(w.exec.report(system(), id, one.id, "failed"));
    w.exec.cancel(marta, id);
    w.exec.approve(vera, id);
    w.exec.assign(marta, planOf(w, "crm.churn").id);
    w.exec.dashboard(ana);
    w.exec.schedule(ana);
    const snap = w.exec.snapshot(T1);
    const total = w.exec.plansFor(ana).length;
    expect(snap.counters).toMatchObject({ prepared: total, validated: total, submitted: 1, approved: 1, started: 1, cancelled: 1, retries: 1, stepsReported: 2, assigned: 1, dashboards: 1, scheduled: 1, refused: 1 });
    expect(snap.planned.aiMicros).toBe(w.exec.plansFor(ana).reduce((t, p) => t + p.cost.aiMicros, 0));
    expect(snap.planned.apiMicros).toBe(w.exec.plansFor(ana).reduce((t, p) => t + p.cost.apiMicros, 0));
    expect(snap.latency).toMatchObject({ count: 1, avgMs: 5 });
    expect(snap.byPriority["critical"]).toBeGreaterThan(0);
    expect(snap.byLevel["level3"]).toBeGreaterThan(0);
    expect(snap.refusals).toEqual({ notFound: 1 });
    expect(snap.plans!.total).toBe(total);
    expect(snap.plans!.byStatus["Cancelled"]).toBe(1);
    expect(w.exec.snapshot(T2).counters).toMatchObject({ prepared: 0, refused: 0 });
  });
  it("never records a prompt, an answer, a context, an address, a token, a secret or any content", () => {
    const w = world();
    w.clock.step = 3;
    prepared(w);
    advance(w, "ai.errors", "Approved");
    w.exec.dashboard(ana);
    const dump = JSON.stringify([w.exec.log.all(), w.exec.state.audit]);
    for (const word of ["Frenar la pérdida", "clientes", "Probar los workers", "Crear tareas", "@", "token", "secret", "password", "Bearer", "prompt"]) expect(dump.toLowerCase(), word).not.toContain(word.toLowerCase());
    for (const event of w.exec.log.all()) for (const value of Object.values(event.detail ?? {})) expect(["number", "boolean", "string"]).toContain(typeof value);
    expect(w.exec.log.all().every((event) => !event.planId || /^[A-Za-z0-9_.:#-]+$/.test(event.planId))).toBe(true);
  });
  it("sanitizes free text out of an event, and gives the trail in the platform's audit shape", () => {
    const w = world();
    w.exec.log.emit({ at: new Date(START).toISOString(), tenantId: T1, actorKind: "person", actorId: "ana", type: "execution.refused", planId: "xp:a b c correo@x.test", detail: { reason: "ok", note: "escribe a ana@acme.test o llama al +52 81 1234 5678", token: "abc def", count: 3 } });
    const event = w.exec.log.all()[0]!;
    expect(event).not.toHaveProperty("planId");
    expect(event.detail).toEqual({ reason: "ok", count: 3 });
    prepared(w);
    expect(w.exec.log.toAudit(T1)[1]).toMatchObject({ actor: "ana", tenantId: T1, action: "plan.prepared", detail: { priority: expect.any(String) } });
    expect(w.exec.log.all().map((e) => e.id).slice(0, 2)).toEqual(["xe_000001", "xe_000002"]);
  });
  it("lets other parts listen to the events", () => {
    const w = world();
    const seen: string[] = [];
    const stop = w.exec.log.listen((event) => seen.push(event.type));
    prepared(w);
    stop();
    expect(seen.slice(0, 2)).toEqual(["plan.prepared", "plan.validated"]);
    const count = seen.length;
    w.exec.sweep(ana);
    expect(seen).toHaveLength(count);
  });
});

describe("determinism, and nothing is run", () => {
  function script(w: World) {
    prepared(w);
    const a = advance(w, "ai.errors", "Running");
    for (const row of w.exec.planFor(ana, a)!.steps) { w.exec.report(system(), a, row.id, "started"); w.exec.report(system(), a, row.id, "completed"); }
    advance(w, "ai.dependency", "Approved");
    w.exec.start(system(), "xp:ai.dependency");
    const c = advance(w, "crm.churn", "WaitingApproval");
    w.exec.reject(adela, c);
    w.exec.cancel(marta, planOf(w, "marketing.noLeads").id);
    w.exec.assign(marta, planOf(w, "support.unservedCustomers").id);
    w.clock.advance(DEFAULT_CONFIG.planTtlMs + 1);
    w.exec.sweep(ana);
    w.exec.dashboard(ana);
    w.exec.schedule(ana);
  }
  it("gives the same plans, log and numbers for the same events", () => {
    const a = world();
    const b = world();
    a.clock.step = 3;
    b.clock.step = 3;
    script(a);
    script(b);
    expect(b.exec.state).toEqual(a.exec.state);
    expect(b.exec.log.all()).toEqual(a.exec.log.all());
    expect(b.exec.snapshot(T1)).toEqual(a.exec.snapshot(T1));
    expect(b.exec.dashboard(ana)).toEqual(a.exec.dashboard(ana));
    expect(b.exec.schedule(ana)).toEqual(a.exec.schedule(ana));
  });
  it("is a pure reducer: it never changes the state or the Copilot output it is given", () => {
    const deepFreeze = <T,>(value: T): T => { if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
    const w = world();
    script(w);
    const frozen = structuredClone(w.exec.state);
    deepFreeze(w.exec.state);
    const output = deepFreeze(outputOf(w, ana));
    const at = new Date(START + 99 * DAY).toISOString();
    const sources = { env, roster: deepFreeze(structuredClone(ROSTER)), connected: ["gmail"] as never[], grants: [] as string[] };
    const events: ExecutionEvent[] = [
      { type: "prepare", tenantId: T1, actor: ana, at, ...output }, { type: "submit", tenantId: T1, actor: mario, at, planId: "xp:sales.funnelDrop" }, { type: "sweep", tenantId: T1, actor: ana, at },
      { type: "cancel", tenantId: T1, actor: marta, at, planId: "xp:sales.funnelDrop" }, { type: "assign", tenantId: T1, actor: marta, at, planId: "xp:sales.funnelDrop" },
    ];
    for (const event of events) {
      const first = reduceExecution(w.exec.state, event, sources);
      expect(reduceExecution(w.exec.state, event, sources)).toEqual(first);
    }
    expect(w.exec.state).toEqual(frozen);
    expect(newExecutionState()).toEqual({ plans: [], seq: {}, audit: [] });
  });
  it("executes nothing: no step ever runs by itself, and the states a runtime would report only change because the system says so", () => {
    const w = world();
    prepared(w);
    advance(w, "ai.errors", "Approved");
    w.clock.advance(HOUR);
    w.exec.sweep(ana);
    w.exec.dashboard(ana);
    w.exec.schedule(ana);
    expect(w.exec.state.plans.every((plan) => plan.steps.every((row) => row.state === "pending" && row.attempts === 0))).toBe(true);
    expect(w.exec.state.plans.filter((plan) => plan.status === "Running" || plan.status === "Completed")).toEqual([]);
    for (const actor of [ana, adela, marta, mario, vera, sales]) expect(w.exec.start(actor, "xp:ai.errors").ok).toBe(false);
    expect(w.exec.state.plans.every((plan) => plan.status !== "Running")).toBe(true);
  });
  it("reads the Copilot's output from a Copilot that executes nothing either: its actions stay unexecuted", () => {
    const w = world();
    const output = outputOf(w, ana);
    ok(w.exec.prepare(ana, output));
    expect(output.actions.every((action) => action.executed === false && action.requiresApproval === true)).toBe(true);
  });
});

describe("the layer is new, read only and runs nothing", () => {
  const folder = join(process.cwd(), "lib/nex/execution");
  const files = ["planner.ts", "execution-engine.ts", "execution-reducer.ts", "execution-types.ts", "execution-actions.ts", "execution-policy.ts", "execution-runtime.ts", "execution-dashboard.ts", "execution-events.ts", "index.ts"];
  const code = (name: string) => readFileSync(join(folder, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("has the ten files of the layer and no screen", () => {
    for (const name of files) expect(existsSync(join(folder, name)), name).toBe(true);
    expect(readdirSync(folder).filter((name) => !name.endsWith(".test.ts")).sort()).toEqual([...files].sort());
    expect(existsSync(join(process.cwd(), "app/(app)/nex/execution"))).toBe(false);
  });
  it("reads no clock, no randomness, no network, no environment, no database and uses no AI", () => {
    for (const name of files) {
      const source = code(name);
      expect(source, name).not.toMatch(/Date\.now\(|Math\.random\(|new Date\(\)|setTimeout|setInterval|\bfetch\(|process\.env|XMLHttpRequest|WebSocket|node:https?|localStorage|indexedDB|createClient|supabase/);
      expect(source, name).not.toMatch(/\.subscribe\(/);
      expect(source, name).not.toMatch(/\b(openai|anthropic|claude|gemini|workers-ai)\b/i);
    }
  });
  it("imports only itself, the Copilot and, read only, the platform's action catalog and connector vocabulary", () => {
    const allowed = ["@/lib/nex/copilot", "@/lib/contracts/platform/workers", "@/lib/contracts/platform/connectors"];
    for (const name of files) {
      const imports = [...code(name).matchAll(/from "([^"]+)"/g)].map((row) => row[1]!);
      expect(imports.every((path) => path.startsWith("./") || allowed.includes(path)), `${name}: ${imports.join(", ")}`).toBe(true);
    }
  });
  it("never calls the Runtime, a Worker, a Connector, KOE or any other layer: no executor, no adapter, no writer, no reducer of the others", () => {
    for (const name of files) {
      const source = code(name);
      expect(source, name).not.toMatch(/ADAPTERS|adapter\.|\.execute\(|executeAction|runAction|runStep|dispatchWorker|callWorker|callConnector|reduceKoe|reduceConnectors|reduceMemory|reduceKnowledge|reduceCopilot|reduceRag|\.ask\(|\.remember\(|\.upsertNode\(/);
    }
  });
  it("is used by nothing else in the repository yet, and changes nothing outside its folder", () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", ".next", ".git", ".open-next"].includes(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name) && !path.includes(join("lib", "nex", "execution")) && !path.includes(join("lib", "nex", "runtime-orchestrator")) && /lib\/nex\/execution/.test(readFileSync(path, "utf8"))) importers.push(path);
      }
    };
    for (const dir of ["app", "lib", "components"]) walk(join(process.cwd(), dir));
    expect(importers).toEqual([]);
  });
});
