-- Connector connection tests (ADR-0038): nobody reads or writes the tables, the credential is kept as ciphertext and wiped on disconnect or expiry, an authorization is bound to the company AND the user
-- that started it and is single use (even when it fails), only owners and administrators manage, a channel belongs to one company at a time, and the audit trail never carries the token.
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/tests/connectors.sql   (after 00_bootstrap.sql and every migration). Fictitious data only (the "token" is a made-up envelope, never a real credential).
-- A failed expectation raises an exception and stops the run (non-zero exit).
--
-- Actors: O owns T1; A is an administrator of T1; M is a plain member of T1; V is a viewer of T1; X owns T2 and has nothing in T1. The "server" is the service_role.

create function pg_temp.as_user(uid uuid, mail text)
returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', uid, 'email', mail)::text, true);
end $$;

create function pg_temp.state_of(stmt text)
returns text language plpgsql as $$
begin
  execute stmt;
  return '00000';
exception when others then
  return sqlstate;
end $$;

create function pg_temp.expect(cond boolean, msg text)
returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', msg; end if;
end $$;

-- the SHA-256 hex of a made-up state value, as the server computes it
create function pg_temp.h(v text) returns text language sql as $$ select encode(sha256(convert_to(v, 'UTF8')), 'hex') $$;

insert into auth.users (id, email) values
  ('51000000-0000-4000-8000-000000000001', 'con-o@example.test'),
  ('51000000-0000-4000-8000-000000000002', 'con-a@example.test'),
  ('51000000-0000-4000-8000-000000000003', 'con-m@example.test'),
  ('51000000-0000-4000-8000-000000000004', 'con-v@example.test'),
  ('51000000-0000-4000-8000-000000000005', 'con-x@example.test');
insert into public.tenants (id, name) values
  ('51000000-0000-4000-8000-0000000000b1', 'Empresa Uno'), ('51000000-0000-4000-8000-0000000000b2', 'Empresa Dos');
insert into public.memberships (user_id, tenant_id, role) values
  ('51000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-0000000000b1', 'owner'),
  ('51000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-0000000000b1', 'admin'),
  ('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-0000000000b1', 'member'),
  ('51000000-0000-4000-8000-000000000004', '51000000-0000-4000-8000-0000000000b1', 'viewer'),
  ('51000000-0000-4000-8000-000000000005', '51000000-0000-4000-8000-0000000000b2', 'owner');

-- ---------------------------------------------------------------------------
-- Static checks: deny by default, who can run what
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['oauth_states', 'connector_connections'] loop
    if not (select relrowsecurity from pg_class where oid = ('public.' || t)::regclass) then raise exception 'FAIL: RLS is off on %', t; end if;
    if has_table_privilege('anon', 'public.' || t, 'select') or has_table_privilege('authenticated', 'public.' || t, 'select') or has_table_privilege('service_role', 'public.' || t, 'select')
       or has_table_privilege('authenticated', 'public.' || t, 'insert') or has_table_privilege('authenticated', 'public.' || t, 'update') or has_table_privilege('authenticated', 'public.' || t, 'delete')
       or has_table_privilege('service_role', 'public.' || t, 'insert') or has_table_privilege('service_role', 'public.' || t, 'update') then raise exception 'FAIL: a role reaches the table %', t; end if;
  end loop;
  foreach t in array array['public.begin_connector_oauth(uuid, uuid, text, text, text, int)', 'public.peek_connector_oauth(text, uuid, text)', 'public.complete_connector_oauth(text, uuid, text, text, text, text[], text)',
                           'public.get_connector_secret(uuid, text)', 'public.mark_connector_state(uuid, text, text, text, text)', 'public.disconnect_connector(uuid, uuid, text)'] loop
    if not has_function_privilege('service_role', t, 'execute') then raise exception 'FAIL: the server key cannot run %', t; end if;
    if has_function_privilege('authenticated', t, 'execute') or has_function_privilege('anon', t, 'execute') then raise exception 'FAIL: % is open to a signed-in user or anon', t; end if;
  end loop;
  if not has_function_privilege('authenticated', 'public.connector_connection_status(uuid, text)', 'execute') or has_function_privilege('anon', 'public.connector_connection_status(uuid, text)', 'execute')
     or has_function_privilege('service_role', 'public.connector_connection_status(uuid, text)', 'execute') then raise exception 'FAIL: the status function is not for signed-in users only'; end if;
  if has_function_privilege('authenticated', 'private.member_is_admin(uuid, uuid)', 'execute') or has_function_privilege('service_role', 'private.member_is_admin(uuid, uuid)', 'execute') then raise exception 'FAIL: a private function is exposed'; end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and p.proname in ('begin_connector_oauth', 'peek_connector_oauth', 'complete_connector_oauth', 'get_connector_secret', 'mark_connector_state', 'disconnect_connector', 'connector_connection_status')
     and (not p.prosecdef or p.proconfig is null or not ('search_path=""' = any (p.proconfig)))) then raise exception 'FAIL: a connector function is not security definer with an empty search_path'; end if;
  perform pg_temp.expect(private.member_is_admin('51000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-0000000000b1')
    and private.member_is_admin('51000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-0000000000b1')
    and not private.member_is_admin('51000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-0000000000b1')
    and not private.member_is_admin('51000000-0000-4000-8000-000000000004', '51000000-0000-4000-8000-0000000000b1')
    and not private.member_is_admin('51000000-0000-4000-8000-000000000005', '51000000-0000-4000-8000-0000000000b1'), 'who counts as an administrator');
