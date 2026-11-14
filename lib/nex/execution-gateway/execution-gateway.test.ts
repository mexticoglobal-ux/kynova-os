/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG, ExecutionGateway, FUTURE_TABLES, GatewayEventLog, GatewayObservability, PRIORITIES, REQUEST_STATES, REQUEST_TRANSITIONS, buildGatewayDashboard, buildRequest, canTransition, evaluatePolicy, newGatewayState,
  permits, reduceGateway, requestIdFor, requestOrder, requiredRole, sanitizeDetail, toBusMessage, validateRequest,
  type GatewayEvent, type GatewaySources, type OsWorkerFact, type PlanFact, type Principal, type Priority, type RuntimeWorkerFact, type StepFact,
} from "./index";

const T1 = "tenant-nova";
const T2 = "tenant-vida";
const START = Date.parse("2026-11-13T10:00:00.000Z");
const SEC = 1_000;
const MIN = 60_000;
const person = (tenantId: string, id: string, role: "viewer" | "member" | "manager" | "admin" | "owner"): Principal => ({ kind: "person", tenantId, id, role });
const ana = person(T1, "ana", "owner");
const marta = person(T1, "marta", "manager");
const mario = person(T1, "mario", "member");
const vera = person(T1, "vera", "viewer");
const luis = person(T2, "luis", "owner");
const system = (tenantId = T1): Principal => ({ kind: "system", tenantId });
const nex = (tenantId = T1): Principal => ({ kind: "nex", tenantId });
const wk = (id: string, tenantId = T1): Principal => ({ kind: "worker", tenantId, id });
/** only PEOPLE hold a role: the system, the workers and NEX have none */
const ROLES: Record<string, "viewer" | "member" | "manager" | "admin" | "owner"> = { ana: "owner", adela: "admin", marta: "manager", mario: "member", vera: "viewer", luis: "owner" };

const step = (stepId: string, over: Partial<StepFact> = {}): StepFact => ({
  stepId, actionId: "task.create", level: 1, approverRole: "member", specialty: "sales", state: "pending", dependsOn: [], timeoutMs: 60_000, retry: { maxAttempts: 1, backoffMs: 1_000 }, tools: ["CRM"], capabilities: ["read"], ...over,
});
const plan = (planId: string, steps: StepFact[], over: Partial<PlanFact> = {}, tenantId = T1): PlanFact => ({ planId, tenantId, status: "Approved", priority: "normal", decidedBy: "adela", dependsOn: [], steps, ...over });
const rw = (workerId: string, over: Partial<RuntimeWorkerFact> = {}, tenantId = T1): RuntimeWorkerFact => ({ workerId, tenantId, state: "Idle", version: "1.2.0", maxConcurrent: 2, current: 0, ...over });
const os = (workerId: string, over: Partial<OsWorkerFact> = {}, companyId = T1): OsWorkerFact => ({
  workerId, companyId, status: "Active", specialty: "sales", version: "1.2.0", capabilities: ["read", "write"], tools: ["CRM", "Email"], permissions: ["task.create", "crm.*", "followup.*"], limits: { timeoutMs: 120_000 }, ...over,
});

type Facts = { plans: PlanFact[]; runtimeWorkers: RuntimeWorkerFact[]; osWorkers: OsWorkerFact[] };
function world(config: Partial<typeof DEFAULT_CONFIG> = {}) {
  const clock = { t: START, advance(ms: number) { this.t += ms; } };
  const facts: Facts = { plans: [plan("p", [step("a"), step("b", { dependsOn: ["a"] })])], runtimeWorkers: [rw("w1"), rw("w2")], osWorkers: [os("w1"), os("w2")] };
  const gw = new ExecutionGateway({ now: () => clock.t, sources: () => ({ ...facts, roleOf: (id: string) => ROLES[id] }), config });
  return { clock, facts, gw };
}
type World = ReturnType<typeof world>;
const ok = (result: { ok: boolean; refusal?: string; reasons?: readonly string[] }, label = "") => expect(result.ok, `${label} ${result.refusal} ${result.reasons}`).toBe(true);
const submit = (w: World, stepId = "a", over: { planId?: string; workerId?: string; priority?: Priority } = {}) => { const result = w.gw.submit(system(), T1, { planId: "p", stepId, workerId: "w1", ...over }); ok(result, `submit ${stepId}`); return result.record!; };
const validate = (w: World, id: string) => { const result = w.gw.validate(system(), T1, id); ok(result, `validate ${id}`); return result.record!; };
const idOf = (stepId: string, planId = "p") => requestIdFor(planId, stepId);
const rec = (w: World, id: string, tenantId = T1) => w.gw.requestsFor(person(tenantId, "x", "owner")).find((row) => row.request.requestId === id)!;
const reasonsOf = (w: World, stepId = "a") => rec(w, idOf(stepId)).reasons;
/** submit and validate one step; returns its record */
const check = (w: World, stepId = "a", over: { workerId?: string; priority?: Priority } = {}) => { submit(w, stepId, over); w.clock.advance(SEC); return validate(w, idOf(stepId)); };
const iso = (ms: number) => new Date(ms).toISOString();

describe("States and transitions", () => {
  it("has exactly the eight states", () => {
    expect([...REQUEST_STATES]).toEqual(["Pending", "Validated", "WaitingApproval", "Ready", "Blocked", "Rejected", "Cancelled", "Expired"]);
    expect(Object.keys(REQUEST_TRANSITIONS).sort()).toEqual([...REQUEST_STATES].sort());
    for (const state of ["Rejected", "Cancelled", "Expired"] as const) expect(REQUEST_TRANSITIONS[state]).toEqual([]);
  });
  it("a request becomes Ready only by being Validated, and finished ones never move", () => {
    expect(canTransition("Pending", "Validated")).toBe(true);
    expect(canTransition("Validated", "Ready")).toBe(true);
    expect(canTransition("Pending", "Ready")).toBe(false);
    expect(canTransition("Blocked", "Ready")).toBe(false);
    expect(canTransition("Ready", "Validated")).toBe(false);
    expect(canTransition("Rejected", "Pending")).toBe(false);
    expect(canTransition("Expired", "Ready")).toBe(false);
  });
});

