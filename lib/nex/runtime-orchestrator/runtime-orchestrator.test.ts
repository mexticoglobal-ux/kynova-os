/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExecutionPlan, ExecutionStep } from "@/lib/nex/execution";
import {
  DEFAULT_CONFIG, ITEM_STATES, ITEM_TRANSITIONS, OrchestratorEngine, OrchestratorEventLog, OrchestratorObservability, assignWorker, backoffFor, buildOrchestratorDashboard, canMove, cancelExecution, criticalPathMs,
  detectBlockages, dispatchList, eligibility, finishExecution, graphIsAcyclic, itemGraph, itemsOfPlan, loadOf, newRuntimeState, pauseExecution, permits, planDependencyCycle, prepareExecution, queueOrder, reduceRuntime,
  resumeExecution, retryDecision, startExecution, topologicalOrder, waitingFor, type OrchestratorConfig, type OrchestratorWorker, type Principal, type QueueItem, type RuntimeEvent, type RuntimeSources, type RuntimeState,
} from "./index";

const T1 = "tenant-nova";
const T2 = "tenant-vida";
const START = Date.parse("2026-11-12T10:00:00.000Z");
const MIN = 60_000;
const HOUR = 3_600_000;
const person = (tenantId: string, id: string, role: "viewer" | "member" | "manager" | "admin" | "owner"): Principal => ({ kind: "person", tenantId, id, role });
const ana = person(T1, "ana", "owner");
const marta = person(T1, "marta", "manager");
const mario = person(T1, "mario", "member");
const vera = person(T1, "vera", "viewer");
const luis = person(T2, "luis", "owner");
const system = (tenantId = T1): Principal => ({ kind: "system", tenantId });
const ROLES: Record<string, "viewer" | "member" | "manager" | "admin" | "owner"> = { ana: "owner", adela: "admin", marta: "manager", mario: "member", vera: "viewer", luis: "owner" };

const worker = (id: string, over: Partial<OrchestratorWorker> = {}): OrchestratorWorker => ({ id, tenantId: T1, name: id, specialty: "sales", status: "active", capacity: 1, permissions: ["*"], ...over });
const WORKERS: OrchestratorWorker[] = [
  worker("w1", { permissions: ["task.create", "lead.score"] }), worker("w2", { capacity: 2 }), worker("w-paused", { status: "paused" }), worker("w-ops", { specialty: "operations" }),
  worker("v1", { tenantId: T2, capacity: 5 }),
];

// ---------------------------------------------------------------------------------------------- plans built by hand (plain data)
const step = (id: string, over: Partial<ExecutionStep> = {}): ExecutionStep => ({
  id, order: 1, title: "SECRETO-TITULO", action: "task.create", module: "sales", worker: { specialty: "sales" }, authorizationLevel: 1, approverRole: "member", timeoutMs: 60_000, retry: { maxAttempts: 1, backoffMs: 1_000 },
  rollbackPolicy: "none", state: "pending", attempts: 0, dependsOn: [], costAiMicros: 0, costApiMicros: 0, estimatedMs: 10_000, sourceActionId: `s-${id}`, ...over,
} as ExecutionStep);
const plan = (id: string, steps: ExecutionStep[], over: Partial<ExecutionPlan> = {}): ExecutionPlan => ({
  id, tenantId: T1, revision: 1, recommendationId: "r1", findingId: "f1", objective: "SECRETO-OBJETIVO", priority: "normal", severity: "medium", expectedImpact: { level: "medium", score: 50 }, risk: { level: "low", note: "" },
  expectedBenefit: "", modules: ["sales"], workers: [], connectors: [], authorizations: [], dependsOn: [], steps, rollback: { policy: "reverse-order", steps: [], requested: false, requestedSteps: [] }, cost: { aiMicros: 0, apiMicros: 0 },
  estimatedMs: 0, status: "Approved", needs: "general", requiredRole: "member", createdAt: "2026-11-12T09:00:00.000Z", expiresAt: "2026-11-19T10:00:00.000Z", createdBy: "ana", decidedBy: "adela", decidedAt: "2026-11-12T09:30:00.000Z", history: [], ...over,
} as ExecutionPlan);
/** a → b → c */
const chain = (id = "p", over: Partial<ExecutionPlan> = {}) => plan(id, [step(`${id}-a`), step(`${id}-b`, { dependsOn: [`${id}-a`] }), step(`${id}-c`, { dependsOn: [`${id}-b`] })], over);
const retrying = (id: string, maxAttempts = 3) => plan(id, [step(`${id}-a`, { retry: { maxAttempts, backoffMs: 1_000 } }), step(`${id}-b`, { dependsOn: [`${id}-a`] })]);

function world(options: { workers?: OrchestratorWorker[]; config?: Partial<OrchestratorConfig> } = {}) {
  const clock = { t: START, advance(ms: number) { this.t += ms; } };
  const active = new Set(["w1", "w2", "w-ops", "v1"]);
  const roster = options.workers ?? WORKERS;
  const engine = new OrchestratorEngine({
    env: { isWorkerActive: (_tenantId, workerId) => active.has(workerId) }, now: () => clock.t, workers: () => roster, roleOf: (_tenantId, personId) => ROLES[personId], ...(options.config ? { config: options.config } : {}),
  });
  return { clock, engine, active };
}
type World = ReturnType<typeof world>;
const ok = (result: { ok: boolean; refusal?: string; reasons?: readonly string[] }, label = "") => expect(result.ok, `${label} ${result.refusal} ${result.reasons}`).toBe(true);
const stateOf = (w: World, id: string) => w.engine.queueFor(ana).find((item) => item.id === id)?.state;
const item = (w: World, id: string) => w.engine.queueFor(ana).find((row) => row.id === id)!;
const tick = (w: World, autoStart?: boolean) => { const result = w.engine.tick(system(), T1, autoStart); ok(result, "tick"); return result; };
const enqueue = (w: World, p: ExecutionPlan, actor: Principal = marta) => { const result = w.engine.enqueue(actor, T1, p); ok(result, "enqueue"); return result; };
/** start and finish an item as the system would report it */
const runItem = (w: World, id: string, outcome: "completed" | "failed" = "completed", ms = 5_000) => {
  ok(w.engine.start(system(), T1, id), `start ${id}`);
  w.clock.advance(ms);
  ok(w.engine.finish(system(), T1, id, outcome), `finish ${id}`);
};