end $$;

-- ---------------------------------------------------------------------------
-- Starting an authorization: only administrators; bound to the company and the user; flood limited
-- ---------------------------------------------------------------------------
do $$
declare
  t1 constant uuid := '51000000-0000-4000-8000-0000000000b1';
  uo constant uuid := '51000000-0000-4000-8000-000000000001'; ua constant uuid := '51000000-0000-4000-8000-000000000002';
  um constant uuid := '51000000-0000-4000-8000-000000000003'; ux constant uuid := '51000000-0000-4000-8000-000000000005';
  n int;
begin
  set local role service_role;
  perform public.begin_connector_oauth(t1, uo, 'youtube', pg_temp.h('s-owner'), 'https://app.example.test/api/v1/connections/youtube/callback');
  perform public.begin_connector_oauth(t1, ua, 'youtube', pg_temp.h('s-admin'), 'https://app.example.test/api/v1/connections/youtube/callback', 120);
  if pg_temp.state_of(format($q$select public.begin_connector_oauth('%s', '%s', 'youtube', '%s', 'https://app.example.test/cb')$q$, t1, um, pg_temp.h('s-member'))) <> '42501' then raise exception 'FAIL: a member started a connection'; end if;
  if pg_temp.state_of(format($q$select public.begin_connector_oauth('%s', '%s', 'youtube', '%s', 'https://app.example.test/cb')$q$, t1, ux, pg_temp.h('s-x-in-t1'))) <> '42501' then raise exception 'FAIL: a user of another company started a connection'; end if;
  if pg_temp.state_of(format($q$select public.begin_connector_oauth('%s', null, 'youtube', '%s', 'https://app.example.test/cb')$q$, t1, pg_temp.h('s-null'))) <> '42501' then raise exception 'FAIL: no user was accepted'; end if;
  if pg_temp.state_of(format($q$select public.begin_connector_oauth('%s', '%s', 'tiktok', '%s', 'https://app.example.test/cb')$q$, t1, uo, pg_temp.h('s-tt'))) <> '22023' then raise exception 'FAIL: an unknown connector was accepted'; end if;
  if pg_temp.state_of(format($q$select public.begin_connector_oauth('%s', '%s', 'youtube', 'not-a-hash', 'https://app.example.test/cb')$q$, t1, uo)) <> '22023' then raise exception 'FAIL: a state that is not a hash was accepted'; end if;
  if pg_temp.state_of(format($q$select public.begin_connector_oauth('%s', '%s', 'youtube', '%s', 'https://app.example.test/cb', 5000)$q$, t1, uo, pg_temp.h('s-ttl'))) <> '22023' then raise exception 'FAIL: a long lifetime was accepted'; end if;
  if pg_temp.state_of(format($q$select public.begin_connector_oauth('%s', '%s', 'youtube', '%s', 'https://app.example.test/cb')$q$, t1, uo, pg_temp.h('s-owner'))) <> '23505' then raise exception 'FAIL: a state was stored twice'; end if;
  reset role;
  perform pg_temp.expect((select count(*) from public.oauth_states where tenant_id = t1) = 2, 'only the two valid states exist');
  -- the plain state never reaches the table: only its hash
  perform pg_temp.expect(not exists (select 1 from public.oauth_states where state_hash in ('s-owner', 's-admin')), 'a plain state was stored');

  -- a flood is refused
  set local role service_role;
  for n in 1..8 loop perform public.begin_connector_oauth(t1, uo, 'youtube', pg_temp.h('flood-' || n), 'https://app.example.test/cb'); end loop;
  if pg_temp.state_of(format($q$select public.begin_connector_oauth('%s', '%s', 'youtube', '%s', 'https://app.example.test/cb')$q$, t1, uo, pg_temp.h('flood-9'))) <> '53400' then raise exception 'FAIL: more than 10 pending authorizations were accepted'; end if;
  reset role;
  delete from public.oauth_states where tenant_id = t1 and state_hash <> pg_temp.h('s-owner') and state_hash <> pg_temp.h('s-admin');
