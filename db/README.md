# Database

Postgres on Supabase. Migrations are plain SQL files, applied in numeric order.

## Migration order

| File | Purpose |
|---|---|
| `migrations/0001_init.sql` | Schema: tenants, profiles, memberships, frameworks, scoring, snapshots, sharing, audit. |
| `migrations/0002_rls.sql` | Row Level Security policies + helper functions. |
| `migrations/0003_seed_csf2.sql` | Seed NIST CSF 2.0 framework + version with the canonical taxonomy JSON. |
| `migrations/0004_triggers.sql` | Audit trigger on `current_scores`; auth signup hook (profile + domain whitelist). |

## How to apply (interim, before app code lands)

In Supabase Studio → SQL Editor, paste each file in order and run. Each migration is idempotent enough for re-runs (`if not exists`, `on conflict do nothing`).

Once the app code lands, migrations will run via the Supabase CLI (`supabase db push`) or a dedicated migration tool. The numbering scheme stays the same.

## Roles and bypass

- `anon` — no policies match → no access. Used for the public-token share endpoint, which goes through an edge function that uses the service role.
- `authenticated` — policies key off `auth.uid()` and `memberships`.
- `service_role` — bypasses RLS. Used by edge functions that need to read across tenants (e.g., resolving a public share token).

## Useful queries

Latest snapshot per (tenant, framework):
```sql
select distinct on (tenant_id, framework_version_id)
       id, tenant_id, framework_version_id, label, period, taken_at
  from snapshots
 order by tenant_id, framework_version_id, taken_at desc;
```

Trend: function-level practice averages over time for one tenant + framework:
```sql
with by_group as (
  select s.id as snapshot_id, s.taken_at,
         left(ss.control_id, 2) as group_id,
         avg(ss.pra)::numeric(4,2) as pra_avg
    from snapshots s
    join snapshot_scores ss on ss.snapshot_id = s.id
   where s.tenant_id = $1 and s.framework_version_id = $2
   group by s.id, s.taken_at, left(ss.control_id, 2)
)
select * from by_group order by taken_at, group_id;
```
