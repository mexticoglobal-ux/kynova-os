-- Tenant isolation and minimum-privilege tests for 20261031000000_tenancy_core.sql (ADR-0006).
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/tests/isolation.sql
-- Fictitious data only. Any failed expectation raises an exception and stops the run (non-zero exit).
--
-- Actors: A owns tenants A, E and F (and G and H, which are suspended); B owns tenant B; M is a plain
-- member of A and D; C has no membership.
-- Each DO block is its own transaction and its writes persist, so read-only checks come first.

-- ---------------------------------------------------------------------------
-- Fixtures (run as the owner role, which is not subject to RLS)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'a@example.test'),
  ('00000000-0000-4000-8000-0000000000a2', 'b@example.test'),
  ('00000000-0000-4000-8000-0000000000a3', 'c@example.test'),
  ('00000000-0000-4000-8000-0000000000a4', 'm@example.test');

insert into public.tenants (id, name) values
  ('00000000-0000-4000-8000-0000000000b1', 'Empresa A'),
  ('00000000-0000-4000-8000-0000000000b2', 'Empresa B'),
  ('00000000-0000-4000-8000-0000000000b3', 'Empresa D'),
  ('00000000-0000-4000-8000-0000000000b4', 'Empresa E'),
  ('00000000-0000-4000-8000-0000000000b5', 'Empresa F');

-- Suspended tenants: G keeps a profile, H has none.
insert into public.tenants (id, name, status) values
  ('00000000-0000-4000-8000-0000000000b6', 'Empresa G', 'suspended'),
  ('00000000-0000-4000-8000-0000000000b7', 'Empresa H', 'suspended');

insert into public.memberships (user_id, tenant_id, role) values
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b1', 'owner'),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b4', 'owner'),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b5', 'owner'),
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000b2', 'owner'),
  ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000b1', 'member'),
  ('00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000b3', 'member'),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b6', 'owner'),
  ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b7', 'owner');

insert into public.business_profiles
  (tenant_id, trade_name, country, locale, sector, team_size, channel, crm, problem, goal, created_by, updated_by)
values
  ('00000000-0000-4000-8000-0000000000b1', 'Empresa A', 'CR', 'es', 'software', 'small', 'web', 'basicTool', 'leads', 'moreSales',
   '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1'),
  ('00000000-0000-4000-8000-0000000000b2', 'Empresa B', 'CR', 'es', 'retail', 'solo', 'social', 'none', 'cash', 'controlFinances',
   '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a2'),
  ('00000000-0000-4000-8000-0000000000b6', 'Empresa G', 'CR', 'es', 'other', 'solo', 'web', 'none', 'leads', 'moreSales',
   '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1');

-- ---------------------------------------------------------------------------
-- Static checks: no PUBLIC or API-role privileges beyond the intended ones
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n from pg_proc p
   where p.pronamespace = 'private'::regnamespace and p.proacl is null;
  if n <> 0 then raise exception 'FAIL: % private function(s) still have the default PUBLIC EXECUTE', n; end if;

  select count(*) into n from pg_proc p, aclexplode(p.proacl) a
   where p.pronamespace = 'private'::regnamespace and a.grantee = 0;
  if n <> 0 then raise exception 'FAIL: PUBLIC can execute % private function(s)', n; end if;

  if has_function_privilege('anon', 'private.is_member(uuid)', 'execute') then raise exception 'FAIL: anon can execute is_member'; end if;
  if has_function_privilege('service_role', 'private.is_owner(uuid)', 'execute') then raise exception 'FAIL: service_role can execute is_owner'; end if;
  if not has_function_privilege('authenticated', 'private.is_member(uuid)', 'execute') then raise exception 'FAIL: authenticated cannot execute is_member'; end if;

  select count(*) into n from pg_proc p
   where p.pronamespace = 'private'::regnamespace and p.proname in ('is_member', 'is_owner')
     and (not p.prosecdef or p.proconfig is distinct from array['search_path=""']);
  if n <> 0 then raise exception 'FAIL: % helper(s) are not SECURITY DEFINER with an empty search_path', n; end if;

  select count(*) into n from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relname in ('tenants', 'memberships', 'business_profiles') and not c.relrowsecurity;
  if n <> 0 then raise exception 'FAIL: RLS is disabled on % table(s)', n; end if;

  select count(*) into n from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'service_role', 'PUBLIC');
  if n <> 0 then raise exception 'FAIL: anon/service_role/PUBLIC hold % table privilege(s)', n; end if;

  select count(*) into n from pg_trigger t
   where not t.tgisinternal and t.tgrelid in ('public.tenants'::regclass, 'public.memberships'::regclass, 'public.business_profiles'::regclass)
     and t.tgname like '%touch_updated_at';
  if n <> 3 then raise exception 'FAIL: expected an updated_at trigger on all 3 tables, found %', n; end if;

  raise notice 'ok: static privilege checks';
