# Vercel project setup (one-time, per tenant)

Six Vercel projects, one per tenant — all linked to this same template repository, distinguished only by environment variables.

## Pre-conditions

- Supabase project exists ([supabase.md](supabase.md))
- Entra app registration is wired into Supabase Auth ([entra.md](entra.md))
- This template repo is pushed to `https://github.com/USI-ONE/cyber-attainment-worksheet`

## Shared environment variables (set on every project)

| Name | Value | Notes |
|---|---|---|
| `SUPABASE_URL` | from Supabase Studio → Settings → API | Project URL |
| `SUPABASE_ANON_KEY` | from Supabase Studio → Settings → API | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | from Supabase Studio → Settings → API | **Server-side only.** Mark as "Sensitive" in Vercel. Used by edge functions for service-role operations (e.g., resolving public share tokens). |
| `ENTRA_TENANT_ID` | from [entra.md](entra.md) step 1 | |
| `ENTRA_CLIENT_ID` | from [entra.md](entra.md) step 1 | |
| `ENTRA_CLIENT_SECRET` | from [entra.md](entra.md) step 2 | Mark as "Sensitive". |

## Per-project environment variables

| Name | Example | Notes |
|---|---|---|
| `TENANT_SLUG` | `collision-leaders` | The single env var that makes this Vercel project a specific tenant. |
| `NEXT_PUBLIC_TENANT_SLUG` | `collision-leaders` | Same value, exposed to the client bundle for branding lookup at render time. |
| `NEXTAUTH_URL` | `https://caw-collision-leaders.vercel.app` | Or the eventual custom hostname when DNS lands. |

## Create the projects

For each of the six tenants:

1. Vercel → **Add New** → **Project** → import `USI-ONE/cyber-attainment-worksheet`.
2. Project name: `caw-<slug>` (must match the GitHub per-client repo name for clarity).
3. Framework: Next.js (auto-detected once app code lands).
4. Root directory: `./` (default).
5. Set the shared env vars (above).
6. Set the per-project env vars (above) with the right `<slug>`.
7. Deploy.

Each project gets `caw-<slug>.vercel.app` as its default Vercel-issued URL. That's the interim hostname.

## Custom domains (later)

When DNS for a tenant is ready:

1. Vercel project → **Settings** → **Domains** → **Add** → enter `csf.<tenantdomain>.com` (or whatever the tenant chose).
2. Vercel emits a CNAME target. Tenant's DNS admin adds the CNAME.
3. Once verified, update the Supabase tenant row:
   ```sql
   update tenants
      set hostname = 'csf.<tenantdomain>.com'
    where slug = '<slug>';
   ```
4. Add the new hostname to Supabase Auth → URL Configuration → Redirect URLs.
5. Add the new redirect URI to Entra's app registration redirect URI list.

No code change required.

## Branch and deploy strategy

- **Production:** the `main` branch of `cyber-attainment-worksheet` deploys to all six projects automatically.
- **Preview:** every PR builds a preview against each project's env vars. Preview URLs include the slug, so PRs can be reviewed per-tenant.
- **Promotion:** PR → review → merge to `main` → six projects re-deploy automatically.

Because all six projects share the same repo, code drift is impossible by construction. Only env vars and the per-client repo's logo / config differ across tenants.
