/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADDON_KEYS, ADDONS, LICENSE_RESOURCES, PLANS, RESOURCES, addonsOf, analysesOf, auditOf, creditsOf, invoicesOf, paymentsOf, proposalsOf, reduceBilling,
  type BillingEnv, type BillingEvent, type BillingState,
} from "./billing-center";
import { DEMO_NOW, demoBillingOk } from "./billing-demo";
import { ERROR_CODES, label, message } from "./billing-messages";
import {
  FUTURE_PAYMENT_CONNECTORS, accountBalance, aiUsage, billingDashboard, canUse, creditBalance, forecast, invoiceBalance, licenses, limitAlerts, limitsOf, monthlyBill, plansFor, roi, usageRows,
} from "./koe-billing";
import { levelForAction } from "./workers";

const NOVA = "tenant-nova";
const VIDA = "tenant-vida";
const at = (minutes = 0) => new Date(Date.parse(DEMO_NOW) + minutes * 60_000).toISOString();
const ev = (tenantId: string, actor: string, rest: Record<string, unknown>, minutes = 1) => ({ at: at(minutes), tenantId, actor, ...rest }) as BillingEvent;
const sample = () => demoBillingOk();
type Source = { state: BillingState; env: BillingEnv };
const run = (source: Source, event: BillingEvent, state: BillingState = source.state, env: BillingEnv = source.env) => reduceBilling(state, event, env);
/** Applies an event that must work, and returns the new state. */
const ok = (source: Source, event: BillingEvent, state: BillingState = source.state, env: BillingEnv = source.env): BillingState => {
  const result = reduceBilling(state, event, env);
  expect(result.error, event.type).toBeUndefined();
  return result.state;
};
const withUsage = (source: Source, tenant: string, resource: string, used: number): BillingEnv => ({ ...source.env, signals: { ...source.env.signals, usage: [{ tenantId: tenant, resource: resource as never, used }, ...source.env.signals.usage] } });
const dashboard = (source: Source, state: BillingState, tenant: string) => billingDashboard(state, source.env.signals, tenant, at(0));

describe("the sample", () => {
  it("loads through the reducer with no refusals, for two isolated companies", () => {
    const source = sample();
    expect(source.errors).toEqual([]);
    expect(source.state.accounts.map((item) => item.tenantId).sort()).toEqual([NOVA, VIDA]);
  });

  it("shows the dashboard: plan, status, renewal, users, Workers, AI use, storage, automations, integrations, marketplace, academy, monthly bill and ROI", () => {
    const source = sample();
    const nova = dashboard(source, source.state, NOVA)!;
    expect(nova.planName).toBe("Professional");
    expect(nova.status).toBe("active");
    expect(nova.daysToRenewal).toBe(3);
    expect(nova.users).toMatchObject({ used: 11, limit: 25 });
    expect(nova.workers).toMatchObject({ used: 5, included: 8, extra: 2, limit: 10 });
    expect(nova.monthlyBill).toEqual({ planMicros: 149_000_000, addonsMicros: 48_000_000, totalMicros: 197_000_000 });
    expect(nova.creditMicros).toBe(20_000_000);
    expect(nova.ai.tasks).toBeGreaterThan(0);
    for (const row of [nova.storage, nova.automations, nova.integrations, nova.marketplace, nova.academy]) expect(row.limit).toBeGreaterThan(0);
    expect(nova.roi.returnPercent).not.toBeNull();
    const vida = dashboard(source, source.state, VIDA)!;
    expect(vida.status).toBe("trialing");
    expect(vida.trialEndsAt).toBeTruthy();
  });
});

