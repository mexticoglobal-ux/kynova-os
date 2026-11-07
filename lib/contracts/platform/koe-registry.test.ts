import { describe, expect, it } from "vitest";
import {
  BASE_MODELS, BASE_TOOLS, STARTER_WORKERS, autonomyOf, covers, looksSecret, rejections, routeModel, toolLevel, validateModel, validateTool, validateWorker,
  type ModelManifest, type TaskProfile, type ToolEntry, type ToolManifest, type WorkerDefinition,
} from "./koe-registry";
import { customWorker } from "./koe-demo";

const tools: Record<string, ToolEntry> = Object.fromEntries(BASE_TOOLS.map((manifest) => [manifest.id, { manifest, status: "active", registeredBy: "kynova" } satisfies ToolEntry]));
const task = (over: Partial<TaskProfile> = {}): TaskProfile => ({ needs: ["fast"], dataClearance: "business", contextTokens: 1_000, needsTools: true, ...over });
const definition = (over: Partial<WorkerDefinition> = {}): WorkerDefinition => ({ ...customWorker(), ownerTenantId: "tenant-nova", origin: "tenant", status: "draft", createdBy: "ana", ...over } as WorkerDefinition);
const toolOf = (id: string): ToolManifest => {
  const found = BASE_TOOLS.find((item) => item.id === id);
  if (!found) throw new Error(`unknown base tool: ${id}`);
  return found;
};
const starter = (id: string): WorkerDefinition => {
  const found = STARTER_WORKERS.find((item) => item.id === id);
  if (!found) throw new Error(`unknown starter worker: ${id}`);
  return found;
};
const withHealth = (id: string, over: Partial<ModelManifest>) => BASE_MODELS.map((model) => (model.id === id ? { ...model, ...over } : model));

describe("tools carry their autonomy level from the single catalog", () => {
  it("accepts the base tools, and the level of each comes from the catalog", () => {
    for (const manifest of BASE_TOOLS) expect(validateTool(manifest), manifest.id).toEqual([]);
    expect(toolLevel({ id: "contact.read" })).toBe(1);
    expect(toolLevel({ id: "faq.answer" })).toBe(2);
    expect(toolLevel({ id: "followup.send" })).toBe(3);
  });

  it("makes an unknown tool Level 3, so a new tool can never start with more freedom than a person would give it", () => {
    const fresh: ToolManifest = { id: "crm.exportEverything", label: "Exportar", description: "Exporta datos.", reads: ["contacts"], writes: [], externalEffect: true, financial: false, dataAccess: "personal", required: [] };
    expect(validateTool(fresh)).toEqual([]);
    expect(toolLevel(fresh)).toBe(3);
  });

  it("rejects a tool that claims to act outside or move money while its action is a lower level", () => {
    const external = { ...toolOf("task.create"), externalEffect: true };
    expect(validateTool(external)[0]).toContain("Nivel 3");
    const money = { ...toolOf("payment.createLink"), externalEffect: false };
    expect(validateTool(money)[0]).toContain("dinero");
    expect(validateTool({ ...BASE_TOOLS[0], id: "bad id" })[0]).toContain("identificador");
    expect(validateTool({ ...BASE_TOOLS[0], label: " " })[0]).toContain("nombre");
  });
});

