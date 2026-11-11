/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateEncryptionKey } from "@/lib/backend/crypto";
import { createBackendCore } from "@/lib/backend/index";
import { connectPlatform } from "@/lib/backend/integration";
import { PLANS } from "./billing-catalog";
import { reduceCrm } from "./crm-center";
import { isPerson } from "./actors";
import { BETA_TENANTS, REAL_DATA_GATES, runInternalBeta } from "./internal-beta";

const beta = runInternalBeta();
const { parts } = beta;
const ids = BETA_TENANTS.map((item) => item.id);
const of = (slug: string) => beta.tenants.find((item) => item.spec.slug === slug)!;
const mine = <T extends { tenantId: string }>(items: readonly T[], tenantId: string) => items.filter((item) => item.tenantId === tenantId);

describe("KYNOVA creates the four companies with its own platform", () => {
  it("runs the whole beta with no refused step: whatever it does, a module accepted", () => {
    expect(beta.errors).toEqual([]);
    expect(beta.steps.length).toBeGreaterThan(150);
    expect(beta.steps.every((step) => step.ok)).toBe(true);
  });
  it("creates Nova Marketing Studio, PSI Sostenible, Real Estate and YouTube Studio", () => {
    expect(BETA_TENANTS.map((item) => item.name)).toEqual(["Nova Marketing Studio", "PSI Sostenible", "Real Estate", "YouTube Studio"]);
    expect(parts.org.orgs.map((item) => item.name).sort()).toEqual(["Nova Marketing Studio", "PSI Sostenible", "Real Estate", "YouTube Studio"]);
    expect(new Set(parts.org.orgs.map((item) => item.tenantId))).toEqual(new Set(ids));
  });
  it("creates each one through the AI Business Architect: a few questions, a ready preview and one confirmation by the owner", () => {
    expect(beta.architect.sessions.map((item) => item.status)).toEqual(["installed", "installed", "installed", "installed"]);
    for (const item of beta.tenants) {
      expect(item.questionsAnswered, item.spec.name).toBeLessThanOrEqual(8);
      expect(item.template.id, item.spec.name).toBe(item.spec.expectedTemplate);
      const session = beta.architect.sessions.find((row) => row.tenantId === item.spec.id)!;
      expect(session).toMatchObject({ ownerId: item.spec.owner.id, templateId: item.spec.expectedTemplate, planId: item.planId });
      expect(item.installedSteps).toBeGreaterThanOrEqual(25);
    }
    expect(of("psi").questionsAnswered).toBe(8); // the sector was asked because the description did not make the business clear
    expect(of("nova").questionsAnswered).toBe(7);
    expect(beta.architect.audit.map((item) => item.action).filter((item) => item === "install.confirm")).toHaveLength(4);
  });
  it("gives each company the Business Template, plan, Workers, AI agents, automations, Insights and a dashboard the Architect recommended", () => {
    for (const item of beta.tenants) {
      const tenantId = item.spec.id;
      expect(parts.billing.accounts.find((row) => row.tenantId === tenantId)?.planId, item.spec.name).toBe(item.planId);
      expect(mine(parts.agent.koe.instances, tenantId).filter((row) => row.status === "active").length, item.spec.name).toBeGreaterThanOrEqual(2);
      expect(mine(parts.studio.assets, tenantId).filter((row) => row.kind === "agent").length, item.spec.name).toBeGreaterThanOrEqual(1);
      expect(mine(parts.automations.automations, tenantId).filter((row) => row.status === "active").length, item.spec.name).toBeGreaterThanOrEqual(4);
      expect(mine(parts.insights.reports, tenantId).length, item.spec.name).toBeGreaterThanOrEqual(1);
      expect(mine(parts.org.teams, tenantId).length, item.spec.name).toBeGreaterThanOrEqual(1);
      expect(item.dashboard.tenantId).toBe(tenantId);
      expect(item.kpis.length, item.spec.name).toBeGreaterThanOrEqual(3);
      expect(item.revenue.goalMicros, item.spec.name).toBeGreaterThan(0);
    }
    expect(of("yt").planId).toBe("starter");
    expect(of("nova").planId).toBe("professional");
  });
  it("has a second person per company who approves what the owner prepared, so the agents and prompts are published by two people", () => {
    for (const item of beta.tenants) {
      const users = mine(parts.org.users, item.spec.id).map((row) => row.id).sort();
      expect(users, item.spec.name).toEqual([item.spec.owner.id, `${item.spec.slug}-equipo`].sort());
      const versions = mine(parts.studio.assets, item.spec.id).flatMap((row) => row.versions);
      expect(versions.every((row) => row.state === "published"), item.spec.name).toBe(true);
      expect(versions.every((row) => isPerson(row.decidedBy ?? "")), item.spec.name).toBe(true);
      expect(versions.every((row) => row.decidedBy !== row.createdBy)).toBe(true);
    }
  });
});

