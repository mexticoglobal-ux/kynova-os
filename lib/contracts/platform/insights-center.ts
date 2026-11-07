// Insights store: what a company may DO around its figures. The figures themselves are computed in one place (koe-insights.ts) from
// the KOE ledger; this store only holds the facts the platform reported, corrections, and report definitions. Pure and deterministic.
//
// Constitution (ADR-0009), enforced by how the events are built and tested:
// - There is no event that edits or deletes a fact, an execution, a log or an audit entry: history is append-only. A wrong figure is
//   fixed by a CORRECTION: a person (or NEX, as a proposal) explains it, a person approves it, and the result is a new compensating
//   fact. The original stays, and the audit trail says who approved what.
// - NEX may prepare: draft a report, edit its drafts, make a simulated export and propose a correction. A person approves, schedules
//   and shares. Nothing leaves the platform: scheduling and sharing are records, exports are descriptions, not files.
// - Facts come only from the platform ("system"). Everything is owned by a company and never mixed.

import { isPerson, isWorker } from "./actors";
import { metricOf, validateFact, type BusinessFact, type BusinessModule, type Department } from "./koe-ledger";
import { message, type ErrorCode } from "./insights-messages";

export const VIEWS = ["executive", "analytics", "ai", "productivity", "financial", "customers", "koe"] as const;
export type ViewKey = (typeof VIEWS)[number];
export const FORMATS = ["pdf", "xlsx"] as const;
export type Format = (typeof FORMATS)[number];
export const FREQUENCIES = ["none", "weekly", "monthly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export type Correction = {
  id: string; tenantId: string; factId: string; newValue: number; reason: string; status: "proposed" | "approved" | "rejected";
  proposedBy: string; proposedAt: string; decidedBy?: string; decidedAt?: string; compensatingFactId?: string;
};
export type ReportInput = { name: string; sections: readonly ViewKey[]; format: Format };
export type Report = ReportInput & {
  id: string; tenantId: string; status: "draft" | "approved"; frequency: Frequency; recipients: readonly string[];
  createdBy: string; createdAt: string; updatedAt: string; approvedBy?: string; approvedAt?: string;
};
// A simulated export: it describes the file that WOULD be produced. No file, no bytes, no download.
export type ExportRecord = { id: string; tenantId: string; reportId: string; reportName: string; format: Format; filename: string; sections: readonly ViewKey[]; at: string; by: string; simulated: true };

export type InsightsAudit = { at: string; actor: string; tenantId: string; action: string; detail?: string };
export type InsightsLog = { at: string; level: "info" | "warn"; event: string };
export type InsightsState = {
  facts: readonly BusinessFact[]; corrections: readonly Correction[]; reports: readonly Report[]; exports: readonly ExportRecord[];
  audit: readonly InsightsAudit[]; logs: readonly InsightsLog[]; sequence: number;
};
export const newInsightsState = (): InsightsState => ({ facts: [], corrections: [], reports: [], exports: [], audit: [], logs: [], sequence: 0 });

type Base = { at: string; tenantId: string; actor: string };
export type InsightsEvent =
  | (Base & { type: "fact.record"; module: BusinessModule; metric: string; value: number; dimension?: Department })
  | (Base & { type: "correction.propose"; factId: string; newValue: number; reason: string })
  | (Base & { type: "correction.approve"; correctionId: string })
  | (Base & { type: "correction.reject"; correctionId: string })
  | (Base & { type: "report.draft"; input: ReportInput })
  | (Base & { type: "report.update"; reportId: string; input: ReportInput })
  | (Base & { type: "report.approve"; reportId: string })
  | (Base & { type: "report.schedule"; reportId: string; frequency: Frequency })
  | (Base & { type: "report.share"; reportId: string; recipients: readonly string[] })
  | (Base & { type: "report.export"; reportId: string });
export type InsightsResult = { state: InsightsState; error?: string; errorCode?: ErrorCode };

