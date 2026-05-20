-- 0026_policy_documents_code.sql
--
-- Tag policy_documents with the catalog code they back, so that when a
-- newer version is uploaded the old one can be marked status='archived'
-- (file preserved for history) and the version-history list can be
-- assembled with a single indexed query:
--
--   select * from public.policy_documents
--    where tenant_id = $1 and policy_code = $2
--    order by created_at desc;
--
-- For existing rows, backfill from tenant_policies — whichever doc is
-- currently linked from a tenant_policies row inherits its code.
-- Documents that aren't part of the policy library (e.g., a control-
-- evidence PDF uploaded at /policy) stay with policy_code = null.

alter table public.policy_documents
  add column if not exists policy_code text
    references public.policy_library_catalog(code) on delete set null;

create index if not exists policy_documents_tenant_code_idx
  on public.policy_documents (tenant_id, policy_code, status, created_at desc);

update public.policy_documents pd
set policy_code = tp.policy_code
from public.tenant_policies tp
where tp.policy_document_id = pd.id
  and pd.policy_code is null;
