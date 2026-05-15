-- One-time, short-lived cross-subdomain sign-on tokens.
--
-- The hub (caw-portfolio-hub.vercel.app) hosts the canonical sign-in flow.
-- Each tenant deploy (caw-<slug>.vercel.app) is a separate browser origin,
-- so cookies from the hub can't authenticate requests there.
--
-- To make "sign in once at the hub → click into your tenant" work, the hub
-- mints a short-lived token bound to a (user_id, tenant_id, target_path)
-- triple. The browser redirects to the tenant deploy carrying the plaintext
-- token; the tenant's GET /auth/sso handler hashes it, looks up the row,
-- creates a tenant-side session for the user, marks the row used, and
-- redirects to the original target path.
--
-- One-time use: every successful exchange flips used_at so the same URL
-- can't be replayed. Short TTL (60 seconds from issue) so the window for
-- abuse is tiny even if a token leaks into a browser-history sync.

create table if not exists public.sso_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id)  on delete cascade,
  token_hash      text not null unique,
  target_path     text not null default '/',
  issued_at       timestamptz not null default now(),
  expires_at      timestamptz not null,
  used_at         timestamptz,
  ip              inet,
  user_agent      text
);

-- Hot lookup path: hash → row. Index already present via the UNIQUE constraint.
-- Add an index on user_id so we can audit / revoke pending tokens for a user.
create index if not exists idx_sso_tokens_user_id     on public.sso_tokens (user_id);
create index if not exists idx_sso_tokens_tenant_id   on public.sso_tokens (tenant_id);
create index if not exists idx_sso_tokens_expires_at  on public.sso_tokens (expires_at);

-- RLS: lock down. Service-role only (the hub + tenant API routes use the
-- service-role client). No direct table access from end users.
alter table public.sso_tokens enable row level security;
-- No policies = no access for the anon / authenticated roles.
