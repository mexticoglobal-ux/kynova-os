// KOE Financial Router (Sprint 36). The ONE entry point for any movement of money in KYNOVA:  Billing -> Financial Router -> payment provider.
// Like the AI Gateway decides which model answers, the Router decides which payment provider moves the money: from the operation, the currency, the company's policy, the cost and the
// health of each provider. Pure and deterministic: `reduceRouter(state, event)` is the only way the state changes. It is ARCHITECTURE ONLY: the seven adapters (MakaPay, PayPal, Payoneer,
// Stripe, Apple Pay, Google Pay and Osmo) share one interface and are all DISCONNECTED; every attempt is simulated from their profile and no card, account, key or network is ever touched.
//
// What it guarantees: idempotency (one operation per key and company), money only moves after a person decides (Level 3: NEX and the system prepare, people approve; money out needs a second
// person), retries and timeouts, circuit breakers, fallback to another provider (never for a refund, which goes back to the provider that took the payment), costs, currency conversion only
// when the company allows it, the payment states of Payments, a full history, an append-only audit trail in the shape the Backend Core's Event Bus connector reads, and isolation by company.
// It reuses `Money`, the payment states and the exchange rates of the Payments module; it does not touch Billing, KOE, NEX, the AI Gateway or the Runtime (see ADR-0020).

import { isPerson } from "./actors";
import type { Invoice } from "./billing-center";
import { CURRENCIES, convertMinor, isCrypto, isCurrency, type FxRate } from "./currency";
import { canTransitionPayment, isMoney, netAmount, type Money, type PaymentStatus } from "./payments";

// ---------------------------------------------------------------- the operations the Router supports
export const MONEY_OPERATIONS = ["membershipCharge", "marketplaceCharge", "renewal", "subscription", "planChange", "partnerPayout", "refund", "credit", "commission", "invoice"] as const;
export type MoneyOperation = (typeof MONEY_OPERATIONS)[number];
/** What the operation needs from a person and whether a provider moves money. `person`: a person asks (or approves what a worker or the system prepared). `second`: a DIFFERENT person approves. */
export type OperationSpec = { flow: "in" | "out" | "internal"; provider: boolean; approval: "person" | "second"; requires: "invoiceOrCustomer" | "listing" | "partner" | "original" | "customer" };
export const OPERATIONS: Record<MoneyOperation, OperationSpec> = {
  membershipCharge: { flow: "in", provider: true, approval: "person", requires: "invoiceOrCustomer" },
  marketplaceCharge: { flow: "in", provider: true, approval: "person", requires: "listing" },
  renewal: { flow: "in", provider: true, approval: "person", requires: "invoiceOrCustomer" },
  subscription: { flow: "in", provider: true, approval: "person", requires: "invoiceOrCustomer" },
  planChange: { flow: "in", provider: true, approval: "person", requires: "invoiceOrCustomer" },
  partnerPayout: { flow: "out", provider: true, approval: "second", requires: "partner" },
  refund: { flow: "out", provider: true, approval: "second", requires: "original" },
  credit: { flow: "internal", provider: false, approval: "second", requires: "customer" },
  commission: { flow: "internal", provider: false, approval: "person", requires: "partner" },
  invoice: { flow: "internal", provider: false, approval: "person", requires: "invoiceOrCustomer" },
};

