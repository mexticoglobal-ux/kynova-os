-- Backend Core v1 (ADR-0010) · 4 of 4: business functions.
-- Every multi-table change (company, team, prospect capture, opportunity, customer, approvals, messages, reads that
-- join several tables) is one function. All are SECURITY DEFINER with an empty search_path and check the caller's
-- membership and role themselves, because they bypass RLS. The API roles can only execute the ones granted below.
--
-- Reversal plan (development only): drop the functions created here (public.* and private.require_*).

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------

create function private.require_member(p_tenant uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$ begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not private.is_member(p_tenant) then raise exception 'forbidden' using errcode = '42501'; end if;
end; $$;

create function private.require_write(p_tenant uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$ begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not private.can_write(p_tenant) then raise exception 'forbidden' using errcode = '42501'; end if;
end; $$;

create function private.require_admin(p_tenant uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$ begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not private.is_admin(p_tenant) then raise exception 'forbidden' using errcode = '42501'; end if;
end; $$;

create function private.jwt_email()
returns text language sql stable set search_path = ''
as $$ select lower(nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email', '')); $$;

-- ---------------------------------------------------------------------------
-- Session and companies
-- ---------------------------------------------------------------------------

-- Called after every sign-in: makes sure the user has a profile, accepts pending invitations for their email
-- and returns the companies they belong to.
create function public.session_bootstrap(p_display_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_email text := private.jwt_email();
  v_name text := nullif(btrim(p_display_name), '');
  inv record;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;

  insert into public.user_profiles (user_id, display_name)
  values (v_uid, coalesce(v_name, nullif(split_part(coalesce(v_email, ''), '@', 1), ''), 'Usuario'))
  on conflict (user_id) do update set display_name = coalesce(v_name, public.user_profiles.display_name);

  if v_email is not null then
    for inv in
      select i.id, i.tenant_id, i.role from public.invitations i
      join public.tenants t on t.id = i.tenant_id and t.status = 'active'
      where i.email = v_email and i.status = 'pending'
    loop
      insert into public.memberships (user_id, tenant_id, role) values (v_uid, inv.tenant_id, inv.role)
      on conflict (user_id, tenant_id) do nothing;
      update public.invitations set status = 'accepted', accepted_at = now(), accepted_by = v_uid where id = inv.id;
      perform private.log_action(inv.tenant_id, 'team.invitation_accepted', 1::smallint, 'Una persona aceptó su invitación', null);
    end loop;
  end if;

  return jsonb_build_object(
    'userId', v_uid,
    'email', v_email,
    'displayName', (select display_name from public.user_profiles where user_id = v_uid),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object('tenantId', t.id, 'name', t.name, 'slug', t.slug, 'role', m.role) order by t.name)
      from public.memberships m join public.tenants t on t.id = m.tenant_id
      where m.user_id = v_uid and t.status = 'active'
    ), '[]'::jsonb)
  );
end;
$$;

-- A signed-in user creates a company and becomes its owner, with a default pipeline and a web chat connection.
create function public.create_company(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(p_name);
  v_base text;
  v_slug text;
  v_tenant uuid;
  v_pipeline uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if v_name is null or char_length(v_name) not between 1 and 120 then raise exception 'invalid name' using errcode = '22023'; end if;
  if (select count(*) from public.memberships where user_id = v_uid and role = 'owner') >= 5 then
    raise exception 'company limit reached' using errcode = '53400';
  end if;

  v_base := btrim(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '-');
  if char_length(v_base) < 2 then v_base := 'empresa'; end if;
  v_slug := left(v_base, 50) || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 5);

  insert into public.tenants (name, slug) values (v_name, v_slug) returning id into v_tenant;
  insert into public.memberships (user_id, tenant_id, role) values (v_uid, v_tenant, 'owner');

  insert into public.pipelines (tenant_id, name, is_default) values (v_tenant, 'Ventas', true) returning id into v_pipeline;
  insert into public.pipeline_stages (tenant_id, pipeline_id, key, name, position, kind, default_probability_pct) values
    (v_tenant, v_pipeline, 'discovery', 'Descubrimiento', 0, 'open', 10),
    (v_tenant, v_pipeline, 'meeting', 'Reunión', 1, 'open', 25),
    (v_tenant, v_pipeline, 'proposal', 'Propuesta', 2, 'open', 50),
    (v_tenant, v_pipeline, 'negotiation', 'Negociación', 3, 'open', 75),
    (v_tenant, v_pipeline, 'won', 'Ganada', 4, 'won', 100),
    (v_tenant, v_pipeline, 'lost', 'Perdida', 5, 'lost', 0);

  insert into public.integration_accounts (tenant_id, category, provider, display_name, status, created_by)
  values (v_tenant, 'conversation', 'web_chat', 'Chat web', 'active', v_uid);
  insert into public.pack_versions (tenant_id, version, status, created_by) values (v_tenant, 1, 'draft', v_uid);

  perform private.log_action(v_tenant, 'company.created', 1::smallint, 'Se creó la empresa ' || v_name);
  return v_tenant;
end;
$$;

create function public.update_company(p_tenant uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_admin(p_tenant);
  if btrim(p_name) = '' or char_length(btrim(p_name)) > 120 then raise exception 'invalid name' using errcode = '22023'; end if;
  update public.tenants set name = btrim(p_name) where id = p_tenant;
  perform private.log_action(p_tenant, 'company.updated', 1::smallint, 'Se cambió el nombre de la empresa');
end;
$$;

-- Owner only, and only after typing the company name. Removes the tenant and every row that belongs to it.
create function public.delete_company(p_tenant uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_name text;
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not private.has_role(p_tenant, array['owner']) then raise exception 'forbidden' using errcode = '42501'; end if;
  select name into v_name from public.tenants where id = p_tenant;
  if v_name is distinct from btrim(p_confirm_name) then raise exception 'confirmation does not match' using errcode = '22023'; end if;

  perform set_config('kynova.allow_log_delete', 'on', true);
  delete from public.messages where tenant_id = p_tenant;
  delete from public.inbound_events where tenant_id = p_tenant;
  delete from public.inbound_dedup where integration_account_id in (select id from public.integration_accounts where tenant_id = p_tenant);
  delete from public.tenants where id = p_tenant;
  -- The cascade fires the audit triggers: clear what it wrote.
  delete from public.action_log where tenant_id = p_tenant;
  delete from public.audit_log where tenant_id = p_tenant;
  perform set_config('kynova.allow_log_delete', 'off', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Team
-- ---------------------------------------------------------------------------

create function public.list_team(p_tenant uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_member(p_tenant);
  return coalesce((
    select jsonb_agg(row order by (row ->> 'role') = 'owner' desc, row ->> 'name')
    from (
      select jsonb_build_object('kind', 'member', 'userId', m.user_id, 'email', u.email,
                                'name', coalesce(p.display_name, split_part(u.email, '@', 1)),
                                'role', m.role, 'since', m.created_at) as row
      from public.memberships m
      join auth.users u on u.id = m.user_id
      left join public.user_profiles p on p.user_id = m.user_id
      where m.tenant_id = p_tenant
      union all
      select jsonb_build_object('kind', 'invitation', 'invitationId', i.id, 'email', i.email, 'name', i.email, 'role', i.role, 'since', i.created_at)
      from public.invitations i
      where i.tenant_id = p_tenant and i.status = 'pending' and private.is_admin(p_tenant)
    ) t
  ), '[]'::jsonb);
end;
$$;

-- Adds the person straight away if they already have an account; otherwise leaves a pending invitation that is
-- accepted when that email signs in.
create function public.invite_member(p_tenant uuid, p_email text, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_user uuid;
begin
  perform private.require_admin(p_tenant);
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' or char_length(v_email) > 254 then raise exception 'invalid email' using errcode = '22023'; end if;
  if p_role not in ('admin', 'member', 'viewer') then raise exception 'invalid role' using errcode = '22023'; end if;
  if p_role = 'admin' and not private.has_role(p_tenant, array['owner']) then raise exception 'only an owner can invite an admin' using errcode = '42501'; end if;

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is not null then
    if exists (select 1 from public.memberships where tenant_id = p_tenant and user_id = v_user) then
      raise exception 'already a member' using errcode = '23505';
    end if;
    insert into public.memberships (user_id, tenant_id, role) values (v_user, p_tenant, p_role);
    perform private.log_action(p_tenant, 'team.member_added', 3::smallint, 'Se agregó a una persona al equipo como ' || p_role);
    return jsonb_build_object('status', 'added');
  end if;

  insert into public.invitations (tenant_id, email, role, invited_by) values (p_tenant, v_email, p_role, (select auth.uid()));
  perform private.log_action(p_tenant, 'team.invited', 3::smallint, 'Se invitó a una persona al equipo como ' || p_role);
  return jsonb_build_object('status', 'invited');
end;
$$;

create function public.set_member_role(p_tenant uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
  v_caller_owner boolean := private.has_role(p_tenant, array['owner']);
begin
  perform private.require_admin(p_tenant);
  if p_role not in ('owner', 'admin', 'member', 'viewer') then raise exception 'invalid role' using errcode = '22023'; end if;
  select role into v_current from public.memberships where tenant_id = p_tenant and user_id = p_user;
  if v_current is null then raise exception 'not a member' using errcode = 'P0002'; end if;
  if (v_current = 'owner' or p_role in ('owner', 'admin')) and not v_caller_owner then
    raise exception 'only an owner can change ownership or admin roles' using errcode = '42501';
  end if;
  if v_current = 'owner' and p_role <> 'owner'
     and (select count(*) from public.memberships where tenant_id = p_tenant and role = 'owner') <= 1 then
    raise exception 'a company needs at least one owner' using errcode = '23514';
  end if;
  update public.memberships set role = p_role where tenant_id = p_tenant and user_id = p_user;
  perform private.log_action(p_tenant, 'team.role_changed', 3::smallint, 'Se cambió el rol de una persona a ' || p_role);
end;
$$;

create function public.remove_member(p_tenant uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current text;
  v_self boolean := p_user = (select auth.uid());
begin
  if (select auth.uid()) is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if v_self then perform private.require_member(p_tenant); else perform private.require_admin(p_tenant); end if;
  select role into v_current from public.memberships where tenant_id = p_tenant and user_id = p_user;
  if v_current is null then raise exception 'not a member' using errcode = 'P0002'; end if;
  if v_current = 'owner' and not v_self and not private.has_role(p_tenant, array['owner']) then
    raise exception 'only an owner can remove an owner' using errcode = '42501';
  end if;
  if v_current = 'owner' and (select count(*) from public.memberships where tenant_id = p_tenant and role = 'owner') <= 1 then
    raise exception 'a company needs at least one owner' using errcode = '23514';
  end if;
  delete from public.memberships where tenant_id = p_tenant and user_id = p_user;
  perform private.log_action(p_tenant, 'team.member_removed', 3::smallint, 'Se quitó a una persona del equipo');
end;
$$;

create function public.revoke_invitation(p_invitation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_tenant uuid;
begin
  select tenant_id into v_tenant from public.invitations where id = p_invitation and status = 'pending';
  if v_tenant is null then raise exception 'not found' using errcode = 'P0002'; end if;
  perform private.require_admin(v_tenant);
  update public.invitations set status = 'revoked' where id = p_invitation;
end;
$$;

-- ---------------------------------------------------------------------------
-- Prospects: one call stores the whole guided conversation, the audit and the handoff
-- ---------------------------------------------------------------------------

create function public.capture_prospect(p_tenant uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := nullif(btrim(p ->> 'name'), '');
  v_business text := nullif(btrim(p ->> 'businessName'), '');
  v_method text := p #>> '{contact,method}';
  v_value text := nullif(btrim(p #>> '{contact,value}'), '');
  v_route text := p ->> 'route';
  v_kind text;
  v_norm text;
  v_org uuid;
  v_contact uuid;
  v_account uuid;
  v_conv uuid;
  v_run uuid;
  v_lead uuid;
  v_approval uuid;
  v_status text;
  v_priority text;
  v_msg jsonb;
  v_i int := 0;
  v_start timestamptz := now();
  v_qualification jsonb;
  v_points smallint := nullif(p #>> '{qualification,points}', '')::smallint;
begin
  perform private.require_write(p_tenant);
  if v_route is null or v_route not in ('hot', 'warm', 'cold', 'human') then raise exception 'invalid route' using errcode = '22023'; end if;
  if jsonb_array_length(coalesce(p -> 'transcript', '[]'::jsonb)) > 200 then raise exception 'transcript too long' using errcode = '22023'; end if;

  -- Who is this? An exact email, phone or WhatsApp match reuses the contact.
  if v_value is not null and v_method in ('email', 'phone', 'whatsapp') then
    v_kind := v_method;
    v_norm := case when v_method = 'email' then lower(v_value) else regexp_replace(v_value, '[^0-9+]', '', 'g') end;
    select contact_id into v_contact from public.contact_identities
    where tenant_id = p_tenant and kind = v_kind and provider is null and value_normalized = v_norm;
  end if;

  if v_contact is null then
    if v_business is not null then
      select id into v_org from public.organizations where tenant_id = p_tenant and lower(name) = lower(v_business) limit 1;
      if v_org is null then
        insert into public.organizations (tenant_id, name) values (p_tenant, left(v_business, 200)) returning id into v_org;
      end if;
    end if;
    insert into public.contacts (tenant_id, organization_id, display_name, source_provider, locale)
    values (p_tenant, v_org, coalesce(left(v_name, 120), 'Visitante'), 'web_chat', null)
    returning id into v_contact;
    insert into public.contact_identities (tenant_id, contact_id, kind, value_normalized, is_primary)
    values (p_tenant, v_contact, coalesce(v_kind, 'web_visitor'), coalesce(v_norm, gen_random_uuid()::text), true);
  else
    update public.contacts set display_name = case when display_name = 'Visitante' and v_name is not null then left(v_name, 120) else display_name end,
                               last_activity_at = now()
    where tenant_id = p_tenant and id = v_contact;
  end if;

  select id into v_account from public.integration_accounts
  where tenant_id = p_tenant and provider = 'web_chat' order by created_at limit 1;

  insert into public.conversations (tenant_id, kind, integration_account_id, contact_id, mode, status, title)
  values (p_tenant, 'contact', v_account, v_contact, 'guided', 'handed_off', 'Chat guiado')
  returning id into v_conv;

  for v_msg in select * from jsonb_array_elements(coalesce(p -> 'transcript', '[]'::jsonb)) loop
    v_i := v_i + 1;
    insert into public.messages (tenant_id, conversation_id, created_at, direction, sender_kind, content_type, body, payload)
    values (p_tenant, v_conv, v_start + (v_i * interval '1 millisecond'),
            v_msg ->> 'direction', v_msg ->> 'senderKind', coalesce(v_msg ->> 'contentType', 'text'),
            left(v_msg ->> 'body', 8000), coalesce(v_msg -> 'payload', '{}'::jsonb));
  end loop;
  update public.conversations set last_message_at = now() where tenant_id = p_tenant and id = v_conv;

  if p -> 'audit' is not null and jsonb_typeof(p -> 'audit') = 'object' then
    insert into public.assessment_runs (tenant_id, contact_id, conversation_id, engine_version, answers, score, band, infrastructure, result, created_by)
    values (p_tenant, v_contact, v_conv, coalesce((p #>> '{audit,engineVersion}')::smallint, 1), p #> '{audit,answers}',
            (p #>> '{audit,score}')::smallint, p #>> '{audit,band}', p #>> '{audit,infrastructure}',
            coalesce(p #> '{audit,result}', '{}'::jsonb), v_uid)
    returning id into v_run;
  end if;

  v_status := case when v_run is not null and v_route in ('hot', 'warm', 'cold') then 'qualified'
                   when v_route = 'human' then 'working' else 'new' end;
  v_priority := case v_route when 'hot' then 'high' when 'human' then 'high' when 'warm' then 'medium' else 'low' end;
  v_qualification := jsonb_build_object('inputs', p -> 'qualification', 'reasons', coalesce(p -> 'reasons', '[]'::jsonb),
                                        'services', coalesce(p -> 'services', '[]'::jsonb),
                                        'topGaps', coalesce(p #> '{audit,topGaps}', '[]'::jsonb),
                                        'intent', p ->> 'intent', 'treatment', p ->> 'treatment');

  select id into v_lead from public.leads
  where tenant_id = p_tenant and contact_id = v_contact and status in ('new', 'working', 'qualified');
  if v_lead is null then
    insert into public.leads (tenant_id, contact_id, status, source_provider, integration_account_id, conversation_id, grade, points,
                              qualification, assessment_run_id, priority, challenge, question, next_action_text, next_action_at)
    values (p_tenant, v_contact, v_status, 'web_chat', v_account, v_conv, v_route, v_points, v_qualification, v_run, v_priority,
            left(p ->> 'challenge', 200), left(p ->> 'question', 1000), left(p ->> 'nextStep', 300), now() + interval '1 day')
    returning id into v_lead;
  else
    update public.leads set status = v_status, grade = v_route, points = v_points, qualification = v_qualification,
                            assessment_run_id = coalesce(v_run, assessment_run_id), priority = v_priority,
                            conversation_id = v_conv, challenge = coalesce(left(p ->> 'challenge', 200), challenge),
                            question = coalesce(left(p ->> 'question', 1000), question),
                            next_action_text = left(p ->> 'nextStep', 300), next_action_at = now() + interval '1 day'
    where tenant_id = p_tenant and id = v_lead;
  end if;

  update public.conversations set lead_id = v_lead where tenant_id = p_tenant and id = v_conv;
  update public.contacts set lifecycle_stage = case when lifecycle_stage in ('prospect', 'former') then 'lead' else lifecycle_stage end
  where tenant_id = p_tenant and id = v_contact;

  insert into public.handoffs (tenant_id, lead_id, conversation_id, route, snapshot)
  values (p_tenant, v_lead, v_conv, v_route, coalesce(p -> 'handoff', '{}'::jsonb));

  if nullif(p ->> 'meetingDraft', '') is not null and v_route in ('hot', 'warm') and v_value is not null then
    -- A newer conversation replaces the request that was still waiting.
    update public.approval_requests set status = 'expired', decided_at = now()
    where tenant_id = p_tenant and lead_id = v_lead and kind = 'meeting_request' and status = 'pending';
    insert into public.approval_requests (tenant_id, kind, lead_id, conversation_id, draft, requested_by_actor_type)
    values (p_tenant, 'meeting_request', v_lead, v_conv, jsonb_build_object('text', left(p ->> 'meetingDraft', 4000)), 'nex')
    returning id into v_approval;
  end if;

  if nullif(p ->> 'noticeVersion', '') is not null then
    insert into public.consent_records (tenant_id, contact_id, purpose, notice_version, status, integration_account_id, conversation_id)
    values (p_tenant, v_contact, 'data_processing', left(p ->> 'noticeVersion', 60), 'granted', v_account, v_conv);
  end if;

  insert into public.activities (tenant_id, contact_id, lead_id, kind, subject, body, actor_type)
  values (p_tenant, v_contact, v_lead, 'conversation_summary', 'Conversación guiada con NEX', left(p ->> 'summary', 8000), 'nex');

  perform private.log_action(p_tenant, 'prospect.captured', 1::smallint, 'NEX recibió y preparó a un prospecto',
                             'Conversación guiada completada', v_contact, v_lead, null, v_conv, v_approval, 'nex');

  return jsonb_build_object('contactId', v_contact, 'leadId', v_lead, 'conversationId', v_conv,
                            'assessmentRunId', v_run, 'approvalRequestId', v_approval);
end;
$$;

-- ---------------------------------------------------------------------------
-- Leads, opportunities and customers
-- ---------------------------------------------------------------------------

create function public.advance_lead(p_lead uuid, p_status text, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare r public.leads;
begin
  select * into r from public.leads where id = p_lead;
  if r.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  perform private.require_write(r.tenant_id);
  if r.status not in ('new', 'working', 'qualified') then raise exception 'lead is closed' using errcode = '23514'; end if;
  if p_status not in ('working', 'qualified', 'disqualified', 'spam') then raise exception 'invalid status' using errcode = '22023'; end if;
  if p_status in ('disqualified', 'spam') and nullif(btrim(p_reason), '') is null then raise exception 'a reason is required' using errcode = '22023'; end if;

  update public.leads set status = p_status, disqualified_reason = case when p_status in ('disqualified', 'spam') then left(btrim(p_reason), 300) end,
                          closed_at = case when p_status in ('disqualified', 'spam') then now() end
  where id = p_lead;
  if p_status in ('disqualified', 'spam') then
    update public.contacts set lifecycle_stage = 'prospect' where tenant_id = r.tenant_id and id = r.contact_id and lifecycle_stage = 'lead';
    if p_status = 'spam' then
      update public.conversations set status = 'quarantined' where tenant_id = r.tenant_id and id = r.conversation_id;
    end if;
  end if;
  perform private.log_action(r.tenant_id, 'lead.' || p_status, 3::smallint, 'Se cambió el estado de un prospecto a ' || p_status, p_reason, r.contact_id, p_lead);
end;
$$;

create function private.default_stage(p_tenant uuid, p_kind text)
returns table (pipeline_id uuid, stage_id uuid, probability smallint)
language sql stable security definer set search_path = ''
as $$
  select s.pipeline_id, s.id, s.default_probability_pct
  from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id and p.tenant_id = s.tenant_id
  where s.tenant_id = p_tenant and p.is_default and s.kind = p_kind
  order by s.position limit 1;
$$;

-- Creates or extends the customer for a won opportunity (one active customer per person or organization).
create function private.ensure_customer(p_tenant uuid, p_contact uuid, p_org uuid, p_opportunity uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_customer uuid;
begin
  select id into v_customer from public.customers
  where tenant_id = p_tenant and status = 'active' and coalesce(organization_id, contact_id) = coalesce(p_org, p_contact);
  if v_customer is null then
    insert into public.customers (tenant_id, contact_id, organization_id, first_opportunity_id)
    values (p_tenant, p_contact, p_org, p_opportunity) returning id into v_customer;
  end if;
  update public.contacts set lifecycle_stage = 'customer' where tenant_id = p_tenant and id = p_contact;
  return v_customer;
end;
$$;

create function public.create_opportunity(
  p_lead uuid, p_title text, p_amount_minor bigint default null, p_currency text default 'USD',
  p_expected_close_on date default null, p_next_action_text text default null, p_next_action_at timestamptz default null,
  p_owner uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leads;
  v_org uuid;
  v_stage record;
  v_opp uuid;
  v_owner uuid := coalesce(p_owner, (select auth.uid()));
begin
  select * into r from public.leads where id = p_lead;
  if r.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  perform private.require_write(r.tenant_id);
  if r.status not in ('new', 'working', 'qualified') then raise exception 'lead is closed' using errcode = '23514'; end if;
  if v_owner is not null and not exists (select 1 from public.memberships where tenant_id = r.tenant_id and user_id = v_owner) then
    raise exception 'owner is not a member' using errcode = '22023';
  end if;
  select organization_id into v_org from public.contacts where tenant_id = r.tenant_id and id = r.contact_id;
  select * into v_stage from private.default_stage(r.tenant_id, 'open');
  if v_stage.stage_id is null then raise exception 'no pipeline configured' using errcode = 'P0002'; end if;

  insert into public.opportunities (tenant_id, lead_id, contact_id, organization_id, pipeline_id, stage_id, title, amount_minor, currency,
                                    probability_pct, expected_close_on, owner_user_id, next_action_text, next_action_at)
  values (r.tenant_id, p_lead, r.contact_id, v_org, v_stage.pipeline_id, v_stage.stage_id, left(btrim(p_title), 200), p_amount_minor, p_currency,
          v_stage.probability, p_expected_close_on, v_owner,
          coalesce(left(p_next_action_text, 300), 'Preparar la primera reunión'), coalesce(p_next_action_at, now() + interval '2 days'))
  returning id into v_opp;

  insert into public.opportunity_stage_history (tenant_id, opportunity_id, to_stage_id, actor_id) values (r.tenant_id, v_opp, v_stage.stage_id, (select auth.uid()));
  update public.leads set status = 'converted', converted_opportunity_id = v_opp, closed_at = now() where id = p_lead;
  perform private.log_action(r.tenant_id, 'opportunity.created', 3::smallint, 'Se creó una oportunidad a partir de un prospecto', null, r.contact_id, p_lead, v_opp);
  return v_opp;
end;
$$;

create function public.move_opportunity(p_opportunity uuid, p_stage uuid, p_lost_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.opportunities;
  s public.pipeline_stages;
  v_customer uuid;
begin
  select * into o from public.opportunities where id = p_opportunity;
  if o.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  perform private.require_write(o.tenant_id);
  if o.status <> 'open' then raise exception 'opportunity is closed' using errcode = '23514'; end if;
  select * into s from public.pipeline_stages where id = p_stage and tenant_id = o.tenant_id and pipeline_id = o.pipeline_id;
  if s.id is null then raise exception 'invalid stage' using errcode = '22023'; end if;
  if s.kind = 'lost' and nullif(btrim(p_lost_reason), '') is null then raise exception 'a reason is required' using errcode = '22023'; end if;

  update public.opportunities set
    stage_id = s.id, probability_pct = s.default_probability_pct,
    status = case s.kind when 'won' then 'won' when 'lost' then 'lost' else 'open' end,
    won_at = case when s.kind = 'won' then now() end,
    closed_at = case when s.kind in ('won', 'lost') then now() end,
    lost_reason = case when s.kind = 'lost' then left(btrim(p_lost_reason), 300) end,
    next_action_text = case when s.kind = 'open' then next_action_text end,
    next_action_at = case when s.kind = 'open' then next_action_at end
  where id = o.id;
  insert into public.opportunity_stage_history (tenant_id, opportunity_id, from_stage_id, to_stage_id, actor_id)
  values (o.tenant_id, o.id, o.stage_id, s.id, (select auth.uid()));

  if s.kind = 'won' then
    v_customer := private.ensure_customer(o.tenant_id, o.contact_id, o.organization_id, o.id);
    update public.opportunities set customer_id = v_customer where id = o.id;
  elsif s.kind = 'lost' then
    update public.contacts set lifecycle_stage = 'lead'
    where tenant_id = o.tenant_id and id = o.contact_id and lifecycle_stage = 'prospect';
  end if;
  perform private.log_action(o.tenant_id, 'opportunity.' || s.kind || '_stage', 3::smallint, 'Una oportunidad pasó a la etapa ' || s.name, p_lost_reason, o.contact_id, o.lead_id, o.id);
end;
$$;

-- The one-click path used by the UI: opportunity created and won, customer created, in one transaction.
create function public.win_lead(p_lead uuid, p_title text default null, p_amount_minor bigint default null, p_currency text default 'USD')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.leads;
  v_name text;
  v_opp uuid;
  v_stage uuid;
  v_customer uuid;
begin
  select * into r from public.leads where id = p_lead;
  if r.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  select display_name into v_name from public.contacts where tenant_id = r.tenant_id and id = r.contact_id;
  v_opp := public.create_opportunity(p_lead, coalesce(nullif(btrim(p_title), ''), 'Venta a ' || v_name), p_amount_minor, p_currency);
  select stage_id into v_stage from private.default_stage(r.tenant_id, 'won');
  if v_stage is null then raise exception 'no won stage configured' using errcode = 'P0002'; end if;
  perform public.move_opportunity(v_opp, v_stage);
  select customer_id into v_customer from public.opportunities where id = v_opp;
  return jsonb_build_object('opportunityId', v_opp, 'customerId', v_customer, 'contactId', r.contact_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Clients (customers with their contact and organization)
-- ---------------------------------------------------------------------------

create function public.create_client(p_tenant uuid, p_name text, p_email text default null, p_phone text default null,
                                     p_organization text default null, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(p_name);
  v_org uuid;
  v_contact uuid;
  v_customer uuid;
  v_email text := nullif(lower(btrim(p_email)), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
begin
  perform private.require_write(p_tenant);
  if v_name is null or char_length(v_name) not between 1 and 120 then raise exception 'invalid name' using errcode = '22023'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then raise exception 'invalid email' using errcode = '22023'; end if;

  if v_email is not null then
    select contact_id into v_contact from public.contact_identities where tenant_id = p_tenant and kind = 'email' and provider is null and value_normalized = v_email;
  end if;
  if v_contact is not null and exists (select 1 from public.customers where tenant_id = p_tenant and status = 'active' and contact_id = v_contact) then
    raise exception 'client already exists' using errcode = '23505';
  end if;

  if nullif(btrim(p_organization), '') is not null then
    select id into v_org from public.organizations where tenant_id = p_tenant and lower(name) = lower(btrim(p_organization)) limit 1;
    if v_org is null then insert into public.organizations (tenant_id, name) values (p_tenant, btrim(p_organization)) returning id into v_org; end if;
  end if;

  if v_contact is null then
    insert into public.contacts (tenant_id, organization_id, display_name, lifecycle_stage) values (p_tenant, v_org, v_name, 'customer') returning id into v_contact;
    if v_email is not null then insert into public.contact_identities (tenant_id, contact_id, kind, value_normalized, is_primary) values (p_tenant, v_contact, 'email', v_email, true); end if;
    if v_phone is not null then
      insert into public.contact_identities (tenant_id, contact_id, kind, value_normalized, is_primary) values (p_tenant, v_contact, 'phone', v_phone, v_email is null)
      on conflict do nothing;
    end if;
  else
    update public.contacts set lifecycle_stage = 'customer', organization_id = coalesce(v_org, organization_id) where tenant_id = p_tenant and id = v_contact;
  end if;

  insert into public.customers (tenant_id, contact_id, organization_id, notes) values (p_tenant, v_contact, v_org, left(p_notes, 2000)) returning id into v_customer;
  perform private.log_action(p_tenant, 'client.created', 3::smallint, 'Se registró un cliente', null, v_contact);
  return v_customer;
end;
$$;

-- p holds only the fields to change: name, organization, notes, status, email, phone.
create function public.update_client(p_customer uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.customers;
  v_org uuid;
  v_status text := p ->> 'status';
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  perform private.require_write(c.tenant_id);
  if v_status is not null and v_status not in ('active', 'inactive') then raise exception 'invalid status' using errcode = '22023'; end if;

  if p ? 'name' then
    if nullif(btrim(p ->> 'name'), '') is null or char_length(btrim(p ->> 'name')) > 120 then raise exception 'invalid name' using errcode = '22023'; end if;
    update public.contacts set display_name = btrim(p ->> 'name') where tenant_id = c.tenant_id and id = c.contact_id;
  end if;
  if p ? 'organization' then
    if nullif(btrim(p ->> 'organization'), '') is null then v_org := null;
    else
      select id into v_org from public.organizations where tenant_id = c.tenant_id and lower(name) = lower(btrim(p ->> 'organization')) limit 1;
      if v_org is null then insert into public.organizations (tenant_id, name) values (c.tenant_id, btrim(p ->> 'organization')) returning id into v_org; end if;
    end if;
    update public.contacts set organization_id = v_org where tenant_id = c.tenant_id and id = c.contact_id;
    update public.customers set organization_id = v_org where id = c.id and (v_org is not null or c.contact_id is not null);
  end if;
  if p ? 'email' and nullif(btrim(p ->> 'email'), '') is not null then
    if lower(btrim(p ->> 'email')) !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then raise exception 'invalid email' using errcode = '22023'; end if;
    delete from public.contact_identities where tenant_id = c.tenant_id and contact_id = c.contact_id and kind = 'email' and provider is null;
    insert into public.contact_identities (tenant_id, contact_id, kind, value_normalized, is_primary) values (c.tenant_id, c.contact_id, 'email', lower(btrim(p ->> 'email')), true);
  end if;
  if p ? 'phone' and nullif(btrim(p ->> 'phone'), '') is not null then
    delete from public.contact_identities where tenant_id = c.tenant_id and contact_id = c.contact_id and kind = 'phone' and provider is null;
    insert into public.contact_identities (tenant_id, contact_id, kind, value_normalized) values (c.tenant_id, c.contact_id, 'phone', regexp_replace(p ->> 'phone', '[^0-9+]', '', 'g'));
  end if;
  if p ? 'notes' then update public.customers set notes = left(p ->> 'notes', 2000) where id = c.id; end if;
  if v_status is not null then
    update public.customers set status = v_status where id = c.id;
    update public.contacts set lifecycle_stage = case when v_status = 'active' then 'customer' else 'former' end where tenant_id = c.tenant_id and id = c.contact_id;
  end if;
  perform private.log_action(c.tenant_id, 'client.updated', 3::smallint, 'Se actualizó un cliente', null, c.contact_id);
end;
$$;

-- Removes the personal data of a contact (export/erasure request). The rows stay so history and counts hold.
create function public.erase_contact(p_contact uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare c public.contacts;
begin
  select * into c from public.contacts where id = p_contact;
  if c.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  perform private.require_admin(c.tenant_id);
  update public.contacts set display_name = 'Contacto anonimizado', first_name = null, last_name = null, attributes = '{}'::jsonb, anonymized_at = now()
  where tenant_id = c.tenant_id and id = p_contact;
  delete from public.contact_identities where tenant_id = c.tenant_id and contact_id = p_contact;
  update public.messages set body = null, payload = '{}'::jsonb
  where tenant_id = c.tenant_id and conversation_id in (select id from public.conversations where tenant_id = c.tenant_id and contact_id = p_contact);
  update public.activities set body = null where tenant_id = c.tenant_id and contact_id = p_contact;
  insert into public.data_requests (tenant_id, contact_id, kind, status, requested_by, completed_at, evidence)
  values (c.tenant_id, p_contact, 'erasure', 'completed', (select auth.uid()), now(), jsonb_build_object('method', 'anonymization'));
  perform private.log_action(c.tenant_id, 'contact.erased', 3::smallint, 'Se anonimizó a un contacto por solicitud', null, p_contact);
end;
$$;

-- ---------------------------------------------------------------------------
-- Approvals
-- ---------------------------------------------------------------------------

create function public.decide_approval(p_request uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.approval_requests;
  l public.leads;
begin
  select * into a from public.approval_requests where id = p_request;
  if a.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  perform private.require_admin(a.tenant_id);
  if a.status <> 'pending' then raise exception 'already decided' using errcode = '23514'; end if;

  update public.approval_requests set status = case when p_approve then 'approved' else 'rejected' end,
                                      decided_by = (select auth.uid()), decided_at = now(), decision_note = left(p_note, 500)
  where id = a.id;

  select * into l from public.leads where id = a.lead_id;
  if p_approve and a.kind = 'meeting_request' and l.id is not null then
    -- The channel is not connected yet: the message is recorded as queued and nothing leaves the platform.
    if a.conversation_id is not null then
      insert into public.messages (tenant_id, conversation_id, direction, sender_kind, content_type, body, delivery_status, approval_request_id)
      values (a.tenant_id, a.conversation_id, 'out', 'nex', 'text', a.draft ->> 'text', 'queued', a.id);
    end if;
    insert into public.activities (tenant_id, contact_id, lead_id, kind, subject, body, actor_type)
    values (a.tenant_id, l.contact_id, l.id, 'meeting', 'Solicitud de reunión aprobada', a.draft ->> 'text', 'user');
    update public.leads set status = 'working', next_action_text = 'Esperar la respuesta del prospecto y confirmar la fecha', next_action_at = now() + interval '3 days'
    where id = l.id;
  end if;
  perform private.log_action(a.tenant_id, 'approval.' || case when p_approve then 'approved' else 'rejected' end, 3::smallint,
                             'El propietario ' || case when p_approve then 'aprobó' else 'rechazó' end || ' una solicitud preparada por NEX',
                             p_note, l.contact_id, a.lead_id, null, a.conversation_id, a.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Messages and conversations
-- ---------------------------------------------------------------------------

create function public.start_assistant_conversation(p_tenant uuid, p_title text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  perform private.require_member(p_tenant);
  insert into public.conversations (tenant_id, kind, user_id, mode, title)
  values (p_tenant, 'assistant', (select auth.uid()), 'free', left(coalesce(nullif(btrim(p_title), ''), 'Conversación con NEX'), 200))
  returning id into v_id;
  return v_id;
end;
$$;

create function public.append_message(p_conversation uuid, p_direction text, p_sender_kind text, p_content_type text, p_body text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.conversations;
  v_id uuid;
  v_at timestamptz := now();
begin
  select * into c from public.conversations where id = p_conversation;
  if c.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if c.kind = 'assistant' then
    perform private.require_member(c.tenant_id);
    if c.user_id is distinct from (select auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  else
    perform private.require_write(c.tenant_id);
  end if;
  insert into public.messages (tenant_id, conversation_id, created_at, owner_user_id, direction, sender_kind, sender_user_id, content_type, body, payload)
  values (c.tenant_id, c.id, v_at, case when c.kind = 'assistant' then c.user_id end, p_direction, p_sender_kind,
          case when p_sender_kind = 'user' then (select auth.uid()) end, p_content_type, left(p_body, 8000), coalesce(p_payload, '{}'::jsonb))
  returning id into v_id;
  update public.conversations set last_message_at = v_at, last_inbound_at = case when p_direction = 'in' then v_at else last_inbound_at end,
                                  title = case when kind = 'assistant' and title = 'Conversación con NEX' and p_direction = 'in' then left(p_body, 80) else title end
  where id = c.id;
  return jsonb_build_object('id', v_id, 'createdAt', v_at);
end;
$$;

create function public.list_conversations(p_tenant uuid, p_kind text default 'contact', p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_member(p_tenant);
  return coalesce((
    select jsonb_agg(x order by x ->> 'lastMessageAt' desc)
    from (
      select jsonb_build_object('id', c.id, 'kind', c.kind, 'title', coalesce(c.title, ct.display_name), 'status', c.status, 'mode', c.mode,
                                'contactId', c.contact_id, 'contactName', ct.display_name, 'leadId', c.lead_id,
                                'lastMessageAt', c.last_message_at, 'startedAt', c.started_at) as x
      from public.conversations c left join public.contacts ct on ct.tenant_id = c.tenant_id and ct.id = c.contact_id
      where c.tenant_id = p_tenant and c.kind = p_kind and (c.kind = 'contact' or c.user_id = (select auth.uid()))
      order by c.last_message_at desc limit least(greatest(p_limit, 1), 100)
    ) q
  ), '[]'::jsonb);
end;
$$;

create function public.list_messages(p_conversation uuid, p_limit int default 100, p_before timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare c public.conversations;
begin
  select * into c from public.conversations where id = p_conversation;
  if c.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  perform private.require_member(c.tenant_id);
  if c.kind = 'assistant' and c.user_id is distinct from (select auth.uid()) then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(m order by m ->> 'createdAt')
    from (
      select jsonb_build_object('id', id, 'createdAt', created_at, 'direction', direction, 'senderKind', sender_kind, 'contentType', content_type,
                                'body', body, 'payload', payload, 'deliveryStatus', delivery_status) as m
      from public.messages
      where tenant_id = c.tenant_id and conversation_id = c.id and (p_before is null or created_at < p_before)
      order by created_at desc, id desc limit least(greatest(p_limit, 1), 200)
    ) q
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads that join several tables (keyset pagination, newest first)
-- ---------------------------------------------------------------------------

create function public.list_leads(p_tenant uuid, p_status text default null, p_limit int default 50,
                                  p_after_created_at timestamptz default null, p_after_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_member(p_tenant);
  return coalesce((
    select jsonb_agg(x order by (x ->> 'createdAt') desc, x ->> 'id' desc)
    from (
      select jsonb_build_object(
        'id', l.id, 'contactId', l.contact_id, 'conversationId', l.conversation_id, 'status', l.status, 'grade', l.grade, 'points', l.points,
        'priority', l.priority, 'challenge', l.challenge, 'question', l.question, 'qualification', l.qualification,
        'nextActionText', l.next_action_text, 'nextActionAt', l.next_action_at, 'ownerUserId', l.owner_user_id,
        'ownerName', op.display_name, 'createdAt', l.created_at, 'convertedOpportunityId', l.converted_opportunity_id,
        'contactName', c.display_name, 'company', o.name,
        'email', (select value_normalized from public.contact_identities i where i.tenant_id = l.tenant_id and i.contact_id = l.contact_id and i.kind = 'email' limit 1),
        'phone', (select value_normalized from public.contact_identities i where i.tenant_id = l.tenant_id and i.contact_id = l.contact_id and i.kind in ('phone', 'whatsapp') limit 1),
        'assessment', (select jsonb_build_object('id', a.id, 'score', a.score, 'band', a.band, 'infrastructure', a.infrastructure, 'answers', a.answers, 'createdAt', a.created_at)
                       from public.assessment_runs a where a.tenant_id = l.tenant_id and a.id = l.assessment_run_id),
        'approval', (select jsonb_build_object('id', r.id, 'kind', r.kind, 'draft', r.draft, 'createdAt', r.created_at)
                     from public.approval_requests r where r.tenant_id = l.tenant_id and r.lead_id = l.id and r.status = 'pending' order by r.created_at desc limit 1)
      ) as x
      from public.leads l
      join public.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
      left join public.organizations o on o.tenant_id = c.tenant_id and o.id = c.organization_id
      left join public.user_profiles op on op.user_id = l.owner_user_id
      where l.tenant_id = p_tenant
        and (p_status is null or l.status = p_status)
        and (p_after_created_at is null or (l.created_at, l.id) < (p_after_created_at, p_after_id))
      order by l.created_at desc, l.id desc
      limit least(greatest(p_limit, 1), 100)
    ) q
  ), '[]'::jsonb);
end;
$$;

create function public.list_clients(p_tenant uuid, p_search text default null, p_status text default null, p_limit int default 50,
                                    p_after_created_at timestamptz default null, p_after_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_search text := nullif(btrim(p_search), '');
begin
  perform private.require_member(p_tenant);
  return coalesce((
    select jsonb_agg(x order by (x ->> 'createdAt') desc, x ->> 'id' desc)
    from (
      select jsonb_build_object(
        'id', cu.id, 'contactId', cu.contact_id, 'organizationId', cu.organization_id, 'status', cu.status, 'since', cu.since, 'notes', cu.notes,
        'createdAt', cu.created_at, 'name', c.display_name, 'company', o.name,
        'email', (select value_normalized from public.contact_identities i where i.tenant_id = cu.tenant_id and i.contact_id = cu.contact_id and i.kind = 'email' limit 1),
        'phone', (select value_normalized from public.contact_identities i where i.tenant_id = cu.tenant_id and i.contact_id = cu.contact_id and i.kind in ('phone', 'whatsapp') limit 1),
        'wonAmountMinor', (select coalesce(sum(amount_minor), 0) from public.opportunities op where op.tenant_id = cu.tenant_id and op.customer_id = cu.id and op.status = 'won')
      ) as x
      from public.customers cu
      left join public.contacts c on c.tenant_id = cu.tenant_id and c.id = cu.contact_id
      left join public.organizations o on o.tenant_id = cu.tenant_id and o.id = coalesce(cu.organization_id, c.organization_id)
      where cu.tenant_id = p_tenant
        and (p_status is null or cu.status = p_status)
        and (v_search is null or c.display_name ilike '%' || v_search || '%' or o.name ilike '%' || v_search || '%')
        and (p_after_created_at is null or (cu.created_at, cu.id) < (p_after_created_at, p_after_id))
      order by cu.created_at desc, cu.id desc
      limit least(greatest(p_limit, 1), 100)
    ) q
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Dashboard: what NEX did since the user was last here, and what needs them
-- ---------------------------------------------------------------------------

create function public.dashboard_digest(p_tenant uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_since timestamptz;
  v_result jsonb;
begin
  perform private.require_member(p_tenant);
  select coalesce(last_seen_at, created_at) into v_since from public.user_profiles where user_id = v_uid;
  v_since := coalesce(v_since, now() - interval '1 day');

  v_result := jsonb_build_object(
    'since', v_since,
    'sinceVisit', jsonb_build_object(
      'analyzed', (select count(*) from public.assessment_runs where tenant_id = p_tenant and created_at > v_since),
      'prospects', (select count(*) from public.leads where tenant_id = p_tenant and created_at > v_since),
      'hot', (select count(*) from public.leads where tenant_id = p_tenant and created_at > v_since and grade = 'hot'),
      'conversations', (select count(*) from public.conversations where tenant_id = p_tenant and kind = 'contact' and started_at > v_since),
      'won', (select count(*) from public.opportunities where tenant_id = p_tenant and won_at > v_since)
    ),
    'leads', jsonb_build_object(
      'open', (select count(*) from public.leads where tenant_id = p_tenant and status in ('new', 'working', 'qualified')),
      'hot', (select count(*) from public.leads where tenant_id = p_tenant and status in ('new', 'working', 'qualified') and grade = 'hot'),
      'needFollowUp', (select count(*) from public.leads where tenant_id = p_tenant and status in ('new', 'working', 'qualified') and (next_action_at is null or next_action_at < now())),
      'total', (select count(*) from public.leads where tenant_id = p_tenant)
    ),
    'approvals', jsonb_build_object(
      'pending', (select count(*) from public.approval_requests where tenant_id = p_tenant and status = 'pending'),
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'leadId', r.lead_id, 'contactName', c.display_name, 'createdAt', r.created_at) order by r.created_at desc)
                         from (select * from public.approval_requests where tenant_id = p_tenant and status = 'pending' order by created_at desc limit 10) r
                         left join public.leads l on l.tenant_id = r.tenant_id and l.id = r.lead_id
                         left join public.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id), '[]'::jsonb)
    ),
    'opportunities', jsonb_build_object(
      'open', (select count(*) from public.opportunities where tenant_id = p_tenant and status = 'open'),
      'won', (select count(*) from public.opportunities where tenant_id = p_tenant and status = 'won'),
      'openAmountMinor', (select coalesce(sum(amount_minor), 0) from public.opportunities where tenant_id = p_tenant and status = 'open'),
      'wonAmountMinor', (select coalesce(sum(amount_minor), 0) from public.opportunities where tenant_id = p_tenant and status = 'won')
    ),
    'customers', jsonb_build_object('active', (select count(*) from public.customers where tenant_id = p_tenant and status = 'active')),
    'conversations', jsonb_build_object(
      'open', (select count(*) from public.conversations where tenant_id = p_tenant and kind = 'contact' and status in ('open', 'waiting', 'handed_off')),
      'messagesToday', (select count(*) from public.messages where tenant_id = p_tenant and created_at > now() - interval '1 day' and owner_user_id is null)
    ),
    'activity', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'at', a.occurred_at, 'kind', a.action_kind, 'level', a.level, 'summary', a.summary, 'actor', a.actor_type) order by a.occurred_at desc)
                          from (select * from public.action_log where tenant_id = p_tenant order by occurred_at desc limit 12) a), '[]'::jsonb)
  );

  -- A "visit" lasts 30 minutes: reloading the page must not erase what happened while the user was away.
  update public.user_profiles set last_seen_at = now() where user_id = v_uid and (last_seen_at is null or last_seen_at < now() - interval '30 minutes');
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Inbound integrations and maintenance (server key only; no channel is connected yet)
-- ---------------------------------------------------------------------------

-- Stores an inbound event once. The caller passes the sha256 of the key in the inbound URL; the tenant is resolved
-- here and never comes from the sender. An unknown key answers exactly like a rejected event.
create function public.ingest_inbound_event(p_key_hash text, p_provider text, p_external_event_id text, p_signature_valid boolean, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.integration_accounts;
begin
  select * into a from public.integration_accounts where inbound_key_hash = p_key_hash and provider = p_provider and status = 'active';
  if a.id is null then return jsonb_build_object('status', 'rejected'); end if;
  if not exists (select 1 from public.tenants where id = a.tenant_id and status = 'active') then return jsonb_build_object('status', 'rejected'); end if;

  insert into public.inbound_dedup (integration_account_id, external_event_id) values (a.id, p_external_event_id) on conflict do nothing;
  if not found then return jsonb_build_object('status', 'duplicate'); end if;

  insert into public.inbound_events (tenant_id, integration_account_id, provider, external_event_id, signature_valid, payload)
  values (a.tenant_id, a.id, p_provider, p_external_event_id, p_signature_valid, p_payload);
  update public.integration_accounts set last_event_at = now() where id = a.id;
  return jsonb_build_object('status', 'accepted');
end;
$$;

create function public.maintain_partitions()
returns void
language sql
security definer
set search_path = ''
as $$
  select private.ensure_partitions(t, 0, 3) from unnest(array['messages', 'inbound_events', 'action_log', 'audit_log']) as t;
  delete from public.inbound_dedup where received_at < now() - interval '14 days';
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function
  private.require_member(uuid), private.require_write(uuid), private.require_admin(uuid), private.jwt_email(),
  private.default_stage(uuid, text), private.ensure_customer(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.require_member(uuid), private.require_write(uuid), private.require_admin(uuid), private.jwt_email() to authenticated;

revoke execute on function
  public.session_bootstrap(text), public.create_company(text), public.update_company(uuid, text), public.delete_company(uuid, text),
  public.list_team(uuid), public.invite_member(uuid, text, text), public.set_member_role(uuid, uuid, text), public.remove_member(uuid, uuid),
  public.revoke_invitation(uuid), public.capture_prospect(uuid, jsonb), public.advance_lead(uuid, text, text),
  public.create_opportunity(uuid, text, bigint, text, date, text, timestamptz, uuid), public.move_opportunity(uuid, uuid, text),
  public.win_lead(uuid, text, bigint, text), public.create_client(uuid, text, text, text, text, text), public.update_client(uuid, jsonb),
  public.erase_contact(uuid), public.decide_approval(uuid, boolean, text), public.start_assistant_conversation(uuid, text),
  public.append_message(uuid, text, text, text, text, jsonb), public.list_conversations(uuid, text, int),
  public.list_messages(uuid, int, timestamptz), public.list_leads(uuid, text, int, timestamptz, uuid),
  public.list_clients(uuid, text, text, int, timestamptz, uuid), public.dashboard_digest(uuid),
  public.ingest_inbound_event(text, text, text, boolean, jsonb), public.maintain_partitions()
  from public, anon, authenticated, service_role;

grant execute on function
  public.session_bootstrap(text), public.create_company(text), public.update_company(uuid, text), public.delete_company(uuid, text),
  public.list_team(uuid), public.invite_member(uuid, text, text), public.set_member_role(uuid, uuid, text), public.remove_member(uuid, uuid),
  public.revoke_invitation(uuid), public.capture_prospect(uuid, jsonb), public.advance_lead(uuid, text, text),
  public.create_opportunity(uuid, text, bigint, text, date, text, timestamptz, uuid), public.move_opportunity(uuid, uuid, text),
  public.win_lead(uuid, text, bigint, text), public.create_client(uuid, text, text, text, text, text), public.update_client(uuid, jsonb),
  public.erase_contact(uuid), public.decide_approval(uuid, boolean, text), public.start_assistant_conversation(uuid, text),
  public.append_message(uuid, text, text, text, text, jsonb), public.list_conversations(uuid, text, int),
  public.list_messages(uuid, int, timestamptz), public.list_leads(uuid, text, int, timestamptz, uuid),
  public.list_clients(uuid, text, text, int, timestamptz, uuid), public.dashboard_digest(uuid)
  to authenticated;

-- The server key executes only these two: it never reads or writes a table.
grant execute on function public.ingest_inbound_event(text, text, text, boolean, jsonb), public.maintain_partitions() to service_role;
