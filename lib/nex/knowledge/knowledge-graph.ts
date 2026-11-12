// Knowledge Graph: the state (nodes and edges of every company, in plain lists), the small pure operations on it, and the traversals over what ONE asker may see. A `View` holds only the nodes
// the asker can read and the edges whose two ends they can read, all of one company: a traversal cannot pass through, or even learn about, what is hidden. Every neighbor list is sorted, so the
// same graph always gives the same traversal.

import { canReadNode } from "./knowledge-security";
import type { AuditEntry, KnowledgeEdge, KnowledgeNode, KnowledgeState, Principal, Relation } from "./knowledge-types";

export const MAX_NODES_PER_TENANT = 10_000;
export const MAX_EDGES_PER_TENANT = 50_000;
export const MAX_AUDIT = 2_000;
export const DEFAULT_DEPTH = 3;
export const MAX_DEPTH = 10;

export const newKnowledgeState = (): KnowledgeState => ({ nodes: [], edges: [], audit: [] });
export const getNode = (state: KnowledgeState, tenantId: string, id: string): KnowledgeNode | undefined => state.nodes.find((node) => node.tenantId === tenantId && node.id === id);
export const getEdge = (state: KnowledgeState, tenantId: string, id: string): KnowledgeEdge | undefined => state.edges.find((edge) => edge.tenantId === tenantId && edge.id === id);
export const tenantNodes = (state: KnowledgeState, tenantId: string): readonly KnowledgeNode[] => state.nodes.filter((node) => node.tenantId === tenantId);
export const tenantEdges = (state: KnowledgeState, tenantId: string): readonly KnowledgeEdge[] => state.edges.filter((edge) => edge.tenantId === tenantId);

export const putNode = (state: KnowledgeState, node: KnowledgeNode): KnowledgeState => {
  const exists = state.nodes.some((row) => row.tenantId === node.tenantId && row.id === node.id);
  return { ...state, nodes: exists ? state.nodes.map((row) => (row.tenantId === node.tenantId && row.id === node.id ? node : row)) : [...state.nodes, node] };
};
export const putEdge = (state: KnowledgeState, edge: KnowledgeEdge): KnowledgeState => {
  const exists = state.edges.some((row) => row.tenantId === edge.tenantId && row.id === edge.id);
  return { ...state, edges: exists ? state.edges.map((row) => (row.tenantId === edge.tenantId && row.id === edge.id ? edge : row)) : [...state.edges, edge] };
};
/** Removes nodes and every edge that touched them. */
export function dropNodes(state: KnowledgeState, tenantId: string, ids: ReadonlySet<string>): { state: KnowledgeState; edgesDropped: number } {
  const edges = state.edges.filter((edge) => !(edge.tenantId === tenantId && (ids.has(edge.from) || ids.has(edge.to))));
  return { state: { ...state, nodes: state.nodes.filter((node) => !(node.tenantId === tenantId && ids.has(node.id))), edges }, edgesDropped: state.edges.length - edges.length };
}
export const dropEdges = (state: KnowledgeState, tenantId: string, ids: ReadonlySet<string>): KnowledgeState => ({ ...state, edges: state.edges.filter((edge) => !(edge.tenantId === tenantId && ids.has(edge.id))) });
export const withAudit = (state: KnowledgeState, entry: AuditEntry): KnowledgeState => ({ ...state, audit: [...state.audit, entry].slice(-MAX_AUDIT) });

// ---------------------------------------------------------------------------------------------- the view of one asker
export type View = { readonly tenantId: string; readonly nodes: ReadonlyMap<string, KnowledgeNode>; readonly out: ReadonlyMap<string, readonly KnowledgeEdge[]>; readonly inn: ReadonlyMap<string, readonly KnowledgeEdge[]> };

