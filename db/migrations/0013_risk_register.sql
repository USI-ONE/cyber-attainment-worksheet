-- 0013_risk_register.sql
-- Risk Register — the spine of cyber risk management.
--
-- Every framework that matters (NIST CSF GV.RM-*, ISO 27001 6.1, SOC 2 CC3.x,
-- HIPAA Security Risk Analysis, FedRAMP, CMMC) requires a documented risk
-- register with likelihood × impact, owners, treatment strategy, and residual
-- risk after treatment. Until this migration the platform let users SCORE
-- themselves on having a risk register but didn't give them one to run.
--
-- Two tables:
--   risks            — one row per identified risk, with inherent + residual
--                      likelihood/impact, treatment strategy, owner, status,
--                      review cadence, and cross-links to controls, DR plans,
--                      IR playbooks, and incidents.
--   risk_treatments  — one row per treatment action (mitigation step) for a
--                      risk. Has its own owner, due date, status — so the
--                      board can see "5 critical risks, 12 treatment actions
--                      in flight, 3 overdue" at a glance.
--
-- Inherent and residual scores are generated columns (likelihood × impact)
-- so we never store a denormalized number. Both range 1-25.
--
-- Seeds: 10 starter risks per tenant covering the cyber-management baseline
-- (BEC, ransomware, vendor compromise, lost device, insider, phishing,
-- backup failure, compliance gap, key person, physical/facility) plus 2-3
-- realistic treatment actions per risk so the module ships with a usable
-- starter register and clear "where to next" examples.

-- =============================================================================
-- risks
-- =============================================================================

create table if not exists public.risks (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants(id) on delete cascade,
  code                    text not null,                 -- e.g. 'R-001'
  title                   text not null,
  description             text,
  category                text not null default 'cyber',  -- cyber/operational/compliance/people/supply_chain/physical/financial
  rationale               text,                          -- why this risk exists (threat + vulnerability)

  inherent_likelihood     int  not null default 3 check (inherent_likelihood  between 1 and 5),
  inherent_impact         int  not null default 3 check (inherent_impact      between 1 and 5),
  inherent_score          int  generated always as (inherent_likelihood * inherent_impact) stored,

  residual_likelihood     int  not null default 3 check (residual_likelihood  between 1 and 5),
  residual_impact         int  not null default 3 check (residual_impact      between 1 and 5),
  residual_score          int  generated always as (residual_likelihood * residual_impact) stored,

  treatment_strategy      text not null default 'mitigate'
                              check (treatment_strategy in ('accept','mitigate','transfer','avoid')),
  owner                   text,
  status                  text not null default 'open'
                              check (status in ('open','in_treatment','accepted','closed','transferred')),

  linked_control_ids      text[] not null default '{}',
  linked_dr_plan_ids      uuid[] not null default '{}',
  linked_ir_playbook_ids  uuid[] not null default '{}',
  linked_incident_ids     uuid[] not null default '{}',

  last_reviewed           date,
  next_review_due         date,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (tenant_id, code)
);

create index if not exists risks_tenant_idx
  on public.risks (tenant_id, residual_score desc, inherent_score desc);

drop trigger if exists risks_set_updated_at on public.risks;
create trigger risks_set_updated_at
  before update on public.risks
  for each row execute function public.set_updated_at();

-- =============================================================================
-- risk_treatments — actions taken to mitigate / accept / transfer / avoid
-- =============================================================================

