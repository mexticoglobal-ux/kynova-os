// NEX AI Workers contracts. A worker is a role NEX plays under a work agreement. The autonomy level of every action
// is decided HERE, in code, never by a model, and anything unknown is Level 3 (ADR-0009, Constitution).

export type AutonomyLevel = 1 | 2 | 3;

// Level 1: observe and prepare. Level 2: act inside a standing authorization. Level 3: always a person's confirmation.
export const ACTION_LEVELS = {
  "contact.read": 1,
  "lead.score": 1,
  "summary.prepare": 1,
  "message.draft": 1,
  "task.create": 1,
  "faq.answer": 2,
  "followup.send": 3,
  "message.sendFirst": 3,
  "message.sendSensitive": 3,
  "opportunity.create": 3,
  "opportunity.win": 3,
  "customer.create": 3,
  "payment.createLink": 3,
  "payment.refund": 3,
  "referral.approveCommission": 3,
  "referral.payout": 3,
  "marketplace.publish": 3,
  "marketplace.purchase": 3,
  "marketplace.revenueShare": 3,
  "marketplace.settlement": 3,
  "marketplace.draftListing": 1,
  "academy.draftCourse": 1,
  "reminder.create": 1,
  "notification.internal": 1,
  "event.prepare": 1,
  "academy.tutorAnswer": 2,
  "academy.publishOfficial": 3,
  "academy.certificate": 3,
  "calendar.write": 3,
  "contact.erase": 3,
  "studio.draft": 1,
  "studio.test": 1,
  "studio.assign": 2,
  "studio.publish": 3,
  "studio.share": 3,
} as const;
export type WorkerAction = keyof typeof ACTION_LEVELS;

export const isKnownAction = (action: string): action is WorkerAction => Object.prototype.hasOwnProperty.call(ACTION_LEVELS, action);

/** Fails closed: an action that is not in the catalog is Level 3. */
export const levelForAction = (action: string): AutonomyLevel => (isKnownAction(action) ? ACTION_LEVELS[action] : 3);

export type Authorization = {
  action: string;
  status: "inactive" | "active" | "revoked";
  // Limits are part of the authorization: beyond them the action goes back to Level 3.
  maxPerDay?: number;
  usedToday?: number;
  expiresAt?: string;
};

export type Decision = { allowed: boolean; level: AutonomyLevel; needs: "nothing" | "approval" };

/** What a worker may do with an action right now. Level 2 needs an active, unexpired, unexhausted authorization. */
export function decide(action: string, authorization?: Authorization, now: Date = new Date()): Decision {
  const level = levelForAction(action);
  if (level === 1) return { allowed: true, level, needs: "nothing" };
  if (level === 2 && authorization && authorization.action === action && authorization.status === "active") {
    const expired = authorization.expiresAt ? Date.parse(authorization.expiresAt) <= now.getTime() : false;
    const exhausted = authorization.maxPerDay !== undefined && (authorization.usedToday ?? 0) >= authorization.maxPerDay;
    if (!expired && !exhausted) return { allowed: true, level, needs: "nothing" };
  }
  return { allowed: false, level, needs: "approval" };
}

export type WorkerTemplate = {
  id: string;
  name: string;
  role: string;
  summary: string;
  tools: readonly WorkerAction[];
  // The highest level any of its tools reaches: shown to the owner before activating.
  highestLevel: AutonomyLevel;
};

export const highestLevelOf = (tools: readonly string[]): AutonomyLevel => tools.reduce<AutonomyLevel>((max, tool) => (levelForAction(tool) > max ? levelForAction(tool) : max), 1);

const template = (id: string, name: string, role: string, summary: string, tools: readonly WorkerAction[]): WorkerTemplate => ({ id, name, role, summary, tools, highestLevel: highestLevelOf(tools) });

export const WORKER_TEMPLATES: readonly WorkerTemplate[] = [
  template("sales-assistant", "Asistente comercial", "Atiende prospectos y prepara el traspaso", "Responde con mensajes aprobados, califica y prepara el resumen ejecutivo.", ["contact.read", "lead.score", "summary.prepare", "message.draft", "faq.answer", "message.sendFirst"]),
  template("follow-up", "Seguimiento", "Que ningún prospecto se enfríe", "Detecta próximas acciones vencidas y prepara el mensaje de seguimiento.", ["contact.read", "task.create", "message.draft", "followup.send"]),
  template("reporter", "Analista de reportes", "Resume el negocio", "Prepara el resumen semanal y señala lo que necesita atención.", ["contact.read", "summary.prepare"]),
  template("collections", "Cobranza", "Prepara cobros y recordatorios", "Redacta recordatorios y enlaces de pago: cada cobro lo aprueba una persona.", ["contact.read", "message.draft", "payment.createLink"]),
];

export const WORKER_RUN_STATUSES = ["queued", "running", "waitingApproval", "completed", "failed", "cancelled", "blocked"] as const;
export type WorkerRunStatus = (typeof WORKER_RUN_STATUSES)[number];

// Every worker has a budget and a stop switch; reaching either stops new runs without losing what already happened.
export type WorkerLimits = { maxRunsPerDay: number; maxActionsPerRun: number; paused: boolean };
export const canStartRun = (limits: WorkerLimits, runsToday: number): boolean => !limits.paused && runsToday < limits.maxRunsPerDay;
