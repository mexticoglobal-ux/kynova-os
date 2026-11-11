/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateEncryptionKey } from "@/lib/backend/crypto";
import type { Entity } from "@/lib/backend/entities";
import { createBackendCore } from "@/lib/backend/index";
import { Connector, newStats, verifyCoverage, type Bridge } from "@/lib/backend/integration";
import { auditPolicies } from "@/lib/backend/rls";
import { PLANS } from "./billing-catalog";
import { BUSINESS_TEMPLATES, TEMPLATE_IDS, emptyParts, templateById, validateTemplate, type TemplateId } from "./business-templates";
import {
  ARCHITECT_TABLES, MAX_QUESTIONS, QUESTIONS, QUESTION_IDS, SECTOR_SIGNALS, applyArchitectEvents, choosePlan, detectBusiness, estimatedMinutes, newArchitectState, nextQuestion, normalizeText, pendingQuestions,
  previewInstall, recommend, reduceArchitect, welcomeMessage, type Answers, type ArchitectEvent, type ArchitectState,
} from "./business-architect";
import { operatingDashboard } from "./kynova-operation";

const T1 = "tenant-clinica-sol";
const T2 = "tenant-agencia-luz";
const AT = "2026-11-11T09:00:00.000Z";
const at = (minutes = 0) => new Date(Date.parse(AT) + minutes * 60_000).toISOString();
const owner = (id = "sol", name = "Sol Ramírez") => ({ id, name, email: `${id}@empresa.test` });
const full = (over: Answers = {}): Answers => ({ businessName: "Clínica Sol", description: "una clínica dental en San José", teamSize: "small", monthlyLeads: "from10to50", channels: ["email", "webchat"], goal: "moreSales", aiAppetite: "balanced", ...over });
const send = (state: ArchitectState, event: ArchitectEvent) => { const result = reduceArchitect(state, event); expect(result.error, result.error).toBeUndefined(); return result; };
const refused = (state: ArchitectState, event: ArchitectEvent): string => { const result = reduceArchitect(state, event); expect(result.error, `${event.type} should be refused`).toBeDefined(); expect(result.state).toBe(state); return result.errorCode ?? ""; };

/** The whole conversation, the way a customer would live it: the assistant asks, the owner answers, until it is ready. */
function converse(state: ArchitectState, tenantId: string, answers: Answers, who = owner(), minute = 0) {
  let result = send(state, { tenantId, actor: who.id, at: at(minute), type: "session.start", owner: who });
  const sessionId = result.session!.id;
  const asked: string[] = [];
  let step = minute;
  for (let guard = 0; guard < 12 && result.question; guard += 1) {
    const question = result.question;
    asked.push(question.id);
    const value = (answers as Record<string, string | readonly string[]>)[question.id] ?? (question.options?.[0] as string);
    step += 1;
    result = send(result.state, { tenantId, actor: who.id, at: at(step), type: "answer.submit", sessionId, questionId: question.id, value });
  }
  return { state: result.state, sessionId, asked, last: result };
}

