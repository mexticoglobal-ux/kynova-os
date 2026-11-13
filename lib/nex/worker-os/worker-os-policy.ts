// Worker OS Policy: the rules a Worker's definition and a request about it must satisfy. It validates capabilities, skills, tools, permissions, version, company and status; keeps the three kinds of
// grant apart (capabilities are catalog words like `read`, tools are catalog names like `CRM`, permissions are action ids like `crm.read`, `crm.*` or `*`: a permission can never be spelled like a
// capability or a tool); refuses anything outside the schema; and decides compatibility among the worker version, the runtime version, the platform version and each capability version.
// An incompatibility BLOCKS the worker. `evaluateRequest` answers "may this worker be given this?" and runs nothing. Pure.

import { capabilityCompatible, checkCapabilities, provides, type Checked } from "./worker-os-capabilities";
import { checkSkills } from "./worker-os-skills";
import { checkTools } from "./worker-os-tools";
import { SPECIALTIES, compareVersions, parseVersion, type Capability, type Limits, type PolicyDecision, type PolicyRequest, type WorkerConfigLike, type WorkerDefinition, type WorkerInput } from "./worker-os-types";

const SAFE = /^[A-Za-z0-9_.:-]{1,60}$/;
/** `*`, an action family (`crm.*`) or an action (`crm.read`): at least one dot or a star, lowercase. Never a bare word such as `read` or `CRM`. */
const PERMISSION = /^(\*|[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)*\.\*|[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+)$/;

/** `*`, the exact action id, or its family (`crm.*`). */
export const permits = (permissions: readonly string[], action: string): boolean => permissions.some((entry) => entry === "*" || entry === action || (entry.endsWith(".*") && action.startsWith(entry.slice(0, -1))));

export function checkPermissions(list: unknown): Checked<string[]> {
  if (!Array.isArray(list) || list.length > 100) return { ok: false, error: "permissions.shape" };
  const seen = new Set<string>();
  for (const entry of list as unknown[]) {
    if (typeof entry !== "string" || entry.length > 80 || !PERMISSION.test(entry)) return { ok: false, error: "permissions.format" };
    if (seen.has(entry)) return { ok: false, error: "permissions.duplicate" };
    seen.add(entry);
  }
  return { ok: true, value: [...seen].sort() };
}

const LIMIT_RANGES: Readonly<Record<keyof Limits, readonly [number, number]>> = { maxConcurrent: [1, 64], queueLimit: [0, 1_000], timeoutMs: [1_000, 3_600_000], maxActionsPerDay: [0, 100_000] };
export function checkLimits(value: unknown): Checked<Limits> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false, error: "limits.shape" };
  const keys = Object.keys(value);
  const names = Object.keys(LIMIT_RANGES) as (keyof Limits)[];
  if (keys.length !== names.length || !names.every((name) => keys.includes(name))) return { ok: false, error: "limits.schema" };
  const row = value as Record<string, unknown>;
  for (const name of names) {
    const entry = row[name];
    const [min, max] = LIMIT_RANGES[name];
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry < min || entry > max) return { ok: false, error: `limits.${name}` };
  }
  return { ok: true, value: { maxConcurrent: row["maxConcurrent"] as number, queueLimit: row["queueLimit"] as number, timeoutMs: row["timeoutMs"] as number, maxActionsPerDay: row["maxActionsPerDay"] as number } };
}
export const checkSpecialty = (value: unknown): boolean => typeof value === "string" && (SPECIALTIES as readonly string[]).includes(value);
const safe = (value: unknown): value is string => typeof value === "string" && SAFE.test(value);
const hasOnly = (value: object, keys: readonly string[]): boolean => Object.keys(value).every((key) => keys.includes(key));

/** The four versions that must agree with the platform: the worker's own, the runtime it needs, the platform it needs and each capability's version. Empty = compatible. */
export function compatibility(release: { version: string; runtimeVersion: string; platformVersion: string }, capabilities: readonly Capability[], config: WorkerConfigLike): string[] {
  const issues: string[] = [];
  if (compareVersions(release.version, config.minWorkerVersion) < 0) issues.push("workerVersion");
  if (!provides(config.runtimeVersion, release.runtimeVersion)) issues.push("runtimeVersion");
  if (!provides(config.platformVersion, release.platformVersion)) issues.push("platformVersion");
  for (const capability of capabilities) if (!capabilityCompatible(capability)) issues.push(`capabilityVersion:${capability.id}`);
  return issues;
}
export const statusFor = (issues: readonly string[]): "Active" | "Blocked" => (issues.length === 0 ? "Active" : "Blocked");

