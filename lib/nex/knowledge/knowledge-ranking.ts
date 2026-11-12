// Knowledge Ranking: every node a company can see has a score from 0 to 100 made of importance, confidence, use, frequency, depth and centrality. Pure and deterministic: no clock.
// Depth is the closeness to an anchor when there is one (a search from a node), and the closeness to the company node otherwise.

import { bfs, type View } from "./knowledge-graph";
import { nodeId } from "./knowledge-node";

/** The most each factor can give: they add up to 100. */
export const RANK_WEIGHTS = { importance: 25, confidence: 20, usage: 15, frequency: 10, depth: 10, centrality: 20 } as const;
/** How many hops a node unreachable from the company is assumed to be: far. */
export const UNREACHABLE_HOPS = 6;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export type RankFactor = { name: keyof typeof RANK_WEIGHTS; points: number; max: number };
export type Rank = { score: number; factors: readonly RankFactor[] };

/** Hops from the company node over any visible relation. */
export function companyDistances(view: View): Map<string, number> {
  return new Map(bfs(view, nodeId("company", view.tenantId), { maxDepth: 10 }).map((visit) => [visit.id, visit.depth]));
}

/** `anchor` (node id → hops) replaces the distance to the company when a search starts from a node. */
export function rankNodes(view: View, anchor?: ReadonlyMap<string, number>): Map<string, Rank> {
  const w = RANK_WEIGHTS;
  const weighted = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const list of view.out.values()) {
    for (const edge of list) {
      for (const id of [edge.from, edge.to]) { weighted.set(id, (weighted.get(id) ?? 0) + edge.weight); seen.set(id, (seen.get(id) ?? 0) + edge.observations); }
    }
  }
  const strongest = Math.max(0, ...weighted.values());
  const hops = anchor ?? companyDistances(view);
  const ranks = new Map<string, Rank>();
  for (const node of view.nodes.values()) {
    const parts = {
      importance: w.importance * clamp(node.importance / 100),
      confidence: w.confidence * clamp(node.confidence / 100),
      usage: w.usage * clamp(Math.log2(1 + node.uses) / Math.log2(21)),
      // how often its ties were seen again
      frequency: w.frequency * clamp(Math.log2(1 + (seen.get(node.id) ?? 0)) / Math.log2(21)),
      depth: w.depth * (1 / (1 + (hops.get(node.id) ?? UNREACHABLE_HOPS))),
      // degree centrality weighted by the strength of every tie, against the best connected node
      centrality: strongest === 0 ? 0 : w.centrality * clamp((weighted.get(node.id) ?? 0) / strongest),
    };
    const factors = (Object.keys(parts) as (keyof typeof parts)[]).map((name) => ({ name, points: Math.round(parts[name] * 10) / 10, max: w[name] }));
    ranks.set(node.id, { score: Math.round(factors.reduce((total, row) => total + row.points, 0) * 10) / 10, factors });
  }
  return ranks;
}