describe("The complete flow: plan → request → STOP", () => {
  it("builds a request from the approved plan, validates it and leaves it Ready, nothing executed", () => {
    const w = world();
    const created = submit(w, "a");
    expect(created.state).toBe("Pending");
    expect(created.request).toEqual({
      requestId: "er:p:a", companyId: T1, workerId: "w1", planId: "p", stepId: "a", actionId: "task.create", priority: "normal", requestedAt: iso(START), approvedBy: "adela", timeout: 60_000,
      retryPolicy: { maxAttempts: 1, backoffMs: 1_000, retryOn: "retryable" }, executionPolicy: { level: 1, approverRole: "member", requiresApproval: true, mode: "request-only" },
      toolRequirements: ["CRM"], capabilityRequirements: ["read"],
    });
    w.clock.advance(SEC);
    const ready = validate(w, "er:p:a");
    expect(ready.state).toBe("Ready");
    expect(ready.reasons).toEqual([]);
    expect(ready.workerVersion).toBe("1.2.0");
    expect(w.gw.audit(T1).filter((entry) => entry.action === "request.transition").map((entry) => `${entry.detail?.["from"]}>${entry.detail?.["to"]}`)).toEqual(["Pending>Validated", "Validated>Ready"]);
    expect(w.gw.dispatch(system()).map((request) => request.requestId)).toEqual(["er:p:a"]);
    // STOP: asking for the list changes nothing; there is no state after Ready that means "run"
    expect(rec(w, "er:p:a").state).toBe("Ready");
    expect(REQUEST_STATES).not.toContain("Dispatched");
  });
  it("a step whose dependencies have not finished is Blocked, and it becomes Ready when they have", () => {
    const w = world();
    expect(check(w, "b").reasons).toEqual(["dependency.pending"]);
    expect(rec(w, idOf("b")).state).toBe("Blocked");
    w.facts.plans = [plan("p", [step("a", { state: "completed" }), step("b", { dependsOn: ["a"] })])];
    w.clock.advance(SEC);
    expect(validate(w, idOf("b")).state).toBe("Ready");
    expect(w.gw.audit(T1).filter((entry) => entry.action === "request.transition").map((entry) => `${entry.detail?.["from"]}>${entry.detail?.["to"]}`)).toEqual(["Pending>Blocked", "Blocked>Validated", "Validated>Ready"]);
  });
  it("a request holds no prompt, context, memory or answer: only the fixed fields", () => {
    const w = world();
    const created = submit(w, "a");
    expect(Object.keys(created.request).sort()).toEqual(["actionId", "approvedBy", "capabilityRequirements", "companyId", "executionPolicy", "planId", "priority", "requestId", "requestedAt", "retryPolicy", "stepId", "timeout", "toolRequirements", "workerId"]);
    expect(JSON.stringify(created)).not.toMatch(/prompt|context|memory|memoria|respuesta|answer/i);
  });
  it("refuses to build a request for something that does not exist, or a malformed ask", () => {
    const w = world();
    expect(w.gw.submit(system(), T1, { planId: "nope", stepId: "a", workerId: "w1" }).reasons).toEqual(["plan"]);
    expect(w.gw.submit(system(), T1, { planId: "p", stepId: "zz", workerId: "w1" }).reasons).toEqual(["step"]);
    expect(w.gw.submit(system(), T1, { planId: "p", stepId: "a", workerId: "ghost" }).reasons).toEqual(["worker"]);
    expect(w.gw.submit(system(), T1, { planId: "p", stepId: "a", workerId: "w1", priority: "urgent" as never }).refusal).toBe("invalid");
    expect(w.gw.submit(system(), T1, { planId: "p", stepId: "a", workerId: "w1", prompt: "haz esto" } as never).refusal).toBe("invalid");
    expect(w.gw.submit(system(), T1, { planId: "p s", stepId: "a", workerId: "w1" }).refusal).toBe("invalid");
    expect(w.gw.requestsFor(ana)).toEqual([]);
  });
  it("is idempotent: submitting or validating twice changes nothing", () => {
    const w = world();
    submit(w, "a");
    const again = w.gw.submit(system(), T1, { planId: "p", stepId: "a", workerId: "w1" });
    expect(again.unchanged).toBe(true);
    expect(w.gw.requestsFor(ana)).toHaveLength(1);
    w.clock.advance(SEC);
    validate(w, idOf("a"));
    const twice = w.gw.validate(system(), T1, idOf("a"));
    expect(twice.unchanged).toBe(true);
    expect(rec(w, idOf("a")).state).toBe("Ready");
  });
});