describe("Execution Queue: states and transitions", () => {
  it("has exactly the eleven states", () => {
    expect([...ITEM_STATES]).toEqual(["Pending", "Assigned", "WaitingDependencies", "WaitingApproval", "Ready", "Running", "Paused", "Completed", "Failed", "Cancelled", "Expired"]);
  });
  it("finished states lead nowhere, and a closed table says what can move", () => {
    for (const state of ["Completed", "Failed", "Cancelled", "Expired"] as const) expect(ITEM_TRANSITIONS[state]).toEqual([]);
    expect(canMove("Assigned", "Running")).toBe(true);
    expect(canMove("Ready", "Running")).toBe(false); // never without a worker
    expect(canMove("WaitingApproval", "Running")).toBe(false); // never without authorization
    expect(canMove("WaitingDependencies", "Running")).toBe(false); // never before its dependencies
    expect(canMove("Running", "Completed")).toBe(true);
    expect(canMove("Completed", "Pending")).toBe(false);
  });
  it("enqueuing leaves every step in the state its facts say", () => {
    const w = world();
    enqueue(w, plan("p", [step("p-a"), step("p-b", { dependsOn: ["p-a"] }), step("p-c", { authorizationLevel: 3, approverRole: "admin", action: "followup.send" })], { decidedBy: "mario" }));
    expect(stateOf(w, "p-a")).toBe("Ready"); // authorized, nothing to wait for, no worker yet
    expect(stateOf(w, "p-b")).toBe("WaitingDependencies");
    expect(stateOf(w, "p-c")).toBe("WaitingApproval"); // a member cannot authorize a Level 3 action
  });
  it("a step only starts as Assigned, then Running, then Completed", () => {
    const w = world();
    enqueue(w, chain());
    tick(w);
    expect(stateOf(w, "p-a")).toBe("Assigned");
    ok(w.engine.start(system(), T1, "p-a"));
    expect(stateOf(w, "p-a")).toBe("Running");
    expect(item(w, "p-a").deadlineAt).toBe(new Date(START + 60_000).toISOString());
    ok(w.engine.finish(system(), T1, "p-a", "completed"));
    expect(stateOf(w, "p-a")).toBe("Completed");
  });
});

describe("Runtime orchestration: an approved plan becomes a queue", () => {
  it("takes an approved plan and builds the run and the items", () => {
    const w = world();
    const result = enqueue(w, chain());
    expect(result.run).toMatchObject({ planId: "p", tenantId: T1, status: "Queued", approvedBy: "adela", approverRole: "admin" });
    expect(result.items).toHaveLength(3);
    expect(w.engine.runsFor(ana)).toHaveLength(1);
  });
  it("refuses what is not an approved plan, and who may not enqueue", () => {
    const w = world();
    expect(w.engine.enqueue(marta, T1, plan("d", [step("d-a")], { status: "Draft" })).refusal).toBe("state");
    expect(w.engine.enqueue(marta, T1, plan("w", [step("w-a")], { status: "WaitingApproval" })).refusal).toBe("state");
    const { decidedBy: _decided, ...noDecider } = plan("n", [step("n-a")]);
    expect(w.engine.enqueue(marta, T1, noDecider as ExecutionPlan).refusal).toBe("state");
    expect(w.engine.enqueue(mario, T1, chain()).refusal).toBe("forbidden");
    expect(w.engine.enqueue(vera, T1, chain()).refusal).toBe("forbidden");
    expect(w.engine.queueFor(ana)).toEqual([]);
  });
  it("refuses a plan from another company, and an actor claiming a company that is not theirs", () => {
    const w = world();
    expect(w.engine.enqueue(marta, T1, chain("x", { tenantId: T2 })).refusal).toBe("tenant");
    expect(w.engine.enqueue(marta, T2, chain()).refusal).toBe("tenant");
    expect(w.engine.runsFor(luis)).toEqual([]);
  });
  it("a finance plan is invisible to whoever may not see finance", () => {
    const w = world();
    ok(w.engine.enqueue(ana, T1, chain("fin", { needs: "finance" })));
    expect(w.engine.queueFor(mario)).toEqual([]);
    expect(w.engine.queueFor(vera)).toEqual([]);
    expect(w.engine.runsFor(mario)).toEqual([]);
    expect(w.engine.queueFor(ana)).toHaveLength(3);
  });
  it("is idempotent: enqueuing the same plan twice changes nothing", () => {
    const w = world();
    enqueue(w, chain());
    tick(w);
    const before = JSON.stringify(w.engine.exportState().queue);
    const again = w.engine.enqueue(marta, T1, chain());
    expect(again.ok).toBe(true);
    expect(again.unchanged).toBe(true);
    expect(JSON.stringify(w.engine.exportState().queue)).toBe(before);
    expect(w.engine.runsFor(ana)).toHaveLength(1);
  });
  it("ticking twice with nothing new changes nothing (idempotent)", () => {
    const w = world();
    enqueue(w, chain());
    tick(w);
    const before = JSON.stringify(w.engine.exportState().queue);
    tick(w);
    expect(JSON.stringify(w.engine.exportState().queue)).toBe(before);
  });
  it("refuses a plan whose steps form a cycle", () => {
    const w = world();
    const result = w.engine.enqueue(marta, T1, plan("cy", [step("cy-a", { dependsOn: ["cy-b"] }), step("cy-b", { dependsOn: ["cy-a"] })]));
    expect(result.refusal).toBe("invalid");
  });
  it("refuses plans that depend on each other in a loop, and respects the limit", () => {
    const w = world({ config: { maxRuns: 2 } });
    enqueue(w, chain("a", { dependsOn: ["b"] }));
    expect(w.engine.enqueue(marta, T1, chain("b", { dependsOn: ["a"] })).refusal).toBe("cycle");
    enqueue(w, chain("c"));
    expect(w.engine.enqueue(marta, T1, chain("d")).refusal).toBe("limit");
  });
});

