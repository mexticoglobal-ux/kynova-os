import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConnectionStore } from "@/lib/integrations/youtube/connection";
import { YOUTUBE_CONNECTOR_ID } from "@/lib/contracts/youtube-connection";
import { BackendError, errorOf } from "./backend";

// The connector connections in the database (ADR-0038, migration 20261128000100_connector_connections.sql): the only access to them. The database decides everything (who may manage, that a state is bound
// to its company and user and used once, that a channel belongs to one company); this file only calls its functions and checks the shape of each answer.
//
// THE TRUST BOUNDARY: recording an identity or a credential is SERVER ONLY. These functions run with the SERVER client (the service key, which cannot read or write a table): a signed-in user cannot call
// them, so nobody can declare a channel as connected or read a credential. The token that reaches `complete` is already ciphertext.
export function createConnectorStore(client: SupabaseClient): ConnectionStore {
  const call = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw errorOf(error);
    return data;
  };
  const object = (value: unknown): Record<string, unknown> => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new BackendError("unavailable");
    return value as Record<string, unknown>;
  };
  const text = (value: unknown): string => {
    if (typeof value !== "string" || value.length === 0) throw new BackendError("unavailable");
    return value;
  };
  return {
    begin: async (input) => {
      await call("begin_connector_oauth", { p_tenant: input.tenantId, p_user: input.userId, p_connector: YOUTUBE_CONNECTOR_ID, p_state_hash: input.stateHash, p_redirect_uri: input.redirectUri });
    },
    peek: async (stateHash, userId) => {
      const row = object(await call("peek_connector_oauth", { p_state_hash: stateHash, p_user: userId, p_connector: YOUTUBE_CONNECTOR_ID }));
      if (row.ok === true) return { ok: true, redirectUri: text(row.redirectUri), tenantId: text(row.tenantId) };
      return { ok: false, reason: row.reason === "user_mismatch" ? "user_mismatch" : "state_invalid" };
    },
    complete: async (input) => {
      const row = object(await call("complete_connector_oauth", {
        p_state_hash: input.stateHash, p_user: input.userId, p_connector: YOUTUBE_CONNECTOR_ID, p_account_id: input.accountId, p_account_label: input.accountLabel, p_scopes: [...input.scopes], p_token_ct: input.tokenCt,
      }));
      if (row.ok === true) return { ok: true, tenantId: text(row.tenantId), accountId: text(row.accountId), accountLabel: text(row.accountLabel) };
      const reason = row.reason;
      return { ok: false, reason: reason === "user_mismatch" || reason === "forbidden" || reason === "account_taken" ? reason : "state_invalid" };
    },
    secret: async (tenantId) => {
      const data = await call("get_connector_secret", { p_tenant: tenantId, p_connector: YOUTUBE_CONNECTOR_ID });
      if (data === null || data === undefined) return null;
      const row = object(data);
      return { accountId: text(row.accountId), tokenCt: text(row.tokenCt) };
    },
    mark: async (tenantId, status, errorCode, accountLabel) => (await call("mark_connector_state", { p_tenant: tenantId, p_connector: YOUTUBE_CONNECTOR_ID, p_status: status, p_error_code: errorCode ?? null, p_account_label: accountLabel ?? null })) === true,
    disconnect: async (tenantId, userId) => {
      const row = object(await call("disconnect_connector", { p_tenant: tenantId, p_user: userId, p_connector: YOUTUBE_CONNECTOR_ID }));
      if (row.ok === true) return { ok: true, accountId: typeof row.accountId === "string" ? row.accountId : null };
      return { ok: false, reason: "not_connected" };
    },
  };
}

/** The store over a client that is obtained only when the first call needs it (the server client is created lazily and never in the browser). */
export function createLazyConnectorStore(clientFor: () => Promise<SupabaseClient>): ConnectionStore {
  let inner: Promise<ConnectionStore> | undefined;
  const store = (): Promise<ConnectionStore> => (inner ??= clientFor().then(createConnectorStore));
  return {
    begin: async (input) => (await store()).begin(input),
    peek: async (stateHash, userId) => (await store()).peek(stateHash, userId),
    complete: async (input) => (await store()).complete(input),
    secret: async (tenantId) => (await store()).secret(tenantId),
    mark: async (tenantId, status, errorCode, accountLabel) => (await store()).mark(tenantId, status, errorCode, accountLabel),
    disconnect: async (tenantId, userId) => (await store()).disconnect(tenantId, userId),
  };
}
