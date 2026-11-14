/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONFIG, FUTURE_TABLES, WORKER_STATES, WORKER_TRANSITIONS, WorkerEventLog, WorkerRuntimeEngine, WorkerRuntimeObservability, backoffFor, buildWorkerRuntimeDashboard, canTransition, compareVersions, eligibility,
  healthBand, healthParts, healthScore, newWorkerRuntimeState, permits, planAssignments, reduceWorkerRuntime, retryDecision, sanitizeDetail, toBusMessage, validateHeartbeat,
  type Heartbeat, type Principal, type TaskSpec, type WorkerRecord, type WorkerRuntimeEvent, type WorkerSpec, type WorkerState,
} from "./index";

const T1 = "tenant-nova";
const T2 = "tenant-vida";
const START = Date.parse("2026-11-13T10:00:00.000Z");
const SEC = 1_000;
const person = (tenantId: string, id: string, role: "viewer" | "member" | "manager" | "admin" | "owner"): Principal => ({ kind: "person", tenantId, id, role });
const ana = person(T1, "ana", "owner");
const adela = person(T1, "adela", "admin");
const marta = person(T1, "marta", "manager");
const mario = person(T1, "mario", "member");
const vera = person(T1, "vera", "viewer");
const luis = person(T2, "luis", "owner");
const system = (tenantId = T1): Principal => ({ kind: "system", tenantId });
const nex = (tenantId = T1): Principal => ({ kind: "nex", tenantId });
const wk = (id: string, tenantId = T1): Principal => ({ kind: "worker", tenantId, id });

const spec = (id: string, over: Partial<WorkerSpec> = {}): WorkerSpec => ({ id, name: "SECRETO-NOMBRE", specialty: "sales", permissions: ["*"], version: "1.2.0", build: "b100", capabilities: ["email"], maxConcurrent: 2, queueLimit: 1, ...over });
const job = (id: string, over: Partial<TaskSpec> = {}): TaskSpec => ({ id, specialty: "sales", action: "task.create", priority: "normal", ...over });

function world(config: Partial<typeof DEFAULT_CONFIG> = {}) {
  const clock = { t: START, advance(ms: number) { this.t += ms; } };
  const engine = new WorkerRuntimeEngine({ now: () => clock.t, config });
  return { clock, engine };
}
type World = ReturnType<typeof world>;
const ok = (result: { ok: boolean; refusal?: string; reasons?: readonly string[] }, label = "") => expect(result.ok, `${label} ${result.refusal} ${result.reasons}`).toBe(true);
const iso = (ms: number) => new Date(ms).toISOString();
const beatOf = (w: World, id: string, over: Partial<Heartbeat> = {}, tenantId = T1): Heartbeat => ({ workerId: id, companyId: tenantId, timestamp: iso(w.clock.t), cpu: 10, memory: 20, queueLength: 0, runningTasks: 0, version: "1.2.0", ...over });
/** the worker reports, one second after the last thing that happened (timestamps only ever grow) */
const beat = (w: World, id: string, over: Partial<Heartbeat> = {}, tenantId = T1) => { w.clock.advance(SEC); return w.engine.heartbeat(wk(id, tenantId), tenantId, beatOf(w, id, over, tenantId)); };
const row = (w: World, id: string, tenantId = T1) => w.engine.workersFor(person(tenantId, "x", "owner")).find((entry) => entry.id === id)!;
const stateOf = (w: World, id: string, tenantId = T1): WorkerState => row(w, id, tenantId).state;
const taskOf = (w: World, id: string) => w.engine.tasksFor(ana).find((entry) => entry.id === id)!;
/** register → start → first heartbeat: Idle */
const up = (w: World, id = "w1", over: Partial<WorkerSpec> = {}) => { ok(w.engine.register(ana, T1, spec(id, over)), "register"); ok(w.engine.start(ana, T1, id), "start"); ok(beat(w, id, { version: over.version ?? "1.2.0" }), "heartbeat"); };
const sched = (w: World) => { const result = w.engine.schedule(system(), T1); ok(result, "schedule"); return result; };
const give = (w: World, taskId: string, over: Partial<TaskSpec> = {}) => { ok(w.engine.submit(system(), T1, job(taskId, over)), "submit"); return sched(w); };
const run = (w: World, taskId: string) => ok(w.engine.taskStart(system(), T1, taskId), `start ${taskId}`);
const done = (w: World, taskId: string) => ok(w.engine.taskFinish(system(), T1, taskId, "completed"), `finish ${taskId}`);
const tick = (w: World) => { const result = w.engine.tick(system(), T1); ok(result, "tick"); return result; };

