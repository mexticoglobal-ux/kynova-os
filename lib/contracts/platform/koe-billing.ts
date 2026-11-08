// KOE Billing Intelligence: the ONE place where money and limits are worked out. The plan limits, what a company has used, its monthly bill,
// the invoice a renewal issues, the balance of an invoice, the credit that applies, the AI usage and its cost (by department, Worker,
// automation and agent), the ROI, the limit alerts with their options, and the forecast with its upgrade recommendation. Every screen
// only formats these answers, and no other module repeats this logic.
// Pure and deterministic. It reads the records KOE already has (the Worker runs and what each module reports); it never changes anything,
// never names a model provider, and one company never sees another's records. A limit is never a wall for existing data: when one is
// reached KOE recommends options, and nothing that already exists is blocked or deleted.

import type { AcademyState } from "./academy-center";
import type { AutomationState } from "./automation-center";
import { ADDONS, FUTURE_PAYMENTS, PLANS, RESOURCES, type AddonKey, type Limits, type Plan, type Resource } from "./billing-catalog";
import type { BillingState } from "./billing-center";
import { label } from "./billing-messages";
import type { CommsState } from "./comms-center";
import type { CrmState } from "./crm-center";
import type { InsightsState } from "./insights-center";
import type { KoeState } from "./koe-engine";
import { PROCESSES, type ExecutionEvent } from "./koe-ledger";
import type { MarketState } from "./marketplace-center";
import type { OrgState } from "./org-center";
import type { StudioState } from "./studio-center";

const DAY = 86_400_000;

// ---------------------------------------------------------------- the rules and assumptions (declared, so every figure can be explained)
export const WINDOW_DAYS = 30; // usage and ROI are measured over the last 30 days
export const WARN_RATIO = 0.8; // from this share of a limit KOE starts to recommend
export const DOWNGRADE_HEADROOM = 0.7; // a smaller plan is only suggested when the projected use stays under this share of its limits
export const GROWTH_MIN = 0.5; // the projected growth of AI tasks is kept between half and double
export const GROWTH_MAX = 2;
// An ASSUMPTION of the simulation, shown as an estimate wherever it is used: what an hour of a person's time is worth to the company.
export const HOURLY_COST_MICROS = 12_000_000;
export const EXISTING_DATA_NOTE = "Llegar al límite nunca bloquea ni borra lo que ya existe: solo limita crear más.";

export type UsageSample = { tenantId: string; resource: Resource; used: number; previous?: number };
/** What KOE knows about the use of the platform, tenant by tenant. The AI tasks are counted from the Worker runs themselves. */
export type BillingSignals = { executions: readonly ExecutionEvent[]; usage: readonly UsageSample[] };
export type InvoiceLine = { kind: "plan" | "addon"; description: string; quantity: number; unitMicros: number; totalMicros: number };