describe("the welcome assistant and the questionnaire", () => {
  it("presents itself as NEX, the AI assistant, and promises a preview before installing anything", () => {
    const text = welcomeMessage("Sol Ramírez");
    expect(text).toMatch(/^Hola Sol/);
    expect(text).toMatch(/NEX/);
    expect(text).toMatch(/IA/);
    expect(text).toMatch(/vista previa/);
  });
  it("asks few and short questions: seven, or eight only when the business was not clear", () => {
    expect(MAX_QUESTIONS).toBe(8);
    expect(pendingQuestions({}).map((item) => item.id)).toEqual(["businessName", "description", "teamSize", "monthlyLeads", "channels", "goal", "aiAppetite"]);
    expect(Object.keys(QUESTIONS).sort()).toEqual([...QUESTION_IDS].sort());
    expect(nextQuestion({})!.id).toBe("businessName");
    expect(nextQuestion({ businessName: "Clínica Sol" })!.id).toBe("description");
    expect(nextQuestion(full())).toBeNull();
  });
  it("is adaptive: it asks for the sector only when the description did not make the business clear, and never twice", () => {
    expect(pendingQuestions(full({ description: "una clínica dental" })).map((item) => item.id)).toEqual([]);
    expect(pendingQuestions(full({ businessName: "Mi Empresa", description: "hacemos cosas" })).map((item) => item.id)).toEqual(["sector"]);
    expect(pendingQuestions(full({ businessName: "Mi Empresa", description: "hacemos cosas", sector: "lawyer" }))).toEqual([]);
    expect(pendingQuestions({ businessName: "Mi Empresa" }).map((item) => item.id)).not.toContain("sector");
  });
  it("fits in under five minutes: every customer answers eight questions at the most, at half a minute each", () => {
    expect(estimatedMinutes({})).toBeLessThanOrEqual(4);
    expect(estimatedMinutes(full({ businessName: "Mi Empresa", description: "hacemos cosas" }))).toBeLessThanOrEqual(4);
    expect(estimatedMinutes(full())).toBe(3.5);
  });
});

describe("detecting the type of business", () => {
  const phrases: [TemplateId, string][] = [
    ["marketingAgency", "Somos una agencia de marketing digital"], ["realEstate", "Inmobiliaria con propiedades en alquiler"], ["restaurant", "Un restaurante de comida típica"], ["clinic", "Clínica dental con consultorio propio"],
    ["lawyer", "Bufete de abogados de familia"], ["accountant", "Servicios de contabilidad e impuestos"], ["construction", "Constructora de casas y remodelación"], ["ecommerce", "Tienda en línea de ropa con envíos"],
    ["facelessYoutube", "Un canal de YouTube de finanzas con videos"], ["consultant", "Consultoría para pequeñas empresas"], ["education", "Academia con cursos para alumnos"],
  ];
  it.each(phrases)("recognises %s from what the customer writes", (id, description) => {
    const detection = detectBusiness({ description });
    expect(detection.templateId).toBe(id);
    expect(["high", "low"]).toContain(detection.confidence);
    expect(detection.matched.length).toBeGreaterThan(0);
  });
  it("ignores accents and capitals, lets the customer's own choice win, and falls back to the generic template when nothing matches", () => {
    expect(normalizeText("CLÍNICA Dental")).toBe(" clinica dental ");
    expect(detectBusiness({ description: "CLINICA DENTAL" }).templateId).toBe("clinic");
    expect(detectBusiness({ description: "una clínica dental", sector: "lawyer" })).toMatchObject({ templateId: "lawyer", confidence: "confirmed" });
    expect(detectBusiness({ description: "hacemos cosas" })).toMatchObject({ templateId: "generic", confidence: "none" });
    expect(detectBusiness({ sector: "other" })).toMatchObject({ templateId: "generic", confidence: "confirmed" });
  });
  it("has signals for every template and none that point to two of them", () => {
    expect(Object.keys(SECTOR_SIGNALS).sort()).toEqual([...TEMPLATE_IDS].sort());
    const owners = new Map<string, string>();
    for (const [id, words] of Object.entries(SECTOR_SIGNALS)) for (const word of words) { expect(owners.has(word), word).toBe(false); owners.set(word, id); }
  });
  it("tells a close call from a clear one", () => {
    expect(detectBusiness({ description: "marketing para una clínica" }).confidence).toBe("low");
    expect(detectBusiness({ description: "agencia de marketing y publicidad" }).confidence).toBe("high");
  });
});

