// KYNOVA Partners & Referral Engine (Sprint 35). The official partner program: people or companies that refer paying customers and earn a RECURRING monthly commission on the
// membership each customer pays, for as long as that customer stays active. Pure and deterministic, like every platform module: `reducePartners(state, event)` is the only way the
// state changes, nothing here sends or moves money, and nothing connects to a payment provider (the payout rails are interfaces, all disconnected).
//
// It reuses what the platform already has: the referral code and link makers and the fraud signals of the Referrals module, the Constitution's person rule (actors.ts), and Billing's own
// payments (`membershipEventsFromBilling` turns what a customer really paid into events; the commission is never computed from anything else).
//
// Every record carries the company (`tenantId`) that runs the program and every event is checked against it, so one company's partners, customers and money never mix with another's.
// Every accepted event leaves an entry in the append-only `audit` trail, in the shape the Backend Core's Event Bus connector already reads (it needs no change: see ADR-0019).
//
// Rules in force: Registered 7 % · Silver 9 % · Gold 12 % (Platinum, Diamond and Elite are in the catalog and locked); the percentage is applied to the membership PAID; a plan change
// recalculates the commission; a commission waits 15 days (refunds, fraud, chargebacks) before it can be paid; a customer that stops paying pauses the commission; a payout needs
// USD 100 accumulated, a person to request it and a DIFFERENT person to approve it, and is recorded as paid with an outside reference (Level 3).

import { isPerson } from "./actors";
import type { BillingState } from "./billing-center";
import { fraudSignals, type FraudSignal } from "./referrals";
import { linkFor, makeCode, normalizeEmail } from "./referral-center";

// ---------------------------------------------------------------- the catalog: tiers, rules and payout rails
export const TIER_IDS = ["registered", "silver", "gold", "platinum", "diamond", "elite"] as const;
export type TierId = (typeof TIER_IDS)[number];
/** `bps` is basis points (700 = 7 %). A locked tier has no percentage yet: the platform defines and unlocks it later, and no event can assign it. */
export type Tier = { id: TierId; label: string; bps: number | null; locked: boolean };
export const TIERS: readonly Tier[] = [
  { id: "registered", label: "Registered", bps: 700, locked: false },
  { id: "silver", label: "Silver", bps: 900, locked: false },
  { id: "gold", label: "Gold", bps: 1_200, locked: false },
  { id: "platinum", label: "Platinum", bps: null, locked: true },
  { id: "diamond", label: "Diamond", bps: null, locked: true },
  { id: "elite", label: "Elite", bps: null, locked: true },
];
export const tierById = (id: string): Tier | undefined => TIERS.find((item) => item.id === id);
export const ACTIVE_TIERS = TIERS.filter((item) => !item.locked);

const USD = 1_000_000;
export const PARTNER_RULES = { minPayoutMicros: 100 * USD, validationDays: 15, defaultTier: "registered" as TierId } as const;

/** A way to pay a partner. Every external rail is only an interface for now: it is declared, never connected, and the reducer refuses it. `manual` is a transfer made outside the platform and recorded with its reference. */
export const RAIL_IDS = ["manual", "makapay", "payoneer", "paypal", "stripe", "osmo"] as const;
export type RailId = (typeof RAIL_IDS)[number];
export type PayoutInstruction = { payoutId: string; tenantId: string; partnerId: string; amountMicros: number };
export interface PayoutRailAdapter {
  readonly id: RailId;
  readonly label: string;
  /** False until a decision of its own connects it. Nothing in this module calls a rail. */
  readonly connected: boolean;
  /** Prepares the instruction to pay; it must never move money by itself. */
  prepare(instruction: PayoutInstruction): { instruction: PayoutInstruction };
}
const prepared = (id: RailId, label: string): PayoutRailAdapter => ({ id, label, connected: false, prepare: (instruction) => ({ instruction }) });
export const PAYOUT_RAILS: readonly PayoutRailAdapter[] = [
  { id: "manual", label: "Transferencia fuera de la plataforma", connected: true, prepare: (instruction) => ({ instruction }) },
  prepared("makapay", "MakaPay"), prepared("payoneer", "Payoneer"), prepared("paypal", "PayPal"), prepared("stripe", "Stripe"), prepared("osmo", "Osmo"),
];

// ---------------------------------------------------------------- records (all carry tenantId: the company that runs the program)
export type PartnerStatus = "pending" | "active" | "suspended" | "closed";
export type ClientStatus = "signedUp" | "active" | "paused" | "churned" | "rejected";
export type CommissionStatus = "validating" | "approved" | "paid" | "voided";
export type PayoutStatus = "requested" | "approved" | "paid" | "rejected";

