// How an automation is carried out through KOE. An automation never touches a model: it is assigned a Worker, the Worker's
// definition says which tools it may use, how sensitive the data it handles may be, its priority and its estimated cost, and
// KOE's router (koe-registry.ts) picks the model from the registry. Here that choice is only RECORDED: no model is called,
// and nothing in the automation modules imports lib/ai or reaches the network.

import { BASE_MODELS, PLATFORM_OWNER, STARTER_WORKERS, covers, routeModel, type Clearance, type ModelManifest, type Priority, type WorkerDefinition } from "./koe-registry";

/** What KOE offers: the Workers and the models. Tests and, later, the real registry replace it. */
export type KoeEnv = { workers: readonly WorkerDefinition[]; models: readonly ModelManifest[] };
export const DEFAULT_KOE_ENV: KoeEnv = { workers: STARTER_WORKERS, models: BASE_MODELS };

export type ModelChoice = { id: string; label: string; provider: string };
export type ExecutionPlan = { worker: WorkerDefinition; model: ModelChoice; modelReason: string; priority: Priority; estimatedCostMicros: number };
export type PlanFailure = { problem: string };
export type Need = { tools: readonly string[]; clearance: Clearance };

const CONTEXT_TOKENS = 4_000; // an automation's prompt is short by construction: closed templates filled with a few fields

/** The Worker if it can carry this automation out in this company, or the reason it cannot. */
export function planExecution(env: KoeEnv, tenantId: string | undefined, workerId: string, need: Need): ExecutionPlan | PlanFailure {
  const worker = env.workers.find((item) => item.id === workerId && (item.ownerTenantId === PLATFORM_OWNER || item.ownerTenantId === tenantId));
  if (!worker) return { problem: `el Worker «${workerId}» no existe` };
  if (worker.status !== "active") return { problem: `el Worker «${worker.name}» no está activo` };
  const missing = need.tools.filter((tool) => !worker.tools.includes(tool));
  if (missing.length) return { problem: `el Worker «${worker.name}» no tiene la herramienta «${missing.join("», «")}»` };
  if (!covers(worker.dataClearance, need.clearance)) return { problem: `el Worker «${worker.name}» no puede manejar datos de contacto` };
  const route = routeModel(env.models, { needs: worker.routing.needs, dataClearance: need.clearance, contextTokens: CONTEXT_TOKENS, needsTools: true }, worker.routing.policy);
  if (!route.chosen) return { problem: `KOE no encontró un modelo disponible para «${worker.name}» (${route.reason})` };
  return { worker, model: { id: route.chosen.id, label: route.chosen.label, provider: route.chosen.provider }, modelReason: route.reason, priority: worker.priority, estimatedCostMicros: worker.costEstimate.perRunMicros };
}

export const failed = (result: ExecutionPlan | PlanFailure): result is PlanFailure => "problem" in result;
