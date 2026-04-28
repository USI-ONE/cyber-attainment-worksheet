# Supabase setup (one-time)

## 1. Create the project

1. Go to [supabase.com](https://supabase.com) → New project.
2. Name: `cyber-attainment-worksheet`. Region: `us-east-1` (or closest to your users). Plan: Pro (~$25/mo) — required for stable backups, branching, and the realtime quotas we'll use.
3. Save the database password to 1Password. You'll need it for `psql` and the Supabase CLI.

## 2. Run migrations

In Supabase Studio → SQL Editor, paste and run each file in order:

1. `db/migrations/0001_init.sql` — schema
2. `db/migrations/0002_rls.sql` — RLS policies
3. `db/migrations/0003_seed_csf2.sql` — NIST CSF 2.0 seed (~106 controls, one big JSONB blob)
4. `db/migrations/0004_triggers.sql` — audit trigger + signup hook

After the seed, verify:

```sql
select f.slug, fv.version, jsonb_array_length(fv.definition->'groups') as groups
  from framework_versions fv
  join frameworks f on f.id = fv.framework_id;
-- Expected: nist-csf-2.0 | 2.0 | 6
```

## 3. Configure Auth

Authentication → Providers:

- **Disable** the default email/password and email-magic-link providers (we want SSO only).
- **Enable** Azure (which is Entra under the hood). You'll fill in client ID / secret / tenant ID after [entra.md](entra.md) is done.

Authentication → URL Configuration:

- **Site URL:** the Vercel URL of whichever tenant project you treat as canonical (any of them works for OAuth callbacks since they all share the same Supabase project). Pin it to `caw-collision-leaders.vercel.app` for now.
- **Redirect URLs (allow list):** add every tenant URL:
  - `https://caw-collision-leaders.vercel.app/auth/callback`
  - `https://caw-ahp.vercel.app/auth/callback`
  - `https://caw-bestige-holdings.vercel.app/auth/callback`
  - `https://caw-black-slate.vercel.app/auth/callback`
  - `https://caw-outdoor-expressions.vercel.app/auth/callback`
  - `https://caw-universal-systems.vercel.app/auth/callback`
  - Each tenant's eventual custom hostname (add when DNS is sorted).

## 4. Capture the env vars Vercel needs

Settings → API:

- `SUPABASE_URL` (Project URL)
- `SUPABASE_ANON_KEY` (anon public key) — safe to ship to clients
- `SUPABASE_SERVICE_ROLE_KEY` (service role key) — server-side only; never expose to clients

These go into Vercel as project env vars (see [vercel.md](vercel.md)).

## 5. (Later) Enable Realtime for `current_scores`

When the Phase 2 PR adds the live view: Database → Replication → enable replication on `current_scores`. The frontend will subscribe via `supabase.channel(...)` to push updates to viewers as the editor scores.

## Cost expectations

| Item | Cost |
|---|---|
| Supabase Pro | $25 / mo |
| Database storage | <100 MB at full rollout — included |
| Auth (50 monthly active users) | included |
| Realtime (concurrent connections during board meetings) | included |
| Edge function invocations (PDF/PPTX renders) | usage-based, expected <$5/mo |

Realistic monthly total at six-tenant rollout: **<$50**.