// ---------------------------------------------------------------- the adapters: one interface, none connected
export const PROVIDER_IDS = ["makapay", "paypal", "payoneer", "stripe", "applePay", "googlePay", "osmo"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
export type AdapterRequest = { operationId: string; tenantId: string; kind: MoneyOperation; amount: Money; method?: string; idempotencyKey: string; reference: Readonly<Record<string, string>> };
export type AdapterResult = { ok: true; providerRef: string } | { ok: false; kind: "notConnected" | "down" | "timeout" | "rateLimited" | "declined" };
/** The contract every payment provider will implement. Today every adapter answers `notConnected`: the Router never calls `execute` while `connected` is false. */
export interface PaymentAdapter {
  readonly id: ProviderId;
  readonly label: string;
  readonly connected: boolean;
  readonly capabilities: { readonly operations: readonly MoneyOperation[]; readonly currencies: readonly string[]; readonly methods: readonly string[] };
  /** Fixed part plus basis points of the amount, in the currency of the operation. REFERENCE values to verify against each provider's contract. */
  readonly pricing: { readonly fixedMinor: number; readonly bps: number };
  /** What the simulation assumes: how long a call takes and how often it works. REFERENCE values. */
  readonly profile: { readonly baseLatencyMs: number; readonly reliability: number };
  execute(request: AdapterRequest): Promise<AdapterResult>;
}
const adapter = (id: ProviderId, label: string, operations: readonly MoneyOperation[], currencies: readonly string[], methods: readonly string[], pricing: PaymentAdapter["pricing"], profile: PaymentAdapter["profile"]): PaymentAdapter =>
  ({ id, label, connected: false, capabilities: { operations, currencies, methods }, pricing, profile, execute: async () => ({ ok: false, kind: "notConnected" }) });
const CHARGES: readonly MoneyOperation[] = ["membershipCharge", "marketplaceCharge", "renewal", "subscription", "planChange"];
export const ADAPTERS: readonly PaymentAdapter[] = [
  adapter("stripe", "Stripe", [...CHARGES, "refund"], ["USD", "EUR", "MXN", "JPY"], ["card"], { fixedMinor: 30, bps: 290 }, { baseLatencyMs: 350, reliability: 0.998 }),
  adapter("paypal", "PayPal", [...CHARGES, "refund", "partnerPayout"], ["USD", "EUR", "MXN"], ["wallet", "card"], { fixedMinor: 49, bps: 349 }, { baseLatencyMs: 600, reliability: 0.995 }),
  adapter("makapay", "MakaPay", [...CHARGES, "refund", "partnerPayout"], ["USD", "CRC"], ["card", "transfer"], { fixedMinor: 0, bps: 150 }, { baseLatencyMs: 450, reliability: 0.99 }),
  adapter("payoneer", "Payoneer", ["partnerPayout"], ["USD", "EUR"], ["transfer"], { fixedMinor: 0, bps: 200 }, { baseLatencyMs: 900, reliability: 0.995 }),
  adapter("applePay", "Apple Pay", ["membershipCharge", "marketplaceCharge", "renewal"], ["USD", "EUR", "MXN"], ["applePay"], { fixedMinor: 30, bps: 290 }, { baseLatencyMs: 300, reliability: 0.997 }),
  adapter("googlePay", "Google Pay", ["membershipCharge", "marketplaceCharge", "renewal"], ["USD", "EUR", "MXN"], ["googlePay"], { fixedMinor: 30, bps: 290 }, { baseLatencyMs: 320, reliability: 0.997 }),
  adapter("osmo", "Osmo", [...CHARGES, "partnerPayout"], ["USD"], ["card", "transfer"], { fixedMinor: 0, bps: 180 }, { baseLatencyMs: 500, reliability: 0.99 }),
];
export const adapterById = (id: string): PaymentAdapter | undefined => ADAPTERS.find((item) => item.id === id);

// ---------------------------------------------------------------- policies, limits and configuration of a company
export const ROUTER_POLICIES = ["cost", "reliability", "speed", "balanced"] as const;
export type RouterPolicy = (typeof ROUTER_POLICIES)[number];
export type RouterLimits = { retry: { maxAttempts: number; backoffMs: readonly number[] }; breaker: { failureThreshold: number; cooldownMs: number }; timeoutMs: number };
export const ROUTER_LIMIT_DEFAULTS: RouterLimits = { retry: { maxAttempts: 2, backoffMs: [200, 800] }, breaker: { failureThreshold: 3, cooldownMs: 60_000 }, timeoutMs: 5_000 };
export const ROUTER_CEILINGS = { maxAttempts: 4, timeoutMs: 30_000 } as const;
export type RouterConfig = {
  tenantId: string; ownerId: string; admins: readonly string[]; policy: RouterPolicy; allowedProviders: readonly ProviderId[]; allowConversion: boolean; rates: readonly FxRate[]; limits: RouterLimits; updatedAt: string; updatedBy: string;
};
export const defaultConfig = (tenantId: string, at: string, by = "system"): RouterConfig => ({ tenantId, ownerId: by, admins: [], policy: "balanced", allowedProviders: [...PROVIDER_IDS], allowConversion: false, rates: [], limits: ROUTER_LIMIT_DEFAULTS, updatedAt: at, updatedBy: by });

export function validateLimits(limits: RouterLimits): string[] {
  const issues: string[] = [];
  if (!Number.isInteger(limits.retry.maxAttempts) || limits.retry.maxAttempts < 1 || limits.retry.maxAttempts > ROUTER_CEILINGS.maxAttempts) issues.push("reintentos");
  if (limits.retry.backoffMs.length === 0 || limits.retry.backoffMs.some((item) => !Number.isInteger(item) || item < 0)) issues.push("espera");
  if (!Number.isInteger(limits.breaker.failureThreshold) || limits.breaker.failureThreshold < 1 || !Number.isInteger(limits.breaker.cooldownMs) || limits.breaker.cooldownMs < 0) issues.push("cortacircuitos");
  if (!Number.isInteger(limits.timeoutMs) || limits.timeoutMs < 100 || limits.timeoutMs > ROUTER_CEILINGS.timeoutMs) issues.push("tiempo máximo");
  return issues;
}

// ---------------------------------------------------------------- the records
export type OperationStatus = "awaitingApproval" | "rejected" | "approved" | "processing" | PaymentStatus;
export type AttemptOutcome = "ok" | "down" | "timeout" | "rateLimited" | "skipped";
export type Attempt = { providerId: string; outcome: AttemptOutcome; latencyMs: number; backoffMs: number; note: string };
export type Operation = {
  id: string; tenantId: string; kind: MoneyOperation; amount: Money; status: OperationStatus; description: string; idempotencyKey: string; fingerprint: string; reference: Readonly<Record<string, string>>;
  method?: string; preferredProvider?: ProviderId; requestedBy: string; requestedAt: string; approvedBy?: string; approvedAt?: string; providerId?: string; providerRef?: string; fallbackUsed: boolean;
  attempts: readonly Attempt[]; feeMinor: number; netMinor: number; settled?: Money; fx?: { from: string; to: string; rate: number }; parentId?: string; recurring?: { interval: "month"; nextAt: string };
  simulated: true; failureReason?: string; history: readonly { at: string; status: OperationStatus; note: string }[];
};
export type BreakerRecord = { tenantId: string; providerId: string; failures: number; openedAt?: string };
export type IncidentMode = "down" | "timeout" | "rateLimited" | "slow";
export const INCIDENT_MODES: readonly IncidentMode[] = ["down", "timeout", "rateLimited", "slow"];
export type Incident = { providerId: string; mode: IncidentMode; since: string; by: string };
export type CreditEntry = { id: string; tenantId: string; customerId: string; amount: Money; operationId: string; at: string };
export type RouterAudit = { at: string; actor: string; tenantId: string; action: string; detail?: string };
export type RouterState = {
  configs: readonly RouterConfig[]; operations: readonly Operation[]; breakers: readonly BreakerRecord[]; incidents: readonly Incident[]; credits: readonly CreditEntry[]; invoiceNumbers: readonly { tenantId: string; operationId: string; number: string }[];
  audit: readonly RouterAudit[]; sequence: number;
};
export const newRouterState = (): RouterState => ({ configs: [], operations: [], breakers: [], incidents: [], credits: [], invoiceNumbers: [], audit: [], sequence: 0 });

// ---------------------------------------------------------------- events
type Base = { at: string; tenantId: string; actor: string };
export type RequestInput = {
  operation: MoneyOperation; amount: Money; idempotencyKey: string; description: string; reference: Readonly<Record<string, string>>; method?: string; preferredProvider?: string;
  recurring?: boolean;
};
export type WebhookStatus = "succeeded" | "failed" | "disputed" | "refunded";
export type RouterEvent =
  | (Base & { type: "router.configure"; policy?: RouterPolicy; allowedProviders?: readonly string[]; allowConversion?: boolean; limits?: Partial<Omit<RouterLimits, "retry" | "breaker">> & { retry?: Partial<RouterLimits["retry"]>; breaker?: Partial<RouterLimits["breaker"]> }; admins?: readonly string[] })
  | (Base & { type: "router.rates"; rates: readonly FxRate[] })
  | (Base & { type: "payment.request"; input: RequestInput })
  | (Base & { type: "payment.approve"; operationId: string })
  | (Base & { type: "payment.reject"; operationId: string; reason: string })
  | (Base & { type: "payment.process"; operationId: string })
  | (Base & { type: "webhook.receive"; operationId: string; status: WebhookStatus })
  | (Base & { type: "provider.incident"; providerId: string; mode: IncidentMode })
  | (Base & { type: "provider.recover"; providerId: string });
export type RouterResult = { state: RouterState; error?: string; errorCode?: string; operation?: Operation; duplicate?: boolean };

export const ERRORS = {
  tenantRequired: "Falta la empresa (tenant_id).", personRequired: "Solo una persona puede hacerlo: NEX y el sistema no.", forbidden: "No tienes permiso para hacerlo.", invalid: "Dato no válido.", notFound: "No existe.",
  idempotencyConflict: "Esa clave de idempotencia ya se usó con otra operación distinta.", currencyUnsupported: "Ningún proveedor permitido mueve esa moneda y la conversión no está autorizada.", noProvider: "Ningún proveedor permitido puede hacer esta operación.",
  invalidTransition: "Ese cambio de estado no es posible.", samePerson: "Quien solicita no puede aprobar: hace falta otra persona.", alreadyDone: "La operación ya se procesó.", notApproved: "La operación todavía no está aprobada.",
  refundExceeds: "El reembolso supera lo cobrado.", notRefundable: "Solo se reembolsa un cobro exitoso de la misma empresa.", cryptoReserved: "La criptomoneda está reservada: se puede representar, no liquidar todavía.",
} as const;
export type RouterErrorCode = keyof typeof ERRORS;

// ---------------------------------------------------------------- small deterministic helpers
const KEY = /^[A-Za-z0-9_.:-]{8,64}$/;
const pad = (value: number) => String(value).padStart(4, "0");
function fnv(text: string): number { let hash = 0x811c9dc5; for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193) >>> 0; } return hash; }
const fingerprintOf = (input: RequestInput) => fnv(JSON.stringify([input.operation, input.amount, input.description, Object.entries(input.reference).sort(), input.method ?? "", input.preferredProvider ?? "", input.recurring ?? false])).toString(16);
const feeOf = (provider: Pick<PaymentAdapter, "pricing">, amountMinor: number) => provider.pricing.fixedMinor + Math.floor((amountMinor * provider.pricing.bps) / 10_000);
const addMonth = (iso: string) => { const date = new Date(iso); date.setUTCMonth(date.getUTCMonth() + 1); return date.toISOString(); };