end $$;

-- ---------------------------------------------------------------------------
-- Completing: bound to the user, single use even on failure, expiry, role checked again, one company per channel
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb; c record;
  t1 constant uuid := '51000000-0000-4000-8000-0000000000b1'; t2 constant uuid := '51000000-0000-4000-8000-0000000000b2';
  uo constant uuid := '51000000-0000-4000-8000-000000000001'; ua constant uuid := '51000000-0000-4000-8000-000000000002'; ux constant uuid := '51000000-0000-4000-8000-000000000005';
  tok constant text := 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
begin
  set local role service_role;
  -- the callback can look at a state without spending it, and only for the user who started it
  r := public.peek_connector_oauth(pg_temp.h('s-owner'), uo, 'youtube');
  perform pg_temp.expect((r ->> 'ok') = 'true' and r ->> 'redirectUri' = 'https://app.example.test/api/v1/connections/youtube/callback' and (r ->> 'tenantId')::uuid = '51000000-0000-4000-8000-0000000000b1', 'peek of the right user: ' || r::text);
  r := public.peek_connector_oauth(pg_temp.h('s-owner'), ux, 'youtube');
  perform pg_temp.expect(r ->> 'reason' = 'user_mismatch', 'peek of another user: ' || r::text);
  r := public.peek_connector_oauth(pg_temp.h('nope'), uo, 'youtube');
  perform pg_temp.expect(r ->> 'reason' = 'state_invalid', 'peek of an unknown state: ' || r::text);

  -- ANOTHER user tries to finish the owner's authorization: refused, and the state is burned (the owner must start again)
  r := public.complete_connector_oauth(pg_temp.h('s-owner'), ux, 'youtube', 'UCfakechannel0000000001', 'Canal ajeno', array['youtube.readonly'], tok);
  perform pg_temp.expect(r ->> 'reason' = 'user_mismatch', 'another user completed the authorization: ' || r::text);
  r := public.complete_connector_oauth(pg_temp.h('s-owner'), uo, 'youtube', 'UCchannelAAAAAAAAAAAAA01', 'Canal de Uno', array['youtube.readonly'], tok);
  perform pg_temp.expect(r ->> 'reason' = 'state_invalid', 'a burned state was reused: ' || r::text);
  reset role;
  perform pg_temp.expect(not exists (select 1 from public.connector_connections where tenant_id = t1), 'a refused completion left a connection');

  -- unknown and malformed input
  set local role service_role;
  perform pg_temp.expect(public.complete_connector_oauth(pg_temp.h('never-started'), uo, 'youtube', 'UCchannelAAAAAAAAAAAAA01', 'Canal', array['youtube.readonly'], tok) ->> 'reason' = 'state_invalid', 'an unknown state');
  if pg_temp.state_of(format($q$select public.complete_connector_oauth('%s', '%s', 'youtube', 'bad id!', 'Canal', array['youtube.readonly'], '%s')$q$, pg_temp.h('s-admin'), ua, tok)) <> '22023' then raise exception 'FAIL: an invalid account id was accepted'; end if;
  if pg_temp.state_of(format($q$select public.complete_connector_oauth('%s', '%s', 'youtube', 'UCchannelAAAAAAAAAAAAA01', 'Canal', array['youtube.readonly'], 'plain-token-in-the-clear')$q$, pg_temp.h('s-admin'), ua)) <> '22023' then raise exception 'FAIL: a token that is not an envelope was accepted'; end if;
  reset role;

  -- the administrator finishes theirs: connected, with the figures the server gave, the token only as ciphertext
  set local role service_role;
  r := public.complete_connector_oauth(pg_temp.h('s-admin'), ua, 'youtube', 'UCchannelAAAAAAAAAAAAA01', '  Canal de Uno  ', array['https://www.googleapis.com/auth/youtube.readonly'], tok);
  reset role;
  perform pg_temp.expect((r ->> 'ok') = 'true' and (r ->> 'tenantId')::uuid = t1 and r ->> 'accountId' = 'UCchannelAAAAAAAAAAAAA01' and r ->> 'accountLabel' = 'Canal de Uno', 'the completion: ' || r::text);
  select * into c from public.connector_connections where tenant_id = t1;
  perform pg_temp.expect(c.status = 'connected' and c.account_id = 'UCchannelAAAAAAAAAAAAA01' and c.account_label = 'Canal de Uno' and c.connected_by = ua and c.token_ct = tok and c.last_verified_at is not null, 'the stored connection is wrong');
  perform pg_temp.expect((select count(*) from public.oauth_states where consumed_at is not null) >= 2, 'the used states are not marked');
  -- the same state again
  set local role service_role;
  perform pg_temp.expect(public.complete_connector_oauth(pg_temp.h('s-admin'), ua, 'youtube', 'UCchannelAAAAAAAAAAAAA01', 'Canal de Uno', array['x'], tok) ->> 'reason' = 'state_invalid', 'a used state was accepted again');
  reset role;