describe("States and transitions", () => {
  it("has exactly the fourteen states, no more", () => {
    expect([...WORKER_STATES]).toEqual(["Created", "Starting", "Idle", "Reserved", "Busy", "Paused", "WaitingApproval", "Retrying", "Recovering", "Stopping", "Stopped", "Failed", "Offline", "Maintenance"]);
    expect(Object.keys(WORKER_TRANSITIONS).sort()).toEqual([...WORKER_STATES].sort());
    for (const targets of Object.values(WORKER_TRANSITIONS)) for (const target of targets) expect(WORKER_STATES).toContain(target);
  });
  it("accepts the valid path and refuses the invalid ones", () => {
    const path: WorkerState[] = ["Created", "Starting", "Idle", "Reserved", "Busy", "Idle", "Stopping", "Stopped"];
    for (let i = 0; i < path.length - 1; i += 1) expect(canTransition(path[i]!, path[i + 1]!), `${path[i]}>${path[i + 1]}`).toBe(true);
    for (const [from, to] of [["Busy", "Created"], ["Offline", "Busy"], ["Stopped", "Busy"], ["Failed", "Busy"], ["Maintenance", "Busy"], ["Idle", "Busy"], ["Created", "Idle"], ["Stopped", "Idle"], ["Offline", "Idle"]] as const) {
      expect(canTransition(from, to), `${from}>${to}`).toBe(false);
    }
    expect(WORKER_TRANSITIONS.Busy).not.toContain("Offline"); // never straight from Busy to Offline
  });
  it("walks the complete lifecycle and writes every transition to the audit trail", () => {
    const w = world();
    ok(w.engine.register(ana, T1, spec("w1")));
    expect(stateOf(w, "w1")).toBe("Created");
    ok(w.engine.start(ana, T1, "w1"));
    expect(stateOf(w, "w1")).toBe("Starting");
    ok(beat(w, "w1"));
    expect(stateOf(w, "w1")).toBe("Idle");
    give(w, "t1");
    expect(stateOf(w, "w1")).toBe("Reserved");
    run(w, "t1");
    expect(stateOf(w, "w1")).toBe("Busy");
    done(w, "t1");
    expect(stateOf(w, "w1")).toBe("Idle");
    ok(w.engine.stop(ana, T1, "w1"));
    expect(stateOf(w, "w1")).toBe("Stopped");
    const moves = w.engine.audit(T1).filter((entry) => entry.action === "worker.transition").map((entry) => `${entry.detail?.["from"]}>${entry.detail?.["to"]}`);
    expect(moves).toEqual(["Created>Starting", "Starting>Idle", "Idle>Reserved", "Reserved>Busy", "Busy>Idle", "Idle>Stopping", "Stopping>Stopped"]);
    expect(w.engine.log.ofType("worker.transition")).toHaveLength(moves.length);
  });
  it("refuses a move the table does not allow", () => {
    const w = world();
    ok(w.engine.register(ana, T1, spec("w1")));
    expect(w.engine.stop(ana, T1, "w1").refusal).toBe("transition"); // Created → Stopping
    expect(w.engine.recover(ana, T1, "w1").refusal).toBe("transition");
    expect(w.engine.pause(ana, T1, "w1").refusal).toBe("transition");
    expect(w.engine.resume(ana, T1, "w1").refusal).toBe("state");
    expect(w.engine.endMaintenance(ana, T1, "w1").refusal).toBe("state");
    ok(w.engine.start(ana, T1, "w1"));
    expect(w.engine.start(ana, T1, "w1").refusal).toBe("transition"); // Starting → Starting
    expect(w.engine.start(ana, T1, "ghost").refusal).toBe("notFound");
    expect(w.engine.register(ana, T1, spec("w1")).refusal).toBe("exists");
    expect(w.engine.register(ana, T1, spec("bad id!")).refusal).toBe("invalid");
    expect(w.engine.register(ana, T1, spec("w2", { maxConcurrent: 0 })).refusal).toBe("invalid");
  });
  it("a stopped worker can be started again, and then only works through a heartbeat", () => {
    const w = world();
    up(w);
    ok(w.engine.stop(ana, T1, "w1"));
    ok(w.engine.start(ana, T1, "w1"));
    expect(stateOf(w, "w1")).toBe("Starting");
    expect(beat(w, "w1").ok).toBe(true);
    expect(stateOf(w, "w1")).toBe("Idle");
  });
});

describe("Heartbeat", () => {
  it("reports id, company, timestamp, cpu, memory, queue, running tasks and version, and keeps them", () => {
    const w = world();
    up(w);
    ok(beat(w, "w1", { cpu: 55, memory: 66, queueLength: 2, runningTasks: 1 }));
    expect(row(w, "w1")).toMatchObject({ cpu: 55, memory: 66, reportedQueue: 2, reportedRunning: 1, lastHeartbeatAt: iso(w.clock.t) });
    expect(w.engine.log.ofType("worker.heartbeat").length).toBeGreaterThan(1);
  });
  it("is validated: company, worker, timestamp, future, expired, stale, metrics and version", () => {
    const w = world();
    up(w);
    const bad = (over: Partial<Heartbeat>, tenantId = T1) => w.engine.heartbeat(wk("w1", tenantId), tenantId, beatOf(w, "w1", over, tenantId));
    w.clock.advance(SEC);
    expect(bad({ companyId: T2 }).refusal).toBe("tenant");
    expect(bad({ workerId: "w9" }).refusal).toBe("forbidden"); // a worker speaks only for itself
    expect(bad({ timestamp: "ayer" }).reasons).toEqual(["timestamp"]);
    expect(bad({ timestamp: iso(w.clock.t + SEC) }).reasons).toEqual(["future"]);
    expect(bad({ timestamp: iso(w.clock.t - 200 * SEC) }).reasons).toEqual(["expired"]);
    expect(bad({ timestamp: iso(w.clock.t - 5 * SEC) }).refusal).toBe("stale"); // older than the last one
    expect(bad({ cpu: 101 }).reasons).toEqual(["metrics"]);
    expect(bad({ memory: -1 }).reasons).toEqual(["metrics"]);
    expect(bad({ queueLength: 1.5 }).reasons).toEqual(["metrics"]);
    expect(bad({ version: "latest" }).reasons).toEqual(["version"]);
    expect(bad({}).ok).toBe(true);
    expect(bad({}).refusal).toBe("stale"); // the same instant twice
  });
  it("only the worker itself reports it: not a person, the system or NEX", () => {
    const w = world();
    up(w);
    w.clock.advance(SEC);
    for (const actor of [ana, adela, system(), nex(), wk("w2")]) expect(w.engine.heartbeat(actor, T1, beatOf(w, "w1")).refusal, JSON.stringify(actor)).toBe("forbidden");
  });
  it("is refused for a worker that was never started or has stopped", () => {
    const w = world();
    ok(w.engine.register(ana, T1, spec("w1")));
    expect(beat(w, "w1").refusal).toBe("state");
    expect(validateHeartbeat(beatOf(w, "w1"), { id: "w1", tenantId: T1 }, w.clock.t, DEFAULT_CONFIG).ok).toBe(true);
  });
  it("a new version in a heartbeat is recorded", () => {
    const w = world();
    up(w);
    ok(beat(w, "w1", { version: "1.3.0" }));
    expect(row(w, "w1").version).toBe("1.3.0");
    expect(w.engine.log.ofType("worker.version")).toHaveLength(1);
  });
});

