# vercel.json — why these settings

## `regions: ["pdx1"]`

Pin serverless functions to `pdx1` (Portland, OR) because the Supabase
project is in `us-west-2` (Oregon). Default Vercel region is `iad1`
(Washington DC, `us-east-1`), which means every DB round-trip used to
cross the country — ~140–200 ms per query. Same-region brings the RTT
under 10 ms. Combined with the parallelization + per-request caching
shipped alongside the original change, button-click latency drops by
~500 ms – 1 s for the typical API write.

Applies to every per-tenant Vercel project that builds from this repo.

## Why this lives in a separate `.md`

`vercel.json` is JSON, not JSONC — Vercel rejects unknown top-level
properties (including the `$comment` array convention) with a 0 ms
schema-validation failure that aborts the build *before* it starts.
Keep `vercel.json` minimal, document the *why* here.