end $$;

do $$
declare
  r jsonb; c record;
  t1 constant uuid := '51000000-0000-4000-8000-0000000000b1'; t2 constant uuid := '51000000-0000-4000-8000-0000000000b2';
  uo constant uuid := '51000000-0000-4000-8000-000000000001'; ua constant uuid := '51000000-0000-4000-8000-000000000002'; ux constant uuid := '51000000-0000-4000-8000-000000000005';
  tok constant text := 'v1.AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'; tok2 constant text := 'v1.CCCCCCCCCCCCCCCC.DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD';
begin
  -- an EXPIRED state
  set local role service_role;
  perform public.begin_connector_oauth(t1, uo, 'youtube', pg_temp.h('s-expired'), 'https://app.example.test/cb');
  reset role;
  update public.oauth_states set expires_at = now() - interval '1 minute' where state_hash = pg_temp.h('s-expired');
  set local role service_role;
  perform pg_temp.expect(public.peek_connector_oauth(pg_temp.h('s-expired'), uo, 'youtube') ->> 'reason' = 'state_invalid', 'an expired state was peeked');
  perform pg_temp.expect(public.complete_connector_oauth(pg_temp.h('s-expired'), uo, 'youtube', 'UCchannelAAAAAAAAAAAAA01', 'Canal', array['x'], tok) ->> 'reason' = 'state_invalid', 'an expired state was accepted');
  reset role;

  -- the administrator was demoted between the start and the callback: the role is checked AGAIN
  set local role service_role;
  perform public.begin_connector_oauth(t1, ua, 'youtube', pg_temp.h('s-demoted'), 'https://app.example.test/cb');
  reset role;
  update public.memberships set role = 'member' where user_id = ua and tenant_id = t1;
  set local role service_role;
  r := public.complete_connector_oauth(pg_temp.h('s-demoted'), ua, 'youtube', 'UCchannelBBBBBBBBBBBBB02', 'Otro canal', array['x'], tok2);
  reset role;
  update public.memberships set role = 'admin' where user_id = ua and tenant_id = t1;
  perform pg_temp.expect(r ->> 'reason' = 'forbidden', 'a demoted user completed the authorization: ' || r::text);
  perform pg_temp.expect((select account_id from public.connector_connections where tenant_id = t1 and status <> 'disconnected') = 'UCchannelAAAAAAAAAAAAA01', 'a refused completion changed the connection');

  -- ANOTHER company cannot take a channel that a company has connected (and its state is burned)
  set local role service_role;
  perform public.begin_connector_oauth(t2, ux, 'youtube', pg_temp.h('s-x'), 'https://app.example.test/cb');
  r := public.complete_connector_oauth(pg_temp.h('s-x'), ux, 'youtube', 'UCchannelAAAAAAAAAAAAA01', 'Canal de Uno', array['x'], tok2);
  reset role;
  perform pg_temp.expect(r ->> 'reason' = 'account_taken', 'a channel was linked to two companies: ' || r::text);
  perform pg_temp.expect(not exists (select 1 from public.connector_connections where tenant_id = t2) and (select consumed_at is not null from public.oauth_states where state_hash = pg_temp.h('s-x')), 'the refused company left a connection or an open state');

  -- reconnecting the same company to ANOTHER channel replaces the live connection (one live row), keeping a single live connection
  set local role service_role;
  perform public.begin_connector_oauth(t1, uo, 'youtube', pg_temp.h('s-reconnect'), 'https://app.example.test/cb');
  r := public.complete_connector_oauth(pg_temp.h('s-reconnect'), uo, 'youtube', 'UCchannelCCCCCCCCCCCCC03', 'Canal nuevo', array['x'], tok2);
  reset role;
  perform pg_temp.expect((r ->> 'ok') = 'true' and (select count(*) from public.connector_connections where tenant_id = t1 and status <> 'disconnected') = 1
    and (select account_id from public.connector_connections where tenant_id = t1 and status <> 'disconnected') = 'UCchannelCCCCCCCCCCCCC03', 'reconnecting did not keep a single live connection');

  -- the backstops of the schema itself (as the owner of the script): two live connections of a company, or one channel in two companies
  if pg_temp.state_of(format($q$insert into public.connector_connections (tenant_id, connector_id, status, account_id, account_label, scopes, token_ct) values ('%s', 'youtube', 'connected', 'UCotherchannelXXXXXXXX1', 'x', '{x}', '%s')$q$, t1, tok)) <> '23505' then raise exception 'FAIL: a company got two live connections'; end if;
  if pg_temp.state_of(format($q$insert into public.connector_connections (tenant_id, connector_id, status, account_id, account_label, scopes, token_ct) values ('%s', 'youtube', 'connected', 'UCchannelCCCCCCCCCCCCC03', 'x', '{x}', '%s')$q$, t2, tok)) <> '23505' then raise exception 'FAIL: a channel was linked to two companies by the schema'; end if;
  if pg_temp.state_of(format($q$insert into public.connector_connections (tenant_id, connector_id, status, scopes) values ('%s', 'youtube', 'connected', '{x}')$q$, t2)) <> '23514' then raise exception 'FAIL: a connected row without account and token was accepted'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- What each role can see, and that the token is unreachable
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb;
  t1 constant uuid := '51000000-0000-4000-8000-0000000000b1'; t2 constant uuid := '51000000-0000-4000-8000-0000000000b2';