describe("Heartbeat timeout", () => {
  it("an Idle worker that falls silent goes Offline, but not before the timeout", () => {
    const w = world();
    up(w);
    w.clock.advance(89 * SEC);
    tick(w);
    expect(stateOf(w, "w1")).toBe("Idle");
    w.clock.advance(2 * SEC);
    tick(w);
    expect(stateOf(w, "w1")).toBe("Offline");
    expect(w.engine.log.ofType("worker.timeout")).toHaveLength(1);
  });
  it("a Busy worker is NEVER taken Offline directly: its tasks are retried and it goes to Recovering", () => {
    const w = world();
    up(w);
    give(w, "t1");
    run(w, "t1");
    w.clock.advance(91 * SEC);
    tick(w);
    expect(stateOf(w, "w1")).toBe("Recovering");
    expect(row(w, "w1").errors).toBe(1);
    expect(taskOf(w, "t1")).toMatchObject({ status: "pending", attempts: 1, lastError: "heartbeatLost" });
    expect(taskOf(w, "t1").workerId).toBeUndefined();
    expect(taskOf(w, "t1").notBeforeMs).toBe(w.clock.t + 1_000);
    expect(w.engine.audit(T1).some((entry) => entry.detail?.["from"] === "Busy" && entry.detail?.["to"] === "Offline")).toBe(false);
    w.clock.advance(91 * SEC);
    tick(w);
    expect(stateOf(w, "w1")).toBe("Offline"); // only after a second silence
  });
  it("a Busy worker out of attempts loses the task for good", () => {
    const w = world();
    up(w);
    give(w, "t1", { maxAttempts: 1 });
    run(w, "t1");
    w.clock.advance(91 * SEC);
    tick(w);
    expect(taskOf(w, "t1")).toMatchObject({ status: "failed", lastError: "heartbeatLost" });
  });
  it("a Reserved worker hands back what it held and becomes Idle first", () => {
    const w = world();
    up(w);
    give(w, "t1");
    w.clock.advance(91 * SEC);
    tick(w);
    expect(stateOf(w, "w1")).toBe("Idle");
    expect(taskOf(w, "t1").status).toBe("pending");
    w.clock.advance(SEC);
    tick(w);
    expect(stateOf(w, "w1")).toBe("Offline");
  });
  it("a worker that never answers its start fails", () => {
    const w = world();
    ok(w.engine.register(ana, T1, spec("w1")));
    ok(w.engine.start(ana, T1, "w1"));
    w.clock.advance(119 * SEC);
    tick(w);
    expect(stateOf(w, "w1")).toBe("Starting");
    w.clock.advance(2 * SEC);
    tick(w);
    expect(stateOf(w, "w1")).toBe("Failed");
  });
  it("only the system or a manager ticks", () => {
    const w = world();
    up(w);
    expect(w.engine.tick(mario, T1).refusal).toBe("forbidden");
    expect(w.engine.tick(wk("w1"), T1).refusal).toBe("forbidden");
    expect(w.engine.tick(nex(), T1).refusal).toBe("forbidden");
    ok(w.engine.tick(marta, T1));
  });
});

describe("Recovery", () => {
  it("Offline → Recovering → Idle, by a person and then a valid heartbeat", () => {
    const w = world();
    up(w);
    w.clock.advance(100 * SEC);
    tick(w);
    expect(stateOf(w, "w1")).toBe("Offline");
    ok(beat(w, "w1")); // a heartbeat alone does not revive it
    expect(stateOf(w, "w1")).toBe("Offline");
    ok(w.engine.recover(ana, T1, "w1"));
    expect(stateOf(w, "w1")).toBe("Recovering");
    expect(row(w, "w1").recoveries).toBe(0);
    ok(beat(w, "w1"));
    expect(stateOf(w, "w1")).toBe("Idle");
    expect(row(w, "w1").recoveries).toBe(1);
    expect(w.engine.log.ofType("worker.recovered")).toHaveLength(1);
  });
  it("only a person at Level 3 recovers; the worker, the system and NEX never", () => {
    const w = world();
    up(w);
    w.clock.advance(100 * SEC);
    tick(w);
    for (const actor of [wk("w1"), system(), nex(), vera, mario, marta]) expect(w.engine.recover(actor, T1, "w1").refusal, JSON.stringify(actor)).toBe("forbidden");
    expect(stateOf(w, "w1")).toBe("Offline");
    ok(w.engine.recover(adela, T1, "w1"));
  });
  it("a recovering worker that stays silent goes back Offline; a failed one is recovered the same way", () => {
    const w = world();
    up(w);
    give(w, "t1");
    run(w, "t1");
    expect(w.engine.taskFinish(system(), T1, "t1", "failed", "fatal").ok).toBe(true);
    expect(stateOf(w, "w1")).toBe("Failed");
    ok(w.engine.recover(ana, T1, "w1"));
    expect(stateOf(w, "w1")).toBe("Recovering");
    w.clock.advance(91 * SEC);
    tick(w);
    expect(stateOf(w, "w1")).toBe("Offline");
  });
  it("a recovered worker takes work again", () => {
    const w = world();
    up(w);
    w.clock.advance(100 * SEC);
    tick(w);
    ok(w.engine.recover(ana, T1, "w1"));
    ok(beat(w, "w1"));
    give(w, "t1");
    expect(taskOf(w, "t1").workerId).toBe("w1");
  });
});

describe("Retry", () => {
  it("a retryable error is retried after a doubling backoff, then it fails", () => {
    const w = world();
    up(w);
    give(w, "t1");
    run(w, "t1");
    ok(w.engine.taskFinish(system(), T1, "t1", "failed", "retryable"));
    expect(stateOf(w, "w1")).toBe("Retrying");
    expect(taskOf(w, "t1")).toMatchObject({ status: "retrying", attempts: 1, lastError: "retryable" });
    expect(row(w, "w1").retries).toBe(1);
    expect(w.engine.taskStart(system(), T1, "t1").refusal).toBe("backoff"); // too early
    w.clock.advance(1_000);
    run(w, "t1");
    expect(stateOf(w, "w1")).toBe("Busy");
    ok(w.engine.taskFinish(system(), T1, "t1", "failed", "retryable"));
    expect(taskOf(w, "t1").notBeforeMs).toBe(w.clock.t + 2_000);
    w.clock.advance(2_000);
    run(w, "t1");
    ok(w.engine.taskFinish(system(), T1, "t1", "failed", "retryable"));
    expect(taskOf(w, "t1")).toMatchObject({ status: "failed", attempts: 3 });
    expect(row(w, "w1").errors).toBe(1);
    expect(stateOf(w, "w1")).toBe("Idle");
    expect(w.engine.log.ofType("task.retry")).toHaveLength(2);
  });
  it("a fatal error is never retried: the task fails, the worker fails and what it held goes back to the pool", () => {
    const w = world();
    up(w);
    give(w, "t1");
    give(w, "t2");
    run(w, "t1");
    ok(w.engine.taskFinish(system(), T1, "t1", "failed", "fatal"));
    expect(taskOf(w, "t1")).toMatchObject({ status: "failed", lastError: "fatal", attempts: 1 });
    expect(stateOf(w, "w1")).toBe("Failed");
    expect(taskOf(w, "t2").status).toBe("pending");
    expect(w.engine.log.ofType("task.retry")).toHaveLength(0);
    expect(w.engine.taskStart(system(), T1, "t2").refusal).toBe("state"); // Failed → Busy does not exist
  });
  it("a failure must say which kind of error it was", () => {
    const w = world();
    up(w);
    give(w, "t1");
    run(w, "t1");
    expect(w.engine.taskFinish(system(), T1, "t1", "failed").refusal).toBe("invalid");
  });
  it("backoff and retry helpers", () => {
    expect([1, 2, 3, 4].map((attempt) => backoffFor(attempt, 1_000, 5_000))).toEqual([1_000, 2_000, 4_000, 5_000]);
    expect(retryDecision({ attempts: 0, maxAttempts: 3 }, 0, DEFAULT_CONFIG)).toEqual({ retry: true, attempts: 1, notBeforeMs: 1_000 });
    expect(retryDecision({ attempts: 2, maxAttempts: 3 }, 0, DEFAULT_CONFIG).retry).toBe(false);
    expect(retryDecision({ attempts: 0, maxAttempts: 1 }, 0, DEFAULT_CONFIG).retry).toBe(false);
  });
});

