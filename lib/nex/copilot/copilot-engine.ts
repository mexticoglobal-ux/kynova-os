// Copilot Engine: the pipeline  user → Copilot → RAG → Memory → Knowledge Graph → KOE → plan → answer. `reduceCopilot(state, event, sources, config)` is a pure reducer (no clock, no database, no AI):
// the same state, event and knowledge always give the same answer. It never answers with the question alone: it first retrieves the RAG context, reads the memory and the graph the asker may see
// and KOE's figures (as far as the asker's role allows), finds problems, opportunities and risks, builds a plan, ranks recommendations and PREPARES actions. It writes nothing into the Memory Engine,
// the Knowledge Graph, KOE or any other module. It EXECUTES nothing: an action is only a suggestion that a person with the role its level asks for can approve (which is only recorded), reject or let expire.

import { reduceRag, resolveConfig } from "@/lib/nex/rag";
import type { KnowledgeState } from "@/lib/nex/knowledge";
import type { MemoryState } from "@/lib/nex/memory";
import { analyzeQuery } from "@/lib/nex/rag";
import { buildActions, decideAction, expireActions, upsertActions } from "./copilot-actions";
import { buildDashboard, consultedOf, gatherFacts, objectivesOf } from "./copilot-context";
import { CopilotEventLog, CopilotObservability } from "./copilot-observability";
import { buildPlan, planTypeFor } from "./copilot-planner";
import { SEVERITY_RANK, evaluateFindings, recommend } from "./copilot-recommendations";
import { APPROVER_BY_LEVEL, authorize, canApprove, canDecide, canSeeAction, canSeeFinance, ownerKey, safeToShow, validateQuery, validateShortText } from "./copilot-security";
import { SESSION_ID, addDecision, addSession, findSession, latestSessionOf, newSession, recordTurn, removeSession, replaceSession, sessionIdFor, sweepSessions } from "./copilot-session";
import {
  DEFAULT_CONFIG, PLAN_TYPES, SEVERITIES,
  type AskOptions, type CopilotConfig, type CopilotEnv, type CopilotEvent, type CopilotEventInput, type CopilotEventType, type CopilotOutcome, type CopilotResponse, type CopilotResult, type CopilotState,
  type DashboardData, type KoeInput, type Principal, type Recommendation, type Refusal, type Session, type SuggestedAction,
} from "./copilot-types";

export type CopilotSources = { memory: MemoryState; graph: KnowledgeState; /** KOE's input for the asker's company (the Copilot never asks KOE to compute for another company) */ koe?: KoeInput; env: CopilotEnv };
export const newCopilotState = (): CopilotState => ({ sessions: [], actions: [], rag: { cache: [], stats: {}, audit: [] }, seq: {}, audit: [] });
const MAX_AUDIT = 2_000;
const LABEL: Readonly<Record<string, string>> = { critical: "Crítica", high: "Alta", medium: "Media", low: "Baja" };

const name = (principal: Principal): string => (principal.kind === "system" ? "system" : principal.id);
const note = (event: CopilotEvent, type: CopilotEventType, detail?: Readonly<Record<string, unknown>>): CopilotEventInput => ({
  at: event.at, tenantId: event.actor.tenantId, actorKind: event.actor.kind, actorId: name(event.actor), type, ...(detail ? { detail } : {}),
});
function finish(state: CopilotState, event: CopilotEvent, result: Omit<CopilotResult, "events">, events: readonly CopilotEventInput[], detail: Record<string, string | number | boolean> = {}): CopilotOutcome {
  // the audit trail names the action and counts, never the question or the knowledge; it is written in the ACTOR's company
  const entry = { at: event.at, actor: name(event.actor), tenantId: event.actor.tenantId, action: `${event.type}${result.ok ? "" : ".refused"}`, detail: { ok: result.ok, ...(result.refusal ? { reason: result.refusal } : {}), ...detail } };
  return { state: { ...state, audit: [...state.audit, entry].slice(-MAX_AUDIT) }, result: { ...result, events } };
}
const refuse = (state: CopilotState, event: CopilotEvent, refusal: Refusal, reasons: readonly string[] = [], before: readonly CopilotEventInput[] = []): CopilotOutcome =>
  finish(state, event, { ok: false, refusal, ...(reasons.length > 0 ? { reasons } : {}) }, [...before, note(event, "copilot.refused", { reason: refusal, action: event.type })]);