describe("Validations: one failed check blocks the request", () => {
  const blocked = (w: World, code: string, stepId = "a") => { expect(rec(w, idOf(stepId)).state, code).toBe("Blocked"); expect(reasonsOf(w, stepId), code).toContain(code); };
  it("worker: state, capacity, runtime and profile presence, Worker OS status and specialty", () => {
    for (const [patch, code] of [[{ state: "Offline" }, "worker.state"], [{ state: "Failed" }, "worker.state"], [{ state: "Maintenance" }, "worker.state"], [{ current: 2 }, "worker.capacity"]] as const) {
      const w = world();
      w.facts.runtimeWorkers = [rw("w1", patch)];
      check(w);
      blocked(w, code);
    }
    const w = world();
    submit(w);
    w.facts.runtimeWorkers = [];
    w.facts.osWorkers = [];
    w.clock.advance(SEC);
    validate(w, idOf("a"));
    expect(reasonsOf(w)).toEqual(expect.arrayContaining(["worker.missing", "worker.profileMissing"]));
    const blockedOs = world();
    blockedOs.facts.osWorkers = [os("w1", { status: "Blocked" })];
    check(blockedOs);
    blocked(blockedOs, "worker.blocked");
    const specialty = world();
    specialty.facts.osWorkers = [os("w1", { specialty: "finance" })];
    check(specialty);
    blocked(specialty, "worker.specialty");
  });
  it("permissions, capabilities and tools: only what the worker declares", () => {
    const a = world();
    a.facts.osWorkers = [os("w1", { permissions: ["crm.*"] })];
    check(a);
    blocked(a, "action.denied");
    const b = world();
    b.facts.osWorkers = [os("w1", { capabilities: ["write"] })];
    check(b);
    blocked(b, "capability.missing");
    const c = world();
    c.facts.osWorkers = [os("w1", { tools: ["Email"] })];
    check(c);
    blocked(c, "tool.missing");
  });
  it("version: the Worker Runtime and the Worker OS must agree, and the version must be accepted", () => {
    const a = world();
    a.facts.runtimeWorkers = [rw("w1", { version: "1.3.0" })];
    check(a);
    blocked(a, "version.mismatch");
    const b = world();
    b.facts.runtimeWorkers = [rw("w1", { version: "0.9.0" })];
    b.facts.osWorkers = [os("w1", { version: "0.9.0" })];
    check(b);
    blocked(b, "version.minimum");
    const c = world();
    c.facts.runtimeWorkers = [rw("w1", { version: "latest" })];
    check(c);
    blocked(c, "version.mismatch");
  });
  it("state of the step and of the plan, and a request that no longer says what the plan says", () => {
    const a = world();
    a.facts.plans = [plan("p", [step("a", { state: "running" })])];
    check(a);
    blocked(a, "step.state");
    const b = world();
    b.facts.plans = [plan("p", [step("a")], { status: "Paused" })];
    check(b);
    blocked(b, "plan.paused");
    const c = world();
    submit(c);
    c.facts.plans = [plan("p", [step("a", { actionId: "crm.update" })])];
    c.clock.advance(SEC);
    validate(c, idOf("a"));
    blocked(c, "request.stale");
  });
  it("reports EVERY failure, not just the first", () => {
    const w = world();
    w.facts.runtimeWorkers = [rw("w1", { state: "Offline", current: 5 })];
    w.facts.osWorkers = [os("w1", { permissions: [], tools: [] })];
    check(w);
    expect(reasonsOf(w)).toEqual(["worker.state", "worker.capacity", "action.denied", "tool.missing"]);
    expect(rec(w, idOf("a")).state).toBe("Blocked");
  });
  it("a blocked request recovers when the cause is fixed, and goes back to Blocked when it returns", () => {
    const w = world();
    w.facts.runtimeWorkers = [rw("w1", { state: "Offline" })];
    check(w);
    expect(rec(w, idOf("a")).state).toBe("Blocked");
    w.facts.runtimeWorkers = [rw("w1")];
    w.clock.advance(SEC);
    expect(validate(w, idOf("a")).state).toBe("Ready");
    w.facts.runtimeWorkers = [rw("w1", { state: "Failed" })];
    w.clock.advance(SEC);
    expect(validate(w, idOf("a")).state).toBe("Blocked");
    expect(w.gw.dispatch(system())).toEqual([]);
  });
});

describe("Approval: the gateway validates it and never grants it", () => {
  it("a plan not yet approved leaves the request WaitingApproval, and approval makes it Ready", () => {
    const w = world();
    w.facts.plans = [plan("p", [step("a")], { status: "WaitingApproval" })];
    const waiting = check(w);
    expect(waiting.state).toBe("WaitingApproval");
    expect(waiting.reasons).toEqual(["approval.pending"]);
    expect(waiting.request.approvedBy).toBeNull(); // nobody has approved it yet: nothing is invented
    w.facts.plans = [plan("p", [step("a")], { status: "Draft", decidedBy: undefined as never })];
    w.facts.plans = [{ planId: "p", tenantId: T1, status: "Draft", priority: "normal", dependsOn: [], steps: [step("a")] }];
    w.clock.advance(SEC);
    expect(validate(w, idOf("a")).request.approvedBy).toBeNull();
    w.facts.plans = [plan("p", [step("a")])];
    w.clock.advance(SEC);
    const ready = validate(w, idOf("a"));
    expect(ready.state).toBe("Ready");
    expect(ready.request.approvedBy).toBe("adela");
  });
  it("level 1, 2 and 3 ask for a member, a manager and an administrator", () => {
    expect(requiredRole({ level: 1, approverRole: "member" })).toBe("member");
    expect(requiredRole({ level: 2, approverRole: "manager" })).toBe("manager");
    expect(requiredRole({ level: 3, approverRole: "admin" })).toBe("admin");
    expect(requiredRole({ level: 3, approverRole: "member" })).toBe("admin"); // a step can never ask for less than its level
    expect(requiredRole({ level: 1, approverRole: "admin" })).toBe("admin"); // and may ask for more
    expect(requiredRole({ level: 7, approverRole: "member" })).toBe("admin"); // an unknown level fails closed
    const cases: [number, "member" | "manager" | "admin", string, boolean][] = [
      [1, "member", "mario", true], [1, "member", "vera", false], [2, "manager", "mario", false], [2, "manager", "marta", true], [3, "admin", "marta", false], [3, "admin", "adela", true], [3, "admin", "ana", true],
    ];
    for (const [level, approverRole, approver, allowed] of cases) {
      const w = world();
      w.facts.plans = [plan("p", [step("a", { level, approverRole, retry: { maxAttempts: 1, backoffMs: 1_000 } })], { decidedBy: approver })];
      check(w);
      expect(rec(w, idOf("a")).state, `${level} ${approver}`).toBe(allowed ? "Ready" : "Blocked");
      if (!allowed) expect(reasonsOf(w)).toEqual(["role.insufficient"]);
    }
  });
  it("only a PERSON counts: the system, a worker and NEX approve nothing", () => {
    for (const approver of ["system", "w1", "nex", "ghost"]) {
      const w = world();
      w.facts.plans = [plan("p", [step("a")], { decidedBy: approver })];
      check(w);
      expect(rec(w, idOf("a")).state, approver).toBe("Blocked");
      expect(reasonsOf(w), approver).toEqual(["role.notPerson"]);
    }
    const w = world();
    w.facts.plans = [plan("p", [step("a")], { decidedBy: undefined as never })];
    w.facts.plans = [{ planId: "p", tenantId: T1, status: "Approved", priority: "normal", dependsOn: [], steps: [step("a")] }];
    check(w);
    expect(reasonsOf(w)).toEqual(["role.noApprover"]);
  });
  it("a closed plan rejects the request for good", () => {
    for (const status of ["Rejected", "Cancelled", "Expired", "Completed"] as const) {
      const w = world();
      w.facts.plans = [plan("p", [step("a")], { status })];
      check(w);
      expect(rec(w, idOf("a")).state, status).toBe("Rejected");
      expect(reasonsOf(w)).toContain("plan.closed");
    }
  });
  it("never changes an authorization: the facts it reads are left exactly as they were", () => {
    const deepFreeze = <T,>(value: T): T => { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; };
    const facts = deepFreeze({ plans: [plan("p", [step("a")], { status: "WaitingApproval" })], runtimeWorkers: [rw("w1")], osWorkers: [os("w1")] });
    const before = JSON.stringify(facts);
    const sources: GatewaySources = { ...facts, roleOf: (id) => ROLES[id] };
    let state = newGatewayState();
    for (const event of [
      { type: "submit", actor: system(), tenantId: T1, at: iso(START), spec: { planId: "p", stepId: "a", workerId: "w1" } },
      { type: "validate", actor: system(), tenantId: T1, at: iso(START + SEC), requestId: "er:p:a" },
    ] as GatewayEvent[]) state = reduceGateway(state, event, sources).state;
    expect(JSON.stringify(facts)).toBe(before);
    expect(state.requests[0]).toMatchObject({ state: "WaitingApproval" });
  });
  it("only the system or a manager operate the gateway; a worker, NEX, a member and a viewer never", () => {
    const w = world();
    submit(w);
    for (const actor of [wk("w1"), nex(), mario, vera]) {
      expect(w.gw.submit(actor, T1, { planId: "p", stepId: "b", workerId: "w1" }).refusal, JSON.stringify(actor)).toBe("forbidden");
      expect(w.gw.validate(actor, T1, idOf("a")).refusal).toBe("forbidden");
      expect(w.gw.cancel(actor, T1, idOf("a")).refusal).toBe("forbidden");
      expect(w.gw.tick(actor, T1).refusal).toBe("forbidden");
    }
    ok(w.gw.validate(marta, T1, idOf("a")));
    expect(rec(w, idOf("a")).state).toBe("Ready");
  });
});

