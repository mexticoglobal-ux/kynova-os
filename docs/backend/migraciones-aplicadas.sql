-- SOLO LECTURA (solo SELECT): no crea, cambia ni borra nada y no lee datos de empresas, solo nombres de objetos. Pegar entero en el SQL Editor del proyecto y pulsar Run.
-- Generado desde supabase/migrations/*.sql. Cada fila es una migración: sus objetos (t: tabla, f: función, c: columna que añade) y si existen AHORA.
-- "objetos" = lo que hay en la base; "registro_cli" = lo que el registro de la CLI de Supabase dice haber aplicado. Son cosas distintas: una migración pegada a mano tiene objetos pero no registro.
-- Si no existe el registro de la CLI, la consulta no falla: dice "no hay registro de la CLI".
with esperado(migracion, items) as (
  values
  ('20261031000000', array['t:public.tenants', 't:public.memberships', 't:public.business_profiles', 'f:private.is_member', 'f:private.is_owner', 'f:private.touch_updated_at']),
  ('20261102000000', array['t:public.business_profiles', 'f:private.is_member', 'f:private.is_owner', 'f:private.touch_updated_at', 'c:tenants.status', 'c:tenants.updated_at', 'c:memberships.role', 'c:memberships.created_at', 'c:memberships.updated_at']),
  ('20261106000100', array['t:public.action_log', 't:public.audit_log', 't:public.user_profiles', 'f:private.uuid_v7', 'f:private.has_role', 'f:private.can_write', 'f:private.is_admin', 'f:private.shares_tenant_with', 'f:private.protect_identity', 'f:private.reject_mutation', 'f:private.ensure_partitions', 'f:private.audit_row', 'f:private.log_action', 'c:tenants.slug']),
  ('20261106000200', array['t:public.organizations', 't:public.contacts', 't:public.contact_identities', 't:public.integration_accounts', 't:public.conversations', 't:public.pack_versions', 't:public.assessment_runs', 't:public.pipelines', 't:public.pipeline_stages', 't:public.leads', 't:public.customers', 't:public.opportunities', 't:public.opportunity_stage_history', 't:public.activities', 't:public.tasks', 't:public.tags', 't:public.contact_tags']),
  ('20261106000300', array['t:public.messages', 't:public.inbound_events', 't:public.inbound_dedup', 't:public.attachments', 't:public.approval_requests', 't:public.outbox_messages', 't:public.work_agreements', 't:public.authorizations', 't:public.consent_records', 't:public.data_requests', 't:public.handoffs', 't:public.invitations', 't:public.metrics_daily']),
  ('20261106000400', array['f:private.require_member', 'f:private.require_write', 'f:private.require_admin', 'f:private.jwt_email', 'f:public.session_bootstrap', 'f:public.create_company', 'f:public.update_company', 'f:public.delete_company', 'f:public.list_team', 'f:public.invite_member', 'f:public.set_member_role', 'f:public.remove_member', 'f:public.revoke_invitation', 'f:public.capture_prospect', 'f:public.advance_lead', 'f:private.default_stage', 'f:private.ensure_customer', 'f:public.create_opportunity', 'f:public.move_opportunity', 'f:public.win_lead', 'f:public.create_client', 'f:public.update_client', 'f:public.erase_contact', 'f:public.decide_approval', 'f:public.start_assistant_conversation', 'f:public.append_message', 'f:public.list_conversations', 'f:public.list_messages', 'f:public.list_leads', 'f:public.list_clients', 'f:public.dashboard_digest', 'f:public.save_assessment', 'f:public.list_assessments', 'f:public.delete_assistant_conversation', 'f:public.list_activity', 'f:public.ingest_inbound_event', 'f:public.maintain_partitions']),
  ('20261110000100', array['t:public.platform_events', 't:public.platform_audit', 't:public.storage_objects', 'f:public.append_platform_events', 'f:public.append_platform_audit', 'f:public.register_storage_object', 'f:public.retire_storage_object', 'f:public.delete_company']),
  ('20261118000100', array['t:public.ai_budget_periods', 't:public.ai_reservations', 't:public.ai_usage_attempts', 'f:private.ai_budget_period', 'f:public.reserve_ai_budget', 'f:public.settle_ai_budget', 'f:public.release_ai_budget', 'f:public.write_off_ai_reservation', 'f:public.assign_ai_budget', 'f:public.assign_ai_call_cap', 'f:public.expire_ai_reservations', 'c:ai_budget_periods.max_calls', 'c:ai_budget_periods.calls_used'])
), chequeo as (
  select e.migracion, i as item,
         case left(i, 1)
           when 't' then to_regclass(substr(i, 3)) is not null
           when 'f' then exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = substr(i, 3))
           else exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = split_part(substr(i, 3), '.', 1) and c.column_name = split_part(substr(i, 3), '.', 2))
         end as existe
  from esperado e, unnest(e.items) as i
), registro as (
  select case when to_regclass('supabase_migrations.schema_migrations') is not null
              then (select array_agg(v) from unnest(xpath('/table/row/version/text()', query_to_xml('select version from supabase_migrations.schema_migrations', false, false, ''))) as v)
         end::text[] as versiones
)
select c.migracion,
       count(*) as esperados,
       count(*) filter (where c.existe) as presentes,
       case when count(*) filter (where not c.existe) = 0 then 'objetos completos'
            when count(*) filter (where c.existe) = 0 then 'objetos ausentes'
            else 'PARCIAL: revisar' end as objetos,
       case when r.versiones is null then 'no hay registro de la CLI'
            when c.migracion = any (r.versiones) then 'registrada'
            else 'no registrada' end as registro_cli,
       string_agg(substr(c.item, 3), ', ' order by c.item) filter (where not c.existe) as faltan
from chequeo c cross join registro r
group by c.migracion, r.versiones
order by c.migracion;