// ---------------------------------------------------------------- breakers (the same idea as the AI Gateway's, for payment providers)
export function breakerOpen(record: BreakerRecord | undefined, limits: RouterLimits, at: string): boolean {
  if (!record?.openedAt) return false;
  return Date.parse(at) - Date.parse(record.openedAt) < limits.breaker.cooldownMs;
}
function afterAttempt(record: BreakerRecord | undefined, tenantId: string, providerId: string, ok: boolean, limits: RouterLimits, at: string): BreakerRecord {
  if (ok) return { tenantId, providerId, failures: 0 };
  const failures = (record?.failures ?? 0) + 1;
  return { tenantId, providerId, failures, ...(failures >= limits.breaker.failureThreshold ? { openedAt: at } : {}) };
}
const RETRYABLE: readonly AttemptOutcome[] = ["timeout", "rateLimited"];

/** One simulated call to a provider, from its profile and any incident declared on it: it never leaves the process. */
export function simulateAttempt(provider: PaymentAdapter, incident: Incident | undefined, timeoutMs: number, seed: string): { outcome: AttemptOutcome; latencyMs: number } {
  const jitter = fnv(seed) % (Math.floor(provider.profile.baseLatencyMs / 5) + 1);
  const normal = provider.profile.baseLatencyMs + jitter;
  if (incident?.mode === "down") return { outcome: "down", latencyMs: 40 };
  if (incident?.mode === "rateLimited") return { outcome: "rateLimited", latencyMs: 60 };
  if (incident?.mode === "timeout") return { outcome: "timeout", latencyMs: timeoutMs };
  const latencyMs = incident?.mode === "slow" ? normal * 10 : normal;
  return latencyMs > timeoutMs ? { outcome: "timeout", latencyMs: timeoutMs } : { outcome: "ok", latencyMs };
}

