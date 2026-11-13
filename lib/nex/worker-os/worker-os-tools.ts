// Worker OS Tools: the tools a Worker is registered to use (CRM, Billing, Marketplace, Academy, Calendar, Drive, Email, Docs, Storage, Analytics, AI Studio, Automations). They are only REGISTERED here:
// nothing is run, called or connected. A tool is not a capability and not a permission. Pure.

import type { Checked } from "./worker-os-capabilities";
import { TOOL_IDS } from "./worker-os-types";

export const isToolId = (id: string): boolean => (TOOL_IDS as readonly string[]).includes(id);
/** Known tool ids only, no duplicates; sorted so the same set is always the same list. */
export function checkTools(list: unknown): Checked<string[]> {
  if (!Array.isArray(list) || list.length > TOOL_IDS.length) return { ok: false, error: "tools.shape" };
  const seen = new Set<string>();
  for (const entry of list as unknown[]) {
    if (typeof entry !== "string" || !isToolId(entry)) return { ok: false, error: "tools.unknown" };
    if (seen.has(entry)) return { ok: false, error: "tools.duplicate" };
    seen.add(entry);
  }
  return { ok: true, value: [...seen].sort() };
}
export const hasTool = (tools: readonly string[], id: string): boolean => tools.includes(id);
export const diffIds = (before: readonly string[], after: readonly string[]): { added: number; removed: number } => ({
  added: after.filter((entry) => !before.includes(entry)).length, removed: before.filter((entry) => !after.includes(entry)).length,
});