const nextSeq = (state: CopilotState, key: string): { n: number; seq: Readonly<Record<string, number>> } => { const n = (state.seq[key] ?? 0) + 1; return { n, seq: { ...state.seq, [key]: n } }; };

function validateAsk(options: AskOptions): { issues: string[]; objective?: string } {
  const issues: string[] = [];
  if (options.sessionId !== undefined && !SESSION_ID.test(options.sessionId)) issues.push("sessionId");
  if (options.planType !== undefined && !PLAN_TYPES.includes(options.planType)) issues.push("planType");
  if (options.topK !== undefined && (!Number.isInteger(options.topK) || options.topK < 1)) issues.push("topK");
  let objective: string | undefined;
  if (options.objective !== undefined) { const checked = validateShortText(options.objective); if (checked.ok) objective = checked.text; else issues.push(`objective:${checked.reason}`); }
  return { issues, ...(objective !== undefined ? { objective } : {}) };
}

/** The answer as fixed text: a headline, the context found, the priorities, the plan and what is waiting for a person. Never generated by a model. */
function answerText(input: { dashboard: DashboardData; topic: string; plan: CopilotResponse["plan"]; recs: readonly Recommendation[]; contextLines: readonly string[]; actions: readonly SuggestedAction[] }): string {
  const waiting = input.actions.filter((action) => action.status === "suggested").length;
  const lines = [
    ...input.dashboard.summary,
    `Tema: ${input.topic}. ${input.plan.title} (${input.plan.horizon}). Objetivo: ${input.plan.objective}.`,
    ...(input.contextLines.length > 0 ? ["Contexto relevante:", ...input.contextLines] : ["No se encontró conocimiento relevante para esta pregunta."]),
    ...(input.recs.length > 0 ? ["Prioridades:", ...input.recs.slice(0, 3).map((rec, index) => `${index + 1}. [${LABEL[rec.severity]}] ${rec.title}: ${rec.reason}`)] : []),
    "Plan:", ...input.plan.steps.map((step) => `${step.order}. ${step.title}`),
    `Acciones sugeridas: ${input.actions.length} (${waiting} por aprobar). Ninguna se ejecuta sin la aprobación de una persona.`,
  ];
  return lines.join("\n");
}

