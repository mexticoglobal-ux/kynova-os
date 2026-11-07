// Referrals Center store: affiliate program, codes and links, attribution, commissions (percent or fixed, multi-level
// prepared), fraud holds, approval rules and payout requests. Pure and deterministic, one state per company (tenant).
//
// Decoupled from any payment gateway on purpose: a payout is only a request that people approve, and "paid" is recorded
// with an external reference someone supplies. Nothing here moves money. Paying a commission is always Level 3.

import { isPerson } from "./actors";
import { addDays } from "./billing";
import { isCurrency, isCrypto, type CurrencyCode } from "./currency";
import { isMoney, type Money } from "./payments";
import { label, message, type ErrorCode } from "./referral-messages";
import { attribute, fraudSignals, rewardFor, type FraudSignal, type RewardRule } from "./referrals";

// ---------------------------------------------------------------- types
export type ProgramStatus = "draft" | "active" | "paused" | "ended";
export type ApprovalRules = {
  holdDays: number; // refund window: a commission cannot be approved before it passes
  autoApproveMaxMinor: number; // at or below this, with no fraud signal, the system approves once the hold passes; above it a person reviews
  minPayoutMinor: number; // a payout request needs at least this much approved
};
export type Program = {
  id: "program";
  tenantId: string;
  name: string;
  status: ProgramStatus;
  currency: CurrencyCode;
  reward: RewardRule; // level 1
  levels: readonly RewardRule[]; // levels 2 and 3, prepared: only used when levelsEnabled
  levelsEnabled: boolean;
  attributionWindowDays: number;
  minSaleMinor: number;
  approval: ApprovalRules;
  linkBase: string;
};
export type ProgramInput = Omit<Program, "id" | "tenantId">;

export type Affiliate = { id: string; tenantId: string; name: string; email: string; code: string; link: string; status: "active" | "suspended"; sponsorId?: string; deviceId?: string; createdAt: string };

export type ReferralStatus = "clicked" | "signedUp" | "qualified" | "converted" | "rejected" | "expired";
export type RejectReason = "lostAttribution" | "expired" | "manual";
export type Referral = {
  id: string;
  tenantId: string;
  affiliateId: string;
  name: string;
  email: string;
  deviceId?: string;
  status: ReferralStatus;
  stage: 0 | 1 | 2 | 3; // furthest point reached: click, signup, qualified, converted
  createdAt: string;
  lastTouchAt: string;
  convertedAt?: string;
  rejectReason?: RejectReason;
};
type Touch = { referralId: string; affiliateId: string; email: string; at: string; code: string };

export type ReferralFraudSignal = FraudSignal | "burst" | "suspendedAffiliate";
export const BURST_LIMIT = 5; // this many referrals from one affiliate within an hour is held for review
const BURST_WINDOW_MS = 3_600_000;

export type CommissionStatus = "pending" | "held" | "approved" | "inPayout" | "paid" | "rejected" | "reversed";
export type Commission = {
  id: string;
  tenantId: string;
  affiliateId: string;
  referralId: string;
  level: 1 | 2 | 3;
  saleRef: string;
  sale: Money;
  amount: Money;
  rule: RewardRule; // the rule that applied when it was earned: later program changes never touch it
  status: CommissionStatus;
  signals: readonly ReferralFraudSignal[];
  createdAt: string;
  eligibleAt: string;
  payoutId?: string;
  clawback?: boolean; // the sale was refunded after the commission was paid
  history: readonly { at: string; actor: string; event: string; detail?: string }[];
};

export type PayoutStatus = "requested" | "approved" | "paid" | "rejected";
export type Payout = { id: string; tenantId: string; affiliateId: string; commissionIds: readonly string[]; total: Money; status: PayoutStatus; requestedBy: string; requestedAt: string; decidedBy?: string; decidedAt?: string; paidAt?: string; paymentRef?: string };

export type ReferralAudit = { at: string; actor: string; action: string; detail?: string };
export type ReferralLog = { at: string; level: "info" | "warn" | "error"; event: string };

export type ReferralState = {
  tenantId: string;
  program: Program | null;
  affiliates: readonly Affiliate[];
  referrals: readonly Referral[];
  touches: readonly Touch[];
  commissions: readonly Commission[];
  payouts: readonly Payout[];
  sales: readonly string[];
  logs: readonly ReferralLog[];
  audit: readonly ReferralAudit[];
  sequence: number;
};

