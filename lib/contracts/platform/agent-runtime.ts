// AI Agent Runtime: the rules that bound an agent session, worked out in ONE place. Checking a playbook against the Worker that will run it, previewing what a plan will
// do (which steps need a person), the limits every session obeys (steps, AI calls, budget, time, repeated steps), the retry rule, and the trace and metrics of a session.
// Pure and deterministic, with no real network, no real credential and no real model. It reads the Workers' definitions and the autonomy catalog, and it never changes them:
// an agent can do only what its Worker may, and the level of every action is decided by the catalog, never by the playbook or the agent.

import { fnv } from "./koe-dev";
import { purposeById } from "./koe-ai-catalog";
import type { ToolEntry, WorkerDefinition } from "./koe-registry";
import { levelForAction, type AutonomyLevel } from "./workers";
import {
  AGENT_LIMIT_CEILINGS, FINAL_STATUSES, STEP_KINDS, type AgentLimits, type PlanStep, type Playbook, type SessionStatus, type StepKind, type StopReason,
} from "./agent-catalog";

// ---------------------------------------------------------------- templates
const PLACEHOLDER = /\{([a-zA-Z][\w-]*)\}/g;
export const placeholdersOf = (text: string): string[] => [...text.matchAll(PLACEHOLDER)].map((match) => match[1] as string);
/** Fills `{name}` from the input. A name with no value is left as it is, so a missing one is easy to see and to refuse. */
export const fill = (text: string, input: Readonly<Record<string, string>>): string => text.replace(PLACEHOLDER, (whole, name: string) => input[name] ?? whole);
const textsOf = (step: PlanStep): string[] => {
  switch (step.kind) {
    case "think": return [step.note];
    case "tool": return Object.values(step.input);
    case "remember": return [step.key, step.value];
    case "finish": return [step.result];
  }
};

/** A step with every `{name}` filled. */
export function renderStep(step: PlanStep, input: Readonly<Record<string, string>>): PlanStep {
  switch (step.kind) {
    case "think": return { ...step, note: fill(step.note, input) };
    case "tool": return { ...step, input: Object.fromEntries(Object.entries(step.input).map(([key, value]) => [key, fill(value, input)])) };
    case "remember": return { ...step, key: fill(step.key, input), value: fill(step.value, input) };
    case "finish": return { ...step, result: fill(step.result, input) };
  }
}

// ---------------------------------------------------------------- is the plan valid for this Worker
/** The issues of a playbook against the Worker that will run it. Empty when it is valid. */
export function validatePlaybook(playbook: Playbook, definition: Pick<WorkerDefinition, "id" | "tools">, tools: Readonly<Record<string, ToolEntry>>): string[] {
  const issues: string[] = [];
  if (playbook.workerId !== definition.id) issues.push("es de otro Worker");
  if (playbook.steps.length === 0) issues.push("no tiene pasos");
  if (playbook.steps.length > AGENT_LIMIT_CEILINGS.maxSteps) issues.push("tiene demasiados pasos");
  const last = playbook.steps.at(-1);
  if (last?.kind !== "finish") issues.push("debe terminar con un paso de cierre");
  if (playbook.steps.slice(0, -1).some((step) => step.kind === "finish")) issues.push("el cierre solo puede ir al final");
  const aiCalls = playbook.steps.filter((step) => step.kind === "think").length;
  if (aiCalls > (playbook.limits?.maxAiCalls ?? AGENT_LIMIT_CEILINGS.maxAiCalls)) issues.push("pide más llamadas a la IA de las que permite");
  for (const [index, step] of playbook.steps.entries()) {
    const where = `paso ${index + 1}`;
    if (!STEP_KINDS.includes(step.kind as StepKind)) issues.push(`${where}: tipo desconocido`);
    if (step.kind === "think" && !purposeById(step.purposeId)) issues.push(`${where}: propósito desconocido`);
    if (step.kind === "tool") {
      const entry = tools[step.tool];
      if (!entry || entry.status !== "active") issues.push(`${where}: herramienta desconocida`);
      else if (!definition.tools.includes(step.tool)) issues.push(`${where}: el Worker no puede usar ${step.tool}`);
      else for (const field of entry.manifest.required) if (!(step.input[field] ?? "").trim()) issues.push(`${where}: falta «${field}»`);
    }
    for (const name of textsOf(step).flatMap(placeholdersOf)) if (!playbook.params.includes(name)) issues.push(`${where}: «${name}» no es un dato del plan`);
  }
  return issues;
}

/** What a plan will do, before it runs: the autonomy level of each action and whether it will wait for a person. */
export type PlanPreviewStep = { index: number; kind: StepKind; label: string; level?: AutonomyLevel; needsPerson: boolean };
export function previewPlan(playbook: Playbook, tools: Readonly<Record<string, ToolEntry>>): PlanPreviewStep[] {
  return playbook.steps.map((step, index) => {
    if (step.kind === "tool") {
      const level = levelForAction(step.tool);
      return { index, kind: step.kind, label: tools[step.tool]?.manifest.label ?? step.tool, level, needsPerson: level !== 1 };
    }
    return { index, kind: step.kind, label: step.kind === "think" ? (purposeById(step.purposeId)?.label ?? step.purposeId) : step.kind === "remember" ? step.key : "Cierre", needsPerson: false };
  });
}

