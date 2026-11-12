// Knowledge Engine: `reduceKnowledge(state, event, env)` is a pure reducer (no clock, no database, no AI): the same state and event always give the same new state. The graph only REFERENCES what
// other modules already hold; it never copies a memory. Nodes are unique by (type, reference) and edges by (from, relation, to), so nothing is duplicated; loops in the hierarchy and in the
// dependencies are refused; a relation never crosses companies. The Knowledge Builder turns facts that other modules already hold (memory, organization, CRM, templates, architect, workers,
// automations, insights, billing, marketplace, academy) into nodes and edges. It only READS them: it receives plain records and never writes back. Applying the same records twice changes nothing.

import { DEFAULT_EDGE, createsCycle, edgeId, relationAllowed, validateEdgeNumbers } from "./knowledge-edge";
import { KnowledgeEventLog } from "./knowledge-events";
import {
  MAX_EDGES_PER_TENANT, MAX_NODES_PER_TENANT, bfs, dfs, dropEdges, dropNodes, getEdge, getNode, neighborhood, newKnowledgeState, putEdge, putNode, shortestPath, tenantEdges, tenantNodes, viewFor, withAudit,
  type PathResult, type TraverseOptions, type Visit,
} from "./knowledge-graph";
import { mergeNode, nodeId, validateNodeInput } from "./knowledge-node";
import { KnowledgeObservability } from "./knowledge-observability";
import { canBuild, canLink, canReadNode, canRemove, canWriteNode } from "./knowledge-security";
import { relatedKnowledge, searchKnowledge, type KnowledgeQuery, type KnowledgeSearchResult, type RelatedOptions } from "./knowledge-search";
import {
  NODE_TYPES, SOURCES, principalId,
  type BuildReport, type EdgeInput, type KnowledgeEdge, type KnowledgeEnv, type KnowledgeEvent, type KnowledgeEventInput, type KnowledgeEventType, type KnowledgeNode, type KnowledgeOutcome, type KnowledgeResult,
  type KnowledgeState, type MemoryRow, type NodeInput, type NodeType, type Principal, type Refusal, type SourceLink, type SourceName, type SourceRecord,
} from "./knowledge-types";

// ------------------------------------------------------------------------------------------ which source may speak of which kind of node
const SOURCE_NODE_TYPES: Readonly<Record<SourceName, readonly NodeType[]>> = {
  memory: ["conversation", "process", "document", "decision", "preference", "customer", "company", "person", "worker"],
  organization: ["company", "person", "worker", "agent", "project", "process", "task"],
  crm: ["customer", "lead", "person", "conversation", "event", "task", "campaign", "company"],
  templates: ["process", "automation", "service", "product", "document", "kpi", "company"],
  architect: ["process", "service", "product", "automation", "kpi", "project", "document", "company"],
  workers: ["worker", "agent", "task", "process", "automation", "person", "company"],
  automations: ["automation", "process", "event", "task", "worker", "agent", "company"],
  insights: ["kpi", "decision", "event", "document", "campaign", "company"],
  billing: ["customer", "service", "product", "event", "document", "person", "company"],
  marketplace: ["product", "service", "campaign", "document", "customer", "company"],
  academy: ["document", "project", "event", "person", "process", "company"],
  manual: NODE_TYPES,
};
export const sourceNodeTypes = (source: SourceName): readonly NodeType[] => SOURCE_NODE_TYPES[source];

// ------------------------------------------------------------------------------------------ memory → records (reads a memory, copies none of it)
const MEMORY_NODE: Readonly<Record<MemoryRow["type"], NodeType | undefined>> = { conversation: "conversation", business: "process", customer: "customer", document: "document", workflow: "process", decision: "decision", preference: "preference", learning: "preference", system: undefined };
const LEARNABLE: readonly NodeType[] = ["preference", "decision", "process"];
const MAX_TAG_HOLDERS = 40;
const MIN_SHARED_TAGS = 2;