export const newReferralState = (tenantId: string): ReferralState => ({ tenantId, program: null, affiliates: [], referrals: [], touches: [], commissions: [], payouts: [], sales: [], logs: [], audit: [], sequence: 0 });

/** Paying a commission is financial: Level 3, a person decides every time (Constitution, ADR-0009). */
export const PAYOUT_LEVEL = 3 as const;

export { isPerson };

// ---------------------------------------------------------------- events
type Base = { tenantId: string; at: string };
export type ReferralEvent =
  | (Base & { type: "program.save"; actor: string; program: ProgramInput })
  | (Base & { type: "program.status"; actor: string; status: ProgramStatus })
  | (Base & { type: "affiliate.enroll"; actor: string; name: string; email: string; sponsorCode?: string; deviceId?: string })
  | (Base & { type: "affiliate.suspend"; actor: string; affiliateId: string })
  | (Base & { type: "affiliate.reactivate"; actor: string; affiliateId: string })
  | (Base & { type: "referral.click"; code: string; name?: string; email: string; deviceId?: string })
  | (Base & { type: "referral.signup"; referralId: string })
  | (Base & { type: "referral.qualify"; referralId: string })
  | (Base & { type: "referral.convert"; email: string; sale: Money; saleRef: string })
  | (Base & { type: "sale.refunded"; saleRef: string })
  | (Base & { type: "commission.review"; actor: string; commissionId: string; approve: boolean })
  | (Base & { type: "tick" })
  | (Base & { type: "payout.request"; actor: string; affiliateId: string; currency: string })
  | (Base & { type: "payout.decide"; actor: string; payoutId: string; approve: boolean })
  | (Base & { type: "payout.markPaid"; actor: string; payoutId: string; paymentRef: string });

export type ReferralResult = { state: ReferralState; error?: string; errorCode?: ErrorCode };

// ---------------------------------------------------------------- validation and helpers
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();
const nonNegInt = (value: number) => Number.isSafeInteger(value) && value >= 0;

export function validateProgram(input: ProgramInput): string[] {
  const issues: string[] = [];
  if (input.name.trim() === "" || input.name.length > 80) issues.push("nombre (1 a 80 caracteres)");
  if (!isCurrency(input.currency) || isCrypto(input.currency)) issues.push("moneda (solo dinero tradicional)");
  const checkRule = (rule: RewardRule, where: string) => {
    if (rule.kind === "percent") {
      if (!Number.isInteger(rule.basisPoints) || rule.basisPoints < 1 || rule.basisPoints > 5_000) issues.push(`${where}: porcentaje de 0.01 % a 50 %`);
      if (rule.currency !== input.currency) issues.push(`${where}: moneda distinta a la del programa`);
      if (rule.capMinor !== undefined && !nonNegInt(rule.capMinor)) issues.push(`${where}: tope inválido`);
    } else {
      if (!isMoney(rule.amount) || rule.amount.amountMinor === 0) issues.push(`${where}: monto fijo positivo`);
      if (rule.amount.currency !== input.currency) issues.push(`${where}: moneda distinta a la del programa`);
    }
  };
  checkRule(input.reward, "nivel 1");
  if (input.levels.length > 2) issues.push("hasta 2 niveles adicionales");
  input.levels.forEach((rule, index) => checkRule(rule, `nivel ${index + 2}`));
  if (input.levelsEnabled && input.levels.length === 0) issues.push("activó niveles sin definirlos");
  if (!Number.isInteger(input.attributionWindowDays) || input.attributionWindowDays < 1 || input.attributionWindowDays > 365) issues.push("ventana de atribución de 1 a 365 días");
  if (!nonNegInt(input.minSaleMinor)) issues.push("venta mínima");
  if (!Number.isInteger(input.approval.holdDays) || input.approval.holdDays < 0 || input.approval.holdDays > 180) issues.push("espera de 0 a 180 días");
  if (!nonNegInt(input.approval.autoApproveMaxMinor)) issues.push("tope de aprobación automática");
  if (!Number.isSafeInteger(input.approval.minPayoutMinor) || input.approval.minPayoutMinor < 1) issues.push("mínimo de pago positivo");
  if (!/^https:\/\/[^\s/]+$/.test(input.linkBase)) issues.push("base del enlace (https://dominio)");
  return issues;
}