describe("plans and add-ons", () => {
  it("declares every limit in four plans that only grow", () => {
    expect(PLANS.map((item) => item.name)).toEqual(["Starter", "Professional", "Business", "Enterprise"]);
    for (const resource of RESOURCES) {
      const values = PLANS.map((plan) => plan.limits[resource]);
      expect(values[0], resource).toBeGreaterThan(0);
      for (let index = 1; index < values.length; index += 1) expect(values[index], resource).toBeGreaterThan(values[index - 1] as number);
    }
    for (let index = 1; index < PLANS.length; index += 1) expect(PLANS[index]?.monthlyMicros).toBeGreaterThan(PLANS[index - 1]?.monthlyMicros as number);
  });

  it("lets only the platform create a custom plan, and only its company sees it", () => {
    const source = sample();
    expect(run(source, ev(NOVA, "ana", { type: "plan.custom.create", name: "Nova a medida", monthlyMicros: 700_000_000, limits: { users: 60, workers: 20 } })).errorCode).toBe("systemOnly");
    const state = ok(source, ev(NOVA, "system", { type: "plan.custom.create", name: "Nova a medida", monthlyMicros: 700_000_000, limits: { users: 60, workers: 20 } }));
    const custom = state.customPlans[0]!;
    expect(plansFor(state, NOVA).map((item) => item.name)).toContain("Nova a medida");
    expect(plansFor(state, VIDA).map((item) => item.name)).not.toContain("Nova a medida");
    expect(run(source, ev(VIDA, "lucia", { type: "plan.change", toPlanId: custom.id }), state).errorCode).toBe("notYours");
    const moved = ok(source, ev(NOVA, "ana", { type: "plan.change", toPlanId: custom.id }), state);
    expect(moved.changes.at(-1)?.kind).toBe("custom");
    expect(limitsOf(moved, NOVA).included.users).toBe(60);
  });

  it("keeps add-ons independent of the plan: they add to the limits and survive a plan change", () => {
    const source = sample();
    expect(limitsOf(source.state, NOVA)).toMatchObject({ included: { workers: 8 }, extra: { workers: 2, aiTasks: 1_000 }, limit: { workers: 10, aiTasks: 4_000 } });
    const state = ok(source, ev(NOVA, "ana", { type: "addon.purchase", addon: "storage", quantity: 2 }));
    expect(limitsOf(state, NOVA).limit.storage).toBe(100 + 2 * ADDONS.storage.units);
    const upgraded = ok(source, ev(NOVA, "ana", { type: "plan.change", toPlanId: "business" }), state);
    expect(limitsOf(upgraded, NOVA)).toMatchObject({ included: { workers: 25 }, extra: { workers: 2, storage: 100 }, limit: { workers: 27, storage: 500 + 100 } });
    for (const key of ADDON_KEYS) expect(ADDONS[key].units).toBeGreaterThan(0);
  });

  it("refuses to cancel an add-on when the use would stay above the limit, and never touches data", () => {
    const source = sample();
    const purchase = addonsOf(source.state, NOVA).find((item) => item.addon === "extraWorkers")!;
    const env = withUsage(source, NOVA, "workers", 10);
    const refused = run(source, ev(NOVA, "ana", { type: "addon.cancel", purchaseId: purchase.id }), source.state, env);
    expect(refused.errorCode).toBe("overLimit");
    expect(refused.state).toBe(source.state);
    const state = ok(source, ev(NOVA, "ana", { type: "addon.cancel", purchaseId: purchase.id }));
    expect(addonsOf(state, NOVA).find((item) => item.id === purchase.id)?.status).toBe("cancelled");
    expect(addonsOf(state, NOVA)).toHaveLength(addonsOf(source.state, NOVA).length); // cancelled, never removed
    expect(limitsOf(state, NOVA).limit.workers).toBe(8);
  });
});

describe("licenses and limits", () => {
  it("controls users, Workers, branches, departments, teams, Academy, Marketplace and integrations", () => {
    const source = sample();
    const rows = licenses(source.state, source.env.signals, NOVA, at(0));
    expect(rows.map((item) => item.resource).sort()).toEqual([...LICENSE_RESOURCES].sort());
    for (const row of rows) expect(row.limit).toBe(row.included + row.extra);
  });

  it("recommends options when a limit is reached and never blocks what exists", () => {
    const source = sample();
    const env = withUsage(source, NOVA, "users", 30);
    const before = JSON.stringify(source.state);
    const rows = usageRows(source.state, env.signals, NOVA, at(0));
    expect(rows.find((item) => item.resource === "users")).toMatchObject({ used: 30, limit: 25, status: "over" });
    const alert = limitAlerts(source.state, env.signals, NOVA, at(0)).find((item) => item.resource === "users")!;
    expect(alert.severity).toBe("high");
    expect(alert.options.map((item) => item.kind).sort()).toEqual(["addon", "upgrade"]);
    expect(alert.note).toMatch(/nunca bloquea ni borra lo que ya existe/);
    const gate = canUse(source.state, env.signals, NOVA, "users", 1, at(0));
    expect(gate.allowed).toBe(false);
    expect(gate.options.length).toBeGreaterThan(0);
    expect(JSON.stringify(source.state)).toBe(before); // nothing was touched
    expect(canUse(source.state, source.env.signals, NOVA, "users", 1, at(0)).allowed).toBe(true);
  });

  it("covers the twelve limits of the plan", () => {
    const source = sample();
    const names = usageRows(source.state, source.env.signals, NOVA, at(0)).map((item) => item.resource);
    for (const resource of ["users", "workers", "academy", "marketplace", "storage", "automations", "integrations", "api", "aiStudio", "communications", "crm", "insights"]) expect(names).toContain(resource);
  });
});

