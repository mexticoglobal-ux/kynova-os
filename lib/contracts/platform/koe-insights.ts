// KOE Insights: the ONE place that turns the KOE ledger into figures. Every number any Insight screen shows is computed here, from
// the ledger (koe-ledger.ts); the screens only format it, and nothing else in the platform keeps a second set of statistics.
// Pure and deterministic. Strictly one company at a time: the first thing every function does is keep only that company's records.
// All money is an estimate in millionths of a dollar; there is no field for a bank, an account or a card.

import { DEPARTMENTS, METRICS, MODULES, PROCESSES, metricOf, type BusinessFact, type BusinessModule, type Department, type ExecutionEvent, type MetricDef, type ProcessId, type Roster } from "./koe-ledger";

export const DEFAULT_HOURLY_RATE_MICROS = 20_000_000; // an ASSUMPTION (US$ 20 per hour of manual work), shown wherever it is used
export const PROCESS_MIN_RUNS = 2; // a process counts as "automated" after this many successful executions in the period
export const MIN_MODEL_USES = 2; // a model needs this many uses before KOE recommends it

export type Period = { from?: string; to?: string };
export type InsightsInput = { tenantId: string; executions: readonly ExecutionEvent[]; facts: readonly BusinessFact[]; roster: Roster; period?: Period; hourlyRateMicros?: number };

// ---------------------------------------------------------------- small, shared helpers (the only arithmetic in the platform's Insights)
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
const average = (values: readonly number[]): number | null => (values.length ? sum(values) / values.length : null);
const round = (value: number, digits = 0) => { const factor = 10 ** digits; return Math.round(value * factor) / factor; };
const ratio = (part: number, whole: number): number | null => (whole > 0 ? part / whole : null);
function group<T>(items: readonly T[], key: (item: T) => string | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) { const k = key(item); if (k === undefined) continue; out.set(k, [...(out.get(k) ?? []), item]); }
  return out;
}
const WEEK = 7 * 86_400_000;

// ---------------------------------------------------------------- result types
export type Point = { label: string; value: number };
export type Ranked = { id: string; name: string; runs: number; costMicros: number };
export type WorkerStat = { workerId: string; name: string; specialty: string; runs: number; costMicros: number; avgCostMicros: number; avgMs: number | null; successRate: number | null; costPerSuccessMicros: number | null };
export type ModelStat = { modelId: string; label: string; runs: number; costMicros: number; avgCostMicros: number; avgMs: number | null; successRate: number | null; fallbacks: number; share: number };
export type SpecialtyStat = { specialty: string; runs: number; costMicros: number };
export type Comparison = { group: string; left: { label: string; costMicros: number; ms: number | null }; right: { label: string; costMicros: number; ms: number | null }; costDeltaMicros: number; msDelta: number | null };
export type ProcessStat = { process: ProcessId; label: string; department: Department; runs: number; hoursSaved: number };
export type ModuleChart = { module: BusinessModule; headline: string; unit: MetricDef["unit"] | "runs"; series: Point[]; total: number; metrics: { id: string; label: string; unit: MetricDef["unit"] | "runs"; total: number }[] };
export type FunnelStage = { id: string; label: string; count: number; fromPrevious: number | null };

