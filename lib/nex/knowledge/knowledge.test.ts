/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  KnowledgeEngine, KnowledgeIndex, NODE_TYPES, RANK_WEIGHTS, RELATIONS, SOURCES, bfs, canReadNode, createsCycle, memoryRecords, newKnowledgeState, rankNodes, reduceKnowledge, shortestPath, sourceNodeTypes, viewFor,
  type KnowledgeEvent, type MemoryRow, type NodeInput, type NodeType, type Principal, type Relation, type SourceRecord,
} from "./index";

const T1 = "tenant-nova";
const T2 = "tenant-vida";
const START = Date.parse("2026-11-12T10:00:00.000Z");
const person = (tenantId: string, id: string, role: "viewer" | "member" | "manager" | "admin" | "owner"): Principal => ({ kind: "person", tenantId, id, role });
const ana = person(T1, "ana", "owner");
const marta = person(T1, "marta", "manager");
const mario = person(T1, "mario", "member");
const vera = person(T1, "vera", "viewer");
const luis = person(T2, "luis", "owner");
const sales: Principal = { kind: "worker", tenantId: T1, id: "sales" };
const followup: Principal = { kind: "worker", tenantId: T1, id: "followup" };
const ghost: Principal = { kind: "worker", tenantId: T1, id: "ghost" };
const system = (tenantId = T1): Principal => ({ kind: "system", tenantId });
const ACTIVE: Record<string, string[]> = { [T1]: ["sales", "followup"], [T2]: ["sales"] };
const env = { isWorkerActive: (tenantId: string, workerId: string) => ACTIVE[tenantId]?.includes(workerId) ?? false };
const id = (type: NodeType, ref: string) => `n:${type}:${ref}`;

function world(step = 0) {
  const clock = { t: START, advance(ms: number) { this.t += ms; } };
  const engine = new KnowledgeEngine({ env, now: () => { const value = clock.t; clock.t += step; return value; } });
  return { clock, engine };
}
type World = ReturnType<typeof world>;
const mustNode = (w: World, actor: Principal, type: NodeType, referenceId: string, extra: Partial<NodeInput> = {}) => {
  const result = w.engine.upsertNode(actor, { type, referenceId, ...extra });
  expect(result.ok, `${type}:${referenceId} ${result.refusal} ${result.reasons}`).toBe(true);
  return result.node!;
};
const mustLink = (w: World, actor: Principal, from: string, relation: Relation, to: string, extra: { confidence?: number; weight?: number } = {}) => {
  const result = w.engine.link(actor, { from, to, relation, ...extra });
  expect(result.ok, `${relation}: ${result.refusal} ${result.reasons}`).toBe(true);
  return result.edge!;
};

/** A small company: a project with a process, a document and a task; people, a worker, a customer, a decision, an automation, a KPI and a product. */
function company(w: World) {
  const G = {
    C: id("company", T1), P1: id("person", "p-ana"), K: id("customer", "c-acme"), L: id("lead", "l-beta"), W: id("worker", "w-sales"), PR: id("project", "pr-web"), PC: id("process", "pc-onboard"),
    D: id("document", "d-manual"), TK: id("task", "t-1"), DC: id("decision", "dc-price"), AU: id("automation", "au-mail"), KP: id("kpi", "kpi-leads"), PD: id("product", "pd-plan"),
  };
  mustNode(w, ana, "company", T1);
  for (const [type, ref] of [["person", "p-ana"], ["customer", "c-acme"], ["lead", "l-beta"], ["worker", "w-sales"], ["project", "pr-web"], ["process", "pc-onboard"], ["document", "d-manual"], ["task", "t-1"], ["decision", "dc-price"], ["automation", "au-mail"], ["kpi", "kpi-leads"], ["product", "pd-plan"]] as const) mustNode(w, ana, type, ref);
  const link = (from: string, relation: Relation, to: string) => mustLink(w, ana, from, relation, to);
  for (const child of [G.PR, G.K, G.L, G.W, G.P1, G.DC]) link(child, "belongsTo", G.C);
  for (const child of [G.PC, G.D, G.TK]) link(child, "belongsTo", G.PR);
  link(G.P1, "owns", G.PR); link(G.TK, "assignedTo", G.W); link(G.P1, "approved", G.DC); link(G.W, "created", G.D); link(G.D, "references", G.PC);
  link(G.PC, "dependsOn", G.AU); link(G.AU, "generated", G.KP); link(G.K, "participatesIn", G.PR); link(G.PR, "uses", G.PD);
  return G;
}
const row = (over: Partial<MemoryRow> & { id: string }): MemoryRow => ({
  tenantId: T1, type: "business", importance: 60, confidence: 60, category: "ventas", tags: [], permissions: { visibility: "tenant", minRole: "viewer", roles: [], workerIds: [], userIds: [] },
  createdBy: { kind: "person", id: "p-ana" }, status: "active", advisory: false, uses: 0, ...over,
});

describe("the graph", () => {
  it("has the twenty node types and the sixteen relations", () => {
    expect([...NODE_TYPES]).toEqual(["company", "person", "customer", "lead", "worker", "agent", "document", "project", "process", "product", "service", "property", "campaign", "conversation", "decision", "preference", "automation", "event", "task", "kpi"]);
    expect([...RELATIONS]).toEqual(["created", "owns", "belongsTo", "assignedTo", "worksWith", "references", "dependsOn", "relatedTo", "generated", "approved", "rejected", "learned", "uses", "contains", "mentions", "participatesIn"]);
    expect([...SOURCES]).toEqual(["memory", "organization", "crm", "templates", "architect", "workers", "automations", "insights", "billing", "marketplace", "academy", "manual"]);
  });
  it("makes a node of every type, with every field it promises", () => {
    const w = world();
    for (const type of NODE_TYPES) {
      const node = mustNode(w, ana, type, `ref-${type}`, { confidence: 80, importance: 70, category: "General", tags: ["Demo"] });
      expect(node).toMatchObject({ id: `n:${type}:ref-${type}`, tenantId: T1, type, referenceId: `ref-${type}`, createdAt: new Date(START).toISOString(), updatedAt: new Date(START).toISOString(), confidence: 80, importance: 70, category: "general", tags: ["demo"], uses: 0, source: "manual" });
      expect(node.permissions).toMatchObject({ visibility: "tenant" });
    }
    expect(w.engine.state.nodes).toHaveLength(20);
  });
  it("keeps only a REFERENCE: no text, no name, no address and nothing of the memory", () => {
    const w = world();
    const node = mustNode(w, ana, "document", "d-manual");
    expect(Object.keys(node).sort()).toEqual(["confidence", "createdAt", "id", "importance", "permissions", "referenceId", "source", "tags", "tenantId", "type", "updatedAt", "uses"]);
    for (const key of ["summary", "text", "name", "content", "email", "body"]) expect(node).not.toHaveProperty(key);
  });
  it("never duplicates a node: the same type and reference is the same node, updated in place", () => {
    const w = world();
    const first = mustNode(w, ana, "project", "pr-web", { importance: 40 });
    w.clock.advance(1000);
    const again = w.engine.upsertNode(ana, { type: "project", referenceId: "pr-web", importance: 90 });
    expect(again).toMatchObject({ ok: true, created: false });
    expect(w.engine.state.nodes).toHaveLength(1);
    expect(again.node).toMatchObject({ id: first.id, importance: 90, createdAt: first.createdAt, updatedAt: new Date(START + 1000).toISOString() });
    // the same facts again change nothing, not even the stamp
    w.clock.advance(1000);
    const before = JSON.stringify(w.engine.state.nodes);
    expect(w.engine.upsertNode(ana, { type: "project", referenceId: "pr-web", importance: 90 }).events).toEqual([]);
    expect(JSON.stringify(w.engine.state.nodes)).toBe(before);
    mustNode(w, ana, "document", "pr-web");
    expect(w.engine.state.nodes.map((node) => node.id).sort()).toEqual(["n:document:pr-web", "n:project:pr-web"]);
  });
  it("refuses a reference, a category or a tag that looks like a credential or an address", () => {
    const w = world();
    const key = ["sk_", "live_", "abcdefghijklmnop"].join("");
    expect(w.engine.upsertNode(ana, { type: "customer", referenceId: key }).refusal).toBe("sensitive");
    expect(w.engine.upsertNode(ana, { type: "customer", referenceId: "c-1", category: "password: hunter2" }).refusal).toBe("sensitive");
    expect(w.engine.upsertNode(ana, { type: "customer", referenceId: "c-1", tags: ["ana@acme.test"] }).refusal).toBe("sensitive");
    expect(w.engine.upsertNode(ana, { type: "customer", referenceId: "ana@acme.test" }).refusal).toBe("sensitive");
    expect(w.engine.state.nodes).toEqual([]);
    expect(JSON.stringify([w.engine.state, w.engine.log.all()])).not.toContain("hunter2");
  });
  it("validates what it is given", () => {
    const w = world();
    const bad = (input: Record<string, unknown>) => w.engine.upsertNode(ana, { type: "project", referenceId: "p-1", ...input } as never);
    expect(bad({ type: "magia" }).reasons).toContain("type");
    expect(bad({ referenceId: "con espacios" }).reasons).toContain("referenceId");
    expect(bad({ referenceId: "x".repeat(65) }).reasons).toContain("referenceId");
    expect(bad({ confidence: 101 }).reasons).toContain("confidence");
    expect(bad({ importance: -1 }).reasons).toContain("importance");
    expect(bad({ category: "!!!" }).reasons).toContain("category");
    expect(bad({ tags: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] }).reasons).toContain("tags");
    expect(bad({ workerId: "con espacios" }).reasons).toContain("workerId");
    expect(bad({ permissions: { minRole: "dios" } }).reasons).toContain("permissions:minRole");
    expect(w.engine.state.nodes).toEqual([]);
  });
  it("lets only an administrator or the system touch the company node, which can never be removed", () => {
    const w = world();
    expect(w.engine.upsertNode(marta, { type: "company", referenceId: T1 }).refusal).toBe("forbidden");
    expect(w.engine.upsertNode(sales, { type: "company", referenceId: T1 }).refusal).toBe("forbidden");
    const node = mustNode(w, ana, "company", T1);
    expect(w.engine.removeNode(ana, node.id)).toMatchObject({ ok: false, refusal: "invalid", reasons: ["company"] });
    expect(w.engine.upsertNode(system(), { type: "company", referenceId: T1, importance: 90 }).ok).toBe(true);
  });
});

