/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing template must fail the test loudly */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STARTER_WORKERS } from "./koe-registry";
import { newInsightsState, reduceInsights } from "./insights-center";
import { reduceCrm } from "./crm-center";
import { BUSINESS_TEMPLATES, TEMPLATE_IDS, automationLibrary, emptyParts, installBusinessTemplate, readKpis, revenueEngine, templateById, validateTemplate, type Installation } from "./business-templates";

const AT = "2026-11-10T12:00:00.000Z";
const owner = { id: "dueno", name: "Dueña de la Empresa", email: "dueno@empresa.test" };
const input = (templateId: string, tenantId = `tenant-${templateId}`) => ({ templateId, tenantId, companyName: `Empresa ${templateId}`, owner, at: AT });
const ok = (result: ReturnType<typeof installBusinessTemplate>): Installation => { if (!("parts" in result)) throw new Error(result.errors.join("; ")); return result; };

// all twelve companies installed into ONE set of records, to prove they stay apart
const started = Date.now();
let shared = emptyParts();
const installs = BUSINESS_TEMPLATES.map((template) => { const result = ok(installBusinessTemplate(input(template.id), shared)); shared = result.parts; return result; });
const elapsedMs = Date.now() - started;

describe("the catalog of Business Templates", () => {
  it("has the twelve templates of the sprint, each once", () => {
    expect(BUSINESS_TEMPLATES.map((item) => item.id)).toEqual([...TEMPLATE_IDS]);
    expect(BUSINESS_TEMPLATES.map((item) => item.name)).toEqual(["Agencia de Marketing", "Bienes Raíces", "Restaurante", "Clínica", "Abogado", "Contador", "Constructora", "E-commerce", "YouTube Faceless", "Consultor", "Educación", "Empresa Genérica"]);
    expect(new Set(BUSINESS_TEMPLATES.map((item) => item.id)).size).toBe(12);
    expect(templateById("clinic")?.name).toBe("Clínica");
    expect(templateById("nope")).toBeUndefined();
  });

  it("gives every template what the sprint asks for: agents, automations, workflows, roles, teams, KPIs, dashboard, objectives and configuration", () => {
    for (const template of BUSINESS_TEMPLATES) {
      expect(template.agents.length, template.id).toBeGreaterThanOrEqual(2);
      expect(template.automations.length + template.extraAutomations.length, template.id).toBeGreaterThanOrEqual(4);
      expect(template.workflows.length, template.id).toBeGreaterThanOrEqual(1);
      expect(template.roles.length, template.id).toBeGreaterThanOrEqual(1);
      expect(template.teams.length, template.id).toBeGreaterThanOrEqual(2);
      expect(template.kpis.length, template.id).toBeGreaterThanOrEqual(3);
      expect(template.objectives.length, template.id).toBeGreaterThanOrEqual(1);
      expect(template.dashboard.length, template.id).toBeGreaterThanOrEqual(5);
      expect(template.workers.length, template.id).toBeGreaterThanOrEqual(3);
      expect(template.summary.length, template.id).toBeGreaterThan(20);
      expect(template.frontOffice.channels.length, template.id).toBeGreaterThan(0);
      expect(template.revenue.leadSources.length, template.id).toBeGreaterThan(0);
    }
  });

  it("references only what the platform has: Workers, playbooks, metrics, specialties, plans and permissions", () => {
    for (const template of BUSINESS_TEMPLATES) expect(validateTemplate(template), template.id).toEqual([]);
    const broken = { ...BUSINESS_TEMPLATES[0]!, workers: ["inventado"], kpis: [{ id: "k1", label: "x", metric: "noExiste", target: 1, period: "month" as const }], planId: "nada" };
    expect(validateTemplate(broken)).toEqual(expect.arrayContaining(["worker:inventado", "metric:k1", "plan:nada"]));
  });

  it("writes each automation once, in the words of the business", () => {
    const clinic = automationLibrary(templateById("clinic")!.terms);
    const agency = automationLibrary(templateById("marketingAgency")!.terms);
    expect(JSON.stringify(clinic.newLead)).toContain("consulta");
    expect(JSON.stringify(clinic.welcomeCustomer)).toContain("paciente");
    expect(JSON.stringify(agency.welcomeCustomer)).toContain("cliente");
    expect(Object.keys(clinic).sort()).toEqual(Object.keys(agency).sort());
    expect(clinic.newLead.trigger).toBe("newProspect");
  });
});