/**
 * The facts a list of memories holds, as graph records: each memory is a node that REFERENCES it (by id) and belongs to its company; who created it (or, for advisory knowledge, who learned it) and
 * who confirmed it are linked; memories that share at least two tags are related. Expired memories and System Memory are left out. Permissions travel with the node, so a restricted memory is
 * as hidden in the graph as it is in memory. Nothing else of the memory (not its summary) is copied.
 */
export function memoryRecords(rows: readonly MemoryRow[]): SourceRecord[] {
  const live = rows.filter((row) => row.status !== "expired" && MEMORY_NODE[row.type] !== undefined).sort((a, b) => a.tenantId.localeCompare(b.tenantId) || a.id.localeCompare(b.id));
  const typeOf = (row: MemoryRow) => MEMORY_NODE[row.type] as NodeType;
  const related = new Map<string, SourceLink[]>();
  const holders = new Map<string, MemoryRow[]>();
  for (const row of live) for (const tag of row.tags) { const key = `${row.tenantId}|${tag}`; holders.set(key, [...(holders.get(key) ?? []), row]); }
  const shared = new Map<string, { a: MemoryRow; b: MemoryRow; count: number }>();
  for (const group of holders.values()) {
    if (group.length < 2 || group.length > MAX_TAG_HOLDERS) continue;
    for (let i = 0; i < group.length; i += 1) for (let j = i + 1; j < group.length; j += 1) {
      const a = group[i] as MemoryRow;
      const b = group[j] as MemoryRow;
      const key = `${a.tenantId}|${a.id}|${b.id}`;
      shared.set(key, { a, b, count: (shared.get(key)?.count ?? 0) + 1 });
    }
  }
  for (const { a, b, count } of shared.values()) {
    if (count < MIN_SHARED_TAGS) continue;
    const key = `${a.tenantId}|${a.id}`;
    related.set(key, [...(related.get(key) ?? []), { relation: "relatedTo", toType: typeOf(b), toId: b.id, weight: Math.min(1, count / 4), confidence: 60 }]);
  }
  return live.map((row): SourceRecord => {
    const type = typeOf(row);
    const links: SourceLink[] = [{ relation: "belongsTo", toType: "company", toId: row.tenantId }];
    if (row.createdBy.kind !== "system") {
      const learned = row.advisory && row.createdBy.kind === "worker" && LEARNABLE.includes(type);
      links.push({ relation: learned ? "learned" : "created", toType: row.createdBy.kind, toId: row.createdBy.id, direction: "in" });
    }
    if (row.confirmedBy) links.push({ relation: "approved", toType: "person", toId: row.confirmedBy, direction: "in" });
    links.push(...(related.get(`${row.tenantId}|${row.id}`) ?? []));
    return {
      tenantId: row.tenantId, type, referenceId: row.id, importance: row.importance, confidence: row.confidence, category: row.category, tags: row.tags.slice(0, 8), permissions: row.permissions,
      ...(row.workerId ? { workerId: row.workerId } : {}), links,
    };
  });
}

// ------------------------------------------------------------------------------------------ result helpers
const note = (event: KnowledgeEvent, type: KnowledgeEventType, detail?: Readonly<Record<string, unknown>>): KnowledgeEventInput => ({
  at: event.at, tenantId: event.actor.tenantId, actorKind: event.actor.kind, actorId: principalId(event.actor), type, ...(detail ? { detail } : {}),
});
function finish(state: KnowledgeState, event: KnowledgeEvent, result: Omit<KnowledgeResult, "events">, events: readonly KnowledgeEventInput[]): KnowledgeOutcome {
  // the audit trail names the action, never the knowledge; it is written in the ACTOR's company (a claimed company that is not theirs is not polluted)
  const detail: Record<string, string | number | boolean> = { ok: result.ok, ...(result.refusal ? { reason: result.refusal } : {}) };
  return { state: withAudit(state, { at: event.at, actor: principalId(event.actor), tenantId: event.actor.tenantId, action: `${event.type}${result.ok ? "" : ".refused"}`, detail }), result: { ...result, events } };
}
const refuse = (state: KnowledgeState, event: KnowledgeEvent, refusal: Refusal, reasons: readonly string[] = []): KnowledgeOutcome =>
  finish(state, event, { ok: false, refusal, ...(reasons.length > 0 ? { reasons } : {}) }, [note(event, "graph.refused", { reason: refusal, action: event.type })]);