describe("relations", () => {
  const cases: [Relation, NodeType, NodeType][] = [
    ["created", "worker", "document"], ["owns", "person", "project"], ["belongsTo", "document", "project"], ["assignedTo", "task", "worker"], ["worksWith", "person", "worker"], ["references", "document", "process"],
    ["dependsOn", "process", "automation"], ["relatedTo", "customer", "campaign"], ["generated", "automation", "kpi"], ["approved", "person", "decision"], ["rejected", "person", "decision"],
    ["learned", "worker", "preference"], ["uses", "project", "product"], ["contains", "project", "task"], ["mentions", "conversation", "customer"], ["participatesIn", "customer", "event"],
  ];
  it.each(cases)("creates a %s relation from a %s to a %s, with every field", (relation, fromType, toType) => {
    const w = world();
    const from = mustNode(w, ana, fromType, "a-1");
    const to = mustNode(w, ana, toType, "b-1");
    const edge = mustLink(w, ana, from.id, relation, to.id);
    expect(edge).toMatchObject({ id: `e:${from.id}|${relation}|${to.id}`, tenantId: T1, from: from.id, to: to.id, relation, confidence: 60, weight: 0.5, createdAt: new Date(START).toISOString(), observations: 1, source: "manual" });
  });
  it("covers every relation of the vocabulary", () => {
    expect(cases.map((row) => row[0]).sort()).toEqual([...RELATIONS].sort());
  });
  it("takes a confidence and a weight, and validates them", () => {
    const w = world();
    const a = mustNode(w, ana, "document", "a-1");
    const b = mustNode(w, ana, "document", "b-1");
    expect(mustLink(w, ana, a.id, "relatedTo", b.id, { confidence: 90, weight: 0.9 })).toMatchObject({ confidence: 90, weight: 0.9 });
    const c = mustNode(w, ana, "document", "c-1");
    for (const bad of [{ weight: 0 }, { weight: 1.5 }, { confidence: 101 }, { confidence: 1.5 }]) expect(w.engine.link(ana, { from: a.id, to: c.id, relation: "relatedTo", ...bad })).toMatchObject({ ok: false, refusal: "invalid" });
  });
  it("never duplicates an edge: seeing it again reinforces it", () => {
    const w = world();
    const a = mustNode(w, ana, "document", "a-1");
    const b = mustNode(w, ana, "document", "b-1");
    mustLink(w, ana, a.id, "references", b.id);
    const again = w.engine.link(marta, { from: a.id, to: b.id, relation: "references", weight: 0.8 });
    expect(again).toMatchObject({ ok: true, created: false, edge: { observations: 2, weight: 0.8 } });
    expect(w.engine.state.edges).toHaveLength(1);
    expect(w.engine.log.ofType("edge.updated")).toHaveLength(1);
    mustLink(w, ana, a.id, "mentions", b.id);
    mustLink(w, ana, b.id, "references", a.id);
    expect(w.engine.state.edges).toHaveLength(3);
  });
  it("lets only a person approve or reject: a worker and the system prepare", () => {
    const w = world();
    const G = company(w);
    expect(w.engine.link(sales, { from: G.P1, to: G.DC, relation: "approved" }).refusal).toBe("forbidden");
    expect(w.engine.link(sales, { from: G.P1, to: G.DC, relation: "rejected" }).refusal).toBe("forbidden");
    expect(w.engine.link(system(), { from: G.P1, to: G.DC, relation: "approved" }).refusal).toBe("forbidden");
    // even a person cannot make a worker the one who approves
    expect(w.engine.link(ana, { from: G.W, to: G.DC, relation: "approved" }).refusal).toBe("relation");
    expect(w.engine.link(sales, { from: G.W, to: G.D, relation: "references" }).ok).toBe(true);
  });
  it("refuses relations between kinds that make no sense", () => {
    const w = world();
    const G = company(w);
    for (const [from, relation, to] of [[G.K, "created", G.PR], [G.D, "assignedTo", G.PR], [G.C, "belongsTo", G.PR], [G.PR, "contains", G.C], [G.KP, "learned", G.DC], [G.D, "uses", G.P1], [G.D, "participatesIn", G.PR]] as [string, Relation, string][]) {
      expect(w.engine.link(ana, { from, to, relation }), `${relation}`).toMatchObject({ ok: false, refusal: "relation" });
    }
  });
  it("refuses a node related to itself and a relation to something that does not exist", () => {
    const w = world();
    const a = mustNode(w, ana, "document", "a-1");
    expect(w.engine.link(ana, { from: a.id, to: a.id, relation: "relatedTo" }).refusal).toBe("self");
    expect(w.engine.link(ana, { from: a.id, to: "n:document:nada", relation: "relatedTo" }).refusal).toBe("notFound");
    expect(w.engine.link(ana, { from: "n:document:nada", to: a.id, relation: "relatedTo" }).refusal).toBe("notFound");
    expect(w.engine.state.edges).toEqual([]);
  });
  it("refuses a loop in the hierarchy, direct, through contains, or longer", () => {
    const w = world();
    const [a, b, c] = ["h-a", "h-b", "h-c"].map((ref) => mustNode(w, ana, "document", ref).id) as [string, string, string];
    mustLink(w, ana, a, "belongsTo", b);
    expect(w.engine.link(ana, { from: b, to: a, relation: "belongsTo" }).refusal).toBe("cycle");
    expect(w.engine.link(ana, { from: a, to: b, relation: "contains" }).refusal).toBe("cycle");
    mustLink(w, ana, b, "belongsTo", c);
    expect(w.engine.link(ana, { from: c, to: a, relation: "belongsTo" }).refusal).toBe("cycle");
    expect(w.engine.link(ana, { from: a, to: c, relation: "contains" }).refusal).toBe("cycle");
    expect(w.engine.link(ana, { from: c, to: a, relation: "contains" }).ok).toBe(true); // c contains a: a stays below c
    expect(w.engine.state.edges).toHaveLength(3);
  });
  it("refuses a loop in the dependencies, and allows loops where they mean something", () => {
    const w = world();
    const [a, b, c] = ["x-a", "x-b", "x-c"].map((ref) => mustNode(w, ana, "process", ref).id) as [string, string, string];
    mustLink(w, ana, a, "dependsOn", b);
    mustLink(w, ana, b, "dependsOn", c);
    expect(w.engine.link(ana, { from: c, to: a, relation: "dependsOn" }).refusal).toBe("cycle");
    expect(w.engine.link(ana, { from: b, to: a, relation: "dependsOn" }).refusal).toBe("cycle");
    for (const relation of ["relatedTo", "references", "mentions"] as const) { mustLink(w, ana, a, relation, b); mustLink(w, ana, b, relation, a); }
    const G = company(world());
    expect(G.P1).toBeDefined();
    const w2 = world();
    const p = mustNode(w2, ana, "person", "p-1");
    const k = mustNode(w2, ana, "worker", "w-1");
    mustLink(w2, ana, p.id, "worksWith", k.id);
    mustLink(w2, ana, k.id, "worksWith", p.id);
    expect(createsCycle([], { from: "a", to: "b", relation: "relatedTo" })).toBe(false);
  });
  it("lets only a manager remove a relation or a node, and a node takes its relations with it", () => {
    const w = world();
    const G = company(w);
    const edge = `e:${G.PC}|belongsTo|${G.PR}`;
    expect(w.engine.unlink(mario, edge).refusal).toBe("forbidden");
    expect(w.engine.unlink(sales, edge).refusal).toBe("forbidden");
    expect(w.engine.unlink(marta, edge).ok).toBe(true);
    expect(w.engine.state.edges.some((row) => row.id === edge)).toBe(false);
    expect(w.engine.state.nodes.some((row) => row.id === G.PC)).toBe(true);
    expect(w.engine.unlink(marta, edge).refusal).toBe("notFound");
    const touching = w.engine.state.edges.filter((row) => row.from === G.PR || row.to === G.PR).length;
    const before = w.engine.state.edges.length;
    expect(w.engine.removeNode(mario, G.PR).refusal).toBe("forbidden");
    expect(w.engine.removeNode(marta, G.PR)).toMatchObject({ ok: true, removed: { nodes: 1, edges: touching } });
    expect(w.engine.state.edges).toHaveLength(before - touching);
    expect(w.engine.state.edges.every((row) => row.from !== G.PR && row.to !== G.PR)).toBe(true);
  });
});

