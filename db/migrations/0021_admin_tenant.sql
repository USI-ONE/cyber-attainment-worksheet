-- Admin-tenant flag.
--
-- Any tenant with is_admin_tenant=true grants platform-admin power to every
-- one of its members. Practically: instead of flipping profiles.is_platform_admin
-- on individual users one-by-one, the operator (USI) marks their own tenant
-- as the admin tenant, then onboards USI staff via the normal "invite to
-- this tenant" flow. Anyone added as editor or viewer to the admin tenant
-- automatically gets cross-tenant access via the same code path that
-- already honors is_platform_admin (see lib/auth.ts).
--
-- Multiple admin tenants are allowed (a partner MSP could have its own).
-- The constraint is just "if you're a member of ANY admin tenant, you're
-- effectively a platform admin."
--
-- Default for existing tenants: false. Universal Systems Inc. (USI) is
-- pre-flipped here since they are the platform operator; flip it off via
-- /admin/tenants if a different tenant should hold the role.

alter table public.tenants
  add column if not exists is_admin_tenant boolean not null default false;

create index if not exists idx_tenants_is_admin_tenant
  on public.tenants (is_admin_tenant)
  where is_admin_tenant = true;

-- Seed USI as the admin tenant. Idempotent — re-running is a no-op.
update public.tenants
   set is_admin_tenant = true
 where slug = 'universal-systems'
   and is_admin_tenant = false;
