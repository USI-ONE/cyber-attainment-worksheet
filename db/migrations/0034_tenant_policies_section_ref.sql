-- 0034_tenant_policies_section_ref.sql
--
-- Many tenants back multiple Policy Library rows with a SINGLE umbrella
-- document (e.g., USI's "Information Privacy and Security Policy" covers
-- Access Control, Data Classification, Encryption, Incident Response,
-- etc.). Wave 1 already lets us point 15 tenant_policies rows at the
-- same policy_documents row, but the UI has no way to disambiguate
-- which SECTION of the umbrella backs each catalog row — every row
-- shows the same title and version, which is technically correct but
-- visually confusing on the /policies page.
--
-- This adds `section_ref` — a short free-text field the user types to
-- cite the specific section (e.g., "§4.2 Access Control", "Appendix B",
-- "Part III, Section 3.1"). Nullable; when null, the UI keeps its
-- current behavior (title + version only).
--
-- Mirrored on tenant_plans so umbrella BCP/DR/IR plans get the same
-- treatment without a follow-up migration.

alter table public.tenant_policies
  add column if not exists section_ref text;

alter table public.tenant_plans
  add column if not exists section_ref text;

comment on column public.tenant_policies.section_ref is
  'Optional citation into the linked document — e.g., "§4.2 Access Control". '
  'Used when one document backs multiple catalog rows.';

comment on column public.tenant_plans.section_ref is
  'Optional citation into the linked document — e.g., "§4.2 Access Control". '
  'Used when one document backs multiple catalog rows.';
