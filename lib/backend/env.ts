// Environment Manager: which environment the platform runs in (Development, Preview or Production), which variables each one needs, and what is
// allowed in each. It reads variables from a source it is given (never from the global scope on its own), reports only NAMES (never a value) and
// never throws: a missing variable is a finding to fix, not a crash. Secrets are described here and read through secrets.ts.

export const ENVIRONMENTS = ["development", "preview", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];
export const isEnvironment = (value: unknown): value is Environment => typeof value === "string" && (ENVIRONMENTS as readonly string[]).includes(value);

/** public: may be shown to the browser. server: only on the server. secret: only on the server, only through the Secrets Manager. */
export type VarScope = "public" | "server" | "secret";
export type VarSpec = { name: string; scope: VarScope; required: readonly Environment[]; description: string; pattern?: RegExp };

const HTTPS_OR_LOCAL = /^(https:\/\/[^\s]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?)$/;
const BASE64_32_BYTES = /^[A-Za-z0-9+/]{43}=$/;

export const ENV_SPEC: readonly VarSpec[] = [
  { name: "KYNOVA_ENV", scope: "server", required: [], description: "Entorno explícito. Si falta, se deduce.", pattern: /^(development|preview|production)$/ },
  { name: "SUPABASE_URL", scope: "server", required: ["preview", "production"], description: "Dirección del proyecto de Supabase de este entorno.", pattern: HTTPS_OR_LOCAL },
  { name: "SUPABASE_PUBLISHABLE_KEY", scope: "public", required: ["preview", "production"], description: "Llave publicable de Supabase (la que protege el RLS, no un secreto).", pattern: /^\S{20,}$/ },
  { name: "SUPABASE_SERVICE_ROLE_KEY", scope: "secret", required: [], description: "Llave de servicio de Supabase. Se evita: salta el RLS. Solo servidor y solo con una razón escrita.", pattern: /^\S{20,}$/ },
  { name: "KYNOVA_ENCRYPTION_KEY", scope: "secret", required: ["production"], description: "Llave AES-256 (32 bytes en base64) para cifrar datos sensibles.", pattern: BASE64_32_BYTES },
  { name: "KYNOVA_HASH_PEPPER", scope: "secret", required: ["production"], description: "Pimienta del hash de tokens y llaves (mínimo 32 caracteres).", pattern: /^\S{32,}$/ },
  { name: "KYNOVA_LOG_LEVEL", scope: "server", required: [], description: "Nivel mínimo de log.", pattern: /^(debug|info|warn|error)$/ },
  { name: "KYNOVA_TRACE_SAMPLE", scope: "server", required: [], description: "Fracción de trazas que se conserva (0 a 1).", pattern: /^(0|1|0?\.\d+)$/ },
];

export type EnvSource = Readonly<Record<string, string | undefined>>;

/** Which environment this is. An explicit value wins; a production build without one is treated as production (the strictest). */
export function detectEnvironment(source: EnvSource): Environment {
  const explicit = source["KYNOVA_ENV"]?.trim();
  if (isEnvironment(explicit)) return explicit;
  if (source["NODE_ENV"] === "production") return "production";
  return "development";
}

export type EnvReport = { environment: Environment; ok: boolean; missing: string[]; invalid: string[]; warnings: string[] };

// A name that says it is a secret must never be exposed to the browser through the public prefix.
const SECRET_LOOKING = /(KEY|SECRET|TOKEN|PASSWORD|SERVICE_ROLE|PEPPER)/i;