const FNV_OFFSET = 0x811c9dc5;
const fnv = (text: string): number => {
  let hash = FNV_OFFSET;
  for (const char of text) hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193) >>> 0;
  return hash;
};
export const CODE_PATTERN = /^[A-Z]{2,4}-[A-Z0-9]{4}$/;

/** Letters from the name plus a hash tail: readable, unique per company and not guessable by counting. */
export function makeCode(tenantId: string, name: string, salt: number): string {
  const letters = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4).padEnd(2, "X");
  const tail = fnv(`${tenantId}|${name}|${salt}`).toString(36).toUpperCase().padStart(4, "0").slice(-4);
  return `${letters}-${tail}`;
}
export const linkFor = (linkBase: string, code: string): string => `${linkBase.replace(/\/$/, "")}/r/${code}`;

// Nothing is ever trimmed: records, logs and the audit trail all stay. Limits belong to the view (display.ts).
const append = <T,>(items: readonly T[], item: T): readonly T[] => [...items, item];
const note = (state: ReferralState, at: string, actor: string, action: string, detail?: string, level: ReferralLog["level"] = "info"): ReferralState => ({
  ...state,
  audit: append(state.audit, { at, actor, action, detail }),
  logs: append(state.logs, { at, level, event: detail ? `${action}: ${detail}` : action }),
});
const nextId = (state: ReferralState, prefix: string): { id: string; state: ReferralState } => {
  const sequence = state.sequence + 1;
  return { id: `${prefix}_${String(sequence).padStart(4, "0")}`, state: { ...state, sequence } };
};
const replace = <T extends { id: string }>(items: readonly T[], item: T): readonly T[] => items.map((existing) => (existing.id === item.id ? item : existing));
const withHistory = (commission: Commission, at: string, actor: string, event: string, detail?: string): Commission => ({ ...commission, history: [...commission.history, { at, actor, event, detail }] });

