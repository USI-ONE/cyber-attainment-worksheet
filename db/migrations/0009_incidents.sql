-- 0009_incidents.sql
-- Incident logging for the platform: a tenant-scoped log of security incidents
-- (BEC, account compromise, malware, lost device, phishing, etc.) with attached
-- documents stored in Supabase Storage. Each incident can link to NIST CSF 2.0
-- control IDs that the incident exposed as gaps, so the radar/scoring side can
-- eventually surface "this category was the path of entry" to the board.
--
-- Document storage uses a single private bucket `incident-documents`. Files are
-- keyed under `<tenant_id>/<incident_id>/<original-filename>` so a tenant move
-- or incident delete can clear the right blobs.
--
-- This migration also pins Black Slate Partners branding (theme tokens + logo)
-- and seeds the Joe Nemrow M365 BEC incident as the first record under BSP so
-- the new module ships with real content.

-- =============================================================================
-- Tables
-- =============================================================================

create table if not exists public.incidents (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  title           text not null,
  status          text not null default 'open'
                    check (status in ('open','contained','closed')),
  severity        text not null default 'medium'
                    check (severity in ('low','medium','high','critical')),
  category        text,
  detected_at     timestamptz,
  contained_at    timestamptz,
  closed_at       timestamptz,
  reported_by     text,
  affected_users  text[] not null default '{}',
  description     text,
  -- timeline / findings / actions / recommendations are kept as jsonb arrays
  -- of plain strings (or {at, event} objects for timeline) so the UI can grow
  -- without a schema migration. The Nemrow seed uses both shapes.
  timeline          jsonb not null default '[]'::jsonb,
  findings          jsonb not null default '[]'::jsonb,
  actions           jsonb not null default '[]'::jsonb,
  recommendations   jsonb not null default '[]'::jsonb,
  linked_control_ids text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists incidents_tenant_idx
  on public.incidents (tenant_id, detected_at desc nulls last, created_at desc);

create table if not exists public.incident_documents (
  id            uuid primary key default gen_random_uuid(),
  incident_id   uuid not null references public.incidents(id) on delete cascade,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  storage_path  text not null,           -- key in the `incident-documents` bucket
  filename      text not null,           -- original filename for download
  content_type  text,
  size_bytes    bigint,
  uploaded_by   text,
  created_at    timestamptz not null default now()
);

create index if not exists incident_documents_incident_idx
  on public.incident_documents (incident_id, created_at desc);

-- Generic updated_at trigger function. Defined here (not assumed from a
-- prior migration) so 0009 is self-contained — future tables that want
-- the same behavior can reuse it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists incidents_set_updated_at on public.incidents;
create trigger incidents_set_updated_at
  before update on public.incidents
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
-- Mirrors the rest of the schema: rows are visible to tenant members; only
-- editors can insert/update/delete. Service-role bypasses both, so the API
-- routes (which use the service-role client today while auth is disabled)
-- continue to work.

alter table public.incidents          enable row level security;
alter table public.incident_documents enable row level security;

drop policy if exists incidents_select on public.incidents;
create policy incidents_select on public.incidents
  for select
  using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = incidents.tenant_id and m.user_id = auth.uid()
    )
  );

drop policy if exists incidents_modify on public.incidents;
create policy incidents_modify on public.incidents
  for all
  using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = incidents.tenant_id and m.user_id = auth.uid()
        and m.role = 'editor'
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = incidents.tenant_id and m.user_id = auth.uid()
        and m.role = 'editor'
    )
  );

drop policy if exists incident_documents_select on public.incident_documents;
create policy incident_documents_select on public.incident_documents
  for select
  using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = incident_documents.tenant_id and m.user_id = auth.uid()
    )
  );

drop policy if exists incident_documents_modify on public.incident_documents;
create policy incident_documents_modify on public.incident_documents
  for all
  using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = incident_documents.tenant_id and m.user_id = auth.uid()
        and m.role = 'editor'
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = incident_documents.tenant_id and m.user_id = auth.uid()
        and m.role = 'editor'
    )
  );

-- =============================================================================
-- Storage bucket
-- =============================================================================
-- Private bucket; access is via signed URLs minted by the service-role API.
insert into storage.buckets (id, name, public)
values ('incident-documents', 'incident-documents', false)
on conflict (id) do update set public = excluded.public;