export const INPUT_KEYS = ["workerId", "companyId", "version", "build", "runtimeVersion", "platformVersion", "specialty", "capabilities", "skills", "tools", "permissions", "limits"] as const;
export type Validated = { ok: true; definition: WorkerInput; issues: string[] } | { ok: false; errors: string[] };
/** The whole schema check of a new worker: exact fields, catalog words, valid versions, no mixing, no duplicates. Returns the normalized definition and its compatibility issues. */
export function validateDefinition(input: unknown, config: WorkerConfigLike): Validated {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, errors: ["shape"] };
  const errors: string[] = [];
  const row = input as Record<string, unknown>;
  for (const key of Object.keys(row)) if (!(INPUT_KEYS as readonly string[]).includes(key)) errors.push(`outsideSchema:${SAFE.test(key) ? key : "?"}`);
  for (const key of INPUT_KEYS) if (!(key in row)) errors.push(`missing:${key}`);
  if (errors.length > 0) return { ok: false, errors };
  if (!safe(row["workerId"])) errors.push("workerId");
  if (!safe(row["companyId"])) errors.push("companyId");
  if (typeof row["version"] !== "string" || !parseVersion(row["version"])) errors.push("version");
  if (!safe(row["build"])) errors.push("build");
  if (typeof row["runtimeVersion"] !== "string" || !parseVersion(row["runtimeVersion"])) errors.push("runtimeVersion");
  if (typeof row["platformVersion"] !== "string" || !parseVersion(row["platformVersion"])) errors.push("platformVersion");
  if (!checkSpecialty(row["specialty"])) errors.push("specialty");
  const capabilities = checkCapabilities(row["capabilities"]);
  const skills = checkSkills(row["skills"]);
  const tools = checkTools(row["tools"]);
  const permissions = checkPermissions(row["permissions"]);
  const limits = checkLimits(row["limits"]);
  for (const checked of [capabilities, skills, tools, permissions, limits]) if (!checked.ok) errors.push(checked.error);
  if (errors.length > 0 || !capabilities.ok || !skills.ok || !tools.ok || !permissions.ok || !limits.ok) return { ok: false, errors };
  const definition: WorkerInput = {
    workerId: row["workerId"] as string, companyId: row["companyId"] as string, version: row["version"] as string, build: row["build"] as string, runtimeVersion: row["runtimeVersion"] as string,
    platformVersion: row["platformVersion"] as string, specialty: row["specialty"] as string, capabilities: capabilities.value, skills: skills.value, tools: tools.value, permissions: permissions.value, limits: limits.value,
  };
  return { ok: true, definition, issues: compatibility(definition, definition.capabilities, config) };
}
export const checkTarget = (value: unknown): value is { version: string; build: string; runtimeVersion: string; platformVersion: string } =>
  typeof value === "object" && value !== null && !Array.isArray(value) && hasOnly(value, ["version", "build", "runtimeVersion", "platformVersion"]) && Object.keys(value).length === 4 &&
  typeof (value as Record<string, unknown>)["version"] === "string" && parseVersion((value as Record<string, string>)["version"] as string) !== undefined && safe((value as Record<string, unknown>)["build"]) &&
  parseVersion(String((value as Record<string, unknown>)["runtimeVersion"])) !== undefined && parseVersion(String((value as Record<string, unknown>)["platformVersion"])) !== undefined;
export const checkChanges = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) && hasOnly(value, ["specialty", "skills", "limits"]) && Object.keys(value).length > 0;

/** May this worker be given this? Collects EVERY violation (company, status, version, capability, skill, tool, permission); allowed only with none. Nothing is run. */
export function evaluateRequest(worker: WorkerDefinition, request: PolicyRequest, config: WorkerConfigLike): PolicyDecision {
  const violations: string[] = [];
  if (request.tenantId !== worker.companyId) violations.push("tenant");
  if (worker.status !== "Active") violations.push("status");
  if (compatibility(worker, worker.capabilities, config).length > 0) violations.push("version");
  if (request.capability !== undefined && !worker.capabilities.some((entry) => entry.id === request.capability)) violations.push("capability");
  if (request.skill !== undefined && !((worker.skills.find((entry) => entry.id === request.skill?.id)?.level ?? -1) >= request.skill.min)) violations.push("skill");
  if (request.tool !== undefined && !worker.tools.includes(request.tool)) violations.push("tool");
  if (request.permission !== undefined && !permits(worker.permissions, request.permission)) violations.push("permission");
  return { allowed: violations.length === 0, violations };
}