describe("the recommendation comes only from the templates and Billing's plans", () => {
  it("recommends nothing until the questions are answered", () => {
    expect(recommend({})).toBeNull();
    expect(recommend({ ...full(), goal: undefined })).toBeNull();
    expect(previewInstall({})).toBeNull();
  });
  it("recommends the template, plan, agents, budget, automations, Workers, teams, KPIs and dashboard", () => {
    const rec = recommend(full())!;
    const template = templateById("clinic")!;
    expect(rec.template).toMatchObject({ id: "clinic", name: "Clínica", confidence: "high" });
    expect(rec.plan.id).toBe("starter");
    expect(rec.agents.count).toBe(template.agents.length);
    expect(rec.aiBudgetUsd).toBe(30);
    expect(rec.automations.length).toBe(template.automations.length - 1); // no web form: that automation is left out
    expect(rec.workers).toContain("followup"); // the Worker its agents need comes first
    expect(rec.workers.length).toBeLessThanOrEqual(PLANS.find((plan) => plan.id === rec.plan.id)!.limits.workers);
    expect(rec.teams.map((item) => item.name)).toEqual(template.teams.map((item) => item.name));
    expect(rec.kpis.length).toBeGreaterThanOrEqual(3);
    expect(rec.dashboard.length).toBeGreaterThanOrEqual(5);
    expect(rec.nextSteps.length).toBeGreaterThanOrEqual(4);
    expect(rec.notes.some((item) => /Nivel 1/.test(item))).toBe(true);
  });
  it("invents nothing: every recommended piece belongs to the template, and the plan is one of Billing's", () => {
    for (const template of BUSINESS_TEMPLATES) {
      const rec = recommend(full({ description: "", sector: template.id, aiAppetite: "ambitious" }))!;
      expect(rec.agents.list.every((item) => template.agents.some((other) => other.name === item.name)), template.id).toBe(true);
      expect(rec.workers.every((item) => template.workers.includes(item)), template.id).toBe(true);
      expect(rec.teams.every((item) => template.teams.some((other) => other.name === item.name)), template.id).toBe(true);
      expect(rec.kpis.every((item) => template.kpis.some((other) => other.id === item.id)), template.id).toBe(true);
      expect(rec.dashboard.every((item) => template.dashboard.includes(item)), template.id).toBe(true);
      expect(PLANS.some((plan) => plan.id === rec.plan.id), template.id).toBe(true);
      expect(validateTemplate({ ...template, ...rec.overrides, workflows: template.workflows.filter(() => false) }).filter((item) => !item.startsWith("workflow")), template.id).toEqual([]);
    }
  });
  it("scales the number of agents and the AI budget with how much the customer wants the AI to do", () => {
    const cautious = recommend(full({ aiAppetite: "cautious" }))!;
    const balanced = recommend(full({ aiAppetite: "balanced" }))!;
    const ambitious = recommend(full({ aiAppetite: "ambitious" }))!;
    expect([cautious.agents.count, balanced.agents.count]).toEqual([1, templateById("clinic")!.agents.length]);
    expect([cautious.aiBudgetUsd, balanced.aiBudgetUsd, ambitious.aiBudgetUsd]).toEqual([20, 30, 50]);
    expect(cautious.overrides.aiBudgetUsd).toBe(20);
  });
  it("chooses the cheapest plan whose limits cover what will be installed, and says so", () => {
    expect(recommend(full({ teamSize: "solo", monthlyLeads: "under10" }))!.plan.id).toBe("starter");
    expect(recommend(full({ teamSize: "medium", monthlyLeads: "from50to200" }))!.plan.id).toBe("professional");
    const big = recommend(full({ teamSize: "large", monthlyLeads: "over200" }))!;
    expect(big.plan.id).toBe("business");
    expect(big.plan.fits).toBe(true);
    expect(big.plan.reasons[0]).toMatch(/Cubre/);
    for (const profile of [{ teamSize: "solo", monthlyLeads: "under10" }, { teamSize: "medium", monthlyLeads: "from50to200" }, { teamSize: "large", monthlyLeads: "over200" }] as const) {
      const rec = recommend(full(profile))!;
      const chosen = PLANS.find((item) => item.id === rec.plan.id)!;
      for (const [resource, amount] of Object.entries(rec.plan.needs)) expect((chosen.limits as unknown as Record<string, number>)[resource]).toBeGreaterThanOrEqual(amount);
      const cheaper = PLANS.filter((item) => item.selfServe && item.tier < chosen.tier && item.tier >= PLANS.find((p) => p.id === templateById(rec.template.id)!.planId)!.tier);
      for (const plan of cheaper) expect(Object.entries(rec.plan.needs).every(([resource, amount]) => (plan.limits as unknown as Record<string, number>)[resource]! >= amount), `${plan.id} would not cover`).toBe(false);
    }
    expect(choosePlan({ users: 100_000 }, "starter")).toMatchObject({ fits: false, id: "enterprise" });
    expect(choosePlan({ users: 1 }, "starter", "business")).toMatchObject({ id: "business", reasons: ["Elegido por ti."] });
  });
  it("drops the web-form automation when the customer has no web form, keeps the Workers its agents need, and gives a solo founder one team", () => {
    const withForm = recommend(full({ channels: ["email", "webform"] }))!;
    const without = recommend(full({ channels: ["email", "webchat"] }))!;
    expect(withForm.automations.length - without.automations.length).toBe(1);
    expect(without.overrides.automations).not.toContain("webForm");
    const solo = recommend(full({ teamSize: "solo", aiAppetite: "cautious" }))!;
    expect(solo.teams).toHaveLength(1);
    expect(solo.workers).toContain(solo.agents.list[0]!.worker);
    expect(solo.notes.some((item) => /segunda persona/.test(item))).toBe(true);
  });
  it("puts what the customer wants first: KPIs and the dashboard follow their first goal", () => {
    const sales = recommend(full({ goal: "moreSales" }))!;
    const finances = recommend(full({ description: "", sector: "accountant", goal: "controlFinances" }))!;
    expect(sales.dashboard[0]).toBe("sales");
    expect(finances.dashboard[0]).toBe("billing");
    expect(finances.kpis[0]!.metric).toBe("paymentsValue");
    expect(sales.kpis[0]!.metric).toBe("leadsNew");
    expect(sales.kpis.length).toBeLessThanOrEqual(4);
    expect(sales.objectives.every((item) => sales.kpis.some((kpi) => kpi.id === item.kpi))).toBe(true);
  });
  it("offers the alternatives and a note when the business was not recognised", () => {
    const rec = recommend(full({ businessName: "Mi Empresa", description: "marketing para una clínica", sector: "clinic" }))!;
    expect(rec.template.alternatives.length).toBeGreaterThan(0);
    expect(rec.template.alternatives.some((item) => item.id === "generic")).toBe(true);
    expect(rec.notes[0]).toMatch(/cambiarla en la vista previa/);
    expect(rec.template.alternatives.map((item) => item.id)).toContain("marketingAgency");
    expect(recommend(full({ businessName: "Mi Empresa", description: "hacemos cosas", sector: "other" }))!.template.id).toBe("generic");
  });
});

