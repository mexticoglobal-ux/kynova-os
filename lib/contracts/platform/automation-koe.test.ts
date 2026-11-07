import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { label, message } from "./automation-messages";
import {
  DEFAULT_KOE_ENV, automationStats, inputFromTemplate, isConfigured, needOf, reduceAutomations, validateAutomation,
  type AutomationEvent, type AutomationState, type AutomationTemplate, type KoeEnv, newAutomationState,
} from "./automation-center";
import { SAMPLE_PAYLOADS, action, blankInput, demoAutomationsOk } from "./automation-demo";
import { BASE_MODELS, BASE_TOOLS, STARTER_WORKERS, validateWorker, type ToolEntry, type WorkerDefinition } from "./koe-registry";
import { levelForAction } from "./workers";

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T10:00:00.000Z`;
const NOVA = { tenantId: "tenant-nova", actor: "ana" };
const VIDA = { tenantId: "tenant-vida", actor: "lucia" };
const NEX = { tenantId: "tenant-nova", actor: "worker:nex" };
const SYSTEM = { tenantId: "tenant-nova", actor: "system" };
const automator = STARTER_WORKERS.find((item) => item.id === "automator") as WorkerDefinition;
const withWorkers = (workers: readonly WorkerDefinition[], models = BASE_MODELS): KoeEnv => ({ workers, models });

const step = (state: AutomationState, event: AutomationEvent, env?: KoeEnv) => reduceAutomations(state, event, env);
const must = (state: AutomationState, event: AutomationEvent, env?: KoeEnv): AutomationState => {
  const result = reduceAutomations(state, event, env);
  expect(result.error, event.type).toBeUndefined();
  return result.state;
};
const made = (input = blankInput(), who = NOVA, state = newAutomationState(), env?: KoeEnv) => {
  const next = must(state, { ...who, at: day(1), type: "automation.create", input }, env);
  return { state: next, id: next.automations.at(-1)?.id ?? "" };
};
const live = (input = blankInput(), who = NOVA, state = newAutomationState(), env?: KoeEnv) => {
  const base = made(input, who, state, env);
  const active = must(base.state, { ...who, at: day(1), type: "automation.activate", automationId: base.id }, env);
  return { state: must(active, { ...who, at: day(1), type: "automation.setTestMode", automationId: base.id, testMode: false }, env), id: base.id };
};
const newClient = (over = {}) => blankInput({ name: "Cliente nuevo", trigger: "newClient", actions: [action("createTask", { titulo: "Revisar a {{nombre}}" })], ...over });
const fire = (state: AutomationState, env?: KoeEnv, at = day(5)) => must(state, { ...SYSTEM, at, type: "trigger.fire", kind: "newClient", payload: SAMPLE_PAYLOADS.newClient }, env);

describe("every automation is carried out by a Worker", () => {
  it("is 'Configuración pendiente' without a Worker, and cannot be activated, tested or put live", () => {
    const pending = made(newClient({ workerId: undefined }));
    expect(pending.state.automations[0].status).toBe("setupPending");
    expect(label("status", "setupPending")).toBe("Configuración pendiente");
    for (const event of [
      { ...NOVA, at: day(2), type: "automation.activate", automationId: pending.id },
      { ...NOVA, at: day(2), type: "automation.setTestMode", automationId: pending.id, testMode: false },
      { ...NOVA, at: day(2), type: "automation.test", automationId: pending.id, payload: SAMPLE_PAYLOADS.newClient },
    ] as AutomationEvent[]) {
      const result = step(pending.state, event);
      expect(result.errorCode, event.type).toBe("workerRequired");
      expect(result.error).toContain("Asigne un Worker");
    }
    expect(step(pending.state, { ...NOVA, at: day(2), type: "automation.pause", automationId: pending.id }).errorCode).toBe("invalidTransition");
    expect(must(pending.state, { ...NOVA, at: day(2), type: "automation.setTestMode", automationId: pending.id, testMode: true }).automations[0].testMode).toBe(true);
    expect(message("workerRequired")).toContain("Worker");
  });

  it("leaves that state when a person assigns a usable Worker, and goes back to it when the Worker is removed", () => {
    const pending = made(newClient({ workerId: undefined }));
    const assigned = must(pending.state, { ...NOVA, at: day(2), type: "automation.edit", automationId: pending.id, input: newClient({ workerId: "automator" }) });
    expect(assigned.automations[0]).toMatchObject({ status: "draft", workerId: "automator", version: 2 });
    const active = must(assigned, { ...NOVA, at: day(3), type: "automation.activate", automationId: pending.id });
    const removed = must(active, { ...NOVA, at: day(4), type: "automation.edit", automationId: pending.id, input: newClient({ workerId: undefined }) });
    expect(removed.automations[0]).toMatchObject({ status: "setupPending", workerId: undefined });
    expect(step(removed, { ...NOVA, at: day(5), type: "automation.activate", automationId: pending.id }).errorCode).toBe("workerRequired");
    expect(fire(removed).runs).toHaveLength(0); // it does not run
  });

  it("treats a Worker that cannot do the job as no Worker: unknown, without the tool, or without clearance for contact data", () => {
    expect(made(newClient({ workerId: "nadie" })).state.automations[0].status).toBe("setupPending");
    const reporter = made(newClient({ workerId: "reporter" })); // cannot create tasks
    expect(reporter.state.automations[0].status).toBe("setupPending");
    expect(validateAutomation(newClient({ workerId: "reporter" }))[0]).toContain("no tiene la herramienta «task.create»");
    const draftsOnly = blankInput({ trigger: "newClient", actions: [action("prepareEmail", { para: "{{correo}}", asunto: "Hola", cuerpo: "Hola {{nombre}}" })] });
    const businessOnly: WorkerDefinition = { ...automator, id: "automator-business", dataClearance: "business" };
    const env = withWorkers([...STARTER_WORKERS, businessOnly]);
    expect(validateAutomation({ ...draftsOnly, workerId: "automator-business" }, env)[0]).toContain("no puede manejar datos de contacto");
    expect(validateAutomation({ ...draftsOnly, workerId: "automator" }, env)).toEqual([]);
    expect(isConfigured({ ...draftsOnly, workerId: "automator-business" }, env)).toBe(false);
    expect(needOf(draftsOnly)).toEqual({ tools: ["message.draft"], clearance: "personal" });
    expect(needOf(newClient())).toEqual({ tools: ["task.create"], clearance: "business" });
  });

  it("only offers a company its own Workers and KYNOVA's", () => {
    const vidaOnly: WorkerDefinition = { ...automator, id: "vida-automator", ownerTenantId: "tenant-vida", origin: "tenant" };
    const env = withWorkers([...STARTER_WORKERS, vidaOnly]);
    expect(made(newClient({ workerId: "vida-automator" }), NOVA, newAutomationState(), env).state.automations[0].status).toBe("setupPending");
    expect(made(newClient({ workerId: "vida-automator" }), VIDA, newAutomationState(), env).state.automations[0].status).toBe("draft");
    const retired: WorkerDefinition = { ...automator, id: "old-automator", status: "retired" };
    expect(validateAutomation(newClient({ workerId: "old-automator" }), withWorkers([...STARTER_WORKERS, retired]), "tenant-nova")[0]).toContain("no está activo");
  });

  it("lets NEX leave a draft with or without a Worker, and the choice is the same", () => {
    expect(made(newClient(), NEX).state.automations[0].status).toBe("draft");
    expect(made(newClient({ workerId: undefined }), NEX).state.automations[0].status).toBe("setupPending");
  });

  it("duplicates with the same Worker, or waits for one", () => {
    const withWorker = made(newClient());
    const copy = must(withWorker.state, { ...NOVA, at: day(2), type: "automation.duplicate", automationId: withWorker.id });
    expect(copy.automations[1]).toMatchObject({ status: "draft", workerId: "automator" });
    const without = made(newClient({ workerId: undefined }));
    expect(must(without.state, { ...NOVA, at: day(2), type: "automation.duplicate", automationId: without.id }).automations[1].status).toBe("setupPending");
  });
});

describe("KOE decides the model; the automation never does", () => {
  it("records the Worker, its priority and estimated cost, and the model KOE's router chose", () => {
    const state = fire(live(newClient()).state);
    expect(state.runs[0]).toMatchObject({ status: "completed", workerId: "automator", workerName: "Automatizador", priority: "normal", estimatedCostMicros: 500, model: { id: "m-fast-a", provider: "proveedor-a" } });
    expect(state.runs[0].modelReason).toBe("Rápido A");
    expect(state.audit.some((entry) => entry.detail?.includes("Automatizador"))).toBe(true);
  });

  it("follows the router when a model is unhealthy: it falls back, and says so", () => {
    const down = BASE_MODELS.map((model) => (model.id === "m-fast-a" ? { ...model, health: "down" as const } : model));
    const fastB = { ...BASE_MODELS[0], id: "m-fast-b", label: "Rápido B", provider: "proveedor-b", costMicrosPer1k: 400 };
    const state = fire(live(newClient(), NOVA, newAutomationState(), withWorkers(STARTER_WORKERS, [...down, fastB])).state, withWorkers(STARTER_WORKERS, [...down, fastB]));
    expect(state.runs[0].model?.id).toBe("m-fast-b");
    expect(state.runs[0].modelReason).toContain("respaldo");
  });

  it("does nothing, and says why, when KOE has no model for the Worker", () => {
    const active = live(newClient()).state;
    const none = withWorkers(STARTER_WORKERS, BASE_MODELS.map((model) => ({ ...model, enabled: false })));
    const state = fire(active, none);
    expect(state.runs[0]).toMatchObject({ status: "skipped", estimatedCostMicros: 0 });
    expect(state.runs[0].reason).toContain("Configuración pendiente: KOE no encontró un modelo");
    expect(state.outputs).toHaveLength(0);
    expect(state.automations[0].runCount).toBe(0);
    expect(step(made(newClient()).state, { ...NOVA, at: day(2), type: "automation.activate", automationId: "au_0001" }, none).errorCode).toBe("invalid"); // it cannot be activated either
  });

  it("does nothing when the Worker of a live automation is retired afterwards", () => {
    const active = live(newClient()).state;
    const retired = withWorkers(STARTER_WORKERS.map((item) => (item.id === "automator" ? { ...item, status: "retired" as const } : item)));
    const state = fire(active, retired);
    expect(state.runs[0]).toMatchObject({ status: "skipped" });
    expect(state.runs[0].reason).toContain("no está activo");
    expect(state.outputs).toHaveLength(0);
  });

  it("runs a Critical Worker's automation before a Low one's, whatever order they were created in", () => {
    const low: WorkerDefinition = { ...automator, id: "automator-low", name: "Automatizador bajo", priority: "low" };
    const critical: WorkerDefinition = { ...automator, id: "automator-critical", name: "Automatizador crítico", priority: "critical" };
    const env = withWorkers([...STARTER_WORKERS, low, critical]);
    const first = live(newClient({ name: "Primero (bajo)", workerId: "automator-low" }), NOVA, newAutomationState(), env);
    const second = live(newClient({ name: "Segundo (crítico)", workerId: "automator-critical" }), NOVA, first.state, env);
    const third = live(newClient({ name: "Tercero (normal)" }), NOVA, second.state, env);
    const state = fire(third.state, env);
    expect(state.runs.map((run) => run.automationName)).toEqual(["Segundo (crítico)", "Tercero (normal)", "Primero (bajo)"]);
    expect(state.runs.map((run) => run.priority)).toEqual(["critical", "normal", "low"]);
  });

  it("adds up the estimated cost of the live runs only, and calls it an estimate", () => {
    const state = demoAutomationsOk();
    const nova = automationStats(state, "tenant-nova");
    const liveRuns = state.runs.filter((run) => run.tenantId === "tenant-nova" && run.mode === "live");
    expect(liveRuns.length).toBeGreaterThan(0);
    expect(nova.estimatedCostMicros).toBe(liveRuns.length * 500);
    expect(state.runs.filter((run) => run.mode === "test").every((run) => run.estimatedCostMicros === 500)).toBe(true); // shown for a test, but not counted
    expect(automationStats(newAutomationState(), "tenant-nova").estimatedCostMicros).toBe(0);
  });

  it("is built on KOE's registry: the Automator is a Worker like the others, and everything it can do is Level 1", () => {
    const tools = Object.fromEntries(BASE_TOOLS.map((manifest) => [manifest.id, { manifest, status: "active", registeredBy: "kynova" } satisfies ToolEntry]));
    expect(validateWorker(automator, tools)).toEqual([]);
    expect(DEFAULT_KOE_ENV.workers.some((item) => item.id === "automator")).toBe(true);
    for (const tool of automator.tools) { expect(levelForAction(tool), tool).toBe(1); expect(tools[tool].manifest.externalEffect, tool).toBe(false); }
    expect(automator.dataClearance).toBe("personal");
  });

  it("never reaches a model or the network from the automation modules", () => {
    const dir = __dirname;
    const files = readdirSync(dir).filter((name) => name.startsWith("automation-") && name.endsWith(".ts") && !name.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const name of files) {
      const source = readFileSync(join(dir, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, ""); // code only, not comments
      expect(source, name).not.toMatch(/lib\/ai|from "@\/lib\/ai|fetch\(|XMLHttpRequest|process\.env|import\(/);
    }
  });
});

describe("prepared for a future Automations Library (templates), which does not exist yet", () => {
  const template: AutomationTemplate = {
    id: "welcome-client", version: 3, name: "Bienvenida", description: "Da la bienvenida a un cliente nuevo.", trigger: "newClient", conditions: [],
    actions: [action("createTask", { titulo: "Dar la bienvenida a {{nombre}}" })],
  };

  it("makes an input from a template, remembering where it came from, and the Worker is still chosen by the company", () => {
    expect(inputFromTemplate(template).workerId).toBeUndefined();
    const input = inputFromTemplate(template, "automator");
    expect(input).toMatchObject({ name: "Bienvenida", workerId: "automator", source: { templateId: "welcome-client", templateVersion: 3 } });
    expect(made(inputFromTemplate(template)).state.automations[0].status).toBe("setupPending"); // a template carries no Worker
    expect(made(input).state.automations[0]).toMatchObject({ status: "draft", testMode: true, source: { templateId: "welcome-client", templateVersion: 3 } });
  });

  it("keeps the origin when edited or duplicated, and ignores a malformed one", () => {
    const base = made(inputFromTemplate(template, "automator"));
    const edited = must(base.state, { ...NOVA, at: day(2), type: "automation.edit", automationId: base.id, input: { ...inputFromTemplate(template, "automator"), name: "Bienvenida editada", source: { templateId: "otra", templateVersion: 9 } } });
    expect(edited.automations[0].source).toEqual({ templateId: "welcome-client", templateVersion: 3 }); // the origin is not rewritable by an edit
    const copy = must(edited, { ...NOVA, at: day(3), type: "automation.duplicate", automationId: base.id });
    expect(copy.automations[1].source).toEqual({ templateId: "welcome-client", templateVersion: 3 });
    expect(made({ ...blankInput(), source: { templateId: "", templateVersion: 1 } }).state.automations[0].source).toBeUndefined();
    expect(made({ ...blankInput(), source: { templateId: "x", templateVersion: 1.5 } }).state.automations[0].source).toBeUndefined();
  });

  it("does not ship any template yet", () => {
    const source = readFileSync(join(__dirname, "automation-center.ts"), "utf8") + readFileSync(join(__dirname, "automation-demo.ts"), "utf8");
    expect(source).not.toMatch(/AUTOMATION_TEMPLATES|TEMPLATE_LIBRARY|const TEMPLATES/);
  });
});
