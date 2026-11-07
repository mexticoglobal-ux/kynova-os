import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FUTURE_CAPABILITIES, VIEWS, applyAllInsights, correctionsOf, effectiveValue, exportsOf, factsOf, newInsightsState, reduceInsights, reportsOf, validateReport, type InsightsEvent, type InsightsState,
} from "./insights-center";
import { DEMO_PERSONAS, demoInsightsSource, simulateExecutions, simulateFacts } from "./insights-demo";
import { ERROR_CODES, label, message } from "./insights-messages";
import { PROCESS_MIN_RUNS, computeInsights, type InsightsInput } from "./koe-insights";
import { DEPARTMENTS, METRICS, MODULES, PROCESSES, executionsFromAutomations, executionsFromKoe, executionsFromStudio, metricOf, validateFact, workersOf, type BusinessFact, type ExecutionEvent, type Roster } from "./koe-ledger";
import { koeMetrics } from "./koe-engine";
import { ACTION_LEVELS } from "./workers";

const ANA = { tenantId: "tenant-nova", actor: "ana" };
const PABLO = { tenantId: "tenant-nova", actor: "pablo" };
const NEX = { tenantId: "tenant-nova", actor: "worker:nex" };
const SYSTEM = { tenantId: "tenant-nova", actor: "system" };
const LUCIA = { tenantId: "tenant-vida", actor: "lucia" };
const at = (day: number, hour = 10) => `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const ROSTER: Roster = { workers: [{ id: "sales", name: "Ventas", specialty: "sales", status: "active" }, { id: "x", name: "Otro", specialty: "custom", status: "paused" }], agents: [{ id: "ag", name: "Agente", active: true }, { id: "ag2", name: "Inactivo", active: false }] };

const source = demoInsightsSource();
const novaInput = (over: Partial<InsightsInput> = {}): InsightsInput => ({ tenantId: "tenant-nova", executions: source.executions, facts: source.state.facts, roster: source.rosters["tenant-nova"], ...over });

let counter = 0;
const ex = (over: Partial<ExecutionEvent> = {}): ExecutionEvent => { counter += 1; return { id: `e${counter}`, tenantId: "tenant-nova", at: at(1), source: "koe", workerId: "sales", workerName: "Ventas", specialty: "sales", modelId: "m1", modelLabel: "Modelo 1", fallback: false, outcome: "success", costMicros: 1_000, ...over }; };
const fact = (metric: string, value: number, day = 1, over: Partial<BusinessFact> = {}): BusinessFact => {
  counter += 1;
  const def = metricOf(metric);
  return { id: `f${counter}`, tenantId: "tenant-nova", at: at(day), module: def?.module ?? "sales", metric, value, ...over };
};
const input = (executions: ExecutionEvent[], facts: BusinessFact[] = [], over: Partial<InsightsInput> = {}): InsightsInput => ({ tenantId: "tenant-nova", executions, facts, roster: ROSTER, ...over });
const step = (state: InsightsState, event: InsightsEvent) => reduceInsights(state, event);
const must = (state: InsightsState, event: InsightsEvent): InsightsState => { const result = reduceInsights(state, event); expect(result.error, event.type).toBeUndefined(); return result.state; };

describe("the sample loads and every figure comes from the KOE ledger", () => {
  it("loads without a refusal, from the other modules' own records plus simulated events", () => {
    expect(source.errors).toEqual([]);
    expect(source.executions.length).toBeGreaterThan(1_000);
    expect(source.state.facts.length).toBeGreaterThan(1_000);
    expect(new Set(source.executions.map((item) => item.source))).toEqual(new Set(["koe", "automation", "studio", "simulated"]));
    expect(new Set(source.executions.map((item) => item.id)).size).toBe(source.executions.length); // every entry is its own
    expect(DEMO_PERSONAS).toHaveLength(4);
  });

  it("reads KOE's own run records, so the totals agree with koeMetrics and nothing is counted twice", () => {
    const koeOnly = executionsFromKoe(source.koe).filter((item) => item.tenantId === "tenant-nova");
    const metrics = koeMetrics(source.koe, "tenant-nova");
    const insights = computeInsights({ tenantId: "tenant-nova", executions: koeOnly, facts: [], roster: source.rosters["tenant-nova"] });
    expect(insights.ai.executions).toBe(metrics.runs);
    expect(insights.financial.aiCostMicros).toBe(metrics.estimatedCostMicros);
    for (const row of metrics.byWorker) expect(insights.financial.costByWorker.find((item) => item.id === row.workerId)?.costMicros, row.workerId).toBe(row.estimatedCostMicros);
    expect(koeOnly.reduce((sum, item) => sum + (item.tokens ?? 0), 0)).toBe(metrics.tokens);
  });

  it("reads live automation runs and Studio tests from their own records", () => {
    const workers = workersOf(source.koe);
    const automationRuns = executionsFromAutomations(source.automations, workers);
    expect(automationRuns).toHaveLength(source.automations.runs.filter((run) => run.mode === "live" && (run.status === "completed" || run.status === "failed")).length);
    expect(automationRuns.every((item) => item.source === "automation" && item.automationName)).toBe(true);
    const tests = executionsFromStudio(source.studio, workers);
    expect(tests).toHaveLength(source.studio.tests.length);
    expect(tests.every((item) => item.process === undefined)).toBe(true); // a test replaced no manual process
    expect(tests.filter((item) => item.compareGroup)).toHaveLength(2);
  });

  it("has one statistics engine: the figures are computed only in koe-insights.ts", () => {
    const dir = __dirname;
    const owners = readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).filter((name) => /roiPercent|successRate|hoursSaved|costPerSuccess/.test(readFileSync(join(dir, name), "utf8")));
    expect(owners).toEqual(["koe-insights.ts"]);
    const screens = readdirSync(join(dir, "../../../app/(app)/platform/_components")).filter((name) => /^Insights.*\.tsx$/.test(name) && !name.endsWith(".test.tsx"));
    expect(screens.length).toBeGreaterThanOrEqual(3);
    for (const name of screens) {
      const text = readFileSync(join(dir, "../../../app/(app)/platform/_components", name), "utf8");
      expect(text, name).not.toMatch(/\.reduce\(|Math\.round|\.filter\(.*\.outcome/); // screens format; they never count
    }
  });

  it("never reaches a model, a provider or the network from the Insights modules", () => {
    const files = readdirSync(__dirname).filter((name) => /^(insights-|koe-ledger|koe-insights)/.test(name) && !name.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const name of files) {
      const code = readFileSync(join(__dirname, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(code, name).not.toMatch(/lib\/ai|fetch\(|XMLHttpRequest|process\.env|import\(|openai|anthropic|gemini|mistral/i);
    }
  });
});

describe("the figures, computed from a known ledger", () => {
  const ledger = [
    ex({ workerId: "sales", workerName: "Ventas", process: "lead-reply", costMicros: 1_000, durationMs: 500, modelId: "m1", modelLabel: "Modelo 1" }),
    ex({ workerId: "sales", workerName: "Ventas", process: "lead-reply", costMicros: 1_000, durationMs: 700, modelId: "m1", modelLabel: "Modelo 1" }),
    ex({ workerId: "sales", workerName: "Ventas", outcome: "error", costMicros: 1_000, durationMs: 600, modelId: "m1", modelLabel: "Modelo 1" }),
    ex({ workerId: "rep", workerName: "Reportes", specialty: "analysis", process: "report", costMicros: 3_000, durationMs: 2_000, modelId: "m2", modelLabel: "Modelo 2", fallback: true }),
    ex({ workerId: "rep", workerName: "Reportes", specialty: "analysis", process: "report", costMicros: 3_000, durationMs: 2_200, modelId: "m2", modelLabel: "Modelo 2" }),
    ex({ workerId: "rep", workerName: "Reportes", specialty: "analysis", outcome: "other", costMicros: 3_000, modelId: "m2", modelLabel: "Modelo 2" }),
    ex({ source: "automation", workerId: "auto", workerName: "Automatizador", specialty: "automation", process: "client-onboarding", costMicros: 500, automationId: "au1", automationName: "Bienvenida", modelId: "m1", modelLabel: "Modelo 1" }),
    ex({ source: "studio", workerId: "sales", workerName: "Ventas", costMicros: 900, durationMs: 400, promptId: "p1", promptName: "Prompt uno", modelId: "m1", modelLabel: "Modelo 1", compareGroup: "cg1", detail: "Prompt uno v1" }),
    ex({ source: "studio", workerId: "sales", workerName: "Ventas", costMicros: 1_100, durationMs: 450, promptId: "p1", promptName: "Prompt uno", modelId: "m1", modelLabel: "Modelo 1", compareGroup: "cg1", detail: "Prompt uno v2" }),
    ex({ source: "studio", workerId: "sales", workerName: "Ventas", costMicros: 900, durationMs: 400, agentId: "a1", agentName: "Agente uno", modelId: "m1", modelLabel: "Modelo 1" }),
  ];
  const facts = [
    fact("leadsNew", 100, 1), fact("leadsQualified", 50, 2), fact("proposalsSent", 20, 3), fact("leadsConverted", 5, 4), fact("attributedRevenue", 2_000_000, 4),
    fact("customersActive", 40, 1), fact("customersActive", 44, 20), fact("customersNew", 6, 5), fact("customersLost", 4, 8), fact("customersServed", 30, 2), fact("tasksCompleted", 17, 3),
    fact("manualMinutes", 120, 2, { dimension: "sales" }), fact("manualMinutes", 60, 3, { dimension: "support" }), fact("paymentsValue", 9_000_000, 5), fact("keywordsTop10", 10, 1), fact("keywordsTop10", 13, 25),
  ];
  const result = computeInsights(input(ledger, facts));

  it("counts executions, successes and errors; an unfinished run is neither", () => {
    expect(result.ai.executions).toBe(10);
    expect(result.ai.errors).toBe(1);
    expect(result.ai.successRate).toBeCloseTo(8 / 9, 5); // 8 successes of 9 decided (the unfinished one is left out)
    expect(result.ai.fallbacks).toBe(1);
    expect(result.executive.automationsRun).toBe(1);
  });

  it("works out hours saved from the processes replaced, never from tests or errors", () => {
    // 2 lead replies (12 min) + 2 reports (45) + 1 onboarding (10) = 124 minutes
    expect(result.productivity.automatedMinutes).toBe(124);
    expect(result.productivity.hoursSaved).toBe(2.1);
    expect(result.productivity.ranking.map((item) => [item.process, item.runs, item.hoursSaved])).toEqual([["report", 2, 1.5], ["lead-reply", 2, 0.4], ["client-onboarding", 1, 0.2]]);
    expect(result.productivity.eliminatedProcesses).toBe(2); // the two processes with at least PROCESS_MIN_RUNS runs
    expect(PROCESS_MIN_RUNS).toBe(2);
    expect(result.productivity.byDepartment.find((item) => item.department === "sales")).toMatchObject({ manualMinutes: 120, automatedMinutes: 24 });
    expect(result.productivity.byDepartment.find((item) => item.department === "operations")?.automatedMinutes).toBe(90);
    expect(DEPARTMENTS.every((department) => result.productivity.byDepartment.some((item) => item.department === department))).toBe(true);
  });

  it("works out cost, savings, value and ROI with the stated assumption", () => {
    const cost = ledger.reduce((sum, item) => sum + item.costMicros, 0);
    expect(result.financial.aiCostMicros).toBe(cost);
    expect(result.financial.savingsMicros).toBe(Math.round((124 / 60) * 20_000_000));
    expect(result.financial.valueMicros).toBe(result.financial.savingsMicros + 2_000_000);
    expect(result.financial.roiPercent).toBe(Math.round(((result.financial.valueMicros - cost) / cost) * 100));
    expect(result.financial.roiMultiple).toBeCloseTo(result.financial.valueMicros / cost, 0);
    expect(result.financial.estimatedRevenueMicros).toBe(9_000_000);
    expect(Math.abs(computeInsights(input(ledger, facts, { hourlyRateMicros: 40_000_000 })).financial.savingsMicros - result.financial.savingsMicros * 2)).toBeLessThanOrEqual(1); // double the rate, double the savings (to the rounding)
    expect(result.rateMicros).toBe(20_000_000);
  });

  it("splits cost by Worker, agent, automation and month, and prompts by use", () => {
    expect(result.financial.costByWorker.map((item) => [item.id, item.costMicros])).toEqual([["rep", 9_000], ["sales", 5_900], ["auto", 500]]);
    expect(result.financial.costByAgent).toEqual([{ id: "a1", name: "Agente uno", runs: 1, costMicros: 900 }]);
    expect(result.financial.costByAutomation[0]).toMatchObject({ id: "au1", runs: 1, costMicros: 500 });
    expect(result.financial.costByMonth).toEqual([{ label: "2026-10", value: 15_400 }]);
    expect(result.executive.topPrompts).toEqual([{ id: "p1", name: "Prompt uno", runs: 2, costMicros: 2_000 }]);
    expect(result.financial.companyCostMicros).toBe(15_400);
  });

  it("analyses AI by Worker, model and specialty, and compares what Studio compared", () => {
    expect(result.ai.byModel.map((item) => [item.modelId, item.runs, item.fallbacks])).toEqual([["m1", 7, 0], ["m2", 3, 1]]);
    expect(result.ai.byModel[0].share).toBeCloseTo(0.7, 3);
    expect(result.ai.preferredModels[0].modelId).toBe("m1");
    expect(result.ai.bySpecialty.map((item) => item.specialty)).toEqual(["sales", "analysis", "automation"]);
    expect(result.ai.comparisons).toEqual([{ group: "cg1", left: { label: "Prompt uno v1", costMicros: 900, ms: 400 }, right: { label: "Prompt uno v2", costMicros: 1_100, ms: 450 }, costDeltaMicros: 200, msDelta: 50 }]);
    expect(result.ai.avgMs).toBe(Math.round((500 + 700 + 600 + 2000 + 2200 + 400 + 450 + 400) / 8)); // only runs with a recorded duration
  });

  it("answers the KOE questions: most efficient, used, costly, fast, recommended model", () => {
    expect(result.koe.mostUsedWorker?.workerId).toBe("sales");
    expect(result.koe.mostCostlyWorker?.workerId).toBe("rep");
    expect(result.koe.mostEfficientWorker?.workerId).toBe("auto"); // 500 per success is the lowest
    expect(result.koe.fastestWorker?.workerId).toBe("sales");
    expect(result.koe.topAutomation?.name).toBe("Bienvenida");
    expect(result.koe.topPrompt?.name).toBe("Prompt uno");
    expect(result.koe.topAgent?.name).toBe("Agente uno");
    expect(result.koe.topSpecialty?.specialty).toBe("sales");
    expect(result.koe.recommendedModel?.model.modelId).toBe("m2"); // the best success rate among decided runs (2 of 2), then cost, then speed
    expect(result.koe.recommendedModel?.reason).toContain("al menos 2 usos");
    expect(result.koe.eventsProcessed).toEqual({ executions: 10, facts: 16, total: 26 });
  });

  it("reads customers and the funnel: new, active (the latest snapshot), lost, conversion, retention", () => {
    expect(result.customers).toMatchObject({ newCustomers: 6, activeCustomers: 44, lostCustomers: 4 });
    expect(result.customers.conversionRate).toBeCloseTo(0.05, 5);
    expect(result.customers.retentionRate).toBeCloseTo(44 / 48, 5);
    expect(result.customers.funnel.map((item) => [item.id, item.count])).toEqual([["leadsNew", 100], ["leadsQualified", 50], ["proposalsSent", 20], ["leadsConverted", 5]]);
    expect(result.customers.funnel[1].fromPrevious).toBeCloseTo(0.5, 5);
    expect(result.executive).toMatchObject({ customersServed: 30, prospectsConverted: 5, tasksCompleted: 17, activeWorkers: 1, activeAgents: 1 });
  });

  it("charts every module by week, using a snapshot's latest value and a sum otherwise", () => {
    expect(result.analytics.map((item) => item.module)).toEqual([...MODULES]);
    const seo = result.analytics.find((item) => item.module === "seo");
    expect(seo?.metrics.find((item) => item.id === "keywordsTop10")?.total).toBe(13); // a snapshot: the latest, not the sum
    const sales = result.analytics.find((item) => item.module === "sales");
    expect(sales?.total).toBe(100);
    expect(sales?.series.reduce((sum, item) => sum + item.value, 0)).toBe(100);
    expect(result.analytics.find((item) => item.module === "workers")?.total).toBe(10);
    expect(result.analytics.find((item) => item.module === "automations")?.total).toBe(1);
    expect(result.analytics.every((item) => item.series.length >= 1 && item.series.length <= 20)).toBe(true);
  });

  it("limits everything to a period, and returns honest nulls (not zero-divisions) when there is nothing", () => {
    const week = computeInsights(input(ledger, facts, { period: { from: at(1, 0), to: at(1, 23) } }));
    expect(week.ai.executions).toBe(10);
    expect(computeInsights(input(ledger, facts, { period: { from: at(2, 0), to: at(3, 23) } })).ai.executions).toBe(0);
    const empty = computeInsights(input([], []));
    expect(empty.empty).toBe(true);
    expect(empty.executive.roiPercent).toBeNull();
    expect(empty.ai).toMatchObject({ avgMs: null, avgCostMicros: null, successRate: null, executions: 0 });
    expect(empty.customers).toMatchObject({ conversionRate: null, retentionRate: null });
    expect(empty.koe.recommendedModel).toBeNull();
    expect(empty.koe.mostEfficientWorker).toBeNull();
    expect(empty.analytics).toHaveLength(MODULES.length);
  });
});

describe("one company never sees or mixes another's figures", () => {
  it("is unchanged by any amount of another company's records", () => {
    const own = computeInsights(novaInput());
    const noise = [...simulateExecutions("tenant-other", 3, 99), ...source.executions.filter((item) => item.tenantId === "tenant-vida")];
    const noiseFacts = [...source.state.facts.filter((item) => item.tenantId === "tenant-vida"), ...simulateFacts("tenant-other", 2, 5).map((event, index) => ({ id: `n${index}`, tenantId: "tenant-other", at: event.at, module: (event as { module: BusinessFact["module"] }).module, metric: (event as { metric: string }).metric, value: (event as { value: number }).value }))];
    const withNoise = computeInsights(novaInput({ executions: [...source.executions.filter((item) => item.tenantId === "tenant-nova"), ...noise], facts: [...source.state.facts.filter((item) => item.tenantId === "tenant-nova"), ...noiseFacts] }));
    expect(withNoise).toEqual(own);
  });

  it("gives each company its own figures, and nothing for an unknown one", () => {
    const nova = computeInsights(novaInput());
    const vida = computeInsights(novaInput({ tenantId: "tenant-vida", roster: source.rosters["tenant-vida"] }));
    expect(vida.tenantId).toBe("tenant-vida");
    expect(vida.ai.executions).toBe(source.executions.filter((item) => item.tenantId === "tenant-vida").length);
    expect(nova.ai.executions + vida.ai.executions).toBe(source.executions.length);
    expect(vida.executive.topPrompts).toEqual([]); // Nova's prompts are not Vida's
    expect(JSON.stringify(vida)).not.toMatch(/Respuesta a prospecto/);
    expect(computeInsights(novaInput({ tenantId: "tenant-nadie", roster: { workers: [], agents: [] } })).empty).toBe(true);
  });

  it("has no field that could hold a bank, account or card detail", () => {
    const keys = (value: unknown, found: string[] = []): string[] => { if (value && typeof value === "object") for (const [key, inner] of Object.entries(value)) { found.push(key); keys(inner, found); } return found; };
    const all = keys(computeInsights(novaInput()));
    expect(all.filter((key) => /bank|card|account|iban|swift|tarjeta|cuenta|banco/i.test(key))).toEqual([]);
    expect(METRICS.filter((item) => item.unit === "money").map((item) => item.id).sort()).toEqual(["attributedRevenue", "marketplaceRevenue", "paymentsValue"]);
    expect(Object.keys(source.state.facts[0]).sort()).toEqual(["at", "id", "metric", "module", "tenantId", "value"].concat(Object.keys(source.state.facts[0]).includes("dimension") ? ["dimension"] : []).sort());
  });
});

describe("facts are validated, and only the platform reports them", () => {
  it("refuses unknown metrics, the wrong module, bad numbers, dates and departments", () => {
    const ok = { at: at(1), module: "sales" as const, metric: "leadsNew", value: 3 };
    expect(validateFact(ok)).toEqual([]);
    expect(validateFact({ ...ok, metric: "saldoBancario" })[0]).toContain("desconocida");
    expect(validateFact({ ...ok, module: "seo" })[0]).toContain("pertenece a sales");
    expect(validateFact({ ...ok, value: Number.NaN })).toContain("valor");
    expect(validateFact({ ...ok, value: 2.5 })).toContain("el valor debe ser entero");
    expect(validateFact({ ...ok, value: 1e13 })).toContain("valor");
    expect(validateFact({ ...ok, at: "ayer" })).toContain("fecha");
    expect(validateFact({ ...ok, dimension: "legal" as never })).toContain("departamento");
    expect(validateFact({ at: at(1), module: "sales", metric: "attributedRevenue", value: 1_234_567 })).toEqual([]); // money may be any amount
    expect(PROCESSES["lead-reply"].manualMinutes).toBeGreaterThan(0);
  });

  it("accepts facts from the platform only: not a person, not NEX", () => {
    const record = { type: "fact.record" as const, module: "sales" as const, metric: "leadsNew", value: 2, at: at(1) };
    expect(must(newInsightsState(), { ...SYSTEM, ...record }).facts).toHaveLength(1);
    expect(step(newInsightsState(), { ...ANA, ...record }).errorCode).toBe("systemOnly");
    expect(step(newInsightsState(), { ...NEX, ...record }).errorCode).toBe("systemOnly");
    expect(step(newInsightsState(), { ...SYSTEM, ...record, metric: "nope" }).errorCode).toBe("invalid");
    expect(factsOf(must(newInsightsState(), { ...SYSTEM, ...record }), "tenant-vida")).toEqual([]);
  });
});

describe("Constitution: NEX prepares, a person approves; history is never altered", () => {
  const withFact = () => must(newInsightsState(), { ...SYSTEM, type: "fact.record", module: "crm", metric: "tasksCompleted", value: 10, at: at(3) });

  it("has no event that edits or deletes a fact, an execution, a log or the history", () => {
    const events = readFileSync(join(__dirname, "insights-center.ts"), "utf8").match(/type: "([a-z.]+)"/g)?.map((item) => item.slice(7, -1)) ?? [];
    expect(new Set(events)).toEqual(new Set(["fact.record", "correction.propose", "correction.approve", "correction.reject", "report.draft", "report.update", "report.approve", "report.schedule", "report.share", "report.export"]));
    expect(events.some((item) => /delete|remove|edit|overwrite|reset|clear/.test(item))).toBe(false);
  });

  it("lets NEX draft a report, edit its drafts, make a simulated export and propose a correction", () => {
    const state = withFact();
    const drafted = must(state, { ...NEX, at: at(4), type: "report.draft", input: { name: "Informe de IA", sections: ["ai", "koe"], format: "xlsx" } });
    expect(drafted.reports[0]).toMatchObject({ status: "draft", createdBy: "worker:nex", frequency: "none", recipients: [] });
    expect(must(drafted, { ...NEX, at: at(4), type: "report.update", reportId: drafted.reports[0].id, input: { name: "Informe de IA v2", sections: ["ai"], format: "xlsx" } }).reports[0].name).toBe("Informe de IA v2");
    expect(must(drafted, { ...NEX, at: at(4), type: "report.export", reportId: drafted.reports[0].id }).exports[0]).toMatchObject({ simulated: true, format: "xlsx", filename: "informe-de-ia-2026-10-04.xlsx", by: "worker:nex" });
    expect(must(state, { ...NEX, at: at(4), type: "correction.propose", factId: state.facts[0].id, newValue: 12, reason: "Faltaron dos tareas" }).corrections[0]).toMatchObject({ status: "proposed", proposedBy: "worker:nex" });
  });

  it("refuses NEX everything that decides: approving, scheduling, sharing, resolving a correction", () => {
    let state = withFact();
    state = must(state, { ...ANA, at: at(4), type: "report.draft", input: { name: "Mensual", sections: ["executive"], format: "pdf" } });
    state = must(state, { ...ANA, at: at(4), type: "correction.propose", factId: state.facts[0].id, newValue: 11, reason: "Ajuste" });
    const reportId = state.reports[0].id;
    const events: InsightsEvent[] = [
      { ...NEX, at: at(5), type: "report.approve", reportId },
      { ...NEX, at: at(5), type: "report.schedule", reportId, frequency: "weekly" },
      { ...NEX, at: at(5), type: "report.share", reportId, recipients: ["ana"] },
      { ...NEX, at: at(5), type: "correction.approve", correctionId: state.corrections[0].id },
      { ...NEX, at: at(5), type: "correction.reject", correctionId: state.corrections[0].id },
    ];
    for (const event of events) expect(step(state, event).errorCode, event.type).toBe("personRequired");
    expect(step(state, { ...SYSTEM, at: at(5), type: "report.draft", input: { name: "x", sections: ["ai"], format: "pdf" } }).errorCode).toBe("personRequired"); // the platform does not author reports
  });

  it("corrects a figure only with a person's approval, as a new compensating fact: the original is never touched", () => {
    const state = withFact();
    const original = JSON.stringify(state.facts[0]);
    const proposed = must(state, { ...NEX, at: at(4), type: "correction.propose", factId: state.facts[0].id, newValue: 13, reason: "Tres tareas sin registrar" });
    expect(proposed.facts).toHaveLength(1); // proposing changes no figure
    expect(effectiveValue(proposed, state.facts[0].id)).toBe(10);
    const approved = must(proposed, { ...PABLO, at: at(5), type: "correction.approve", correctionId: proposed.corrections[0].id });
    expect(approved.facts).toHaveLength(2);
    expect(JSON.stringify(approved.facts[0])).toBe(original);
    expect(approved.facts[1]).toMatchObject({ value: 3, correctionOf: state.facts[0].id, metric: "tasksCompleted" });
    expect(effectiveValue(approved, state.facts[0].id)).toBe(13);
    expect(approved.corrections[0]).toMatchObject({ status: "approved", decidedBy: "pablo", compensatingFactId: approved.facts[1].id });
    expect(approved.audit.at(-1)).toMatchObject({ action: "correction.approve", actor: "pablo" });
    expect(step(approved, { ...PABLO, at: at(6), type: "correction.approve", correctionId: proposed.corrections[0].id }).errorCode).toBe("correctionClosed");
    // and the Insights figure follows, while the history of what was reported stays
    expect(computeInsights({ tenantId: "tenant-nova", executions: [], facts: approved.facts, roster: ROSTER }).executive.tasksCompleted).toBe(13);
    // a second correction is measured against what the figure is worth now
    const again = must(must(approved, { ...ANA, at: at(6), type: "correction.propose", factId: state.facts[0].id, newValue: 9, reason: "Se duplicó" }), { ...ANA, at: at(6), type: "correction.approve", correctionId: "co_00004" });
    expect(effectiveValue(again, state.facts[0].id)).toBe(9);
    expect(again.facts).toHaveLength(3);
  });

  it("can reject a correction, and validates the value, the reason, the target and the company", () => {
    const state = withFact();
    const id = state.facts[0].id;
    const proposed = must(state, { ...ANA, at: at(4), type: "correction.propose", factId: id, newValue: 12, reason: "Ajuste" });
    const rejected = must(proposed, { ...PABLO, at: at(5), type: "correction.reject", correctionId: proposed.corrections[0].id });
    expect(rejected.corrections[0].status).toBe("rejected");
    expect(rejected.facts).toHaveLength(1);
    expect(step(rejected, { ...PABLO, at: at(6), type: "correction.reject", correctionId: proposed.corrections[0].id }).errorCode).toBe("correctionClosed");
    expect(step(state, { ...ANA, at: at(4), type: "correction.propose", factId: "f_99999", newValue: 1, reason: "x" }).errorCode).toBe("factNotFound");
    expect(step(state, { ...ANA, at: at(4), type: "correction.propose", factId: id, newValue: 1.5, reason: "x" }).errorCode).toBe("invalid");
    expect(step(state, { ...ANA, at: at(4), type: "correction.propose", factId: id, newValue: 1, reason: " " }).errorCode).toBe("invalid");
    expect(step(state, { ...LUCIA, at: at(4), type: "correction.propose", factId: id, newValue: 1, reason: "x" }).errorCode).toBe("notYours");
    expect(step(proposed, { ...LUCIA, at: at(5), type: "correction.approve", correctionId: proposed.corrections[0].id }).errorCode).toBe("notYours");
    const approved = must(proposed, { ...PABLO, at: at(5), type: "correction.approve", correctionId: proposed.corrections[0].id });
    expect(step(approved, { ...ANA, at: at(6), type: "correction.propose", factId: approved.facts[1].id, newValue: 1, reason: "x" }).errorCode).toBe("invalid"); // correct the original, not a correction
    expect(correctionsOf(approved, "tenant-vida")).toEqual([]);
  });

  it("prepares reports: a draft, approved by a person, and only then scheduled and shared (as records) and exported (as a description)", () => {
    expect(validateReport({ name: " ", sections: [], format: "doc" as never })).toEqual(["nombre (1 a 80 caracteres)", "al menos una sección", "formato"]);
    expect(validateReport({ name: "x", sections: ["ai", "ai"], format: "pdf" })).toContain("secciones");
    expect(validateReport({ name: "x", sections: ["nope" as never], format: "pdf" })).toContain("secciones");
    let state = must(newInsightsState(), { ...ANA, at: at(4), type: "report.draft", input: { name: "Resumen ejecutivo", sections: [...VIEWS], format: "pdf" } });
    const id = state.reports[0].id;
    for (const event of [{ ...ANA, at: at(4), type: "report.schedule", reportId: id, frequency: "weekly" }, { ...ANA, at: at(4), type: "report.share", reportId: id, recipients: ["pablo"] }] as InsightsEvent[]) expect(step(state, event).errorCode, event.type).toBe("notApproved");
    state = must(state, { ...PABLO, at: at(5), type: "report.approve", reportId: id });
    expect(state.reports[0]).toMatchObject({ status: "approved", approvedBy: "pablo" });
    expect(step(state, { ...ANA, at: at(5), type: "report.update", reportId: id, input: { name: "otro", sections: ["ai"], format: "pdf" } }).errorCode).toBe("invalidState"); // an approved report is not rewritten
    expect(step(state, { ...PABLO, at: at(6), type: "report.approve", reportId: id }).errorCode).toBe("invalidState");
    state = must(must(state, { ...PABLO, at: at(6), type: "report.schedule", reportId: id, frequency: "monthly" }), { ...PABLO, at: at(6), type: "report.share", reportId: id, recipients: ["ana", "pablo", "ana"] });
    expect(state.reports[0]).toMatchObject({ frequency: "monthly", recipients: ["ana", "pablo"] });
    expect(step(state, { ...PABLO, at: at(6), type: "report.share", reportId: id, recipients: ["alguien@correo.com"] }).errorCode).toBe("invalid"); // internal people only
    expect(step(state, { ...PABLO, at: at(6), type: "report.schedule", reportId: id, frequency: "daily" as never }).errorCode).toBe("invalid");
    const exported = must(state, { ...ANA, at: at(7), type: "report.export", reportId: id });
    expect(exported.exports[0]).toMatchObject({ simulated: true, format: "pdf", filename: "resumen-ejecutivo-2026-10-07.pdf" });
    expect(Object.keys(exported.exports[0])).not.toContain("bytes"); // a description of a file, not a file
    expect(exportsOf(exported, "tenant-vida")).toEqual([]);
    expect(reportsOf(exported, "tenant-vida")).toEqual([]);
    expect(step(state, { ...LUCIA, at: at(6), type: "report.export", reportId: id }).errorCode).toBe("notYours");
    expect(step(state, { ...ANA, at: at(6), type: "report.export", reportId: "rp_99999" }).errorCode).toBe("notFound");
  });

  it("keeps the full audit trail, and the autonomy levels say who decides", () => {
    const result = applyAllInsights(newInsightsState(), [
      { ...ANA, at: at(4), type: "report.draft", input: { name: "A", sections: ["ai"], format: "pdf" } },
      { ...NEX, at: at(4), type: "report.approve", reportId: "rp_00001" },
    ]);
    expect(result.errors).toHaveLength(1);
    expect(result.state.audit.map((item) => item.action)).toEqual(["report.draft"]);
    expect([ACTION_LEVELS["insights.draft"], ACTION_LEVELS["insights.export"], ACTION_LEVELS["insights.correct"], ACTION_LEVELS["insights.approve"], ACTION_LEVELS["insights.share"], ACTION_LEVELS["insights.schedule"]]).toEqual([1, 1, 3, 3, 3, 3]);
  });
});

describe("the future is declared and not built", () => {
  it("lists forecast, predictions, AI analysis, benchmark, machine learning and recommendations, all through KOE and all unbuilt", () => {
    expect(FUTURE_CAPABILITIES.map((item) => item.id)).toEqual(["forecast", "prediction", "aiAnalysis", "benchmark", "machineLearning", "recommendations"]);
    for (const item of FUTURE_CAPABILITIES) expect(item).toMatchObject({ status: "notBuilt", reads: "ledger", runsThrough: "KOE" });
    const code = ["koe-insights.ts", "insights-center.ts", "koe-ledger.ts"].map((name) => readFileSync(join(__dirname, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")).join("\n");
    expect(code).not.toMatch(/function\s+(forecast|predict|benchmark|train|recommend)/i);
  });
});

describe("language", () => {
  it("has a message for every error code and Spanish labels", () => {
    for (const code of ERROR_CODES) expect(message(code, { detail: "x", from: "a", to: "b" }), code).not.toMatch(/\{\w+\}/);
    expect(label("tabs", "koe")).toBe("KOE");
    expect(label("module", "seo")).toBe("SEO");
    expect(label("reportStatus", "approved")).toBe("Aprobado");
    expect(label("frequency", "monthly")).toBe("Mensual");
    expect(message("invalid", { detail: "nombre" })).toBe("No es válido: nombre.");
  });
});
