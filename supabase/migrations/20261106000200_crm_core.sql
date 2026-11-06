-- Backend Core v1 (ADR-0010) · 2 of 4: identity and CRM core.
-- organizations, contacts, identities, integration accounts, conversations, packs, assessments, pipelines, leads,
-- customers, opportunities, activities, tasks, tags. Every table: tenant_id, RLS, minimum privileges, composite FKs
-- so a row can never point at another tenant's row.
--
-- Reversal plan (development only): drop the tables created here in reverse dependency order.

-- ---------------------------------------------------------------------------
-- Organizations and contacts
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  workspace_id uuid,
  name text not null check (char_length(name) between 1 and 200),
  domain text check (domain is null or char_length(domain) <= 253),
  sector text,
  size_band text,
  country char(2) check (country is null or country ~ '^[A-Z]{2}$'),
  attributes jsonb not null default '{}'::jsonb check (pg_column_size(attributes) < 16384),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create index organizations_name_idx on public.organizations (tenant_id, lower(name));
create index organizations_name_trgm_idx on public.organizations using gin (name extensions.gin_trgm_ops);

-- One person, from anonymous visitor to customer. lifecycle_stage is derived: only the business functions set it.
create table public.contacts (
  id uuid primary key default private.uuid_v7(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  workspace_id uuid,
  organization_id uuid,
  display_name text not null default 'Visitante' check (char_length(display_name) between 1 and 120),
  first_name text check (char_length(first_name) <= 120),
  last_name text check (char_length(last_name) <= 120),
  lifecycle_stage text not null default 'prospect' check (lifecycle_stage in ('prospect', 'lead', 'customer', 'former')),
  locale text,
  country char(2) check (country is null or country ~ '^[A-Z]{2}$'),
  time_zone text,
  owner_user_id uuid references auth.users (id) on delete set null,
  source_provider text,
  source_integration_account_id uuid,
  attributes jsonb not null default '{}'::jsonb check (pg_column_size(attributes) < 16384),
  merged_into_id uuid,
  anonymized_at timestamptz,
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (merged_into_id is null or merged_into_id <> id),
  foreign key (tenant_id, organization_id) references public.organizations (tenant_id, id),
  foreign key (tenant_id, merged_into_id) references public.contacts (tenant_id, id)
);
create index contacts_stage_idx on public.contacts (tenant_id, lifecycle_stage, last_activity_at desc);
create index contacts_owner_idx on public.contacts (tenant_id, owner_user_id) where owner_user_id is not null;
create index contacts_created_idx on public.contacts (tenant_id, created_at desc);
create index contacts_name_trgm_idx on public.contacts using gin (display_name extensions.gin_trgm_ops);

-- Each way of recognising a person. The unique index is the cross-channel deduplication.
create table public.contact_identities (
  id uuid primary key default private.uuid_v7(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contact_id uuid not null,
  kind text not null check (kind in ('email', 'phone', 'whatsapp', 'facebook_psid', 'instagram_igsid', 'web_visitor', 'payment_customer')),
  provider text,
  value_normalized text not null check (char_length(value_normalized) between 1 and 320),
  verified_at timestamptz,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade
);
create unique index contact_identities_key on public.contact_identities (tenant_id, kind, coalesce(provider, ''), value_normalized);
create index contact_identities_contact_idx on public.contact_identities (tenant_id, contact_id);

-- ---------------------------------------------------------------------------
-- Channel and payment connections (nothing connected yet: only the web chat exists)
-- ---------------------------------------------------------------------------

create table public.integration_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  workspace_id uuid,
  category text not null check (category in ('conversation', 'payment')),
  provider text not null check (provider in ('web_chat', 'whatsapp', 'facebook', 'instagram', 'email', 'form', 'stripe', 'paypal', 'makapay', 'makawallet', 'sinpe')),
  display_name text not null check (char_length(display_name) between 1 and 120),
  external_account_id text,
  status text not null default 'pending' check (status in ('pending', 'active', 'paused', 'error', 'revoked')),
  -- A pointer to where the secret lives (Cloudflare or Vault). Never the secret itself.
  secret_ref text check (char_length(secret_ref) <= 200),
  -- sha256 of the key in the inbound URL, so the tenant is resolved without exposing it.
  inbound_key_hash text,
  config jsonb not null default '{}'::jsonb check (pg_column_size(config) < 16384),
  capabilities jsonb not null default '{}'::jsonb check (pg_column_size(capabilities) < 16384),
  last_event_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check ((category = 'conversation' and provider in ('web_chat', 'whatsapp', 'facebook', 'instagram', 'email', 'form'))
      or (category = 'payment' and provider in ('stripe', 'paypal', 'makapay', 'makawallet', 'sinpe')))
);
create unique index integration_accounts_provider_key on public.integration_accounts (provider, external_account_id) where external_account_id is not null;
create unique index integration_accounts_inbound_key on public.integration_accounts (inbound_key_hash) where inbound_key_hash is not null;
create index integration_accounts_tenant_idx on public.integration_accounts (tenant_id, provider);

-- ---------------------------------------------------------------------------
-- Conversations (contact threads and the private NEX assistant threads)
-- ---------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default private.uuid_v7(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  workspace_id uuid,
  -- 'contact': a thread with a prospect or customer. 'assistant': a signed-in user talking to NEX (private to that user).
  kind text not null default 'contact' check (kind in ('contact', 'assistant')),
  integration_account_id uuid,
  contact_id uuid,
  user_id uuid references auth.users (id) on delete cascade,
  title text check (char_length(title) <= 200),
  status text not null default 'open' check (status in ('open', 'waiting', 'handed_off', 'closed', 'quarantined')),
  mode text not null default 'guided' check (mode in ('guided', 'human', 'free')),
  external_thread_id text,
  assigned_user_id uuid references auth.users (id) on delete set null,
  lead_id uuid,
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  window_expires_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check ((kind = 'contact' and contact_id is not null) or (kind = 'assistant' and contact_id is null and user_id is not null)),
  foreign key (tenant_id, integration_account_id) references public.integration_accounts (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id)
);
create unique index conversations_thread_key on public.conversations (tenant_id, integration_account_id, external_thread_id) where external_thread_id is not null;
create index conversations_inbox_idx on public.conversations (tenant_id, status, last_message_at desc) where kind = 'contact';
create index conversations_contact_idx on public.conversations (tenant_id, contact_id, last_message_at desc) where contact_id is not null;
create index conversations_assistant_idx on public.conversations (tenant_id, user_id, last_message_at desc) where kind = 'assistant';

-- ---------------------------------------------------------------------------
-- Client packs and assessments
-- ---------------------------------------------------------------------------

-- The client's own data (catalog, FAQs, qualification rules, hours, messages), versioned and approved. Never code.
create table public.pack_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  kind text not null default 'commercial' check (kind in ('commercial')),
  version integer not null check (version >= 1),
  status text not null default 'draft' check (status in ('draft', 'approved', 'retired')),
  content jsonb not null default '{}'::jsonb check (pg_column_size(content) < 262144),
  content_sha256 text,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, kind, version),
  check (status <> 'approved' or (approved_at is not null and approved_by is not null))
);
create unique index pack_versions_one_approved on public.pack_versions (tenant_id, kind) where status = 'approved';

