// AI Agent Runtime store: each company's agent sessions and the log of everything that happened. Pure and deterministic, one global state with every record owned by a
// company (tenant): nothing is shared between companies. There is NO real model, tool or network call: an agent is a KOE Worker driven by a playbook, and every step goes
// through the engines that already exist, which this file only CALLS and never changes:
//   - a tool, a memory entry, an approval or the end of the run -> the Workers engine (koe-engine.ts), so the Worker's tools, data clearance, memory, autonomy levels,
//     approvals and kill switches all apply exactly as they do for any Worker;
//   - a thought (a question to the AI) -> KOE's AI request (koe-ai-center.ts), which decides the Worker, specialty, priority and policy, asks the AI Cost Optimizer and
//     hands the work to the AI Gateway. The runtime never names a model or a provider, and never talks to the Optimizer or the Gateway itself.
//
// Constitution (ADR-0009): an agent only prepares. A person starts a session, decides every approval and can cancel or take over; NEX and the Workers cannot start a
// session. A Level 3 action (money, anything that acts outside the platform) always waits for a person, and a rejection ends the session: it is never retried or worked around.
// Every session is bounded (steps, AI calls, budget, time, repeated steps), a temporary failure is retried a few times and then goes to a person, and the kill switches of
// KOE win over everything. There is no event that edits or deletes a session or a log: every list only grows.

import { isPerson } from "./actors";
import {
  AGENT_LIMIT_DEFAULTS, playbookById, validateLimits, type AgentLimits, type PlanStep, type StopReason,
} from "./agent-catalog";
import { message, reason, stopText, type ErrorCode } from "./agent-messages";
import {
  aiCallsExhausted, attemptOf, backoffMs, checkLimits, isFinal, isLoop, mayRetry, renderStep, stepSignature, validatePlaybook,
  type Session, type SessionStep, type SessionStepStatus,
} from "./agent-runtime";
import { newKoeState, reduceKoe, workerActor, type KoeResult, type KoeState } from "./koe-engine";
import { newAiState, reduceAi, type AiResult, type AiState } from "./koe-ai-center";
import type { ErrorCode as KoeErrorCode } from "./koe-messages";

export * from "./agent-catalog";
export type { Session, SessionStep } from "./agent-runtime";

export type AgentLog = { at: string; actor: string; tenantId: string; sessionId?: string; action: string; detail?: string };
/** A simulated failure a test or the platform plants: the next `times` attempts at `target` (a tool id, or "ai") fail for this company. */
export type Fault = { id: string; tenantId: string; target: string; remaining: number };
export type AgentState = { koe: KoeState; ai: AiState; sessions: readonly Session[]; faults: readonly Fault[]; logs: readonly AgentLog[]; sequence: number };
export const newAgentState = (admins: readonly string[] = []): AgentState => ({ koe: newKoeState(admins), ai: newAiState(), sessions: [], faults: [], logs: [], sequence: 0 });

type Base = { at: string; tenantId: string; actor: string };
export type AgentEvent =
  | (Base & { type: "session.start"; instanceId: string; playbookId: string; goal: string; input: Readonly<Record<string, string>>; limits?: Partial<AgentLimits> })
  | (Base & { type: "session.step"; sessionId: string })
  | (Base & { type: "session.run"; sessionId: string })
  | (Base & { type: "session.approve"; sessionId: string; approve: boolean; reason?: string })
  | (Base & { type: "session.cancel"; sessionId: string })
  | (Base & { type: "session.takeover"; sessionId: string; note: string })
  | (Base & { type: "fault.inject"; target: string; times: number })
  | (Base & { type: "fault.clear"; target: string });

export type AgentResult = { state: AgentState; error?: string; errorCode?: ErrorCode | KoeErrorCode; session?: Session };

const append = <T,>(items: readonly T[], item: T): readonly T[] => [...items, item];
const log = (state: AgentState, base: Base, action: string, detail?: string, sessionId?: string): AgentState => ({
  ...state, logs: append(state.logs, { at: base.at, actor: base.actor, tenantId: base.tenantId, action, ...(sessionId ? { sessionId } : {}), ...(detail ? { detail } : {}) }),
});
const withSession = (state: AgentState, session: Session): AgentState => ({ ...state, sessions: state.sessions.map((item) => (item.id === session.id ? session : item)) });
const sessionById = (state: AgentState, id: string): Session | undefined => state.sessions.find((item) => item.id === id);
const lastRun = (koe: KoeState, runId: string) => koe.runs.find((item) => item.id === runId);

