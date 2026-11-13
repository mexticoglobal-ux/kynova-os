// Dependency Graph: the DAG of the execution queue. Every item depends on other items of its plan (the plan's steps) and on whole plans (a plan that must be Completed first). The graph refuses
// cycles, says what an item is still waiting for, finds the items that can never run because something they depend on failed, was cancelled or expired, and measures the critical path.
// An item may not start until EVERY dependency is Completed. Pure.

import { topologicalOrder, wouldCreateCycle } from "@/lib/nex/execution";
import type { QueueItem, RunRecord } from "./orchestrator-types";

export { topologicalOrder, wouldCreateCycle };

export type Waiting = { kind: "item" | "plan"; id: string; state: string };
/** What an item is still waiting for: every dependency that is not Completed (an item that does not exist counts as missing). */
export function waitingFor(item: Pick<QueueItem, "dependsOn" | "planDependsOn">, byId: ReadonlyMap<string, QueueItem>, runs: ReadonlyMap<string, RunRecord>): Waiting[] {
  const waiting: Waiting[] = [];
  for (const dep of item.dependsOn) { const other = byId.get(dep); if (!other || other.state !== "Completed") waiting.push({ kind: "item", id: dep, state: other?.state ?? "Missing" }); }
  for (const dep of item.planDependsOn) { const run = runs.get(dep); if (!run || run.status !== "Completed") waiting.push({ kind: "plan", id: dep, state: run?.status ?? "NotQueued" }); }
  return waiting;
}
/** Items that can never run: something they wait for failed, was cancelled or expired. */
export function deadDependencies(items: readonly QueueItem[], runs: ReadonlyMap<string, RunRecord>): QueueItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const bad = new Set(["Failed", "Cancelled", "Expired"]);
  return items.filter((item) => item.state !== "Completed" && !["Failed", "Cancelled", "Expired"].includes(item.state) && waitingFor(item, byId, runs).some((wait) => bad.has(wait.state)));
}
/** Would a plan that depends on `dependsOn` close a loop between plans? (Only plans that are in the queue can form one.) */
export function planDependencyCycle(planId: string, dependsOn: readonly string[], runs: readonly RunRecord[]): boolean {
  const nodes = [...runs.map((run) => ({ id: run.planId, dependsOn: run.planDependsOn })), { id: planId, dependsOn }];
  const known = new Set(nodes.map((node) => node.id));
  return topologicalOrder(nodes.map((node) => ({ id: node.id, dependsOn: node.dependsOn.filter((dep) => known.has(dep) && dep !== node.id) }))) === undefined || dependsOn.includes(planId);
}
/** Every dependency of a plan's items, as one DAG over the items (plan dependencies expanded into the items of that plan). */
export function itemGraph(items: readonly QueueItem[]): { id: string; dependsOn: readonly string[] }[] {
  const byPlan = new Map<string, string[]>();
  for (const item of items) byPlan.set(item.planId, [...(byPlan.get(item.planId) ?? []), item.id]);
  return items.map((item) => ({ id: item.id, dependsOn: [...new Set([...item.dependsOn, ...item.planDependsOn.flatMap((plan) => byPlan.get(plan) ?? [])])].sort() }));
}
export const graphIsAcyclic = (items: readonly QueueItem[]): boolean => topologicalOrder(itemGraph(items).map((node) => ({ id: node.id, dependsOn: node.dependsOn.filter((dep) => items.some((item) => item.id === dep)) }))) !== undefined;
/** How many items wait for each item: the more, the bigger the bottleneck. */
export function dependentsOf(items: readonly QueueItem[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of itemGraph(items)) for (const dep of node.dependsOn) counts.set(dep, (counts.get(dep) ?? 0) + 1);
  return counts;
}
/** The longest chain of estimated time through the items (what the plans take if everything that can run together does). */
export function criticalPathMs(items: readonly QueueItem[]): number {
  const graph = itemGraph(items).map((node) => ({ id: node.id, dependsOn: node.dependsOn.filter((dep) => items.some((item) => item.id === dep)) }));
  const order = topologicalOrder(graph);
  if (!order) return items.reduce((total, item) => total + item.estimatedMs, 0);
  const finish = new Map<string, number>();
  for (const id of order) {
    const item = items.find((row) => row.id === id) as QueueItem;
    const node = graph.find((row) => row.id === id) as { dependsOn: readonly string[] };
    finish.set(id, item.estimatedMs + Math.max(0, ...node.dependsOn.map((dep) => finish.get(dep) ?? 0)));
  }
  return Math.max(0, ...finish.values());
}
