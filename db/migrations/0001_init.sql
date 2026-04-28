-- 0001_init.sql
-- Cyber Attainment Worksheet: core schema.
-- Run on a fresh Supabase project, in order with the other migrations.

create extension if not exists pgcrypto;

-- =============================================================
-- Tenants and identity
-- =============================================================

create table tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  hostname text unique,
  display_name text not null,
  brand_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table  tenants               is 'One row per client deployment (Collision Leaders, AHP, etc.).';
comment on column tenants.slug          is 'kebab-case identifier; matches the caw-<slug> repo name.';
comment on column tenants.hostname      is 'Production hostname; used for hostname->tenant routing in the app.';
comment on column tenants.brand_config  is 'JSON: { logo_url, display_name_override, ... }';

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  display_name text,
  created_at timestamptz not null default now()
);

comment on table profiles is 'App-level user profile, one-to-one with auth.users.';

create type membership_role as enum ('editor', 'viewer');

create table memberships (
  user_id   uuid not null references profiles(id) on delete cascade,
  tenant_id uuid not null references tenants(id)  on delete cascade,
  role      membership_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

comment on table memberships is 'Per-tenant access. editor = score editor (CIO); viewer = read-only.';

create table domain_whitelist (
  domain       text primary key,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  default_role membership_role not null default 'viewer'
);

comment on table domain_whitelist is 'On signup, if a user email matches one of these domains, auto-grant a membership.';

-- =============================================================
-- Frameworks (NIST CSF 2.0 today; CIS / HIPAA / ISO future)
-- =============================================================

create table frameworks (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,
  display_name text not null,
  description  text
);

create table framework_versions (
  id           uuid primary key default gen_random_uuid(),
  framework_id uuid not null references frameworks(id) on delete cascade,
  version      text not null,
  definition   jsonb not null,
  published_at timestamptz not null default now(),
  is_current   boolean not null default false,
  unique (framework_id, version)
);

comment on column framework_versions.definition is
  'Canonical framework JSON: { schema_version, framework, scoring, groups[].categories[].controls[] }.';

create table tenant_frameworks (
  tenant_id            uuid not null references tenants(id) on delete cascade,
  framework_version_id uuid not null references framework_versions(id),
  enabled_at           timestamptz not null default now(),
  primary key (tenant_id, framework_version_id)
);

-- =============================================================
-- Scoring: live working state
-- =============================================================

create table current_scores (
  tenant_id            uuid not null references tenants(id) on delete cascade,
  framework_version_id uuid not null references framework_versions(id),
  control_id           text not null,
  pol      smallint check (pol  between 1 and 4),
  pra      smallint check (pra  between 1 and 4),
  gol      smallint check (gol  between 1 and 4),
  prio     smallint check (prio between 1 and 4),
  owner    text,
  status   text,
  notes    text,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, framework_version_id, control_id)
);

comment on table current_scores is
  'Live working state. Per (tenant, framework_version, control). Edited by editors only.';

-- =============================================================
-- Snapshots: frozen point-in-time copies
-- =============================================================

create table snapshots (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  framework_version_id uuid not null references framework_versions(id),
  label                text not null,
  period               text,
  taken_at             timestamptz not null default now(),
  taken_by             uuid references profiles(id),
  notes_md             text
);

comment on table snapshots is
  'Frozen point-in-time copies. Immutable; corrections = new snapshot with a new label.';

create table snapshot_scores (
  snapshot_id uuid not null references snapshots(id) on delete cascade,
  control_id  text not null,
  pol smallint, pra smallint, gol smallint, prio smallint,
  owner text, status text, notes text,
  primary key (snapshot_id, control_id)
);

create index snapshots_tenant_taken_idx
  on snapshots (tenant_id, framework_version_id, taken_at desc);

-- =============================================================
-- Sharing
-- =============================================================

create table snapshot_shares (
  id                  uuid primary key default gen_random_uuid(),
  snapshot_id         uuid not null references snapshots(id) on delete cascade,
  recipient_tenant_id uuid references tenants(id) on delete cascade,
  share_token         text unique,
  expires_at          timestamptz,
  revoked_at          timestamptz,
  created_by          uuid references profiles(id),
  created_at          timestamptz not null default now(),
  check (recipient_tenant_id is not null or share_token is not null)
);

comment on table snapshot_shares is
  'Two share modes: (a) recipient_tenant_id = read-grant to another tenant (e.g., share with Bestige); (b) share_token = public signed link.';

-- =============================================================
-- Audit log
-- =============================================================

create table audit_log (
  id                   bigserial primary key,
  tenant_id            uuid not null references tenants(id) on delete cascade,
  framework_version_id uuid references framework_versions(id),
  control_id           text,
  field                text not null,
  old_value            text,
  new_value            text,
  changed_by           uuid references profiles(id),
  changed_at           timestamptz not null default now()
);

create index audit_log_tenant_changed_idx on audit_log (tenant_id, changed_at desc);
