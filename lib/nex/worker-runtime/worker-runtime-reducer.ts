// Worker Runtime Reducer: the pure function `reduceWorkerRuntime(state, event, config)` that decides how every Worker of a company lives. The same state and event always give the same result; there is
// no clock (every event carries `at`, every heartbeat its own timestamp), no network, no database and no AI, and NO action is run: this only moves records.
//   · Level 3: only a person (administrator or owner) may register, start, stop, pause, resume, put in maintenance, recover, approve or reject. Workers, the system and NEX never can.
//   · Workers report heartbeats and the start and finish of the tasks they hold; the system may relay task reports, schedule and tick. A heartbeat never revives an Offline or Failed worker by itself:
//     a person recovers it (Offline|Failed → Recovering) and only a valid heartbeat then makes it Idle.
//   · Silence: Idle → Offline. A Busy worker is NEVER taken Offline directly: its tasks go back to the pool (retried if they can be) and it goes to Recovering.
//   · Every valid transition is checked against a closed table and written to the audit trail. Everything is isolated by company.

import { validateHeartbeat, heartbeatExpired, silenceMs } from "./worker-runtime-heartbeat";
import { loadOf, planAssignments, retryDecision, taskOrder } from "./worker-runtime-scheduler";
import {
  DEFAULT_CONFIG, HELD, PRIORITIES, canOperate, canTransition, isLevel3, parseVersion,
  type AuditEntry, type Principal, type Refusal, type Task, type TaskSpec, type WorkerEventInput, type WorkerEventType, type WorkerRecord, type WorkerRuntimeConfig, type WorkerRuntimeEvent, type WorkerRuntimeOutcome,
  type WorkerRuntimeResult, type WorkerRuntimeState, type WorkerSpec, type WorkerState,
} from "./worker-runtime-types";

export const newWorkerRuntimeState = (): WorkerRuntimeState => ({ workers: [], tasks: [], audit: [] });
const MAX_AUDIT = 5_000;
const SAFE = /^[A-Za-z0-9_.:-]{1,60}$/;
const LIFECYCLE = new Set<string>(["register", "start", "stop", "pause", "resume", "maintenance", "endMaintenance", "recover", "approve", "reject"]);
const OPERATIONAL: readonly WorkerState[] = ["Idle", "Reserved", "WaitingApproval", "Busy", "Retrying"];
const name = (principal: Principal): string => (principal.kind === "system" || principal.kind === "nex" ? principal.kind : principal.id);

function refuse(state: WorkerRuntimeState, event: WorkerRuntimeEvent, refusal: Refusal, reasons: readonly string[] = []): WorkerRuntimeOutcome {
  const who = name(event.actor);
  const input: WorkerEventInput = { at: event.at, tenantId: event.actor.tenantId, actorKind: event.actor.kind, actorId: who, type: "runtime.refused", detail: { reason: refusal, action: event.type } };
  const entry: AuditEntry = { at: event.at, actor: who, tenantId: event.actor.tenantId, action: `${event.type}.refused`, detail: { ok: false, reason: refusal, ...(reasons[0] ? { why: reasons[0] } : {}) } };
  return { state: { ...state, audit: [...state.audit, entry].slice(-MAX_AUDIT) }, result: { ok: false, refusal, ...(reasons.length > 0 ? { reasons } : {}), events: [input] } };
}

const validSpec = (spec: WorkerSpec): boolean =>
  SAFE.test(spec.id) && typeof spec.name === "string" && spec.name.length >= 1 && spec.name.length <= 80 && SAFE.test(spec.specialty) && Array.isArray(spec.permissions) && spec.permissions.length <= 50 &&
  spec.permissions.every((entry) => typeof entry === "string" && entry.length >= 1 && entry.length <= 60) && parseVersion(spec.version) !== undefined && SAFE.test(spec.build) && Array.isArray(spec.capabilities) &&
  spec.capabilities.length <= 50 && spec.capabilities.every((entry) => SAFE.test(entry)) && Number.isInteger(spec.maxConcurrent) && spec.maxConcurrent >= 1 && spec.maxConcurrent <= 64 && Number.isInteger(spec.queueLimit) &&
  spec.queueLimit >= 0 && spec.queueLimit <= 1_000;
