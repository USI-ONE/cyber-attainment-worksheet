-- 0018_training.sql
--
-- Security awareness training + phishing-simulation tracking.
--
-- Two tables, one workflow. A `training_campaigns` row is the program
-- (annual awareness, monthly phishing simulation, role-specific module,
-- onboarding). A `training_records` row is one trainee's outcome on that
-- campaign (assigned / complete / overdue / quiz score). For phishing
-- simulations, the aggregate counts live on the campaign itself
-- (recipient_count, clicked_count, reported_count) since most platforms
-- (KnowBe4, Proofpoint) report aggregates by default; per-recipient
-- records are optional.
--
-- This module feeds:
--   - PR.AT-01 / PR.AT-02 (awareness + role-based training)
--   - GV.RR-04 (Personnel policies)
--   - Board KPIs (completion rate, phishing click rate)
--   - Attention Feed (overdue training, low completion campaigns,
--     elevated phishing click rates)
--   - Risks R-005 Insider Threat + R-006 Phishing → Credential Theft

-- =============================================================================
-- training_campaigns
-- =============================================================================

create table if not exists public.training_campaigns (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  name                        text not null,
  kind                        text not null default 'awareness'
                                check (kind in ('awareness','phishing','role_specific','onboarding','tabletop','other')),
  description                 text,
  -- Who delivered the training. Free text for now — usually a vendor
  -- name (KnowBe4, Proofpoint, Curricula) or "Internal".
  vendor                      text,
  -- Lifecycle dates. scheduled_at = when the program runs / ran.
  -- completed_at flips to non-null when the campaign closes.
  scheduled_at                date,
  completed_at                date,
  -- Audience description — typically "All employees", "IT staff",
  -- "Executives & finance". Free text so customers can describe their
  -- own segmentation without a hard schema.
  target_audience             text default 'All employees',
  status                      text not null default 'active'
                                check (status in ('planned','active','completed','archived')),

  -- Aggregate metrics. Populated for phishing campaigns even when no
  -- per-trainee records exist, since phishing platforms usually report
  -- aggregates. For awareness campaigns these can be left null and
  -- computed from training_records at read time.
  recipient_count             int default 0,
  clicked_count               int default 0,
  reported_count              int default 0,
  credentials_submitted_count int default 0,
  attachment_opened_count     int default 0,

  -- Cross-references to other modules.
  linked_control_ids          text[] not null default '{}',
  linked_risk_ids             uuid[] not null default '{}',
  notes                       text,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists training_campaigns_tenant_idx
  on public.training_campaigns (tenant_id, status, scheduled_at desc);
create index if not exists training_campaigns_kind_idx
  on public.training_campaigns (tenant_id, kind);

drop trigger if exists training_campaigns_set_updated_at on public.training_campaigns;
create trigger training_campaigns_set_updated_at
  before update on public.training_campaigns
  for each row execute function public.set_updated_at();

-- =============================================================================
-- training_records — per-trainee outcomes (for awareness / role-specific
-- /onboarding). Phishing simulations use the campaign-level aggregates
-- above; per-recipient records here are optional.
-- =============================================================================

create table if not exists public.training_records (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  campaign_id     uuid not null references public.training_campaigns(id) on delete cascade,
  trainee_email   text,
  trainee_name    text,
  trainee_role    text,
  assigned_at     date,
  due_date        date,
  completed_at    date,
  status          text not null default 'assigned'
                      check (status in ('assigned','in_progress','complete','overdue','exempt','failed')),
  -- 0-100 quiz score, when the training tool reports one.
  score           numeric(5,2),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists training_records_campaign_idx
  on public.training_records (campaign_id, status);
create index if not exists training_records_tenant_idx
  on public.training_records (tenant_id, status, due_date nulls last);

drop trigger if exists training_records_set_updated_at on public.training_records;
create trigger training_records_set_updated_at
  before update on public.training_records
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS — standard member-select / editor-modify
-- =============================================================================

alter table public.training_campaigns enable row level security;
alter table public.training_records  enable row level security;

drop policy if exists training_campaigns_select on public.training_campaigns;
create policy training_campaigns_select on public.training_campaigns
  for select using (
    exists (select 1 from public.memberships m
            where m.tenant_id = training_campaigns.tenant_id and m.user_id = auth.uid())
  );
drop policy if exists training_campaigns_modify on public.training_campaigns;
create policy training_campaigns_modify on public.training_campaigns
  for all
  using (
    exists (select 1 from public.memberships m
            where m.tenant_id = training_campaigns.tenant_id and m.user_id = auth.uid()
              and m.role = 'editor')
  )
  with check (
    exists (select 1 from public.memberships m
            where m.tenant_id = training_campaigns.tenant_id and m.user_id = auth.uid()
              and m.role = 'editor')
  );

drop policy if exists training_records_select on public.training_records;
create policy training_records_select on public.training_records
  for select using (
    exists (select 1 from public.memberships m
            where m.tenant_id = training_records.tenant_id and m.user_id = auth.uid())
  );
drop policy if exists training_records_modify on public.training_records;
create policy training_records_modify on public.training_records
  for all
  using (
    exists (select 1 from public.memberships m
            where m.tenant_id = training_records.tenant_id and m.user_id = auth.uid()
              and m.role = 'editor')
  )
  with check (
    exists (select 1 from public.memberships m
            where m.tenant_id = training_records.tenant_id and m.user_id = auth.uid()
              and m.role = 'editor')
  );

-- =============================================================================
-- Seeds — one active annual awareness campaign + one recent phishing
-- simulation per tenant. Realistic-looking metrics, conservative
-- click rates. Admins overwrite with real data.
-- =============================================================================

-- Annual awareness — active, due 90 days out, no per-trainee records yet
-- (admin populates as they go).
insert into public.training_campaigns (
  tenant_id, name, kind, description, vendor,
  scheduled_at, target_audience, status, recipient_count,
  linked_control_ids
)
select t.id,
  'Annual Security Awareness Training (FY' || extract(year from current_date)::text || ')',
  'awareness',
  'Annual mandatory training covering phishing recognition, password hygiene, data classification, incident reporting, and acceptable-use policy.',
  'Internal',
  current_date,
  'All employees',
  'active',
  0,
  array['PR.AT-01','GV.RR-04']::text[]
from public.tenants t
where not exists (
  select 1 from public.training_campaigns c
  where c.tenant_id = t.id
    and c.kind = 'awareness'
    and c.scheduled_at >= (current_date - interval '12 months')
);

-- Phishing simulation — completed last month, light click rate (5-8%),
-- moderate report rate. Numbers feel real.
insert into public.training_campaigns (
  tenant_id, name, kind, description, vendor,
  scheduled_at, completed_at, target_audience, status,
  recipient_count, clicked_count, reported_count, credentials_submitted_count,
  linked_control_ids, linked_risk_ids
)
select t.id,
  'Q' || extract(quarter from current_date - interval '1 month')::text ||
  ' Phishing Simulation — Invoice Lure',
  'phishing',
  'Quarterly phishing simulation. Lure: fake invoice from external sender impersonating a known vendor. Measured: open, click, credential submission, user-reported.',
  'KnowBe4',
  (current_date - interval '30 days')::date,
  (current_date - interval '25 days')::date,
  'All employees',
  'completed',
  -- Mock counts: 50 recipients, ~7% clicked, ~22% reported, 1-2 submitted creds.
  50, 4, 11, 1,
  array['PR.AT-01','PR.AT-02','DE.AE-02']::text[],
  array[]::uuid[]
from public.tenants t
where not exists (
  select 1 from public.training_campaigns c
  where c.tenant_id = t.id
    and c.kind = 'phishing'
    and c.scheduled_at >= (current_date - interval '6 months')
);

-- Link the phishing campaigns to the seeded R-006 (Phishing → Credential
-- Theft) risk per tenant.
update public.training_campaigns c
set linked_risk_ids = array(
  select r.id from public.risks r
  where r.tenant_id = c.tenant_id and r.code = 'R-006'
)
where c.kind = 'phishing'
  and (c.linked_risk_ids is null or array_length(c.linked_risk_ids, 1) is null);