describe("who may see and change what", () => {
  it("lets a viewer read but not write, refuses an inactive worker, and refuses a claimed company that is not the actor's", () => {
    const w = world();
    expect(w.engine.upsertNode(vera, { type: "project", referenceId: "p-1" }).refusal).toBe("forbidden");
    expect(w.engine.upsertNode(ghost, { type: "project", referenceId: "p-1" }).refusal).toBe("workerInactive");
    expect(w.engine.upsertNode(sales, { type: "project", referenceId: "p-1" }).ok).toBe(true);
    expect(w.engine.dispatch({ type: "node.upsert", tenantId: T1, actor: luis, at: new Date(START).toISOString(), input: { type: "project", referenceId: "p-2" } }).refusal).toBe("tenant");
    expect(w.engine.dispatch({ type: "node.upsert", tenantId: T1, actor: ana, at: "ayer", input: { type: "project", referenceId: "p-2" } })).toMatchObject({ ok: false, refusal: "invalid", reasons: ["at"] });
    expect(w.engine.state.nodes).toHaveLength(1);
  });
  it("hides a restricted node and every relation to it, and traversals do not pass through it", () => {
    const w = world();
    const x = mustNode(w, ana, "document", "r-x").id;
    const y = mustNode(w, ana, "document", "r-y", { permissions: { visibility: "restricted", roles: ["manager"] } }).id;
    const z = mustNode(w, ana, "document", "r-z").id;
    mustLink(w, ana, x, "relatedTo", y);
    mustLink(w, ana, y, "relatedTo", z);
    expect(w.engine.shortestPath(mario, x, z)).toMatchObject({ found: false });
    expect(w.engine.shortestPath(marta, x, z)).toMatchObject({ found: true, hops: 2 });
    expect(w.engine.shortestPath(ana, x, z)).toMatchObject({ found: true, nodes: [x, y, z] });
    expect(w.engine.shortestPath(vera, x, z).found).toBe(false);
    expect(w.engine.neighborhood(mario, x, 3)).toMatchObject({ nodes: [{ id: x, depth: 0 }], edges: [] });
    expect(w.engine.search(mario, { types: ["document"] }).hits.map((hit) => hit.node.id).sort()).toEqual([x, z]);
    expect(w.engine.search(marta, { types: ["document"] }).total).toBe(3);
    expect(w.engine.breadthFirst(mario, y)).toEqual([]);
  });
  it("makes a hidden node simply not exist for the asker: it cannot be changed, linked, used or removed", () => {
    const w = world();
    const x = mustNode(w, ana, "document", "r-x").id;
    const y = mustNode(w, ana, "document", "r-y", { permissions: { visibility: "restricted", roles: ["manager"] } }).id;
    expect(w.engine.upsertNode(mario, { type: "document", referenceId: "r-y", importance: 1 }).refusal).toBe("notFound");
    expect(w.engine.link(mario, { from: x, to: y, relation: "relatedTo" }).refusal).toBe("notFound");
    expect(w.engine.removeNode(mario, y).refusal).toBe("forbidden");
    expect(w.engine.useNodes(mario, [y]).used).toEqual([]);
    expect(w.engine.state.nodes.find((node) => node.id === y)).toMatchObject({ importance: 50, uses: 0 });
  });
  it("keeps a private node for the people it names, a worker's own knowledge for that worker, and opens a restricted one to a listed worker", () => {
    const w = world();
    const secret = mustNode(w, ana, "decision", "d-private", { permissions: { visibility: "private", userIds: ["marta"] } }).id;
    const own = mustNode(w, ana, "conversation", "cv-own", { workerId: "sales" }).id;
    const listed = mustNode(w, ana, "document", "d-listed", { permissions: { visibility: "restricted", workerIds: ["followup"] } }).id;
    const seen = (actor: Principal) => w.engine.search(actor, {}).hits.map((hit) => hit.node.id);
    expect(seen(marta)).toContain(secret);
    for (const actor of [ana, mario, vera, sales, followup, system()]) expect(seen(actor), JSON.stringify(actor)).not.toContain(secret);
    expect(seen(sales)).toContain(own);
    expect(seen(followup)).not.toContain(own);
    expect(seen(mario)).toContain(own);
    expect(seen(followup)).toContain(listed);
    expect(seen(sales)).not.toContain(listed);
    expect(seen(ana)).toContain(listed);
  });
  it("applies the role of the node: a customer or a lead needs a member", () => {
    const w = world();
    const customer = mustNode(w, ana, "customer", "c-1").id;
    expect(w.engine.search(vera, { types: ["customer"] }).hits).toEqual([]);
    expect(w.engine.search(mario, { types: ["customer"] }).hits.map((hit) => hit.node.id)).toEqual([customer]);
  });
});

