-- 0027_attestation_types_tpsa.sql
--
-- Extend the vendor_attestations.attestation_type CHECK constraint with two
-- additional values that come up often in MSP-managed engagements but were
-- previously folded into 'other':
--
--   tpsa  — Third-Party Security Assessment, the annual vendor security
--           questionnaire/audit the vendor produces (or that the customer
--           runs against the vendor). Distinct from a SOC 2 report because
--           it's typically customer-owned, not vendor-issued.
--   ddq   — Vendor Due Diligence Questionnaire (e.g. SIG, CAIQ). Filled in
--           by the vendor as part of onboarding and refreshed periodically.
--
-- The CHECK constraint name from migration 0017 is the default Postgres
-- naming. Drop-and-recreate is the only way to alter a CHECK in place.

alter table public.vendor_attestations
  drop constraint if exists vendor_attestations_attestation_type_check;

alter table public.vendor_attestations
  add constraint vendor_attestations_attestation_type_check
  check (attestation_type in (
    'soc2_type1','soc2_type2',
    'iso_27001','iso_27017','iso_27018','iso_27701',
    'pci_dss','hipaa_baa',
    'fedramp_high','fedramp_moderate','cmmc',
    'cyber_insurance','penetration_test','vulnerability_scan',
    'tpsa','ddq',
    'other'
  ));
