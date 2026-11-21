-- SOLO LECTURA. Identifica, en el proyecto de desarrollo de Supabase, qué migraciones del repositorio están aplicadas y qué objetos existen.
-- Se ejecuta en el SQL Editor del proyecto. Solo contiene SELECT: no crea, cambia ni borra nada. No usa datos de tenants ni claves.
-- Generado a partir de supabase/migrations/*.sql (tablas y funciones que cada migración crea; se excluye private.apply_tenant_rls, que 20261106000300 borra).
-- Regla de lectura: una migración está aplicada cuando TODOS sus objetos existen. Si falta alguno, no se deduce nada más: se revisa ese objeto.
-- Los esquemas pueden coincidir parcialmente (migraciones pegadas a mano): el resultado por objeto (parte 2) manda sobre el resumen (parte 1).

-- PARTE 0 (opcional, SOLO si existe): el registro de la CLI de Supabase. Si da error "relation does not exist", no es un fallo: las migraciones no se aplicaron con la CLI.
-- select version, name from supabase_migrations.schema_migrations order by version;

-- PARTE 1: resumen por migración.
with expected(migration, kind, name) as (
  values
    ('20261031000000', 'table', 'public.tenants'),
    ('20261031000000', 'table', 'public.memberships'),
    ('20261031000000', 'table', 'public.business_profiles'),
    ('20261031000000', 'function', 'private.is_member'),
    ('20261031000000', 'function', 'private.is_owner'),
    ('20261031000000', 'function', 'private.touch_updated_at'),
    ('20261102000000', 'table', 'public.business_profiles'),
    ('20261102000000', 'function', 'private.is_member'),
    ('20261102000000', 'function', 'private.is_owner'),
    ('20261102000000', 'function', 'private.touch_updated_at'),
    ('20261106000100', 'table', 'public.action_log'),
    ('20261106000100', 'table', 'public.audit_log'),
    ('20261106000100', 'table', 'public.user_profiles'),
    ('20261106000100', 'function', 'private.uuid_v7'),
    ('20261106000100', 'function', 'private.has_role'),
    ('20261106000100', 'function', 'private.can_write'),
    ('20261106000100', 'function', 'private.is_admin'),
    ('20261106000100', 'function', 'private.shares_tenant_with'),
    ('20261106000100', 'function', 'private.protect_identity'),
    ('20261106000100', 'function', 'private.reject_mutation'),
    ('20261106000100', 'function', 'private.ensure_partitions'),
    ('20261106000100', 'function', 'private.audit_row'),
    ('20261106000100', 'function', 'private.log_action'),
    ('20261106000200', 'table', 'public.organizations'),
    ('20261106000200', 'table', 'public.contacts'),
    ('20261106000200', 'table', 'public.contact_identities'),
    ('20261106000200', 'table', 'public.integration_accounts'),
    ('20261106000200', 'table', 'public.conversations'),
    ('20261106000200', 'table', 'public.pack_versions'),
    ('20261106000200', 'table', 'public.assessment_runs'),
    ('20261106000200', 'table', 'public.pipelines'),
    ('20261106000200', 'table', 'public.pipeline_stages'),
    ('20261106000200', 'table', 'public.leads'),
    ('20261106000200', 'table', 'public.customers'),
    ('20261106000200', 'table', 'public.opportunities'),
    ('20261106000200', 'table', 'public.opportunity_stage_history'),
    ('20261106000200', 'table', 'public.activities'),
    ('20261106000200', 'table', 'public.tasks'),
    ('20261106000200', 'table', 'public.tags'),
    ('20261106000200', 'table', 'public.contact_tags'),
    ('20261106000300', 'table', 'public.messages'),
    ('20261106000300', 'table', 'public.inbound_events'),
    ('20261106000300', 'table', 'public.inbound_dedup'),
    ('20261106000300', 'table', 'public.attachments'),
    ('20261106000300', 'table', 'public.approval_requests'),
    ('20261106000300', 'table', 'public.outbox_messages'),
    ('20261106000300', 'table', 'public.work_agreements'),
    ('20261106000300', 'table', 'public.authorizations'),
    ('20261106000300', 'table', 'public.consent_records'),
    ('20261106000300', 'table', 'public.data_requests'),
    ('20261106000300', 'table', 'public.handoffs'),
    ('20261106000300', 'table', 'public.invitations'),
    ('20261106000300', 'table', 'public.metrics_daily'),
    ('20261106000400', 'function', 'private.require_member'),
    ('20261106000400', 'function', 'private.require_write'),
    ('20261106000400', 'function', 'private.require_admin'),
    ('20261106000400', 'function', 'private.jwt_email'),
    ('20261106000400', 'function', 'public.session_bootstrap'),
    ('20261106000400', 'function', 'public.create_company'),
    ('20261106000400', 'function', 'public.update_company'),
    ('20261106000400', 'function', 'public.delete_company'),
    ('20261106000400', 'function', 'public.list_team'),
    ('20261106000400', 'function', 'public.invite_member'),
    ('20261106000400', 'function', 'public.set_member_role'),
    ('20261106000400', 'function', 'public.remove_member'),
    ('20261106000400', 'function', 'public.revoke_invitation'),
    ('20261106000400', 'function', 'public.capture_prospect'),
    ('20261106000400', 'function', 'public.advance_lead'),
    ('20261106000400', 'function', 'private.default_stage'),
    ('20261106000400', 'function', 'private.ensure_customer'),
    ('20261106000400', 'function', 'public.create_opportunity'),
    ('20261106000400', 'function', 'public.move_opportunity'),
    ('20261106000400', 'function', 'public.win_lead'),
    ('20261106000400', 'function', 'public.create_client'),
    ('20261106000400', 'function', 'public.update_client'),
    ('20261106000400', 'function', 'public.erase_contact'),
    ('20261106000400', 'function', 'public.decide_approval'),
    ('20261106000400', 'function', 'public.start_assistant_conversation'),
    ('20261106000400', 'function', 'public.append_message'),
    ('20261106000400', 'function', 'public.list_conversations'),
    ('20261106000400', 'function', 'public.list_messages'),
    ('20261106000400', 'function', 'public.list_leads'),
    ('20261106000400', 'function', 'public.list_clients'),
    ('20261106000400', 'function', 'public.dashboard_digest'),
    ('20261106000400', 'function', 'public.save_assessment'),
    ('20261106000400', 'function', 'public.list_assessments'),
    ('20261106000400', 'function', 'public.delete_assistant_conversation'),
    ('20261106000400', 'function', 'public.list_activity'),
    ('20261106000400', 'function', 'public.ingest_inbound_event'),
    ('20261106000400', 'function', 'public.maintain_partitions'),
    ('20261110000100', 'table', 'public.platform_events'),
    ('20261110000100', 'table', 'public.platform_audit'),
    ('20261110000100', 'table', 'public.storage_objects'),
    ('20261110000100', 'function', 'public.append_platform_events'),
    ('20261110000100', 'function', 'public.append_platform_audit'),
    ('20261110000100', 'function', 'public.register_storage_object'),
    ('20261110000100', 'function', 'public.retire_storage_object'),
    ('20261110000100', 'function', 'public.delete_company'),
    ('20261118000100', 'table', 'public.ai_budget_periods'),
    ('20261118000100', 'table', 'public.ai_reservations'),
    ('20261118000100', 'table', 'public.ai_usage_attempts'),
    ('20261118000100', 'function', 'private.ai_budget_period'),
    ('20261118000100', 'function', 'public.reserve_ai_budget'),
    ('20261118000100', 'function', 'public.settle_ai_budget'),
    ('20261118000100', 'function', 'public.release_ai_budget'),
    ('20261118000100', 'function', 'public.write_off_ai_reservation'),
    ('20261118000100', 'function', 'public.assign_ai_budget'),
    ('20261118000100', 'function', 'public.assign_ai_call_cap'),
    ('20261118000100', 'function', 'public.expire_ai_reservations')
), found as (
  select e.migration, e.kind, e.name,
         case e.kind
           when 'table' then to_regclass(e.name) is not null
           else exists (
             select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname || '.' || p.proname = e.name
           )
         end as exists_now
  from expected e
)
select migration,
       count(*)                                             as objetos_esperados,
       count(*) filter (where exists_now)                   as existen,
       count(*) filter (where not exists_now)               as faltan,
       case when count(*) filter (where not exists_now) = 0 then 'completa'
            when count(*) filter (where exists_now) = 0     then 'ausente'
            else 'PARCIAL: revisar' end                     as estado
from found
group by migration
order by migration;

-- PARTE 2: detalle por objeto (los que faltan primero).
with expected(migration, kind, name) as (
  values
    ('20261031000000', 'table', 'public.tenants'),
    ('20261031000000', 'table', 'public.memberships'),
    ('20261031000000', 'table', 'public.business_profiles'),
    ('20261031000000', 'function', 'private.is_member'),
    ('20261031000000', 'function', 'private.is_owner'),
    ('20261031000000', 'function', 'private.touch_updated_at'),
    ('20261102000000', 'table', 'public.business_profiles'),
    ('20261102000000', 'function', 'private.is_member'),
    ('20261102000000', 'function', 'private.is_owner'),
    ('20261102000000', 'function', 'private.touch_updated_at'),
    ('20261106000100', 'table', 'public.action_log'),
    ('20261106000100', 'table', 'public.audit_log'),
    ('20261106000100', 'table', 'public.user_profiles'),
    ('20261106000100', 'function', 'private.uuid_v7'),
    ('20261106000100', 'function', 'private.has_role'),
    ('20261106000100', 'function', 'private.can_write'),
    ('20261106000100', 'function', 'private.is_admin'),
    ('20261106000100', 'function', 'private.shares_tenant_with'),
    ('20261106000100', 'function', 'private.protect_identity'),
    ('20261106000100', 'function', 'private.reject_mutation'),
    ('20261106000100', 'function', 'private.ensure_partitions'),
    ('20261106000100', 'function', 'private.audit_row'),
    ('20261106000100', 'function', 'private.log_action'),
    ('20261106000200', 'table', 'public.organizations'),
    ('20261106000200', 'table', 'public.contacts'),
    ('20261106000200', 'table', 'public.contact_identities'),
    ('20261106000200', 'table', 'public.integration_accounts'),
    ('20261106000200', 'table', 'public.conversations'),
    ('20261106000200', 'table', 'public.pack_versions'),
    ('20261106000200', 'table', 'public.assessment_runs'),
    ('20261106000200', 'table', 'public.pipelines'),
    ('20261106000200', 'table', 'public.pipeline_stages'),
    ('20261106000200', 'table', 'public.leads'),
    ('20261106000200', 'table', 'public.customers'),
    ('20261106000200', 'table', 'public.opportunities'),
    ('20261106000200', 'table', 'public.opportunity_stage_history'),
    ('20261106000200', 'table', 'public.activities'),
    ('20261106000200', 'table', 'public.tasks'),
    ('20261106000200', 'table', 'public.tags'),
    ('20261106000200', 'table', 'public.contact_tags'),
    ('20261106000300', 'table', 'public.messages'),
    ('20261106000300', 'table', 'public.inbound_events'),
    ('20261106000300', 'table', 'public.inbound_dedup'),
    ('20261106000300', 'table', 'public.attachments'),
    ('20261106000300', 'table', 'public.approval_requests'),
    ('20261106000300', 'table', 'public.outbox_messages'),
    ('20261106000300', 'table', 'public.work_agreements'),
    ('20261106000300', 'table', 'public.authorizations'),
    ('20261106000300', 'table', 'public.consent_records'),
    ('20261106000300', 'table', 'public.data_requests'),
    ('20261106000300', 'table', 'public.handoffs'),
    ('20261106000300', 'table', 'public.invitations'),
    ('20261106000300', 'table', 'public.metrics_daily'),
    ('20261106000400', 'function', 'private.require_member'),
    ('20261106000400', 'function', 'private.require_write'),
    ('20261106000400', 'function', 'private.require_admin'),
    ('20261106000400', 'function', 'private.jwt_email'),
    ('20261106000400', 'function', 'public.session_bootstrap'),
    ('20261106000400', 'function', 'public.create_company'),
    ('20261106000400', 'function', 'public.update_company'),
    ('20261106000400', 'function', 'public.delete_company'),
    ('20261106000400', 'function', 'public.list_team'),
    ('20261106000400', 'function', 'public.invite_member'),
    ('20261106000400', 'function', 'public.set_member_role'),
    ('20261106000400', 'function', 'public.remove_member'),
    ('20261106000400', 'function', 'public.revoke_invitation'),
    ('20261106000400', 'function', 'public.capture_prospect'),
    ('20261106000400', 'function', 'public.advance_lead'),
    ('20261106000400', 'function', 'private.default_stage'),
    ('20261106000400', 'function', 'private.ensure_customer'),
    ('20261106000400', 'function', 'public.create_opportunity'),
    ('20261106000400', 'function', 'public.move_opportunity'),
    ('20261106000400', 'function', 'public.win_lead'),
    ('20261106000400', 'function', 'public.create_client'),
    ('20261106000400', 'function', 'public.update_client'),
    ('20261106000400', 'function', 'public.erase_contact'),
    ('20261106000400', 'function', 'public.decide_approval'),
    ('20261106000400', 'function', 'public.start_assistant_conversation'),
    ('20261106000400', 'function', 'public.append_message'),
    ('20261106000400', 'function', 'public.list_conversations'),
    ('20261106000400', 'function', 'public.list_messages'),
    ('20261106000400', 'function', 'public.list_leads'),
    ('20261106000400', 'function', 'public.list_clients'),
    ('20261106000400', 'function', 'public.dashboard_digest'),
    ('20261106000400', 'function', 'public.save_assessment'),
    ('20261106000400', 'function', 'public.list_assessments'),
    ('20261106000400', 'function', 'public.delete_assistant_conversation'),
    ('20261106000400', 'function', 'public.list_activity'),
    ('20261106000400', 'function', 'public.ingest_inbound_event'),
    ('20261106000400', 'function', 'public.maintain_partitions'),
    ('20261110000100', 'table', 'public.platform_events'),
    ('20261110000100', 'table', 'public.platform_audit'),
    ('20261110000100', 'table', 'public.storage_objects'),
    ('20261110000100', 'function', 'public.append_platform_events'),
    ('20261110000100', 'function', 'public.append_platform_audit'),
    ('20261110000100', 'function', 'public.register_storage_object'),
    ('20261110000100', 'function', 'public.retire_storage_object'),
    ('20261110000100', 'function', 'public.delete_company'),
    ('20261118000100', 'table', 'public.ai_budget_periods'),
    ('20261118000100', 'table', 'public.ai_reservations'),
    ('20261118000100', 'table', 'public.ai_usage_attempts'),
    ('20261118000100', 'function', 'private.ai_budget_period'),
    ('20261118000100', 'function', 'public.reserve_ai_budget'),
    ('20261118000100', 'function', 'public.settle_ai_budget'),
    ('20261118000100', 'function', 'public.release_ai_budget'),
    ('20261118000100', 'function', 'public.write_off_ai_reservation'),
    ('20261118000100', 'function', 'public.assign_ai_budget'),
    ('20261118000100', 'function', 'public.assign_ai_call_cap'),
    ('20261118000100', 'function', 'public.expire_ai_reservations')
)
select e.migration, e.kind, e.name,
       case e.kind
         when 'table' then to_regclass(e.name) is not null
         else exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = e.name)
       end as existe
from expected e
order by existe, e.migration, e.kind, e.name;

-- PARTE 3: otras tablas del esquema public que NO pertenecen a ninguna migración del repositorio (p. ej. restos del spike).
select c.relname as tabla_no_gestionada_por_migraciones
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
  and ('public.' || c.relname) not in (
    'public.tenants', 'public.memberships', 'public.business_profiles', 'public.business_profiles', 'public.action_log', 'public.audit_log', 'public.user_profiles', 'public.organizations', 'public.contacts', 'public.contact_identities', 'public.integration_accounts', 'public.conversations', 'public.pack_versions', 'public.assessment_runs', 'public.pipelines', 'public.pipeline_stages', 'public.leads', 'public.customers', 'public.opportunities', 'public.opportunity_stage_history', 'public.activities', 'public.tasks', 'public.tags', 'public.contact_tags', 'public.messages', 'public.inbound_events', 'public.inbound_dedup', 'public.attachments', 'public.approval_requests', 'public.outbox_messages', 'public.work_agreements', 'public.authorizations', 'public.consent_records', 'public.data_requests', 'public.handoffs', 'public.invitations', 'public.metrics_daily', 'public.platform_events', 'public.platform_audit', 'public.storage_objects', 'public.ai_budget_periods', 'public.ai_reservations', 'public.ai_usage_attempts'
  )
order by 1;

-- PARTE 4: columnas que añaden las migraciones de "mejora" (no crean objetos nuevos, así que la parte 1 no las distingue).
select migration, tabla, columna,
       exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = v.tabla and c.column_name = v.columna) as existe
from (values
  ('20261102000000', 'tenants', 'status'), ('20261102000000', 'tenants', 'updated_at'),
  ('20261102000000', 'memberships', 'role'), ('20261102000000', 'memberships', 'created_at'), ('20261102000000', 'memberships', 'updated_at'),
  ('20261106000100', 'tenants', 'slug')
) as v(migration, tabla, columna)
order by existe, migration, tabla, columna;

-- PARTE 5: columnas de `20261118000100_ai_budget.sql` (tope de llamadas). Si esta migración no está aplicada, las partes 1 y 2 ya la dan por ausente y esta devuelve 0 filas.
select table_name as tabla, column_name as columna
from information_schema.columns
where table_schema = 'public' and table_name = 'ai_budget_periods' and column_name in ('max_calls', 'calls_used')
order by column_name;
