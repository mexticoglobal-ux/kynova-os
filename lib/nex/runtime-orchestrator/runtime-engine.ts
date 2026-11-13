// Runtime Engine: the Runtime Adapter (seven pure functions on one queue item) and the pure reducer `reduceRuntime(state, event, sources, config)` that orchestrates them. The adapter functions only
// produce structures:  prepareExecution · assignWorker · startExecution · pauseExecution · resumeExecution · cancelExecution · finishExecution.  NONE of them executes a real action, calls an API, a
// Connector, a provider or a Worker: `startExecution` records that the Runtime was told to start a step (state Running, with its deadline), and `finishExecution` records what a future runtime reported.
// The reducer is deterministic: the same state, event and company data always give the same result; there is no clock, no network, no database and no AI.
// Authorization comes first: no step is ever started on an approval nobody can check, nor before every dependency is Completed.

import { canOperate, canReport, canSeePlan, stepPermission, topologicalOrder } from "@/lib/nex/execution";
import { planDependencyCycle } from "./dependency-graph";
import { authorized, itemsOfPlan, queueOrder, refreshQueue } from "./execution-queue";
import { backoffFor, detectBlockages, detectTimeouts, dispatchList, retryDecision } from "./scheduler";
import { chooseWorker, eligibility, loadOf } from "./worker-assignment";
import {
  DEFAULT_CONFIG, TERMINAL_ITEM, TERMINAL_RUN,
  type Blockage, type ExecutionPlan, type OrchestratorConfig, type OrchestratorEnv, type OrchestratorEventInput, type OrchestratorEventType, type OrchestratorWorker, type Principal, type QueueItem, type Refusal,
  type Role, type RunRecord, type RuntimeEvent, type RuntimeOutcome, type RuntimeResult, type RuntimeSources, type RuntimeState,
} from "./orchestrator-types";

// ---------------------------------------------------------------------------------------------- the Runtime Adapter: structures, never actions
/** An approved plan → its run and its queue items. Nothing is assigned or started. */
export function prepareExecution(plan: ExecutionPlan, context: { at: string; approvedBy: string; approverRole?: Role }): { run: RunRecord; items: QueueItem[] } {
  const items = itemsOfPlan(plan, context.at);
  return {
    run: {
      planId: plan.id, tenantId: plan.tenantId, priority: plan.priority, impact: plan.expectedImpact.score, needs: plan.needs, status: "Queued", paused: false, approvedBy: context.approvedBy,
      ...(context.approverRole ? { approverRole: context.approverRole } : {}), enqueuedAt: context.at, planExpiresAt: plan.expiresAt, itemIds: items.map((item) => item.id), planDependsOn: [...plan.dependsOn].sort(),
    },
    items,
  };
}
/** Gives the item to the best eligible worker of ITS company, or says why nobody could take it. The item is returned unchanged when nobody can. */
export function assignWorker(item: QueueItem, workers: readonly OrchestratorWorker[], env: OrchestratorEnv, load: ReadonlyMap<string, number>): { item: QueueItem; assigned: boolean; rejected: Readonly<Record<string, number>> } {
  const choice = chooseWorker(item, workers.filter((worker) => worker.tenantId === item.tenantId), env, load);
  return choice.workerId ? { item: { ...item, workerId: choice.workerId, state: "Assigned" }, assigned: true, rejected: choice.rejected } : { item, assigned: false, rejected: choice.rejected };
}
/** Records that the Runtime was told to start the item: Running, with the instant its time is up. Executes nothing. */
export const startExecution = (item: QueueItem, nowMs: number): QueueItem => {
  const { notBeforeMs: _notBefore, ...rest } = item;
  return { ...rest, state: "Running", startedAt: new Date(nowMs).toISOString(), deadlineAt: new Date(nowMs + item.timeoutMs).toISOString() };
};
export const pauseExecution = (item: QueueItem): QueueItem => (TERMINAL_ITEM.includes(item.state) || item.state === "Paused" ? item : { ...item, pausedFrom: item.state, state: "Paused" });
/** A paused item goes back to what it was doing (a running item keeps the time it had left: its deadline moves by the time it was paused); anything else is evaluated again. */
export function resumeExecution(item: QueueItem, pausedMs: number): QueueItem {
  if (item.state !== "Paused") return item;
  const { pausedFrom, ...rest } = item;
  if (pausedFrom === "Running" && item.deadlineAt) return { ...rest, state: "Running", deadlineAt: new Date(Date.parse(item.deadlineAt) + pausedMs).toISOString() };
  return { ...rest, state: "Pending" };
}
export const cancelExecution = (item: QueueItem): QueueItem => {
  if (TERMINAL_ITEM.includes(item.state)) return item;
  const { workerId: _worker, pausedFrom: _from, ...rest } = item;
  return { ...rest, state: "Cancelled" };
};
/** What a future runtime reported about an item that was running. A failure retries after a backoff while attempts remain; otherwise the item fails. */
export function finishExecution(item: QueueItem, outcome: "completed" | "failed" | "timeout", nowMs: number, maxBackoffMs: number): { item: QueueItem; retried: boolean } {
  const { workerId: _worker, startedAt: _started, deadlineAt: _deadline, ...rest } = item;
  if (outcome === "completed") return { item: { ...item, state: "Completed", completedAt: new Date(nowMs).toISOString() }, retried: false };
  const decision = retryDecision(item, nowMs, maxBackoffMs);
  const lastFailure = outcome === "timeout" ? ("timeout" as const) : ("failed" as const);
  return decision.retry
    ? { item: { ...rest, state: "Pending", attempts: decision.attempts, notBeforeMs: decision.notBeforeMs as number, lastFailure }, retried: true }
    : { item: { ...item, state: "Failed", attempts: decision.attempts, lastFailure, completedAt: new Date(nowMs).toISOString() }, retried: false };
}
export { backoffFor };

