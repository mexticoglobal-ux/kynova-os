// Billing & Subscription store: each company's plan, subscription, add-ons, invoices, receipts, credits and the history of every change.
// Pure and deterministic, one global state with every record owned by a company (tenant): nothing is ever shared between companies.
// There is NO payment gateway: a payment is only RECORDED, as a simulation. Every financial figure (a bill, a balance, a forecast, a limit,
// an ROI) is worked out by koe-billing.ts; this file only decides who may do what and records the result.
//
// Constitution (ADR-0009), enforced by how the events are built and tested:
// - Level 1 (NEX prepares): propose a plan change or the purchase of an add-on. A person approves it; NEX never applies it.
// - Level 2 (a standing authorization): ask for an upgrade to the next plan up. It is only a request: a person still approves it.
// - Level 3 (a person with billing authority): NEVER charge, cancel, renew, issue a payment or modify an invoice. There is no event that
//   changes an invoice (a mistake is fixed with a credit), and every change stays in the audit trail. Existing data is never blocked or
//   deleted by a limit, a downgrade or a cancellation.

import { isPerson, isWorker } from "./actors";
import { DEFAULT_KOE_ENV, failed, planExecution, type KoeEnv } from "./automation-koe";
import { addDays, addInterval } from "./billing";
import { ADDONS, BILLING_AUTH_ACTION, INVOICE_DUE_DAYS, MAX_PACKS, PLANS, RENEWAL_WINDOW_DAYS, RESOURCES, SIMULATED_METHODS, TRIAL_DAYS, type AddonKey, type Limits, type Plan, type SimulatedMethod } from "./billing-catalog";
import { message, type ErrorCode } from "./billing-messages";
import { creditApplicable, creditBalance, forecast, invoiceBalance, invoiceDraft, nextPlanUp, overLimits, planOf, type BillingSignals, type InvoiceLine } from "./koe-billing";
import { decide, type Authorization } from "./workers";

export { DEFAULT_KOE_ENV, type KoeEnv } from "./automation-koe";
export * from "./billing-catalog";

export type AccountStatus = "trialing" | "active" | "cancelled";
export type Account = {
  tenantId: string; ownerId: string; admins: readonly string[]; planId: string; status: AccountStatus; periodStart: string; renewsAt: string;
  trialEndsAt?: string; trialUsed: boolean; fallbackPlanId?: string; resumeRenewsAt?: string; cancelledAt?: string; endsAt?: string; createdAt: string;
};
export type ChangeKind = "start" | "upgrade" | "downgrade" | "trial" | "enterprise" | "custom" | "cancel" | "reactivate" | "expire";
export type PlanChange = { id: string; tenantId: string; kind: ChangeKind; fromPlanId?: string; toPlanId?: string; at: string; by: string; via: "person" | "proposal"; note?: string };
export type AddonPurchase = { id: string; tenantId: string; addon: AddonKey; quantity: number; unitMonthlyMicros: number; status: "active" | "cancelled"; purchasedAt: string; by: string; cancelledAt?: string };
// An invoice is never modified after it is issued: whether it is paid, open or overdue is read from the payments that point at it.
export type Invoice = { id: string; tenantId: string; number: string; issuedAt: string; dueAt: string; periodStart: string; periodEnd: string; planId: string; lines: readonly InvoiceLine[]; totalMicros: number; issuedBy: string };
export type Payment = { id: string; tenantId: string; invoiceId: string; receipt: string; amountMicros: number; method: SimulatedMethod | "credit"; at: string; by: string };
export type CreditEntry = { id: string; tenantId: string; amountMicros: number; reason: string; invoiceId?: string; at: string; by: string };
export type ProposalPayload = { kind: "plan"; toPlanId: string } | { kind: "addon"; addon: AddonKey; quantity: number };
export type Proposal = { id: string; tenantId: string; payload: ProposalPayload; via: "draft" | "authorized"; status: "proposed" | "approved" | "rejected"; proposedBy: string; proposedAt: string; decidedBy?: string; decidedAt?: string; reason: string };
export type Grant = { id: string; tenantId: string; action: typeof BILLING_AUTH_ACTION; status: "active" | "revoked"; maxPerDay?: number; expiresAt?: string; grantedBy: string; grantedAt: string };
export type BillingAnalysis = {
  id: string; tenantId: string; at: string; by: string; workerId: string; workerName: string; model: { id: string; label: string }; modelReason: string; estimatedCostMicros: number;
  recommendation: "stay" | "upgrade" | "downgrade"; recommendedPlanId?: string; projectedTasks: number; projectedAiCostMicros: number; alerts: number;
};
export type BillingAuditCategory = "plan" | "addons" | "invoices" | "payments" | "credits" | "proposals" | "access" | "other";
export type BillingAudit = { at: string; actor: string; tenantId: string; action: string; category: BillingAuditCategory; detail?: string };
export type BillingLog = { at: string; level: "info" | "warn"; event: string };