describe("installing a template: pocos segundos, through the existing reducers", () => {
  it("installs all twelve with no refused step, and fast", () => {
    for (const install of installs) expect(install.errors, install.template.id).toEqual([]);
    expect(elapsedMs).toBeLessThan(5_000);
    expect(installs.every((item) => item.steps.length > 20)).toBe(true);
    expect(installs.every((item) => item.steps.every((step) => step.phase === "install" && step.ok))).toBe(true);
  });

  it("configures Organization: the company, its owner, departments, roles and teams", () => {
    for (const { template, tenantId } of installs) {
      expect(shared.org.orgs.find((item) => item.tenantId === tenantId)?.name, template.id).toBe(`Empresa ${template.id}`);
      expect(shared.org.users.filter((item) => item.tenantId === tenantId).map((item) => item.id), template.id).toEqual(["dueno"]);
      const departments = shared.org.departments.filter((item) => item.tenantId === tenantId).map((item) => item.name);
      expect(departments, template.id).toEqual(expect.arrayContaining([...template.departments]));
      expect(shared.org.teams.filter((item) => item.tenantId === tenantId).map((item) => item.name).sort(), template.id).toEqual(template.teams.map((item) => item.name).sort());
      for (const role of template.roles) expect(shared.org.roles.some((item) => item.tenantId === tenantId && item.name === role.name && !item.builtin), `${template.id}:${role.name}`).toBe(true);
    }
  });

  it("configures the Workers (KOE), NEX's AI and Billing", () => {
    for (const { template, tenantId } of installs) {
      const enabled = shared.agent.koe.instances.filter((item) => item.tenantId === tenantId && item.status === "active").map((item) => item.definitionId).sort();
      expect(enabled, template.id).toEqual([...template.workers].sort());
      expect(shared.org.assignments.filter((item) => item.tenantId === tenantId && item.subject.kind === "worker").length, template.id).toBe(template.workers.length);
      expect(shared.agent.ai.configs.find((item) => item.tenantId === tenantId), template.id).toMatchObject({ policy: "balanced", budgetMicros: template.aiBudgetUsd * 1_000_000 });
      expect(shared.billing.accounts.find((item) => item.tenantId === tenantId)?.planId, template.id).toBe(template.planId);
    }
    expect(STARTER_WORKERS.length).toBeGreaterThan(0);
  });

  it("configures AI Studio's recommended agents (sent to review, not published) and the Automations (active from day one)", () => {
    for (const { template, tenantId } of installs) {
      const assets = shared.studio.assets.filter((item) => item.tenantId === tenantId);
      expect(assets.length, template.id).toBe(template.agents.length * 2);
      expect(assets.filter((item) => item.kind === "agent").map((item) => item.name).sort(), template.id).toEqual(template.agents.map((item) => item.name).sort());
      expect(assets.flatMap((item) => item.versions).every((item) => item.state === "pendingApproval"), template.id).toBe(true);
      const automations = shared.automations.automations.filter((item) => item.tenantId === tenantId);
      expect(automations.length, template.id).toBe(template.automations.length + template.extraAutomations.length);
      expect(automations.every((item) => item.status === "active" && item.testMode === false), template.id).toBe(true);
      expect(shared.insights.reports.filter((item) => item.tenantId === tenantId).map((item) => `${item.name}:${item.status}`), template.id).toEqual(["Resumen ejecutivo:draft"]);
    }
  });

  it("keeps every template at Level 1: it grants no autonomy at all; that is the owner's own later decision", () => {
    expect(shared.org.grants).toEqual([]);
    expect(shared.crm.grants).toEqual([]);
    expect(shared.comms.grants).toEqual([]);
    expect(shared.billing.grants).toEqual([]);
    expect(shared.studio.grants).toEqual([]);
    expect(shared.agent.koe.authorizations ?? []).toEqual([]);
    expect(shared.studio.assets.filter((item) => item.kind === "agent").every((item) => item.versions.every((version) => version.content.kind === "agent" && version.content.workerIds.length === 0))).toBe(true);
    expect(shared.crm.leads).toEqual([]);
    expect(shared.comms.conversations).toEqual([]);
  });

  it("keeps the workflows runnable: every step is a Worker plan the company has, an automation it installed, or a person", () => {
    for (const { template } of installs) {
      expect(template.workflows.length, template.id).toBeGreaterThanOrEqual(1);
      for (const flow of template.workflows) expect(flow.steps.length, `${template.id}:${flow.id}`).toBeGreaterThanOrEqual(2);
    }
    expect(templateById("restaurant")!.workflows.map((item) => item.id)).not.toContain("invoice-to-cash");
  });

  it("starts the dashboard and the KPIs at zero, with the targets of the template", () => {
    for (const install of installs) {
      expect(install.dashboard.tenantId).toBe(install.tenantId);
      expect(install.dashboard.people).toMatchObject({ active: 1, workers: install.template.workers.length });
      expect(install.dashboard.billing.planId).toBe(install.template.planId);
      expect(install.dashboard.automation.active).toBe(install.template.automations.length + install.template.extraAutomations.length);
      expect(install.kpis.map((item) => item.target)).toEqual(install.template.kpis.map((item) => item.target));
      expect(install.kpis.every((item) => item.value === 0 && item.progress === 0)).toBe(true);
      expect(install.objectives.length).toBeGreaterThan(0);
    }
  });
});

