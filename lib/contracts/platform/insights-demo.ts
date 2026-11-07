// Sample data for the local simulation of Insights. Fictional companies and numbers, all from SIMULATED events: nothing is a real call.
// The ledger is built from the other modules' own sample records (KOE runs, automation runs, Studio tests), plus a deterministic
// generator for volume (executions routed with KOE's own router, and facts reported through the same reducer a real feed will use).

import { demoAutomationsOk } from "./automation-demo";
import { demoKoeOk } from "./koe-demo";
import type { KoeState } from "./koe-engine";
import { METRICS, executionsFromAutomations, executionsFromKoe, executionsFromStudio, processForSpecialty, rosterOf, workersOf, type BusinessFact, type ExecutionEvent, type Roster } from "./koe-ledger";
import { BASE_MODELS, STARTER_WORKERS, routeModel } from "./koe-registry";
import { newInsightsState, reduceInsights, type InsightsEvent, type InsightsState } from "./insights-center";
import { demoStudioOk } from "./studio-demo";
import type { AutomationState } from "./automation-center";
import type { StudioState } from "./studio-center";

export const DEMO_TENANTS = [
  { id: "tenant-nova", name: "Nova Marketing Studio" },
  { id: "tenant-vida", name: "Clínica Vida" },
] as const;

export const DEMO_PERSONAS = [
  { id: "nova-ana", label: "Nova · Ana", tenantId: "tenant-nova", actor: "ana" },
  { id: "nova-pablo", label: "Nova · Pablo", tenantId: "tenant-nova", actor: "pablo" },
  { id: "vida-lucia", label: "Clínica Vida · Lucía", tenantId: "tenant-vida", actor: "lucia" },
  { id: "nex", label: "NEX (IA) en Nova", tenantId: "tenant-nova", actor: "worker:nex" },
] as const;

/** A small deterministic generator: the same simulation every time. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296; };
}

const DAYS = 31;
const stamp = (day: number, hour: number) => `2026-10-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;
// Workers the simulation runs, with how many runs a day a company of scale 1 gives each
// each company runs its own automations: the names are never shared
const AUTOMATIONS: Record<string, readonly [string, string][]> = {
  "tenant-nova": [["prospecto", "Prospecto caliente"], ["bienvenida", "Bienvenida al cliente nuevo"], ["precios", "Formulario web: precios"]],
  "tenant-vida": [["cita", "Aviso de cita"], ["control", "Recordatorio de control"]],
};
const POOL: readonly [string, number][] = [["sales", 5], ["followup", 3], ["reporter", 1], ["collections", 2], ["tutor", 2], ["automator", 4], ["coordinator", 1]];

/** Executions routed through KOE's own router, with a model that is degraded some days and down one day, so fallbacks and errors appear. */
export function simulateExecutions(tenantId: string, scale: number, seed: number): ExecutionEvent[] {
  const random = mulberry32(seed);
  const out: ExecutionEvent[] = [];
  const names = AUTOMATIONS[tenantId] ?? AUTOMATIONS["tenant-nova"];
  let n = 0;
  for (let day = 1; day <= DAYS; day += 1) {
    const models = BASE_MODELS.map((model) => (model.id === "m-reason-c" && day % 9 === 0 ? { ...model, health: "degraded" as const } : model.id === "m-fast-a" && day === 13 ? { ...model, health: "down" as const } : model));
    for (const [workerId, perDay] of POOL) {
      const worker = STARTER_WORKERS.find((item) => item.id === workerId);
      if (!worker) continue;
      const count = Math.max(0, Math.round(perDay * scale * (1 + day / 40) + (random() - 0.5) * 2));
      for (let index = 0; index < count; index += 1) {
        n += 1;
        const route = routeModel(models, { needs: worker.routing.needs, dataClearance: worker.dataClearance, contextTokens: 4_000, needsTools: true }, worker.routing.policy);
        const reasoning = worker.routing.needs.includes("reasoning");
        const tokens = 400 + Math.floor(random() * 1_100);
        const failed = !route.chosen || random() < 0.04;
        out.push({
          id: `x:${tenantId}:${String(n).padStart(5, "0")}`, tenantId, at: stamp(day, 8 + Math.floor(random() * 10)), source: workerId === "automator" ? "automation" : "simulated",
          ...(workerId === "automator" ? { automationId: `sim-${tenantId}-${names[n % names.length][0]}`, automationName: names[n % names.length][1] } : {}),
          workerId, workerName: worker.name, specialty: worker.specialty, modelId: route.chosen?.id, modelLabel: route.chosen?.label, fallback: route.fallbackUsed,
          outcome: failed ? "error" : "success", durationMs: route.chosen ? Math.round((reasoning ? 2_200 : 550) * (0.7 + random() * 0.8)) : undefined,
          costMicros: route.chosen ? worker.costEstimate.perRunMicros + Math.ceil((tokens / 1_000) * route.chosen.costMicrosPer1k) : 0, tokens: route.chosen ? tokens : undefined,
          process: failed ? undefined : processForSpecialty(worker.specialty),
        });
      }
    }
  }
  return out;
}