describe("Maintenance, pause and stop", () => {
  it("maintenance: only a person, no new work, and it never goes Busy", () => {
    const w = world();
    up(w);
    for (const actor of [wk("w1"), system(), nex(), vera, mario, marta]) expect(w.engine.maintenance(actor, T1, "w1").refusal, JSON.stringify(actor)).toBe("forbidden");
    ok(w.engine.maintenance(ana, T1, "w1"));
    expect(stateOf(w, "w1")).toBe("Maintenance");
    ok(w.engine.submit(system(), T1, job("t1")));
    const result = sched(w);
    expect(result.placements).toEqual([]);
    expect(result.unplaced![0]!.reasons).toContain("state");
    expect(canTransition("Maintenance", "Busy")).toBe(false);
    ok(w.engine.endMaintenance(ana, T1, "w1"));
    expect(stateOf(w, "w1")).toBe("Idle");
  });
  it("maintenance on a busy worker waits for its current task and takes nothing else", () => {
    const w = world();
    up(w);
    give(w, "t1");
    run(w, "t1");
    give(w, "t2");
    expect(taskOf(w, "t2").workerId).toBe("w1");
    ok(w.engine.maintenance(ana, T1, "w1"));
    expect(stateOf(w, "w1")).toBe("Busy"); // still finishing
    expect(row(w, "w1").pending).toBe("maintenance");
    expect(taskOf(w, "t2").status).toBe("pending"); // handed back
    expect(w.engine.maintenance(ana, T1, "w1").refusal).toBe("state");
    expect(sched(w).placements).toEqual([]); // not while draining
    done(w, "t1");
    expect(stateOf(w, "w1")).toBe("Maintenance");
    expect(row(w, "w1").pending).toBeUndefined();
  });
  it("maintenance can be cancelled before it starts, and an Offline worker can go to maintenance", () => {
    const w = world();
    up(w);
    give(w, "t1");
    run(w, "t1");
    ok(w.engine.maintenance(ana, T1, "w1"));
    ok(w.engine.endMaintenance(ana, T1, "w1"));
    expect(row(w, "w1").pending).toBeUndefined();
    done(w, "t1");
    expect(stateOf(w, "w1")).toBe("Idle");
    w.clock.advance(100 * SEC);
    tick(w);
    ok(w.engine.maintenance(ana, T1, "w1"));
    expect(stateOf(w, "w1")).toBe("Maintenance");
  });
  it("pause: only a person; the worker finishes ONLY its current task and starts nothing new", () => {
    const w = world();
    up(w);
    for (const actor of [wk("w1"), system(), nex(), vera, mario, marta]) expect(w.engine.pause(actor, T1, "w1").refusal, JSON.stringify(actor)).toBe("forbidden");
    give(w, "t1");
    run(w, "t1");
    give(w, "t2");
    expect(taskOf(w, "t2").status).toBe("reserved");
    ok(w.engine.pause(ana, T1, "w1"));
    expect(stateOf(w, "w1")).toBe("Busy");
    expect(taskOf(w, "t2").status).toBe("pending");
    expect(taskOf(w, "t1").status).toBe("running");
    expect(w.engine.taskStart(system(), T1, "t2").refusal).toBe("state");
    done(w, "t1");
    expect(stateOf(w, "w1")).toBe("Paused");
    ok(w.engine.submit(system(), T1, job("t3")));
    expect(sched(w).placements).toEqual([]);
    ok(w.engine.resume(ana, T1, "w1"));
    expect(stateOf(w, "w1")).toBe("Idle");
    expect(sched(w).placements!.length).toBeGreaterThan(0);
  });
  it("pause on an idle worker is immediate, and a pause can be withdrawn while the worker is still busy", () => {
    const w = world();
    up(w);
    ok(w.engine.pause(ana, T1, "w1"));
    expect(stateOf(w, "w1")).toBe("Paused");
    ok(w.engine.resume(ana, T1, "w1"));
    give(w, "t1");
    run(w, "t1");
    ok(w.engine.pause(ana, T1, "w1"));
    expect(w.engine.pause(ana, T1, "w1").refusal).toBe("state");
    ok(w.engine.resume(ana, T1, "w1"));
    done(w, "t1");
    expect(stateOf(w, "w1")).toBe("Idle");
  });
  it("stop: only a person, and it waits for an empty queue before it stops", () => {
    const w = world();
    up(w, "w1", { maxConcurrent: 1, queueLimit: 2 });
    for (const actor of [wk("w1"), system(), nex(), vera, mario, marta]) expect(w.engine.stop(actor, T1, "w1").refusal, JSON.stringify(actor)).toBe("forbidden");
    give(w, "t1");
    give(w, "t2");
    expect(taskOf(w, "t2").status).toBe("queued");
    run(w, "t1");
    ok(w.engine.stop(ana, T1, "w1"));
    expect(stateOf(w, "w1")).toBe("Stopping");
    ok(w.engine.submit(system(), T1, job("t3")));
    expect(sched(w).placements).toEqual([]); // nothing new
    done(w, "t1");
    expect(stateOf(w, "w1")).toBe("Stopping"); // t2 moved up and still has to run
    expect(taskOf(w, "t2").status).toBe("reserved");
    run(w, "t2");
    expect(stateOf(w, "w1")).toBe("Stopping");
    done(w, "t2");
    expect(stateOf(w, "w1")).toBe("Stopped");
  });
});