export type BillingState = {
  accounts: readonly Account[]; customPlans: readonly Plan[]; changes: readonly PlanChange[]; addons: readonly AddonPurchase[]; invoices: readonly Invoice[]; payments: readonly Payment[];
  credits: readonly CreditEntry[]; proposals: readonly Proposal[]; grants: readonly Grant[]; analyses: readonly BillingAnalysis[]; audit: readonly BillingAudit[]; logs: readonly BillingLog[]; sequence: number;
};
export const newBillingState = (): BillingState => ({ accounts: [], customPlans: [], changes: [], addons: [], invoices: [], payments: [], credits: [], proposals: [], grants: [], analyses: [], audit: [], logs: [], sequence: 0 });

/** What KOE knows about the company's use of the platform, from the other modules' records. */
export type BillingEnv = KoeEnv & { signals: BillingSignals };
export const EMPTY_SIGNALS: BillingSignals = { executions: [], usage: [] };
export const DEFAULT_BILLING_ENV: BillingEnv = { ...DEFAULT_KOE_ENV, signals: EMPTY_SIGNALS };

type Base = { at: string; tenantId: string; actor: string };
export type BillingEvent =
  | (Base & { type: "account.create"; ownerId: string; planId: string; trial?: boolean })
  | (Base & { type: "plan.custom.create"; name: string; monthlyMicros: number; limits: Partial<Limits>; tier?: number; summary?: string })
  | (Base & { type: "billing.setAdmin"; userId: string; enabled: boolean })
  | (Base & { type: "plan.change"; toPlanId: string; note?: string })
  | (Base & { type: "plan.trial"; planId: string })
  | (Base & { type: "trial.expire" })
  | (Base & { type: "plan.cancel"; reason?: string })
  | (Base & { type: "plan.reactivate" })
  | (Base & { type: "addon.purchase"; addon: AddonKey; quantity: number })
  | (Base & { type: "addon.cancel"; purchaseId: string })
  | (Base & { type: "renewal.run" })
  | (Base & { type: "payment.record"; invoiceId: string; amountMicros: number; method: SimulatedMethod })
  | (Base & { type: "credit.add"; amountMicros: number; reason: string })
  | (Base & { type: "proposal.create"; payload: ProposalPayload; reason?: string })
  | (Base & { type: "proposal.approve"; proposalId: string })
  | (Base & { type: "proposal.reject"; proposalId: string })
  | (Base & { type: "upgrade.request"; toPlanId: string; reason?: string })
  | (Base & { type: "billing.analyze" })
  | (Base & { type: "authorization.grant"; maxPerDay?: number; expiresAt?: string })
  | (Base & { type: "authorization.revoke"; grantId: string });
export type BillingResult = { state: BillingState; error?: string; errorCode?: ErrorCode };

// ---------------------------------------------------------------- helpers
// Nothing is ever trimmed or deleted: every list only grows (a status changes; history stays). Limits belong to the view (display.ts).
const append = <T,>(items: readonly T[], item: T): readonly T[] => [...items, item];
const replace = <T extends { id: string }>(items: readonly T[], item: T): readonly T[] => items.map((existing) => (existing.id === item.id ? item : existing));
const nextId = (state: BillingState, prefix: string): { id: string; state: BillingState } => {
  const sequence = state.sequence + 1;
  return { id: `${prefix}_${String(sequence).padStart(5, "0")}`, state: { ...state, sequence } };
};
const note = (state: BillingState, event: { at: string; actor: string; tenantId: string }, action: string, category: BillingAuditCategory, detail?: string, level: BillingLog["level"] = "info"): BillingState => ({
  ...state,
  audit: append(state.audit, { at: event.at, actor: event.actor, tenantId: event.tenantId, action, category, detail }),
  logs: append(state.logs, { at: event.at, level, event: detail ? `${action}: ${detail}` : action }),
});
const HANDLE = /^[a-z0-9][a-z0-9._-]{0,29}$/;
const sameDay = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10);
const pad = (value: number, size: number) => String(value).padStart(size, "0");

