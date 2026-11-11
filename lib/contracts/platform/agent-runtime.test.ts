/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AGENT_LIMIT_CEILINGS, AGENT_LIMIT_DEFAULTS, FINAL_STATUSES, PLAYBOOKS, STOP_REASONS, newAgentState, playbookById, reduceAgent, validateLimits, type AgentEvent, type AgentResult, type AgentState, type Playbook,
} from "./agent-center";
import { ERROR_CODES, STOP_KEYS, message, stopText } from "./agent-messages";
import {
  agentMetrics, aiCallsExhausted, attemptOf, backoffMs, checkLimits, explainSession, fill, isLoop, mayRetry, placeholdersOf, previewPlan, renderStep, stepSignature, validatePlaybook, type Session, type SessionStep,
} from "./agent-runtime";
import { reduceGateway } from "./gateway-center";
import { GATEWAY_PROVIDERS } from "./gateway-catalog";
import { reduceKoe, workerActor } from "./koe-engine";
import { newKoeState } from "./koe-engine";
import { reduceAi } from "./koe-ai-center";
import { purposeById } from "./koe-ai-catalog";
import { BASE_TOOLS, STARTER_WORKERS } from "./koe-registry";

const NOVA = "tenant-nova";
const OTHER = "tenant-other";
const ANA = "ana";
const PABLO = "pablo";
const ADMIN = "admin:ana";
const SYSTEM = "system";
let tick = 0;
const BASE = Date.parse("2026-11-10T10:00:00.000Z");
const at = (seconds = tick++) => new Date(BASE + seconds * 1_000).toISOString();

const TOOLS = newKoeState().tools;
const definitionOf = (id: string) => STARTER_WORKERS.find((item) => item.id === id)!;

/** Four companies' worth of Workers is not needed: Nova has the four Workers the playbooks use, and another company has the sales assistant. */
function world(): AgentState {
  let state = newAgentState([ADMIN]);
  const enable = (tenantId: string, definitionId: string) => {
    const result = reduceKoe(state.koe, { type: "worker.enable", at: at(), tenantId, actor: ANA, definitionId });
    expect(result.error, result.error).toBeUndefined();
    state = { ...state, koe: result.state };
  };
  for (const workerId of ["sales", "followup", "reporter", "collections"]) enable(NOVA, workerId);
  enable(OTHER, "sales");
  return state;
}
const instanceOf = (state: AgentState, tenantId: string, workerId: string) => state.koe.instances.find((item) => item.tenantId === tenantId && item.definitionId === workerId)!.id;

type Start = Partial<Extract<AgentEvent, { type: "session.start" }>>;
const start = (state: AgentState, playbookId = "sales.qualify", over: Start = {}): AgentResult => {
  const playbook = playbookById(playbookId)!;
  const tenantId = over.tenantId ?? NOVA;
  return reduceAgent(state, {
    type: "session.start", at: at(), tenantId, actor: ANA, instanceId: instanceOf(state, tenantId, playbook.workerId), playbookId, goal: "Preparar el contacto de Clínica Vida",
    input: { contacto: "Clínica Vida", tema: "propuesta", cliente: "Clínica Vida", monto: "250" }, ...over,
  });
};
const started = (state: AgentState, playbookId?: string, over: Start = {}): { state: AgentState; session: Session } => {
  const result = start(state, playbookId, over);
  expect(result.error, result.error).toBeUndefined();
  return { state: result.state, session: result.session! };
};
const step = (state: AgentState, sessionId: string, over: { tenantId?: string; actor?: string } = {}): AgentResult => reduceAgent(state, { type: "session.step", at: at(), tenantId: over.tenantId ?? NOVA, actor: over.actor ?? SYSTEM, sessionId });
const run = (state: AgentState, sessionId: string, over: { tenantId?: string; actor?: string } = {}): AgentResult => reduceAgent(state, { type: "session.run", at: at(), tenantId: over.tenantId ?? NOVA, actor: over.actor ?? SYSTEM, sessionId });
const fault = (state: AgentState, target: string, times: number, tenantId = NOVA): AgentState => {
  const result = reduceAgent(state, { type: "fault.inject", at: at(), tenantId, actor: SYSTEM, target, times });
  expect(result.error, result.error).toBeUndefined();
  return result.state;
};
const approve = (state: AgentState, sessionId: string, yes: boolean, actor = PABLO, tenantId = NOVA): AgentResult => reduceAgent(state, { type: "session.approve", at: at(), tenantId, actor, sessionId, approve: yes });
const sessionOf = (result: AgentResult, state?: AgentState): Session => (state ?? result.state).sessions.find((item) => item.id === result.session!.id)!;
const runOf = (state: AgentState, session: Session) => state.koe.runs.find((item) => item.id === session.runId)!;