describe("Scheduler", () => {
  it("never mixes companies: another company's worker is never used", () => {
    const w = world();
    up(w, "w1");
    ok(w.engine.register(luis, T2, spec("v1")));
    ok(w.engine.start(luis, T2, "v1"));
    ok(beat(w, "v1", {}, T2));
    ok(w.engine.submit(system(T2), T2, job("t2")));
    ok(w.engine.schedule(system(T2), T2));
    expect(w.engine.tasksFor(luis).find((entry) => entry.id === "t2")!.workerId).toBe("v1");
    give(w, "t1");
    expect(taskOf(w, "t1").workerId).toBe("w1");
  });
  it("respects specialty, permissions, versions and capabilities", () => {
    const w = world();
    up(w, "sales", { specialty: "sales", permissions: ["task.create"], capabilities: ["email"] });
    up(w, "ops", { specialty: "ops", permissions: ["*"], version: "0.9.0" });
    const place = (id: string, over: Partial<TaskSpec>) => { ok(w.engine.submit(system(), T1, job(id, over))); return sched(w); };
    expect(place("a", { specialty: "ops" }).unplaced![0]!.reasons).toEqual(["specialty", "version"]); // the only ops worker is below the minimum version
    expect(place("b", { action: "payment.refund" }).unplaced!.find((entry) => entry.taskId === "b")!.reasons).toContain("permission");
    expect(place("c", { capabilities: ["sms"] }).unplaced!.find((entry) => entry.taskId === "c")!.reasons).toContain("capabilities");
    expect(place("d", { minVersion: "2.0.0" }).unplaced!.find((entry) => entry.taskId === "d")!.reasons).toContain("version");
    expect(place("e", { minVersion: "1.2.0", capabilities: ["email"] }).placements).toEqual([{ taskId: "e", workerId: "sales", slot: "reserved" }]);
    expect(permits(["crm.*"], "crm.update")).toBe(true);
    expect(permits(["crm.*"], "mail.send")).toBe(false);
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("x", "1.0.0")).toBeLessThan(0);
  });
  it("never gives work to Offline, Failed, Maintenance, Paused or Stopped workers", () => {
    const w = world();
    for (const id of ["off", "bad", "mnt", "pau", "stp"]) up(w, id);
    // pause, maintenance and stop are asked of people
    ok(w.engine.pause(ana, T1, "pau"));
    ok(w.engine.maintenance(ana, T1, "mnt"));
    ok(w.engine.stop(ana, T1, "stp"));
    give(w, "boom");
    run(w, "boom"); // whoever got it
    const holder = taskOf(w, "boom").workerId!;
    expect(["off", "bad"]).toContain(holder);
    ok(w.engine.taskFinish(system(), T1, "boom", "failed", "fatal"));
    expect(stateOf(w, holder)).toBe("Failed");
    const other = holder === "off" ? "bad" : "off";
    w.clock.advance(100 * SEC);
    ok(beat(w, other)); // the other one stays alive; whoever is silent goes Offline
    tick(w);
    const states = Object.fromEntries(["off", "bad", "mnt", "pau", "stp"].map((id) => [id, stateOf(w, id)]));
    expect(Object.values(states).filter((state) => ["Offline", "Failed", "Maintenance", "Paused", "Stopped"].includes(state)).length).toBe(5 - 1);
    ok(w.engine.submit(system(), T1, job("after", { action: "task.create" })));
    const result = sched(w);
    expect(result.placements!.every((placement) => stateOf(w, placement.workerId) !== "Failed" && placement.workerId !== "mnt" && placement.workerId !== "pau" && placement.workerId !== "stp")).toBe(true);
  });
  it("serves higher priorities first when room is scarce", () => {
    const w = world();
    up(w, "w1", { maxConcurrent: 1, queueLimit: 0 });
    ok(w.engine.submit(system(), T1, job("low", { priority: "low" })));
    ok(w.engine.submit(system(), T1, job("crit", { priority: "critical" })));
    ok(w.engine.submit(system(), T1, job("high", { priority: "high" })));
    const result = sched(w);
    expect(result.placements!.map((placement) => placement.taskId)).toEqual(["crit"]);
    expect(result.unplaced!.map((entry) => entry.taskId)).toEqual(["high", "low"]);
    expect(result.unplaced![0]!.reasons).toEqual(["capacity"]);
  });
  it("never exceeds maxConcurrent or queueLimit", () => {
    const w = world();
    up(w, "w1", { maxConcurrent: 2, queueLimit: 1 });
    for (const id of ["a", "b", "c", "d", "e"]) ok(w.engine.submit(system(), T1, job(id)));
    const result = sched(w);
    expect(result.placements).toHaveLength(3);
    expect(result.placements!.filter((placement) => placement.slot === "queued")).toHaveLength(1);
    expect(result.unplaced).toHaveLength(2);
    expect(row(w, "w1").current).toBe(2);
    expect(w.engine.dashboard(ana).queues.queued).toBe(1);
    // a finished task frees a slot: the queued one moves up by itself
    run(w, "a");
    done(w, "a");
    expect(row(w, "w1").current).toBe(2);
    expect(w.engine.tasksFor(ana).filter((entry) => entry.status === "queued")).toHaveLength(0);
  });
  it("balances by load among equal workers, and breaks ties by id", () => {
    const w = world();
    up(w, "w2");
    up(w, "w1");
    give(w, "a");
    expect(taskOf(w, "a").workerId).toBe("w1");
    give(w, "b");
    expect(taskOf(w, "b").workerId).toBe("w2");
  });
  it("a worker that needs approval waits in WaitingApproval until a person at Level 3 approves", () => {
    const w = world();
    up(w);
    give(w, "t1", { requiresApproval: true });
    expect(stateOf(w, "w1")).toBe("WaitingApproval");
    expect(taskOf(w, "t1").status).toBe("awaitingApproval");
    expect(row(w, "w1").current).toBe(1);
    for (const actor of [wk("w1"), system(), nex(), mario, marta]) expect(w.engine.approve(actor, T1, "t1").refusal, JSON.stringify(actor)).toBe("forbidden");
    expect(w.engine.taskStart(system(), T1, "t1").refusal).toBe("state"); // not without approval
    ok(w.engine.approve(adela, T1, "t1"));
    expect(stateOf(w, "w1")).toBe("Reserved");
    run(w, "t1");
    expect(stateOf(w, "w1")).toBe("Busy");
  });
  it("a rejected task is cancelled and the worker is free again", () => {
    const w = world();
    up(w);
    give(w, "t1", { requiresApproval: true });
    ok(w.engine.reject(ana, T1, "t1"));
    expect(taskOf(w, "t1").status).toBe("cancelled");
    expect(stateOf(w, "w1")).toBe("Idle");
    expect(w.engine.approve(ana, T1, "t1").refusal).toBe("state");
  });
  it("submitting twice is idempotent, and only the system or a manager submits and schedules", () => {
    const w = world();
    up(w);
    ok(w.engine.submit(system(), T1, job("t1")));
    const again = w.engine.submit(marta, T1, job("t1"));
    expect(again.unchanged).toBe(true);
    expect(w.engine.tasksFor(ana)).toHaveLength(1);
    for (const actor of [wk("w1"), nex(), mario, vera]) {
      expect(w.engine.submit(actor, T1, job("t9")).refusal).toBe("forbidden");
      expect(w.engine.schedule(actor, T1).refusal).toBe("forbidden");
    }
    expect(w.engine.submit(system(), T1, job("bad", { priority: "urgent" as never })).refusal).toBe("invalid");
  });
  it("the pure planner and eligibility agree with the engine", () => {
    const rec: WorkerRecord = { id: "w1", tenantId: T1, name: "x", specialty: "sales", permissions: ["*"], state: "Idle", stateSince: iso(START), createdAt: iso(START), version: "1.0.0", build: "b", capabilities: [], maxConcurrent: 1, current: 0, queueLimit: 0, errors: 0, retries: 0, recoveries: 0 };
    expect(eligibility(rec, { tenantId: T2, specialty: "sales", action: "a", capabilities: [], requiresApproval: false }, { slots: 0, queued: 0 }, DEFAULT_CONFIG)).toEqual({ ok: false, reason: "tenant" });
    expect(eligibility({ ...rec, state: "Offline" }, { tenantId: T1, specialty: "sales", action: "a", capabilities: [], requiresApproval: false }, { slots: 0, queued: 0 }, DEFAULT_CONFIG)).toEqual({ ok: false, reason: "state" });
    expect(planAssignments([], [], START, DEFAULT_CONFIG)).toEqual({ placements: [], unplaced: [] });
  });
});

