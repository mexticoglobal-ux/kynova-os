// Execution Gateway Reducer: the pure function `reduceGateway(state, event, sources, config)` that turns a step of an approved plan into an EXECUTION REQUEST and decides, from the facts of the other layers,
// whether it is Ready, waiting for approval, Blocked or Rejected. The same state, event and facts always give the same result; there is no clock (every event carries `at`), no network, no database and
// no AI, and NOTHING is executed, approved or authorized: a Ready request is a description of work, and the flow STOPS there.
//   · Who: the system or a manager submit, validate, cancel and tick. Workers and NEX never. Nobody approves here: approval is read as a fact (who approved the plan, and the role that person holds).
//   · Every state change is checked against a closed table and written to the audit trail; creation, validation, rejection, cancellation and expiry are audited by name.

import { buildRequest, requestIdFor, validSpec } from "./execution-gateway-dispatcher";
import { validateRequest } from "./execution-gateway-validator";
import {
  DEFAULT_CONFIG, TERMINAL, canOperate, canTransition,
  type AuditEntry, type GatewayConfig, type GatewayEvent, type GatewayEventInput, type GatewayEventType, type GatewayOutcome, type GatewayRecord, type GatewaySources, type GatewayState, type Principal, type Refusal, type RequestState,
} from "./execution-gateway-types";

export const newGatewayState = (): GatewayState => ({ requests: [], audit: [] });
const MAX_AUDIT = 5_000;
const name = (principal: Principal): string => (principal.kind === "system" || principal.kind === "nex" ? principal.kind : principal.id);

function refuse(state: GatewayState, event: GatewayEvent, refusal: Refusal, reasons: readonly string[] = []): GatewayOutcome {
  const who = name(event.actor);
  const input: GatewayEventInput = { at: event.at, tenantId: event.actor.tenantId, actorKind: event.actor.kind, actorId: who, type: "gateway.refused", detail: { reason: refusal, action: event.type } };
  const entry: AuditEntry = { at: event.at, actor: who, tenantId: event.actor.tenantId, action: `${event.type}.refused`, detail: { ok: false, reason: refusal, ...(reasons[0] ? { why: reasons[0] } : {}) } };
  return { state: { ...state, audit: [...state.audit, entry].slice(-MAX_AUDIT) }, result: { ok: false, refusal, ...(reasons.length > 0 ? { reasons } : {}), events: [input] } };
}

