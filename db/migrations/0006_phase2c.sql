-- 0006_phase2c.sql
-- Phase 2C schema: Work Plans, Registers, Security Policy

-- =============================================================
-- Work Plans
-- =============================================================

create table if not exists work_plan_tasks (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references tenants(id) on delete cascade,
  framework_version_id uuid references framework_versions(id),
  control_id           text not null,
  title                text not null,
  detail               text,
  status               text not null default 'Not Started',
  owner                text,
  due_date             date,
  display_order        int  not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  completed_at         timestamptz
);
create index if not exists work_plan_tasks_tenant_control_idx
  on work_plan_tasks (tenant_id, control_id, display_order);

create table if not exists work_plan_notes (
  tenant_id            uuid not null references tenants(id) on delete cascade,
  framework_version_id uuid not null references framework_versions(id),
  control_id           text not null,
  notes                text,
  updated_at           timestamptz not null default now(),
  primary key (tenant_id, framework_version_id, control_id)
);

-- =============================================================
-- Registers (definable schema; rows in JSONB)
-- =============================================================

create table if not exists register_definitions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  slug          text not null,
  name          text not null,
  description   text,
  columns       jsonb not null default '[]'::jsonb,
  display_order int  not null default 0,
  created_at    timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table if not exists register_rows (
  id            uuid primary key default gen_random_uuid(),
  register_id   uuid not null references register_definitions(id) on delete cascade,
  data          jsonb not null default '{}'::jsonb,
  display_order int  not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists register_rows_register_idx on register_rows (register_id, display_order);

-- =============================================================
-- Security Policy (flat list of titled markdown sections, ordered)
-- =============================================================

create table if not exists policy_sections (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  title         text not null,
  body_md       text default '',
  display_order int  not null default 0,
  version       int  not null default 1,
  control_refs  text[] default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists policy_sections_tenant_idx on policy_sections (tenant_id, display_order);

-- =============================================================
-- RLS
-- =============================================================

alter table work_plan_tasks      enable row level security;
alter table work_plan_notes      enable row level security;
alter table register_definitions enable row level security;
alter table register_rows        enable row level security;
alter table policy_sections      enable row level security;

drop policy if exists wpt_member_read   on work_plan_tasks;
drop policy if exists wpt_editor_write  on work_plan_tasks;
drop policy if exists wpn_member_read   on work_plan_notes;
drop policy if exists wpn_editor_write  on work_plan_notes;
drop policy if exists rdef_member_read  on register_definitions;
drop policy if exists rdef_editor_write on register_definitions;
drop policy if exists rrow_member_read  on register_rows;
drop policy if exists rrow_editor_write on register_rows;
drop policy if exists pol_member_read   on policy_sections;
drop policy if exists pol_editor_write  on policy_sections;

create policy wpt_member_read   on work_plan_tasks      for select using (user_can_see_tenant(tenant_id));
create policy wpt_editor_write  on work_plan_tasks      for all
  using (user_has_tenant_role(tenant_id, 'editor'))
  with check (user_has_tenant_role(tenant_id, 'editor'));

create policy wpn_member_read   on work_plan_notes      for select using (user_can_see_tenant(tenant_id));
create policy wpn_editor_write  on work_plan_notes      for all
  using (user_has_tenant_role(tenant_id, 'editor'))
  with check (user_has_tenant_role(tenant_id, 'editor'));

create policy rdef_member_read  on register_definitions for select using (user_can_see_tenant(tenant_id));
create policy rdef_editor_write on register_definitions for all
  using (user_has_tenant_role(tenant_id, 'editor'))
  with check (user_has_tenant_role(tenant_id, 'editor'));

create policy rrow_member_read  on register_rows for select using (
  exists (select 1 from register_definitions rd where rd.id = register_rows.register_id and user_can_see_tenant(rd.tenant_id))
);
create policy rrow_editor_write on register_rows for all
  using (exists (select 1 from register_definitions rd where rd.id = register_rows.register_id and user_has_tenant_role(rd.tenant_id, 'editor')))
  with check (exists (select 1 from register_definitions rd where rd.id = register_rows.register_id and user_has_tenant_role(rd.tenant_id, 'editor')));

create policy pol_member_read   on policy_sections      for select using (user_can_see_tenant(tenant_id));
create policy pol_editor_write  on policy_sections      for all
  using (user_has_tenant_role(tenant_id, 'editor'))
  with check (user_has_tenant_role(tenant_id, 'editor'));
