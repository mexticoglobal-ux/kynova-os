-- Fictitious development seed (ADR-0006: no real data, no data from Nova Marketing Studio).
-- Disposable development project only. Run from the Supabase SQL editor AFTER the migration and AFTER
-- creating the three fictitious Auth users (A, B, C). Replace the two placeholders below with the emails
-- of users A and B. User C stays without a membership on purpose.

insert into public.tenants (id, name) values
  ('00000000-0000-0000-0000-00000000000a', 'Empresa de prueba A'),
  ('00000000-0000-0000-0000-00000000000b', 'Empresa de prueba B');

-- Placeholders: if an email does not match an Auth user, that row is silently skipped.
-- Verification query below must return 2 rows.
insert into public.memberships (user_id, tenant_id, role)
select u.id, v.tenant_id, 'owner'
from auth.users u
join (values
  ('CORREO-USUARIO-A', '00000000-0000-0000-0000-00000000000a'::uuid),
  ('CORREO-USUARIO-B', '00000000-0000-0000-0000-00000000000b'::uuid)
) as v(email, tenant_id) on lower(u.email) = lower(v.email);

-- One fictitious profile for tenant A, authored by its owner. Tenant B starts without a profile so the
-- creation path can be tested from the API.
insert into public.business_profiles
  (tenant_id, trade_name, country, locale, sector, team_size, channel, crm, problem, goal, created_by, updated_by)
select m.tenant_id, 'Empresa de prueba A', 'CR', 'es', 'software', 'small', 'web', 'basicTool', 'leads', 'moreSales', m.user_id, m.user_id
from public.memberships m
where m.tenant_id = '00000000-0000-0000-0000-00000000000a';

-- Verification: expect 2 memberships (owner of A, owner of B) and 1 profile (tenant A).
select u.email, m.tenant_id, m.role
from public.memberships m join auth.users u on u.id = m.user_id;
select tenant_id, trade_name from public.business_profiles;
