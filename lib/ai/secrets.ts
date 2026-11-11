// The secrets of the providers. A key lives in Wrangler (or GitHub) secrets, never in the repository, a log or a prompt, and is read only through the Backend Core's Secrets
// Manager: by name, from an allow-list that is THIS list, and only for the moment of a call (the access is recorded by name and purpose, never by value). The Secrets
// Manager classes are the core's; the names of the provider secrets are defined here, in lib/ai, because the core names no provider.

import type { EnvSource } from "@/lib/backend/env";
import { EnvSecretsProvider, SecretsManager } from "@/lib/backend/secrets";
import { PROVIDER_REGISTRY } from "./providers";

/** Every secret a provider needs, by name. */
export const AI_SECRET_NAMES: readonly string[] = [...new Set(Object.values(PROVIDER_REGISTRY).flatMap((config) => (config.secret ? [config.secret] : [])))];
/** Values that configure a provider but are not secrets (the address of a local model). */
export const AI_CONFIG_NAMES: readonly string[] = [...new Set(Object.values(PROVIDER_REGISTRY).flatMap((config) => (config.addressName ? [config.addressName] : [])))];

/** The one door to the provider secrets. Only the names above can be read through it. */
export function aiSecrets(env: EnvSource, clock?: () => string): SecretsManager {
  return new SecretsManager(new EnvSecretsProvider(env, [...AI_SECRET_NAMES, ...AI_CONFIG_NAMES]), clock);
}

export type ProviderReadiness = { providerId: string; connected: boolean; configured: boolean; usable: boolean; needs: string };

/** Which providers can be called now, by name only: connected in the registry AND configured. A prepared provider is never usable. */
export function providerReadiness(secrets: SecretsManager): ProviderReadiness[] {
  return Object.entries(PROVIDER_REGISTRY).map(([providerId, config]) => {
    const needs = config.secret ?? config.addressName ?? "";
    const configured = needs === "" ? true : secrets.has(needs);
    return { providerId, connected: config.connected, configured, usable: config.connected && configured, needs };
  });
}
