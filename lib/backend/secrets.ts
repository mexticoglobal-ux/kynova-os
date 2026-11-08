// Secrets Manager: the one door to every secret. A secret lives in Wrangler or GitHub secrets (never in the repository, a log or a prompt) and is read
// only here, only by name, only from an allow-list, and only for the moment it is used. Reading is recorded by NAME (never by value). Rotation is
// tracked so an old secret is flagged. Nothing here talks to a network: a provider is anything that can answer `get(name)`.
import { SECRET_NAMES, type EnvSource } from "./env";

export interface SecretsProvider {
  get(name: string): string | undefined;
  names(): readonly string[];
}

/** Reads secrets from a source of variables (the Worker bindings), and only the names in the allow-list. */
export class EnvSecretsProvider implements SecretsProvider {
  constructor(private readonly source: EnvSource, private readonly allowed: readonly string[] = SECRET_NAMES) {}
  get(name: string): string | undefined {
    if (!this.allowed.includes(name)) return undefined;
    const value = this.source[name]?.trim();
    return value ? value : undefined;
  }
  names(): readonly string[] {
    return this.allowed.filter((name) => this.get(name) !== undefined);
  }
}

/** A provider for tests: nothing is read from the environment. */
export class MemorySecretsProvider implements SecretsProvider {
  constructor(private readonly values: Readonly<Record<string, string>>) {}
  get(name: string): string | undefined {
    return this.values[name];
  }
  names(): readonly string[] {
    return Object.keys(this.values);
  }
}

export class SecretMissingError extends Error {
  constructor(readonly secretName: string) {
    super(`Falta el secreto ${secretName}. Configúrelo en los secretos de Wrangler o de GitHub, nunca en el código.`);
    this.name = "SecretMissingError";
  }
}

export type SecretAccess = { name: string; at: string; purpose: string };

export class SecretsManager {
  private readonly accesses: SecretAccess[] = [];
  constructor(private readonly provider: SecretsProvider, private readonly clock: () => string = () => new Date().toISOString()) {}

  has(name: string): boolean {
    return this.provider.get(name) !== undefined;
  }

  /** Hands the secret to a function for the moment it is used. The access is recorded by name and purpose, never by value. */
  async use<T>(name: string, purpose: string, work: (secret: string) => Promise<T> | T): Promise<T> {
    const secret = this.provider.get(name);
    if (secret === undefined) throw new SecretMissingError(name);
    this.accesses.push({ name, at: this.clock(), purpose });
    return work(secret);
  }

  /** Which secrets were used, when and why. Values are never part of it. */
  accessLog(): readonly SecretAccess[] {
    return [...this.accesses];
  }

  /** The names of the secrets that are configured. */
  configured(): readonly string[] {
    return this.provider.names();
  }
}

// ---------------------------------------------------------------- rotation
export type SecretMeta = { name: string; rotatedAt: string; maxAgeDays: number };
const DAY = 86_400_000;
/** The secrets whose last rotation is older than their limit. */
export const secretsDue = (metas: readonly SecretMeta[], now: string): string[] => metas.filter((item) => Date.parse(now) - Date.parse(item.rotatedAt) > item.maxAgeDays * DAY).map((item) => item.name);

// ---------------------------------------------------------------- recognizing and hiding a secret
const SECRET_PATTERNS: readonly RegExp[] = [
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // a JWT
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, // a payment or API key
  /\bAKIA[0-9A-Z]{16}\b/g, // an AWS key id
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}\b/g, // a Supabase key
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g,
];
// An assignment to a name that says it is a secret, with a long value.
const SECRET_ASSIGNMENT = /\b([A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_?KEY|SERVICE_ROLE|PRIVATE_KEY)[A-Za-z0-9_]*)\s*[:=]\s*["']?([A-Za-z0-9+/_.=-]{24,})["']?/gi;

export const looksLikeSecret = (text: string): boolean => {
  SECRET_ASSIGNMENT.lastIndex = 0;
  return SECRET_PATTERNS.some((pattern) => new RegExp(pattern.source, "").test(text)) || SECRET_ASSIGNMENT.test(text);
};

/** Replaces anything that looks like a secret, so a log, a trace or an error message can never carry one. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[secreto]");
  return out.replace(SECRET_ASSIGNMENT, (_all, name: string) => `${name}=[secreto]`);
}

/** A value shown to a person without giving it away: the first two and last two characters, or dots when it is short. */
export const maskSecret = (value: string): string => (value.length < 12 ? "••••" : `${value.slice(0, 2)}••••${value.slice(-2)}`);