// ---------------------------------------------------------------- the session
export type SessionStepStatus = "done" | "retry" | "failed" | "waiting";
export type SessionStep = {
  id: string; index: number; at: string; kind: StepKind; detail: string; status: SessionStepStatus; attempt: number; costMicros: number; backoffMs: number;
  signature: string; aiRecordId?: string; koeStepId?: string; approvalId?: string; note?: string;
};
export type Escalation = { reason: string; at: string; handledBy?: string };
export type Session = {
  id: string; tenantId: string; instanceId: string; workerId: string; playbookId: string; goal: string; input: Readonly<Record<string, string>>; runId: string; status: SessionStatus;
  cursor: number; steps: readonly SessionStep[]; startedBy: string; startedAt: string; finishedAt?: string; limits: AgentLimits; baseCostMicros: number; spentMicros: number;
  aiCalls: number; stopReason?: StopReason; escalation?: Escalation; result?: string;
};

export const isFinal = (status: SessionStatus): boolean => FINAL_STATUSES.includes(status);
export const stepSignature = (step: PlanStep): string => `${step.kind}|${step.kind === "tool" ? step.tool : step.kind === "think" ? step.purposeId : step.kind === "remember" ? step.key : "finish"}|${fnv(JSON.stringify(textsOf(step)))}`;

/** The attempt number of the step at this position: one more than the failed attempts it already has. */
export const attemptOf = (session: Pick<Session, "steps">, index: number): number => session.steps.filter((item) => item.index === index && item.status === "retry").length + 1;

/** Why a session must stop before its next step, or null when it may go on. The order is the order of importance. */
export function checkLimits(session: Session, at: string): StopReason | null {
  const { limits } = session;
  if (Date.parse(at) - Date.parse(session.startedAt) > limits.maxDurationMs) return "timeout";
  if (session.steps.length >= limits.maxSteps) return "steps";
  if (session.spentMicros > limits.budgetMicros) return "budget";
  return null;
}
/** Whether the next step is an AI call that would go past the limit, so it can be refused before asking. */
export const aiCallsExhausted = (session: Session): boolean => session.aiCalls >= session.limits.maxAiCalls;

/** The same step done again and again: the last `threshold + 1` finished steps all have one signature. */
export function isLoop(steps: readonly SessionStep[], threshold: number): boolean {
  const done = steps.filter((item) => item.status === "done");
  if (done.length <= threshold) return false;
  const recent = done.slice(-(threshold + 1));
  return recent.every((item) => item.signature === recent[0]?.signature);
}

/** A temporary failure is retried until the retries run out; anything else goes to a person. */
export const mayRetry = (attempt: number, limits: Pick<AgentLimits, "maxRetries">): boolean => attempt <= limits.maxRetries;
/** The wait before the next attempt (recorded, never slept): it doubles each time. */
export const backoffMs = (attempt: number): number => 100 * 2 ** (attempt - 1);

// ---------------------------------------------------------------- metrics and trace
export type AgentMetrics = {
  sessions: number; byStatus: Record<SessionStatus, number>; steps: number; retries: number; escalations: number; approvalsRequested: number; aiCalls: number; spentMicros: number;
  averageSteps: number; stopReasons: { reason: StopReason; count: number }[];
};
export function agentMetrics(sessions: readonly Session[], tenantId: string): AgentMetrics {
  const mine = sessions.filter((item) => item.tenantId === tenantId);
  const byStatus: Record<SessionStatus, number> = { running: 0, waitingApproval: 0, escalated: 0, completed: 0, stopped: 0, cancelled: 0, handedOff: 0 };
  const reasons = new Map<StopReason, number>();
  for (const session of mine) {
    byStatus[session.status] += 1;
    if (session.stopReason) reasons.set(session.stopReason, (reasons.get(session.stopReason) ?? 0) + 1);
  }
  const steps = mine.reduce((sum, item) => sum + item.steps.length, 0);
  return {
    sessions: mine.length, byStatus, steps, retries: mine.reduce((sum, item) => sum + item.steps.filter((step) => step.status === "retry").length, 0),
    escalations: mine.filter((item) => item.escalation).length, approvalsRequested: mine.reduce((sum, item) => sum + item.steps.filter((step) => step.approvalId).length, 0),
    aiCalls: mine.reduce((sum, item) => sum + item.aiCalls, 0), spentMicros: mine.reduce((sum, item) => sum + item.spentMicros, 0),
    averageSteps: mine.length === 0 ? 0 : Math.round((steps / mine.length) * 10) / 10, stopReasons: [...reasons].map(([reason, count]) => ({ reason, count })),
  };
}

/** The trace of a session, one line per step, in order. */
export function explainSession(session: Session): string[] {
  return session.steps.map((step) => `${String(step.index + 1).padStart(2, "0")} · ${step.kind} · ${step.status}${step.attempt > 1 ? ` (intento ${step.attempt})` : ""} · ${step.detail}${step.note ? ` — ${step.note}` : ""}`);
}
