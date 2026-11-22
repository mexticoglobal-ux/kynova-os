// The budget store the AI path uses (ADR-0036): the database's budget functions (lib/db/ai-budget.ts), reached with the SERVER client of the Backend Core, never the user's.
//
// Why the server: reserving, settling and releasing record or free consumption, so the database lets ONLY the service key run them (a signed-in user could declare zero cost or free a
// reservation while its call is in flight). The service client is the one that already exists for this (`SupabaseClients.serviceClient()` in lib/db/core-clients.ts): the key is read only
// through the Secrets Manager at the moment it is needed, never in the browser. In this database that key cannot read or write a table: it can run exactly the functions the migration grants it.
//
// It never throws. When the server client cannot be had (Supabase not configured, no service key) or a call fails, the answer is "could not tell" (null, or false for a release), so no provider is
// called and a reservation is never released on a guess.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BudgetStore } from "@/lib/contracts/ai-budget";
import { loadConfig, type EnvSource } from "@/lib/backend/env";
import { EnvSecretsProvider, SecretsManager } from "@/lib/backend/secrets";
import { createAiBudgetStore } from "@/lib/db/ai-budget";
import { SupabaseClients } from "@/lib/db/core-clients";

/** `clientFor` is for tests: it replaces the way the server client is obtained. */
export function createAiBudgetServerStore(vars: EnvSource, clientFor?: () => Promise<SupabaseClient>): BudgetStore {
  let inner: Promise<BudgetStore> | undefined;
  const store = (): Promise<BudgetStore> => {
    inner ??= (clientFor ?? (() => new SupabaseClients(loadConfig(vars), new SecretsManager(new EnvSecretsProvider(vars))).serviceClient()))().then(createAiBudgetStore);
    return inner;
  };
  return {
    reserve: async (input) => { try { return await (await store()).reserve(input); } catch { return null; } },
    settle: async (reservationId, attempts) => { try { return await (await store()).settle(reservationId, attempts); } catch { return null; } },
    release: async (reservationId) => { try { return await (await store()).release(reservationId); } catch { return false; } },
  };
}