// ------------------------------------------------------------------------------------------ steps shared by the reducer and the builder
type Ctx = { tenantId: string; at: string; source: SourceName };
type LinkOutcome = { ok: true; state: KnowledgeState; edge: KnowledgeEdge; created: boolean; changed: boolean } | { ok: false; refusal: Refusal; reasons?: readonly string[] };

function linkStep(state: KnowledgeState, ctx: Ctx, input: EdgeInput, reinforce: boolean): LinkOutcome {
  const from = getNode(state, ctx.tenantId, input.from);
  const to = getNode(state, ctx.tenantId, input.to);
  if (!from || !to) return { ok: false, refusal: "notFound" };
  if (from.id === to.id) return { ok: false, refusal: "self" };
  if (!relationAllowed(input.relation, from.type, to.type)) return { ok: false, refusal: "relation" };
  const issues = validateEdgeNumbers(input);
  if (issues.length > 0) return { ok: false, refusal: "invalid", reasons: issues };
  const id = edgeId(from.id, input.relation, to.id);
  const existing = getEdge(state, ctx.tenantId, id);
  if (existing) {
    const next: KnowledgeEdge = { ...existing, confidence: input.confidence ?? existing.confidence, weight: input.weight ?? existing.weight, observations: reinforce ? existing.observations + 1 : existing.observations };
    const changed = JSON.stringify(next) !== JSON.stringify(existing);
    return { ok: true, state: changed ? putEdge(state, next) : state, edge: next, created: false, changed };
  }
  if (createsCycle(tenantEdges(state, ctx.tenantId), { from: from.id, to: to.id, relation: input.relation })) return { ok: false, refusal: "cycle" };
  if (tenantEdges(state, ctx.tenantId).length >= MAX_EDGES_PER_TENANT) return { ok: false, refusal: "limit" };
  const edge: KnowledgeEdge = {
    id, tenantId: ctx.tenantId, from: from.id, to: to.id, relation: input.relation, confidence: input.confidence ?? DEFAULT_EDGE.confidence, weight: input.weight ?? DEFAULT_EDGE.weight,
    createdAt: ctx.at, observations: 1, source: ctx.source,
  };
  return { ok: true, state: putEdge(state, edge), edge, created: true, changed: true };
}

