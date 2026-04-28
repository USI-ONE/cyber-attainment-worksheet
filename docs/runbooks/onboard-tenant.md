# Runbook: Onboard a new tenant

For fresh-start tenants — Animal Health Partners (AHP), Bestige Holdings, Black Slate Partners, Outdoor Expressions, Universal Systems Inc., or any future client. Use [migrate-cl.md](migrate-cl.md) instead if the tenant has existing assessment data to import.

## Inputs you need

- **Slug** — kebab-case, matches the `caw-<slug>` repo. Example: `bestige-holdings`.
- **Display name** — e.g., `Bestige Holdings`.
- **Email domain** — for the viewer whitelist. Example: `bestigeholdings.com`.
- **Logo SVG** — sized for ~120×120 display. Drop it into `assets/logo.svg` of the per-client repo.

## 1. Per-client repo

Confirm `https://github.com/USI-ONE/caw-<slug>` exists. If not, create it (it's listed in the [tenants/README.md](../../tenants/README.md) — they were all created at platform bootstrap).

Update its `caw.config.json` with the right slug and display name. Drop the logo into `assets/logo.svg`. Push.

## 2. Vercel project

Create a Vercel project named `caw-<slug>`:

- Connect to `USI-ONE/cyber-attainment-worksheet` (this template repo).
- Set environment variable `TENANT_SLUG=<slug>`.
- Inherit the shared env vars (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `ENTRA_*`, etc. — see [setup/vercel.md](../setup/vercel.md)).
- Deploy. The project gets `caw-<slug>.vercel.app` automatically.

## 3. Provision in Supabase

```sql
-- Tenant
insert into tenants (slug, hostname, display_name, brand_config)
values (
  '<slug>',
  'caw-<slug>.vercel.app',
  '<Display Name>',
  jsonb_build_object(
    'logo_url', 'https://raw.githubusercontent.com/USI-ONE/caw-<slug>/main/assets/logo.svg',
    'display_name_override', '<Display Name>'
  )
);

-- Enable NIST CSF 2.0 (default)
insert into tenant_frameworks (tenant_id, framework_version_id)
select t.id, fv.id
  from tenants t,
       framework_versions fv
  join frameworks f on f.id = fv.framework_id
 where t.slug = '<slug>'
   and f.slug = 'nist-csf-2.0'
   and fv.is_current;

-- Domain whitelist for viewers
insert into domain_whitelist (domain, tenant_id, default_role)
select '<email-domain>', t.id, 'viewer'
  from tenants t
 where t.slug = '<slug>';
```

## 4. Grant yourself editor

After signing in to `caw-<slug>.vercel.app` at least once:

```sql
insert into memberships (user_id, tenant_id, role)
select u.id, t.id, 'editor'
  from auth.users u, tenants t
 where u.email = '<your-email>'
   and t.slug = '<slug>';
```

## 5. Verify

Open `caw-<slug>.vercel.app`:

- Logo shows the tenant's brand.
- Framework header reads NIST CSF 2.0.
- Radar shows zero attainment.
- All 106 controls render.

Begin scoring. The first snapshot is created when you click **Lock & Label** for the first time (typically pre-board-meeting).

## 6. Optional: invite viewers explicitly

Domain whitelist handles most cases. For viewers without a matching email domain (board members on personal Gmail, etc.), invite them via Entra B2B and add an explicit membership row:

```sql
insert into memberships (user_id, tenant_id, role)
select u.id, t.id, 'viewer'
  from auth.users u, tenants t
 where u.email = '<viewer-email>'
   and t.slug = '<slug>';
```

## Onboarding checklist (per tenant)

- [ ] `caw-<slug>` repo populated with logo + config
- [ ] Vercel project created with `TENANT_SLUG` env var
- [ ] `tenants` row inserted
- [ ] `tenant_frameworks` row inserted (NIST CSF 2.0)
- [ ] `domain_whitelist` row inserted (if applicable)
- [ ] Editor membership granted to CIO
- [ ] Empty state verified at `caw-<slug>.vercel.app`
