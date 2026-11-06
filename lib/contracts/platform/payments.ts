// Payments module contracts. Money is an integer in minor units with an explicit currency, always.
// Nothing here talks to a provider; adapters (lib/integrations/types.ts) will produce and consume these shapes.

export type Money = { amountMinor: number; currency: string };

export const isMoney = (value: unknown): value is Money =>
  typeof value === "object" && value !== null &&
  Number.isSafeInteger((value as Money).amountMinor) && (value as Money).amountMinor >= 0 &&
  typeof (value as Money).currency === "string" && /^[A-Z]{3}$/.test((value as Money).currency);

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error("currency mismatch");
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

export const PAYMENT_STATUSES = ["pending", "succeeded", "failed", "refunded", "partiallyRefunded", "disputed"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// A payment only moves forward. Terminal states never come back; a dispute can end either way through new events.
const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  pending: ["succeeded", "failed"],
  succeeded: ["refunded", "partiallyRefunded", "disputed"],
  partiallyRefunded: ["refunded", "disputed"],
  disputed: ["succeeded", "refunded"],
  refunded: [],
  failed: [],
};

export const canTransitionPayment = (from: PaymentStatus, to: PaymentStatus): boolean => from === to || PAYMENT_TRANSITIONS[from].includes(to);

/** The net amount kept after refunds. Refunds can never exceed what was paid. */
export function netAmount(paid: Money, refunds: readonly Money[]): Money {
  const refunded = refunds.reduce((sum, refund) => addMoney(sum, refund), { amountMinor: 0, currency: paid.currency });
  if (refunded.amountMinor > paid.amountMinor) throw new Error("refunds exceed the payment");
  return { amountMinor: paid.amountMinor - refunded.amountMinor, currency: paid.currency };
}

// Creating a payment link or a charge is a financial action: Level 3, a person approves every time.
export const PAYMENT_LINK_STATUSES = ["draft", "pendingApproval", "active", "paid", "expired", "cancelled"] as const;
export type PaymentLinkStatus = (typeof PAYMENT_LINK_STATUSES)[number];

export type PaymentLinkDraft = {
  tenantId: string;
  reference: { opportunityId?: string; customerId?: string; invoiceId?: string };
  amount: Money;
  description: string;
  expiresAt?: string;
  provider: string;
};

export function validatePaymentLink(draft: PaymentLinkDraft): string[] {
  const issues: string[] = [];
  if (!isMoney(draft.amount) || draft.amount.amountMinor === 0) issues.push("amount must be a positive integer in minor units");
  if (draft.description.trim() === "" || draft.description.length > 200) issues.push("description is required (200 characters at most)");
  if (!draft.reference.opportunityId && !draft.reference.customerId && !draft.reference.invoiceId) issues.push("a payment must reference an opportunity, a customer or an invoice");
  if (draft.expiresAt && Number.isNaN(Date.parse(draft.expiresAt))) issues.push("expiresAt is not a date");
  return issues;
}

// Reconciliation (SINPE and any provider without webhooks): a received transfer is matched to an expected payment.
export type ReconciliationCandidate = { paymentId: string; expected: Money; reference?: string; payerName?: string };
export type IncomingTransfer = { amount: Money; reference?: string; payerName?: string; receivedAt: string };
export type MatchResult = { kind: "exact" | "probable" | "none" | "ambiguous"; paymentId?: string; candidates: string[] };

/** Exact: same amount and reference. Probable: same amount, one open candidate. Never decides alone when it is ambiguous. */
export function matchTransfer(transfer: IncomingTransfer, open: readonly ReconciliationCandidate[]): MatchResult {
  const sameAmount = open.filter((candidate) => candidate.expected.currency === transfer.amount.currency && candidate.expected.amountMinor === transfer.amount.amountMinor);
  const exact = sameAmount.filter((candidate) => transfer.reference && candidate.reference && candidate.reference === transfer.reference);
  if (exact.length === 1) return { kind: "exact", paymentId: exact[0].paymentId, candidates: [exact[0].paymentId] };
  if (sameAmount.length === 1 && exact.length === 0) return { kind: "probable", paymentId: sameAmount[0].paymentId, candidates: [sameAmount[0].paymentId] };
  if (sameAmount.length === 0) return { kind: "none", candidates: [] };
  return { kind: "ambiguous", candidates: sameAmount.map((candidate) => candidate.paymentId) };
}