describe("Health score", () => {
  const base: WorkerRecord = { id: "w1", tenantId: T1, name: "x", specialty: "sales", permissions: [], state: "Idle", stateSince: iso(START), createdAt: iso(START), version: "1.0.0", build: "b", capabilities: [], maxConcurrent: 2, current: 0, queueLimit: 1, errors: 0, retries: 0, recoveries: 0, lastHeartbeatAt: iso(START), activeSince: iso(START - 3_600_000) };
  it("is 0–100 and perfect for a fresh, idle, long-running, error-free worker", () => {
    expect(healthScore(base, START, DEFAULT_CONFIG)).toBe(100);
    const parts = healthParts(base, START, DEFAULT_CONFIG);
    expect(Object.values(parts).reduce((a, b) => a + b, 0)).toBe(100);
    expect(healthBand(100)).toBe("healthy");
    expect(healthBand(50)).toBe("degraded");
    expect(healthBand(10)).toBe("critical");
  });
  it("drops with a silent heartbeat, errors, retries, recoveries, load and a short uptime", () => {
    const at = (patch: Partial<WorkerRecord>, now = START) => healthScore({ ...base, ...patch }, now, DEFAULT_CONFIG);
    expect(at({}, START + 60_000)).toBeLessThan(100);
    expect(at({}, START + 60_000)).toBeGreaterThan(at({}, START + 90_000));
    expect(at({ errors: 2 })).toBe(90);
    expect(at({ retries: 3 })).toBe(94);
    expect(at({ recoveries: 1 })).toBe(95);
    expect(at({ current: 2 })).toBeLessThan(at({ current: 1 }));
    expect(at({ current: 2 })).toBeLessThan(at({}));
    expect(at({ activeSince: iso(START - 600_000) })).toBeLessThan(100);
    expect(at({ errors: 99, retries: 99, recoveries: 99, current: 2 }, START + 500_000)).toBeGreaterThanOrEqual(0);
  });
  it("is 0 for a worker that cannot work", () => {
    for (const state of ["Created", "Stopped", "Failed", "Offline"] as const) expect(healthScore({ ...base, state }, START, DEFAULT_CONFIG)).toBe(0);
  });
});

