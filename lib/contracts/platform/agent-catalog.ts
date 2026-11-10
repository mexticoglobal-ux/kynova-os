// AI Agent Runtime, catalog: the DATA the runtime works from. A playbook is the plan an agent follows for one kind of job: a short, ordered list of steps (ask the AI,
// use a tool, remember something, finish) written as data, never as code. The limits that bound every session, and the codes of why a session stopped, live here too.
// A new playbook is a new entry, never a change to the runtime. Nothing here calls anything: there is no network, no credential and no real model.
// An agent is a KOE Worker (its tools, its data clearance and its memory come from the Worker's definition) driven by a playbook through the runtime.

import type { Clearance } from "./koe-registry";

// ---------------------------------------------------------------- the steps of a plan
/**
 * What a playbook may ask an agent to do. `{name}` in a text is filled from the session's input. A step names a PURPOSE (never a model or a provider) or a tool of
 * the Worker (never a level: the level comes from the autonomy catalog).
 */
export type PlanStep =
  | { kind: "think"; purposeId: string; note: string }
  | { kind: "tool"; tool: string; input: Readonly<Record<string, string>> }
  | { kind: "remember"; key: string; value: string; sensitivity: Clearance }
  | { kind: "finish"; result: string };
export type StepKind = PlanStep["kind"];
export const STEP_KINDS: readonly StepKind[] = ["think", "tool", "remember", "finish"];

// ---------------------------------------------------------------- limits (every session is bounded; a company may only lower them)
export type AgentLimits = {
  maxSteps: number; // steps the session may take, retries included
  maxAiCalls: number;
  budgetMicros: number; // millionths of a dollar: the estimated cost of the run plus every AI call
  maxDurationMs: number;
  maxRetries: number; // retries of one step after a temporary failure
  loopThreshold: number; // how many times the same step may repeat before the session is stopped
};
export const AGENT_LIMIT_DEFAULTS: AgentLimits = { maxSteps: 12, maxAiCalls: 4, budgetMicros: 100_000, maxDurationMs: 600_000, maxRetries: 2, loopThreshold: 2 };
/** The hard ceilings: no playbook and no start request may go beyond them. */
export const AGENT_LIMIT_CEILINGS: AgentLimits = { maxSteps: 25, maxAiCalls: 10, budgetMicros: 5_000_000, maxDurationMs: 3_600_000, maxRetries: 4, loopThreshold: 5 };

export function validateLimits(limits: AgentLimits): string[] {
  const issues: string[] = [];
  for (const key of Object.keys(AGENT_LIMIT_CEILINGS) as (keyof AgentLimits)[]) {
    const value = limits[key];
    if (!Number.isInteger(value) || value <= 0 || value > AGENT_LIMIT_CEILINGS[key]) issues.push(key);
  }
  return issues;
}

// ---------------------------------------------------------------- why a session stopped, and how it can end
export const STOP_REASONS = ["steps", "aiCalls", "budget", "timeout", "loop", "killSwitch", "rejected", "cancelled"] as const;
export type StopReason = (typeof STOP_REASONS)[number];
export const SESSION_STATUSES = ["running", "waitingApproval", "escalated", "completed", "stopped", "cancelled", "handedOff"] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];
/** A session in one of these never moves again. */
export const FINAL_STATUSES: readonly SessionStatus[] = ["completed", "stopped", "cancelled", "handedOff"];

// ---------------------------------------------------------------- playbooks
export type Playbook = {
  id: string;
  label: string;
  summary: string;
  workerId: string;
  /** What a person must give to start it. Every `{name}` the steps use must be one of these. */
  params: readonly string[];
  steps: readonly PlanStep[];
  limits?: Partial<AgentLimits>;
};

export const PLAYBOOKS: readonly Playbook[] = [
  {
    id: "sales.qualify", label: "Calificar un prospecto", workerId: "sales", params: ["contacto"],
    summary: "Lee al contacto, calcula su calificación, pide un análisis, recuerda el resultado y deja un borrador de primer mensaje. No envía nada.",
    steps: [
      { kind: "tool", tool: "contact.read", input: { contacto: "{contacto}" } },
      { kind: "tool", tool: "lead.score", input: { prospecto: "{contacto}" } },
      { kind: "think", purposeId: "lead.analyze", note: "Analiza al prospecto" },
      { kind: "remember", key: "calificacion", value: "Calificación preparada para {contacto}", sensitivity: "business" },
      { kind: "tool", tool: "message.draft", input: { contacto: "{contacto}", tema: "primer contacto" } },
      { kind: "finish", result: "Prospecto {contacto} calificado y borrador de primer mensaje listo para aprobar." },
    ],
  },
  {
    id: "followup.nudge", label: "Dar seguimiento a un contacto", workerId: "followup", params: ["contacto", "tema"],
    summary: "Lee al contacto, redacta el seguimiento con ayuda de la IA y deja una tarea interna. No envía nada.",
    steps: [
      { kind: "tool", tool: "contact.read", input: { contacto: "{contacto}" } },
      { kind: "think", purposeId: "message.draft", note: "Redacta el seguimiento" },
      { kind: "tool", tool: "message.draft", input: { contacto: "{contacto}", tema: "{tema}" } },
      { kind: "tool", tool: "task.create", input: { titulo: "Dar seguimiento a {contacto}" } },
      { kind: "finish", result: "Seguimiento de {contacto} preparado y tarea creada." },
    ],
  },
  {
    id: "reporter.daily", label: "Resumen del negocio", workerId: "reporter", params: ["tema"],
    summary: "Prepara un resumen de un tema con ayuda de la IA.",
    steps: [
      { kind: "tool", tool: "summary.prepare", input: { tema: "{tema}" } },
      { kind: "think", purposeId: "summary.prepare", note: "Resume" },
      { kind: "finish", result: "Resumen de {tema} listo." },
    ],
  },
  {
    id: "collections.reminder", label: "Recordatorio de cobro", workerId: "collections", params: ["contacto", "cliente", "monto"],
    summary: "Prepara el recordatorio y pide un enlace de cobro. El enlace mueve dinero: siempre espera a una persona.",
    steps: [
      { kind: "tool", tool: "contact.read", input: { contacto: "{contacto}" } },
      { kind: "tool", tool: "message.draft", input: { contacto: "{contacto}", tema: "recordatorio de pago" } },
      { kind: "tool", tool: "payment.createLink", input: { cliente: "{cliente}", monto: "{monto}" } },
      { kind: "finish", result: "Recordatorio y enlace de cobro de {cliente} preparados." },
    ],
  },
];
export const playbookById = (id: string): Playbook | undefined => PLAYBOOKS.find((item) => item.id === id);
