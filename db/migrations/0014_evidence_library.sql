-- 0014_evidence_library.sql
-- Evidence Library — the auditor-ready artifact store.
--
-- Every audit (NIST CSF assessment, SOC 2, ISO 27001, HIPAA Security Risk
-- Analysis, FedRAMP, CMMC) asks the same question: "show me proof." Until
-- this migration the platform tracked everything *except* the evidence
-- itself — policies lived in policy_documents, incident docs lived in
-- incident_documents, but quarterly access reviews, configuration
-- screenshots, training completion records, DR test logs, IR tabletop
-- after-action reports, vulnerability scans, pentest results, and the
-- like had nowhere to land that auditors and operators could find.
--
-- One table: evidence_artifacts. Each row is a single artifact (typically
-- a file in private Supabase Storage) plus the cross-references that say
-- "this is what it proves" — NIST CSF controls, specific risks, treatment
-- actions, DR plans, IR playbooks, and incidents. The same artifact can
-- cover multiple controls/risks via the array columns, so one screenshot
-- of M365 Conditional Access policies can attest to PR.AA-01 + PR.AA-05 +
-- R-001 (BEC) + R-006 (Phishing) without duplicating the file.

-- =============================================================================
-- evidence_artifacts
-- =============================================================================

create table if not exists public.evidence_artifacts (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  title                   text not null,
  description             text,
  category                text not null default 'other',
  -- common categories the UI will pre-populate as filter pills:
  --   access_review          quarterly user access reviews
  --   config_screenshot      screenshots of CA policies, firewall, AV, etc.
  --   training_record        security awareness completion exports
  --   dr_test_result         DR test logs + signed sign-off
  --   ir_tabletop_record     tabletop exercise after-action reports
  --   vulnerability_scan     Nessus / Qualys / etc. results
  --   penetration_test       annual pentest reports
  --   audit_evidence         SOC 2 / ISO audit responses + workpapers
  --   policy_attestation     signed policy acknowledgements
  --   backup_verification    restore-test logs
  --   log_export             specific log captures preserved as evidence
  --   certification          vendor certs (SOC 2 reports, ISO certificates)
  --   incident_report        post-mortems and final IR reports
  --   other                  anything else

  -- Storage — same private-bucket pattern as policy_documents / incident_documents.
  storage_path            text,                    -- nullable: an evidence "row"
                                                   -- can exist with no file
                                                   -- (e.g. a freeform note row)
  filename                text,
  content_type            text,
  size_bytes              bigint,
  uploaded_by             text,

  -- Audit lifecycle
  collected_date          date,                    -- when the artifact was
                                                   -- captured / produced
  retention_until         date,                    -- when this evidence can be
                                                   -- disposed (regulatory or
                                                   -- internal retention policy)
  status                  text not null default 'current'
                              check (status in ('current','superseded','expired','archived')),

  -- Cross-references — what does this evidence prove?
  linked_control_ids      text[]  not null default '{}',
  linked_risk_ids         uuid[]  not null default '{}',
  linked_treatment_ids    uuid[]  not null default '{}',
  linked_dr_plan_ids      uuid[]  not null default '{}',
  linked_ir_playbook_ids  uuid[]  not null default '{}',
  linked_incident_ids     uuid[]  not null default '{}',
  linked_policy_doc_ids   uuid[]  not null default '{}',

  tags                    text[]  not null default '{}',

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists evidence_artifacts_tenant_idx
  on public.evidence_artifacts (tenant_id, collected_date desc nulls last, created_at desc);
create index if not exists evidence_artifacts_category_idx
  on public.evidence_artifacts (tenant_id, category);
create index if not exists evidence_artifacts_retention_idx
  on public.evidence_artifacts (tenant_id, retention_until nulls last)
  where status = 'current';

drop trigger if exists evidence_artifacts_set_updated_at on public.evidence_artifacts;
create trigger evidence_artifacts_set_updated_at
  before update on public.evidence_artifacts
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS — standard member-select / editor-modify; service-role bypasses
-- =============================================================================

alter table public.evidence_artifacts enable row level security;

drop policy if exists evidence_artifacts_select on public.evidence_artifacts;
create policy evidence_artifacts_select on public.evidence_artifacts
  for select using (
    exists (select 1 from public.memberships m
            where m.tenant_id = evidence_artifacts.tenant_id and m.user_id = auth.uid())
  );

drop policy if exists evidence_artifacts_modify on public.evidence_artifacts;
create policy evidence_artifacts_modify on public.evidence_artifacts
  for all
  using (
    exists (select 1 from public.memberships m
            where m.tenant_id = evidence_artifacts.tenant_id and m.user_id = auth.uid()
              and m.role = 'editor')
  )
  with check (
    exists (select 1 from public.memberships m
            where m.tenant_id = evidence_artifacts.tenant_id and m.user_id = auth.uid()
              and m.role = 'editor')
  );

-- =============================================================================
-- Storage bucket — private; access via signed URLs minted by the service-role API
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('evidence-artifacts', 'evidence-artifacts', false)
on conflict (id) do update set public = excluded.public;
