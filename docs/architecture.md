# Architecture

This document captures the design decisions for the Cyber Attainment Worksheet platform and the reasoning behind each. It is the canonical reference for "why is it built this way." Specific tables and columns are documented in [data-model.md](data-model.md).

## Goals

1. **Board KPI report** — show CSF 2.0 (and later: CIS, HIPAA, ISO 27001) attainment trend over time per client.
2. **Persistence that survives a laptop change.** No more localStorage as the only home for assessment data.
3. **Multi-viewer, single-editor.** The CIO scores. Board members and stakeholders read. Quarterly cadence (or faster, bi-weekly aligned to board meetings).
4. **Snapshots as first-class.** Trend over time is meaningless without immutable, labeled point-in-time copies.
5. **Portfolio rollup** for funds (e.g., Bestige Holdings) — but PortCos *send* their data; the fund doesn't read across the portfolio without an explicit share.
6. **Board deliverables** as PDF / PPTX, not URLs.
7. **Multiple clients** with consistent design, unique branding (logo only), and the ability to add new frameworks without a refactor.

## Decisions

### One template repo, multiple Vercel projects, one shared database

`cyber-attainment-worksheet` is the only deployable code. Six (today) Vercel projects all link to this same repo and share the same Supabase project; each Vercel project is pinned to a tenant via a `TENANT_SLUG` environment variable. The per-client repositories (`caw-<slug>`) hold only configuration and assets — they don't deploy on their own.

**Why:** the prior split between AHP and Collision Leaders happened by code fork, and they drifted (AHP grew an entire GRC suite; CL stayed a single worksheet). A single source of truth for code prevents drift by construction. Per-client repos retain a useful purpose (logos, board-pack templates, runbooks) without giving a pathway for code drift.

### Postgres on Supabase as the persistence layer

Why Supabase: managed Postgres + Auth + Realtime + Edge Functions in one project, generous free / pro tiers, RLS as a first-class authorization mechanism, official Azure (Entra) auth provider.

Trade-off accepted: vendor lock to Supabase's auth + RLS conventions. Mitigation: the data model is plain Postgres and portable; only the auth integration would need rewriting if Supabase ever needed to be replaced.

### Microsoft Entra (Azure AD) SSO

The user (USI / Universal Systems Inc.) operates on M365. Entra is already provisioned, IT can manage groups, and B2B guest invites give every PortCo viewer access without additional licensing. Supabase has a native Azure provider — no custom OAuth code.

### Two roles only: `editor` and `viewer`

Editing is single-user (the CIO) for the foreseeable future. Multi-user editing was the hardest part of the original design space and is now off the table — no last-write-wins, no per-user drafts, no CRDT. Viewers are read-only and can be many.

If multi-user editing is ever needed, the audit log already captures every change, so a per-user draft layer can be added later without a data migration.

### Snapshots are immutable; live state is realtime

A snapshot is created explicitly via "Lock & Label" by the editor and copies `current_scores` into `snapshot_scores` at that moment. After creation, snapshots cannot be edited — corrections produce a new snapshot with a new label. Trend charts read snapshots only.

`current_scores` is the live working state. Viewers subscribe via Supabase realtime and see updates as the editor scores. This is what "realtime" means in our context.

**Why immutability:** trend integrity. If snapshots are mutable, the board chart can lie retroactively.

### Sharing replaces direct portfolio access

A fund (Bestige) doesn't have direct read access across PortCos. PortCos create explicit `snapshot_shares` granting read on a specific snapshot to either:

- another tenant in the system (e.g., Bestige's own tenant — produces a "Shared with us" inbox), or
- a public token (signed link, no login — for board members, regulators, insurance).

This correctly handles the case that not all clients are Bestige PortCos (USI is independent). The fund only sees what's been explicitly shared; the PortCo retains control.

### Frameworks are data, not code

The framework taxonomy is a JSONB column on `framework_versions.definition`. Adding NIST CSF 2.1, ISO 27001:2022, CIS v8.1, or HIPAA Security Rule is a SQL insert plus a JSON file in `frameworks/`. The frontend renders any valid framework definition with the same components.

Compound key on scores: `(tenant_id, framework_version_id, control_id)`. A tenant can be scored against multiple frameworks simultaneously without conflict.

### Vercel-issued URLs first; custom DNS later

Initial hostnames are `caw-<slug>.vercel.app`. Custom hostnames (e.g., `csf.collisionleaders.com`) attach later by adding the hostname in Vercel and adjusting `tenants.hostname` — no code change, no schema change.

### Branding

All sites share the same design and palette. Per-client branding is the logo only (`brand_config.logo_url`) plus the tenant display name. The single stylesheet is shared across all tenants.

## Migration from existing deployments

- **Collision Leaders** (GitHub Pages, single-file `index.html`, `localStorage` key `cl_csf20_v1`): one-click "Sync to cloud" import. See [runbooks/migrate-cl.md](runbooks/migrate-cl.md).
- **AHP** (Azure Static Web App, separate codebase with extra modules): not migrated as code. The CSF scoring portion of AHP starts fresh on this platform — empty start, no localStorage import. AHP's other modules (compliance registers, policy editor, KPIs) are out of scope for this platform and remain on the existing Azure deployment until separately addressed.
- **All other tenants** (Bestige, Black Slate, Outdoor Expressions, USI): empty start.

## Open architectural items (not blocking)

- **Multi-user editing** — design exists in audit_log, not yet exposed.
- **Auto-snapshots** — not implemented; manual "Lock & Label" only. The audit log is dense enough to derive a continuous trend later if desired.
- **Custom score dimensions per framework** — `scoring.dimensions` is in the JSON definition but `current_scores` columns are pinned to `pol/pra/gol/prio`. If a future framework needs more or different dimensions, this becomes a schema change. Trade-off accepted for simplicity now.
