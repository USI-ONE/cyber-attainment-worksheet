# Runbook: Migrate Collision Leaders

Bring Collision Leaders' existing `localStorage` assessment data into the platform without losing anything.

**Pre-condition:** Supabase migrations applied ([setup/supabase.md](../setup/supabase.md)), Entra app registered ([setup/entra.md](../setup/entra.md)), and the `caw-collision-leaders` Vercel project is deployed and reachable at `https://caw-collision-leaders.vercel.app`.

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
    'logo_url', 'https://raw.githubusercontent.com/USI-ONE/caw-collision-leaders/main/assets/logo.png',
    'tagline', 'The Crown of Quality'
  )
)
on conflict (slug) do nothing;

-- Enable NIST CSF 2.0 for this tenant
insert into tenant_frameworks (tenant_id, framework_version_id)
select t.id, fv.id
  from tenants t
       cross join framework_versions fv
       join frameworks f on f.id = fv.framework_id
 where t.slug = 'collision-leaders'
   and f.slug = 'nist-csf-2.0'
   and fv.is_current
on conflict do nothing;
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
   and t.slug = 'collision-leaders'
on conflict do nothing;

-- Auto-grant viewer to anyone signing in with @collisionleaders.com
insert into domain_whitelist (domain, tenant_id, default_role)
select 'collisionleaders.com', t.id, 'viewer'
  from tenants t
 where t.slug = 'collision-leaders'
on conflict do nothing;
```

## 3. Verify the empty state (1 minute)

Open `https://caw-collision-leaders.vercel.app`. Sign in via Microsoft. Confirm:

- The CL crown logo is visible in the header.
- The framework header reads "NIST Cybersecurity Framework 2.0".
- The radar shows zero attainment (no scores yet).
- All 106 control rows render across the 6 functions.

If any of those fail, **stop here.** The localStorage import in step 4 will fail loudly if the framework definition isn't seeded or the tenant isn't provisioned.

## 4. Export legacy data and import it (5 minutes)

1. Open the legacy site: `https://usi-one.github.io/Collision-Leaders/` (in any browser tab).
2. Open the browser console (F12 → **Console**).
3. Paste the snippet shown at `https://caw-collision-leaders.vercel.app/import` (the **Import** page on the new app has a **Copy** button for the snippet) and press **Enter**.
   
   For convenience, the snippet is:
   ```js
   (()=>{const k='cl_csf20_v1';const d=localStorage.getItem(k);if(!d){alert('No legacy data found in localStorage under key '+k);return;}const a=document.createElement('a');a.href='data:application/json;charset=utf-8,'+encodeURIComponent(d);a.download='legacy-'+new Date().toISOString().slice(0,10)+'.json';document.body.appendChild(a);a.click();document.body.removeChild(a);})();
   ```
   
4. A file like `legacy-2026-04-28.json` downloads.
5. Switch to the new app: `https://caw-collision-leaders.vercel.app/import`.
6. Choose the JSON file and click **Import**.
7. Server validates editor role, populates `current_scores` for the CL tenant, and creates a snapshot labeled `Import baseline YYYY-MM-DD`. Success banner shows the imported control count.

## 5. Verify (you, 5 minutes)

Open `https://caw-collision-leaders.vercel.app`:

- Radar should match the screenshot from step 0.
- CSV export should match `cl-pre-migration.csv` (allowing for column-order differences — content should match).

If anything looks wrong, the database insert is reversible:

```sql
delete from current_scores where tenant_id = (select id from tenants where slug = 'collision-leaders');
delete from snapshot_scores where snapshot_id in (select id from snapshots where tenant_id = (select id from tenants where slug = 'collision-leaders'));
delete from snapshots where tenant_id = (select id from tenants where slug = 'collision-leaders');
```

The legacy localStorage is untouched. Re-export and try again, or escalate.

## 6. Cutover (after step 5 verifies)

Add a redirect to the existing GitHub Pages site so users land on the new URL. In `USI-ONE/Collision-Leaders` `index.html`, near the top of `<head>`:

```html
<meta http-equiv="refresh"
      content="0; url=https://caw-collision-leaders.vercel.app/">
<link rel="canonical" href="https://caw-collision-leaders.vercel.app/">
```

Commit and push to the `main` branch. GitHub Pages picks it up within a minute.

Leave the redirect in place for **30 days**. After 30 days, decide: archive the repo, delete the `gh-pages` site, or leave the redirect indefinitely.

## 7. Rollback path

| When | How |
|---|---|
| Before step 6 | Use the old site as before. Delete the import data (SQL above). No user-visible impact. |
| After step 6, < 30 days | Revert the redirect commit on the gh-pages site. Old site is back. The new app continues to exist; you decide whether to deprecate it or fix forward. |
| After 30 days | Same as above; the gh-pages history still has the pre-redirect HTML. |