describe("AI usage and ROI (all KOE)", () => {
  it("adds up by department, Worker, automation and agent, without naming any provider", () => {
    const source = sample();
    const usage = aiUsage(source.env.signals, NOVA, at(0));
    const sum = (rows: readonly { tasks: number; costMicros: number }[], key: "tasks" | "costMicros") => rows.reduce((total, row) => total + row[key], 0);
    expect(sum(usage.byDepartment, "tasks")).toBe(usage.tasks);
    expect(sum(usage.byDepartment, "costMicros")).toBe(usage.costMicros);
    expect(sum(usage.byWorker, "tasks")).toBe(usage.tasks);
    expect(usage.byAutomation.length).toBeGreaterThan(0);
    expect(usage.averageCostMicros).toBe(Math.round(usage.costMicros / usage.tasks));
    expect(JSON.stringify(usage)).not.toMatch(/\b(openai|anthropic|llama|gpt|gemini|mistral)\b|workers ai/i);
  });

  it("states the ROI from its documented assumption", () => {
    const source = sample();
    const result = roi(source.state, source.env.signals, NOVA, at(0));
    const usage = aiUsage(source.env.signals, NOVA, at(0));
    expect(result.savedMinutes).toBe(usage.savedMinutes);
    expect(result.aiCostMicros).toBe(usage.costMicros);
    expect(result.platformCostMicros).toBe(monthlyBill(source.state, NOVA).totalMicros);
    expect(result.netMicros).toBe(result.savedMicros - result.aiCostMicros - result.platformCostMicros);
    expect(result.returnPercent).toBe(Math.round((result.netMicros / (result.aiCostMicros + result.platformCostMicros)) * 100));
    expect(result.assumption).toMatch(/supuesto/);
  });
});

describe("forecast and recommendation (all KOE)", () => {
  it("recommends an upgrade when the projected use goes past the plan, and a cheaper add-on when it is enough", () => {
    const source = sample();
    const vida = forecast(source.state, source.env.signals, VIDA, at(0));
    expect(vida.recommendation).toMatchObject({ kind: "upgrade", toPlanId: "professional" });
    expect(vida.recommendation.reasons).toContain("aiTasks");
    expect(vida.recommendation.addonAlternativeMicros).toBe(18_000_000);
    expect(vida.projectedTasks).toBeGreaterThan(300);
    expect(vida.projectedTotalMicros).toBe(vida.platformMicros + vida.projectedAiCostMicros);
  });

  it("keeps the plan when it is enough, and suggests a smaller one only with room to spare", () => {
    const source = sample();
    expect(forecast(source.state, source.env.signals, NOVA, at(0)).recommendation.kind).toBe("stay");
    const quiet: BillingEnv = { ...source.env, signals: { executions: [], usage: [] } };
    const down = forecast(source.state, quiet.signals, NOVA, at(0)).recommendation;
    expect(down).toMatchObject({ kind: "downgrade", toPlanId: "starter" });
    expect(down.deltaMonthlyMicros).toBeLessThan(0);
  });

  it("records each analysis with the Worker, the model and its cost, and never overwrites it", () => {
    const source = sample();
    const first = analysesOf(source.state, NOVA);
    const state = ok(source, ev(NOVA, "worker:nex", { type: "billing.analyze" }));
    const after = analysesOf(state, NOVA);
    expect(after).toHaveLength(first.length + 1);
    expect(after.slice(0, first.length)).toEqual(first);
    expect(after.at(-1)).toMatchObject({ workerId: expect.any(String), model: { id: expect.any(String), label: expect.any(String) }, recommendation: "stay" });
    expect(after.at(-1)?.estimatedCostMicros).toBeGreaterThan(0);
    expect(analysesOf(state, VIDA)).toHaveLength(0);
  });
});