const append = <T,>(items: readonly T[], item: T): readonly T[] => [...items, item];
const replace = <T extends { id: string }>(items: readonly T[], item: T): readonly T[] => items.map((existing) => (existing.id === item.id ? item : existing));
const nextId = (state: InsightsState, prefix: string): { id: string; state: InsightsState } => {
  const sequence = state.sequence + 1;
  return { id: `${prefix}_${String(sequence).padStart(5, "0")}`, state: { ...state, sequence } };
};
const note = (state: InsightsState, event: { at: string; actor: string; tenantId: string }, action: string, detail?: string, level: InsightsLog["level"] = "info"): InsightsState => ({
  ...state,
  audit: append(state.audit, { at: event.at, actor: event.actor, tenantId: event.tenantId, action, detail }),
  logs: append(state.logs, { at: event.at, level, event: detail ? `${action}: ${detail}` : action }),
});
const slug = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "reporte";

export function validateReport(input: ReportInput): string[] {
  const issues: string[] = [];
  if (input.name.trim() === "" || input.name.length > 80) issues.push("nombre (1 a 80 caracteres)");
  if (input.sections.length === 0) issues.push("al menos una sección");
  if (input.sections.some((item) => !VIEWS.includes(item)) || new Set(input.sections).size !== input.sections.length) issues.push("secciones");
  if (!FORMATS.includes(input.format)) issues.push("formato");
  return issues;
}

/** What a fact is worth today: its own value plus every approved correction made to it. */
export const effectiveValue = (state: InsightsState, factId: string): number | undefined => {
  const fact = state.facts.find((item) => item.id === factId);
  return fact ? fact.value + state.facts.filter((item) => item.correctionOf === factId).reduce((sum, item) => sum + item.value, 0) : undefined;
};