// ---------------------------------------------------------------- the reducer
export function reduceReferrals(state: ReferralState, event: ReferralEvent): ReferralResult {
  const refuse = (code: ErrorCode, params?: Record<string, string | number>): ReferralResult => ({ state, error: message(code, params), errorCode: code });

  if (event.tenantId !== state.tenantId) return refuse("tenantMismatch"); // defense in depth: a company never sees another's data
  const { program } = state;
  const needPerson = (actor: string) => (isPerson(actor) ? null : refuse("personRequired"));

  switch (event.type) {
    case "program.save": {
      const denied = needPerson(event.actor);
      if (denied) return denied;
      const issues = validateProgram(event.program);
      if (issues.length) return refuse("programInvalid", { detail: issues[0] });
      if (program?.status === "ended") return refuse("programInactive");
      return { state: note({ ...state, program: { id: "program", tenantId: state.tenantId, ...event.program } }, event.at, event.actor, "program.save", event.program.name) };
    }

    case "program.status": {
      const denied = needPerson(event.actor);
      if (denied) return denied;
      if (!program) return refuse("noProgram");
      if (program.status === "ended") return refuse("invalidTransition", { from: "terminado", to: event.status });
      return { state: note({ ...state, program: { ...program, status: event.status } }, event.at, event.actor, "program.status", event.status) };
    }

    case "affiliate.enroll": {
      if (!program) return refuse("noProgram");
      if (event.name.trim() === "") return refuse("nameRequired");
      const email = normalizeEmail(event.email);
      if (!EMAIL.test(email)) return refuse("emailInvalid");
      if (state.affiliates.some((affiliate) => affiliate.email === email)) return refuse("affiliateExists");
      let sponsorId: string | undefined;
      if (event.sponsorCode?.trim()) {
        const sponsor = state.affiliates.find((affiliate) => affiliate.code === event.sponsorCode?.trim().toUpperCase());
        if (!sponsor) return refuse("sponsorNotFound");
        sponsorId = sponsor.id;
      }
      const { id, state: sequenced } = nextId(state, "af");
      let salt = sequenced.sequence;
      let code = makeCode(state.tenantId, event.name, salt);
      while (sequenced.affiliates.some((affiliate) => affiliate.code === code)) code = makeCode(state.tenantId, event.name, (salt += 1));
      const affiliate: Affiliate = { id, tenantId: state.tenantId, name: event.name.trim(), email, code, link: linkFor(program.linkBase, code), status: "active", sponsorId, deviceId: event.deviceId, createdAt: event.at };
      return { state: note({ ...sequenced, affiliates: append(sequenced.affiliates, affiliate) }, event.at, event.actor, "affiliate.enroll", `${id} · ${code}`) };
    }

    case "affiliate.suspend":
    case "affiliate.reactivate": {
      const denied = needPerson(event.actor);
      if (denied) return denied;
      const affiliate = state.affiliates.find((item) => item.id === event.affiliateId);
      if (!affiliate) return refuse("affiliateNotFound");
      const status = event.type === "affiliate.suspend" ? "suspended" : "active";
      return { state: note({ ...state, affiliates: replace(state.affiliates, { ...affiliate, status }) }, event.at, event.actor, event.type, affiliate.id) };
    }

    case "referral.click": {
      if (!program || program.status !== "active") return refuse("programInactive");
      const affiliate = state.affiliates.find((item) => item.code === event.code.trim().toUpperCase());
      if (!affiliate) return refuse("codeNotFound");
      if (affiliate.status !== "active") return refuse("affiliateSuspended");
      const email = normalizeEmail(event.email);
      if (!EMAIL.test(email)) return refuse("emailInvalid");
      if (state.referrals.some((referral) => referral.email === email && referral.status === "converted")) return { state: note(state, event.at, "system", "referral.ignored", "ya es cliente") };
      const existing = state.referrals.find((referral) => referral.affiliateId === affiliate.id && referral.email === email && (referral.status === "clicked" || referral.status === "signedUp" || referral.status === "qualified"));
      let next = state;
      let referralId: string;
      if (existing) {
        referralId = existing.id;
        next = { ...next, referrals: replace(next.referrals, { ...existing, lastTouchAt: event.at, deviceId: event.deviceId ?? existing.deviceId }) };
      } else {
        const created = nextId(next, "rf");
        referralId = created.id;
        const referral: Referral = { id: created.id, tenantId: state.tenantId, affiliateId: affiliate.id, name: event.name?.trim() || email.split("@")[0], email, deviceId: event.deviceId, status: "clicked", stage: 0, createdAt: event.at, lastTouchAt: event.at };
        next = { ...created.state, referrals: append(created.state.referrals, referral) };
      }
      next = { ...next, touches: append(next.touches, { referralId, affiliateId: affiliate.id, email, at: event.at, code: affiliate.code }) };
      return { state: note(next, event.at, "system", "referral.click", `${referralId} · ${affiliate.code}`) };
    }

    case "referral.signup":
    case "referral.qualify": {
      const referral = state.referrals.find((item) => item.id === event.referralId);
      if (!referral) return refuse("referralNotFound");
      const [from, to, stage] = event.type === "referral.signup" ? (["clicked", "signedUp", 1] as const) : (["signedUp", "qualified", 2] as const);
      if (referral.status !== from) return refuse("invalidTransition", { from: statusWord(referral.status), to: statusWord(to) });
      return { state: note({ ...state, referrals: replace(state.referrals, { ...referral, status: to, stage }) }, event.at, "system", event.type, referral.id) };
    }

    case "referral.convert": {
      if (!program || program.status !== "active") return refuse("programInactive");
      if (!isMoney(event.sale) || event.sale.amountMinor === 0) return refuse("saleInvalid");
      if (event.sale.currency !== program.currency) return refuse("currencyMismatch", { currency: program.currency });
      const saleRef = event.saleRef.trim();
      if (saleRef === "") return refuse("saleInvalid");
      if (state.sales.includes(saleRef)) return refuse("saleDuplicate");
      const email = normalizeEmail(event.email);
      if (state.referrals.some((referral) => referral.email === email && referral.status === "converted")) return refuse("alreadyConverted");
      const open = state.referrals.filter((referral) => referral.email === email && (referral.status === "clicked" || referral.status === "signedUp" || referral.status === "qualified"));
      if (open.length === 0) return refuse("referralNotFound");

      const winnerTouch = attribute(
        state.touches.filter((touch) => touch.email === email).map((touch) => ({ referrerId: touch.affiliateId, at: touch.at, code: touch.code })),
        event.at,
        program.attributionWindowDays,
      );
      if (!winnerTouch) return refuse("outsideWindow");
      const winner = open.find((referral) => referral.affiliateId === winnerTouch.referrerId);
      if (!winner) return refuse("referralNotFound");
      const affiliate = state.affiliates.find((item) => item.id === winner.affiliateId);
      if (!affiliate) return refuse("affiliateNotFound");

      // The last touch wins; every other open referral of the same person loses the attribution.
      let next: ReferralState = {
        ...state,
        referrals: state.referrals.map((referral) => {
          if (referral.id === winner.id) return { ...referral, status: "converted" as const, stage: 3 as const, convertedAt: event.at };
          return open.some((item) => item.id === referral.id) ? { ...referral, status: "rejected" as const, rejectReason: "lostAttribution" as const } : referral;
        }),
        sales: append(state.sales, saleRef),
      };

      const recentByAffiliate = state.referrals.filter((referral) => referral.affiliateId === affiliate.id && Math.abs(Date.parse(winner.createdAt) - Date.parse(referral.createdAt)) <= BURST_WINDOW_MS).length;
      const signals: ReferralFraudSignal[] = [
        ...fraudSignals({ referrerEmail: affiliate.email, referredEmail: winner.email, sameDevice: Boolean(affiliate.deviceId && affiliate.deviceId === winner.deviceId) }),
        ...(recentByAffiliate >= BURST_LIMIT ? (["burst"] as const) : []),
        ...(affiliate.status === "suspended" ? (["suspendedAffiliate"] as const) : []),
      ];

      const earn = (target: Affiliate, level: 1 | 2 | 3, rule: RewardRule): ReferralState | null => {
        const amount = rewardFor({ reward: rule, minSaleMinor: program.minSaleMinor }, event.sale);
        if (amount.amountMinor === 0) return null;
        const created = nextId(next, "cm");
        const suspended = target.status === "suspended";
        const status: CommissionStatus = suspended ? "rejected" : signals.length ? "held" : "pending";
        const commission: Commission = {
          id: created.id, tenantId: state.tenantId, affiliateId: target.id, referralId: winner.id, level, saleRef, sale: event.sale, amount, rule, status, signals,
          createdAt: event.at, eligibleAt: addDays(event.at, program.approval.holdDays),
          history: [{ at: event.at, actor: "system", event: status === "held" ? "held" : status === "rejected" ? "rejected" : "created", detail: signals.length ? signals.join(", ") : undefined }],
        };
        return { ...created.state, commissions: append(created.state.commissions, commission) };
      };

      const first = earn(affiliate, 1, program.reward);
      next = first ?? note(next, event.at, "system", "commission.belowMinimum", saleRef);

      if (program.levelsEnabled) {
        const visited = new Set<string>([affiliate.id]);
        let sponsorId = affiliate.sponsorId;
        for (let index = 0; index < program.levels.length && sponsorId && !visited.has(sponsorId); index += 1) {
          const sponsor = next.affiliates.find((item) => item.id === sponsorId);
          if (!sponsor || sponsor.status !== "active") break;
          visited.add(sponsor.id);
          const upline = earn(sponsor, (index + 2) as 2 | 3, program.levels[index]);
          if (upline) next = upline;
          sponsorId = sponsor.sponsorId;
        }
      }
      return { state: note(next, event.at, "system", "referral.convert", `${winner.id} · ${saleRef}${signals.length ? ` · ${signals.join(", ")}` : ""}`, signals.length ? "warn" : "info") };
    }

    case "sale.refunded": {
      if (!state.sales.includes(event.saleRef)) return refuse("saleNotFound");
      const affected = state.commissions.filter((commission) => commission.saleRef === event.saleRef);
      if (affected.some((commission) => commission.status === "inPayout")) return refuse("commissionInPayout");
      const commissions = state.commissions.map((commission) => {
        if (commission.saleRef !== event.saleRef) return commission;
        if (commission.status === "paid") return withHistory({ ...commission, clawback: true }, event.at, "system", "clawback", "venta reembolsada después de pagar");
        if (commission.status === "pending" || commission.status === "held" || commission.status === "approved") return withHistory({ ...commission, status: "reversed" as const }, event.at, "system", "reversed", "venta reembolsada");
        return commission;
      });
      return { state: note({ ...state, commissions }, event.at, "system", "sale.refunded", event.saleRef, "warn") };
    }

    case "commission.review": {
      const denied = needPerson(event.actor);
      if (denied) return denied;
      const commission = state.commissions.find((item) => item.id === event.commissionId);
      if (!commission) return refuse("commissionNotFound");
      if (commission.status !== "pending" && commission.status !== "held") return refuse("commissionNotReviewable", { status: commission.status });
      if (event.approve && Date.parse(event.at) < Date.parse(commission.eligibleAt)) return refuse("holdNotElapsed", { date: commission.eligibleAt.slice(0, 10) });
      const updated = withHistory({ ...commission, status: event.approve ? ("approved" as const) : ("rejected" as const) }, event.at, event.actor, event.approve ? "approved" : "rejected");
      return { state: note({ ...state, commissions: replace(state.commissions, updated) }, event.at, event.actor, event.approve ? "commission.approve" : "commission.reject", commission.id) };
    }

    case "tick": {
      if (!program) return { state };
      const now = Date.parse(event.at);
      const commissions = state.commissions.map((commission) =>
        commission.status === "pending" && commission.signals.length === 0 && now >= Date.parse(commission.eligibleAt) && commission.amount.amountMinor <= program.approval.autoApproveMaxMinor
          ? withHistory({ ...commission, status: "approved" as const }, event.at, "system", "approved", "regla de aprobación automática")
          : commission,
      );
      const windowMs = program.attributionWindowDays * 86_400_000;
      const referrals = state.referrals.map((referral) =>
        (referral.status === "clicked" || referral.status === "signedUp" || referral.status === "qualified") && now - Date.parse(referral.lastTouchAt) > windowMs
          ? { ...referral, status: "expired" as const, rejectReason: "expired" as const }
          : referral,
      );
      return { state: note({ ...state, commissions, referrals }, event.at, "system", "tick") };
    }

    case "payout.request": {
      const denied = needPerson(event.actor);
      if (denied) return denied;
      if (!program) return refuse("noProgram");
      const affiliate = state.affiliates.find((item) => item.id === event.affiliateId);
      if (!affiliate) return refuse("affiliateNotFound");
      if (!isCurrency(event.currency) || isCrypto(event.currency)) return refuse("currencyInvalid");
      const ready = state.commissions.filter((commission) => commission.affiliateId === affiliate.id && commission.status === "approved" && commission.amount.currency === event.currency);
      if (ready.length === 0) return refuse("nothingToPay");
      const total = ready.reduce((sum, commission) => sum + commission.amount.amountMinor, 0);
      if (total < program.approval.minPayoutMinor) return refuse("payoutBelowMinimum", { min: program.approval.minPayoutMinor });
      const { id, state: sequenced } = nextId(state, "po");
      const payout: Payout = { id, tenantId: state.tenantId, affiliateId: affiliate.id, commissionIds: ready.map((commission) => commission.id), total: { amountMinor: total, currency: event.currency }, status: "requested", requestedBy: event.actor, requestedAt: event.at };
      const commissions = sequenced.commissions.map((commission) => (payout.commissionIds.includes(commission.id) ? withHistory({ ...commission, status: "inPayout" as const, payoutId: id }, event.at, event.actor, "payout.requested", id) : commission));
      return { state: note({ ...sequenced, commissions, payouts: append(sequenced.payouts, payout) }, event.at, event.actor, "payout.request", `${id} · ${affiliate.id}`) };
    }

    case "payout.decide": {
      const denied = needPerson(event.actor);
      if (denied) return denied;
      const payout = state.payouts.find((item) => item.id === event.payoutId);
      if (!payout) return refuse("payoutNotFound");
      if (payout.status !== "requested") return refuse("payoutResolved");
      if (event.approve && event.actor === payout.requestedBy) return refuse("selfApproval");
      const decided: Payout = { ...payout, status: event.approve ? "approved" : "rejected", decidedBy: event.actor, decidedAt: event.at };
      const commissions = event.approve
        ? state.commissions
        : state.commissions.map((commission) => (commission.payoutId === payout.id ? withHistory({ ...commission, status: "approved" as const, payoutId: undefined }, event.at, event.actor, "payout.rejected", payout.id) : commission));
      return { state: note({ ...state, commissions, payouts: replace(state.payouts, decided) }, event.at, event.actor, event.approve ? "payout.approve" : "payout.reject", payout.id) };
    }

    case "payout.markPaid": {
      const denied = needPerson(event.actor);
      if (denied) return denied;
      const payout = state.payouts.find((item) => item.id === event.payoutId);
      if (!payout) return refuse("payoutNotFound");
      if (payout.status !== "approved") return refuse("payoutNotApproved");
      const paymentRef = event.paymentRef.trim();
      if (paymentRef === "" || paymentRef.length > 80) return refuse("paymentRefRequired");
      const commissions = state.commissions.map((commission) => (commission.payoutId === payout.id ? withHistory({ ...commission, status: "paid" as const }, event.at, event.actor, "paid", paymentRef) : commission));
      return { state: note({ ...state, commissions, payouts: replace(state.payouts, { ...payout, status: "paid", paidAt: event.at, paymentRef }) }, event.at, event.actor, "payout.paid", `${payout.id} · ${paymentRef}`) };
    }
  }
}

