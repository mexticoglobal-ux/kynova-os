// Copilot Context: what the Copilot knows about the business at the moment of answering, as plain FACTS. It reads the memories and the graph the asker may read (counts only, no text), the RAG's
// result for the question, and KOE's statistics (computed by KOE's own `computeInsights`; nothing is recomputed here and nothing is written back). Figures are gated by what the asker may see:
// money for managers and above, operations for members and above. Pure and deterministic. It also shapes the data a future executive dashboard will show (no screen is built here).

import { computeInsights } from "@/lib/contracts/platform/koe-insights";
import { viewFor, type KnowledgeState } from "@/lib/nex/knowledge";
import { canRead as canReadMemory, type MemoryState } from "@/lib/nex/memory";
import type { RagResult } from "@/lib/nex/rag";
import { canSeeFinance, canSeeOperations, validateShortText } from "./copilot-security";
import type { Consulted, DashboardData, DashboardItem, DashboardKpi, KoeInput, Objective, PlanType, Principal, Recommendation, Session, SuggestedAction } from "./copilot-types";

export type KoeFacts = {
  customersNew: number; customersLost: number; customersActive: number; customersServed: number; conversionRate: number | null; retentionRate: number | null;
  aiSuccess: number | null; totalRuns: number; topWorkerShare: number | null; idleWorkers: number; activeWorkers: number; hoursSaved: number; automationsRun: number; tasksCompleted: number;
  marketingTotal: number; salesLeadsTotal: number; funnelWorstDrop: { stage: string; fromPrevious: number } | null;
  /** only when the asker may see money */
  finance: { roiPercent: number | null; aiCostMicros: number; savingsMicros: number; attributedRevenueMicros: number } | null;
};
export type Facts = {
  memory: { total: number; byType: Readonly<Record<string, number>>; important: number; advisoryUnconfirmed: number; archived: number };
  graph: { nodes: number; edges: number; byType: Readonly<Record<string, number>>; isolated: number; processes: number; processesWithoutAutomation: number };
  koe: KoeFacts | undefined;
  hasObjective: boolean;
  /** the objectives the company wrote down (memories tagged as an objective that the asker may read), most important first */
  objectives: readonly string[];
  rag: { items: number; topScore: number };
};
export type FactSources = { memory: MemoryState; graph: KnowledgeState; koe?: KoeInput };

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
const OBJECTIVE_TAGS = ["objetivo", "objetivos", "meta", "metas", "okr", "goal", "goals"];

function koeFacts(input: KoeInput | undefined, actor: Principal): KoeFacts | undefined {
  // KOE's figures are the company's: another company's input is never used, and a viewer sees none of them
  if (!input || input.tenantId !== actor.tenantId || !canSeeOperations(actor)) return undefined;
  const insights = computeInsights(input);
  if (insights.empty) return undefined;
  const runs = insights.ai.byWorker.map((worker) => worker.runs);
  const totalRuns = sum(runs);
  const stages = insights.customers.funnel;
  let worst: KoeFacts["funnelWorstDrop"] = null;
  stages.forEach((stage, index) => { if (index > 0 && stage.fromPrevious !== null && (worst === null || stage.fromPrevious < worst.fromPrevious)) worst = { stage: stage.id, fromPrevious: stage.fromPrevious }; });
  const finance = canSeeFinance(actor)
    ? { roiPercent: insights.executive.roiPercent, aiCostMicros: insights.executive.aiCostMicros, savingsMicros: insights.executive.savingsMicros, attributedRevenueMicros: insights.financial.attributedRevenueMicros }
    : null;
  return {
    customersNew: insights.customers.newCustomers, customersLost: insights.customers.lostCustomers, customersActive: insights.customers.activeCustomers, customersServed: insights.executive.customersServed,
    conversionRate: insights.customers.conversionRate, retentionRate: insights.customers.retentionRate, aiSuccess: insights.ai.successRate, totalRuns,
    topWorkerShare: totalRuns > 0 ? Math.max(0, ...runs) / totalRuns : null, idleWorkers: Math.max(0, insights.executive.activeWorkers - runs.filter((count) => count > 0).length), activeWorkers: insights.executive.activeWorkers,
    hoursSaved: insights.executive.hoursSaved, automationsRun: insights.executive.automationsRun, tasksCompleted: insights.executive.tasksCompleted,
    marketingTotal: insights.analytics.find((chart) => chart.module === "marketing")?.total ?? 0, salesLeadsTotal: insights.analytics.find((chart) => chart.module === "sales")?.total ?? 0,
    funnelWorstDrop: worst, finance,
  };
}