describe("the preview shows exactly what the one click will do", () => {
  it("lists everything that will be installed, proven by a dry run that leaves nothing behind", () => {
    const preview = previewInstall(full())!;
    expect(preview).toMatchObject({ company: "Clínica Sol", template: "Clínica", ok: true, errors: [] });
    expect(preview.steps).toBeGreaterThan(30);
    expect(preview.agents.length).toBe(templateById("clinic")!.agents.length);
    expect(preview.plan.name).toBe("Starter");
    for (const key of ["automations", "workers", "teams", "departments", "roles", "kpis", "dashboard", "objectives", "workflows", "nextSteps"] as const) expect(preview[key].length, key).toBeGreaterThan(0);
    expect(previewInstall(full())).toEqual(preview);
  });
  it("matches what is really installed afterwards", () => {
    const talk = converse(newArchitectState(), T1, full());
    let state = talk.state;
    const sessionId = talk.sessionId;
    const preview = previewInstall(full())!;
    const done = send(state, { tenantId: T1, actor: "sol", at: at(20), type: "install.confirm", sessionId });
    state = done.state;
    const parts = done.installation!.parts;
    expect(parts.org.teams.filter((item) => item.tenantId === T1).map((item) => item.name).sort()).toEqual([...preview.teams].sort());
    expect(parts.studio.assets.filter((item) => item.tenantId === T1 && item.kind === "agent").map((item) => item.name).sort()).toEqual([...preview.agents].sort());
    expect(parts.automations.automations.filter((item) => item.tenantId === T1).length).toBe(preview.automations.length);
    expect(parts.agent.koe.instances.filter((item) => item.tenantId === T1).map((item) => item.definitionId).sort()).toEqual([...preview.workers].sort());
    expect(parts.billing.accounts.find((item) => item.tenantId === T1)?.planId).toBe(preview.plan.id);
    expect(parts.agent.ai.configs.find((item) => item.tenantId === T1)?.budgetMicros).toBe(preview.aiBudgetUsd * 1_000_000);
    expect(done.session!.installed).toMatchObject({ agents: preview.agents.length, automations: preview.automations.length, workers: preview.workers.length, teams: preview.teams.length, steps: preview.steps });
  });
});