// ---------------------------------------------------------------- the decision: which provider, in which currency
export type Candidate = { provider: PaymentAdapter; settle: Money; feeMinor: number; fx?: { from: string; to: string; rate: number } };
/** The providers that can do this operation for this company, best first. Pure: it explains the decision and changes nothing. `reliabilityOf` lets history refine the profile. */
export function routeCandidates(config: RouterConfig, kind: MoneyOperation, amount: Money, method?: string, reliabilityOf: (providerId: string) => number | undefined = () => undefined): Candidate[] {
  const out: Candidate[] = [];
  for (const provider of ADAPTERS) {
    if (!config.allowedProviders.includes(provider.id) || !provider.capabilities.operations.includes(kind)) continue;
    if (method && !provider.capabilities.methods.includes(method)) continue;
    let settle: Money | null = provider.capabilities.currencies.includes(amount.currency) ? amount : null;
    let fx: Candidate["fx"];
    if (!settle && config.allowConversion) {
      for (const currency of provider.capabilities.currencies) {
        const converted = isCurrency(currency) ? convertMinor(amount, currency, config.rates) : null;
        if (converted) { settle = converted; fx = { from: amount.currency, to: currency, rate: converted.amountMinor / Math.max(1, amount.amountMinor) }; break; }
      }
    }
    if (settle) out.push({ provider, settle, feeMinor: feeOf(provider, settle.amountMinor), ...(fx ? { fx } : {}) });
  }
  const reliability = (item: Candidate) => reliabilityOf(item.provider.id) ?? item.provider.profile.reliability;
  const rank = (values: number[], pick: (a: number, b: number) => boolean) => values.map((value) => values.filter((other) => pick(other, value)).length);
  const fees = rank(out.map((item) => item.feeMinor / Math.max(1, item.settle.amountMinor)), (a, b) => a < b);
  const speeds = rank(out.map((item) => item.provider.profile.baseLatencyMs), (a, b) => a < b);
  const trusts = rank(out.map(reliability), (a, b) => a > b);
  const score = (index: number) => (config.policy === "cost" ? (fees[index] ?? 0) * 10_000 + (trusts[index] ?? 0) * 100 + (speeds[index] ?? 0) : config.policy === "reliability" ? (trusts[index] ?? 0) * 10_000 + (fees[index] ?? 0) * 100 + (speeds[index] ?? 0) : config.policy === "speed" ? (speeds[index] ?? 0) * 10_000 + (fees[index] ?? 0) * 100 + (trusts[index] ?? 0) : (fees[index] ?? 0) + (speeds[index] ?? 0) + (trusts[index] ?? 0));
  const order = out.map((item, index) => ({ item, key: score(index) })).sort((a, b) => a.key - b.key || a.item.provider.id.localeCompare(b.item.provider.id)).map((entry) => entry.item);
  return order;
}

/** The share of attempts that worked, per provider, from this company's own history (undefined until there are 5 attempts). */
export function observedReliability(state: RouterState, tenantId: string, providerId: string): number | undefined {
  const attempts = state.operations.filter((item) => item.tenantId === tenantId).flatMap((item) => item.attempts).filter((item) => item.providerId === providerId && item.outcome !== "skipped");
  return attempts.length < 5 ? undefined : attempts.filter((item) => item.outcome === "ok").length / attempts.length;
}

