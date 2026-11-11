// lib/ai: the provider layer of the AI Gateway. The ONLY place that talks to an AI provider. Callers use `askAi` / `askAiStream`; everything else is exported for tests and
// for the Backend Core's health.
export { askAi, askAiStream, providerPrompt, type Answer, type AnswerPart, type AskEvent } from "./service";
export { executeChain, executeStream, outcomeOfKind, sanitizeAnswer, type AttemptEvent, type Execution, type ExecutorDeps } from "./executor";
export { AI_CONFIG_NAMES, AI_SECRET_NAMES, aiSecrets, providerReadiness, type ProviderReadiness } from "./secrets";
export { CONNECTED_PROVIDERS, NATIVE_MODELS, PREPARED_PROVIDERS, PROVIDER_REGISTRY, costOfNative, type NativeModel, type ProviderConfig } from "./providers";
export { PROVIDER_ERROR_KINDS, ProviderError, RETRYABLE_KINDS, type Completion, type ProviderAdapter, type ProviderErrorKind, type ProviderPrompt, type StreamEvent, type Usage } from "./types";