-- Immutable snapshot of one Business Audit.
create table public.assessment_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contact_id uuid not null,
  lead_id uuid,
  conversation_id uuid,
  engine_version smallint not null default 1,
  pack_version_id uuid,
  basis text not null default 'selfReported' check (basis in ('selfReported')),
  answers jsonb not null check (pg_column_size(answers) < 16384),
  score smallint not null check (score between 0 and 100),
  band text not null check (band in ('initial', 'basic', 'intermediate', 'advanced')),
  infrastructure text not null check (infrastructure in ('none', 'partial', 'established')),
  result jsonb not null default '{}'::jsonb check (pg_column_size(result) < 65536),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  foreign key (tenant_id, pack_version_id) references public.pack_versions (tenant_id, id)
);
create index assessment_runs_contact_idx on public.assessment_runs (tenant_id, contact_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Pipelines, leads, customers, opportunities
-- ---------------------------------------------------------------------------

create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id)
);
create unique index pipelines_one_default on public.pipelines (tenant_id) where is_default;

create table public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  pipeline_id uuid not null,
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null check (char_length(name) between 1 and 120),
  position smallint not null check (position >= 0),
  kind text not null default 'open' check (kind in ('open', 'won', 'lost')),
  default_probability_pct smallint not null default 0 check (default_probability_pct between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (pipeline_id, key),
  foreign key (tenant_id, pipeline_id) references public.pipelines (tenant_id, id) on delete cascade
);
create index pipeline_stages_pipeline_idx on public.pipeline_stages (tenant_id, pipeline_id, position);

