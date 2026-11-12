// Knowledge Edge: what a relation is, which relations may join which kinds of node, and when an edge would close an INVALID cycle. Hierarchy (belongsTo / contains) and dependency
// (dependsOn) must stay acyclic; the other relations may loop (people work with each other, documents reference each other). A node never relates to itself.

import type { KnowledgeEdge, NodeType, Relation } from "./knowledge-types";

export const edgeId = (from: string, relation: Relation, to: string): string => `e:${from}|${relation}|${to}`;
export const DEFAULT_EDGE = { confidence: 60, weight: 0.5 } as const;

type Kinds = readonly NodeType[] | "any";
const ACTORS: readonly NodeType[] = ["person", "worker", "agent"];
const PARTIES: readonly NodeType[] = ["person", "customer", "lead", "worker", "agent"];
const WORK: readonly NodeType[] = ["project", "process", "task", "automation", "campaign", "document", "product", "service", "property", "kpi"];
/** Which kind of node may be on each end of each relation. */
export const RELATION_RULES: Readonly<Record<Relation, { from: Kinds; to: Kinds }>> = {
  created: { from: ["person", "worker", "agent", "automation", "company"], to: "any" },
  owns: { from: ["company", "person", "customer", "lead", "worker", "agent"], to: WORK },
  belongsTo: { from: "any", to: "any" },
  assignedTo: { from: ["task", "project", "process", "campaign", "automation", "lead", "customer", "event"], to: ACTORS },
  worksWith: { from: PARTIES, to: PARTIES },
  references: { from: "any", to: "any" },
  dependsOn: { from: "any", to: "any" },
  relatedTo: { from: "any", to: "any" },
  generated: { from: ["worker", "agent", "automation", "campaign", "process", "project", "person"], to: ["document", "decision", "event", "task", "kpi", "conversation", "campaign", "preference"] },
  approved: { from: ["person"], to: "any" }, // only people decide
  rejected: { from: ["person"], to: "any" },
  learned: { from: ["worker", "agent"], to: ["preference", "decision", "process"] },
  uses: { from: "any", to: ["document", "process", "product", "service", "automation", "kpi", "project", "property"] },
  contains: { from: "any", to: "any" },
  mentions: { from: ["document", "conversation", "decision", "event", "campaign", "task", "process"], to: "any" },
  participatesIn: { from: PARTIES, to: ["project", "event", "campaign", "conversation", "process", "task"] },
};
const fits = (kinds: Kinds, type: NodeType) => kinds === "any" || kinds.includes(type);
/** The company is the root: it belongs to nothing and nothing contains it. */
export function relationAllowed(relation: Relation, fromType: NodeType, toType: NodeType): boolean {
  const rule = RELATION_RULES[relation];
  if (!fits(rule.from, fromType) || !fits(rule.to, toType)) return false;
  if (relation === "belongsTo" && fromType === "company") return false;
  if (relation === "contains" && toType === "company") return false;
  return true;
}

/** belongsTo(a → b) says b is the PARENT of a; contains(a → b) says a is the parent of b. Returns [child, parent] or undefined for any other relation. */
export const hierarchyPair = (edge: Pick<KnowledgeEdge, "from" | "to" | "relation">): [string, string] | undefined =>
  edge.relation === "belongsTo" ? [edge.from, edge.to] : edge.relation === "contains" ? [edge.to, edge.from] : undefined;

/** Would adding this edge close a loop in the hierarchy or in the dependencies? */
export function createsCycle(edges: readonly KnowledgeEdge[], candidate: Pick<KnowledgeEdge, "from" | "to" | "relation">): boolean {
  const pair = hierarchyPair(candidate);
  if (pair) {
    const [child, parent] = pair;
    const up = new Map<string, string[]>();
    for (const edge of edges) { const link = hierarchyPair(edge); if (link) up.set(link[0], [...(up.get(link[0]) ?? []), link[1]]); }
    return reaches(up, parent, child); // a path parent ⇒ child going upwards means child is already above parent
  }
  if (candidate.relation === "dependsOn") {
    const next = new Map<string, string[]>();
    for (const edge of edges) if (edge.relation === "dependsOn") next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to]);
    return reaches(next, candidate.to, candidate.from);
  }
  return false;
}
function reaches(next: ReadonlyMap<string, readonly string[]>, start: string, target: string): boolean {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const neighbor of next.get(current) ?? []) stack.push(neighbor);
  }
  return false;
}

export function validateEdgeNumbers(input: { confidence?: number; weight?: number }): string[] {
  const issues: string[] = [];
  if (input.confidence !== undefined && (!Number.isInteger(input.confidence) || input.confidence < 0 || input.confidence > 100)) issues.push("confidence");
  if (input.weight !== undefined && (!(input.weight > 0) || input.weight > 1)) issues.push("weight");
  return issues;
}