// referral status words for the transition error, from the same dictionary the screens use
const statusWord = (status: ReferralStatus): string => label("referralStatus", status);

export function applyAllReferrals(state: ReferralState, events: readonly ReferralEvent[]): { state: ReferralState; errors: string[] } {
  const errors: string[] = [];
  let current = state;
  for (const event of events) {
    const result = reduceReferrals(current, event);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    current = result.state;
  }
  return { state: current, errors };
}

// ---------------------------------------------------------------- dashboard
export type ReferralSummary = {
  affiliates: { total: number; active: number; suspended: number };
  funnel: { clicks: number; signedUp: number; qualified: number; converted: number; rejected: number; expired: number };
  rates: { signup: number | null; conversion: number | null; closing: number | null }; // 0..1; null when there is nothing to divide by
  commissions: Record<"pending" | "held" | "approved" | "inPayout" | "paid", number> & { reversed: number; rejected: number; clawback: number };
  leaderboard: { affiliateId: string; name: string; converted: number; earnedMinor: number }[];
  todo: { toReview: number; payoutsToDecide: number; payoutsToPay: number };
};

const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole);

export function summarizeReferrals(state: ReferralState): ReferralSummary {
  const stage = (min: number) => state.referrals.filter((referral) => referral.stage >= min).length;
  const clicks = state.referrals.length;
  const sum = (status: CommissionStatus) => state.commissions.filter((commission) => commission.status === status).reduce((total, commission) => total + commission.amount.amountMinor, 0);
  const earned = (affiliateId: string) => state.commissions.filter((commission) => commission.affiliateId === affiliateId && (commission.status === "approved" || commission.status === "inPayout" || commission.status === "paid")).reduce((total, commission) => total + commission.amount.amountMinor, 0);
  return {
    affiliates: { total: state.affiliates.length, active: state.affiliates.filter((a) => a.status === "active").length, suspended: state.affiliates.filter((a) => a.status === "suspended").length },
    funnel: { clicks, signedUp: stage(1), qualified: stage(2), converted: stage(3), rejected: state.referrals.filter((r) => r.status === "rejected").length, expired: state.referrals.filter((r) => r.status === "expired").length },
    rates: { signup: ratio(stage(1), clicks), conversion: ratio(stage(3), clicks), closing: ratio(stage(3), stage(1)) },
    commissions: { pending: sum("pending"), held: sum("held"), approved: sum("approved"), inPayout: sum("inPayout"), paid: sum("paid"), reversed: sum("reversed"), rejected: sum("rejected"), clawback: state.commissions.filter((c) => c.clawback).length },
    leaderboard: state.affiliates
      .map((affiliate) => ({ affiliateId: affiliate.id, name: affiliate.name, converted: state.referrals.filter((r) => r.affiliateId === affiliate.id && r.status === "converted").length, earnedMinor: earned(affiliate.id) }))
      .sort((a, b) => b.earnedMinor - a.earnedMinor || a.name.localeCompare(b.name)),
    todo: {
      toReview: state.commissions.filter((c) => c.status === "pending" || c.status === "held").length,
      payoutsToDecide: state.payouts.filter((p) => p.status === "requested").length,
      payoutsToPay: state.payouts.filter((p) => p.status === "approved").length,
    },
  };
}