describe("every company is its own world", () => {
  function two() {
    const w = world();
    for (const [actor, tenant] of [[ana, T1], [luis, T2]] as const) {
      mustNode(w, actor, "company", tenant);
      mustNode(w, actor, "project", "pr-web");
      mustLink(w, actor, id("project", "pr-web"), "belongsTo", id("company", tenant));
    }
    mustNode(w, ana, "document", "d-only-nova");
    return w;
  }
  it("keeps the same references apart: same ids, different companies, never merged", () => {
    const w = two();
    expect(w.engine.state.nodes.filter((node) => node.id === id("project", "pr-web")).map((node) => node.tenantId).sort()).toEqual([T1, T2]);
    expect(w.engine.state.edges).toHaveLength(2);
    expect(w.engine.state.edges.map((edge) => edge.tenantId).sort()).toEqual([T1, T2]);
  });
  it("never relates across companies, whoever asks and whatever the ids", () => {
    const w = two();
    const before = JSON.stringify(w.engine.state.edges);
    expect(w.engine.link(luis, { from: id("project", "pr-web"), to: id("document", "d-only-nova"), relation: "references" }).refusal).toBe("notFound");
    expect(w.engine.link(ana, { from: id("project", "pr-web"), to: id("company", T2), relation: "belongsTo" }).refusal).toBe("notFound");
    expect(w.engine.dispatch({ type: "edge.link", tenantId: T2, actor: ana, at: new Date(START).toISOString(), input: { from: id("project", "pr-web"), to: id("company", T2), relation: "belongsTo" } }).refusal).toBe("tenant");
    expect(w.engine.link(system(T1), { from: id("project", "pr-web"), to: id("company", T2), relation: "belongsTo" }).refusal).toBe("notFound");
    expect(JSON.stringify(w.engine.state.edges)).toBe(before);
    expect(w.engine.state.edges.every((edge) => edge.from.length > 0 && w.engine.state.nodes.filter((node) => node.tenantId === edge.tenantId).some((node) => node.id === edge.from) && w.engine.state.nodes.filter((node) => node.tenantId === edge.tenantId).some((node) => node.id === edge.to))).toBe(true);
  });
  it("never lets one company read, search, traverse, change or remove another's graph", () => {
    const w = two();
    expect(w.engine.search(luis, { text: "nova" }).miss).toBe(true);
    expect(w.engine.search(luis, {}).hits.every((hit) => hit.node.tenantId === T2)).toBe(true);
    expect(w.engine.breadthFirst(luis, id("document", "d-only-nova"))).toEqual([]);
    expect(w.engine.shortestPath(luis, id("project", "pr-web"), id("document", "d-only-nova")).found).toBe(false);
    expect(w.engine.related(luis, id("document", "d-only-nova")).issues).toEqual(["id"]);
    expect(w.engine.removeNode(luis, id("document", "d-only-nova")).refusal).toBe("notFound");
    expect(w.engine.unlink(luis, `e:${id("project", "pr-web")}|belongsTo|${id("company", T1)}`).refusal).toBe("notFound");
    expect(w.engine.useNodes(luis, [id("document", "d-only-nova")]).used).toEqual([]);
    expect(w.engine.state.nodes.some((node) => node.id === id("document", "d-only-nova"))).toBe(true);
  });
  it("checks the company first in canRead and builds a view and an index of one company only", () => {
    const w = two();
    const open = { ...w.engine.state.nodes.find((node) => node.tenantId === T1)!, permissions: { visibility: "tenant" as const, minRole: "viewer" as const, roles: ["owner" as const], workerIds: ["sales"], userIds: ["luis"] } };
    expect(canReadNode(luis, open)).toBe(false);
    expect(canReadNode(system(T2), open)).toBe(false);
    expect(canReadNode({ kind: "worker", tenantId: T2, id: "sales" }, open)).toBe(false);
    expect([...viewFor(w.engine.state, luis).nodes.values()].every((node) => node.tenantId === T2)).toBe(true);
    expect(KnowledgeIndex.build(T2, w.engine.state).size).toBe(2);
    expect(KnowledgeIndex.build(T1, w.engine.state).size).toBe(3);
  });
  it("keeps the builder to its own company: a record of another company is skipped and creates nothing", () => {
    const w = two();
    const t2Before = JSON.stringify(w.engine.state.nodes.filter((node) => node.tenantId === T2));
    const result = w.engine.build(system(T1), "crm", [{ tenantId: T2, type: "customer", referenceId: "c-leak" }, { tenantId: T1, type: "customer", referenceId: "c-ok" }]);
    expect(result.build?.skipped).toEqual({ crossTenant: 1 });
    expect(w.engine.state.nodes.some((node) => node.referenceId === "c-leak")).toBe(false);
    expect(JSON.stringify(w.engine.state.nodes.filter((node) => node.tenantId === T2))).toBe(t2Before);
  });
  it("keeps the audit trail and the numbers of each company apart", () => {
    const w = two();
    w.engine.dispatch({ type: "node.remove", tenantId: T1, actor: luis, at: new Date(START).toISOString(), id: id("document", "d-only-nova") });
    expect(w.engine.state.audit.filter((entry) => entry.tenantId === T1).every((entry) => entry.actor !== "luis")).toBe(true);
    expect(w.engine.state.audit.some((entry) => entry.tenantId === T2 && entry.action === "node.remove.refused")).toBe(true);
    expect(w.engine.snapshot(T1).counters.nodesCreated).toBe(3);
    expect(w.engine.snapshot(T2).counters).toMatchObject({ nodesCreated: 2, refused: 1 });
    expect(w.engine.log.forTenant(T2).every((event) => event.tenantId === T2)).toBe(true);
  });
});

describe("traversal", () => {
  it("goes breadth first, level by level, in a fixed order", () => {
    const w = world();
    const G = company(w);
    const visits = w.engine.breadthFirst(ana, G.C, { maxDepth: 1 });
    expect(visits[0]).toEqual({ id: G.C, depth: 0 });
    expect(visits.slice(1).map((visit) => visit.id)).toEqual([G.K, G.DC, G.L, G.P1, G.PR, G.W].sort());
    expect(visits.slice(1).every((visit) => visit.depth === 1 && visit.via?.relation === "belongsTo")).toBe(true);
    const deep = w.engine.breadthFirst(ana, G.C, { maxDepth: 10 });
    expect(deep).toHaveLength(13);
    expect(deep.map((visit) => visit.depth)).toEqual([...deep.map((visit) => visit.depth)].sort((a, b) => a - b));
    expect(w.engine.breadthFirst(ana, G.C, { maxDepth: 0 })).toEqual([{ id: G.C, depth: 0 }]);
    expect(w.engine.breadthFirst(ana, "n:project:nada")).toEqual([]);
  });
  it("goes depth first, down one branch before the next, and differs from breadth first", () => {
    const w = world();
    const [a, b, c, d] = ["t-a", "t-b", "t-c", "t-d"].map((ref) => mustNode(w, ana, "document", ref).id) as [string, string, string, string];
    mustLink(w, ana, a, "relatedTo", b);
    mustLink(w, ana, a, "relatedTo", c);
    mustLink(w, ana, b, "relatedTo", d);
    expect(w.engine.depthFirst(ana, a, { direction: "out" }).map((visit) => visit.id)).toEqual([a, b, d, c]);
    expect(w.engine.breadthFirst(ana, a, { direction: "out" }).map((visit) => visit.id)).toEqual([a, b, c, d]);
    expect(w.engine.depthFirst(ana, a, { direction: "out", maxDepth: 1 }).map((visit) => visit.id)).toEqual([a, b, c]);
  });
  it("follows only the direction and the relations it is told to", () => {
    const w = world();
    const G = company(w);
    const ids = (visits: { id: string }[]) => visits.slice(1).map((visit) => visit.id).sort();
    expect(ids(w.engine.breadthFirst(ana, G.PR, { maxDepth: 1, direction: "out" }))).toEqual([G.C, G.PD].sort());
    expect(ids(w.engine.breadthFirst(ana, G.PR, { maxDepth: 1, direction: "in" }))).toEqual([G.PC, G.D, G.TK, G.P1, G.K].sort());
    expect(ids(w.engine.breadthFirst(ana, G.PR, { maxDepth: 1, direction: "in", relations: ["belongsTo"] }))).toEqual([G.PC, G.D, G.TK].sort());
    expect(ids(w.engine.breadthFirst(ana, G.PC, { maxDepth: 5, direction: "out", relations: ["dependsOn", "generated"] }))).toEqual([G.AU, G.KP].sort());
  });
  it("finds the shortest path, the same one every time", () => {
    const w = world();
    const G = company(w);
    const path = w.engine.shortestPath(ana, G.K, G.W);
    expect(path).toMatchObject({ found: true, nodes: [G.K, G.C, G.W], hops: 2 });
    expect(path.edges.map((edge) => edge.id)).toEqual([`e:${G.K}|belongsTo|${G.C}`, `e:${G.W}|belongsTo|${G.C}`]);
    expect(w.engine.shortestPath(ana, G.K, G.W)).toEqual(path);
    expect(w.engine.shortestPath(ana, G.K, G.K)).toMatchObject({ found: true, nodes: [G.K], hops: 0 });
    expect(w.engine.shortestPath(ana, G.K, G.KP).hops).toBe(4);
    expect(w.engine.shortestPath(ana, G.K, G.KP, { maxDepth: 3 }).found).toBe(false);
    expect(w.engine.shortestPath(ana, G.K, G.C, { direction: "out" })).toMatchObject({ found: true, hops: 1 });
    expect(w.engine.shortestPath(ana, G.K, G.W, { direction: "out" }).found).toBe(false); // W points INTO the company: there is no way out of K that reaches it
    expect(w.engine.shortestPath(ana, G.W, G.K, { direction: "out" }).found).toBe(false);
    expect(w.engine.shortestPath(ana, G.K, "n:project:nada")).toMatchObject({ found: false, hops: -1 });
    const lone = mustNode(w, ana, "document", "lonely").id;
    expect(w.engine.shortestPath(ana, G.K, lone).found).toBe(false);
  });
  it("gives the neighborhood of a node: what is within reach and the relations among it", () => {
    const w = world();
    const G = company(w);
    const near = w.engine.neighborhood(ana, G.PR, 1);
    expect(near.nodes.map((visit) => visit.id).sort()).toEqual([G.PR, G.C, G.PD, G.PC, G.D, G.TK, G.P1, G.K].sort());
    expect(near.edges.every((edge) => near.nodes.some((visit) => visit.id === edge.from) && near.nodes.some((visit) => visit.id === edge.to))).toBe(true);
    expect(near.edges.some((edge) => edge.id === `e:${G.P1}|owns|${G.PR}`)).toBe(true);
    expect(near.edges.some((edge) => edge.id === `e:${G.K}|belongsTo|${G.C}`)).toBe(true);
    expect(w.engine.neighborhood(ana, G.PR, 1, { relations: ["belongsTo"] }).nodes.map((visit) => visit.id).sort()).toEqual([G.PR, G.C, G.PC, G.D, G.TK].sort());
  });
  it("finds related knowledge: close, well connected, sharing neighbors; never the node itself", () => {
    const w = world();
    const G = company(w);
    const related = w.engine.related(ana, G.PR, { depth: 2 });
    expect(related.hits.map((hit) => hit.node.id)).not.toContain(G.PR);
    expect(related.hits.every((hit) => hit.distance !== undefined && hit.distance >= 1 && hit.distance <= 2)).toBe(true);
    expect(related.hits[0]!.distance).toBe(1);
    expect(related.hits.map((hit) => hit.score)).toEqual([...related.hits.map((hit) => hit.score)].sort((a, b) => b - a));
    expect(related.hits[0]!.why.some((reason) => reason.startsWith("vecinos"))).toBe(true);
    expect(w.engine.related(ana, G.PR, { limit: 3 }).hits).toHaveLength(3);
    expect(w.engine.related(ana, G.PR, { depth: 1, relations: ["uses"] }).hits.map((hit) => hit.node.id)).toEqual([G.PD]);
    expect(w.engine.related(ana, "n:project:nada").issues).toEqual(["id"]);
    expect(w.engine.related(ana, G.PR, { depth: 2 }).hits).toEqual(related.hits);
  });
});