begin
  -- owner and admin read the status, without any token
  perform pg_temp.as_user('51000000-0000-4000-8000-000000000001', 'con-o@example.test');
  r := public.connector_connection_status(t1, 'youtube');
  perform pg_temp.expect(r ->> 'state' = 'connected' and r ->> 'accountId' = 'UCchannelCCCCCCCCCCCCC03' and r ->> 'accountLabel' = 'Canal nuevo' and not (r ? 'tokenCt') and r::text !~ 'v1\.', 'the owner status: ' || r::text);
  if pg_temp.state_of(format($q$select count(*) from public.connector_connections where tenant_id = '%s'$q$, t1)) <> '42501' then raise exception 'FAIL: a signed-in user read the table'; end if;
  if pg_temp.state_of(format($q$select public.get_connector_secret('%s', 'youtube')$q$, t1)) <> '42501' then raise exception 'FAIL: a signed-in user read the credential'; end if;
  if pg_temp.state_of(format($q$select public.disconnect_connector('%s', '51000000-0000-4000-8000-000000000001', 'youtube')$q$, t1)) <> '42501' then raise exception 'FAIL: a signed-in user disconnected without the server'; end if;
  reset role;
  perform pg_temp.as_user('51000000-0000-4000-8000-000000000002', 'con-a@example.test');
  perform pg_temp.expect(public.connector_connection_status(t1, 'youtube') ->> 'state' = 'connected', 'the admin status');
  reset role;
  -- a member, a viewer and another company's owner cannot even ask
  perform pg_temp.as_user('51000000-0000-4000-8000-000000000003', 'con-m@example.test');
  if pg_temp.state_of(format($q$select public.connector_connection_status('%s', 'youtube')$q$, t1)) <> '42501' then raise exception 'FAIL: a member read the status'; end if;
  reset role;
  perform pg_temp.as_user('51000000-0000-4000-8000-000000000004', 'con-v@example.test');
  if pg_temp.state_of(format($q$select public.connector_connection_status('%s', 'youtube')$q$, t1)) <> '42501' then raise exception 'FAIL: a viewer read the status'; end if;
  reset role;
  perform pg_temp.as_user('51000000-0000-4000-8000-000000000005', 'con-x@example.test');
  if pg_temp.state_of(format($q$select public.connector_connection_status('%s', 'youtube')$q$, t1)) <> '42501' then raise exception 'FAIL: another company read the status'; end if;
  perform pg_temp.expect(public.connector_connection_status(t2, 'youtube') ->> 'state' = 'disconnected', 'the other company has no connection');
  reset role;
  -- the server key cannot read a table either
  set local role service_role;
  if pg_temp.state_of($q$select count(*) from public.connector_connections$q$) <> '42501' then raise exception 'FAIL: the server key read the table'; end if;
  if pg_temp.state_of($q$update public.connector_connections set status = 'connected'$q$) <> '42501' then raise exception 'FAIL: the server key wrote the table'; end if;
  reset role;
  set local role anon;
  if pg_temp.state_of(format($q$select public.connector_connection_status('%s', 'youtube')$q$, t1)) <> '42501' then raise exception 'FAIL: anon ran the status function'; end if;
  reset role;
