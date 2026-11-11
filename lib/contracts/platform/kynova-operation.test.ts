import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPerson } from "./actors";
import { CUSTOMER_TENANT, KYNOVA_DEPARTMENTS, KYNOVA_PEOPLE, KYNOVA_TENANT, KYNOVA_WORKERS, operatingDashboard, runKynovaOperation } from "./kynova-operation";

const op = runKynovaOperation();
const { parts, dashboard } = op;
const modules = (name: string) => op.steps.filter((step) => step.module === name);

describe("KYNOVA operates KYNOVA: the whole day goes through the platform that already exists", () => {
  it("is applied with no refused step: whatever the scenario does, a module accepted", () => {
    expect(op.errors).toEqual([]);
    expect(op.steps.length).toBeGreaterThan(300);
    expect(op.steps.every((step) => step.ok)).toBe(true);
  });

  it("uses every module the sprint asks for, and every phase of the day", () => {
    for (const name of ["org", "billing", "communications", "crm", "marketplace", "academy", "studio", "insights", "automations", "koe"]) expect(modules(name).length, name).toBeGreaterThan(0);
    for (const phase of ["setup", "leads", "followup", "support", "billing", "marketing", "content", "metrics", "meetings", "tasks"]) expect(op.steps.some((step) => step.phase === phase), phase).toBe(true);
  });

  it("creates the company: its owner, people, departments, teams and internal Workers", () => {
    expect(parts.org.orgs.find((item) => item.tenantId === KYNOVA_TENANT)?.name).toBe("KYNOVA");
    const users = parts.org.users.filter((item) => item.tenantId === KYNOVA_TENANT);
    expect(users.map((item) => item.id).sort()).toEqual(KYNOVA_PEOPLE.map((item) => item.id).sort());
    expect(users.every((item) => item.status === "active")).toBe(true);
    const departments = parts.org.departments.filter((item) => item.tenantId === KYNOVA_TENANT).map((item) => item.name);
    expect(departments).toEqual(expect.arrayContaining([...KYNOVA_DEPARTMENTS]));
    expect(parts.org.teams.filter((item) => item.tenantId === KYNOVA_TENANT).length).toBeGreaterThanOrEqual(5);
    const enabled = parts.agent.koe.instances.filter((item) => item.tenantId === KYNOVA_TENANT && item.status === "active").map((item) => item.definitionId).sort();
    expect(enabled).toEqual([...KYNOVA_WORKERS].sort());
    expect(parts.org.assignments.some((item) => item.subject.kind === "worker")).toBe(true);
  });

  it("configures billing, NEX's AI and the automations", () => {
    expect(dashboard.billing.planId).toBe("business");
    expect(parts.agent.ai.configs.find((item) => item.tenantId === KYNOVA_TENANT)).toMatchObject({ policy: "balanced", ownerId: "jeffrey" });
    expect(dashboard.automation.active).toBeGreaterThanOrEqual(6);
    expect(parts.studio.assets.filter((item) => item.tenantId === KYNOVA_TENANT).map((item) => item.name)).toEqual(expect.arrayContaining(["Primera respuesta a prospecto", "Agente comercial de KYNOVA", "Calendario de contenido"]));
  });

  it("simulates the day: leads, follow-up, support, billing, marketing, content, metrics, meetings and tasks", () => {
    expect(dashboard.sales).toMatchObject({ leadsToday: 5, leadsWon: 1, customers: 1, meetings: 2 });
    expect(dashboard.sales.pipelineMicros).toBeGreaterThan(0);
    expect(dashboard.tasks.done).toBeGreaterThan(0);
    expect(dashboard.support.resolved).toBe(1);
    expect(dashboard.support.draftsReady).toBeGreaterThan(0);
    expect(dashboard.billing.invoices).toBeGreaterThan(0);
    expect(dashboard.billing.paidMicros).toBeGreaterThan(0);
    expect(dashboard.marketing).toMatchObject({ approvedAssets: 4 });
    expect(dashboard.marketing.contentPublished).toBeGreaterThan(0);
    expect(dashboard.marketing.reportsApproved).toBe(1);
    expect(dashboard.marketplace).toMatchObject({ listingsLive: 2, sales: 2 });
    expect(dashboard.marketplace.earningsMinor).toBeGreaterThan(0);
    expect(dashboard.academy).toMatchObject({ courses: 1, certificates: 1 });
    expect(dashboard.automation.runs).toBeGreaterThanOrEqual(5);
    expect(dashboard.insights.automationsRun).toBeGreaterThan(0);
    expect(parts.insights.exports.length).toBe(1);
  });

  it("runs the AI only through KOE: every request is answered by the simulated Gateway, and the Workers' sessions finish", () => {
    expect(dashboard.ai.aiCalls).toBeGreaterThanOrEqual(5);
    expect(op.aiResults.filter((item) => item.error)).toEqual([]);
    expect(dashboard.ai.agentSessions).toBe(3);
    expect(dashboard.ai.agentSessionsCompleted).toBe(3);
    expect(dashboard.ai.approvalsWaiting).toBe(0);
    expect(dashboard.ai.aiCostMicros).toBeGreaterThan(0);
    for (const call of parts.agent.ai.gateway.calls) expect(call.tokenSource ?? "simulated").not.toBe("provider");
  });

  it("keeps the Constitution: NEX prepares, only people decide, approve and send", () => {
    expect(parts.agent.koe.approvals.every((item) => item.status !== "pending")).toBe(true);
    expect(parts.agent.koe.approvals.filter((item) => item.decidedBy).every((item) => isPerson(item.decidedBy ?? ""))).toBe(true);
    expect(parts.comms.entries.filter((item) => item.direction === "out").every((item) => isPerson(item.actor))).toBe(true);
    expect(parts.crm.tasks.filter((item) => item.status === "accepted" || item.status === "done").every((item) => isPerson(item.decidedBy ?? ""))).toBe(true);
    expect(parts.billing.payments.every((item) => isPerson(item.by))).toBe(true);
    expect(parts.billing.proposals.filter((item) => item.proposedBy === "worker:nex").every((item) => item.status === "proposed")).toBe(true);
    expect(parts.studio.assets.flatMap((item) => item.versions).filter((item) => item.state === "published").every((item) => isPerson(item.decidedBy ?? ""))).toBe(true);
  });

  it("is deterministic: the same day produces the same records and the same dashboard", () => {
    const again = runKynovaOperation();
    expect(again.dashboard).toEqual(dashboard);
    expect(again.steps.map((step) => `${step.module}:${step.event}:${step.ok}`)).toEqual(op.steps.map((step) => `${step.module}:${step.event}:${step.ok}`));
  });
});

