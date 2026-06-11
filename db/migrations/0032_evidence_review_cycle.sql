-- 0032_evidence_review_cycle.sql
--
-- Evidence-artifact review cycle.
--
-- The existing fields on evidence_artifacts (collected_date,
-- retention_until) describe the *disposal* lifecycle: when the artifact
-- was collected and when it can be archived. Review cycle is a
-- different concept — how recently the artifact was checked for
-- correctness against the policy or control it backs, and when the next
-- review is due. Both can be set independently.
--
-- last_reviewed_at  — the most-recent review date set by a reviewer.
-- review_expires_at — when the next review is due. Editor-set; not
--                     computed. Operators set their own review cadence
--                     per artifact (e.g., monthly for a phishing report,
--                     annual for a pen test, multi-year for a SOC 2).
--
-- The dashboard Attention feed emits a signal when review_expires_at
-- is past today, distinct from the existing evidence_expired signal
-- (which fires on retention_until).

alter table public.evidence_artifacts
  add column if not exists last_reviewed_at  date,
  add column if not exists review_expires_at date;

-- Index supports the attention-feed query: "all rows in tenant where
-- review_expires_at is past today (or within N days)". Partial index so
-- it only contains rows that have a review date set.
create index if not exists evidence_artifacts_review_due_idx
  on public.evidence_artifacts (tenant_id, review_expires_at)
  where review_expires_at is not null;
