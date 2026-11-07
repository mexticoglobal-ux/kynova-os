import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ASSIGN_ACTION, CATEGORIES, MAX_BODY, MAX_VARIABLES, STUDIO_ACTIONS, assetsOf, chooseWorker, declareVariables, diffLines, grantsOf, latestOf, levelOfStudio, newStudioState, placeholdersOf, publishedOf, reduceStudio,
  renderPrompt, sharesOf, statusOf, studioStats, templatesOf, testsOf, toMarketplaceDraft, validateContent, versionOf, type Content, type StudioEnv, type StudioEvent, type StudioState,
} from "./studio-center";
import { DEMO_PERSONAS, PROSPECT_V1, PROSPECT_V2, agentContent, demoStudioEnv, demoStudioOk, meta, promptContent } from "./studio-demo";
import { ERROR_CODES, label, message } from "./studio-messages";
import { BASE_MODELS, STARTER_WORKERS } from "./koe-registry";
import { ACTION_LEVELS } from "./workers";

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T10:00:00.000Z`;
const ANA = { tenantId: "tenant-nova", actor: "ana" };
const PABLO = { tenantId: "tenant-nova", actor: "pablo" };
const NEX = { tenantId: "tenant-nova", actor: "worker:nex" };
const SYSTEM = { tenantId: "tenant-nova", actor: "system" };
const LUCIA = { tenantId: "tenant-vida", actor: "lucia" };
const ENV = demoStudioEnv();

const step = (state: StudioState, event: StudioEvent, env: StudioEnv = ENV) => reduceStudio(state, event, env);
const must = (state: StudioState, event: StudioEvent, env: StudioEnv = ENV): StudioState => {
  const result = reduceStudio(state, event, env);
  expect(result.error, event.type).toBeUndefined();
  return result.state;
};
const prompt = (name = "Mi prompt", body = "Responde a {{nombre}} sobre {{tema}}.", clearance: "public" | "business" | "personal" = "business") => ({ meta: meta(name, "sales", ["ventas"]), content: promptContent(body, clearance) });
const createPrompt = (state = newStudioState(), who = ANA, name = "Mi prompt", body?: string, clearance?: "public" | "business" | "personal", env: StudioEnv = ENV) => {
  const made = prompt(name, body, clearance);
  const next = must(state, { ...who, at: day(1), type: "asset.create", kind: "prompt", meta: made.meta, content: made.content }, env);
  return { state: next, id: next.assets.at(-1)?.id ?? "" };
};
const publish = (state: StudioState, id: string, number = 1, env: StudioEnv = ENV) => {
  const submitted = must(state, { ...ANA, at: day(2), type: "version.submit", assetId: id, versionNumber: number }, env);
  return must(submitted, { ...PABLO, at: day(2), type: "version.approve", assetId: id, versionNumber: number }, env);
};
const GRANT: StudioEvent = { ...ANA, at: day(1), type: "authorization.grant", maxPerDay: 5 };
const publishedPrompt = (state = newStudioState()) => { const made = createPrompt(state); return { state: publish(made.state, made.id), id: made.id }; };
const novaAutomation = ENV.refs.automations.find((item) => item.tenantId === "tenant-nova")?.id ?? "";
const agentOf = (promptId: string, over = {}) => ({ meta: meta("Mi agente"), content: agentContent(promptId, over) });

describe("the sample loads without a refusal and shows every case", () => {
  it("has prompts, an agent, versions in every state, tests, a template and a share", () => {
    const state = demoStudioOk();
    expect(studioStats(state, "tenant-nova")).toMatchObject({ prompts: { draft: 2, inReview: 1, published: 0, archived: 0 }, agents: { published: 1 }, versions: 5, pendingApprovals: 1, tests: 4, templates: 1, shares: { approved: 1 } });
    expect(studioStats(state, "tenant-vida")).toMatchObject({ prompts: { inReview: 1 }, tests: 0, templates: 0 });
    const prospect = state.assets.find((item) => item.name === "Respuesta a prospecto" && item.source.origin === "own");
    expect(prospect?.versions.map((item) => item.state)).toEqual(["published", "pendingApproval"]);
    expect(prospect?.versions[1].createdBy).toBe("worker:nex"); // NEX proposed it; a person decides
    expect(state.assets.some((item) => item.source.origin === "template")).toBe(true);
  });
});

describe("Constitution: NEX only prepares drafts, a person publishes", () => {
  it("lets NEX create, save a new version, duplicate, edit an unpublished draft, submit and propose a share", () => {
    const made = createPrompt(newStudioState(), NEX);
    expect(made.state.assets[0].versions[0]).toMatchObject({ state: "draft", createdBy: "worker:nex" });
    const saved = must(made.state, { ...NEX, at: day(2), type: "asset.save", assetId: made.id, content: promptContent("Hola {{nombre}}, ¿en qué te ayudo con {{tema}}?"), note: "otra idea" });
    expect(saved.assets[0].versions).toHaveLength(2);
    expect(must(saved, { ...NEX, at: day(2), type: "asset.duplicate", assetId: made.id }).assets).toHaveLength(2);
    expect(must(saved, { ...NEX, at: day(2), type: "asset.update", assetId: made.id, meta: meta("Mejor nombre") }).assets[0].name).toBe("Mejor nombre");
    expect(must(saved, { ...NEX, at: day(2), type: "version.submit", assetId: made.id, versionNumber: 2 }).assets[0].versions[1].state).toBe("pendingApproval");
  });

  it("refuses NEX everything that decides: publish, reject, archive, test, template, share approval, authorizations", () => {
    const base = publishedPrompt();
    const pending = must(must(base.state, { ...ANA, at: day(3), type: "asset.save", assetId: base.id, content: promptContent("Otra {{nombre}} {{tema}}") }), { ...ANA, at: day(3), type: "version.submit", assetId: base.id, versionNumber: 2 });
    const shared = must(pending, { ...ANA, at: day(3), type: "share.propose", assetId: base.id, versionNumber: 1, toTenantId: "tenant-vida" });
    const events: StudioEvent[] = [
      { ...NEX, at: day(4), type: "version.approve", assetId: base.id, versionNumber: 2 },
      { ...NEX, at: day(4), type: "version.reject", assetId: base.id, versionNumber: 2, note: "no" },
      { ...NEX, at: day(4), type: "asset.archive", assetId: base.id, archived: true },
      { ...NEX, at: day(4), type: "test.run", assetId: base.id, versionNumber: 1, inputs: { nombre: "A", tema: "B" } },
      { ...NEX, at: day(4), type: "test.compare", assetId: base.id, a: 1, b: 2, inputs: { nombre: "A", tema: "B" } },
      { ...NEX, at: day(4), type: "template.create", assetId: base.id, versionNumber: 1 },
      { ...NEX, at: day(4), type: "share.approve", shareId: "sh_0001" },
      { ...NEX, at: day(4), type: "share.revoke", shareId: "sh_0001" },
      { ...NEX, at: day(4), type: "authorization.grant" },
      { ...NEX, at: day(4), type: "authorization.revoke", grantId: "gr_0001" },
    ];
    for (const event of events) expect(step(shared, event).errorCode, event.type).toBe("personRequired");
    expect(step(shared, { ...NEX, at: day(4), type: "asset.update", assetId: base.id, meta: meta("Cambio") }).errorCode).toBe("notEditableByAi"); // it has a published version
    const sys = { ...SYSTEM, at: day(4), type: "asset.create" as const, kind: "prompt" as const, ...prompt() };
    expect(step(newStudioState(), sys).errorCode).toBe("personRequired"); // the platform does not author either
  });

  it("only publishes with a person's approval: a version NEX sent stays pending, and nobody approves twice", () => {
    const made = createPrompt(newStudioState(), NEX);
    const pending = must(made.state, { ...NEX, at: day(2), type: "version.submit", assetId: made.id, versionNumber: 1 });
    expect(statusOf(pending.assets[0])).toBe("inReview");
    expect(publishedOf(pending.assets[0])).toBeUndefined();
    const approved = must(pending, { ...PABLO, at: day(3), type: "version.approve", assetId: made.id, versionNumber: 1, note: "ok" });
    expect(approved.assets[0].versions[0]).toMatchObject({ state: "published", decidedBy: "pablo", decisionNote: "ok", submittedBy: "worker:nex" });
    expect(statusOf(approved.assets[0])).toBe("published");
    expect(step(approved, { ...PABLO, at: day(4), type: "version.approve", assetId: made.id, versionNumber: 1 }).errorCode).toBe("invalidState");
    expect(step(made.state, { ...PABLO, at: day(3), type: "version.approve", assetId: made.id, versionNumber: 1 }).errorCode).toBe("invalidState"); // a draft must be submitted first
  });

  it("supersedes the earlier published version when a new one is published, and keeps both", () => {
    const base = publishedPrompt();
    const saved = must(base.state, { ...ANA, at: day(3), type: "asset.save", assetId: base.id, content: promptContent("Nueva {{nombre}} {{tema}}.") });
    const next = publish(saved, base.id, 2);
    expect(next.assets[0].versions.map((item) => item.state)).toEqual(["superseded", "published"]);
    expect(next.assets[0].publishedNumber).toBe(2);
  });

  it("rejects with a reason, and a rejected version stays on record", () => {
    const made = createPrompt();
    const pending = must(made.state, { ...ANA, at: day(2), type: "version.submit", assetId: made.id, versionNumber: 1 });
    expect(step(pending, { ...PABLO, at: day(3), type: "version.reject", assetId: made.id, versionNumber: 1, note: "  " }).errorCode).toBe("invalid");
    const rejected = must(pending, { ...PABLO, at: day(3), type: "version.reject", assetId: made.id, versionNumber: 1, note: "Falta el tono" });
    expect(rejected.assets[0].versions[0]).toMatchObject({ state: "rejected", decisionNote: "Falta el tono" });
    expect(statusOf(rejected.assets[0])).toBe("draft");
  });
});

describe("versions are never overwritten and the history is complete", () => {
  it("adds a version on every save and leaves the earlier content exactly as it was, through every later event", () => {
    const base = publishedPrompt();
    const v1 = JSON.stringify(versionOf(base.state.assets[0], 1)?.content);
    let state = base.state;
    for (let n = 2; n <= 6; n += 1) state = must(state, { ...ANA, at: day(n), type: "asset.save", assetId: base.id, content: promptContent(`Versión ${n} para {{nombre}} sobre {{tema}}.`), note: `cambio ${n}` });
    state = publish(state, base.id, 4);
    state = must(must(state, { ...ANA, at: day(8), type: "version.submit", assetId: base.id, versionNumber: 5 }), { ...PABLO, at: day(8), type: "version.reject", assetId: base.id, versionNumber: 5, note: "no" });
    const asset = state.assets[0];
    expect(asset.versions.map((item) => item.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(JSON.stringify(versionOf(asset, 1)?.content)).toBe(v1);
    expect(asset.versions[2].content).toMatchObject({ body: "Versión 3 para {{nombre}} sobre {{tema}}." });
    expect(asset.versions.map((item) => item.note)).toEqual(["Versión inicial", "cambio 2", "cambio 3", "cambio 4", "cambio 5", "cambio 6"]);
    expect(state.audit.filter((entry) => entry.action === "asset.save")).toHaveLength(5); // who saved what, when, stays in the audit trail
  });

  it("keeps every record, however many there are: nothing is trimmed", () => {
    const base = publishedPrompt();
    let state = base.state;
    for (let n = 0; n < 60; n += 1) state = must(state, { ...ANA, at: `2026-10-05T10:${String(n).padStart(2, "0")}:00.000Z`, type: "asset.save", assetId: base.id, content: promptContent(`Texto ${n} {{nombre}} {{tema}}`) });
    for (let n = 0; n < 60; n += 1) state = must(state, { ...ANA, at: `2026-10-06T10:${String(n).padStart(2, "0")}:00.000Z`, type: "test.run", assetId: base.id, versionNumber: 1, inputs: { nombre: "A", tema: "B" } });
    expect(state.assets[0].versions).toHaveLength(61);
    expect(state.tests).toHaveLength(60);
    expect(state.audit.length).toBeGreaterThan(120);
    expect(state.audit[0].action).toBe("asset.create");
  });

  it("duplicates into a new asset with its own history and a source that says where it came from", () => {
    const base = publishedPrompt();
    const copy = must(base.state, { ...PABLO, at: day(3), type: "asset.duplicate", assetId: base.id });
    expect(copy.assets[1]).toMatchObject({ name: "Mi prompt (copia)", source: { origin: "duplicate", ref: base.id, version: 1 }, createdBy: "pablo", publishedNumber: undefined });
    expect(copy.assets[1].versions).toHaveLength(1);
    expect(copy.assets[1].versions[0].state).toBe("draft");
    expect(copy.assets[0].versions[0].state).toBe("published");
  });
});

describe("prompt builder: variables, categories and tags", () => {
  it("finds the variables, declares them, and keeps what was already described", () => {
    expect(placeholdersOf("Hola {{nombre}} y {{ tema }} y {{nombre}}")).toEqual(["nombre", "tema"]);
    const first = declareVariables("Hola {{nombre}}", []);
    const described = first.map((item) => ({ ...item, description: "Quien escribe" }));
    expect(declareVariables("Hola {{nombre}} sobre {{tema}}", described)).toEqual([{ name: "nombre", description: "Quien escribe", example: "" }, { name: "tema", description: "", example: "" }]);
  });

  it("requires exactly the declared variables, valid names and no secrets", () => {
    const lookup = { assets: [], env: ENV, tenantId: "tenant-nova" };
    const check = (content: Content) => validateContent("prompt", content, lookup);
    expect(check(promptContent("Hola {{nombre}}"))).toEqual([]);
    expect(check({ ...promptContent("Hola {{nombre}}"), variables: [] })[0]).toContain("«nombre» se usa pero no está declarada");
    expect(check({ ...promptContent("Hola"), variables: [{ name: "x", description: "", example: "" }] })[0]).toContain("«x» está declarada pero no se usa");
    expect(check(promptContent("Hola {{Nombre}}"))[0]).toContain("variable «Nombre»");
    expect(check(promptContent("Hola {{nom bre}}"))[0]).toContain("variable «nom bre»");
    expect(check(promptContent("   "))[0]).toContain("el texto del prompt");
    expect(check(promptContent("x".repeat(MAX_BODY + 1)))[0]).toContain("supera");
    expect(check(promptContent("Usa la clave sk_live_abcdef123456"))[0]).toContain("secreto");
    expect(check(promptContent(Array.from({ length: MAX_VARIABLES + 1 }, (_, i) => `{{v${i}}}`).join(" ")))[0]).toContain(`hasta ${MAX_VARIABLES}`);
    expect(check({ ...promptContent("Hola {{a}}"), variables: [{ name: "a", description: "", example: "sk_test_abcdef123456" }] })[0]).toContain("ejemplo no válido");
    expect(check({ ...promptContent("Hola"), clearance: "secret" as never })[0]).toContain("nivel de datos");
  });

  it("fills variables as data: a value is never expanded again, control characters are removed, and a missing one is named", () => {
    expect(renderPrompt("Hola {{nombre}}", { nombre: "Ana" })).toEqual({ text: "Hola Ana", missing: [] });
    expect(renderPrompt("Hola {{nombre}} {{tema}}", { nombre: "Ana" })).toEqual({ text: "Hola Ana ", missing: ["tema"] });
    expect(renderPrompt("{{a}}", { a: "{{b}}", b: "x" }).text).toBe("{{b}}");
    expect(renderPrompt("{{a}}", { a: "uno\u0000dos\u0007" }).text).toBe("uno dos");
    expect(renderPrompt("{{a}}", { a: "x".repeat(2_000) }).text).toHaveLength(1_000);
  });

  it("validates the category, the tags and the name, and edits them with a trail", () => {
    const base = createPrompt();
    const bad = (m: ReturnType<typeof meta>) => step(base.state, { ...ANA, at: day(2), type: "asset.update", assetId: base.id, meta: m });
    expect(bad(meta(" "))).toMatchObject({ errorCode: "invalid" });
    expect(bad({ ...meta("x"), category: "otra" as never }).error).toContain("categoría");
    expect(bad(meta("x", "sales", ["Mayúscula"])).error).toContain("etiquetas");
    expect(bad(meta("x", "sales", ["a", "a"])).error).toContain("repetidas");
    expect(bad(meta("x", "sales", Array.from({ length: 9 }, (_, i) => `t${i}`))).error).toContain("hasta 8");
    expect(bad({ ...meta("x"), description: "d".repeat(301) }).error).toContain("descripción");
    const edited = must(base.state, { ...ANA, at: day(2), type: "asset.update", assetId: base.id, meta: meta("Nuevo nombre", "support", ["soporte"]) });
    expect(edited.assets[0]).toMatchObject({ name: "Nuevo nombre", category: "support", tags: ["soporte"] });
    expect(edited.audit.at(-1)?.detail).toContain("«Mi prompt» → «Nuevo nombre»");
    expect(CATEGORIES).toHaveLength(7);
  });
});

describe("agents: connected to prompts, Workers, automations and courses", () => {
  const withPrompt = () => publishedPrompt(must(newStudioState(), GRANT));
  const create = (state: StudioState, content: ReturnType<typeof agentContent>, who = ANA) => step(state, { ...who, at: day(3), type: "asset.create", kind: "agent", meta: meta("Mi agente"), content });

  it("creates an agent with the main prompt, Workers, automations, courses, memory, personality and limits", () => {
    const base = withPrompt();
    const made = must(base.state, { ...ANA, at: day(3), type: "asset.create", kind: "agent", ...agentOf(base.id, { workerIds: ["sales"], automationIds: [novaAutomation], courseIds: ["course-ventas"], memory: { mode: "durable", maxEntries: 30, maxChars: 4_000 }, personality: { tone: "formal", language: "en", style: "Directo" } }) });
    const content = latestOf(made.assets[1]).content;
    expect(content).toMatchObject({ kind: "agent", promptId: base.id, workerIds: ["sales"], automationIds: [novaAutomation], courseIds: ["course-ventas"], memory: { mode: "durable" }, personality: { tone: "formal", language: "en" } });
  });

  it("checks every piece: prompt of its own company, capable Workers, its own automations and courses, memory, personality and limits", () => {
    const base = withPrompt();
    const issue = (over: Partial<ReturnType<typeof agentContent>>, state = base.state) => create(state, agentContent(base.id, over)).error ?? "";
    expect(issue({})).toBe("");
    expect(create(base.state, agentContent("as_9999")).error).toContain("prompt principal");
    expect(issue({ workerIds: ["nadie"] })).toContain("no existe");
    expect(issue({ workerIds: ["tutor"] })).toContain("no tiene la herramienta");
    expect(issue({ workerIds: ["sales", "sales"] })).toContain("repetidos");
    expect(issue({ workerIds: ["coordinator", "sales", "reporter", "followup", "collections", "tutor"] })).toContain("hasta 5");
    expect(issue({ automationIds: ["au_9999"] })).toContain("no existe en su empresa");
    expect(issue({ courseIds: ["course-atencion"] })).toContain("no existe en su empresa"); // that course is Vida's
    expect(issue({ memory: { mode: "durable", maxEntries: 0, maxChars: 4_000 } })).toContain("entradas");
    expect(issue({ memory: { mode: "session", maxEntries: 10, maxChars: 50 } })).toContain("caracteres");
    expect(issue({ memory: { mode: "forever" as never, maxEntries: 10, maxChars: 500 } })).toContain("modo de memoria");
    expect(issue({ clearance: "personal", memory: { mode: "durable", maxEntries: 10, maxChars: 500 } })).toContain("duradera");
    expect(issue({ personality: { tone: "grosero" as never, language: "es", style: "" } })).toContain("tono");
    expect(issue({ personality: { tone: "formal", language: "xx" as never, style: "" } })).toContain("idioma");
    expect(issue({ personality: { tone: "formal", language: "es", style: "s".repeat(301) } })).toContain("estilo");
    expect(issue({ limits: { maxRunsPerDay: 0, maxStepsPerRun: 5, maxCostMicrosPerRun: 100 } })).toContain("ejecuciones por día");
    expect(issue({ limits: { maxRunsPerDay: 5, maxStepsPerRun: 99, maxCostMicrosPerRun: 100 } })).toContain("pasos");
    expect(issue({ limits: { maxRunsPerDay: 5, maxStepsPerRun: 5, maxCostMicrosPerRun: 9_999_999 } })).toContain("costo");
    const personalPrompt = publish(createPrompt(must(newStudioState(), GRANT), ANA, "Con datos", "Hola {{nombre}}", "personal").state, "as_0002");
    expect(create(personalPrompt, agentContent("as_0002", { clearance: "business" })).error).toContain("no cubre");
  });

  it("is Level 2 to change what an agent is connected to: it needs a standing authorization a person granted", () => {
    expect([levelOfStudio("draft"), levelOfStudio("test"), levelOfStudio("assign"), levelOfStudio("publish"), levelOfStudio("share")]).toEqual([1, 1, 2, 3, 3]);
    for (const key of Object.values(STUDIO_ACTIONS)) expect(key in ACTION_LEVELS, key).toBe(true);
    const noGrant = publishedPrompt();
    expect(create(noGrant.state, agentContent(noGrant.id, { workerIds: ["sales"] })).errorCode).toBe("needsAuthorization");
    expect(create(noGrant.state, agentContent(noGrant.id)).error).toBeUndefined(); // no connections, nothing to authorize
    const granted = withPrompt();
    const made = must(granted.state, { ...ANA, at: day(3), type: "asset.create", kind: "agent", ...agentOf(granted.id, { workerIds: ["sales"] }) });
    expect(made.audit.some((entry) => entry.action === "agent.assign")).toBe(true);
    // the same connections again need nothing new; different ones do consume the authorization
    const agentId = made.assets[1].id;
    const same = must(made, { ...ANA, at: day(3), type: "asset.save", assetId: agentId, content: agentContent(granted.id, { workerIds: ["sales"], personality: { tone: "formal", language: "es", style: "" } }) });
    expect(same.audit.filter((entry) => entry.action === "agent.assign")).toHaveLength(1);
    expect(step(made, { ...ANA, at: day(3), type: "asset.save", assetId: agentId, content: agentContent(granted.id, { workerIds: ["sales", "coordinator"] }) }).error).toBeUndefined();
  });

  it("applies the authorization's limits: per day, expiry, revocation, and NEX works inside it too", () => {
    const base = publishedPrompt(must(newStudioState(), { ...ANA, at: day(1), type: "authorization.grant", maxPerDay: 2, expiresAt: day(10) }));
    const attempt = (state: StudioState, at: string, who = ANA, workers: string[] = ["sales"]) => step(state, { ...who, at, type: "asset.create", kind: "agent", ...agentOf(base.id, { workerIds: workers }) });
    const first = attempt(base.state, day(3));
    const second = attempt(first.state, day(3), NEX); // NEX acts inside the person's authorization
    expect(second.error).toBeUndefined();
    expect(attempt(second.state, day(3)).errorCode).toBe("needsAuthorization"); // two uses today
    expect(attempt(second.state, day(4)).error).toBeUndefined(); // a new day
    expect(attempt(second.state, "2026-10-11T10:00:00.000Z").errorCode).toBe("needsAuthorization"); // expired
    const grantId = grantsOf(base.state, "tenant-nova")[0].id;
    const revoked = must(base.state, { ...PABLO, at: day(3), type: "authorization.revoke", grantId });
    expect(attempt(revoked, day(3)).errorCode).toBe("needsAuthorization");
    expect(step(base.state, { ...LUCIA, at: day(3), type: "authorization.revoke", grantId }).errorCode).toBe("notYours");
    expect(step(base.state, { ...ANA, at: day(3), type: "authorization.revoke", grantId: "gr_9999" }).errorCode).toBe("authorizationNotFound");
    expect(step(newStudioState(), { ...ANA, at: day(3), type: "authorization.grant", maxPerDay: 0 }).errorCode).toBe("invalid");
    expect(step(newStudioState(), { ...ANA, at: day(3), type: "authorization.grant", expiresAt: day(2) }).errorCode).toBe("invalid");
    expect(grantsOf(base.state, "tenant-vida")).toEqual([]);
    expect(ASSIGN_ACTION).toBe("studio.assign");
  });

  it("will not duplicate an agent's connections without that authorization either, and an agent is published only if its prompt is", () => {
    const base = withPrompt();
    const made = must(base.state, { ...ANA, at: day(3), type: "asset.create", kind: "agent", ...agentOf(base.id, { workerIds: ["sales"] }) });
    const noGrant = { ...made, grants: [] };
    expect(step(noGrant, { ...ANA, at: day(4), type: "asset.duplicate", assetId: made.assets[1].id }).errorCode).toBe("needsAuthorization");
    // an agent whose prompt has no published version cannot be published
    const draftPrompt = createPrompt(must(newStudioState(), GRANT));
    const agent = must(draftPrompt.state, { ...ANA, at: day(3), type: "asset.create", kind: "agent", ...agentOf(draftPrompt.id) });
    const pending = must(agent, { ...ANA, at: day(3), type: "version.submit", assetId: agent.assets[1].id, versionNumber: 1 });
    expect(step(pending, { ...PABLO, at: day(4), type: "version.approve", assetId: agent.assets[1].id, versionNumber: 1 }).errorCode).toBe("promptNotPublished");
  });
});

describe("KOE: every test goes through it; Studio never calls a model", () => {
  const inputs = { nombre: "Marta", tema: "precios" };

  it("records the Worker KOE picked and why, the model its router chose and why, and the estimated cost and time", () => {
    const base = publishedPrompt();
    const state = must(base.state, { ...ANA, at: day(5), type: "test.run", assetId: base.id, versionNumber: 1, inputs });
    const run = state.tests[0];
    expect(run).toMatchObject({ workerId: "sales", workerName: "Asistente comercial", model: { id: "m-fast-a", label: "Rápido A" }, level: 1, kind: "prompt", versionNumber: 1, by: "ana" });
    expect(run.workerReason).toContain("especialidad");
    expect(run.modelReason).toBe("Rápido A");
    expect(run.estimatedCostMicros).toBeGreaterThan(900); // the Worker's cost per run plus the model's tokens
    expect(run.estimatedMs).toBeGreaterThan(300);
    expect(run.rendered).toBe("Responde a Marta sobre precios.");
    expect(run.output).toContain("Ningún modelo fue llamado");
    expect(JSON.stringify(run)).not.toMatch(/proveedor/); // no provider is named in what Studio records
  });

  it("lets the data decide: personal data only reaches a Worker cleared for it, another category picks another Worker", () => {
    const personal = publishedPrompt(createPrompt(newStudioState(), ANA, "Datos", "Hola {{nombre}} {{tema}}", "personal").state);
    expect(chooseWorker(ENV, "tenant-nova", "sales", "personal")).toMatchObject({ plan: { worker: { id: "sales" } } });
    const ran = must(personal.state, { ...ANA, at: day(5), type: "test.run", assetId: personal.id, versionNumber: 1, inputs });
    expect(ran.tests[0].workerId).toBe("sales"); // the only one that handles personal data and can write
    const analysis = must(newStudioState(), { ...ANA, at: day(1), type: "asset.create", kind: "prompt", meta: meta("Resumen", "analysis"), content: promptContent("Resume {{tema}}") });
    const analysed = must(analysis, { ...ANA, at: day(5), type: "test.run", assetId: analysis.assets[0].id, versionNumber: 1, inputs: { tema: "la semana" } });
    expect(analysed.tests[0]).toMatchObject({ workerId: "reporter" });
    expect(BASE_MODELS.find((model) => model.id === analysed.tests[0].model.id)?.classes).toContain("reasoning");
    expect(analysed.tests[0].estimatedMs).toBeGreaterThan(must(personal.state, { ...ANA, at: day(5), type: "test.run", assetId: personal.id, versionNumber: 1, inputs: { nombre: "x", tema: "y" } }).tests[0].estimatedMs - 1000);
  });

  it("refuses a test when KOE has no Worker or no model, or an input is missing, and records nothing", () => {
    const base = publishedPrompt();
    const noModels: StudioEnv = { ...ENV, models: BASE_MODELS.map((model) => ({ ...model, enabled: false })) };
    const refused = step(base.state, { ...ANA, at: day(5), type: "test.run", assetId: base.id, versionNumber: 1, inputs }, noModels);
    expect(refused.errorCode).toBe("noWorker");
    expect(refused.state.tests).toHaveLength(0);
    expect(step(base.state, { ...ANA, at: day(5), type: "test.run", assetId: base.id, versionNumber: 1, inputs: { nombre: "Marta" } }).error).toContain("falta el dato «tema»");
    expect(step(base.state, { ...ANA, at: day(5), type: "test.run", assetId: base.id, versionNumber: 1, inputs, workerId: "tutor" }).errorCode).toBe("noWorker");
    expect(step(base.state, { ...ANA, at: day(5), type: "test.run", assetId: base.id, versionNumber: 9, inputs }).errorCode).toBe("versionNotFound");
    expect(step(base.state, { ...ANA, at: day(5), type: "test.run", assetId: base.id, versionNumber: 1, inputs, workerId: "coordinator" }).state.tests[0].workerId).toBe("coordinator");
  });

  it("tests an agent through its own Workers, with the personality and its limits", () => {
    const base = publishedPrompt(must(newStudioState(), GRANT));
    const made = must(base.state, { ...ANA, at: day(3), type: "asset.create", kind: "agent", ...agentOf(base.id, { workerIds: ["coordinator"], limits: { maxRunsPerDay: 2, maxStepsPerRun: 5, maxCostMicrosPerRun: 20_000 } }) });
    const agentId = made.assets[1].id;
    const published = publish(made, agentId);
    const run = must(published, { ...ANA, at: day(5), type: "test.run", assetId: agentId, versionNumber: 1, inputs });
    expect(run.tests[0]).toMatchObject({ kind: "agent", workerId: "coordinator" });
    expect(run.tests[0].workerReason).toContain("Workers del agente");
    expect(run.tests[0].rendered).toContain("[Cercano · es · Breve y claro]");
    const twice = must(run, { ...ANA, at: day(5), type: "test.run", assetId: agentId, versionNumber: 1, inputs });
    expect(step(twice, { ...ANA, at: day(5), type: "test.run", assetId: agentId, versionNumber: 1, inputs }).errorCode).toBe("limitReached"); // 2 per day
    expect(step(twice, { ...ANA, at: day(6), type: "test.run", assetId: agentId, versionNumber: 1, inputs }).error).toBeUndefined(); // a new day
    const tight = must(published, { ...ANA, at: day(6), type: "asset.save", assetId: agentId, content: agentContent(base.id, { workerIds: ["coordinator"], limits: { maxRunsPerDay: 9, maxStepsPerRun: 5, maxCostMicrosPerRun: 10 } }) });
    expect(step(tight, { ...ANA, at: day(6), type: "test.run", assetId: agentId, versionNumber: 2, inputs }).errorCode).toBe("limitReached"); // the estimated cost is over its limit
  });

  it("compares two versions through the same Worker, so the difference is the prompt, and records both together", () => {
    const base = publishedPrompt();
    const saved = must(base.state, { ...ANA, at: day(3), type: "asset.save", assetId: base.id, content: promptContent("Responde a {{nombre}} sobre {{tema}}.\nPregunta por el presupuesto.") });
    const compared = must(saved, { ...ANA, at: day(4), type: "test.compare", assetId: base.id, a: 1, b: 2, inputs });
    expect(compared.tests).toHaveLength(2);
    expect(compared.tests[0].compareGroup).toBe(compared.tests[1].compareGroup);
    expect(compared.tests[0].workerId).toBe(compared.tests[1].workerId);
    expect(compared.tests[1].estimatedCostMicros).toBeGreaterThanOrEqual(compared.tests[0].estimatedCostMicros);
    expect(step(saved, { ...ANA, at: day(4), type: "test.compare", assetId: base.id, a: 1, b: 1, inputs }).errorCode).toBe("invalid");
    const bad = step(saved, { ...ANA, at: day(4), type: "test.compare", assetId: base.id, a: 1, b: 7, inputs });
    expect(bad.errorCode).toBe("versionNotFound");
    expect(bad.state.tests).toHaveLength(0); // all or nothing
  });

  it("shows what changed between versions line by line", () => {
    expect(diffLines(PROSPECT_V1, PROSPECT_V2)).toEqual([
      { type: "same", text: "Eres el asistente comercial de la empresa." },
      { type: "same", text: "Responde a {{nombre}} sobre {{tema}} con un tono cercano." },
      { type: "added", text: "Pregunta por el presupuesto disponible." },
      { type: "same", text: "No prometas precios." },
    ]);
    expect(diffLines("a\nb", "a")).toEqual([{ type: "same", text: "a" }, { type: "removed", text: "b" }]);
    expect(diffLines("x", "y")).toEqual([{ type: "removed", text: "x" }, { type: "added", text: "y" }]);
  });

  it("never reaches a model, a provider or the network from the Studio modules", () => {
    const dir = __dirname;
    const files = readdirSync(dir).filter((name) => name.startsWith("studio-") && name.endsWith(".ts") && !name.endsWith(".test.ts"));
    expect(files.length).toBeGreaterThanOrEqual(3);
    for (const name of files) {
      const source = readFileSync(join(dir, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(source, name).not.toMatch(/lib\/ai|fetch\(|XMLHttpRequest|process\.env|import\(|openai|anthropic|gemini|mistral/i);
    }
  });
});

describe("templates and sharing: the model only", () => {
  it("turns a published version into a template with author, company, source and version, and a draft can start from it", () => {
    const base = publishedPrompt();
    expect(step(createPrompt().state, { ...ANA, at: day(3), type: "template.create", assetId: "as_0001", versionNumber: 1 }).errorCode).toBe("notPublished");
    const made = must(base.state, { ...PABLO, at: day(3), type: "template.create", assetId: base.id, versionNumber: 1 });
    const template = made.templates[0];
    expect(template).toMatchObject({ kind: "prompt", version: 1, author: "ana", company: "tenant-nova", source: { origin: "own", ref: base.id, version: 1 }, name: "Mi prompt" });
    const fromIt = must(made, { ...ANA, at: day(4), type: "asset.fromTemplate", templateId: template.id });
    expect(fromIt.assets[1]).toMatchObject({ source: { origin: "template", ref: template.id, version: 1 } });
    expect(latestOf(fromIt.assets[1]).state).toBe("draft");
    expect(step(made, { ...LUCIA, at: day(4), type: "asset.fromTemplate", templateId: template.id }).errorCode).toBe("notYours");
    expect(step(made, { ...ANA, at: day(4), type: "asset.fromTemplate", templateId: "tp_9999" }).errorCode).toBe("templateNotFound");
    expect(templatesOf(made, "tenant-vida")).toEqual([]);
  });

  it("keeps a company's connections out of an agent template, and asks for a prompt when one is made from it", () => {
    const base = publishedPrompt(must(newStudioState(), GRANT));
    const made = must(base.state, { ...ANA, at: day(3), type: "asset.create", kind: "agent", ...agentOf(base.id, { workerIds: ["sales"], automationIds: [novaAutomation], courseIds: ["course-ventas"] }) });
    const agentId = made.assets[1].id;
    const withTemplate = must(publish(made, agentId), { ...ANA, at: day(5), type: "template.create", assetId: agentId, versionNumber: 1 });
    const template = withTemplate.templates[0];
    expect(template.kind).toBe("agent");
    expect(JSON.stringify(template.content)).not.toMatch(/promptId|workerIds|automationIds|courseIds/);
    expect(step(withTemplate, { ...ANA, at: day(6), type: "asset.fromTemplate", templateId: template.id }).errorCode).toBe("invalid"); // no prompt chosen
    const copy = must(withTemplate, { ...ANA, at: day(6), type: "asset.fromTemplate", templateId: template.id, promptId: base.id });
    expect(latestOf(copy.assets.at(-1) as never).content).toMatchObject({ kind: "agent", promptId: base.id, workerIds: [] });
  });

  it("maps a template to a Marketplace listing draft without creating any listing", () => {
    const base = publishedPrompt();
    const made = must(base.state, { ...ANA, at: day(3), type: "template.create", assetId: base.id, versionNumber: 1 });
    expect(toMarketplaceDraft(made.templates[0])).toMatchObject({ kind: "digitalResource", templateId: made.templates[0].id, templateVersion: 1, author: "ana", company: "tenant-nova" });
    const source = readFileSync(join(__dirname, "studio-center.ts"), "utf8") + readFileSync(join(__dirname, "studio-demo.ts"), "utf8");
    expect(source).not.toMatch(/PROMPT_MARKETPLACE|PROMPT_LISTINGS|import .*marketplace-center/);
  });

  it("proposes, approves and revokes a share between companies as records, with nothing copied", () => {
    const base = publishedPrompt();
    const propose = (state: StudioState, to = "tenant-vida", who = ANA, number = 1) => step(state, { ...who, at: day(4), type: "share.propose", assetId: base.id, versionNumber: number, toTenantId: to });
    const draftOnly = must(base.state, { ...ANA, at: day(3), type: "asset.save", assetId: base.id, content: promptContent("Otra {{nombre}} {{tema}}") });
    expect(propose(draftOnly, "tenant-vida", ANA, 2).errorCode).toBe("notPublished");
    expect(propose(base.state, "tenant-nova").errorCode).toBe("shareInvalid");
    expect(propose(base.state, " ").errorCode).toBe("shareInvalid");
    const proposed = propose(base.state, "tenant-vida", NEX).state; // NEX may propose; it cannot approve
    expect(sharesOf(proposed, "tenant-nova")[0]).toMatchObject({ status: "proposed", toTenantId: "tenant-vida", proposedBy: "worker:nex" });
    expect(propose(proposed).errorCode).toBe("shareInvalid"); // already proposed
    const shareId = proposed.shares[0].id;
    expect(step(proposed, { ...LUCIA, at: day(5), type: "share.approve", shareId }).errorCode).toBe("notYours"); // the owner decides
    const approved = must(proposed, { ...PABLO, at: day(5), type: "share.approve", shareId });
    expect(approved.shares[0]).toMatchObject({ status: "approved", decidedBy: "pablo" });
    expect(step(approved, { ...PABLO, at: day(6), type: "share.approve", shareId }).errorCode).toBe("shareClosed");
    expect(assetsOf(approved, "tenant-vida")).toEqual([]); // nothing reaches the other company yet
    expect(sharesOf(approved, "tenant-vida")).toEqual([]);
    const revoked = must(approved, { ...PABLO, at: day(7), type: "share.revoke", shareId });
    expect(revoked.shares[0].status).toBe("revoked");
    expect(step(revoked, { ...PABLO, at: day(8), type: "share.revoke", shareId }).errorCode).toBe("shareClosed");
    expect(propose(revoked).error).toBeUndefined(); // a revoked agreement can be proposed again
    expect(step(approved, { ...PABLO, at: day(6), type: "share.approve", shareId: "sh_9999" }).errorCode).toBe("notFound");
  });
});

describe("one company never sees or changes another's", () => {
  it("refuses every change on another company's asset and scopes the views", () => {
    const state = demoStudioOk();
    const novaId = assetsOf(state, "tenant-nova")[0].id;
    const events: StudioEvent[] = [
      { ...LUCIA, at: day(9), type: "asset.update", assetId: novaId, meta: meta("x") },
      { ...LUCIA, at: day(9), type: "asset.save", assetId: novaId, content: promptContent("Hola") },
      { ...LUCIA, at: day(9), type: "asset.duplicate", assetId: novaId },
      { ...LUCIA, at: day(9), type: "asset.archive", assetId: novaId, archived: true },
      { ...LUCIA, at: day(9), type: "version.submit", assetId: novaId, versionNumber: 1 },
      { ...LUCIA, at: day(9), type: "version.approve", assetId: novaId, versionNumber: 2 },
      { ...LUCIA, at: day(9), type: "version.reject", assetId: novaId, versionNumber: 2, note: "x" },
      { ...LUCIA, at: day(9), type: "test.run", assetId: novaId, versionNumber: 1, inputs: {} },
      { ...LUCIA, at: day(9), type: "template.create", assetId: novaId, versionNumber: 1 },
      { ...LUCIA, at: day(9), type: "share.propose", assetId: novaId, versionNumber: 1, toTenantId: "tenant-nova" },
    ];
    for (const event of events) expect(step(state, event, demoStudioEnv()).errorCode, event.type).toBe("notYours");
    expect(assetsOf(state, "tenant-vida").map((item) => item.name)).toEqual(["Aviso de cita"]);
    expect(testsOf(state, "tenant-vida")).toEqual([]);
    expect(studioStats(state, "tenant-unknown").prompts).toEqual({ draft: 0, inReview: 0, published: 0, archived: 0 });
  });

  it("archives and restores, and an archived asset cannot be changed, submitted or tested", () => {
    const base = publishedPrompt();
    const archived = must(base.state, { ...ANA, at: day(3), type: "asset.archive", assetId: base.id, archived: true });
    expect(statusOf(archived.assets[0])).toBe("archived");
    for (const event of [
      { ...ANA, at: day(4), type: "asset.save", assetId: base.id, content: promptContent("Hola") },
      { ...ANA, at: day(4), type: "asset.update", assetId: base.id, meta: meta("x") },
      { ...ANA, at: day(4), type: "test.run", assetId: base.id, versionNumber: 1, inputs: {} },
    ] as StudioEvent[]) expect(step(archived, event).errorCode, event.type).toBe("archived");
    expect(statusOf(must(archived, { ...ANA, at: day(4), type: "asset.archive", assetId: base.id, archived: false }).assets[0])).toBe("published");
  });
});

describe("language", () => {
  it("has a message for every error code, labels in Spanish, and no provider name anywhere", () => {
    for (const code of ERROR_CODES) expect(message(code, { detail: "x", from: "a", to: "b" }), code).not.toMatch(/\{\w+\}/);
    expect(label("status", "inReview")).toBe("En revisión");
    expect(label("versionState", "pendingApproval")).toBe("Pendiente de aprobación");
    expect(label("level", "2")).toBe("Nivel 2 · con autorización");
    expect(label("shareStatus", "approved")).toContain("sin efecto");
    expect(message("invalid", { detail: "nombre" })).toBe("No es válido: nombre.");
    const text = readFileSync(join(__dirname, "studio-messages.ts"), "utf8");
    expect(text).not.toMatch(/openai|anthropic|gemini|mistral|proveedor-/i);
    expect(DEMO_PERSONAS.length).toBe(4);
    expect(STARTER_WORKERS.some((worker) => worker.id === "sales")).toBe(true);
  });
});