export type Insights = {
  tenantId: string; period: { from: string; to: string }; rateMicros: number; empty: boolean;
  executive: {
    roiPercent: number | null; roiMultiple: number | null; hoursSaved: number; automationsRun: number; activeWorkers: number; activeAgents: number; topPrompts: Ranked[];
    customersServed: number; prospectsConverted: number; tasksCompleted: number; aiCostMicros: number; savingsMicros: number; avgResponseMs: number | null;
  };
  analytics: ModuleChart[];
  ai: { byWorker: WorkerStat[]; byModel: ModelStat[]; bySpecialty: SpecialtyStat[]; avgMs: number | null; avgCostMicros: number | null; successRate: number | null; errors: number; fallbacks: number; preferredModels: ModelStat[]; comparisons: Comparison[]; executions: number };
  productivity: { hoursSaved: number; automatedMinutes: number; eliminatedProcesses: number; ranking: ProcessStat[]; byDepartment: { department: Department; manualMinutes: number; automatedMinutes: number }[] };
  financial: {
    roiPercent: number | null; roiMultiple: number | null; aiCostMicros: number; savingsMicros: number; attributedRevenueMicros: number; valueMicros: number; estimatedRevenueMicros: number;
    costByWorker: Ranked[]; costByAgent: Ranked[]; costByAutomation: Ranked[]; costByMonth: Point[]; companyCostMicros: number;
  };
  customers: { newCustomers: number; activeCustomers: number; lostCustomers: number; conversionRate: number | null; retentionRate: number | null; funnel: FunnelStage[]; weekly: { label: string; created: number; lost: number }[] };
  koe: {
    mostEfficientWorker: WorkerStat | null; mostUsedWorker: WorkerStat | null; mostCostlyWorker: WorkerStat | null; fastestWorker: WorkerStat | null;
    topAutomation: Ranked | null; topPrompt: Ranked | null; topAgent: Ranked | null; recommendedModel: { model: ModelStat; reason: string } | null; topSpecialty: SpecialtyStat | null;
    eventsProcessed: { executions: number; facts: number; total: number };
  };
};

