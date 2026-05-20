-- 0025_policy_library.sql
--
-- The "policy library" tracks the standard set of policies an MSP-managed
-- client is expected to maintain (AUP, IR Plan, BCP/DR, Backup, Vendor Mgmt,
-- and so on). It is a SHOULD-HAVE checklist with status, review cadence,
-- and ownership — distinct from the existing tables:
--
--   * policy_sections     — markdown chunks of the umbrella cybersecurity
--                           policy doc, rendered at /policy.
--   * policy_documents    — uploaded PDF/DOCX artifacts that satisfy
--                           NIST CSF control scoring, also at /policy.
--   * policy_library_catalog  (NEW, this migration) — platform-wide master
--                           list of policy types.
--   * tenant_policies     (NEW, this migration) — per-tenant state for each
--                           catalog entry: status, version, last review,
--                           next review due, owner, attached document.
--
-- The catalog is seeded by this migration and intended to evolve as a
-- platform-wide reference. Tenants opt into industry add-ons (HIPAA, PCI)
-- simply by setting status to anything other than 'na' on the relevant
-- rows.

-- =============================================================================
-- policy_library_catalog
-- =============================================================================
create table if not exists public.policy_library_catalog (
  code                  text primary key,
  title                 text not null,
  category              text not null check (category in (
                          'foundational','operational','people',
                          'third_party','risk','industry'
                        )),
  description           text,
  default_review_months int  not null default 12,
  industry_tag          text,                    -- null | 'hipaa' | 'pci'
  sort_order            int  not null default 0,
  created_at            timestamptz not null default now()
);

-- =============================================================================
-- tenant_policies — per-tenant state
-- =============================================================================
create table if not exists public.tenant_policies (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  policy_code         text not null references public.policy_library_catalog(code) on delete restrict,
  status              text not null default 'missing'
                        check (status in ('missing','draft','active','expired','na')),
  version             text,
  last_reviewed_at    date,
  next_review_due     date,
  owner_user_id       uuid references public.profiles(id) on delete set null,
  policy_document_id  uuid references public.policy_documents(id) on delete set null,
  notes               text,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.profiles(id) on delete set null,
  unique (tenant_id, policy_code)
);

create index if not exists tenant_policies_tenant_idx
  on public.tenant_policies (tenant_id, status, next_review_due nulls last);

-- Reuse the trigger function defined in migration 0009.
drop trigger if exists tenant_policies_set_updated_at on public.tenant_policies;
create trigger tenant_policies_set_updated_at
  before update on public.tenant_policies
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================

-- Catalog is platform-wide and read-public (it's metadata, no tenant data).
alter table public.policy_library_catalog enable row level security;
drop policy if exists policy_catalog_read on public.policy_library_catalog;
create policy policy_catalog_read on public.policy_library_catalog
  for select using (true);

-- Per-tenant state: members of the tenant can read; tenant admins or
-- platform admins can write. (Service role bypasses RLS, which is how the
-- API routes work — they enforce authz in TS before calling.)
alter table public.tenant_policies enable row level security;

drop policy if exists tenant_policies_select on public.tenant_policies;
create policy tenant_policies_select on public.tenant_policies
  for select using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = tenant_policies.tenant_id and m.user_id = auth.uid()
    )
  );

drop policy if exists tenant_policies_modify on public.tenant_policies;
create policy tenant_policies_modify on public.tenant_policies
  for all using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = tenant_policies.tenant_id
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
      where m.tenant_id = tenant_policies.tenant_id
        and m.user_id = auth.uid()
        and m.role = 'admin'
    )
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_platform_admin = true
    )
  );

