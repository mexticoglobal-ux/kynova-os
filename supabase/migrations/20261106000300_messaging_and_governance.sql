-- Backend Core v1 (ADR-0010) · 3 of 4: messaging, approvals, governance and invitations.
-- Partitioned by month: messages, inbound_events. Everything else is a plain table. Writes to the messaging and
-- governance tables go through functions (next migration); members only read.
--
-- Reversal plan (development only): drop the tables created here in reverse dependency order.

-- ---------------------------------------------------------------------------
-- Messages (the largest table: partitioned by month from day one)
-- ---------------------------------------------------------------------------

-- No FK to conversations: a partitioned table cannot be referenced without its partition key. The append_message
-- function checks that the conversation belongs to the tenant, and a scheduled check looks for orphans.
create table public.messages (
  id uuid not null default private.uuid_v7(),
  created_at timestamptz not null default now(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  conversation_id uuid not null,
  -- Set only for private assistant threads: the one user who may read the message.
  owner_user_id uuid,
  direction text not null check (direction in ('in', 'out', 'system')),
  sender_kind text not null check (sender_kind in ('contact', 'user', 'nex', 'system')),
  sender_user_id uuid,
  content_type text not null default 'text' check (content_type in ('text', 'choice', 'template', 'media', 'event')),
  body text check (char_length(body) <= 8000),
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) < 16384),
  provider_message_id text,
  delivery_status text not null default 'sent' check (delivery_status in ('queued', 'sent', 'delivered', 'read', 'failed')),
  error_code text,
  approval_request_id uuid,
  authorization_id uuid,
  primary key (id, created_at)
) partition by range (created_at);
create index messages_thread_idx on public.messages (tenant_id, conversation_id, created_at, id);
create index messages_provider_idx on public.messages (tenant_id, provider_message_id) where provider_message_id is not null;

-- Raw inbound webhook or form payloads, kept briefly to reprocess and debug.
create table public.inbound_events (
  id uuid not null default private.uuid_v7(),
  received_at timestamptz not null default now(),
  tenant_id uuid not null,
  integration_account_id uuid not null,
  provider text not null,
  external_event_id text not null check (char_length(external_event_id) between 1 and 300),
  signature_valid boolean not null,
  payload jsonb not null check (pg_column_size(payload) < 262144),
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  attempts smallint not null default 0,
  error text check (char_length(error) <= 500),
  processed_at timestamptz,
  primary key (id, received_at)
) partition by range (received_at);
create index inbound_events_status_idx on public.inbound_events (tenant_id, status, received_at);

select private.ensure_partitions('messages', 1, 3);
select private.ensure_partitions('inbound_events', 1, 3);

-- A partitioned table cannot enforce uniqueness across partitions, so retries are caught here (pruned by age).
create table public.inbound_dedup (
  integration_account_id uuid not null,
  external_event_id text not null,
  received_at timestamptz not null default now(),
  primary key (integration_account_id, external_event_id)
);
create index inbound_dedup_age_idx on public.inbound_dedup (received_at);

create table public.attachments (
  id uuid primary key default private.uuid_v7(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  message_id uuid not null,
  message_created_at timestamptz not null,
  -- Object key in R2: tenants/{tenant_id}/... The file never lives in the database.
  storage_key text not null check (char_length(storage_key) <= 500),
  mime_type text not null,
  bytes bigint not null check (bytes >= 0),
  sha256 text,
  scan_status text not null default 'pending' check (scan_status in ('pending', 'clean', 'blocked')),
  created_at timestamptz not null default now()
);
create index attachments_message_idx on public.attachments (tenant_id, message_id, message_created_at);

-- ---------------------------------------------------------------------------
-- Outbound queue (transactional outbox). Nothing consumes it yet: no channel is connected.
-- ---------------------------------------------------------------------------

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null check (kind in ('meeting_request', 'first_message', 'opportunity', 'customer_conversion', 'payment_link')),
  lead_id uuid,
  opportunity_id uuid,
  conversation_id uuid,
  draft jsonb not null default '{}'::jsonb check (pg_column_size(draft) < 16384),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired', 'executed')),
  requested_by_actor_type text not null default 'nex' check (requested_by_actor_type in ('user', 'nex', 'system', 'integration')),
  requested_by_actor_id uuid,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text check (char_length(decision_note) <= 500),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (status = 'pending' or decided_at is not null),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  foreign key (tenant_id, opportunity_id) references public.opportunities (tenant_id, id),
  foreign key (tenant_id, conversation_id) references public.conversations (tenant_id, id)
);
create index approval_requests_pending_idx on public.approval_requests (tenant_id, created_at desc) where status = 'pending';

create table public.outbox_messages (
  id uuid primary key default private.uuid_v7(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  integration_account_id uuid not null,
  conversation_id uuid not null,
  payload jsonb not null check (pg_column_size(payload) < 16384),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 200),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempts smallint not null default 0,
  next_attempt_at timestamptz not null default now(),
  -- A message leaves the platform only if someone approved it or an active authorization covers it.
  approval_request_id uuid,
  authorization_id uuid,
  error text check (char_length(error) <= 500),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (tenant_id, idempotency_key),
  check (approval_request_id is not null or authorization_id is not null),
  foreign key (tenant_id, integration_account_id) references public.integration_accounts (tenant_id, id),
  foreign key (tenant_id, conversation_id) references public.conversations (tenant_id, id),
  foreign key (tenant_id, approval_request_id) references public.approval_requests (tenant_id, id)
);
create index outbox_due_idx on public.outbox_messages (next_attempt_at) where status in ('pending', 'sending');

