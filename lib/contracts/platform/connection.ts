// A company's connection to one provider: status, configuration, permissions, logs, errors and audit, plus the pure rules
// for activating and deactivating it. No provider is called here; adapters will feed events into this model.

import {
  EXTERNAL_EFFECTS,
  PROVIDER_MANIFESTS,
  canTransitionConnection,
  type Capability,
  type ConnectionStatus,
  type ProviderId,
} from "./integrations";

// ---------------------------------------------------------------- configuration
// Configuration holds only NON-secret settings. Secrets are referenced (secretRef), never stored here (ADR-0010 P4).
export type ConfigField = { key: string; label: string; kind: "text" | "select" | "toggle" | "secretRef"; required: boolean; options?: readonly string[]; help?: string };

const COMMON_FIELDS: readonly ConfigField[] = [{ key: "displayName", label: "Nombre visible", kind: "text", required: true }];

export const CONFIG_FIELDS: Record<ProviderId, readonly ConfigField[]> = {
  webChat: [...COMMON_FIELDS, { key: "greeting", label: "Saludo", kind: "text", required: false }],
  whatsapp: [...COMMON_FIELDS, { key: "phoneNumberId", label: "Identificador del número", kind: "text", required: true }, { key: "credential", label: "Credencial", kind: "secretRef", required: true }],
  facebook: [...COMMON_FIELDS, { key: "pageId", label: "Identificador de la página", kind: "text", required: true }, { key: "credential", label: "Credencial", kind: "secretRef", required: true }],
  instagram: [...COMMON_FIELDS, { key: "accountId", label: "Cuenta profesional", kind: "text", required: true }, { key: "credential", label: "Credencial", kind: "secretRef", required: true }],
  email: [...COMMON_FIELDS, { key: "address", label: "Dirección de correo", kind: "text", required: true }, { key: "credential", label: "Credencial", kind: "secretRef", required: true }],
  stripe: [...COMMON_FIELDS, { key: "mode", label: "Modo", kind: "select", required: true, options: ["test", "live"] }, { key: "credential", label: "Credencial", kind: "secretRef", required: true }],
  paypal: [...COMMON_FIELDS, { key: "mode", label: "Modo", kind: "select", required: true, options: ["sandbox", "live"] }, { key: "credential", label: "Credencial", kind: "secretRef", required: true }],
  bankTransfer: [...COMMON_FIELDS, { key: "accountAlias", label: "Alias de la cuenta receptora", kind: "text", required: true }, { key: "reconciliation", label: "Conciliación", kind: "select", required: true, options: ["manual", "asistida"] }],
  crypto: [...COMMON_FIELDS],
  makapay: [...COMMON_FIELDS],
  makawallet: [...COMMON_FIELDS],
  sinpe: [...COMMON_FIELDS, { key: "reconciliation", label: "Conciliación", kind: "select", required: true, options: ["manual", "asistida"] }],
  googleCalendar: [...COMMON_FIELDS, { key: "calendarId", label: "Calendario", kind: "text", required: true }, { key: "credential", label: "Credencial", kind: "secretRef", required: true }],
};

export type ConfigValues = Record<string, string | boolean>;

/** Missing or malformed settings. A secretRef must be a reference (`secret:name`), never a raw secret. */
export function validateConfig(provider: ProviderId, values: ConfigValues): string[] {
  const issues: string[] = [];
  for (const field of CONFIG_FIELDS[provider]) {
    const value = values[field.key];
    const empty = value === undefined || value === "" || value === false;
    if (field.required && empty && field.kind !== "toggle") issues.push(`${field.label} es obligatorio`);
    else if (!empty && field.kind === "select" && !field.options?.includes(String(value))) issues.push(`${field.label} tiene un valor no válido`);
    else if (!empty && field.kind === "secretRef" && !/^secret:[a-z0-9][a-z0-9-_]{1,62}$/.test(String(value))) issues.push(`${field.label} debe ser una referencia (secret:nombre), nunca el secreto`);
  }
  return issues;
}

// ---------------------------------------------------------------- permissions
// What the company lets this connection do. Only capabilities the provider declares can be granted; external effects
// are granted as "approval" (a person confirms each one) and never as unattended.
export type Grant = "off" | "approval" | "auto";
export type Permissions = Partial<Record<Capability, Grant>>;

export const grantsAllowed = (capability: Capability): readonly Grant[] => (EXTERNAL_EFFECTS.includes(capability) ? ["off", "approval"] : ["off", "auto"]);

export function validatePermissions(provider: ProviderId, permissions: Permissions): string[] {
  const manifest = PROVIDER_MANIFESTS[provider];
  const issues: string[] = [];
  for (const [capability, grant] of Object.entries(permissions) as [Capability, Grant][]) {
    if (!manifest.capabilities.includes(capability)) issues.push(`${capability}: el proveedor no lo ofrece`);
    else if (!grantsAllowed(capability).includes(grant)) issues.push(`${capability}: ${grant} no está permitido`);
  }
  return issues;
}

/** Everything off until a person turns something on: the safe starting point. */
export const defaultPermissions = (provider: ProviderId): Permissions =>
  Object.fromEntries(PROVIDER_MANIFESTS[provider].capabilities.map((capability) => [capability, "off" as Grant]));

