-- 0031_policy_documents_lineage.sql
--
-- Version history on policy_documents.
--
-- Each row in policy_documents already represents one version: when a
-- new file is uploaded for an existing tenant_policies / tenant_plans
-- entry, the prior row is left in place with status='archived' and the
-- linking table is repointed at the new row. What was missing: a way
-- to query "all versions of THIS document over time."
--
-- `lineage_id` ties every version of the same document together. The
-- first version of any doc gets a fresh lineage_id (= its own id, by
-- default — same uuid, different role). Every subsequent edit / replace
-- copies the lineage_id from the prior version to the new one. The
-- viewer then runs:
--
--   select * from policy_documents
--    where tenant_id = $1
--      and lineage_id = $2
--    order by created_at desc;
--
-- and gets the full version history of one policy or plan.

alter table public.policy_documents
  add column if not exists lineage_id uuid;

-- Backfill: each existing row is the first (and so far only) version of
-- its own lineage. After this update, lineage_id = id for every row.
update public.policy_documents
   set lineage_id = id
 where lineage_id is null;

alter table public.policy_documents
  alter column lineage_id set not null;

-- Common query path is (tenant_id, lineage_id) ordered by created_at —
-- index supports both filters together.
create index if not exists policy_documents_tenant_lineage_idx
  on public.policy_documents (tenant_id, lineage_id, created_at desc);

-- New-version provenance fields used by the inline editor:
--   change_note    — free-text "what changed" caption authored by the editor
--   superseded_by  — convenient pointer from an archived row to its
--                    successor. Optional — the lineage query already
--                    gives history; this just speeds up "show me what
--                    replaced this one."
alter table public.policy_documents
  add column if not exists change_note   text,
  add column if not exists superseded_by uuid references public.policy_documents(id) on delete set null;

create index if not exists policy_documents_superseded_by_idx
  on public.policy_documents (superseded_by);