// ---------------------------------------------------------------- adapters: the other modules' records, in the shape this module reads
export type UsageParts = {
  org: OrgState; koe: KoeState; automation: AutomationState; academy: AcademyState; market: MarketState; studio: StudioState; insights: InsightsState; crm: CrmState; comms: CommsState;
  /** What the other modules do not hold yet (storage, API calls, connections): measured by the platform. */
  measured: readonly UsageSample[];
};
/** How much of each resource a company uses, from the records of the other modules. Only that company's records are read. */
export function usageFrom(parts: UsageParts, tenantId: string, asOf: string): UsageSample[] {
  const before = Date.parse(asOf) - WINDOW_DAYS * DAY;
  const seats = parts.org.users.filter((item) => item.tenantId === tenantId && (item.status === "active" || item.status === "pending"));
  const channels = new Set(parts.comms.conversations.filter((item) => item.tenantId === tenantId).map((item) => item.channel));
  const automations = parts.automation.automations.filter((item) => item.tenantId === tenantId && (item.status === "active" || item.status === "paused"));
  const samples: UsageSample[] = [
    { tenantId, resource: "users", used: seats.length, previous: seats.filter((item) => Date.parse(item.createdAt) <= before).length },
    { tenantId, resource: "workers", used: parts.koe.instances.filter((item) => item.tenantId === tenantId && item.status !== "disabled").length },
    { tenantId, resource: "branches", used: parts.org.branches.filter((item) => item.tenantId === tenantId && item.status === "active").length },
    { tenantId, resource: "departments", used: parts.org.departments.filter((item) => item.tenantId === tenantId).length },
    { tenantId, resource: "teams", used: parts.org.teams.filter((item) => item.tenantId === tenantId).length },
    { tenantId, resource: "academy", used: parts.academy.courses.filter((item) => item.ownerTenantId === tenantId && item.status !== "archived").length },
    { tenantId, resource: "marketplace", used: parts.market.listings.filter((item) => item.sellerTenantId === tenantId && item.status !== "retired" && item.status !== "rejected").length },
    { tenantId, resource: "automations", used: automations.length, previous: automations.filter((item) => Date.parse(item.createdAt) <= before).length },
    { tenantId, resource: "aiStudio", used: parts.studio.assets.filter((item) => item.tenantId === tenantId && !item.archived).length },
    { tenantId, resource: "communications", used: channels.size },
    { tenantId, resource: "crm", used: parts.crm.leads.filter((item) => item.tenantId === tenantId).length + parts.crm.customers.filter((item) => item.tenantId === tenantId).length },
    { tenantId, resource: "insights", used: parts.insights.reports.filter((item) => item.tenantId === tenantId).length },
  ];
  return [...samples, ...parts.measured.filter((item) => item.tenantId === tenantId)];
}

// ---------------------------------------------------------------- plans, limits and the bill
export const planOf = (state: BillingState, tenantId: string, planId: string): Plan | undefined =>
  PLANS.find((item) => item.id === planId) ?? state.customPlans.find((item) => item.id === planId && item.tenantId === tenantId);
/** The plans a company can see: the platform's and its own custom ones, never another company's. */
export const plansFor = (state: BillingState, tenantId: string): Plan[] =>
  [...PLANS, ...state.customPlans.filter((item) => item.tenantId === tenantId)].sort((a, b) => a.tier - b.tier || a.monthlyMicros - b.monthlyMicros);

const zero = (): Limits => Object.fromEntries(RESOURCES.map((resource) => [resource, 0])) as Limits;
/** What a company may use: what its plan includes plus what its active add-ons add. Add-ons are independent of the plan. */
export function limitsOf(state: BillingState, tenantId: string, options: { planId?: string; withoutPurchase?: string } = {}): { included: Limits; extra: Limits; limit: Limits } {
  const account = state.accounts.find((item) => item.tenantId === tenantId);
  const plan = planOf(state, tenantId, options.planId ?? account?.planId ?? "");
  const included = plan ? { ...plan.limits } : zero();
  const extra = zero();
  for (const purchase of state.addons) {
    if (purchase.tenantId !== tenantId || purchase.status !== "active" || purchase.id === options.withoutPurchase) continue;
    const definition = ADDONS[purchase.addon];
    extra[definition.resource] += definition.units * purchase.quantity;
  }
  const limit = zero();
  for (const resource of RESOURCES) limit[resource] = included[resource] + extra[resource];
  return { included, extra, limit };
}

export function monthlyBill(state: BillingState, tenantId: string): { planMicros: number; addonsMicros: number; totalMicros: number } {
  const account = state.accounts.find((item) => item.tenantId === tenantId);
  const planMicros = (account && planOf(state, tenantId, account.planId)?.monthlyMicros) || 0;
  let addonsMicros = 0;
  for (const purchase of state.addons) if (purchase.tenantId === tenantId && purchase.status === "active") addonsMicros += purchase.unitMonthlyMicros * purchase.quantity;
  return { planMicros, addonsMicros, totalMicros: planMicros + addonsMicros };
}

