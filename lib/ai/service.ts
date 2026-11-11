// The way a request reaches a real provider WITHOUT changing KOE or the Gateway's architecture:  Module -> KOE -> AI Cost Optimizer -> AI Gateway -> provider.
// KOE and the Gateway's reducer are pure and synchronous; a provider call is neither. So the request runs through the SAME reducer twice, around the real call:
//   1. capture: KOE decides (Worker, specialty, policy, priority), the Optimizer recommends, and the Gateway only records the GatewayRequest that reached it;
//   2. this layer runs that request against real providers (executor.ts), with the prompt KOE assembled;
//   3. replay: the same request runs again and the Gateway records the REAL outcome (model, provider, attempts, tokens, cost) instead of simulating one.
// KOE\'s own record therefore carries the real tokens and cost. A request KOE refuses (content, limits, budget, no model) never reaches the Gateway and never calls a
// provider. The prompt text is built from KOE\'s own pipeline and never stored; the answer text is returned to the caller and kept nowhere in any state.

import { withGatewayDriver } from "@/lib/contracts/platform/gateway-center";
import { buildPrompt, type PromptPlan } from "@/lib/contracts/platform/koe-ai";
import { effectiveConfig, purposeById, reduceAi, type AiEvent, type AiResult, type AiState } from "@/lib/contracts/platform/koe-ai-center";
import type { GatewayRequest } from "@/lib/contracts/platform/gateway-engine";
import { executeChain, executeStream, type Execution, type ExecutorDeps } from "./executor";
import type { ProviderPrompt } from "./types";

export type AskEvent = Extract<AiEvent, { type: "ai.request" }>;
export type Answer = { result: AiResult; text: string | null };
export type AnswerPart = { type: "delta"; text: string } | { type: "done"; answer: Answer };

/** The prompt KOE assembled, as a provider needs it: the instructions apart from everything else (rules/ai.md 5), the rest labelled by layer. */
export function providerPrompt(plan: PromptPlan): ProviderPrompt {
  const instructions = plan.parts.filter((part) => part.layer === "system" || part.layer === "guardrails" || part.layer === "business").map((part) => part.text);
  const material = plan.parts.filter((part) => part.layer !== "system" && part.layer !== "guardrails" && part.layer !== "business").map((part) => `[${part.layer}]\n${part.text}`);
  return { system: instructions.join("\n\n"), user: material.join("\n\n") };
}

/** The pass that only captures the request. Returns the result KOE gave (the one to hand back when nothing reaches the Gateway) and the request, if any. */
function capture(state: AiState, event: AskEvent): { dry: AiResult; request: GatewayRequest | undefined; prompt: ProviderPrompt | undefined } {
  const requests: GatewayRequest[] = [];
  const dry = withGatewayDriver({ mode: "capture", requests }, () => reduceAi(state, event));
  const request = requests[0];
  if (!request) return { dry, request: undefined, prompt: undefined };
  // the same pipeline KOE ran, so the provider gets exactly what KOE decided to send
  const purpose = purposeById(event.purposeId);
  const config = effectiveConfig(state, event.tenantId, event.at);
  const limit = config.limits.maxInputTokens;
  const plan = buildPrompt(event.input, { keepPersonal: purpose?.privacy === "personal", maxInputTokens: limit });
  return { dry, request, prompt: providerPrompt(plan) };
}

const replay = (state: AiState, event: AskEvent, request: GatewayRequest, execution: Execution): AiResult =>
  withGatewayDriver({ mode: "replay", outcomes: new Map([[request.requestId, execution.outcome]]) }, () => reduceAi(state, event));

/** Asks the AI. Everything is decided by KOE, the Optimizer and the Gateway; the caller gets KOE\'s result (with the real outcome recorded) and the answer text. */
export async function askAi(state: AiState, event: AskEvent, deps: ExecutorDeps): Promise<Answer> {
  const { dry, request, prompt } = capture(state, event);
  if (!request || !prompt) return { result: dry, text: null };
  const execution = await executeChain(request, prompt, { ...deps, breakers: state.gateway.breakers });
  return { result: replay(state, event, request, execution), text: execution.text };
}

/** Asks the AI and gets the answer as it is written. The last part carries the same Answer as `askAi`. */
export async function* askAiStream(state: AiState, event: AskEvent, deps: ExecutorDeps): AsyncGenerator<AnswerPart, void> {
  const { dry, request, prompt } = capture(state, event);
  if (!request || !prompt) { yield { type: "done", answer: { result: dry, text: null } }; return; }
  for await (const part of executeStream(request, prompt, { ...deps, breakers: state.gateway.breakers })) {
    if (part.type === "delta") { yield part; continue; }
    yield { type: "done", answer: { result: replay(state, event, request, part.execution), text: part.execution.text } };
  }
}
