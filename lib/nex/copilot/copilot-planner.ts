// Copilot Planner: deterministic plans. A plan has a TYPE (sales, marketing, finance, operations, CRM, automations, AI, growth, support, organization) chosen from the words of the question, what the
// question is about and what was found, an objective, and a short ordered list of steps: two fixed steps to understand where the company stands, the steps that attend the most severe recommendations
// (those of the plan's own area first), and a closing step to measure and ask again. The same question over the same findings always gives the same plan.

import { tokenize } from "@/lib/nex/memory";
import type { Intent } from "@/lib/nex/rag";
import type { Finding, Horizon, Plan, PlanStep, PlanType, Recommendation } from "./copilot-types";

const TERM_WORDS: Readonly<Record<PlanType, readonly string[]>> = {
  sales: ["pipeline", "oportunidad"], marketing: ["seo"], finance: ["finanzas", "presupuesto"], operations: [], crm: ["retención", "churn"], automations: ["automatización", "automatizar", "automation"],
  ai: ["ia", "modelo", "modelos", "worker", "workers", "agente", "agentes", "ai"], growth: ["crecimiento", "crecer", "growth", "escalar"], support: ["soporte", "ticket", "tickets", "support", "atención"],
  organization: ["organización", "estructura", "equipo", "roles"],
};
const TERM_PLAN: ReadonlyMap<string, PlanType> = new Map((Object.keys(TERM_WORDS) as PlanType[]).flatMap((type) => TERM_WORDS[type].flatMap((word) => tokenize(word).map((term): [string, PlanType] => [term, type]))));
const INTENT_PLAN: Readonly<Record<Intent, PlanType | undefined>> = {
  information: undefined, customer: "crm", company: "organization", document: "operations", workflow: "automations", finance: "finance", sales: "sales", marketing: "marketing", operations: "operations",
  preferences: "crm", history: "growth",
};

/** An explicit choice wins; then a telling word; then what the question is about; and for a general question, the area with the most severe finding. */
export function planTypeFor(terms: readonly string[], intents: readonly Intent[], findings: readonly Finding[], override?: PlanType): PlanType {
  if (override) return override;
  for (const term of terms) { const type = TERM_PLAN.get(term); if (type) return type; }
  for (const intent of intents) { const type = INTENT_PLAN[intent]; if (type) return type; }
  return findings[0]?.area ?? "growth";
}

export const PLAN_TITLES: Readonly<Record<PlanType, string>> = {
  sales: "Plan de ventas", marketing: "Plan de marketing", finance: "Plan financiero", operations: "Plan de operaciones", crm: "Plan de clientes (CRM)", automations: "Plan de automatizaciones",
  ai: "Plan de IA y workers", growth: "Plan de crecimiento", support: "Plan de soporte", organization: "Plan de organización",
};
const BASE_STEPS: Readonly<Record<PlanType, readonly [PlanStep["title"], PlanStep["why"]][]>> = {
  sales: [["Revisar el embudo de ventas actual", "Saber en qué etapa se pierden prospectos."], ["Fijar una meta de conversión", "Tener un número contra el cual medir."]],
  marketing: [["Revisar qué canales traen prospectos hoy", "Saber qué funciona antes de gastar más."], ["Fijar una meta de prospectos por periodo", "Tener un número contra el cual medir."]],
  finance: [["Revisar costos, ahorro e ingresos del periodo", "Ver si la inversión devuelve lo que cuesta."], ["Fijar un límite de gasto y un retorno mínimo", "Evitar que el costo crezca sin control."]],
  operations: [["Listar los procesos que más tiempo consumen", "Saber dónde está el trabajo manual."], ["Fijar una meta de horas liberadas", "Tener un número contra el cual medir."]],
  crm: [["Revisar clientes nuevos, activos y perdidos", "Ver cómo se mueve la base de clientes."], ["Fijar una meta de retención", "Tener un número contra el cual medir."]],
  automations: [["Revisar qué automatizaciones y workers ya funcionan", "Partir de lo que ya da resultado."], ["Elegir el siguiente proceso a automatizar", "Concentrar el esfuerzo en uno a la vez."]],
  ai: [["Revisar el rendimiento y el costo de cada worker", "Ver dónde la IA da valor y dónde falla."], ["Fijar una meta de éxito por worker", "Tener un número contra el cual medir."]],
  growth: [["Revisar qué está funcionando hoy", "Reforzar lo que ya da resultado."], ["Elegir una palanca de crecimiento para el periodo", "Concentrar el esfuerzo en una a la vez."]],
  support: [["Revisar qué clientes esperan respuesta", "Atender primero a quien lleva más tiempo esperando."], ["Fijar un tiempo máximo de respuesta", "Tener un compromiso contra el cual medir."]],
  organization: [["Revisar qué sabe NEX del negocio y qué falta", "Ver las lagunas de conocimiento."], ["Nombrar a una persona responsable de cada área", "Que cada decisión tenga dueño."]],
};
const CLOSING: readonly [string, string] = ["Medir el resultado y volver a consultar a NEX", "Comprobar si el plan funcionó y ajustar."];

export const horizonOf = (topScore: number | undefined): Horizon => (topScore === undefined ? "quarter" : topScore >= 80 ? "now" : topScore >= 60 ? "week" : topScore >= 35 ? "month" : "quarter");

export function buildPlan(input: { id: string; type: PlanType; objective: string; recommendations: readonly Recommendation[]; maxSteps: number }): Plan {
  const room = Math.max(0, input.maxSteps - 3);
  const own = input.recommendations.filter((rec) => rec.area === input.type);
  // the plan's own area first; if that area has little to attend, the most severe of the rest fill in
  const chosen = [...own, ...input.recommendations.filter((rec) => rec.area !== input.type)].slice(0, Math.min(room, Math.max(own.length, 2)));
  const steps: PlanStep[] = [];
  for (const [title, why] of BASE_STEPS[input.type]) steps.push({ order: steps.length + 1, title, why, area: input.type });
  for (const rec of chosen) steps.push({ order: steps.length + 1, title: `Atender: ${rec.title}`, why: rec.reason, area: rec.area, recommendationId: rec.id });
  steps.push({ order: steps.length + 1, title: CLOSING[0], why: CLOSING[1], area: input.type });
  return { id: input.id, type: input.type, title: PLAN_TITLES[input.type], objective: input.objective, horizon: horizonOf(chosen.map((rec) => rec.score).sort((a, b) => b - a)[0]), steps, basedOn: chosen.map((rec) => rec.findingId) };
}
