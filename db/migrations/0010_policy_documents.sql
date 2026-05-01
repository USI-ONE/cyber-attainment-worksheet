-- 0010_policy_documents.sql
-- Per-tenant store of cybersecurity policy *documents* (PDF, DOCX, etc.)
-- These are the artifacts that back NIST CSF 2.0 scoring decisions: when a
-- control's Policy column says "3", a board member can ask "what's the policy?"
-- and the answer should be one click away.
--
-- Document model is single-table (one row per document), unlike incidents
-- (parent + child documents). Each policy document carries a list of NIST
-- control IDs it satisfies, and the worksheet UI surfaces the count per row
-- so the link from "we have a policy" to "we scored Practice = 3" is visible.

-- =============================================================================
-- Table
-- =============================================================================

create table if not exists public.policy_documents (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  title           text not null,
  version         text,                     -- freeform: "1.2", "2026-Q2", etc.
  effective_date  date,
  owner           text,                     -- person or role responsible
  status          text not null default 'published'
                    check (status in ('draft','published','archived')),
  description     text,
  storage_path    text not null,            -- key in `policy-documents` bucket
  filename        text not null,
  content_type    text,
  size_bytes      bigint,
  uploaded_by     text,
  linked_control_ids text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists policy_documents_tenant_idx
  on public.policy_documents (tenant_id, status, effective_date desc nulls last, created_at desc);

-- A GIN index on linked_control_ids lets the worksheet ask "which policy docs
-- back control PR.AA-05?" without scanning the whole table per render.
create index if not exists policy_documents_controls_idx
  on public.policy_documents using gin (linked_control_ids);

-- updated_at trigger (function defined in 0009)
drop trigger if exists policy_documents_set_updated_at on public.policy_documents;
create trigger policy_documents_set_updated_at
  before update on public.policy_documents
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================

alter table public.policy_documents enable row level security;

drop policy if exists policy_documents_select on public.policy_documents;
create policy policy_documents_select on public.policy_documents
  for select
  using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = policy_documents.tenant_id and m.user_id = auth.uid()
    )
  );

drop policy if exists policy_documents_modify on public.policy_documents;
create policy policy_documents_modify on public.policy_documents
  for all
  using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = policy_documents.tenant_id and m.user_id = auth.uid()
        and m.role = 'editor'
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = policy_documents.tenant_id and m.user_id = auth.uid()
        and m.role = 'editor'
    )
  );

-- =============================================================================
-- Storage bucket
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('policy-documents', 'policy-documents', false)
on conflict (id) do update set public = excluded.public;