function ask(start: CopilotState, event: Extract<CopilotEvent, { type: "ask" }>, sources: CopilotSources, config: CopilotConfig): CopilotOutcome {
  const { actor, tenantId } = event;
  const valid = validateQuery(event.question);
  if (!valid.ok) return refuse(start, event, valid.refusal, valid.reasons);
  const options = event.options ?? {};
  const checked = validateAsk(options);
  if (checked.issues.length > 0) return refuse(start, event, "invalid", checked.issues);
  const nowMs = Date.parse(event.at);
  const owner = ownerKey(actor);
  const events: CopilotEventInput[] = [];

  // what is over: idle sessions and suggestions nobody decided on in time
  const swept = sweepSessions(start.sessions, tenantId, nowMs, config.sessionTtlMs);
  const expiredActions = expireActions(start.actions, tenantId, nowMs);
  let state: CopilotState = { ...start, sessions: swept.sessions, actions: expiredActions.actions };
  if (swept.ended > 0) events.push(note(event, "copilot.session_ended", { count: swept.ended, by: "idle" }));
  if (expiredActions.expired.length > 0) events.push(note(event, "copilot.action_expired", { count: expiredActions.expired.length }));

  // the session: the asker's own, or a new one
  let session: Session;
  if (options.sessionId !== undefined) {
    const found = findSession(state.sessions, tenantId, options.sessionId, owner);
    if (!found) return refuse(state, event, start.sessions.some((row) => row.id === options.sessionId && row.tenantId === tenantId && row.owner === owner) ? "expired" : "notFound", [], events);
    session = found;
  } else {
    const made = nextSeq(state, `${tenantId}|s`);
    session = newSession(tenantId, owner, sessionIdFor(made.n), event.at);
    state = { ...state, seq: made.seq, sessions: addSession(state.sessions, session, config.maxSessions) };
    events.push(note(event, "copilot.session_started"));
  }
  const objective = checked.objective ?? session.objective;

  // 1. the question as the RAG sees it (a short follow-up keeps the topic of the session), 2. the RAG: Memory + Knowledge Graph
  const analysis = analyzeQuery(valid.text);
  const query = analysis.terms.length < 2 && session.focus.length > 0 ? `${valid.text} ${session.focus.join(" ")}` : valid.text;
  const rag = reduceRag(state.rag, { type: "retrieve", tenantId, actor, at: event.at, query, ...(options.topK !== undefined ? { options: { topK: options.topK } } : {}) }, { memory: sources.memory, graph: sources.graph, env: sources.env }, resolveConfig(config.rag));
  if (!rag.result.ok) return refuse(state, event, (rag.result.refusal ?? "invalid") as Refusal, rag.result.reasons ?? [], events);
  state = { ...state, rag: rag.state };

  // 3. what the company is like (memory and graph as far as the asker may see, KOE as far as the role allows) → 4. problems, opportunities and risks → 5. recommendations
  const facts = gatherFacts({ memory: sources.memory, graph: sources.graph, ...(sources.koe ? { koe: sources.koe } : {}) }, actor, rag.result, objective);
  const findings = evaluateFindings(facts, canSeeFinance(actor));
  const recommendations = recommend(findings);
  const top = recommendations.slice(0, config.maxRecommendations);

  // 6. the plan
  const planType = planTypeFor(analysis.terms, analysis.intents, findings, options.planType);
  const objectives = objectivesOf({ ...(objective !== undefined ? { objective } : {}) }, facts.objectives, planType);
  const plan = buildPlan({ id: `plan:${session.id}:${session.turns + 1}`, type: planType, objective: (objectives[0] as { label: string }).label, recommendations, maxSteps: config.maxSteps });

  // 7. the actions: prepared, never executed
  const incoming = buildActions(top, tenantId, event.at, config);
  const actions = upsertActions(state.actions, incoming, tenantId, config.maxActions);
  const mine = actions.filter((action) => action.tenantId === tenantId && incoming.some((row) => row.id === action.id) && canSeeAction(actor, action));
  state = { ...state, actions };

  // 8. the session keeps the topic, the objective and the recommendations: not the conversation
  session = recordTurn(session, { at: event.at, topic: analysis.primary, terms: analysis.terms, ...(objective !== undefined ? { objective } : {}), recommendations: top.slice(0, 5).map((rec) => ({ id: rec.id, title: rec.title, severity: rec.severity })) });
  state = { ...state, sessions: replaceSession(state.sessions, session) };

  // 9. the answer
  const dashboard = buildDashboard({ tenantId, at: event.at, facts, recommendations, actions: mine, actor });
  const contextLines = (rag.result.context?.entries ?? []).slice(0, 3).map((entry) => entry.line);
  let text = answerText({ dashboard, topic: session.topic ?? analysis.primary, plan, recs: top, contextLines, actions: mine });
  if (!safeToShow(text)) text = answerText({ dashboard, topic: session.topic ?? analysis.primary, plan, recs: top, contextLines: [], actions: mine });
  const consulted = consultedOf(facts, true);
  const response: CopilotResponse = {
    sessionId: session.id, topic: session.topic ?? analysis.primary,
    understanding: { objectives, findings, counts: { memories: facts.memory.total, importantMemories: facts.memory.important, graphNodes: facts.graph.nodes, graphEdges: facts.graph.edges, isolatedNodes: facts.graph.isolated, processes: facts.graph.processes } },
    context: { items: rag.result.items.length, chars: rag.result.context?.chars ?? 0, sources: rag.result.items.map((item) => ({ key: item.key, kind: item.kind, type: item.type, score: item.score })), lines: contextLines, cached: rag.result.cached },
    plan, recommendations: top, actions: mine, executiveSummary: dashboard.summary, text, consulted,
  };
  const bySeverity = Object.fromEntries(SEVERITIES.map((severity) => [severity, top.filter((rec) => rec.severity === severity).length]));
  events.push(
    note(event, "copilot.context", { items: response.context.items, chars: response.context.chars, cached: rag.result.cached, ...(rag.result.items[0] ? { topScore: rag.result.items[0].score } : {}) }),
    note(event, "copilot.planned", { type: plan.type, steps: plan.steps.length, horizon: plan.horizon }),
    note(event, "copilot.recommended", { count: top.length, ...bySeverity, ...(top[0] ? { topScore: top[0].score } : {}) }),
    ...(mine.length > 0 ? [note(event, "copilot.action_suggested", { count: incoming.length, level1: incoming.filter((a) => a.level === 1).length, level2: incoming.filter((a) => a.level === 2).length, level3: incoming.filter((a) => a.level === 3).length })] : []),
    note(event, "copilot.asked", { intent: analysis.primary, plan: plan.type, cached: rag.result.cached, findings: findings.length, recommendations: top.length, actions: mine.length, ...consulted }),
  );
  return finish(state, event, { ok: true, response, session }, events, { findings: findings.length, recommendations: top.length, actions: mine.length, cached: rag.result.cached });
}

