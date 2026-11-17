// Beta Dashboard (Sprint 61): the first real screen, as plain data. It READS what the modules already computed (the Internal Beta's operating dashboard and KPIs, the CRM timeline, the Approval Center's
// inbox, Sprint 41's workspace view, and the Orchestrator and Gateway dashboards when someone hands them in) and arranges it for one company and one viewer. It creates no state, no query, no rule and no
// API. Whatever is not available is `null` and the screen says "Sin información": nothing is invented. Pure: no clock (the instant is handed in), no network, no database.
//
// Safety: only the companies the viewer belongs to appear; the approvals inbox is for people who administer the company (Level 3: owner or admin), everybody else sees "Sin información" there; the
// activity and the inbox carry kinds, operations, ids and times, never the text of a message, an address or a summary.

import type { MembershipDto } from "@/lib/contracts/backend";
import type { ConnectorsState } from "@/lib/contracts/platform/connectors";
import type { InternalBeta } from "@/lib/contracts/platform/internal-beta";
import type { OperatingDashboard } from "@/lib/contracts/platform/kynova-operation";
import type { KpiReading } from "@/lib/contracts/platform/business-templates";
import { workspaceView, type WorkspaceRow } from "@/lib/integrations/google/view";
import type { ConnectionActivity } from "@/lib/integrations/google/workspace";
import type { GatewayDashboard } from "@/lib/nex/execution-gateway";
import type { OrchestratorDashboard } from "@/lib/nex/runtime-orchestrator";
import { approvalInbox, type ApprovalEntry } from "./approval-center";

export const NO_INFO = "Sin información";
const ADMIN_ROLES: readonly string[] = ["owner", "admin"];
const ACTIVITY_LIMIT = 8;

export type BetaViewer = { tenantIds: readonly string[]; role: string };
export type BetaSources = {
  beta: Pick<InternalBeta, "parts" | "portfolio" | "tenants">;
  /** the connected apps of the platform (plain state), when there is one */ connectors?: ConnectorsState; activities?: readonly ConnectionActivity[];
  orchestrator?: OrchestratorDashboard; gateway?: GatewayDashboard;
};
export type BetaActivity = { at: string; kind: string; actor: string };
export type BetaDashboard = {
  tenantId: string; asOf: string; name: string;
  companies: readonly { id: string; name: string; template: string; plan: string }[];
  counts: { workers: number | null; workflows: number | null; executions: number | null; pendingRequests: number | null };
  approvals: readonly ApprovalEntry[] | null;
  google: readonly Pick<WorkspaceRow, "connectorId" | "label" | "display" | "healthScore" | "lastSyncAt" | "needsReauthorization">[] | null;
  health: OperatingDashboard["health"] | null;
  activity: readonly BetaActivity[] | null;
  kpis: readonly KpiReading[] | null;
  execution: { queued: number; active: number; gatewayPending: number } | null;
};
export type BetaRefusal = "forbidden" | "unknownCompany";

/** The viewer from the session's memberships (the server's, never the client's). `requested` is only a preference: a company the person does not belong to falls back to their active one. */
export function viewerOfMemberships(memberships: readonly Pick<MembershipDto, "tenantId" | "role">[], active: string | undefined, requested: string | undefined): { viewer: BetaViewer; tenantId: string } | null {
  const pick = [requested, active].map((id) => memberships.find((row) => row.tenantId === id)).find((row) => row !== undefined) ?? memberships[0];
  return pick ? { viewer: { tenantIds: memberships.map((row) => row.tenantId), role: pick.role }, tenantId: pick.tenantId } : null;
}

/** What one viewer sees of one company. A company the viewer does not belong to does not exist for them. */
export function betaDashboard(sources: BetaSources, viewer: BetaViewer, tenantId: string, at: string): { ok: true; dashboard: BetaDashboard } | { ok: false; refusal: BetaRefusal } {
  if (!viewer.tenantIds.includes(tenantId)) return { ok: false, refusal: "forbidden" };
  const own = sources.beta.tenants.find((row) => row.spec.id === tenantId);
  if (!own) return { ok: false, refusal: "unknownCompany" };
  const companies = sources.beta.portfolio.filter((row) => viewer.tenantIds.includes(row.tenantId)).map((row) => ({ id: row.tenantId, name: row.name, template: row.template, plan: row.plan })).sort((a, b) => a.id.localeCompare(b.id));
  const operating = own.dashboard;
  const canDecide = ADMIN_ROLES.includes(viewer.role);
  const activity = sources.beta.parts.crm.timeline.filter((row) => row.tenantId === tenantId).sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id)).slice(0, ACTIVITY_LIMIT).map((row): BetaActivity => ({ at: row.at, kind: row.kind, actor: row.actor }));
  const orchestrator = sources.orchestrator?.tenantId === tenantId ? sources.orchestrator : undefined;
  const gateway = sources.gateway?.tenantId === tenantId ? sources.gateway : undefined;
  return {
    ok: true,
    dashboard: {
      tenantId, asOf: at, name: own.spec.name, companies,
      counts: { workers: operating.people.workers, workflows: operating.automation.active, executions: operating.ai.workerRuns + operating.automation.runs, pendingRequests: operating.ai.approvalsWaiting },
      approvals: canDecide && sources.connectors ? approvalInbox(sources.connectors, tenantId, at) : null,
      google: sources.connectors ? workspaceView(sources.connectors, sources.activities ?? [], tenantId, at).map((row) => ({ connectorId: row.connectorId, label: row.label, display: row.display, healthScore: row.healthScore, ...(row.lastSyncAt ? { lastSyncAt: row.lastSyncAt } : {}), needsReauthorization: row.needsReauthorization })) : null,
      health: operating.health,
      activity: activity.length > 0 ? activity : null,
      kpis: own.kpis.length > 0 ? own.kpis : null,
      execution: orchestrator || gateway ? { queued: orchestrator?.queue.total ?? 0, active: orchestrator?.plans.active.length ?? 0, gatewayPending: gateway?.pending.total ?? 0 } : null,
    },
  };
}
