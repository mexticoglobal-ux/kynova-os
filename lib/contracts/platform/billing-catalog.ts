// The catalog of the Billing & Subscription Center: what can be limited, the plans and the add-ons. It is declarative data (like the base roles of the
// Organization module); every figure derived from it (a bill, a forecast, an ROI) is worked out only by koe-billing.ts. Money is an integer in
// micro-dollars, the same unit KOE uses for its own costs. Prices are SIMULATED: nothing here is a real price or reaches a payment provider.

export const RESOURCES = [
  "users", "workers", "branches", "departments", "teams", "storage", "academy", "marketplace", "integrations", "automations", "api", "aiStudio", "communications", "crm", "insights", "aiTasks",
] as const;
export type Resource = (typeof RESOURCES)[number];
export type Limits = Record<Resource, number>;

/** What each license controls: the eight the company manages seat by seat. The rest are limits of the plan (see LIMIT_RESOURCES). */
export const LICENSE_RESOURCES: readonly Resource[] = ["users", "workers", "branches", "departments", "teams", "academy", "marketplace", "integrations"];

export type Plan = {
  id: string;
  /** "platform" for the plans every company can choose; a company id for a custom plan only that company sees. */
  tenantId: string;
  name: string;
  tier: number;
  monthlyMicros: number;
  limits: Limits;
  selfServe: boolean;
  custom: boolean;
  summary: string;
};

const USD = 1_000_000;
const limits = (values: Limits): Limits => values;

export const PLANS: readonly Plan[] = [
  {
    id: "starter", tenantId: "platform", name: "Starter", tier: 1, monthlyMicros: 49 * USD, selfServe: true, custom: false, summary: "Para empezar con un equipo pequeño.",
    limits: limits({ users: 5, workers: 2, branches: 1, departments: 3, teams: 3, storage: 10, academy: 3, marketplace: 5, integrations: 3, automations: 5, api: 10_000, aiStudio: 5, communications: 3, crm: 500, insights: 2, aiTasks: 300 }),
  },
  {
    id: "professional", tenantId: "platform", name: "Professional", tier: 2, monthlyMicros: 149 * USD, selfServe: true, custom: false, summary: "Para una empresa que ya trabaja con Workers IA a diario.",
    limits: limits({ users: 25, workers: 8, branches: 3, departments: 10, teams: 12, storage: 100, academy: 15, marketplace: 25, integrations: 10, automations: 25, api: 100_000, aiStudio: 25, communications: 6, crm: 5_000, insights: 10, aiTasks: 3_000 }),
  },
  {
    id: "business", tenantId: "platform", name: "Business", tier: 3, monthlyMicros: 399 * USD, selfServe: true, custom: false, summary: "Para varias sucursales y una operación con mucho volumen.",
    limits: limits({ users: 100, workers: 25, branches: 10, departments: 30, teams: 50, storage: 500, academy: 60, marketplace: 100, integrations: 25, automations: 100, api: 1_000_000, aiStudio: 100, communications: 10, crm: 50_000, insights: 50, aiTasks: 15_000 }),
  },
  {
    id: "enterprise", tenantId: "platform", name: "Enterprise", tier: 4, monthlyMicros: 1_200 * USD, selfServe: false, custom: false, summary: "Para grandes organizaciones; se acuerda con el equipo de KYNOVA.",
    limits: limits({ users: 1_000, workers: 200, branches: 100, departments: 300, teams: 500, storage: 5_000, academy: 500, marketplace: 1_000, integrations: 200, automations: 1_000, api: 20_000_000, aiStudio: 1_000, communications: 50, crm: 1_000_000, insights: 500, aiTasks: 200_000 }),
  },
];

export const ADDON_KEYS = ["extraUsers", "extraWorkers", "storage", "academy", "marketplace", "automationPack", "aiCredits"] as const;
export type AddonKey = (typeof ADDON_KEYS)[number];
/** An add-on is bought in packs, is independent of the plan, and adds `units` of one resource for each pack. */
export const ADDONS: Record<AddonKey, { resource: Resource; units: number; monthlyMicros: number }> = {
  extraUsers: { resource: "users", units: 5, monthlyMicros: 25 * USD },
  extraWorkers: { resource: "workers", units: 2, monthlyMicros: 30 * USD },
  storage: { resource: "storage", units: 50, monthlyMicros: 10 * USD },
  academy: { resource: "academy", units: 5, monthlyMicros: 15 * USD },
  marketplace: { resource: "marketplace", units: 10, monthlyMicros: 12 * USD },
  automationPack: { resource: "automations", units: 10, monthlyMicros: 20 * USD },
  aiCredits: { resource: "aiTasks", units: 1_000, monthlyMicros: 18 * USD },
};

export const TRIAL_DAYS = 14;
export const INVOICE_DUE_DAYS = 14;
export const RENEWAL_WINDOW_DAYS = 3; // a renewal can be run this many days before it is due
export const MAX_PACKS = 20;
export const BILLING_AUTH_ACTION = "billing.request.auto";
export const SIMULATED_METHODS = ["simulatedCard", "simulatedTransfer"] as const;
export type SimulatedMethod = (typeof SIMULATED_METHODS)[number];

/** Payment connectors the platform will use later. Declared only: none exists today and every one will go through KOE, never directly. */
export const FUTURE_PAYMENTS = [
  { id: "stripe", name: "Stripe" },
  { id: "paypal", name: "PayPal" },
  { id: "makapay", name: "MakaPay" },
  { id: "makawallet", name: "MakaWallet" },
  { id: "sinpe", name: "SINPE" },
  { id: "crypto", name: "Cripto" },
  { id: "applePay", name: "Apple Pay" },
  { id: "googlePay", name: "Google Pay" },
] as const;