describe("Dependencies and the DAG", () => {
  it("no step starts until every dependency is Completed", () => {
    const w = world();
    enqueue(w, chain());
    tick(w);
    expect(w.engine.start(system(), T1, "p-b").refusal).toBe("dependency");
    expect(w.engine.start(system(), T1, "p-c").refusal).toBe("dependency");
    runItem(w, "p-a");
    expect(stateOf(w, "p-b")).toBe("Ready");
    expect(stateOf(w, "p-c")).toBe("WaitingDependencies");
    tick(w);
    runItem(w, "p-b");
    tick(w);
    runItem(w, "p-c");
    expect(w.engine.runsFor(ana)[0]!.status).toBe("Completed");
    expect(w.engine.log.ofType("run.completed")).toHaveLength(1);
  });
  it("a plan waits for the plans it depends on", () => {
    const w = world();
    enqueue(w, chain("second", { dependsOn: ["first"] }));
    tick(w);
    expect(stateOf(w, "second-a")).toBe("WaitingDependencies");
    expect(w.engine.log.all().some((event) => event.type === "orchestrator.blocked" && event.detail?.["kind"] === "dependencyNotQueued")).toBe(true);
    enqueue(w, chain("first"));
    tick(w);
    for (const id of ["a", "b", "c"]) { tick(w); runItem(w, `first-${id}`); }
    tick(w);
    expect(stateOf(w, "second-a")).toBe("Assigned");
  });
  it("graph helpers: order, cycles, critical path and waiting", () => {
    const items = itemsOfPlan(chain(), "2026-11-12T10:00:00.000Z");
    expect(topologicalOrder(itemGraph(items))).toEqual(["p-a", "p-b", "p-c"]);
    expect(graphIsAcyclic(items)).toBe(true);
    expect(criticalPathMs(items)).toBe(30_000);
    const byId = new Map(items.map((row) => [row.id, row]));
    expect(waitingFor(items[1]!, byId, new Map())).toEqual([{ kind: "item", id: "p-a", state: "Pending" }]);
    const loop = [{ ...items[0]!, dependsOn: ["p-c"] }, items[1]!, items[2]!];
    expect(graphIsAcyclic(loop)).toBe(false);
    expect(planDependencyCycle("x", ["x"], [])).toBe(true);
  });
  it("a failed dependency is a blockage, not a silent wait", () => {
    const w = world();
    enqueue(w, chain());
    tick(w);
    runItem(w, "p-a", "failed");
    expect(w.engine.runsFor(ana)[0]!.status).toBe("Failed");
    expect(w.engine.log.ofType("run.failed")).toHaveLength(1);
    expect(stateOf(w, "p-b")).toBe("Cancelled");
  });
});

describe("Scheduler and priorities", () => {
  it("orders by priority, then impact, then who waited longest, then id", () => {
    const rows = [
      { id: "d", priority: "low", impact: 90, enqueuedAt: "1" }, { id: "c", priority: "critical", impact: 10, enqueuedAt: "3" }, { id: "b", priority: "critical", impact: 10, enqueuedAt: "2" },
      { id: "a", priority: "critical", impact: 80, enqueuedAt: "9" }, { id: "e", priority: "normal", impact: 99, enqueuedAt: "0" },
    ] as const;
    expect(queueOrder(rows).map((row) => row.id)).toEqual(["a", "b", "c", "e", "d"]);
  });
  it("assigns the most urgent first when workers are scarce, and dispatches in that order", () => {
    const w = world({ workers: [worker("w1")] });
    enqueue(w, plan("low", [step("low-a")], { priority: "low" }));
    enqueue(w, plan("crit", [step("crit-a")], { priority: "critical" }));
    const result = tick(w);
    expect(stateOf(w, "crit-a")).toBe("Assigned");
    expect(stateOf(w, "low-a")).toBe("Ready"); // waiting for capacity is not a blockage
    expect(result.dispatch!.map((entry) => entry.itemId)).toEqual(["crit-a"]);
    expect(result.blockages).toEqual([]);
  });
  it("a tick does not start anything unless asked; with autoStart it starts exactly what is assigned", () => {
    const w = world();
    enqueue(w, chain());
    tick(w);
    expect(stateOf(w, "p-a")).toBe("Assigned");
    const w2 = world();
    enqueue(w2, chain());
    const result = tick(w2, true);
    expect(stateOf(w2, "p-a")).toBe("Running");
    expect(stateOf(w2, "p-b")).toBe("WaitingDependencies");
    expect(result.dispatch).toEqual([]);
  });
  it("backoff is exponential and capped", () => {
    expect([1, 2, 3, 4].map((attempt) => backoffFor(attempt, 1_000, 5_000))).toEqual([1_000, 2_000, 4_000, 5_000]);
    expect(retryDecision({ attempts: 0, maxAttempts: 3, backoffMs: 1_000 }, 0, 600_000)).toEqual({ retry: true, attempts: 1, notBeforeMs: 1_000 });
    expect(retryDecision({ attempts: 2, maxAttempts: 3, backoffMs: 1_000 }, 0, 600_000)).toEqual({ retry: false, attempts: 3 });
    expect(retryDecision({ attempts: 0, maxAttempts: 1, backoffMs: 1_000 }, 0, 600_000).retry).toBe(false); // Level 3 is never retried
  });
});