function applyBuild(start: KnowledgeState, ctx: Ctx, records: readonly SourceRecord[], replace: boolean): { state: KnowledgeState; report: BuildReport } {
  const allowed = SOURCE_NODE_TYPES[ctx.source];
  const skipped: Record<string, number> = {};
  const bump = (reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };
  const nodes = { created: 0, updated: 0, removed: 0 };
  const edges = { created: 0, updated: 0, removed: 0 };
  let state = start;
  const keep = new Set<string>();
  const produced = new Set<string>();

  const ensure = (input: NodeInput): KnowledgeNode | undefined => {
    const { issues, sensitive } = validateNodeInput(input);
    if (sensitive) { bump("sensitive"); return undefined; }
    if (issues.length > 0) { bump("invalid"); return undefined; }
    const existing = getNode(state, ctx.tenantId, nodeId(input.type, input.referenceId));
    if (!existing && tenantNodes(state, ctx.tenantId).length >= MAX_NODES_PER_TENANT) { bump("limit"); return undefined; }
    const merged = mergeNode(existing, ctx.tenantId, ctx.at, ctx.source, input);
    if (merged.changed) { state = putNode(state, merged.node); if (merged.created) nodes.created += 1; else nodes.updated += 1; }
    keep.add(merged.node.id);
    return merged.node;
  };

  // the company is the root every other node ends up under
  ensure({ type: "company", referenceId: ctx.tenantId });
  const accepted: SourceRecord[] = [];
  for (const record of [...records].sort((a, b) => a.type.localeCompare(b.type) || a.referenceId.localeCompare(b.referenceId))) {
    if (record.tenantId !== ctx.tenantId) { bump("crossTenant"); continue; } // a record of another company is never mixed in
    if (!allowed.includes(record.type)) { bump("sourceType"); continue; }
    const node = ensure({
      type: record.type, referenceId: record.referenceId, ...(record.confidence !== undefined ? { confidence: record.confidence } : {}), ...(record.importance !== undefined ? { importance: record.importance } : {}),
      ...(record.permissions ? { permissions: record.permissions } : {}), ...(record.workerId !== undefined ? { workerId: record.workerId } : {}), ...(record.category !== undefined ? { category: record.category } : {}), ...(record.tags ? { tags: record.tags } : {}),
    });
    if (node) accepted.push(record);
  }
  for (const record of accepted) {
    const own = nodeId(record.type, record.referenceId);
    for (const link of record.links ?? []) {
      if (!allowed.includes(link.toType)) { bump("sourceType"); continue; }
      const target = ensure({ type: link.toType, referenceId: link.toId });
      if (!target) continue;
      const input: EdgeInput = { from: link.direction === "in" ? target.id : own, to: link.direction === "in" ? own : target.id, relation: link.relation, ...(link.confidence !== undefined ? { confidence: link.confidence } : {}), ...(link.weight !== undefined ? { weight: link.weight } : {}) };
      const linked = linkStep(state, ctx, input, false);
      if (!linked.ok) { bump(linked.refusal); continue; }
      state = linked.state;
      produced.add(linked.edge.id);
      if (linked.created) edges.created += 1; else if (linked.changed) edges.updated += 1;
    }
  }
  if (replace) {
    // what this source no longer says is removed: a memory that was deleted leaves the graph. The company node is never removed.
    const gone = new Set(tenantNodes(state, ctx.tenantId).filter((node) => node.source === ctx.source && node.type !== "company" && !keep.has(node.id)).map((node) => node.id));
    const stale = new Set(tenantEdges(state, ctx.tenantId).filter((edge) => edge.source === ctx.source && !produced.has(edge.id)).map((edge) => edge.id));
    const before = tenantEdges(state, ctx.tenantId).length;
    state = dropEdges(state, ctx.tenantId, stale);
    const dropped = dropNodes(state, ctx.tenantId, gone);
    state = dropped.state;
    nodes.removed += gone.size;
    edges.removed += before - tenantEdges(state, ctx.tenantId).length;
  }
  return { state, report: { source: ctx.source, nodes, edges, skipped } };
}