/** Adds a step to a session. The id is the session's own, in order. */
function addStep(session: Session, base: Base, step: Omit<SessionStep, "id" | "at" | "signature"> & { signature: string }): Session {
  const entry: SessionStep = { id: `${session.id}.${session.steps.length + 1}`, at: base.at, ...step };
  return { ...session, steps: append(session.steps, entry) as readonly SessionStep[] };
}

export function reduceAgent(state: AgentState, event: AgentEvent): AgentResult {
  const refuse = (code: ErrorCode, params: Record<string, string | number> = {}): AgentResult => ({ state, error: message(code, params), errorCode: code });
  const fromKoe = (result: KoeResult): AgentResult => ({ state, error: message("koeRefused", { detail: result.error ?? "" }), errorCode: result.errorCode ?? "koeRefused" });
  if (event.tenantId.trim() === "" || event.actor.trim() === "") return refuse("invalid", { detail: "empresa o autor" });

  switch (event.type) {
    // ================================================================ a person starts a session
    case "session.start": {
      if (!isPerson(event.actor) && event.actor !== "system") return refuse("personRequired");
      const playbook = playbookById(event.playbookId);
      if (!playbook) return refuse("playbookNotFound", { detail: event.playbookId });
      const instance = state.koe.instances.find((item) => item.id === event.instanceId);
      if (!instance) return refuse("invalid", { detail: "instancia del Worker" });
      if (instance.tenantId !== event.tenantId) return refuse("notYours");
      if (instance.definitionId !== playbook.workerId) return refuse("workerMismatch", { detail: playbook.id });
      const definition = state.koe.definitions.find((item) => item.id === instance.definitionId);
      if (!definition) return refuse("invalid", { detail: "Worker" });
      const issues = validatePlaybook(playbook, definition, state.koe.tools);
      if (issues.length) return refuse("planInvalid", { detail: issues[0] ?? "plan" });
      for (const param of playbook.params) if ((event.input[param] ?? "").trim() === "") return refuse("missingParam", { detail: param });
      if (event.goal.trim() === "") return refuse("invalid", { detail: "objetivo" });
      const limits: AgentLimits = { ...AGENT_LIMIT_DEFAULTS, ...playbook.limits, ...event.limits };
      const limitIssues = validateLimits(limits);
      if (limitIssues.length) return refuse("invalid", { detail: limitIssues[0] ?? "límites" });
      const started = reduceKoe(state.koe, { type: "run.start", at: event.at, tenantId: event.tenantId, actor: event.actor, instanceId: instance.id, goal: event.goal });
      if (started.error) return fromKoe(started);
      const run = started.state.runs.at(-1);
      if (!run) return refuse("invalid", { detail: "ejecución" });
      const sequence = state.sequence + 1;
      const session: Session = {
        id: `ag_${String(sequence).padStart(4, "0")}`, tenantId: event.tenantId, instanceId: instance.id, workerId: definition.id, playbookId: playbook.id, goal: event.goal.trim(),
        input: event.input, runId: run.id, status: "running", cursor: 0, steps: [], startedBy: event.actor, startedAt: event.at, limits, baseCostMicros: run.estimatedCostMicros,
        spentMicros: run.estimatedCostMicros, aiCalls: 0,
      };
      const next = log({ ...state, koe: started.state, sessions: append(state.sessions, session) as readonly Session[], sequence }, event, "session.start", `${playbook.id} · ${run.id}`, session.id);
      return { state: next, session };
    }

    case "session.step": return advance(state, event, event.sessionId);

    case "session.run": {
      let current = advance(state, event, event.sessionId);
      if (current.error) return current;
      for (let guard = 0; guard < 100; guard += 1) {
        const session = current.session;
        if (!session || session.status !== "running") break;
        const next = advance(current.state, event, event.sessionId);
        if (next.error) break;
        current = next;
      }
      return current;
    }

    // ================================================================ a person decides what the agent may not
    case "session.approve": {
      if (!isPerson(event.actor)) return refuse("personRequired");
      const session = sessionById(state, event.sessionId);
      if (!session) return refuse("notFound");
      if (session.tenantId !== event.tenantId) return refuse("notYours");
      const waiting = session.steps.findLast((item) => item.status === "waiting");
      if (session.status !== "waitingApproval" || !waiting?.approvalId) return refuse("notWaiting");
      const decided = reduceKoe(state.koe, { type: "approval.decide", at: event.at, tenantId: event.tenantId, actor: event.actor, approvalId: waiting.approvalId, approve: event.approve, ...(event.reason ? { reason: event.reason } : {}) });
      if (decided.error) return fromKoe(decided);
      const mark = (status: SessionStepStatus, note: string): Session => ({ ...session, steps: session.steps.map((item) => (item.id === waiting.id ? { ...item, status, note } : item)) });
      const koeState = decided.state;
      if (event.approve) {
        const updated: Session = { ...mark("done", `aprobado por ${event.actor}`), status: "running", cursor: session.cursor + 1 };
        return { state: log(withSession({ ...state, koe: koeState }, updated), event, "session.approve", waiting.detail, session.id), session: updated };
      }
      const rejected = mark("failed", reason("rejected", { detail: waiting.detail }));
      return stop({ ...state, koe: koeState }, rejected, "rejected", event);
    }

    case "session.cancel": {
      if (!isPerson(event.actor)) return refuse("personRequired");
      const session = sessionById(state, event.sessionId);
      if (!session) return refuse("notFound");
      if (session.tenantId !== event.tenantId) return refuse("notYours");
      if (isFinal(session.status)) return refuse("finished");
      const cancelled = reduceKoe(state.koe, { type: "run.cancel", at: event.at, tenantId: event.tenantId, actor: event.actor, runId: session.runId });
      const koeState = cancelled.error ? state.koe : cancelled.state;
      const updated: Session = { ...session, status: "cancelled", stopReason: "cancelled", finishedAt: event.at };
      return { state: log(withSession({ ...state, koe: koeState }, updated), event, "session.cancel", undefined, session.id), session: updated };
    }

    case "session.takeover": {
      if (!isPerson(event.actor)) return refuse("personRequired");
      const session = sessionById(state, event.sessionId);
      if (!session) return refuse("notFound");
      if (session.tenantId !== event.tenantId) return refuse("notYours");
      if (session.status !== "escalated" || !session.escalation) return refuse("notEscalated");
      if (event.note.trim() === "") return refuse("invalid", { detail: "nota" });
      const cancelled = reduceKoe(state.koe, { type: "run.cancel", at: event.at, tenantId: event.tenantId, actor: event.actor, runId: session.runId });
      const koeState = cancelled.error ? state.koe : cancelled.state;
      const updated: Session = { ...session, status: "handedOff", finishedAt: event.at, escalation: { ...session.escalation, handledBy: event.actor }, result: event.note.trim() };
      return { state: log(withSession({ ...state, koe: koeState }, updated), event, "session.takeover", event.note.trim(), session.id), session: updated };
    }

    // ================================================================ simulated failures (the platform only)
    case "fault.inject": {
      if (event.actor !== "system") return refuse("systemOnly");
      if (!Number.isInteger(event.times) || event.times < 1 || event.times > 10 || event.target.trim() === "") return refuse("invalid", { detail: "falla" });
      const sequence = state.sequence + 1;
      const fault: Fault = { id: `ft_${String(sequence).padStart(4, "0")}`, tenantId: event.tenantId, target: event.target, remaining: event.times };
      return { state: log({ ...state, faults: [...state.faults.filter((item) => !(item.tenantId === event.tenantId && item.target === event.target)), fault], sequence }, event, "fault.inject", `${event.target} × ${event.times}`) };
    }
    case "fault.clear": {
      if (event.actor !== "system") return refuse("systemOnly");
      return { state: log({ ...state, faults: state.faults.filter((item) => !(item.tenantId === event.tenantId && item.target === event.target)) }, event, "fault.clear", event.target) };
    }
  }
}