describe("Dashboard", () => {
  function fleet() {
    const w = world();
    for (const id of ["w1", "w2", "w3", "w4", "w5"]) up(w, id, { specialty: id, version: id === "w5" ? "1.1.0" : "1.2.0" });
    ok(w.engine.maintenance(ana, T1, "w4"));
    give(w, "tb", { specialty: "w2" });
    run(w, "tb");
    give(w, "tf", { specialty: "w5" });
    run(w, "tf");
    ok(w.engine.taskFinish(system(), T1, "tf", "failed", "fatal"));
    w.clock.advance(60 * SEC);
    for (const id of ["w1", "w2", "w4", "w5"]) ok(beat(w, id, { version: id === "w5" ? "1.1.0" : "1.2.0" }));
    w.clock.advance(40 * SEC);
    tick(w);
    return w;
  }
  it("counts workers by state, health, capacity, queues and versions", () => {
    const w = fleet();
    const dashboard = w.engine.dashboard(ana);
    expect(dashboard.workers).toMatchObject({ total: 5, idle: 1, busy: 1, offline: 1, failed: 1, maintenance: 1 });
    expect(dashboard.health.average).toBeGreaterThan(0);
    expect(dashboard.health.lowest[0]!.score).toBe(0);
    expect(dashboard.capacity).toEqual({ used: 1, total: 4, percent: 25 });
    expect(dashboard.versions).toEqual({ "1.2.0": 4, "1.1.0": 1 });
    expect(dashboard.queues).toMatchObject({ queued: 0, pending: 0, awaitingApproval: 0 });
  });
  it("shows queues", () => {
    const w = world();
    up(w, "w1", { maxConcurrent: 1, queueLimit: 2 });
    give(w, "a");
    give(w, "b");
    give(w, "c");
    ok(w.engine.submit(system(), T1, job("d")));
    const dashboard = w.engine.dashboard(ana);
    expect(dashboard.queues).toEqual({ queued: 2, pending: 1, awaitingApproval: 0, byWorker: [{ workerId: "w1", queued: 2 }] });
  });
  it("is isolated by company and never shows another company's workers", () => {
    const w = fleet();
    ok(w.engine.register(luis, T2, spec("v1")));
    const other = w.engine.dashboard(luis);
    expect(other.workers.total).toBe(1);
    expect(JSON.stringify(other)).not.toMatch(/w1|w2|tb/);
    expect(w.engine.dashboard(ana).workers.total).toBe(5);
    expect(w.engine.log.ofType("runtime.dashboard")).toHaveLength(2);
  });
  it("builds from plain data with no engine, ignoring other companies' rows", () => {
    const dashboard = buildWorkerRuntimeDashboard({ tenantId: T1, at: iso(START), workers: [{ id: "x", tenantId: T2, name: "x", specialty: "s", permissions: [], state: "Idle", stateSince: iso(START), createdAt: iso(START), version: "1.0.0", build: "b", capabilities: [], maxConcurrent: 1, current: 0, queueLimit: 0, errors: 0, retries: 0, recoveries: 0 }], tasks: [], config: DEFAULT_CONFIG });
    expect(dashboard.workers.total).toBe(0);
    expect(dashboard.capacity.percent).toBe(0);
  });
});

describe("Audit, observability and Event Bus", () => {
  it("every valid transition is in the audit trail and the log, and refusals are audited too", () => {
    const w = world();
    up(w);
    give(w, "t1");
    run(w, "t1");
    w.engine.stop(mario, T1, "w1");
    const audit = w.engine.audit(T1);
    expect(audit.filter((entry) => entry.action === "worker.transition")).toHaveLength(w.engine.log.ofType("worker.transition").length);
    expect(audit.at(-1)).toMatchObject({ action: "stop.refused", actor: "mario", detail: { ok: false, reason: "forbidden" } });
    expect(audit.every((entry) => entry.tenantId === T1)).toBe(true);
    expect(w.engine.audit(T2)).toEqual([]);
  });
  it("counts per company with ids and numbers only, never content", () => {
    const w = world();
    up(w);
    give(w, "t1");
    run(w, "t1");
    done(w, "t1");
    w.engine.stop(mario, T1, "w1");
    w.engine.dashboard(ana);
    const snapshot = w.engine.snapshot(T1);
    expect(snapshot.counters).toMatchObject({ registered: 1, heartbeats: 1, submitted: 1, assigned: 1, started: 1, completed: 1, refused: 1, dashboards: 1, scheduled: 1 });
    expect(snapshot.byTransition["Idle>Reserved"]).toBe(1);
    expect(snapshot.refusals["forbidden"]).toBe(1);
    expect(snapshot.workers?.byState["Idle"]).toBe(1);
    expect(w.engine.snapshot(T2).counters).toMatchObject({ registered: 0, heartbeats: 0 });
    const everything = JSON.stringify([w.engine.log.all(), w.engine.exportState().audit, snapshot, w.engine.dashboard(ana)]);
    expect(everything).not.toMatch(/SECRETO/);
    expect(w.engine.log.forTenant(T2)).toEqual([]);
  });
  it("drops free text before an event is kept", () => {
    expect(sanitizeDetail({ note: "texto libre con espacios", prompt: "dame los datos", ok: true, n: 3.14159, id: "w-1", from: "Idle", to: "Busy" })).toEqual({ ok: true, n: 3.14, id: "w-1", from: "Idle", to: "Busy" });
    const log = new WorkerEventLog();
    const event = log.emit({ at: iso(START), tenantId: T1, actorKind: "system", actorId: "system", type: "runtime.tick", workerId: "con espacios", detail: { memory: "mi memoria privada" } });
    expect(event.workerId).toBeUndefined();
    expect(event.detail).toBeUndefined();
  });
  it("prepares messages for the future Event Bus without publishing anything", () => {
    const w = world();
    up(w);
    const message = toBusMessage(w.engine.log.ofType("worker.transition")[0]!);
    expect(message).toMatchObject({ topic: "worker-runtime.worker", tenantId: T1, key: "w1", data: { type: "worker.transition" } });
    expect(toBusMessage(w.engine.log.ofType("runtime.scheduled")[0] ?? w.engine.log.all()[0]!).topic).toMatch(/^worker-runtime\./);
    expect(w.engine.log.toAudit(T1).length).toBeGreaterThan(0);
  });
  it("observability can be detached", () => {
    const log = new WorkerEventLog();
    const observability = new WorkerRuntimeObservability(log);
    log.emit({ at: iso(START), tenantId: T1, actorKind: "system", actorId: "system", type: "runtime.tick" });
    observability.stop();
    log.emit({ at: iso(START), tenantId: T1, actorKind: "system", actorId: "system", type: "runtime.tick" });
    expect(observability.snapshot(T1).counters.ticks).toBe(1);
  });
  it("declares the future tables with company scope and row level security, and creates no migration", () => {
    expect(FUTURE_TABLES.map((table) => table.name)).toEqual(["worker_runtime_workers", "worker_runtime_heartbeats", "worker_runtime_tasks", "worker_runtime_audit"]);
    expect(FUTURE_TABLES.every((table) => table.tenantScoped && table.policy.length > 0)).toBe(true);
    const dir = join(process.cwd(), "supabase", "migrations");
    if (existsSync(dir)) for (const name of readdirSync(dir)) expect(readFileSync(join(dir, name), "utf8"), name).not.toMatch(/worker_runtime/);
  });
});

