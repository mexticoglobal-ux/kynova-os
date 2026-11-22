// The AI layer's side of the budget (ADR-0036): how much to reserve before a call, how every provider attempt is counted afterwards, and the gate that ties both to a store.
// Pure: no database, no network, no clock. The store (the database) decides; this file prepares what it is asked and turns the executor's attempts into billable rows.
//
// What counts as billed is a decision to confirm against the provider's real invoices; today it is deliberately CONSERVATIVE (a call that may have been processed is counted at its
// worst case rather than ignored), because a reservation that is not reconciled keeps counting against the limit anyway.

import { MAX_ATTEMPTS_PER_RESERVATION, type AttemptRole, type BudgetAttemptRow, type BudgetStore, type ReserveRefusal, type SettleOutcome } from "@/lib/contracts/ai-budget";
import { attemptsFor, type GatewayRequest } from "@/lib/contracts/platform/gateway-engine";
import type { AttemptEvent } from "./executor";
import { NATIVE_MODELS, costOfNative, type NativeModel } from "./providers";

export type BillingTreatment = "actual" | "worst_case" | "none";
/**
 * How each way an attempt can end is counted:
 *  - actual: the provider's own token counts and the model's price;
 *  - worst_case: the request was sent and may have been processed (a timeout, a network failure, a server error), so it counts at the input plus the largest answer allowed;
 *  - none: rejected before any processing (rate limit, bad key, bad request, not configured, never sent).
 * Review this table against real invoices before connecting a provider.
 */
export const BILLING_POLICY: Readonly<Record<string, BillingTreatment>> = {
  ok: "actual",
  timeout: "worst_case",
  network: "worst_case",
  server: "worst_case",
  content: "actual",
  parse: "actual",
  rateLimited: "none",
  auth: "none",
  badRequest: "none",
  notConfigured: "none",
  skipped: "none",
};

/** An outcome the table does not know is counted at its worst case: never assume a call was free. */
export const treatmentOf = (event: Pick<AttemptEvent, "outcome" | "errorKind">): BillingTreatment =>
  event.outcome === "skipped" ? "none" : event.outcome === "ok" ? "actual" : (BILLING_POLICY[event.errorKind ?? (event.outcome === "rateLimited" ? "rateLimited" : "")] ?? "worst_case");

/**
 * The most a call can cost, in micros of a dollar: every model of the chain, each tried as many times as the Gateway allows for the request's priority, at the largest input and
 * answer. This is what is reserved before the call, so retries and fallbacks are already covered. At least 1 (a reservation is never for nothing).
 */
export function worstCaseMicros(request: Pick<GatewayRequest, "models" | "priority" | "limits" | "inputTokens" | "maxOutputTokens">, natives: Readonly<Record<string, NativeModel>> = NATIVE_MODELS): number {
  const tries = attemptsFor(request.priority, request.limits);
  let total = 0;
  for (const modelId of request.models) {
    const native = natives[modelId];
    if (!native || !native.chat) continue;
    total += costOfNative(native, request.inputTokens, request.maxOutputTokens) * tries;
  }
  return Math.max(1, total);
}

/** The attempts the executor reported (a provider that was skipped was never called and is left out) as the rows the database settles, with their role and cost. */
export function rowsFromAttempts(
  events: readonly AttemptEvent[],
  call: { inputTokens: number; maxOutputTokens: number },
  natives: Readonly<Record<string, NativeModel>> = NATIVE_MODELS,
): { rows: BudgetAttemptRow[]; unpriced: string[] } {
  const sent = events.filter((event) => event.outcome !== "skipped").slice(0, MAX_ATTEMPTS_PER_RESERVATION);
  const rows: BudgetAttemptRow[] = [];
  const unpriced: string[] = [];
  sent.forEach((event, index) => {
    const treatment = treatmentOf(event);
    const previous = sent[index - 1];
    const role: AttemptRole = index === 0 ? "primary" : previous?.modelId === event.modelId ? "retry" : "fallback";
    const native = natives[event.modelId];
    const inputTokens = treatment === "none" ? 0 : (event.inputTokens ?? call.inputTokens);
    const outputTokens = treatment === "none" ? 0 : treatment === "worst_case" ? call.maxOutputTokens : (event.outputTokens ?? 0);
    if (treatment !== "none" && !native) unpriced.push(event.modelId);
    rows.push({
      attempt_no: index + 1,
      role,
      provider: event.providerId,
      model: event.modelId,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_micros: treatment === "none" || !native ? 0 : costOfNative(native, inputTokens, outputTokens),
      billable: treatment !== "none",
    });
  });
  return { rows, unpriced };
}

export type BudgetGate = {
  /** Reserves the room in the company's budget. true only when it was granted: anything else (no budget, exceeded, store unreachable) is false and nothing is sent to a provider. */
  reserve(): Promise<boolean>;
  /** After the call: settles the reservation with every attempt the executor made, retries and fallbacks included. */
  settle(events: readonly AttemptEvent[], call: { inputTokens: number; maxOutputTokens: number }): Promise<SettleOutcome | null>;
  /** Settles with attempt rows the caller already priced (from the provider's own report). null when it could not be recorded: the reservation then stays held. */
  settleRows(rows: readonly BudgetAttemptRow[]): Promise<SettleOutcome | null>;
  /** The call never reached a provider: gives the room back. */
  release(): Promise<boolean>;
  readonly reservationId: string | undefined;
  readonly refusal: ReserveRefusal | "unavailable" | "repeated" | undefined;
};

/** The gate for ONE call of a company. `idempotencyKey` identifies the request: a retry of the same request passes the same key, so it never reserves twice AND is never granted a second call (`refusal: "repeated"`). */
export function createBudgetGate(store: BudgetStore, params: { tenantId: string; requestedBy: string; purposeId: string; idempotencyKey: string; estimateMicros: number; ttlSeconds?: number }): BudgetGate {
  let reservationId: string | undefined;
  let refusal: ReserveRefusal | "unavailable" | "repeated" | undefined;
  return {
    get reservationId() { return reservationId; },
    get refusal() { return refusal; },
    async reserve() {
      const outcome = await store.reserve({ tenantId: params.tenantId, requestedBy: params.requestedBy, purposeId: params.purposeId, estimateMicros: params.estimateMicros, idempotencyKey: params.idempotencyKey, ...(params.ttlSeconds ? { ttlSeconds: params.ttlSeconds } : {}) }).catch(() => null);
      if (!outcome) { refusal = "unavailable"; return false; }
      if (!outcome.ok) { refusal = outcome.reason; return false; }
      // the key was reserved before: that request already has its call (made, in flight or pending). Granting it again would send a SECOND call under one reservation.
      if (outcome.repeated) { refusal = "repeated"; return false; }
      reservationId = outcome.reservationId;
      return true;
    },
    async settle(events, call) {
      if (!reservationId) return null;
      return store.settle(reservationId, rowsFromAttempts(events, call).rows).catch(() => null);
    },
    async settleRows(rows) {
      if (!reservationId) return null;
      return store.settle(reservationId, rows).catch(() => null);
    },
    async release() {
      if (!reservationId) return false;
      return store.release(reservationId).catch(() => false);
    },
  };
}