end $$;

-- ---------------------------------------------------------------------------
-- A (owner of A, E, F): reads only its own tenants
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);

  select count(*) into n from public.tenants;
  if n <> 3 then raise exception 'FAIL: A should see 3 tenants, saw %', n; end if;
  select count(*) into n from public.memberships;
  if n <> 3 then raise exception 'FAIL: A should see only its 3 memberships, saw %', n; end if;
  select count(*) into n from public.business_profiles;
  if n <> 1 then raise exception 'FAIL: A should see exactly 1 profile, saw %', n; end if;
  select count(*) into n from public.business_profiles where tenant_id = '00000000-0000-4000-8000-0000000000b2';
  if n <> 0 then raise exception 'FAIL: A can read the profile of tenant B'; end if;
  select count(*) into n from public.tenants where id = '00000000-0000-4000-8000-0000000000b2';
  if n <> 0 then raise exception 'FAIL: A can read tenant B'; end if;
  -- A owns the suspended tenants G and H, yet they, their memberships and the G profile are invisible.
  select count(*) into n from public.tenants where id in ('00000000-0000-4000-8000-0000000000b6', '00000000-0000-4000-8000-0000000000b7');
  if n <> 0 then raise exception 'FAIL: A can read a suspended tenant'; end if;
  select count(*) into n from public.memberships where tenant_id in ('00000000-0000-4000-8000-0000000000b6', '00000000-0000-4000-8000-0000000000b7');
  if n <> 0 then raise exception 'FAIL: A can read a membership of a suspended tenant'; end if;
  select count(*) into n from public.business_profiles where tenant_id = '00000000-0000-4000-8000-0000000000b6';
  if n <> 0 then raise exception 'FAIL: A can read the profile of a suspended tenant'; end if;
  raise notice 'ok: A reads only its own active tenants';
end $$;

-- ---------------------------------------------------------------------------
-- B, C and M: reads
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a2', true);
  select count(*) into n from public.business_profiles where tenant_id = '00000000-0000-4000-8000-0000000000b1';
  if n <> 0 then raise exception 'FAIL: B can read the profile of tenant A'; end if;
  select count(*) into n from public.business_profiles;
  if n <> 1 then raise exception 'FAIL: B should see exactly 1 profile, saw %', n; end if;
  raise notice 'ok: B reads only its own profile';
end $$;

do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a3', true);
  select count(*) into n from public.tenants;
  if n <> 0 then raise exception 'FAIL: C (no membership) sees % tenants', n; end if;
  select count(*) into n from public.memberships;
  if n <> 0 then raise exception 'FAIL: C sees % memberships', n; end if;
  select count(*) into n from public.business_profiles;
  if n <> 0 then raise exception 'FAIL: C sees % profiles', n; end if;
  begin
    insert into public.business_profiles
      (tenant_id, trade_name, country, locale, sector, team_size, channel, crm, problem, goal, created_by, updated_by)
    values ('00000000-0000-4000-8000-0000000000b1', 'X', 'CR', 'es', 'other', 'solo', 'web', 'none', 'leads', 'moreSales',
            '00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a3');
    raise exception 'FAIL: C inserted a profile';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ok: C (no membership) sees nothing and cannot write';