/** The lines of the invoice a renewal issues: the plan and every active add-on. Computed here so no other place adds up money. */
export function invoiceDraft(state: BillingState, tenantId: string, planId: string): { lines: InvoiceLine[]; totalMicros: number } {
  const plan = planOf(state, tenantId, planId);
  const lines: InvoiceLine[] = [];
  if (plan) lines.push({ kind: "plan", description: `Plan ${plan.name}`, quantity: 1, unitMicros: plan.monthlyMicros, totalMicros: plan.monthlyMicros });
  for (const purchase of state.addons) {
    if (purchase.tenantId !== tenantId || purchase.status !== "active") continue;
    lines.push({ kind: "addon", description: label("addon", purchase.addon), quantity: purchase.quantity, unitMicros: purchase.unitMonthlyMicros, totalMicros: purchase.unitMonthlyMicros * purchase.quantity });
  }
  let totalMicros = 0;
  for (const line of lines) totalMicros += line.totalMicros;
  return { lines, totalMicros };
}

export type InvoiceState = "open" | "paid" | "overdue";
/** Whether an invoice is paid is read from the payments that point at it: the invoice itself is never modified. */
export function invoiceBalance(state: BillingState, invoiceId: string, asOf: string): { totalMicros: number; paidMicros: number; outstandingMicros: number; status: InvoiceState } {
  const invoice = state.invoices.find((item) => item.id === invoiceId);
  let paidMicros = 0;
  for (const payment of state.payments) if (payment.invoiceId === invoiceId) paidMicros += payment.amountMicros;
  const totalMicros = invoice?.totalMicros ?? 0;
  const outstandingMicros = totalMicros - paidMicros;
  const status: InvoiceState = outstandingMicros <= 0 ? "paid" : invoice && Date.parse(asOf) > Date.parse(invoice.dueAt) ? "overdue" : "open";
  return { totalMicros, paidMicros, outstandingMicros, status };
}
export function accountBalance(state: BillingState, tenantId: string, asOf: string): { outstandingMicros: number; overdueMicros: number; openInvoices: number } {
  let outstandingMicros = 0;
  let overdueMicros = 0;
  let openInvoices = 0;
  for (const invoice of state.invoices) {
    if (invoice.tenantId !== tenantId) continue;
    const balance = invoiceBalance(state, invoice.id, asOf);
    if (balance.outstandingMicros > 0) { outstandingMicros += balance.outstandingMicros; openInvoices += 1; if (balance.status === "overdue") overdueMicros += balance.outstandingMicros; }
  }
  return { outstandingMicros, overdueMicros, openInvoices };
}
export function creditBalance(state: BillingState, tenantId: string): number {
  let balance = 0;
  for (const entry of state.credits) if (entry.tenantId === tenantId) balance += entry.amountMicros;
  return balance;
}
/** How much of an invoice the company's credit covers. */
export const creditApplicable = (state: BillingState, tenantId: string, totalMicros: number): number => {
  const balance = creditBalance(state, tenantId);
  return balance <= 0 ? 0 : balance < totalMicros ? balance : totalMicros;
};
/** The plan immediately above the current one that the company can pick by itself (Enterprise and custom plans are agreed, not picked). */
export function nextPlanUp(state: BillingState, tenantId: string): Plan | undefined {
  const account = state.accounts.find((item) => item.tenantId === tenantId);
  const current = account && planOf(state, tenantId, account.planId);
  if (!current) return undefined;
  return PLANS.filter((item) => item.selfServe && item.tier > current.tier).sort((a, b) => a.tier - b.tier)[0];
}

// ---------------------------------------------------------------- usage and limits
const windowOf = (signals: BillingSignals, tenantId: string, asOf: string, days = WINDOW_DAYS, back = 0): ExecutionEvent[] => {
  const end = Date.parse(asOf) - back * DAY;
  const start = end - days * DAY;
  return signals.executions.filter((item) => item.tenantId === tenantId && Date.parse(item.at) > start && Date.parse(item.at) <= end);
};
const sampleOf = (signals: BillingSignals, tenantId: string, resource: Resource): UsageSample | undefined => signals.usage.find((item) => item.tenantId === tenantId && item.resource === resource);
const usedOf = (signals: BillingSignals, tenantId: string, resource: Resource, asOf: string): number => (resource === "aiTasks" ? windowOf(signals, tenantId, asOf).length : sampleOf(signals, tenantId, resource)?.used ?? 0);