-- One episode of commercial interest. A contact has at most one open lead.
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  workspace_id uuid,
  contact_id uuid not null,
  status text not null default 'new' check (status in ('new', 'working', 'qualified', 'disqualified', 'converted', 'spam')),
  source_provider text,
  integration_account_id uuid,
  conversation_id uuid,
  grade text check (grade in ('hot', 'warm', 'cold', 'human')),
  points smallint check (points between 0 and 100),
  qualification jsonb not null default '{}'::jsonb check (pg_column_size(qualification) < 16384),
  pack_version_id uuid,
  assessment_run_id uuid,
  priority text not null default 'medium' check (priority in ('high', 'medium', 'low')),
  challenge text check (char_length(challenge) <= 200),
  question text check (char_length(question) <= 1000),
  owner_user_id uuid references auth.users (id) on delete set null,
  next_action_text text check (char_length(next_action_text) <= 300),
  next_action_at timestamptz,
  disqualified_reason text check (char_length(disqualified_reason) <= 300),
  converted_opportunity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (tenant_id, id),
  check (status <> 'disqualified' or disqualified_reason is not null),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  foreign key (tenant_id, integration_account_id) references public.integration_accounts (tenant_id, id),
  foreign key (tenant_id, conversation_id) references public.conversations (tenant_id, id),
  foreign key (tenant_id, pack_version_id) references public.pack_versions (tenant_id, id),
  foreign key (tenant_id, assessment_run_id) references public.assessment_runs (tenant_id, id)
);
create unique index leads_one_open_per_contact on public.leads (tenant_id, contact_id) where status in ('new', 'working', 'qualified');
create index leads_inbox_idx on public.leads (tenant_id, status, priority, next_action_at);
create index leads_owner_idx on public.leads (tenant_id, owner_user_id, status);
create index leads_created_idx on public.leads (tenant_id, created_at desc);

alter table public.conversations
  add foreign key (tenant_id, lead_id) references public.leads (tenant_id, id);
alter table public.assessment_runs
  add foreign key (tenant_id, lead_id) references public.leads (tenant_id, id);
alter table public.assessment_runs
  add foreign key (tenant_id, conversation_id) references public.conversations (tenant_id, id);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  workspace_id uuid,
  contact_id uuid,
  organization_id uuid,
  status text not null default 'active' check (status in ('active', 'inactive')),
  since date not null default current_date,
  first_opportunity_id uuid,
  notes text check (char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (contact_id is not null or organization_id is not null),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  foreign key (tenant_id, organization_id) references public.organizations (tenant_id, id)
);
create unique index customers_one_active_per_party on public.customers (tenant_id, coalesce(organization_id, contact_id)) where status = 'active';
create index customers_status_idx on public.customers (tenant_id, status, created_at desc);