export const accountOf = (state: BillingState, tenantId: string) => state.accounts.find((item) => item.tenantId === tenantId);
/** Who may decide anything about money: the owner of the company and the people the owner named. A Worker, the platform or anyone else never. */
export function canBill(state: BillingState, tenantId: string, actor: string): boolean {
  const account = accountOf(state, tenantId);
  return !!account && isPerson(actor) && (account.ownerId === actor || account.admins.includes(actor));
}

// ---------------------------------------------------------------- the reducer
export function reduceBilling(state: BillingState, event: BillingEvent, env: BillingEnv = DEFAULT_BILLING_ENV): BillingResult {
  const person = isPerson(event.actor);
  const tenant = event.tenantId;
  const refuse = (code: ErrorCode, params?: Record<string, string | number>): BillingResult => ({ state, error: message(code, params), errorCode: code });
  const needSystem = (): BillingResult | null => (event.actor === "system" ? null : refuse("systemOnly"));
  const needDrafter = (): BillingResult | null => (person || isWorker(event.actor) ? null : refuse("personRequired"));
  const account = accountOf(state, tenant);
  /** A person who is the owner or administers billing. Level 3: a Worker never reaches this. */
  const needBilling = (): BillingResult | null => {
    if (!person) return refuse("personRequired");
    return canBill(state, tenant, event.actor) ? null : refuse("forbidden");
  };
  const needOwner = (): BillingResult | null => {
    if (!person) return refuse("personRequired");
    return account?.ownerId === event.actor ? null : refuse("ownerRequired");
  };
  const planById = (id: string) => planOf(state, tenant, id);
  const planMissing = (id: string): BillingResult => refuse(state.customPlans.some((item) => item.id === id) ? "notYours" : "notFound");
  const overText = (resources: readonly string[]) => resources.map((item) => item).join(", ");
  const autoAllowed = (st: BillingState): boolean => {
    const grant = st.grants.find((item) => item.tenantId === tenant && item.status === "active" && (!item.expiresAt || Date.parse(item.expiresAt) > Date.parse(event.at)));
    if (!grant) return false;
    const usedToday = st.audit.filter((entry) => entry.tenantId === tenant && entry.action === "upgrade.request" && sameDay(entry.at, event.at)).length;
    const authorization: Authorization = { action: BILLING_AUTH_ACTION, status: "active", maxPerDay: grant.maxPerDay, usedToday, expiresAt: grant.expiresAt };
    return decide(BILLING_AUTH_ACTION, authorization, new Date(event.at)).allowed;
  };
  const changeOf = (st: BillingState, kind: ChangeKind, from: string | undefined, to: string | undefined, via: PlanChange["via"], text?: string): BillingState => {
    const made = nextId(st, "ch");
    return { ...made.state, changes: append(made.state.changes, { id: made.id, tenantId: tenant, kind, fromPlanId: from, toPlanId: to, at: event.at, by: event.actor, via, ...(text ? { note: text } : {}) }) };
  };

  if (event.type !== "account.create" && event.type !== "plan.custom.create" && !account) return refuse("notFound");

  switch (event.type) {
    // ---- the company joins the platform: the platform sets it up
    case "account.create": {
      const denied = needSystem();
      if (denied) return denied;
      if (account) return refuse("exists", { detail: "la cuenta de la empresa" });
      const plan = PLANS.find((item) => item.id === event.planId);
      if (!plan || !HANDLE.test(event.ownerId)) return refuse("invalid", { detail: "plan o propietario" });
      const trialEndsAt = event.trial ? addDays(event.at, TRIAL_DAYS) : undefined;
      const created: Account = {
        tenantId: tenant, ownerId: event.ownerId, admins: [], planId: plan.id, status: event.trial ? "trialing" : "active", periodStart: event.at,
        renewsAt: trialEndsAt ?? addInterval(event.at, "month"), ...(trialEndsAt ? { trialEndsAt } : {}), trialUsed: !!event.trial, createdAt: event.at,
      };
      const next = changeOf({ ...state, accounts: append(state.accounts, created) }, "start", undefined, plan.id, "person");
      return { state: note(next, event, "account.create", "plan", `${plan.name}${event.trial ? " (prueba)" : ""} · propietario ${event.ownerId}`) };
    }

    case "plan.custom.create": {
      const denied = needSystem(); // a custom plan is agreed with the company and set up by the platform
      if (denied) return denied;
      if (event.name.trim() === "" || event.name.length > 60 || !Number.isInteger(event.monthlyMicros) || event.monthlyMicros < 0) return refuse("invalid", { detail: "nombre y precio" });
      const full = Object.fromEntries(RESOURCES.map((resource) => [resource, event.limits[resource] ?? 0])) as Limits;
      if (RESOURCES.some((resource) => !Number.isInteger(full[resource]) || full[resource] < 0)) return refuse("invalid", { detail: "los límites" });
      const made = nextId(state, "cp");
      const plan: Plan = { id: made.id, tenantId: tenant, name: event.name.trim(), tier: event.tier ?? 4, monthlyMicros: event.monthlyMicros, limits: full, selfServe: false, custom: true, summary: event.summary ?? "Plan acordado con la empresa." };
      return { state: note({ ...made.state, customPlans: append(made.state.customPlans, plan) }, event, "plan.custom.create", "plan", `${made.id} · ${plan.name}`) };
    }

    case "billing.setAdmin": {
      const denied = needOwner();
      if (denied) return denied;
      if (!HANDLE.test(event.userId) || event.userId === account?.ownerId) return refuse("invalid", { detail: "la persona" });
      const admins = event.enabled ? (account?.admins.includes(event.userId) ? account.admins : [...(account?.admins ?? []), event.userId]) : (account?.admins ?? []).filter((item) => item !== event.userId);
      return { state: note({ ...state, accounts: state.accounts.map((item) => (item.tenantId === tenant ? { ...item, admins } : item)) }, event, "billing.setAdmin", "access", `${event.userId} · ${event.enabled ? "administra la facturación" : "ya no administra la facturación"}`) };
    }

    // ---- plan and subscription: only a person with billing authority
    case "plan.change": {
      const denied = needBilling();
      if (denied) return denied;
      if (!account) return refuse("notFound");
      if (account.status === "cancelled") return refuse("cancelled");
      const target = planById(event.toPlanId);
      if (!target) return planMissing(event.toPlanId);
      if (target.id === account.planId) return refuse("samePlan");
      const current = planById(account.planId);
      const kind: ChangeKind = target.custom ? "custom" : target.id === "enterprise" ? "enterprise" : target.tier > (current?.tier ?? 0) ? "upgrade" : "downgrade";
      if (kind === "downgrade") {
        const over = overLimits(state, env.signals, tenant, event.at, { planId: target.id });
        if (over.length > 0) return refuse("overLimit", { detail: overText(over) });
      }
      const next = changeOf({ ...state, accounts: state.accounts.map((item) => (item.tenantId === tenant ? { ...item, planId: target.id } : item)) }, kind, account.planId, target.id, "person", event.note);
      return { state: note(next, event, "plan.change", "plan", `${current?.name ?? account.planId} → ${target.name} (${kind})`) };
    }

    case "plan.trial": {
      const denied = needBilling();
      if (denied) return denied;
      if (!account) return refuse("notFound");
      if (account.status !== "active") return refuse("notEligible", { detail: "solo una suscripción activa puede probar otro plan" });
      if (account.trialUsed) return refuse("trialUsed");
      const target = planById(event.planId);
      if (!target) return planMissing(event.planId);
      const current = planById(account.planId);
      if (target.tier <= (current?.tier ?? 0)) return refuse("notEligible", { detail: "la prueba es de un plan superior al actual" });
      const trialEndsAt = addDays(event.at, TRIAL_DAYS);
      const updated: Account = { ...account, planId: target.id, status: "trialing", trialEndsAt, trialUsed: true, fallbackPlanId: account.planId, resumeRenewsAt: account.renewsAt, renewsAt: trialEndsAt };
      const next = changeOf({ ...state, accounts: state.accounts.map((item) => (item.tenantId === tenant ? updated : item)) }, "trial", account.planId, target.id, "person");
      return { state: note(next, event, "plan.trial", "plan", `${target.name} hasta ${trialEndsAt.slice(0, 10)}`) };
    }

    case "trial.expire": {
      const denied = needSystem();
      if (denied) return denied;
      if (!account || account.status !== "trialing" || !account.trialEndsAt || Date.parse(event.at) < Date.parse(account.trialEndsAt)) return refuse("notEligible", { detail: "la prueba no ha vencido" });
      if (account.fallbackPlanId) {
        const resume = account.resumeRenewsAt && Date.parse(account.resumeRenewsAt) > Date.parse(event.at) ? account.resumeRenewsAt : addInterval(event.at, "month");
        const back: Account = { ...account, planId: account.fallbackPlanId, status: "active", renewsAt: resume, fallbackPlanId: undefined, resumeRenewsAt: undefined };
        const next = changeOf({ ...state, accounts: state.accounts.map((item) => (item.tenantId === tenant ? back : item)) }, "expire", account.planId, back.planId, "person");
        return { state: note(next, event, "trial.expire", "plan", `vuelve a ${back.planId}`) };
      }
      const ended: Account = { ...account, status: "cancelled", cancelledAt: event.at, endsAt: event.at };
      return { state: note(changeOf({ ...state, accounts: state.accounts.map((item) => (item.tenantId === tenant ? ended : item)) }, "expire", account.planId, undefined, "person"), event, "trial.expire", "plan", "la prueba terminó sin renovar") };
    }

    case "plan.cancel": {
      const denied = needBilling();
      if (denied) return denied;
      if (!account) return refuse("notFound");
      if (account.status === "cancelled") return refuse("cancelled");
      const updated: Account = { ...account, status: "cancelled", cancelledAt: event.at, endsAt: account.renewsAt };
      const next = changeOf({ ...state, accounts: state.accounts.map((item) => (item.tenantId === tenant ? updated : item)) }, "cancel", account.planId, undefined, "person", event.reason);
      return { state: note(next, event, "plan.cancel", "plan", `hasta ${account.renewsAt.slice(0, 10)}; los datos no se borran`, "warn") };
    }

    case "plan.reactivate": {
      const denied = needBilling();
      if (denied) return denied;
      if (!account) return refuse("notFound");
      if (account.status !== "cancelled") return refuse("notEligible", { detail: "la suscripción no está cancelada" });
      const updated: Account = { ...account, status: "active", periodStart: event.at, renewsAt: addInterval(event.at, "month"), cancelledAt: undefined, endsAt: undefined, trialEndsAt: undefined };
      const next = changeOf({ ...state, accounts: state.accounts.map((item) => (item.tenantId === tenant ? updated : item)) }, "reactivate", undefined, account.planId, "person");
      return { state: note(next, event, "plan.reactivate", "plan", account.planId) };
    }

    // ---- add-ons: independent of the plan, bought in packs
    case "addon.purchase": {
      const denied = needBilling();
      if (denied) return denied;
      if (!account) return refuse("notFound");
      if (account.status === "cancelled") return refuse("cancelled");
      const definition = ADDONS[event.addon];
      if (!definition || !Number.isInteger(event.quantity) || event.quantity < 1 || event.quantity > MAX_PACKS) return refuse("invalid", { detail: `add-on y cantidad (1 a ${MAX_PACKS} paquetes)` });
      const made = nextId(state, "ad");
      const purchase: AddonPurchase = { id: made.id, tenantId: tenant, addon: event.addon, quantity: event.quantity, unitMonthlyMicros: definition.monthlyMicros, status: "active", purchasedAt: event.at, by: event.actor };
      return { state: note({ ...made.state, addons: append(made.state.addons, purchase) }, event, "addon.purchase", "addons", `${made.id} · ${event.addon} ×${event.quantity}`) };
    }

    case "addon.cancel": {
      const denied = needBilling();
      if (denied) return denied;
      const purchase = state.addons.find((item) => item.id === event.purchaseId);
      if (!purchase) return refuse("notFound");
      if (purchase.tenantId !== tenant) return refuse("notYours");
      if (purchase.status === "cancelled") return refuse("closed");
      const over = overLimits(state, env.signals, tenant, event.at, { withoutPurchase: purchase.id });
      if (over.length > 0) return refuse("overLimit", { detail: overText(over) });
      return { state: note({ ...state, addons: replace(state.addons, { ...purchase, status: "cancelled", cancelledAt: event.at }) }, event, "addon.cancel", "addons", `${purchase.id} · ${purchase.addon}`) };
    }

    // ---- renewals, invoices and payments: Level 3, always a person, and only ever recorded
    case "renewal.run": {
      const denied = needBilling();
      if (denied) return denied;
      if (!account) return refuse("notFound");
      if (account.status === "cancelled") return refuse("cancelled");
      const trialing = account.status === "trialing";
      if (!trialing && Date.parse(event.at) < Date.parse(addDays(account.renewsAt, -RENEWAL_WINDOW_DAYS))) return refuse("notDue", { detail: RENEWAL_WINDOW_DAYS });
      const periodStart = trialing ? event.at : account.renewsAt;
      const periodEnd = addInterval(periodStart, "month");
      const draft = invoiceDraft(state, tenant, account.planId);
      const made = nextId(state, "inv");
      const count = made.state.invoices.filter((item) => item.tenantId === tenant).length + 1;
      const invoice: Invoice = {
        id: made.id, tenantId: tenant, number: `F-${pad(count, 4)}`, issuedAt: event.at, dueAt: addDays(event.at, INVOICE_DUE_DAYS), periodStart, periodEnd, planId: account.planId,
        lines: draft.lines, totalMicros: draft.totalMicros, issuedBy: event.actor,
      };
      let next: BillingState = { ...made.state, invoices: append(made.state.invoices, invoice), accounts: state.accounts.map((item) => (item.tenantId === tenant ? { ...account, status: "active" as const, periodStart, renewsAt: periodEnd, trialEndsAt: undefined, fallbackPlanId: undefined, resumeRenewsAt: undefined } : item)) };
      const credit = creditApplicable(state, tenant, invoice.totalMicros);
      if (credit > 0) {
        const entry = nextId(next, "cr");
        const paid = nextId(entry.state, "pay");
        const receipts = paid.state.payments.filter((item) => item.tenantId === tenant).length + 1;
        next = {
          ...paid.state,
          credits: append(paid.state.credits, { id: entry.id, tenantId: tenant, amountMicros: -credit, reason: `Aplicado a la factura ${invoice.number}`, invoiceId: invoice.id, at: event.at, by: event.actor }),
          payments: append(paid.state.payments, { id: paid.id, tenantId: tenant, invoiceId: invoice.id, receipt: `R-${pad(receipts, 4)}`, amountMicros: credit, method: "credit", at: event.at, by: event.actor }),
        };
      }
      return { state: note(note(next, event, "renewal.run", "plan", `${invoice.number} · ${periodStart.slice(0, 10)} a ${periodEnd.slice(0, 10)}`), event, "invoice.issue", "invoices", `${invoice.number} · ${invoice.id}`) };
    }

    case "payment.record": {
      const denied = needBilling();
      if (denied) return denied;
      const invoice = state.invoices.find((item) => item.id === event.invoiceId);
      if (!invoice) return refuse("notFound");
      if (invoice.tenantId !== tenant) return refuse("notYours");
      if (!SIMULATED_METHODS.includes(event.method) || !Number.isInteger(event.amountMicros) || event.amountMicros < 1) return refuse("invalid", { detail: "monto y método" });
      const balance = invoiceBalance(state, invoice.id, event.at);
      if (balance.outstandingMicros <= 0) return refuse("nothingToPay");
      if (event.amountMicros > balance.outstandingMicros) return refuse("overpay");
      const made = nextId(state, "pay");
      const receipts = made.state.payments.filter((item) => item.tenantId === tenant).length + 1;
      const payment: Payment = { id: made.id, tenantId: tenant, invoiceId: invoice.id, receipt: `R-${pad(receipts, 4)}`, amountMicros: event.amountMicros, method: event.method, at: event.at, by: event.actor };
      return { state: note({ ...made.state, payments: append(made.state.payments, payment) }, event, "payment.record", "payments", `${payment.receipt} · ${invoice.number} · simulado`) };
    }

    case "credit.add": {
      const denied = needBilling();
      if (denied) return denied;
      if (!Number.isInteger(event.amountMicros) || event.amountMicros < 1 || event.amountMicros > 1_000_000_000_000 || event.reason.trim() === "" || event.reason.length > 120) return refuse("invalid", { detail: "monto y motivo" });
      const made = nextId(state, "cr");
      return { state: note({ ...made.state, credits: append(made.state.credits, { id: made.id, tenantId: tenant, amountMicros: event.amountMicros, reason: event.reason.trim(), at: event.at, by: event.actor }) }, event, "credit.add", "credits", `${made.id} · ${event.reason.trim()}`) };
    }

    // ---- Level 1: NEX prepares, a person approves
    case "proposal.create": {
      const denied = needDrafter();
      if (denied) return denied;
      const kind = (event.payload as { kind: string }).kind;
      if (kind !== "plan" && kind !== "addon") return refuse("criticalForHuman"); // charging, cancelling, renewing, paying or editing an invoice is never prepared by NEX
      if (event.payload.kind === "plan") {
        if (!planById(event.payload.toPlanId)) return planMissing(event.payload.toPlanId);
      } else if (!ADDONS[event.payload.addon] || !Number.isInteger(event.payload.quantity) || event.payload.quantity < 1 || event.payload.quantity > MAX_PACKS) return refuse("invalid", { detail: "add-on y cantidad" });
      const made = nextId(state, "pr");
      return { state: note({ ...made.state, proposals: append(made.state.proposals, { id: made.id, tenantId: tenant, payload: event.payload, via: "draft", status: "proposed", proposedBy: event.actor, proposedAt: event.at, reason: event.reason ?? "Propuesta de NEX" }) }, event, "proposal.create", "proposals", `${made.id} · ${event.payload.kind}`) };
    }

    case "proposal.approve":
    case "proposal.reject": {
      const denied = needBilling();
      if (denied) return denied;
      const proposal = state.proposals.find((item) => item.id === event.proposalId);
      if (!proposal) return refuse("notFound");
      if (proposal.tenantId !== tenant) return refuse("notYours");
      if (proposal.status !== "proposed") return refuse("closed");
      if (event.type === "proposal.reject") return { state: note({ ...state, proposals: replace(state.proposals, { ...proposal, status: "rejected", decidedBy: event.actor, decidedAt: event.at }) }, event, "proposal.reject", "proposals", proposal.id) };
      // approving applies the change as the approver, through the same rules as if the person had done it
      const applied = proposal.payload.kind === "plan"
        ? reduceBilling(state, { type: "plan.change", at: event.at, tenantId: tenant, actor: event.actor, toPlanId: proposal.payload.toPlanId, note: `Propuesta ${proposal.id}` }, env)
        : reduceBilling(state, { type: "addon.purchase", at: event.at, tenantId: tenant, actor: event.actor, addon: proposal.payload.addon, quantity: proposal.payload.quantity }, env);
      if (applied.error) return applied;
      return { state: note({ ...applied.state, proposals: replace(applied.state.proposals, { ...proposal, status: "approved", decidedBy: event.actor, decidedAt: event.at }) }, event, "proposal.approve", "proposals", `${proposal.id} · ${proposal.payload.kind}`) };
    }

    // ---- Level 2: with a standing authorization NEX may ask for an upgrade to the next plan up; the request still needs a person
    case "upgrade.request": {
      if (!isWorker(event.actor)) return refuse("notEligible", { detail: "un upgrade lo hace directamente una persona; la solicitud es de NEX" });
      if (!account || account.status !== "active") return refuse("notEligible", { detail: "la suscripción debe estar activa" });
      if (!autoAllowed(state)) return refuse("needsAuthorization");
      const up = nextPlanUp(state, tenant);
      if (!up || up.id !== event.toPlanId) return refuse("notEligible", { detail: "solo se puede pedir el plan inmediatamente superior" });
      const made = nextId(state, "pr");
      const proposal: Proposal = { id: made.id, tenantId: tenant, payload: { kind: "plan", toPlanId: up.id }, via: "authorized", status: "proposed", proposedBy: event.actor, proposedAt: event.at, reason: event.reason ?? "Solicitud de upgrade de NEX" };
      return { state: note({ ...made.state, proposals: append(made.state.proposals, proposal) }, event, "upgrade.request", "proposals", `${made.id} · ${up.name}`) };
    }

    // ---- KOE's own analysis: recorded with the Worker and the model it used, never overwritten
    case "billing.analyze": {
      const denied = needDrafter();
      if (denied) return denied;
      const plan = planExecution(env, tenant, "reporter", { tools: ["summary.prepare"], clearance: "business" });
      if (failed(plan)) return refuse("noWorker", { detail: plan.problem });
      const view = forecast(state, env.signals, tenant, event.at);
      const made = nextId(state, "an");
      const analysis: BillingAnalysis = {
        id: made.id, tenantId: tenant, at: event.at, by: event.actor, workerId: plan.worker.id, workerName: plan.worker.name, model: { id: plan.model.id, label: plan.model.label }, modelReason: plan.modelReason,
        estimatedCostMicros: plan.estimatedCostMicros, recommendation: view.recommendation.kind, recommendedPlanId: view.recommendation.toPlanId, projectedTasks: view.projectedTasks, projectedAiCostMicros: view.projectedAiCostMicros, alerts: view.alerts,
      };
      return { state: note({ ...made.state, analyses: append(made.state.analyses, analysis) }, event, "billing.analyze", "other", `${made.id} · ${view.recommendation.kind}`) };
    }

    case "authorization.grant": {
      const denied = needBilling();
      if (denied) return denied;
      if (event.maxPerDay !== undefined && (!Number.isInteger(event.maxPerDay) || event.maxPerDay < 1 || event.maxPerDay > 20)) return refuse("invalid", { detail: "solicitudes por día de 1 a 20" });
      if (event.expiresAt !== undefined && !(Date.parse(event.expiresAt) > Date.parse(event.at))) return refuse("invalid", { detail: "la fecha de vencimiento debe ser futura" });
      const made = nextId(state, "gr");
      return { state: note({ ...made.state, grants: append(made.state.grants, { id: made.id, tenantId: tenant, action: BILLING_AUTH_ACTION, status: "active", maxPerDay: event.maxPerDay, expiresAt: event.expiresAt, grantedBy: event.actor, grantedAt: event.at }) }, event, "authorization.grant", "access", `${made.id} · ${BILLING_AUTH_ACTION}`) };
    }

    case "authorization.revoke": {
      const denied = needBilling();
      if (denied) return denied;
      const grant = state.grants.find((item) => item.id === event.grantId);
      if (!grant) return refuse("notFound");
      if (grant.tenantId !== tenant) return refuse("notYours");
      if (grant.status === "revoked") return refuse("closed");
      return { state: note({ ...state, grants: replace(state.grants, { ...grant, status: "revoked" }) }, event, "authorization.revoke", "access", grant.id) };
    }
  }
}