type Plan = { id: string; base: number; chance?: number; weekdays?: boolean; money?: number; growth?: number; snapshot?: boolean };
const PLAN: readonly Plan[] = [
  { id: "leadsNew", base: 6, growth: 0.6 }, { id: "leadsQualified", base: 3, growth: 0.4 }, { id: "proposalsSent", base: 2, growth: 0.3 }, { id: "leadsConverted", base: 1, chance: 0.7 },
  { id: "attributedRevenue", base: 0, money: 1_200_000_000, chance: 0.7 }, { id: "marketingLeads", base: 4, growth: 0.5 }, { id: "contentPublished", base: 1, weekdays: true },
  { id: "organicVisits", base: 120, growth: 6 }, { id: "keywordsTop10", base: 14, growth: 0.3, snapshot: true }, { id: "customersNew", base: 0, chance: 0.6 }, { id: "customersLost", base: 0, chance: 0.12 },
  { id: "customersServed", base: 8, growth: 0.3 }, { id: "tasksCompleted", base: 14, growth: 0.4 }, { id: "lessonsCompleted", base: 9, growth: 0.3 }, { id: "certificatesIssued", base: 0, chance: 0.2 },
  { id: "marketplaceSales", base: 0, chance: 0.5 }, { id: "marketplaceRevenue", base: 0, money: 29_000_000, chance: 0.5 }, { id: "referralsNew", base: 0, chance: 0.5 }, { id: "referralsConverted", base: 0, chance: 0.2 },
  { id: "paymentsCount", base: 2, growth: 0.1 }, { id: "paymentsValue", base: 0, money: 400_000_000 }, { id: "syncsOk", base: 20 }, { id: "syncsFailed", base: 0, chance: 0.15 },
];

/** Facts for a month, as events the platform would report. The reducer validates each one: a bad metric would be refused. */
export function simulateFacts(tenantId: string, scale: number, seed: number): InsightsEvent[] {
  const random = mulberry32(seed);
  const events: InsightsEvent[] = [];
  let active = Math.round(40 * scale);
  for (let day = 1; day <= DAYS; day += 1) {
    const weekday = ((day + 3) % 7) < 5; // 2026-10-01 is a Thursday
    const counts: Record<string, number> = {};
    for (const plan of PLAN) {
      const def = METRICS.find((item) => item.id === plan.id);
      if (!def) continue;
      if (plan.weekdays && !weekday) continue;
      let value: number;
      if (plan.money !== undefined) {
        const multiplier = plan.id === "attributedRevenue" ? (counts.leadsConverted ?? 0) : plan.id === "marketplaceRevenue" ? (counts.marketplaceSales ?? 0) : (counts.paymentsCount ?? 0);
        value = Math.round(plan.money * multiplier * (0.8 + random() * 0.4));
      } else if (plan.chance !== undefined) value = random() < plan.chance ? Math.max(1, Math.round(scale + (plan.id === "leadsConverted" ? 0 : random()))) : 0;
      else value = Math.max(0, Math.round((plan.base + (plan.growth ?? 0) * day) * scale + (random() - 0.5) * 2));
      counts[plan.id] = value;
      if (plan.id === "customersNew") active += value;
      if (plan.id === "customersLost") active = Math.max(0, active - value);
      if (value === 0 && !plan.snapshot) continue;
      events.push({ tenantId, actor: "system", at: stamp(day, 12), type: "fact.record", module: def.module, metric: def.id, value });
    }
    events.push({ tenantId, actor: "system", at: stamp(day, 13), type: "fact.record", module: "crm", metric: "customersActive", value: active });
    for (const department of ["sales", "marketing", "support", "finance", "operations"] as const) {
      events.push({ tenantId, actor: "system", at: stamp(day, 14), type: "fact.record", module: "crm", metric: "manualMinutes", value: Math.round((60 + random() * 120) * scale), dimension: department });
    }
  }
  return events;
}