export type Program = { tenantId: string; ownerId: string; admins: readonly string[]; linkBase: string; createdAt: string };
export type Partner = { id: string; tenantId: string; actorId: string; name: string; email: string; kind: "person" | "company"; status: PartnerStatus; tierId: TierId; code: string; link: string; registeredAt: string; decidedBy?: string; decidedAt?: string };
export type Click = { id: string; tenantId: string; partnerId: string; code: string; at: string; deviceId?: string };
/** A referred customer: the funnel (signed up, active, paused, churned) and the plan it pays now. */
export type Client = {
  id: string; tenantId: string; partnerId: string; clientRef: string; name: string; email: string; status: ClientStatus; signals: readonly FraudSignal[]; signedUpAt: string;
  planId?: string; monthlyMicros?: number; convertedAt?: string; lastPaidAt?: string; pausedAt?: string; endedAt?: string;
};
/** One month's commission, tied to the payment that earned it. The rate is the partner's rate THAT day: a later tier change never rewrites it. */
export type Commission = {
  id: string; tenantId: string; partnerId: string; clientId: string; invoiceId: string; periodStart: string; baseMicros: number; bps: number; amountMicros: number; status: CommissionStatus;
  accruedAt: string; validUntil: string; validatedAt?: string; payoutId?: string; history: readonly { at: string; amountMicros: number; reason: string }[]; voidReason?: string;
};
/** A correction after a commission left the validation window (a plan change, a late refund): positive or negative, and paid or recovered with the next payout. */
export type Adjustment = { id: string; tenantId: string; partnerId: string; commissionId: string; amountMicros: number; reason: string; at: string; payoutId?: string };
export type Payout = {
  id: string; tenantId: string; partnerId: string; amountMicros: number; status: PayoutStatus; requestedBy: string; requestedAt: string; approvedBy?: string; approvedAt?: string;
  paidBy?: string; paidAt?: string; rail?: RailId; reference?: string; commissionIds: readonly string[]; adjustmentIds: readonly string[];
};
export type PartnerAudit = { at: string; actor: string; tenantId: string; action: string; detail?: string };
export type PartnerState = {
  programs: readonly Program[]; partners: readonly Partner[]; clicks: readonly Click[]; clients: readonly Client[]; commissions: readonly Commission[]; adjustments: readonly Adjustment[]; payouts: readonly Payout[];
  audit: readonly PartnerAudit[]; sequence: number;
};
export const newPartnerState = (): PartnerState => ({ programs: [], partners: [], clicks: [], clients: [], commissions: [], adjustments: [], payouts: [], audit: [], sequence: 0 });

// ---------------------------------------------------------------- events
type Base = { at: string; tenantId: string; actor: string };
export type RefundKind = "refund" | "chargeback" | "fraud";
export type PartnerEvent =
  | (Base & { type: "program.create"; linkBase?: string })
  | (Base & { type: "program.admin"; userId: string; enabled: boolean })
  | (Base & { type: "partner.register"; name: string; email: string; kind: "person" | "company" })
  | (Base & { type: "partner.approve"; partnerId: string })
  | (Base & { type: "partner.suspend"; partnerId: string; reason: string })
  | (Base & { type: "partner.reinstate"; partnerId: string })
  | (Base & { type: "partner.close"; partnerId: string; reason: string })
  | (Base & { type: "partner.setTier"; partnerId: string; tierId: string })
  | (Base & { type: "referral.click"; code: string; deviceId?: string })
  | (Base & { type: "referral.signup"; code: string; clientRef: string; name: string; email: string; deviceId?: string })
  | (Base & { type: "membership.paid"; clientRef: string; invoiceId: string; planId: string; amountMicros: number; periodStart: string })
  | (Base & { type: "membership.planChanged"; clientRef: string; toPlanId: string; monthlyMicros: number; currentPeriodPaidMicros?: number })
  | (Base & { type: "membership.lapsed"; clientRef: string })
  | (Base & { type: "membership.cancelled"; clientRef: string })
  | (Base & { type: "payment.reversed"; invoiceId: string; kind: RefundKind })
  | (Base & { type: "validation.run" })
  | (Base & { type: "payout.request"; partnerId: string })
  | (Base & { type: "payout.approve"; payoutId: string })
  | (Base & { type: "payout.reject"; payoutId: string; reason: string })
  | (Base & { type: "payout.markPaid"; payoutId: string; rail: string; reference: string });
export type PartnerResult = { state: PartnerState; error?: string; errorCode?: string };

