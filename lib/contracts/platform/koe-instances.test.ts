import { describe, expect, it } from "vitest";
import { demoKoeOk, customWorker } from "./koe-demo";
import { instanceFor, newKoeState, reduceKoe, workerActor, type KoeEvent, type KoeState } from "./koe-engine";
import { BASE_MODELS, STARTER_WORKERS, modelAvailability, type WorkerDefinition } from "./koe-registry";

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T10:00:00.000Z`;
const NOVA = { tenantId: "tenant-nova", actor: "ana" };
const PABLO = { tenantId: "tenant-nova", actor: "pablo" };
const VIDA = { tenantId: "tenant-vida", actor: "lucia" };
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
const started = (state: KoeState, definitionId: string, who = NOVA, at = day(2)) => {
  const next = must(state, { ...who, at, type: "run.start", instanceId: inst(state, definitionId, who.tenantId), goal: "Objetivo" });
  return { state: next, id: next.runs.at(-1)?.id ?? "" };
};
const starter = (id: string): WorkerDefinition => {
  const found = STARTER_WORKERS.find((item) => item.id === id);
  if (!found) throw new Error(`unknown starter worker: ${id}`);
  return found;
};

describe("which models a Worker may use", () => {
  const usable = (id: string, excluded: string[] = [], models = BASE_MODELS) => modelAvailability(models, starter(id), excluded).filter((entry) => entry.usable).map((entry) => entry.model.id);

  it("judges each Worker against what it needs and the most sensitive data it may handle", () => {
    expect(usable("sales")).toEqual(["m-fast-a"]); // personal data: a fast model that does not train on it
    expect(usable("collections")).toEqual(["m-fast-a"]);
    expect(usable("reporter")).toEqual(["m-reason-b", "m-reason-c"]); // business data: "unknown" policy is acceptable, "may train" is not
    expect(usable("coordinator")).toEqual(["m-reason-b", "m-reason-c"]);
  });

  it("explains why a model is out, and ignores health (eligibility is not availability)", () => {
    const sales = modelAvailability(BASE_MODELS, starter("sales"));
    expect(sales.find((entry) => entry.model.id === "m-vision-d")?.reasons.join()).toContain("no admite herramientas");
    expect(sales.find((entry) => entry.model.id === "m-reason-b")?.reasons.join()).toContain("le falta");
    const down = BASE_MODELS.map((model) => (model.id === "m-fast-a" ? { ...model, health: "down" as const } : model));
    expect(usable("sales", [], down)).toEqual(["m-fast-a"]);
    const off = BASE_MODELS.map((model) => (model.id === "m-fast-a" ? { ...model, enabled: false } : model));
    expect(usable("sales", [], off)).toEqual([]);
  });

  it("adds a company's exclusions to the Worker's own policy", () => {
    expect(usable("reporter", ["proveedor-c"])).toEqual(["m-reason-b"]);
    expect(usable("reporter", ["proveedor-b", "proveedor-c"])).toEqual([]);
    const strict: WorkerDefinition = { ...starter("reporter"), routing: { needs: ["reasoning"], policy: { deniedProviders: ["proveedor-b"] } } };
    expect(modelAvailability(BASE_MODELS, strict, ["proveedor-c"]).some((entry) => entry.usable)).toBe(false);
  });
});

describe("a Worker's status in a company: active, paused or disabled", () => {
  it("pauses and resumes only in the right order", () => {
    const base = enabled(["reporter"]);
    const id = inst(base, "reporter");
    expect(step(base, { ...NOVA, at: day(2), type: "instance.resume", instanceId: id }).errorCode).toBe("invalidTransition"); // already active
    const paused = must(base, { ...NOVA, at: day(2), type: "instance.pause", instanceId: id });
    expect(step(paused, { ...NOVA, at: day(2), type: "instance.pause", instanceId: id }).errorCode).toBe("invalidTransition");
    expect(step(paused, { ...NOVA, at: day(2), type: "run.start", instanceId: id, goal: "x" }).errorCode).toBe("instancePaused");
    expect(must(paused, { ...NOVA, at: day(3), type: "instance.resume", instanceId: id }).instances[0].status).toBe("active");
  });

  it("disables a Worker: nothing can start, live runs and what they delegated are cancelled, pending approvals are rejected", () => {
    const base = enabled(["coordinator", "sales", "followup"]);
    const root = started(base, "coordinator");
    const delegated = must(root.state, { ...W("coordinator"), at: day(2), type: "run.delegate", runId: root.id, toWorker: "sales", goal: "Parte", grant: ["lead.score"], contextKeys: [] });
    const waiting = started(delegated, "followup");
    const asked = must(waiting.state, { ...W("followup"), at: day(2), type: "run.tool", runId: waiting.id, tool: "followup.send", input: { contacto: "x", mensaje: "y" } });
    expect(asked.approvals).toHaveLength(1);

    const off = must(asked, { ...PABLO, at: day(3), type: "instance.disable", instanceId: inst(asked, "coordinator") });
    expect(off.instances.find((item) => item.definitionId === "coordinator")?.status).toBe("disabled");
    expect(off.runs.find((run) => run.id === root.id)?.status).toBe("cancelled");
    expect(off.runs.find((run) => run.workerId === "sales")?.status).toBe("cancelled"); // what it delegated stops too
    expect(off.runs.find((run) => run.id === waiting.id)?.status).toBe("waitingApproval"); // another Worker is not affected
    expect(off.audit.at(-1)).toMatchObject({ action: "instance.disable" });
    expect(step(off, { ...NOVA, at: day(3), type: "run.start", instanceId: inst(off, "coordinator"), goal: "x" }).errorCode).toBe("instanceDisabled");
    expect(step(off, { ...W("coordinator"), at: day(3), type: "run.model", runId: root.id }).errorCode).toBe("runNotRunning"); // its run was cancelled

    const followupOff = must(asked, { ...NOVA, at: day(3), type: "instance.disable", instanceId: inst(asked, "followup") });
    expect(followupOff.approvals[0]).toMatchObject({ status: "rejected", reason: "Worker deshabilitado" });
    expect(followupOff.audit.at(-1)?.detail).toContain("ejecuciones canceladas");
  });

  it("is switched on again only by a person, and neither pause nor resume gets around it", () => {
    const base = enabled(["reporter"]);
    const id = inst(base, "reporter");
    const off = must(base, { ...NOVA, at: day(2), type: "instance.disable", instanceId: id });
    expect(step(off, { ...NOVA, at: day(2), type: "instance.disable", instanceId: id }).errorCode).toBe("invalidTransition");
    expect(step(off, { ...NOVA, at: day(2), type: "instance.resume", instanceId: id }).errorCode).toBe("invalidTransition"); // resume is for paused ones
    expect(step(off, { ...NOVA, at: day(2), type: "instance.pause", instanceId: id }).errorCode).toBe("invalidTransition");
    expect(step(off, { ...NEX, at: day(2), type: "instance.enable", instanceId: id }).errorCode).toBe("personRequired");
    expect(step(off, { ...VIDA, at: day(2), type: "instance.enable", instanceId: id }).errorCode).toBe("notYours");
    expect(step(base, { ...NOVA, at: day(2), type: "instance.enable", instanceId: id }).errorCode).toBe("invalidTransition"); // it was not disabled
    const on = must(off, { ...PABLO, at: day(3), type: "instance.enable", instanceId: id });
    expect(on.instances[0].status).toBe("active");
    expect(step(on, { ...NOVA, at: day(3), type: "run.start", instanceId: id, goal: "x" }).error).toBeUndefined();
  });

  it("cannot be enabled again once its definition was retired, and a person only disables their own company's", () => {
    const custom = customWorker({ id: "temp" });
    let state = must(fresh(), { ...NOVA, at: day(1), type: "worker.draft", input: custom });
    state = must(state, { ...NOVA, at: day(1), type: "worker.submit", definitionId: "temp" });
    state = must(state, { ...PABLO, at: day(1), type: "worker.review", definitionId: "temp", approve: true });
    state = must(state, { ...NOVA, at: day(1), type: "worker.enable", definitionId: "temp" });
    const id = inst(state, "temp");
    expect(step(state, { ...VIDA, at: day(2), type: "instance.disable", instanceId: id }).errorCode).toBe("notYours");
    const retired = must(must(state, { ...NOVA, at: day(2), type: "instance.disable", instanceId: id }), { ...NOVA, at: day(3), type: "worker.retire", definitionId: "temp" });
    expect(retired.instances[0].status).toBe("disabled"); // retiring does not turn a switched-off instance into a paused one
    expect(step(retired, { ...NOVA, at: day(4), type: "instance.enable", instanceId: id }).errorCode).toBe("notActive");
    expect(step(fresh(), { ...NOVA, at: day(1), type: "instance.disable", instanceId: "wi_9999" }).errorCode).toBe("instanceNotFound");
  });
});

describe("configuration per company", () => {
  it("lets a company lower a Worker's daily runs, never raise them above the definition", () => {
    const base = enabled(["reporter"]);
    const id = inst(base, "reporter");
    const configure = (over: Partial<Extract<KoeEvent, { type: "instance.configure" }>> = {}, who: { tenantId: string; actor: string } = NOVA) => step(base, { ...who, at: day(2), type: "instance.configure", instanceId: id, maxRunsPerDay: 1, deniedProviders: [], ...over });
    expect(configure({ maxRunsPerDay: 0 }).errorCode).toBe("configInvalid");
    expect(configure({ maxRunsPerDay: starter("reporter").limits.maxRunsPerDay + 1 }).errorCode).toBe("configInvalid");
    expect(configure({ maxRunsPerDay: 1.5 }).errorCode).toBe("configInvalid");
    expect(configure({ deniedProviders: ["proveedor-inventado"] }).errorCode).toBe("configInvalid");
    expect(configure({}, NEX).errorCode).toBe("personRequired");
    expect(configure({}, VIDA).errorCode).toBe("notYours");
    const limited = must(base, { ...NOVA, at: day(2), type: "instance.configure", instanceId: id, maxRunsPerDay: 1, deniedProviders: [] });
    const first = must(limited, { ...NOVA, at: day(2), type: "run.start", instanceId: id, goal: "uno" });
    expect(step(first, { ...NOVA, at: day(2), type: "run.start", instanceId: id, goal: "dos" }).errorCode).toBe("dailyRunLimit");
    expect(step(first, { ...NOVA, at: day(3), type: "run.start", instanceId: id, goal: "otro día" }).error).toBeUndefined();
  });

  it("keeps one company's configuration from touching another's Worker", () => {
    const both = enabled(["reporter"], VIDA, enabled(["reporter"]));
    const novaId = inst(both, "reporter");
    const vidaId = inst(both, "reporter", "tenant-vida");
    const configured = must(both, { ...NOVA, at: day(2), type: "instance.configure", instanceId: novaId, maxRunsPerDay: 2, deniedProviders: ["proveedor-c"] });
    expect(configured.instances.find((item) => item.id === vidaId)).toMatchObject({ maxRunsPerDay: starter("reporter").limits.maxRunsPerDay, deniedProviders: [] });
    expect(step(configured, { ...VIDA, at: day(2), type: "instance.configure", instanceId: novaId, maxRunsPerDay: 1, deniedProviders: [] }).errorCode).toBe("notYours");
  });

  it("applies a company's excluded providers to the model KOE picks, on top of the Worker's own policy", () => {
    const base = enabled(["reporter"]);
    const id = inst(base, "reporter");
    const run = started(base, "reporter");
    const pick = (state: KoeState) => step(state, { ...W("reporter"), at: day(2), type: "run.model", runId: run.id });
    expect(pick(run.state).state.runs[0].steps[0].modelId).toBe("m-reason-c"); // cheapest that qualifies
    const noC = must(run.state, { ...NOVA, at: day(2), type: "instance.configure", instanceId: id, maxRunsPerDay: 10, deniedProviders: ["proveedor-c"] });
    expect(pick(noC).state.runs[0].steps[0].modelId).toBe("m-reason-b");
    const noBoth = must(run.state, { ...NOVA, at: day(2), type: "instance.configure", instanceId: id, maxRunsPerDay: 10, deniedProviders: ["proveedor-b", "proveedor-c"] });
    const none = pick(noBoth);
    expect(none.errorCode).toBe("noModel");
    expect(none.state.audit.at(-1)?.action).toBe("model.none");
  });
});

describe("the sample shows a Worker that was installed and switched off, and one configured by its company", () => {
  it("has a disabled tutor and a limited sales assistant in Nova", () => {
    const state = demoKoeOk();
    expect(state.instances.find((item) => item.tenantId === "tenant-nova" && item.definitionId === "tutor")?.status).toBe("disabled");
    expect(state.instances.find((item) => item.tenantId === "tenant-nova" && item.definitionId === "sales")).toMatchObject({ maxRunsPerDay: 20, deniedProviders: ["proveedor-d"] });
    expect(state.instances.filter((item) => item.tenantId === "tenant-vida").map((item) => item.definitionId)).toEqual(["reporter"]);
  });
});