create table if not exists public.risk_treatments (
  id              uuid primary key default gen_random_uuid(),
  risk_id         uuid not null references public.risks(id) on delete cascade,
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  action          text not null,                 -- what we're doing
  detail          text,                          -- why / how
  status          text not null default 'Not Started'
                      check (status in ('Not Started','In Progress','Blocked','Complete')),
  owner           text,
  due_date        date,
  completed_at    timestamptz,
  display_order   int  not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists risk_treatments_risk_idx
  on public.risk_treatments (risk_id, display_order);
create index if not exists risk_treatments_tenant_status_idx
  on public.risk_treatments (tenant_id, status, due_date nulls last);

drop trigger if exists risk_treatments_set_updated_at on public.risk_treatments;
create trigger risk_treatments_set_updated_at
  before update on public.risk_treatments
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS — standard member-select / editor-modify, service-role bypasses
-- =============================================================================

alter table public.risks            enable row level security;
alter table public.risk_treatments  enable row level security;

drop policy if exists risks_select on public.risks;
create policy risks_select on public.risks
  for select using (
    exists (select 1 from public.memberships m
            where m.tenant_id = risks.tenant_id and m.user_id = auth.uid())
  );

drop policy if exists risks_modify on public.risks;
create policy risks_modify on public.risks
  for all
  using (
    exists (select 1 from public.memberships m
            where m.tenant_id = risks.tenant_id and m.user_id = auth.uid()
              and m.role = 'editor')
  )
  with check (
    exists (select 1 from public.memberships m
            where m.tenant_id = risks.tenant_id and m.user_id = auth.uid()
              and m.role = 'editor')
  );

drop policy if exists risk_treatments_select on public.risk_treatments;
create policy risk_treatments_select on public.risk_treatments
  for select using (
    exists (select 1 from public.memberships m
            where m.tenant_id = risk_treatments.tenant_id and m.user_id = auth.uid())
  );

drop policy if exists risk_treatments_modify on public.risk_treatments;
create policy risk_treatments_modify on public.risk_treatments
  for all
  using (
    exists (select 1 from public.memberships m
            where m.tenant_id = risk_treatments.tenant_id and m.user_id = auth.uid()
              and m.role = 'editor')
  )
  with check (
    exists (select 1 from public.memberships m
            where m.tenant_id = risk_treatments.tenant_id and m.user_id = auth.uid()
              and m.role = 'editor')
  );

-- =============================================================================
-- Seeds — 10 starter risks per tenant.
--
-- Each row uses ON CONFLICT (tenant_id, code) DO NOTHING so re-running the
-- migration is safe. Linked control IDs match the NIST CSF 2.0 categories
-- that treat each risk, so the radar/scoring side can eventually surface
-- coverage relationships.
-- =============================================================================

insert into public.risks (
  tenant_id, code, title, description, category, rationale,
  inherent_likelihood, inherent_impact,
  residual_likelihood, residual_impact,
  treatment_strategy, owner, status,
  linked_control_ids,
  next_review_due
)
select t.id, x.code, x.title, x.description, x.category, x.rationale,
       x.inh_l, x.inh_i, x.res_l, x.res_i,
       x.strategy, x.owner, x.status,
       x.controls, (current_date + interval '6 months')::date
from public.tenants t
cross join (values
  (
    'R-001',
    'Business Email Compromise (BEC)',
    'A user mailbox is compromised via phishing, MFA bypass, or token theft and used to send fraudulent invoice/wire-change emails or pivot internally.',
    'cyber',
    'Threat: financially motivated actors target SMB mailboxes daily. Vulnerability: any user without strong MFA + Conditional Access is exposed. Recent industry data shows BEC remains the #1 reported cybercrime loss vector.',
    5, 4,
    2, 4,
    'mitigate', 'IT Manager', 'in_treatment',
    array['PR.AA-01','PR.AA-05','PR.AT-01','DE.AE-02','DE.CM-01','RS.MA-01']::text[]
  ),
  (
    'R-002',
    'Ransomware / Encryption Event',
    'Endpoint, server, or shared-storage encryption by ransomware leading to widespread operational outage and potential data exfiltration.',
    'cyber',
    'Threat: ransomware-as-a-service has lowered the entry barrier; SMBs are targeted because they pay. Vulnerability: gaps in EDR coverage, exposed RMM, unpatched perimeter devices, and non-immutable backups.',
    3, 5,
    2, 4,
    'mitigate', 'IT Manager', 'in_treatment',
    array['PR.DS-11','PR.PS-04','DE.CM-01','DE.AE-02','RS.MA-01','RS.MI-01','RC.RP-01','RC.RP-04']::text[]
  ),
  (
    'R-003',
    'Third-Party / Vendor Compromise',
    'A critical vendor (RMM/PSA, SaaS, payroll, MSP) is breached, exposing our credentials, data, or providing an attacker route into our environment.',
    'supply_chain',
    'Threat: supply-chain attacks are the highest-leverage vector for adversaries. Vulnerability: vendors often have privileged access (RMM agents, federation, API tokens) with limited visibility on our side.',
    4, 4,
    3, 3,
    'mitigate', 'Operations Lead', 'in_treatment',
    array['GV.SC-01','GV.SC-04','GV.SC-06','GV.SC-07','GV.SC-08','ID.RA-09']::text[]
  ),
  (
    'R-004',
    'Lost or Stolen Device',
    'A laptop, phone, or tablet containing organizational data is lost or stolen.',
    'operational',
    'Threat: physical loss happens routinely (commute, travel, vehicle break-ins). Vulnerability: device contains cached credentials, mailbox cache, and OneDrive sync — sensitive without encryption + remote wipe.',
    4, 3,
    4, 1,
    'mitigate', 'IT Manager', 'in_treatment',
    array['PR.AA-01','PR.AA-05','PR.DS-01','PR.DS-02']::text[]
  ),
  (
    'R-005',
    'Insider Threat (Malicious or Negligent)',
    'An authorized user intentionally or accidentally exfiltrates, deletes, or exposes sensitive data — disgruntled employee, departing salesperson, or simple human error.',
    'people',
    'Threat: insiders have legitimate access and skip every perimeter control. Vulnerability: gaps in data loss prevention, UEBA, leaver-process discipline, and segregation of duties.',
    3, 4,
    2, 3,
    'mitigate', 'HR + IT Manager', 'in_treatment',
    array['PR.AT-01','PR.AT-02','DE.AE-02','GV.RR-02','GV.RR-04']::text[]
  ),
  (
    'R-006',
    'Phishing → Credential Theft',
    'Users click phishing links and enter credentials on lookalike portals; attacker uses stolen credentials to access M365, VPN, or SaaS.',
    'cyber',
    'Threat: phishing remains the highest-volume entry vector. Vulnerability: every user is a potential click; MFA reduces but does not eliminate (token theft, MFA fatigue, AiTM attacks).',
    5, 3,
    3, 2,
    'mitigate', 'IT Manager', 'in_treatment',
    array['PR.AT-01','PR.AT-02','PR.AA-01','PR.AA-05','DE.AE-02','DE.AE-07']::text[]
  ),
  (
    'R-007',
    'Backup Failure During Recovery Event',
    'When a recovery is needed (ransomware, deletion, corruption), backups are found to be incomplete, corrupted, untested, or encrypted by the same incident.',
    'operational',
    'Threat: ransomware groups specifically target backups. Vulnerability: backups without immutability, untested restore procedures, gaps in coverage (SaaS data, endpoints).',
    2, 5,
    1, 5,
    'mitigate', 'IT Manager', 'in_treatment',
    array['PR.DS-11','RC.RP-01','RC.RP-03','RC.RP-04']::text[]
  ),
  (
    'R-008',
    'Regulatory Compliance Gap',
    'A regulatory obligation (HIPAA, PCI-DSS, state breach notification, industry-specific) is not met, surfacing in audit, contract renewal, or post-breach review.',
    'compliance',
    'Threat: regulators and customer contracts impose specific requirements with audit cadence. Vulnerability: requirements change faster than internal compliance reviews; assessments lag.',
    3, 4,
    2, 3,
    'mitigate', 'Compliance Officer', 'in_treatment',
    array['GV.OC-01','GV.OC-03','GV.OC-04','GV.RM-01','GV.RM-04']::text[]
  ),
  (
    'R-009',
    'Key Person Dependency',
    'A single individual holds undocumented operational knowledge (admin credentials, vendor relationships, configuration history) and their unavailability halts critical processes.',
    'people',
    'Threat: any departure, illness, or accident affecting the key person. Vulnerability: undocumented procedures, single named admin on critical systems, no cross-training.',
    4, 3,
    3, 2,
    'mitigate', 'Operations Lead', 'in_treatment',
    array['GV.RR-02','PR.AT-01','RC.RP-01']::text[]
  ),
  (
    'R-010',
    'Physical / Facility Loss (Fire, Flood, Power)',
    'Primary facility becomes inaccessible due to fire, flood, prolonged power loss, or other physical incident — staff cannot work, on-site infrastructure unavailable.',
    'physical',
    'Threat: natural and infrastructure events occur with regional patterns. Vulnerability: on-prem servers, hard-wired phones, single-site dependency.',
    2, 4,
    2, 2,
    'mitigate', 'Operations Lead', 'in_treatment',
    array['ID.AM-04','PR.IR-01','PR.IR-04','RC.RP-01']::text[]
  )
) as x(code, title, description, category, rationale, inh_l, inh_i, res_l, res_i, strategy, owner, status, controls)
on conflict (tenant_id, code) do nothing;

-- After risks are inserted, wire each tenant's BEC risk to its BEC playbook,
-- the Ransomware risk to its Ransomware playbook, and the Ransomware + Backup
-- Failure risks to the M365 DR plan. This makes the cross-reference live from
-- day one without per-tenant scripting.
update public.risks r
set linked_ir_playbook_ids = array(
  select p.id from public.ir_playbooks p
  where p.tenant_id = r.tenant_id and p.category = 'bec'
)
where r.code = 'R-001' and array_length(r.linked_ir_playbook_ids, 1) is null;

update public.risks r
set linked_ir_playbook_ids = array(
  select p.id from public.ir_playbooks p
  where p.tenant_id = r.tenant_id and p.category = 'ransomware'
)
where r.code = 'R-002' and array_length(r.linked_ir_playbook_ids, 1) is null;

update public.risks r
set linked_dr_plan_ids = array(
  select d.id from public.dr_plans d
  where d.tenant_id = r.tenant_id
  order by d.tier, d.name
  limit 1
)
where r.code in ('R-002','R-007') and array_length(r.linked_dr_plan_ids, 1) is null;

-- =============================================================================
-- Seed treatments — 2-3 mitigation actions per risk so the module ships
-- with a real-feeling starter treatment plan.
-- =============================================================================

with t_actions as (
  select * from (values
    -- R-001 BEC
    ('R-001', 1, 'Enforce phishing-resistant MFA for every user',
       'Require MFA on every M365 sign-in via Conditional Access; block legacy authentication; prefer FIDO2/Windows Hello over SMS.',
       'In Progress', 'IT Manager'),
    ('R-001', 2, 'Deploy Conditional Access policies for risky sign-ins',
       'Block sign-ins from high-risk geographies/devices; require compliant device for admin roles; alert on impossible-travel.',
       'In Progress', 'IT Manager'),
    ('R-001', 3, 'Quarterly phishing simulation + remediation training',
       'Run M365 Attack Simulation Training every quarter; require corrective training for click-throughs; report click rate as KPI.',
       'Not Started', 'IT Manager'),
    -- R-002 Ransomware
    ('R-002', 1, 'Verify backup immutability + monthly restore test',
       'Confirm at least one immutable backup copy per critical system; restore one system per month from immutable backup to validate recoverability.',
       'In Progress', 'IT Manager'),
    ('R-002', 2, 'Deploy EDR with managed detection across all endpoints',
       'EDR on every endpoint and server; managed detection-and-response from MSP SOC; tune to alert on encryption-style behavior.',
       'Complete', 'IT Manager'),
    ('R-002', 3, 'Annual ransomware tabletop with executive participation',
       'Walk the IR playbook with CEO/CFO at the table; include insurance carrier callback; document gaps in after-action report.',
       'Not Started', 'CIO'),
    -- R-003 Vendor
    ('R-003', 1, 'Maintain vendor risk register with criticality + last-assessed',
       'Track every vendor with privileged access; record SOC 2 / ISO attestation status; assess annually for critical vendors.',
       'In Progress', 'Operations Lead'),
    ('R-003', 2, 'Restrict RMM/PSA access with conditional access + audit logging',
       'RMM admin consoles behind MFA + IP allowlist; full audit of vendor sessions; rotate vendor credentials quarterly.',
       'In Progress', 'IT Manager'),
    -- R-004 Lost device
    ('R-004', 1, 'BitLocker / FileVault on every endpoint, enforced via MDM',
       'Full-disk encryption required at provisioning; compliance check daily; lost device cannot expose data without key.',
       'Complete', 'IT Manager'),
    ('R-004', 2, 'Remote wipe via Intune / Jamf for lost/stolen devices',
       'Document procedure for help-desk to wipe on user report; test quarterly; track wipes as KPI.',
       'In Progress', 'IT Manager'),
    -- R-005 Insider
    ('R-005', 1, 'Documented leaver process with 24-hour access revocation',
       'On termination notification: disable accounts within 24h, revoke tokens, recover devices, transfer mailbox ownership.',
       'In Progress', 'HR + IT Manager'),
    ('R-005', 2, 'UEBA / DLP alerts on bulk data egress',
       'Alert on unusual download volume, sharing outside organization, USB mass-copy. Tune to reduce false-positive fatigue.',
       'Not Started', 'IT Manager'),
    -- R-006 Phishing
    ('R-006', 1, 'M365 Defender for Office 365 with safe links + attachments',
       'Enable safe links rewriting and safe attachments sandboxing; block known-bad senders at edge.',
       'Complete', 'IT Manager'),
    ('R-006', 2, 'User phishing-report button + 1-hour triage SLA',
       'Deploy the Report Phishing button in Outlook; security team triages within 1 business hour and blocks/responds.',
       'In Progress', 'IT Manager'),
    -- R-007 Backup failure
    ('R-007', 1, 'Document RTO/RPO + recovery procedure for every Tier 1 system',
       'Recorded in /dr-plans with owner, dependencies, and step-by-step procedure. Reviewed quarterly.',
       'In Progress', 'IT Manager'),
    ('R-007', 2, 'Monthly restore test for one Tier-1 system, rotating',
       'Pick one Tier-1 system each month; test-restore in isolated environment; record pass/fail in DR plan test history.',
       'Not Started', 'IT Manager'),
    ('R-007', 3, 'Quarterly verification that SaaS data (M365, etc.) is backed up',
       'Native M365 retention is not backup. Verify third-party SaaS backup covers Exchange, SharePoint, OneDrive, Teams.',
       'In Progress', 'IT Manager'),
    -- R-008 Compliance
    ('R-008', 1, 'Maintain compliance register with review cadence',
       'In /registers, track every regulatory obligation with frequency, owner, last-review and next-review dates.',
       'In Progress', 'Compliance Officer'),
    ('R-008', 2, 'Annual third-party assessment against named framework',
       'Independent annual review against NIST CSF 2.0 (and applicable industry framework). Address findings via work plan.',
       'Not Started', 'CIO'),
    -- R-009 Key person
    ('R-009', 1, 'Document admin runbooks for every critical system',
       'Each Tier-1 system has a documented runbook (config, backup, escalation contacts). Reviewed annually.',
       'In Progress', 'Operations Lead'),
    ('R-009', 2, 'Cross-train at least two people on every critical admin function',
       'No single person is the only one who can perform a critical action. Cross-training tracked in HR system.',
       'Not Started', 'Operations Lead'),
    -- R-010 Physical
    ('R-010', 1, 'Document remote-work continuity procedure',
       'Every staff member can work from home or alternate location within 24h of facility loss. Test annually.',
       'In Progress', 'Operations Lead'),
    ('R-010', 2, 'Cloud-first infrastructure to remove single-site dependency',
       'M365, cloud-hosted line-of-business apps; on-prem servers retired or virtualized off-site.',
       'In Progress', 'IT Manager')
  ) as v(code, ord, action, detail, status, owner)
)
insert into public.risk_treatments (
  risk_id, tenant_id, action, detail, status, owner, display_order
)
select r.id, r.tenant_id, ta.action, ta.detail, ta.status, ta.owner, ta.ord
from t_actions ta
join public.risks r on r.code = ta.code
where not exists (
  select 1 from public.risk_treatments x
  where x.risk_id = r.id and x.display_order = ta.ord
);