describe("Worker assignment", () => {
  const env = { isWorkerActive: () => true };
  const base = { tenantId: T1, specialty: "sales", action: "task.create" };
  it("checks tenant, activity, specialty, permission and capacity, in that order", () => {
    expect(eligibility(worker("x", { tenantId: T2 }), base, env, new Map())).toEqual({ ok: false, reason: "tenant" });
    expect(eligibility(worker("x", { status: "paused" }), base, env, new Map())).toEqual({ ok: false, reason: "inactive" });
    expect(eligibility(worker("x"), base, { isWorkerActive: () => false }, new Map())).toEqual({ ok: false, reason: "inactive" });
    expect(eligibility(worker("x", { specialty: "support" }), base, env, new Map())).toEqual({ ok: false, reason: "specialty" });
    expect(eligibility(worker("x", { permissions: ["lead.score"] }), base, env, new Map())).toEqual({ ok: false, reason: "permission" });
    expect(eligibility(worker("x"), base, env, new Map([["x", 1]]))).toEqual({ ok: false, reason: "capacity" });
    expect(eligibility(worker("x"), base, env, new Map())).toEqual({ ok: true });
  });
  it("permissions: exact, family and wildcard", () => {
    expect(permits(["*"], "anything")).toBe(true);
    expect(permits(["followup.*"], "followup.send")).toBe(true);
    expect(permits(["followup.*"], "message.draft")).toBe(false);
    expect(permits(["task.create"], "task.create")).toBe(true);
    expect(permits([], "task.create")).toBe(false);
  });
  it("never assigns an inactive worker or one of another company, whatever the roster says", () => {
    const w = world();
    enqueue(w, plan("p", [step("p-1"), step("p-2"), step("p-3"), step("p-4"), step("p-5"), step("p-6")]));
    tick(w);
    const used = new Set(w.engine.queueFor(ana).map((row) => row.workerId).filter(Boolean));
    expect([...used].sort()).toEqual(["w1", "w2"]);
    expect(used.has("w-paused")).toBe(false);
    expect(used.has("v1")).toBe(false);
    expect(used.has("w-ops")).toBe(false); // a different specialty
  });
  it("balances by load and never exceeds a worker's capacity", () => {
    const w = world();
    enqueue(w, plan("p", [step("p-1"), step("p-2"), step("p-3"), step("p-4")]));
    tick(w);
    const load = loadOf(w.engine.queueFor(ana));
    expect(load.get("w1")).toBe(1);
    expect(load.get("w2")).toBe(2);
    expect(w.engine.queueFor(ana).filter((row) => row.state === "Ready")).toHaveLength(1);
  });
  it("respects what a worker is permitted to do", () => {
    const w = world({ workers: [worker("w1", { permissions: ["lead.score"] })] });
    enqueue(w, plan("p", [step("p-a")]));
    const result = tick(w);
    expect(stateOf(w, "p-a")).toBe("Ready");
    expect(result.blockages!.map((blockage) => blockage.kind)).toEqual(["noWorker"]); // nobody could EVER take it
  });
  it("a worker that stops being active lets go of what it held", () => {
    const w = world({ workers: [worker("w1")] });
    enqueue(w, chain());
    tick(w);
    expect(item(w, "p-a").workerId).toBe("w1");
    w.active.delete("w1");
    tick(w);
    expect(stateOf(w, "p-a")).toBe("Ready");
    expect(item(w, "p-a").workerId).toBeUndefined();
    expect(w.engine.log.ofType("queue.unassigned")).toHaveLength(1);
  });
  it("a worker principal that is not active is refused", () => {
    const w = world();
    const ghost: Principal = { kind: "worker", tenantId: T1, id: "ghost" };
    expect(w.engine.tick(ghost, T1).refusal).toBe("workerInactive");
  });
  it("assignWorker returns the item unchanged when nobody can take it", () => {
    const [first] = itemsOfPlan(chain(), "2026-11-12T10:00:00.000Z");
    const none = assignWorker(first!, [worker("x", { tenantId: T2 })], env, new Map());
    expect(none.assigned).toBe(false);
    expect(none.item).toBe(first);
    expect(none.rejected.tenant).toBe(0); // another company's worker is never even considered
  });
});

describe("Authorization comes before everything", () => {
  it("a step above the approver's role waits for approval and cannot start", () => {
    const w = world();
    enqueue(w, plan("p", [step("p-a", { authorizationLevel: 3, approverRole: "admin", action: "followup.send" })], { decidedBy: "marta" }));
    tick(w);
    expect(stateOf(w, "p-a")).toBe("WaitingApproval");
    expect(w.engine.start(system(), T1, "p-a").refusal).toBe("authorization");
    expect(item(w, "p-a").workerId).toBeUndefined(); // no worker is given to an unauthorized step
  });
  it("an approver whose role nobody can check authorizes nothing", () => {
    const w = world();
    enqueue(w, plan("p", [step("p-a")], { decidedBy: "stranger" }));
    tick(w);
    expect(stateOf(w, "p-a")).toBe("WaitingApproval");
  });
  it("an authorized Level 3 step goes through when an administrator approved it", () => {
    const w = world();
    enqueue(w, plan("p", [step("p-a", { authorizationLevel: 3, approverRole: "admin", action: "followup.send" })], { decidedBy: "adela" }));
    tick(w);
    expect(stateOf(w, "p-a")).toBe("Assigned");
    ok(w.engine.start(system(), T1, "p-a"));
  });
  it("only the system starts and finishes; people and workers cannot say it ran", () => {
    const w = world();
    enqueue(w, chain());
    tick(w);
    expect(w.engine.start(ana, T1, "p-a").refusal).toBe("forbidden");
    expect(w.engine.start({ kind: "worker", tenantId: T1, id: "w1" }, T1, "p-a").refusal).toBe("forbidden");
    ok(w.engine.start(system(), T1, "p-a"));
    expect(w.engine.finish(ana, T1, "p-a", "completed").refusal).toBe("forbidden");
    expect(stateOf(w, "p-a")).toBe("Running");
  });
  it("cannot start without a worker, or something that does not exist", () => {
    const w = world({ workers: [] });
    enqueue(w, chain());
    tick(w);
    expect(w.engine.start(system(), T1, "p-a").refusal).toBe("worker");
    expect(w.engine.start(system(), T1, "nothing").refusal).toBe("notFound");
  });
  it("cannot finish what is not running", () => {
    const w = world();
    enqueue(w, chain());
    tick(w);
    expect(w.engine.finish(system(), T1, "p-a", "completed").refusal).toBe("state");
  });
});