/** Checks the variables of an environment. The report holds names and reasons only: never a value. */
export function validateEnvironment(source: EnvSource, environment: Environment = detectEnvironment(source)): EnvReport {
  const missing: string[] = [];
  const invalid: string[] = [];
  const warnings: string[] = [];
  for (const spec of ENV_SPEC) {
    const value = source[spec.name]?.trim();
    if (!value) {
      if (spec.required.includes(environment)) missing.push(spec.name);
      continue;
    }
    if (spec.pattern && !spec.pattern.test(value)) invalid.push(spec.name);
  }
  for (const name of Object.keys(source)) {
    if (name.startsWith("NEXT_PUBLIC_") && SECRET_LOOKING.test(name)) invalid.push(`${name} (un secreto no puede ir al navegador)`);
  }
  if (environment === "production" && source["SUPABASE_SERVICE_ROLE_KEY"]?.trim()) warnings.push("SUPABASE_SERVICE_ROLE_KEY está configurada en producción: salta el RLS; úsela solo con una razón escrita");
  if (environment !== "production" && source["KYNOVA_ENCRYPTION_KEY"]?.trim() && source["KYNOVA_ENV"] === undefined) warnings.push("hay una llave de cifrado pero KYNOVA_ENV no está definida: el entorno se dedujo");
  return { environment, ok: missing.length === 0 && invalid.length === 0, missing, invalid, warnings };
}

export type EnvironmentPolicy = {
  /** Sample data may be used. */
  demoData: boolean;
  /** Real customer data may be stored. False everywhere until the gates of ADR-0006 and the production approval are met. */
  realData: boolean;
  verboseErrors: boolean;
  defaultLogLevel: "debug" | "info" | "warn" | "error";
  traceSample: number;
  /** Row Level Security is only enforced where it has been activated: nowhere yet (see rls.ts). */
  rlsEnforced: boolean;
};

export const ENVIRONMENT_POLICIES: Record<Environment, EnvironmentPolicy> = {
  development: { demoData: true, realData: false, verboseErrors: true, defaultLogLevel: "debug", traceSample: 1, rlsEnforced: false },
  preview: { demoData: true, realData: false, verboseErrors: false, defaultLogLevel: "info", traceSample: 0.5, rlsEnforced: false },
  production: { demoData: false, realData: false, verboseErrors: false, defaultLogLevel: "warn", traceSample: 0.05, rlsEnforced: false },
};

export type BackendConfig = {
  environment: Environment;
  policy: EnvironmentPolicy;
  supabase: { url: string; publishableKey: string } | null;
  /** Whether a service key is configured. The key itself is only ever read through the Secrets Manager. */
  serviceKeyConfigured: boolean;
  logLevel: EnvironmentPolicy["defaultLogLevel"];
  traceSample: number;
  report: EnvReport;
};

/** The configuration of the platform, built from a source of variables. Never throws and never holds a secret. */
export function loadConfig(source: EnvSource): BackendConfig {
  const report = validateEnvironment(source);
  const policy = ENVIRONMENT_POLICIES[report.environment];
  const url = source["SUPABASE_URL"]?.trim();
  const key = source["SUPABASE_PUBLISHABLE_KEY"]?.trim();
  const valid = (name: string) => !report.invalid.includes(name);
  const level = source["KYNOVA_LOG_LEVEL"]?.trim();
  const sample = Number(source["KYNOVA_TRACE_SAMPLE"]);
  return {
    environment: report.environment,
    policy,
    supabase: url && key && valid("SUPABASE_URL") && valid("SUPABASE_PUBLISHABLE_KEY") ? { url, publishableKey: key } : null,
    serviceKeyConfigured: Boolean(source["SUPABASE_SERVICE_ROLE_KEY"]?.trim()),
    logLevel: level === "debug" || level === "info" || level === "warn" || level === "error" ? level : policy.defaultLogLevel,
    traceSample: source["KYNOVA_TRACE_SAMPLE"] && Number.isFinite(sample) && sample >= 0 && sample <= 1 ? sample : policy.traceSample,
    report,
  };
}

/** The names of the variables that are secrets: the only ones the Secrets Manager will hand out. */
export const SECRET_NAMES: readonly string[] = ENV_SPEC.filter((item) => item.scope === "secret").map((item) => item.name);