// ---------------------------------------------------------------- the reducer
export function reduceRouter(state: RouterState, event: RouterEvent): RouterResult {
  const refuse = (code: RouterErrorCode, detail?: string): RouterResult => ({ state, error: detail ? `${ERRORS[code]} ${detail}` : ERRORS[code], errorCode: code });
  if (!event.tenantId || event.tenantId.trim() === "" || !event.actor || event.actor.trim() === "") return refuse("tenantRequired");
  const { tenantId, at } = event;
  const config = state.configs.find((item) => item.tenantId === tenantId) ?? defaultConfig(tenantId, at);
  const configured = state.configs.some((item) => item.tenantId === tenantId);
  const isAdmin = (actor: string) => isPerson(actor) && (!configured || config.ownerId === actor || config.admins.includes(actor));
  const record = (next: RouterState, action: string, detail?: string): RouterState => ({ ...next, audit: [...next.audit, { at, actor: event.actor, tenantId, action, ...(detail ? { detail } : {}) }] });
  const operationOf = (id: string) => state.operations.find((item) => item.id === id && item.tenantId === tenantId);
  const replace = (current: RouterState, updated: Operation): RouterState => ({ ...current, operations: current.operations.map((item) => (item.id === updated.id ? updated : item)) });
  const step = (operation: Operation, status: OperationStatus, note: string): Operation => ({ ...operation, status, history: [...operation.history, { at, status, note }] });

  switch (event.type) {
    case "router.configure": {
      if (!isPerson(event.actor)) return refuse("personRequired");
      if (configured && !isAdmin(event.actor)) return refuse("forbidden");
      if (event.policy !== undefined && !ROUTER_POLICIES.includes(event.policy)) return refuse("invalid", "política");
      if (event.allowedProviders && (event.allowedProviders.length === 0 || event.allowedProviders.some((item) => !PROVIDER_IDS.includes(item as ProviderId)))) return refuse("invalid", "proveedores");
      const limits: RouterLimits = { ...config.limits, ...event.limits, retry: { ...config.limits.retry, ...event.limits?.retry }, breaker: { ...config.limits.breaker, ...event.limits?.breaker } };
      const issues = validateLimits(limits);
      if (issues.length) return refuse("invalid", issues[0]);
      const next: RouterConfig = { ...config, ownerId: configured ? config.ownerId : event.actor, admins: event.admins ?? config.admins, policy: event.policy ?? config.policy, allowedProviders: (event.allowedProviders as readonly ProviderId[] | undefined) ?? config.allowedProviders, allowConversion: event.allowConversion ?? config.allowConversion, limits, updatedAt: at, updatedBy: event.actor };
      const configs = configured ? state.configs.map((item) => (item.tenantId === tenantId ? next : item)) : [...state.configs, next];
      return { state: record({ ...state, configs }, "router.configure", `${next.policy} · ${next.allowedProviders.length} proveedores${next.allowConversion ? " · conversión" : ""}`) };
    }
    case "router.rates": {
      if (!isPerson(event.actor)) return refuse("personRequired");
      if (configured && !isAdmin(event.actor)) return refuse("forbidden");
      if (event.rates.some((rate) => !isCurrency(rate.from) || !isCurrency(rate.to) || !(rate.rate > 0) || !Number.isFinite(rate.rate) || isCrypto(rate.from) || isCrypto(rate.to))) return refuse("invalid", "tasa");
      const next: RouterConfig = { ...config, ownerId: configured ? config.ownerId : event.actor, rates: event.rates, updatedAt: at, updatedBy: event.actor };
      const configs = configured ? state.configs.map((item) => (item.tenantId === tenantId ? next : item)) : [...state.configs, next];
      return { state: record({ ...state, configs }, "router.rates", String(event.rates.length)) };
    }
    case "provider.incident": case "provider.recover": {
      if (event.actor !== "system") return refuse("forbidden");
      if (!adapterById(event.providerId)) return refuse("invalid", "proveedor");
      if (event.type === "provider.incident") {
        if (!INCIDENT_MODES.includes(event.mode)) return refuse("invalid", "incidente");
        const incidents = [...state.incidents.filter((item) => item.providerId !== event.providerId), { providerId: event.providerId, mode: event.mode, since: at, by: event.actor }];
        return { state: record({ ...state, incidents }, "provider.incident", `${event.providerId} · ${event.mode}`) };
      }
      return { state: record({ ...state, incidents: state.incidents.filter((item) => item.providerId !== event.providerId) }, "provider.recover", event.providerId) };
    }
    case "payment.request": {
      const { input } = event;
      const spec = OPERATIONS[input.operation];
      if (!spec) return refuse("invalid", "operación");
      if (!KEY.test(input.idempotencyKey)) return refuse("invalid", "clave de idempotencia");
      // idempotency first: the same key from the same company is the same operation, and asking again never creates a second one
      const fingerprint = fingerprintOf(input);
      const existing = state.operations.find((item) => item.tenantId === tenantId && item.idempotencyKey === input.idempotencyKey);
      if (existing) return existing.fingerprint === fingerprint ? { state, operation: existing, duplicate: true } : refuse("idempotencyConflict");
      if (!isMoney(input.amount) || input.amount.amountMinor <= 0 || !isCurrency(input.amount.currency)) return refuse("invalid", "monto");
      if (isCrypto(input.amount.currency)) return refuse("cryptoReserved");
      if (input.description.trim() === "" || input.description.length > 200) return refuse("invalid", "descripción");
      const ref = input.reference;
      const needs = { invoiceOrCustomer: !!(ref["invoiceId"] || ref["customerId"]), listing: !!ref["listingId"], partner: !!ref["partnerId"], original: !!ref["originalOperationId"], customer: !!ref["customerId"] }[spec.requires];
      if (!needs) return refuse("invalid", "referencia");
      if (input.preferredProvider !== undefined && !adapterById(input.preferredProvider)) return refuse("invalid", "proveedor preferido");
      let parentId: string | undefined;
      if (input.operation === "refund") {
        const original = operationOf(ref["originalOperationId"] ?? "");
        if (!original || !(["succeeded", "partiallyRefunded"] as OperationStatus[]).includes(original.status) || !OPERATIONS[original.kind].provider || OPERATIONS[original.kind].flow !== "in") return refuse("notRefundable");
        if (original.amount.currency !== input.amount.currency) return refuse("invalid", "moneda distinta a la del cobro");
        const refunded = state.operations.filter((item) => item.parentId === original.id && item.kind === "refund" && item.status !== "rejected" && item.status !== "failed").map((item) => item.amount);
        try { netAmount(original.amount, [...refunded, input.amount]); } catch { return refuse("refundExceeds"); }
        parentId = original.id;
      }
      if (spec.provider && input.operation !== "refund" && routeCandidates(config, input.operation, input.amount, input.method).length === 0) {
        return refuse(config.allowedProviders.length && ADAPTERS.some((item) => config.allowedProviders.includes(item.id) && item.capabilities.operations.includes(input.operation)) ? "currencyUnsupported" : "noProvider");
      }
      const id = `op_${pad(state.sequence + 1)}`;
      // a person may ask on their own for what needs one person; a worker or the system only PREPARES; money out and credits always need a second person
      const selfApproved = spec.approval === "person" && isPerson(event.actor);
      const operation: Operation = {
        id, tenantId, kind: input.operation, amount: input.amount, status: selfApproved ? "approved" : "awaitingApproval", description: input.description.trim(), idempotencyKey: input.idempotencyKey, fingerprint, reference: ref, ...(input.method ? { method: input.method } : {}),
        ...(input.preferredProvider ? { preferredProvider: input.preferredProvider as ProviderId } : {}), requestedBy: event.actor, requestedAt: at, ...(selfApproved ? { approvedBy: event.actor, approvedAt: at } : {}), fallbackUsed: false, attempts: [], feeMinor: 0, netMinor: 0,
        ...(parentId ? { parentId } : {}), simulated: true, history: [{ at, status: selfApproved ? "approved" : "awaitingApproval", note: selfApproved ? "pedido por una persona" : "espera a una persona" }],
        ...(input.recurring ? { recurring: { interval: "month" as const, nextAt: addMonth(at) } } : {}),
      };
      return { state: record({ ...state, operations: [...state.operations, operation], sequence: state.sequence + 1 }, "payment.request", `${id} · ${input.operation} · ${input.amount.amountMinor} ${input.amount.currency}`), operation };
    }
    case "payment.approve": case "payment.reject": {
      if (!isPerson(event.actor)) return refuse("personRequired");
      const operation = operationOf(event.operationId);
      if (!operation) return refuse("notFound");
      if (operation.status !== "awaitingApproval") return refuse("invalidTransition", operation.status);
      if (event.type === "payment.reject") return { state: record(replace(state, step(operation, "rejected", event.reason)), "payment.reject", `${operation.id} · ${event.reason}`) };
      if (operation.requestedBy === event.actor) return refuse("samePerson");
      return { state: record(replace(state, { ...step(operation, "approved", "aprobada por una persona"), approvedBy: event.actor, approvedAt: at }), "payment.approve", operation.id) };
    }
    case "payment.process": {
      if (!isPerson(event.actor) && event.actor !== "system") return refuse("personRequired");
      const operation = operationOf(event.operationId);
      if (!operation) return refuse("notFound");
      if (operation.status === "awaitingApproval") return refuse("notApproved");
      if (operation.status !== "approved") return refuse("alreadyDone", operation.status);
      return processOperation(state, config, operation, event, record, replace, step);
    }
    case "webhook.receive": {
      if (event.actor !== "system") return refuse("forbidden");
      const operation = operationOf(event.operationId);
      if (!operation) return refuse("notFound");
      const target: PaymentStatus = event.status === "refunded" ? "refunded" : event.status;
      if (!(["succeeded", "partiallyRefunded", "disputed", "pending", "failed", "refunded"] as OperationStatus[]).includes(operation.status) || !canTransitionPayment(operation.status as PaymentStatus, target)) return refuse("invalidTransition", `${operation.status} → ${target}`);
      return { state: record(replace(state, step(operation, target, `aviso del proveedor: ${event.status}`)), "webhook.receive", `${operation.id} · ${event.status}`) };
    }
    default: return refuse("invalid");
  }
}