export type UsageStatus = "ok" | "warn" | "atLimit" | "over";
export type UsageRow = { resource: Resource; used: number; included: number; extra: number; limit: number; ratio: number; status: UsageStatus; free: number };
const statusOf = (used: number, limit: number): UsageStatus => (used > limit ? "over" : limit > 0 && used === limit ? "atLimit" : limit > 0 && used / limit >= WARN_RATIO ? "warn" : "ok");

export function usageRows(state: BillingState, signals: BillingSignals, tenantId: string, asOf: string): UsageRow[] {
  const { included, extra, limit } = limitsOf(state, tenantId);
  return RESOURCES.map((resource) => {
    const used = usedOf(signals, tenantId, resource, asOf);
    return { resource, used, included: included[resource], extra: extra[resource], limit: limit[resource], ratio: limit[resource] > 0 ? used / limit[resource] : used > 0 ? 2 : 0, status: statusOf(used, limit[resource]), free: limit[resource] > used ? limit[resource] - used : 0 };
  });
}
/** The eight licenses a company manages seat by seat. */
export const licenses = (state: BillingState, signals: BillingSignals, tenantId: string, asOf: string): UsageRow[] =>
  usageRows(state, signals, tenantId, asOf).filter((row) => (["users", "workers", "branches", "departments", "teams", "academy", "marketplace", "integrations"] as Resource[]).includes(row.resource));

/** The resources where today's use would be above the limits of a plan or of the add-ons that would remain: used to refuse a downgrade or an add-on cancellation. */
export function overLimits(state: BillingState, signals: BillingSignals, tenantId: string, asOf: string, options: { planId?: string; withoutPurchase?: string } = {}): Resource[] {
  const { limit } = limitsOf(state, tenantId, options);
  return RESOURCES.filter((resource) => usedOf(signals, tenantId, resource, asOf) > limit[resource]);
}

export type LimitOption =
  | { kind: "addon"; addon: AddonKey; quantity: number; monthlyMicros: number; text: string }
  | { kind: "upgrade"; toPlanId: string; deltaMonthlyMicros: number; text: string };
export type LimitAlert = { resource: Resource; used: number; limit: number; status: UsageStatus; severity: "normal" | "high"; text: string; options: LimitOption[]; note: string };
const packsFor = (needed: number, units: number) => (needed <= 0 ? 1 : Math.ceil(needed / units));

function optionsFor(state: BillingState, tenantId: string, resource: Resource, target: number, limit: number): LimitOption[] {
  const options: LimitOption[] = [];
  const account = state.accounts.find((item) => item.tenantId === tenantId);
  const current = account && planOf(state, tenantId, account.planId);
  for (const [key, definition] of Object.entries(ADDONS) as [AddonKey, (typeof ADDONS)[AddonKey]][]) {
    if (definition.resource !== resource) continue;
    const quantity = packsFor(target - limit, definition.units);
    options.push({ kind: "addon", addon: key, quantity, monthlyMicros: definition.monthlyMicros * quantity, text: `Comprar ${quantity} × ${label("addon", key)}` });
  }
  const { extra } = limitsOf(state, tenantId);
  const up = plansFor(state, tenantId).find((plan) => plan.selfServe && current && plan.tier > current.tier && plan.limits[resource] + extra[resource] >= target);
  if (up && current) options.push({ kind: "upgrade", toPlanId: up.id, deltaMonthlyMicros: up.monthlyMicros - current.monthlyMicros, text: `Subir al plan ${up.name}` });
  return options.sort((a, b) => (a.kind === "addon" ? a.monthlyMicros : a.deltaMonthlyMicros) - (b.kind === "addon" ? b.monthlyMicros : b.deltaMonthlyMicros));
}