// ================================================================ the plans
describe("the playbooks", () => {
  it("are valid for the Worker that runs them", () => {
    expect(PLAYBOOKS.length).toBeGreaterThanOrEqual(4);
    for (const playbook of PLAYBOOKS) expect(validatePlaybook(playbook, definitionOf(playbook.workerId), TOOLS), playbook.id).toEqual([]);
  });

  it("are refused when they ask for what the Worker may not do or are badly formed", () => {
    const base = playbookById("sales.qualify")!;
    const issues = (over: Partial<Playbook>, worker = "sales") => validatePlaybook({ ...base, ...over }, definitionOf(worker), TOOLS).join("; ");
    expect(issues({}, "followup")).toMatch(/otro Worker/);
    expect(issues({ steps: [{ kind: "tool", tool: "payment.createLink", input: { cliente: "{contacto}", monto: "1" } }, { kind: "finish", result: "ok" }] })).toMatch(/no puede usar payment\.createLink/);
    expect(issues({ steps: [{ kind: "tool", tool: "contact.read", input: {} }, { kind: "finish", result: "ok" }] })).toMatch(/falta «contacto»/);
    expect(issues({ steps: [{ kind: "tool", tool: "contact.read", input: { contacto: "{otro}" } }, { kind: "finish", result: "ok" }] })).toMatch(/«otro» no es un dato del plan/);
    expect(issues({ steps: [{ kind: "tool", tool: "no.existe", input: {} }, { kind: "finish", result: "ok" }] })).toMatch(/herramienta desconocida/);
    expect(issues({ steps: [{ kind: "think", purposeId: "free.model", note: "x" }, { kind: "finish", result: "ok" }] })).toMatch(/propósito desconocido/);
    expect(issues({ steps: [{ kind: "remember", key: "k", value: "v", sensitivity: "business" }] })).toMatch(/cierre/);
    expect(issues({ steps: [{ kind: "finish", result: "a" }, { kind: "finish", result: "b" }] })).toMatch(/solo puede ir al final/);
    expect(issues({ steps: [] })).toMatch(/no tiene pasos/);
    expect(issues({ steps: Array.from({ length: 30 }, () => ({ kind: "finish", result: "x" }) as const) })).toMatch(/demasiados pasos/);
  });

  it("name a purpose or a tool, never a model, a provider or a level", () => {
    for (const playbook of PLAYBOOKS) {
      expect(JSON.stringify(playbook), playbook.id).not.toMatch(/gw-|openai|anthropic|google|mistral|grok|deepseek|openrouter|"level"|"model"|"provider"/i);
      for (const item of playbook.steps) if (item.kind === "think") expect(purposeById(item.purposeId), playbook.id).toBeDefined();
    }
  });

  it("fill their templates from the input and say which names they use", () => {
    expect(placeholdersOf("Hola {contacto}, {tema} y {contacto}")).toEqual(["contacto", "tema", "contacto"]);
    expect(fill("Hola {contacto} {falta}", { contacto: "Ana" })).toBe("Hola Ana {falta}");
    const rendered = renderStep({ kind: "tool", tool: "contact.read", input: { contacto: "{contacto}" } }, { contacto: "Ana" });
    expect(rendered).toEqual({ kind: "tool", tool: "contact.read", input: { contacto: "Ana" } });
    expect(stepSignature({ kind: "tool", tool: "contact.read", input: { contacto: "A" } })).not.toBe(stepSignature({ kind: "tool", tool: "contact.read", input: { contacto: "B" } }));
  });

  it("preview what a plan will do and which steps will wait for a person", () => {
    const sales = previewPlan(playbookById("sales.qualify")!, TOOLS);
    expect(sales.map((item) => item.kind)).toEqual(["tool", "tool", "think", "remember", "tool", "finish"]);
    expect(sales.every((item) => !item.needsPerson)).toBe(true);
    const collections = previewPlan(playbookById("collections.reminder")!, TOOLS);
    expect(collections.filter((item) => item.needsPerson).map((item) => item.label)).toEqual([TOOLS["payment.createLink"]!.manifest.label]);
    expect(collections.find((item) => item.needsPerson)?.level).toBe(3);
  });

  it("have limits under the ceilings", () => {
    expect(validateLimits(AGENT_LIMIT_DEFAULTS)).toEqual([]);
    expect(validateLimits({ ...AGENT_LIMIT_DEFAULTS, maxSteps: AGENT_LIMIT_CEILINGS.maxSteps + 1 })).toEqual(["maxSteps"]);
    expect(validateLimits({ ...AGENT_LIMIT_DEFAULTS, budgetMicros: 0 })).toEqual(["budgetMicros"]);
    for (const playbook of PLAYBOOKS) expect(validateLimits({ ...AGENT_LIMIT_DEFAULTS, ...playbook.limits }), playbook.id).toEqual([]);
  });
});