-- =============================================================================
-- Seed catalog — the 19 core + industry add-ons
-- =============================================================================
insert into public.policy_library_catalog (code, title, category, description, default_review_months, industry_tag, sort_order) values
  -- Foundational
  ('acceptable_use',          'Acceptable Use Policy',                  'foundational', 'Rules for employee use of company IT, internet, and equipment.',                                                          12, null, 10),
  ('access_control',          'Access Control & Identity Management',   'foundational', 'How identities are provisioned, reviewed, and de-provisioned. Includes least privilege and joiner-mover-leaver.',         12, null, 20),
  ('password_authentication', 'Password & Authentication Policy',       'foundational', 'Password length/complexity, MFA, session timeout, account lockout.',                                                     12, null, 30),
  ('data_classification',     'Data Classification & Handling',         'foundational', 'How data is classified (Public / Internal / Confidential / Restricted) and what handling each tier requires.',           12, null, 40),
  ('data_retention',          'Data Retention & Disposal',              'foundational', 'How long different categories of data are retained and how they are destroyed at end of life.',                          12, null, 50),
  ('encryption',              'Encryption & Key Management',            'foundational', 'When encryption is required (at rest, in transit), allowed algorithms, and key management practices.',                  12, null, 60),
  -- Operational
  ('change_management',       'Change Management Policy',               'operational',  'How production changes are approved, tested, and rolled back.',                                                          12, null, 110),
  ('patch_vulnerability',     'Patch & Vulnerability Management',       'operational',  'Patch cadence by severity, vulnerability scanning, remediation SLAs.',                                                   12, null, 120),
  ('backup_recovery',         'Backup & Recovery Policy',               'operational',  'What gets backed up, retention, restore testing cadence.',                                                                12, null, 130),
  ('business_continuity',     'Business Continuity / DR Plan',          'operational',  'How the business keeps running during a disruption; RTO/RPO targets; tabletop exercise cadence.',                       12, null, 140),
  ('incident_response',       'Incident Response Plan',                 'operational',  'How a security incident is detected, contained, eradicated, and recovered. Roles, escalation, notification timelines.', 12, null, 150),
  ('logging_monitoring',      'Logging, Monitoring & Audit',            'operational',  'What is logged, where logs are stored, retention, and how they are reviewed.',                                            12, null, 160),
  -- People
  ('security_awareness',      'Security Awareness Training Policy',     'people',       'Required training topics and cadence (typical: at hire + annually + phishing simulation).',                              12, null, 210),
  ('onboarding_offboarding',  'Onboarding / Offboarding Procedure',     'people',       'Access provisioning at hire and full revocation at termination.',                                                         12, null, 220),
  ('sanctions',               'Sanctions / Disciplinary Policy',        'people',       'Consequences for policy violations.',                                                                                     24, null, 230),
  ('remote_mobile',           'Remote Work & Mobile Device (BYOD)',     'people',       'Requirements when working from non-office locations or using personal devices.',                                          12, null, 240),
  -- Third Party / Physical
  ('vendor_risk',             'Vendor / Third-Party Risk Management',   'third_party',  'How third parties are vetted, contracted with, and reviewed.',                                                            12, null, 310),
  ('physical_security',       'Physical & Environmental Security',      'third_party',  'Office access control, visitor management, environmental controls.',                                                     24, null, 320),
  ('ai_acceptable_use',       'AI Acceptable Use Policy',               'third_party',  'Allowed AI tools (ChatGPT, Claude, Copilot) and what data may/may not be input.',                                         12, null, 330),
  -- Risk
  ('risk_management',         'Risk Management Policy',                 'risk',         'How risks are identified, scored, and treated. Defines the methodology.',                                                12, null, 410),
  -- Industry-specific add-ons
  ('hipaa_privacy',           'HIPAA Privacy Policy',                   'industry',     'PHI uses, disclosures, and patient rights under the HIPAA Privacy Rule.',                                                12, 'hipaa', 510),
  ('hipaa_breach',            'HIPAA Breach Notification Policy',       'industry',     'Process and timelines for notifying patients, HHS, and (if applicable) media of a PHI breach.',                          12, 'hipaa', 520),
  ('hipaa_baa_template',      'HIPAA BAA Template',                     'industry',     'Standard Business Associate Agreement language for vendors with PHI access.',                                            24, 'hipaa', 530),
  ('pci_cde',                 'PCI Cardholder Data Environment Policy', 'industry',     'Scope of PCI environment, segmentation, processing controls (PCI DSS 4.0).',                                              12, 'pci',   610),
  ('privacy_notice',          'Consumer Privacy Notice',                'industry',     'CCPA/CPRA and state privacy law notices.',                                                                                12, null,    710)
on conflict (code) do nothing;