describe("ranking", () => {
  const rank = (w: World, actor: Principal = ana) => rankNodes(viewFor(w.engine.state, actor));
  it("adds up to 100 and never gives a factor more than its weight", () => {
    expect(Object.values(RANK_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    const w = world();
    const G = company(w);
    for (const one of rank(w).values()) {
      expect(one.score).toBeLessThanOrEqual(100);
      expect(one.factors.every((factor) => factor.points <= factor.max)).toBe(true);
      expect(one.factors.map((factor) => factor.name)).toEqual(["importance", "confidence", "usage", "frequency", "depth", "centrality"]);
    }
    expect(rank(w).size).toBe(Object.keys(G).length);
  });
  it("rises with importance, confidence and use", () => {
    const w = world();
    const strong = mustNode(w, ana, "document", "s-1", { importance: 90, confidence: 90 }).id;
    const weak = mustNode(w, ana, "document", "s-2", { importance: 10, confidence: 10 }).id;
    const ranks = rank(w);
    expect(ranks.get(strong)!.score).toBeGreaterThan(ranks.get(weak)!.score);
    const a = mustNode(w, ana, "document", "u-1").id;
    const b = mustNode(w, ana, "document", "u-2").id;
    for (let index = 0; index < 5; index += 1) w.engine.useNodes(ana, [a]);
    expect(w.engine.state.nodes.find((node) => node.id === a)!.uses).toBe(5);
    const used = rank(w);
    expect(used.get(a)!.score).toBeGreaterThan(used.get(b)!.score);
    expect(used.get(a)!.factors.find((factor) => factor.name === "usage")!.points).toBeGreaterThan(0);
    expect(used.get(b)!.factors.find((factor) => factor.name === "usage")!.points).toBe(0);
  });
  it("gives more centrality to the hub of a star than to its leaves, weighted by the strength of the ties", () => {
    const w = world();
    const hub = mustNode(w, ana, "document", "hub").id;
    const leaves = ["l-1", "l-2", "l-3"].map((ref) => mustNode(w, ana, "document", ref).id);
    for (const leaf of leaves) mustLink(w, ana, hub, "relatedTo", leaf);
    const ranks = rank(w);
    const centrality = (node: string) => ranks.get(node)!.factors.find((factor) => factor.name === "centrality")!.points;
    expect(centrality(hub)).toBe(20);
    expect(centrality(leaves[0]!)).toBeCloseTo(6.7, 1);
    const w2 = world();
    const h = mustNode(w2, ana, "document", "hub").id;
    const strong = mustNode(w2, ana, "document", "strong").id;
    const weak = mustNode(w2, ana, "document", "weak").id;
    mustLink(w2, ana, h, "relatedTo", strong, { weight: 1 });
    mustLink(w2, ana, h, "relatedTo", weak, { weight: 0.2 });
    const r2 = rank(w2);
    expect(r2.get(strong)!.factors.find((factor) => factor.name === "centrality")!.points).toBeGreaterThan(r2.get(weak)!.factors.find((factor) => factor.name === "centrality")!.points);
  });
  it("counts how often a tie was seen again (frequency)", () => {
    const w = world();
    const [a, b, c, d] = ["f-a", "f-b", "f-c", "f-d"].map((ref) => mustNode(w, ana, "document", ref).id) as [string, string, string, string];
    mustLink(w, ana, a, "references", b);
    for (let index = 0; index < 4; index += 1) mustLink(w, ana, c, "references", d);
    const ranks = rank(w);
    const frequency = (node: string) => ranks.get(node)!.factors.find((factor) => factor.name === "frequency")!.points;
    expect(frequency(c)).toBeGreaterThan(frequency(a));
    expect(frequency(c)).toBe(frequency(d));
  });
  it("scores depth by the closeness to the company, or to an anchor when there is one", () => {
    const w = world();
    const G = company(w);
    const ranks = rank(w);
    const depth = (node: string) => ranks.get(node)!.factors.find((factor) => factor.name === "depth")!.points;
    expect(depth(G.C)).toBe(10);
    expect(depth(G.PR)).toBe(5);
    expect(depth(G.PC)).toBe(3.3);
    const anchored = rankNodes(viewFor(w.engine.state, ana), new Map([[G.KP, 0], [G.AU, 1]]));
    expect(anchored.get(G.KP)!.factors.find((factor) => factor.name === "depth")!.points).toBe(10);
    expect(anchored.get(G.AU)!.factors.find((factor) => factor.name === "depth")!.points).toBe(5);
  });
  it("ranks only what the asker can see", () => {
    const w = world();
    mustNode(w, ana, "document", "open");
    const hidden = mustNode(w, ana, "document", "hidden", { permissions: { visibility: "restricted", roles: ["manager"] } }).id;
    expect(rank(w, mario).has(hidden)).toBe(false);
    expect(rank(w, ana).has(hidden)).toBe(true);
  });
});

describe("search", () => {
  it("finds by node, reference, type, worker, category, tag and text", () => {
    const w = world();
    const G = company(w);
    mustNode(w, ana, "conversation", "cv-1", { workerId: "sales", category: "Operaciones", tags: ["Urgente", "Acme"] });
    const ids = (query: Parameters<KnowledgeEngine["search"]>[1]) => w.engine.search(ana, query).hits.map((hit) => hit.node.id).sort();
    expect(ids({ nodeId: G.D })).toEqual([G.D]);
    expect(ids({ referenceId: "pc-onboard" })).toEqual([G.PC]);
    expect(ids({ types: ["customer", "lead"] })).toEqual([G.K, G.L].sort());
    expect(ids({ workerId: "sales" })).toEqual([id("conversation", "cv-1")]);
    expect(ids({ category: "operaciones" })).toEqual([id("conversation", "cv-1")]);
    expect(ids({ tags: ["URGENTE"] })).toEqual([id("conversation", "cv-1")]);
    expect(ids({ text: "manual" })).toEqual([G.D]);
    expect(ids({ text: "operaciones urgente" })).toEqual([id("conversation", "cv-1")]);
    expect(w.engine.search(ana, { text: "manual operaciones" }).hits.map((hit) => hit.relevance)).toEqual([50, 50]);
  });
  it("finds by relation: the nodes that are an end of a relation of that kind", () => {
    const w = world();
    const G = company(w);
    expect(w.engine.search(ana, { relations: ["approved"] }).hits.map((hit) => hit.node.id).sort()).toEqual([G.P1, G.DC].sort());
    expect(w.engine.search(ana, { relations: ["dependsOn", "generated"] }).hits.map((hit) => hit.node.id).sort()).toEqual([G.PC, G.AU, G.KP].sort());
    expect(w.engine.search(ana, { relations: ["rejected"] }).miss).toBe(true);
  });
  it("searches around a node up to a depth, in a direction, through chosen relations, and says how it got there", () => {
    const w = world();
    const G = company(w);
    const around = w.engine.search(ana, { from: G.PC, depth: 1, direction: "out" });
    expect(around.hits.map((hit) => hit.node.id).sort()).toEqual([G.AU, G.PR].sort());
    expect(around.hits.every((hit) => hit.distance === 1)).toBe(true);
    const viaDependency = w.engine.search(ana, { from: G.PC, depth: 3, relations: ["dependsOn", "generated"] });
    expect(viaDependency.hits.map((hit) => [hit.node.id, hit.distance, hit.via])).toEqual(expect.arrayContaining([[G.AU, 1, "dependsOn"], [G.KP, 2, "generated"]]));
    expect(viaDependency.total).toBe(2);
    expect(w.engine.search(ana, { from: "n:project:nada" }).issues).toEqual(["from"]);
    expect(w.engine.search(ana, { from: G.PC, depth: 1, types: ["automation"] }).hits.map((hit) => hit.node.id)).toEqual([G.AU]);
  });
  it("limits by depth from the company when there is no starting node, and by confidence", () => {
    const w = world();
    const G = company(w);
    mustNode(w, ana, "document", "d-sure", { confidence: 95 });
    expect(w.engine.search(ana, { depth: 0, limit: 50 }).hits.map((hit) => hit.node.id)).toEqual([G.C]);
    expect(w.engine.search(ana, { depth: 1, limit: 50 }).total).toBe(7);
    expect(w.engine.search(ana, { minConfidence: 90 }).hits.map((hit) => hit.node.id)).toEqual([id("document", "d-sure")]);
  });
  it("ranks the hits, limits them, reports the total and says miss; bad queries say what is wrong", () => {
    const w = world();
    const G = company(w);
    const all = w.engine.search(ana, { limit: 50 });
    expect(all.total).toBe(13);
    expect(all.hits[0]!.node.id).toBe(G.C);
    expect(all.hits.map((hit) => hit.score)).toEqual([...all.hits.map((hit) => hit.score)].sort((a, b) => b - a));
    const few = w.engine.search(ana, { limit: 2 });
    expect(few).toMatchObject({ total: 13, miss: false });
    expect(few.hits).toHaveLength(2);
    expect(w.engine.search(ana, { text: "inexistente" })).toMatchObject({ hits: [], total: 0, miss: true });
    expect(w.engine.search(ana, { limit: 0 }).issues).toEqual(["limit"]);
    expect(w.engine.search(ana, { depth: 11 }).issues).toEqual(["depth"]);
    expect(w.engine.search(ana, { minConfidence: 101 }).issues).toEqual(["minConfidence"]);
    expect(w.engine.search(ana, { types: ["magia" as never] }).issues).toEqual(["types"]);
    expect(w.engine.search(ana, { relations: ["magia" as never] }).issues).toEqual(["relations"]);
    expect(w.engine.search(ana, { direction: "up" as never }).issues).toEqual(["direction"]);
  });
  it("is deterministic: the same query gives the same hits in the same order, ties broken by id", () => {
    const w = world();
    company(w);
    const a = w.engine.search(ana, { limit: 50 });
    const b = w.engine.search(ana, { limit: 50 });
    expect(a.hits.map((hit) => [hit.node.id, hit.score])).toEqual(b.hits.map((hit) => [hit.node.id, hit.score]));
    const twins = world();
    mustNode(twins, ana, "document", "twin-b");
    mustNode(twins, ana, "document", "twin-a");
    expect(twins.engine.search(ana, {}).hits.map((hit) => hit.node.id)).toEqual(["n:document:twin-a", "n:document:twin-b"]);
  });
});

describe("the Knowledge Builder: from memory", () => {
  const permissions = { visibility: "tenant" as const, minRole: "viewer" as const, roles: [], workerIds: [], userIds: [] };
  const rows: MemoryRow[] = [
    row({ id: "m1", type: "business", tags: ["ventas", "precios"] }),
    row({ id: "m2", type: "customer", tags: ["ventas", "precios", "acme"], createdBy: { kind: "worker", id: "w-sales" }, workerId: "w-sales" }),
    row({ id: "m3", type: "learning", advisory: true, tags: ["tono"], createdBy: { kind: "worker", id: "w-sales" }, confirmedBy: "p-marta", workerId: "w-sales" }),
    row({ id: "m4", type: "conversation", status: "expired" }),
    row({ id: "m5", type: "system", permissions }),
    row({ id: "m6", tenantId: T2, type: "business" }),
  ];
  const graph = (w: World, input: readonly MemoryRow[] = rows) => w.engine.buildFromMemory(system(T1), input);
  it("turns memories into nodes that only REFERENCE them, under the company", () => {
    const w = world();
    const result = graph(w);
    expect(result.build).toMatchObject({ source: "memory", nodes: { created: 7, updated: 0, removed: 0 }, edges: { created: 8, updated: 0, removed: 0 }, skipped: { crossTenant: 1 } });
    const ids = w.engine.state.nodes.map((node) => node.id).sort();
    expect(ids).toEqual([id("company", T1), id("customer", "m2"), id("person", "p-ana"), id("person", "p-marta"), id("preference", "m3"), id("process", "m1"), id("worker", "w-sales")].sort());
    expect(w.engine.state.nodes.find((node) => node.id === id("process", "m1"))).toMatchObject({ referenceId: "m1", source: "memory", importance: 60, confidence: 60, category: "ventas" });
    for (const node of w.engine.state.nodes) for (const key of ["summary", "text", "name", "content"]) expect(node).not.toHaveProperty(key);
    expect(w.engine.state.nodes.some((node) => node.referenceId === "m4" || node.referenceId === "m5" || node.referenceId === "m6")).toBe(false);
  });
  it("relates each memory to its company, its author, who learned it, who confirmed it and what shares its tags", () => {
    const w = world();
    graph(w);
    const edges = w.engine.state.edges.map((edge) => edge.id).sort();
    expect(edges).toEqual([
      `e:${id("process", "m1")}|belongsTo|${id("company", T1)}`, `e:${id("customer", "m2")}|belongsTo|${id("company", T1)}`, `e:${id("preference", "m3")}|belongsTo|${id("company", T1)}`,
      `e:${id("person", "p-ana")}|created|${id("process", "m1")}`, `e:${id("worker", "w-sales")}|created|${id("customer", "m2")}`, `e:${id("worker", "w-sales")}|learned|${id("preference", "m3")}`,
      `e:${id("person", "p-marta")}|approved|${id("preference", "m3")}`, `e:${id("process", "m1")}|relatedTo|${id("customer", "m2")}`,
    ].sort());
    expect(w.engine.state.edges.find((edge) => edge.relation === "relatedTo")).toMatchObject({ weight: 0.5, confidence: 60, source: "memory" });
  });
  it("carries the memory's permissions into the graph: a restricted memory stays hidden", () => {
    const w = world();
    graph(w, [row({ id: "m1", permissions: { visibility: "restricted", minRole: "manager", roles: ["manager"], workerIds: [], userIds: [] } }), row({ id: "m2", type: "document" })]);
    expect(w.engine.search(mario, { types: ["process"] }).miss).toBe(true);
    expect(w.engine.search(marta, { types: ["process"] }).total).toBe(1);
    expect(w.engine.search(mario, { types: ["process"] }).total).toBe(0);
  });
  it("is idempotent: building the same memories again changes nothing", () => {
    const w = world();
    graph(w);
    const before = JSON.stringify([w.engine.state.nodes, w.engine.state.edges]);
    w.clock.advance(5000);
    const again = graph(w);
    expect(again.build).toMatchObject({ nodes: { created: 0, updated: 0, removed: 0 }, edges: { created: 0, updated: 0, removed: 0 } });
    expect(JSON.stringify([w.engine.state.nodes, w.engine.state.edges])).toBe(before);
  });
  it("forgets what the memory forgot: a deleted or expired memory leaves the graph, the rest stays", () => {
    const w = world();
    graph(w);
    const result = graph(w, rows.filter((memory) => memory.id !== "m2"));
    expect(result.build).toMatchObject({ nodes: { removed: 1 }, edges: { removed: 3 } });
    expect(w.engine.state.nodes.some((node) => node.id === id("customer", "m2"))).toBe(false);
    expect(w.engine.state.edges.every((edge) => edge.from !== id("customer", "m2") && edge.to !== id("customer", "m2"))).toBe(true);
    expect(w.engine.state.nodes.some((node) => node.id === id("company", T1))).toBe(true);
    expect(w.engine.state.nodes.some((node) => node.id === id("worker", "w-sales"))).toBe(true);
    graph(w, rows.map((memory) => (memory.id === "m1" ? { ...memory, status: "expired" as const } : memory)));
    expect(w.engine.state.nodes.some((node) => node.id === id("process", "m1"))).toBe(false);
  });
  it("replaces only what its own source said: other sources' nodes stay", () => {
    const w = world();
    w.engine.build(system(), "crm", [{ tenantId: T1, type: "customer", referenceId: "c-crm" }]);
    graph(w);
    graph(w, []);
    expect(w.engine.state.nodes.map((node) => node.id).sort()).toEqual([id("company", T1), id("customer", "c-crm")].sort());
    graph(w);
    w.engine.build(system(), "memory", memoryRecords(rows));
    expect(w.engine.state.nodes.length).toBeGreaterThan(2);
  });
  it("does not relate memories that share fewer than two tags, or a tag held by too many", () => {
    const records = memoryRecords([row({ id: "a", tags: ["x", "y"] }), row({ id: "b", tags: ["x"] }), row({ id: "c", tags: ["x", "y"] })]);
    expect(records.find((record) => record.referenceId === "a")?.links?.filter((link) => link.relation === "relatedTo")).toEqual([{ relation: "relatedTo", toType: "process", toId: "c", weight: 0.5, confidence: 60 }]);
    const crowd = Array.from({ length: 45 }, (_, index) => row({ id: `k${String(index).padStart(2, "0")}`, tags: ["x", "y"] }));
    expect(memoryRecords(crowd).every((record) => !(record.links ?? []).some((link) => link.relation === "relatedTo"))).toBe(true);
  });
  it("only reads: the rows it is given are never changed", () => {
    const deepFreeze = <T,>(value: T): T => { if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
    const frozen = deepFreeze(structuredClone(rows));
    const w = world();
    expect(() => graph(w, frozen)).not.toThrow();
    expect(frozen).toEqual(rows);
  });
  it("lets only the system or an administrator build", () => {
    const w = world();
    for (const actor of [marta, mario, vera, sales]) expect(w.engine.buildFromMemory(actor, rows).refusal, JSON.stringify(actor)).toBe("forbidden");
    expect(w.engine.buildFromMemory(ana, rows).ok).toBe(true);
    expect(w.engine.build(ana, "nada" as never, []).refusal).toBe("invalid");
    expect(w.engine.state.nodes.length).toBeGreaterThan(0);
  });
});

describe("the Knowledge Builder: from the rest of the platform", () => {
  it("accepts a record from every source (organization, CRM, templates, architect, workers, automations, insights, billing, marketplace, academy) and relates it to the company", () => {
    for (const source of SOURCES.filter((name) => name !== "memory" && name !== "manual")) {
      const type = sourceNodeTypes(source).find((candidate) => candidate !== "company")!;
      const w = world();
      const result = w.engine.build(system(), source, [{ tenantId: T1, type, referenceId: "r-1", importance: 70, links: [{ relation: "belongsTo", toType: "company", toId: T1 }] }]);
      expect(result.build, source).toMatchObject({ source, nodes: { created: 2 }, edges: { created: 1 }, skipped: {} });
      expect(w.engine.state.nodes.find((node) => node.id === id(type, "r-1"))).toMatchObject({ source, importance: 70 });
    }
  });
  it("lets a source speak only of the kinds of node it owns", () => {
    const w = world();
    const result = w.engine.build(system(), "billing", [{ tenantId: T1, type: "worker", referenceId: "w-1" }, { tenantId: T1, type: "customer", referenceId: "c-1", links: [{ relation: "participatesIn", toType: "project", toId: "p-1" }] }]);
    expect(result.build?.skipped).toEqual({ sourceType: 2 });
    expect(w.engine.state.nodes.map((node) => node.id).sort()).toEqual([id("company", T1), id("customer", "c-1")].sort());
    expect(sourceNodeTypes("manual")).toEqual([...NODE_TYPES]);
  });
  it("skips, and counts, a relation that is not allowed, a loop, and anything sensitive: the rest is still built", () => {
    const w = world();
    const key = ["ghp_", "abcdefghijklmnop"].join("");
    const records: SourceRecord[] = [
      { tenantId: T1, type: "process", referenceId: "a1", links: [{ relation: "belongsTo", toType: "process", toId: "a2" }] },
      { tenantId: T1, type: "process", referenceId: "a2", links: [{ relation: "belongsTo", toType: "process", toId: "a1" }] },
      { tenantId: T1, type: "task", referenceId: "t1", links: [{ relation: "approved", toType: "person", toId: "p1" }] },
      { tenantId: T1, type: "task", referenceId: "bad", tags: [key] },
      { tenantId: T1, type: "task", referenceId: "con espacios" },
      { tenantId: T1, type: "task", referenceId: "t2", links: [{ relation: "assignedTo", toType: "person", toId: "p1" }] },
    ];
    const result = w.engine.build(system(), "organization", records);
    expect(result.build?.skipped).toEqual({ cycle: 1, relation: 1, sensitive: 1, invalid: 1 });
    expect(w.engine.state.edges.map((edge) => edge.relation).sort()).toEqual(["assignedTo", "belongsTo"]);
    expect(JSON.stringify(w.engine.state)).not.toContain(key);
  });
  it("never writes into the modules it reads from: it takes plain records and returns a graph", () => {
    const records: SourceRecord[] = Object.freeze([Object.freeze({ tenantId: T1, type: "project" as const, referenceId: "p-1", tags: Object.freeze(["a"]) as readonly string[], links: Object.freeze([Object.freeze({ relation: "belongsTo" as const, toType: "company" as const, toId: T1 })]) })]) as unknown as SourceRecord[];
    const w = world();
    expect(w.engine.build(system(), "organization", records).ok).toBe(true);
  });
  it("is idempotent for every source, and replaces only its own", () => {
    const w = world();
    const crm: SourceRecord[] = [{ tenantId: T1, type: "customer", referenceId: "c-1", links: [{ relation: "belongsTo", toType: "company", toId: T1 }] }, { tenantId: T1, type: "lead", referenceId: "l-1", links: [{ relation: "belongsTo", toType: "company", toId: T1 }] }];
    const org: SourceRecord[] = [{ tenantId: T1, type: "project", referenceId: "p-1", links: [{ relation: "belongsTo", toType: "company", toId: T1 }] }];
    w.engine.build(system(), "crm", crm, true);
    w.engine.build(system(), "organization", org, true);
    const before = JSON.stringify([w.engine.state.nodes, w.engine.state.edges]);
    expect(w.engine.build(system(), "crm", crm, true).build).toMatchObject({ nodes: { created: 0, updated: 0, removed: 0 }, edges: { created: 0, updated: 0, removed: 0 } });
    expect(JSON.stringify([w.engine.state.nodes, w.engine.state.edges])).toBe(before);
    expect(w.engine.build(system(), "crm", [crm[0]!], true).build).toMatchObject({ nodes: { removed: 1 } });
    expect(w.engine.state.nodes.map((node) => node.id).sort()).toEqual([id("company", T1), id("customer", "c-1"), id("project", "p-1")].sort());
  });
});

describe("observability", () => {
  it("counts nodes, relations, searches, traversals, ranking, latency, hits, misses and refusals, per company", () => {
    const w = world(5);
    const company_ = w.engine.upsertNode(ana, { type: "company", referenceId: T1 }).node!;
    const pr = w.engine.upsertNode(ana, { type: "project", referenceId: "pr-a", category: "Ventas" }).node!;
    const doc = w.engine.upsertNode(ana, { type: "document", referenceId: "d-a" }).node!;
    w.engine.link(ana, { from: pr.id, to: company_.id, relation: "belongsTo" });
    w.engine.link(ana, { from: doc.id, to: pr.id, relation: "belongsTo" });
    w.engine.upsertNode(vera, { type: "project", referenceId: "p-x" });
    w.engine.upsertNode(luis, { type: "project", referenceId: "p-t2" });
    w.engine.search(ana, { text: "ventas" });
    w.engine.search(ana, { text: "nada" });
    w.engine.related(ana, pr.id);
    w.engine.breadthFirst(ana, company_.id);
    w.engine.shortestPath(ana, doc.id, company_.id);
    w.engine.neighborhood(ana, pr.id, 1);
    const snap = w.engine.snapshot(T1);
    expect(snap.counters).toMatchObject({ nodesCreated: 3, edgesCreated: 2, searches: 3, hits: 2, misses: 1, traversals: 3, refused: 1 });
    expect(snap.hitRatePercent).toBe(67);
    expect(snap.latency).toMatchObject({ count: 6, avgMs: 5, maxMs: 5, p95Ms: 5 });
    expect(snap.ranking.searchesRanked).toBe(2);
    expect(snap.ranking.avgTopScore).toBeGreaterThan(0);
    expect(snap.traversals).toEqual({ bfs: 1, path: 1, neighborhood: 1 });
    expect(snap.refusals).toEqual({ forbidden: 1 });
    expect(snap.graph).toMatchObject({ nodes: 3, edges: 2, isolated: 0, nodesByType: { company: 1, project: 1, document: 1 }, edgesByRelation: { belongsTo: 2 } });
    expect(w.engine.snapshot(T2).counters).toMatchObject({ nodesCreated: 1, searches: 0 });
  });
  it("counts what a build created, updated and removed", () => {
    const w = world();
    w.engine.buildFromMemory(system(), [row({ id: "m1" }), row({ id: "m2", tags: [] })]);
    w.engine.buildFromMemory(system(), [row({ id: "m1" })]);
    const snap = w.engine.snapshot(T1);
    expect(snap.counters).toMatchObject({ builds: 2, nodesCreated: 4, nodesRemoved: 1 });
    expect(w.engine.log.ofType("graph.built")).toHaveLength(2);
  });
  it("keeps knowledge out of the events, and gives the trail in the platform's audit shape", () => {
    const w = world();
    w.engine.upsertNode(ana, { type: "project", referenceId: "pr-secreto", category: "Ventas", tags: ["confidencial"] });
    w.engine.search(ana, { text: "secreto confidencial" });
    const dump = JSON.stringify(w.engine.log.all());
    for (const word of ["pr-secreto", "Ventas", "ventas", "confidencial", "secreto"]) expect(dump).not.toContain(word);
    expect(w.engine.log.toAudit(T1)[0]).toMatchObject({ actor: "ana", tenantId: T1, action: "node.created", detail: { type: "project" } });
    expect(w.engine.log.all().map((event) => event.id)).toEqual(["ke_000001", "ke_000002"]);
  });
  it("lets other parts listen to the events", () => {
    const w = world();
    const seen: string[] = [];
    const stop = w.engine.log.listen((event) => seen.push(event.type));
    w.engine.upsertNode(ana, { type: "project", referenceId: "p-1" });
    stop();
    w.engine.upsertNode(ana, { type: "project", referenceId: "p-2" });
    expect(seen).toEqual(["node.created"]);
  });
});

describe("determinism", () => {
  function script(w: World) {
    const G = company(w);
    w.clock.advance(1000);
    w.engine.buildFromMemory(system(), [row({ id: "m1", tags: ["a", "b"] }), row({ id: "m2", tags: ["a", "b"], createdBy: { kind: "worker", id: "w-sales" } })]);
    w.engine.useNodes(ana, [G.PR, G.PR, G.D]);
    w.engine.link(marta, { from: G.D, to: G.PC, relation: "references" });
    w.engine.search(ana, { text: "manual", limit: 5 });
    w.engine.related(ana, G.PR);
    w.engine.shortestPath(ana, G.K, G.KP);
    w.engine.removeNode(marta, G.TK);
  }
  it("gives the same graph, log and numbers for the same events", () => {
    const a = world(3);
    const b = world(3);
    script(a);
    script(b);
    expect(b.engine.state).toEqual(a.engine.state);
    expect(b.engine.log.all()).toEqual(a.engine.log.all());
    expect(b.engine.snapshot(T1)).toEqual(a.engine.snapshot(T1));
  });
  it("is a pure reducer: it never changes the state it is given", () => {
    const w = world();
    script(w);
    const frozen = structuredClone(w.engine.state);
    const deepFreeze = <T,>(value: T): T => { if (value && typeof value === "object") { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
    deepFreeze(w.engine.state);
    const at = new Date(START + 99_000).toISOString();
    const events: KnowledgeEvent[] = [
      { type: "node.upsert", tenantId: T1, actor: ana, at, input: { type: "project", referenceId: "pr-new" } },
      { type: "edge.link", tenantId: T1, actor: ana, at, input: { from: id("customer", "c-acme"), to: id("project", "pr-web"), relation: "references" } },
      { type: "node.remove", tenantId: T1, actor: marta, at, id: id("project", "pr-web") },
      { type: "build", tenantId: T1, actor: system(), at, source: "crm", records: [{ tenantId: T1, type: "customer", referenceId: "c-new" }], replace: true },
    ];
    for (const event of events) {
      const first = reduceKnowledge(w.engine.state, event, env);
      expect(reduceKnowledge(w.engine.state, event, env)).toEqual(first);
    }
    expect(w.engine.state).toEqual(frozen);
    expect(newKnowledgeState()).toEqual({ nodes: [], edges: [], audit: [] });
  });
  it("traverses a graph built in any order the same way", () => {
    const forward = world();
    const backward = world();
    const pairs: [string, string][] = [["a-1", "a-2"], ["a-2", "a-3"], ["a-3", "a-4"], ["a-1", "a-4"]];
    for (const [w, list] of [[forward, pairs], [backward, [...pairs].reverse()]] as const) {
      for (const ref of ["a-1", "a-2", "a-3", "a-4"]) mustNode(w, ana, "document", ref);
      for (const [from, to] of list) mustLink(w, ana, id("document", from), "relatedTo", id("document", to));
    }
    const walk = (w: World) => bfs(viewFor(w.engine.state, ana), id("document", "a-1"), { maxDepth: 3 }).map((visit) => [visit.id, visit.depth, visit.via?.relation]);
    expect(walk(backward)).toEqual(walk(forward));
    expect(shortestPath(viewFor(backward.engine.state, ana), id("document", "a-1"), id("document", "a-3")).nodes).toEqual(shortestPath(viewFor(forward.engine.state, ana), id("document", "a-1"), id("document", "a-3")).nodes);
  });
});

describe("the layer is new, pure and connected to nothing", () => {
  const folder = join(process.cwd(), "lib/nex/knowledge");
  const files = ["knowledge-engine.ts", "knowledge-graph.ts", "knowledge-node.ts", "knowledge-edge.ts", "knowledge-index.ts", "knowledge-search.ts", "knowledge-ranking.ts", "knowledge-types.ts", "knowledge-events.ts", "knowledge-security.ts", "knowledge-observability.ts", "index.ts"];
  const code = (name: string) => readFileSync(join(folder, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("has the twelve files of the layer and no screen", () => {
    for (const name of files) expect(existsSync(join(folder, name)), name).toBe(true);
    expect(readdirSync(folder).filter((name) => !name.endsWith(".test.ts")).sort()).toEqual([...files].sort());
    expect(existsSync(join(process.cwd(), "app/(app)/nex/knowledge"))).toBe(false);
  });
  it("reads no clock, no randomness, no network, no environment and no database", () => {
    for (const name of files) {
      const source = code(name);
      expect(source, name).not.toMatch(/Date\.now\(|Math\.random\(|new Date\(\)|\bfetch\(|process\.env|XMLHttpRequest|WebSocket|node:https?|localStorage|indexedDB|createClient|supabase/);
      expect(source, name).not.toMatch(/\.subscribe\(/);
      expect(source, name).not.toMatch(/\b(openai|anthropic|claude|gemini|workers-ai)\b/i);
    }
  });
  it("imports nothing outside itself: not the Memory Engine, the Backend Core, the database, the AI layer, the Hub, Google, KOE or any module it reads from", () => {
    for (const name of files) {
      const imports = [...code(name).matchAll(/from "([^"]+)"/g)].map((row) => row[1]!);
      expect(imports.every((path) => path.startsWith("./")), `${name}: ${imports.join(", ")}`).toBe(true);
    }
  });
  it("is used by nothing else in the repository yet, and changes nothing outside its folder", () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (["node_modules", ".next", ".git", ".open-next"].includes(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name) && !path.includes(join("lib", "nex", "knowledge")) && !path.includes(join("lib", "nex", "copilot")) && !path.includes(join("lib", "nex", "rag")) && /lib\/nex\/knowledge/.test(readFileSync(path, "utf8"))) importers.push(path);
      }
    };
    for (const dir of ["app", "lib", "components"]) walk(join(process.cwd(), dir));
    expect(importers).toEqual([]);
  });
});