export const ERRORS = {
  tenantRequired: "Falta la empresa (tenant_id).", noProgram: "La empresa todavía no tiene un programa de partners.", programExists: "La empresa ya tiene un programa de partners.", personRequired: "Solo una persona puede hacerlo: NEX y el sistema no.",
  forbidden: "No tienes permiso para hacerlo.", invalid: "Dato no válido.", notFound: "No existe.", duplicate: "Ya está registrado.", tierLocked: "Ese nivel está bloqueado: solo la plataforma lo activará más adelante.",
  partnerInactive: "El partner no está activo.", invalidTransition: "Ese cambio de estado no es posible.", alreadyReferred: "Esa empresa ya fue referida.", codeUnknown: "El código no existe o su partner no está activo.",
  belowMinimum: "El saldo no llega al mínimo para retirar.", samePerson: "Quien solicita el pago no puede aprobarlo.", railNotConnected: "Ese medio de pago todavía no está conectado.", payoutOpen: "Ya hay un pago en curso para este partner.",
  noBalance: "No hay comisiones aprobadas para pagar.",
} as const;
export type PartnerErrorCode = keyof typeof ERRORS;

const DAY = 86_400_000;
const addDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY).toISOString();
const commissionOf = (baseMicros: number, bps: number) => Math.floor((baseMicros * bps) / 10_000);
const pad = (value: number) => String(value).padStart(4, "0");

/** The balance a partner could withdraw today: approved commissions not yet in a payout, plus the corrections that are not in one. It can be negative when a correction recovers money. */
export function availableMicros(state: PartnerState, tenantId: string, partnerId: string): number {
  const approved = state.commissions.filter((item) => item.tenantId === tenantId && item.partnerId === partnerId && item.status === "approved" && !item.payoutId).reduce((total, item) => total + item.amountMicros, 0);
  const corrections = state.adjustments.filter((item) => item.tenantId === tenantId && item.partnerId === partnerId && !item.payoutId).reduce((total, item) => total + item.amountMicros, 0);
  return approved + corrections;
}

