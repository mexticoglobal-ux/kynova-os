// Approval Center (Sprint 54): the one inbox of actions waiting for a person, over what already exists. A Ready request is held by the Connectors reducer (anything that leaves the platform waits there,
// `awaitingApproval`); who may decide is the reducer's rule (a person who administers the company: a Worker, the system and NEX never), the audit trail is the reducer's own (`action.request`,
// `action.approve`, `action.reject`) and the real call is Sprint 41's service. This file adds nothing to them: an inbox view, a deadline, and three thin calls. Pure, no clock (the instant is handed in).
//
// Expiry: the Connectors module has no event for it and its approve/reject are people's, so a pending action past its deadline is shown as `expired`, can no longer be APPROVED here, and is closed by
// REJECTING it with the reason "expirada" in the name of a person (a sweep needs one: the system cannot reject).

import type { ConnectorAction, ConnectorEnv, ConnectorsState } from "@/lib/contracts/platform/connectors";
import type { GoogleWorkspace, WorkspaceResult } from "@/lib/integrations/google";
import type { GatewayRecord } from "@/lib/nex/execution-gateway";
import { googleRequest } from "./execution-bridge";

export const APPROVAL_TTL_MINUTES = 24 * 60;
export const EXPIRED_REASON = "expirada";
export type ApprovalEntry = { actionId: string; connectorId: string; workerId: string; scope: string; operation: string; summary: string; requestedAt: string; expiresAt: string; status: "pending" | "expired" };

const deadline = (action: Pick<ConnectorAction, "requestedAt">, ttlMinutes: number): string => new Date(Date.parse(action.requestedAt) + ttlMinutes * 60_000).toISOString();
const overdue = (action: Pick<ConnectorAction, "requestedAt">, at: string, ttlMinutes: number): boolean => Date.parse(at) >= Date.parse(deadline(action, ttlMinutes));

/** The company's own actions waiting for a person, oldest first; those past their deadline say so. Another company's never appear. */
export function approvalInbox(state: ConnectorsState, tenantId: string, at: string, ttlMinutes = APPROVAL_TTL_MINUTES): ApprovalEntry[] {
  return state.actions
    .filter((row) => row.tenantId === tenantId && row.status === "awaitingApproval")
    .map((row): ApprovalEntry => ({ actionId: row.id, connectorId: row.connectorId, workerId: row.workerId, scope: row.scope, operation: row.operation, summary: row.summary, requestedAt: row.requestedAt, expiresAt: deadline(row, ttlMinutes), status: overdue(row, at, ttlMinutes) ? "expired" : "pending" }))
    .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.actionId.localeCompare(b.actionId));
}

/** A Ready request goes in the inbox: the service asks the Connectors reducer, which holds the write for a person. Nothing leaves the platform. */
export async function holdForApproval(ws: GoogleWorkspace, state: ConnectorsState, env: ConnectorEnv, record: GatewayRecord, params: Record<string, unknown>, at: string): Promise<WorkspaceResult | { ok: false; reason: "notReady" | "unknownOperation" | "notConnected" }> {
  const built = googleRequest(record, state, params, at);
  return built.ok ? ws.request(state, env, built.input) : built;
}

type Decision = { tenantId: string; actor: string; actionId: string; at: string; ttlMinutes?: number };
/** Approves: the person's decision, then the real call. A pending action past its deadline is refused here (it can only be rejected). */
export async function approveAction(ws: GoogleWorkspace, state: ConnectorsState, env: ConnectorEnv, input: Decision): Promise<WorkspaceResult> {
  const entry = approvalInbox(state, input.tenantId, input.at, input.ttlMinutes).find((row) => row.actionId === input.actionId);
  if (entry?.status === "expired") return { state, ok: false, status: "refused", code: "expired", error: "La solicitud venció: ya no se puede aprobar." };
  return ws.approve(state, env, { tenantId: input.tenantId, actor: input.actor, actionId: input.actionId, at: input.at });
}
export const rejectAction = (ws: GoogleWorkspace, state: ConnectorsState, env: ConnectorEnv, input: Decision & { reason: string }): Promise<WorkspaceResult> =>
  ws.reject(state, env, { tenantId: input.tenantId, actor: input.actor, actionId: input.actionId, reason: input.reason, at: input.at });

/** Closes every pending action past its deadline by rejecting it as "expirada" in the name of `actor` (who must be a person who administers the company: otherwise the reducer refuses and nothing changes). */
export async function expireDue(ws: GoogleWorkspace, state: ConnectorsState, env: ConnectorEnv, input: { tenantId: string; actor: string; at: string; ttlMinutes?: number }): Promise<{ state: ConnectorsState; expired: string[]; refused: string[] }> {
  let current = state;
  const expired: string[] = [];
  const refused: string[] = [];
  for (const entry of approvalInbox(state, input.tenantId, input.at, input.ttlMinutes).filter((row) => row.status === "expired")) {
    const result = await rejectAction(ws, current, env, { tenantId: input.tenantId, actor: input.actor, actionId: entry.actionId, reason: EXPIRED_REASON, at: input.at });
    if (result.ok) { current = result.state; expired.push(entry.actionId); } else refused.push(entry.actionId);
  }
  return { state: current, expired, refused };
}