end $$;

do $$
declare n int; rc int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a4', true);
  select count(*) into n from public.business_profiles;
  if n <> 1 then raise exception 'FAIL: M should read the profile of tenant A only, saw %', n; end if;

  update public.business_profiles set trade_name = 'Hijacked by member',
         updated_by = '00000000-0000-4000-8000-0000000000a4'
   where tenant_id = '00000000-0000-4000-8000-0000000000b1';
  get diagnostics rc = row_count;
  if rc <> 0 then raise exception 'FAIL: a plain member updated the profile (% rows)', rc; end if;

  begin
    insert into public.business_profiles
      (tenant_id, trade_name, country, locale, sector, team_size, channel, crm, problem, goal, created_by, updated_by)
    values ('00000000-0000-4000-8000-0000000000b3', 'X', 'CR', 'es', 'other', 'solo', 'web', 'none', 'leads', 'moreSales',
            '00000000-0000-4000-8000-0000000000a4', '00000000-0000-4000-8000-0000000000a4');
    raise exception 'FAIL: a plain member created a profile';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ok: a plain member reads but cannot write';
end $$;

-- ---------------------------------------------------------------------------
-- anon and service_role: no table access at all
-- ---------------------------------------------------------------------------
do $$
begin
  set local role anon;
  begin perform 1 from public.tenants; raise exception 'FAIL: anon read tenants';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.memberships; raise exception 'FAIL: anon read memberships';
  exception when insufficient_privilege then null; end;
  begin perform 1 from public.business_profiles; raise exception 'FAIL: anon read business_profiles';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.tenants (name) values ('anon tenant');
    raise exception 'FAIL: anon inserted a tenant';
  exception when insufficient_privilege then null; end;
  begin perform private.is_member('00000000-0000-4000-8000-0000000000b1'); raise exception 'FAIL: anon called is_member';
  exception when insufficient_privilege then null; end;
  raise notice 'ok: anon has no access';
end $$;

do $$
begin
  set local role service_role;
  begin perform 1 from public.business_profiles; raise exception 'FAIL: service_role read business_profiles without an explicit grant';
  exception when insufficient_privilege then null; end;
  raise notice 'ok: service_role holds no implicit table privileges';
end $$;

-- ---------------------------------------------------------------------------
-- A: writes. Memberships can never be changed through the API.
-- ---------------------------------------------------------------------------
do $$
declare rc int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);

  begin
    insert into public.memberships (user_id, tenant_id, role)
    values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000b2', 'owner');
    raise exception 'FAIL: A added itself to tenant B';
  exception when insufficient_privilege then null; end;
  begin
    update public.memberships set role = 'owner' where user_id = '00000000-0000-4000-8000-0000000000a4';
    raise exception 'FAIL: A changed a membership role';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.memberships where tenant_id = '00000000-0000-4000-8000-0000000000b1';
    raise exception 'FAIL: A deleted memberships';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.tenants (name) values ('A creates a tenant');
    raise exception 'FAIL: A created a tenant through the API';
  exception when insufficient_privilege then null; end;
  raise notice 'ok: memberships and tenants are read-only through the API';
end $$;