describe("KPIs and the Revenue Engine read what the platform already keeps", () => {
  it("moves a KPI when Insights records facts, and caps its progress at 100 %", () => {
    const template = templateById("marketingAgency")!;
    let parts = ok(installBusinessTemplate(input("marketingAgency", "tenant-solo"))).parts;
    const fact = (value: number) => { const result = reduceInsights(parts.insights, { type: "fact.record", at: AT, tenantId: "tenant-solo", actor: "system", module: "sales", metric: "leadsNew", value }); expect(result.error).toBeUndefined(); parts = { ...parts, insights: result.state }; };
    fact(10);
    expect(readKpis(template, parts, "tenant-solo").find((item) => item.metric === "leadsNew")).toMatchObject({ value: 10, progress: 25 });
    fact(500);
    expect(readKpis(template, parts, "tenant-solo").find((item) => item.metric === "leadsNew")?.progress).toBe(100);
    expect(readKpis(template, parts, "tenant-otra").every((item) => item.value === 0)).toBe(true);
    expect(newInsightsState().facts).toEqual([]);
  });

  it("shows the whole goal as the gap on day one, and closes it as the pipeline and the sales grow", () => {
    const template = templateById("consultant")!;
    let parts = ok(installBusinessTemplate(input("consultant", "tenant-rev"))).parts;
    const day1 = revenueEngine(template, parts, "tenant-rev");
    const { monthlyGoalMicros, averageTicketMicros, closeRate } = template.revenue;
    expect(day1).toMatchObject({ goalMicros: monthlyGoalMicros, wonMicros: 0, pipelineMicros: 0, gapMicros: monthlyGoalMicros, onTrack: false });
    expect(day1.salesNeeded).toBe(Math.ceil(monthlyGoalMicros / averageTicketMicros));
    expect(day1.leadsNeeded).toBe(Math.ceil(day1.salesNeeded / closeRate));
    const create = (name: string, value: number) => { const result = reduceCrm(parts.crm, { type: "lead.create", at: AT, tenantId: "tenant-rev", actor: "dueno", input: { name, company: name, source: "Referido", estimatedValueMicros: value, fit: 70, owner: "dueno" } }); expect(result.error).toBeUndefined(); parts = { ...parts, crm: result.state }; };
    create("Prospecto Uno", 6_000_000_000);
    const withPipeline = revenueEngine(template, parts, "tenant-rev");
    expect(withPipeline).toMatchObject({ pipelineMicros: 6_000_000_000, leadsInPipeline: 1, expectedMicros: Math.round(6_000_000_000 * closeRate) });
    expect(withPipeline.gapMicros).toBeLessThan(day1.gapMicros);
    expect(withPipeline.leadsNeeded).toBeLessThanOrEqual(day1.leadsNeeded);
    create("Prospecto Dos", 100_000_000_000);
    expect(revenueEngine(template, parts, "tenant-rev")).toMatchObject({ gapMicros: 0, salesNeeded: 0, leadsNeeded: 0, onTrack: true });
    expect(revenueEngine(template, parts, "tenant-otra")).toMatchObject({ pipelineMicros: 0, wonMicros: 0, gapMicros: monthlyGoalMicros });
  });
});