create table public.opportunities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  workspace_id uuid,
  lead_id uuid,
  contact_id uuid not null,
  organization_id uuid,
  customer_id uuid,
  pipeline_id uuid not null,
  stage_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),
  amount_minor bigint check (amount_minor is null or amount_minor >= 0),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  probability_pct smallint not null default 0 check (probability_pct between 0 and 100),
  expected_close_on date,
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  owner_user_id uuid references auth.users (id) on delete set null,
  next_action_text text check (char_length(next_action_text) <= 300),
  next_action_at timestamptz,
  lost_reason text check (char_length(lost_reason) <= 300),
  won_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  -- Sales rules (docs/modules/sales.md) enforced by the database.
  check (status <> 'open' or (owner_user_id is not null and next_action_at is not null)),
  check (status <> 'lost' or lost_reason is not null),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  foreign key (tenant_id, organization_id) references public.organizations (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id),
  foreign key (tenant_id, pipeline_id) references public.pipelines (tenant_id, id),
  foreign key (tenant_id, stage_id) references public.pipeline_stages (tenant_id, id)
);
create index opportunities_board_idx on public.opportunities (tenant_id, pipeline_id, stage_id, expected_close_on);
create index opportunities_owner_idx on public.opportunities (tenant_id, owner_user_id) where status = 'open';
create index opportunities_contact_idx on public.opportunities (tenant_id, contact_id);
create index opportunities_lead_idx on public.opportunities (tenant_id, lead_id) where lead_id is not null;

alter table public.leads add foreign key (tenant_id, converted_opportunity_id) references public.opportunities (tenant_id, id);
alter table public.customers add foreign key (tenant_id, first_opportunity_id) references public.opportunities (tenant_id, id);

create table public.opportunity_stage_history (
  id uuid primary key default private.uuid_v7(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  opportunity_id uuid not null,
  from_stage_id uuid,
  to_stage_id uuid not null,
  actor_type text not null default 'user' check (actor_type in ('user', 'nex', 'system', 'integration')),
  actor_id uuid,
  changed_at timestamptz not null default now(),
  foreign key (tenant_id, opportunity_id) references public.opportunities (tenant_id, id) on delete cascade
);
create index opportunity_stage_history_idx on public.opportunity_stage_history (tenant_id, opportunity_id, changed_at);

-- ---------------------------------------------------------------------------
-- Activities, tasks, tags
-- ---------------------------------------------------------------------------

create table public.activities (
  id uuid primary key default private.uuid_v7(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contact_id uuid not null,
  lead_id uuid,
  opportunity_id uuid,
  customer_id uuid,
  kind text not null check (kind in ('call', 'meeting', 'email', 'note', 'conversation_summary', 'system')),
  subject text not null check (char_length(subject) between 1 and 300),
  body text check (char_length(body) <= 8000),
  occurred_at timestamptz not null default now(),
  actor_type text not null default 'user' check (actor_type in ('user', 'nex', 'system', 'integration')),
  actor_id uuid,
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) < 16384),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  foreign key (tenant_id, opportunity_id) references public.opportunities (tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id)
);
create index activities_timeline_idx on public.activities (tenant_id, contact_id, occurred_at desc);
create index activities_opportunity_idx on public.activities (tenant_id, opportunity_id, occurred_at desc) where opportunity_id is not null;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contact_id uuid,
  lead_id uuid,
  opportunity_id uuid,
  assignee_user_id uuid references auth.users (id) on delete set null,
  title text not null check (char_length(title) between 1 and 300),
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  completed_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  foreign key (tenant_id, opportunity_id) references public.opportunities (tenant_id, id)
);
create index tasks_assignee_idx on public.tasks (tenant_id, assignee_user_id, due_at) where status = 'open';

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, name)
);

create table public.contact_tags (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  contact_id uuid not null,
  tag_id uuid not null,
  primary key (contact_id, tag_id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id) on delete cascade,
  foreign key (tenant_id, tag_id) references public.tags (tenant_id, id) on delete cascade
);
create index contact_tags_tag_idx on public.contact_tags (tenant_id, tag_id);