describe("Retries, timeouts and failures", () => {
  it("a failed attempt retries after a backoff, then succeeds", () => {
    const w = world();
    enqueue(w, retrying("r"));
    tick(w);
    runItem(w, "r-a", "failed");
    expect(stateOf(w, "r-a")).toBe("Pending");
    expect(item(w, "r-a")).toMatchObject({ attempts: 1, lastFailure: "failed" });
    expect(item(w, "r-a").workerId).toBeUndefined();
    tick(w);
    expect(stateOf(w, "r-a")).toBe("Pending"); // still backing off
    w.clock.advance(1_000);
    tick(w);
    expect(stateOf(w, "r-a")).toBe("Assigned");
    runItem(w, "r-a");
    expect(stateOf(w, "r-a")).toBe("Completed");
    expect(w.engine.log.ofType("execution.retry")).toHaveLength(1);
  });
  it("the backoff doubles", () => {
    const w = world();
    enqueue(w, retrying("r"));
    tick(w);
    runItem(w, "r-a", "failed");
    w.clock.advance(1_000);
    tick(w);
    runItem(w, "r-a", "failed", 0);
    expect(item(w, "r-a").notBeforeMs).toBe(w.clock.t + 2_000);
  });
  it("out of attempts, the step fails, the run fails and what had not started is cancelled", () => {
    const w = world();
    enqueue(w, retrying("r", 2));
    tick(w);
    runItem(w, "r-a", "failed");
    w.clock.advance(1_000);
    tick(w);
    runItem(w, "r-a", "failed");
    expect(stateOf(w, "r-a")).toBe("Failed");
    expect(stateOf(w, "r-b")).toBe("Cancelled");
    expect(w.engine.runsFor(ana)[0]!.status).toBe("Failed");
    expect(w.engine.log.ofType("execution.failed")).toHaveLength(1);
  });
  it("a Level 3 step is never retried", () => {
    const w = world();
    enqueue(w, plan("p", [step("p-a", { authorizationLevel: 3, approverRole: "admin", action: "followup.send" })]));
    tick(w);
    runItem(w, "p-a", "failed");
    expect(stateOf(w, "p-a")).toBe("Failed");
  });
  it("a running step whose time is up times out and is retried", () => {
    const w = world();
    enqueue(w, retrying("r"));
    tick(w);
    ok(w.engine.start(system(), T1, "r-a"));
    w.clock.advance(59_000);
    tick(w);
    expect(stateOf(w, "r-a")).toBe("Running");
    w.clock.advance(1_000);
    tick(w);
    expect(stateOf(w, "r-a")).toBe("Pending");
    expect(item(w, "r-a").lastFailure).toBe("timeout");
    expect(w.engine.log.ofType("execution.timeout")).toHaveLength(1);
    expect(w.engine.log.ofType("execution.retry")).toHaveLength(1);
  });
  it("a timeout with no attempts left fails the step", () => {
    const w = world();
    enqueue(w, chain());
    tick(w);
    ok(w.engine.start(system(), T1, "p-a"));
    w.clock.advance(60_000);
    tick(w);
    expect(stateOf(w, "p-a")).toBe("Failed");
    expect(w.engine.runsFor(ana)[0]!.status).toBe("Failed");
  });
  it("a plan that expires before anything started expires", () => {
    const w = world();
    enqueue(w, chain());
    w.clock.advance(8 * 24 * HOUR);
    tick(w);
    expect(w.engine.queueFor(ana).every((row) => row.state === "Expired")).toBe(true);
    expect(w.engine.runsFor(ana)[0]!.status).toBe("Expired");
    expect(w.engine.log.ofType("run.expired")).toHaveLength(1);
  });
});

