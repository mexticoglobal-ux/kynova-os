import type { ConnectorDef, Health, IntegrationRecord, Status } from "./domain";

/** What a company sees for a connector. A connector without an adapter is "coming soon" whatever else is stored; nothing is ever assumed connected. */
export function effectiveStatus(def: ConnectorDef, rec: IntegrationRecord | null): Status {
  if (!def.available) return "coming_soon";
  return rec?.status ?? "not_configured";
}
export const healthOf = (s: Status): Health => (s === "connected" ? "ok" : s === "error" ? "error" : "unknown");

/** The plain map every other system reads: connector key -> status. */
export type IntegrationState = Readonly<Record<string, Status>>;
export interface IntegrationTotals { total: number; available: number; connected: number; pending: number; error: number }
export function totals(state: IntegrationState): IntegrationTotals {
  const v = Object.values(state);
  return { total: v.length, available: v.filter((s) => s !== "coming_soon").length, connected: v.filter((s) => s === "connected").length, pending: v.filter((s) => s === "pending").length, error: v.filter((s) => s === "error").length };
}
/**
 * The contract for AI Employees and the CEO AI: before working with data from a platform, ask what is missing. Only a connected platform is ready;
 * every other state is reported with its real status. With no state at all, nothing is assumed.
 */
export function requirements(state: IntegrationState | null, needs: readonly string[]): { ready: boolean; missing: { key: string; status: Status }[] } {
  const missing = needs.filter((k) => state?.[k] !== "connected").map((key) => ({ key, status: state?.[key] ?? ("not_configured" as Status) }));
  return { ready: missing.length === 0, missing };
}
