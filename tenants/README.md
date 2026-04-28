# Tenants

Per-client repositories hold tenant-specific configuration and assets only — no deployable code. Each is named `caw-<slug>`.

| Tenant                  | Slug                  | Repo                                                                               | Bestige PortCo? |
|-------------------------|-----------------------|------------------------------------------------------------------------------------|---|
| Collision Leaders       | `collision-leaders`   | [caw-collision-leaders](https://github.com/USI-ONE/caw-collision-leaders)          | Yes |
| Animal Health Partners  | `ahp`                 | [caw-ahp](https://github.com/USI-ONE/caw-ahp)                                      | Yes |
| Bestige Holdings        | `bestige-holdings`    | [caw-bestige-holdings](https://github.com/USI-ONE/caw-bestige-holdings)            | n/a (the fund itself) |
| Black Slate Partners    | `black-slate`         | [caw-black-slate](https://github.com/USI-ONE/caw-black-slate)                      | Yes |
| Outdoor Expressions     | `outdoor-expressions` | [caw-outdoor-expressions](https://github.com/USI-ONE/caw-outdoor-expressions)      | Yes |
| Universal Systems Inc.  | `universal-systems`   | [caw-universal-systems](https://github.com/USI-ONE/caw-universal-systems)          | No |

## What's in each per-client repo

```
caw.config.json           Slug, display name, hostname, active framework versions
assets/logo.svg           Tenant logo (only required brand asset)
templates/board-pack.pptx (optional) Per-client PPTX template; falls back to template default
README.md                 Client runbook: editor contact, viewer distribution list, evidence URLs
```

## What's NOT in per-client repos

- App code — lives in this template repo only.
- Database schema or migrations — live in `db/migrations/` here.
- Framework definitions — live in `frameworks/` here.
- Score data — lives in Supabase only.

This separation prevents the drift that happened with the original AHP / CL split.

## Adding a new tenant

See [`docs/runbooks/onboard-tenant.md`](../docs/runbooks/onboard-tenant.md).