describe("the real use cases of each business run on existing modules", () => {
  it("covers every use case the sprint lists, for every company", () => {
    for (const item of beta.tenants) {
      expect(Object.keys(item.useCaseEvidence).sort(), item.spec.name).toEqual([...item.spec.useCases].sort());
      expect(Object.values(item.useCaseEvidence).every((text) => text.length > 10), item.spec.name).toBe(true);
    }
    expect(of("nova").spec.useCases).toEqual(["Captación de clientes", "Seguimiento", "SEO", "Campañas", "Redes Sociales"]);
    expect(of("psi").spec.useCases).toEqual(["Prospectos B2B", "Seguimiento comercial", "Cotizaciones", "Productos", "Distribuidores"]);
    expect(of("re").spec.useCases).toEqual(["Propiedades", "Leads", "Seguimiento", "Agenda", "Cierre"]);
    expect(of("yt").spec.useCases).toEqual(["Producción", "Calendario", "Guiones", "Miniaturas", "Publicaciones", "Analíticas"]);
  });
  it("Nova Marketing Studio: captures clients (SEO, ads, referrals), follows up, and works SEO, campaigns and social content through AI Studio and KOE", () => {
    const id = of("nova").spec.id;
    const leads = mine(parts.crm.leads, id);
    expect(leads.map((row) => row.source).sort()).toEqual(["Campaña de anuncios", "Redes sociales (manual)", "Referido", "SEO"]);
    expect(mine(parts.automations.runs, id).length).toBeGreaterThanOrEqual(2);
    expect(mine(parts.studio.assets, id).map((row) => row.name)).toEqual(expect.arrayContaining(["Auditoría SEO", "Brief de campaña", "Calendario de redes"]));
    expect(mine(parts.studio.tests, id).length).toBe(3);
    expect(mine(parts.crm.timeline, id).length).toBeGreaterThan(0);
    expect(mine(parts.agent.sessions, id).map((row) => row.playbookId)).toEqual(["followup.nudge"]);
    expect(mine(parts.insights.facts, id).some((row) => row.metric === "organicVisits")).toBe(true);
  });
  it("PSI Sostenible: B2B prospects and distributors, quotes prepared for a person to approve, a product catalog, a distributor won and converted", () => {
    const id = of("psi").spec.id;
    expect(mine(parts.crm.leads, id).map((row) => row.source).sort()).toEqual(["Distribuidor", "Distribuidor", "Feria", "Prospecto B2B", "Prospecto B2B"]);
    expect(mine(parts.crm.customers, id)).toHaveLength(1);
    expect(mine(parts.crm.customers, id)[0]!.company).toBe("Distribuidora Norte");
    const draft = mine(parts.comms.drafts, id)[0]!;
    expect(draft.status).toBe("ready");
    expect(isPerson(draft.decidedBy ?? "")).toBe(true);
    expect(mine(parts.comms.entries, id).filter((row) => row.direction === "out").every((row) => isPerson(row.actor))).toBe(true);
    expect(mine(parts.studio.assets, id).map((row) => row.name)).toContain("Catálogo de productos");
    expect(mine(parts.automations.automations, id).map((row) => row.name)).toContain("Cotización enviada: recordatorio");
    expect(mine(parts.insights.facts, id).find((row) => row.metric === "proposalsSent")?.value).toBe(2);
  });
  it("Real Estate: property sheets, leads from portals and referrals, visits on the calendar, and a sale closed", () => {
    const id = of("re").spec.id;
    expect(mine(parts.studio.assets, id).map((row) => row.name)).toContain("Fichas de propiedades");
    expect(mine(parts.crm.leads, id)).toHaveLength(4);
    expect(mine(parts.crm.meetings, id).map((row) => row.title)).toEqual(["Visita a casa en Escazú", "Visita al terreno en Heredia"]);
    expect(mine(parts.crm.leads, id).filter((row) => row.stage === "won")).toHaveLength(1);
    expect(mine(parts.crm.customers, id)).toHaveLength(1);
    expect(mine(parts.agent.sessions, id).map((row) => row.playbookId).sort()).toEqual(["followup.nudge", "sales.qualify"]);
    expect(mine(parts.agent.sessions, id).every((row) => row.status === "completed")).toBe(true);
  });
  it("YouTube Studio: scripts, thumbnails and an editorial calendar, production tasks with due dates, a sponsor, and analytics with an approved report", () => {
    const id = of("yt").spec.id;
    expect(mine(parts.studio.assets, id).map((row) => row.name)).toEqual(expect.arrayContaining(["Guion de video", "Brief de miniatura", "Calendario editorial"]));
    expect(mine(parts.studio.tests, id)).toHaveLength(3);
    const outputs = mine(parts.automations.outputs, id);
    expect(outputs.filter((row) => row.kind === "task").length).toBeGreaterThanOrEqual(6);
    expect(outputs.filter((row) => row.kind === "task" && row.dueAt).length).toBeGreaterThanOrEqual(6);
    expect(outputs.some((row) => row.status === "done")).toBe(true);
    expect(mine(parts.crm.leads, id)[0]!.source).toBe("Patrocinio");
    expect(mine(parts.insights.facts, id).find((row) => row.metric === "organicVisits")?.value).toBe(31_500);
    expect(mine(parts.insights.reports, id).find((row) => row.name === "Analíticas del canal")?.status).toBe("approved");
    expect(mine(parts.agent.sessions, id).map((row) => row.playbookId)).toEqual(["reporter.daily"]);
  });
  it("gives every company CRM, Communications and Billing activity in the same working day", () => {
    for (const item of beta.tenants) {
      expect(mine(parts.crm.leads, item.spec.id).length, item.spec.name).toBeGreaterThan(0);
      expect(mine(parts.comms.conversations, item.spec.id).length, item.spec.name).toBeGreaterThan(0);
      expect(mine(parts.comms.conversations, item.spec.id).some((row) => row.status === "resolved"), item.spec.name).toBe(true);
      expect(mine(parts.billing.analyses, item.spec.id).length, item.spec.name).toBe(1);
      expect(mine(parts.agent.sessions, item.spec.id).length, item.spec.name).toBeGreaterThanOrEqual(1);
    }
  });
});

