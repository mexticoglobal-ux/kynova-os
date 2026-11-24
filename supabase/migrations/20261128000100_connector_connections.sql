-- Real connector connections (ADR-0038), first one: a YouTube channel, read only. Two tables and the functions that write them. NOBODY reads or writes a table directly: not a signed-in user, not the server key.
-- Everything goes through functions, and the ones that RECORD an identity or a credential are SERVER-ONLY (service_role), because a signed-in user could otherwise declare any channel as connected.
--   * oauth_states: one row per started authorization. Only the SHA-256 of the `state` is stored (the browser keeps the value), it is bound to the company AND the user that started it, short-lived and single-use.
--   * connector_connections: one row per connection of a company. The provider's refresh token is kept ENCRYPTED by the server (token_ct: AES-GCM envelope bound to the company); the database never sees it in
--     the clear, no session role can read it, and a status function answers without it. Disconnecting (or an expired authorization) WIPES the ciphertext.
--   * A company has ONE live connection per connector, and an external account (a channel) belongs to ONE company at a time (both enforced by partial unique indexes). A disconnected row stays as history.
-- Who may manage: owners and administrators of the company (the same rule as private.is_admin), checked again inside every function for the user the server names.
--
-- NOT APPLIED to any remote project: review first (AGENTS.md 7.11).
--
-- Reversal plan (development only, destroys the connections): drop the functions public.begin_connector_oauth, complete_connector_oauth, get_connector_secret, mark_connector_state, disconnect_connector,
-- connector_connection_status and private.member_is_admin; then drop the tables connector_connections and oauth_states.

