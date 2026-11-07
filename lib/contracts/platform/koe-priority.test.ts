import { describe, expect, it } from "vitest";
import { customWorker, demoKoeOk } from "./koe-demo";
import { effectivePriority, instanceFor, koeMetrics, newKoeState, pendingApprovals, reduceKoe, workerActor, type KoeEvent, type KoeState } from "./koe-engine";
import { MAX_RUN_COST_MICROS, PRIORITIES, PRIORITY_RANK, STARTER_WORKERS, BASE_TOOLS, formatCostMicros, higherPriority, validateWorker, type ToolEntry, type WorkerDefinition } from "./koe-registry";

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T10:00:00.000Z`;
const NOVA = { tenantId: "tenant-nova", actor: "ana" };
const PABLO = { tenantId: "tenant-nova", actor: "pablo" };
const VIDA = { tenantId: "tenant-vida", actor: "lucia" };
const NEX = { tenantId: "tenant-nova", actor: "worker:nex" };
const W = (workerId: string, tenantId = "tenant-nova") => ({ tenantId, actor: workerActor(workerId) });
const tools: Record<string, ToolEntry> = Object.fromEntries(BASE_TOOLS.map((manifest) => [manifest.id, { manifest, status: "active", registeredBy: "kynova" } satisfies ToolEntry]));

const step = (state: KoeState, event: KoeEvent) => reduceKoe(state, event);
const must = (state: KoeState, event: KoeEvent): KoeState => {
  const result = reduceKoe(state, event);
  expect(result.error, event.type).toBeUndefined();
  return result.state;
};
const enabled = (ids: string[], tenant = NOVA, state = newKoeState(["admin:ana"])) => ids.reduce((current, definitionId) => must(current, { ...tenant, at: day(1), type: "worker.enable", definitionId }), state);
const inst = (state: KoeState, definitionId: string, tenantId = "tenant-nova") => instanceFor(state, tenantId, definitionId)?.id ?? "";
const started = (state: KoeState, definitionId: string, who = NOVA, at = day(2)) => {
  const next = must(state, { ...who, at, type: "run.start", instanceId: inst(state, definitionId, who.tenantId), goal: "Objetivo" });
  return { state: next, id: next.runs.at(-1)?.id ?? "" };
};
const configure = (state: KoeState, definitionId: string, priority: (typeof PRIORITIES)[number], who = NOVA) =>
  must(state, { ...who, at: day(1), type: "instance.configure", instanceId: inst(state, definitionId, who.tenantId), maxRunsPerDay: 10, deniedProviders: [], priority });

describe("priority of a Worker", () => {
  it("has four levels in order, and every KYNOVA Worker ships with one", () => {
    expect(PRIORITIES).toEqual(["low", "normal", "high", "critical"]);
    expect(PRIORITIES.map((item) => PRIORITY_RANK[item])).toEqual([0, 1, 2, 3]);
    expect(higherPriority("low", "high")).toBe("high");
    expect(higherPriority("critical", "normal")).toBe("critical");
    const byId = Object.fromEntries(STARTER_WORKERS.map((worker) => [worker.id, worker.priority]));
    expect(byId).toMatchObject({ coordinator: "high", sales: "high", reporter: "low" });
    expect(Object.values(byId).every((value) => PRIORITIES.includes(value))).toBe(true);
  });

  it("is validated on the definition", () => {
    const definition = (over: Partial<WorkerDefinition>): WorkerDefinition => ({ ...customWorker(), ownerTenantId: "tenant-nova", origin: "tenant", status: "draft", createdBy: "ana", ...over } as WorkerDefinition);
    expect(validateWorker(definition({}), tools)).toEqual([]);
    expect(validateWorker(definition({ priority: "urgente" as never }), tools)[0]).toContain("prioridad");
  });

  it("is a company's choice for its own installation, and only a person's", () => {
    const base = enabled(["sales"]);
    expect(effectivePriority(STARTER_WORKERS[1], undefined)).toBe("high");
    expect(configure(base, "sales", "critical").instances[0].priority).toBe("critical");
    const send = (who: { tenantId: string; actor: string }, priority: string) => step(base, { ...who, at: day(1), type: "instance.configure", instanceId: inst(base, "sales"), maxRunsPerDay: 10, deniedProviders: [], priority: priority as never });
    expect(send(NEX, "critical").errorCode).toBe("personRequired");
    expect(send(VIDA, "critical").errorCode).toBe("notYours");
    expect(send(NOVA, "urgente").errorCode).toBe("configInvalid");
    // not passing a priority leaves the company's choice as it was
    const kept = must(configure(base, "sales", "low"), { ...NOVA, at: day(2), type: "instance.configure", instanceId: inst(base, "sales"), maxRunsPerDay: 5, deniedProviders: [] });
    expect(kept.instances[0]).toMatchObject({ priority: "low", maxRunsPerDay: 5 });
  });

  it("is stamped on each run when it starts, so changing it later does not rewrite what already ran", () => {
    const base = enabled(["sales"]);
    const first = started(base, "sales");
    expect(first.state.runs[0].priority).toBe("high"); // the Worker's default
    const raised = configure(first.state, "sales", "critical");
    const second = started(raised, "sales", NOVA, day(3));
    expect(second.state.runs.map((run) => run.priority)).toEqual(["high", "critical"]);
  });

  it("makes delegated work at least as urgent as the work that asked for it", () => {
    const base = enabled(["coordinator", "reporter"]);
    const root = started(base, "coordinator");
    const delegated = must(root.state, { ...W("coordinator"), at: day(2), type: "run.delegate", runId: root.id, toWorker: "reporter", goal: "Parte", grant: ["summary.prepare"], contextKeys: [] });
    expect(STARTER_WORKERS.find((worker) => worker.id === "reporter")?.priority).toBe("low");
    expect(delegated.runs[1].priority).toBe("high"); // a "low" specialist does not starve a "high" job
    const urgent = configure(base, "coordinator", "critical");
    const crit = started(urgent, "coordinator");
    expect(must(crit.state, { ...W("coordinator"), at: day(2), type: "run.delegate", runId: crit.id, toWorker: "reporter", goal: "Parte", grant: ["summary.prepare"], contextKeys: [] }).runs[1].priority).toBe("critical");
  });

  it("orders what waits for a person: most urgent first, then oldest", () => {
    let state = enabled(["sales", "followup", "collections"]);
    state = configure(state, "collections", "critical");
    state = configure(state, "followup", "low");
    const ask = (current: KoeState, worker: string, tool: string, input: Record<string, string>, at: string) => {
      const run = started(current, worker, NOVA, at);
      return must(run.state, { ...W(worker), at, type: "run.tool", runId: run.id, tool, input });
    };
    state = ask(state, "followup", "followup.send", { contacto: "a", mensaje: "b" }, "2026-10-02T10:00:00.000Z");
    state = ask(state, "sales", "message.sendFirst", { contacto: "a", mensaje: "b" }, "2026-10-02T11:00:00.000Z");
    state = ask(state, "collections", "payment.createLink", { cliente: "a", monto: "1.00 USD" }, "2026-10-02T12:00:00.000Z");
    state = ask(state, "sales", "message.sendFirst", { contacto: "c", mensaje: "d" }, "2026-10-02T13:00:00.000Z");
    const order = pendingApprovals(state, "tenant-nova").map((approval) => approval.tool);
    expect(order).toEqual(["payment.createLink", "message.sendFirst", "message.sendFirst", "followup.send"]); // critical, then the two "high" oldest first, then low
    const high = pendingApprovals(state, "tenant-nova").filter((approval) => approval.tool === "message.sendFirst");
    expect(Date.parse(high[0].requestedAt)).toBeLessThan(Date.parse(high[1].requestedAt));
  });

  it("never changes what a Worker may do: a critical Worker's actions keep their level and still wait for a person", () => {
    let state = enabled(["collections", "followup"]);
    state = configure(configure(state, "collections", "critical"), "followup", "critical");
    const money = started(state, "collections");
    const asked = must(money.state, { ...W("collections"), at: day(2), type: "run.tool", runId: money.id, tool: "payment.createLink", input: { cliente: "x", monto: "1.00 USD" } });
    expect(asked.approvals[0]).toMatchObject({ level: 3, financial: true });
    expect(asked.runs[0].status).toBe("waitingApproval");
    expect(step(asked, { ...NOVA, at: day(2), type: "approval.decide", approvalId: asked.approvals[0].id, approve: true }).errorCode).toBe("selfApproval"); // still a second person
    expect(must(asked, { ...PABLO, at: day(2), type: "approval.decide", approvalId: asked.approvals[0].id, approve: true }).approvals[0].status).toBe("approved");
    const message = started(state, "followup", NOVA, day(3));
    expect(must(message.state, { ...W("followup"), at: day(3), type: "run.tool", runId: message.id, tool: "followup.send", input: { contacto: "x", mensaje: "y" } }).runs[0].steps[0]).toMatchObject({ decision: "needsApproval", level: 3 });
  });
});

describe("estimated cost per run", () => {
  it("formats millionths of a dollar", () => {
    expect(formatCostMicros(4_000)).toBe("US$ 0.0040");
    expect(formatCostMicros(0)).toBe("US$ 0.0000");
    expect(formatCostMicros(1_500_000)).toBe("US$ 1.5000");
  });

  it("is declared by every Worker and validated as a whole, bounded number", () => {
    for (const worker of STARTER_WORKERS) expect(worker.costEstimate.perRunMicros, worker.id).toBeGreaterThan(0);
    const definition = (perRunMicros: number): WorkerDefinition => ({ ...customWorker(), ownerTenantId: "tenant-nova", origin: "tenant", status: "draft", createdBy: "ana", costEstimate: { perRunMicros } } as WorkerDefinition);
    expect(validateWorker(definition(0), tools)).toEqual([]);
    expect(validateWorker(definition(MAX_RUN_COST_MICROS), tools)).toEqual([]);
    for (const bad of [-1, 1.5, MAX_RUN_COST_MICROS + 1, Number.NaN]) expect(validateWorker(definition(bad), tools)[0], String(bad)).toContain("costo estimado");
  });

  it("is stamped on each run, and the metrics add up what the runs recorded, per company", () => {
    const state = demoKoeOk();
    const nova = koeMetrics(state, "tenant-nova");
    expect(nova.runs).toBe(6);
    expect(nova.estimatedCostMicros).toBe(state.runs.filter((run) => run.tenantId === "tenant-nova").reduce((sum, run) => sum + run.estimatedCostMicros, 0));
    expect(nova.byWorker.reduce((sum, entry) => sum + entry.estimatedCostMicros, 0)).toBe(nova.estimatedCostMicros);
    expect(nova.byWorker.reduce((sum, entry) => sum + entry.runs, 0)).toBe(6);
    expect(nova.steps).toBeGreaterThan(10);
    expect(nova.tokens).toBeGreaterThan(0);
    expect(nova.byWorker[0].estimatedCostMicros).toBeGreaterThanOrEqual(nova.byWorker.at(-1)?.estimatedCostMicros ?? 0); // costliest first
    expect(nova.byWorker.find((entry) => entry.workerId === "sales")).toMatchObject({ runs: 2, estimatedCostMicros: 1_800, priority: "high" });
    const vida = koeMetrics(state, "tenant-vida");
    expect(vida).toMatchObject({ runs: 0, estimatedCostMicros: 0, byWorker: [] });
  });

  it("counts a run at the estimate it had when it started, even if the Worker is edited afterwards", () => {
    const base = enabled(["reporter"]);
    const run = started(base, "reporter");
    const before = koeMetrics(run.state, "tenant-nova").estimatedCostMicros;
    expect(before).toBe(3_000);
    const edited: KoeState = { ...run.state, definitions: run.state.definitions.map((definition) => (definition.id === "reporter" ? { ...definition, costEstimate: { perRunMicros: 9_000 } } : definition)) };
    expect(koeMetrics(edited, "tenant-nova").estimatedCostMicros).toBe(3_000); // history is not rewritten
    expect(started(edited, "reporter", NOVA, day(3)).state.runs[1].estimatedCostMicros).toBe(9_000); // new runs use the new estimate
  });

  it("is only an estimate: it does not limit, bill or block anything", () => {
    let state = enabled(["reporter"]);
    state = must(state, { ...NOVA, at: day(1), type: "instance.configure", instanceId: inst(state, "reporter"), maxRunsPerDay: 50, deniedProviders: [] });
    for (let index = 0; index < 40; index += 1) state = started(state, "reporter").state;
    expect(koeMetrics(state, "tenant-nova").estimatedCostMicros).toBe(40 * 3_000);
    expect(state.runs).toHaveLength(40); // no budget stopped them
  });
});