describe("Pause, resume and cancel", () => {
  it("a paused run dispatches nothing and cannot start", () => {
    const w = world();
    enqueue(w, chain());
    tick(w);
    ok(w.engine.pause(marta, T1, "p"));
    expect(stateOf(w, "p-a")).toBe("Paused");
    expect(w.engine.runsFor(ana)[0]).toMatchObject({ status: "Paused", paused: true });
    expect(w.engine.start(system(), T1, "p-a").refusal).toBe("state");
    expect(tick(w).dispatch).toEqual([]);
    expect(w.engine.pause(marta, T1, "p").refusal).toBe("state");
  });
  it("resuming brings the items back to being evaluated", () => {
    const w = world();
    enqueue(w, chain());
    tick(w);
    ok(w.engine.pause(marta, T1, "p"));
    w.clock.advance(5 * MIN);
    ok(w.engine.resume(marta, T1, "p"));
    tick(w);
    expect(stateOf(w, "p-a")).toBe("Assigned");
    expect(w.engine.runsFor(ana)[0]!.paused).toBe(false);
    expect(w.engine.resume(marta, T1, "p").refusal).toBe("state");
  });
  it("a running step keeps the time it had left: its deadline moves by the time it was paused", () => {
    const w = world();
    enqueue(w, chain());
    tick(w);
    ok(w.engine.start(system(), T1, "p-a"));
    w.clock.advance(10_000);
    ok(w.engine.pause(marta, T1, "p"));
    w.clock.advance(5 * MIN);
    ok(w.engine.resume(marta, T1, "p"));
    expect(stateOf(w, "p-a")).toBe("Running");
    expect(item(w, "p-a").deadlineAt).toBe(new Date(START + 60_000 + 5 * MIN).toISOString());
    tick(w);
    expect(stateOf(w, "p-a")).toBe("Running"); // no timeout while it was paused
  });
  it("cancelling closes every item and the run, and a closed run refuses everything", () => {
    const w = world();
    enqueue(w, chain());
    tick(w);
    ok(w.engine.cancel(marta, T1, "p"));
    expect(w.engine.queueFor(ana).every((row) => row.state === "Cancelled")).toBe(true);
    expect(w.engine.queueFor(ana).every((row) => row.workerId === undefined)).toBe(true);
    expect(w.engine.runsFor(ana)[0]!.status).toBe("Cancelled");
    expect(w.engine.cancel(marta, T1, "p").refusal).toBe("state");
    expect(w.engine.pause(marta, T1, "p").refusal).toBe("state");
    expect(w.engine.start(system(), T1, "p-a").refusal).toBe("state");
    expect(w.engine.log.ofType("execution.cancelled")).toHaveLength(1);
  });
  it("needs a manager, and never reaches another company's run", () => {
    const w = world();
    enqueue(w, chain());
    expect(w.engine.pause(mario, T1, "p").refusal).toBe("forbidden");
    expect(w.engine.cancel(vera, T1, "p").refusal).toBe("forbidden");
    expect(w.engine.cancel(luis, T2, "p").refusal).toBe("notFound");
    expect(w.engine.runsFor(ana)[0]!.status).toBe("Queued");
  });
  it("the adapter functions are plain moves on one item", () => {
    const [first] = itemsOfPlan(chain(), "2026-11-12T10:00:00.000Z");
    const running = startExecution({ ...first!, state: "Assigned", workerId: "w1" }, START);
    expect(running.state).toBe("Running");
    const paused = pauseExecution(running);
    expect(paused).toMatchObject({ state: "Paused", pausedFrom: "Running" });
    expect(resumeExecution(paused, 1_000).state).toBe("Running");
    expect(resumeExecution({ ...first!, state: "Paused", pausedFrom: "Ready" }, 0).state).toBe("Pending");
    expect(cancelExecution(running).state).toBe("Cancelled");
    expect(cancelExecution({ ...first!, state: "Completed" }).state).toBe("Completed"); // a finished item is final
    expect(finishExecution(running, "completed", START + 1, 1_000).item.state).toBe("Completed");
    expect(pauseExecution({ ...first!, state: "Completed" }).state).toBe("Completed");
  });
  it("prepareExecution builds structures and nothing else", () => {
    const prepared = prepareExecution(chain(), { at: "2026-11-12T10:00:00.000Z", approvedBy: "adela", approverRole: "admin" });
    expect(prepared.items.map((row) => row.state)).toEqual(["Pending", "Pending", "Pending"]);
    expect(prepared.run.itemIds).toEqual(["p-a", "p-b", "p-c"]);
  });
});

describe("Audit, events and observability", () => {
  it("every move leaves an audit entry in the actor's company, with ids and counts only", () => {
    const w = world();
    enqueue(w, chain());
    tick(w);
    runItem(w, "p-a");
    w.engine.enqueue(mario, T1, chain("z")); // refused, and audited
    const audit = w.engine.audit(T1);
    expect(audit.map((entry) => entry.action)).toEqual(["enqueue", "tick", "start", "finish", "enqueue.refused"]);
    expect(audit.every((entry) => entry.tenantId === T1)).toBe(true);
    expect(w.engine.audit(T2)).toEqual([]);
    const types = new Set(w.engine.log.all().map((event) => event.type));
    for (const type of ["queue.enqueued", "queue.assigned", "execution.started", "execution.finished", "orchestrator.tick", "orchestrator.refused"]) expect(types.has(type as never), type).toBe(true);
  });
  it("covers assignment, start, pause, resume, timeout, retry, cancel, finish and fail", () => {
    const w = world();
    enqueue(w, retrying("r"));
    tick(w);
    ok(w.engine.start(system(), T1, "r-a"));
    ok(w.engine.pause(marta, T1, "r"));
    ok(w.engine.resume(marta, T1, "r"));
    w.clock.advance(60_000);
    tick(w); // timeout + retry
    w.clock.advance(1_000);
    tick(w);
    runItem(w, "r-a");
    tick(w);
    runItem(w, "r-b", "failed");
    enqueue(w, chain());
    ok(w.engine.cancel(marta, T1, "p"));
    const types = new Set(w.engine.log.all().map((event) => event.type));
    for (const type of ["queue.assigned", "execution.started", "execution.paused", "execution.resumed", "execution.timeout", "execution.retry", "execution.cancelled", "execution.finished", "execution.failed"]) expect(types.has(type as never), type).toBe(true);
  });
  it("never records a prompt, an answer, a context or any content: only ids and numbers", () => {
    const w = world();
    enqueue(w, chain());
    tick(w);
    runItem(w, "p-a");
    w.engine.dashboard(ana);
    const everything = JSON.stringify([w.engine.log.all(), w.engine.exportState().audit, w.engine.snapshot(T1), w.engine.dashboard(ana)]);
    expect(everything).not.toMatch(/SECRETO/);
    const events = new OrchestratorEventLog();
    const event = events.emit({ at: "2026-11-12T10:00:00.000Z", tenantId: T1, actorKind: "system", actorId: "system", type: "orchestrator.tick", detail: { note: "texto libre con espacios y secretos", token: "sk-abc def", ok: true, n: 3, id: "p-1" } });
    expect(event.detail).toEqual({ ok: true, n: 3, id: "p-1" });
  });
  it("counts per company and a company never sees another's numbers", () => {
    const w = world();
    enqueue(w, chain());
    tick(w);
    runItem(w, "p-a");
    const snapshot = w.engine.snapshot(T1);
    expect(snapshot.counters).toMatchObject({ enqueued: 1, items: 3, started: 1, finished: 1, ticks: 1 });
    expect(snapshot.queue?.byState["Completed"]).toBe(1);
    expect(w.engine.snapshot(T2).counters).toMatchObject({ enqueued: 0, ticks: 0, started: 0 });
    expect(w.engine.log.forTenant(T2)).toEqual([]);
    expect(w.engine.log.toAudit(T1).length).toBeGreaterThan(0);
  });
  it("measures how long a tick takes and how often it was refused", () => {
    const w = world();
    enqueue(w, chain());
    tick(w);
    w.engine.enqueue(mario, T1, chain("q"));
    const snapshot = w.engine.snapshot(T1);
    expect(snapshot.latency.count).toBe(1);
    expect(snapshot.refusals["forbidden"]).toBe(1);
    expect(snapshot.byPriority["normal"]).toBe(1);
  });
  it("observability can be detached", () => {
    const log = new OrchestratorEventLog();
    const observability = new OrchestratorObservability(log);
    log.emit({ at: "2026-11-12T10:00:00.000Z", tenantId: T1, actorKind: "system", actorId: "system", type: "orchestrator.tick" });
    observability.stop();
    log.emit({ at: "2026-11-12T10:00:00.000Z", tenantId: T1, actorKind: "system", actorId: "system", type: "orchestrator.tick" });
    expect(observability.snapshot(T1).counters.ticks).toBe(1);
  });
});

