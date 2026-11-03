-- SOLO para el proyecto desechable del spike. No ejecutar en producción.
-- Ejecutar una vez, en orden: Bloque 0, Bloque A, Bloque B y verificaciones.

-- Bloque 0: permisos por defecto para objetos futuros creados por postgres.
-- El último REVOKE es global para funciones futuras de postgres; no copiar a producción.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated, service_role;
alter default privileges for role postgres revoke execute on functions from public;

-- Bloque A: esquema, función de membresía, tablas, RLS y filas sintéticas.
create schema private;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.memberships (
  user_id uuid not null references auth.users (id) on delete cascade,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  primary key (user_id, tenant_id)
);
create index memberships_tenant_id_idx on public.memberships (tenant_id);

create table public.spike_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now()
);
create index spike_items_tenant_id_idx on public.spike_items (tenant_id);

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
    where m.tenant_id = target_tenant
      and m.user_id = (select auth.uid())
  );
$$;

revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
revoke execute on function private.is_member(uuid) from public, anon, authenticated, service_role;
grant execute on function private.is_member(uuid) to authenticated;

revoke all on table public.tenants, public.memberships, public.spike_items from public, anon, authenticated, service_role;
grant select on table public.tenants, public.memberships to authenticated;
grant select, insert, update, delete on table public.spike_items to authenticated;

alter table public.tenants enable row level security;
alter table public.memberships enable row level security;
alter table public.spike_items enable row level security;

create policy tenants_select on public.tenants
  for select to authenticated
  using ((select private.is_member(id)));

create policy memberships_select_own on public.memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy items_select on public.spike_items
  for select to authenticated
  using ((select private.is_member(tenant_id)));

create policy items_insert on public.spike_items
  for insert to authenticated
  with check ((select private.is_member(tenant_id)));

create policy items_update on public.spike_items
  for update to authenticated
  using ((select private.is_member(tenant_id)))
  with check ((select private.is_member(tenant_id)));

create policy items_delete on public.spike_items
  for delete to authenticated
  using ((select private.is_member(tenant_id)));

insert into public.tenants (id, name) values
  ('00000000-0000-0000-0000-00000000000a', 'Empresa de prueba A'),
  ('00000000-0000-0000-0000-00000000000b', 'Empresa de prueba B');

insert into public.spike_items (tenant_id, label) values
  ('00000000-0000-0000-0000-00000000000a', 'Dato ficticio A-1'),
  ('00000000-0000-0000-0000-00000000000a', 'Dato ficticio A-2'),
  ('00000000-0000-0000-0000-00000000000b', 'Dato ficticio B-1'),
  ('00000000-0000-0000-0000-00000000000b', 'Dato ficticio B-2');

-- Bloque B: reemplazar los dos correos por los usuarios A y B creados en Auth.
-- El usuario C no debe tener membresía.
insert into public.memberships (user_id, tenant_id)
select u.id, v.tenant_id
from auth.users u
join (values
  ('CORREO-USUARIO-A', '00000000-0000-0000-0000-00000000000a'::uuid),
  ('CORREO-USUARIO-B', '00000000-0000-0000-0000-00000000000b'::uuid)
) as v(email, tenant_id) on lower(u.email) = lower(v.email);

-- Verificaciones. Ejecutar V7 y V8 individualmente; V7 debe producir permiso denegado.
-- V1: debe devolver 2 membresías.
select u.email, m.tenant_id
from public.memberships m join auth.users u on u.id = m.user_id;

-- V2: no debe haber privilegios por defecto para PUBLIC, anon, authenticated o service_role.
select d.defaclobjtype, a.grantee::regrole, a.privilege_type
from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
where d.defaclrole = 'postgres'::regrole
  and d.defaclnamespace = 'public'::regnamespace
  and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole, 'service_role'::regrole));

-- V3: las tres tablas deben mostrar rls = true.
select relname, relrowsecurity as rls
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('tenants', 'memberships', 'spike_items');

-- V4: owner = postgres, secdef = true y search_path vacío.
select p.proname, pg_get_userbyid(p.proowner) as owner, p.prosecdef as secdef, p.proconfig as config
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'private' and p.proname = 'is_member';

-- V5: anon=false, authenticated=true, service_role=false.
select r as role, has_function_privilege(r, 'private.is_member(uuid)', 'execute') as can_execute
from unnest(array['anon', 'authenticated', 'service_role']) r;

-- V6: debe devolver 0 filas.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'service_role');

-- V7: debe fallar con permission denied for table spike_items.
begin;
set local role anon;
select count(*) from public.spike_items;
rollback;

-- V8: sustituir UUID por el del usuario A. Debe devolver solo A-1 y A-2.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'UUID-DEL-USUARIO-A';
select label from public.spike_items order by label;
rollback;