export function reducePartners(state: PartnerState, event: PartnerEvent): PartnerResult {
  const refuse = (code: PartnerErrorCode, detail?: string): PartnerResult => ({ state, error: detail ? `${ERRORS[code]} ${detail}` : ERRORS[code], errorCode: code });
  if (!event.tenantId || event.tenantId.trim() === "" || !event.actor || event.actor.trim() === "") return refuse("tenantRequired");
  const { tenantId } = event;
  const program = state.programs.find((item) => item.tenantId === tenantId);
  const isAdmin = (actor: string) => !!program && isPerson(actor) && (program.ownerId === actor || program.admins.includes(actor));
  const record = (next: PartnerState, action: string, detail?: string): PartnerState => ({ ...next, audit: [...next.audit, { at: event.at, actor: event.actor, tenantId, action, ...(detail ? { detail } : {}) }] });
  const next = (): { id: string; sequence: number } => ({ id: pad(state.sequence + 1), sequence: state.sequence + 1 });
  const partnerOf = (id: string) => state.partners.find((item) => item.id === id && item.tenantId === tenantId);
  const clientOf = (ref: string) => state.clients.find((item) => item.clientRef === ref && item.tenantId === tenantId);
  const tierBps = (partner: Partner) => tierById(partner.tierId)?.bps ?? 0;
  const set = <K extends "partners" | "clients" | "commissions" | "payouts">(key: K, items: readonly PartnerState[K][number][]) => ({ ...state, [key]: items }) as PartnerState;

  if (event.type === "program.create") {
    if (!isPerson(event.actor)) return refuse("personRequired");
    if (program) return refuse("programExists");
    const created: Program = { tenantId, ownerId: event.actor, admins: [], linkBase: (event.linkBase ?? "https://kynova.example").trim(), createdAt: event.at };
    return { state: record({ ...state, programs: [...state.programs, created] }, "program.create", created.linkBase) };
  }
  if (!program) return refuse("noProgram");

  switch (event.type) {
    case "program.admin": {
      if (program.ownerId !== event.actor) return refuse("forbidden");
      if (!isPerson(event.userId)) return refuse("personRequired");
      const admins = event.enabled ? [...new Set([...program.admins, event.userId])] : program.admins.filter((item) => item !== event.userId);
      return { state: record({ ...state, programs: state.programs.map((item) => (item.tenantId === tenantId ? { ...item, admins } : item)) }, "program.admin", `${event.userId} · ${event.enabled ? "alta" : "baja"}`) };
    }
    case "partner.register": {
      if (!isPerson(event.actor)) return refuse("personRequired");
      const email = normalizeEmail(event.email);
      if (event.name.trim().length < 2 || !/^\S+@\S+\.\S+$/.test(email) || !["person", "company"].includes(event.kind)) return refuse("invalid");
      if (state.partners.some((item) => item.tenantId === tenantId && (item.email === email || item.actorId === event.actor))) return refuse("duplicate");
      const { id, sequence } = next();
      let salt = 0;
      let code = makeCode(tenantId, event.name, salt);
      while (state.partners.some((item) => item.tenantId === tenantId && item.code === code)) code = makeCode(tenantId, event.name, (salt += 1));
      const partner: Partner = { id: `pt_${id}`, tenantId, actorId: event.actor, name: event.name.trim(), email, kind: event.kind, status: "pending", tierId: PARTNER_RULES.defaultTier, code, link: linkFor(program.linkBase, code), registeredAt: event.at };
      return { state: record({ ...state, partners: [...state.partners, partner], sequence }, "partner.register", `${partner.id} · ${code}`) };
    }
    case "partner.approve": case "partner.suspend": case "partner.reinstate": case "partner.close": {
      if (!isAdmin(event.actor)) return refuse(isPerson(event.actor) ? "forbidden" : "personRequired");
      const partner = partnerOf(event.partnerId);
      if (!partner) return refuse("notFound");
      const target: PartnerStatus = event.type === "partner.approve" ? "active" : event.type === "partner.suspend" ? "suspended" : event.type === "partner.reinstate" ? "active" : "closed";
      const allowed: Record<string, readonly PartnerStatus[]> = { "partner.approve": ["pending"], "partner.suspend": ["active"], "partner.reinstate": ["suspended"], "partner.close": ["pending", "active", "suspended"] };
      if (!allowed[event.type]?.includes(partner.status)) return refuse("invalidTransition", `${partner.status} → ${target}`);
      return { state: record(set("partners", state.partners.map((item) => (item.id === partner.id ? { ...item, status: target, decidedBy: event.actor, decidedAt: event.at } : item))), event.type, `${partner.id}${"reason" in event ? ` · ${event.reason}` : ""}`) };
    }
    case "partner.setTier": {
      if (!isAdmin(event.actor)) return refuse(isPerson(event.actor) ? "forbidden" : "personRequired");
      const partner = partnerOf(event.partnerId);
      const tier = tierById(event.tierId);
      if (!partner || !tier) return refuse(partner ? "invalid" : "notFound");
      if (tier.locked) return refuse("tierLocked", tier.label);
      if (partner.status === "closed") return refuse("partnerInactive");
      return { state: record(set("partners", state.partners.map((item) => (item.id === partner.id ? { ...item, tierId: tier.id } : item))), "partner.setTier", `${partner.id} · ${partner.tierId} → ${tier.id}`) };
    }
    case "referral.click": {
      const partner = state.partners.find((item) => item.tenantId === tenantId && item.code === event.code && item.status === "active");
      if (!partner) return refuse("codeUnknown");
      const { id, sequence } = next();
      const click: Click = { id: `ck_${id}`, tenantId, partnerId: partner.id, code: partner.code, at: event.at, ...(event.deviceId ? { deviceId: event.deviceId } : {}) };
      return { state: record({ ...state, clicks: [...state.clicks, click], sequence }, "referral.click", partner.id) };
    }
    case "referral.signup": {
      const partner = state.partners.find((item) => item.tenantId === tenantId && item.code === event.code && item.status === "active");
      if (!partner) return refuse("codeUnknown");
      if (!event.clientRef.trim() || event.name.trim().length < 2) return refuse("invalid");
      if (clientOf(event.clientRef)) return refuse("alreadyReferred");
      const sameDevice = !!event.deviceId && state.clicks.some((item) => item.partnerId === partner.id && item.deviceId === event.deviceId) && state.partners.some((item) => item.id === partner.id && item.actorId === event.actor);
      const signals = fraudSignals({ referrerEmail: partner.email, referredEmail: event.email, sameDevice });
      const { id, sequence } = next();
      const client: Client = { id: `cl_${id}`, tenantId, partnerId: partner.id, clientRef: event.clientRef, name: event.name.trim(), email: normalizeEmail(event.email), status: signals.length ? "rejected" : "signedUp", signals, signedUpAt: event.at };
      return { state: record({ ...state, clients: [...state.clients, client], sequence }, "referral.signup", `${client.id} · ${partner.id}${signals.length ? ` · ${signals.join(",")}` : ""}`) };
    }
    case "membership.paid": {
      const client = clientOf(event.clientRef);
      if (!client) return refuse("notFound");
      if (client.status === "rejected") return refuse("invalidTransition", "referido rechazado");
      if (!event.invoiceId || !Number.isInteger(event.amountMicros) || event.amountMicros <= 0) return refuse("invalid");
      if (state.commissions.some((item) => item.tenantId === tenantId && item.invoiceId === event.invoiceId)) return refuse("duplicate", event.invoiceId);
      const partner = partnerOf(client.partnerId);
      if (!partner) return refuse("notFound");
      const converted = client.status === "signedUp";
      const updated: Client = { ...client, status: "active", planId: event.planId, monthlyMicros: event.amountMicros, lastPaidAt: event.at, ...(converted ? { convertedAt: event.at } : {}), ...(client.status === "paused" ? {} : {}) };
      delete (updated as { pausedAt?: string }).pausedAt;
      delete (updated as { endedAt?: string }).endedAt;
      const clients = state.clients.map((item) => (item.id === client.id ? updated : item));
      // a partner that is not active earns nothing for this payment; the customer's history still moves
      if (partner.status !== "active") return { state: record({ ...state, clients }, "membership.paid", `${client.id} · sin comisión (${partner.status})`) };
      const { id, sequence } = next();
      const bps = tierBps(partner);
      const amountMicros = commissionOf(event.amountMicros, bps);
      const commission: Commission = { id: `cm_${id}`, tenantId, partnerId: partner.id, clientId: client.id, invoiceId: event.invoiceId, periodStart: event.periodStart, baseMicros: event.amountMicros, bps, amountMicros, status: "validating", accruedAt: event.at, validUntil: addDays(event.at, PARTNER_RULES.validationDays), history: [{ at: event.at, amountMicros, reason: "alta" }] };
      return { state: record({ ...state, clients, commissions: [...state.commissions, commission], sequence }, "membership.paid", `${client.id} · ${commission.id} · ${amountMicros}`) };
    }
    case "membership.planChanged": {
      const client = clientOf(event.clientRef);
      if (!client) return refuse("notFound");
      if (!Number.isInteger(event.monthlyMicros) || event.monthlyMicros <= 0) return refuse("invalid");
      let working = state;
      let note = `${client.id} · ${client.planId ?? "—"} → ${event.toPlanId}`;
      // the commission of the period already paid is recalculated on the new membership: in place while it is validating, as a correction afterwards
      const latest = [...state.commissions].filter((item) => item.clientId === client.id && item.status !== "voided").sort((a, b) => Date.parse(b.accruedAt) - Date.parse(a.accruedAt))[0];
      if (latest && event.currentPeriodPaidMicros !== undefined && event.currentPeriodPaidMicros > 0 && event.currentPeriodPaidMicros !== latest.baseMicros) {
        const amountMicros = commissionOf(event.currentPeriodPaidMicros, latest.bps);
        const delta = amountMicros - latest.amountMicros;
        if (latest.status === "validating") {
          working = { ...working, commissions: working.commissions.map((item) => (item.id === latest.id ? { ...item, baseMicros: event.currentPeriodPaidMicros as number, amountMicros, history: [...item.history, { at: event.at, amountMicros, reason: `cambio de plan a ${event.toPlanId}` }] } : item)) };
        } else if (delta !== 0) {
          const { id, sequence } = next();
          working = { ...working, sequence, adjustments: [...working.adjustments, { id: `aj_${id}`, tenantId, partnerId: latest.partnerId, commissionId: latest.id, amountMicros: delta, reason: `cambio de plan a ${event.toPlanId}`, at: event.at }] };
        }
        note += ` · ${latest.id} ${latest.amountMicros} → ${amountMicros}`;
      }
      const clients = working.clients.map((item) => (item.id === client.id ? { ...item, planId: event.toPlanId, monthlyMicros: event.monthlyMicros } : item));
      return { state: record({ ...working, clients }, "membership.planChanged", note) };
    }
    case "membership.lapsed": case "membership.cancelled": {
      const client = clientOf(event.clientRef);
      if (!client) return refuse("notFound");
      const lapsed = event.type === "membership.lapsed";
      if (!["active", "paused"].includes(client.status) || (lapsed && client.status === "paused") || (!lapsed && client.status === "churned")) return refuse("invalidTransition", client.status);
      const changed: Client = { ...client, status: lapsed ? "paused" : "churned", ...(lapsed ? { pausedAt: event.at } : { endedAt: event.at }) };
      return { state: record(set("clients", state.clients.map((item) => (item.id === client.id ? changed : item))), event.type, client.id) };
    }
    case "payment.reversed": {
      const commission = state.commissions.find((item) => item.tenantId === tenantId && item.invoiceId === event.invoiceId);
      if (!commission) return refuse("notFound");
      if (commission.status === "voided") return refuse("invalidTransition", "ya anulada");
      const reason = `${event.kind} de ${event.invoiceId}`;
      let working: PartnerState;
      if (commission.status === "validating" || (commission.status === "approved" && !commission.payoutId)) {
        working = set("commissions", state.commissions.map((item) => (item.id === commission.id ? { ...item, status: "voided" as const, voidReason: reason, history: [...item.history, { at: event.at, amountMicros: 0, reason }] } : item)));
      } else {
        // already in a payout or paid: the money is recovered from the next payout
        const { id, sequence } = next();
        working = { ...state, sequence, adjustments: [...state.adjustments, { id: `aj_${id}`, tenantId, partnerId: commission.partnerId, commissionId: commission.id, amountMicros: -commission.amountMicros, reason, at: event.at }] };
      }
      // a chargeback or fraud also stops the customer's commission until it pays again
      const client = working.clients.find((item) => item.id === commission.clientId);
      if (client && event.kind !== "refund" && client.status === "active") working = { ...working, clients: working.clients.map((item) => (item.id === client.id ? { ...item, status: "paused" as const, pausedAt: event.at } : item)) };
      return { state: record(working, "payment.reversed", `${commission.id} · ${event.kind}`) };
    }
    case "validation.run": {
      if (isPerson(event.actor) && !isAdmin(event.actor)) return refuse("forbidden");
      if (!isPerson(event.actor) && event.actor !== "system") return refuse("personRequired");
      const due = state.commissions.filter((item) => item.tenantId === tenantId && item.status === "validating" && Date.parse(item.validUntil) <= Date.parse(event.at));
      if (due.length === 0) return { state: record(state, "validation.run", "0") };
      const ids = new Set(due.map((item) => item.id));
      return { state: record(set("commissions", state.commissions.map((item) => (ids.has(item.id) ? { ...item, status: "approved" as const, validatedAt: event.at, history: [...item.history, { at: event.at, amountMicros: item.amountMicros, reason: "validada" }] } : item))), "validation.run", String(due.length)) };
    }
    case "payout.request": {
      if (!isPerson(event.actor)) return refuse("personRequired");
      const partner = partnerOf(event.partnerId);
      if (!partner) return refuse("notFound");
      if (partner.actorId !== event.actor && !isAdmin(event.actor)) return refuse("forbidden");
      if (partner.status !== "active") return refuse("partnerInactive");
      if (state.payouts.some((item) => item.partnerId === partner.id && (item.status === "requested" || item.status === "approved"))) return refuse("payoutOpen");
      const commissions = state.commissions.filter((item) => item.partnerId === partner.id && item.status === "approved" && !item.payoutId);
      const adjustments = state.adjustments.filter((item) => item.partnerId === partner.id && !item.payoutId);
      if (commissions.length === 0) return refuse("noBalance");
      const amountMicros = availableMicros(state, tenantId, partner.id);
      if (amountMicros < PARTNER_RULES.minPayoutMicros) return refuse("belowMinimum", `${amountMicros / USD} de ${PARTNER_RULES.minPayoutMicros / USD} USD`);
      const { id, sequence } = next();
      const payout: Payout = { id: `po_${id}`, tenantId, partnerId: partner.id, amountMicros, status: "requested", requestedBy: event.actor, requestedAt: event.at, commissionIds: commissions.map((item) => item.id), adjustmentIds: adjustments.map((item) => item.id) };
      const lockedC = new Set(payout.commissionIds);
      const lockedA = new Set(payout.adjustmentIds);
      return { state: record({ ...state, sequence, payouts: [...state.payouts, payout], commissions: state.commissions.map((item) => (lockedC.has(item.id) ? { ...item, payoutId: payout.id } : item)), adjustments: state.adjustments.map((item) => (lockedA.has(item.id) ? { ...item, payoutId: payout.id } : item)) }, "payout.request", `${payout.id} · ${amountMicros}`) };
    }
    case "payout.approve": case "payout.reject": case "payout.markPaid": {
      if (!isAdmin(event.actor)) return refuse(isPerson(event.actor) ? "forbidden" : "personRequired");
      const payout = state.payouts.find((item) => item.id === event.payoutId && item.tenantId === tenantId);
      if (!payout) return refuse("notFound");
      if (event.type === "payout.approve") {
        if (payout.status !== "requested") return refuse("invalidTransition", payout.status);
        if (payout.requestedBy === event.actor) return refuse("samePerson");
        return { state: record(set("payouts", state.payouts.map((item) => (item.id === payout.id ? { ...item, status: "approved" as const, approvedBy: event.actor, approvedAt: event.at } : item))), "payout.approve", payout.id) };
      }
      if (event.type === "payout.reject") {
        if (payout.status !== "requested" && payout.status !== "approved") return refuse("invalidTransition", payout.status);
        const freedC = new Set(payout.commissionIds);
        const freedA = new Set(payout.adjustmentIds);
        const reopened: PartnerState = { ...state, payouts: state.payouts.map((item) => (item.id === payout.id ? { ...item, status: "rejected" as const } : item)),
          commissions: state.commissions.map((item) => { if (!freedC.has(item.id)) return item; const { payoutId: _released, ...rest } = item; void _released; return rest; }),
          adjustments: state.adjustments.map((item) => { if (!freedA.has(item.id)) return item; const { payoutId: _released, ...rest } = item; void _released; return rest; }) };
        return { state: record(reopened, "payout.reject", `${payout.id} · ${event.reason}`) };
      }
      if (payout.status !== "approved") return refuse("invalidTransition", payout.status);
      if (payout.approvedBy === event.actor || payout.requestedBy === event.actor) return refuse("samePerson");
      const rail = PAYOUT_RAILS.find((item) => item.id === event.rail);
      if (!rail) return refuse("invalid", "medio de pago");
      if (!rail.connected) return refuse("railNotConnected", rail.label);
      if (event.reference.trim().length < 4) return refuse("invalid", "referencia");
      const paidC = new Set(payout.commissionIds);
      return { state: record({ ...state, payouts: state.payouts.map((item) => (item.id === payout.id ? { ...item, status: "paid" as const, paidBy: event.actor, paidAt: event.at, rail: rail.id, reference: event.reference.trim() } : item)),
        commissions: state.commissions.map((item) => (paidC.has(item.id) ? { ...item, status: "paid" as const } : item)) }, "payout.markPaid", `${payout.id} · ${rail.id}`) };
    }
    default: return refuse("invalid");
  }
}