describe("invoices, receipts, credits and payments (architecture only)", () => {
  it("issues the invoice of a renewal from the plan and the add-ons, and applies the credit", () => {
    const source = sample();
    expect(run(source, ev(NOVA, "ana", { type: "renewal.run" }, -6 * 24 * 60)).errorCode).toBe("notDue");
    const state = ok(source, ev(NOVA, "ana", { type: "renewal.run" }));
    const invoice = invoicesOf(state, NOVA).at(-1)!;
    expect(invoice.number).toBe("F-0002");
    expect(invoice.lines.map((line) => line.kind)).toEqual(["plan", "addon", "addon"]);
    expect(invoice.totalMicros).toBe(197_000_000);
    expect(creditBalance(state, NOVA)).toBe(0);
    expect(paymentsOf(state, NOVA).at(-1)).toMatchObject({ method: "credit", amountMicros: 20_000_000, invoiceId: invoice.id });
    const balance = invoiceBalance(state, invoice.id, at(10));
    expect(balance).toMatchObject({ paidMicros: 20_000_000, outstandingMicros: 177_000_000, status: "open" });
    expect(state.accounts.find((item) => item.tenantId === NOVA)?.renewsAt.slice(0, 10)).toBe("2026-12-05");
  });

  it("records payments with receipts, refuses an overpayment, and never modifies an issued invoice", () => {
    const source = sample();
    let state = ok(source, ev(NOVA, "ana", { type: "renewal.run" }));
    const invoice = invoicesOf(state, NOVA).at(-1)!;
    const frozen = JSON.stringify(invoice);
    expect(run(source, ev(NOVA, "ana", { type: "payment.record", invoiceId: invoice.id, amountMicros: 200_000_000, method: "simulatedCard" }), state).errorCode).toBe("overpay");
    state = ok(source, ev(NOVA, "pablo", { type: "payment.record", invoiceId: invoice.id, amountMicros: 100_000_000, method: "simulatedCard" }), state);
    expect(invoiceBalance(state, invoice.id, at(10)).outstandingMicros).toBe(77_000_000);
    state = ok(source, ev(NOVA, "pablo", { type: "payment.record", invoiceId: invoice.id, amountMicros: 77_000_000, method: "simulatedTransfer" }), state);
    expect(invoiceBalance(state, invoice.id, at(10)).status).toBe("paid");
    expect(run(source, ev(NOVA, "ana", { type: "payment.record", invoiceId: invoice.id, amountMicros: 1, method: "simulatedCard" }), state).errorCode).toBe("nothingToPay");
    expect(JSON.stringify(invoicesOf(state, NOVA).at(-1))).toBe(frozen); // paying changed nothing in the invoice
    expect(paymentsOf(state, NOVA).map((item) => item.receipt)).toEqual(["R-0001", "R-0002", "R-0003", "R-0004"]);
    expect(accountBalance(state, NOVA, at(10)).outstandingMicros).toBe(0);
  });

  it("marks an unpaid invoice as overdue after its due date, and adds credits as a ledger", () => {
    const source = sample();
    const state = ok(source, ev(NOVA, "ana", { type: "renewal.run" }));
    const invoice = invoicesOf(state, NOVA).at(-1)!;
    expect(invoiceBalance(state, invoice.id, at(20 * 24 * 60)).status).toBe("overdue");
    const credited = ok(source, ev(NOVA, "ana", { type: "credit.add", amountMicros: 5_000_000, reason: "Ajuste" }), state);
    expect(creditBalance(credited, NOVA)).toBe(5_000_000);
    expect(creditsOf(credited, NOVA).length).toBe(creditsOf(state, NOVA).length + 1);
    expect(run(source, ev(NOVA, "ana", { type: "credit.add", amountMicros: -5, reason: "x" })).errorCode).toBe("invalid");
  });
});

