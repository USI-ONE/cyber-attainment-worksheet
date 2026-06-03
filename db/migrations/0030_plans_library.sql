-- 0030_plans_library.sql
--
-- A "Plans Library" — the operational counterpart to the Policy Library
-- (0025_policy_library.sql). Policies say WHAT we will do; plans say
-- HOW we will do it. Same UX shape as the Policy Library so the user
-- has one mental model:
--
--   * plans_library_catalog — platform-wide master list of standard
--     plans every reasonably-mature org should maintain. Seeded with
--     14 entries across resilience / operational / risk & compliance /
--     strategic categories.
--   * tenant_plans — per-tenant state for each catalog entry: status,
--     version, last_reviewed_at, next_review_due, owner_user_id,
--     plan_document_id linking to the attached file. RLS scoped to
--     memberships; writes require tenant admin or platform admin.
--
-- Plan documents are stored in public.policy_documents (already a
-- generic per-tenant document store with storage in the policy-documents
-- bucket). The `policy_documents` name is historical — the table holds
-- any governance document. tenant_plans.plan_document_id FKs to it.
-- A future migration could rename the table to `governance_documents`;
-- for now we live with the name.

-- =============================================================================
-- plans_library_catalog
-- =============================================================================
create table if not exists public.plans_library_catalog (
  code                  text primary key,
  title                 text not null,
  category              text not null check (category in (
                          'resilience','operational','risk_compliance','strategic'
                        )),
  description           text,
  default_review_months int  not null default 12,
  sort_order            int  not null default 0,
  created_at            timestamptz not null default now()
);

-- =============================================================================
-- tenant_plans — per-tenant state
-- =============================================================================
create table if not exists public.tenant_plans (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  plan_code           text not null references public.plans_library_catalog(code) on delete restrict,
  status              text not null default 'missing'
                        check (status in ('missing','draft','active','expired','na')),
  version             text,
  last_reviewed_at    date,
  next_review_due     date,
  owner_user_id       uuid references public.profiles(id) on delete set null,
  plan_document_id    uuid references public.policy_documents(id) on delete set null,
  notes               text,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles(id) on delete set null,
  unique (tenant_id, plan_code)
);

create index if not exists tenant_plans_tenant_idx
  on public.tenant_plans (tenant_id, status, next_review_due nulls last);

drop trigger if exists tenant_plans_set_updated_at on public.tenant_plans;
create trigger tenant_plans_set_updated_at
  before update on public.tenant_plans
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================

alter table public.plans_library_catalog enable row level security;
drop policy if exists plan_catalog_read on public.plans_library_catalog;
create policy plan_catalog_read on public.plans_library_catalog
  for select using (true);

alter table public.tenant_plans enable row level security;

drop policy if exists tenant_plans_select on public.tenant_plans;
create policy tenant_plans_select on public.tenant_plans
  for select using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = tenant_plans.tenant_id and m.user_id = auth.uid()
    )
  );

drop policy if exists tenant_plans_modify on public.tenant_plans;
create policy tenant_plans_modify on public.tenant_plans
  for all using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = tenant_plans.tenant_id
        and m.user_id = auth.uid()
        and m.role = 'admin'
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_platform_admin = true
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = tenant_plans.tenant_id
        and m.user_id = auth.uid()
        and m.role = 'admin'
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_platform_admin = true
    )
  );

-- =============================================================================
-- Seed catalog — 14 standard plans every org should maintain
-- =============================================================================
insert into public.plans_library_catalog (code, title, category, description, default_review_months, sort_order) values
  -- Resilience
  ('incident_response',          'Incident Response Plan',                       'resilience',      'How a security incident is detected, contained, eradicated, recovered. Roles, severity matrix, escalation, regulatory notification timelines.',                            12, 10),
  ('disaster_recovery',          'Disaster Recovery Plan',                       'resilience',      'How IT systems are recovered after a major outage. RTO/RPO targets per tier, playbooks per failure scenario (ransomware, vendor outage, primary site loss).',         12, 20),
  ('business_continuity',        'Business Continuity Plan',                     'resilience',      'How the business keeps operating during a disruption. Critical functions, manual workarounds, recovery priorities, tabletop cadence.',                                  12, 30),
  ('crisis_communication',       'Crisis Communication Plan',                    'resilience',      'Who says what to whom during a crisis. Designated spokesperson, internal/external/regulatory message templates, channels, cadence.',                                    12, 40),
  -- Operational
  ('backup_recovery',            'Backup & Recovery Plan',                       'operational',     'What gets backed up, retention by tier, restore test cadence, immutability and air-gap controls, encryption.',                                                          12, 110),
  ('change_management',          'Change Management Plan',                       'operational',     'How production changes are approved, tested, rolled back. Standard/normal/emergency categories, two-person rule for sensitive systems.',                              12, 120),
  ('patch_management',           'Patch Management Plan',                        'operational',     'Patch cadence by severity (Critical 14d, High 30d, Medium 90d), deployment procedures, exception process with compensating controls.',                                 12, 130),
  ('vulnerability_management',   'Vulnerability Management Plan',                'operational',     'Scanning cadence (internal/external/authenticated), remediation SLAs, pen test schedule, exception management.',                                                       12, 140),
  ('access_review',              'Access Review Plan',                           'operational',     'Quarterly privileged + annual standard access certification process. Joiner/mover/leaver workflow.',                                                                 12, 150),
  -- Risk & Compliance
  ('risk_management',            'Risk Management Plan',                         'risk_compliance', 'How risks are identified, scored (likelihood × impact), treated (accept/transfer/avoid/mitigate). Risk register cadence, executive review.',                          12, 210),
  ('vendor_risk_management',     'Vendor / Third-Party Risk Management Plan',    'risk_compliance', 'How vendors are tiered, onboarded, monitored, offboarded. TPSA cadence, BAA/PCI tracking, contract clause library.',                                                12, 220),
  ('data_retention_destruction', 'Data Retention & Destruction Plan',            'risk_compliance', 'Retention schedule by record type with regulatory citations. Secure destruction procedures, certificates of destruction.',                                            12, 230),
  ('audit_compliance',           'Audit & Compliance Plan',                      'risk_compliance', 'Annual audit calendar, regulatory tracking, internal control review, evidence collection for SOC 2 / HIPAA / PCI / customer audits.',                                  12, 240),
  -- Strategic
  ('ai_governance',              'AI Governance Plan',                           'strategic',       'Approved AI tools, intake/approval workflow, data classification matrix for AI, agentic AI controls, shadow-AI prevention.',                                          12, 310)
on conflict (code) do nothing;