// ================================================================ the rules, as pure functions
describe("the rules of a session", () => {
  const done = (signature: string, index = 0): SessionStep => ({ id: `s.${index}`, index, at: at(), kind: "tool", detail: "x", status: "done", attempt: 1, costMicros: 0, backoffMs: 0, signature });
  const bare = (over: Partial<Session> = {}): Session => ({
    id: "ag_1", tenantId: NOVA, instanceId: "i", workerId: "sales", playbookId: "sales.qualify", goal: "g", input: {}, runId: "r", status: "running", cursor: 0, steps: [], startedBy: ANA, startedAt: at(0),
    limits: AGENT_LIMIT_DEFAULTS, baseCostMicros: 0, spentMicros: 0, aiCalls: 0, ...over,
  });

  it("detects the same step done again and again, and not different ones", () => {
    expect(isLoop([done("a"), done("a"), done("a")], 2)).toBe(true);
    expect(isLoop([done("a"), done("a")], 2)).toBe(false);
    expect(isLoop([done("a"), done("b"), done("a"), done("a")], 2)).toBe(false);
    expect(isLoop([], 2)).toBe(false);
  });

  it("checks the limits in order: time, steps, then budget", () => {
    expect(checkLimits(bare(), at(1))).toBeNull();
    expect(checkLimits(bare(), at(AGENT_LIMIT_DEFAULTS.maxDurationMs / 1_000 + 5))).toBe("timeout");
    expect(checkLimits(bare({ steps: Array.from({ length: 12 }, (_, index) => done(`s${index}`, index)) }), at(1))).toBe("steps");
    expect(checkLimits(bare({ spentMicros: AGENT_LIMIT_DEFAULTS.budgetMicros + 1 }), at(1))).toBe("budget");
    expect(checkLimits(bare({ spentMicros: AGENT_LIMIT_DEFAULTS.budgetMicros }), at(1))).toBeNull();
  });

  it("counts the AI calls, retries a few times with a growing wait and numbers the attempts", () => {
    expect(aiCallsExhausted(bare({ aiCalls: 4 }))).toBe(true);
    expect(aiCallsExhausted(bare({ aiCalls: 3 }))).toBe(false);
    expect([1, 2, 3].map((attempt) => mayRetry(attempt, { maxRetries: 2 }))).toEqual([true, true, false]);
    expect([1, 2, 3].map(backoffMs)).toEqual([100, 200, 400]);
    const retry = (index: number): SessionStep => ({ ...done("x", index), status: "retry" });
    expect(attemptOf(bare({ steps: [retry(0), retry(0), retry(1)] }), 0)).toBe(3);
    expect(attemptOf(bare(), 0)).toBe(1);
  });
});

// ================================================================ starting a session
describe("starting a session", () => {
  it("is done by a person or the platform, never by NEX or a Worker, and starts the Worker's run", () => {
    const state = world();
    for (const actor of ["worker:nex", workerActor("sales")]) expect(start(state, "sales.qualify", { actor }).errorCode, actor).toBe("personRequired");
    const byPerson = started(state);
    expect(byPerson.session).toMatchObject({ status: "running", cursor: 0, workerId: "sales", tenantId: NOVA, startedBy: ANA, aiCalls: 0 });
    expect(runOf(byPerson.state, byPerson.session)).toMatchObject({ status: "running", workerId: "sales", goal: "Preparar el contacto de Clínica Vida" });
    expect(started(state, "sales.qualify", { actor: SYSTEM }).session.startedBy).toBe(SYSTEM);
    expect(byPerson.session.spentMicros).toBe(runOf(byPerson.state, byPerson.session).estimatedCostMicros);
  });

  it("refuses an unknown plan, a plan of another Worker, a missing datum, an empty goal and out-of-range limits", () => {
    const state = world();
    expect(start(state, "sales.qualify", { playbookId: "no.such" }).errorCode).toBe("playbookNotFound");
    expect(start(state, "sales.qualify", { instanceId: instanceOf(state, NOVA, "followup") }).errorCode).toBe("workerMismatch");
    expect(start(state, "sales.qualify", { input: {} }).errorCode).toBe("missingParam");
    expect(start(state, "sales.qualify", { goal: "  " }).errorCode).toBe("invalid");
    expect(start(state, "sales.qualify", { limits: { maxSteps: 999 } }).errorCode).toBe("invalid");
    expect(start(state, "sales.qualify", { instanceId: "nope" }).errorCode).toBe("invalid");
  });

  it("is refused when the Worker is not installed or is disabled for that company, or belongs to another company", () => {
    const state = world();
    expect(start(state, "sales.qualify", { tenantId: OTHER, instanceId: instanceOf(state, NOVA, "sales") }).errorCode).toBe("notYours");
    const disabled = reduceKoe(state.koe, { type: "instance.disable", at: at(), tenantId: NOVA, actor: ANA, instanceId: instanceOf(state, NOVA, "sales") });
    const refused = start({ ...state, koe: disabled.state });
    expect(refused.errorCode).toBe("instanceDisabled");
    expect(refused.state.sessions).toHaveLength(0);
  });

  it("is bounded by the limits it is given, lowered but never raised past the ceilings", () => {
    const { session } = started(world(), "sales.qualify", { limits: { maxSteps: 3, budgetMicros: 50_000 } });
    expect(session.limits).toMatchObject({ maxSteps: 3, budgetMicros: 50_000, maxAiCalls: AGENT_LIMIT_DEFAULTS.maxAiCalls });
  });
});

