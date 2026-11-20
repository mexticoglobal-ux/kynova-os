import type { SupabaseClient } from "@supabase/supabase-js";
import { parseReserveOutcome, parseSettleOutcome, type BudgetStore } from "@/lib/contracts/ai-budget";
import { errorOf } from "./backend";

// The AI budget in the database (ADR-0036, migration 20261118000100_ai_budget.sql): the only access to it. Every decision (the limit, idempotency, who may do what, the company) is made by
// the functions in the database; this file only calls them and checks the shape of the answer. A function that fails throws the backend's error, an answer that is not the expected shape
// is null, and in both cases the AI layer treats the budget as unavailable and calls no provider.
export function createAiBudgetStore(client: SupabaseClient): BudgetStore {
  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw errorOf(error);
    return data;
  };
  return {
    reserve: async (input) =>
      parseReserveOutcome(await call("reserve_ai_budget", { p_tenant: input.tenantId, p_purpose: input.purposeId, p_estimate_micros: input.estimateMicros, p_idempotency_key: input.idempotencyKey, p_ttl_seconds: input.ttlSeconds ?? 300 })),
    settle: async (reservationId, attempts) => parseSettleOutcome(await call("settle_ai_budget", { p_reservation: reservationId, p_attempts: attempts })),
    release: async (reservationId) => {
      await call("release_ai_budget", { p_reservation: reservationId });
      return true;
    },
  };
}