// ------------------------------------------------------------------------------------------ the reducer
export function reduceKnowledge(state: KnowledgeState, event: KnowledgeEvent, env: KnowledgeEnv): KnowledgeOutcome {
  const { actor } = event;
  if (actor.tenantId !== event.tenantId) return refuse(state, event, "tenant");
  if (Number.isNaN(Date.parse(event.at))) return refuse(state, event, "invalid", ["at"]);
  if (actor.kind === "worker" && !env.isWorkerActive(actor.tenantId, actor.id)) return refuse(state, event, "workerInactive");
  const tenantId = event.tenantId;
  // what the asker cannot read does not exist for them
  const find = (id: string): KnowledgeNode | undefined => { const node = getNode(state, tenantId, id); return node && canReadNode(actor, node) ? node : undefined; };

  switch (event.type) {
    case "node.upsert": {
      const { input } = event;
      if (!NODE_TYPES.includes(input.type)) return refuse(state, event, "invalid", ["type"]);
      if (!canWriteNode(actor, input.type)) return refuse(state, event, "forbidden");
      const { issues, sensitive } = validateNodeInput(input);
      if (sensitive) return refuse(state, event, "sensitive");
      if (issues.length > 0) return refuse(state, event, "invalid", issues);
      const existing = getNode(state, tenantId, nodeId(input.type, input.referenceId));
      if (existing && !canReadNode(actor, existing)) return refuse(state, event, "notFound");
      if (!existing && tenantNodes(state, tenantId).length >= MAX_NODES_PER_TENANT) return refuse(state, event, "limit");
      const merged = mergeNode(existing, tenantId, event.at, "manual", input);
      const next = merged.changed ? putNode(state, merged.node) : state;
      return finish(next, event, { ok: true, node: merged.node, created: merged.created }, merged.created ? [note(event, "node.created", { type: merged.node.type })] : merged.changed ? [note(event, "node.updated", { type: merged.node.type })] : []);
    }
    case "node.remove": {
      if (!canRemove(actor)) return refuse(state, event, "forbidden");
      const node = find(event.id);
      if (!node) return refuse(state, event, "notFound");
      if (node.type === "company") return refuse(state, event, "invalid", ["company"]);
      const dropped = dropNodes(state, tenantId, new Set([node.id]));
      return finish(dropped.state, event, { ok: true, removed: { nodes: 1, edges: dropped.edgesDropped } }, [note(event, "node.removed", { type: node.type, edges: dropped.edgesDropped })]);
    }
    case "node.use": {
      let next = state;
      const used: string[] = [];
      for (const id of [...new Set(event.ids)].slice(0, 100)) {
        const node = find(id);
        if (!node) continue;
        next = putNode(next, { ...node, uses: node.uses + 1 });
        used.push(id);
      }
      return finish(next, event, { ok: true, used }, used.length > 0 ? [note(event, "node.used", { count: used.length })] : []);
    }
    case "edge.link": {
      const { input } = event;
      if (!canLink(actor, input.relation)) return refuse(state, event, "forbidden");
      if (!find(input.from) || !find(input.to)) return refuse(state, event, "notFound");
      const linked = linkStep(state, { tenantId, at: event.at, source: "manual" }, input, true);
      if (!linked.ok) return refuse(state, event, linked.refusal, linked.reasons);
      return finish(linked.state, event, { ok: true, edge: linked.edge, created: linked.created }, [note(event, linked.created ? "edge.created" : "edge.updated", { relation: linked.edge.relation })]);
    }
    case "edge.unlink": {
      if (!canRemove(actor)) return refuse(state, event, "forbidden");
      const edge = getEdge(state, tenantId, event.id);
      if (!edge || !find(edge.from) || !find(edge.to)) return refuse(state, event, "notFound");
      return finish(dropEdges(state, tenantId, new Set([edge.id])), event, { ok: true, removed: { nodes: 0, edges: 1 } }, [note(event, "edge.removed", { relation: edge.relation })]);
    }
    case "build": {
      if (!canBuild(actor)) return refuse(state, event, "forbidden");
      if (!SOURCES.includes(event.source)) return refuse(state, event, "invalid", ["source"]);
      const { state: next, report } = applyBuild(state, { tenantId, at: event.at, source: event.source }, event.records, event.replace === true);
      return finish(next, event, { ok: true, build: report }, [note(event, "graph.built", {
        source: report.source, nodesCreated: report.nodes.created, nodesUpdated: report.nodes.updated, nodesRemoved: report.nodes.removed,
        edgesCreated: report.edges.created, edgesUpdated: report.edges.updated, edgesRemoved: report.edges.removed, skipped: Object.values(report.skipped).reduce((a, b) => a + b, 0),
      })]);
    }
  }
}