/** What the asker can see of the memory and the graph, as counts. Nothing of another company, nothing hidden from this asker. */
export function gatherFacts(sources: FactSources, actor: Principal, rag: Pick<RagResult, "items"> | undefined, sessionObjective?: string): Facts {
  const memories = sources.memory.memories.filter((memory) => memory.tenantId === actor.tenantId && canReadMemory(actor, memory) && memory.status !== "expired");
  const byMemoryType: Record<string, number> = {};
  for (const memory of memories) byMemoryType[memory.type] = (byMemoryType[memory.type] ?? 0) + 1;
  const view = viewFor(sources.graph, actor);
  const byNodeType: Record<string, number> = {};
  for (const node of view.nodes.values()) byNodeType[node.type] = (byNodeType[node.type] ?? 0) + 1;
  const edges = [...view.out.values()].reduce((total, list) => total + list.length, 0);
  const isolated = [...view.nodes.keys()].filter((id) => (view.out.get(id)?.length ?? 0) === 0 && (view.inn.get(id)?.length ?? 0) === 0).length;
  const processes = [...view.nodes.values()].filter((node) => node.type === "process");
  // a process is automated when it is related to an automation, in either direction
  const automated = (id: string) => [...(view.out.get(id) ?? []).map((edge) => edge.to), ...(view.inn.get(id) ?? []).map((edge) => edge.from)].some((other) => view.nodes.get(other)?.type === "automation");
  // what the company wrote down as an objective: found in the memory itself, whatever the question was
  const written = memories.filter((memory) => memory.tags.some((tag) => OBJECTIVE_TAGS.includes(tag))).sort((a, b) => b.importance - a.importance || a.id.localeCompare(b.id)).flatMap((memory) => { const text = validateShortText(memory.summary); return text.ok ? [text.text] : []; }).slice(0, 3);
  return {
    memory: {
      total: memories.length, byType: byMemoryType, important: memories.filter((memory) => memory.pinned || memory.importance >= 80).length,
      advisoryUnconfirmed: memories.filter((memory) => memory.advisory && !memory.confirmedBy).length, archived: memories.filter((memory) => memory.status === "archived").length,
    },
    graph: { nodes: view.nodes.size, edges, byType: byNodeType, isolated, processes: processes.length, processesWithoutAutomation: processes.filter((node) => !automated(node.id)).length },
    koe: koeFacts(sources.koe, actor),
    // an objective exists if the person stated one, or the company wrote one down (memory or graph, as far as the asker can see)
    hasObjective: Boolean(sessionObjective) || written.length > 0 || [...view.nodes.values()].some((node) => node.tags.some((tag) => OBJECTIVE_TAGS.includes(tag))),
    objectives: written,
    rag: { items: rag?.items.length ?? 0, topScore: rag?.items[0]?.score ?? 0 },
  };
}

// ------------------------------------------------------------------------------------------ objectives
export const DEFAULT_OBJECTIVE: Readonly<Record<PlanType, string>> = {
  sales: "Convertir más prospectos en clientes", marketing: "Generar más prospectos calificados", finance: "Mantener un retorno positivo sobre lo que se invierte",
  operations: "Reducir el trabajo manual y los retrasos", crm: "Retener y hacer crecer la base de clientes", automations: "Automatizar lo repetitivo sin perder control",
  ai: "Usar a los workers donde más valor dan", growth: "Crecer de forma sostenida", support: "Atender a cada cliente a tiempo", organization: "Tener el conocimiento del negocio claro y conectado",
};
/** The objectives behind a question: the one the person stated, the ones the company wrote down (knowledge tagged as an objective), and a default for the plan. */
export function objectivesOf(session: Pick<Session, "objective"> | undefined, written: readonly string[], planType: PlanType): Objective[] {
  const found: Objective[] = [];
  if (session?.objective) found.push({ id: "objective:session", source: "session", label: session.objective });
  written.forEach((label, index) => found.push({ id: `objective:knowledge:${index + 1}`, source: "knowledge", label }));
  found.push({ id: `objective:default:${planType}`, source: "default", label: DEFAULT_OBJECTIVE[planType] });
  return found.slice(0, 4);
}

// ------------------------------------------------------------------------------------------ data for a future executive dashboard (no screen)
const pct = (value: number | null) => (value === null ? null : Math.round(value * 100));
const item = (rec: Recommendation): DashboardItem => ({ id: rec.id, title: rec.title, severity: rec.severity, score: rec.score, area: rec.area });