// ---------------------------------------------------------------------------------------------- the reducer
export const newRuntimeState = (): RuntimeState => ({ runs: [], queue: [], audit: [] });
const MAX_AUDIT = 2_000;
const name = (principal: Principal): string => (principal.kind === "system" ? "system" : principal.id);

const note = (event: RuntimeEvent, type: OrchestratorEventType, ids: { planId?: string; itemId?: string } = {}, detail?: Readonly<Record<string, unknown>>): OrchestratorEventInput => ({
  at: event.at, tenantId: event.actor.tenantId, actorKind: event.actor.kind, actorId: name(event.actor), type, ...(ids.planId ? { planId: ids.planId } : {}), ...(ids.itemId ? { itemId: ids.itemId } : {}), ...(detail ? { detail } : {}),
});
function finish(state: RuntimeState, event: RuntimeEvent, result: Omit<RuntimeResult, "events">, events: readonly OrchestratorEventInput[], detail: Record<string, string | number | boolean> = {}): RuntimeOutcome {
  // the audit trail names the action and counts, never any content; it is written in the ACTOR's company
  const entry = { at: event.at, actor: name(event.actor), tenantId: event.actor.tenantId, action: `${event.type}${result.ok ? "" : ".refused"}`, detail: { ok: result.ok, ...(result.refusal ? { reason: result.refusal } : {}), ...detail } };
  return { state: { ...state, audit: [...state.audit, entry].slice(-MAX_AUDIT) }, result: { ...result, events } };
}
const refuse = (state: RuntimeState, event: RuntimeEvent, refusal: Refusal, reasons: readonly string[] = []): RuntimeOutcome =>
  finish(state, event, { ok: false, refusal, ...(reasons.length > 0 ? { reasons } : {}) }, [note(event, "orchestrator.refused", {}, { reason: refusal, action: event.type })]);

