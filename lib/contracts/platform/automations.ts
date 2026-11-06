// Automations contracts: a trigger, optional conditions and a short list of actions. Definitions are data, validated here.
// Anything that reaches outside the platform or moves money is created as an approval request, never executed directly.

export const TRIGGER_KINDS = ["leadCreated", "leadGradeChanged", "messageReceived", "approvalDecided", "opportunityStageChanged", "paymentSucceeded", "schedule"] as const;
export type TriggerKind = (typeof TRIGGER_KINDS)[number];

export const CONDITION_OPS = ["equals", "notEquals", "greaterThan", "lessThan", "contains"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export const ACTION_KINDS = ["createTask", "notifyUser", "addTag", "draftMessage", "moveOpportunityStage", "createApprovalRequest", "sendMessage", "callWebhook"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

// These reach outside the platform: they always run as an approval request (Level 3) unless an authorization covers them.
export const EXTERNAL_ACTIONS: readonly ActionKind[] = ["sendMessage", "callWebhook"];

export type Condition = { field: string; op: ConditionOp; value: string | number | boolean };
export type Action = { kind: ActionKind; params: Record<string, string | number | boolean> };

export type AutomationDefinition = {
  name: string;
  trigger: { kind: TriggerKind; params?: Record<string, string | number | boolean> };
  conditions: readonly Condition[];
  actions: readonly Action[];
  status: "draft" | "testing" | "active" | "paused";
  // New automations start in test mode: they log what they would do and do nothing else.
  testMode: boolean;
};

export const MAX_ACTIONS = 10;
export const MAX_CONDITIONS = 8;

export type AutomationReport = { errors: string[]; warnings: string[]; approvalActions: number[] };

const LOOP_RISK: Partial<Record<ActionKind, TriggerKind>> = { moveOpportunityStage: "opportunityStageChanged" };

export function validateAutomation(definition: AutomationDefinition): AutomationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const approvalActions: number[] = [];

  if (definition.name.trim() === "" || definition.name.length > 120) errors.push("name is required (120 characters at most)");
  if (!(TRIGGER_KINDS as readonly string[]).includes(definition.trigger.kind)) errors.push(`unknown trigger: ${definition.trigger.kind}`);
  if (definition.trigger.kind === "schedule" && typeof definition.trigger.params?.cron !== "string") errors.push("a schedule needs a cron expression");
  if (definition.conditions.length > MAX_CONDITIONS) errors.push(`at most ${MAX_CONDITIONS} conditions`);
  for (const condition of definition.conditions) {
    if (!(CONDITION_OPS as readonly string[]).includes(condition.op)) errors.push(`unknown operator: ${condition.op}`);
    if (condition.field.trim() === "") errors.push("a condition needs a field");
  }
  if (definition.actions.length === 0) errors.push("at least one action");
  if (definition.actions.length > MAX_ACTIONS) errors.push(`at most ${MAX_ACTIONS} actions`);

  definition.actions.forEach((action, index) => {
    if (!(ACTION_KINDS as readonly string[]).includes(action.kind)) errors.push(`unknown action: ${action.kind}`);
    if (EXTERNAL_ACTIONS.includes(action.kind)) approvalActions.push(index);
    if (LOOP_RISK[action.kind] === definition.trigger.kind) warnings.push(`action ${index + 1} can retrigger this automation`);
  });
  if (approvalActions.length > 0) warnings.push("actions that reach outside the platform will wait for a person's approval");
  if (definition.status === "active" && definition.testMode) warnings.push("active but still in test mode: it will only log");
  return { errors, warnings, approvalActions };
}

export const AUTOMATION_RUN_STATUSES = ["queued", "running", "waitingApproval", "completed", "failed", "skipped", "testLogged"] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

export const AUTOMATION_TEMPLATES: readonly AutomationDefinition[] = [
  {
    name: "Aviso de prospecto caliente",
    trigger: { kind: "leadGradeChanged" },
    conditions: [{ field: "grade", op: "equals", value: "hot" }],
    actions: [{ kind: "notifyUser", params: { role: "admin" } }, { kind: "createTask", params: { title: "Contactar hoy", dueInHours: 4 } }],
    status: "draft",
    testMode: true,
  },
  {
    name: "Seguimiento tras la reunión",
    trigger: { kind: "approvalDecided" },
    conditions: [{ field: "kind", op: "equals", value: "meeting_request" }],
    actions: [{ kind: "createTask", params: { title: "Confirmar fecha", dueInHours: 48 } }, { kind: "draftMessage", params: { template: "recordatorio-reunion" } }],
    status: "draft",
    testMode: true,
  },
  {
    name: "Bienvenida al cliente nuevo",
    trigger: { kind: "paymentSucceeded" },
    conditions: [],
    actions: [{ kind: "addTag", params: { tag: "cliente-nuevo" } }, { kind: "sendMessage", params: { template: "bienvenida" } }],
    status: "draft",
    testMode: true,
  },
];
