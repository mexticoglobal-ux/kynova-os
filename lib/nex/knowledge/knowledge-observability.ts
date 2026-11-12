// Knowledge Observability: nodes, relations, searches, traversals, ranking, latency, hits and misses, per company. It only reads the event log (and, for the shape of the graph, the state).

import { tenantEdges, tenantNodes } from "./knowledge-graph";
import type { KnowledgeEventLog, KnowledgeLogEvent } from "./knowledge-events";
import type { KnowledgeState } from "./knowledge-types";

type Counters = {
  nodesCreated: number; nodesUpdated: number; nodesRemoved: number; nodesUsed: number; edgesCreated: number; edgesUpdated: number; edgesRemoved: number; builds: number;
  searches: number; hits: number; misses: number; traversals: number; refused: number;
};
const zero = (): Counters => ({ nodesCreated: 0, nodesUpdated: 0, nodesRemoved: 0, nodesUsed: 0, edgesCreated: 0, edgesUpdated: 0, edgesRemoved: 0, builds: 0, searches: 0, hits: 0, misses: 0, traversals: 0, refused: 0 });
const num = (value: unknown): number => (typeof value === "number" ? value : 0);

type Tenant = { counters: Counters; latency: number[]; topScores: number[]; traversals: Record<string, number>; refusals: Record<string, number>; skipped: Record<string, number> };

export class KnowledgeObservability {
  private readonly tenants = new Map<string, Tenant>();
  private detach: (() => void) | undefined;
  constructor(log?: KnowledgeEventLog) { if (log) this.detach = log.listen((event) => this.count(event)); }
  stop(): void { this.detach?.(); }

  private row(tenantId: string): Tenant {
    const found = this.tenants.get(tenantId);
    if (found) return found;
    const created: Tenant = { counters: zero(), latency: [], topScores: [], traversals: {}, refusals: {}, skipped: {} };
    this.tenants.set(tenantId, created);
    return created;
  }
  count(event: KnowledgeLogEvent): void {
    const row = this.row(event.tenantId);
    const c = row.counters;
    const detail = event.detail ?? {};
    switch (event.type) {
      case "node.created": c.nodesCreated += 1; break;
      case "node.updated": c.nodesUpdated += 1; break;
      case "node.removed": c.nodesRemoved += 1; break;
      case "node.used": c.nodesUsed += Math.max(1, num(detail["count"])); break;
      case "edge.created": c.edgesCreated += 1; break;
      case "edge.updated": c.edgesUpdated += 1; break;
      case "edge.removed": c.edgesRemoved += 1; break;
      case "graph.built":
        c.builds += 1; c.nodesCreated += num(detail["nodesCreated"]); c.nodesUpdated += num(detail["nodesUpdated"]); c.nodesRemoved += num(detail["nodesRemoved"]);
        c.edgesCreated += num(detail["edgesCreated"]); c.edgesUpdated += num(detail["edgesUpdated"]); c.edgesRemoved += num(detail["edgesRemoved"]);
        break;
      case "graph.searched":
        c.searches += 1;
        if (num(detail["hits"]) > 0) c.hits += 1; else c.misses += 1;
        if (typeof detail["latencyMs"] === "number") row.latency.push(detail["latencyMs"]);
        if (typeof detail["topScore"] === "number") row.topScores.push(detail["topScore"]);
        break;
      case "graph.traversed": {
        c.traversals += 1;
        const kind = typeof detail["kind"] === "string" ? detail["kind"] : "unknown";
        row.traversals[kind] = (row.traversals[kind] ?? 0) + 1;
        if (typeof detail["latencyMs"] === "number") row.latency.push(detail["latencyMs"]);
        break;
      }
      case "graph.refused": { c.refused += 1; const reason = typeof detail["reason"] === "string" ? detail["reason"] : "unknown"; row.refusals[reason] = (row.refusals[reason] ?? 0) + 1; break; }
      default: break;
    }
  }

  /** One company's numbers; a company never sees another's. `state` adds the shape of the graph. */
  snapshot(tenantId: string, state?: KnowledgeState) {
    const row = this.row(tenantId);
    const sorted = [...row.latency].sort((a, b) => a - b);
    const total = row.counters.hits + row.counters.misses;
    return {
      counters: { ...row.counters },
      hitRatePercent: total === 0 ? 0 : Math.round((row.counters.hits / total) * 100),
      latency: { count: sorted.length, avgMs: sorted.length === 0 ? 0 : Math.round((sorted.reduce((a, b) => a + b, 0) / sorted.length) * 10) / 10, maxMs: sorted.at(-1) ?? 0, p95Ms: sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] as number) },
      ranking: { searchesRanked: row.topScores.length, avgTopScore: row.topScores.length === 0 ? 0 : Math.round((row.topScores.reduce((a, b) => a + b, 0) / row.topScores.length) * 10) / 10, maxTopScore: Math.max(0, ...row.topScores) },
      traversals: { ...row.traversals },
      refusals: { ...row.refusals },
      ...(state ? { graph: this.shape(state, tenantId) } : {}),
    };
  }
  private shape(state: KnowledgeState, tenantId: string) {
    const nodes = tenantNodes(state, tenantId);
    const edges = tenantEdges(state, tenantId);
    const byType: Record<string, number> = {};
    const byRelation: Record<string, number> = {};
    const touched = new Set<string>();
    for (const node of nodes) byType[node.type] = (byType[node.type] ?? 0) + 1;
    for (const edge of edges) { byRelation[edge.relation] = (byRelation[edge.relation] ?? 0) + 1; touched.add(edge.from); touched.add(edge.to); }
    return { nodes: nodes.length, edges: edges.length, nodesByType: byType, edgesByRelation: byRelation, isolated: nodes.filter((node) => !touched.has(node.id)).length };
  }
}
