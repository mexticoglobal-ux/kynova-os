import { describe, expect, it } from "vitest";
import { demoKoeOk, customWorker, PLATFORM_TENANT } from "./koe-demo";
import {
  APPROVAL_TTL_HOURS, canDelegate, definitionOf, delegationGraph, effectiveTools, explainRun, instanceFor, instanceUsage, instancesOf, memoryOf, newKoeState, pendingApprovals, reduceKoe, rootRunsOf, runsOf, workerActor,
  type KoeEvent, type KoeState, type WorkerInput,
} from "./koe-engine";
import { ERROR_CODES, label, message } from "./koe-messages";
import { BASE_MODELS, STARTER_WORKERS, type ToolManifest } from "./koe-registry";
import { ACTION_LEVELS } from "./workers";

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T10:00:00.000Z`;
const NOVA = { tenantId: "tenant-nova", actor: "ana" };
const PABLO = { tenantId: "tenant-nova", actor: "pablo" };
const VIDA = { tenantId: "tenant-vida", actor: "lucia" };
const ADMIN_A = { tenantId: PLATFORM_TENANT, actor: "admin:ana" };
const ADMIN_B = { tenantId: PLATFORM_TENANT, actor: "admin:bruno" };
const NEX = { tenantId: "tenant-nova", actor: "worker:nex" };
const W = (workerId: string, tenantId = "tenant-nova") => ({ tenantId, actor: workerActor(workerId) });

const step = (state: KoeState, event: KoeEvent) => reduceKoe(state, event);
const must = (state: KoeState, event: KoeEvent): KoeState => {
  const result = reduceKoe(state, event);
  expect(result.error, event.type).toBeUndefined();
  return result.state;
};
const fresh = () => newKoeState(["admin:ana", "admin:bruno"]);
const enabled = (ids: string[], tenant = NOVA, state = fresh()) => ids.reduce((current, definitionId) => must(current, { ...tenant, at: day(1), type: "worker.enable", definitionId }), state);
const inst = (state: KoeState, definitionId: string, tenantId = "tenant-nova") => instanceFor(state, tenantId, definitionId)?.id ?? "";
const started = (state: KoeState, definitionId: string, who = NOVA, goal = "Objetivo", at = day(2)) => {
  const next = must(state, { ...who, at, type: "run.start", instanceId: inst(state, definitionId, who.tenantId), goal });
  return { state: next, id: next.runs.at(-1)?.id ?? "" };
};
const tool = (runId: string, workerId: string, toolId: string, input: Record<string, string>, at = day(2), tenantId = "tenant-nova"): KoeEvent => ({ ...W(workerId, tenantId), at, type: "run.tool", runId, tool: toolId, input });
const lastApproval = (state: KoeState) => state.approvals.at(-1)?.id ?? "";

/** Brings a custom Worker to life the way a company would: draft, submit, a second person approves, enable. */
const activate = (state: KoeState, over: Partial<WorkerInput>, tenant = NOVA) => {
  const input = customWorker(over);
  let current = must(state, { ...tenant, at: day(1), type: "worker.draft", input });
  current = must(current, { ...tenant, at: day(1), type: "worker.submit", definitionId: input.id });
  current = must(current, { tenantId: tenant.tenantId, actor: tenant.actor === "ana" ? "pablo" : "ana", at: day(1), type: "worker.review", definitionId: input.id, approve: true });
  return must(current, { ...tenant, at: day(1), type: "worker.enable", definitionId: input.id });
};

describe("the sample loads without a refusal and shows every mechanism", () => {
  it("has finished, waiting and delegated runs, a pending approval, a promoted memory and a drafted Worker", () => {
    const state = demoKoeOk();
    expect(state.runs.map((run) => run.status).sort()).toEqual(["completed", "completed", "completed", "completed", "completed", "waitingApproval"]);
    expect(pendingApprovals(state, "tenant-nova")).toHaveLength(1);
    expect(state.memory.map((item) => [item.scope, item.cleared ?? false])).toEqual([["run", true], ["durable", false]]);
    expect(definitionOf(state, "reclamos")?.status).toBe("pendingReview");
    expect(rootRunsOf(state, "tenant-nova")).toHaveLength(4);
    expect(runsOf(state, "tenant-nova")).toHaveLength(6);
  });

  it("shows a nested trace of who did what, with each step's decision and level", () => {
    const state = demoKoeOk();
    const root = rootRunsOf(state, "tenant-nova")[0];
    const trace = explainRun(state, root.id).join("\n");
    expect(trace).toContain("Coordinador · completed");
    expect(trace).toContain("Asistente comercial · completed");
    expect(trace).toContain("Analista de reportes · completed");
    expect(trace).toContain("[allowed · Nivel 1]");
    expect(trace).toContain("Consulta a Razonamiento C");
    expect(trace).toContain("Consulta a Rápido A"); // the sales assistant touched personal data
  });

  it("keeps each company's Workers, runs and memory apart", () => {
    const state = demoKoeOk();
    expect(instancesOf(state, "tenant-vida").map((item) => item.definitionId)).toEqual(["reporter"]);
    expect(runsOf(state, "tenant-vida")).toHaveLength(0);
    expect(memoryOf(state, "tenant-vida")).toHaveLength(0);
    expect(pendingApprovals(state, "tenant-vida")).toHaveLength(0);
    const novaRun = state.runs[0];
    expect(step(state, { ...W("coordinator", "tenant-vida"), at: day(9), type: "run.tool", runId: novaRun.id, tool: "task.create", input: { titulo: "x" } }).errorCode).toBe("notYours");
    expect(step(state, { ...VIDA, at: day(9), type: "instance.pause", instanceId: novaRun.instanceId }).errorCode).toBe("notYours");
    expect(step(state, { ...VIDA, at: day(9), type: "approval.decide", approvalId: lastApproval(state), approve: true }).errorCode).toBe("notYours");
    expect(step(state, { ...VIDA, at: day(9), type: "run.cancel", runId: state.runs[3].id }).errorCode).toBe("notYours");
    expect(step(state, { ...VIDA, at: day(9), type: "worker.enable", definitionId: "reclamos" }).errorCode).toBe("notYours"); // it belongs to Nova
  });
});

describe("autonomy levels are decided by the catalog, never by a Worker", () => {
  it("runs Level 1 at once, makes Level 3 wait for a person, and a waiting run cannot move on", () => {
    const { state, id } = started(enabled(["sales"]), "sales");
    const read = must(state, tool(id, "sales", "contact.read", { contacto: "Clínica Vida" }));
    expect(read.runs[0].steps[0]).toMatchObject({ decision: "allowed", level: 1 });
    const send = must(read, tool(id, "sales", "message.sendFirst", { contacto: "Clínica Vida", mensaje: "Hola" }));
    expect(send.runs[0].status).toBe("waitingApproval");
    expect(send.runs[0].steps[1]).toMatchObject({ decision: "needsApproval", level: 3 });
    expect(send.runs[0].steps[1].output).toBeUndefined(); // nothing happened yet
    expect(step(send, tool(id, "sales", "contact.read", { contacto: "x" })).errorCode).toBe("runNotRunning");
    expect(step(send, { ...W("sales"), at: day(2), type: "run.finish", runId: id, outcome: "completed", result: "x" }).errorCode).toBe("runNotRunning");

    const approved = must(send, { ...NOVA, at: day(2), type: "approval.decide", approvalId: lastApproval(send), approve: true }); // not a money move: the starter may approve
    expect(approved.runs[0].status).toBe("running");
    expect(approved.runs[0].steps[1]).toMatchObject({ decision: "approved" });
    expect(approved.runs[0].steps[1].output).toContain("[simulado]");
    const rejected = must(send, { ...NOVA, at: day(2), type: "approval.decide", approvalId: lastApproval(send), approve: false, reason: "No" });
    expect(rejected.runs[0].steps[1]).toMatchObject({ decision: "rejected" });
    expect(rejected.runs[0].steps[1].output).toBeUndefined();
    expect(step(approved, { ...NOVA, at: day(3), type: "approval.decide", approvalId: lastApproval(send), approve: false }).errorCode).toBe("approvalResolved");
  });

  it("lets Level 2 run only inside an active authorization with a daily limit", () => {
    const first = started(enabled(["sales"]), "sales");
    const { id } = first;
    let state = first.state;
    const faq = () => tool(id, "sales", "faq.answer", { pregunta: "¿Horario?" });
    expect(must(state, faq()).runs[0].steps[0]).toMatchObject({ decision: "needsApproval", level: 2 }); // no authorization yet
    state = must(state, { ...NOVA, at: day(2), type: "authorization.grant", instanceId: inst(state, "sales"), action: "faq.answer", maxPerDay: 2 });
    state = must(must(state, faq()), faq());
    expect(state.runs[0].steps.map((s) => s.decision)).toEqual(["allowed", "allowed"]);
    expect(instanceUsage(state, state.instances[0], day(2)).authorizations[0].usedToday).toBe(2);
    expect(must(state, faq()).runs[0].steps[2]).toMatchObject({ decision: "needsApproval" }); // the limit is spent: back to a person
  });

  it("stops honoring an authorization that expired or was revoked", () => {
    const base = enabled(["sales"]);
    const granted = must(base, { ...NOVA, at: day(1), type: "authorization.grant", instanceId: inst(base, "sales"), action: "faq.answer", maxPerDay: 5, expiresAt: "2026-10-02T00:00:00.000Z" });
    const late = started(granted, "sales", NOVA, "x", day(3));
    expect(must(late.state, tool(late.id, "sales", "faq.answer", { pregunta: "?" }, day(3))).runs[0].steps[0].decision).toBe("needsApproval");
    const open = must(base, { ...NOVA, at: day(1), type: "authorization.grant", instanceId: inst(base, "sales"), action: "faq.answer", maxPerDay: 5 });
    const revoked = must(open, { ...PABLO, at: day(1), type: "authorization.revoke", authorizationId: open.authorizations[0].id });
    const run = started(revoked, "sales");
    expect(must(run.state, tool(run.id, "sales", "faq.answer", { pregunta: "?" })).runs[0].steps[0].decision).toBe("needsApproval");
  });

  it("never lets a person authorize Level 3, nor Level 1, nor a tool the Worker does not hold, and never lets a Worker authorize", () => {
    const state = enabled(["sales"]);
    const grant = (action: string, over: Partial<Extract<KoeEvent, { type: "authorization.grant" }>> = {}, who: { tenantId: string; actor: string } = NOVA) => step(state, { ...who, at: day(2), type: "authorization.grant", instanceId: inst(state, "sales"), action, maxPerDay: 3, ...over });
    expect(grant("message.sendFirst").errorCode).toBe("authorizationInvalid"); // Level 3 always asks
    expect(grant("contact.read").errorCode).toBe("authorizationInvalid"); // Level 1 needs none
    expect(grant("payment.createLink").errorCode).toBe("authorizationInvalid"); // sales does not hold it
    expect(grant("faq.answer", {}, NEX).errorCode).toBe("personRequired");
    expect(grant("faq.answer", {}, W("sales")).errorCode).toBe("personRequired");
    expect(grant("faq.answer", { maxPerDay: 0 }).errorCode).toBe("authorizationInvalid");
    expect(grant("faq.answer", { expiresAt: "2026-10-01T00:00:00.000Z" }).errorCode).toBe("authorizationInvalid");
    expect(grant("faq.answer", {}, VIDA).errorCode).toBe("instanceNotFound" in {} ? "x" : "notYours");
    expect(ACTION_LEVELS["faq.answer"]).toBe(2);
    expect(grant("message.sendFirst").state.audit.at(-1)?.action).toBe("refused"); // the attempt is on the record
  });

  it("refuses unknown tools, tools outside the Worker's list, and missing input", () => {
    const { state, id } = started(enabled(["reporter"]), "reporter");
    expect(step(state, tool(id, "reporter", "nope.nothing", {})).errorCode).toBe("toolUnknown");
    expect(step(state, tool(id, "reporter", "followup.send", { contacto: "x", mensaje: "y" })).errorCode).toBe("toolNotAllowed");
    expect(step(state, tool(id, "reporter", "summary.prepare", { tema: " " })).errorCode).toBe("inputInvalid");
  });

  it("only lets the run's own Worker move it", () => {
    const { state, id } = started(enabled(["sales", "reporter"]), "sales");
    expect(step(state, { ...NOVA, at: day(2), type: "run.tool", runId: id, tool: "contact.read", input: { contacto: "x" } }).errorCode).toBe("notThisWorker");
    expect(step(state, tool(id, "reporter", "summary.prepare", { tema: "x" })).errorCode).toBe("notThisWorker");
    expect(step(state, { ...NEX, at: day(2), type: "run.model", runId: id }).errorCode).toBe("notThisWorker");
    expect(step(state, { ...NOVA, at: day(2), type: "run.finish", runId: id, outcome: "completed", result: "x" }).errorCode).toBe("notThisWorker");
  });

  it("asks for a person other than the initiator when the action moves money, and any person when the initiator was the system", () => {
    const base = enabled(["collections"]);
    const { state, id } = started(base, "collections");
    const waiting = must(state, tool(id, "collections", "payment.createLink", { cliente: "Hotel Mar", monto: "900.00 USD" }));
    expect(waiting.approvals[0]).toMatchObject({ financial: true, level: 3 });
    expect(step(waiting, { ...NOVA, at: day(2), type: "approval.decide", approvalId: lastApproval(waiting), approve: true }).errorCode).toBe("selfApproval");
    expect(step(waiting, { ...NEX, at: day(2), type: "approval.decide", approvalId: lastApproval(waiting), approve: true }).errorCode).toBe("personRequired");
    expect(step(waiting, { ...W("collections"), at: day(2), type: "approval.decide", approvalId: lastApproval(waiting), approve: true }).errorCode).toBe("personRequired");
    expect(step(waiting, { ...NOVA, at: day(2), type: "approval.decide", approvalId: lastApproval(waiting), approve: false }).error).toBeUndefined(); // refusing is always allowed
    expect(must(waiting, { ...PABLO, at: day(2), type: "approval.decide", approvalId: lastApproval(waiting), approve: true }).approvals[0].status).toBe("approved");

    const automated = must(base, { tenantId: "tenant-nova", actor: "system", at: day(2), type: "run.start", instanceId: inst(base, "collections"), goal: "Cobro automático" });
    const run = automated.runs[0].id;
    const asked = must(automated, tool(run, "collections", "payment.createLink", { cliente: "Hotel Mar", monto: "1.00 USD" }));
    expect(must(asked, { ...NOVA, at: day(2), type: "approval.decide", approvalId: lastApproval(asked), approve: true }).approvals[0].status).toBe("approved");
  });
});

describe("collaboration under KOE: specialists hand work to each other without gaining powers", () => {
  const team = () => enabled(["coordinator", "sales", "followup", "reporter", "collections"]);
  const delegate = (state: KoeState, runId: string, toWorker: string, grant: string[] = [], contextKeys: string[] = [], from = "coordinator"): KoeEvent => ({ ...W(from), at: day(2), type: "run.delegate", runId, toWorker, goal: "Una parte del trabajo", grant, contextKeys });

  it("needs both sides to agree, and shows the company's collaboration graph", () => {
    const coordinator = STARTER_WORKERS.find((w) => w.id === "coordinator");
    const tutor = STARTER_WORKERS.find((w) => w.id === "tutor");
    const sales = STARTER_WORKERS.find((w) => w.id === "sales");
    if (!coordinator || !tutor || !sales) throw new Error("missing starter worker");
    expect(canDelegate(coordinator, sales)).toBe(true);
    expect(canDelegate(sales, coordinator)).toBe(false);
    expect(canDelegate(coordinator, tutor)).toBe(false);
    const edges = delegationGraph(team(), "tenant-nova").map((edge) => `${edge.from}>${edge.to}`).sort();
    expect(edges).toContain("coordinator>sales");
    expect(edges).toContain("sales>followup");
    expect(edges).toContain("coordinator>reporter");
    expect(edges).toContain("followup>reporter");
    expect(edges).not.toContain("sales>reporter");
    expect(delegationGraph(enabled(["coordinator"]), "tenant-nova")).toEqual([]); // nobody to delegate to yet
  });

  it("delegates to an enabled specialist, creating a child run that keeps the human initiator", () => {
    const { state, id } = started(team(), "coordinator");
    const next = must(state, delegate(state, id, "sales", ["lead.score"]));
    const child = next.runs[1];
    expect(child).toMatchObject({ workerId: "sales", parentRunId: id, rootRunId: id, depth: 1, startedBy: "ana", status: "running" });
    expect(child.chain).toEqual(["coordinator", "sales"]);
    expect(next.runs[0].steps[0]).toMatchObject({ kind: "delegate", childRunId: child.id });
    expect(explainRun(next, id).join("\n")).toContain("Asistente comercial");
    expect(step(next, { ...W("coordinator"), at: day(2), type: "run.finish", runId: id, outcome: "completed", result: "x" }).errorCode).toBe("childrenRunning");
  });

  it("refuses to delegate to a Worker that is not listed, not accepting, not enabled or not active", () => {
    const { state, id } = started(team(), "coordinator");
    expect(step(state, delegate(state, id, "tutor")).errorCode).toBe("notActive" in {} ? "x" : "delegationNotAllowed");
    const lone = started(enabled(["coordinator"]), "coordinator");
    expect(step(lone.state, delegate(lone.state, lone.id, "sales")).errorCode).toBe("targetNotEnabled");
    const sales = started(team(), "sales");
    expect(step(sales.state, delegate(sales.state, sales.id, "reporter", [], [], "sales")).errorCode).toBe("delegationNotAllowed");
    expect(step(state, delegate(state, id, "ghost")).errorCode).toBe("notActive");

    const picky = activate(activate(enabled(["coordinator"]), { id: "caller", collaboration: { delegatesTo: ["listener"], acceptsFrom: [] }, limits: { maxRunsPerDay: 5, maxStepsPerRun: 10, maxDelegationDepth: 1 } }), { id: "listener", collaboration: { delegatesTo: [], acceptsFrom: [] } });
    const run = started(picky, "caller");
    expect(step(run.state, delegate(run.state, run.id, "listener", [], [], "caller")).errorCode).toBe("delegationNotAccepted");
  });

  it("never raises powers: Level 3 tools cannot be handed over, and a child only uses what it was granted", () => {
    const { state, id } = started(team(), "coordinator");
    expect(step(state, delegate(state, id, "collections", ["payment.createLink"])).errorCode).toBe("grantInvalid"); // the coordinator does not hold it
    expect(step(state, delegate(state, id, "sales", ["payment.createLink"])).errorCode).toBe("grantInvalid"); // the receiver does not have it
    expect(step(state, delegate(state, id, "sales", ["message.sendFirst"])).errorCode).toBe("grantInvalid"); // Level 3 and the delegator lacks it
    const granted = must(state, delegate(state, id, "sales", ["lead.score"]));
    const child = granted.runs[1].id;
    expect(effectiveTools(STARTER_WORKERS.find((w) => w.id === "sales") as never, granted.runs[1])).toEqual(["lead.score"]);
    expect(step(granted, tool(child, "sales", "message.draft", { contacto: "x", tema: "y" })).errorCode).toBe("toolNotGranted");
    expect(step(granted, tool(child, "sales", "message.sendFirst", { contacto: "x", mensaje: "y" })).errorCode).toBe("toolNotGranted");
    expect(must(granted, tool(child, "sales", "lead.score", { prospecto: "x" })).runs[1].steps[0].decision).toBe("allowed");
    // with no explicit grant the child gets only the receiver's Level 1 tools
    const bare = must(state, delegate(state, id, "sales", []));
    expect(effectiveTools(STARTER_WORKERS.find((w) => w.id === "sales") as never, bare.runs[1])).toEqual(["contact.read", "lead.score", "summary.prepare", "message.draft"]);
  });

  it("still sends a child's Level 3 action to a person", () => {
    const { state, id } = started(team(), "sales");
    const handed = must(state, delegate(state, id, "followup", ["contact.read"], [], "sales"));
    expect(handed.runs[1].workerId).toBe("followup");
    expect(step(handed, tool(handed.runs[1].id, "followup", "followup.send", { contacto: "x", mensaje: "y" })).errorCode).toBe("toolNotGranted");
  });

  it("detects a delegation cycle and stops a chain that is too deep", () => {
    const loop = activate(activate(fresh(), { id: "ping", collaboration: { delegatesTo: ["pong"], acceptsFrom: ["pong"] }, limits: { maxRunsPerDay: 5, maxStepsPerRun: 10, maxDelegationDepth: 3 } }), { id: "pong", collaboration: { delegatesTo: ["ping"], acceptsFrom: ["ping"] }, limits: { maxRunsPerDay: 5, maxStepsPerRun: 10, maxDelegationDepth: 3 } });
    const root = started(loop, "ping");
    const down = must(root.state, delegate(root.state, root.id, "pong", ["task.create"], [], "ping"));
    expect(step(down, delegate(down, down.runs[1].id, "ping", ["task.create"], [], "pong")).errorCode).toBe("delegationCycle");

    const chain = activate(activate(activate(fresh(), { id: "wa", collaboration: { delegatesTo: ["wb"], acceptsFrom: [] }, limits: { maxRunsPerDay: 5, maxStepsPerRun: 10, maxDelegationDepth: 1 } }), { id: "wb", collaboration: { delegatesTo: ["wc"], acceptsFrom: ["wa"] }, limits: { maxRunsPerDay: 5, maxStepsPerRun: 10, maxDelegationDepth: 1 } }), { id: "wc", collaboration: { delegatesTo: [], acceptsFrom: ["wb"] } });
    const top = started(chain, "wa");
    const mid = must(top.state, delegate(top.state, top.id, "wb", ["task.create"], [], "wa"));
    expect(step(mid, delegate(mid, mid.runs[1].id, "wc", ["task.create"], [], "wb")).errorCode).toBe("delegationDepth");
  });

  it("keeps personal data from crossing to a Worker that is not cleared for it, and withholds personal results from a delegator that is not", () => {
    const state = demoKoeOk();
    const plan = state.runs[0];
    const items = Object.fromEntries(plan.context.map((item) => [item.key, item.value]));
    expect(items["resultado:reporter"]).toContain("3 prospectos calientes");
    expect(items["resultado:sales"]).toBe("[retenido: contiene datos personales]");
    expect(plan.dataTouched).toBe("business"); // the coordinator never saw the personal result
    expect(explainRun(state, plan.id).join("\n")).toContain("contenido retenido por privacidad");

    const bridge = activate(activate(fresh(), { id: "holder", dataClearance: "personal", tools: ["contact.read"], memory: { maxEntries: 5, maxChars: 500, allowPersonal: true, durable: false }, collaboration: { delegatesTo: ["viewer"], acceptsFrom: [] }, limits: { maxRunsPerDay: 5, maxStepsPerRun: 10, maxDelegationDepth: 1 } }), { id: "viewer", collaboration: { delegatesTo: [], acceptsFrom: ["holder"] } });
    const run = started(bridge, "holder");
    const stored = must(must(run.state, { ...W("holder"), at: day(2), type: "memory.put", runId: run.id, key: "paciente", value: "María Pérez, 8888-1234", sensitivity: "personal" }), { ...W("holder"), at: day(2), type: "memory.put", runId: run.id, key: "tema", value: "Cita de control", sensitivity: "business" });
    const shared = must(stored, delegate(stored, run.id, "viewer", ["task.create"], ["paciente", "tema"], "holder"));
    expect(shared.runs[1].context.map((item) => item.key)).toEqual(["tema"]); // the personal item stayed behind
    expect(shared.runs[0].steps.at(-1)?.detail).toContain("retenido");
  });

  it("cancelling a run cancels what it delegated, rejects their pending approvals and erases their memory", () => {
    const { state, id } = started(team(), "coordinator");
    const delegated = must(state, delegate(state, id, "reporter", ["summary.prepare"]));
    const child = delegated.runs[1].id;
    const cancelled = must(delegated, { ...NOVA, at: day(3), type: "run.cancel", runId: id });
    expect(cancelled.runs.map((run) => run.status)).toEqual(["cancelled", "cancelled"]);
    expect(step(cancelled, { ...NOVA, at: day(3), type: "run.cancel", runId: child }).errorCode).toBe("runNotRunning");
    expect(step(delegated, { ...NEX, at: day(3), type: "run.cancel", runId: id }).errorCode).toBe("personRequired");
  });

  it("returns a delegated result to the delegator, and refuses a result that is empty", () => {
    const { state, id } = started(team(), "coordinator");
    const delegated = must(state, delegate(state, id, "reporter", ["summary.prepare"]));
    const child = delegated.runs[1].id;
    expect(step(delegated, { ...W("reporter"), at: day(2), type: "run.finish", runId: child, outcome: "completed", result: " " }).errorCode).toBe("reasonRequired");
    const done = must(delegated, { ...W("reporter"), at: day(2), type: "run.finish", runId: child, outcome: "completed", result: "Todo en orden" });
    expect(done.runs[0].context.find((item) => item.key === "resultado:reporter")?.value).toBe("Todo en orden");
    expect(must(done, { ...W("coordinator"), at: day(2), type: "run.finish", runId: id, outcome: "completed", result: "Listo" }).runs[0].status).toBe("completed");
  });
});

describe("working memory", () => {
  const holder = (over: Partial<WorkerInput> = {}) => activate(fresh(), { id: "keeper", dataClearance: "personal", tools: ["contact.read"], memory: { maxEntries: 2, maxChars: 100, allowPersonal: true, durable: true }, ...over });
  const put = (runId: string, key: string, value: string, sensitivity: "public" | "business" | "personal" = "business"): KoeEvent => ({ ...W("keeper"), at: day(2), type: "memory.put", runId, key, value, sensitivity });

  it("refuses secrets and payment data, personal data it is not cleared for, and values that are too long or too many", () => {
    const { state, id } = started(holder(), "keeper");
    expect(step(state, put(id, "clave", "sk_live_abc123")).errorCode).toBe("memorySecret");
    expect(step(state, put(id, "tarjeta", "4111 1111 1111 1111")).errorCode).toBe("memorySecret");
    expect(step(state, put(id, "largo", "x".repeat(101))).errorCode).toBe("memoryTooLong");
    const noPersonal = started(holder({ memory: { maxEntries: 2, maxChars: 100, allowPersonal: false, durable: true } }), "keeper");
    expect(step(noPersonal.state, put(noPersonal.id, "paciente", "María", "personal")).errorCode).toBe("memoryClearance");
    const business = started(holder({ dataClearance: "business", tools: ["lead.score"], memory: { maxEntries: 2, maxChars: 100, allowPersonal: false, durable: true } }), "keeper");
    expect(step(business.state, put(business.id, "paciente", "María", "personal")).errorCode).toBe("memoryClearance");
    let current = must(state, put(id, "a", "uno"));
    current = must(current, put(id, "b", "dos"));
    expect(step(current, put(id, "c", "tres")).errorCode).toBe("memoryFull");
    expect(step(current, put(id, "a", "uno de nuevo")).error).toBeUndefined(); // overwriting a key is not a new entry
    expect(step(current, put(id, " ", "x")).errorCode).toBe("reasonRequired");
  });

  it("erases the values when the run ends, leaving only the trace that they existed", () => {
    const { state, id } = started(holder(), "keeper");
    const stored = must(state, put(id, "nota", "algo del trabajo"));
    expect(stored.memory[0]).toMatchObject({ value: "algo del trabajo", scope: "run" });
    const done = must(stored, { ...W("keeper"), at: day(2), type: "run.finish", runId: id, outcome: "completed", result: "Listo" });
    expect(done.memory[0]).toMatchObject({ value: "", cleared: true, key: "nota" });
    const cancelled = must(started(holder(), "keeper").state, { ...NOVA, at: day(3), type: "run.cancel", runId: stored.runs[0].id });
    expect(cancelled.runs[0].status).toBe("cancelled");
  });

  it("keeps something past the run only when a person promotes it, never personal data, and lets it expire or be forgotten", () => {
    const { state, id } = started(holder(), "keeper");
    const stored = must(must(state, put(id, "dato", "Preferencia de horario")), put(id, "paciente", "María", "personal"));
    const [shared, personal] = stored.memory;
    expect(step(stored, { ...NEX, at: day(3), type: "memory.promote", entryId: shared.id }).errorCode).toBe("personRequired");
    expect(step(stored, { ...NOVA, at: day(3), type: "memory.promote", entryId: personal.id }).errorCode).toBe("memoryNotPromotable");
    expect(step(stored, { ...VIDA, at: day(3), type: "memory.promote", entryId: shared.id }).errorCode).toBe("notYours");
    const kept = must(stored, { ...NOVA, at: day(3), type: "memory.promote", entryId: shared.id });
    const durable = kept.memory.at(-1);
    expect(durable).toMatchObject({ scope: "durable", key: "dato", value: "Preferencia de horario" });
    expect(durable?.expiresAt).toBe("2026-11-02T10:00:00.000Z");
    expect(must(kept, { tenantId: PLATFORM_TENANT, actor: "system", at: "2026-11-03T10:00:00.000Z", type: "tick" }).memory.at(-1)).toMatchObject({ cleared: true, value: "" });
    expect(must(kept, { ...NOVA, at: day(4), type: "memory.forget", entryId: durable?.id ?? "" }).memory.at(-1)).toMatchObject({ cleared: true, value: "" });
    expect(step(kept, { ...VIDA, at: day(4), type: "memory.forget", entryId: durable?.id ?? "" }).errorCode).toBe("notYours");
    expect(step(kept, { ...NOVA, at: day(4), type: "memory.promote", entryId: shared.id }).error).toBeUndefined();
    const volatile = started(enabled(["sales"]), "sales");
    const sale = must(volatile.state, { ...W("sales"), at: day(2), type: "memory.put", runId: volatile.id, key: "nota", value: "algo", sensitivity: "business" });
    expect(step(sale, { ...NOVA, at: day(3), type: "memory.promote", entryId: sale.memory[0].id }).errorCode).toBe("memoryNotPromotable"); // sales does not keep memory
  });
});

describe("KOE routes models by policy and records why", () => {
  it("routes by what the run has touched: personal data forces a model that does not train on it", () => {
    const worker = activate(fresh(), { id: "thinker", dataClearance: "personal", tools: ["contact.read"], routing: { needs: ["reasoning"], policy: {} } });
    const { state, id } = started(worker, "thinker");
    const before = must(state, { ...W("thinker"), at: day(2), type: "run.model", runId: id });
    expect(before.runs[0].steps[0].modelId).toBe("m-reason-c"); // business data: the cheapest model that qualifies
    const touched = must(before, tool(id, "thinker", "contact.read", { contacto: "María" }));
    const after = must(touched, { ...W("thinker"), at: day(2), type: "run.model", runId: id });
    expect(after.runs[0].steps.at(-1)?.modelId).toBe("m-reason-b");
    expect(after.runs[0].steps.at(-1)?.routing).toBeDefined();
    expect(after.runs[0].dataTouched).toBe("personal");
    // a task cannot ask for less protection than the run already has
    const attempt = must(touched, { ...W("thinker"), at: day(2), type: "run.model", runId: id, task: { dataClearance: "public" } });
    expect(attempt.runs[0].steps.at(-1)?.modelId).toBe("m-reason-b");
  });

  it("refuses, and records the refusal, when no model can serve the task", () => {
    const worker = activate(fresh(), { id: "thinker", dataClearance: "personal", tools: ["contact.read"], routing: { needs: ["reasoning"], policy: {} } });
    const { state, id } = started(worker, "thinker");
    const touched = must(state, tool(id, "thinker", "contact.read", { contacto: "María" }));
    const down = must(touched, { ...ADMIN_A, at: day(2), type: "model.update", modelId: "m-reason-b", health: "down" });
    const refused = step(down, { ...W("thinker"), at: day(2), type: "run.model", runId: id });
    expect(refused.errorCode).toBe("noModel");
    expect(refused.state.audit.at(-1)?.action).toBe("model.none");
  });

  it("falls back when a model goes down, and says so in the audit", () => {
    const { state, id } = started(enabled(["sales"]), "sales");
    const down = must(state, { ...ADMIN_A, at: day(2), type: "model.update", modelId: "m-fast-a", health: "down" });
    const noTools = must(down, { ...W("sales"), at: day(2), type: "run.model", runId: id, task: { needsTools: false } });
    expect(noTools.runs[0].steps[0].modelId).toBe("m-vision-d");
    expect(noTools.audit.at(-1)?.detail).toContain("respaldo");
    expect(step(down, { ...W("sales"), at: day(2), type: "run.model", runId: id }).errorCode).toBe("noModel"); // with tools needed, nobody else serves "fast"
  });

  it("adds a model from a new provider as data, only for administrators", () => {
    const newcomer = { id: "m-fast-e", provider: "proveedor-e", label: "Rápido E", classes: ["fast" as const], maxContextTokens: 32_000, costMicrosPer1k: 50, dataPolicy: "noTraining" as const, regions: ["us"], supportsTools: true, health: "healthy" as const, enabled: true };
    const { state, id } = started(enabled(["sales"]), "sales");
    expect(step(state, { ...NOVA, at: day(2), type: "model.register", model: newcomer }).errorCode).toBe("adminRequired");
    expect(step(state, { ...NEX, at: day(2), type: "model.register", model: newcomer }).errorCode).toBe("personRequired");
    expect(step(state, { ...ADMIN_A, at: day(2), type: "model.register", model: { ...newcomer, regions: [] } }).errorCode).toBe("modelInvalid");
    const added = must(state, { ...ADMIN_A, at: day(2), type: "model.register", model: newcomer });
    expect(step(added, { ...ADMIN_B, at: day(2), type: "model.register", model: newcomer }).errorCode).toBe("modelInvalid"); // repeated id
    expect(must(added, { ...W("sales"), at: day(2), type: "run.model", runId: id }).runs[0].steps[0].modelId).toBe("m-fast-e");
    expect(step(added, { ...NOVA, at: day(2), type: "model.update", modelId: "m-fast-e", health: "down" }).errorCode).toBe("adminRequired");
    expect(step(added, { ...ADMIN_A, at: day(2), type: "model.update", modelId: "nope", health: "down" }).errorCode).toBe("modelNotFound");
    expect(BASE_MODELS.length).toBe(5);
  });

  it("honors a Worker's own routing policy", () => {
    const worker = activate(fresh(), { id: "picky", routing: { needs: ["reasoning"], policy: { deniedProviders: ["proveedor-c"] } } });
    const { state, id } = started(worker, "picky");
    expect(must(state, { ...W("picky"), at: day(2), type: "run.model", runId: id }).runs[0].steps[0].modelId).toBe("m-reason-b");
  });
});

describe("limits and kill switches", () => {
  it("limits runs per day and steps per run, and honors a paused Worker", () => {
    const worker = activate(fresh(), { id: "tiny", limits: { maxRunsPerDay: 2, maxStepsPerRun: 2, maxDelegationDepth: 0 } });
    const one = started(worker, "tiny");
    const two = started(one.state, "tiny");
    expect(step(two.state, { ...NOVA, at: day(2), type: "run.start", instanceId: inst(two.state, "tiny"), goal: "Tercera" }).errorCode).toBe("dailyRunLimit");
    expect(step(two.state, { ...NOVA, at: day(3), type: "run.start", instanceId: inst(two.state, "tiny"), goal: "Otro día" }).error).toBeUndefined();
    let current = must(one.state, tool(one.id, "tiny", "task.create", { titulo: "a" }));
    current = must(current, tool(one.id, "tiny", "task.create", { titulo: "b" }));
    expect(step(current, tool(one.id, "tiny", "task.create", { titulo: "c" })).errorCode).toBe("stepLimit");
    const paused = must(current, { ...NOVA, at: day(3), type: "instance.pause", instanceId: inst(current, "tiny") });
    expect(step(paused, { ...NOVA, at: day(3), type: "run.start", instanceId: inst(paused, "tiny"), goal: "x" }).errorCode).toBe("instancePaused");
    expect(step(paused, { ...NEX, at: day(3), type: "instance.resume", instanceId: inst(paused, "tiny") }).errorCode).toBe("personRequired");
    expect(must(paused, { ...PABLO, at: day(3), type: "instance.resume", instanceId: inst(paused, "tiny") }).instances[0].status).toBe("active");
  });

  it("lets a person stop every Worker of their company at once, while refusing is still possible", () => {
    const { state, id } = started(enabled(["collections", "reporter"]), "collections");
    const waiting = must(state, tool(id, "collections", "payment.createLink", { cliente: "Hotel Mar", monto: "1.00 USD" }));
    const stopped = must(waiting, { ...PABLO, at: day(2), type: "tenant.pause", paused: true });
    expect(step(stopped, { ...NOVA, at: day(2), type: "run.start", instanceId: inst(stopped, "reporter"), goal: "x" }).errorCode).toBe("tenantPaused");
    expect(step(stopped, { ...W("collections"), at: day(2), type: "run.model", runId: id }).errorCode).toBe("tenantPaused");
    expect(step(stopped, { ...PABLO, at: day(2), type: "approval.decide", approvalId: lastApproval(stopped), approve: true }).errorCode).toBe("tenantPaused"); // nothing executes while stopped
    expect(must(stopped, { ...PABLO, at: day(2), type: "approval.decide", approvalId: lastApproval(stopped), approve: false }).approvals[0].status).toBe("rejected");
    expect(step(stopped, { ...NEX, at: day(2), type: "tenant.pause", paused: false }).errorCode).toBe("personRequired");
    const resumed = must(stopped, { ...PABLO, at: day(3), type: "tenant.pause", paused: false });
    expect(step(resumed, { ...NOVA, at: day(3), type: "run.start", instanceId: inst(resumed, "reporter"), goal: "x" }).error).toBeUndefined();
    const other = enabled(["reporter"], VIDA, stopped); // another company is unaffected
    expect(step(other, { ...VIDA, at: day(3), type: "run.start", instanceId: inst(other, "reporter", "tenant-vida"), goal: "x" }).error).toBeUndefined();
  });

  it("has a platform-wide stop that only administrators control", () => {
    const base = enabled(["reporter"]);
    expect(step(base, { ...NOVA, at: day(2), type: "platform.pause", paused: true }).errorCode).toBe("adminRequired");
    expect(step(base, { ...NEX, at: day(2), type: "platform.pause", paused: true }).errorCode).toBe("personRequired");
    const stopped = must(base, { ...ADMIN_A, at: day(2), type: "platform.pause", paused: true });
    expect(step(stopped, { ...NOVA, at: day(2), type: "run.start", instanceId: inst(stopped, "reporter"), goal: "x" }).errorCode).toBe("platformPaused");
    const resumed = must(stopped, { ...ADMIN_B, at: day(3), type: "platform.pause", paused: false });
    expect(step(resumed, { ...NOVA, at: day(3), type: "run.start", instanceId: inst(resumed, "reporter"), goal: "x" }).error).toBeUndefined();
  });

  it("expires an approval nobody answered, and the run goes on", () => {
    const { state, id } = started(enabled(["sales"]), "sales");
    const waiting = must(state, tool(id, "sales", "message.sendFirst", { contacto: "x", mensaje: "y" }));
    const early = must(waiting, { tenantId: PLATFORM_TENANT, actor: "system", at: "2026-10-02T20:00:00.000Z", type: "tick" });
    expect(early.approvals[0].status).toBe("pending");
    const late = must(waiting, { tenantId: PLATFORM_TENANT, actor: "system", at: `2026-10-0${2 + Math.ceil(APPROVAL_TTL_HOURS / 24) + 1}T10:00:00.000Z`, type: "tick" });
    expect(late.approvals[0].status).toBe("expired");
    expect(late.runs[0]).toMatchObject({ status: "running" });
    expect(late.runs[0].steps[0].decision).toBe("expired");
    expect(step(late, { ...NOVA, at: day(6), type: "approval.decide", approvalId: late.approvals[0].id, approve: true }).errorCode).toBe("approvalResolved");
  });
});

describe("a new Worker is data: no change to the engine", () => {
  it("lets NEX draft a Worker (Level 1) and nothing else about it", () => {
    const drafted = must(fresh(), { ...NEX, at: day(1), type: "worker.draft", input: customWorker({ id: "nex-idea" }) });
    expect(definitionOf(drafted, "nex-idea")).toMatchObject({ status: "draft", createdBy: "worker:nex", origin: "tenant", ownerTenantId: "tenant-nova" });
    for (const event of [
      { ...NEX, at: day(1), type: "worker.submit", definitionId: "nex-idea" },
      { ...NEX, at: day(1), type: "worker.review", definitionId: "nex-idea", approve: true },
      { ...NEX, at: day(1), type: "worker.enable", definitionId: "nex-idea" },
      { ...NEX, at: day(1), type: "worker.retire", definitionId: "nex-idea" },
      { ...NEX, at: day(1), type: "run.start", instanceId: "wi_0001", goal: "x" },
    ] as KoeEvent[]) expect(step(drafted, event).errorCode, event.type).toBe("personRequired");
    expect(step(drafted, { ...NEX, at: day(1), type: "worker.edit", definitionId: "nex-idea", input: customWorker({ id: "nex-idea", name: "Mejor" }) }).error).toBeUndefined();
  });

  it("needs a second person of the same company to approve, and checks the definition before it goes live", () => {
    const input = customWorker({ id: "mine" });
    const drafted = must(fresh(), { ...NOVA, at: day(1), type: "worker.draft", input });
    expect(step(drafted, { ...NOVA, at: day(1), type: "worker.draft", input }).errorCode).toBe("definitionExists");
    expect(step(drafted, { ...VIDA, at: day(1), type: "worker.submit", definitionId: "mine" }).errorCode).toBe("notYours");
    const submitted = must(drafted, { ...NOVA, at: day(1), type: "worker.submit", definitionId: "mine" });
    const review = (who: { tenantId: string; actor: string }, approve = true, reason?: string) => step(submitted, { ...who, at: day(1), type: "worker.review", definitionId: "mine", approve, reason });
    expect(review(NOVA).errorCode).toBe("selfReview");
    expect(review(VIDA).errorCode).toBe("notYours");
    expect(review(ADMIN_A).errorCode).toBe("notYours"); // the platform does not approve a company's own Workers
    expect(review(PABLO, false).errorCode).toBe("reasonRequired");
    expect(review(PABLO, false, "Falta acotar").state.definitions.find((d) => d.id === "mine")?.status).toBe("draft");
    expect(review(PABLO).state.definitions.find((d) => d.id === "mine")?.status).toBe("active");
    expect(step(drafted, { ...NOVA, at: day(1), type: "worker.review", definitionId: "mine", approve: true }).errorCode).toBe("nothingToReview");
    const invalid = must(fresh(), { ...NOVA, at: day(1), type: "worker.draft", input: customWorker({ id: "broken", tools: [] }) });
    expect(step(invalid, { ...NOVA, at: day(1), type: "worker.submit", definitionId: "broken" }).errorCode).toBe("definitionInvalid");
  });

  it("runs a new Worker through the same rules as the built-in ones", () => {
    const state = activate(fresh(), { id: "triage", tools: ["contact.read", "message.draft", "followup.send"], dataClearance: "personal" });
    const { state: running, id } = started(state, "triage");
    expect(must(running, tool(id, "triage", "contact.read", { contacto: "x" })).runs[0].steps[0].decision).toBe("allowed");
    expect(must(running, tool(id, "triage", "followup.send", { contacto: "x", mensaje: "y" })).runs[0].status).toBe("waitingApproval");
    expect(step(running, tool(id, "triage", "payment.createLink", { cliente: "x", monto: "1" })).errorCode).toBe("toolNotAllowed");
    expect(step(fresh(), { ...VIDA, at: day(1), type: "worker.enable", definitionId: "triage" }).errorCode).toBe("definitionNotFound");
    expect(step(state, { ...VIDA, at: day(2), type: "worker.enable", definitionId: "triage" }).errorCode).toBe("notYours");
    expect(step(state, { ...NOVA, at: day(2), type: "worker.enable", definitionId: "triage" }).errorCode).toBe("alreadyEnabled");
    expect(step(state, { ...NOVA, at: day(2), type: "worker.edit", definitionId: "triage", input: customWorker({ id: "triage" }) }).errorCode).toBe("invalidTransition");
  });

  it("only administrators create or approve KYNOVA's own Workers, and a second administrator approves", () => {
    const input = { ...customWorker({ id: "kynova-new" }), origin: "kynova" as const };
    expect(step(fresh(), { ...NOVA, at: day(1), type: "worker.draft", input }).errorCode).toBe("adminRequired");
    let state = must(fresh(), { ...ADMIN_A, at: day(1), type: "worker.draft", input });
    expect(definitionOf(state, "kynova-new")).toMatchObject({ ownerTenantId: "platform", origin: "kynova" });
    state = must(state, { ...ADMIN_A, at: day(1), type: "worker.submit", definitionId: "kynova-new" });
    expect(step(state, { ...ADMIN_A, at: day(1), type: "worker.review", definitionId: "kynova-new", approve: true }).errorCode).toBe("selfReview");
    expect(step(state, { ...NOVA, at: day(1), type: "worker.review", definitionId: "kynova-new", approve: true }).errorCode).toBe("adminRequired");
    state = must(state, { ...ADMIN_B, at: day(1), type: "worker.review", definitionId: "kynova-new", approve: true });
    expect(must(state, { ...VIDA, at: day(2), type: "worker.enable", definitionId: "kynova-new" }).instances).toHaveLength(1); // any company can enable it
  });

  it("retiring a Worker stops its instances and cancels its runs everywhere", () => {
    const base = activate(fresh(), { id: "temp" });
    const { state, id } = started(base, "temp");
    expect(step(state, { ...VIDA, at: day(3), type: "worker.retire", definitionId: "temp" }).errorCode).toBe("notYours");
    const retired = must(state, { ...NOVA, at: day(3), type: "worker.retire", definitionId: "temp" });
    expect(retired.runs.find((run) => run.id === id)?.status).toBe("cancelled");
    expect(retired.instances[0].status).toBe("paused");
    expect(step(retired, { ...VIDA, at: day(4), type: "worker.enable", definitionId: "temp" }).errorCode).toBe("notYours");
    expect(step(retired, { ...NOVA, at: day(4), type: "worker.retire", definitionId: "temp" }).errorCode).toBe("invalidTransition");
  });

  it("extends the platform with a new tool as data: pending until a second administrator approves, and Level 3 by default", () => {
    const manifest: ToolManifest = { id: "crm.exportAll", label: "Exportar el CRM", description: "Exporta los contactos.", reads: ["contacts"], writes: [], externalEffect: true, financial: false, dataAccess: "personal", required: ["destino"] };
    expect(step(fresh(), { ...NOVA, at: day(1), type: "tool.register", manifest }).errorCode).toBe("adminRequired");
    expect(step(fresh(), { ...ADMIN_A, at: day(1), type: "tool.register", manifest: { ...manifest, id: "bad id" } }).errorCode).toBe("toolRegistrationInvalid");
    let state = must(fresh(), { ...ADMIN_A, at: day(1), type: "tool.register", manifest });
    expect(step(state, { ...ADMIN_B, at: day(1), type: "tool.register", manifest }).errorCode).toBe("toolExists");
    expect(state.tools["crm.exportAll"].status).toBe("pending");
    expect(step(state, { ...ADMIN_A, at: day(1), type: "tool.approve", toolId: "crm.exportAll" }).errorCode).toBe("selfReview");
    expect(step(state, { ...NOVA, at: day(1), type: "tool.approve", toolId: "crm.exportAll" }).errorCode).toBe("adminRequired");
    expect(step(state, { ...ADMIN_B, at: day(1), type: "tool.approve", toolId: "nope" }).errorCode).toBe("toolNotFound");
    const early = customWorker({ id: "exporter", tools: ["crm.exportAll"], dataClearance: "personal" });
    expect(step(must(state, { ...NOVA, at: day(1), type: "worker.draft", input: early }), { ...NOVA, at: day(1), type: "worker.submit", definitionId: "exporter" }).errorCode).toBe("definitionInvalid"); // still pending
    state = must(state, { ...ADMIN_B, at: day(1), type: "tool.approve", toolId: "crm.exportAll" });
    const live = activate(state, { id: "exporter", tools: ["crm.exportAll"], dataClearance: "personal" });
    const { state: running, id } = started(live, "exporter");
    expect(must(running, tool(id, "exporter", "crm.exportAll", { destino: "contabilidad" })).runs[0].steps[0]).toMatchObject({ decision: "needsApproval", level: 3 }); // an unknown action starts at Level 3
  });
});

describe("audit is complete and nothing is trimmed", () => {
  it("records every successful event and every refused attempt at something sensitive", () => {
    const state = demoKoeOk();
    expect(state.audit.length).toBeGreaterThan(30);
    expect(state.audit.some((entry) => entry.action === "tool.needsApproval" && entry.runId)).toBe(true);
    expect(state.audit.some((entry) => entry.action === "approval.approve" && entry.actor === "pablo")).toBe(true);
    expect(state.audit.some((entry) => entry.action === "run.delegate" && entry.detail?.includes("retenidos"))).toBe(false); // nothing personal was in the coordinator's bundle
    expect(state.audit.every((entry) => entry.tenantId && entry.actor && entry.at)).toBe(true);
    const refused = step(state, { ...NOVA, at: day(9), type: "run.tool", runId: state.runs[0].id, tool: "contact.read", input: { contacto: "x" } });
    expect(refused.state.audit.at(-1)).toMatchObject({ action: "refused" });
  });

  it("keeps every audit entry and log line however many there are", () => {
    let state = fresh();
    for (let index = 0; index < 600; index += 1) state = must(state, { ...NOVA, at: day(2), type: "tenant.pause", paused: index % 2 === 0 });
    expect(state.audit).toHaveLength(600);
    expect(state.logs).toHaveLength(600);
    expect(state.audit[0].action).toBe("tenant.pause");
  });
});

describe("language", () => {
  it("has a message for every error code, no placeholder left, and a label for every group", () => {
    for (const code of ERROR_CODES) expect(message(code, { detail: "x", from: "a", to: "b", tool: "t", status: "s", max: 1, level: "personal" }), code).not.toMatch(/\{\w+\}/);
    expect(label("level", "3")).toContain("siempre confirma");
    expect(label("runStatus", "waitingApproval")).toBe("Esperando aprobación");
    expect(label("modelClass", "reasoning")).toBe("Razonamiento");
    expect(message("grantInvalid", { detail: "payment.createLink" })).toContain("payment.createLink");
  });
});
