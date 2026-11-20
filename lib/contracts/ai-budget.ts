// The contract of the AI budget (ADR-0036): what the database functions of supabase/migrations/20261118000100_ai_budget.sql take and answer. Figures only: micros of a dollar and
// token counts, never a prompt or an answer. The database is the source of truth; this file only types and checks what crosses the boundary.

/** Whether an attempt was the first call, a second call to the same model, or a call to another model. */
export type AttemptRole = "primary" | "retry" | "fallback";

/** One provider attempt as `settle_ai_budget` takes it (the keys are the database's). */
export type BudgetAttemptRow = {
  attempt_no: number;
  role: AttemptRole;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
  /** false for an attempt that was never sent or that the provider will not charge */ billable: boolean;
};

export const MAX_ATTEMPTS_PER_RESERVATION = 20;

export type ReserveRefusal = "no_budget" | "budget_exceeded" | "already_closed";
export type ReserveOutcome =
  | { ok: true; reservationId: string; periodStart: string; expiresAt: string; repeated: boolean }
  | { ok: false; reason: ReserveRefusal; reservationId?: string };
export type SettleOutcome = { ok: true; reservationId: string; settledMicros: number; overageMicros: number; repeated: boolean };

/** What the AI layer needs from wherever the budget lives (the database, in `lib/db/ai-budget.ts`; a fake in tests). A null answer means "could not tell": the caller does not call a provider. */
export interface BudgetStore {
  reserve(input: { tenantId: string; purposeId: string; estimateMicros: number; idempotencyKey: string; ttlSeconds?: number }): Promise<ReserveOutcome | null>;
  settle(reservationId: string, attempts: readonly BudgetAttemptRow[]): Promise<SettleOutcome | null>;
  release(reservationId: string): Promise<boolean>;
}

const REFUSALS: readonly string[] = ["no_budget", "budget_exceeded", "already_closed"];
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const whole = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** The answer of `reserve_ai_budget`, or null when it is not one (the caller then treats the budget as unavailable and does not call a provider). */
export function parseReserveOutcome(value: unknown): ReserveOutcome | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null;
  if (value.ok) {
    return isUuid(value.reservationId) && typeof value.periodStart === "string" && typeof value.expiresAt === "string"
      ? { ok: true, reservationId: value.reservationId, periodStart: value.periodStart, expiresAt: value.expiresAt, repeated: value.repeated === true }
      : null;
  }
  return typeof value.reason === "string" && REFUSALS.includes(value.reason)
    ? { ok: false, reason: value.reason as ReserveRefusal, ...(isUuid(value.reservationId) ? { reservationId: value.reservationId } : {}) }
    : null;
}

/** The answer of `settle_ai_budget`, or null. */
export function parseSettleOutcome(value: unknown): SettleOutcome | null {
  if (!isRecord(value) || value.ok !== true || !isUuid(value.reservationId) || !whole(value.settledMicros) || !whole(value.overageMicros)) return null;
  return { ok: true, reservationId: value.reservationId, settledMicros: value.settledMicros, overageMicros: value.overageMicros, repeated: value.repeated === true };
}