describe("Priorities", () => {
  it("are critical, high, normal, low and background, in a fixed order", () => {
    expect([...PRIORITIES]).toEqual(["critical", "high", "normal", "low", "background"]);
  });
  it("serves Ready requests by priority, then who asked first, then id", () => {
    const w = world();
    w.facts.runtimeWorkers = [rw("w1", { maxConcurrent: 9 })];
    const steps = ["s1", "s2", "s3", "s4", "s5", "s6"].map((id) => step(id));
    w.facts.plans = [plan("p", steps, { priority: "critical" })];
    for (const [id, priority] of [["s1", "low"], ["s2", "critical"], ["s3", "background"], ["s4", "high"], ["s5", "normal"], ["s6", "critical"]] as const) { w.clock.advance(SEC); submit(w, id, { priority }); }
    w.clock.advance(SEC);
    for (const id of ["s1", "s2", "s3", "s4", "s5", "s6"]) validate(w, idOf(id));
    expect(w.gw.dispatch(system()).map((request) => request.stepId)).toEqual(["s2", "s6", "s4", "s5", "s1", "s3"]);
  });
  it("is deterministic: the same ties always come out the same way", () => {
    const rows = [
      { request: { requestId: "b", priority: "normal" as const, requestedAt: "2" } }, { request: { requestId: "a", priority: "normal" as const, requestedAt: "2" } },
      { request: { requestId: "c", priority: "normal" as const, requestedAt: "1" } }, { request: { requestId: "d", priority: "critical" as const, requestedAt: "9" } },
    ];
    expect(requestOrder(rows).map((row) => row.request.requestId)).toEqual(["d", "c", "a", "b"]);
    expect(requestOrder([...rows].reverse()).map((row) => row.request.requestId)).toEqual(["d", "c", "a", "b"]);
  });
  it("a request can lower its priority but never raise it above the plan's", () => {
    const w = world();
    expect(check(w, "a", { priority: "low" }).state).toBe("Ready");
    const e = world();
    e.facts.plans = [plan("p", [step("a")], { priority: "low" })];
    check(e, "a", { priority: "critical" });
    expect(rec(e, idOf("a")).state).toBe("Blocked");
    expect(reasonsOf(e)).toEqual(["priority.escalation"]);
  });
});

describe("Dependencies", () => {
  it("a step may only run when its dependencies finished correctly; a dead dependency rejects", () => {
    for (const [state, expected, code] of [["completed", "Ready", ""], ["pending", "Blocked", "dependency.pending"], ["running", "Blocked", "dependency.pending"], ["ready", "Blocked", "dependency.pending"], ["failed", "Rejected", "dependency.failed"], ["skipped", "Rejected", "dependency.failed"]] as const) {
      const w = world();
      w.facts.plans = [plan("p", [step("a", { state }), step("b", { dependsOn: ["a"] })])];
      check(w, "b");
      expect(rec(w, idOf("b")).state, state).toBe(expected);
      if (code) expect(reasonsOf(w, "b")).toEqual([code]);
    }
    const missing = world();
    missing.facts.plans = [plan("p", [step("b", { dependsOn: ["ghost"] })])];
    check(missing, "b");
    expect(reasonsOf(missing, "b")).toEqual(["dependency.missing"]);
  });
  it("all dependencies count, not only the first", () => {
    const w = world();
    w.facts.plans = [plan("p", [step("a", { state: "completed" }), step("c", { state: "pending" }), step("b", { dependsOn: ["a", "c"] })])];
    check(w, "b");
    expect(reasonsOf(w, "b")).toEqual(["dependency.pending"]);
  });
  it("a plan waits for the plans it depends on, within its own company", () => {
    const run = (other: PlanFact | undefined) => {
      const w = world();
      w.facts.plans = [plan("p", [step("a")], { dependsOn: ["x"] }), ...(other ? [other] : [])];
      check(w);
      return w;
    };
    expect(rec(run(plan("x", [], { status: "Completed" })), idOf("a")).state).toBe("Ready");
    expect(reasonsOf(run(plan("x", [], { status: "Running" })))).toEqual(["dependency.planPending"]);
    expect(rec(run(plan("x", [], { status: "Cancelled" })), idOf("a")).state).toBe("Rejected");
    expect(reasonsOf(run(undefined))).toEqual(["dependency.planMissing"]);
    expect(reasonsOf(run(plan("x", [], { status: "Completed" }, T2)))).toEqual(["dependency.planMissing"]); // another company's plan does not exist
  });
});