describe("the Upgrade Center", () => {
  it("upgrades, refuses a downgrade that would not fit, and keeps every record", () => {
    const source = sample();
    const state = ok(source, ev(NOVA, "ana", { type: "plan.change", toPlanId: "business" }));
    expect(dashboard(source, state, NOVA)!.planName).toBe("Business");
    expect(state.changes.at(-1)).toMatchObject({ kind: "upgrade", fromPlanId: "professional", toPlanId: "business" });
    const refused = run(source, ev(NOVA, "ana", { type: "plan.change", toPlanId: "starter" }));
    expect(refused.errorCode).toBe("overLimit");
    expect(refused.state).toBe(source.state);
    expect(run(source, ev(NOVA, "ana", { type: "plan.change", toPlanId: "professional" })).errorCode).toBe("samePlan");
    const down = ok(source, ev(NOVA, "ana", { type: "plan.change", toPlanId: "professional" }), state);
    expect(down.changes.at(-1)?.kind).toBe("downgrade");
  });

  it("starts a trial once, ends it by the platform, and goes back to the previous plan", () => {
    const source = sample();
    let state = ok(source, ev(NOVA, "ana", { type: "plan.trial", planId: "business" }));
    const account = () => state.accounts.find((item) => item.tenantId === NOVA)!;
    expect(account()).toMatchObject({ status: "trialing", planId: "business", fallbackPlanId: "professional" });
    expect(run(source, ev(NOVA, "ana", { type: "plan.trial", planId: "business" }), state).errorCode).toBe("notEligible");
    expect(run(source, ev(NOVA, "system", { type: "trial.expire" }, 60), state).errorCode).toBe("notEligible"); // not over yet
    state = ok(source, ev(NOVA, "system", { type: "trial.expire" }, 15 * 24 * 60), state);
    expect(account()).toMatchObject({ status: "active", planId: "professional" });
    expect(state.changes.at(-1)?.kind).toBe("expire");
    expect(run(source, ev(NOVA, "ana", { type: "plan.trial", planId: "business" }, 16 * 24 * 60), state).errorCode).toBe("trialUsed");
    expect(run(source, ev(NOVA, "ana", { type: "plan.trial", planId: "starter" })).errorCode).toBe("notEligible"); // only a higher plan
  });

  it("moves to Enterprise, cancels without deleting anything, and reactivates", () => {
    const source = sample();
    const enterprise = ok(source, ev(NOVA, "ana", { type: "plan.change", toPlanId: "enterprise" }));
    expect(enterprise.changes.at(-1)?.kind).toBe("enterprise");
    const cancelled = ok(source, ev(NOVA, "ana", { type: "plan.cancel", reason: "Prueba" }));
    const account = cancelled.accounts.find((item) => item.tenantId === NOVA)!;
    expect(account.status).toBe("cancelled");
    expect(account.endsAt).toBe(account.renewsAt);
    expect(cancelled.invoices).toEqual(source.state.invoices); // nothing deleted
    expect(cancelled.addons).toEqual(source.state.addons);
    expect(run(source, ev(NOVA, "ana", { type: "renewal.run" }), cancelled).errorCode).toBe("cancelled");
    expect(run(source, ev(NOVA, "ana", { type: "plan.change", toPlanId: "business" }), cancelled).errorCode).toBe("cancelled");
    expect(run(source, ev(NOVA, "ana", { type: "plan.cancel" }), cancelled).errorCode).toBe("cancelled");
    const back = ok(source, ev(NOVA, "ana", { type: "plan.reactivate" }, 5), cancelled);
    expect(back.accounts.find((item) => item.tenantId === NOVA)?.status).toBe("active");
    expect(back.changes.map((item) => item.kind).slice(-2)).toEqual(["cancel", "reactivate"]);
  });
});

