-- 0028_vendor_attestation_checklist.sql
--
-- Add a structured audit-checklist field to vendor_attestations. This is
-- where the TPSA's actual line-by-line responses live — distinct from the
-- attached file (the customer-signed copy of the same questions) and from
-- the high-level metadata (issued_on, expires_on, findings counts).
--
-- Shape:
--   {
--     "template_version": "tpsa.v1",
--     "items": [
--       { "id": "soc2_current",
--         "label": "Vendor maintains a current SOC 2 Type II...",
--         "response": "yes" | "no" | "na" | null,
--         "notes": "" }
--     ]
--   }
--
-- Stored per-row (not normalized into a separate table) because a TPSA
-- is a snapshot — you want to see exactly what the vendor said on the
-- form that was current at that time, not the latest version of the
-- template. The template_version field lets us migrate forward as the
-- questions evolve.

alter table public.vendor_attestations
  add column if not exists checklist jsonb;

-- Helps the UI show "vendors with checklists started" in a roll-up by
-- letting Postgres index the boolean "has a checklist" predicate.
create index if not exists vendor_attestations_has_checklist_idx
  on public.vendor_attestations (vendor_id)
  where checklist is not null;