create table public.oauth_states (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null,
  connector_id text not null check (connector_id in ('youtube')),
  -- the callback address this authorization was started with: the code exchange must use the very same one
  redirect_uri text not null check (char_length(redirect_uri) between 1 and 500),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index oauth_states_tenant_idx on public.oauth_states (tenant_id, expires_at);

create table public.connector_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  connector_id text not null check (connector_id in ('youtube')),
  status text not null check (status in ('connected', 'expired', 'error', 'disconnected')),
  -- the provider's own identifier and visible name of the account (for YouTube: the channel id and title); not secrets
  account_id text check (account_id is null or account_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  account_label text check (account_label is null or char_length(account_label) between 1 and 200),
  scopes text[] not null default '{}',
  -- the encrypted refresh token (envelope "v1.<iv>.<ciphertext>"); null once disconnected or expired
  token_ct text check (token_ct is null or (token_ct ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' and char_length(token_ct) <= 4000)),
  connected_by uuid,
  connected_at timestamptz,
  last_verified_at timestamptz,
  last_error_code text check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,60}$'),
  disconnected_at timestamptz,
  disconnected_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'connected' or (token_ct is not null and account_id is not null)),
  check (status in ('connected', 'error') or token_ct is null)
);
-- one live connection per company and connector, and one company per external account
create unique index connector_connections_one_live on public.connector_connections (tenant_id, connector_id) where status <> 'disconnected';
create unique index connector_connections_account_live on public.connector_connections (connector_id, account_id) where status <> 'disconnected' and account_id is not null;

create trigger oauth_states_protect_tenant before update on public.oauth_states for each row execute function private.protect_identity();
create trigger connector_connections_protect_tenant before update on public.connector_connections for each row execute function private.protect_identity();
create trigger connector_connections_touch before update on public.connector_connections for each row execute function private.touch_updated_at();
-- the audit trail records who changed what, never the token
create trigger connector_connections_audit after insert or update or delete on public.connector_connections for each row execute function private.audit_row('token_ct');

-- Deny by default: RLS on, no policy and no privilege for any API role. The functions below are the only way in.
alter table public.oauth_states enable row level security;
alter table public.connector_connections enable row level security;
revoke all on table public.oauth_states, public.connector_connections from public, anon, authenticated, service_role;
-- an explicit deny (nobody has a privilege on these tables anyway; the policy only makes the intent visible and keeps every RLS table covered by a policy)
create policy oauth_states_no_direct_access on public.oauth_states for select to authenticated using (false);
create policy connector_connections_no_direct_access on public.connector_connections for select to authenticated using (false);

-- Whether a user holds the owner or admin role in an ACTIVE company: the rule of private.is_admin, for a user the SERVER names (the server key has no session of its own).
create function private.member_is_admin(p_user uuid, p_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = p_tenant and m.user_id = p_user and m.role = any (array['owner', 'admin']) and t.status = 'active'
  );
$$;

-- Starts an authorization: stores the hash of the state, bound to the company and the user, valid for p_ttl_seconds (60 to 900). SERVER ONLY. Expired and used states of the company are removed, and a
-- company cannot have more than 10 pending ones (a flood is refused with 53400).
create function public.begin_connector_oauth(p_tenant uuid, p_user uuid, p_connector text, p_state_hash text, p_redirect_uri text, p_ttl_seconds int default 600)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_connector is null or p_connector <> 'youtube' then raise exception 'unknown connector' using errcode = '22023'; end if;
  if p_state_hash is null or p_state_hash !~ '^[0-9a-f]{64}$' or p_redirect_uri is null or char_length(p_redirect_uri) not between 1 and 500
     or p_ttl_seconds is null or p_ttl_seconds not between 60 and 900 then raise exception 'invalid authorization' using errcode = '22023'; end if;
  if p_user is null or not private.member_is_admin(p_user, p_tenant) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.oauth_states where tenant_id = p_tenant and (expires_at < now() or consumed_at is not null);
  if (select count(*) from public.oauth_states where tenant_id = p_tenant) >= 10 then raise exception 'too many pending authorizations' using errcode = '53400'; end if;
  insert into public.oauth_states (state_hash, tenant_id, user_id, connector_id, redirect_uri, expires_at)
  values (p_state_hash, p_tenant, p_user, p_connector, p_redirect_uri, now() + make_interval(secs => p_ttl_seconds));
end;
$$;

-- Reads a pending authorization for the callback WITHOUT consuming it, so the server can check the redirect address before spending the code (and bind the encryption to the company): {ok, redirectUri, tenantId} or {ok: false, reason}. SERVER ONLY.
-- Same checks as completing (user, connector, expiry, use); it is read-only.
create function public.peek_connector_oauth(p_state_hash text, p_user uuid, p_connector text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare s public.oauth_states;
begin
  select * into s from public.oauth_states where state_hash = p_state_hash;
  if not found or s.consumed_at is not null or s.expires_at < now() or s.connector_id is distinct from p_connector then return jsonb_build_object('ok', false, 'reason', 'state_invalid'); end if;
  if s.user_id is distinct from p_user then return jsonb_build_object('ok', false, 'reason', 'user_mismatch'); end if;
  return jsonb_build_object('ok', true, 'redirectUri', s.redirect_uri, 'tenantId', s.tenant_id);
end;
$$;

-- Completes an authorization with the identity the SERVER verified with the provider and the encrypted token. SERVER ONLY. The state is consumed FIRST and stays consumed whatever happens next
-- (single use, even on failure). The company comes from the state, never from the caller: {ok: true, tenantId, accountId, accountLabel} or {ok: false, reason} with reason in
-- state_invalid (unknown, used or expired), user_mismatch (another user than the one who started it), forbidden (no longer an administrator) or account_taken (that account belongs to another company).
create function public.complete_connector_oauth(p_state_hash text, p_user uuid, p_connector text, p_account_id text, p_account_label text, p_scopes text[], p_token_ct text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.oauth_states;
  v_live public.connector_connections;
begin
  if p_account_id is null or p_account_id !~ '^[A-Za-z0-9_-]{1,100}$' or p_account_label is null or char_length(btrim(p_account_label)) not between 1 and 200
     or p_scopes is null or cardinality(p_scopes) = 0 or p_token_ct is null or p_token_ct !~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$' or char_length(p_token_ct) > 4000 then
    raise exception 'invalid connection' using errcode = '22023';
  end if;

  select * into s from public.oauth_states where state_hash = p_state_hash for update;
  if not found or s.consumed_at is not null or s.expires_at < now() or s.connector_id is distinct from p_connector then
    return jsonb_build_object('ok', false, 'reason', 'state_invalid');
  end if;
  update public.oauth_states set consumed_at = now() where state_hash = p_state_hash;
  if s.user_id is distinct from p_user then return jsonb_build_object('ok', false, 'reason', 'user_mismatch'); end if;
  if not private.member_is_admin(p_user, s.tenant_id) then return jsonb_build_object('ok', false, 'reason', 'forbidden'); end if;

  begin
    select * into v_live from public.connector_connections where tenant_id = s.tenant_id and connector_id = s.connector_id and status <> 'disconnected' for update;
    if found then
      update public.connector_connections
         set status = 'connected', account_id = p_account_id, account_label = btrim(p_account_label), scopes = p_scopes, token_ct = p_token_ct, connected_by = p_user,
             connected_at = now(), last_verified_at = now(), last_error_code = null, disconnected_at = null, disconnected_by = null
       where id = v_live.id;
    else
      insert into public.connector_connections (tenant_id, connector_id, status, account_id, account_label, scopes, token_ct, connected_by, connected_at, last_verified_at)
      values (s.tenant_id, s.connector_id, 'connected', p_account_id, btrim(p_account_label), p_scopes, p_token_ct, p_user, now(), now());
    end if;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'account_taken');
  end;
  return jsonb_build_object('ok', true, 'tenantId', s.tenant_id, 'accountId', p_account_id, 'accountLabel', btrim(p_account_label));
end;
$$;

-- The encrypted token of the live connection, for the server to refresh or revoke it: {status, accountId, tokenCt} or null when there is none. SERVER ONLY.
create function public.get_connector_secret(p_tenant uuid, p_connector text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('status', c.status, 'accountId', c.account_id, 'tokenCt', c.token_ct)
    from public.connector_connections c
   where c.tenant_id = p_tenant and c.connector_id = p_connector and c.status in ('connected', 'error') and c.token_ct is not null;
$$;

-- Records what the server learned from the provider about the live connection: 'connected' (verified again, optional new visible name), 'expired' (the authorization no longer works: the
-- ciphertext is WIPED) or 'error' (a failure that may be temporary: the token is kept). Returns whether a live connection was updated. SERVER ONLY.
create function public.mark_connector_state(p_tenant uuid, p_connector text, p_status text, p_error_code text default null, p_account_label text default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_rows int;
begin
  if p_status is null or p_status not in ('connected', 'expired', 'error') then raise exception 'invalid status' using errcode = '22023'; end if;
  update public.connector_connections
     set status = case when p_status = 'connected' and token_ct is null then status else p_status end,
         token_ct = case when p_status = 'expired' then null else token_ct end,
         last_verified_at = case when p_status = 'connected' then now() else last_verified_at end,
         last_error_code = case when p_status = 'connected' then null else p_error_code end,
         account_label = coalesce(nullif(btrim(p_account_label), ''), account_label)
   where tenant_id = p_tenant and connector_id = p_connector and status <> 'disconnected';
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

-- Disconnects: the ciphertext is WIPED in the same statement, so the credential cannot be used again whatever happens next. Only an owner or administrator (the user the server names).
-- {ok: true, accountId} or {ok: false, reason: 'not_connected'}. SERVER ONLY.
create function public.disconnect_connector(p_tenant uuid, p_user uuid, p_connector text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.connector_connections;
begin
  if p_user is null or not private.member_is_admin(p_user, p_tenant) then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.connector_connections
     set status = 'disconnected', token_ct = null, disconnected_at = now(), disconnected_by = p_user
   where tenant_id = p_tenant and connector_id = p_connector and status <> 'disconnected'
  returning * into v_row;
  if not found then return jsonb_build_object('ok', false, 'reason', 'not_connected'); end if;
  return jsonb_build_object('ok', true, 'accountId', v_row.account_id);
end;
$$;

-- What the screen shows, for owners and administrators of the company (a signed-in user, checked by role): {state: 'disconnected'} or {state, accountId, accountLabel, connectedAt, lastVerifiedAt,
-- lastErrorCode}. It never carries the token.
create function public.connector_connection_status(p_tenant uuid, p_connector text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare c public.connector_connections;
begin
  if not (select private.is_admin(p_tenant)) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into c from public.connector_connections where tenant_id = p_tenant and connector_id = p_connector and status <> 'disconnected';
  if not found then return jsonb_build_object('state', 'disconnected'); end if;
  return jsonb_build_object('state', c.status, 'accountId', c.account_id, 'accountLabel', c.account_label, 'connectedAt', c.connected_at, 'lastVerifiedAt', c.last_verified_at, 'lastErrorCode', c.last_error_code);
end;
$$;

revoke execute on function
  private.member_is_admin(uuid, uuid),
  public.begin_connector_oauth(uuid, uuid, text, text, text, int), public.peek_connector_oauth(text, uuid, text), public.complete_connector_oauth(text, uuid, text, text, text, text[], text),
  public.get_connector_secret(uuid, text), public.mark_connector_state(uuid, text, text, text, text), public.disconnect_connector(uuid, uuid, text), public.connector_connection_status(uuid, text)
  from public, anon, authenticated, service_role;

-- Only the server key records or reads a credential; a signed-in user only reads the status of its own company (and the function checks the role).
grant execute on function
  public.begin_connector_oauth(uuid, uuid, text, text, text, int), public.peek_connector_oauth(text, uuid, text), public.complete_connector_oauth(text, uuid, text, text, text, text[], text),
  public.get_connector_secret(uuid, text), public.mark_connector_state(uuid, text, text, text, text), public.disconnect_connector(uuid, uuid, text)
  to service_role;
grant execute on function public.connector_connection_status(uuid, text) to authenticated;