describe("the NEX Constitution", () => {
  const NEX = "worker:nex";

  it("Level 3: NEX never charges, cancels, renews, issues a payment, edits an invoice or changes who administers billing", () => {
    const source = sample();
    const invoice = invoicesOf(source.state, NOVA)[0]!;
    const attempts: Record<string, unknown>[] = [
      { type: "plan.change", toPlanId: "business" }, { type: "plan.cancel" }, { type: "plan.reactivate" }, { type: "renewal.run" },
      { type: "payment.record", invoiceId: invoice.id, amountMicros: 1, method: "simulatedCard" }, { type: "credit.add", amountMicros: 1, reason: "x" },
      { type: "addon.purchase", addon: "storage", quantity: 1 }, { type: "billing.setAdmin", userId: "carla", enabled: true }, { type: "authorization.grant", maxPerDay: 5 },
      { type: "proposal.approve", proposalId: proposalsOf(source.state, NOVA)[0]!.id }, { type: "plan.trial", planId: "business" },
    ];
    for (const attempt of attempts) {
      const result = run(source, ev(NOVA, NEX, attempt));
      expect(result.errorCode, String(attempt.type)).toBe("personRequired");
      expect(result.state, String(attempt.type)).toBe(source.state);
    }
  });

  it("Level 3: there is no event to edit or delete an invoice, a payment or the history", () => {
    const events = readFileSync(join(__dirname, "billing-center.ts"), "utf8").match(/type: "([a-zA-Z.]+)"/g)?.map((item) => item.slice(7, -1)) ?? [];
    expect(events.length).toBeGreaterThan(15);
    for (const type of events) expect(type, type).not.toMatch(/(^|\.)(delete|remove|void|edit|modify|adjust|refund|charge)/i);
    expect(levelForAction("billing.charge")).toBe(3);
    expect(levelForAction("billing.cancel")).toBe(3);
    expect(levelForAction("billing.renew")).toBe(3);
    expect(levelForAction("billing.payment")).toBe(3);
    expect(levelForAction("billing.invoice")).toBe(3);
    expect(levelForAction("billing.refund")).toBe(3); // an action that is not in the catalog fails closed
  });

  it("Level 1: NEX prepares a plan change or a purchase; a person approves and it is applied as that person", () => {
    const source = sample();
    const made = ok(source, ev(NOVA, NEX, { type: "proposal.create", payload: { kind: "plan", toPlanId: "business" }, reason: "Crecimiento" }));
    const proposal = proposalsOf(made, NOVA).at(-1)!;
    expect(proposal).toMatchObject({ status: "proposed", via: "draft", proposedBy: NEX });
    expect(dashboard(source, made, NOVA)!.planName).toBe("Professional"); // nothing changed yet
    expect(run(source, ev(NOVA, "carla", { type: "proposal.approve", proposalId: proposal.id }), made).errorCode).toBe("forbidden");
    const approved = ok(source, ev(NOVA, "pablo", { type: "proposal.approve", proposalId: proposal.id }), made);
    expect(dashboard(source, approved, NOVA)!.planName).toBe("Business");
    expect(proposalsOf(approved, NOVA).at(-1)).toMatchObject({ status: "approved", decidedBy: "pablo" });
    expect(run(source, ev(NOVA, "pablo", { type: "proposal.approve", proposalId: proposal.id }), approved).errorCode).toBe("closed");
    const addonProposal = proposalsOf(source.state, NOVA).find((item) => item.payload.kind === "addon" && item.status === "proposed")!;
    const bought = ok(source, ev(NOVA, "ana", { type: "proposal.approve", proposalId: addonProposal.id }));
    expect(addonsOf(bought, NOVA).at(-1)).toMatchObject({ addon: "storage", by: "ana" });
    const rejected = ok(source, ev(NOVA, "ana", { type: "proposal.reject", proposalId: addonProposal.id }));
    expect(proposalsOf(rejected, NOVA).find((item) => item.id === addonProposal.id)?.status).toBe("rejected");
  });

  it("Level 1: an approval that would break a rule is refused and the proposal stays open", () => {
    const source = sample();
    const made = ok(source, ev(NOVA, NEX, { type: "proposal.create", payload: { kind: "plan", toPlanId: "starter" } }));
    const proposal = proposalsOf(made, NOVA).at(-1)!;
    const refused = run(source, ev(NOVA, "ana", { type: "proposal.approve", proposalId: proposal.id }), made);
    expect(refused.errorCode).toBe("overLimit");
    expect(proposalsOf(refused.state, NOVA).at(-1)?.status).toBe("proposed");
  });

  it("never prepares a critical financial decision", () => {
    const source = sample();
    for (const kind of ["cancel", "renew", "payment", "invoice", "charge"]) {
      const result = run(source, ev(NOVA, NEX, { type: "proposal.create", payload: { kind } }));
      expect(result.errorCode, kind).toBe("criticalForHuman");
    }
  });

  it("Level 2: with a standing authorization NEX asks for the next plan up; it is only a request", () => {
    const source = sample();
    const grant = source.state.grants.find((item) => item.tenantId === NOVA)!;
    const revoked = ok(source, ev(NOVA, "ana", { type: "authorization.revoke", grantId: grant.id }));
    expect(run(source, ev(NOVA, NEX, { type: "upgrade.request", toPlanId: "business" }), revoked).errorCode).toBe("needsAuthorization");
    const state = ok(source, ev(NOVA, NEX, { type: "upgrade.request", toPlanId: "business", reason: "Más usuarios" }));
    expect(proposalsOf(state, NOVA).at(-1)).toMatchObject({ via: "authorized", status: "proposed", payload: { kind: "plan", toPlanId: "business" } });
    expect(dashboard(source, state, NOVA)!.planName).toBe("Professional"); // a request never changes the plan
    expect(run(source, ev(NOVA, NEX, { type: "upgrade.request", toPlanId: "business" }, 2), state).errorCode).toBe("needsAuthorization"); // one a day
    expect(run(source, ev(NOVA, NEX, { type: "upgrade.request", toPlanId: "enterprise" }, 60 * 24 * 2)).errorCode).toBe("notEligible");
    expect(run(source, ev(NOVA, NEX, { type: "upgrade.request", toPlanId: "starter" }, 60 * 24 * 2)).errorCode).toBe("notEligible");
    expect(run(source, ev(NOVA, "ana", { type: "upgrade.request", toPlanId: "business" })).errorCode).toBe("notEligible");
    const expired = run(source, ev(NOVA, NEX, { type: "upgrade.request", toPlanId: "business" }, 60 * 24 * 60));
    expect(expired.errorCode).toBe("needsAuthorization"); // the authorization has an expiry
  });

  it("lets only the owner name who administers billing", () => {
    const source = sample();
    expect(run(source, ev(NOVA, "pablo", { type: "billing.setAdmin", userId: "carla", enabled: true })).errorCode).toBe("ownerRequired");
    expect(run(source, ev(NOVA, "carla", { type: "credit.add", amountMicros: 1_000_000, reason: "x" })).errorCode).toBe("forbidden");
    const state = ok(source, ev(NOVA, "ana", { type: "billing.setAdmin", userId: "carla", enabled: true }));
    ok(source, ev(NOVA, "carla", { type: "credit.add", amountMicros: 1_000_000, reason: "x" }), state);
    const removed = ok(source, ev(NOVA, "ana", { type: "billing.setAdmin", userId: "carla", enabled: false }), state);
    expect(run(source, ev(NOVA, "carla", { type: "credit.add", amountMicros: 1_000_000, reason: "x" }), removed).errorCode).toBe("forbidden");
  });
});