/** Runs an approved operation: internal ones post to the ledger; the rest go through the providers, with retries, timeouts, breakers and fallback. */
function processOperation(
  state: RouterState, config: RouterConfig, operation: Operation, event: Extract<RouterEvent, { type: "payment.process" }>,
  record: (next: RouterState, action: string, detail?: string) => RouterState, replace: (current: RouterState, updated: Operation) => RouterState, step: (operation: Operation, status: OperationStatus, note: string) => Operation,
): RouterResult {
  const { at, tenantId } = event;
  const spec = OPERATIONS[operation.kind];
  if (!spec.provider) {
    let next = state;
    let done: Operation = { ...step(operation, "succeeded", "registrada en el libro"), providerId: "ledger", netMinor: operation.amount.amountMinor };
    if (operation.kind === "credit") next = { ...next, credits: [...next.credits, { id: `cr_${pad(next.credits.length + 1)}`, tenantId, customerId: operation.reference["customerId"] ?? "", amount: operation.amount, operationId: operation.id, at }] };
    if (operation.kind === "invoice") { const number = `FAC-${pad(next.invoiceNumbers.filter((item) => item.tenantId === tenantId).length + 1)}`; next = { ...next, invoiceNumbers: [...next.invoiceNumbers, { tenantId, operationId: operation.id, number }] }; done = { ...done, providerRef: number }; }
    return { state: record(replace(next, done), "payment.process", `${operation.id} · ledger`), operation: done };
  }

  // the providers to try, best first; a refund goes back to the provider that took the payment, and only there
  let chain: Candidate[];
  if (operation.kind === "refund") {
    const original = state.operations.find((item) => item.id === operation.parentId);
    const provider = adapterById(original?.providerId ?? "");
    chain = provider && provider.capabilities.operations.includes("refund") ? [{ provider, settle: original?.settled ?? operation.amount, feeMinor: 0 }] : [];
  } else {
    chain = routeCandidates(config, operation.kind, operation.amount, operation.method, (id) => observedReliability(state, tenantId, id));
    if (operation.preferredProvider) chain = [...chain.filter((item) => item.provider.id === operation.preferredProvider), ...chain.filter((item) => item.provider.id !== operation.preferredProvider)];
  }
  const attempts: Attempt[] = [];
  let breakers = state.breakers;
  const { limits } = config;
  let winner: { candidate: Candidate; providerRef: string } | undefined;
  for (const [position, candidate] of chain.entries()) {
    const id = candidate.provider.id;
    const incident = state.incidents.find((item) => item.providerId === id);
    if (breakerOpen(breakers.find((item) => item.tenantId === tenantId && item.providerId === id), limits, at)) { attempts.push({ providerId: id, outcome: "skipped", latencyMs: 0, backoffMs: 0, note: "cortacircuitos abierto" }); continue; }
    for (let tryNumber = 0; tryNumber < limits.retry.maxAttempts; tryNumber += 1) {
      const result = simulateAttempt(candidate.provider, incident, limits.timeoutMs, `${operation.id}|${id}|${tryNumber}`);
      const retry = RETRYABLE.includes(result.outcome) && tryNumber + 1 < limits.retry.maxAttempts;
      const backoffMs = retry ? (limits.retry.backoffMs[Math.min(tryNumber, limits.retry.backoffMs.length - 1)] ?? 0) : 0;
      attempts.push({ providerId: id, outcome: result.outcome, latencyMs: result.latencyMs, backoffMs, note: result.outcome === "ok" ? (position > 0 ? "respaldo" : "") : `intento ${tryNumber + 1}` });
      const prior = breakers.find((item) => item.tenantId === tenantId && item.providerId === id);
      const updated = afterAttempt(prior, tenantId, id, result.outcome === "ok", limits, at);
      breakers = prior ? breakers.map((item) => (item.tenantId === tenantId && item.providerId === id ? updated : item)) : [...breakers, updated];
      if (result.outcome === "ok") { winner = { candidate, providerRef: `sim_${id}_${operation.id}` }; break; }
      if (!retry) break;
    }
    if (winner) break;
    if (operation.kind === "refund") break;
  }
  if (!winner) {
    const failed: Operation = { ...step(operation, "failed", "ningún proveedor pudo hacerla"), attempts, failureReason: attempts.map((item) => `${item.providerId}: ${item.outcome}`).join(", ") || "sin proveedor" };
    return { state: record(replace({ ...state, breakers }, failed), "payment.failed", `${operation.id} · ${failed.failureReason}`), operation: failed };
  }
  const { candidate, providerRef } = winner;
  const fee = operation.kind === "refund" ? 0 : candidate.feeMinor;
  const done: Operation = {
    ...step(operation, "succeeded", `simulada con ${candidate.provider.label}`), attempts, providerId: candidate.provider.id, providerRef, fallbackUsed: attempts.some((item) => item.providerId !== candidate.provider.id && item.outcome !== "ok"),
    feeMinor: fee, netMinor: candidate.settle.amountMinor - fee, settled: candidate.settle, ...(candidate.fx ? { fx: candidate.fx } : {}),
  };
  const withParent = operation.kind === "refund" && operation.parentId ? settleParent(replace({ ...state, breakers }, done), operation.parentId, tenantId, at) : replace({ ...state, breakers }, done);
  return { state: record(withParent, "payment.process", `${operation.id} · ${candidate.provider.id}${done.fallbackUsed ? " · respaldo" : ""} · comisión ${fee}`), operation: done };
}

