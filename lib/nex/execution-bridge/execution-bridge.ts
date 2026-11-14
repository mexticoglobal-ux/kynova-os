// Execution bridge (Sprint 52): the only glue between the layers that already exist. It carries what the real Execution plan, the Worker Runtime and the Worker OS SAY into the plain facts the Execution
// Gateway reads, and turns a Ready request into the event the existing Connectors reducer already takes (`action.request`, asked by the Worker, approved by a person, run by the connector). It adds
// no rule and no state: it validates nothing, approves nothing and calls no provider, and the Connectors module is the one that decides (write actions still wait for a person). Pure.

import type { ConnectorId, ConnectorsEvent, ConnectorsState } from "@/lib/contracts/platform/connectors";
import type { GoogleOperationId, GoogleWorkspace } from "@/lib/integrations/google";
import type { ExecutionPlan } from "@/lib/nex/execution";
import type { GatewayRecord, GatewaySources, OsWorkerFact, PlanFact, RuntimeWorkerFact, StepFact } from "@/lib/nex/execution-gateway";
import type { WorkerRecord as OsWorker } from "@/lib/nex/worker-os";
import type { WorkerRecord as RuntimeWorker } from "@/lib/nex/worker-runtime";

/** The Worker OS tool a step needs when it goes through a connector. A connector with no tool of that kind (WhatsApp, Meta, LinkedIn, YouTube, TikTok) asks for none yet. */
export const TOOL_OF_CONNECTOR: Readonly<Partial<Record<ConnectorId, string>>> = { gmail: "Email", outlook: "Email", googleCalendar: "Calendar", msCalendar: "Calendar", googleDrive: "Drive", onedrive: "Drive" };

export const planFact = (plan: ExecutionPlan): PlanFact => ({
  planId: plan.id, tenantId: plan.tenantId, status: plan.status, priority: plan.priority, ...(plan.decidedBy ? { decidedBy: plan.decidedBy } : {}), dependsOn: [...plan.dependsOn],
  steps: plan.steps.map((step): StepFact => {
    const tool = step.connector ? TOOL_OF_CONNECTOR[step.connector] : undefined;
    return {
      stepId: step.id, actionId: step.action, level: step.authorizationLevel, approverRole: step.approverRole, specialty: step.worker.specialty, state: step.state, dependsOn: [...step.dependsOn], timeoutMs: step.timeoutMs,
      retry: { maxAttempts: step.retry.maxAttempts, backoffMs: step.retry.backoffMs }, tools: tool ? [tool] : [], capabilities: [],
    };
  }),
});
export const runtimeFact = (worker: RuntimeWorker): RuntimeWorkerFact => ({ workerId: worker.id, tenantId: worker.tenantId, state: worker.state, version: worker.version, maxConcurrent: worker.maxConcurrent, current: worker.current });
/** The plan names a specialty in lower case (`sales`), the Worker OS in its catalog form (`Sales`): they are compared in lower case. */
export const osFact = (worker: OsWorker): OsWorkerFact => ({
  workerId: worker.workerId, companyId: worker.companyId, status: worker.status, specialty: worker.specialty.toLowerCase(), version: worker.version, capabilities: worker.capabilities.map((entry) => entry.id), tools: [...worker.tools],
  permissions: [...worker.permissions], limits: { timeoutMs: worker.limits.timeoutMs },
});
export const gatewaySources = (input: { plans: readonly ExecutionPlan[]; runtimeWorkers: readonly RuntimeWorker[]; osWorkers: readonly OsWorker[]; roleOf: GatewaySources["roleOf"] }): GatewaySources => ({
  plans: input.plans.map(planFact), runtimeWorkers: input.runtimeWorkers.map(runtimeFact), osWorkers: input.osWorkers.map(osFact), roleOf: input.roleOf,
});

// ---------------------------------------------------------------------------------------------- Google Workspace (Sprint 41's service): Ready request → the input of `GoogleWorkspace.request`
/** The Google operation a platform action means. The catalog has no Drive or read actions yet, so those are reached only by naming the operation itself (`drive.upload`). */
export const GOOGLE_OPERATION_OF_ACTION: Readonly<Record<string, GoogleOperationId>> = { "followup.send": "gmail.send", "message.sendFirst": "gmail.send", "message.sendSensitive": "gmail.send", "comms.send": "gmail.send", "calendar.write": "calendar.create" };
const CONNECTOR_OF_FAMILY: Readonly<Record<string, ConnectorId>> = { gmail: "gmail", calendar: "googleCalendar", drive: "googleDrive" };
/** An action that already is a Google operation id (`gmail.send`, `drive.upload`…) stands for itself; the service refuses an id it does not know. */
export const googleOperationOf = (actionId: string): string | undefined => GOOGLE_OPERATION_OF_ACTION[actionId] ?? (/^(gmail|calendar|drive)\.[A-Za-z]+$/.test(actionId) ? actionId : undefined);

export type GoogleRequestInput = Parameters<GoogleWorkspace["request"]>[2];
/**
 * Builds what the Google Workspace service takes (it then asks the Connectors reducer, holds anything that leaves the platform for a person and only then calls Google). Only a Ready request, a mapped
 * operation and one of the company's own active connections count. `params` (the content: recipients, text, dates) come from the caller: a request never carries them.
 */
export function googleRequest(record: GatewayRecord, state: ConnectorsState, params: Record<string, unknown>, at: string): { ok: true; input: GoogleRequestInput } | { ok: false; reason: "notReady" | "unknownOperation" | "notConnected" } {
  if (record.state !== "Ready") return { ok: false, reason: "notReady" };
  const operation = googleOperationOf(record.request.actionId);
  const connectorId = operation ? CONNECTOR_OF_FAMILY[operation.split(".")[0] ?? ""] : undefined;
  if (!operation || !connectorId) return { ok: false, reason: "unknownOperation" };
  const connection = state.connections.find((row) => row.tenantId === record.request.companyId && row.connectorId === connectorId && (row.status === "active" || row.status === "degraded"));
  if (!connection) return { ok: false, reason: "notConnected" };
  return { ok: true, input: { tenantId: record.request.companyId, workerId: record.request.workerId, connectionId: connection.id, operation, params, at } };
}

/** Which connection, scope and operation a request goes through: the caller knows its company's connection; this bridge invents none. */
export type ConnectorRoute = { connectionId: string; scope: string; operation: string; summary: string };
/** Only a Ready request becomes a connector event, and it is asked the way the Connectors module demands: by the Worker (`worker:<id>`), never by a person, an agent or the system. */
export function connectorAction(record: GatewayRecord, route: ConnectorRoute, at: string): Extract<ConnectorsEvent, { type: "action.request" }> | undefined {
  if (record.state !== "Ready") return undefined;
  return { tenantId: record.request.companyId, actor: `worker:${record.request.workerId}`, at, type: "action.request", connectionId: route.connectionId, workerId: record.request.workerId, scope: route.scope, operation: route.operation, summary: route.summary };
}