describe("the model router chooses by capability, policy and health, never by vendor", () => {
  it("picks the cheapest healthy model that has what the task needs", () => {
    expect(routeModel(BASE_MODELS, task()).chosen?.id).toBe("m-fast-a");
    expect(routeModel(BASE_MODELS, task({ needs: ["reasoning"] })).chosen?.id).toBe("m-reason-c"); // cheaper than B, allowed for business data
    expect(routeModel(BASE_MODELS, task({ needs: ["code"] })).chosen?.id).toBe("m-reason-b");
    expect(routeModel(BASE_MODELS, task({ needs: ["embedding"], needsTools: false })).chosen?.id).toBe("m-embed-a");
  });

  it("treats the data policy as a hard rule: personal data only goes to a model that does not train on it", () => {
    expect(routeModel(BASE_MODELS, task({ needs: ["reasoning"], dataClearance: "personal" })).chosen?.id).toBe("m-reason-b");
    const mayTrain = withHealth("m-reason-b", { dataPolicy: "mayTrain" });
    expect(routeModel(mayTrain, task({ needs: ["reasoning"], dataClearance: "personal" })).chosen).toBeNull();
    expect(routeModel(mayTrain, task({ needs: ["reasoning"], dataClearance: "business" })).chosen?.id).toBe("m-reason-c"); // business data refuses "may train" but accepts "unknown"
    expect(rejections(mayTrain[1], task({ needs: ["reasoning"], dataClearance: "business" }), {}).join()).toContain("entrenar");
    expect(routeModel(mayTrain, task({ needs: ["reasoning"], dataClearance: "public" })).chosen?.id).toBe("m-reason-c");
  });

  it("filters by tools, context size, region, and by what the company allows or excludes", () => {
    expect(routeModel(BASE_MODELS, task({ needs: ["vision"], needsTools: true })).chosen).toBeNull(); // the vision model has no tool use
    expect(routeModel(BASE_MODELS, task({ needs: ["vision"], needsTools: false })).chosen?.id).toBe("m-vision-d");
    expect(routeModel(BASE_MODELS, task({ needs: ["reasoning"], contextTokens: 150_000 })).chosen?.id).toBe("m-reason-b");
    expect(routeModel(BASE_MODELS, task({ needs: ["reasoning"], region: "eu" })).chosen?.id).toBe("m-reason-c");
    expect(routeModel(BASE_MODELS, task({ needs: ["reasoning"], region: "us" })).chosen?.id).toBe("m-reason-b");
    expect(routeModel(BASE_MODELS, task({ needs: ["reasoning"] }), { deniedProviders: ["proveedor-c"] }).chosen?.id).toBe("m-reason-b");
    expect(routeModel(BASE_MODELS, task({ needs: ["reasoning"] }), { allowedProviders: ["proveedor-b"] }).chosen?.id).toBe("m-reason-b");
    expect(routeModel(BASE_MODELS, task({ needs: ["reasoning"] }), { maxCostMicrosPer1k: 100 }).chosen).toBeNull();
  });

  it("falls back when the preferred model is down, says so, and prefers healthy over degraded", () => {
    const down = withHealth("m-fast-a", { health: "down" });
    const noFast = routeModel(down, task({ needs: ["fast"], needsTools: false }));
    expect(noFast.chosen?.id).toBe("m-vision-d");
    expect(noFast.fallbackUsed).toBe(true);
    expect(noFast.reason).toContain("respaldo");
    expect(routeModel(BASE_MODELS, task()).fallbackUsed).toBe(false);
    const degraded = withHealth("m-reason-c", { health: "degraded" });
    expect(routeModel(degraded, task({ needs: ["reasoning"] })).chosen?.id).toBe("m-reason-b"); // healthy beats a cheaper degraded one
    expect(routeModel(withHealth("m-reason-b", { health: "down" }).map((m) => (m.id === "m-reason-c" ? { ...m, health: "degraded" as const } : m)), task({ needs: ["reasoning"] })).chosen?.id).toBe("m-reason-c"); // degraded is still better than nothing
  });

  it("skips disabled models and explains why nothing fits", () => {
    const none = routeModel(withHealth("m-embed-a", { enabled: false }), task({ needs: ["embedding"], needsTools: false }));
    expect(none.chosen).toBeNull();
    expect(none.reason).toContain("desactivado");
    expect(none.candidates.find((c) => c.model.id === "m-embed-a")?.reasons).toContain("desactivado");
  });

  it("routes to a model from a brand-new provider with no change to the router, and breaks ties by id", () => {
    const newcomer: ModelManifest = { id: "m-fast-e", provider: "proveedor-e", label: "Rápido E", classes: ["fast"], maxContextTokens: 32_000, costMicrosPer1k: 100, dataPolicy: "noTraining", regions: ["us"], supportsTools: true, health: "healthy", enabled: true };
    expect(validateModel(newcomer)).toEqual([]);
    expect(routeModel([...BASE_MODELS, newcomer], task()).chosen?.id).toBe("m-fast-e");
    const twin = { ...newcomer, id: "m-fast-d" };
    expect(routeModel([...BASE_MODELS, newcomer, twin], task()).chosen?.id).toBe("m-fast-d");
    expect(covers("personal", "business")).toBe(true);
    expect(covers("business", "personal")).toBe(false);
  });

  it("validates a model manifest", () => {
    const base = BASE_MODELS[0];
    expect(validateModel({ ...base, id: "Bad Id" })[0]).toContain("identificador");
    expect(validateModel({ ...base, classes: [] })[0]).toContain("capacidades");
    expect(validateModel({ ...base, maxContextTokens: 10 })[0]).toContain("contexto");
    expect(validateModel({ ...base, costMicrosPer1k: -1 })[0]).toContain("costo");
    expect(validateModel({ ...base, regions: [] })[0]).toContain("regiones");
  });
});

