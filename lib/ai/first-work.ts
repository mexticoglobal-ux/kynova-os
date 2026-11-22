// The facade the first-work draft route (and the evals runner) uses to reach a model: the ONLY file outside the AI layer's own tests that the architecture guard lets a route import.
// It turns the product configuration and limits into the `DraftDeps` that `generateDraft` takes, and ties them to ONE controlled call (controlled-call.ts): budget, call cap, input
// check and a single provider attempt. With the shipped configuration (everything off) it is never reached: the route does not build it.

import type { BudgetStore } from "@/lib/contracts/ai-budget";
import type { EnvSource } from "@/lib/backend/env";
import { FIRST_WORK_AI, type DraftDeps, type FirstWorkAiConfig } from "@/lib/first-work-draft";
import { createControlledCall, type ControlledCall } from "./controlled-call";
import type { ExecutorDeps } from "./executor";
import { instructionsOf } from "./prompts";
import { aiSecrets } from "./secrets";

/**
 * The configuration the route uses. It is the shipped one (everything off) unless the explicit test switch names THIS company: a deployment variable that holds the id of the one company
 * the first AI test may run for. Without the variable, or for any other company, nothing changes: the rules draft, no budget call, no provider call. With it, the requirements are met
 * by configuration (the registry's gw-fast-1 and the prices checked against the provider's page on 2026-11-20, the limits of FIRST_WORK_TEST_LIMITS, the persistent budget), but a call
 * still needs the budget assigned in the database, the call cap not used up and a provider key; without any of them the answer is the rules draft saying why.
 */
export function firstWorkAiConfigFor(tenantId: string, testTenant: string | undefined): FirstWorkAiConfig {
  if (!testTenant || testTenant.trim().toLowerCase() !== tenantId.toLowerCase()) return FIRST_WORK_AI;
  return { ...FIRST_WORK_AI, enabled: true, provider: "openai", model: "gw-fast-1", pricesVerified: true, limitsDefined: true, persistentBudget: true };
}

export type FirstWorkCallLimits = { maxInputTokens: number; maxOutputTokens: number };

export type FirstWorkDepsParams = {
  store: BudgetStore;
  tenantId: string;
  /** the id of THIS request: the same id never makes a second model call */ requestId: string;
  config: FirstWorkAiConfig;
  limits: FirstWorkCallLimits;
  /** where the provider key is read from (the Secrets Manager reads it only for the moment of the call) */ env: EnvSource;
  /** for tests: the registry of providers, the fetch and the clock of the executor */ executor?: Partial<Pick<ExecutorDeps, "registry" | "fetchImpl" | "now" | "clock" | "sleep">>;
};

/** The deps for `generateDraft` and the controlled call behind them (whose `report()` says how the reservation ended). */
export function buildFirstWorkDraftDeps(params: FirstWorkDepsParams): { deps: DraftDeps; controlled: ControlledCall } {
  const { maxInputTokens, maxOutputTokens } = params.limits;
  const controlled = createControlledCall({
    store: params.store,
    tenantId: params.tenantId,
    purposeId: params.config.purposeId,
    idempotencyKey: params.requestId,
    modelId: params.config.model ?? "",
    maxInputTokens,
    maxOutputTokens,
    executor: { secrets: aiSecrets(params.env), ...params.executor },
  });
  // The prompt is still `draft` until its evals are green: it is delivered only here, for the one company the test switch names (the caller only builds these deps then).
  const instructions = instructionsOf(params.config.promptId, { allowDraft: true });
  return { deps: { ...(instructions ? { instructions } : {}), ask: (prompt) => controlled.ask(prompt), budget: controlled.budget, inputFits: (prompt) => controlled.fits(prompt) }, controlled };
}