// ================================================================ running a plan through the existing engines
describe("running a session", () => {
  it("goes through a whole plan: tools and memory through the Workers engine, the thought through KOE's AI request, and the end of the run", () => {
    const { state, session } = started(world());
    const result = run(state, session.id);
    expect(result.error, result.error).toBeUndefined();
    const done = sessionOf(result);
    expect(done).toMatchObject({ status: "completed", cursor: 6, aiCalls: 1 });
    expect(done.steps.map((item) => item.kind)).toEqual(["tool", "tool", "think", "remember", "tool", "finish"]);
    expect(done.steps.every((item) => item.status === "done")).toBe(true);
    const koeRun = runOf(result.state, done);
    expect(koeRun.status).toBe("completed");
    expect(koeRun.result).toBe("Prospecto Clínica Vida calificado y borrador de primer mensaje listo para aprobar.");
    expect(koeRun.steps.filter((item) => item.kind === "tool").map((item) => item.tool)).toEqual(["contact.read", "lead.score", "message.draft"]);
    expect(koeRun.steps.every((item) => item.decision !== "refused")).toBe(true);
    expect(result.state.koe.memory.filter((item) => item.runId === done.runId).every((item) => item.cleared)).toBe(true);
  });

  it("asks the AI only through KOE: the request names a purpose, KOE decides the rest, and the cost is added to the session", () => {
    const { state, session } = started(world());
    const result = run(state, session.id);
    expect(result.state.ai.records).toHaveLength(1);
    const record = result.state.ai.records[0]!;
    expect(record).toMatchObject({ caller: "worker", actor: workerActor("sales"), purposeId: "lead.analyze", workerId: purposeById("lead.analyze")!.workerId, status: "ok" });
    const thought = sessionOf(result).steps.find((item) => item.kind === "think")!;
    expect(thought).toMatchObject({ aiRecordId: record.id, costMicros: record.estimatedCostMicros });
    expect(sessionOf(result).spentMicros).toBe(session.baseCostMicros + record.estimatedCostMicros);
    expect(result.state.ai.gateway.calls).toHaveLength(1);
  });

  it("advances one step at a time, and the trace says what happened", () => {
    let state = started(world()).state;
    const id = state.sessions[0]!.id;
    for (let index = 1; index <= 3; index += 1) {
      const next = step(state, id);
      expect(next.error, next.error).toBeUndefined();
      state = next.state;
      expect(sessionOf(next).cursor).toBe(index);
    }
    const trace = explainSession(sessionOf({ state, session: state.sessions[0] } as AgentResult));
    expect(trace).toHaveLength(3);
    expect(trace[0]).toMatch(/^01 · tool · done · contact\.read/);
    expect(trace[2]).toMatch(/^03 · think · done/);
  });

  it("can be advanced by a person, the platform or the agent itself, and by no other Worker", () => {
    const { state, session } = started(world());
    expect(step(state, session.id, { actor: workerActor("reporter") }).errorCode).toBe("notAllowed");
    expect(step(state, session.id, { actor: "worker:nex" }).errorCode).toBe("notAllowed");
    for (const actor of [ANA, SYSTEM, workerActor("sales")]) expect(step(state, session.id, { actor }).error, actor).toBeUndefined();
  });

  it("does not move a session that is over, and says so", () => {
    const { state, session } = started(world());
    const done = run(state, session.id);
    expect(step(done.state, session.id).errorCode).toBe("finished");
    expect(run(done.state, session.id).errorCode).toBe("finished");
    expect(FINAL_STATUSES).toContain(sessionOf(done).status);
  });

  it("runs every playbook to the end with the Worker's own tools", () => {
    for (const playbook of PLAYBOOKS.filter((item) => item.id !== "collections.reminder")) {
      const { state, session } = started(world(), playbook.id);
      const result = run(state, session.id);
      expect(sessionOf(result).status, playbook.id).toBe("completed");
      expect(runOf(result.state, session).status, playbook.id).toBe("completed");
    }
  });
});

