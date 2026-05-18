-- 0022_hipaa_security_rule.sql
--
-- HIPAA Security Rule (45 CFR Part 164 Subpart C) as a third framework
-- in the catalog, alongside NIST CSF 2.0 and ISO/IEC 27001:2022. Same
-- shape as 0016 — load the framework + version + definition, then seed
-- a NIST CSF 2.0 → HIPAA mapping table.
--
-- Why now: Medify Aesthetic Partners is being onboarded as the first
-- HIPAA-focused tenant. Their NIST CSF 2.0 scores will inherit into
-- HIPAA via the existing crosswalk-inheritance machinery, so the
-- /compliance page picks this up automatically with no UI changes.
--
-- Scope: 49 items covering the three Safeguard groups in Subpart C —
-- standards + implementation specifications (both Required and
-- Addressable). The Privacy Rule and Breach Notification Rule are NOT
-- included here; that's a different subpart and a different control
-- set. Add later as a separate framework if a tenant needs it.
--
-- Provenance: ID scheme is internal (AS.* / PS.* / TS.*); citation
-- string for each item is captured in the `outcome` text so an auditor
-- can match it back to the regulation. Mappings to NIST CSF 2.0 are
-- drawn from NIST SP 800-66r2 ("Implementing the HIPAA Security Rule")
-- Appendix F and are documented as 'equivalent', 'related', or
-- 'partial' per the same rubric used for the ISO crosswalk in 0016.

-- =============================================================================
-- HIPAA Security Rule framework + version
-- =============================================================================

insert into public.frameworks (slug, display_name, description)
values (
  'hipaa-security-rule',
  'HIPAA Security Rule',
  '45 CFR Part 164 Subpart C — Administrative, Physical, and Technical Safeguards for electronic protected health information (ePHI).'
)
on conflict (slug) do update set
  display_name = excluded.display_name,
  description  = excluded.description;