export function viewFor(state: KnowledgeState, principal: Principal): View {
  const nodes = new Map<string, KnowledgeNode>();
  for (const node of state.nodes) if (node.tenantId === principal.tenantId && canReadNode(principal, node)) nodes.set(node.id, node);
  const out = new Map<string, KnowledgeEdge[]>();
  const inn = new Map<string, KnowledgeEdge[]>();
  for (const edge of state.edges) {
    if (edge.tenantId !== principal.tenantId || !nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    out.set(edge.from, [...(out.get(edge.from) ?? []), edge]);
    inn.set(edge.to, [...(inn.get(edge.to) ?? []), edge]);
  }
  for (const list of out.values()) list.sort((a, b) => a.to.localeCompare(b.to) || a.relation.localeCompare(b.relation));
  for (const list of inn.values()) list.sort((a, b) => a.from.localeCompare(b.from) || a.relation.localeCompare(b.relation));
  return { tenantId: principal.tenantId, nodes, out, inn };
}
export const viewEdges = (view: View): KnowledgeEdge[] => [...view.out.values()].flat().sort((a, b) => a.id.localeCompare(b.id));

// ---------------------------------------------------------------------------------------------- traversals
export type Direction = "out" | "in" | "both";
export type TraverseOptions = { maxDepth?: number; relations?: readonly Relation[]; direction?: Direction };
export type Visit = { id: string; depth: number; via?: { edgeId: string; relation: Relation; from: string } };
type Step = { id: string; edge: KnowledgeEdge };

const depthOf = (options: TraverseOptions) => Math.max(0, Math.min(options.maxDepth ?? DEFAULT_DEPTH, MAX_DEPTH));
function steps(view: View, id: string, options: TraverseOptions): Step[] {
  const direction = options.direction ?? "both";
  const allowed = options.relations ? new Set<Relation>(options.relations) : undefined;
  const found: Step[] = [];
  if (direction !== "in") for (const edge of view.out.get(id) ?? []) found.push({ id: edge.to, edge });
  if (direction !== "out") for (const edge of view.inn.get(id) ?? []) found.push({ id: edge.from, edge });
  return found.filter((step) => !allowed || allowed.has(step.edge.relation)).sort((a, b) => a.id.localeCompare(b.id) || a.edge.relation.localeCompare(b.edge.relation) || a.edge.id.localeCompare(b.edge.id));
}
export const neighborIds = (view: View, id: string, direction: Direction = "both"): string[] => [...new Set(steps(view, id, { direction }).map((step) => step.id))];
const via = (step: Step, from: string): Visit["via"] => ({ edgeId: step.edge.id, relation: step.edge.relation, from });

/** Breadth first: level by level, in a fixed order. */
export function bfs(view: View, start: string, options: TraverseOptions = {}): Visit[] {
  if (!view.nodes.has(start)) return [];
  const limit = depthOf(options);
  const seen = new Set<string>([start]);
  const order: Visit[] = [{ id: start, depth: 0 }];
  for (let cursor = 0; cursor < order.length; cursor += 1) {
    const current = order[cursor] as Visit;
    if (current.depth >= limit) continue;
    for (const step of steps(view, current.id, options)) {
      if (seen.has(step.id)) continue;
      seen.add(step.id);
      order.push({ id: step.id, depth: current.depth + 1, via: via(step, current.id) });
    }
  }
  return order;
}
/** Depth first, preorder: follows the first neighbor all the way down before coming back. */
export function dfs(view: View, start: string, options: TraverseOptions = {}): Visit[] {
  if (!view.nodes.has(start)) return [];
  const limit = depthOf(options);
  const seen = new Set<string>();
  const order: Visit[] = [];
  const stack: Visit[] = [{ id: start, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop() as Visit;
    if (seen.has(current.id)) continue;
    seen.add(current.id);
    order.push(current);
    if (current.depth >= limit) continue;
    const next = steps(view, current.id, options).filter((step) => !seen.has(step.id));
    for (let index = next.length - 1; index >= 0; index -= 1) { const step = next[index] as Step; stack.push({ id: step.id, depth: current.depth + 1, via: via(step, current.id) }); }
  }
  return order;
}

export type PathResult = { found: boolean; nodes: string[]; edges: KnowledgeEdge[]; hops: number };
/** The fewest hops between two nodes the asker can see. Ties are broken by the fixed neighbor order, so the answer never changes. */
export function shortestPath(view: View, from: string, to: string, options: TraverseOptions = {}): PathResult {
  const none: PathResult = { found: false, nodes: [], edges: [], hops: -1 };
  if (!view.nodes.has(from) || !view.nodes.has(to)) return none;
  if (from === to) return { found: true, nodes: [from], edges: [], hops: 0 };
  const limit = Math.max(1, Math.min(options.maxDepth ?? MAX_DEPTH, MAX_DEPTH));
  const parent = new Map<string, { id: string; edge: KnowledgeEdge }>();
  const depth = new Map<string, number>([[from, 0]]);
  const queue = [from];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor] as string;
    const here = depth.get(current) as number;
    if (here >= limit) continue;
    for (const step of steps(view, current, options)) {
      if (depth.has(step.id)) continue;
      depth.set(step.id, here + 1);
      parent.set(step.id, { id: current, edge: step.edge });
      if (step.id === to) {
        const nodes = [to];
        const edges: KnowledgeEdge[] = [];
        for (let node = to; node !== from;) { const back = parent.get(node) as { id: string; edge: KnowledgeEdge }; edges.unshift(back.edge); nodes.unshift(back.id); node = back.id; }
        return { found: true, nodes, edges, hops: edges.length };
      }
      queue.push(step.id);
    }
  }
  return none;
}
/** Everything within `depth` hops of a node, with the edges among them. */
export function neighborhood(view: View, id: string, depth: number, options: Omit<TraverseOptions, "maxDepth"> = {}): { nodes: Visit[]; edges: KnowledgeEdge[] } {
  const nodes = bfs(view, id, { ...options, maxDepth: depth });
  const inside = new Set(nodes.map((visit) => visit.id));
  const allowed = options.relations ? new Set<Relation>(options.relations) : undefined;
  return { nodes, edges: viewEdges(view).filter((edge) => inside.has(edge.from) && inside.has(edge.to) && (!allowed || allowed.has(edge.relation))) };
}