export function reduceCopilot(state: CopilotState, event: CopilotEvent, sources: CopilotSources, config: CopilotConfig = DEFAULT_CONFIG): CopilotOutcome {
  const { actor, tenantId } = event;
  const refusal = authorize(actor, tenantId, sources.env);
  if (refusal) return refuse(state, event, refusal);
  if (Number.isNaN(Date.parse(event.at))) return refuse(state, event, "invalid", ["at"]);
  const nowMs = Date.parse(event.at);
  const owner = ownerKey(actor);

  switch (event.type) {
    case "ask": return ask(state, event, sources, config);
    case "decide": {
      if (!canDecide(actor)) return refuse(state, event, "forbidden");
      const session = findSession(state.sessions, tenantId, event.sessionId, owner);
      if (!session) return refuse(state, event, "notFound");
      const label = validateShortText(event.label);
      if (!label.ok) return refuse(state, event, label.reason === "sensitive" ? "sensitive" : "invalid", [label.reason]);
      const made = nextSeq(state, `${tenantId}|d`);
      const next = addDecision(session, { id: `d_${String(made.n).padStart(6, "0")}`, label: label.text, at: event.at }, config.maxDecisions);
      return finish({ ...state, seq: made.seq, sessions: replaceSession(state.sessions, next) }, event, { ok: true, session: next }, [note(event, "copilot.decision")]);
    }
    case "end": {
      const session = findSession(state.sessions, tenantId, event.sessionId, owner);
      if (!session) return refuse(state, event, "notFound");
      return finish({ ...state, sessions: removeSession(state.sessions, tenantId, session.id) }, event, { ok: true }, [note(event, "copilot.session_ended", { count: 1, by: "person" })]);
    }
    case "approve":
    case "reject": {
      const found = state.actions.find((action) => action.tenantId === tenantId && action.id === event.actionId);
      // what the asker may not see does not exist for them
      if (!found || !canSeeAction(actor, found)) return refuse(state, event, "notFound");
      if (actor.kind !== "person") return refuse(state, event, "forbidden");
      if (found.status !== "suggested" && found.status !== "expired") return refuse(state, event, "invalid", ["status"]);
      if (found.status === "expired" || nowMs >= Date.parse(found.expiresAt)) {
        const expired = state.actions.map((action) => (action === found ? { ...action, status: "expired" as const } : action));
        return finish({ ...state, actions: expired }, event, { ok: false, refusal: "expired" }, [note(event, "copilot.refused", { reason: "expired", action: event.type })]);
      }
      if (!canApprove(actor, found)) return refuse(state, event, "level", [`requires:${APPROVER_BY_LEVEL[found.level]}`]);
      const decided = decideAction(found, event.type === "approve" ? "approved" : "rejected", name(actor), event.at);
      let next: CopilotState = { ...state, actions: state.actions.map((action) => (action === found ? decided : action)) };
      // the decision is part of what the asker's session remembers (ids only)
      const session = latestSessionOf(next.sessions, tenantId, owner);
      if (session) {
        const made = nextSeq(next, `${tenantId}|d`);
        next = { ...next, seq: made.seq, sessions: replaceSession(next.sessions, addDecision(session, { id: `d_${String(made.n).padStart(6, "0")}`, label: `${decided.status} ${decided.actionId}`.slice(0, 120), at: event.at }, config.maxDecisions)) };
      }
      return finish(next, event, { ok: true, action: decided }, [note(event, event.type === "approve" ? "copilot.action_approved" : "copilot.action_rejected", { level: decided.level })], { level: decided.level });
    }
    case "dashboard": {
      const facts = gatherFacts({ memory: sources.memory, graph: sources.graph, ...(sources.koe ? { koe: sources.koe } : {}) }, actor, undefined, latestSessionOf(state.sessions, tenantId, owner)?.objective);
      const recommendations = recommend(evaluateFindings(facts, canSeeFinance(actor)));
      const visible = state.actions.filter((action) => action.tenantId === tenantId && canSeeAction(actor, action) && !(action.status === "suggested" && nowMs >= Date.parse(action.expiresAt)));
      const dashboard = buildDashboard({ tenantId, at: event.at, facts, recommendations, actions: visible, actor });
      return finish(state, event, { ok: true, dashboard }, [note(event, "copilot.dashboard", { status: dashboard.status, kpis: dashboard.kpis.length, alerts: dashboard.alerts.length })], { kpis: dashboard.kpis.length });
    }
  }
}

