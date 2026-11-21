// ONE controlled model call (the first AI test, ADR-0036): the single path in which a budget reservation, the call cap, the input check and exactly ONE provider attempt are tied
// together. The route and the evals runner both go through it, so nothing about the limits is decided twice.
//
// What it guarantees, and how:
//  - Nothing reaches a provider unless a reservation was GRANTED first (the database checks the money and the call cap in one atomic step). A repeated request id is not granted again.
//  - The input is checked before reserving (`fits`) and again by the executor before sending. The bound is a CONSERVATIVE ESTIMATE (see input-bound.ts), never presented as a maximum
//    the provider guarantees; the money reserved is priced on it times a margin of ours, and what the call really cost (the provider's own token report) is what gets settled.
//  - ONE real attempt: one model in the chain, `retry.maxAttempts = 1`, and `maxProviderCalls = 1` in the executor, which refuses a second call before starting it. No retry, no fallback.
//  - The reservation is released ONLY when it is known that nothing was sent. If the outcome is uncertain (a timeout, a dropped connection, a server error, an unreadable answer, a
//    settlement that failed) the reservation stays HELD: it expires to "unreconciled", keeps counting against the money and the cap, and is reconciled later with the provider's evidence
//    or written off with a written reason. Nothing here ever frees room on a guess.

import { MAX_ATTEMPTS_PER_RESERVATION, type BudgetAttemptRow, type BudgetStore } from "@/lib/contracts/ai-budget";
import { GATEWAY_LIMIT_DEFAULTS } from "@/lib/contracts/platform/ai-limits";
import { MODEL_PROVIDER } from "@/lib/contracts/platform/gateway-catalog";
import { attemptsFor, type GatewayRequest } from "@/lib/contracts/platform/gateway-engine";
import { createBudgetGate } from "./budget";
import { executeChain, type AttemptEvent, type ExecutorDeps } from "./executor";
import { chatInputTokenBound } from "./input-bound";
import { NATIVE_MODELS, costOfNative, type NativeModel } from "./providers";
import type { ProviderErrorKind, ProviderPrompt } from "./types";

/** How the reservation of one call ended. "none": it was never reserved (refused, or the call never got that far). */
export type ReservationEnd = "none" | "released" | "settled" | "settled_no_charge" | "pending";

export type ControlledCallParams = {
  store: BudgetStore;
  tenantId: string;
  purposeId: string;
  /** identifies THIS request: the same id never makes a second call */ idempotencyKey: string;
  /** the registry key of the ONE model (never a provider's own id) */ modelId: string;
  /** the input limit, compared with the conservative bound */ maxInputTokens: number;
  /** sent to the provider as its own output cap */ maxOutputTokens: number;
  /** the margin applied to the input bound when pricing the reservation */ reservationInputFactor: number;
  /** a request's time limit in ms */ maxTimeMs?: number;
  executor: Omit<ExecutorDeps, "maxInputTokens" | "maxProviderCalls" | "onAttempt">;
  now?: () => Date;
};

export type ControlledCall = {
  /** whether the prompt is within the input limit by the conservative bound (also remembers its size for the reservation) */
  fits(prompt: ProviderPrompt): boolean;
  /** asks for the room; true only when granted */
  readonly budget: { reserve(): Promise<boolean> };
  /** the one provider attempt; returns the answer or throws (and has already settled, released or left pending the reservation, as it must) */
  ask(prompt: ProviderPrompt): Promise<string>;
  /** what happened, in words and figures (no text, no key) */
  readonly report: () => { reservation: ReservationEnd; providerCalls: number; reservationId: string | undefined; refusal: string | undefined; reservedMicros: number | undefined; settledMicros: number | undefined };
};

/** A rejection the provider itself answered before processing anything (rate limit, bad key, bad request): no charge, but a call was made, so its slot in the cap stays used. */
const REJECTED_BY_PROVIDER: readonly ProviderErrorKind[] = ["rateLimited", "auth", "badRequest"];

export function reservationMicros(native: NativeModel, inputBound: number, maxOutputTokens: number, factor: number): number {
  return Math.max(1, costOfNative(native, Math.ceil(inputBound * factor), maxOutputTokens));
}

