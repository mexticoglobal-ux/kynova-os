-- Bring the existing disposable spike project up to the Phase 1b tenancy schema.
-- Additive and data-preserving: keeps the two fictitious tenants and their memberships.
-- Apply only to the disposable Supabase project, never production.

begin;

create schema if not exists private;

alter table public.tenants
  add column if not exists status text,
  add column if not exists updated_at timestamptz;
update public.tenants set status = 'active' where status is null;
update public.tenants set updated_at = coalesce(created_at, now()) where updated_at is null;
alter table public.tenants
  alter column status set default 'active',
  alter column status set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

alter table public.memberships
  add column if not exists role text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;
update public.memberships set role = 'member' where role is null;
update public.memberships set created_at = now() where created_at is null;
update public.memberships set updated_at = coalesce(created_at, now()) where updated_at is null;
alter table public.memberships
  alter column role set default 'member',
  alter column role set not null,
  alter column created_at set default now(),
  alter column created_at set not null,
  alter column updated_at set default now(),
  alter column updated_at set not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.tenants'::regclass and conname = 'tenants_status_check') then
    alter table public.tenants add constraint tenants_status_check check (status in ('active', 'suspended'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.memberships'::regclass and conname = 'memberships_role_check') then
    alter table public.memberships add constraint memberships_role_check check (role in ('owner', 'member'));
  end if;
end $$;

-- In this disposable fixture each of these two known fictitious tenants has one member.
-- Promote only that sole member so owner-only profile writes can be exercised.
update public.memberships m set role = 'owner'
from public.tenants t
where t.id = m.tenant_id
  and t.id in ('00000000-0000-0000-0000-00000000000a'::uuid, '00000000-0000-0000-0000-00000000000b'::uuid)
  and t.name in ('Empresa de prueba A', 'Empresa de prueba B')
  and (select count(*) from public.memberships only_member where only_member.tenant_id = t.id) = 1;

create table if not exists public.business_profiles (
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

create index if not exists memberships_tenant_id_idx on public.memberships (tenant_id);

create or replace function private.is_member(target_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = target_tenant and m.user_id = (select auth.uid()) and t.status = 'active'
  );
$$;

create or replace function private.is_owner(target_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.memberships m join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = target_tenant and m.user_id = (select auth.uid())
      and m.role = 'owner' and t.status = 'active'
  );
$$;

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tenants_touch_updated_at on public.tenants;
create trigger tenants_touch_updated_at before update on public.tenants
for each row execute function private.touch_updated_at();
drop trigger if exists memberships_touch_updated_at on public.memberships;
create trigger memberships_touch_updated_at before update on public.memberships
for each row execute function private.touch_updated_at();
drop trigger if exists business_profiles_touch_updated_at on public.business_profiles;
create trigger business_profiles_touch_updated_at before update on public.business_profiles
for each row execute function private.touch_updated_at();

revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
revoke execute on function private.is_member(uuid), private.is_owner(uuid), private.touch_updated_at()
  from public, anon, authenticated, service_role;
grant execute on function private.is_member(uuid), private.is_owner(uuid) to authenticated;

revoke all on table public.tenants, public.memberships, public.business_profiles
  from public, anon, authenticated, service_role;
grant select on table public.tenants, public.memberships, public.business_profiles to authenticated;
grant insert (tenant_id, trade_name, country, locale, sector, team_size, channel, crm, problem, goal,
              questionnaire_version, created_by, updated_by)
  on table public.business_profiles to authenticated;
grant update (trade_name, country, locale, sector, team_size, channel, crm, problem, goal,
              questionnaire_version, updated_by)
  on table public.business_profiles to authenticated;

alter table public.tenants enable row level security;
alter table public.memberships enable row level security;
alter table public.business_profiles enable row level security;

drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants for select to authenticated
using ((select private.is_member(id)));
drop policy if exists memberships_select_own on public.memberships;
create policy memberships_select_own on public.memberships for select to authenticated
using (user_id = (select auth.uid()) and (select private.is_member(tenant_id)));
drop policy if exists business_profiles_select on public.business_profiles;
create policy business_profiles_select on public.business_profiles for select to authenticated
using ((select private.is_member(tenant_id)));
drop policy if exists business_profiles_insert on public.business_profiles;
create policy business_profiles_insert on public.business_profiles for insert to authenticated
with check ((select private.is_owner(tenant_id)) and created_by = (select auth.uid()) and updated_by = (select auth.uid()));
drop policy if exists business_profiles_update on public.business_profiles;
create policy business_profiles_update on public.business_profiles for update to authenticated
using ((select private.is_owner(tenant_id)))
with check ((select private.is_owner(tenant_id)) and updated_by = (select auth.uid()));

commit;