describe("Dashboard", () => {
  it("gives active plans, workers, queue, throughput, utilization, times, retries, failures, bottlenecks and dependencies", () => {
    const w = world();
    enqueue(w, chain());
    enqueue(w, retrying("r"));
    tick(w);
    runItem(w, "p-a", "completed", 20_000);
    runItem(w, "r-a", "failed", 0);
    tick(w);
    const dashboard = w.engine.dashboard(ana);
    expect(dashboard.tenantId).toBe(T1);
    expect(dashboard.plans.active.map((row) => row.planId)).toEqual(["p", "r"]);
    expect(dashboard.plans.active[0]).toMatchObject({ items: 3, completed: 1, progress: 33.3 });
    expect(dashboard.queue.byState.Completed).toBe(1);
    expect(dashboard.throughput.completed).toBe(1);
    expect(dashboard.averageMs.execution).toBe(20_000);
    expect(dashboard.retries).toEqual({ items: 1, attempts: 1 });
    expect(dashboard.utilization.capacity).toBe(4);
    expect(dashboard.workers.free.length + dashboard.workers.active.length).toBeGreaterThan(0);
    expect(dashboard.dependencies.edges).toBe(3);
    expect(dashboard.failures).toEqual({ items: 0, plans: 0, byCause: {} });
  });
  it("lists completed plans and failures", () => {
    const w = world();
    enqueue(w, plan("one", [step("one-a")]));
    tick(w);
    runItem(w, "one-a");
    enqueue(w, plan("two", [step("two-a")]));
    tick(w);
    runItem(w, "two-a", "failed");
    const dashboard = w.engine.dashboard(ana);
    expect(dashboard.plans.completed).toEqual(["one"]);
    expect(dashboard.failures).toMatchObject({ items: 1, plans: 1, byCause: { failed: 1 } });
  });
  it("shows a saturated worker as a bottleneck", () => {
    const w = world({ workers: [worker("w1")] });
    enqueue(w, plan("p", [step("p-1"), step("p-2")]));
    tick(w);
    const dashboard = w.engine.dashboard(ana);
    expect(dashboard.bottlenecks).toContainEqual({ kind: "workerSaturated", ref: "w1", count: 1 });
    expect(dashboard.utilization.percent).toBe(100);
    expect(dashboard.queue.next).toEqual(["p-1", "p-2"]);
  });
  it("is isolated by company: another company's dashboard has none of this", () => {
    const w = world();
    enqueue(w, chain());
    tick(w);
    const other = w.engine.dashboard(luis);
    expect(other.tenantId).toBe(T2);
    expect(other.plans.total).toBe(0);
    expect(other.queue.total).toBe(0);
    expect(JSON.stringify(other)).not.toMatch(/p-a|w1|w2/);
    expect(w.engine.log.ofType("orchestrator.dashboard")).toHaveLength(1);
  });
  it("builds from plain data with no engine", () => {
    const dashboard = buildOrchestratorDashboard({ tenantId: T1, at: "2026-11-12T10:00:00.000Z", runs: [], queue: [], workers: WORKERS, env: { isWorkerActive: () => true }, config: DEFAULT_CONFIG });
    expect(dashboard.workers.total).toBe(3); // the paused worker and the other company's are not counted
    expect(dashboard.utilization.percent).toBe(0);
  });
});

describe("Multitenancy and isolation", () => {
  it("two companies run side by side and never touch each other", () => {
    const w = world();
    enqueue(w, chain("p", { tenantId: T1 }));
    ok(w.engine.enqueue({ kind: "person", tenantId: T2, id: "luis", role: "owner" }, T2, chain("q", { tenantId: T2 })));
    ok(w.engine.tick(system(T2), T2));
    ok(w.engine.tick(system(T1), T1));
    expect(w.engine.queueFor(ana).map((row) => row.planId)).toEqual(["p", "p", "p"]);
    expect(w.engine.queueFor(luis).map((row) => row.planId)).toEqual(["q", "q", "q"]);
    expect(w.engine.queueFor(luis).find((row) => row.id === "q-a")!.workerId).toBe("v1");
    expect(w.engine.queueFor(ana).find((row) => row.id === "p-a")!.workerId).not.toBe("v1");
    expect(w.engine.start(system(T2), T2, "p-a").refusal).toBe("notFound");
    expect(w.engine.audit(T1).some((entry) => entry.tenantId === T2)).toBe(false);
  });
  it("the reducer touches only the actor's company rows", () => {
    const w = world();
    enqueue(w, chain("p"));
    ok(w.engine.enqueue(luis, T2, chain("q", { tenantId: T2 })));
    const before = w.engine.exportState().queue.filter((row) => row.tenantId === T2);
    tick(w);
    runItem(w, "p-a");
    expect(w.engine.exportState().queue.filter((row) => row.tenantId === T2)).toEqual(before);
  });
  it("a plan dependency never crosses companies", () => {
    const w = world();
    ok(w.engine.enqueue(luis, T2, chain("first", { tenantId: T2 })));
    enqueue(w, chain("second", { dependsOn: ["first"] }));
    tick(w);
    expect(stateOf(w, "second-a")).toBe("WaitingDependencies"); // T2's plan does not exist for T1
  });
});