describe("KYNOVA administers the four companies", () => {
  it("shows its portfolio: each company, its plan, pipeline and activity, and the recurring revenue KYNOVA bills them", () => {
    expect(beta.portfolio.map((row) => row.name)).toEqual(["Nova Marketing Studio", "PSI Sostenible", "Real Estate", "YouTube Studio"]);
    const expected = beta.portfolio.reduce((total, row) => total + PLANS.find((plan) => plan.id === row.plan)!.monthlyMicros, 0);
    expect(beta.mrrMicros).toBe(expected);
    expect(beta.mrrMicros).toBe(496_000_000);
    for (const row of beta.portfolio) {
      expect(row.leadsOpen + row.customers, row.name).toBeGreaterThan(0);
      expect(row.automationRuns, row.name).toBeGreaterThan(0);
      expect(row.agentSessions, row.name).toBeGreaterThan(0);
      expect(Object.values(row.health).every((item) => item === "good" || item === "attention")).toBe(true);
    }
    expect(beta.portfolio.find((row) => row.name === "PSI Sostenible")!.pipelineMicros).toBeGreaterThan(25_000_000_000);
  });
  it("keeps Level 1 everywhere: nothing was authorized, and only people approved, sent or published", () => {
    for (const list of [parts.org.grants, parts.crm.grants, parts.comms.grants, parts.billing.grants, parts.studio.grants]) expect(list).toEqual([]);
    expect(parts.agent.koe.approvals.every((row) => row.status !== "pending")).toBe(true);
    expect(parts.agent.koe.approvals.filter((row) => row.decidedBy).every((row) => isPerson(row.decidedBy ?? ""))).toBe(true);
    expect(parts.comms.entries.filter((row) => row.direction === "out").every((row) => isPerson(row.actor))).toBe(true);
    expect(parts.crm.tasks.filter((row) => row.status !== "proposed" && row.status !== "dismissed").every((row) => isPerson(row.decidedBy ?? ""))).toBe(true);
    expect(parts.billing.proposals.every((row) => row.status === "proposed" || isPerson(row.decidedBy ?? ""))).toBe(true);
  });
  it("is deterministic: the same beta gives the same portfolio and the same records", () => {
    const again = runInternalBeta();
    expect(JSON.stringify(again.portfolio)).toBe(JSON.stringify(beta.portfolio));
    expect(again.steps.map((row) => `${row.module}:${row.event}:${row.ok}`)).toEqual(beta.steps.map((row) => `${row.module}:${row.event}:${row.ok}`));
  });
});