// ================================================================ what only a person may decide
describe("the Constitution in the runtime", () => {
  it("makes a Level 3 action wait for a person, and nothing after it runs", () => {
    const { state, session } = started(world(), "collections.reminder");
    const result = run(state, session.id);
    const waiting = sessionOf(result);
    expect(waiting.status).toBe("waitingApproval");
    expect(waiting.steps.at(-1)).toMatchObject({ kind: "tool", status: "waiting", detail: "payment.createLink" });
    expect(waiting.cursor).toBe(2);
    expect(runOf(result.state, waiting).status).toBe("waitingApproval");
    expect(result.state.koe.approvals.filter((item) => item.status === "pending")).toHaveLength(1);
    expect(step(result.state, session.id).errorCode).toBe("waiting");
    expect(waiting.steps).toHaveLength(3);
  });

  it("goes on only when a person approves, and then finishes", () => {
    const { state, session } = started(world(), "collections.reminder");
    const waiting = run(state, session.id).state;
    const approved = approve(waiting, session.id, true);
    expect(approved.error, approved.error).toBeUndefined();
    expect(sessionOf(approved)).toMatchObject({ status: "running", cursor: 3 });
    expect(sessionOf(approved).steps.at(-1)).toMatchObject({ status: "done", note: `aprobado por ${PABLO}` });
    const finished = run(approved.state, session.id);
    expect(sessionOf(finished).status).toBe("completed");
    expect(runOf(finished.state, session).status).toBe("completed");
  });

  it("ends the session when a person rejects, and never retries or works around it", () => {
    const { state, session } = started(world(), "collections.reminder");
    const waiting = run(state, session.id).state;
    const rejected = approve(waiting, session.id, false);
    const ended = sessionOf(rejected);
    expect(ended).toMatchObject({ status: "stopped", stopReason: "rejected" });
    expect(ended.steps.at(-1)).toMatchObject({ status: "failed" });
    expect(runOf(rejected.state, ended).status).toBe("failed");
    expect(step(rejected.state, session.id).errorCode).toBe("finished");
    expect(rejected.state.koe.approvals.find((item) => item.status === "rejected")).toBeDefined();
  });

  it("does not let a Worker, NEX or the platform approve, nor the person who started a payment", () => {
    const { state, session } = started(world(), "collections.reminder");
    const waiting = run(state, session.id).state;
    for (const actor of [workerActor("collections"), "worker:nex", SYSTEM]) expect(approve(waiting, session.id, true, actor).errorCode, actor).toBe("personRequired");
    const self = approve(waiting, session.id, true, ANA);
    expect(self.errorCode).toBe("selfApproval");
    expect(self.state.sessions[0]!.status).toBe("waitingApproval");
    expect(approve(state, session.id, true).errorCode).toBe("notWaiting");
  });

  it("lets only a person cancel, and cancelling ends the Worker's run too", () => {
    const { state, session } = started(world());
    for (const actor of [workerActor("sales"), SYSTEM]) expect(reduceAgent(state, { type: "session.cancel", at: at(), tenantId: NOVA, actor, sessionId: session.id }).errorCode, actor).toBe("personRequired");
    const cancelled = reduceAgent(state, { type: "session.cancel", at: at(), tenantId: NOVA, actor: PABLO, sessionId: session.id });
    expect(sessionOf(cancelled)).toMatchObject({ status: "cancelled", stopReason: "cancelled" });
    expect(runOf(cancelled.state, session).status).toBe("cancelled");
    expect(step(cancelled.state, session.id).errorCode).toBe("finished");
    expect(reduceAgent(cancelled.state, { type: "session.cancel", at: at(), tenantId: NOVA, actor: PABLO, sessionId: session.id }).errorCode).toBe("finished");
  });

  it("notices when a person cancelled the Worker's run elsewhere, and stops", () => {
    const { state, session } = started(world());
    const cancelledRun = reduceKoe(state.koe, { type: "run.cancel", at: at(), tenantId: NOVA, actor: PABLO, runId: session.runId });
    const next = step({ ...state, koe: cancelledRun.state }, session.id);
    expect(sessionOf(next)).toMatchObject({ status: "cancelled", stopReason: "cancelled" });
  });
});