// ------------------------------------------------------------------------------------------ the engine: state + log + observability around the reducer
export type EngineOptions = { env: KnowledgeEnv; /** milliseconds; injected so nothing here reads a clock */ now: () => number; state?: KnowledgeState };
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export class KnowledgeEngine {
  state: KnowledgeState;
  readonly log = new KnowledgeEventLog();
  readonly observability = new KnowledgeObservability(this.log);
  constructor(private readonly options: EngineOptions) { this.state = options.state ?? newKnowledgeState(); }

  private at(): string { return new Date(this.options.now()).toISOString(); }
  dispatch(event: KnowledgeEvent): KnowledgeResult {
    const { state, result } = reduceKnowledge(this.state, event, this.options.env);
    this.state = state;
    for (const input of result.events) this.log.emit(input);
    return result;
  }
  private send(actor: Principal, rest: DistributiveOmit<KnowledgeEvent, "tenantId" | "actor" | "at">): KnowledgeResult { return this.dispatch({ ...rest, tenantId: actor.tenantId, actor, at: this.at() } as KnowledgeEvent); }

  upsertNode(actor: Principal, input: NodeInput): KnowledgeResult { return this.send(actor, { type: "node.upsert", input }); }
  removeNode(actor: Principal, id: string): KnowledgeResult { return this.send(actor, { type: "node.remove", id }); }
  useNodes(actor: Principal, ids: readonly string[]): KnowledgeResult { return this.send(actor, { type: "node.use", ids }); }
  link(actor: Principal, input: EdgeInput): KnowledgeResult { return this.send(actor, { type: "edge.link", input }); }
  unlink(actor: Principal, id: string): KnowledgeResult { return this.send(actor, { type: "edge.unlink", id }); }
  /** Builds from records a source already holds. With `replace`, what that source no longer says leaves the graph. */
  build(actor: Principal, source: SourceName, records: readonly SourceRecord[], replace = false): KnowledgeResult { return this.send(actor, { type: "build", source, records, replace }); }
  /** Reads memories and relates them; the memories themselves are neither copied nor changed. */
  buildFromMemory(actor: Principal, rows: readonly MemoryRow[]): KnowledgeResult { return this.build(actor, "memory", memoryRecords(rows), true); }

  private timed<T>(run: () => T): { value: T; latencyMs: number } {
    const started = this.options.now();
    const value = run();
    return { value, latencyMs: Math.max(0, this.options.now() - started) };
  }
  private emit(actor: Principal, type: KnowledgeEventType, detail: Readonly<Record<string, unknown>>) { this.log.emit({ at: this.at(), tenantId: actor.tenantId, actorKind: actor.kind, actorId: principalId(actor), type, detail }); }

  search(actor: Principal, query: KnowledgeQuery): KnowledgeSearchResult {
    const { value, latencyMs } = this.timed(() => searchKnowledge(this.state, actor, query));
    this.emit(actor, "graph.searched", { hits: value.hits.length, total: value.total, latencyMs, ...(value.hits[0] ? { topScore: value.hits[0].score } : {}) });
    return value;
  }
  related(actor: Principal, id: string, options: RelatedOptions = {}): KnowledgeSearchResult {
    const { value, latencyMs } = this.timed(() => relatedKnowledge(this.state, actor, id, options));
    this.emit(actor, "graph.searched", { hits: value.hits.length, total: value.total, latencyMs, kind: "related", ...(value.hits[0] ? { topScore: value.hits[0].score } : {}) });
    return value;
  }
  breadthFirst(actor: Principal, start: string, options: TraverseOptions = {}): Visit[] { return this.walk(actor, "bfs", () => bfs(viewFor(this.state, actor), start, options), options.maxDepth); }
  depthFirst(actor: Principal, start: string, options: TraverseOptions = {}): Visit[] { return this.walk(actor, "dfs", () => dfs(viewFor(this.state, actor), start, options), options.maxDepth); }
  shortestPath(actor: Principal, from: string, to: string, options: TraverseOptions = {}): PathResult {
    const { value, latencyMs } = this.timed(() => shortestPath(viewFor(this.state, actor), from, to, options));
    this.emit(actor, "graph.traversed", { kind: "path", visited: value.nodes.length, found: value.found, latencyMs });
    return value;
  }
  neighborhood(actor: Principal, id: string, depth: number, options: Omit<TraverseOptions, "maxDepth"> = {}) {
    const { value, latencyMs } = this.timed(() => neighborhood(viewFor(this.state, actor), id, depth, options));
    this.emit(actor, "graph.traversed", { kind: "neighborhood", visited: value.nodes.length, depth, latencyMs });
    return value;
  }
  private walk(actor: Principal, kind: string, run: () => Visit[], depth: number | undefined): Visit[] {
    const { value, latencyMs } = this.timed(run);
    this.emit(actor, "graph.traversed", { kind, visited: value.length, depth: depth ?? 3, latencyMs });
    return value;
  }
  snapshot(tenantId: string) { return this.observability.snapshot(tenantId, this.state); }
}