const validTask = (spec: TaskSpec): boolean =>
  SAFE.test(spec.id) && SAFE.test(spec.specialty) && SAFE.test(spec.action) && PRIORITIES.includes(spec.priority) && (spec.minVersion === undefined || parseVersion(spec.minVersion) !== undefined) &&
  (spec.capabilities ?? []).every((entry) => SAFE.test(entry)) && (spec.maxAttempts === undefined || (Number.isInteger(spec.maxAttempts) && spec.maxAttempts >= 1 && spec.maxAttempts <= 10));

export function reduceWorkerRuntime(start: WorkerRuntimeState, event: WorkerRuntimeEvent, config: WorkerRuntimeConfig = DEFAULT_CONFIG): WorkerRuntimeOutcome {
  const { actor, tenantId, at } = event;
  if (actor.tenantId !== tenantId) return refuse(start, event, "tenant");
  const nowMs = Date.parse(at);
  if (Number.isNaN(nowMs)) return refuse(start, event, "invalid", ["at"]);
  // Level 3: workers, the system and NEX never change how a Worker lives
  if (LIFECYCLE.has(event.type) && !isLevel3(actor)) return refuse(start, event, "forbidden");

  let workers: WorkerRecord[] = [...start.workers];
  let tasks: Task[] = [...start.tasks];
  const events: WorkerEventInput[] = [];
  const audit: AuditEntry[] = [];
  const who = name(actor);
  const note = (type: WorkerEventType, ids: { workerId?: string; taskId?: string } = {}, detail?: Readonly<Record<string, unknown>>) =>
    events.push({ at, tenantId, actorKind: actor.kind, actorId: who, type, ...(ids.workerId ? { workerId: ids.workerId } : {}), ...(ids.taskId ? { taskId: ids.taskId } : {}), ...(detail ? { detail } : {}) });

  const worker = (id: string): WorkerRecord | undefined => workers.find((row) => row.id === id && row.tenantId === tenantId);
  const taskOf = (id: string): Task | undefined => tasks.find((row) => row.id === id && row.tenantId === tenantId);
  const putW = (next: WorkerRecord): WorkerRecord => { workers = workers.map((row) => (row.id === next.id && row.tenantId === next.tenantId ? next : row)); return next; };
  const putT = (next: Task): Task => { tasks = tasks.map((row) => (row.id === next.id && row.tenantId === next.tenantId ? next : row)); return next; };
  const bare = (row: WorkerRecord): WorkerRecord => { const { pending: _pending, ...rest } = row; return rest; };

  /** The only way a worker changes state: checked against the closed table, written to the log and the audit trail. */
  const move = (from: WorkerRecord, to: WorkerState, cause: string, extra: Partial<WorkerRecord> = {}, clearPending = false): WorkerRecord => {
    const current = worker(from.id) ?? from;
    if (!canTransition(current.state, to)) return current;
    const base = clearPending ? bare(current) : current;
    const next = putW({ ...base, ...extra, state: to, stateSince: at });
    note("worker.transition", { workerId: current.id }, { from: current.state, to, cause });
    audit.push({ at, actor: who, tenantId, action: "worker.transition", detail: { workerId: current.id, from: current.state, to, cause } });
    return next;
  };
  const release = (row: Task, cause: string): void => {
    const { workerId: _worker, ...rest } = row;
    putT({ ...rest, status: "pending" });
    note("task.released", { taskId: row.id }, { cause });
  };
  const releaseWhere = (workerId: string, statuses: readonly Task["status"][], cause: string): void => {
    for (const row of tasks.filter((entry) => entry.tenantId === tenantId && entry.workerId === workerId && statuses.includes(entry.status))) release(row, cause);
  };
  const held = (workerId: string): Task[] => tasks.filter((row) => row.tenantId === tenantId && row.workerId === workerId && HELD.includes(row.status));
  const doing = (workerId: string): boolean => held(workerId).some((row) => row.status === "running" || row.status === "retrying");

  /** A queued task moves up as soon as a slot is free. */
  const promote = (row: WorkerRecord): void => {
    for (;;) {
      const load = loadOf(tasks.filter((entry) => entry.tenantId === tenantId)).get(row.id) ?? { slots: 0, queued: 0 };
      if (load.slots >= row.maxConcurrent) return;
      const next = taskOrder(tasks.filter((entry) => entry.tenantId === tenantId && entry.workerId === row.id && entry.status === "queued"))[0];
      if (!next) return;
      putT({ ...next, status: next.requiresApproval ? "awaitingApproval" : "reserved" });
    }
  };
  /** After any change: where the worker should be, given the work it holds. A stopping worker finishes stopping once it holds nothing. */
  const settle = (id: string): void => {
    const row = worker(id);
    if (!row) return;
    if (row.state === "Stopping") { promote(row); if (held(id).length === 0) move(row, "Stopped", "drained"); return; }
    if (!OPERATIONAL.includes(row.state)) return;
    promote(row);
    const own = held(id);
    const has = (status: Task["status"]) => own.some((entry) => entry.status === status);
    const target: WorkerState = has("running") ? "Busy" : has("retrying") ? "Retrying" : row.pending === "pause" ? "Paused" : row.pending === "maintenance" ? "Maintenance" : has("reserved") ? "Reserved" : has("awaitingApproval") ? "WaitingApproval" : "Idle";
    if (target !== row.state) move(row, target, "settle", {}, target === "Paused" || target === "Maintenance");
  };
  const finishOk = (extra: { workerId?: string; taskId?: string; placements?: WorkerRuntimeResult["placements"]; unplaced?: WorkerRuntimeResult["unplaced"]; unchanged?: boolean } = {}, detail: Record<string, string | number | boolean> = {}): WorkerRuntimeOutcome => {
    for (const row of workers.filter((entry) => entry.tenantId === tenantId).sort((a, b) => a.id.localeCompare(b.id))) settle(row.id);
    const load = loadOf(tasks.filter((entry) => entry.tenantId === tenantId));
    workers = workers.map((row) => { if (row.tenantId !== tenantId) return row; const slots = load.get(row.id)?.slots ?? 0; return slots === row.current ? row : { ...row, current: slots }; });
    const entry: AuditEntry = { at, actor: who, tenantId, action: event.type, detail: { ok: true, ...detail } };
    const found = extra.workerId ? worker(extra.workerId) : undefined;
    const foundTask = extra.taskId ? taskOf(extra.taskId) : undefined;
    return {
      state: { workers, tasks, audit: [...start.audit, ...audit, entry].slice(-MAX_AUDIT) },
      result: { ok: true, ...(extra.unchanged ? { unchanged: true } : {}), ...(found ? { worker: found } : {}), ...(foundTask ? { task: foundTask } : {}), ...(extra.placements ? { placements: extra.placements } : {}), ...(extra.unplaced ? { unplaced: extra.unplaced } : {}), events },
    };
  };
  const unknownWorker = (id: string) => refuse(start, event, "notFound", [`worker:${id}`]);

  switch (event.type) {
    case "register": {
      const spec = event.worker;
      if (!validSpec(spec)) return refuse(start, event, "invalid", ["worker"]);
      if (worker(spec.id)) return refuse(start, event, "exists");
      if (workers.filter((row) => row.tenantId === tenantId).length >= config.maxWorkers) return refuse(start, event, "limit", ["maxWorkers"]);
      workers.push({
        id: spec.id, tenantId, name: spec.name, specialty: spec.specialty, permissions: [...spec.permissions], state: "Created", stateSince: at, createdAt: at, version: spec.version, build: spec.build, capabilities: [...spec.capabilities],
        maxConcurrent: spec.maxConcurrent, current: 0, queueLimit: spec.queueLimit, errors: 0, retries: 0, recoveries: 0,
      });
      note("worker.registered", { workerId: spec.id }, { maxConcurrent: spec.maxConcurrent, queueLimit: spec.queueLimit, version: spec.version });
      return finishOk({ workerId: spec.id });
    }

    case "start": {
      const row = worker(event.workerId);
      if (!row) return unknownWorker(event.workerId);
      if (!canTransition(row.state, "Starting")) return refuse(start, event, "transition", [`${row.state}>Starting`]);
      move(row, "Starting", "start", { watchFrom: at });
      return finishOk({ workerId: row.id });
    }

    case "stop": {
      const row = worker(event.workerId);
      if (!row) return unknownWorker(event.workerId);
      if (!canTransition(row.state, "Stopping")) return refuse(start, event, "transition", [`${row.state}>Stopping`]);
      // nothing new starts; what it holds (running, reserved, queued) is finished first, and the worker stops only when its queue is empty
      releaseWhere(row.id, ["awaitingApproval"], "stop");
      move(row, "Stopping", "stop", {}, true);
      return finishOk({ workerId: row.id });
    }

    case "pause":
    case "maintenance": {
      const row = worker(event.workerId);
      if (!row) return unknownWorker(event.workerId);
      const kind = event.type === "pause" ? "pause" : "maintenance";
      const target: WorkerState = kind === "pause" ? "Paused" : "Maintenance";
      const sources: readonly WorkerState[] = kind === "pause" ? ["Idle", "Reserved", "WaitingApproval", "Busy", "Retrying"] : ["Idle", "Reserved", "WaitingApproval", "Busy", "Retrying", "Paused", "Offline"];
      if (!sources.includes(row.state)) return refuse(start, event, "transition", [`${row.state}>${target}`]);
      if (row.pending === kind) return refuse(start, event, "state", ["alreadyAsked"]);
      // it finishes ONLY the task(s) in hand; whatever it merely held is handed back and nothing new starts
      releaseWhere(row.id, ["reserved", "queued", "awaitingApproval"], kind);
      if (doing(row.id)) putW({ ...row, pending: kind }); else move(row, target, kind, {}, true);
      return finishOk({ workerId: row.id });
    }

    case "resume": {
      const row = worker(event.workerId);
      if (!row) return unknownWorker(event.workerId);
      if (row.state === "Paused") move(row, "Idle", "resume", { watchFrom: at });
      else if (row.pending === "pause") putW(bare(row));
      else return refuse(start, event, "state", [row.state]);
      return finishOk({ workerId: row.id });
    }

    case "endMaintenance": {
      const row = worker(event.workerId);
      if (!row) return unknownWorker(event.workerId);
      if (row.state === "Maintenance") move(row, "Idle", "endMaintenance", { watchFrom: at });
      else if (row.pending === "maintenance") putW(bare(row));
      else return refuse(start, event, "state", [row.state]);
      return finishOk({ workerId: row.id });
    }

    case "recover": {
      const row = worker(event.workerId);
      if (!row) return unknownWorker(event.workerId);
      if (row.state !== "Failed" && row.state !== "Offline") return refuse(start, event, "transition", [`${row.state}>Recovering`]);
      move(row, "Recovering", "recover", { watchFrom: at });
      return finishOk({ workerId: row.id });
    }

    case "approve":
    case "reject": {
      const row = taskOf(event.taskId);
      if (!row) return refuse(start, event, "notFound", [`task:${event.taskId}`]);
      if (row.status !== "awaitingApproval") return refuse(start, event, "state", [row.status]);
      if (event.type === "approve") { putT({ ...row, status: "reserved" }); note("task.approved", { taskId: row.id }, { level: 3 }); }
      else { const { workerId: _worker, ...rest } = row; putT({ ...rest, status: "cancelled" }); note("task.rejected", { taskId: row.id }); }
      return finishOk({ taskId: row.id });
    }

    case "heartbeat": {
      const beat = event.heartbeat;
      // a worker speaks only for itself
      if (actor.kind !== "worker" || actor.id !== beat.workerId) return refuse(start, event, "forbidden");
      const row = worker(beat.workerId);
      if (!row) return unknownWorker(beat.workerId);
      const check = validateHeartbeat(beat, row, nowMs, config);
      if (!check.ok) return refuse(start, event, check.reason === "tenant" ? "tenant" : check.reason === "stale" ? "stale" : "invalid", [check.reason]);
      if (row.state === "Created" || row.state === "Stopped") return refuse(start, event, "state", [row.state]);
      const moved = putW({ ...row, lastHeartbeatAt: beat.timestamp, cpu: beat.cpu, memory: beat.memory, reportedQueue: beat.queueLength, reportedRunning: beat.runningTasks, version: beat.version });
      if (beat.version !== row.version) note("worker.version", { workerId: row.id }, { to: beat.version });
      note("worker.heartbeat", { workerId: row.id }, { cpu: beat.cpu, memory: beat.memory, queue: beat.queueLength, running: beat.runningTasks });
      // only a valid heartbeat completes a start or a recovery
      if (row.state === "Starting") move(moved, "Idle", "heartbeat", { activeSince: beat.timestamp });
      else if (row.state === "Recovering") { move(moved, "Idle", "heartbeat", { activeSince: beat.timestamp, recoveries: row.recoveries + 1 }); note("worker.recovered", { workerId: row.id }); }
      return finishOk({ workerId: row.id });
    }

    case "submit": {
      if (!canOperate(actor)) return refuse(start, event, "forbidden");
      const spec = event.task;
      if (!validTask(spec)) return refuse(start, event, "invalid", ["task"]);
      if (taskOf(spec.id)) return finishOk({ taskId: spec.id, unchanged: true });
      if (tasks.filter((row) => row.tenantId === tenantId).length >= config.maxTasks) return refuse(start, event, "limit", ["maxTasks"]);
      tasks.push({
        id: spec.id, tenantId, specialty: spec.specialty, action: spec.action, priority: spec.priority, requiresApproval: spec.requiresApproval ?? false, ...(spec.minVersion ? { minVersion: spec.minVersion } : {}),
        capabilities: [...(spec.capabilities ?? [])], status: "pending", attempts: 0, maxAttempts: spec.maxAttempts ?? config.maxAttempts, submittedAt: at,
      });
      note("task.submitted", { taskId: spec.id }, { priority: spec.priority, level3: spec.requiresApproval ?? false });
      return finishOk({ taskId: spec.id });
    }

    case "schedule": {
      if (!canOperate(actor)) return refuse(start, event, "forbidden");
      const plan = planAssignments(workers.filter((row) => row.tenantId === tenantId), tasks.filter((row) => row.tenantId === tenantId), nowMs, config);
      for (const placement of plan.placements) {
        const row = taskOf(placement.taskId);
        if (!row) continue;
        putT({ ...row, status: placement.slot === "queued" ? "queued" : placement.slot, workerId: placement.workerId });
        note(placement.slot === "queued" ? "task.queued" : "task.assigned", { workerId: placement.workerId, taskId: row.id }, { priority: row.priority, slot: placement.slot });
      }
      note("runtime.scheduled", {}, { placed: plan.placements.length, unplaced: plan.unplaced.length });
      return finishOk({ placements: plan.placements, unplaced: plan.unplaced }, { placed: plan.placements.length });
    }

    case "taskStart": {
      const row = taskOf(event.taskId);
      if (!row) return refuse(start, event, "notFound", [`task:${event.taskId}`]);
      if (!(actor.kind === "system" || (actor.kind === "worker" && actor.id === row.workerId))) return refuse(start, event, "forbidden");
      const owner = row.workerId ? worker(row.workerId) : undefined;
      if (!owner) return refuse(start, event, "state", [row.status]);
      if (row.status === "retrying" && row.notBeforeMs !== undefined && row.notBeforeMs > nowMs) return refuse(start, event, "backoff", [`waitMs:${row.notBeforeMs - nowMs}`]);
      if (row.status !== "reserved" && row.status !== "retrying") return refuse(start, event, "state", [row.status]);
      if (!["Reserved", "Busy", "Retrying", "Stopping"].includes(owner.state)) return refuse(start, event, "state", [owner.state]);
      const { notBeforeMs: _notBefore, ...rest } = row;
      putT({ ...rest, status: "running", startedAt: at });
      note("task.started", { workerId: owner.id, taskId: row.id });
      return finishOk({ taskId: row.id, workerId: owner.id });
    }

    case "taskFinish": {
      const row = taskOf(event.taskId);
      if (!row) return refuse(start, event, "notFound", [`task:${event.taskId}`]);
      if (!(actor.kind === "system" || (actor.kind === "worker" && actor.id === row.workerId))) return refuse(start, event, "forbidden");
      const owner = row.workerId ? worker(row.workerId) : undefined;
      if (!owner || row.status !== "running") return refuse(start, event, "state", [row.status]);
      if (event.outcome === "failed" && event.error === undefined) return refuse(start, event, "invalid", ["error"]);
      if (event.outcome === "completed") {
        putT({ ...row, status: "completed" });
        note("task.completed", { workerId: owner.id, taskId: row.id }, { attempts: row.attempts + 1 });
      } else if (event.error === "fatal") {
        // a fatal error is never retried, and it takes the worker out: what it held goes back to the pool and a person must recover it
        putT({ ...row, status: "failed", lastError: "fatal", attempts: row.attempts + 1 });
        note("task.failed", { workerId: owner.id, taskId: row.id }, { error: "fatal" });
        putW({ ...owner, errors: owner.errors + 1 });
        releaseWhere(owner.id, HELD, "fatal");
        const latest = worker(owner.id);
        if (latest) move(latest, "Failed", "fatal", {}, true);
      } else {
        const decision = retryDecision(row, nowMs, config);
        if (decision.retry) {
          putT({ ...row, status: "retrying", attempts: decision.attempts, lastError: "retryable", ...(decision.notBeforeMs !== undefined ? { notBeforeMs: decision.notBeforeMs } : {}) });
          putW({ ...owner, retries: owner.retries + 1 });
          note("task.retry", { workerId: owner.id, taskId: row.id }, { attempts: decision.attempts, backoffMs: (decision.notBeforeMs ?? nowMs) - nowMs });
        } else {
          putT({ ...row, status: "failed", lastError: "retryable", attempts: decision.attempts });
          putW({ ...owner, errors: owner.errors + 1 });
          note("task.failed", { workerId: owner.id, taskId: row.id }, { error: "retryable", attempts: decision.attempts });
        }
      }
      return finishOk({ taskId: row.id, workerId: owner.id });
    }

    case "tick": {
      if (!canOperate(actor)) return refuse(start, event, "forbidden");
      const counts = { offline: 0, recovering: 0, released: 0, failed: 0 };
      for (const row of workers.filter((entry) => entry.tenantId === tenantId).sort((a, b) => a.id.localeCompare(b.id))) {
        const silent = heartbeatExpired(row, nowMs, config);
        switch (row.state) {
          case "Idle":
            if (silent) { note("worker.timeout", { workerId: row.id }, { silentMs: silenceMs(row, nowMs) }); move(row, "Offline", "timeout"); counts.offline += 1; }
            break;
          case "Reserved":
          case "WaitingApproval":
            // never straight to Offline: it hands back what it held and becomes Idle first (the next silent tick takes it Offline)
            if (silent) { note("worker.timeout", { workerId: row.id }, { silentMs: silenceMs(row, nowMs) }); releaseWhere(row.id, ["reserved", "queued", "awaitingApproval"], "timeout"); move(row, "Idle", "timeout"); counts.released += 1; }
            break;
          case "Busy":
          case "Retrying": {
            if (!silent) break;
            // a Busy worker is NEVER taken Offline directly: its tasks are retried (if they can be) elsewhere and it goes to Recovering
            note("worker.timeout", { workerId: row.id }, { silentMs: silenceMs(row, nowMs) });
            for (const entry of held(row.id)) {
              if (entry.status !== "running" && entry.status !== "retrying") { release(entry, "timeout"); continue; }
              const decision = retryDecision(entry, nowMs, config);
              const { workerId: _worker, ...rest } = entry;
              if (decision.retry) {
                putT({ ...rest, status: "pending", attempts: decision.attempts, lastError: "heartbeatLost", ...(decision.notBeforeMs !== undefined ? { notBeforeMs: decision.notBeforeMs } : {}) });
                note("task.retry", { taskId: entry.id }, { attempts: decision.attempts, backoffMs: (decision.notBeforeMs ?? nowMs) - nowMs, cause: "heartbeatLost" });
              } else {
                putT({ ...rest, status: "failed", lastError: "heartbeatLost", attempts: decision.attempts });
                note("task.failed", { taskId: entry.id }, { error: "heartbeatLost", attempts: decision.attempts });
              }
            }
            const latest = worker(row.id) ?? row;
            putW({ ...latest, errors: latest.errors + 1 });
            move(latest, "Recovering", "timeout", { watchFrom: at }, true);
            counts.recovering += 1;
            break;
          }
          case "Recovering":
            if (silent) { note("worker.timeout", { workerId: row.id }, { silentMs: silenceMs(row, nowMs) }); move(row, "Offline", "timeout"); counts.offline += 1; }
            break;
          case "Starting":
            if (silenceMs(row, nowMs) > config.startTimeoutMs) { note("worker.timeout", { workerId: row.id }, { silentMs: silenceMs(row, nowMs) }); move(row, "Failed", "startTimeout"); counts.failed += 1; }
            break;
          default:
            break;
        }
      }
      note("runtime.tick", {}, counts);
      return finishOk({}, counts);
    }
  }
}