describe("Security: Level 3 and company isolation", () => {
  it("workers, the system, NEX and people below administrator can never change how a Worker lives", () => {
    const w = world();
    up(w);
    for (const actor of [wk("w1"), system(), nex(), vera, mario, marta]) {
      const label = JSON.stringify(actor);
      expect(w.engine.register(actor, T1, spec("zz")).refusal, label).toBe("forbidden");
      for (const call of [w.engine.start, w.engine.stop, w.engine.pause, w.engine.resume, w.engine.maintenance, w.engine.endMaintenance, w.engine.recover]) expect(call.call(w.engine, actor, T1, "w1").refusal, label).toBe("forbidden");
      expect(w.engine.approve(actor, T1, "t").refusal, label).toBe("forbidden");
      expect(w.engine.reject(actor, T1, "t").refusal, label).toBe("forbidden");
    }
    expect(stateOf(w, "w1")).toBe("Idle");
    ok(w.engine.register(adela, T1, spec("zz")));
    ok(w.engine.pause(adela, T1, "w1"));
  });
  it("a company never touches another's workers, and the same id can exist in both", () => {
    const w = world();
    up(w, "w1");
    expect(w.engine.stop(luis, T2, "w1").refusal).toBe("notFound");
    expect(w.engine.stop(luis, T1, "w1").refusal).toBe("tenant"); // claiming a company that is not theirs
    expect(w.engine.heartbeat(wk("w1", T2), T2, beatOf(w, "w1", {}, T2)).refusal).toBe("notFound");
    ok(w.engine.register(luis, T2, spec("w1")));
    ok(w.engine.start(luis, T2, "w1"));
    expect(stateOf(w, "w1", T1)).toBe("Idle");
    expect(stateOf(w, "w1", T2)).toBe("Starting");
    expect(w.engine.workersFor(luis)).toHaveLength(1);
    expect(w.engine.workersFor(ana)).toHaveLength(1);
  });
  it("a tick or a schedule of one company changes nothing of another's", () => {
    const w = world();
    up(w, "w1");
    ok(w.engine.register(luis, T2, spec("v1")));
    ok(w.engine.start(luis, T2, "v1"));
    const before = JSON.stringify(w.engine.exportState().workers.filter((entry) => entry.tenantId === T2));
    w.clock.advance(500 * SEC);
    tick(w);
    sched(w);
    expect(JSON.stringify(w.engine.exportState().workers.filter((entry) => entry.tenantId === T2))).toBe(before);
    expect(stateOf(w, "v1", T2)).toBe("Starting");
  });
});

describe("Determinism and purity", () => {
  const script = (w: World) => {
    up(w, "w1");
    up(w, "w2", { specialty: "ops" });
    give(w, "a", { priority: "high" });
    give(w, "b", { specialty: "ops", requiresApproval: true });
    run(w, "a");
    w.engine.approve(ana, T1, "b");
    ok(w.engine.taskFinish(system(), T1, "a", "failed", "retryable"));
    w.clock.advance(1_000);
    run(w, "a");
    done(w, "a");
    ok(w.engine.pause(ana, T1, "w1"));
    w.clock.advance(100 * SEC);
    tick(w);
    w.clock.advance(SEC);
    tick(w);
    ok(w.engine.recover(ana, T1, "w2"));
    ok(beat(w, "w2"));
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
    expect(a.engine.dashboard(ana)).toEqual(b.engine.dashboard(ana));
  });
  it("the reducer does not mutate its inputs and gives the same answer twice", () => {
    const deepFreeze = <T,>(value: T): T => { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; };
    let state = newWorkerRuntimeState();
    const events: WorkerRuntimeEvent[] = [
      { type: "register", actor: ana, tenantId: T1, at: iso(START), worker: spec("w1") },
      { type: "start", actor: ana, tenantId: T1, at: iso(START + SEC), workerId: "w1" },
      { type: "heartbeat", actor: wk("w1"), tenantId: T1, at: iso(START + 2 * SEC), heartbeat: { workerId: "w1", companyId: T1, timestamp: iso(START + 2 * SEC), cpu: 1, memory: 1, queueLength: 0, runningTasks: 0, version: "1.2.0" } },
      { type: "submit", actor: system(), tenantId: T1, at: iso(START + 3 * SEC), task: job("t1") },
      { type: "schedule", actor: system(), tenantId: T1, at: iso(START + 4 * SEC) },
      { type: "tick", actor: system(), tenantId: T1, at: iso(START + 500 * SEC) },
      { type: "tick", actor: system(), tenantId: T1, at: iso(START + 501 * SEC) },
    ];
    for (const event of events) {
      deepFreeze(state);
      deepFreeze(event);
      const one = reduceWorkerRuntime(state, event);
      const two = reduceWorkerRuntime(state, event);
      expect(one).toEqual(two);
      state = one.state;
    }
    expect(state.workers[0]!.state).toBe("Offline");
  });
  it("a bad instant is refused, never guessed", () => {
    const result = reduceWorkerRuntime(newWorkerRuntimeState(), { type: "tick", actor: system(), tenantId: T1, at: "mañana" });
    expect(result.result.refusal).toBe("invalid");
    expect(result.state.workers).toEqual([]);
  });
});

describe("Pure and isolated: nothing is executed", () => {
  const dir = join(process.cwd(), "lib", "nex", "worker-runtime");
  const FILES = [
    "index.ts", "worker-runtime-dashboard.ts", "worker-runtime-events.ts", "worker-runtime-health.ts", "worker-runtime-heartbeat.ts", "worker-runtime-observability.ts", "worker-runtime-reducer.ts", "worker-runtime-scheduler.ts",
    "worker-runtime-types.ts", "worker-runtime.ts",
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
  it("calls no Runtime, Connector, Worker, provider, bus or other layer", () => {
    for (const name of FILES) expect(code(name), name).not.toMatch(/ADAPTERS|adapter\.|\.execute\(|executeAction|runAction|runStep|callWorker|callConnector|reduceKoe|reduceConnectors|reduceMemory|reduceKnowledge|reduceCopilot|reduceRag|reduceExecution|reduceRuntime\b|\.ask\(|\.remember\(|\.subscribe\(|\.publish\(|lib\/nex|lib\/backend/);
  });
  it("is used by nothing else in the repository yet", () => {
    const importers: string[] = [];
    const walk = (folder: string) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (["node_modules", ".next", ".git", ".open-next"].includes(entry.name)) continue;
        const path = join(folder, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name) && !path.includes(join("lib", "nex", "worker-runtime")) && !path.includes("execution-bridge") && /lib\/nex\/worker-runtime/.test(readFileSync(path, "utf8"))) importers.push(path);
      }
    };
    for (const folder of ["app", "lib", "components"]) walk(join(process.cwd(), folder));
    expect(importers).toEqual([]);
  });
});
