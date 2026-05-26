-- 0029_assessment_items.sql
--
-- Expand the assessment schema to support variable-length question lists
-- per control. Migrations 0006 / 0007 fixed assessment_responses at three
-- columns: q1_documented, q2_followed, q3_measured (+ q4_improvement
-- evidence narrative). That ceiling forced every control into the same
-- three-question template; some controls genuinely need 4-5 focused
-- questions to capture the practice (e.g., MFA coverage where you want
-- to score human accounts, privileged service accounts, contractors,
-- and hardware-key adoption separately).
--
-- This migration:
--   1. Adds items_answered jsonb that stores [{id, answer, notes}, ...]
--      where id matches the AssessmentItem.id defined in
--      lib/assessment-questions.ts (currently 'q1', 'q2', 'q3'; controls
--      can later add 'q4', 'q5', etc.).
--   2. Backfills items_answered from the existing q1/q2/q3 columns so
--      every prior response already exists in the new shape on day one.
--   3. KEEPS the old q1_documented / q2_followed / q3_measured /
--      q4_improvement columns in place — readers that haven't been
--      migrated yet (e.g., lib/recommendations.ts, audit-binder PDF)
--      keep working unchanged. New writes mirror to both shapes until
--      every reader is moved over, then a follow-up migration drops the
--      old columns.

alter table public.assessment_responses
  add column if not exists items_answered jsonb not null default '[]'::jsonb;

-- Backfill: every row that has at least one of q1/q2/q3 populated
-- gets an items_answered array with the three items in canonical
-- order. Rows that are completely blank stay as [].
update public.assessment_responses
set items_answered = jsonb_build_array(
  jsonb_build_object('id', 'q1', 'answer', to_jsonb(q1_documented), 'notes', null),
  jsonb_build_object('id', 'q2', 'answer', to_jsonb(q2_followed),   'notes', null),
  jsonb_build_object('id', 'q3', 'answer', to_jsonb(q3_measured),   'notes', null)
)
where items_answered = '[]'::jsonb
  and (q1_documented is not null or q2_followed is not null or q3_measured is not null);

-- Lightweight index for the rare case where someone wants to query "all
-- responses that answered 'no' to item q3" across the tenant. JSONB
-- containment index on common shapes.
create index if not exists assessment_responses_items_answered_gin
  on public.assessment_responses using gin (items_answered);