/** The limits close to or past their end, each with the options KOE recommends. KOE only recommends: it never blocks or deletes existing data. */
export function limitAlerts(state: BillingState, signals: BillingSignals, tenantId: string, asOf: string): LimitAlert[] {
  return usageRows(state, signals, tenantId, asOf).filter((row) => row.status !== "ok").map((row) => {
    const target = Math.ceil(row.used / WARN_RATIO);
    return {
      resource: row.resource, used: row.used, limit: row.limit, status: row.status, severity: row.status === "warn" ? "normal" as const : "high" as const,
      text: `${label("resource", row.resource)}: ${row.used} de ${row.limit} (${label("usageStatus", row.status)})`, options: optionsFor(state, tenantId, row.resource, target, row.limit), note: EXISTING_DATA_NOTE,
    };
  });
}

/** Whether a company can create more of something. Only creating more is limited; what already exists is never touched. */
export function canUse(state: BillingState, signals: BillingSignals, tenantId: string, resource: Resource, quantity: number, asOf: string): { allowed: boolean; options: LimitOption[]; note: string } {
  const row = usageRows(state, signals, tenantId, asOf).find((item) => item.resource === resource);
  const allowed = !!row && row.used + quantity <= row.limit;
  return { allowed, options: allowed || !row ? [] : optionsFor(state, tenantId, resource, row.used + quantity, row.limit), note: EXISTING_DATA_NOTE };
}

// ---------------------------------------------------------------- AI usage (KOE AI Usage): never a provider, only what KOE did
export type CostRow = { id: string; label: string; tasks: number; costMicros: number };
export type AiUsage = {
  windowDays: number; tasks: number; successes: number; costMicros: number; averageCostMicros: number; savedMinutes: number; savedMicros: number;
  byDepartment: CostRow[]; byWorker: CostRow[]; byAutomation: CostRow[]; byAgent: CostRow[];
};
const group = (events: readonly ExecutionEvent[], key: (event: ExecutionEvent) => { id: string; label: string } | undefined): CostRow[] => {
  const rows = new Map<string, CostRow>();
  for (const event of events) {
    const k = key(event);
    if (!k) continue;
    const row = rows.get(k.id) ?? { id: k.id, label: k.label, tasks: 0, costMicros: 0 };
    row.tasks += 1;
    row.costMicros += event.costMicros;
    rows.set(k.id, row);
  }
  return [...rows.values()].sort((a, b) => b.costMicros - a.costMicros || b.tasks - a.tasks || a.label.localeCompare(b.label));
};
export function aiUsage(signals: BillingSignals, tenantId: string, asOf: string): AiUsage {
  const events = windowOf(signals, tenantId, asOf);
  let costMicros = 0;
  let savedMinutes = 0;
  let successes = 0;
  for (const event of events) {
    costMicros += event.costMicros;
    if (event.outcome === "success") {
      successes += 1;
      if (event.process) savedMinutes += PROCESSES[event.process].manualMinutes;
    }
  }
  return {
    windowDays: WINDOW_DAYS, tasks: events.length, successes, costMicros, averageCostMicros: events.length > 0 ? Math.round(costMicros / events.length) : 0, savedMinutes, savedMicros: Math.round((savedMinutes / 60) * HOURLY_COST_MICROS),
    byDepartment: group(events, (event) => { const department = event.process ? PROCESSES[event.process].department : "unclassified"; return { id: department, label: label("department", department) }; }),
    byWorker: group(events, (event) => ({ id: event.workerId, label: event.workerName })),
    byAutomation: group(events, (event) => (event.automationId ? { id: event.automationId, label: event.automationName ?? event.automationId } : undefined)),
    byAgent: group(events, (event) => (event.agentId ? { id: event.agentId, label: event.agentName ?? event.agentId } : undefined)),
  };
}