describe("Timeout", () => {
  const withTimeout = (timeoutMs: number, extra: { plan?: Partial<PlanFact>; limits?: number } = {}) => {
    const w = world();
    w.facts.plans = [plan("p", [step("a", { timeoutMs })], extra.plan)];
    if (extra.limits !== undefined) w.facts.osWorkers = [os("w1", { limits: { timeoutMs: extra.limits } })];
    check(w);
    return w;
  };
  it("is checked against the minimum, the maximum, the company, the plan and the worker", () => {
    expect(reasonsOf(withTimeout(500))).toEqual(["timeout.min"]);
    expect(reasonsOf(withTimeout(4_000_000, { limits: 5_000_000 }))).toEqual(["timeout.max", "timeout.company"]);
    expect(reasonsOf(withTimeout(1_900_000, { limits: 5_000_000 }))).toEqual(["timeout.company"]);
    expect(reasonsOf(withTimeout(60_000, { plan: { timeoutMs: 30_000 } }))).toEqual(["timeout.plan"]);
    expect(reasonsOf(withTimeout(60_000, { limits: 30_000 }))).toEqual(["timeout.worker"]);
    expect(rec(withTimeout(60_000, { plan: { timeoutMs: 60_000 }, limits: 60_000 }), idOf("a")).state).toBe("Ready");
    expect(rec(withTimeout(1_000), idOf("a")).state).toBe("Ready");
  });
  it("the company limit comes from the configuration", () => {
    const w = world({ companyMaxTimeoutMs: 10_000 });
    check(w);
    expect(reasonsOf(w)).toEqual(["timeout.company"]);
  });
});

describe("Retry policy: only retryable errors", () => {
  it("is always retryable-only, bounded, and never retries a fatal error", () => {
    const w = world();
    w.facts.plans = [plan("p", [step("a", { retry: { maxAttempts: 3, backoffMs: 500 } })])];
    expect(check(w).request.retryPolicy).toEqual({ maxAttempts: 3, backoffMs: 500, retryOn: "retryable" });
    expect(rec(w, idOf("a")).state).toBe("Ready");
    const tooMany = world();
    tooMany.facts.plans = [plan("p", [step("a", { retry: { maxAttempts: 9, backoffMs: 500 } })])];
    check(tooMany);
    expect(reasonsOf(tooMany)).toEqual(["retry.bounds"]);
    const negative = world();
    negative.facts.plans = [plan("p", [step("a", { retry: { maxAttempts: 2, backoffMs: -1 } })])];
    check(negative);
    expect(reasonsOf(negative)).toEqual(["retry.bounds"]);
    const fatal = world();
    fatal.facts.plans = [plan("p", [step("a", { retry: { maxAttempts: 2, backoffMs: 500, retryFatal: true } })])];
    check(fatal);
    expect(rec(fatal, idOf("a")).state).toBe("Rejected");
    expect(reasonsOf(fatal)).toEqual(["retry.fatal"]);
  });
  it("a Level 3 step is never retried", () => {
    const w = world();
    w.facts.plans = [plan("p", [step("a", { level: 3, approverRole: "admin", actionId: "followup.send", retry: { maxAttempts: 2, backoffMs: 500 } })])];
    check(w);
    expect(reasonsOf(w)).toEqual(["retry.level3"]);
    const one = world();
    one.facts.plans = [plan("p", [step("a", { level: 3, approverRole: "admin", actionId: "followup.send" })])];
    expect(check(one).state).toBe("Ready");
  });
});

describe("Policy engine: evaluated, never executed", () => {
  const request = { companyId: T1, workerId: "w1", actionId: "task.create" };
  const good = () => ({ request, plan: plan("p", [step("a")]), step: step("a"), runtime: rw("w1"), profile: os("w1"), roleOf: (id: string) => ROLES[id] });
  it("allows what is in order, and collects every violation of the seven dimensions otherwise", () => {
    expect(evaluatePolicy(good())).toEqual({ allowed: true, violations: [], approval: "approved", approvedBy: "adela" });
    const ctx = good();
    const bad = evaluatePolicy({
      ...ctx, plan: plan("p", [step("a")], { decidedBy: "mario" }, T2), step: step("a", { level: 2, approverRole: "manager", tools: ["Billing"], capabilities: ["approve"], actionId: "payment.refund" }),
      runtime: rw("w1", { state: "Paused" }), profile: os("w1", { status: "Blocked" }),
    });
    expect(bad.violations.map((violation) => violation.code)).toEqual(["company.mismatch", "worker.state", "worker.blocked", "action.denied", "tool.missing", "capability.missing", "role.insufficient"]);
    expect(bad.allowed).toBe(false);
    expect(bad.violations[0]).toEqual({ code: "company.mismatch", permanent: true });
  });
  it("matches exact actions, families and the star", () => {
    expect(permits(["*"], "any.thing")).toBe(true);
    expect(permits(["crm.*"], "crm.update")).toBe(true);
    expect(permits(["crm.*"], "crmx.update")).toBe(false);
    expect(permits([], "crm.read")).toBe(false);
  });
  it("is deterministic and runs nothing", () => {
    expect(evaluatePolicy(good())).toEqual(evaluatePolicy(good()));
    const verdict = validateRequest(buildRequestFor(), { plans: [plan("p", [step("a")])], runtimeWorkers: [rw("w1")], osWorkers: [os("w1")], roleOf: (id) => ROLES[id] }, DEFAULT_CONFIG);
    expect(verdict.outcome).toBe("ready");
  });
  function buildRequestFor() {
    const built = buildRequest({ planId: "p", stepId: "a", workerId: "w1" }, T1, iso(START), { plans: [plan("p", [step("a")])], runtimeWorkers: [rw("w1")], osWorkers: [os("w1")] });
    if (!built.ok) throw new Error("not built");
    return built.request;
  }
});