export function reduceGateway(start: GatewayState, event: GatewayEvent, sources: GatewaySources, config: GatewayConfig = DEFAULT_CONFIG): GatewayOutcome {
  const { actor, tenantId, at } = event;
  if (actor.tenantId !== tenantId) return refuse(start, event, "tenant");
  const nowMs = Date.parse(at);
  if (Number.isNaN(nowMs)) return refuse(start, event, "invalid", ["at"]);
  // Level 3: nobody here approves; workers and NEX never operate the gateway
  if (!canOperate(actor)) return refuse(start, event, "forbidden");

  let requests: GatewayRecord[] = [...start.requests];
  const events: GatewayEventInput[] = [];
  const audit: AuditEntry[] = [];
  const who = name(actor);
  const note = (type: GatewayEventType, requestId?: string, detail?: Readonly<Record<string, unknown>>) =>
    events.push({ at, tenantId, actorKind: actor.kind, actorId: who, type, ...(requestId ? { requestId } : {}), ...(detail ? { detail } : {}) });
  const find = (id: string): GatewayRecord | undefined => requests.find((row) => row.request.requestId === id && row.request.companyId === tenantId);
  const put = (next: GatewayRecord): GatewayRecord => { requests = requests.map((row) => (row.request.requestId === next.request.requestId && row.request.companyId === next.request.companyId ? next : row)); return next; };
  const record = (action: string, detail: Record<string, string | number | boolean> = {}) => audit.push({ at, actor: who, tenantId, action, detail: { ok: true, ...detail } });

  /** The only way a request changes state: checked against the closed table, logged and audited. */
  const move = (from: GatewayRecord, to: RequestState, cause: string): GatewayRecord => {
    const current = find(from.request.requestId) ?? from;
    if (current.state === to || !canTransition(current.state, to)) return current;
    const next = put({ ...current, state: to, updatedAt: at, revision: current.revision + 1 });
    note("request.transition", current.request.requestId, { from: current.state, to, cause });
    audit.push({ at, actor: who, tenantId, action: "request.transition", detail: { requestId: current.request.requestId, from: current.state, to, cause } });
    if (to === "Rejected") { note("request.rejected", current.request.requestId, { reasons: next.reasons.length }); record("request.rejected", { requestId: current.request.requestId, reasons: next.reasons.length }); }
    if (to === "Cancelled") { note("request.cancelled", current.request.requestId); record("request.cancelled", { requestId: current.request.requestId }); }
    if (to === "Expired") { note("request.expired", current.request.requestId); record("request.expired", { requestId: current.request.requestId }); }
    return next;
  };
  const finishOk = (extra: { record?: GatewayRecord; records?: readonly GatewayRecord[]; unchanged?: boolean } = {}): GatewayOutcome => ({
    state: { requests, audit: [...start.audit, ...audit].slice(-MAX_AUDIT) },
    result: { ok: true, ...(extra.unchanged ? { unchanged: true } : {}), ...(extra.record ? { record: find(extra.record.request.requestId) ?? extra.record } : {}), ...(extra.records ? { records: extra.records } : {}), events },
  });

  switch (event.type) {
    case "submit": {
      const spec = event.spec;
      if (!validSpec(spec)) return refuse(start, event, "invalid", ["spec"]);
      const existing = find(requestIdFor(spec.planId, spec.stepId));
      if (existing) return TERMINAL.includes(existing.state) ? refuse(start, event, "exists", [existing.state]) : finishOk({ record: existing, unchanged: true });
      if (requests.filter((row) => row.request.companyId === tenantId).length >= config.maxRequests) return refuse(start, event, "limit", ["maxRequests"]);
      const built = buildRequest(spec, tenantId, at, sources);
      if (!built.ok) return refuse(start, event, built.reason === "shape" ? "invalid" : "notFound", [built.reason]);
      const created: GatewayRecord = { request: built.request, state: "Pending", reasons: [], revision: 1, createdAt: at, updatedAt: at, expiresAt: new Date(nowMs + config.requestTtlMs).toISOString() };
      requests.push(created);
      note("request.created", created.request.requestId, { priority: created.request.priority, level: created.request.executionPolicy.level, timeoutMs: created.request.timeout });
      record("request.created", { requestId: created.request.requestId, priority: created.request.priority });
      return finishOk({ record: created });
    }

    case "validate": {
      const current = find(event.requestId);
      if (!current) return refuse(start, event, "notFound", [`request:${event.requestId}`]);
      if (TERMINAL.includes(current.state)) return refuse(start, event, "state", [current.state]);
      const verdict = validateRequest(current.request, sources, config);
      const reasons = verdict.outcome === "waitingApproval" ? ["approval.pending"] : verdict.failures.map((failure) => failure.code);
      // the approver is COPIED from the plan, never decided here
      let row = put({ ...current, request: { ...current.request, approvedBy: verdict.approvedBy }, reasons, validatedAt: at, ...(verdict.workerVersion ? { workerVersion: verdict.workerVersion } : {}) });
      note("request.validated", row.request.requestId, { outcome: verdict.outcome, failures: verdict.failures.length });
      for (const failure of verdict.failures) note("request.failure", row.request.requestId, { code: failure.code, permanent: failure.permanent });
      const before = current.state;
      if (verdict.outcome === "ready") {
        if (row.state === "Pending" || row.state === "Blocked") row = move(row, "Validated", "validated");
        row = move(row, "Ready", "validated");
        note("request.ready", row.request.requestId);
      } else if (verdict.outcome === "waitingApproval") {
        if (row.state === "Pending" || row.state === "Blocked") row = move(row, "Validated", "validated");
        row = row.state === "Ready" ? move(row, "Blocked", "approval.pending") : move(row, "WaitingApproval", "approval.pending");
      } else if (verdict.outcome === "blocked") {
        row = move(row, "Blocked", verdict.failures[0]?.code ?? "blocked");
        note("request.blocked", row.request.requestId, { failures: verdict.failures.length });
      } else {
        row = move(row, "Rejected", verdict.failures.find((failure) => failure.permanent)?.code ?? "rejected");
      }
      record("request.validated", { requestId: row.request.requestId, outcome: verdict.outcome, failures: verdict.failures.length, state: row.state });
      return finishOk({ record: row, unchanged: before === row.state && JSON.stringify(current.reasons) === JSON.stringify(reasons) });
    }

    case "cancel": {
      const current = find(event.requestId);
      if (!current) return refuse(start, event, "notFound", [`request:${event.requestId}`]);
      if (TERMINAL.includes(current.state)) return refuse(start, event, "state", [current.state]);
      return finishOk({ record: move(current, "Cancelled", "cancel") });
    }

    case "tick": {
      const expired: GatewayRecord[] = [];
      for (const current of requests.filter((row) => row.request.companyId === tenantId && !TERMINAL.includes(row.state) && Date.parse(row.expiresAt) <= nowMs).sort((a, b) => a.request.requestId.localeCompare(b.request.requestId))) {
        expired.push(move(current, "Expired", "ttl"));
      }
      return finishOk({ records: expired });
    }
  }
}