/** After a refund, the original payment is partially or fully refunded: the state follows the Payments rules. */
function settleParent(state: RouterState, parentId: string, tenantId: string, at: string): RouterState {
  const parent = state.operations.find((item) => item.id === parentId && item.tenantId === tenantId);
  if (!parent) return state;
  const refunded = state.operations.filter((item) => item.parentId === parentId && item.kind === "refund" && item.status === "succeeded").reduce((total, item) => total + item.amount.amountMinor, 0);
  const to: PaymentStatus = refunded >= parent.amount.amountMinor ? "refunded" : "partiallyRefunded";
  if (parent.status === to || !canTransitionPayment(parent.status as PaymentStatus, to)) return state;
  return { ...state, operations: state.operations.map((item) => (item.id === parentId ? { ...item, status: to, history: [...item.history, { at, status: to, note: "reembolso" }] } : item)) };
}

export function applyRouterEvents(state: RouterState, events: readonly RouterEvent[]): { state: RouterState; errors: string[] } {
  const errors: string[] = [];
  let current = state;
  for (const event of events) { const result = reduceRouter(current, event); if (result.error) errors.push(`${event.type}: ${result.error}`); current = result.state; }
  return { state: current, errors };
}

// ---------------------------------------------------------------- history and observability: readings, nothing stored
export type RouterMetrics = {
  operations: number; byStatus: Record<string, number>; byProvider: Record<string, { operations: number; attempts: number; failures: number; avgLatencyMs: number }>; successPercent: number | null; fallbacks: number; retries: number;
  feesByCurrency: Record<string, number>; volumeByCurrency: Record<string, number>; conversions: number; awaitingApproval: number; avgLatencyMs: number | null;
};
export function routerMetrics(state: RouterState, tenantId: string): RouterMetrics {
  const mine = state.operations.filter((item) => item.tenantId === tenantId);
  const byStatus: Record<string, number> = {};
  const byProvider: RouterMetrics["byProvider"] = {};
  const fees: Record<string, number> = {};
  const volume: Record<string, number> = {};
  let latencySum = 0;
  let latencyCount = 0;
  let retries = 0;
  for (const operation of mine) {
    byStatus[operation.status] = (byStatus[operation.status] ?? 0) + 1;
    retries += operation.attempts.filter((item) => item.backoffMs > 0).length;
    for (const attempt of operation.attempts.filter((item) => item.outcome !== "skipped")) {
      const row = byProvider[attempt.providerId] ?? { operations: 0, attempts: 0, failures: 0, avgLatencyMs: 0 };
      row.attempts += 1; if (attempt.outcome !== "ok") row.failures += 1; row.avgLatencyMs += attempt.latencyMs; byProvider[attempt.providerId] = row;
      latencySum += attempt.latencyMs; latencyCount += 1;
    }
    if (operation.providerId && operation.providerId !== "ledger") byProvider[operation.providerId] = { ...(byProvider[operation.providerId] ?? { operations: 0, attempts: 0, failures: 0, avgLatencyMs: 0 }), operations: (byProvider[operation.providerId]?.operations ?? 0) + 1 };
    if (operation.settled) { fees[operation.settled.currency] = (fees[operation.settled.currency] ?? 0) + operation.feeMinor; volume[operation.settled.currency] = (volume[operation.settled.currency] ?? 0) + operation.settled.amountMinor; }
  }
  for (const row of Object.values(byProvider)) row.avgLatencyMs = row.attempts === 0 ? 0 : Math.round(row.avgLatencyMs / row.attempts);
  const decided = mine.filter((item) => ["succeeded", "failed", "partiallyRefunded", "refunded", "disputed"].includes(item.status));
  return {
    operations: mine.length, byStatus, byProvider, successPercent: decided.length === 0 ? null : Math.round((decided.filter((item) => item.status !== "failed").length / decided.length) * 100), fallbacks: mine.filter((item) => item.fallbackUsed).length, retries,
    feesByCurrency: fees, volumeByCurrency: volume, conversions: mine.filter((item) => item.fx).length, awaitingApproval: mine.filter((item) => item.status === "awaitingApproval").length, avgLatencyMs: latencyCount === 0 ? null : Math.round(latencySum / latencyCount),
  };
}

/** The history of a company's operations, newest first, optionally narrowed. */
export function routerHistory(state: RouterState, tenantId: string, filter: { kind?: MoneyOperation; status?: OperationStatus; providerId?: string; reference?: Readonly<Record<string, string>> } = {}): Operation[] {
  return state.operations.filter((item) => item.tenantId === tenantId && (!filter.kind || item.kind === filter.kind) && (!filter.status || item.status === filter.status) && (!filter.providerId || item.providerId === filter.providerId)
    && Object.entries(filter.reference ?? {}).every(([key, value]) => item.reference[key] === value)).sort((a, b) => Date.parse(b.requestedAt) - Date.parse(a.requestedAt) || b.id.localeCompare(a.id));
}