describe("Cancellation and expiry", () => {
  it("cancels an open request, and a finished one cannot be cancelled or submitted again", () => {
    const w = world();
    check(w);
    ok(w.gw.cancel(marta, T1, idOf("a")));
    expect(rec(w, idOf("a")).state).toBe("Cancelled");
    expect(w.gw.dispatch(system())).toEqual([]);
    expect(w.gw.cancel(marta, T1, idOf("a")).refusal).toBe("state");
    expect(w.gw.validate(system(), T1, idOf("a")).refusal).toBe("state");
    expect(w.gw.submit(system(), T1, { planId: "p", stepId: "a", workerId: "w1" }).refusal).toBe("exists");
    expect(w.gw.cancel(marta, T1, "er:nothing").refusal).toBe("notFound");
  });
  it("expires open requests after their time and leaves finished ones alone", () => {
    const w = world({ requestTtlMs: 10 * MIN });
    check(w, "a");
    submit(w, "b");
    ok(w.gw.cancel(marta, T1, idOf("b")));
    w.clock.advance(9 * MIN);
    expect(w.gw.tick(system(), T1).records).toEqual([]);
    w.clock.advance(2 * MIN);
    const expired = w.gw.tick(system(), T1);
    expect(expired.records!.map((row) => row.request.requestId)).toEqual([idOf("a")]);
    expect(rec(w, idOf("a")).state).toBe("Expired");
    expect(rec(w, idOf("b")).state).toBe("Cancelled");
    expect(w.gw.tick(system(), T1).records).toEqual([]);
    expect(w.gw.audit(T1).some((entry) => entry.action === "request.expired")).toBe(true);
  });
});

describe("Audit, observability and Event Bus", () => {
  it("records creation, validation, rejection, cancellation and expiry, with every transition and refusal", () => {
    const w = world({ requestTtlMs: 10 * MIN });
    w.facts.plans = [plan("p", [step("a"), step("r", { state: "pending", retry: { maxAttempts: 2, backoffMs: 1, retryFatal: true } }), step("c"), step("e")])];
    for (const id of ["a", "r", "c", "e"]) check(w, id);
    ok(w.gw.cancel(marta, T1, idOf("c")));
    w.gw.submit(vera, T1, { planId: "p", stepId: "a", workerId: "w1" });
    w.clock.advance(11 * MIN);
    w.gw.tick(system(), T1);
    const actions = new Set(w.gw.audit(T1).map((entry) => entry.action));
    for (const action of ["request.created", "request.validated", "request.rejected", "request.cancelled", "request.expired", "request.transition", "submit.refused"]) expect(actions.has(action), action).toBe(true);
    expect(w.gw.audit(T1).every((entry) => entry.tenantId === T1)).toBe(true);
    expect(w.gw.audit(T2)).toEqual([]);
    expect(w.gw.audit(T1).filter((entry) => entry.action === "request.transition")).toHaveLength(w.gw.log.ofType("request.transition").length);
  });
  it("counts per company with ids and numbers only, never content", () => {
    const w = world();
    w.facts.runtimeWorkers = [rw("w1", { state: "Offline" })];
    check(w, "a");
    w.gw.dispatch(system());
    w.gw.dashboard(ana);
    w.gw.submit(vera, T1, { planId: "p", stepId: "b", workerId: "w1" });
    const snapshot = w.gw.snapshot(T1);
    expect(snapshot.counters).toMatchObject({ created: 1, validated: 1, blocked: 1, failures: 1, dispatches: 1, dashboards: 1, refused: 1 });
    expect(snapshot.byFailure).toEqual({ "worker.state": 1 });
    expect(snapshot.byTransition).toEqual({ "Pending>Blocked": 1 });
    expect(snapshot.refusals["forbidden"]).toBe(1);
    expect(snapshot.requests).toEqual({ total: 1, byState: { Blocked: 1 } });
    expect(w.gw.snapshot(T2).counters).toMatchObject({ created: 0, failures: 0 });
    expect(w.gw.log.forTenant(T2)).toEqual([]);
    expect(JSON.stringify([w.gw.log.all(), w.gw.exportState().audit, snapshot])).not.toMatch(/prompt|memoria|contexto|respuesta/i);
  });
  it("drops free text before an event is kept", () => {
    expect(sanitizeDetail({ note: "texto libre con espacios", prompt: "dame los datos", ok: true, n: 3.14159, code: "worker.state", from: "Pending" })).toEqual({ ok: true, n: 3.14, code: "worker.state", from: "Pending" });
    const log = new GatewayEventLog();
    const event = log.emit({ at: iso(START), tenantId: T1, actorKind: "system", actorId: "system", type: "gateway.refused", requestId: "con espacios", detail: { memory: "mi memoria privada" } });
    expect(event.requestId).toBeUndefined();
    expect(event.detail).toBeUndefined();
  });
  it("prepares messages for the future Event Bus without publishing anything", () => {
    const w = world();
    check(w);
    const message = toBusMessage(w.gw.log.ofType("request.created")[0]!);
    expect(message).toMatchObject({ topic: "execution-gateway.request", tenantId: T1, key: "er:p:a", data: { type: "request.created", priority: "normal" } });
    expect(toBusMessage(w.gw.log.ofType("request.ready")[0]!).topic).toBe("execution-gateway.request");
    w.gw.dispatch(system());
    expect(toBusMessage(w.gw.log.ofType("gateway.dispatched")[0]!).topic).toBe("execution-gateway.gateway");
    expect(w.gw.log.toAudit(T1).length).toBeGreaterThan(0);
  });
  it("observability can be detached", () => {
    const log = new GatewayEventLog();
    const observability = new GatewayObservability(log);
    log.emit({ at: iso(START), tenantId: T1, actorKind: "system", actorId: "system", type: "gateway.dashboard" });
    observability.stop();
    log.emit({ at: iso(START), tenantId: T1, actorKind: "system", actorId: "system", type: "gateway.dashboard" });
    expect(observability.snapshot(T1).counters.dashboards).toBe(1);
  });
  it("declares the future tables with company scope and row level security, and creates no migration", () => {
    expect(FUTURE_TABLES.map((table) => table.name)).toEqual(["gateway_requests", "gateway_validations", "gateway_audit"]);
    expect(FUTURE_TABLES.every((table) => table.tenantScoped && table.policy.length > 0)).toBe(true);
    const dir = join(process.cwd(), "supabase", "migrations");
    if (existsSync(dir)) for (const name of readdirSync(dir)) expect(readFileSync(join(dir, name), "utf8"), name).not.toMatch(/gateway_requests|gateway_validations|gateway_audit/);
  });
});

