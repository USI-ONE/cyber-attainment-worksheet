# cyber-attainment-worksheet

Multi-tenant cyber framework attainment platform. NIST CSF 2.0 today; CIS, HIPAA, ISO 27001 are config additions, not code changes.

This is the **template repository** — all deployable code lives here. Per-client repositories (`caw-<slug>`) hold tenant-specific configuration and assets only; they don't deploy on their own.

## Status

**Foundation only.** No app code yet — this commit lays the database schema, RLS policies, the NIST CSF 2.0 seed, the audit trigger, and the operational documentation. App code (Next.js / Supabase client / Entra SSO) is the next PR.

## Tenants

| Tenant                   | Slug                  | Per-client repo                                                                            | Interim hostname                       |
|--------------------------|-----------------------|--------------------------------------------------------------------------------------------|----------------------------------------|
| Collision Leaders        | `collision-leaders`   | [caw-collision-leaders](https://github.com/USI-ONE/caw-collision-leaders)                  | `caw-collision-leaders.vercel.app`     |
| Animal Health Partners   | `ahp`                 | [caw-ahp](https://github.com/USI-ONE/caw-ahp)                                              | `caw-ahp.vercel.app`                   |
| Bestige Holdings         | `bestige-holdings`    | [caw-bestige-holdings](https://github.com/USI-ONE/caw-bestige-holdings)                    | `caw-bestige-holdings.vercel.app`      |
| Black Slate Partners     | `black-slate`         | [caw-black-slate](https://github.com/USI-ONE/caw-black-slate)                              | `caw-black-slate.vercel.app`           |
| Outdoor Expressions      | `outdoor-expressions` | [caw-outdoor-expressions](https://github.com/USI-ONE/caw-outdoor-expressions)              | `caw-outdoor-expressions.vercel.app`   |
| Universal Systems Inc.   | `universal-systems`   | [caw-universal-systems](https://github.com/USI-ONE/caw-universal-systems)                  | `caw-universal-systems.vercel.app`     |

Custom hostnames (e.g., `csf.collisionleaders.com`) layer on later as a no-code change once DNS is sorted.

## Repository layout

```
db/
  migrations/         SQL migrations, run in numeric order
  README.md           Migration order, common queries
frameworks/
  nist-csf-2.0.json   Canonical framework taxonomy (source of truth)
  README.md           Framework JSON shape, how to add new ones
docs/
  architecture.md     Architecture decisions and rationale
  data-model.md       Table-by-table reference
  runbooks/
    migrate-cl.md     Step-by-step migration of Collision Leaders' localStorage data
    onboard-tenant.md Generic new-tenant onboarding
  setup/
    supabase.md       Supabase project setup
    entra.md          Entra app registration
    vercel.md         Vercel projects setup
tenants/
  README.md           Index of per-client repos
```

## Architecture in one paragraph

One template repo (this one) deploys to six Vercel projects, one per tenant, all backed by a single Supabase Postgres database. Tenant-by-hostname routing in the app picks the right tenant on each request. Auth is Microsoft Entra (SSO). Two roles: `editor` (CIO) writes scores; `viewer` (board members, etc.) reads. Frameworks (NIST CSF 2.0 today) are stored as JSON in the database, so adding CIS / HIPAA / ISO 27001 later is a config insert, not a refactor. Snapshots are immutable point-in-time copies that power trend and rollup; live state is realtime via Supabase channels. Snapshot sharing — explicit, per-snapshot — replaces a "Bestige reads everything" design with "PortCos share what they want." See [docs/architecture.md](docs/architecture.md) for the long version.

## Quickstart (operator)

1. [`docs/setup/supabase.md`](docs/setup/supabase.md) — create the Supabase project, run migrations.
2. [`docs/setup/entra.md`](docs/setup/entra.md) — register the Entra app, configure Supabase Auth Azure provider.
3. [`docs/setup/vercel.md`](docs/setup/vercel.md) — create the six Vercel projects, set env vars.
4. [`docs/runbooks/migrate-cl.md`](docs/runbooks/migrate-cl.md) — bring Collision Leaders' existing localStorage data into the platform.
5. [`docs/runbooks/onboard-tenant.md`](docs/runbooks/onboard-tenant.md) — repeat for AHP, Bestige, Black Slate, Outdoor Expressions, USI (no localStorage import for these — fresh start).

## License

Proprietary. © Universal Systems Inc. All rights reserved.