// ================================================================ the limits and the kill switches
describe("the limits and the kill switches", () => {
  it("stops at the step limit and closes the run as failed", () => {
    const { state, session } = started(world(), "sales.qualify", { limits: { maxSteps: 2 } });
    const result = run(state, session.id);
    expect(sessionOf(result)).toMatchObject({ status: "stopped", stopReason: "steps" });
    expect(sessionOf(result).steps).toHaveLength(2);
    expect(runOf(result.state, session)).toMatchObject({ status: "failed" });
    expect(runOf(result.state, session).result).toMatch(new RegExp(stopText("steps")));
  });

  it("stops when the budget is exceeded, before spending any more", () => {
    const { state, session } = started(world(), "sales.qualify", { limits: { budgetMicros: 1 } });
    const result = step(state, session.id);
    expect(sessionOf(result)).toMatchObject({ status: "stopped", stopReason: "budget" });
    expect(result.state.ai.records).toHaveLength(0);
  });

  it("stops when it takes longer than the time it was given", () => {
    const { state, session } = started(world(), "sales.qualify", { limits: { maxDurationMs: 1_000 } });
    const later = new Date(Date.parse(session.startedAt) + 5_000).toISOString();
    const result = reduceAgent(state, { type: "session.step", at: later, tenantId: NOVA, actor: SYSTEM, sessionId: session.id });
    expect(sessionOf(result)).toMatchObject({ status: "stopped", stopReason: "timeout" });
  });

  it("obeys every kill switch of KOE before anything else: a company pause, a platform pause and a paused or disabled Worker", () => {
    const stopReasonAfter = (event: Parameters<typeof reduceKoe>[1]) => {
      const { state, session } = started(world());
      const switched = reduceKoe(state.koe, event);
      expect(switched.error, switched.error).toBeUndefined();
      const result = step({ ...state, koe: switched.state }, session.id);
      expect(result.state.ai.records).toHaveLength(0);
      return sessionOf(result);
    };
    expect(stopReasonAfter({ type: "tenant.pause", at: at(), tenantId: NOVA, actor: ANA, paused: true })).toMatchObject({ status: "stopped", stopReason: "killSwitch" });
    expect(stopReasonAfter({ type: "platform.pause", at: at(), tenantId: NOVA, actor: ADMIN, paused: true })).toMatchObject({ status: "stopped", stopReason: "killSwitch" });
    const state = world();
    expect(stopReasonAfter({ type: "instance.pause", at: at(), tenantId: NOVA, actor: ANA, instanceId: instanceOf(state, NOVA, "sales") })).toMatchObject({ stopReason: "killSwitch" });
    expect(stopReasonAfter({ type: "instance.disable", at: at(), tenantId: NOVA, actor: ANA, instanceId: instanceOf(state, NOVA, "sales") })).toMatchObject({ stopReason: "killSwitch" });
  });

  it("has a text for every reason a session can stop", () => {
    expect([...STOP_KEYS].sort()).toEqual([...STOP_REASONS].sort());
    for (const key of STOP_KEYS) expect(stopText(key).length).toBeGreaterThan(3);
  });
});

// ================================================================ failures: retry, then a person
describe("failures: retry a little, then hand it to a person", () => {
  const stepsOf = (result: AgentResult) => sessionOf(result).steps;

  it("retries a temporary failure of a tool and then goes on, recording the attempt and the wait", () => {
    const { state, session } = started(fault(world(), "contact.read", 1));
    const result = run(state, session.id);
    expect(sessionOf(result).status).toBe("completed");
    const attempts = stepsOf(result).filter((item) => item.index === 0);
    expect(attempts.map((item) => [item.status, item.attempt])).toEqual([["retry", 1], ["done", 2]]);
    expect(attempts[0]).toMatchObject({ backoffMs: 100 });
    expect(attempts[0]!.note).toMatch(/Falla temporal/);
    expect(agentMetrics(result.state.sessions, NOVA).retries).toBe(1);
  });

  it("retries a temporary failure of the AI the same way", () => {
    const { state, session } = started(fault(world(), "ai", 1));
    const result = run(state, session.id);
    expect(sessionOf(result).status).toBe("completed");
    const attempts = stepsOf(result).filter((item) => item.kind === "think");
    expect(attempts.map((item) => item.status)).toEqual(["retry", "done"]);
    expect(result.state.ai.records).toHaveLength(1);
  });

  it("hands the session to a person when the retries run out, and it stops moving by itself", () => {
    const { state, session } = started(fault(world(), "contact.read", 9));
    const result = run(state, session.id);
    const escalated = sessionOf(result);
    expect(escalated.status).toBe("escalated");
    expect(escalated.escalation?.reason).toMatch(/Agotó los reintentos/);
    expect(stepsOf(result).filter((item) => item.index === 0).map((item) => item.status)).toEqual(["retry", "retry", "failed"]);
    expect(step(result.state, session.id).errorCode).toBe("escalated");
    expect(runOf(result.state, escalated).status).toBe("running");
    expect(agentMetrics(result.state.sessions, NOVA)).toMatchObject({ escalations: 1, retries: 2 });
  });

  it("escalates at once, without retrying, when the AI refuses for a reason a retry cannot fix", () => {
    const base = world();
    const narrow = reduceAi(base.ai, { type: "ai.configure", at: at(), tenantId: NOVA, actor: ANA, allowedModels: ["gw-econ-1"] });
    const { state, session } = started({ ...base, ai: narrow.state });
    const result = run(state, session.id);
    expect(sessionOf(result).status).toBe("escalated");
    const thoughts = stepsOf(result).filter((item) => item.kind === "think");
    expect(thoughts).toHaveLength(1);
    expect(thoughts[0]).toMatchObject({ status: "failed", attempt: 1 });
    expect(sessionOf(result).escalation?.reason).toMatch(/Ningún modelo permitido/);
  });

  it("retries when no AI provider can answer, then escalates", () => {
    const base = world();
    let gateway = base.ai.gateway;
    for (const item of GATEWAY_PROVIDERS) gateway = reduceGateway(gateway, { type: "provider.incident", at: at(), tenantId: "platform", actor: SYSTEM, providerId: item.id, mode: "down" }).state;
    const { state, session } = started({ ...base, ai: { ...base.ai, gateway } });
    const result = run(state, session.id);
    expect(sessionOf(result).status).toBe("escalated");
    expect(stepsOf(result).filter((item) => item.kind === "think").map((item) => item.status)).toEqual(["retry", "retry", "failed"]);
  });

  it("lets a person take over an escalated session, which closes the Worker's run, and nobody else", () => {
    const { state, session } = started(fault(world(), "contact.read", 9));
    const escalated = run(state, session.id).state;
    const takeover = (actor: string, note = "Lo sigo yo") => reduceAgent(escalated, { type: "session.takeover", at: at(), tenantId: NOVA, actor, sessionId: session.id, note });
    for (const actor of [workerActor("sales"), SYSTEM]) expect(takeover(actor).errorCode, actor).toBe("personRequired");
    expect(takeover(PABLO, " ").errorCode).toBe("invalid");
    const taken = takeover(PABLO);
    expect(sessionOf(taken)).toMatchObject({ status: "handedOff", result: "Lo sigo yo", escalation: { handledBy: PABLO } });
    expect(runOf(taken.state, session).status).toBe("cancelled");
    expect(reduceAgent(started(world()).state, { type: "session.takeover", at: at(), tenantId: NOVA, actor: PABLO, sessionId: "ag_0001", note: "x" }).errorCode).toBe("notEscalated");
  });

  it("escalates when the Workers engine refuses what the agent asked, instead of working around it", () => {
    const { state, session } = started(world());
    const stripped = { ...state, koe: { ...state.koe, tools: { ...state.koe.tools, "lead.score": { ...state.koe.tools["lead.score"]!, status: "pending" as const } } } };
    const result = run(stripped, session.id);
    expect(sessionOf(result).status).toBe("escalated");
    expect(sessionOf(result).escalation?.reason).toMatch(/lead\.score|herramienta/i);
  });

  it("lets only the platform plant a simulated failure", () => {
    expect(reduceAgent(world(), { type: "fault.inject", at: at(), tenantId: NOVA, actor: ANA, target: "ai", times: 1 }).errorCode).toBe("systemOnly");
    expect(reduceAgent(world(), { type: "fault.inject", at: at(), tenantId: NOVA, actor: SYSTEM, target: "ai", times: 0 }).errorCode).toBe("invalid");
    expect(reduceAgent(world(), { type: "fault.clear", at: at(), tenantId: NOVA, actor: ANA, target: "ai" }).errorCode).toBe("systemOnly");
    const cleared = reduceAgent(fault(world(), "ai", 3), { type: "fault.clear", at: at(), tenantId: NOVA, actor: SYSTEM, target: "ai" });
    expect(cleared.state.faults).toHaveLength(0);
  });
});

