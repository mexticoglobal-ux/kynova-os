// The configuration registry of lib/ai (rules/ai.md 2): which providers exist, which are connected, which secret each one needs, and which provider-native model
// serves each internal model of the registry, with its reference price. Nothing that consumes a model names one: they all go through the Gateway, which maps its
// internal ids (gw-...) to a provider (gateway-catalog.ts) and, here, to that provider's own model name. Changing a model or a price is a change in this file only.

import { anthropicAdapter, deepseekAdapter, googleAdapter, grokAdapter, mistralAdapter, ollamaAdapter, openaiAdapter, openrouterAdapter } from "./adapters";
import type { ProviderAdapter } from "./types";

export type ProviderConfig = {
  adapter: ProviderAdapter;
  /**
   * Connected providers are called. A provider that is only prepared is never called, even if its secret is set: connecting it is a decision of its own
   * (a change to this flag, with its tests). The Gateway sees it as unavailable and falls back.
   */
  connected: boolean;
  /** The secret that holds the key. `null` for a provider that needs none. */
  secret: string | null;
  /** The configuration value (not a secret) that holds the address of a provider that runs where we choose. */
  addressName?: string;
};

export const PROVIDER_REGISTRY: Readonly<Record<string, ProviderConfig>> = {
  openai: { adapter: openaiAdapter, connected: true, secret: "OPENAI_API_KEY" },
  anthropic: { adapter: anthropicAdapter, connected: true, secret: "ANTHROPIC_API_KEY" },
  google: { adapter: googleAdapter, connected: true, secret: "GEMINI_API_KEY" },
  openrouter: { adapter: openrouterAdapter, connected: true, secret: "OPENROUTER_API_KEY" },
  // prepared, not connected
  grok: { adapter: grokAdapter, connected: false, secret: "XAI_API_KEY" },
  deepseek: { adapter: deepseekAdapter, connected: false, secret: "DEEPSEEK_API_KEY" },
  mistral: { adapter: mistralAdapter, connected: false, secret: "MISTRAL_API_KEY" },
  local: { adapter: ollamaAdapter, connected: false, secret: null, addressName: "OLLAMA_BASE_URL" },
};
export const CONNECTED_PROVIDERS = Object.entries(PROVIDER_REGISTRY).filter(([, config]) => config.connected).map(([id]) => id);
export const PREPARED_PROVIDERS = Object.entries(PROVIDER_REGISTRY).filter(([, config]) => !config.connected).map(([id]) => id);

/** What a provider-native model costs, in millionths of a dollar per million tokens. REFERENCE prices: verify them against the provider's invoice before relying on them. */
export type NativeModel = { provider: string; model: string; /** false for a model the chat adapters cannot serve (embeddings). */ chat: boolean; inputMicrosPerM: number; outputMicrosPerM: number };

/** The provider-native model behind each internal model of the registry (ai-model-registry.ts). Names and prices are configuration to review, not facts. */
export const NATIVE_MODELS: Readonly<Record<string, NativeModel>> = {
  "gw-fast-1": { provider: "openai", model: "gpt-4o-mini", chat: true, inputMicrosPerM: 150_000, outputMicrosPerM: 600_000 },
  "gw-reason-1": { provider: "anthropic", model: "claude-opus-5-5", chat: true, inputMicrosPerM: 15_000_000, outputMicrosPerM: 75_000_000 },
  "gw-balanced-1": { provider: "google", model: "gemini-2.5-flash", chat: true, inputMicrosPerM: 300_000, outputMicrosPerM: 2_500_000 },
  "gw-route-1": { provider: "openrouter", model: "openrouter/auto", chat: true, inputMicrosPerM: 1_000_000, outputMicrosPerM: 3_000_000 },
  "gw-eu-1": { provider: "mistral", model: "mistral-small-latest", chat: true, inputMicrosPerM: 200_000, outputMicrosPerM: 600_000 },
  "gw-live-1": { provider: "grok", model: "grok-3-mini", chat: true, inputMicrosPerM: 300_000, outputMicrosPerM: 500_000 },
  "gw-econ-1": { provider: "deepseek", model: "deepseek-chat", chat: true, inputMicrosPerM: 270_000, outputMicrosPerM: 1_100_000 },
  "gw-local-1": { provider: "local", model: "llama3.2", chat: true, inputMicrosPerM: 0, outputMicrosPerM: 0 },
  "gw-embed-1": { provider: "local", model: "nomic-embed-text", chat: false, inputMicrosPerM: 0, outputMicrosPerM: 0 },
};

/** The real cost of a call from the tokens the provider counted. */
export const costOfNative = (model: NativeModel, inputTokens: number, outputTokens: number): number =>
  Math.ceil((inputTokens * model.inputMicrosPerM + outputTokens * model.outputMicrosPerM) / 1_000_000);