describe("Dashboard", () => {
  function fleet() {
    const w = world();
    w.facts.runtimeWorkers = [rw("w1", { maxConcurrent: 9 }), rw("w2", { version: "1.3.0", maxConcurrent: 9 })];
    w.facts.osWorkers = [os("w1"), os("w2", { version: "1.3.0" })];
    w.facts.plans = [
      plan("p", [step("a"), step("b", { dependsOn: ["a"] })], { priority: "high" }),
      plan("q", [step("x", { state: "failed" }), step("y", { dependsOn: ["x"] })]),
      plan("r", [step("z")], { priority: "low", status: "WaitingApproval" }),
    ];
    const go = (planId: string, stepId: string, workerId: string) => { ok(w.gw.submit(system(), T1, { planId, stepId, workerId })); };
    go("p", "a", "w1"); go("p", "b", "w1"); go("q", "y", "w2"); go("r", "z", "w1");
    w.clock.advance(SEC);
    for (const id of ["er:p:a", "er:p:b", "er:q:y", "er:r:z"]) validate(w, id);
    w.clock.advance(SEC);
    return w;
  }
  it("counts requests, Ready, Blocked, Rejected, pending, times, priorities, errors and versions", () => {
    const d = fleet().gw.dashboard(ana);
    expect(d.requests).toEqual({ total: 4, byState: { Pending: 0, Validated: 0, WaitingApproval: 1, Ready: 1, Blocked: 1, Rejected: 1, Cancelled: 0, Expired: 0 } });
    expect(d.ready).toEqual({ total: 1, next: ["er:p:a"] });
    expect(d.blocked).toEqual({ total: 1, byReason: { "dependency.pending": 1 } });
    expect(d.rejected).toEqual({ total: 1, byReason: { "dependency.failed": 1 } });
    expect(d.pending).toEqual({ total: 1, pending: 0, validated: 0, waitingApproval: 1 });
    expect(d.averageMs.toValidate).toBe(1_000);
    expect(d.averageMs.openAge).toBe(2_000);
    expect(d.priorities).toEqual({ critical: 0, high: 2, normal: 1, low: 1, background: 0 });
    expect(d.errors).toEqual({ "dependency.pending": 1, "dependency.failed": 1 });
    expect(d.versions).toEqual({ "1.2.0": 3, "1.3.0": 1 });
  });
  it("is isolated by company and never shows another company's requests", () => {
    const w = fleet();
    const other = w.gw.dashboard(luis);
    expect(other.requests.total).toBe(0);
    expect(JSON.stringify(other)).not.toMatch(/er:/);
    expect(w.gw.dashboard(ana).requests.total).toBe(4);
    expect(w.gw.log.ofType("gateway.dashboard")).toHaveLength(2);
  });
  it("builds from plain data with no engine, ignoring other companies' rows", () => {
    const d = buildGatewayDashboard({ tenantId: T1, at: iso(START), requests: [] });
    expect(d.requests.total).toBe(0);
    expect(d.averageMs).toEqual({ toValidate: 0, openAge: 0 });
  });
});

describe("Multitenancy: requests are never mixed", () => {
  function twoCompanies() {
    const w = world();
    w.facts.plans = [plan("p", [step("a")]), plan("p", [step("a")], { priority: "high", decidedBy: "luis" }, T2)];
    w.facts.runtimeWorkers = [rw("w1"), rw("w1", { version: "1.2.0" }, T2)];
    w.facts.osWorkers = [os("w1"), os("w1", {}, T2)];
    return w;
  }
  it("the same plan, step and worker ids live in both companies without touching each other", () => {
    const w = twoCompanies();
    ok(w.gw.submit(system(), T1, { planId: "p", stepId: "a", workerId: "w1" }));
    ok(w.gw.submit(system(T2), T2, { planId: "p", stepId: "a", workerId: "w1" }));
    expect(rec(w, "er:p:a", T1).request).toMatchObject({ companyId: T1, priority: "normal", approvedBy: "adela" });
    expect(rec(w, "er:p:a", T2).request).toMatchObject({ companyId: T2, priority: "high", approvedBy: "luis" });
    w.clock.advance(SEC);
    ok(w.gw.validate(system(T2), T2, "er:p:a"));
    expect(rec(w, "er:p:a", T1).state).toBe("Pending");
    expect(rec(w, "er:p:a", T2).state).toBe("Ready");
    expect(w.gw.dispatch(system(T1))).toEqual([]);
    expect(w.gw.dispatch(system(T2)).map((request) => request.companyId)).toEqual([T2]);
  });
  it("a company never reaches another's request, and cannot claim a company that is not its own", () => {
    const w = twoCompanies();
    submit(w, "a");
    expect(w.gw.validate(system(T2), T2, "er:p:b").refusal).toBe("notFound");
    expect(w.gw.cancel(luis, T2, "er:p:a").refusal).toBe("notFound");
    expect(w.gw.validate(luis, T1, "er:p:a").refusal).toBe("tenant");
    expect(w.gw.submit(system(T2), T1, { planId: "p", stepId: "a", workerId: "w1" }).refusal).toBe("tenant");
    expect(rec(w, "er:p:a").state).toBe("Pending");
  });
  it("only the company's own facts exist: another company's plan, worker or profile cannot satisfy a request", () => {
    const w = world();
    w.facts.plans = [plan("p", [step("a")], {}, T2)];
    expect(w.gw.submit(system(), T1, { planId: "p", stepId: "a", workerId: "w1" }).reasons).toEqual(["plan"]);
    w.facts.plans = [plan("p", [step("a")])];
    w.facts.runtimeWorkers = [rw("w1", {}, T2)];
    expect(w.gw.submit(system(), T1, { planId: "p", stepId: "a", workerId: "w1" }).reasons).toEqual(["worker"]);
  });
  it("a tick of one company expires nothing of another's", () => {
    const w = twoCompanies();
    ok(w.gw.submit(system(), T1, { planId: "p", stepId: "a", workerId: "w1" }));
    ok(w.gw.submit(system(T2), T2, { planId: "p", stepId: "a", workerId: "w1" }));
    w.clock.advance(2 * 60 * MIN);
    ok(w.gw.tick(system(T2), T2));
    expect(rec(w, "er:p:a", T2).state).toBe("Expired");
    expect(rec(w, "er:p:a", T1).state).toBe("Pending");
  });
});