-- =============================================================================
-- Black Slate Partners branding
-- =============================================================================
-- Apply theme tokens + logo + tagline so the BSP deployment matches the
-- corporate site (black/white minimalism, Stratus navy + On Top orange accents).
update public.tenants
set
  display_name = 'Black Slate Partners',
  brand_config = jsonb_build_object(
    'logo_url',  'https://raw.githubusercontent.com/USI-ONE/caw-black-slate/main/assets/logo.svg',
    'tagline',   'Trusted roofing leadership through strong partnerships',
    'theme', jsonb_build_object(
      'primary',         '#2C4F6E',
      'primary_light',   '#4D7591',
      'primary_bright',  '#3B7090',
      'primary_pale',    'rgba(44,79,110,0.14)',
      'primary_border',  'rgba(44,79,110,0.42)',
      'secondary',       '#DD541F',
      'accent',          '#E8E4DA'
    )
  )
where slug = 'black-slate';

-- =============================================================================
-- Seed: Joe Nemrow M365 account compromise (BSP)
-- =============================================================================
-- Mirrors the sections of Joe_Nemrow_Incident_Report_Client.pdf so the BSP
-- portal has a real first record. Linked NIST CSF 2.0 controls reflect the
-- gaps that allowed the BEC: identity proofing/MFA (PR.AA-01/05), Conditional
-- Access (DE.AE-02), continuous monitoring (DE.CM-01), and the IR process
-- itself (RS.MA-01). The PDF document is uploaded through the UI after
-- deploy, not seeded here, since storage uploads can't run inside SQL.
insert into public.incidents (
  tenant_id, title, status, severity, category,
  detected_at, contained_at, reported_by, affected_users,
  description, timeline, findings, actions, recommendations, linked_control_ids
)
select
  t.id,
  'M365 Account Compromise — jnemrow@blackslatepartners.com',
  'contained',
  'high',
  'Business Email Compromise',
  '2026-04-30 16:36:00-06'::timestamptz,
  '2026-04-30 16:39:00-06'::timestamptz,
  'Universal Systems Inc. (USI)',
  array['jnemrow@blackslatepartners.com'],
  'Universal Systems Inc. identified and investigated unauthorized access to the Microsoft 365 account jnemrow@blackslatepartners.com. Log evidence confirms successful Outlook Web sign-ins from multiple geographically inconsistent locations, the presence of a malicious inbox rule designed to hide messages, and outbound email activity consistent with business email compromise (BEC) techniques. Containment actions were executed on April 30, 2026, including password resets, token revocation, and MFA re-registration.',
  jsonb_build_array(
    jsonb_build_object('at','2026-04-07', 'event','Successful Outlook Web sign-ins from Denver, Colorado.'),
    jsonb_build_object('at','2026-04-15..20', 'event','Successful Outlook Web sign-ins from Dallas, TX; Florida; and Cape Town, South Africa.'),
    jsonb_build_object('at','2026-04-22..30', 'event','203 outbound emails sent from the account, including invoice/payment-related forwards.'),
    jsonb_build_object('at','2026-04-30 16:36–16:39 MDT', 'event','Security response actions executed: password reset, MFA security info removal, session revocation.')
  ),
  jsonb_build_array(
    'Multiple successful Outlook Web sign-ins occurred from locations not consistent with the user''s normal activity.',
    'A malicious inbox rule was identified that moved messages containing ''townsquareignite.com'' out of the Inbox and marked them as read.',
    'Outbound emails included invoice and payment-related subjects, indicating potential BEC activity.',
    'No Conditional Access policy was applied to block or challenge the suspicious sign-ins.'
  ),
  jsonb_build_array(
    'User password reset and forced password change.',
    'Revocation of active authentication tokens.',
    'Removal of MFA security information and forced re-registration.',
    'Removal of malicious inbox rules.',
    'Ongoing monitoring of outbound email and sign-in activity.'
  ),
  jsonb_build_array(
    'Enable Conditional Access policies for Outlook Web and high-risk sign-ins.',
    'Require MFA for all cloud access, including legacy protocols.',
    'Conduct security awareness training for end users.',
    'Review audit logs and inbox rules periodically for all users.',
    'Consider disabling inbox rule creation for non-admin users if business allows.'
  ),
  array['PR.AA-01','PR.AA-05','DE.AE-02','DE.CM-01','RS.MA-01']
from public.tenants t
where t.slug = 'black-slate'
  and not exists (
    select 1 from public.incidents i
    where i.tenant_id = t.id
      and i.title = 'M365 Account Compromise — jnemrow@blackslatepartners.com'
  );