// ---------------------------------------------------------------- ROI, with the assumptions declared
export type Roi = { savedMinutes: number; savedMicros: number; aiCostMicros: number; platformCostMicros: number; netMicros: number; returnPercent: number | null; assumption: string };
export function roi(state: BillingState, signals: BillingSignals, tenantId: string, asOf: string): Roi {
  const usage = aiUsage(signals, tenantId, asOf);
  const platformCostMicros = monthlyBill(state, tenantId).totalMicros;
  const cost = usage.costMicros + platformCostMicros;
  const netMicros = usage.savedMicros - cost;
  return {
    savedMinutes: usage.savedMinutes, savedMicros: usage.savedMicros, aiCostMicros: usage.costMicros, platformCostMicros, netMicros, returnPercent: cost > 0 ? Math.round((netMicros / cost) * 100) : null,
    assumption: `Cada minuto de trabajo manual que KOE evitó se valora a ${(HOURLY_COST_MICROS / 1_000_000).toFixed(0)} US$ la hora (un supuesto de la simulación); el costo es el de la IA más el plan y los add-ons de un mes.`,
  };
}

// ---------------------------------------------------------------- the forecast and the recommendation
export type ProjectedRow = { resource: Resource; used: number; projected: number; limit: number; ratio: number };
export type Recommendation = { kind: "stay" | "upgrade" | "downgrade"; toPlanId?: string; reasons: Resource[]; deltaMonthlyMicros: number; addonAlternativeMicros?: number; text: string };
export type Forecast = {
  windowDays: number; growth: number; projectedTasks: number; projectedAiCostMicros: number; platformMicros: number; projectedTotalMicros: number; rows: ProjectedRow[]; alerts: number; recommendation: Recommendation;
};
export function forecast(state: BillingState, signals: BillingSignals, tenantId: string, asOf: string): Forecast {
  const account = state.accounts.find((item) => item.tenantId === tenantId);
  const current = account && planOf(state, tenantId, account.planId);
  const usage = aiUsage(signals, tenantId, asOf);
  // the last 15 days against the 15 before them set the pace; the next 30 days follow it (kept between half and double)
  const recent = windowOf(signals, tenantId, asOf, 15).length;
  const earlier = windowOf(signals, tenantId, asOf, 15, 15).length;
  const growth = earlier > 0 ? Math.min(GROWTH_MAX, Math.max(GROWTH_MIN, recent / earlier)) : 1;
  const projectedTasks = Math.round(recent * 2 * growth);
  const { limit, extra } = limitsOf(state, tenantId);
  const rows: ProjectedRow[] = RESOURCES.map((resource) => {
    const used = usedOf(signals, tenantId, resource, asOf);
    const previous = resource === "aiTasks" ? undefined : sampleOf(signals, tenantId, resource)?.previous;
    const projected = resource === "aiTasks" ? projectedTasks : used + (previous !== undefined && used > previous ? used - previous : 0);
    return { resource, used, projected, limit: limit[resource], ratio: limit[resource] > 0 ? projected / limit[resource] : projected > 0 ? 2 : 0 };
  });
  const over = rows.filter((row) => row.projected > row.limit).map((row) => row.resource);
  const fits = (plan: Plan, headroom: number) => rows.every((row) => row.projected <= (plan.limits[row.resource] + extra[row.resource]) * headroom);
  const plans = plansFor(state, tenantId);
  const platformMicros = monthlyBill(state, tenantId).totalMicros;
  let recommendation: Recommendation = { kind: "stay", reasons: [], deltaMonthlyMicros: 0, text: "El plan actual alcanza para el uso proyectado." };
  if (current && over.length > 0) {
    const better = plans.find((plan) => plan.tier > current.tier && fits(plan, 1)) ?? plans.filter((plan) => plan.tier > current.tier).at(-1);
    let alternative = 0;
    let coverable = true;
    for (const resource of over) {
      const row = rows.find((item) => item.resource === resource);
      const addon = (Object.entries(ADDONS) as [AddonKey, (typeof ADDONS)[AddonKey]][]).find(([, definition]) => definition.resource === resource);
      if (!row || !addon) { coverable = false; continue; }
      alternative += addon[1].monthlyMicros * packsFor(row.projected - row.limit, addon[1].units);
    }
    if (better) {
      const delta = better.monthlyMicros - current.monthlyMicros;
      const cheaper = coverable && alternative < delta;
      recommendation = {
        kind: "upgrade", toPlanId: better.id, reasons: over, deltaMonthlyMicros: delta, ...(cheaper ? { addonAlternativeMicros: alternative } : {}),
        text: `El uso proyectado supera el plan en ${over.map((item) => label("resource", item)).join(", ")}: KOE recomienda subir a ${better.name}${cheaper ? ", o cubrirlo con add-ons por menos" : ""}.`,
      };
    } else recommendation = { kind: "stay", reasons: over, deltaMonthlyMicros: 0, text: "El uso proyectado supera el plan y no hay un plan superior que se elija solo: conviene acordar uno con KYNOVA." };
  } else if (current) {
    const smaller = plans.filter((plan) => plan.selfServe && plan.tier < current.tier && plan.monthlyMicros < current.monthlyMicros && fits(plan, DOWNGRADE_HEADROOM)).at(-1);
    if (smaller) recommendation = { kind: "downgrade", toPlanId: smaller.id, reasons: [], deltaMonthlyMicros: smaller.monthlyMicros - current.monthlyMicros, text: `El uso proyectado cabe con holgura en ${smaller.name}: bajar de plan ahorraría dinero. Es solo una recomendación.` };
  }
  const projectedAiCostMicros = Math.round(usage.averageCostMicros * projectedTasks);
  return { windowDays: WINDOW_DAYS, growth, projectedTasks, projectedAiCostMicros, platformMicros, projectedTotalMicros: platformMicros + projectedAiCostMicros, rows, alerts: rows.filter((row) => row.ratio >= WARN_RATIO).length, recommendation };
}