describe("the session: one customer, one company, one confirmation", () => {
  it("runs the whole conversation and, with one click, leaves the company configured in minutes", () => {
    const started = Date.now();
    const { state, sessionId, asked, last } = converse(newArchitectState(), T1, full());
    expect(asked).toEqual(["businessName", "description", "teamSize", "monthlyLeads", "channels", "goal", "aiAppetite"]);
    expect(last.session!.status).toBe("ready");
    expect(last.recommendation!.template.id).toBe("clinic");
    expect(last.preview!.ok).toBe(true);
    const done = send(state, { tenantId: T1, actor: "sol", at: at(30), type: "install.confirm", sessionId });
    const elapsedMs = Date.now() - started;
    expect(done.session).toMatchObject({ status: "installed", templateId: "clinic", planId: "starter", installedAt: at(30) });
    expect(elapsedMs).toBeLessThan(5_000);
    expect(estimatedMinutes(full())).toBeLessThan(5);
    const parts = done.installation!.parts;
    const dashboard = operatingDashboard({ parts, executions: [] }, T1, at(31));
    expect(dashboard).toMatchObject({ people: { active: 1 }, billing: { planId: "starter" } });
    expect(dashboard.automation.active).toBe(last.recommendation!.automations.length);
    expect(done.installation!.errors).toEqual([]);
    // Level 1: nothing was authorized
    expect(parts.org.grants).toEqual([]);
    expect(parts.crm.grants).toEqual([]);
    expect(parts.studio.grants).toEqual([]);
  });
  it("lets the customer change the template and the plan in the preview before installing", () => {
    const { state, sessionId } = converse(newArchitectState(), T1, full());
    const changed = send(state, { tenantId: T1, actor: "sol", at: at(20), type: "recommendation.adjust", sessionId, templateId: "consultant", planId: "professional" });
    expect(changed.recommendation).toMatchObject({ template: { id: "consultant", confidence: "confirmed" }, plan: { id: "professional", reasons: expect.arrayContaining(["Elegido por ti."]) } });
    expect(changed.preview).toMatchObject({ template: "Consultor", ok: true });
    const done = send(changed.state, { tenantId: T1, actor: "sol", at: at(21), type: "install.confirm", sessionId });
    expect(done.session).toMatchObject({ templateId: "consultant", planId: "professional" });
    expect(done.installation!.parts.billing.accounts[0]!.planId).toBe("professional");
  });
  it("accepts only valid answers, and only from the person who opened the assistant", () => {
    const started = send(newArchitectState(), { tenantId: T1, actor: "sol", at: at(), type: "session.start", owner: owner() });
    const state = started.state;
    const sessionId = started.session!.id;
    const answer = (questionId: string, value: string | readonly string[], actor = "sol", tenantId = T1): ArchitectEvent => ({ tenantId, actor, at: at(1), type: "answer.submit", sessionId, questionId, value });
    expect(refused(state, answer("businessName", "x"))).toBe("invalid");
    expect(refused(state, answer("teamSize", "gigante"))).toBe("invalid");
    expect(refused(state, answer("channels", []))).toBe("invalid");
    expect(refused(state, answer("channels", ["fax"]))).toBe("invalid");
    expect(refused(state, answer("nada", "x"))).toBe("unknownQuestion");
    expect(refused(state, answer("businessName", "Clínica Sol", "intruso"))).toBe("forbidden");
    expect(refused(state, answer("businessName", "Clínica Sol", "sol", T2))).toBe("notFound");
    expect(refused(state, { tenantId: T1, actor: "sol", at: at(), type: "install.confirm", sessionId })).toBe("notReady");
    expect(refused(state, { tenantId: T1, actor: "sol", at: at(), type: "recommendation.adjust", sessionId, templateId: "clinic" })).toBe("notReady");
  });
  it("is the customer who answers and confirms: NEX only asks", () => {
    const state = newArchitectState();
    expect(refused(state, { tenantId: T1, actor: "worker:nex", at: at(), type: "session.start", owner: owner("worker:nex") })).toBe("personRequired");
    expect(refused(state, { tenantId: T1, actor: "system", at: at(), type: "session.start", owner: owner("system") })).toBe("personRequired");
    expect(refused(state, { tenantId: T1, actor: "otra", at: at(), type: "session.start", owner: owner("sol") })).toBe("invalid");
    expect(refused(state, { tenantId: T1, actor: "sol", at: at(), type: "session.start", owner: { id: "sol", name: "Sol", email: "mal" } })).toBe("invalid");
    expect(refused(state, { tenantId: "", actor: "sol", at: at(), type: "session.start", owner: owner() })).toBe("tenantRequired");
    const { state: ready, sessionId } = converse(state, T1, full());
    expect(refused(ready, { tenantId: T1, actor: "worker:nex", at: at(40), type: "install.confirm", sessionId })).toBe("personRequired");
    expect(refused(ready, { tenantId: T1, actor: "otro", at: at(40), type: "install.confirm", sessionId })).toBe("forbidden");
  });
  it("opens one assistant per company, installs once, and lets the customer cancel before", () => {
    const first = send(newArchitectState(), { tenantId: T1, actor: "sol", at: at(), type: "session.start", owner: owner() });
    expect(refused(first.state, { tenantId: T1, actor: "sol", at: at(1), type: "session.start", owner: owner() })).toBe("sessionOpen");
    const cancelled = send(first.state, { tenantId: T1, actor: "sol", at: at(2), type: "session.cancel", sessionId: first.session!.id });
    expect(cancelled.session!.status).toBe("cancelled");
    expect(refused(cancelled.state, { tenantId: T1, actor: "sol", at: at(3), type: "session.cancel", sessionId: first.session!.id })).toBe("invalidTransition");
    const again = converse(cancelled.state, T1, full());
    const done = send(again.state, { tenantId: T1, actor: "sol", at: at(30), type: "install.confirm", sessionId: again.sessionId });
    expect(refused(done.state, { tenantId: T1, actor: "sol", at: at(31), type: "install.confirm", sessionId: again.sessionId })).toBe("alreadyInstalled");
    expect(refused(done.state, { tenantId: T1, actor: "sol", at: at(32), type: "session.start", owner: owner() })).toBe("alreadyInstalled");
    expect(refused(done.state, { tenantId: T1, actor: "sol", at: at(33), type: "session.cancel", sessionId: again.sessionId })).toBe("invalidTransition");
  });
  it("lets the customer correct an answer and re-reads the recommendation", () => {
    const { state, sessionId } = converse(newArchitectState(), T1, full());
    const changed = send(state, { tenantId: T1, actor: "sol", at: at(25), type: "answer.submit", sessionId, questionId: "aiAppetite", value: "cautious" });
    expect(changed.recommendation!.agents.count).toBe(1);
    expect(changed.session!.status).toBe("ready");
    const renamed = send(changed.state, { tenantId: T1, actor: "sol", at: at(26), type: "answer.submit", sessionId, questionId: "businessName", value: "Mi Empresa" });
    const vague = send(renamed.state, { tenantId: T1, actor: "sol", at: at(27), type: "answer.submit", sessionId, questionId: "description", value: "hacemos cosas" });
    expect(vague.session!.status).toBe("asking");
    expect(vague.question!.id).toBe("sector");
    expect(estimatedMinutes(vague.session!.answers)).toBeLessThanOrEqual(4);
    expect(vague.recommendation).toBeNull();
  });
});

