# Data model

Table-by-table reference. SQL definitions live in [`db/migrations/0001_init.sql`](../db/migrations/0001_init.sql).

## Identity and access

### `tenants`
One row per client. `slug` is the kebab-case identifier shared with the GitHub repo (`caw-<slug>`) and Vercel project name. `hostname` is filled in once DNS lands (e.g., `csf.collisionleaders.com`) — until then, the app resolves a tenant by matching the request `Host` against `caw-<slug>.vercel.app` patterns. `brand_config` is `{ logo_url, display_name_override?, ... }`.

### `profiles`
App-level user row. Mirrors `auth.users` (Supabase Auth) one-to-one. Created automatically by the `fn_handle_new_user()` trigger on signup.

### `memberships`
Per-tenant role grant. Two roles: `editor`, `viewer`. The CIO has `editor` on every tenant they score. Domain-whitelisted users get `viewer` automatically on signup.

### `domain_whitelist`
On signup, if a user's email domain matches a row here, they receive the configured `default_role` membership for that tenant automatically. Not user-readable (no RLS policies); only managed via service role / SQL editor.

## Frameworks

### `frameworks`
The framework as a concept (`nist-csf-2.0`, future `cis`, `hipaa-security-rule`, `iso-27001`). One row per slug.

### `framework_versions`
A specific version of a framework. `definition` is the canonical JSON: `{ schema_version, framework, scoring, groups[].categories[].controls[] }` — see [`frameworks/README.md`](../frameworks/README.md). `is_current` flags the active version per framework.

### `tenant_frameworks`
Which frameworks each tenant is being scored against. A tenant can have multiple active simultaneously (e.g., a healthcare PortCo could run CSF 2.0 and HIPAA Security Rule in parallel).

## Scoring

### `current_scores`
Live working state. Composite primary key `(tenant_id, framework_version_id, control_id)`. Columns:

- `pol`, `pra`, `gol` — Policy / Practice / Goal tier 1–4 (or NULL).
- `prio` — Priority 1–4 (or NULL).
- `owner`, `status`, `notes` — free text.
- `updated_by`, `updated_at` — provenance.

Edited by `editor`s only (via RLS). Every change emits one row per changed field into `audit_log` via the `trg_audit_current_scores` trigger.

### `snapshots`
Frozen point-in-time copy. `label` is free text (e.g., "2026-Q1 Board Pack"); `period` is an optional sortable token (`2026-Q1`, `2026-W18`). Immutable after creation — there is no UPDATE path in the app.

### `snapshot_scores`
Frozen copy of the score rows at snapshot time. No FK to `current_scores` — they're independent records once frozen.

## Sharing

### `snapshot_shares`
Two share modes, mutually permitted (CHECK constraint requires at least one):

- `recipient_tenant_id` — grants read of this snapshot to another tenant in the system. The recipient tenant sees it in their "Shared with us" inbox.
- `share_token` — public signed link, no login required. Validated by an edge function using the service role; not by RLS.

`expires_at` is optional (NULL = indefinite). `revoked_at` is the manual revoke field.

## Audit

### `audit_log`
One row per changed field. Append-only. Indexed on `(tenant_id, changed_at desc)` for efficient editor-facing queries.

Visible to editors of the tenant only.

## Frequently used queries

See [`db/README.md`](../db/README.md) for examples (latest snapshot per tenant + framework; trend by group over time).
