-- 0005_phase2b.sql
-- Phase 2B schema: 30-day Priorities, Security Standards, Board KPIs.

-- =============================================================
-- 30-Day Priorities
-- =============================================================

create table priorities (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  framework_version_id uuid references framework_versions(id),
  control_id           text,
  title                text not null,
  detail               text,
  owner                text,
  status               text not null default 'Not Started',
  priority_level       smallint check (priority_level between 1 and 4),
  due_date             date,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  completed_at         timestamptz
);

create index priorities_tenant_idx on priorities (tenant_id, status, priority_level desc);
comment on table priorities is '30-day focus list. Optional link to a control_id; status is free-text but UI offers the same NIST tier set.';

-- =============================================================
-- Security Standards (catalog + per-tenant toggles)
-- =============================================================

create table standards (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  display_name text not null,
  description  text
);

create table tenant_standards (
  tenant_id     uuid not null references tenants(id) on delete cascade,
  standard_id   uuid not null references standards(id),
  applies       boolean not null default true,
  scope_notes   text,
  enabled_at    timestamptz not null default now(),
  primary key (tenant_id, standard_id)
);

create table standard_control_mappings (
  standard_id          uuid not null references standards(id) on delete cascade,
  framework_version_id uuid not null references framework_versions(id),
  control_id           text not null,
  notes                text,
  primary key (standard_id, framework_version_id, control_id)
);

-- Seed common standards
insert into standards (slug, display_name, description) values
  ('hipaa-security',     'HIPAA Security Rule',                'Administrative, physical, and technical safeguards for ePHI.'),
  ('iso-27001-2022',     'ISO/IEC 27001:2022',                 'Information security management system.'),
  ('pci-dss-4',          'PCI DSS 4.0',                        'Payment card industry data security standard.'),
  ('soc-2',              'SOC 2',                              'Trust services criteria — security, availability, processing integrity, confidentiality, privacy.'),
  ('nist-csf-2-0',       'NIST CSF 2.0',                       'NIST Cybersecurity Framework v2.0.'),
  ('cis-v8-1',           'CIS Critical Security Controls v8.1','Center for Internet Security top 18 critical security controls.'),
  ('nist-800-171-r3',    'NIST SP 800-171 r3',                 'Protecting CUI in nonfederal systems.'),
  ('cmmc-l2',            'CMMC Level 2',                       'Cybersecurity Maturity Model Certification, Level 2.'),
  ('gdpr',               'GDPR',                               'EU General Data Protection Regulation.'),
  ('ccpa',               'CCPA',                               'California Consumer Privacy Act.')
on conflict (slug) do nothing;

-- =============================================================
-- Board KPIs
-- =============================================================

create table kpi_definitions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  slug            text not null,
  name            text not null,
  description     text,
  unit            text,
  target_value    numeric,
  target_direction text not null default 'up' check (target_direction in ('up','down')),
  display_order   int not null default 0,
  enabled         boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table kpi_observations (
  id                bigserial primary key,
  kpi_definition_id uuid not null references kpi_definitions(id) on delete cascade,
  observed_at       date not null,
  value             numeric,
  notes_md          text,
  recorded_by       uuid references profiles(id),
  recorded_at       timestamptz not null default now(),
  unique (kpi_definition_id, observed_at)
);

create index kpi_observations_def_idx on kpi_observations (kpi_definition_id, observed_at desc);

-- =============================================================
-- RLS (placeholders for when auth re-lands; service role currently bypasses)
-- =============================================================

alter table priorities                enable row level security;
alter table standards                 enable row level security;
alter table tenant_standards          enable row level security;
alter table standard_control_mappings enable row level security;
alter table kpi_definitions           enable row level security;
alter table kpi_observations          enable row level security;

-- Catalog tables are world-readable to authenticated users
create policy standards_auth_read              on standards                 for select using (auth.role() = 'authenticated');
create policy standard_mappings_auth_read      on standard_control_mappings for select using (auth.role() = 'authenticated');

-- Tenant-scoped reads
create policy priorities_member_read           on priorities       for select using (user_can_see_tenant(tenant_id));
create policy tenant_standards_member_read     on tenant_standards for select using (user_can_see_tenant(tenant_id));
create policy kpi_def_member_read              on kpi_definitions  for select using (user_can_see_tenant(tenant_id));
create policy kpi_obs_member_read              on kpi_observations for select using (
  exists (select 1 from kpi_definitions kd where kd.id = kpi_observations.kpi_definition_id and user_can_see_tenant(kd.tenant_id))
);

-- Editor writes
create policy priorities_editor_write          on priorities       for all
  using      (user_has_tenant_role(tenant_id, 'editor'))
  with check (user_has_tenant_role(tenant_id, 'editor'));
create policy tenant_standards_editor_write    on tenant_standards for all
  using      (user_has_tenant_role(tenant_id, 'editor'))
  with check (user_has_tenant_role(tenant_id, 'editor'));
create policy kpi_def_editor_write             on kpi_definitions  for all
  using      (user_has_tenant_role(tenant_id, 'editor'))
  with check (user_has_tenant_role(tenant_id, 'editor'));
create policy kpi_obs_editor_write             on kpi_observations for all
  using (
    exists (select 1 from kpi_definitions kd where kd.id = kpi_observations.kpi_definition_id and user_has_tenant_role(kd.tenant_id, 'editor'))
  )
  with check (
    exists (select 1 from kpi_definitions kd where kd.id = kpi_observations.kpi_definition_id and user_has_tenant_role(kd.tenant_id, 'editor'))
  );
