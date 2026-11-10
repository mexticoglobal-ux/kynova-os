// AI Gateway, catalog: the DATA the Gateway works from. The providers (all SIMULATED adapters), which provider serves each model, the retry and circuit-breaker
// limits and the architecture of the cache. The Gateway decides the provider, the model (from the list it is handed), the fallback, the retry, the timeout and what
// to observe. It never decides a Worker, a specialty or a policy, and it does not know them: it receives a narrow request from KOE (see gateway-engine.ts).
// This is the only file that names a provider. Nothing here calls anything: there is no network, no credential and no real model.

import { MODEL_REGISTRY } from "./ai-model-registry";

// ---------------------------------------------------------------- providers (simulated adapters: they never leave the process)
export const PROVIDER_KINDS = ["cloud", "aggregator", "local"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export type GatewayProvider = { id: string; label: string; kind: ProviderKind; regions: readonly string[]; simulated: true; note: string };

const provider = (id: string, label: string, kind: ProviderKind, regions: string[], note: string): GatewayProvider => ({ id, label, kind, regions, simulated: true, note });

export const GATEWAY_PROVIDERS: readonly GatewayProvider[] = [
  provider("openai", "OpenAI", "cloud", ["us", "eu"], "Adaptador simulado. Sin conexión ni credencial."),
  provider("anthropic", "Anthropic", "cloud", ["us", "eu"], "Adaptador simulado. Sin conexión ni credencial."),
  provider("google", "Google", "cloud", ["us", "eu"], "Adaptador simulado. Sin conexión ni credencial."),
  provider("mistral", "Mistral", "cloud", ["eu"], "Adaptador simulado. Sin conexión ni credencial."),
  provider("grok", "Grok", "cloud", ["us"], "Adaptador simulado. Sin conexión ni credencial."),
  provider("deepseek", "DeepSeek", "cloud", ["asia"], "Adaptador simulado. Sin conexión ni credencial."),
  provider("openrouter", "OpenRouter", "aggregator", ["us", "eu"], "Adaptador simulado. Sin conexión ni credencial."),
  provider("local", "Modelos locales", "local", ["us", "eu", "asia"], "Adaptador simulado. Los datos no salen de la infraestructura de la plataforma."),
];
export const PROVIDER_IDS = GATEWAY_PROVIDERS.map((item) => item.id);
export const providerById = (id: string): GatewayProvider | undefined => GATEWAY_PROVIDERS.find((item) => item.id === id);

/** Which provider serves each model. The registry says what a model is; only the Gateway knows who serves it. */
export const MODEL_PROVIDER: Readonly<Record<string, string>> = {
  "gw-fast-1": "openai", "gw-reason-1": "anthropic", "gw-balanced-1": "google", "gw-eu-1": "mistral", "gw-live-1": "grok",
  "gw-econ-1": "deepseek", "gw-route-1": "openrouter", "gw-local-1": "local", "gw-embed-1": "local",
};
export const providerOf = (modelId: string): string | undefined => MODEL_PROVIDER[modelId];
/** The models of the registry that no provider serves, and the entries that name a model the registry does not have. Both must be empty. */
export const providerGaps = (): string[] => [
  ...MODEL_REGISTRY.filter((item) => !providerById(MODEL_PROVIDER[item.id] ?? "")).map((item) => item.id),
  ...Object.keys(MODEL_PROVIDER).filter((id) => !MODEL_REGISTRY.some((item) => item.id === id)),
];

export { GATEWAY_CEILINGS, GATEWAY_LIMIT_DEFAULTS, validateGatewayLimits, type GatewayLimits } from "./ai-limits";

// ---------------------------------------------------------------- cache (ARCHITECTURE only: nothing is stored today)
export const CACHE_ARCHITECTURE = {
  implemented: false,
  scope: "tenant", // an entry is never shared between companies
  keyParts: ["tenantId", "cacheScope", "modelId", "promptHash"], // `cacheScope` is an opaque label KOE hands over; the Gateway never reads it
  layers: [
    { id: "exact", description: "La misma instrucción, con los mismos datos, para la misma empresa: respuesta idéntica.", ttlSeconds: 3_600 },
    { id: "semantic", description: "Una pregunta equivalente (por embeddings) para la misma empresa. Futuro: necesita el modelo de embeddings.", ttlSeconds: 86_400 },
  ],
  neverCache: ["datos personales", "credenciales", "propósitos no cacheables", "respuestas con herramientas que actúan"],
  invalidatedBy: ["cambio del prompt del negocio", "cambio de política o de modelos permitidos", "cambio del contenido aprobado"],
} as const;
