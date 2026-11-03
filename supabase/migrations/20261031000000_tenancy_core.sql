-- Tenancy core (ADR-0006, fase 1b): tenants, memberships and the business profile v1.
-- One logical change: schema, constraints, indexes, grants and RLS ship together.
--
-- Apply only to a disposable development project, from the Supabase SQL editor (never `supabase db push`
-- without approval, AGENTS.md 7.11). Project-level default privileges are NOT set here: see
-- docs/supabase-spike/README.md "Bloque 0" for the disposable project.
--
-- Reversal plan (development only, destroys the data in these tables):
--   drop table public.business_profiles, public.memberships, public.tenants;
--   drop function private.is_owner(uuid), private.is_member(uuid), private.touch_updated_at();
--   drop schema private;

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- A tenant is the isolation unit: its id is the tenant_id carried by every business table.
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  role text not null check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);
create index memberships_tenant_id_idx on public.memberships (tenant_id);

-- One current profile per tenant. Closed values only: the CHECKs mirror lib/contracts/assessment.ts
-- (a unit test keeps both in sync). created_by/updated_by block deleting a user who authored a profile
-- until the profile is reassigned; revisit with the deletion policy (ADR-0006, pending decision 6).
create table public.business_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants (id) on delete cascade,
  trade_name text not null check (char_length(trade_name) between 1 and 120),
  country text not null check (country ~ '^[A-Z]{2}$'),
  locale text not null check (locale ~ '^[a-z]{2}$'),
  sector text not null check (sector in ('realEstate', 'marketingAgency', 'professionalServices', 'software', 'retail', 'other')),
  team_size text not null check (team_size in ('solo', 'small', 'medium', 'large')),
  channel text not null check (channel in ('web', 'social', 'referrals', 'ads', 'inPerson')),
  crm text not null check (crm in ('none', 'spreadsheets', 'basicTool', 'fullCrm')),
  problem text not null check (problem in ('leads', 'followUp', 'cash', 'manualWork', 'visibility')),
  goal text not null check (goal in ('moreSales', 'organizeClients', 'automate', 'controlFinances', 'understandData')),
  questionnaire_version smallint not null default 1 check (questionnaire_version >= 1),
  created_by uuid not null references auth.users (id),
  updated_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Helper functions (not exposed: the private schema is not in the API's exposed schemas)
-- ---------------------------------------------------------------------------

-- A suspended tenant cuts off every member: both helpers require an active tenant.
create function private.is_member(target_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = target_tenant
      and m.user_id = (select auth.uid())
      and t.status = 'active'
  );
$$;

create function private.is_owner(target_tenant uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = target_tenant
      and m.user_id = (select auth.uid())
      and m.role = 'owner'
      and t.status = 'active'
  );
$$;

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tenants_touch_updated_at
  before update on public.tenants
  for each row execute function private.touch_updated_at();

create trigger memberships_touch_updated_at
  before update on public.memberships
  for each row execute function private.touch_updated_at();

create trigger business_profiles_touch_updated_at
  before update on public.business_profiles
  for each row execute function private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Minimum privileges: start from nothing, grant only what each role needs
-- ---------------------------------------------------------------------------

revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;

revoke execute on function private.is_member(uuid), private.is_owner(uuid), private.touch_updated_at()
  from public, anon, authenticated, service_role;
grant execute on function private.is_member(uuid), private.is_owner(uuid) to authenticated;

revoke all on table public.tenants, public.memberships, public.business_profiles
  from public, anon, authenticated, service_role;

grant select on table public.tenants, public.memberships to authenticated;
grant select on table public.business_profiles to authenticated;

-- Column-level writes: tenant_id, created_by and created_at are fixed at insert time and never updatable.
-- No DELETE in v1: export and deletion are designed with the retention decision (ADR-0006, phase 2).
grant insert (tenant_id, trade_name, country, locale, sector, team_size, channel, crm, problem, goal,
              questionnaire_version, created_by, updated_by)
  on table public.business_profiles to authenticated;
grant update (trade_name, country, locale, sector, team_size, channel, crm, problem, goal,
              questionnaire_version, updated_by)
  on table public.business_profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security: deny by default, one policy per operation
-- ---------------------------------------------------------------------------

alter table public.tenants enable row level security;
alter table public.memberships enable row level security;
alter table public.business_profiles enable row level security;

create policy tenants_select on public.tenants
  for select to authenticated
  using ((select private.is_member(id)));

-- Own memberships only, and only while the tenant is active (a suspended tenant disappears entirely).
create policy memberships_select_own on public.memberships
  for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_member(tenant_id)));

create policy business_profiles_select on public.business_profiles
  for select to authenticated
  using ((select private.is_member(tenant_id)));

create policy business_profiles_insert on public.business_profiles
  for insert to authenticated
  with check (
    (select private.is_owner(tenant_id))
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
  );

create policy business_profiles_update on public.business_profiles
  for update to authenticated
  using ((select private.is_owner(tenant_id)))
  with check (
    (select private.is_owner(tenant_id))
    and updated_by = (select auth.uid())
  );
