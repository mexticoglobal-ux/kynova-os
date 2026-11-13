// Execution Gateway: the convenience class that holds the requests, their event log and observability, and hands every move to the pure reducer. The clock is INJECTED (`now`) and the facts of the other
// layers are INJECTED (`sources`), so the same script always gives the same result; the engine reads no clock, calls no network, no database, no AI, no Connector, no Worker and no Runtime, and it
// executes, approves and authorizes nothing. `dispatch` only LISTS the requests that are Ready, in order: the flow stops there, and a later sprint connects it to real execution.

import { readyRequests } from "./execution-gateway-dispatcher";
import { buildGatewayDashboard, type GatewayDashboard } from "./execution-gateway-dashboard";
import { GatewayEventLog } from "./execution-gateway-events";
import { GatewayObservability } from "./execution-gateway-observability";
import { newGatewayState, reduceGateway } from "./execution-gateway-reducer";
import { DEFAULT_CONFIG, type ExecutionRequest, type GatewayConfig, type GatewayEvent, type GatewayRecord, type GatewayResult, type GatewaySources, type GatewayState, type Principal, type RequestSpec } from "./execution-gateway-types";

export type GatewayOptions = { /** the injected clock: epoch milliseconds */ now: () => number; /** the facts of the other layers, read when a request is built or validated */ sources: () => GatewaySources; config?: Partial<GatewayConfig>; state?: GatewayState };

export class ExecutionGateway {
  readonly log = new GatewayEventLog();
  readonly observability = new GatewayObservability(this.log);
  private state: GatewayState;
  private readonly config: GatewayConfig;
  constructor(private readonly options: GatewayOptions) {
    this.state = options.state ?? newGatewayState();
    this.config = { ...DEFAULT_CONFIG, ...options.config };
  }

  private at = (): string => new Date(this.options.now()).toISOString();
  private run(event: GatewayEvent): GatewayResult {
    const outcome = reduceGateway(this.state, event, this.options.sources(), this.config);
    this.state = outcome.state;
    for (const input of outcome.result.events) this.log.emit(input);
    return outcome.result;
  }

  /** Builds the request for one step and one worker (Pending). */
  submit(actor: Principal, tenantId: string, spec: RequestSpec): GatewayResult { return this.run({ type: "submit", actor, tenantId, at: this.at(), spec }); }
  /** Checks everything about one request against the facts as they are now. */
  validate(actor: Principal, tenantId: string, requestId: string): GatewayResult { return this.run({ type: "validate", actor, tenantId, at: this.at(), requestId }); }
  /** Validates every open request of the company, in id order. */
  validateAll(actor: Principal, tenantId: string): readonly GatewayResult[] {
    const open = this.state.requests.filter((row) => row.request.companyId === tenantId && !["Rejected", "Cancelled", "Expired"].includes(row.state)).map((row) => row.request.requestId).sort();
    return open.map((requestId) => this.validate(actor, tenantId, requestId));
  }
  cancel(actor: Principal, tenantId: string, requestId: string): GatewayResult { return this.run({ type: "cancel", actor, tenantId, at: this.at(), requestId }); }
  tick(actor: Principal, tenantId: string): GatewayResult { return this.run({ type: "tick", actor, tenantId, at: this.at() }); }

  /** The Ready requests of the actor's company in order (priority, then who asked first, then id). A list of what would be asked; nothing is asked and no state changes. */
  dispatch(actor: Principal): readonly ExecutionRequest[] {
    const list = readyRequests(this.requestsFor(actor));
    this.log.emit({ at: this.at(), tenantId: actor.tenantId, actorKind: actor.kind, actorId: actor.kind === "system" || actor.kind === "nex" ? actor.kind : actor.id, type: "gateway.dispatched", detail: { requests: list.length } });
    return list;
  }
  /** What this actor may see: their own company's requests. Anything else does not exist. */
  requestsFor(actor: Principal): readonly GatewayRecord[] { return this.state.requests.filter((row) => row.request.companyId === actor.tenantId); }
  dashboard(actor: Principal): GatewayDashboard {
    const at = this.at();
    const dashboard = buildGatewayDashboard({ tenantId: actor.tenantId, at, requests: this.requestsFor(actor) });
    this.log.emit({ at, tenantId: actor.tenantId, actorKind: actor.kind, actorId: actor.kind === "system" || actor.kind === "nex" ? actor.kind : actor.id, type: "gateway.dashboard", detail: { requests: dashboard.requests.total } });
    return dashboard;
  }
  snapshot(tenantId: string) { return this.observability.snapshot(tenantId, this.state); }
  /** The whole state, for persistence by someone else: this layer stores nothing. */
  exportState(): GatewayState { return this.state; }
  audit(tenantId: string) { return this.state.audit.filter((entry) => entry.tenantId === tenantId); }
}
