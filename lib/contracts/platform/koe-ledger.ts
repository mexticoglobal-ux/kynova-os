// The KOE ledger: the single record every Insight is read from. Two kinds of entries, both append-only and owned by a company:
// - EXECUTIONS: what KOE routed (a Worker run, an automation run, an AI Studio test), turned into one neutral shape by the
//   adapters below. They are read from the records those modules already keep; nothing is counted twice or recomputed here.
// - FACTS: events the other modules report (a lead arrived, a course lesson was completed, a payment total). In the simulation
//   they come from a generator; later, from KOE's event feed. A fact has a closed metric, a number and a date: no free text, and
//   no bank or card data can be expressed in it.
// The statistics live in ONE place (koe-insights.ts). This file only defines the vocabulary and converts records.

import type { AutomationState, RunStatus as AutomationRunStatus, TriggerKind } from "./automation-center";
import type { KoeState } from "./koe-engine";
import type { StudioState } from "./studio-center";

// ---------------------------------------------------------------- the closed vocabulary
export const MODULES = ["sales", "marketing", "seo", "crm", "academy", "marketplace", "referrals", "automations", "workers", "payments", "integrations"] as const;
export type BusinessModule = (typeof MODULES)[number];
export const DEPARTMENTS = ["sales", "marketing", "support", "finance", "operations"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export type MetricUnit = "count" | "money" | "minutes";
// "sum": add what was reported in the period. "last": a snapshot, the latest value in the period counts.
export type MetricDef = { id: string; module: Exclude<BusinessModule, "automations" | "workers">; label: string; unit: MetricUnit; agg: "sum" | "last" };
export const METRICS: readonly MetricDef[] = [
  { id: "leadsNew", module: "sales", label: "Prospectos nuevos", unit: "count", agg: "sum" },
  { id: "leadsQualified", module: "sales", label: "Prospectos calificados", unit: "count", agg: "sum" },
  { id: "proposalsSent", module: "sales", label: "Propuestas enviadas", unit: "count", agg: "sum" },
  { id: "leadsConverted", module: "sales", label: "Prospectos convertidos", unit: "count", agg: "sum" },
  { id: "attributedRevenue", module: "sales", label: "Ingresos atribuidos", unit: "money", agg: "sum" },
  { id: "marketingLeads", module: "marketing", label: "Prospectos de campañas", unit: "count", agg: "sum" },
  { id: "contentPublished", module: "marketing", label: "Contenidos publicados", unit: "count", agg: "sum" },
  { id: "organicVisits", module: "seo", label: "Visitas orgánicas", unit: "count", agg: "sum" },
  { id: "keywordsTop10", module: "seo", label: "Palabras clave en el top 10", unit: "count", agg: "last" },
  { id: "customersNew", module: "crm", label: "Clientes nuevos", unit: "count", agg: "sum" },
  { id: "customersLost", module: "crm", label: "Clientes perdidos", unit: "count", agg: "sum" },
  { id: "customersActive", module: "crm", label: "Clientes activos", unit: "count", agg: "last" },
  { id: "customersServed", module: "crm", label: "Clientes atendidos", unit: "count", agg: "sum" },
  { id: "tasksCompleted", module: "crm", label: "Tareas completadas", unit: "count", agg: "sum" },
  { id: "manualMinutes", module: "crm", label: "Minutos de trabajo manual", unit: "minutes", agg: "sum" },
  { id: "lessonsCompleted", module: "academy", label: "Lecciones completadas", unit: "count", agg: "sum" },
  { id: "certificatesIssued", module: "academy", label: "Certificados emitidos", unit: "count", agg: "sum" },
  { id: "marketplaceSales", module: "marketplace", label: "Ventas del Marketplace", unit: "count", agg: "sum" },
  { id: "marketplaceRevenue", module: "marketplace", label: "Ingresos del Marketplace", unit: "money", agg: "sum" },
  { id: "referralsNew", module: "referrals", label: "Referidos nuevos", unit: "count", agg: "sum" },
  { id: "referralsConverted", module: "referrals", label: "Referidos convertidos", unit: "count", agg: "sum" },
  { id: "paymentsCount", module: "payments", label: "Cobros recibidos", unit: "count", agg: "sum" },
  { id: "paymentsValue", module: "payments", label: "Valor cobrado", unit: "money", agg: "sum" },
  { id: "syncsOk", module: "integrations", label: "Sincronizaciones correctas", unit: "count", agg: "sum" },
  { id: "syncsFailed", module: "integrations", label: "Sincronizaciones fallidas", unit: "count", agg: "sum" },
];
export const metricOf = (id: string): MetricDef | undefined => METRICS.find((item) => item.id === id);

// A fact is a number about a metric. Money is an aggregate in millionths of a dollar (never an account, card or payer).
export type BusinessFact = { id: string; tenantId: string; at: string; module: BusinessModule; metric: string; value: number; dimension?: Department; correctionOf?: string };

export function validateFact(fact: Pick<BusinessFact, "at" | "module" | "metric" | "value" | "dimension">): string[] {
  const issues: string[] = [];
  const def = metricOf(fact.metric);
  if (!def) issues.push(`métrica «${fact.metric}» desconocida`);
  else if (def.module !== fact.module) issues.push(`la métrica «${fact.metric}» pertenece a ${def.module}`);
  if (!Number.isFinite(fact.value) || Math.abs(fact.value) > 1e12) issues.push("valor");
  if (def && def.unit !== "money" && !Number.isInteger(fact.value)) issues.push("el valor debe ser entero");
  if (Number.isNaN(Date.parse(fact.at))) issues.push("fecha");
  if (fact.dimension !== undefined && !DEPARTMENTS.includes(fact.dimension)) issues.push("departamento");
  return issues;
}

// ---------------------------------------------------------------- processes: what an automatic execution replaces
export type ProcessDef = { label: string; department: Department; manualMinutes: number }; // minutes a person would have spent
export const PROCESSES = {
  "lead-reply": { label: "Responder a un prospecto", department: "sales", manualMinutes: 12 },
  "follow-up": { label: "Dar seguimiento", department: "sales", manualMinutes: 8 },
  "report": { label: "Preparar un reporte", department: "operations", manualMinutes: 45 },
  "collections": { label: "Preparar un cobro", department: "finance", manualMinutes: 15 },
  "coordination": { label: "Coordinar una tarea", department: "operations", manualMinutes: 10 },
  "tutoring": { label: "Responder una duda de un curso", department: "support", manualMinutes: 7 },
  "prospect-intake": { label: "Registrar un prospecto nuevo", department: "sales", manualMinutes: 6 },
  "client-onboarding": { label: "Dar la bienvenida a un cliente", department: "support", manualMinutes: 10 },
  "payment-reconcile": { label: "Conciliar un pago", department: "finance", manualMinutes: 9 },
  "meeting-prep": { label: "Preparar una reunión", department: "operations", manualMinutes: 12 },
  "form-triage": { label: "Clasificar un formulario", department: "marketing", manualMinutes: 5 },
  "manual-task": { label: "Tarea manual", department: "operations", manualMinutes: 8 },
} as const satisfies Record<string, ProcessDef>;
export type ProcessId = keyof typeof PROCESSES;

const SPECIALTY_PROCESS: Record<string, ProcessId | undefined> = { sales: "lead-reply", followup: "follow-up", analysis: "report", collections: "collections", coordination: "coordination", education: "tutoring", automation: "manual-task" };
const TRIGGER_PROCESS: Record<TriggerKind, ProcessId> = { newProspect: "prospect-intake", newClient: "client-onboarding", paymentReceived: "payment-reconcile", meetingCreated: "meeting-prep", formSubmitted: "form-triage", manual: "manual-task" };
export const processForSpecialty = (specialty: string): ProcessId | undefined => SPECIALTY_PROCESS[specialty];

// ---------------------------------------------------------------- executions
export type ExecutionSource = "koe" | "automation" | "studio" | "simulated";
export type Outcome = "success" | "error" | "other";
export type ExecutionEvent = {
  id: string; tenantId: string; at: string; source: ExecutionSource;
  workerId: string; workerName: string; specialty: string;
  modelId?: string; modelLabel?: string; fallback: boolean;
  outcome: Outcome; durationMs?: number; costMicros: number; tokens?: number;
  process?: ProcessId; // the manual process it replaced, when it replaced one (a test does not)
  automationId?: string; automationName?: string; agentId?: string; agentName?: string; promptId?: string; promptName?: string;
  compareGroup?: string; detail?: string;
};

export type WorkerInfo = { id: string; name: string; specialty: string };
export type Roster = { workers: readonly { id: string; name: string; specialty: string; status: "active" | "paused" | "disabled" }[]; agents: readonly { id: string; name: string; active: boolean }[] };
export const emptyRoster = (): Roster => ({ workers: [], agents: [] });

const FALLBACK = /respaldo/i;
const infoOf = (workers: readonly WorkerInfo[], id: string, name?: string): WorkerInfo => workers.find((item) => item.id === id) ?? { id, name: name ?? id, specialty: "custom" };

/** Every Worker run KOE recorded. This is the same record `koeMetrics` totals, so the two always agree. */
export function executionsFromKoe(state: KoeState): ExecutionEvent[] {
  return state.runs.map((run) => {
    const definition = state.definitions.find((item) => item.id === run.workerId);
    const model = run.steps.find((step) => step.kind === "model");
    const label = model?.modelId ? state.models.find((item) => item.id === model.modelId)?.label : undefined;
    const duration = run.finishedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : 0;
    const outcome: Outcome = run.status === "completed" ? "success" : run.status === "failed" ? "error" : "other";
    return {
      id: `k:${run.id}`, tenantId: run.tenantId, at: run.startedAt, source: "koe" as const,
      workerId: run.workerId, workerName: definition?.name ?? run.workerId, specialty: definition?.specialty ?? "custom",
      modelId: model?.modelId, modelLabel: label, fallback: FALLBACK.test(model?.routing ?? ""),
      outcome, durationMs: duration > 0 ? duration : undefined, costMicros: run.estimatedCostMicros, tokens: run.steps.reduce((sum, step) => sum + (step.tokens ?? 0), 0),
      process: outcome === "success" ? processForSpecialty(definition?.specialty ?? "") : undefined,
      detail: run.goal,
    };
  });
}

/** Live automation runs (a test run did nothing, a skipped one never ran). */
export function executionsFromAutomations(state: AutomationState, workers: readonly WorkerInfo[]): ExecutionEvent[] {
  const ran: readonly AutomationRunStatus[] = ["completed", "failed"];
  return state.runs.filter((run) => run.mode === "live" && ran.includes(run.status) && run.workerId).map((run) => {
    const worker = infoOf(workers, run.workerId ?? "", run.workerName);
    const outcome: Outcome = run.status === "completed" ? "success" : "error";
    return {
      id: `a:${run.id}`, tenantId: run.tenantId, at: run.at, source: "automation" as const, workerId: worker.id, workerName: worker.name, specialty: worker.specialty,
      modelId: run.model?.id, modelLabel: run.model?.label, fallback: FALLBACK.test(run.modelReason ?? ""), outcome, costMicros: run.estimatedCostMicros,
      process: outcome === "success" ? TRIGGER_PROCESS[run.trigger] : undefined, automationId: run.automationId, automationName: run.automationName,
    };
  });
}

/** Every AI Studio test: KOE chose the Worker and the model; the test replaced no manual process. */
export function executionsFromStudio(state: StudioState, workers: readonly WorkerInfo[]): ExecutionEvent[] {
  return state.tests.map((test) => {
    const worker = infoOf(workers, test.workerId, test.workerName);
    return {
      id: `s:${test.id}`, tenantId: test.tenantId, at: test.at, source: "studio" as const, workerId: worker.id, workerName: worker.name, specialty: worker.specialty,
      modelId: test.model.id, modelLabel: test.model.label, fallback: FALLBACK.test(test.modelReason), outcome: "success" as const, durationMs: test.estimatedMs, costMicros: test.estimatedCostMicros,
      tokens: test.tokensIn + test.tokensOut, ...(test.kind === "agent" ? { agentId: test.assetId, agentName: test.assetName } : { promptId: test.assetId, promptName: test.assetName }),
      compareGroup: test.compareGroup, detail: `${test.assetName} v${test.versionNumber}`,
    };
  });
}

export const workersOf = (state: KoeState): WorkerInfo[] => state.definitions.map((item) => ({ id: item.id, name: item.name, specialty: item.specialty }));

/** Who is installed and who is published, for "active Workers" and "active agents". */
export function rosterOf(koe: KoeState, studio: StudioState, tenantId: string): Roster {
  return {
    workers: koe.instances.filter((item) => item.tenantId === tenantId).map((item) => {
      const definition = koe.definitions.find((candidate) => candidate.id === item.definitionId);
      return { id: item.definitionId, name: definition?.name ?? item.definitionId, specialty: definition?.specialty ?? "custom", status: item.status };
    }),
    agents: studio.assets.filter((asset) => asset.tenantId === tenantId && asset.kind === "agent").map((asset) => ({ id: asset.id, name: asset.name, active: asset.publishedNumber !== undefined && !asset.archived })),
  };
}