describe("the four companies never see each other", () => {
  it("keeps every record under its own company, and each company's totals add up to the whole", () => {
    const groups: [string, readonly { tenantId: string }[]][] = [
      ["leads", parts.crm.leads], ["customers", parts.crm.customers], ["conversations", parts.comms.conversations], ["accounts", parts.billing.accounts], ["assets", parts.studio.assets], ["automations", parts.automations.automations],
      ["sessions", parts.agent.sessions], ["users", parts.org.users], ["facts", parts.insights.facts], ["reports", parts.insights.reports],
    ];
    for (const [name, list] of groups) {
      expect(list.every((row) => ids.includes(row.tenantId)), name).toBe(true);
      expect(ids.reduce((total, id) => total + mine(list, id).length, 0), name).toBe(list.length);
    }
    expect(beta.tenants.reduce((total, item) => total + item.dashboard.sales.leadsOpen + item.dashboard.sales.leadsWon, 0)).toBe(parts.crm.leads.length);
  });
  it("refuses an operation on another company's record", () => {
    const novaLead = mine(parts.crm.leads, of("nova").spec.id)[0]!;
    const result = reduceCrm(parts.crm, { tenantId: of("psi").spec.id, actor: "psi-owner", at: "2026-11-12T13:00:00.000Z", type: "stage.move", leadId: novaLead.id, to: "qualified" });
    expect(result.error).toBeDefined();
    expect(result.state).toBe(parts.crm);
  });
  it("sends every company's audit trails through the Event Bus under that company, with full coverage", async () => {
    let clock = Date.parse("2026-11-12T14:00:00.000Z");
    const core = createBackendCore({ vars: { KYNOVA_ENCRYPTION_KEY: generateEncryptionKey(), KYNOVA_HASH_PEPPER: "p".repeat(40) }, now: () => (clock += 7), clock: () => new Date((clock += 7)).toISOString() });
    const platform = connectPlatform(core);
    const carried = [
      await platform.backfill("crm", parts.crm), await platform.backfill("communications", parts.comms), await platform.backfill("billing", parts.billing), await platform.backfill("organizations", parts.org),
      await platform.backfill("insights", parts.insights), await platform.backfill("automations", parts.automations), await platform.backfill("studio", parts.studio),
    ];
    expect(carried.every((count) => count > 0)).toBe(true);
    for (const id of ids) {
      const events = (await core.events()).store.read({ tenantId: id, after: 0, limit: 100_000 });
      expect(events.length, id).toBeGreaterThan(20);
      expect(events.every((row) => row.tenantId === id), id).toBe(true);
      expect(await platform.coverage(id), id).toMatchObject({ ok: true });
    }
  });
});

describe("nothing real is connected and no real data is held", () => {
  it("keeps real customers' data out: every gate of ADR-0006 is still open and every address is a sample one", () => {
    expect(REAL_DATA_GATES.map((item) => item.met)).toEqual([false, false, false, false]);
    const emails = [...parts.crm.leads.map((row) => row.email), ...parts.org.users.map((row) => row.email), ...BETA_TENANTS.map((row) => row.owner.email)].filter((item): item is string => !!item);
    expect(emails.length).toBeGreaterThan(20);
    expect(emails.every((item) => item.endsWith(".test"))).toBe(true);
  });
  it("connects no WhatsApp, Stripe, MakaPay or social network: channels are email, web chat and web form, payments are simulated, and social leads are only a typed label", () => {
    expect(new Set(parts.comms.conversations.map((row) => row.channel))).toEqual(new Set(["email", "webchat", "webform"]));
    expect(parts.billing.payments.every((row) => row.method === "simulatedCard" || row.method === "simulatedTransfer" || row.method === "credit")).toBe(true);
    expect(mine(parts.crm.leads, of("nova").spec.id).some((row) => row.source === "Redes sociales (manual)")).toBe(true);
    const source = readFileSync(join(process.cwd(), "lib/contracts/platform/internal-beta.ts"), "utf8").replace(/\/\/.*$/gm, "");
    expect(source).not.toMatch(/\bfetch\(|process\.env|XMLHttpRequest|WebSocket|whatsapp|stripe|makapay|apiKey/i);
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(imports.every((item) => item.startsWith("./"))).toBe(true);
    expect(imports.filter((item) => /gateway|koe-ai|financial-router|lib\/ai|backend|\/db/.test(item))).toEqual([]);
    expect(source.match(/export function reduce\w+/g)).toBeNull();
  });
});