// ------------------------------------------------------------------------------------------ the engine: state + log + observability around the reducer
export type EngineOptions = {
  env: CopilotEnv;
  /** milliseconds; injected so nothing here reads a clock */
  now: () => number;
  /** read-only access to the knowledge at the moment of each question: the Copilot never writes into any of it */
  memory: () => MemoryState;
  graph: () => KnowledgeState;
  /** KOE's input for a company (the Copilot only reads it, through KOE's own statistics engine) */
  koe?: (tenantId: string) => KoeInput | undefined;
  config?: Partial<CopilotConfig>;
  state?: CopilotState;
};

export class CopilotEngine {
  state: CopilotState;
  readonly config: CopilotConfig;
  readonly log = new CopilotEventLog();
  readonly observability = new CopilotObservability(this.log);
  constructor(private readonly options: EngineOptions) {
    this.state = options.state ?? newCopilotState();
    this.config = { ...DEFAULT_CONFIG, ...options.config, rag: { ...DEFAULT_CONFIG.rag, ...options.config?.rag } };
  }
  private iso(ms: number): string { return new Date(ms).toISOString(); }
  private sources(tenantId: string): CopilotSources {
    const koe = this.options.koe?.(tenantId);
    return { memory: this.options.memory(), graph: this.options.graph(), env: this.options.env, ...(koe ? { koe } : {}) };
  }
  private run(event: CopilotEvent, latencyMs?: number): CopilotResult {
    const { state, result } = reduceCopilot(this.state, event, this.sources(event.actor.tenantId), this.config);
    this.state = state;
    for (const input of result.events) this.log.emit(input.type === "copilot.asked" && latencyMs !== undefined ? { ...input, detail: { ...input.detail, latencyMs } } : input);
    return result;
  }

  /** Answers a question. The latency of the whole pipeline is recorded; the question itself is never kept. */
  ask(actor: Principal, question: string, options: AskOptions = {}): CopilotResult {
    const started = this.options.now();
    const event: CopilotEvent = { type: "ask", tenantId: actor.tenantId, actor, at: this.iso(started), question, options };
    const { state, result } = reduceCopilot(this.state, event, this.sources(actor.tenantId), this.config);
    this.state = state;
    const latencyMs = Math.max(0, this.options.now() - started);
    for (const input of result.events) this.log.emit(input.type === "copilot.asked" ? { ...input, detail: { ...input.detail, latencyMs } } : input);
    return result;
  }
  decide(actor: Principal, sessionId: string, label: string): CopilotResult { return this.run({ type: "decide", tenantId: actor.tenantId, actor, at: this.iso(this.options.now()), sessionId, label }); }
  end(actor: Principal, sessionId: string): CopilotResult { return this.run({ type: "end", tenantId: actor.tenantId, actor, at: this.iso(this.options.now()), sessionId }); }
  approve(actor: Principal, actionId: string): CopilotResult { return this.run({ type: "approve", tenantId: actor.tenantId, actor, at: this.iso(this.options.now()), actionId }); }
  reject(actor: Principal, actionId: string): CopilotResult { return this.run({ type: "reject", tenantId: actor.tenantId, actor, at: this.iso(this.options.now()), actionId }); }
  /** The data a future executive dashboard will show. No screen. */
  dashboard(actor: Principal): CopilotResult { return this.run({ type: "dashboard", tenantId: actor.tenantId, actor, at: this.iso(this.options.now()) }); }

  /** The actions of the asker's company that the asker may see (what they may not see does not exist for them). */
  actionsFor(actor: Principal): readonly SuggestedAction[] { return this.state.actions.filter((action) => action.tenantId === actor.tenantId && canSeeAction(actor, action)); }
  sessionsOf(actor: Principal): readonly Session[] { return this.state.sessions.filter((session) => session.tenantId === actor.tenantId && session.owner === ownerKey(actor)); }
  snapshot(tenantId: string) { return this.observability.snapshot(tenantId, this.state); }
}
export { SEVERITY_RANK };
