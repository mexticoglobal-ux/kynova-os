// Execution Gateway Dashboard: the numbers a screen would draw, as plain data (no UI): requests, Ready, Blocked, Rejected, pending, average time, priorities, errors and versions. Only ONE company's requests
// go in and only that company's numbers come out; ids and counts, never the content of anything. Pure: the clock is handed in.

import { readyRequests } from "./execution-gateway-dispatcher";
import { PRIORITIES, REQUEST_STATES, type GatewayRecord, type RequestState } from "./execution-gateway-types";

export type GatewayDashboard = {
  tenantId: string; at: string;
  requests: { total: number; byState: Record<RequestState, number> };
  ready: { total: number; next: string[] };
  blocked: { total: number; byReason: Record<string, number> };
  rejected: { total: number; byReason: Record<string, number> };
  pending: { total: number; pending: number; validated: number; waitingApproval: number };
  averageMs: { toValidate: number; openAge: number };
  priorities: Record<string, number>;
  errors: Record<string, number>;
  versions: Record<string, number>;
};
const mean = (values: readonly number[]): number => (values.length === 0 ? 0 : Math.round(values.reduce((a, b) => a + b, 0) / values.length));

export function buildGatewayDashboard(input: { tenantId: string; at: string; requests: readonly GatewayRecord[] }): GatewayDashboard {
  const { tenantId, at } = input;
  const nowMs = Date.parse(at);
  // one company: whatever belongs to another does not exist here
  const rows = input.requests.filter((row) => row.request.companyId === tenantId);
  const byState = Object.fromEntries(REQUEST_STATES.map((state) => [state, 0])) as Record<RequestState, number>;
  for (const row of rows) byState[row.state] += 1;
  const reasons = (state: RequestState) => {
    const counts: Record<string, number> = {};
    for (const row of rows.filter((entry) => entry.state === state)) for (const code of row.reasons) counts[code] = (counts[code] ?? 0) + 1;
    return counts;
  };
  const priorities = Object.fromEntries(PRIORITIES.map((priority) => [priority, 0])) as Record<string, number>;
  const versions: Record<string, number> = {};
  const errors: Record<string, number> = {};
  for (const row of rows) {
    priorities[row.request.priority] = (priorities[row.request.priority] ?? 0) + 1;
    if (row.workerVersion) versions[row.workerVersion] = (versions[row.workerVersion] ?? 0) + 1;
    if (row.state === "Blocked" || row.state === "Rejected") for (const code of row.reasons) errors[code] = (errors[code] ?? 0) + 1;
  }
  const open = rows.filter((row) => row.state === "Pending" || row.state === "Validated" || row.state === "WaitingApproval" || row.state === "Blocked");
  return {
    tenantId, at,
    requests: { total: rows.length, byState },
    ready: { total: byState.Ready, next: readyRequests(rows).slice(0, 5).map((request) => request.requestId) },
    blocked: { total: byState.Blocked, byReason: reasons("Blocked") }, rejected: { total: byState.Rejected, byReason: reasons("Rejected") },
    pending: { total: byState.Pending + byState.Validated + byState.WaitingApproval, pending: byState.Pending, validated: byState.Validated, waitingApproval: byState.WaitingApproval },
    averageMs: { toValidate: mean(rows.filter((row) => row.validatedAt).map((row) => Date.parse(row.validatedAt as string) - Date.parse(row.createdAt))), openAge: mean(open.map((row) => Math.max(0, nowMs - Date.parse(row.createdAt)))) },
    priorities, errors, versions,
  };
}