export type InsightsSource = {
  koe: KoeState; automations: AutomationState; studio: StudioState; state: InsightsState; executions: readonly ExecutionEvent[];
  rosters: Record<string, Roster>; errors: string[];
};

/** Everything the Insights screens read: the ledger (executions and facts), the rosters, and the Insights store itself. */
export function demoInsightsSource(): InsightsSource {
  const koe = demoKoeOk();
  const automations = demoAutomationsOk();
  const studio = demoStudioOk();
  const workers = workersOf(koe);
  const executions = [
    ...executionsFromKoe(koe), ...executionsFromAutomations(automations, workers), ...executionsFromStudio(studio, workers),
    ...simulateExecutions("tenant-nova", 1, 20_261_001), ...simulateExecutions("tenant-vida", 0.45, 20_261_002),
  ];
  const errors: string[] = [];
  let state = newInsightsState();
  const send = (event: InsightsEvent) => {
    const result = reduceInsights(state, event);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    state = result.state;
  };
  for (const event of [...simulateFacts("tenant-nova", 1, 7_001), ...simulateFacts("tenant-vida", 0.45, 7_002)]) send(event);

  const ana = { tenantId: "tenant-nova", actor: "ana" };
  const pablo = { tenantId: "tenant-nova", actor: "pablo" };
  const nex = { tenantId: "tenant-nova", actor: "worker:nex" };
  send({ ...ana, at: stamp(30, 9), type: "report.draft", input: { name: "Resumen ejecutivo mensual", sections: ["executive", "financial", "customers"], format: "pdf" } });
  send({ ...pablo, at: stamp(30, 10), type: "report.approve", reportId: state.reports[0]?.id ?? "" });
  send({ ...pablo, at: stamp(30, 11), type: "report.schedule", reportId: state.reports[0]?.id ?? "", frequency: "monthly" });
  send({ ...pablo, at: stamp(30, 12), type: "report.share", reportId: state.reports[0]?.id ?? "", recipients: ["ana", "pablo"] });
  send({ ...ana, at: stamp(30, 13), type: "report.export", reportId: state.reports[0]?.id ?? "" });
  send({ ...nex, at: stamp(31, 9), type: "report.draft", input: { name: "Rendimiento de la IA", sections: ["ai", "koe", "productivity"], format: "xlsx" } });
  const someFact = state.facts.find((item) => item.tenantId === "tenant-nova" && item.metric === "tasksCompleted");
  send({ ...nex, at: stamp(31, 10), type: "correction.propose", factId: someFact?.id ?? "", newValue: (someFact?.value ?? 0) + 3, reason: "El equipo registró tres tareas más ese día" });

  return { koe, automations, studio, state, executions, rosters: { "tenant-nova": rosterOf(koe, studio, "tenant-nova"), "tenant-vida": rosterOf(koe, studio, "tenant-vida") }, errors };
}

export const factsOfTenant = (facts: readonly BusinessFact[], tenantId: string) => facts.filter((item) => item.tenantId === tenantId);