describe("every company is configured apart, and every step is audited", () => {
  it("installs two different companies into one set of records without mixing them", () => {
    const one = converse(newArchitectState(), T1, full(), owner("sol"));
    const first = send(one.state, { tenantId: T1, actor: "sol", at: at(30), type: "install.confirm", sessionId: one.sessionId });
    const two = converse(first.state, T2, full({ businessName: "Agencia Luz", description: "agencia de marketing y publicidad", teamSize: "medium", monthlyLeads: "from50to200", goal: "organizeClients" }), owner("luz", "Luz Mora"), 40);
    const second = send(two.state, { tenantId: T2, actor: "luz", at: at(70), type: "install.confirm", sessionId: two.sessionId, parts: first.installation!.parts });
    const parts = second.installation!.parts;
    expect(new Set(parts.org.orgs.map((item) => item.tenantId))).toEqual(new Set([T1, T2]));
    expect(parts.billing.accounts.map((item) => `${item.tenantId}:${item.planId}`).sort()).toEqual([`${T1}:${first.session!.planId}`, `${T2}:${second.session!.planId}`].sort());
    expect(second.session!.planId).toBe("professional");
    expect(operatingDashboard({ parts, executions: [] }, T2, at(80)).people.workers).toBe(second.session!.installed!.workers);
    expect(parts.org.users.filter((item) => item.tenantId === T1).map((item) => item.id)).toEqual(["sol"]);
    expect(parts.studio.assets.filter((item) => item.tenantId === T2).length).toBe(second.session!.installed!.agents * 2);
    expect(second.state.sessions.map((item) => item.tenantId)).toEqual([T1, T2]);
    expect(refused(second.state, { tenantId: T2, actor: "luz", at: at(90), type: "session.cancel", sessionId: one.sessionId })).toBe("notFound");
  });
  it("audits every accepted event once, with no personal data, and nothing for a refused one", () => {
    const { state, sessionId } = converse(newArchitectState(), T1, full());
    expect(state.audit.map((item) => item.action)).toEqual(["session.start", ...Array(7).fill("answer.submit")]);
    const done = send(state, { tenantId: T1, actor: "sol", at: at(30), type: "install.confirm", sessionId });
    expect(done.state.audit.at(-1)).toMatchObject({ action: "install.confirm", tenantId: T1, actor: "sol" });
    expect(JSON.stringify(done.state.audit)).not.toMatch(/@|Clínica Sol|dental/);
    const bad = reduceArchitect(done.state, { tenantId: T1, actor: "worker:nex", at: at(31), type: "session.cancel", sessionId });
    expect(bad.state.audit).toHaveLength(done.state.audit.length);
  });
  it("is deterministic", () => {
    const run = () => { const { state, sessionId } = converse(newArchitectState(), T1, full()); return send(state, { tenantId: T1, actor: "sol", at: at(30), type: "install.confirm", sessionId }); };
    const a = run();
    const b = run();
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
    expect(JSON.stringify(a.installation!.parts)).toBe(JSON.stringify(b.installation!.parts));
    expect(applyArchitectEvents(newArchitectState(), []).errors).toEqual([]);
  });
});