export function createControlledCall(params: ControlledCallParams): ControlledCall {
  const native = NATIVE_MODELS[params.modelId];
  const now = params.now ?? (() => new Date());
  let boundSeen: number | undefined;
  let reservation: ReservationEnd = "none";
  let providerCalls = 0;
  let reservedMicros: number | undefined;
  let settledMicros: number | undefined;
  let gate: ReturnType<typeof createBudgetGate> | undefined;

  const request = (inputTokens: number): GatewayRequest => ({
    requestId: params.idempotencyKey,
    tenantId: params.tenantId,
    at: now().toISOString(),
    models: [params.modelId],
    priority: "normal",
    maxTimeMs: params.maxTimeMs ?? 20_000,
    inputTokens,
    maxOutputTokens: params.maxOutputTokens,
    // ONE attempt: no retry (the executor is also given maxProviderCalls = 1, which does not depend on these limits)
    limits: { retry: { maxAttempts: 1, backoffMs: [0] }, breaker: GATEWAY_LIMIT_DEFAULTS.breaker },
    promptHash: params.idempotencyKey,
  });

  /** Gives the room back, only when it is known that no call left. If the release itself fails the reservation stays pending. */
  const release = async (): Promise<void> => {
    reservation = (await (gate?.release() ?? Promise.resolve(false)).catch(() => false)) ? "released" : "pending";
  };

  return {
    fits(prompt) {
      boundSeen = chatInputTokenBound(prompt);
      return boundSeen <= params.maxInputTokens;
    },
    budget: {
      async reserve() {
        if (!native || !native.chat || !MODEL_PROVIDER[params.modelId]) return false; // an unknown model never reserves
        const estimate = reservationMicros(native, boundSeen ?? params.maxInputTokens, params.maxOutputTokens, params.reservationInputFactor);
        gate = createBudgetGate(params.store, { tenantId: params.tenantId, purposeId: params.purposeId, idempotencyKey: params.idempotencyKey, estimateMicros: estimate });
        const granted = await gate.reserve();
        if (granted) { reservation = "pending"; reservedMicros = estimate; }
        return granted;
      },
    },
    async ask(prompt) {
      if (!gate || !native) throw new Error("no reservation");
      const bound = chatInputTokenBound(prompt);
      const asked = request(bound);
      // everything that can be known WITHOUT calling is checked first, and each failure here means nothing was sent: the reservation is released
      if (bound > params.maxInputTokens || asked.models.length !== 1 || attemptsFor(asked.priority, asked.limits) !== 1) {
        await release();
        throw new Error("refused before the call");
      }
      const events: AttemptEvent[] = [];
      let execution;
      try {
        execution = await executeChain(asked, prompt, { ...params.executor, maxInputTokens: params.maxInputTokens, maxProviderCalls: 1, onAttempt: (event) => events.push(event) });
      } catch {
        // the executor failed in a way we cannot read: a call may have left. Keep the reservation for reconciliation.
        providerCalls = 1;
        reservation = "pending";
        throw new Error("uncertain outcome");
      }
      const sent = events.filter((event) => event.outcome !== "skipped" && event.errorKind !== "notConfigured");
      providerCalls = sent.length;
      if (sent.length === 0) {
        // skipped (a provider that is only prepared, a missing key, an open breaker) or refused for its input: nothing left
        await release();
        throw new Error("no call was made");
      }
      if (sent.length > 1 || events.length > MAX_ATTEMPTS_PER_RESERVATION) {
        reservation = "pending"; // impossible with maxProviderCalls = 1; if it ever happens it is not guessed at
        throw new Error("more than one call: left for reconciliation");
      }
      const attempt = sent[0] as AttemptEvent;
      const settle = async (row: BudgetAttemptRow): Promise<boolean> => {
        const settled = await gate?.settleRows([row]).catch(() => null);
        if (!settled) { reservation = "pending"; return false; } // the settlement could not be recorded: it stays pending
        settledMicros = settled.settledMicros;
        return true;
      };
      const row = (inputTokens: number, outputTokens: number, billable: boolean): BudgetAttemptRow => ({
        attempt_no: 1, role: "primary", provider: attempt.providerId, model: attempt.modelId, input_tokens: inputTokens, output_tokens: outputTokens,
        cost_micros: billable ? costOfNative(native, inputTokens, outputTokens) : 0, billable,
      });
      const outcome = execution.outcome;
      if (outcome.status === "ok" && execution.text !== null) {
        // a call that was made and answered: the provider's own token report when it gave one, otherwise the reserved worst case (it was billed, the amount is not known)
        const reported = outcome.tokenSource === "provider";
        if (await settle(reported ? row(outcome.inputTokens, outcome.outputTokens, true) : row(Math.ceil((boundSeen ?? bound) * params.reservationInputFactor), params.maxOutputTokens, true))) reservation = "settled";
        return execution.text;
      }
      if (attempt.errorKind && REJECTED_BY_PROVIDER.includes(attempt.errorKind)) {
        if (await settle(row(0, 0, false))) reservation = "settled_no_charge";
        throw new Error("the provider refused the request");
      }
      // a timeout, a dropped connection, a server error, an unreadable answer: it may have been processed and billed, and we do not know. NOT released, NOT settled on a guess.
      reservation = "pending";
      throw new Error("uncertain outcome");
    },
    report: () => ({ reservation, providerCalls, reservationId: gate?.reservationId, refusal: gate?.refusal, reservedMicros, settledMicros }),
  };
}