// ================================================================ isolation
describe("isolation between companies", () => {
  it("lets a company see, move, approve, cancel or take over only its own sessions", () => {
    const { state, session } = started(world(), "collections.reminder");
    const waiting = run(state, session.id).state;
    expect(step(waiting, session.id, { tenantId: OTHER }).errorCode).toBe("notYours");
    expect(run(waiting, session.id, { tenantId: OTHER }).errorCode).toBe("notYours");
    expect(approve(waiting, session.id, true, PABLO, OTHER).errorCode).toBe("notYours");
    expect(reduceAgent(waiting, { type: "session.cancel", at: at(), tenantId: OTHER, actor: PABLO, sessionId: session.id }).errorCode).toBe("notYours");
    expect(reduceAgent(waiting, { type: "session.takeover", at: at(), tenantId: OTHER, actor: PABLO, sessionId: session.id, note: "x" }).errorCode).toBe("notYours");
    expect(step(waiting, "ag_9999").errorCode).toBe("notFound");
  });

  it("keeps the failures, the metrics and the AI records of each company apart", () => {
    let state = fault(world(), "ai", 5, NOVA);
    const mine = started(state, "sales.qualify", { tenantId: NOVA });
    state = mine.state;
    const theirs = started(state, "sales.qualify", { tenantId: OTHER });
    state = theirs.state;
    state = run(state, theirs.session.id, { tenantId: OTHER }).state;
    expect(state.sessions.find((item) => item.id === theirs.session.id)?.status).toBe("completed");
    expect(state.faults.find((item) => item.tenantId === NOVA)?.remaining).toBe(5);
    expect(agentMetrics(state.sessions, OTHER)).toMatchObject({ sessions: 1, retries: 0 });
    expect(agentMetrics(state.sessions, NOVA)).toMatchObject({ sessions: 1, byStatus: expect.objectContaining({ running: 1 }) });
    expect(state.ai.records.every((item) => item.tenantId === OTHER)).toBe(true);
  });
});