describe("it goes through the Event Bus and respects the RLS design, without touching the Backend Core", () => {
  const bridge: Bridge<ArchitectState, ArchitectEvent, ReturnType<typeof reduceArchitect>> = {
    id: "business-architect", label: "AI Business Architect", modules: ["organizations"], reduce: reduceArchitect,
    streams: (state) => [{ name: "audit", module: "organizations", entries: state.audit }], tenantOf: (event) => event.tenantId, actorOf: (event) => event.actor, typeOf: (event) => event.type,
  };
  it("publishes every accepted step on the bus under its company and covers every audit record", async () => {
    let clock = Date.parse("2026-11-11T12:00:00.000Z");
    const core = createBackendCore({ vars: { KYNOVA_ENCRYPTION_KEY: generateEncryptionKey(), KYNOVA_HASH_PEPPER: "p".repeat(40) }, now: () => (clock += 7), clock: () => new Date((clock += 7)).toISOString() });
    const connector = new Connector(core, bridge, newStats());
    let state = newArchitectState();
    const go = async (event: ArchitectEvent) => { const result = await connector.reduce(state, event); state = result.state; return result; };
    const started = await go({ tenantId: T1, actor: "sol", at: at(), type: "session.start", owner: owner() });
    await go({ tenantId: T1, actor: "sol", at: at(1), type: "answer.submit", sessionId: started.session!.id, questionId: "businessName", value: "Clínica Sol" });
    expect((await go({ tenantId: T1, actor: "worker:nex", at: at(2), type: "answer.submit", sessionId: started.session!.id, questionId: "description", value: "una clínica" })).error).toBeDefined();
    await go({ tenantId: T2, actor: "luz", at: at(3), type: "session.start", owner: owner("luz", "Luz Mora") });
    const events = (await core.events()).store.read({ tenantId: T1, after: 0, limit: 100 });
    expect(events.map((item) => item.payload["action"])).toEqual(["session.start", "answer.submit"]);
    expect((await core.events()).store.read({ tenantId: T2, after: 0, limit: 100 })).toHaveLength(1);
    expect(await verifyCoverage(core, T1)).toMatchObject({ ok: true });
  });
  it("describes two company tables whose policies filter by company, the trail append-only", () => {
    const columns = ["id:uuid", "tenant_id:uuid", "created_at:timestamptz"].map((spec) => { const [name, type] = spec.split(":"); return { name: name!, type: type as "uuid", nullable: false, pii: false }; });
    const entities: Entity[] = ARCHITECT_TABLES.map((item) => ({ table: item.table, module: "organizations" as const, scope: "tenant" as const, status: "planned" as const, rls: "read" as const, appendOnly: item.appendOnly, columns, description: "architect" }));
    expect(auditPolicies(entities)).toEqual([]);
    expect(ARCHITECT_TABLES.map((item) => item.table)).toEqual(["architect_sessions", "architect_audit"]);
  });
});

describe("it adds no module, no rule and no real AI", () => {
  const source = readFileSync(join(process.cwd(), "lib/contracts/platform/business-architect.ts"), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  it("imports only the existing platform contracts: no AI Gateway, KOE's AI, provider, database or Backend Core, and makes no network call", () => {
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(imports.every((item) => item.startsWith("./"))).toBe(true);
    expect(imports.filter((item) => /gateway|koe-ai|agent|financial-router|lib\/ai|backend|\/db/.test(item))).toEqual([]);
    expect(source).not.toMatch(/\bfetch\(|process\.env|XMLHttpRequest|WebSocket|apiKey|openai|anthropic|gemini/i);
  });
  it("installs through the existing installer and defines no reducer of any other module", () => {
    expect(source).toMatch(/installBusinessTemplate\(/);
    expect(source.match(/export function reduce\w+/g)).toEqual(["export function reduceArchitect"]);
    expect(emptyParts().org.orgs).toEqual([]);
  });
});