/** The domain telemetry of the new operations, as plain data a Backend Core bridge can publish later (events and counters). It reads the states; it never sends anything. */
export type RouterObservation = { kind: "event"; name: string; id: string; tenantId: string; at: string; payload: Record<string, unknown> } | { kind: "metric"; name: string; labels: Record<string, string>; value?: number };
export function routerObservations(before: RouterState, after: RouterState): RouterObservation[] {
  const out: RouterObservation[] = [];
  for (const operation of after.operations) {
    const prior = before.operations.find((item) => item.id === operation.id);
    if (prior?.status === operation.status) continue;
    out.push({ kind: "event", name: "payment.operation.recorded", id: `router.op:${operation.id}:${operation.history.length}`, tenantId: operation.tenantId, at: operation.history.at(-1)?.at ?? operation.requestedAt, payload: { operationId: operation.id, kind: operation.kind, status: operation.status, provider: operation.providerId ?? "none", fallback: operation.fallbackUsed, feeMinor: operation.feeMinor, currency: operation.amount.currency } });
    out.push({ kind: "metric", name: "kynova_payment_operations_total", labels: { kind: operation.kind, status: operation.status } });
    if (operation.status === "succeeded" && operation.providerId && operation.providerId !== "ledger") out.push({ kind: "metric", name: "kynova_payment_fees_minor", labels: { provider: operation.providerId, currency: operation.amount.currency }, value: operation.feeMinor });
    if (operation.fallbackUsed && !prior?.fallbackUsed) out.push({ kind: "metric", name: "kynova_payment_fallbacks_total", labels: { kind: operation.kind } });
  }
  return out;
}

// ---------------------------------------------------------------- the entry from Billing, Marketplace and Partners: what each module hands to the Router
const MICROS_PER_MINOR_USD = 10_000;
export const microsToMinorUsd = (micros: number): number => Math.round(micros / MICROS_PER_MINOR_USD);
/** Billing -> Router: the request that charges an invoice Billing already issued. Billing is only read. */
export function chargeFromInvoice(invoice: Pick<Invoice, "id" | "tenantId" | "number" | "totalMicros" | "planId">, over: { actor: string; at: string; kind?: "membershipCharge" | "renewal"; method?: string }): RouterEvent {
  return { tenantId: invoice.tenantId, actor: over.actor, at: over.at, type: "payment.request", input: { operation: over.kind ?? "membershipCharge", amount: { amountMinor: microsToMinorUsd(invoice.totalMicros), currency: "USD" }, idempotencyKey: `inv:${invoice.id}:${over.kind ?? "membershipCharge"}`, description: `Factura ${invoice.number} · plan ${invoice.planId}`, reference: { invoiceId: invoice.id }, ...(over.method ? { method: over.method } : {}) } };
}
/** Partners -> Router: the request that pays an approved partner payout (money out, so a second person approves it). */
export function payoutFromPartner(payout: { id: string; tenantId: string; partnerId: string; amountMicros: number }, over: { actor: string; at: string }): RouterEvent {
  return { tenantId: payout.tenantId, actor: over.actor, at: over.at, type: "payment.request", input: { operation: "partnerPayout", amount: { amountMinor: microsToMinorUsd(payout.amountMicros), currency: "USD" }, idempotencyKey: `payout:${payout.id}`, description: `Pago al partner ${payout.partnerId}`, reference: { partnerId: payout.partnerId, payoutId: payout.id } } };
}
/** Marketplace -> Router: the request that charges a purchase. */
export function chargeFromPurchase(purchase: { id: string; listingId: string; buyerTenantId: string; pricing: { amountMinor?: number }; currency: string }, over: { tenantId: string; actor: string; at: string }): RouterEvent | null {
  const amountMinor = purchase.pricing.amountMinor;
  if (!amountMinor || amountMinor <= 0) return null;
  return { tenantId: over.tenantId, actor: over.actor, at: over.at, type: "payment.request", input: { operation: "marketplaceCharge", amount: { amountMinor, currency: purchase.currency }, idempotencyKey: `purchase:${purchase.id}`, description: `Compra ${purchase.id}`, reference: { listingId: purchase.listingId, purchaseId: purchase.id, buyerTenantId: purchase.buyerTenantId } } };
}
/** Router -> Billing: the `payment.record` event that records, in Billing, a charge the Router completed. Billing keeps its own rules: it still needs a person to record it. */
export function billingPaymentFromOperation(operation: Operation): { type: "payment.record"; invoiceId: string; amountMicros: number; method: "simulatedCard" } | null {
  const invoiceId = operation.reference["invoiceId"];
  if (!invoiceId || operation.status !== "succeeded" || operation.amount.currency !== "USD" || !["membershipCharge", "renewal"].includes(operation.kind)) return null;
  return { type: "payment.record", invoiceId, amountMicros: operation.amount.amountMinor * MICROS_PER_MINOR_USD, method: "simulatedCard" };
}

// ---------------------------------------------------------------- the tables this module will need (a contract only: no migration is written or applied)
/** Every table is a company's (tenant_id); members read and writes go through functions; operations are never deleted and the trail is append-only. */
export const ROUTER_TABLES = [
  { table: "router_configs", appendOnly: false }, { table: "router_operations", appendOnly: false }, { table: "router_attempts", appendOnly: true }, { table: "router_breakers", appendOnly: false },
  { table: "router_credits", appendOnly: true }, { table: "router_audit", appendOnly: true },
] as const;
export const CURRENCY_DECIMALS = CURRENCIES;