// ---------------------------------------------------------------- stopping and escalating
/** Ends a session for a reason. The Worker's run is closed too when it can be (a kill switch blocks that, and then KOE has already handled it). */
function stop(state: AgentState, session: Session, why: StopReason, base: Base): AgentResult {
  let koe = state.koe;
  const run = lastRun(koe, session.runId);
  if (why !== "killSwitch" && why !== "cancelled" && run?.status === "running") {
    const closed = reduceKoe(koe, { type: "run.finish", at: base.at, tenantId: session.tenantId, actor: workerActor(session.workerId), runId: session.runId, outcome: "failed", result: reason("stopped", { detail: stopText(why) }) });
    if (!closed.error) koe = closed.state;
  }
  const updated: Session = { ...session, status: why === "cancelled" ? "cancelled" : "stopped", stopReason: why, finishedAt: base.at };
  return { state: log(withSession({ ...state, koe }, updated), base, "session.stop", why, session.id), session: updated };
}

/** Hands a session to a person: it stops moving by itself and says why. The Worker's run stays open for the person to continue or cancel. */
function escalate(state: AgentState, session: Session, base: Base, detail: string, step: Omit<SessionStep, "id" | "at" | "status" | "note">): AgentResult {
  const text = reason("escalated", { detail });
  const updated: Session = { ...addStep(session, base, { ...step, status: "failed", note: text }), status: "escalated", escalation: { reason: text, at: base.at } };
  return { state: log(withSession(state, updated), base, "session.escalate", detail, session.id), session: updated };
}

