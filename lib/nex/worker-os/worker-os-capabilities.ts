// Worker OS Capabilities: what a Worker DECLARES it can do (read, write, search, analyze, execute, schedule, communicate, calculate, monitor, report, organize, generate, validate, approve), each with the
// version of the capability contract it implements. Nothing is assumed: only what is declared exists, and only what the catalog knows. Capabilities are not tools and not permissions. Pure.

import { CAPABILITY_IDS, CAPABILITY_VERSIONS, compareVersions, parseVersion, type Capability, type CapabilityId } from "./worker-os-types";

export const isCapabilityId = (id: string): id is CapabilityId => Object.prototype.hasOwnProperty.call(CAPABILITY_VERSIONS, id);
/** An offered version satisfies a needed one when the major is the same and nothing newer is needed. */
export const provides = (offered: string, needed: string): boolean => {
  const a = parseVersion(offered);
  const b = parseVersion(needed);
  return a !== undefined && b !== undefined && a[0] === b[0] && compareVersions(needed, offered) <= 0;
};
export const capabilityCompatible = (capability: Capability): boolean => isCapabilityId(capability.id) && provides(CAPABILITY_VERSIONS[capability.id], capability.version);

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };
/** Exactly `{id, version}` for each, known ids only, valid versions, no duplicates; sorted so the same set is always the same list. */
export function checkCapabilities(list: unknown): Checked<Capability[]> {
  if (!Array.isArray(list) || list.length > CAPABILITY_IDS.length) return { ok: false, error: "capabilities.shape" };
  const seen = new Set<string>();
  const value: Capability[] = [];
  for (const entry of list as unknown[]) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return { ok: false, error: "capabilities.shape" };
    const keys = Object.keys(entry);
    const { id, version } = entry as { id?: unknown; version?: unknown };
    if (keys.length !== 2 || !keys.includes("id") || !keys.includes("version")) return { ok: false, error: "capabilities.schema" };
    if (typeof id !== "string" || !isCapabilityId(id)) return { ok: false, error: "capabilities.unknown" };
    if (typeof version !== "string" || !parseVersion(version)) return { ok: false, error: "capabilities.version" };
    if (seen.has(id)) return { ok: false, error: "capabilities.duplicate" };
    seen.add(id);
    value.push({ id, version });
  }
  return { ok: true, value: value.sort((a, b) => a.id.localeCompare(b.id)) };
}
export const hasCapability = (capabilities: readonly Capability[], id: string): boolean => capabilities.some((entry) => entry.id === id);
/** How many were added and removed between two declarations (a version change counts as one of each). */
export function diffCapabilities(before: readonly Capability[], after: readonly Capability[]): { added: number; removed: number } {
  const key = (entry: Capability) => `${entry.id}@${entry.version}`;
  const was = new Set(before.map(key));
  const is = new Set(after.map(key));
  return { added: [...is].filter((entry) => !was.has(entry)).length, removed: [...was].filter((entry) => !is.has(entry)).length };
}