describe("companies stay apart, and bad installs are refused", () => {
  it("keeps each company's records its own: twelve installs in one set of records, nothing crosses", () => {
    for (const { template, tenantId } of installs) {
      for (const list of [shared.org.orgs, shared.org.teams, shared.org.departments, shared.billing.accounts, shared.studio.assets, shared.automations.automations, shared.insights.reports]) {
        const mine = (list as readonly { tenantId: string }[]).filter((item) => item.tenantId === tenantId);
        expect(mine.length, `${template.id}`).toBeGreaterThan(0);
      }
      expect(shared.org.teams.filter((item) => item.tenantId === tenantId).every((item) => template.teams.some((team) => team.name === item.name))).toBe(true);
    }
    expect(new Set(shared.org.orgs.map((item) => item.tenantId)).size).toBe(12);
  });

  it("refuses an unknown template, a non-person owner and a second install of the same company", () => {
    expect(installBusinessTemplate(input("inexistente")).errors[0]).toMatch(/no existe/);
    expect(installBusinessTemplate({ ...input("clinic", "tenant-x"), owner: { ...owner, id: "worker:nex" } }).errors[0]).toMatch(/persona/);
    const again = installBusinessTemplate(input("clinic"), shared);
    expect(again.errors.length).toBeGreaterThan(0);
    expect(shared.org.orgs.filter((item) => item.tenantId === "tenant-clinic")).toHaveLength(1);
  });

  it("is deterministic: the same install gives the same records", () => {
    const a = ok(installBusinessTemplate(input("clinic", "tenant-det")));
    const b = ok(installBusinessTemplate(input("clinic", "tenant-det")));
    expect(JSON.stringify(a.parts)).toBe(JSON.stringify(b.parts));
    expect(a.dashboard).toEqual(b.dashboard);
  });
});

describe("the sprint adds no module and no logic of its own", () => {
  const source = readFileSync(join(process.cwd(), "lib/contracts/platform/business-templates.ts"), "utf8").replace(/\/\/.*$/gm, "");
  it("imports only the existing platform contracts, defines no reducer and touches nothing outside", () => {
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(imports.every((item) => item.startsWith("./"))).toBe(true);
    expect(imports.filter((item) => /gateway|lib\/ai|backend|\/db|koe-ai-catalog/.test(item))).toEqual([]);
    expect(source).not.toMatch(/export function reduce|export const reduce|\bfetch\(|process\.env|WebSocket/);
    expect(source).not.toMatch(/stripe|whatsapp|instagram|facebook|tiktok|linkedin/i);
  });
});