const mine = <T extends { tenantId: string }>(list: readonly T[], tenantId: string): T[] => list.filter((row) => row.tenantId === tenantId);
const others = <T extends { tenantId: string }>(list: readonly T[], tenantId: string): T[] => list.filter((row) => row.tenantId !== tenantId);
const runMap = (runs: readonly RunRecord[]) => new Map(runs.map((run) => [run.planId, run]));
const sees = (actor: Principal, row: { needs: "general" | "finance"; tenantId: string }) => canSeePlan(actor, row);

/** The state of a run, from its items. A terminal run stays terminal. */
function deriveRun(run: RunRecord, items: readonly QueueItem[], at: string): RunRecord {
  if (TERMINAL_RUN.includes(run.status)) return run;
  const own = items.filter((item) => item.planId === run.planId);
  if (own.some((item) => item.state === "Failed")) return { ...run, status: "Failed", completedAt: at };
  if (own.length > 0 && own.every((item) => item.state === "Completed")) return { ...run, status: "Completed", completedAt: at };
  if (own.some((item) => item.state === "Expired")) return { ...run, status: "Expired", completedAt: at };
  if (own.length > 0 && own.every((item) => TERMINAL_ITEM.includes(item.state))) return { ...run, status: "Cancelled", completedAt: at };
  const started = own.some((item) => item.startedAt !== undefined || item.state === "Completed");
  return { ...run, status: run.paused ? "Paused" : started ? "Running" : "Queued", ...(started && !run.startedAt ? { startedAt: at } : {}) };
}
const RUN_EVENT: Readonly<Partial<Record<RunRecord["status"], OrchestratorEventType>>> = { Completed: "run.completed", Failed: "run.failed", Expired: "run.expired" };

/** A terminal failure stops the run: whatever has not started is cancelled (what is running is left for the runtime to report). */
function cascadeFailure(items: readonly QueueItem[], planId: string): QueueItem[] {
  return items.map((item) => (item.planId === planId && item.state !== "Running" && !TERMINAL_ITEM.includes(item.state) ? cancelExecution(item) : item));
}

