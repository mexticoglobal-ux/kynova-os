-- Read-only checks for the DISPOSABLE Supabase project (ADR-0006). Run it in the SQL editor after
-- Bloque 0 and the tenancy migration. It changes nothing and needs no emails or user ids.
-- Result: one row per control, PASS or FAIL. Any FAIL means the project is not in the expected state.
--
-- Limits: catalog checks only (privileges, RLS flags, policies, helper functions, default privileges).
-- It does not exercise policies as A, B or C: that is done through the API (docs/supabase-spike/README.md).
-- It cannot see default privileges owned by supabase_admin. Not yet run against a real Supabase project.

select check_name, case when ok then 'PASS' else 'FAIL' end as result
from (
  values
    ('RLS is enabled on tenants, memberships and business_profiles',
      (select count(*) = 3 from pg_class c
        where c.relnamespace = 'public'::regnamespace
          and c.relname in ('tenants', 'memberships', 'business_profiles')
          and c.relrowsecurity)),

    ('5 policies exist (1 on tenants, 1 on memberships, 3 on business_profiles)',
      (select count(*) = 5 from pg_policies
        where schemaname = 'public' and tablename in ('tenants', 'memberships', 'business_profiles'))),

    ('anon, service_role and PUBLIC hold no privilege on the three tables',
      (select count(*) = 0 from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('tenants', 'memberships', 'business_profiles')
          and grantee in ('anon', 'service_role', 'PUBLIC'))),

    ('authenticated can SELECT the three tables',
      (select count(*) = 3 from information_schema.role_table_grants
        where table_schema = 'public'
          and table_name in ('tenants', 'memberships', 'business_profiles')
          and grantee = 'authenticated' and privilege_type = 'SELECT')),

    ('authenticated has no write privilege on tenants and memberships',
      (select count(*) = 0 from information_schema.role_table_grants
        where table_schema = 'public' and table_name in ('tenants', 'memberships') and grantee = 'authenticated'
          and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'))),

    ('authenticated cannot DELETE or TRUNCATE business_profiles',
      (select count(*) = 0 from information_schema.role_table_grants
        where table_schema = 'public' and table_name = 'business_profiles' and grantee = 'authenticated'
          and privilege_type in ('DELETE', 'TRUNCATE'))),

    ('tenant_id and created_by of a profile cannot be updated; trade_name can',
      (select not has_column_privilege('authenticated', 'public.business_profiles', 'tenant_id', 'update')
          and not has_column_privilege('authenticated', 'public.business_profiles', 'created_by', 'update')
          and has_column_privilege('authenticated', 'public.business_profiles', 'trade_name', 'update'))),

    ('helpers are SECURITY DEFINER, owned by postgres, with an empty search_path',
      (select count(*) = 2 from pg_proc p
        where p.pronamespace = 'private'::regnamespace and p.proname in ('is_member', 'is_owner')
          and p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres'
          and p.proconfig = array['search_path=""'])),

    ('no function in the private schema is executable by PUBLIC',
      (select count(*) = 0 from pg_proc p
        where p.pronamespace = 'private'::regnamespace
          and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)))),

    ('only authenticated can execute the helpers (not anon, not service_role)',
      (select not has_function_privilege('anon', 'private.is_member(uuid)', 'execute')
          and not has_function_privilege('anon', 'private.is_owner(uuid)', 'execute')
          and not has_function_privilege('service_role', 'private.is_member(uuid)', 'execute')
          and not has_function_privilege('service_role', 'private.is_owner(uuid)', 'execute')
          and has_function_privilege('authenticated', 'private.is_member(uuid)', 'execute')
          and has_function_privilege('authenticated', 'private.is_owner(uuid)', 'execute'))),

    ('the private schema is usable by authenticated but not by anon',
      (select has_schema_privilege('authenticated', 'private', 'usage')
          and not has_schema_privilege('anon', 'private', 'usage'))),

    ('Bloque 0: no default privileges for the API roles on future postgres objects in public',
      (select count(*) = 0 from pg_default_acl d, aclexplode(d.defaclacl) a
        where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 'public'::regnamespace
          and a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole))),

    ('Bloque 0: PUBLIC cannot execute future functions created by postgres',
      (select exists (select 1 from pg_default_acl d
                       where d.defaclrole = 'postgres'::regrole and d.defaclobjtype = 'f' and d.defaclnamespace = 0)
          and not exists (select 1 from pg_default_acl d, aclexplode(d.defaclacl) a
                           where d.defaclrole = 'postgres'::regrole and d.defaclobjtype = 'f' and d.defaclnamespace = 0
                             and a.grantee = 0)))
) as t(check_name, ok)
order by check_name;
