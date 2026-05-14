-- 0017_vendor_risk.sql
--
-- Vendor risk management — a dedicated module for tracking third-party
-- vendors with privileged access or data exposure. Replaces the freeform
-- "Vendor Risk Register" row in the generic Registers feature with a
-- structured workflow: criticality + data sensitivity + attestation
-- tracking (SOC 2 Type II, ISO 27001 cert, HIPAA BAA, etc.) + assessment
-- cadence + linked risks/incidents.
--
-- Two tables:
--   vendors            — the master list. One row per vendor relationship.
--   vendor_attestations — the certs / contracts each vendor produces.
--                        Multiple per vendor (e.g. SOC 2 Type II annually +
--                        a HIPAA BAA + cyber-insurance certificate of
--                        currency). expires_on drives Attention Feed
--                        alerts when renewal is overdue.
--
-- Seeds: 4 representative vendors per tenant covering the most common
-- shapes (MSP, SaaS, file storage, payment processor) plus one SOC 2
-- attestation per vendor so the Attention Feed and reports have data to
-- show out of the box.

-- =============================================================================
-- vendors
-- =============================================================================

create table if not exists public.vendors (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  name                text not null,
  service_description text,
  vendor_type         text not null default 'saas'
                          check (vendor_type in ('saas','msp','hardware','consulting','payments','infrastructure','contractor','other')),
  criticality         text not null default 'medium'
                          check (criticality in ('low','medium','high','critical')),
  -- Data sensitivity captures what the vendor can see / store. Drives the
  -- "show me every vendor with PHI" filter and feeds the audit binder.
  data_sensitivity    text not null default 'none'
                          check (data_sensitivity in ('none','public','internal','confidential','pii','phi','financial','regulated')),
  access_summary      text,
  -- Lifecycle. 'active' = currently engaged. 'pending' = onboarding in
  -- progress (not yet allowed to access data). 'offboarded' = relationship
  -- ended; keeps the row for audit history.
  status              text not null default 'active'
                          check (status in ('pending','active','offboarded')),
  -- Owner = the internal person responsible for managing this vendor
  -- relationship (not the vendor's own contact). Typically the IT manager
  -- or department head that uses the service.
  owner               text,
  primary_contact     text,
  contact_email       text,
  contract_renewal_at date,
  annual_spend_usd    numeric(12, 2),
  website             text,
  notes               text,
  -- Cross-references to other modules.
  linked_risk_ids     uuid[] not null default '{}',
  linked_control_ids  text[] not null default '{}',
  linked_incident_ids uuid[] not null default '{}',
  -- Cadence: when is the next vendor-risk assessment due?
  last_assessed_at    date,
  next_assessment_at  date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists vendors_tenant_idx
  on public.vendors (tenant_id, criticality, name);
create index if not exists vendors_renewal_idx
  on public.vendors (tenant_id, next_assessment_at)
  where status = 'active';

drop trigger if exists vendors_set_updated_at on public.vendors;
create trigger vendors_set_updated_at
  before update on public.vendors
  for each row execute function public.set_updated_at();

-- =============================================================================
-- vendor_attestations — one row per cert / contract artifact
-- =============================================================================

create table if not exists public.vendor_attestations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  vendor_id       uuid not null references public.vendors(id) on delete cascade,
  -- The TYPE of attestation. Free text would lose categorical filtering;
  -- a check constraint here lists the most common shapes. Add to it if
  -- the standard you need isn't here.
  attestation_type text not null
    check (attestation_type in (
      'soc2_type1','soc2_type2','iso_27001','iso_27017','iso_27018','iso_27701',
      'pci_dss','hipaa_baa','fedramp_high','fedramp_moderate','cmmc',
      'cyber_insurance','penetration_test','vulnerability_scan','other'
    )),
  -- Free-text title that describes the artifact ("FY2025 SOC 2 Type II
  -- report covering Sept 2024 – Sept 2025").
  title           text not null,
  -- When the report / cert was issued and when it expires. Most have
  -- annual cadence; expires_on drives the Attention Feed.
  issued_on       date,
  expires_on      date,
  status          text not null default 'current'
                      check (status in ('pending','current','expired','superseded','archived')),
  -- Optional cross-reference to an Evidence Library artifact that holds
  -- the actual PDF. We keep the metadata here (issuer, expiry, status)
  -- because vendors deserve their own page in the audit binder; the file
  -- itself lives once in evidence_artifacts.
  evidence_artifact_id uuid references public.evidence_artifacts(id) on delete set null,
  -- Findings recorded during the review: critical / major / minor counts
  -- so a board can see "we accepted 3 minor findings."
  findings_critical int not null default 0,
  findings_major    int not null default 0,
  findings_minor    int not null default 0,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists vendor_attestations_vendor_idx
  on public.vendor_attestations (vendor_id, expires_on nulls last);
create index if not exists vendor_attestations_tenant_expiry_idx
  on public.vendor_attestations (tenant_id, expires_on)
  where status = 'current';

drop trigger if exists vendor_attestations_set_updated_at on public.vendor_attestations;
create trigger vendor_attestations_set_updated_at
  before update on public.vendor_attestations
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================

alter table public.vendors             enable row level security;
alter table public.vendor_attestations enable row level security;

drop policy if exists vendors_select on public.vendors;
create policy vendors_select on public.vendors
  for select using (
    exists (select 1 from public.memberships m
            where m.tenant_id = vendors.tenant_id and m.user_id = auth.uid())
  );
drop policy if exists vendors_modify on public.vendors;
create policy vendors_modify on public.vendors
  for all
  using (
    exists (select 1 from public.memberships m
            where m.tenant_id = vendors.tenant_id and m.user_id = auth.uid()
              and m.role = 'editor')
  )
  with check (
    exists (select 1 from public.memberships m
            where m.tenant_id = vendors.tenant_id and m.user_id = auth.uid()
              and m.role = 'editor')
  );

drop policy if exists vendor_attestations_select on public.vendor_attestations;
create policy vendor_attestations_select on public.vendor_attestations
  for select using (
    exists (select 1 from public.memberships m
            where m.tenant_id = vendor_attestations.tenant_id and m.user_id = auth.uid())
  );
drop policy if exists vendor_attestations_modify on public.vendor_attestations;
create policy vendor_attestations_modify on public.vendor_attestations
  for all
  using (
    exists (select 1 from public.memberships m
            where m.tenant_id = vendor_attestations.tenant_id and m.user_id = auth.uid()
              and m.role = 'editor')
  )
  with check (
    exists (select 1 from public.memberships m
            where m.tenant_id = vendor_attestations.tenant_id and m.user_id = auth.uid()
              and m.role = 'editor')
  );

-- =============================================================================
-- Seeds — 4 representative vendors per tenant. Generic-enough that they
-- read as plausible for any SMB tenant on the platform (USI, CL, BSP, AHP,
-- Bestige, Outdoor Expressions). The annual_spend numbers are conservative
-- placeholders — admins should overwrite.
-- =============================================================================

insert into public.vendors (
  tenant_id, name, service_description, vendor_type, criticality,
  data_sensitivity, access_summary, status, owner,
  next_assessment_at, linked_control_ids
)
select t.id, v.name, v.service_description, v.vendor_type, v.criticality,
       v.data_sensitivity, v.access_summary, 'active', v.owner,
       (current_date + interval '6 months')::date, v.controls
from public.tenants t
cross join (values
  (
    'Microsoft 365 (Microsoft Corporation)',
    'Email, document collaboration, identity, Teams, SharePoint, OneDrive, Defender for Office 365.',
    'saas',
    'critical',
    'confidential',
    'Global admin + Conditional Access; mailbox and SharePoint content; Entra ID identity store; audit logs.',
    'IT Manager',
    array['GV.SC-01','GV.SC-04','PR.AA-01','PR.AA-05','PR.DS-01','PR.DS-11']::text[]
  ),
  (
    'Universal Systems Inc. (USI) — MSP',
    'Managed IT services + cybersecurity assessment + RMM/PSA access to endpoints and servers.',
    'msp',
    'critical',
    'confidential',
    'RMM agent admin access; PSA helpdesk visibility; Entra ID partner relationship; named admins on M365 tenant.',
    'IT Manager',
    array['GV.SC-01','GV.SC-04','GV.SC-06','GV.SC-07','GV.SC-08']::text[]
  ),
  (
    'Datto / Kaseya (or your SaaS backup provider)',
    'Third-party backup of M365 mailboxes, SharePoint, OneDrive, Teams. Immutable retention.',
    'saas',
    'high',
    'confidential',
    'Read access to M365 tenant via OAuth; encrypted backups stored in vendor cloud.',
    'IT Manager',
    array['PR.DS-11','RC.RP-01','RC.RP-03']::text[]
  ),
  (
    'Stripe (or your payment processor)',
    'Card processing for online transactions; PCI scope-reduction via hosted checkout.',
    'payments',
    'high',
    'financial',
    'API access via secret keys; no card data stored in tenant systems (hosted checkout reduces scope).',
    'Finance Lead',
    array['GV.SC-01','PR.DS-01','PR.PS-04']::text[]
  )
) as v(name, service_description, vendor_type, criticality, data_sensitivity, access_summary, owner, controls)
where not exists (
  select 1 from public.vendors x
  where x.tenant_id = t.id and x.name = v.name
);

-- One starter attestation per seeded vendor: a SOC 2 Type II report on
-- annual cadence, expiring 9 months from now (so the Attention Feed has
-- something to track without firing immediately).
insert into public.vendor_attestations (
  tenant_id, vendor_id, attestation_type, title, issued_on, expires_on, status
)
select v.tenant_id, v.id, 'soc2_type2',
       v.name || ' — SOC 2 Type II (annual)',
       (current_date - interval '3 months')::date,
       (current_date + interval '9 months')::date,
       'current'
from public.vendors v
where v.status = 'active'
  and v.vendor_type in ('saas','msp','payments')
  and not exists (
    select 1 from public.vendor_attestations a
    where a.vendor_id = v.id
      and a.attestation_type = 'soc2_type2'
      and a.status = 'current'
  );

-- Also seed a HIPAA BAA where the vendor type is MSP or SaaS holding
-- confidential data — represents the contractual side, not a third-party
-- attestation. Expires further out (3 years is typical for BAAs).
insert into public.vendor_attestations (
  tenant_id, vendor_id, attestation_type, title, issued_on, expires_on, status
)
select v.tenant_id, v.id, 'hipaa_baa',
       v.name || ' — HIPAA Business Associate Agreement',
       (current_date - interval '1 year')::date,
       (current_date + interval '2 years')::date,
       'current'
from public.vendors v
where v.status = 'active'
  and v.data_sensitivity in ('confidential','phi','pii')
  and v.vendor_type in ('saas','msp')
  and not exists (
    select 1 from public.vendor_attestations a
    where a.vendor_id = v.id and a.attestation_type = 'hipaa_baa'
  );