-- The single version we maintain. The HIPAA Security Rule itself dates
-- from 2003 with a 2013 Omnibus update; we tag this version "2013" as
-- the most recent substantive rulemaking. If HHS issues a new rule we'd
-- add a new framework_versions row and a fresh definition.
insert into public.framework_versions (framework_id, version, definition, is_current)
select
  f.id,
  '2013',
  jsonb_build_object(
    'schema_version', 2,
    'framework', jsonb_build_object(
      'slug', 'hipaa-security-rule',
      'display_name', 'HIPAA Security Rule',
      'description',  '45 CFR Part 164 Subpart C — safeguards for ePHI.'
    ),
    'scoring', jsonb_build_object(
      'dimensions', jsonb_build_array(
        jsonb_build_object('key','pol','label','Policy'),
        jsonb_build_object('key','pra','label','Practice'),
        jsonb_build_object('key','gol','label','Goal')
      ),
      'tiers', jsonb_build_array(
        jsonb_build_object('value',1,'label','Initial'),
        jsonb_build_object('value',2,'label','Repeatable'),
        jsonb_build_object('value',3,'label','Defined'),
        jsonb_build_object('value',4,'label','Managed'),
        jsonb_build_object('value',5,'label','Optimizing')
      )
    ),
    'groups', jsonb_build_array(
      -- AS Administrative Safeguards (§ 164.308) ---------------------------
      jsonb_build_object(
        'id','AS','name','Administrative Safeguards',
        'description','§ 164.308 — administrative actions, policies and procedures to manage selection, development, implementation, and maintenance of security measures protecting ePHI.',
        'categories', jsonb_build_array(jsonb_build_object(
          'id','AS','name','Administrative',
          'controls', jsonb_build_array(
            -- 164.308(a)(1) Security Management Process
            jsonb_build_object('id','AS.SMP','outcome','§ 164.308(a)(1) — Security Management Process: implement policies and procedures to prevent, detect, contain, and correct security violations.'),
            jsonb_build_object('id','AS.SMP-01','outcome','§ 164.308(a)(1)(ii)(A) [R] — Risk Analysis: assess potential risks and vulnerabilities to ePHI.'),
            jsonb_build_object('id','AS.SMP-02','outcome','§ 164.308(a)(1)(ii)(B) [R] — Risk Management: implement security measures sufficient to reduce risks and vulnerabilities to a reasonable and appropriate level.'),
            jsonb_build_object('id','AS.SMP-03','outcome','§ 164.308(a)(1)(ii)(C) [R] — Sanction Policy: apply appropriate sanctions against workforce members who fail to comply with security policies.'),
            jsonb_build_object('id','AS.SMP-04','outcome','§ 164.308(a)(1)(ii)(D) [R] — Information System Activity Review: regularly review records of information system activity (audit logs, access reports, security incident tracking).'),
            -- 164.308(a)(2) Assigned Security Responsibility
            jsonb_build_object('id','AS.ASR','outcome','§ 164.308(a)(2) [R] — Assigned Security Responsibility: identify the security official responsible for development and implementation of the policies and procedures.'),
            -- 164.308(a)(3) Workforce Security
            jsonb_build_object('id','AS.WS','outcome','§ 164.308(a)(3) — Workforce Security: implement policies and procedures to ensure workforce members have appropriate access to ePHI and prevent access by those who shouldn''t.'),
            jsonb_build_object('id','AS.WS-01','outcome','§ 164.308(a)(3)(ii)(A) [A] — Authorization and/or Supervision: of workforce members who work with ePHI or in locations where it might be accessed.'),
            jsonb_build_object('id','AS.WS-02','outcome','§ 164.308(a)(3)(ii)(B) [A] — Workforce Clearance Procedure: determine that access to ePHI is appropriate for each workforce member.'),
            jsonb_build_object('id','AS.WS-03','outcome','§ 164.308(a)(3)(ii)(C) [A] — Termination Procedures: terminate access to ePHI when employment ends or access requirements change.'),
            -- 164.308(a)(4) Information Access Management
            jsonb_build_object('id','AS.IAM','outcome','§ 164.308(a)(4) — Information Access Management: implement policies and procedures for authorizing access to ePHI consistent with the Privacy Rule.'),
            jsonb_build_object('id','AS.IAM-01','outcome','§ 164.308(a)(4)(ii)(A) [R] — Isolating Healthcare Clearinghouse Functions: implement policies and procedures to protect ePHI from the larger organization.'),
            jsonb_build_object('id','AS.IAM-02','outcome','§ 164.308(a)(4)(ii)(B) [A] — Access Authorization: policies and procedures for granting access to ePHI.'),
            jsonb_build_object('id','AS.IAM-03','outcome','§ 164.308(a)(4)(ii)(C) [A] — Access Establishment and Modification: policies and procedures for establishing, documenting, reviewing, and modifying access rights.'),
            -- 164.308(a)(5) Security Awareness and Training
            jsonb_build_object('id','AS.SAT','outcome','§ 164.308(a)(5) — Security Awareness and Training: implement a security awareness and training program for all members of the workforce.'),
            jsonb_build_object('id','AS.SAT-01','outcome','§ 164.308(a)(5)(ii)(A) [A] — Security Reminders: periodic security updates.'),
            jsonb_build_object('id','AS.SAT-02','outcome','§ 164.308(a)(5)(ii)(B) [A] — Protection from Malicious Software: guarding against, detecting, and reporting malicious software.'),
            jsonb_build_object('id','AS.SAT-03','outcome','§ 164.308(a)(5)(ii)(C) [A] — Log-in Monitoring: monitor login attempts and report discrepancies.'),
            jsonb_build_object('id','AS.SAT-04','outcome','§ 164.308(a)(5)(ii)(D) [A] — Password Management: procedures for creating, changing, and safeguarding passwords.'),
            -- 164.308(a)(6) Security Incident Procedures
            jsonb_build_object('id','AS.SIP','outcome','§ 164.308(a)(6) — Security Incident Procedures: implement policies and procedures to address security incidents.'),
            jsonb_build_object('id','AS.SIP-01','outcome','§ 164.308(a)(6)(ii) [R] — Response and Reporting: identify and respond to suspected or known security incidents; mitigate, to the extent practicable, harmful effects; document incidents and outcomes.'),
            -- 164.308(a)(7) Contingency Plan
            jsonb_build_object('id','AS.CP','outcome','§ 164.308(a)(7) — Contingency Plan: establish policies and procedures for responding to an emergency or other occurrence that damages systems containing ePHI.'),
            jsonb_build_object('id','AS.CP-01','outcome','§ 164.308(a)(7)(ii)(A) [R] — Data Backup Plan: procedures to create and maintain retrievable exact copies of ePHI.'),
            jsonb_build_object('id','AS.CP-02','outcome','§ 164.308(a)(7)(ii)(B) [R] — Disaster Recovery Plan: procedures to restore any loss of data.'),
            jsonb_build_object('id','AS.CP-03','outcome','§ 164.308(a)(7)(ii)(C) [R] — Emergency Mode Operation Plan: procedures to continue critical business processes for protection of ePHI while operating in emergency mode.'),
            jsonb_build_object('id','AS.CP-04','outcome','§ 164.308(a)(7)(ii)(D) [A] — Testing and Revision Procedures: periodic testing and revision of contingency plans.'),
            jsonb_build_object('id','AS.CP-05','outcome','§ 164.308(a)(7)(ii)(E) [A] — Applications and Data Criticality Analysis: assess relative criticality of specific applications and data in support of other contingency-plan components.'),
            -- 164.308(a)(8) Evaluation
            jsonb_build_object('id','AS.EVAL','outcome','§ 164.308(a)(8) [R] — Evaluation: perform periodic technical and nontechnical evaluation against the standards, based initially on the regulations and subsequently in response to environmental or operational changes.'),
            -- 164.308(b)(1) Business Associate Contracts and Other Arrangements
            jsonb_build_object('id','AS.BAC','outcome','§ 164.308(b)(1) [R] — Business Associate Contracts: covered entity may permit a business associate to create, receive, maintain, or transmit ePHI only if the covered entity obtains satisfactory assurances (per § 164.314(a)) that the BA will appropriately safeguard the information.')
          )
        ))
      ),
      -- PS Physical Safeguards (§ 164.310) ---------------------------------
      jsonb_build_object(
        'id','PS','name','Physical Safeguards',
        'description','§ 164.310 — physical measures, policies, and procedures to protect electronic information systems and the buildings and equipment that house them from natural and environmental hazards and unauthorized intrusion.',
        'categories', jsonb_build_array(jsonb_build_object(
          'id','PS','name','Physical',
          'controls', jsonb_build_array(
            -- 164.310(a)(1) Facility Access Controls
            jsonb_build_object('id','PS.FAC','outcome','§ 164.310(a)(1) — Facility Access Controls: implement policies and procedures to limit physical access to electronic information systems and the facilities in which they are housed, while ensuring properly authorized access is allowed.'),
            jsonb_build_object('id','PS.FAC-01','outcome','§ 164.310(a)(2)(i) [A] — Contingency Operations: procedures that allow facility access in support of restoration of lost data under the disaster recovery plan and emergency mode operations plan.'),
            jsonb_build_object('id','PS.FAC-02','outcome','§ 164.310(a)(2)(ii) [A] — Facility Security Plan: policies and procedures to safeguard the facility and equipment from unauthorized physical access, tampering, and theft.'),
            jsonb_build_object('id','PS.FAC-03','outcome','§ 164.310(a)(2)(iii) [A] — Access Control and Validation Procedures: procedures to control and validate a person''s access to facilities based on their role or function.'),
            jsonb_build_object('id','PS.FAC-04','outcome','§ 164.310(a)(2)(iv) [A] — Maintenance Records: policies and procedures to document repairs and modifications to the physical components of a facility related to security (hardware, walls, doors, locks).'),
            -- 164.310(b) Workstation Use
            jsonb_build_object('id','PS.WU','outcome','§ 164.310(b) [R] — Workstation Use: implement policies and procedures specifying the proper functions to be performed, the manner in which functions are to be performed, and physical attributes of the surroundings of workstations that can access ePHI.'),
            -- 164.310(c) Workstation Security
            jsonb_build_object('id','PS.WSEC','outcome','§ 164.310(c) [R] — Workstation Security: physical safeguards for all workstations that access ePHI, restricting access to authorized users.'),
            -- 164.310(d)(1) Device and Media Controls
            jsonb_build_object('id','PS.DMC','outcome','§ 164.310(d)(1) — Device and Media Controls: implement policies and procedures governing the receipt and removal of hardware and electronic media containing ePHI into and out of a facility, and the movement of these items within the facility.'),
            jsonb_build_object('id','PS.DMC-01','outcome','§ 164.310(d)(2)(i) [R] — Disposal: policies and procedures to address the final disposition of ePHI and the hardware or media on which it is stored.'),
            jsonb_build_object('id','PS.DMC-02','outcome','§ 164.310(d)(2)(ii) [R] — Media Re-use: procedures for removal of ePHI from electronic media before the media are made available for re-use.'),
            jsonb_build_object('id','PS.DMC-03','outcome','§ 164.310(d)(2)(iii) [A] — Accountability: maintain a record of the movements of hardware and electronic media and any person responsible for them.'),
            jsonb_build_object('id','PS.DMC-04','outcome','§ 164.310(d)(2)(iv) [A] — Data Backup and Storage: create a retrievable, exact copy of ePHI, when needed, before movement of equipment.')
          )
        ))
      ),
      -- TS Technical Safeguards (§ 164.312) --------------------------------
      jsonb_build_object(
        'id','TS','name','Technical Safeguards',
        'description','§ 164.312 — technology and the policies and procedures for its use that protect ePHI and control access to it.',
        'categories', jsonb_build_array(jsonb_build_object(
          'id','TS','name','Technical',
          'controls', jsonb_build_array(
            -- 164.312(a)(1) Access Control
            jsonb_build_object('id','TS.AC','outcome','§ 164.312(a)(1) — Access Control: implement technical policies and procedures for electronic information systems that maintain ePHI to allow access only to those persons or software programs that have been granted access rights.'),
            jsonb_build_object('id','TS.AC-01','outcome','§ 164.312(a)(2)(i) [R] — Unique User Identification: assign a unique name and/or number for identifying and tracking user identity.'),
            jsonb_build_object('id','TS.AC-02','outcome','§ 164.312(a)(2)(ii) [R] — Emergency Access Procedure: procedures for obtaining necessary ePHI during an emergency.'),
            jsonb_build_object('id','TS.AC-03','outcome','§ 164.312(a)(2)(iii) [A] — Automatic Logoff: terminate an electronic session after a predetermined time of inactivity.'),
            jsonb_build_object('id','TS.AC-04','outcome','§ 164.312(a)(2)(iv) [A] — Encryption and Decryption: a mechanism to encrypt and decrypt ePHI.'),
            -- 164.312(b) Audit Controls
            jsonb_build_object('id','TS.AUD','outcome','§ 164.312(b) [R] — Audit Controls: implement hardware, software, and procedural mechanisms that record and examine activity in information systems that contain or use ePHI.'),
            -- 164.312(c)(1) Integrity
            jsonb_build_object('id','TS.INT','outcome','§ 164.312(c)(1) — Integrity: implement policies and procedures to protect ePHI from improper alteration or destruction.'),
            jsonb_build_object('id','TS.INT-01','outcome','§ 164.312(c)(2) [A] — Mechanism to Authenticate ePHI: corroborate that ePHI has not been altered or destroyed in an unauthorized manner.'),
            -- 164.312(d) Person or Entity Authentication
            jsonb_build_object('id','TS.AUTH','outcome','§ 164.312(d) [R] — Person or Entity Authentication: verify that a person or entity seeking access to ePHI is the one claimed.'),
            -- 164.312(e)(1) Transmission Security
            jsonb_build_object('id','TS.TX','outcome','§ 164.312(e)(1) — Transmission Security: technical security measures to guard against unauthorized access to ePHI being transmitted over an electronic communications network.'),
            jsonb_build_object('id','TS.TX-01','outcome','§ 164.312(e)(2)(i) [A] — Integrity Controls: security measures to ensure electronically transmitted ePHI is not improperly modified without detection.'),
            jsonb_build_object('id','TS.TX-02','outcome','§ 164.312(e)(2)(ii) [A] — Encryption: a mechanism to encrypt ePHI whenever deemed appropriate.')
          )
        ))
      )
    )
  ),
  true