export function reduceRuntime(start: RuntimeState, event: RuntimeEvent, sources: RuntimeSources, config: OrchestratorConfig = DEFAULT_CONFIG): RuntimeOutcome {
  const { actor, tenantId } = event;
  const denied = stepPermission(actor, sources.env, tenantId);
  if (denied) return refuse(start, event, denied as Refusal); // only `tenant` or `workerInactive`
  if (Number.isNaN(Date.parse(event.at))) return refuse(start, event, "invalid", ["at"]);
  const nowMs = Date.parse(event.at);
  const state = start;
  const workers = mine(sources.workers, tenantId);

  /** Applies a change to ONE company's items and runs, leaving everyone else's untouched, and announces what finished. */
  const commit = (items: readonly QueueItem[], runs: readonly RunRecord[], events: OrchestratorEventInput[]): RuntimeState => {
    const nextRuns = runs.map((run) => {
      const next = deriveRun(run, items, event.at);
      if (next.status !== run.status && RUN_EVENT[next.status]) events.push(note(event, RUN_EVENT[next.status] as OrchestratorEventType, { planId: run.planId }, { items: next.itemIds.length }));
      return next;
    });
    return { ...state, queue: [...others(state.queue, tenantId), ...items], runs: [...others(state.runs, tenantId), ...nextRuns] };
  };
  const items0 = mine(state.queue, tenantId);
  const runs0 = mine(state.runs, tenantId);

  switch (event.type) {
    case "enqueue": {
      if (!canOperate(actor)) return refuse(state, event, "forbidden");
      const { plan } = event;
      if (plan.tenantId !== tenantId) return refuse(state, event, "tenant", ["crossTenant"]);
      // permissions first: a plan the actor may not see does not exist for them
      if (!sees(actor, plan)) return refuse(state, event, "notFound");
      if (plan.status !== "Approved" && plan.status !== "Running") return refuse(state, event, "state", [plan.status]);
      if (!plan.decidedBy) return refuse(state, event, "state", ["notApproved"]);
      if (runs0.some((run) => run.planId === plan.id)) return finish(state, event, { ok: true, unchanged: true, run: runs0.find((run) => run.planId === plan.id) as RunRecord }, []);
      if (topologicalOrder(plan.steps) === undefined) return refuse(state, event, "invalid", ["plan.cycle"]);
      if (planDependencyCycle(plan.id, plan.dependsOn, runs0)) return refuse(state, event, "cycle", ["plan.dependencyCycle"]);
      if (runs0.length >= config.maxRuns) return refuse(state, event, "limit", ["maxRuns"]);
      const role = sources.roleOf(plan.decidedBy);
      const prepared = prepareExecution(plan, { at: event.at, approvedBy: plan.decidedBy, ...(role ? { approverRole: role } : {}) });
      const runs = [...runs0, prepared.run];
      const items = refreshQueue([...items0, ...prepared.items], runMap(runs), nowMs);
      const events: OrchestratorEventInput[] = [note(event, "queue.enqueued", { planId: plan.id }, { items: prepared.items.length, priority: plan.priority, authorized: items.filter((item) => item.planId === plan.id && item.state !== "WaitingApproval").length })];
      const next = commit(items, runs, events);
      return finish(next, event, { ok: true, run: next.runs.find((run) => run.planId === plan.id) as RunRecord, items: next.queue.filter((item) => item.planId === plan.id) }, events, { items: prepared.items.length });
    }

    case "tick": {
      if (!canOperate(actor)) return refuse(state, event, "forbidden");
      const events: OrchestratorEventInput[] = [];
      let items = [...items0];
      let runs = [...runs0];
      const autoStart = event.autoStart ?? config.autoStart;
      const counts = { expired: 0, timeouts: 0, retries: 0, assigned: 0, unassigned: 0, started: 0 };

      // a) a run that never started and whose plan expired is over
      for (const run of runs) {
        if (TERMINAL_RUN.includes(run.status) || nowMs < Date.parse(run.planExpiresAt)) continue;
        if (items.some((item) => item.planId === run.planId && (item.startedAt !== undefined || item.state === "Running" || item.state === "Completed"))) continue;
        items = items.map((item) => (item.planId === run.planId && !TERMINAL_ITEM.includes(item.state) ? { ...item, state: "Expired" as const, ...(item.workerId ? {} : {}) } : item));
        counts.expired += 1;
      }
      // b) running items whose time is up: a timeout is a failed attempt
      for (const late of detectTimeouts(items, nowMs)) {
        const result = finishExecution(late, "timeout", nowMs, config.maxBackoffMs);
        items = items.map((item) => (item.id === late.id ? result.item : item));
        counts.timeouts += 1;
        events.push(note(event, "execution.timeout", { planId: late.planId, itemId: late.id }, { attempts: result.item.attempts, timeoutMs: late.timeoutMs }));
        if (result.retried) { counts.retries += 1; events.push(note(event, "execution.retry", { planId: late.planId, itemId: late.id }, { attempts: result.item.attempts, backoffMs: (result.item.notBeforeMs as number) - nowMs })); }
        else { events.push(note(event, "execution.failed", { planId: late.planId, itemId: late.id }, { attempts: result.item.attempts, cause: "timeout" })); items = cascadeFailure(items, late.planId); }
      }
      // c) a worker that stopped being eligible (inactive, changed company, lost the permission) lets go of its items
      for (const held of queueOrder(items.filter((item) => item.state === "Assigned"))) {
        const worker = workers.find((row) => row.id === held.workerId);
        const result = worker ? eligibility(worker, held, sources.env, new Map()) : ({ ok: false, reason: "inactive" } as const);
        if (!result.ok) { const { workerId: _w, ...rest } = held; items = items.map((item) => (item.id === held.id ? { ...rest, state: "Ready" as const } : item)); counts.unassigned += 1; events.push(note(event, "queue.unassigned", { planId: held.planId, itemId: held.id }, { reason: result.reason })); }
      }
      // d) every item is evaluated from the facts (authorization, dependencies, backoff)
      items = refreshQueue(items, runMap(runs), nowMs);
      // e) workers are assigned in queue order, by permission, specialty, availability, capacity and load
      const load = loadOf(items);
      for (const ready of queueOrder(items.filter((item) => item.state === "Ready"))) {
        const result = assignWorker(ready, workers, sources.env, load);
        if (!result.assigned) continue;
        load.set(result.item.workerId as string, (load.get(result.item.workerId as string) ?? 0) + 1);
        items = items.map((item) => (item.id === ready.id ? result.item : item));
        counts.assigned += 1;
        events.push(note(event, "queue.assigned", { planId: ready.planId, itemId: ready.id }, { workerId: result.item.workerId as string, level: ready.level }));
      }
      // f) what is ready and assigned: the dispatch list, and, only when asked, the start of those items
      const dispatch = dispatchList(items, runMap(runs));
      if (autoStart) {
        for (const entry of dispatch) {
          items = items.map((item) => (item.id === entry.itemId ? startExecution(item, nowMs) : item));
          counts.started += 1;
          events.push(note(event, "execution.started", { planId: entry.planId, itemId: entry.itemId }, { workerId: entry.workerId, level: entry.level, auto: true }));
        }
      }
      // g) what is stuck
      const blockages: Blockage[] = detectBlockages(items, runMap(runs), workers, sources.env, nowMs, config.blockedAfterMs);
      const kinds = new Map<string, number>();
      for (const blockage of blockages) kinds.set(blockage.kind, (kinds.get(blockage.kind) ?? 0) + 1);
      for (const [kind, count] of [...kinds].sort((a, b) => a[0].localeCompare(b[0]))) events.push(note(event, "orchestrator.blocked", {}, { kind, count }));
      runs = runs.map((run) => (counts.expired > 0 && !TERMINAL_RUN.includes(run.status) && items.some((item) => item.planId === run.planId && item.state === "Expired") ? { ...run } : run));
      events.push(note(event, "orchestrator.tick", {}, { ...counts, dispatchable: autoStart ? 0 : dispatch.length, blocked: blockages.length, queued: items.filter((item) => !TERMINAL_ITEM.includes(item.state)).length }));
      const next = commit(items, runs, events);
      return finish(next, event, { ok: true, dispatch: autoStart ? [] : dispatch, blockages }, events, { assigned: counts.assigned, started: counts.started, timeouts: counts.timeouts });
    }

    case "start": {
      // only the system says the Runtime was told to start something
      if (!canReport(actor)) return refuse(state, event, "forbidden");
      const item = items0.find((row) => row.id === event.itemId);
      if (!item || !sees(actor, item)) return refuse(state, event, "notFound");
      const run = runs0.find((row) => row.planId === item.planId);
      if (TERMINAL_ITEM.includes(item.state)) return refuse(state, event, "state", [item.state]);
      // no step is ever started without authorization, before its dependencies are Completed, or without a worker
      if (item.state === "WaitingApproval" || !authorized(item, run)) return refuse(state, event, "authorization", [`requires:${item.approverRole}`]);
      if (item.state === "WaitingDependencies") return refuse(state, event, "dependency", [item.state]);
      if (item.state === "Ready") return refuse(state, event, "worker", ["noWorkerAssigned"]);
      if (item.state !== "Assigned" || run?.paused) return refuse(state, event, "state", [item.state]);
      const worker = workers.find((row) => row.id === item.workerId);
      if (!worker || !eligibility(worker, item, sources.env, new Map()).ok) return refuse(state, event, "worker", ["workerNotEligible"]);
      const started = startExecution(item, nowMs);
      const events = [note(event, "execution.started", { planId: item.planId, itemId: item.id }, { workerId: worker.id, level: item.level, auto: false })];
      const next = commit(items0.map((row) => (row.id === item.id ? started : row)), runs0, events);
      return finish(next, event, { ok: true, item: started }, events);
    }

    case "finish": {
      if (!canReport(actor)) return refuse(state, event, "forbidden");
      const item = items0.find((row) => row.id === event.itemId);
      if (!item || !sees(actor, item)) return refuse(state, event, "notFound");
      if (item.state !== "Running") return refuse(state, event, "state", [item.state]);
      const result = finishExecution(item, event.outcome, nowMs, config.maxBackoffMs);
      let items = items0.map((row) => (row.id === item.id ? result.item : row));
      const events: OrchestratorEventInput[] = [];
      if (event.outcome === "completed") events.push(note(event, "execution.finished", { planId: item.planId, itemId: item.id }, { level: item.level, durationMs: nowMs - Date.parse(item.startedAt as string) }));
      else if (result.retried) events.push(note(event, "execution.retry", { planId: item.planId, itemId: item.id }, { attempts: result.item.attempts, backoffMs: (result.item.notBeforeMs as number) - nowMs }));
      else { events.push(note(event, "execution.failed", { planId: item.planId, itemId: item.id }, { attempts: result.item.attempts, cause: "failed" })); items = cascadeFailure(items, item.planId); }
      // whatever this unblocks is evaluated at once
      items = refreshQueue(items, runMap(runs0), nowMs);
      const next = commit(items, runs0, events);
      return finish(next, event, { ok: true, item: next.queue.find((row) => row.id === item.id) as QueueItem }, events);
    }

    case "pause":
    case "resume":
    case "cancel": {
      if (!canOperate(actor)) return refuse(state, event, "forbidden");
      const run = runs0.find((row) => row.planId === event.planId);
      if (!run || !sees(actor, run)) return refuse(state, event, "notFound");
      if (TERMINAL_RUN.includes(run.status)) return refuse(state, event, "state", [run.status]);
      const events: OrchestratorEventInput[] = [];
      let items = [...items0];
      let runs = [...runs0];
      if (event.type === "pause") {
        if (run.paused) return refuse(state, event, "state", ["Paused"]);
        items = items.map((item) => (item.planId === run.planId ? pauseExecution(item) : item));
        runs = runs.map((row) => (row.planId === run.planId ? { ...row, paused: true, pausedAtMs: nowMs } : row));
        events.push(note(event, "execution.paused", { planId: run.planId }, { items: items.filter((item) => item.planId === run.planId && item.state === "Paused").length }));
      } else if (event.type === "resume") {
        if (!run.paused) return refuse(state, event, "state", [run.status]);
        const pausedMs = nowMs - (run.pausedAtMs ?? nowMs);
        items = refreshQueue(items.map((item) => (item.planId === run.planId ? resumeExecution(item, pausedMs) : item)), runMap(runs.map((row) => (row.planId === run.planId ? { ...row, paused: false } : row))), nowMs);
        const { pausedAtMs: _paused, ...rest } = run;
        runs = runs.map((row) => (row.planId === run.planId ? { ...rest, paused: false } : row));
        events.push(note(event, "execution.resumed", { planId: run.planId }, { pausedMs }));
      } else {
        items = items.map((item) => (item.planId === run.planId ? cancelExecution(item) : item));
        runs = runs.map((row) => (row.planId === run.planId ? { ...row, status: "Cancelled" as const, paused: false, completedAt: event.at } : row));
        events.push(note(event, "execution.cancelled", { planId: run.planId }, { items: items.filter((item) => item.planId === run.planId && item.state === "Cancelled").length }));
      }
      const next = commit(items, runs, events);
      return finish(next, event, { ok: true, run: next.runs.find((row) => row.planId === run.planId) as RunRecord }, events);
    }
  }
}
