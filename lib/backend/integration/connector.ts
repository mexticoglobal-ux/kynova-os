// The connector: what joins a module to the Backend Core WITHOUT changing the module. It wraps the module's own reducer: the reducer runs exactly as before, and
// afterwards the connector reads what the module appended to its own append-only trails (audit and logs) and carries it into the Backend Core:
//   - every new entry is published on the Event Bus, with a deterministic id, under the company that owns it;
//   - every new entry is recorded in the central, hash-chained audit, and so is every refused attempt;
//   - the call is counted, timed and traced (one trace id ties the span, the events and the audit records of a call together).
// Nothing in a module imports the Backend Core: the connection goes one way, from the core to the modules. Every company's data stays under its own tenant_id:
// a call without a company is refused before the module is touched, and an entry that belongs to another company than the call's is never published.

import { auditFromModuleEntry, actorKindOf, type Outcome } from "../audit";
import { eventFromEntry, type ModuleEntry, type ModuleId } from "../events";
import type { TenantContext } from "../entities";
import { tenantMismatch } from "../identity";
import type { BackendCore } from "../index";
import { randomBytes, toHex } from "../crypto";

const TENANT_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

/** What every module's own trail entry looks like, plus the company it belongs to. */
export type SourceEntry = ModuleEntry & { tenantId?: string };
/** One append-only trail of a module's state, and the module of the platform it belongs to. */
export type Stream = { name: string; module: ModuleId; entries: readonly SourceEntry[] };
export type ReduceResult<S> = { state: S; error?: string | undefined; errorCode?: string | undefined };

/** What an observer may ask the connector to do on top of the entries: publish a domain event, count something, or add a span. Pure data. */
export type Observation =
  | { kind: "event"; module: ModuleId; name: string; id: string; tenantId: string; actor: string; at: string; payload: Record<string, unknown> }
  | { kind: "metric"; metric: "inc" | "observe"; name: string; labels: Record<string, string>; value?: number }
  | { kind: "span"; name: string; at: string; durationMs: number; status: "ok" | "error"; attributes: Record<string, unknown> };

export type Bridge<S, E, R extends ReduceResult<S> = ReduceResult<S>> = {
  id: string;
  label: string;
  /** The modules of the platform this bridge reports on. */
  modules: readonly ModuleId[];
  reduce: (state: S, event: E) => R;
  /** Every append-only trail of the state (nested ones included), always in the same order. */
  streams: (state: S) => readonly Stream[];
  tenantOf: (event: E) => string;
  actorOf: (event: E) => string;
  typeOf: (event: E) => string;
  /** Domain telemetry worked out from the state before and after a call. Optional. */
  observe?: (before: S, after: S) => readonly Observation[];
};

export type IntegrationStats = { tenants: Set<string>; calls: number; refused: number; events: number; audits: number; violations: number };
export const newStats = (): IntegrationStats => ({ tenants: new Set(), calls: 0, refused: 0, events: 0, audits: 0, violations: 0 });

/** How an entry of a module's trail ended, from its action name: a refusal or a failure is recorded as such in the central audit. */
export function outcomeOfAction(action: string): Outcome {
  if (/(^|[.:_-])(refused|rejected|denied)\b/i.test(action)) return "refused";
  if (/(^|[.:_-])(failed|error)\b/i.test(action)) return "error";
  return "success";
}

export class Connector<S, E, R extends ReduceResult<S> = ReduceResult<S>> {
  constructor(private readonly core: BackendCore, readonly bridge: Bridge<S, E, R>, private readonly stats: IntegrationStats) {}

  /** Runs the module's reducer exactly as it is and carries what it recorded into the Backend Core. The result is the module's own, untouched. */
  /**
   * `context` is the signed-in person's company (from Supabase Auth). When it is given, a call for another company is refused before the module is touched:
   * the tenant of the call and the tenant of the session must be the same.
   */
  async reduce(state: S, event: E, context?: TenantContext | null): Promise<R> {
    const { core, bridge, stats } = this;
    const tenantId = bridge.tenantOf(event);
    const metrics = await core.metrics();
    if (!TENANT_ID.test(tenantId)) {
      // there is no default company: nothing runs without one
      stats.violations += 1;
      metrics.inc("kynova_integration_violations_total", { check: "tenant" });
      core.logger.warn("llamada sin empresa", { module: bridge.id, type: bridge.typeOf(event) });
      return { state, error: "Falta la empresa (tenant_id): ninguna operación corre sin ella.", errorCode: "tenantRequired" } as R;
    }
    if (context !== undefined) {
      const mismatch = tenantMismatch(context, tenantId);
      if (mismatch) {
        stats.violations += 1;
        metrics.inc("kynova_integration_violations_total", { check: "tenant" });
        core.logger.warn("empresa distinta a la de la sesión", { module: bridge.id, type: bridge.typeOf(event) });
        return { state, error: mismatch, errorCode: "tenantMismatch" } as R;
      }
    }
    stats.tenants.add(tenantId);
    const type = bridge.typeOf(event);
    const actor = bridge.actorOf(event);
    const span = core.tracer.start(`reducer.${bridge.id}`, { attributes: { module: bridge.id, type, tenantId, actor } });
    const traceId = span.context.traceId;
    const startedMs = core.now();
    const result = bridge.reduce(state, event);
    const elapsed = Math.max(0, core.now() - startedMs);

    const refused = result.error !== undefined;
    stats.calls += 1;
    if (refused) stats.refused += 1;
    metrics.inc("kynova_reducer_calls_total", { module: bridge.id, outcome: refused ? "refused" : "ok" });
    metrics.observe("kynova_reducer_duration_ms", elapsed, { module: bridge.id });

    const before = bridge.streams(state);
    const after = bridge.streams(result.state);
    let carried = 0;
    for (const [position, current] of after.entries()) {
      const prior = before[position]?.entries.length ?? 0;
      for (const [offset, entry] of current.entries.slice(prior).entries()) {
        const sent = await this.carry(current, prior + offset + 1, entry, tenantId, traceId);
        if (sent) carried += 1;
      }
    }
    // a refused attempt that left no entry of its own is still part of the history of the company
    if (refused && carried === 0) {
      await core.audit().then((audit) => audit.record({
        tenantId, actorId: actor, actorKind: actorKindOf(actor), module: bridge.modules[0] ?? "koe", action: type, category: "refused",
        ...(result.errorCode ? { detail: result.errorCode } : {}), outcome: "refused", requestId: traceId, at: core.clock(),
      }));
      stats.audits += 1;
      metrics.inc("kynova_audit_records_total", { module: bridge.id, outcome: "refused" });
    }
    await this.observations(bridge.observe?.(state, result.state) ?? [], traceId, span.context.spanId);
    span.setAttribute("outcome", refused ? "refused" : "ok");
    span.setAttribute("entries", carried);
    span.end(refused ? "error" : "ok");
    core.logger.debug("reductor", { module: bridge.id, type, outcome: refused ? "refused" : "ok", tenantId, traceId });
    return result;
  }

