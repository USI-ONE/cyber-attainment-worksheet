-- 0011_assessment_responses.sql
-- Per-control questionnaire responses backing the guided Practice assessment.
-- One row per (tenant, framework, control). The /assessment wizard auto-saves
-- on every answer change and recomputes the Practice score (current_scores.pra)
-- on every write so the radar/worksheet/reports update in real time.

create table if not exists public.assessment_responses (
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  framework_version_id uuid not null references public.framework_versions(id) on delete cascade,
  control_id           text not null,
  -- The four CMM-ladder questions. Answer set: 'no' | 'partial' | 'yes' | null
  -- (null = not answered). q4_improvement is freeform; if non-empty AND q1-3
  -- are all 'yes', the score unlocks tier 5 (Optimizing).
  q1_documented        text check (q1_documented is null or q1_documented in ('no','partial','yes')),
  q2_followed          text check (q2_followed  is null or q2_followed  in ('no','partial','yes')),
  q3_measured          text check (q3_measured  is null or q3_measured  in ('no','partial','yes')),
  q4_improvement       text,
  notes                text,
  -- The score that lib/assessment.ts computed from the four answers; persisted
  -- so we don't have to recompute when listing many rows for the landing page.
  computed_score       numeric(3,1),
  responded_by         text,
  responded_at         timestamptz not null default now(),
  primary key (tenant_id, framework_version_id, control_id)
);

create index if not exists assessment_responses_tenant_idx
  on public.assessment_responses (tenant_id, framework_version_id, responded_at desc);

-- Reuse the generic updated_at trigger function defined in 0009_incidents.sql.
-- Here it acts as a "responded_at" stamp so a partial save bumps the timestamp.
drop trigger if exists assessment_responses_set_responded_at on public.assessment_responses;
create or replace function public.set_responded_at()
returns trigger language plpgsql as $$
begin new.responded_at := now(); return new; end;
$$;
create trigger assessment_responses_set_responded_at
  before update on public.assessment_responses
  for each row execute function public.set_responded_at();

-- =============================================================================
-- RLS — same pattern as the rest of the schema (member-select, editor-modify).
-- Service-role bypasses both, so the API routes (which use the service-role
-- client today while auth is disabled) keep working.
-- =============================================================================

alter table public.assessment_responses enable row level security;

drop policy if exists assessment_responses_select on public.assessment_responses;
create policy assessment_responses_select on public.assessment_responses
  for select
  using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = assessment_responses.tenant_id and m.user_id = auth.uid()
    )
  );

drop policy if exists assessment_responses_modify on public.assessment_responses;
create policy assessment_responses_modify on public.assessment_responses
  for all
  using (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = assessment_responses.tenant_id and m.user_id = auth.uid()
        and m.role = 'editor'
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.tenant_id = assessment_responses.tenant_id and m.user_id = auth.uid()
        and m.role = 'editor'
    )
  );