describe("Determinism and purity", () => {
  const script = (w: World) => {
    w.facts.plans = [plan("p", [step("a"), step("b", { dependsOn: ["a"] }), step("c", { retry: { maxAttempts: 2, backoffMs: 1, retryFatal: true } })], { priority: "high" })];
    for (const id of ["a", "b", "c"]) { w.clock.advance(SEC); submit(w, id); }
    w.clock.advance(SEC);
    w.gw.validateAll(system(), T1);
    w.facts.plans = [plan("p", [step("a", { state: "completed" }), step("b", { dependsOn: ["a"] }), step("c")], { priority: "high" })];
    w.clock.advance(SEC);
    w.gw.validateAll(marta, T1);
    ok(w.gw.cancel(marta, T1, idOf("b")));
    w.gw.dispatch(system());
    w.gw.dashboard(ana);
    w.clock.advance(2 * 60 * MIN);
    w.gw.tick(system(), T1);
  };
  it("the same script in two worlds gives the same state, log and numbers", () => {
    const a = world();
    const b = world();
    script(a);
    script(b);
    expect(a.gw.exportState()).toEqual(b.gw.exportState());
    expect(a.gw.log.all()).toEqual(b.gw.log.all());
    expect(a.gw.snapshot(T1)).toEqual(b.gw.snapshot(T1));
    expect(a.gw.dashboard(ana)).toEqual(b.gw.dashboard(ana));
  });
  it("the reducer does not mutate its inputs and gives the same answer twice", () => {
    const deepFreeze = <T,>(value: T): T => { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; };
    const sources: GatewaySources = deepFreeze({ plans: [plan("p", [step("a")])], runtimeWorkers: [rw("w1")], osWorkers: [os("w1")], roleOf: (id: string) => ROLES[id] });
    let state = newGatewayState();
    const events: GatewayEvent[] = [
      { type: "submit", actor: system(), tenantId: T1, at: iso(START), spec: { planId: "p", stepId: "a", workerId: "w1" } },
      { type: "validate", actor: system(), tenantId: T1, at: iso(START + SEC), requestId: "er:p:a" },
      { type: "cancel", actor: marta, tenantId: T1, at: iso(START + 2 * SEC), requestId: "er:p:a" },
      { type: "tick", actor: system(), tenantId: T1, at: iso(START + 3 * SEC) },
    ];
    for (const event of events) {
      deepFreeze(state);
      deepFreeze(event);
      const one = reduceGateway(state, event, sources);
      const two = reduceGateway(state, event, sources);
      expect(one).toEqual(two);
      expect(one.result.ok, `${event.type} ${one.result.refusal}`).toBe(true);
      state = one.state;
    }
    expect(state.requests[0]!.state).toBe("Cancelled");
  });
  it("a bad instant is refused, never guessed", () => {
    const result = reduceGateway(newGatewayState(), { type: "tick", actor: system(), tenantId: T1, at: "mañana" }, { plans: [], runtimeWorkers: [], osWorkers: [], roleOf: () => undefined });
    expect(result.result.refusal).toBe("invalid");
  });
});

describe("Pure and isolated: nothing is executed", () => {
  const dir = join(process.cwd(), "lib", "nex", "execution-gateway");
  const FILES = [
    "execution-gateway-dashboard.ts", "execution-gateway-dispatcher.ts", "execution-gateway-events.ts", "execution-gateway-observability.ts", "execution-gateway-policy.ts", "execution-gateway-reducer.ts",
    "execution-gateway-types.ts", "execution-gateway-validator.ts", "execution-gateway.ts", "index.ts",
  ];
  const code = (name: string) => readFileSync(join(dir, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
  it("has exactly the ten files of the layer", () => {
    for (const name of FILES) expect(existsSync(join(dir, name)), name).toBe(true);
    expect(readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).sort()).toEqual([...FILES].sort());
  });
  it("reads no clock, no randomness, no network, no environment, no database and no AI", () => {
    for (const name of FILES) {
      const source = code(name);
      expect(source, name).not.toMatch(/Date\.now|new Date\(\)|Math\.random|performance\.now|setTimeout|setInterval|\bfetch\(|XMLHttpRequest|WebSocket|process\.env|randomUUID|supabase|createClient|openai|anthropic|workers-ai|AI_GATEWAY|docker|kubernetes/i);
      expect(source, name).not.toMatch(/from "@\/|from "node:|from "react|from "next/);
    }
  });
  it("imports only its own files", () => {
    for (const name of FILES) for (const match of code(name).matchAll(/from "([^"]+)"/g)) expect(match[1]!.startsWith("./"), `${name}: ${match[1]}`).toBe(true);
  });
  it("calls no Runtime, Connector, Worker, provider, bus or other layer, and approves nothing", () => {
    for (const name of FILES) expect(code(name), name).not.toMatch(/ADAPTERS|adapter\.|\.execute\(|executeAction|runAction|runStep|callWorker|callConnector|callTool|\.invoke\(|\.connect\(|reduceKoe|reduceConnectors|reduceMemory|reduceKnowledge|reduceCopilot|reduceRag|reduceExecution|reduceWorkerRuntime|reduceWorkerOs|reduceRuntime\b|\.ask\(|\.remember\(|\.subscribe\(|\.publish\(|lib\/nex|lib\/backend|\.approve\(|approvedBy\s*[:=]\s*(who|actor|name)/);
  });
  it("is used by nothing else in the repository yet", () => {
    const importers: string[] = [];
    const walk = (folder: string) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (["node_modules", ".next", ".git", ".open-next"].includes(entry.name)) continue;
        const path = join(folder, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name) && !path.includes(join("lib", "nex", "execution-gateway")) && !path.includes("execution-bridge") && /lib\/nex\/execution-gateway/.test(readFileSync(path, "utf8"))) importers.push(path);
      }
    };
    for (const folder of ["app", "lib", "components"]) walk(join(process.cwd(), folder));
    expect(importers).toEqual([]);
  });
});