do $$
declare rc int; n int; before_at timestamptz; after_at timestamptz;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);

  -- Cannot write into tenant B (insert with a foreign tenant_id).
  begin
    insert into public.business_profiles
      (tenant_id, trade_name, country, locale, sector, team_size, channel, crm, problem, goal, created_by, updated_by)
    values ('00000000-0000-4000-8000-0000000000b2', 'X', 'CR', 'es', 'other', 'solo', 'web', 'none', 'leads', 'moreSales',
            '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1');
    raise exception 'FAIL: A inserted a profile with the foreign tenant_id of B';
  exception when insufficient_privilege then null; end;

  -- Cannot update B's profile (RLS hides the row: 0 rows affected).
  update public.business_profiles set trade_name = 'Hijacked by A', updated_by = '00000000-0000-4000-8000-0000000000a1'
   where tenant_id = '00000000-0000-4000-8000-0000000000b2';
  get diagnostics rc = row_count;
  if rc <> 0 then raise exception 'FAIL: A updated the profile of B (% rows)', rc; end if;

  -- Cannot forge authorship.
  begin
    insert into public.business_profiles
      (tenant_id, trade_name, country, locale, sector, team_size, channel, crm, problem, goal, created_by, updated_by)
    values ('00000000-0000-4000-8000-0000000000b5', 'Forged', 'CR', 'es', 'other', 'solo', 'web', 'none', 'leads', 'moreSales',
            '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1');
    raise exception 'FAIL: A inserted a profile authored as B';
  exception when insufficient_privilege then null; end;
  begin
    update public.business_profiles set updated_by = '00000000-0000-4000-8000-0000000000a2'
     where tenant_id = '00000000-0000-4000-8000-0000000000b1';
    raise exception 'FAIL: A updated a profile authored as B';
  exception when insufficient_privilege then null; end;

  -- tenant_id and created_by are immutable; no DELETE exists.
  begin
    update public.business_profiles set tenant_id = '00000000-0000-4000-8000-0000000000b4'
     where tenant_id = '00000000-0000-4000-8000-0000000000b1';
    raise exception 'FAIL: A moved a profile to another tenant';
  exception when insufficient_privilege then null; end;
  begin
    update public.business_profiles set created_by = '00000000-0000-4000-8000-0000000000a2'
     where tenant_id = '00000000-0000-4000-8000-0000000000b1';
    raise exception 'FAIL: A rewrote created_by';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.business_profiles where tenant_id = '00000000-0000-4000-8000-0000000000b1';
    raise exception 'FAIL: A deleted a profile';
  exception when insufficient_privilege then null; end;

  -- Out-of-domain values are rejected by the database, not only by the application.
  begin
    update public.business_profiles set sector = 'notASector' where tenant_id = '00000000-0000-4000-8000-0000000000b1';
    raise exception 'FAIL: an invalid sector was accepted';
  exception when check_violation then null; end;

  -- A suspended tenant cuts off even its owner: no update of G's profile, no profile for H.
  update public.business_profiles set trade_name = 'Edited while suspended', updated_by = '00000000-0000-4000-8000-0000000000a1'
   where tenant_id = '00000000-0000-4000-8000-0000000000b6';
  get diagnostics rc = row_count;
  if rc <> 0 then raise exception 'FAIL: A updated the profile of a suspended tenant (% rows)', rc; end if;
  begin
    insert into public.business_profiles
      (tenant_id, trade_name, country, locale, sector, team_size, channel, crm, problem, goal, created_by, updated_by)
    values ('00000000-0000-4000-8000-0000000000b7', 'X', 'CR', 'es', 'other', 'solo', 'web', 'none', 'leads', 'moreSales',
            '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1');
    raise exception 'FAIL: A created a profile for a suspended tenant';
  exception when insufficient_privilege then null; end;

  -- Positive controls: an owner can create (tenant E) and update (tenant A) its own profile.
  insert into public.business_profiles
    (tenant_id, trade_name, country, locale, sector, team_size, channel, crm, problem, goal, created_by, updated_by)
  values ('00000000-0000-4000-8000-0000000000b4', 'Empresa E', 'CR', 'es', 'other', 'solo', 'web', 'none', 'leads', 'moreSales',
          '00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1');

  select updated_at into before_at from public.business_profiles where tenant_id = '00000000-0000-4000-8000-0000000000b1';
  update public.business_profiles set trade_name = 'Empresa A renombrada', updated_by = '00000000-0000-4000-8000-0000000000a1'
   where tenant_id = '00000000-0000-4000-8000-0000000000b1';
  get diagnostics rc = row_count;
  if rc <> 1 then raise exception 'FAIL: the owner could not update its own profile (% rows)', rc; end if;
  select updated_at into after_at from public.business_profiles where tenant_id = '00000000-0000-4000-8000-0000000000b1';
  if after_at <= before_at then raise exception 'FAIL: updated_at was not refreshed'; end if;
  raise notice 'ok: A writes only inside its own tenants';