// ---------------------------------------------------------------- the dashboard
export type BillingDashboard = {
  planId: string; planName: string; status: string; renewsAt: string; daysToRenewal: number; trialEndsAt?: string; monthlyBill: ReturnType<typeof monthlyBill>;
  users: UsageRow; workers: UsageRow; storage: UsageRow; automations: UsageRow; integrations: UsageRow; marketplace: UsageRow; academy: UsageRow;
  ai: { tasks: number; costMicros: number; limit: UsageRow }; roi: Roi; creditMicros: number; outstandingMicros: number; overdueMicros: number; alerts: number; health: "ok" | "attention";
};
export function billingDashboard(state: BillingState, signals: BillingSignals, tenantId: string, asOf: string): BillingDashboard | undefined {
  const account = state.accounts.find((item) => item.tenantId === tenantId);
  const plan = account && planOf(state, tenantId, account.planId);
  if (!account || !plan) return undefined;
  const rows = usageRows(state, signals, tenantId, asOf);
  const row = (resource: Resource) => rows.find((item) => item.resource === resource) as UsageRow;
  const usage = aiUsage(signals, tenantId, asOf);
  const balance = accountBalance(state, tenantId, asOf);
  const alerts = limitAlerts(state, signals, tenantId, asOf).length;
  return {
    planId: plan.id, planName: plan.name, status: account.status, renewsAt: account.renewsAt, daysToRenewal: Math.floor((Date.parse(account.renewsAt) - Date.parse(asOf)) / DAY), ...(account.trialEndsAt ? { trialEndsAt: account.trialEndsAt } : {}),
    monthlyBill: monthlyBill(state, tenantId), users: row("users"), workers: row("workers"), storage: row("storage"), automations: row("automations"), integrations: row("integrations"), marketplace: row("marketplace"), academy: row("academy"),
    ai: { tasks: usage.tasks, costMicros: usage.costMicros, limit: row("aiTasks") }, roi: roi(state, signals, tenantId, asOf), creditMicros: creditBalance(state, tenantId), outstandingMicros: balance.outstandingMicros, overdueMicros: balance.overdueMicros,
    alerts, health: alerts > 0 || balance.overdueMicros > 0 || account.status === "cancelled" ? "attention" : "ok",
  };
}

/** Payment connectors the platform will use later. Declared only: none exists, and every one will go through KOE, never directly. */
export const FUTURE_PAYMENT_CONNECTORS = FUTURE_PAYMENTS.map((item) => ({ ...item, notBuilt: true as const, goesThrough: "KOE" as const, direct: false as const }));