// ---------------------------------------------------------------- the engine
export function computeInsights(input: InsightsInput): Insights {
  const { tenantId, roster } = input;
  const rate = input.hourlyRateMicros ?? DEFAULT_HOURLY_RATE_MICROS;
  // one company only: nothing below ever sees another company's record
  const allExec = input.executions.filter((item) => item.tenantId === tenantId);
  const allFacts = input.facts.filter((item) => item.tenantId === tenantId);
  const times = [...allExec.map((item) => item.at), ...allFacts.map((item) => item.at)].map((value) => Date.parse(value)).filter((value) => !Number.isNaN(value));
  const start = input.period?.from ? Date.parse(input.period.from) : times.length ? Math.min(...times) : 0;
  const end = input.period?.to ? Date.parse(input.period.to) : times.length ? Math.max(...times) : 0;
  const within = (at: string) => { const t = Date.parse(at); return t >= start && t <= end; };
  const exec = allExec.filter((item) => within(item.at));
  const facts = allFacts.filter((item) => within(item.at));

  const total = (id: string) => sum(facts.filter((fact) => fact.metric === id).map((fact) => fact.value));
  const last = (id: string) => { const list = facts.filter((fact) => fact.metric === id).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)); return list.length ? list[list.length - 1].value : 0; };
  const valueOf = (def: MetricDef) => (def.agg === "last" ? last(def.id) : total(def.id));

  const decided = exec.filter((item) => item.outcome !== "other");
  const successes = exec.filter((item) => item.outcome === "success");

  // ---- AI figures
  const stat = (items: readonly ExecutionEvent[]) => {
    const ok = items.filter((item) => item.outcome === "success").length;
    const done = items.filter((item) => item.outcome !== "other").length;
    const cost = sum(items.map((item) => item.costMicros));
    const ms = average(items.flatMap((item) => (item.durationMs === undefined ? [] : [item.durationMs])));
    return { runs: items.length, cost, avgCost: items.length ? cost / items.length : 0, ms, successRate: ratio(ok, done), ok };
  };
  const byWorker: WorkerStat[] = [...group(exec, (item) => item.workerId).entries()].map(([workerId, items]) => {
    const s = stat(items);
    return { workerId, name: items[0].workerName, specialty: items[0].specialty, runs: s.runs, costMicros: s.cost, avgCostMicros: round(s.avgCost), avgMs: s.ms === null ? null : round(s.ms), successRate: s.successRate, costPerSuccessMicros: s.ok ? round(s.cost / s.ok) : null };
  }).sort((a, b) => b.runs - a.runs || a.name.localeCompare(b.name));
  const modelled = exec.filter((item) => item.modelId);
  const byModel: ModelStat[] = [...group(modelled, (item) => item.modelId).entries()].map(([modelId, items]) => {
    const s = stat(items);
    return { modelId, label: items[0].modelLabel ?? modelId, runs: s.runs, costMicros: s.cost, avgCostMicros: round(s.avgCost), avgMs: s.ms === null ? null : round(s.ms), successRate: s.successRate, fallbacks: items.filter((item) => item.fallback).length, share: round(items.length / modelled.length, 4) };
  }).sort((a, b) => b.runs - a.runs || a.label.localeCompare(b.label));
  const bySpecialty: SpecialtyStat[] = [...group(exec, (item) => item.specialty).entries()].map(([specialty, items]) => ({ specialty, runs: items.length, costMicros: sum(items.map((item) => item.costMicros)) })).sort((a, b) => b.runs - a.runs || a.specialty.localeCompare(b.specialty));
  const overall = stat(exec);
  const comparisons: Comparison[] = [...group(exec, (item) => item.compareGroup).entries()].filter(([, items]) => items.length === 2).map(([key, [a, b]]) => ({
    group: key, left: { label: a.detail ?? a.id, costMicros: a.costMicros, ms: a.durationMs ?? null }, right: { label: b.detail ?? b.id, costMicros: b.costMicros, ms: b.durationMs ?? null },
    costDeltaMicros: b.costMicros - a.costMicros, msDelta: a.durationMs !== undefined && b.durationMs !== undefined ? b.durationMs - a.durationMs : null,
  }));

  // ---- productivity
  const covered = successes.filter((item) => item.process && item.source !== "studio");
  const minutes = (item: ExecutionEvent) => (item.process ? PROCESSES[item.process].manualMinutes : 0);
  const automatedMinutes = sum(covered.map(minutes));
  const hoursSaved = round(automatedMinutes / 60, 1);
  const ranking: ProcessStat[] = [...group(covered, (item) => item.process).entries()].map(([process, items]) => ({
    process: process as ProcessId, label: PROCESSES[process as ProcessId].label, department: PROCESSES[process as ProcessId].department, runs: items.length, hoursSaved: round(sum(items.map(minutes)) / 60, 1),
  })).sort((a, b) => b.hoursSaved - a.hoursSaved || a.label.localeCompare(b.label));
  const byDepartment = DEPARTMENTS.map((department) => ({
    department,
    manualMinutes: sum(facts.filter((fact) => fact.metric === "manualMinutes" && fact.dimension === department).map((fact) => fact.value)),
    automatedMinutes: sum(covered.filter((item) => item.process && PROCESSES[item.process].department === department).map(minutes)),
  }));

  // ---- finance
  const aiCost = sum(exec.map((item) => item.costMicros));
  const savings = Math.round(automatedMinutes / 60 * rate);
  const attributed = total("attributedRevenue");
  const value = savings + attributed;
  const roi = aiCost > 0 ? Math.round(((value - aiCost) / aiCost) * 100) : null;
  const multiple = aiCost > 0 ? round(value / aiCost, 1) : null; // how many times the estimated AI cost came back as value
  const rankBy = (key: (item: ExecutionEvent) => { id: string; name: string } | undefined): Ranked[] => {
    const map = new Map<string, Ranked>();
    for (const item of exec) {
      const k = key(item);
      if (!k) continue;
      const current = map.get(k.id) ?? { id: k.id, name: k.name, runs: 0, costMicros: 0 };
      map.set(k.id, { ...current, runs: current.runs + 1, costMicros: current.costMicros + item.costMicros });
    }
    return [...map.values()].sort((a, b) => b.costMicros - a.costMicros || b.runs - a.runs || a.name.localeCompare(b.name));
  };
  const byRuns = (list: Ranked[]) => [...list].sort((a, b) => b.runs - a.runs || b.costMicros - a.costMicros || a.name.localeCompare(b.name));
  const costByWorker = rankBy((item) => ({ id: item.workerId, name: item.workerName }));
  const costByAgent = rankBy((item) => (item.agentId ? { id: item.agentId, name: item.agentName ?? item.agentId } : undefined));
  const costByAutomation = rankBy((item) => (item.automationId ? { id: item.automationId, name: item.automationName ?? item.automationId } : undefined));
  const prompts = rankBy((item) => (item.promptId ? { id: item.promptId, name: item.promptName ?? item.promptId } : undefined));
  const costByMonth: Point[] = [...group(exec, (item) => item.at.slice(0, 7)).entries()].map(([label, items]) => ({ label, value: sum(items.map((item) => item.costMicros)) })).sort((a, b) => a.label.localeCompare(b.label));

  // ---- analytics: one chart per module, by week
  const weeks = Math.max(1, Math.min(20, Math.ceil((end - start + 1) / WEEK)));
  const bucket = (at: string) => Math.min(weeks - 1, Math.max(0, Math.floor((Date.parse(at) - start) / WEEK)));
  const labelOf = (index: number) => new Date(start + index * WEEK).toISOString().slice(5, 10);
  const series = (items: readonly { at: string; value: number }[]): Point[] => Array.from({ length: weeks }, (_, index) => ({ label: labelOf(index), value: sum(items.filter((item) => bucket(item.at) === index).map((item) => item.value)) }));
  const analytics: ModuleChart[] = MODULES.map((module) => {
    if (module === "automations" || module === "workers") {
      const mine = module === "automations" ? exec.filter((item) => item.source === "automation") : exec;
      const s = stat(mine);
      return { module, headline: "Ejecuciones", unit: "runs" as const, series: series(mine.map((item) => ({ at: item.at, value: 1 }))), total: mine.length, metrics: [
        { id: "runs", label: "Ejecuciones", unit: "runs" as const, total: mine.length }, { id: "cost", label: "Costo estimado", unit: "money" as const, total: s.cost }, { id: "success", label: "Éxitos", unit: "runs" as const, total: s.ok },
      ] };
    }
    const defs = METRICS.filter((item) => item.module === module);
    const head = defs[0];
    return { module, headline: head.label, unit: head.unit, series: series(facts.filter((fact) => fact.metric === head.id).map((fact) => ({ at: fact.at, value: fact.value }))), total: valueOf(head), metrics: defs.map((def) => ({ id: def.id, label: def.label, unit: def.unit, total: valueOf(def) })) };
  });

  // ---- customers
  const leadsNew = total("leadsNew");
  const converted = total("leadsConverted");
  const funnelIds: [string, string][] = [["leadsNew", "Prospectos"], ["leadsQualified", "Calificados"], ["proposalsSent", "Propuestas"], ["leadsConverted", "Convertidos"]];
  const funnel: FunnelStage[] = funnelIds.map(([id, label], index) => ({ id, label, count: total(id), fromPrevious: index === 0 ? null : ratio(total(id), total(funnelIds[index - 1][0])) }));
  const active = last("customersActive");
  const lost = total("customersLost");
  const weekly = Array.from({ length: weeks }, (_, index) => ({
    label: labelOf(index),
    created: sum(facts.filter((fact) => fact.metric === "customersNew" && bucket(fact.at) === index).map((fact) => fact.value)),
    lost: sum(facts.filter((fact) => fact.metric === "customersLost" && bucket(fact.at) === index).map((fact) => fact.value)),
  }));

  // ---- KOE intelligence
  const best = <T,>(list: readonly T[], better: (a: T, b: T) => number): T | null => (list.length ? [...list].sort(better)[0] : null);
  const candidates = byModel.filter((item) => item.runs >= MIN_MODEL_USES);
  const recommended = best(candidates, (a, b) => (b.successRate ?? 0) - (a.successRate ?? 0) || a.avgCostMicros - b.avgCostMicros || (a.avgMs ?? Infinity) - (b.avgMs ?? Infinity) || a.modelId.localeCompare(b.modelId));
  const timed = byWorker.filter((item) => item.avgMs !== null);
  const topOf = (list: Ranked[]) => byRuns(list)[0] ?? null;

  return {
    tenantId, period: { from: new Date(start).toISOString(), to: new Date(end).toISOString() }, rateMicros: rate, empty: exec.length === 0 && facts.length === 0,
    executive: {
      roiPercent: roi, roiMultiple: multiple, hoursSaved, automationsRun: exec.filter((item) => item.source === "automation").length,
      activeWorkers: roster.workers.filter((item) => item.status === "active").length, activeAgents: roster.agents.filter((item) => item.active).length,
      topPrompts: byRuns(prompts).slice(0, 3), customersServed: total("customersServed"), prospectsConverted: converted, tasksCompleted: total("tasksCompleted"),
      aiCostMicros: aiCost, savingsMicros: savings, avgResponseMs: overall.ms === null ? null : round(overall.ms),
    },
    analytics,
    ai: { byWorker, byModel, bySpecialty, avgMs: overall.ms === null ? null : round(overall.ms), avgCostMicros: exec.length ? round(overall.avgCost) : null, successRate: ratio(successes.length, decided.length), errors: exec.filter((item) => item.outcome === "error").length, fallbacks: exec.filter((item) => item.fallback).length, preferredModels: byModel.slice(0, 3), comparisons, executions: exec.length },
    productivity: { hoursSaved, automatedMinutes, eliminatedProcesses: ranking.filter((item) => item.runs >= PROCESS_MIN_RUNS).length, ranking, byDepartment },
    financial: {
      roiPercent: roi, roiMultiple: multiple, aiCostMicros: aiCost, savingsMicros: savings, attributedRevenueMicros: attributed, valueMicros: value, estimatedRevenueMicros: total("paymentsValue"),
      costByWorker, costByAgent, costByAutomation, costByMonth, companyCostMicros: aiCost,
    },
    customers: { newCustomers: total("customersNew"), activeCustomers: active, lostCustomers: lost, conversionRate: ratio(converted, leadsNew), retentionRate: ratio(active, active + lost), funnel, weekly },
    koe: {
      mostEfficientWorker: best(byWorker.filter((item) => item.costPerSuccessMicros !== null), (a, b) => (a.costPerSuccessMicros ?? 0) - (b.costPerSuccessMicros ?? 0) || b.runs - a.runs || a.name.localeCompare(b.name)),
      mostUsedWorker: best(byWorker, (a, b) => b.runs - a.runs || a.name.localeCompare(b.name)),
      mostCostlyWorker: best(byWorker, (a, b) => b.costMicros - a.costMicros || a.name.localeCompare(b.name)),
      fastestWorker: best(timed, (a, b) => (a.avgMs ?? 0) - (b.avgMs ?? 0) || a.name.localeCompare(b.name)),
      topAutomation: topOf(costByAutomation), topPrompt: topOf(prompts), topAgent: topOf(costByAgent),
      recommendedModel: recommended ? { model: recommended, reason: `mayor tasa de éxito, menor costo y menor tiempo entre los modelos con al menos ${MIN_MODEL_USES} usos` } : null,
      topSpecialty: bySpecialty[0] ?? null, eventsProcessed: { executions: exec.length, facts: facts.length, total: exec.length + facts.length },
    },
  };
}

export { metricOf };

export type PeriodPreset = "all" | "7d" | "14d";
/** A relative period ending at the latest record the company has. The screens ask for a preset; they never do date arithmetic. */
export function presetPeriod(preset: PeriodPreset, tenantId: string, executions: readonly ExecutionEvent[], facts: readonly BusinessFact[]): Period {
  if (preset === "all") return {};
  const times = [...executions.filter((item) => item.tenantId === tenantId).map((item) => item.at), ...facts.filter((item) => item.tenantId === tenantId).map((item) => item.at)].map((value) => Date.parse(value)).filter((value) => !Number.isNaN(value));
  if (times.length === 0) return {};
  const to = Math.max(...times);
  const days = preset === "7d" ? 7 : 14;
  return { from: new Date(to - days * 86_400_000).toISOString(), to: new Date(to).toISOString() };
}