describe("KYNOVA's records are only KYNOVA's", () => {
  it("shows another company nothing of KYNOVA's day, and shows KYNOVA nothing of the customer's", () => {
    const other = operatingDashboard(op, CUSTOMER_TENANT);
    expect(other.people.active).toBe(0);
    expect(other.sales).toMatchObject({ leadsOpen: 0, leadsToday: 0, leadsWon: 0, meetings: 0, customers: 0 });
    expect(other.support.open + other.support.resolved).toBe(0);
    expect(other.billing).toMatchObject({ invoices: 0, paidMicros: 0 });
    expect(other.automation.runs).toBe(0);
    expect(other.ai.aiCalls).toBe(0);
    expect(other.marketplace.listingsLive).toBe(0);
    // the customer bought from KYNOVA through the Marketplace: that purchase is all it holds, and it is not KYNOVA's operation
    expect(parts.market.purchases.every((item) => item.buyerTenantId === CUSTOMER_TENANT)).toBe(true);
    for (const list of [parts.crm.leads, parts.comms.conversations, parts.automations.runs, parts.org.users, parts.billing.accounts]) expect(list.every((item) => (item as { tenantId: string }).tenantId === KYNOVA_TENANT)).toBe(true);
  });
});

describe("the sprint adds nothing to the platform: it only scripts it", () => {
  const source = readFileSync(join(process.cwd(), "lib/contracts/platform/kynova-operation.ts"), "utf8").replace(/\/\/.*$/gm, "");
  it("imports only the existing platform contracts: no screen, no database, no provider, no Backend Core", () => {
    const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(imports.length).toBeGreaterThan(10);
    expect(imports.every((item) => item.startsWith("./"))).toBe(true);
    expect(imports.filter((item) => /gateway|lib\/ai|backend|db/.test(item))).toEqual([]);
  });

  it("makes no network call, reads no environment, and connects no WhatsApp, Stripe or social network", () => {
    expect(source).not.toMatch(/\bfetch\(|process\.env|XMLHttpRequest|WebSocket/);
    expect(source).not.toMatch(/stripe|instagram|facebook|messenger|tiktok|linkedin|whatsapp/i);
    expect(parts.comms.conversations.every((item) => ["email", "webchat", "webform"].includes(item.channel))).toBe(true);
    expect(parts.billing.payments.every((item) => item.method === "simulatedCard" || item.method === "credit")).toBe(true);
  });
});
