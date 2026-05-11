-- 0015_user_management.sql
-- Standalone user-management — email + password auth, server-side sessions,
-- invite-token onboarding. Zero dependency on Supabase Auth / Clerk / Auth0 /
-- Entra. Designed so that swapping in OIDC/SAML later is a column addition
-- (auth_provider, external_subject) rather than a rewrite.
--
-- Authorization model — two dimensions:
--   1. profiles.is_platform_admin (boolean) — global super-admin (USI staff).
--      Implicit access to every tenant. Can administer users, tenants, and
--      memberships across the entire platform.
--   2. memberships(user_id, tenant_id, role) — per-tenant role:
--        viewer = read everything in the tenant
--        editor = read/write everything in the tenant; can also invite users
--                 to this tenant (delegated tenant administration)
--      A user with no membership and no platform_admin flag sees nothing.
--
-- Bootstrap: this migration only creates the SCHEMA. The apply script
-- (apply-0015.mjs) generates a random invite token for the first platform
-- admin and prints the URL. There is no plaintext password in this file.

-- =============================================================================
-- profiles — repurposed as our user-account table
-- =============================================================================
-- The existing profiles(id) referenced auth.users(id) with on-delete-cascade.
-- We're not using Supabase Auth, so drop the FK and let profiles stand on
-- its own. Existing rows (none in practice — auth has been off) keep their
-- IDs; new rows generate their own UUIDs via gen_random_uuid().

alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles alter column id set default gen_random_uuid();

alter table public.profiles
  add column if not exists password_hash         text,
  add column if not exists password_changed_at   timestamptz,
  add column if not exists is_platform_admin     boolean not null default false,
  add column if not exists status                text not null default 'active'
      check (status in ('active','disabled','invited')),
  add column if not exists last_login_at         timestamptz,
  add column if not exists invited_by            uuid references public.profiles(id) on delete set null,
  add column if not exists invited_at            timestamptz,
  add column if not exists updated_at            timestamptz not null default now();

-- Normalize email case at the unique-index layer so 'Chris@USI.com' and
-- 'chris@usi.com' aren't two accounts. Drop the constraint first (which
-- drops its backing index), then create our lower(email) unique index.
alter table public.profiles drop constraint if exists profiles_email_key;
drop index if exists public.profiles_email_key;
create unique index if not exists profiles_email_lower_idx
  on public.profiles (lower(email));

-- updated_at trigger reuses the helper defined in 0009_incidents.sql.
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- =============================================================================
-- sessions — server-side session storage; cookie carries opaque random token,
-- DB stores its SHA-256 hash so a DB leak does not yield live cookies.
-- =============================================================================

create table if not exists public.sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  token_hash    text not null unique,        -- hex SHA-256 of the cookie value
  user_agent    text,
  ip            text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz
);
create index if not exists sessions_user_idx
  on public.sessions (user_id, expires_at desc);

-- =============================================================================
-- user_invites — one-time tokens for onboarding + password-reset workflows
-- =============================================================================

create table if not exists public.user_invites (
  id                   uuid primary key default gen_random_uuid(),
  email                text not null,
  invited_by           uuid references public.profiles(id) on delete set null,
  tenant_id            uuid references public.tenants(id) on delete cascade,
  role                 public.membership_role,        -- nullable if invite is platform-admin-only
  grant_platform_admin boolean not null default false,
  token_hash           text not null unique,
  expires_at           timestamptz not null,
  accepted_at          timestamptz,
  accepted_by          uuid references public.profiles(id) on delete set null,
  revoked_at           timestamptz,
  created_at           timestamptz not null default now()
);
create unique index if not exists user_invites_email_pending_idx
  on public.user_invites (lower(email))
  where accepted_at is null and revoked_at is null;

-- =============================================================================
-- audit_log_user — separate from the existing scoring audit_log so user-mgmt
-- events don't pollute the per-tenant change feed. Records sign-ins, invite
-- issuance, role changes, user disablement.
-- =============================================================================

create table if not exists public.audit_log_user (
  id          bigserial primary key,
  actor_id    uuid references public.profiles(id) on delete set null,
  target_id   uuid references public.profiles(id) on delete set null,
  tenant_id   uuid references public.tenants(id)  on delete set null,
  action      text not null,           -- 'login_success','login_fail','invite_issued','invite_accepted','user_disabled','role_changed','platform_admin_granted','platform_admin_revoked','password_reset_admin'
  detail      jsonb not null default '{}'::jsonb,
  ip          text,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_user_actor_idx  on public.audit_log_user (actor_id, created_at desc);
create index if not exists audit_log_user_target_idx on public.audit_log_user (target_id, created_at desc);

-- =============================================================================
-- RLS — keep things service-role-only for now. Application layer enforces
-- authz; RLS gets a tightening pass once auth is mandatory across the app.
-- =============================================================================

alter table public.sessions        enable row level security;
alter table public.user_invites    enable row level security;
alter table public.audit_log_user  enable row level security;

-- Default-deny: no policies created. Service role bypasses RLS, so the
-- application keeps working. Selective member-visibility policies can be
-- added when we expose user/session listings to non-admin users (we don't
-- today; admin pages run through service-role server components).
