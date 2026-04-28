# Runbook: Migrate Collision Leaders

Bring Collision Leaders' existing `localStorage` assessment data into the platform without losing anything.

**Pre-condition:** the foundation (Supabase + Entra + Vercel project for `caw-collision-leaders`) is set up per [setup/supabase.md](../setup/supabase.md), [setup/entra.md](../setup/entra.md), and [setup/vercel.md](../setup/vercel.md). The app code (Phase 1 PR, not yet shipped at the time of writing) is deployed and renders an empty unscored worksheet at `caw-collision-leaders.vercel.app`.

## 0. Pre-flight (you, 2 minutes)

Open the existing GitHub Pages site: `https://usi-one.github.io/Collision-Leaders/`.

1. Take a full-page screenshot of the radar + dashboard. Save it.
2. Click **Export CSV**. Save the file. Name it `cl-pre-migration.csv`.

This is your safety net. Until cutover (step 6), nothing about the existing site changes.

## 1. Provision the tenant in Supabase (1 minute)

In Supabase Studio → SQL Editor, run:

```sql
-- Create the tenant
insert into tenants (slug, hostname, display_name, brand_config)
values (
  'collision-leaders',
  'caw-collision-leaders.vercel.app',
  'Collision Leaders',
  jsonb_build_object(
    'logo_url', 'https://raw.githubusercontent.com/USI-ONE/caw-collision-leaders/main/assets/logo.svg',
    'display_name_override', 'Collision Leaders'
  )
);

-- Enable NIST CSF 2.0 for this tenant
insert into tenant_frameworks (tenant_id, framework_version_id)
select t.id, fv.id
  from tenants t,
       framework_versions fv
  join frameworks f on f.id = fv.framework_id
 where t.slug = 'collision-leaders'
   and f.slug = 'nist-csf-2.0'
   and fv.is_current;
```

Verify:

```sql
select t.slug, f.slug as framework, fv.version
  from tenant_frameworks tf
  join tenants t on t.id = tf.tenant_id
  join framework_versions fv on fv.id = tf.framework_version_id
  join frameworks f on f.id = fv.framework_id;
-- Expected: collision-leaders | nist-csf-2.0 | 2.0
```

## 2. Grant yourself editor; whitelist the CL email domain (1 minute)

After signing in to the new app at least once (so your `auth.users` row exists):

```sql
-- Grant yourself editor on Collision Leaders
insert into memberships (user_id, tenant_id, role)
select u.id, t.id, 'editor'
  from auth.users u, tenants t
 where u.email = '<your-email>'
   and t.slug = 'collision-leaders';

-- Auto-grant viewer to anyone signing in with @collisionleaders.com
insert into domain_whitelist (domain, tenant_id, default_role)
select 'collisionleaders.com', t.id, 'viewer'
  from tenants t
 where t.slug = 'collision-leaders';
```

## 3. Verify the empty state (1 minute)

Open `https://caw-collision-leaders.vercel.app`. Sign in via Entra. Confirm:

- The CL crown logo is visible.
- The framework header reads "NIST Cybersecurity Framework 2.0".
- The radar shows zero attainment (no scores yet).
- All 106 control rows render across the 6 functions.

If any of those fail, **stop here.** The localStorage import in step 4 will fail loudly if the framework definition isn't seeded.

## 4. Import (you, single click — once app code lands)

The Phase 1 PR adds an "Sync to cloud" button to the **old** GitHub Pages site. The button is a tiny script appended to the existing `index.html`:

1. Open `https://usi-one.github.io/Collision-Leaders/`.
2. Click **Sync to cloud**. Sign in via Entra (same identity you used in step 3).
3. The script reads `localStorage['cl_csf20_v1']`, POSTs it to `https://caw-collision-leaders.vercel.app/api/import` along with your auth token.
4. The server validates that you are an editor on `collision-leaders`, populates `current_scores`, and creates a snapshot labeled `Import baseline YYYY-MM-DD`.

A success toast appears; the page also writes a flag to `localStorage` so subsequent visits show "Already synced — open new app."

## 5. Verify (you, 5 minutes)

Open `https://caw-collision-leaders.vercel.app`:

- Radar should match the screenshot from step 0.
- CSV export should match `cl-pre-migration.csv` (allowing for minor formatting differences in column order — content should match).
- Snapshots tab should show one row: `Import baseline YYYY-MM-DD`.

If anything looks wrong, the database insert is reversible:

```sql
delete from current_scores where tenant_id = (select id from tenants where slug = 'collision-leaders');
delete from snapshots      where tenant_id = (select id from tenants where slug = 'collision-leaders');
```

The old localStorage is untouched. Go back to the old site and try again, or escalate.

## 6. Cutover (30 minutes after step 5 verifies)

Add a redirect to the existing GitHub Pages site so users land on the new URL:

```html
<!-- index.html, near the top of <head> -->
<meta http-equiv="refresh"
      content="0; url=https://caw-collision-leaders.vercel.app/">
<link rel="canonical" href="https://caw-collision-leaders.vercel.app/">
```

Commit and push to the `main` branch of `USI-ONE/Collision-Leaders`. GitHub Pages picks it up within a minute.

Leave the redirect in place for **30 days**. After 30 days, decide: archive the repo, delete the gh-pages site, or leave the redirect indefinitely.

## 7. Rollback path

| When | How |
|---|---|
| Before step 6 | Use the old site as before. Delete the import data (SQL above). No user-visible impact. |
| After step 6, < 30 days | Revert the redirect commit on the gh-pages site. Old site is back. The new app continues to exist; you decide whether to deprecate it or fix forward. |
| After 30 days | Same as above; the gh-pages history still has the pre-redirect HTML. |