// ---------------------------------------------------------------- logs, errors, audit
export const LOG_LEVELS = ["info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type ConnectionLog = { at: string; level: LogLevel; event: string; detail?: string };

export const ERROR_KINDS = ["auth", "rateLimit", "provider", "network", "config", "unknown"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];
export type ConnectionError = { at: string; kind: ErrorKind; message: string; retryable: boolean };

/** Whether an error is worth retrying by itself. Auth and config errors need a person. */
export const isRetryable = (kind: ErrorKind): boolean => kind === "rateLimit" || kind === "provider" || kind === "network";

export const AUDIT_ACTIONS = ["connect", "configure", "setPermissions", "activate", "deactivate", "revoke", "error"] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
// The audit trail records who changed what, never the values of secrets or message content.
export type ConnectionAudit = { at: string; actor: string; action: AuditAction; detail?: string };

// ---------------------------------------------------------------- the record
export type Connection = {
  provider: ProviderId;
  status: ConnectionStatus;
  enabled: boolean;
  config: ConfigValues;
  permissions: Permissions;
  logs: readonly ConnectionLog[];
  errors: readonly ConnectionError[];
  audit: readonly ConnectionAudit[];
};

export const newConnection = (provider: ProviderId): Connection => ({ provider, status: "notConnected", enabled: false, config: {}, permissions: defaultPermissions(provider), logs: [], errors: [], audit: [] });

// Logs, errors and the audit trail are never trimmed; limits belong to the view (display.ts).
const keep = <T,>(items: readonly T[], item: T): readonly T[] => [...items, item];

export type ConnectionEvent =
  | { type: "configure"; actor: string; at: string; config: ConfigValues }
  | { type: "setPermissions"; actor: string; at: string; permissions: Permissions }
  | { type: "activate"; actor: string; at: string }
  | { type: "deactivate"; actor: string; at: string }
  | { type: "revoke"; actor: string; at: string }
  | { type: "fail"; at: string; kind: ErrorKind; message: string };

export type ReduceResult = { connection: Connection; error?: string };

const audited = (connection: Connection, at: string, actor: string, action: AuditAction, detail?: string): Connection => ({ ...connection, audit: keep(connection.audit, { at, actor, action, detail }) });
const logged = (connection: Connection, at: string, level: LogLevel, event: string, detail?: string): Connection => ({ ...connection, logs: keep(connection.logs, { at, level, event, detail }) });

/**
 * The only way a connection changes. Returns the new record or an explanation of why the change is refused:
 * activation needs a valid configuration, and a provider whose API is still pending can never be activated.
 */
export function reduce(connection: Connection, event: ConnectionEvent): ReduceResult {
  const manifest = PROVIDER_MANIFESTS[connection.provider];
  const refuse = (error: string): ReduceResult => ({ connection, error });

  switch (event.type) {
    case "configure": {
      if (connection.status === "revoked") return refuse("La conexión fue revocada: vuelva a conectarla.");
      const issues = validateConfig(connection.provider, event.config);
      const status: ConnectionStatus = connection.status === "notConnected" ? "pending" : connection.status;
      const next = { ...connection, config: event.config, status };
      // Saving an incomplete form is allowed (it is a draft); activation is what demands completeness.
      return { connection: logged(audited(next, event.at, event.actor, connection.status === "notConnected" ? "connect" : "configure"), event.at, "info", "Configuración guardada", issues.length ? `${issues.length} pendientes` : undefined) };
    }
    case "setPermissions": {
      const issues = validatePermissions(connection.provider, event.permissions);
      if (issues.length) return refuse(issues[0]);
      return { connection: logged(audited({ ...connection, permissions: { ...connection.permissions, ...event.permissions } }, event.at, event.actor, "setPermissions"), event.at, "info", "Permisos actualizados") };
    }
    case "activate": {
      if (manifest.authKinds.includes("undefined")) return refuse(`${manifest.label} no puede activarse: falta su documentación técnica.`);
      if (!canTransitionConnection(connection.status, "active")) return refuse("La conexión no está lista para activarse.");
      const issues = validateConfig(connection.provider, connection.config);
      if (issues.length) return refuse(issues[0]);
      return { connection: logged(audited({ ...connection, status: "active", enabled: true }, event.at, event.actor, "activate"), event.at, "info", "Conexión activada") };
    }
    case "deactivate": {
      if (connection.status !== "active" && connection.status !== "degraded") return refuse("La conexión no está activa.");
      return { connection: logged(audited({ ...connection, status: "paused", enabled: false }, event.at, event.actor, "deactivate"), event.at, "info", "Conexión pausada") };
    }
    case "revoke": {
      if (!canTransitionConnection(connection.status, "revoked")) return refuse("Esta conexión no puede revocarse en su estado actual.");
      return { connection: logged(audited({ ...connection, status: "revoked", enabled: false }, event.at, event.actor, "revoke"), event.at, "warn", "Conexión revocada") };
    }
    case "fail": {
      const retryable = isRetryable(event.kind);
      const target: ConnectionStatus = retryable && connection.status === "active" ? "degraded" : "error";
      const status = canTransitionConnection(connection.status, target) ? target : connection.status;
      const next = { ...connection, status, enabled: status === "error" ? false : connection.enabled, errors: keep(connection.errors, { at: event.at, kind: event.kind, message: event.message, retryable }) };
      return { connection: logged(audited(next, event.at, "system", "error", event.kind), event.at, "error", event.message) };
    }
  }
}

/** Why a connection cannot be activated yet, or an empty list when it can. Used to explain a disabled button. */
export function activationBlockers(connection: Connection): string[] {
  const manifest = PROVIDER_MANIFESTS[connection.provider];
  if (manifest.authKinds.includes("undefined")) return [`Falta la documentación técnica de ${manifest.label}`];
  if (connection.status === "revoked") return ["La conexión fue revocada"];
  return validateConfig(connection.provider, connection.config);
}