export function applyAllBilling(state: BillingState, events: readonly BillingEvent[], env: BillingEnv = DEFAULT_BILLING_ENV): { state: BillingState; errors: string[] } {
  const errors: string[] = [];
  let current = state;
  for (const event of events) {
    const result = reduceBilling(current, event, env);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    current = result.state;
  }
  return { state: current, errors };
}

export const customPlansOf = (state: BillingState, tenantId: string) => state.customPlans.filter((item) => item.tenantId === tenantId);
export const changesOf = (state: BillingState, tenantId: string) => state.changes.filter((item) => item.tenantId === tenantId);
export const addonsOf = (state: BillingState, tenantId: string) => state.addons.filter((item) => item.tenantId === tenantId);
export const invoicesOf = (state: BillingState, tenantId: string) => state.invoices.filter((item) => item.tenantId === tenantId);
export const paymentsOf = (state: BillingState, tenantId: string) => state.payments.filter((item) => item.tenantId === tenantId);
export const creditsOf = (state: BillingState, tenantId: string) => state.credits.filter((item) => item.tenantId === tenantId);
export const proposalsOf = (state: BillingState, tenantId: string) => state.proposals.filter((item) => item.tenantId === tenantId);
export const grantsOf = (state: BillingState, tenantId: string) => state.grants.filter((item) => item.tenantId === tenantId);
export const analysesOf = (state: BillingState, tenantId: string) => state.analyses.filter((item) => item.tenantId === tenantId);
export const auditOf = (state: BillingState, tenantId: string, category?: BillingAuditCategory) => state.audit.filter((item) => item.tenantId === tenantId && (!category || item.category === category));
export { creditBalance };