-- ---------------------------------------------------------------------------
-- Governance (ADR-0009 shapes: the Level 2 tables exist but nothing activates them)
-- ---------------------------------------------------------------------------

create table public.work_agreements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'revoked')),
  version integer not null default 1,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);

create table public.authorizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  work_agreement_id uuid not null,
  action_kind text not null check (char_length(action_kind) between 1 and 80),
  scope jsonb not null default '{}'::jsonb check (pg_column_size(scope) < 16384),
  status text not null default 'inactive' check (status in ('inactive', 'active', 'revoked')),
  granted_by uuid references auth.users (id) on delete set null,
  granted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, work_agreement_id) references public.work_agreements (tenant_id, id) on delete cascade
);

create table public.consent_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contact_id uuid not null,
  purpose text not null check (purpose in ('data_processing', 'marketing_email', 'whatsapp_optin')),
  notice_version text not null check (char_length(notice_version) <= 60),
  status text not null check (status in ('granted', 'withdrawn')),
  integration_account_id uuid,
  conversation_id uuid,
  recorded_at timestamptz not null default now(),
  evidence jsonb not null default '{}'::jsonb check (pg_column_size(evidence) < 8192),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade
);
create index consent_records_contact_idx on public.consent_records (tenant_id, contact_id, recorded_at desc);

create table public.data_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contact_id uuid,
  kind text not null check (kind in ('export', 'erasure')),
  status text not null default 'pending' check (status in ('pending', 'completed', 'rejected')),
  requested_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  evidence jsonb not null default '{}'::jsonb check (pg_column_size(evidence) < 8192),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id)
);

-- What the team received for a lead: a frozen copy of the handoff package.
create table public.handoffs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  lead_id uuid not null,
  conversation_id uuid,
  route text not null check (route in ('hot', 'warm', 'cold', 'human')),
  snapshot jsonb not null check (pg_column_size(snapshot) < 65536),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id) on delete cascade
);
create index handoffs_lead_idx on public.handoffs (tenant_id, lead_id, created_at desc);

-- People invited to a company. Accepted automatically when that email signs in (session_bootstrap).
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  email text not null check (email = lower(email) and char_length(email) between 3 and 254),
  role text not null check (role in ('admin', 'member', 'viewer')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null
);
create unique index invitations_one_pending on public.invitations (tenant_id, email) where status = 'pending';

-- Daily rollups so the dashboard never counts big tables on the hot path.
create table public.metrics_daily (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  day date not null,
  metric_key text not null check (char_length(metric_key) between 1 and 80),
  dimension_key text not null default '',
  value bigint not null default 0,
  primary key (tenant_id, day, metric_key, dimension_key)
);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['attachments', 'approval_requests', 'outbox_messages', 'work_agreements', 'authorizations',
                           'consent_records', 'data_requests', 'handoffs', 'invitations'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.protect_identity()', t || '_protect_tenant', t);
  end loop;
  foreach t in array array['approval_requests', 'work_agreements', 'authorizations'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.touch_updated_at()', t || '_touch_updated_at', t);
  end loop;
end $$;

create trigger consent_records_append_only before update or delete on public.consent_records
  for each row execute function private.reject_mutation();
create trigger handoffs_append_only before update or delete on public.handoffs
  for each row execute function private.reject_mutation();
create trigger approval_requests_audit after insert or update or delete on public.approval_requests
  for each row execute function private.audit_row('draft');
create trigger authorizations_audit after insert or update or delete on public.authorizations
  for each row execute function private.audit_row();
create trigger work_agreements_audit after insert or update or delete on public.work_agreements
  for each row execute function private.audit_row();
create trigger invitations_audit after insert or update or delete on public.invitations
  for each row execute function private.audit_row('email');

-- ---------------------------------------------------------------------------
-- Row Level Security and privileges
-- ---------------------------------------------------------------------------

select private.apply_tenant_rls('messages', 'read');
select private.apply_tenant_rls('inbound_events', 'read');
select private.apply_tenant_rls('attachments', 'read');
select private.apply_tenant_rls('approval_requests', 'read');
select private.apply_tenant_rls('outbox_messages', 'read');
select private.apply_tenant_rls('work_agreements', 'admin');
select private.apply_tenant_rls('authorizations', 'admin');
select private.apply_tenant_rls('consent_records', 'read');
select private.apply_tenant_rls('data_requests', 'admin');
select private.apply_tenant_rls('handoffs', 'read');
select private.apply_tenant_rls('invitations', 'read');
select private.apply_tenant_rls('metrics_daily', 'read');

-- Assistant messages are private to their user.
drop policy messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using ((select private.is_member(tenant_id)) and (owner_user_id is null or owner_user_id = (select auth.uid())));

-- Raw inbound payloads hold personal data: the server only. Admins see the invitations they sent.
revoke select on public.inbound_events from authenticated;
drop policy inbound_events_select on public.inbound_events;
drop policy invitations_select on public.invitations;
create policy invitations_select on public.invitations
  for select to authenticated using ((select private.is_admin(tenant_id)));

-- inbound_dedup has no tenant_id: it is internal, with no access for the API roles at all.
alter table public.inbound_dedup enable row level security;
revoke all on table public.inbound_dedup from public, anon, authenticated, service_role;

-- The generic helper has done its job.
drop function private.apply_tenant_rls(text, text);
