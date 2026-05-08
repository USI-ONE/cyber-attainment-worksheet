-- 0012_dr_ir_planning.sql
-- Disaster Recovery plans + Incident Response playbooks. Two tenant-scoped
-- tables that together turn the platform from "score+log" into a real
-- continuity-and-response toolset.
--
-- dr_plans: one row per protected system/asset. Holds the RTO/RPO promise,
-- the backup story, the recovery procedure, and a test cadence — i.e. the
-- artifacts an auditor wants to see when scoring RC.RP-* and the executive
-- wants to see when ransomware hits.
--
-- ir_playbooks: one row per incident category (BEC, ransomware, lost device,
-- etc.). Holds detection signals, containment / eradication / recovery steps,
-- communication matrix, escalation contacts, regulatory-notification clocks,
-- and evidence-preservation guidance — i.e. the runbook IR team grabs when
-- a real event hits.
--
-- Both tables follow the same RLS pattern as the rest of the schema (member
-- select, editor modify) and use jsonb arrays for the freeform sequences
-- so the UI can grow new step kinds without further schema migrations.

-- =============================================================================
-- dr_plans
-- =============================================================================

create table if not exists public.dr_plans (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  name                text not null,
  system_name         text,                   -- the system/asset being recovered
  tier                int  not null default 2 check (tier between 1 and 3),
                                              -- 1=critical, 2=important, 3=standard
  rto_minutes         int,                    -- Recovery Time Objective (minutes)
  rpo_minutes         int,                    -- Recovery Point Objective (minutes)
  description         text,
  backup_method       text,                   -- e.g. "Veeam → Wasabi (immutable)"
  backup_frequency    text,                   -- e.g. "Hourly" / "Daily 02:00 MT"
  backup_retention    text,                   -- e.g. "30d operational + 1y archive"
  recovery_steps      jsonb not null default '[]'::jsonb,  -- text[] in order
  recovery_owner      text,
  recovery_team       text[] not null default '{}',
  dependencies        text[] not null default '{}',         -- upstream systems
  last_tested         date,
  last_test_result    text check (last_test_result is null
                                  or last_test_result in ('pass','partial','fail')),
  last_test_notes     text,
  next_test_due       date,
  linked_control_ids  text[] not null default '{}',
  status              text not null default 'active'
                          check (status in ('draft','active','archived')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists dr_plans_tenant_idx
  on public.dr_plans (tenant_id, tier, name);

drop trigger if exists dr_plans_set_updated_at on public.dr_plans;
create trigger dr_plans_set_updated_at
  before update on public.dr_plans
  for each row execute function public.set_updated_at();

-- =============================================================================
-- ir_playbooks
-- =============================================================================

create table if not exists public.ir_playbooks (
  id                       uuid primary key default gen_random_uuid(),
  tenant_id                uuid not null references public.tenants(id) on delete cascade,
  name                     text not null,
  category                 text not null,                  -- 'bec', 'ransomware', etc.
  severity_default         text not null default 'medium'
                              check (severity_default in ('low','medium','high','critical')),
  description              text,
  trigger_conditions       text,                            -- when this playbook fires
  detection_sources        text[] not null default '{}',    -- where alerts come from
  containment_steps        jsonb not null default '[]'::jsonb,
  eradication_steps        jsonb not null default '[]'::jsonb,
  recovery_steps           jsonb not null default '[]'::jsonb,
  communications_plan      jsonb not null default '[]'::jsonb,
                              -- [{ audience, when, channel, message_template }]
  escalation_contacts      jsonb not null default '[]'::jsonb,
                              -- [{ role, name, phone, email, when_to_contact }]
  evidence_to_preserve     text[] not null default '{}',
  regulatory_notifications jsonb not null default '[]'::jsonb,
                              -- [{ regulation, deadline_hours, contact, trigger }]
  linked_control_ids       text[] not null default '{}',
  last_reviewed            date,
  last_tabletop            date,
  next_review_due          date,
  status                   text not null default 'active'
                              check (status in ('draft','active','archived')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists ir_playbooks_tenant_idx
  on public.ir_playbooks (tenant_id, category, name);

drop trigger if exists ir_playbooks_set_updated_at on public.ir_playbooks;
create trigger ir_playbooks_set_updated_at
  before update on public.ir_playbooks
  for each row execute function public.set_updated_at();

-- =============================================================================
-- RLS — same member-select / editor-modify pattern as the rest of the schema
-- =============================================================================

alter table public.dr_plans     enable row level security;
alter table public.ir_playbooks enable row level security;

drop policy if exists dr_plans_select on public.dr_plans;
create policy dr_plans_select on public.dr_plans
  for select using (
    exists (select 1 from public.memberships m
            where m.tenant_id = dr_plans.tenant_id and m.user_id = auth.uid())
  );

drop policy if exists dr_plans_modify on public.dr_plans;
create policy dr_plans_modify on public.dr_plans
  for all
  using (
    exists (select 1 from public.memberships m
            where m.tenant_id = dr_plans.tenant_id and m.user_id = auth.uid()
              and m.role = 'editor')
  )
  with check (
    exists (select 1 from public.memberships m
            where m.tenant_id = dr_plans.tenant_id and m.user_id = auth.uid()
              and m.role = 'editor')
  );

drop policy if exists ir_playbooks_select on public.ir_playbooks;
create policy ir_playbooks_select on public.ir_playbooks
  for select using (
    exists (select 1 from public.memberships m
            where m.tenant_id = ir_playbooks.tenant_id and m.user_id = auth.uid())
  );

drop policy if exists ir_playbooks_modify on public.ir_playbooks;
create policy ir_playbooks_modify on public.ir_playbooks
  for all
  using (
    exists (select 1 from public.memberships m
            where m.tenant_id = ir_playbooks.tenant_id and m.user_id = auth.uid()
              and m.role = 'editor')
  )
  with check (
    exists (select 1 from public.memberships m
            where m.tenant_id = ir_playbooks.tenant_id and m.user_id = auth.uid()
              and m.role = 'editor')
  );

-- =============================================================================
-- Seeds — one starter DR plan and two starter IR playbooks for every tenant
-- so the modules ship with usable content, not an empty page.
-- =============================================================================

insert into public.dr_plans (
  tenant_id, name, system_name, tier, rto_minutes, rpo_minutes,
  description, backup_method, backup_frequency, backup_retention,
  recovery_steps, recovery_owner, dependencies,
  next_test_due, linked_control_ids, status
)
select
  t.id,
  'Microsoft 365 — Email & SharePoint Recovery',
  'Microsoft 365 (Exchange Online, SharePoint, OneDrive)',
  1,    -- tier 1: critical
  240,  -- 4 hours RTO
  60,   -- 1 hour RPO
  'Recovery procedure for Microsoft 365 mailboxes, SharePoint sites, and OneDrive accounts following data loss, ransomware, or accidental deletion. Combines Microsoft native retention (90-day soft delete, 14-day litigation hold) with third-party SaaS backup for point-in-time restore beyond Microsoft retention windows.',
  'Microsoft 365 native retention + Datto SaaS Protection (or equivalent third-party SaaS backup)',
  'Continuous — third-party backup runs every 4 hours; native retention is real-time',
  '90 days operational (native) + 1 year archival (third-party)',
  jsonb_build_array(
    'Confirm scope of loss: identify affected mailboxes, sites, files, and timeframe of corruption/loss.',
    'Determine recovery target time (just before incident) and consult third-party backup console for available restore points.',
    'For mailbox recovery: use Microsoft 365 admin center > Mailboxes > Recover Deleted Items if within 14 days; otherwise initiate restore from third-party backup.',
    'For SharePoint/OneDrive: use Version History (within 90 days) or third-party backup restore-to-original-location.',
    'Validate restored data with affected users before declaring recovery complete.',
    'Document recovery in incident log and update DR test record.'
  ),
  'IT Manager / MSP Lead',
  array['Microsoft 365 license tenant', 'Third-party SaaS backup subscription', 'Admin credentials with Global Admin or Exchange Admin role'],
  (current_date + interval '6 months')::date,
  array['PR.DS-11','RC.RP-01','RC.RP-02','RC.RP-03'],
  'active'
from public.tenants t
where not exists (
  select 1 from public.dr_plans d
  where d.tenant_id = t.id and d.name = 'Microsoft 365 — Email & SharePoint Recovery'
);

insert into public.ir_playbooks (
  tenant_id, name, category, severity_default, description,
  trigger_conditions, detection_sources,
  containment_steps, eradication_steps, recovery_steps,
  communications_plan, escalation_contacts, evidence_to_preserve,
  regulatory_notifications, linked_control_ids, status
)
select
  t.id,
  'Business Email Compromise (BEC)',
  'bec',
  'high',
  'Response playbook for compromised user mailboxes — typical indicators include impossible-travel sign-ins, malicious inbox rules, mass forwarding, and fraudulent invoice/wire-change emails sent from a legitimate user account. Goal is rapid containment, evidence preservation, and clear stakeholder communication while the investigation runs.',
  'Triggered by any of: M365 risky sign-in alert, user-reported phishing/suspicious activity, finance receiving wire-change request that fails out-of-band verification, MSP detecting malicious inbox rule.',
  array['Microsoft Defender / Entra ID Identity Protection', 'M365 Audit Log', 'User report (phishing button or help desk)', 'MSP SOC alert', 'Finance team out-of-band verification'],
  jsonb_build_array(
    'Force password reset for the affected account immediately (admin center > user > reset password, require change at next sign-in).',
    'Revoke all active refresh/access tokens for the account (PowerShell: Revoke-MgUserSignInSession or admin center > user > Sign out).',
    'Remove all MFA registered methods and require re-registration with verified user identity.',
    'Disable any malicious inbox rules (admin center > Exchange > Mail flow, or PowerShell: Get-InboxRule | Remove-InboxRule).',
    'Block any forwarding addresses configured by the attacker.',
    'If account has Global Admin or other privileged role: temporarily revoke privileged role assignment.'
  ),
  jsonb_build_array(
    'Audit M365 sign-in logs for the past 90 days to map full scope of attacker access.',
    'Search for additional malicious inbox rules across all tenant mailboxes (compromised account may have been used to set rules in shared mailboxes).',
    'Search Sent Items and Deleted Items for attacker-sent messages; check for invoice fraud, wire-change requests, or payload distribution.',
    'Check for OAuth app consents granted from the account (admin center > Enterprise apps > User consent grants).',
    'If invoice/wire fraud is suspected, contact bank fraud department immediately to halt any pending transfers.',
    'Run organization-wide phish-kit / mass-mail search to identify other recipients of attacker-sent emails.'
  ),
  jsonb_build_array(
    'Re-enable account access with new credentials and re-registered MFA after user verification.',
    'Restore any legitimate inbox rules that were disabled during containment.',
    'Conduct one-on-one debrief with affected user covering attacker behavior, what to watch for.',
    'Apply or tighten Conditional Access policy: block legacy auth, require compliant device for risky sign-ins, geo-restrict if appropriate.',
    'If sensitive data was exfiltrated, assess regulatory notification requirements (see Regulatory Notifications section).',
    'Document incident in /incidents with full timeline, findings, and recommendations.'
  ),
  jsonb_build_array(
    jsonb_build_object('audience', 'Affected user', 'when', 'Within 1 hour of detection', 'channel', 'Phone (not email — account is compromised)', 'message_template', 'Your account is being investigated for unauthorized access. We are resetting your password and MFA. Do not log in until contacted by IT.'),
    jsonb_build_object('audience', 'Finance team', 'when', 'Immediately if BEC indicators include invoice/wire fraud', 'channel', 'Phone + Teams', 'message_template', 'Hold all pending wire transfers and invoice payments related to [user] pending verification. All wire-change requests today must be verified by phone callback to a known number.'),
    jsonb_build_object('audience', 'Recipients of attacker-sent emails', 'when', 'Within 24 hours of identification', 'channel', 'Email from a different verified sender', 'message_template', 'On [date], an email sent from [user@domain] may have been sent without their authorization. If you took action on that email (especially payment or credential entry), please contact [security@domain] immediately.'),
    jsonb_build_object('audience', 'Executive sponsor / CIO', 'when', 'If incident is high severity or involves >5 accounts', 'channel', 'Phone + email', 'message_template', 'BEC incident detected on [date]. Containment complete. Investigation ongoing. Initial scope: [N] accounts. Full report within 24 hours.')
  ),
  jsonb_build_array(
    jsonb_build_object('role', 'IT Manager / MSP Lead', 'name', '', 'phone', '', 'email', '', 'when_to_contact', 'Immediately on detection'),
    jsonb_build_object('role', 'CFO / Finance Lead', 'name', '', 'phone', '', 'email', '', 'when_to_contact', 'If invoice/wire fraud suspected'),
    jsonb_build_object('role', 'CIO / Executive Sponsor', 'name', '', 'phone', '', 'email', '', 'when_to_contact', 'High-severity or >5 accounts affected'),
    jsonb_build_object('role', 'Cyber insurance carrier', 'name', '', 'phone', '', 'email', '', 'when_to_contact', 'Within carrier-required notification window (typically 24-72h)'),
    jsonb_build_object('role', 'Outside counsel', 'name', '', 'phone', '', 'email', '', 'when_to_contact', 'If breach notification may be required')
  ),
  array['M365 sign-in logs (90 days minimum)','M365 audit log export','Inbox rule list before/after containment','Sent Items copies','Email message headers of suspicious messages','OAuth consent grant log','Screenshots of admin actions taken'],
  jsonb_build_array(
    jsonb_build_object('regulation', 'State breach notification (varies)', 'deadline_hours', 720, 'contact', 'State AG office in each affected resident state', 'trigger', 'PII of state residents was accessed or exfiltrated'),
    jsonb_build_object('regulation', 'HIPAA Breach Notification Rule', 'deadline_hours', 1440, 'contact', 'HHS OCR + affected individuals', 'trigger', 'PHI was accessed and risk assessment is not low-probability'),
    jsonb_build_object('regulation', 'Cyber insurance', 'deadline_hours', 72, 'contact', 'Insurance carrier breach hotline', 'trigger', 'Any incident likely to result in claim'),
    jsonb_build_object('regulation', 'SEC Form 8-K (public companies)', 'deadline_hours', 96, 'contact', 'SEC via legal counsel', 'trigger', 'Material cybersecurity incident')
  ),
  array['DE.AE-02','PR.AA-01','PR.AA-05','RS.MA-01','RS.MA-02','RS.MI-01','RC.RP-01','RC.CO-03'],
  'active'
from public.tenants t
where not exists (
  select 1 from public.ir_playbooks p
  where p.tenant_id = t.id and p.category = 'bec'
);

insert into public.ir_playbooks (
  tenant_id, name, category, severity_default, description,
  trigger_conditions, detection_sources,
  containment_steps, eradication_steps, recovery_steps,
  communications_plan, escalation_contacts, evidence_to_preserve,
  regulatory_notifications, linked_control_ids, status
)
select
  t.id,
  'Ransomware / Encryption Event',
  'ransomware',
  'critical',
  'Response playbook for confirmed or suspected ransomware affecting endpoints, servers, or shared file storage. Treat as a worst-case continuity event: assume domain-wide impact until proven otherwise, and prioritize evidence preservation alongside containment so insurance, legal, and forensics paths stay open.',
  'Triggered by any of: encrypted file extensions appearing on shares, ransom note discovered, EDR alert flagging encryption-style behavior, user-reported "all my files have weird names", backup-system alert that protected data was modified at unusual rate.',
  array['EDR/MDR (CrowdStrike, SentinelOne, Defender)', 'File integrity monitoring on shared drives', 'Backup system anomaly alerts (Datto, Veeam, etc.)', 'User report to help desk', 'MSP SOC alert'],
  jsonb_build_array(
    'DO NOT power off infected systems — disconnect from network instead (preserves memory evidence for forensics).',
    'Isolate affected endpoints/servers via EDR network containment or by physically/virtually disconnecting from the network.',
    'Disable shared mapped drives at file server level to prevent further file encryption.',
    'Force password reset for any privileged accounts that may have been used; rotate service-account credentials.',
    'Block C2 IPs/domains observed in EDR alerts at firewall.',
    'Assume domain compromise: rotate KRBTGT account password twice (with 24h interval) if domain controller may be affected.'
  ),
  jsonb_build_array(
    'Engage cyber insurance breach hotline IMMEDIATELY — most policies require pre-approved IR firms and will not reimburse otherwise.',
    'Engage external IR/forensics firm via insurance pre-approval list to perform root-cause analysis.',
    'Identify initial access vector (phish, RDP, exposed RMM, vendor compromise) and remediate the entry point.',
    'Image affected systems for forensic analysis BEFORE any wipe/rebuild.',
    'Search for persistence mechanisms across the environment: scheduled tasks, services, registry run keys, group policy.',
    'Remove ransomware binaries and any planted credentials/backdoors identified by forensics.'
  ),
  jsonb_build_array(
    'Verify backup integrity before restoration — test-restore in isolated environment to confirm backups are not also encrypted/corrupted.',
    'Rebuild affected systems from clean baseline images, not in-place reinstall.',
    'Restore data from last verified-clean backup point; do not pay ransom (per organizational policy and per OFAC guidance — paying many ransomware groups is illegal).',
    'Validate restored systems with EDR scan before returning to production network.',
    'Reset all user passwords forced at next sign-in; rotate all service-account, application, and API credentials.',
    'Apply lessons-learned: patches, segmentation, EDR coverage gaps, backup-immutability gaps.'
  ),
  jsonb_build_array(
    jsonb_build_object('audience', 'Executive sponsor / CEO', 'when', 'Within 1 hour of confirmation', 'channel', 'Phone', 'message_template', 'Ransomware incident confirmed at [time]. Containment in progress. Insurance and IR firm engaged. Operational impact: [scope]. Next briefing in [N] hours.'),
    jsonb_build_object('audience', 'All staff', 'when', 'Within 2-4 hours', 'channel', 'Out-of-band (phone tree, personal email, SMS) — internal email may be unavailable', 'message_template', 'A cybersecurity event has affected [systems]. Do not attempt to access [affected systems]. We will provide updates every [N] hours. Report any unusual activity to [hotline].'),
    jsonb_build_object('audience', 'Customers (if customer-facing systems affected)', 'when', 'Coordinated with legal counsel, typically within 24-72h', 'channel', 'Email + status page', 'message_template', 'We are responding to a security event that has affected [services]. We have engaged forensics and law enforcement. We will share updates as the investigation allows. Estimated restoration: [time].'),
    jsonb_build_object('audience', 'FBI IC3 / local field office', 'when', 'Within 24-72h', 'channel', 'IC3.gov + local FBI field office direct line', 'message_template', 'Reporting ransomware incident. [Contact info, affected systems, ransom amount if known, threat actor name, IOCs available].')
  ),
  jsonb_build_array(
    jsonb_build_object('role', 'Cyber insurance breach hotline', 'name', '', 'phone', '', 'email', '', 'when_to_contact', 'IMMEDIATELY on confirmation — before any other action'),
    jsonb_build_object('role', 'Pre-approved IR/forensics firm', 'name', '', 'phone', '', 'email', '', 'when_to_contact', 'Via insurance carrier within 1 hour'),
    jsonb_build_object('role', 'Outside counsel / breach coach', 'name', '', 'phone', '', 'email', '', 'when_to_contact', 'Within 1 hour'),
    jsonb_build_object('role', 'CEO / Executive sponsor', 'name', '', 'phone', '', 'email', '', 'when_to_contact', 'Within 1 hour'),
    jsonb_build_object('role', 'FBI field office (local)', 'name', '', 'phone', '', 'email', '', 'when_to_contact', 'Within 24-72h'),
    jsonb_build_object('role', 'CISA Report (cisa.gov/report)', 'name', '', 'phone', '888-282-0870', 'email', 'central@cisa.dhs.gov', 'when_to_contact', 'Within 72h for federal contractors / critical infrastructure')
  ),
  array['Memory dump from affected systems (BEFORE shutdown)','Disk images of patient-zero system','Ransom note (full text + filename pattern)','Sample encrypted file (a few KB, for IR firm)','EDR alert export covering 30 days prior','Firewall logs covering 30 days prior','Backup system logs','Active Directory audit logs','VPN/RMM access logs'],
  jsonb_build_array(
    jsonb_build_object('regulation', 'Cyber insurance', 'deadline_hours', 24, 'contact', 'Carrier breach hotline', 'trigger', 'Ransomware confirmed — REQUIRED to preserve coverage'),
    jsonb_build_object('regulation', 'CISA (Cyber Incident Reporting for Critical Infrastructure Act)', 'deadline_hours', 72, 'contact', 'CISA report.cisa.gov', 'trigger', 'Covered entity in critical infrastructure sector'),
    jsonb_build_object('regulation', 'State breach notification (varies)', 'deadline_hours', 720, 'contact', 'State AG office in each affected resident state', 'trigger', 'PII of state residents was accessed or exfiltrated'),
    jsonb_build_object('regulation', 'HIPAA Breach Notification Rule', 'deadline_hours', 1440, 'contact', 'HHS OCR + affected individuals + media if >500', 'trigger', 'PHI was accessed and risk assessment is not low-probability'),
    jsonb_build_object('regulation', 'OFAC payment screening', 'deadline_hours', 0, 'contact', 'OFAC + outside counsel before any payment consideration', 'trigger', 'Any consideration of paying ransom — payments to sanctioned actors are illegal')
  ),
  array['PR.DS-11','PR.PS-04','DE.CM-01','DE.AE-02','RS.MA-01','RS.MA-02','RS.MI-01','RS.MI-02','RC.RP-01','RC.RP-04','RC.CO-03','RC.CO-04'],
  'active'
from public.tenants t
where not exists (
  select 1 from public.ir_playbooks p
  where p.tenant_id = t.id and p.category = 'ransomware'
);