  /** The first connection of a module that already has history: carries EVERY entry of a state, each under the company that owns it. */
  async backfill(state: S): Promise<number> {
    let carried = 0;
    const traceId = toHex(randomBytes(16));
    for (const current of this.bridge.streams(state)) {
      for (const [offset, entry] of current.entries.entries()) {
        if (!entry.tenantId) {
          this.stats.violations += 1;
          (await this.core.metrics()).inc("kynova_integration_violations_total", { check: "tenant" });
          continue;
        }
        if (await this.carry(current, offset + 1, entry, entry.tenantId, traceId)) carried += 1;
      }
    }
    return carried;
  }

  /** Publishes one entry and records it in the central audit. Returns whether it went through. */
  private async carry(stream: Stream, index: number, entry: SourceEntry, tenantId: string, traceId: string): Promise<boolean> {
    const { core, bridge, stats } = this;
    const metrics = await core.metrics();
    const entryTenant = entry.tenantId ?? tenantId;
    if (entryTenant !== tenantId) {
      // an entry of one company inside the call of another is never published: it is counted, and it is the audit's business
      stats.violations += 1;
      metrics.inc("kynova_integration_violations_total", { check: "tenant" });
      core.logger.error("entrada de otra empresa", { module: bridge.id, stream: stream.name });
      return false;
    }
    const bus = core.events();
    const published = (await bus).publish({ ...eventFromEntry(stream.module, entryTenant, entry), id: `${bridge.id}.${stream.name}:${index}`.slice(0, 64), correlationId: traceId });
    if (!published.ok) {
      stats.violations += 1;
      metrics.inc("kynova_integration_violations_total", { check: "event" });
      core.logger.error("evento no válido", { module: bridge.id, problems: published.problems.join("; ") });
      return false;
    }
    if (published.duplicate) return true; // already carried: the bus keeps one copy, and so does the audit
    stats.events += 1;
    metrics.inc("kynova_bus_events_total", { module: stream.module });
    const outcome = outcomeOfAction(entry.action);
    await (await core.audit()).record({ ...auditFromModuleEntry(stream.module, entryTenant, entry, { outcome, requestId: traceId, target: stream.name }), at: entry.at });
    stats.audits += 1;
    metrics.inc("kynova_audit_records_total", { module: stream.module, outcome });
    return true;
  }

  private async observations(items: readonly Observation[], traceId: string, parentSpanId: string): Promise<void> {
    const { core, stats } = this;
    const metrics = await core.metrics();
    for (const item of items) {
      if (item.kind === "metric") {
        if (item.metric === "inc") metrics.inc(item.name, item.labels, item.value ?? 1);
        else metrics.observe(item.name, item.value ?? 0, item.labels);
      } else if (item.kind === "span") {
        // a child span of the call, with the duration the module simulated (the work itself took no time here)
        const endedMs = Date.parse(item.at);
        core.spans.write({
          traceId, spanId: toHex(randomBytes(8)), parentId: parentSpanId, name: item.name, startedAt: new Date(endedMs - item.durationMs).toISOString(), endedAt: item.at,
          durationMs: item.durationMs, status: item.status, attributes: item.attributes,
        });
      } else {
        if (!TENANT_ID.test(item.tenantId)) { stats.violations += 1; continue; }
        const result = (await core.events()).publish({ type: `${item.module}.${item.name}`, module: item.module, tenantId: item.tenantId, actor: item.actor, at: item.at, id: item.id.slice(0, 64), correlationId: traceId, payload: item.payload });
        if (!result.ok) { stats.violations += 1; metrics.inc("kynova_integration_violations_total", { check: "event" }); continue; }
        if (!result.duplicate) { stats.events += 1; metrics.inc("kynova_bus_events_total", { module: item.module }); }
      }
    }
  }
}
