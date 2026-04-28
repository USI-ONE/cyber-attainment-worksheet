# Frameworks

Canonical framework definitions live here as JSON. They are the source of truth for what the seed migrations insert into `framework_versions.definition`.

## Current frameworks

| Slug | Version | File | Status |
|---|---|---|---|
| `nist-csf-2.0` | 2.0 | `nist-csf-2.0.json` | Active (seeded by `db/migrations/0003_seed_csf2.sql`) |
| `cis-v8.1` | — | — | Planned, not yet authored |
| `hipaa-security-rule` | — | — | Planned, not yet authored |
| `iso-27001-2022` | — | — | Planned, not yet authored |

## Canonical JSON shape

```jsonc
{
  "schema_version": 1,
  "framework": {
    "slug": "nist-csf-2.0",
    "display_name": "NIST Cybersecurity Framework 2.0",
    "description": "..."
  },
  "scoring": {
    "dimensions": [
      { "key": "pol", "label": "Policy",   "description": "..." },
      { "key": "pra", "label": "Practice", "description": "..." },
      { "key": "gol", "label": "Goal",     "description": "..." }
    ],
    "tiers": [
      { "value": 1, "label": "Partial" },
      { "value": 2, "label": "Risk Informed" },
      { "value": 3, "label": "Repeatable" },
      { "value": 4, "label": "Adaptive" }
    ]
  },
  "groups": [
    {
      "id": "GV",
      "name": "GOVERN",
      "description": "...",
      "categories": [
        {
          "id": "GV.OC",
          "name": "Organizational Context",
          "controls": [
            { "id": "GV.OC-01", "outcome": "..." }
          ]
        }
      ]
    }
  ]
}
```

`groups` is the framework-agnostic name for the top-level division (CSF calls them functions, ISO calls them clauses, HIPAA calls them safeguards). The frontend renders any valid framework definition with the same components.

`scoring.dimensions` is the list of independent score axes for each control. CSF 2.0 uses three (Policy / Practice / Goal). Other frameworks may use one or more — the schema accommodates whatever is defined here.

## Adding a new framework

1. Author `<slug>.json` in this directory matching the shape above.
2. Author `db/migrations/000N_seed_<slug>.sql` that inserts the framework + version + JSON definition.
3. (Operationally) `insert into tenant_frameworks` for any tenant that should be scored against the new framework.

No app code change is required. The frontend reads `framework_versions.definition` and renders accordingly.