/** Uses up one planted failure for this company and target, if there is one. */
function takeFault(state: AgentState, tenantId: string, target: string): { state: AgentState; hit: boolean } {
  const fault = state.faults.find((item) => item.tenantId === tenantId && item.target === target && item.remaining > 0);
  if (!fault) return { state, hit: false };
  return { state: { ...state, faults: state.faults.map((item) => (item.id === fault.id ? { ...item, remaining: item.remaining - 1 } : item)) }, hit: true };
}

// ---------------------------------------------------------------- one step of one session
function advance(state: AgentState, base: Base, sessionId: string): AgentResult {
  const refuse = (code: ErrorCode, params: Record<string, string | number> = {}): AgentResult => ({ state, error: message(code, params), errorCode: code });
  const session = sessionById(state, sessionId);
  if (!session) return refuse("notFound");
  if (session.tenantId !== base.tenantId) return refuse("notYours");
  if (!isPerson(base.actor) && base.actor !== "system" && base.actor !== workerActor(session.workerId)) return refuse("notAllowed");
  if (session.status === "waitingApproval") return refuse("waiting");
  if (session.status === "escalated") return refuse("escalated");
  if (isFinal(session.status)) return refuse("finished");
  const playbook = playbookById(session.playbookId);
  if (!playbook) return refuse("playbookNotFound", { detail: session.playbookId });

  // the kill switches and a cancelled run win over everything, before any limit
  const instance = state.koe.instances.find((item) => item.id === session.instanceId);
  if (state.koe.platformPaused || state.koe.pausedTenants.includes(session.tenantId) || !instance || instance.status !== "active") return stop(state, session, "killSwitch", base);
  if (lastRun(state.koe, session.runId)?.status === "cancelled") return stop(state, session, "cancelled", base);
  const limit = checkLimits(session, base.at);
  if (limit) return stop(state, session, limit, base);
  if (isLoop(session.steps, session.limits.loopThreshold)) return stop(state, session, "loop", base);

  const raw: PlanStep | undefined = playbook.steps[session.cursor];
  if (!raw) return stop(state, session, "steps", base);
  const step = renderStep(raw, session.input);
  const attempt = attemptOf(session, session.cursor);
  const worker = workerActor(session.workerId);
  const common = { index: session.cursor, kind: step.kind, attempt, signature: stepSignature(raw), costMicros: 0, backoffMs: 0 } as const;
  const retryOrEscalate = (current: AgentState, why: string, detail: string, retryable: boolean): AgentResult => {
    if (retryable && mayRetry(attempt, session.limits)) {
      const wait = backoffMs(attempt);
      const updated = addStep(session, base, { ...common, detail, status: "retry", backoffMs: wait, note: reason("retry", { attempt, max: session.limits.maxRetries }) });
      return { state: log(withSession(current, updated), base, "session.retry", `${detail} · ${why}`, session.id), session: updated };
    }
    return escalate(current, session, base, retryable ? reason("outOfRetries", { detail: why }) : why, { ...common, detail });
  };

  switch (step.kind) {
    case "think": {
      if (aiCallsExhausted(session)) return stop(state, session, "aiCalls", base);
      const planted = takeFault(state, session.tenantId, "ai");
      if (planted.hit) return retryOrEscalate(planted.state, "falla simulada del servicio de IA", step.note, true);
      const asked: AiResult = reduceAi(state.ai, {
        type: "ai.request", at: base.at, tenantId: session.tenantId, actor: worker, caller: "worker", purposeId: step.purposeId, input: { user: `${step.note}: ${session.goal}` },
      });
      const afterAi: AgentState = { ...state, ai: asked.state };
      if (asked.error || !asked.record) return retryOrEscalate(afterAi, asked.error ?? "sin respuesta", step.note, asked.errorCode === "allFailed" || asked.errorCode === "rateLimited");
      const cost = asked.record.estimatedCostMicros;
      const updated: Session = { ...addStep(session, base, { ...common, detail: step.note, status: "done", costMicros: cost, aiRecordId: asked.record.id }), cursor: session.cursor + 1, aiCalls: session.aiCalls + 1, spentMicros: session.spentMicros + cost };
      return { state: log(withSession(afterAi, updated), base, "session.think", `${step.purposeId} · ${asked.record.id}`, session.id), session: updated };
    }

    case "tool": {
      const planted = takeFault(state, session.tenantId, step.tool);
      if (planted.hit) return retryOrEscalate(planted.state, `falla simulada de ${step.tool}`, step.tool, true);
      const used = reduceKoe(state.koe, { type: "run.tool", at: base.at, tenantId: session.tenantId, actor: worker, runId: session.runId, tool: step.tool, input: step.input });
      if (used.error) return escalate(state, session, base, used.error, { ...common, detail: step.tool });
      const run = lastRun(used.state, session.runId);
      const koeStepId = run?.steps.at(-1)?.id;
      const pending = used.state.approvals.find((item) => item.runId === session.runId && item.status === "pending" && !session.steps.some((done) => done.approvalId === item.id));
      const next: AgentState = { ...state, koe: used.state };
      if (pending) {
        const updated: Session = { ...addStep(session, base, { ...common, detail: step.tool, status: "waiting", approvalId: pending.id, ...(koeStepId ? { koeStepId } : {}), note: reason("waiting", { detail: step.tool }) }), status: "waitingApproval" };
        return { state: log(withSession(next, updated), base, "session.waiting", `${step.tool} · ${pending.id}`, session.id), session: updated };
      }
      const updated: Session = { ...addStep(session, base, { ...common, detail: step.tool, status: "done", ...(koeStepId ? { koeStepId } : {}) }), cursor: session.cursor + 1 };
      return { state: log(withSession(next, updated), base, "session.tool", step.tool, session.id), session: updated };
    }

    case "remember": {
      const kept = reduceKoe(state.koe, { type: "memory.put", at: base.at, tenantId: session.tenantId, actor: worker, runId: session.runId, key: step.key, value: step.value, sensitivity: step.sensitivity });
      if (kept.error) return escalate(state, session, base, kept.error, { ...common, detail: step.key });
      const updated: Session = { ...addStep(session, base, { ...common, detail: step.key, status: "done" }), cursor: session.cursor + 1 };
      return { state: log(withSession({ ...state, koe: kept.state }, updated), base, "session.remember", step.key, session.id), session: updated };
    }

    case "finish": {
      const done = reduceKoe(state.koe, { type: "run.finish", at: base.at, tenantId: session.tenantId, actor: worker, runId: session.runId, outcome: "completed", result: step.result });
      if (done.error) return escalate(state, session, base, done.error, { ...common, detail: "cierre" });
      const updated: Session = { ...addStep(session, base, { ...common, detail: "cierre", status: "done" }), status: "completed", cursor: session.cursor + 1, finishedAt: base.at, result: step.result };
      return { state: log(withSession({ ...state, koe: done.state }, updated), base, "session.complete", step.result, session.id), session: updated };
    }
  }
}