describe("Determinism and purity", () => {
  const script = (w: World) => {
    enqueue(w, chain("p", { priority: "high" }));
    enqueue(w, retrying("r"));
    tick(w);
    runItem(w, "p-a");
    runItem(w, "r-a", "failed");
    w.clock.advance(1_000);
    tick(w, true);
    w.engine.pause(marta, T1, "p");
    w.clock.advance(MIN);
    w.engine.resume(marta, T1, "p");
    tick(w);
    w.engine.dashboard(ana);
  };
  it("the same script in two worlds gives the same state, log and numbers", () => {
    const a = world();
    const b = world();
    script(a);
    script(b);
    expect(a.engine.exportState()).toEqual(b.engine.exportState());
    expect(a.engine.log.all()).toEqual(b.engine.log.all());
    expect(a.engine.snapshot(T1)).toEqual(b.engine.snapshot(T1));
  });
  it("the reducer does not mutate its inputs and gives the same answer twice", () => {
    const deepFreeze = <T,>(value: T): T => { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; };
    const sources: RuntimeSources = deepFreeze({ env: { isWorkerActive: () => true }, workers: WORKERS, roleOf: (personId: string) => ROLES[personId] });
    const state: RuntimeState = deepFreeze(newRuntimeState());
    const event: RuntimeEvent = deepFreeze({ type: "enqueue", actor: marta, tenantId: T1, at: "2026-11-12T10:00:00.000Z", plan: chain() });
    const one = reduceRuntime(state, event, sources);
    const two = reduceRuntime(state, event, sources);
    expect(one).toEqual(two);
    expect(state.queue).toEqual([]);
    const tickEvent: RuntimeEvent = deepFreeze({ type: "tick", actor: system(), tenantId: T1, at: "2026-11-12T10:00:01.000Z" });
    expect(reduceRuntime(deepFreeze(one.state), tickEvent, sources)).toEqual(reduceRuntime(deepFreeze(two.state), tickEvent, sources));
  });
  it("a bad instant is refused, never guessed", () => {
    const result = reduceRuntime(newRuntimeState(), { type: "tick", actor: system(), tenantId: T1, at: "mañana" }, { env: { isWorkerActive: () => true }, workers: [], roleOf: () => undefined });
    expect(result.result.refusal).toBe("invalid");
  });
  it("the pure helpers agree with the engine", () => {
    const items = itemsOfPlan(chain(), "2026-11-12T10:00:00.000Z");
    const assigned: QueueItem = { ...items[0]!, state: "Assigned", workerId: "w1" };
    expect(dispatchList([assigned, items[1]!], new Map()).map((entry) => entry.itemId)).toEqual(["p-a"]);
    expect(detectBlockages(items, new Map(), [], { isWorkerActive: () => true }, START, HOUR)).toEqual([]);
  });
});

describe("Pure and isolated: nothing is executed", () => {
  const dir = join(process.cwd(), "lib", "nex", "runtime-orchestrator");
  const FILES = ["dependency-graph.ts", "execution-queue.ts", "index.ts", "orchestrator-dashboard.ts", "orchestrator-events.ts", "orchestrator-types.ts", "orchestrator.ts", "runtime-engine.ts", "scheduler.ts", "worker-assignment.ts"];
  const code = (name: string) => readFileSync(join(dir, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
  it("has exactly the ten files of the layer", () => {
    for (const name of FILES) expect(existsSync(join(dir, name)), name).toBe(true);
    expect(readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).sort()).toEqual([...FILES].sort());
  });
  it("reads no clock, no randomness, no network, no environment, no database and no AI", () => {
    for (const name of FILES) {
      const source = code(name);
      expect(source, name).not.toMatch(/Date\.now|new Date\(\)|Math\.random|performance\.now|setTimeout|setInterval|\bfetch\(|XMLHttpRequest|process\.env|randomUUID|supabase|createClient|openai|anthropic|workers-ai|AI_GATEWAY/i);
      expect(source, name).not.toMatch(/from "@\/lib\/(db|ai)|from "node:|from "react|from "next/);
    }
  });
  it("imports only its own files and the execution layer", () => {
    for (const name of FILES) {
      for (const match of code(name).matchAll(/from "([^"]+)"/g)) expect(match[1]!.startsWith("./") || match[1] === "@/lib/nex/execution", `${name}: ${match[1]}`).toBe(true);
    }
  });
  it("calls no Runtime, Connector, Worker, provider or other layer", () => {
    for (const name of FILES) {
      expect(code(name), name).not.toMatch(/ADAPTERS|adapter\.|\.execute\(|executeAction|runAction|runStep|dispatchWorker|callWorker|callConnector|reduceKoe|reduceConnectors|reduceMemory|reduceKnowledge|reduceCopilot|reduceRag|reduceExecution|\.ask\(|\.remember\(|\.upsertNode\(|\.prepare\(/);
    }
  });
  it("is used by nothing else in the repository yet", () => {
    const importers: string[] = [];
    const walk = (folder: string) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (["node_modules", ".next", ".git", ".open-next"].includes(entry.name)) continue;
        const path = join(folder, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name) && !path.includes(join("lib", "nex", "runtime-orchestrator")) && !path.includes("execution-bridge") && /lib\/nex\/runtime-orchestrator/.test(readFileSync(path, "utf8"))) importers.push(path);
      }
    };
    for (const folder of ["app", "lib", "components"]) walk(join(process.cwd(), folder));
    expect(importers).toEqual([]);
  });
});