end $$;

-- ---------------------------------------------------------------------------
-- An expired authorization wipes the credential; a temporary error keeps it; disconnecting wipes it for good
-- ---------------------------------------------------------------------------
do $$
declare
  r jsonb; s jsonb;
  t1 constant uuid := '51000000-0000-4000-8000-0000000000b1'; t2 constant uuid := '51000000-0000-4000-8000-0000000000b2';
  uo constant uuid := '51000000-0000-4000-8000-000000000001'; um constant uuid := '51000000-0000-4000-8000-000000000003'; ux constant uuid := '51000000-0000-4000-8000-000000000005';
  tok2 constant text := 'v1.CCCCCCCCCCCCCCCC.DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD'; tok3 constant text := 'v1.EEEEEEEEEEEEEEEE.FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF';
begin
  set local role service_role;
  s := public.get_connector_secret(t1, 'youtube');
  perform pg_temp.expect(s ->> 'tokenCt' = tok2 and s ->> 'status' = 'connected', 'the server reads the credential: ' || coalesce(s::text, 'null'));
  -- a temporary error keeps the token; a verification clears the error
  perform pg_temp.expect(public.mark_connector_state(t1, 'youtube', 'error', 'provider_unavailable') is true, 'mark error');
  perform pg_temp.expect(public.get_connector_secret(t1, 'youtube') ->> 'tokenCt' = tok2, 'a temporary error wiped the token');
  perform pg_temp.expect(public.mark_connector_state(t1, 'youtube', 'connected', null, 'Canal nuevo (renombrado)') is true, 'mark connected');
  reset role;
  perform pg_temp.expect((select account_label from public.connector_connections where tenant_id = t1 and status <> 'disconnected') = 'Canal nuevo (renombrado)' and (select last_error_code from public.connector_connections where tenant_id = t1 and status <> 'disconnected') is null, 'verification did not refresh the connection');
  if pg_temp.state_of(format($q$select public.mark_connector_state('%s', 'youtube', 'disconnected')$q$, t1)) <> '22023' then raise exception 'FAIL: mark_connector_state can disconnect'; end if;

  -- the authorization expired at the provider: the ciphertext is WIPED and nothing can use it
  set local role service_role;
  perform public.mark_connector_state(t1, 'youtube', 'expired', 'invalid_grant');
  perform pg_temp.expect(public.get_connector_secret(t1, 'youtube') is null, 'an expired connection still hands out a credential');
  reset role;
  perform pg_temp.expect((select token_ct is null and status = 'expired' and last_error_code = 'invalid_grant' from public.connector_connections where tenant_id = t1 and status <> 'disconnected'), 'the expired row keeps a token');
  perform pg_temp.as_user(uo, 'con-o@example.test');
  perform pg_temp.expect(public.connector_connection_status(t1, 'youtube') ->> 'state' = 'expired' and public.connector_connection_status(t1, 'youtube') ->> 'lastErrorCode' = 'invalid_grant', 'the expired status');
  reset role;

  -- authorizing again recovers the same live row
  set local role service_role;
  perform public.begin_connector_oauth(t1, uo, 'youtube', pg_temp.h('s-again'), 'https://app.example.test/cb');
  r := public.complete_connector_oauth(pg_temp.h('s-again'), uo, 'youtube', 'UCchannelCCCCCCCCCCCCC03', 'Canal nuevo', array['x'], tok3);
  reset role;
  perform pg_temp.expect((r ->> 'ok') = 'true' and (select count(*) from public.connector_connections where tenant_id = t1 and status <> 'disconnected') = 1 and (select status from public.connector_connections where tenant_id = t1 and status <> 'disconnected') = 'connected', 're-authorizing did not recover');

  -- DISCONNECT: a member cannot; an administrator can, and the credential is gone at once
  set local role service_role;
  if pg_temp.state_of(format($q$select public.disconnect_connector('%s', '%s', 'youtube')$q$, t1, um)) <> '42501' then raise exception 'FAIL: a member disconnected'; end if;
  if pg_temp.state_of(format($q$select public.disconnect_connector('%s', '%s', 'youtube')$q$, t1, ux)) <> '42501' then raise exception 'FAIL: another company disconnected'; end if;
  perform pg_temp.expect(public.get_connector_secret(t1, 'youtube') ->> 'tokenCt' = tok3, 'the failed disconnects changed the credential');
  r := public.disconnect_connector(t1, uo, 'youtube');
  perform pg_temp.expect((r ->> 'ok') = 'true' and r ->> 'accountId' = 'UCchannelCCCCCCCCCCCCC03', 'the disconnection: ' || r::text);
  perform pg_temp.expect(public.get_connector_secret(t1, 'youtube') is null, 'a disconnected connection still hands out a credential');
  perform pg_temp.expect(public.disconnect_connector(t1, uo, 'youtube') ->> 'reason' = 'not_connected', 'disconnecting twice');
  reset role;
  perform pg_temp.expect((select count(*) from public.connector_connections where tenant_id = t1 and token_ct is not null) = 0 and (select count(*) from public.connector_connections where tenant_id = t1 and status = 'disconnected') >= 1, 'a token survived the disconnection, or the history is gone');
  perform pg_temp.as_user(uo, 'con-o@example.test');
  perform pg_temp.expect(public.connector_connection_status(t1, 'youtube') ->> 'state' = 'disconnected', 'the disconnected status');
  reset role;

  -- the channel is free again for another company
  set local role service_role;
  perform public.begin_connector_oauth(t2, ux, 'youtube', pg_temp.h('s-x-2'), 'https://app.example.test/cb');
  r := public.complete_connector_oauth(pg_temp.h('s-x-2'), ux, 'youtube', 'UCchannelCCCCCCCCCCCCC03', 'Canal nuevo', array['x'], tok3);
  reset role;
  perform pg_temp.expect((r ->> 'ok') = 'true', 'a freed channel could not be linked by another company: ' || r::text);
end $$;

-- ---------------------------------------------------------------------------
-- The audit trail never carries the token; deleting a company removes its connection records
-- ---------------------------------------------------------------------------
do $$
declare
  t2 constant uuid := '51000000-0000-4000-8000-0000000000b2';
  ux constant uuid := '51000000-0000-4000-8000-000000000005';
begin
  perform pg_temp.expect((select count(*) from public.audit_log where table_name = 'connector_connections') >= 6, 'the connection changes were not audited');
  perform pg_temp.expect(not exists (select 1 from public.audit_log where table_name = 'connector_connections' and changed::text ~ 'v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+'), 'a token reached the audit trail');
  perform pg_temp.expect(exists (select 1 from public.audit_log where table_name = 'connector_connections' and changed -> 'token_ct' = '["[redactado]", "[redactado]"]'::jsonb), 'the token column is not redacted in the audit trail');
  perform pg_temp.as_user(ux, 'con-x@example.test');
  perform public.delete_company(t2, 'Empresa Dos');
  reset role;
  perform pg_temp.expect(not exists (select 1 from public.connector_connections where tenant_id = t2) and not exists (select 1 from public.oauth_states where tenant_id = t2), 'deleting the company left connection records');
end $$;

select 'connectors: all checks passed' as result;