export function applyPartnerEvents(state: PartnerState, events: readonly PartnerEvent[]): { state: PartnerState; errors: string[] } {
  const errors: string[] = [];
  let current = state;
  for (const event of events) { const result = reducePartners(current, event); if (result.error) errors.push(`${event.type}: ${result.error}`); current = result.state; }
  return { state: current, errors };
}

// ---------------------------------------------------------------- Billing is the source of what a customer paid
/** The events a referred customer's Billing records mean for the program: every real payment, the plan changes after the first plan, a cancellation, and an overdue invoice as a lapse. Pure: Billing is only read. */
export function membershipEventsFromBilling(billing: BillingState, input: { programTenantId: string; clientTenantId: string; clientRef: string; asOf: string }): PartnerEvent[] {
  const { programTenantId, clientTenantId, clientRef, asOf } = input;
  const base = { tenantId: programTenantId, actor: "system" };
  const invoices = billing.invoices.filter((item) => item.tenantId === clientTenantId);
  const events: PartnerEvent[] = [];
  const paidInvoices = new Set<string>();
  for (const payment of billing.payments.filter((item) => item.tenantId === clientTenantId && item.method !== "credit")) {
    const invoice = invoices.find((item) => item.id === payment.invoiceId);
    if (!invoice) continue;
    paidInvoices.add(invoice.id);
    events.push({ ...base, at: payment.at, type: "membership.paid", clientRef, invoiceId: invoice.id, planId: invoice.planId, amountMicros: payment.amountMicros, periodStart: invoice.periodStart });
  }
  for (const invoice of invoices) if (!paidInvoices.has(invoice.id) && Date.parse(invoice.dueAt) < Date.parse(asOf)) events.push({ ...base, at: asOf, type: "membership.lapsed", clientRef });
  for (const change of billing.changes.filter((item) => item.tenantId === clientTenantId)) {
    if ((change.kind === "upgrade" || change.kind === "downgrade") && change.toPlanId) events.push({ ...base, at: change.at, type: "membership.planChanged", clientRef, toPlanId: change.toPlanId, monthlyMicros: invoices.findLast?.((item) => item.planId === change.toPlanId)?.totalMicros ?? 1 });
    if (change.kind === "cancel") events.push({ ...base, at: change.at, type: "membership.cancelled", clientRef });
  }
  return events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

// ---------------------------------------------------------------- the dashboard and the histories: readings, nothing stored
export type PartnerDashboard = {
  partner: { id: string; name: string; status: PartnerStatus; tier: string; ratePercent: number; code: string; link: string; nextTier?: string };
  funnel: { clicks: number; signups: number; converted: number; rejected: number; conversionPercent: number };
  clients: { active: number; paused: number; churned: number; signedUp: number; list: readonly { clientRef: string; name: string; status: ClientStatus; planId?: string; monthlyMicros?: number; since: string }[] };
  commissions: { validatingMicros: number; approvedMicros: number; paidMicros: number; voidedMicros: number; recurringMonthlyMicros: number; nextValidationAt?: string; list: readonly Commission[] };
  balance: { availableMicros: number; minimumMicros: number; canRequest: boolean; missingMicros: number };
  payouts: readonly Payout[];
};
/** The Partner's own dashboard: its state, rate, funnel, customers and their status, commissions, balance and payments. Reads only the records of ONE company and ONE partner. */
export function partnerDashboard(state: PartnerState, tenantId: string, partnerId: string): PartnerDashboard | null {
  const partner = state.partners.find((item) => item.id === partnerId && item.tenantId === tenantId);
  if (!partner) return null;
  const tier = tierById(partner.tierId);
  const clients = state.clients.filter((item) => item.tenantId === tenantId && item.partnerId === partnerId);
  const commissions = state.commissions.filter((item) => item.tenantId === tenantId && item.partnerId === partnerId);
  const sum = (status: CommissionStatus) => commissions.filter((item) => item.status === status).reduce((total, item) => total + item.amountMicros, 0);
  const signups = clients.length;
  const converted = clients.filter((item) => item.convertedAt).length;
  const available = availableMicros(state, tenantId, partnerId);
  const nextTier = ACTIVE_TIERS.find((item) => (item.bps ?? 0) > (tier?.bps ?? 0));
  const validating = commissions.filter((item) => item.status === "validating").sort((a, b) => Date.parse(a.validUntil) - Date.parse(b.validUntil))[0];
  return {
    partner: { id: partner.id, name: partner.name, status: partner.status, tier: partner.tierId, ratePercent: (tier?.bps ?? 0) / 100, code: partner.code, link: partner.link, ...(nextTier ? { nextTier: nextTier.id } : {}) },
    funnel: { clicks: state.clicks.filter((item) => item.tenantId === tenantId && item.partnerId === partnerId).length, signups, converted, rejected: clients.filter((item) => item.status === "rejected").length, conversionPercent: signups === 0 ? 0 : Math.round((converted / signups) * 100) },
    clients: {
      active: clients.filter((item) => item.status === "active").length, paused: clients.filter((item) => item.status === "paused").length, churned: clients.filter((item) => item.status === "churned").length, signedUp: clients.filter((item) => item.status === "signedUp").length,
      list: clients.map((item) => ({ clientRef: item.clientRef, name: item.name, status: item.status, ...(item.planId ? { planId: item.planId } : {}), ...(item.monthlyMicros ? { monthlyMicros: item.monthlyMicros } : {}), since: item.signedUpAt })),
    },
    commissions: {
      validatingMicros: sum("validating"), approvedMicros: sum("approved"), paidMicros: sum("paid"), voidedMicros: commissions.filter((item) => item.status === "voided").reduce((total, item) => total + (item.history[0]?.amountMicros ?? 0), 0),
      recurringMonthlyMicros: clients.filter((item) => item.status === "active" && item.monthlyMicros).reduce((total, item) => total + commissionOf(item.monthlyMicros as number, tier?.bps ?? 0), 0),
      ...(validating ? { nextValidationAt: validating.validUntil } : {}), list: commissions,
    },
    balance: { availableMicros: available, minimumMicros: PARTNER_RULES.minPayoutMicros, canRequest: available >= PARTNER_RULES.minPayoutMicros && partner.status === "active", missingMicros: Math.max(0, PARTNER_RULES.minPayoutMicros - available) },
    payouts: state.payouts.filter((item) => item.tenantId === tenantId && item.partnerId === partnerId),
  };
}

export type ProgramSummary = { partners: Record<PartnerStatus, number>; byTier: Record<string, number>; clientsActive: number; clientsPaused: number; liabilityMicros: number; paidOutMicros: number };
/** The program owner's view of one company's program. */
export function programSummary(state: PartnerState, tenantId: string): ProgramSummary {
  const partners = state.partners.filter((item) => item.tenantId === tenantId);
  const count = (status: PartnerStatus) => partners.filter((item) => item.status === status).length;
  const byTier: Record<string, number> = {};
  for (const item of partners) byTier[item.tierId] = (byTier[item.tierId] ?? 0) + 1;
  const mine = state.commissions.filter((item) => item.tenantId === tenantId);
  return {
    partners: { pending: count("pending"), active: count("active"), suspended: count("suspended"), closed: count("closed") }, byTier,
    clientsActive: state.clients.filter((item) => item.tenantId === tenantId && item.status === "active").length, clientsPaused: state.clients.filter((item) => item.tenantId === tenantId && item.status === "paused").length,
    liabilityMicros: mine.filter((item) => item.status === "validating" || item.status === "approved").reduce((total, item) => total + item.amountMicros, 0),
    paidOutMicros: state.payouts.filter((item) => item.tenantId === tenantId && item.status === "paid").reduce((total, item) => total + item.amountMicros, 0),
  };
}

// ---------------------------------------------------------------- the tables this module will need (a contract only: no migration is written or applied here)
/** Every table is a company's (tenant_id) and gets the platform's RLS (members read, writes only through functions); the ledger tables are append-only. */
export const PARTNER_TABLES = [
  { table: "partner_programs", appendOnly: false }, { table: "partners", appendOnly: false }, { table: "partner_clicks", appendOnly: true }, { table: "partner_clients", appendOnly: false },
  { table: "partner_commissions", appendOnly: false }, { table: "partner_adjustments", appendOnly: true }, { table: "partner_payouts", appendOnly: false }, { table: "partner_audit", appendOnly: true },
] as const;
