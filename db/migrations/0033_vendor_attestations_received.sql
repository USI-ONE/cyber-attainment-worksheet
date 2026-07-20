-- 0033_vendor_attestations_received.sql
--
-- Distinguish "when did we receive the attestation from the vendor" from
-- "when did the vendor issue the attestation." Both matter and they are
-- routinely different — a SOC 2 issued 2026-01-15 might not land in our
-- inbox until 2026-03-30, and the audit story wants the received date
-- so the review cycle clock starts at receipt.
--
-- Backfill uses issued_on when present, otherwise the row's created_at::date.
-- Going forward, new attestations default to current_date so a bare
-- INSERT still gets a sensible value if the caller doesn't specify.

alter table public.vendor_attestations
  add column if not exists received_at date;

update public.vendor_attestations
   set received_at = coalesce(issued_on, created_at::date)
 where received_at is null;

alter table public.vendor_attestations
  alter column received_at set default current_date,
  alter column received_at set not null;

-- Support the "latest TPSA received per vendor" query pattern the UI
-- surfaces at the top of the vendor editor.
create index if not exists vendor_attestations_vendor_received_idx
  on public.vendor_attestations (vendor_id, received_at desc);