from public.frameworks f
where f.slug = 'hipaa-security-rule'
on conflict (framework_id, version) do update set
  definition = excluded.definition,
  is_current = excluded.is_current;

-- =============================================================================
-- NIST CSF 2.0 → HIPAA Security Rule mappings
-- =============================================================================
-- Drawn from NIST SP 800-66r2 ("Implementing the HIPAA Security Rule"),
-- Appendix F's crosswalk. Each row is one directional mapping; queries
-- bidirectionalize at read time.
--
-- Relationship rubric (same as 0016):
--   equivalent = same intent, similar specificity
--   related    = overlapping intent, different scope
--   partial    = one control partially satisfies the other

-- Pre-resolve the two framework_version_ids into temporary CTEs so the
-- bulk INSERT doesn't repeat the lookup for every row.
with src as (select id from public.framework_versions where version='2.0' and framework_id=(select id from public.frameworks where slug='nist-csf-2.0') limit 1),
     tgt as (select id from public.framework_versions where version='2013' and framework_id=(select id from public.frameworks where slug='hipaa-security-rule') limit 1),
     pairs (from_id, to_id, relationship) as (values
       -- Administrative Safeguards
       ('ID.RA-01','AS.SMP-01','equivalent'),     -- Risk Analysis
       ('ID.RA-03','AS.SMP-01','related'),
       ('ID.RA-04','AS.SMP-01','related'),
       ('ID.RA-05','AS.SMP-02','equivalent'),     -- Risk Management
       ('GV.RM-04','AS.SMP-02','related'),
       ('GV.RM-06','AS.SMP-02','related'),
       ('GV.RR-04','AS.SMP-03','related'),        -- Sanction Policy
       ('DE.CM-01','AS.SMP-04','related'),        -- Info System Activity Review
       ('DE.CM-09','AS.SMP-04','related'),
       ('DE.AE-02','AS.SMP-04','related'),
       ('PR.PS-04','AS.SMP-04','related'),
       ('GV.RR-01','AS.ASR','equivalent'),        -- Assigned Security Responsibility
       ('GV.RR-02','AS.ASR','equivalent'),
       ('GV.RR-04','AS.WS-01','related'),         -- Workforce Security: auth/supervision
       ('PR.AA-01','AS.WS-02','related'),         -- Workforce Clearance
       ('PR.AA-05','AS.WS-02','related'),
       ('PR.AA-01','AS.WS-03','related'),         -- Termination
       ('PR.AA-05','AS.WS-03','related'),
       ('PR.AA-05','AS.IAM','equivalent'),        -- Information Access Management (standard)
       ('PR.AA-05','AS.IAM-02','equivalent'),     -- Access Authorization
       ('PR.AA-05','AS.IAM-03','equivalent'),     -- Establishment / Modification
       ('PR.AA-04','AS.IAM-03','related'),
       ('PR.AT-01','AS.SAT','equivalent'),        -- Security Awareness & Training (standard)
       ('PR.AT-01','AS.SAT-01','related'),        -- Reminders
       ('PR.PS-05','AS.SAT-02','related'),        -- Anti-malware
       ('DE.CM-01','AS.SAT-03','related'),        -- Login monitoring
       ('PR.AA-03','AS.SAT-04','equivalent'),     -- Password Management
       ('RS.MA-01','AS.SIP','equivalent'),        -- Incident Procedures (standard)
       ('RS.MA-02','AS.SIP-01','related'),        -- Response & Reporting
       ('RS.MA-03','AS.SIP-01','related'),
       ('RS.MI-01','AS.SIP-01','related'),
       ('RS.MI-02','AS.SIP-01','related'),
       ('RS.CO-02','AS.SIP-01','related'),
       ('PR.DS-11','AS.CP-01','equivalent'),      -- Data Backup Plan
       ('RC.RP-01','AS.CP-02','equivalent'),      -- Disaster Recovery Plan
       ('RC.RP-02','AS.CP-02','related'),
       ('PR.IR-03','AS.CP-03','related'),         -- Emergency Mode Operation
       ('RC.RP-02','AS.CP-03','related'),
       ('PR.DS-11','AS.CP-04','related'),         -- Testing and Revision
       ('RC.RP-03','AS.CP-04','related'),
       ('ID.AM-05','AS.CP-05','equivalent'),      -- Apps & Data Criticality
       ('ID.IM-01','AS.EVAL','equivalent'),       -- Evaluation
       ('ID.IM-04','AS.EVAL','related'),
       ('GV.SC-05','AS.BAC','equivalent'),        -- Business Associate Contracts
       ('GV.SC-07','AS.BAC','related'),
       -- Physical Safeguards
       ('PR.AA-06','PS.FAC','equivalent'),        -- Facility Access Controls (standard)
       ('PR.IR-02','PS.FAC-02','related'),        -- Facility Security Plan
       ('PR.AA-06','PS.FAC-03','equivalent'),     -- Access Control and Validation
       ('PR.AA-06','PS.FAC-04','related'),        -- Maintenance Records
       ('PR.AA-05','PS.WU','related'),            -- Workstation Use
       ('PR.AA-06','PS.WSEC','related'),          -- Workstation Security
       ('PR.IR-02','PS.WSEC','related'),
       ('PR.PS-03','PS.DMC-01','equivalent'),     -- Disposal
       ('PR.PS-03','PS.DMC-02','equivalent'),     -- Media Re-use
       ('ID.AM-01','PS.DMC-03','related'),        -- Accountability
       ('PR.DS-11','PS.DMC-04','equivalent'),     -- Data Backup and Storage
       -- Technical Safeguards
       ('PR.AA-05','TS.AC','equivalent'),         -- Access Control (standard)
       ('PR.AA-01','TS.AC-01','equivalent'),      -- Unique User ID
       ('PR.AA-05','TS.AC-02','related'),         -- Emergency Access
       ('PR.AA-05','TS.AC-03','related'),         -- Automatic Logoff
       ('PR.DS-01','TS.AC-04','equivalent'),      -- Encryption & Decryption
       ('PR.PS-04','TS.AUD','equivalent'),        -- Audit Controls
       ('DE.CM-01','TS.AUD','related'),
       ('PR.DS-01','TS.INT-01','related'),        -- Authenticate ePHI integrity
       ('PR.AA-03','TS.AUTH','equivalent'),       -- Person/Entity Authentication
       ('PR.AA-01','TS.AUTH','related'),
       ('PR.DS-02','TS.TX','equivalent'),         -- Transmission Security (standard)
       ('PR.DS-02','TS.TX-01','equivalent'),      -- Integrity Controls
       ('PR.DS-02','TS.TX-02','equivalent')       -- Encryption
     )
insert into public.framework_mappings (
  from_framework_version_id, from_control_id,
  to_framework_version_id,   to_control_id,
  relationship
)
select
  (select id from src),  p.from_id,
  (select id from tgt),  p.to_id,
  p.relationship
from pairs p
on conflict (from_framework_version_id, from_control_id, to_framework_version_id, to_control_id)
  do update set relationship = excluded.relationship;