describe("a Worker is data: definitions and their validation", () => {
  it("ships KYNOVA's own Workers as valid, active definitions that collaborate in both directions", () => {
    for (const worker of STARTER_WORKERS) {
      expect(validateWorker(worker, tools), worker.id).toEqual([]);
      expect(worker.status).toBe("active");
    }
    const byId = Object.fromEntries(STARTER_WORKERS.map((worker) => [worker.id, worker]));
    for (const worker of STARTER_WORKERS) for (const target of worker.collaboration.delegatesTo) expect([target, byId[target].collaboration.acceptsFrom.includes(worker.id) || byId[target].collaboration.acceptsFrom.includes("*")]).toEqual([target, true]);
  });

  it("states each Worker's highest autonomy level, and what it can do outside or with money", () => {
    const summary = (id: string) => autonomyOf(starter(id), tools);
    expect(summary("reporter")).toMatchObject({ highest: 1, external: [], financial: [] });
    expect(summary("sales")).toMatchObject({ highest: 3, external: ["message.sendFirst"], financial: [] });
    expect(summary("sales").byLevel[2]).toEqual(["faq.answer"]);
    expect(summary("collections")).toMatchObject({ highest: 3, financial: ["payment.createLink"] });
    expect(summary("tutor").highest).toBe(2);
  });

  it("names what is wrong with a definition", () => {
    const issues = (over: Partial<WorkerDefinition>) => validateWorker(definition(over), tools);
    expect(issues({})).toEqual([]);
    expect(issues({ id: "Bad Id" })[0]).toContain("identificador");
    expect(issues({ name: " " })[0]).toContain("nombre");
    expect(issues({ version: "v1" })[0]).toContain("versión");
    expect(issues({ tools: [] })[0]).toContain("herramienta");
    expect(issues({ tools: ["task.create", "task.create"] })[0]).toContain("repetidas");
    expect(issues({ tools: ["does.notExist"] })[0]).toContain("desconocida");
    expect(issues({ tools: ["contact.read"], dataClearance: "business" })[0]).toContain("solo está habilitado para");
    expect(issues({ memory: { maxEntries: 20, maxChars: 2_000, allowPersonal: true, durable: false } })[0]).toContain("datos personales");
    expect(issues({ memory: { maxEntries: 500, maxChars: 2_000, allowPersonal: false, durable: false } })[0]).toContain("entradas");
    expect(issues({ limits: { maxRunsPerDay: 0, maxStepsPerRun: 20, maxDelegationDepth: 0 } })[0]).toContain("ejecuciones");
    expect(issues({ limits: { maxRunsPerDay: 5, maxStepsPerRun: 20, maxDelegationDepth: 9 } })[0]).toContain("profundidad");
    expect(issues({ collaboration: { delegatesTo: ["wd-demo"], acceptsFrom: [] } })[0]).toContain("consigo mismo");
    expect(issues({ collaboration: { delegatesTo: ["reporter"], acceptsFrom: [] } })[0]).toContain("profundidad de delegación");
    expect(issues({ routing: { needs: [], policy: {} } })[0]).toContain("modelo");
  });

  it("does not accept a tool that is still pending approval", () => {
    const pending = { ...tools, "x.new": { manifest: { ...BASE_TOOLS[0], id: "x.new" }, status: "pending" as const, registeredBy: "admin:ana" } };
    expect(validateWorker(definition({ tools: ["x.new"] }), pending)[0]).toContain("desconocida o pendiente");
  });
});

describe("working memory never holds secrets or payment data", () => {
  it("flags keys, tokens, references to secrets, private keys, card-shaped numbers and long token-like strings", () => {
    for (const value of ["sk_live_abc123", "sk_test_zzz", "AKIAABCDEFGHIJKLMNOP", "Bearer abcdefghijklmnop1234", "secret:stripe-main", "-----BEGIN PRIVATE KEY-----", "4111 1111 1111 1111", "4111-1111-1111-1111", "A".repeat(45)]) expect(looksSecret(value), value).toBe(true);
    for (const value of ["Clínica Vida, score 82", "Llamar el jueves a las 10:30", "Pedido 12345", "Teléfono 8888-1234"]) expect(looksSecret(value), value).toBe(false);
  });
});