end $$;

-- ---------------------------------------------------------------------------
-- Same isolation through the JSON claims PostgREST sets in current Supabase (request.jwt.claims),
-- with the legacy request.jwt.claim.sub setting cleared.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a2","role":"authenticated"}', true);
  select count(*) into n from public.business_profiles;
  if n <> 1 then raise exception 'FAIL: B via JSON claims should see exactly 1 profile, saw %', n; end if;
  select count(*) into n from public.business_profiles where tenant_id = '00000000-0000-4000-8000-0000000000b1';
  if n <> 0 then raise exception 'FAIL: B via JSON claims can read the profile of tenant A'; end if;

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a3","role":"authenticated"}', true);
  select count(*) into n from public.tenants;
  if n <> 0 then raise exception 'FAIL: C via JSON claims sees % tenants', n; end if;

  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from public.tenants;
  if n <> 0 then raise exception 'FAIL: a caller with no identity sees % tenants', n; end if;
  raise notice 'ok: isolation holds through request.jwt.claims';
end $$;

-- ---------------------------------------------------------------------------
-- Helper behavior for an authenticated caller
-- ---------------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
  if not private.is_member('00000000-0000-4000-8000-0000000000b1') then raise exception 'FAIL: A should be a member of A'; end if;
  if private.is_member('00000000-0000-4000-8000-0000000000b2') then raise exception 'FAIL: A should not be a member of B'; end if;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a4', true);
  if private.is_owner('00000000-0000-4000-8000-0000000000b1') then raise exception 'FAIL: M should not be an owner of A'; end if;
  raise notice 'ok: membership helpers';
end $$;

-- ---------------------------------------------------------------------------
-- Final state, as the owner role: nothing crossed a tenant boundary
-- ---------------------------------------------------------------------------
do $$
declare n int; t text;
begin
  select trade_name into t from public.business_profiles where tenant_id = '00000000-0000-4000-8000-0000000000b2';
  if t is distinct from 'Empresa B' then raise exception 'FAIL: the profile of B changed to %', t; end if;
  select count(*) into n from public.business_profiles;
  if n <> 4 then raise exception 'FAIL: expected 4 profiles (A, B, E, G), found %', n; end if;
  select trade_name into t from public.business_profiles where tenant_id = '00000000-0000-4000-8000-0000000000b6';
  if t is distinct from 'Empresa G' then raise exception 'FAIL: the profile of suspended tenant G changed to %', t; end if;
  select count(*) into n from public.memberships;
  if n <> 8 then raise exception 'FAIL: expected 8 memberships, found %', n; end if;

  -- updated_at is maintained on every table (data.md rule 6).
  update public.tenants set name = name where id = '00000000-0000-4000-8000-0000000000b1';
  select count(*) into n from public.tenants where id = '00000000-0000-4000-8000-0000000000b1' and updated_at > created_at;
  if n <> 1 then raise exception 'FAIL: tenants.updated_at is not maintained'; end if;
  update public.memberships set role = role
   where user_id = '00000000-0000-4000-8000-0000000000a1' and tenant_id = '00000000-0000-4000-8000-0000000000b1';
  select count(*) into n from public.memberships
   where user_id = '00000000-0000-4000-8000-0000000000a1' and tenant_id = '00000000-0000-4000-8000-0000000000b1' and updated_at > created_at;
  if n <> 1 then raise exception 'FAIL: memberships.updated_at is not maintained'; end if;
  raise notice 'ok: final state intact';
end $$;
