-- CI ONLY. Never run this against a Supabase project.
-- Minimal stand-ins for what Supabase provides (API roles, auth.users, auth.uid()) so the tenancy
-- migration and its isolation tests can run on a plain, ephemeral Postgres. The real Supabase `auth`
-- schema differs: a green run here is evidence about the SQL, not about Supabase.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);

-- Same contract as Supabase's auth.uid(): read the user id from the request JWT settings.
create function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

-- Supabase lets the API roles resolve auth.uid() inside policies, but not read auth.users.
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Hostile defaults on purpose: new objects get every privilege for the API roles, like older Supabase
-- projects. The migration must not depend on safe defaults; its explicit REVOKEs must win.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
