// What Connected Apps shows for Google Workspace: the account, the state, the last sync, the last email, event and file, and a health score. A reading only: it works out nothing
// that is not already in the connection or in the activity the service keeps, and it never shows content (an item is an opaque id and a time).

import { CONNECTORS, displayStatus, tokenDue, type Connection, type ConnectorsState, type DisplayStatus, type Incident } from "@/lib/contracts/platform/connectors";
import type { ConnectionActivity, Seen } from "./workspace";

/** The three Google apps. Defined here (not in the service) so the screens can import the view without pulling in the service that talks to Google. */
export const GOOGLE_CONNECTORS = ["gmail", "googleCalendar", "googleDrive"] as const;
export type GoogleConnectorId = (typeof GOOGLE_CONNECTORS)[number];

const DAY = 86_400_000;
/**
 * A 0-100 score of how healthy a Google connection is: its state (40), whether the access can be renewed in time (20), how fresh the last sync is (20) and the share of recent calls that
 * worked (20). A connection that needs authorizing again, or is not connected, scores low; an outage at Google takes points off. Pure.
 */
export function healthScore(input: { connection?: Connection; activity?: ConnectionActivity; at: string; incident?: Incident }): number {
  const { connection, activity, at } = input;
  if (!connection || connection.status === "notConnected" || connection.status === "revoked") return 0;
  if (connection.status === "pending") return 10;
  if (connection.status === "error" || activity?.needsReauthorization) return Math.min(20, activity?.recent.length ? 10 : 0);
  let score = connection.status === "active" ? 40 : 20;
  const expired = !!connection.expiresAt && Date.parse(connection.expiresAt) <= Date.parse(at);
  score += expired ? 0 : tokenDue(connection, at) ? 10 : 20;
  const lastSync = activity?.lastSyncAt ?? connection.lastSyncAt;
  const age = lastSync ? Date.parse(at) - Date.parse(lastSync) : Number.POSITIVE_INFINITY;
  score += age <= DAY ? 20 : age <= 3 * DAY ? 10 : 0;
  const recent = activity?.recent ?? [];
  score += recent.length === 0 ? 10 : Math.round((recent.filter((item) => item === "ok").length / recent.length) * 20);
  if (input.incident) score -= input.incident.mode === "down" ? 30 : 15;
  return Math.max(0, Math.min(100, score));
}

export type WorkspaceRow = {
  connectorId: GoogleConnectorId; label: string; connectionId?: string; account?: string; display: DisplayStatus; lastSyncAt?: string; lastEmail?: Seen; lastEvent?: Seen; lastFile?: Seen;
  healthScore: number; needsReauthorization: boolean; renewalDue: boolean; scopes: readonly string[];
};
/** Gmail, Google Calendar and Google Drive of ONE company, with what to show for each. */
export function workspaceView(state: ConnectorsState, activities: readonly ConnectionActivity[], tenantId: string, at: string): WorkspaceRow[] {
  return GOOGLE_CONNECTORS.map((connectorId) => {
    const connection = state.connections.find((row) => row.tenantId === tenantId && row.connectorId === connectorId);
    const activity = connection ? activities.find((row) => row.connectionId === connection.id && row.tenantId === tenantId) : undefined;
    const group = CONNECTORS[connectorId].group;
    const incident = state.incidents.find((row) => row.group === group);
    const needsReauthorization = activity?.needsReauthorization ?? false;
    const display = needsReauthorization ? "Error" : displayStatus(connection?.status ?? "notConnected");
    const lastSyncAt = activity?.lastSyncAt ?? connection?.lastSyncAt;
    return {
      connectorId, label: CONNECTORS[connectorId].label, ...(connection ? { connectionId: connection.id } : {}), ...(connection?.accountLabel ? { account: connection.accountLabel } : {}), display, ...(lastSyncAt ? { lastSyncAt } : {}),
      ...(activity?.lastEmail ? { lastEmail: activity.lastEmail } : {}), ...(activity?.lastEvent ? { lastEvent: activity.lastEvent } : {}), ...(activity?.lastFile ? { lastFile: activity.lastFile } : {}),
      healthScore: healthScore({ ...(connection ? { connection } : {}), ...(activity ? { activity } : {}), at, ...(incident ? { incident } : {}) }), needsReauthorization, renewalDue: !!connection && tokenDue(connection, at),
      scopes: connection ? connection.grantedScopes : [],
    };
  });
}