export function buildDashboard(input: { tenantId: string; at: string; facts: Facts; recommendations: readonly Recommendation[]; actions: readonly SuggestedAction[]; actor: Principal }): DashboardData {
  const { facts, recommendations } = input;
  const k = facts.koe;
  const kpis: DashboardKpi[] = [
    { id: "memory.total", label: "Memorias visibles", value: facts.memory.total, unit: "count", source: "memory" },
    { id: "memory.important", label: "Memorias importantes", value: facts.memory.important, unit: "count", source: "memory" },
    { id: "memory.unconfirmedLearning", label: "Aprendizajes sin confirmar", value: facts.memory.advisoryUnconfirmed, unit: "count", source: "memory" },
    { id: "graph.nodes", label: "Nodos del grafo", value: facts.graph.nodes, unit: "count", source: "graph" },
    { id: "graph.edges", label: "Relaciones del grafo", value: facts.graph.edges, unit: "count", source: "graph" },
    { id: "graph.isolated", label: "Nodos aislados", value: facts.graph.isolated, unit: "count", source: "graph" },
    { id: "copilot.pendingApprovals", label: "Acciones por aprobar", value: input.actions.filter((action) => action.status === "suggested").length, unit: "count", source: "copilot" },
  ];
  if (k) {
    kpis.push(
      { id: "customers.new", label: "Clientes nuevos", value: k.customersNew, unit: "count", source: "koe" }, { id: "customers.lost", label: "Clientes perdidos", value: k.customersLost, unit: "count", source: "koe" },
      { id: "customers.active", label: "Clientes activos", value: k.customersActive, unit: "count", source: "koe" }, { id: "customers.conversion", label: "Conversión", value: pct(k.conversionRate), unit: "percent", source: "koe" },
      { id: "customers.retention", label: "Retención", value: pct(k.retentionRate), unit: "percent", source: "koe" }, { id: "automation.hoursSaved", label: "Horas ahorradas", value: k.hoursSaved, unit: "hours", source: "koe" },
      { id: "automation.runs", label: "Automatizaciones ejecutadas", value: k.automationsRun, unit: "count", source: "koe" }, { id: "workers.active", label: "Workers activos", value: k.activeWorkers, unit: "count", source: "koe" },
      { id: "ai.success", label: "Éxito de la IA", value: pct(k.aiSuccess), unit: "percent", source: "koe" },
    );
    if (k.finance) {
      kpis.push(
        { id: "finance.roi", label: "ROI", value: k.finance.roiPercent, unit: "percent", source: "koe" }, { id: "finance.aiCost", label: "Costo de IA", value: k.finance.aiCostMicros, unit: "money_micros", source: "koe" },
        { id: "finance.savings", label: "Ahorro", value: k.finance.savingsMicros, unit: "money_micros", source: "koe" }, { id: "finance.revenue", label: "Ingresos atribuidos", value: k.finance.attributedRevenueMicros, unit: "money_micros", source: "koe" },
      );
    }
  }
  const risks = recommendations.filter((rec) => rec.kind === "risk" || rec.kind === "problem").map(item);
  const opportunities = recommendations.filter((rec) => rec.kind === "opportunity").map(item);
  const urgent = recommendations.filter((rec) => rec.severity === "critical" || rec.severity === "high");
  const pending = input.actions.filter((action) => action.status === "suggested").length;
  const alerts = [
    ...urgent.map((rec) => ({ id: `alert:${rec.id}`, severity: rec.severity, message: rec.title })),
    ...(pending > 0 ? [{ id: "alert:pendingApprovals", severity: "medium" as const, message: `${pending} acción(es) esperan la aprobación de una persona` }] : []),
  ];
  const known = facts.memory.total > 0 || facts.graph.nodes > 0 || k !== undefined;
  const status: DashboardData["status"] = !known ? "unknown" : recommendations.some((rec) => rec.severity === "critical") ? "critical" : recommendations.some((rec) => rec.severity === "high") ? "attention" : "healthy";
  const summary = [
    status === "unknown" ? "Todavía no hay información suficiente para evaluar la empresa." : `Estado general: ${status === "healthy" ? "saludable" : status === "attention" ? "requiere atención" : "crítico"}.`,
    `${risks.length} riesgo(s) o problema(s) y ${opportunities.length} oportunidad(es) identificados.`,
    ...(recommendations[0] ? [`Prioridad principal: ${recommendations[0].title}.`] : []),
  ];
  return {
    tenantId: input.tenantId, generatedAt: input.at, status, summary, kpis, risks, opportunities, alerts,
    priorities: recommendations.slice(0, 5).map((rec, index) => ({ ...item(rec), rank: index + 1 })),
    coverage: { memory: facts.memory.total > 0, graph: facts.graph.nodes > 0, koe: k !== undefined },
  };
}
export const consultedOf = (facts: Facts, ragConsulted: boolean): Consulted => ({ rag: ragConsulted, memory: true, graph: true, koe: facts.koe !== undefined });