describe("one company never sees or changes another", () => {
  it("keeps plan, use, licenses, invoices and proposals apart", () => {
    const source = sample();
    const invoice = invoicesOf(source.state, NOVA)[0]!;
    const purchase = addonsOf(source.state, NOVA)[0]!;
    const proposal = proposalsOf(source.state, NOVA)[0]!;
    expect(run(source, ev(VIDA, "lucia", { type: "payment.record", invoiceId: invoice.id, amountMicros: 1, method: "simulatedCard" })).errorCode).toBe("notYours");
    expect(run(source, ev(VIDA, "lucia", { type: "addon.cancel", purchaseId: purchase.id })).errorCode).toBe("notYours");
    expect(run(source, ev(VIDA, "lucia", { type: "proposal.approve", proposalId: proposal.id })).errorCode).toBe("notYours");
    expect(run(source, ev(VIDA, "ana", { type: "plan.cancel" })).errorCode).toBe("forbidden"); // Nova's owner has no authority in Vida
    expect(run(source, ev(NOVA, "lucia", { type: "plan.cancel" })).errorCode).toBe("forbidden");
    expect(invoicesOf(source.state, VIDA)).toHaveLength(0);
    expect(addonsOf(source.state, VIDA).every((item) => item.tenantId === VIDA)).toBe(true);
    expect(run(source, ev(VIDA, "system", { type: "account.create", ownerId: "lucia", planId: "starter" })).errorCode).toBe("exists");
  });

  it("does not move a figure of one company when another acts", () => {
    const source = sample();
    const before = JSON.stringify([dashboard(source, source.state, NOVA), forecast(source.state, source.env.signals, NOVA, at(0)), auditOf(source.state, NOVA)]);
    let state = ok(source, ev(VIDA, "lucia", { type: "plan.change", toPlanId: "professional" }));
    state = ok(source, ev(VIDA, "lucia", { type: "renewal.run" }), state);
    state = ok(source, ev(VIDA, "lucia", { type: "credit.add", amountMicros: 3_000_000, reason: "Ajuste" }), state);
    state = ok(source, ev(VIDA, "worker:nex", { type: "billing.analyze" }), state);
    expect(JSON.stringify([dashboard(source, state, NOVA), forecast(state, source.env.signals, NOVA, at(0)), auditOf(state, NOVA)])).toBe(before);
    expect(dashboard(source, state, VIDA)!.planName).toBe("Professional");
  });
});

