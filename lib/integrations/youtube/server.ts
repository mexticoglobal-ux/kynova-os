// Wires the YouTube connection to the server's environment (ADR-0038): the Google credentials and the encryption key come only through the Secrets Manager, the database through the SERVER client.
// Nothing here runs in the browser, and a missing credential never becomes a simulated answer: the connection simply cannot start and the screen says which names to configure.

import { randomToken, sha256Hex } from "@/lib/backend/crypto";
import { loadConfig, type EnvSource } from "@/lib/backend/env";
import { EnvSecretsProvider, SecretsManager } from "@/lib/backend/secrets";
import { createLazyConnectorStore } from "@/lib/db/connector-connections";
import { SupabaseClients } from "@/lib/db/core-clients";
import type { Fetcher } from "./google";
import type { YoutubeConfig, YoutubeDeps } from "./connection";

/** The names a real connection needs, and which of them this environment lacks. Names only: a value is never read here. */
export function youtubeSetup(vars: EnvSource): { configured: boolean; missing: string[] } {
  const secrets = new SecretsManager(new EnvSecretsProvider(vars));
  const missing: string[] = [];
  if (!vars.GOOGLE_CLIENT_ID?.trim()) missing.push("GOOGLE_CLIENT_ID");
  if (!secrets.has("GOOGLE_CLIENT_SECRET")) missing.push("GOOGLE_CLIENT_SECRET");
  if (!secrets.has("KYNOVA_ENCRYPTION_KEY")) missing.push("KYNOVA_ENCRYPTION_KEY");
  if (!secrets.has("SUPABASE_SERVICE_ROLE_KEY")) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return { configured: missing.length === 0, missing };
}

/** The parts of the connection for this environment. `fetcher` is for tests. */
export async function youtubeDepsFromEnv(vars: EnvSource, fetcher: Fetcher = (input, init) => fetch(input, init)): Promise<YoutubeDeps> {
  const setup = youtubeSetup(vars);
  const secrets = new SecretsManager(new EnvSecretsProvider(vars));
  const clients = new SupabaseClients(loadConfig(vars), secrets);
  let config: YoutubeConfig | null = null;
  if (setup.configured) {
    const clientId = (vars.GOOGLE_CLIENT_ID as string).trim();
    config = await secrets.use("GOOGLE_CLIENT_SECRET", "conexión de YouTube: intercambio de la autorización", (clientSecret) =>
      secrets.use("KYNOVA_ENCRYPTION_KEY", "conexión de YouTube: cifrado del permiso renovable", (encryptionKey) => ({ clientId, clientSecret, encryptionKey })));
  }
  return { config, missing: setup.missing, store: createLazyConnectorStore(() => clients.serviceClient()), fetcher, newState: () => randomToken(32), sha256Hex };
}