export function reduceInsights(state: InsightsState, event: InsightsEvent): InsightsResult {
  const person = isPerson(event.actor);
  const refuse = (code: ErrorCode, params?: Record<string, string | number>): InsightsResult => ({ state, error: message(code, params), errorCode: code });
  const needPerson = (): InsightsResult | null => (person ? null : refuse("personRequired"));
  const needDrafter = (): InsightsResult | null => (person || isWorker(event.actor) ? null : refuse("personRequired"));
  const findReport = (id: string): { report?: Report; failure?: InsightsResult } => {
    const report = state.reports.find((item) => item.id === id);
    if (!report) return { failure: refuse("notFound") };
    if (report.tenantId !== event.tenantId) return { failure: refuse("notYours") };
    return { report };
  };

  switch (event.type) {
    case "fact.record": {
      if (event.actor !== "system") return refuse("systemOnly"); // not a person, not NEX: the platform reports what happened
      const issues = validateFact({ at: event.at, module: event.module, metric: event.metric, value: event.value, dimension: event.dimension });
      if (issues.length) return refuse("invalid", { detail: issues[0] });
      const made = nextId(state, "f");
      const fact: BusinessFact = { id: made.id, tenantId: event.tenantId, at: event.at, module: event.module, metric: event.metric, value: event.value, ...(event.dimension ? { dimension: event.dimension } : {}) };
      return { state: { ...made.state, facts: append(made.state.facts, fact) } }; // facts are the feed: they are not narrated in the audit one by one
    }

    case "correction.propose": {
      const denied = needDrafter();
      if (denied) return denied;
      const fact = state.facts.find((item) => item.id === event.factId);
      if (!fact) return refuse("factNotFound");
      if (fact.tenantId !== event.tenantId) return refuse("notYours");
      if (fact.correctionOf) return refuse("invalid", { detail: "corrija la métrica original, no una corrección" });
      if (!Number.isFinite(event.newValue) || Math.abs(event.newValue) > 1e12 || (metricOf(fact.metric)?.unit !== "money" && !Number.isInteger(event.newValue))) return refuse("invalid", { detail: "el valor nuevo" });
      if (event.reason.trim() === "" || event.reason.length > 200) return refuse("invalid", { detail: "el motivo (1 a 200 caracteres)" });
      const made = nextId(state, "co");
      const correction: Correction = { id: made.id, tenantId: event.tenantId, factId: fact.id, newValue: event.newValue, reason: event.reason.trim(), status: "proposed", proposedBy: event.actor, proposedAt: event.at };
      return { state: note({ ...made.state, corrections: append(made.state.corrections, correction) }, event, "correction.propose", `${made.id} · ${fact.id} → ${event.newValue}`) };
    }

    case "correction.approve":
    case "correction.reject": {
      const denied = needPerson(); // changing a figure is always a person's decision
      if (denied) return denied;
      const correction = state.corrections.find((item) => item.id === event.correctionId);
      if (!correction) return refuse("notFound");
      if (correction.tenantId !== event.tenantId) return refuse("notYours");
      if (correction.status !== "proposed") return refuse("correctionClosed");
      if (event.type === "correction.reject") return { state: note({ ...state, corrections: replace(state.corrections, { ...correction, status: "rejected", decidedBy: event.actor, decidedAt: event.at }) }, event, "correction.reject", correction.id, "warn") };
      const original = state.facts.find((item) => item.id === correction.factId) as BusinessFact;
      const delta = correction.newValue - (effectiveValue(state, original.id) ?? original.value);
      const made = nextId(state, "f");
      // a NEW fact that compensates the difference: the original record is never touched
      const compensating: BusinessFact = { id: made.id, tenantId: original.tenantId, at: event.at, module: original.module, metric: original.metric, value: delta, ...(original.dimension ? { dimension: original.dimension } : {}), correctionOf: original.id };
      return { state: note({ ...made.state, facts: append(made.state.facts, compensating), corrections: replace(made.state.corrections, { ...correction, status: "approved", decidedBy: event.actor, decidedAt: event.at, compensatingFactId: made.id }) }, event, "correction.approve", `${correction.id} · ${original.id} ${delta >= 0 ? "+" : ""}${delta}`, "warn") };
    }

    case "report.draft": {
      const denied = needDrafter();
      if (denied) return denied;
      const issues = validateReport(event.input);
      if (issues.length) return refuse("invalid", { detail: issues[0] });
      const made = nextId(state, "rp");
      const report: Report = { ...event.input, name: event.input.name.trim(), id: made.id, tenantId: event.tenantId, status: "draft", frequency: "none", recipients: [], createdBy: event.actor, createdAt: event.at, updatedAt: event.at };
      return { state: note({ ...made.state, reports: append(made.state.reports, report) }, event, "report.draft", `${made.id} · ${report.name}`) };
    }

    case "report.update": {
      const denied = needDrafter();
      if (denied) return denied;
      const { report, failure } = findReport(event.reportId);
      if (!report) return failure as InsightsResult;
      if (report.status !== "draft") return refuse("invalidState", { from: "aprobado", to: "editado" }); // an approved report is not rewritten: make a new draft
      const issues = validateReport(event.input);
      if (issues.length) return refuse("invalid", { detail: issues[0] });
      return { state: note({ ...state, reports: replace(state.reports, { ...report, ...event.input, name: event.input.name.trim(), updatedAt: event.at }) }, event, "report.update", report.id) };
    }

    case "report.approve": {
      const denied = needPerson();
      if (denied) return denied;
      const { report, failure } = findReport(event.reportId);
      if (!report) return failure as InsightsResult;
      if (report.status !== "draft") return refuse("invalidState", { from: "aprobado", to: "aprobado" });
      return { state: note({ ...state, reports: replace(state.reports, { ...report, status: "approved", approvedBy: event.actor, approvedAt: event.at, updatedAt: event.at }) }, event, "report.approve", report.id) };
    }

    case "report.schedule":
    case "report.share": {
      const denied = needPerson();
      if (denied) return denied;
      const { report, failure } = findReport(event.reportId);
      if (!report) return failure as InsightsResult;
      if (report.status !== "approved") return refuse("notApproved");
      if (event.type === "report.schedule") {
        if (!FREQUENCIES.includes(event.frequency)) return refuse("invalid", { detail: "frecuencia" });
        return { state: note({ ...state, reports: replace(state.reports, { ...report, frequency: event.frequency, updatedAt: event.at }) }, event, "report.schedule", `${report.id} · ${event.frequency}`) }; // a record: no job runs
      }
      const recipients = [...new Set(event.recipients.map((item) => item.trim()).filter(Boolean))];
      if (recipients.length > 10 || recipients.some((item) => item.length > 40 || /[@\s]/.test(item))) return refuse("invalid", { detail: "destinatarios internos (hasta 10, sin correos)" });
      return { state: note({ ...state, reports: replace(state.reports, { ...report, recipients, updatedAt: event.at }) }, event, "report.share", `${report.id} · ${recipients.length} destinatarios`) }; // internal people only; nothing is sent
    }

    case "report.export": {
      const denied = needDrafter();
      if (denied) return denied;
      const { report, failure } = findReport(event.reportId);
      if (!report) return failure as InsightsResult;
      const made = nextId(state, "ex");
      const record: ExportRecord = { id: made.id, tenantId: event.tenantId, reportId: report.id, reportName: report.name, format: report.format, filename: `${slug(report.name)}-${event.at.slice(0, 10)}.${report.format}`, sections: report.sections, at: event.at, by: event.actor, simulated: true };
      return { state: note({ ...made.state, exports: append(made.state.exports, record) }, event, "report.export", `${report.id} · ${record.filename} (simulado)`) };
    }
  }
}