-- ---------------------------------------------------------------------------
-- Triggers: updated_at, immutable tenant_id, row audit (personal columns redacted)
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'organizations', 'contacts', 'contact_identities', 'integration_accounts', 'conversations', 'pack_versions',
    'assessment_runs', 'pipelines', 'pipeline_stages', 'leads', 'customers', 'opportunities',
    'opportunity_stage_history', 'activities', 'tasks', 'tags', 'contact_tags'
  ] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.protect_identity()', t || '_protect_tenant', t);
  end loop;

  foreach t in array array['organizations', 'contacts', 'integration_accounts', 'conversations', 'pipelines',
                           'pipeline_stages', 'leads', 'customers', 'opportunities', 'tasks'] loop
    execute format('create trigger %I before update on public.%I for each row execute function private.touch_updated_at()', t || '_touch_updated_at', t);
  end loop;
end $$;

create trigger organizations_audit after insert or update or delete on public.organizations
  for each row execute function private.audit_row('attributes');
create trigger contacts_audit after insert or update or delete on public.contacts
  for each row execute function private.audit_row('display_name', 'first_name', 'last_name', 'attributes');
create trigger leads_audit after insert or update or delete on public.leads
  for each row execute function private.audit_row('question');
create trigger opportunities_audit after insert or update or delete on public.opportunities
  for each row execute function private.audit_row();
create trigger customers_audit after insert or update or delete on public.customers
  for each row execute function private.audit_row('notes');
create trigger pipelines_audit after insert or update or delete on public.pipelines
  for each row execute function private.audit_row();
create trigger pipeline_stages_audit after insert or update or delete on public.pipeline_stages
  for each row execute function private.audit_row();
create trigger integration_accounts_audit after insert or update or delete on public.integration_accounts
  for each row execute function private.audit_row('secret_ref', 'inbound_key_hash');
create trigger pack_versions_audit after insert or update or delete on public.pack_versions
  for each row execute function private.audit_row('content');
create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function private.audit_row();

-- Append-only: assessments and stage history are facts.
create trigger assessment_runs_append_only before update or delete on public.assessment_runs
  for each row execute function private.reject_mutation();
create trigger opportunity_stage_history_append_only before update or delete on public.opportunity_stage_history
  for each row execute function private.reject_mutation();

-- ---------------------------------------------------------------------------
-- Row Level Security and privileges
-- ---------------------------------------------------------------------------

-- Members who can write the commercial data: organizations, contacts, identities, activities, tasks, tags.
select private.apply_tenant_rls('organizations', 'rw');
select private.apply_tenant_rls('contacts', 'rw');
select private.apply_tenant_rls('contact_identities', 'rw_delete');
select private.apply_tenant_rls('activities', 'rw');
select private.apply_tenant_rls('tasks', 'rw_delete');
select private.apply_tenant_rls('tags', 'rw_delete');
select private.apply_tenant_rls('contact_tags', 'rw_delete');
-- Leads, opportunities, customers and conversations change through business functions, plus plain edits of
-- the descriptive fields by writers. Facts (assessments, history) are written only by functions.
select private.apply_tenant_rls('leads', 'rw');
select private.apply_tenant_rls('opportunities', 'rw');
select private.apply_tenant_rls('customers', 'rw');
select private.apply_tenant_rls('assessment_runs', 'read');
select private.apply_tenant_rls('opportunity_stage_history', 'read');
-- Administration data: admins only write.
select private.apply_tenant_rls('integration_accounts', 'admin');
select private.apply_tenant_rls('pack_versions', 'admin');
select private.apply_tenant_rls('pipelines', 'admin');
select private.apply_tenant_rls('pipeline_stages', 'admin');

-- Conversations: members see contact threads; an assistant thread is visible only to its user. Writes by function.
select private.apply_tenant_rls('conversations', 'read');
drop policy conversations_select on public.conversations;
create policy conversations_select on public.conversations
  for select to authenticated
  using ((select private.is_member(tenant_id)) and (kind = 'contact' or user_id = (select auth.uid())));