// ================================================================ records and metrics
describe("records, metrics and privacy", () => {
  it("measures the sessions: counts by status, steps, retries, approvals, AI calls and spend", () => {
    let state = fault(world(), "contact.read", 1);
    const a = started(state);
    state = run(a.state, a.session.id).state;
    const b = started(state, "collections.reminder");
    state = run(b.state, b.session.id).state;
    const metrics = agentMetrics(state.sessions, NOVA);
    expect(metrics).toMatchObject({ sessions: 2, retries: 1, approvalsRequested: 1, aiCalls: 1, escalations: 0 });
    expect(metrics.byStatus).toMatchObject({ completed: 1, waitingApproval: 1 });
    expect(metrics.steps).toBe(state.sessions.reduce((sum, item) => sum + item.steps.length, 0));
    expect(metrics.spentMicros).toBe(state.sessions.reduce((sum, item) => sum + item.spentMicros, 0));
    expect(agentMetrics([], NOVA)).toMatchObject({ sessions: 0, averageSteps: 0 });
  });

  it("never gives the AI chain anything but a purpose and the words of the task: the prompt is not kept by KOE's AI records", () => {
    const state = started(world(), "sales.qualify", { goal: "Calificar a ana.privada@clinica.com ZETA-QUASAR-77" }).state;
    const id = state.sessions[0]!.id;
    const result = run(state, id);
    expect(JSON.stringify(result.state.ai)).not.toMatch(/ana\.privada|ZETA-QUASAR/);
    expect(result.state.ai.records[0]!.pii).toContain("email");
  });

  it("only grows: session ids and step ids are in order and an earlier step never changes", () => {
    let state = world();
    const snapshots: string[] = [];
    const first = started(state);
    state = first.state;
    for (let index = 0; index < 4; index += 1) {
      state = step(state, first.session.id).state;
      snapshots.push(JSON.stringify(state.sessions[0]!.steps));
    }
    snapshots.forEach((snapshot, index) => { if (index > 0) expect(snapshot.startsWith(snapshots[index - 1]!.slice(0, -1))).toBe(true); });
    expect(state.sessions[0]!.steps.map((item) => item.id)).toEqual(["ag_0001.1", "ag_0001.2", "ag_0001.3", "ag_0001.4"]);
    const second = started(state);
    expect(second.session.id).toBe("ag_0002");
    expect(state.logs.length).toBeGreaterThanOrEqual(5);
  });

  it("has a text for every error code", () => {
    for (const code of ERROR_CODES) expect(message(code, { detail: "x" }), code).not.toMatch(/\{/);
  });
});

// ================================================================ the rules of the architecture, in the code
describe("the rules of the runtime in the code", () => {
  const ROOT = join(__dirname, "..", "..", "..");
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next" || name === ".git" || name === ".open-next") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out); else out.push(full);
    }
    return out;
  };
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const code = (name: string) => strip(readFileSync(join(__dirname, name), "utf8"));
  const importsOf = (name: string) => [...code(name).matchAll(/from "\.\/([^"]+)"/g)].map((match) => match[1]!);
  const FILES = ["agent-catalog.ts", "agent-messages.ts", "agent-runtime.ts", "agent-center.ts"];

  it("reaches the AI only through KOE: it imports neither the AI Cost Optimizer, the AI Gateway nor the model registry, and names no model or provider", () => {
    for (const name of FILES) {
      for (const imported of importsOf(name)) expect(imported, name).not.toMatch(/^(gateway-|ai-cost-optimizer|ai-model-registry|ai-limits|ai-decision)/);
      expect(code(name), name).not.toMatch(/openai|anthropic|google|mistral|grok|deepseek|openrouter|\bgw-|providerId|modelId/i);
    }
    expect(importsOf("agent-center.ts")).toEqual(expect.arrayContaining(["koe-engine", "koe-ai-center"]));
  });

  it("makes no network call, reads no environment and holds no key", () => {
    for (const name of FILES) expect(code(name), name).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|process\.env|import\(|node:https?|lib\/ai|lib\/db|apiKey|api_key|Authorization|Bearer/);
  });

  it("changes nothing that exists: only the Backend Core's bridges import it (Sprint 30), no module does, and it adds no dependency", () => {
    const sources = ["app", "components", "lib", "config"].flatMap((dir) => walk(join(ROOT, dir))).filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file) && !/[\\/]agent-(catalog|messages|runtime|center)\.ts$/.test(file));
    const importers = sources.filter((file) => /from "[^"]*agent-(catalog|messages|runtime|center)"/.test(readFileSync(file, "utf8"))).map((file) => file.slice(ROOT.length + 1).split("\\").join("/"));
    // the Backend Core bridges (Sprint 30) and KYNOVA's own operating script (Sprint 33, it only applies the existing reducers) are the only readers
    expect(importers).toEqual(["lib/backend/integration/bridges.ts", "lib/contracts/platform/kynova-operation.ts"]);
    const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect([...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)].filter((name) => /openai|anthropic|langchain|ai-sdk|agent/i.test(name))).toEqual([]);
  });

  it("uses the autonomy catalog for every level: a playbook has no level of its own", () => {
    expect(code("agent-catalog.ts")).not.toMatch(/level\s*:/i);
    expect(BASE_TOOLS.length).toBeGreaterThan(0);
  });
});