export function applyAllInsights(state: InsightsState, events: readonly InsightsEvent[]): { state: InsightsState; errors: string[] } {
  const errors: string[] = [];
  let current = state;
  for (const event of events) {
    const result = reduceInsights(current, event);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    current = result.state;
  }
  return { state: current, errors };
}

export const factsOf = (state: InsightsState, tenantId: string) => state.facts.filter((item) => item.tenantId === tenantId);
export const reportsOf = (state: InsightsState, tenantId: string) => state.reports.filter((item) => item.tenantId === tenantId);
export const correctionsOf = (state: InsightsState, tenantId: string) => state.corrections.filter((item) => item.tenantId === tenantId);
export const exportsOf = (state: InsightsState, tenantId: string) => state.exports.filter((item) => item.tenantId === tenantId);

// ---------------------------------------------------------------- the future, declared and NOT built
export type FutureCapability = { id: "forecast" | "prediction" | "aiAnalysis" | "benchmark" | "machineLearning" | "recommendations"; label: string; status: "notBuilt"; reads: "ledger"; runsThrough: "KOE"; needs: string };
/** Each of these will be a KOE Worker reading the same ledger (so the figures stay one source of truth). None exists yet. */
export const FUTURE_CAPABILITIES: readonly FutureCapability[] = [
  { id: "forecast", label: "Forecast", status: "notBuilt", reads: "ledger", runsThrough: "KOE", needs: "historial suficiente de hechos y ejecuciones por empresa" },
  { id: "prediction", label: "Predicciones", status: "notBuilt", reads: "ledger", runsThrough: "KOE", needs: "señales por prospecto y cliente, con consentimiento" },
  { id: "aiAnalysis", label: "Análisis IA", status: "notBuilt", reads: "ledger", runsThrough: "KOE", needs: "un Worker de análisis con nivel de datos de la empresa" },
  { id: "benchmark", label: "Benchmark", status: "notBuilt", reads: "ledger", runsThrough: "KOE", needs: "datos agregados y anonimizados entre empresas, con aprobación de cada una" },
  { id: "machineLearning", label: "Machine Learning", status: "notBuilt", reads: "ledger", runsThrough: "KOE", needs: "evals, un registro de modelos propio y revisión de privacidad" },
  { id: "recommendations", label: "Recomendaciones", status: "notBuilt", reads: "ledger", runsThrough: "KOE", needs: "figuras confiables y un Worker que solo proponga (Nivel 1)" },
];