describe("audit and history", () => {
  it("records every kind of change and only ever grows", () => {
    const source = sample();
    const categories = new Set(auditOf(source.state, NOVA).map((item) => item.category));
    for (const category of ["plan", "addons", "invoices", "payments", "credits", "proposals", "access"]) expect(categories.has(category as never), category).toBe(true);
    let state = source.state;
    const history: BillingState[] = [];
    for (const event of [
      ev(NOVA, "ana", { type: "addon.purchase", addon: "storage", quantity: 1 }), ev(NOVA, "ana", { type: "plan.change", toPlanId: "business" }), ev(NOVA, "ana", { type: "renewal.run" }, 5),
      ev(NOVA, "ana", { type: "plan.cancel" }, 6), ev(NOVA, "ana", { type: "plan.reactivate" }, 7),
    ]) { history.push(state); state = ok(source, event, state); }
    for (const before of history) {
      for (const key of ["audit", "changes", "addons", "invoices", "payments", "credits", "proposals", "analyses"] as const) {
        const earlier = before[key] as readonly unknown[];
        expect(state[key].length, key).toBeGreaterThanOrEqual(earlier.length);
      }
    }
    expect(state.audit.slice(0, source.state.audit.length)).toEqual(source.state.audit);
    expect(state.invoices.slice(0, source.state.invoices.length)).toEqual(source.state.invoices);
  });

  it("refuses without changing anything, and says why in Spanish", () => {
    const source = sample();
    const result = run(source, ev(NOVA, "carla", { type: "plan.cancel" }));
    expect(result.state).toBe(source.state);
    expect(result.error).toBe(message("forbidden"));
    for (const code of ERROR_CODES) expect(message(code, { detail: "x" }), code).toMatch(/\S/);
    for (const resource of RESOURCES) expect(label("resource", resource)).toMatch(/\S/);
    for (const key of ADDON_KEYS) expect(label("addon", key)).toMatch(/\S/);
  });
});

describe("the future payment architecture", () => {
  it("declares Stripe, PayPal, MakaPay, MakaWallet, SINPE, crypto, Apple Pay and Google Pay without building any", () => {
    expect(FUTURE_PAYMENT_CONNECTORS.map((item) => item.id)).toEqual(["stripe", "paypal", "makapay", "makawallet", "sinpe", "crypto", "applePay", "googlePay"]);
    for (const item of FUTURE_PAYMENT_CONNECTORS) expect(item).toMatchObject({ notBuilt: true, goesThrough: "KOE", direct: false });
  });
});

describe("where the rules live", () => {
  const dir = __dirname;
  const read = (name: string) => readFileSync(join(dir, name), "utf8");
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("holds the financial rules in koe-billing.ts alone", () => {
    const rules = /HOURLY_COST_MICROS|WARN_RATIO|DOWNGRADE_HEADROOM|GROWTH_MAX|GROWTH_MIN/;
    const owners = readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).filter((name) => rules.test(strip(read(name))));
    expect(owners).toEqual(["koe-billing.ts"]);
    const center = strip(read("billing-center.ts"));
    expect(center).not.toMatch(/\.reduce\(|Math\./); // the store only decides who may do what; it adds up no money
  });

  it("has screens that only format: no arithmetic on money, no provider and no network", () => {
    const folder = join(dir, "..", "..", "..", "app", "(app)", "platform", "_components");
    const screens = readdirSync(folder).filter((name) => /^Billing.*\.tsx$/.test(name) && !name.endsWith(".test.tsx"));
    expect(screens.length).toBeGreaterThanOrEqual(3);
    for (const name of screens) {
      const code = strip(readFileSync(join(folder, name), "utf8"));
      expect(code, name).not.toMatch(/\.reduce\(|Math\.|HOURLY_COST_MICROS|WARN_RATIO|fetch\(|XMLHttpRequest|lib\/ai|lib\/db/);
      expect(code, name).not.toMatch(/\b(openai|anthropic|llama|gemini|mistral)\b/i);
    }
    for (const name of ["billing-center.ts", "billing-demo.ts", "koe-billing.ts", "billing-catalog.ts", "billing-messages.ts"]) {
      expect(strip(read(name)), name).not.toMatch(/fetch\(|XMLHttpRequest|from "stripe"|lib\/ai|lib\/db|process\.env/);
    }
  });
});
