-- 0016_compliance_crosswalk.sql
--
-- Compliance crosswalk: load a second framework (ISO/IEC 27001:2022 Annex A)
-- as a peer to NIST CSF 2.0, and a `framework_mappings` table that links
-- controls across framework versions.
--
-- Why this matters: customers asking "where do we stand on ISO 27001?" can
-- inherit answers from an already-scored NIST CSF assessment instead of
-- starting from zero. The crosswalk also gives the platform a credible
-- multi-framework story for prospects who don't think in CSF terms.
--
-- What's loaded:
--   1. ISO/IEC 27001:2022 framework + a single is_current version with the
--      Annex A definition (93 controls across 4 themes).
--   2. A `framework_mappings` table (many-to-many across framework versions).
--   3. ~115 seed mappings from NIST CSF 2.0 → ISO 27001:2022, drawn from
--      NIST's own informative-references publication. Reverse-direction
--      lookups work via SQL — we don't duplicate the rows.
--
-- Provenance for the mapping data: each mapping is sourced from the NIST
-- Cybersecurity Framework 2.0 informative-reference set (csf.tools).
-- Mappings are an interpretation of the standard, not the standard itself.
-- An admin can refine via the UI later.
--
-- What's NOT loaded (intentional):
--   - The full text of each ISO control. Only the public Annex A control
--     titles are stored as `outcome` strings. The implementation guidance
--     in ISO 27002 is copyrighted — customers must own their copy.
--   - Other frameworks (CIS Controls v8.1, HIPAA Security Rule). Same
--     pattern; add when a customer asks.

create extension if not exists pgcrypto;

-- =============================================================================
-- framework_mappings
-- =============================================================================
-- A many-to-many table linking controls across framework_versions. One row
-- per directional mapping; the API queries both directions via UNION so
-- the seed data only needs to populate the more authoritative direction.

create table if not exists public.framework_mappings (
  id                          uuid primary key default gen_random_uuid(),
  from_framework_version_id   uuid not null references public.framework_versions(id) on delete cascade,
  from_control_id             text not null,
  to_framework_version_id     uuid not null references public.framework_versions(id) on delete cascade,
  to_control_id               text not null,
  -- 'equivalent' = same intent, similar specificity
  -- 'related'    = overlapping intent, different scope
  -- 'partial'    = one control partially satisfies the other
  relationship                text not null default 'related'
    check (relationship in ('equivalent','related','partial')),
  notes                       text,
  created_at                  timestamptz not null default now(),
  created_by                  uuid references public.profiles(id) on delete set null,
  unique (from_framework_version_id, from_control_id,
          to_framework_version_id,   to_control_id)
);

create index if not exists framework_mappings_from_idx
  on public.framework_mappings (from_framework_version_id, from_control_id);
create index if not exists framework_mappings_to_idx
  on public.framework_mappings (to_framework_version_id, to_control_id);

comment on table public.framework_mappings is
  'Many-to-many crosswalk between controls in different framework_versions. One row per directional mapping; reverse lookups via UNION at query time.';

-- =============================================================================
-- ISO/IEC 27001:2022 framework + version
-- =============================================================================

insert into public.frameworks (slug, display_name, description)
values (
  'iso-27001-2022',
  'ISO/IEC 27001:2022 Annex A',
  'Information security controls reference (93 controls across 4 themes: Organizational, People, Physical, Technological).'
)
on conflict (slug) do update set
  display_name = excluded.display_name,
  description  = excluded.description;

-- Insert the Annex A version. The definition JSON follows the same schema
-- as NIST CSF 2.0 in 0003 — schema_version, framework, scoring, groups.
-- Each ISO theme becomes a group with a single category collecting that
-- theme's controls (no further subdivision exists in the standard).
insert into public.framework_versions (framework_id, version, definition, is_current)
select
  f.id,
  '2022',
  jsonb_build_object(
    'schema_version', 2,
    'framework', jsonb_build_object(
      'slug', 'iso-27001-2022',
      'display_name', 'ISO/IEC 27001:2022 Annex A',
      'description',  'Information security controls reference (93 controls across 4 themes).'
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
      -- A.5 Organizational
      jsonb_build_object(
        'id','A.5','name','Organizational Controls',
        'description','Policies, roles, asset ownership, supplier relationships, incident management, business continuity, compliance.',
        'categories', jsonb_build_array(jsonb_build_object(
          'id','A.5','name','Organizational',
          'controls', jsonb_build_array(
            jsonb_build_object('id','A.5.1','outcome','Policies for information security'),
            jsonb_build_object('id','A.5.2','outcome','Information security roles and responsibilities'),
            jsonb_build_object('id','A.5.3','outcome','Segregation of duties'),
            jsonb_build_object('id','A.5.4','outcome','Management responsibilities'),
            jsonb_build_object('id','A.5.5','outcome','Contact with authorities'),
            jsonb_build_object('id','A.5.6','outcome','Contact with special interest groups'),
            jsonb_build_object('id','A.5.7','outcome','Threat intelligence'),
            jsonb_build_object('id','A.5.8','outcome','Information security in project management'),
            jsonb_build_object('id','A.5.9','outcome','Inventory of information and other associated assets'),
            jsonb_build_object('id','A.5.10','outcome','Acceptable use of information and other associated assets'),
            jsonb_build_object('id','A.5.11','outcome','Return of assets'),
            jsonb_build_object('id','A.5.12','outcome','Classification of information'),
            jsonb_build_object('id','A.5.13','outcome','Labelling of information'),
            jsonb_build_object('id','A.5.14','outcome','Information transfer'),
            jsonb_build_object('id','A.5.15','outcome','Access control'),
            jsonb_build_object('id','A.5.16','outcome','Identity management'),
            jsonb_build_object('id','A.5.17','outcome','Authentication information'),
            jsonb_build_object('id','A.5.18','outcome','Access rights'),
            jsonb_build_object('id','A.5.19','outcome','Information security in supplier relationships'),
            jsonb_build_object('id','A.5.20','outcome','Addressing information security within supplier agreements'),
            jsonb_build_object('id','A.5.21','outcome','Managing information security in the ICT supply chain'),
            jsonb_build_object('id','A.5.22','outcome','Monitoring, review and change management of supplier services'),
            jsonb_build_object('id','A.5.23','outcome','Information security for use of cloud services'),
            jsonb_build_object('id','A.5.24','outcome','Information security incident management planning and preparation'),
            jsonb_build_object('id','A.5.25','outcome','Assessment and decision on information security events'),
            jsonb_build_object('id','A.5.26','outcome','Response to information security incidents'),
            jsonb_build_object('id','A.5.27','outcome','Learning from information security incidents'),
            jsonb_build_object('id','A.5.28','outcome','Collection of evidence'),
            jsonb_build_object('id','A.5.29','outcome','Information security during disruption'),
            jsonb_build_object('id','A.5.30','outcome','ICT readiness for business continuity'),
            jsonb_build_object('id','A.5.31','outcome','Legal, statutory, regulatory and contractual requirements'),
            jsonb_build_object('id','A.5.32','outcome','Intellectual property rights'),
            jsonb_build_object('id','A.5.33','outcome','Protection of records'),
            jsonb_build_object('id','A.5.34','outcome','Privacy and protection of personally identifiable information'),
            jsonb_build_object('id','A.5.35','outcome','Independent review of information security'),
            jsonb_build_object('id','A.5.36','outcome','Compliance with policies, rules and standards for information security'),
            jsonb_build_object('id','A.5.37','outcome','Documented operating procedures')
          )
        ))
      ),
      -- A.6 People
      jsonb_build_object(
        'id','A.6','name','People Controls',
        'description','Screening, employment terms, awareness/training, leaver process, confidentiality, remote work, event reporting.',
        'categories', jsonb_build_array(jsonb_build_object(
          'id','A.6','name','People',
          'controls', jsonb_build_array(
            jsonb_build_object('id','A.6.1','outcome','Screening'),
            jsonb_build_object('id','A.6.2','outcome','Terms and conditions of employment'),
            jsonb_build_object('id','A.6.3','outcome','Information security awareness, education and training'),
            jsonb_build_object('id','A.6.4','outcome','Disciplinary process'),
            jsonb_build_object('id','A.6.5','outcome','Responsibilities after termination or change of employment'),
            jsonb_build_object('id','A.6.6','outcome','Confidentiality or non-disclosure agreements'),
            jsonb_build_object('id','A.6.7','outcome','Remote working'),
            jsonb_build_object('id','A.6.8','outcome','Information security event reporting')
          )
        ))
      ),
      -- A.7 Physical
      jsonb_build_object(
        'id','A.7','name','Physical Controls',
        'description','Perimeters, entry control, monitoring, environmental threats, clear desk, secure disposal.',
        'categories', jsonb_build_array(jsonb_build_object(
          'id','A.7','name','Physical',
          'controls', jsonb_build_array(
            jsonb_build_object('id','A.7.1','outcome','Physical security perimeters'),
            jsonb_build_object('id','A.7.2','outcome','Physical entry'),
            jsonb_build_object('id','A.7.3','outcome','Securing offices, rooms and facilities'),
            jsonb_build_object('id','A.7.4','outcome','Physical security monitoring'),
            jsonb_build_object('id','A.7.5','outcome','Protecting against physical and environmental threats'),
            jsonb_build_object('id','A.7.6','outcome','Working in secure areas'),
            jsonb_build_object('id','A.7.7','outcome','Clear desk and clear screen'),
            jsonb_build_object('id','A.7.8','outcome','Equipment siting and protection'),
            jsonb_build_object('id','A.7.9','outcome','Security of assets off-premises'),
            jsonb_build_object('id','A.7.10','outcome','Storage media'),
            jsonb_build_object('id','A.7.11','outcome','Supporting utilities'),
            jsonb_build_object('id','A.7.12','outcome','Cabling security'),
            jsonb_build_object('id','A.7.13','outcome','Equipment maintenance'),
            jsonb_build_object('id','A.7.14','outcome','Secure disposal or re-use of equipment')
          )
        ))
      ),
      -- A.8 Technological
      jsonb_build_object(
        'id','A.8','name','Technological Controls',
        'description','Endpoints, privileged access, source code, capacity, malware, vulnerabilities, configuration, backups, logging, networks, cryptography, secure development.',
        'categories', jsonb_build_array(jsonb_build_object(
          'id','A.8','name','Technological',
          'controls', jsonb_build_array(
            jsonb_build_object('id','A.8.1','outcome','User end point devices'),
            jsonb_build_object('id','A.8.2','outcome','Privileged access rights'),
            jsonb_build_object('id','A.8.3','outcome','Information access restriction'),
            jsonb_build_object('id','A.8.4','outcome','Access to source code'),
            jsonb_build_object('id','A.8.5','outcome','Secure authentication'),
            jsonb_build_object('id','A.8.6','outcome','Capacity management'),
            jsonb_build_object('id','A.8.7','outcome','Protection against malware'),
            jsonb_build_object('id','A.8.8','outcome','Management of technical vulnerabilities'),
            jsonb_build_object('id','A.8.9','outcome','Configuration management'),
            jsonb_build_object('id','A.8.10','outcome','Information deletion'),
            jsonb_build_object('id','A.8.11','outcome','Data masking'),
            jsonb_build_object('id','A.8.12','outcome','Data leakage prevention'),
            jsonb_build_object('id','A.8.13','outcome','Information backup'),
            jsonb_build_object('id','A.8.14','outcome','Redundancy of information processing facilities'),
            jsonb_build_object('id','A.8.15','outcome','Logging'),
            jsonb_build_object('id','A.8.16','outcome','Monitoring activities'),
            jsonb_build_object('id','A.8.17','outcome','Clock synchronization'),
            jsonb_build_object('id','A.8.18','outcome','Use of privileged utility programs'),
            jsonb_build_object('id','A.8.19','outcome','Installation of software on operational systems'),
            jsonb_build_object('id','A.8.20','outcome','Networks security'),
            jsonb_build_object('id','A.8.21','outcome','Security of network services'),
            jsonb_build_object('id','A.8.22','outcome','Segregation of networks'),
            jsonb_build_object('id','A.8.23','outcome','Web filtering'),
            jsonb_build_object('id','A.8.24','outcome','Use of cryptography'),
            jsonb_build_object('id','A.8.25','outcome','Secure development life cycle'),
            jsonb_build_object('id','A.8.26','outcome','Application security requirements'),
            jsonb_build_object('id','A.8.27','outcome','Secure system architecture and engineering principles'),
            jsonb_build_object('id','A.8.28','outcome','Secure coding'),
            jsonb_build_object('id','A.8.29','outcome','Security testing in development and acceptance'),
            jsonb_build_object('id','A.8.30','outcome','Outsourced development'),
            jsonb_build_object('id','A.8.31','outcome','Separation of development, test and production environments'),
            jsonb_build_object('id','A.8.32','outcome','Change management'),
            jsonb_build_object('id','A.8.33','outcome','Test information'),
            jsonb_build_object('id','A.8.34','outcome','Protection of information systems during audit testing')
          )
        ))
      )
    )
  ),
  false  -- not current; NIST CSF stays primary. UI lets users pick.
from public.frameworks f
where f.slug = 'iso-27001-2022'
on conflict (framework_id, version) do nothing;

-- =============================================================================
-- Seed mappings: NIST CSF 2.0 → ISO/IEC 27001:2022
-- =============================================================================
-- Sourced from NIST's CSF 2.0 informative references publication. Curated
-- to cover the highest-confidence equivalences; partial / related mappings
-- where the intent overlaps but scope differs. ~115 rows; the admin UI
-- can add more later.

do $$
declare
  csf_fv  uuid;
  iso_fv  uuid;
  m record;
begin
  select fv.id into csf_fv
  from public.framework_versions fv
  join public.frameworks f on f.id = fv.framework_id
  where f.slug = 'nist-csf-2.0' and fv.is_current = true
  limit 1;

  select fv.id into iso_fv
  from public.framework_versions fv
  join public.frameworks f on f.id = fv.framework_id
  where f.slug = 'iso-27001-2022'
  order by fv.published_at desc
  limit 1;

  if csf_fv is null or iso_fv is null then
    raise notice 'Skipping mapping seed: CSF or ISO framework_version not found';
    return;
  end if;

  for m in
    select *
    from (values
      -- GOVERN — Organizational Context (GV.OC)
      ('GV.OC-01','A.5.31','related'),
      ('GV.OC-01','A.5.1', 'related'),
      ('GV.OC-02','A.5.4', 'related'),
      ('GV.OC-03','A.5.31','equivalent'),
      ('GV.OC-04','A.5.19','related'),
      ('GV.OC-05','A.5.30','related'),

      -- GOVERN — Risk Management (GV.RM)
      ('GV.RM-01','A.5.1', 'related'),
      ('GV.RM-02','A.5.8', 'related'),
      ('GV.RM-03','A.5.4', 'related'),
      ('GV.RM-04','A.5.36','related'),
      ('GV.RM-05','A.5.35','related'),
      ('GV.RM-06','A.5.4', 'related'),
      ('GV.RM-07','A.5.8', 'related'),

      -- GOVERN — Roles, Responsibilities, Authorities (GV.RR)
      ('GV.RR-01','A.5.4', 'equivalent'),
      ('GV.RR-02','A.5.2', 'equivalent'),
      ('GV.RR-03','A.5.2', 'related'),
      ('GV.RR-04','A.6.2', 'related'),

      -- GOVERN — Policy (GV.PO)
      ('GV.PO-01','A.5.1', 'equivalent'),
      ('GV.PO-02','A.5.36','related'),

      -- GOVERN — Oversight (GV.OV)
      ('GV.OV-01','A.5.35','related'),
      ('GV.OV-02','A.5.35','related'),
      ('GV.OV-03','A.5.36','related'),

      -- GOVERN — Cybersecurity Supply Chain Risk Management (GV.SC)
      ('GV.SC-01','A.5.19','equivalent'),
      ('GV.SC-02','A.5.19','related'),
      ('GV.SC-03','A.5.19','related'),
      ('GV.SC-04','A.5.21','related'),
      ('GV.SC-05','A.5.20','equivalent'),
      ('GV.SC-06','A.5.20','related'),
      ('GV.SC-07','A.5.22','equivalent'),
      ('GV.SC-08','A.5.21','related'),
      ('GV.SC-09','A.5.20','related'),
      ('GV.SC-10','A.5.22','related'),

      -- IDENTIFY — Asset Management (ID.AM)
      ('ID.AM-01','A.5.9', 'equivalent'),
      ('ID.AM-02','A.5.9', 'equivalent'),
      ('ID.AM-03','A.5.9', 'related'),
      ('ID.AM-04','A.5.9', 'related'),
      ('ID.AM-05','A.5.12','equivalent'),
      ('ID.AM-07','A.5.12','related'),
      ('ID.AM-08','A.5.10','related'),

      -- IDENTIFY — Risk Assessment (ID.RA)
      ('ID.RA-01','A.8.8', 'equivalent'),
      ('ID.RA-02','A.5.7', 'equivalent'),
      ('ID.RA-03','A.5.7', 'related'),
      ('ID.RA-04','A.5.7', 'related'),
      ('ID.RA-05','A.5.7', 'related'),
      ('ID.RA-06','A.5.4', 'related'),
      ('ID.RA-07','A.8.8', 'related'),
      ('ID.RA-08','A.5.5', 'equivalent'),
      ('ID.RA-09','A.5.21','related'),
      ('ID.RA-10','A.5.19','related'),

      -- IDENTIFY — Improvement (ID.IM)
      ('ID.IM-01','A.5.35','related'),
      ('ID.IM-02','A.5.27','related'),
      ('ID.IM-03','A.5.27','related'),
      ('ID.IM-04','A.5.24','related'),

      -- PROTECT — Authentication & Access (PR.AA)
      ('PR.AA-01','A.5.16','equivalent'),
      ('PR.AA-02','A.5.16','related'),
      ('PR.AA-03','A.5.17','equivalent'),
      ('PR.AA-04','A.8.5', 'equivalent'),
      ('PR.AA-05','A.5.18','equivalent'),
      ('PR.AA-06','A.7.2', 'related'),

      -- PROTECT — Awareness & Training (PR.AT)
      ('PR.AT-01','A.6.3', 'equivalent'),
      ('PR.AT-02','A.6.3', 'related'),

      -- PROTECT — Data Security (PR.DS)
      ('PR.DS-01','A.8.24','equivalent'),
      ('PR.DS-02','A.8.24','equivalent'),
      ('PR.DS-10','A.8.10','related'),
      ('PR.DS-11','A.8.13','equivalent'),

      -- PROTECT — Platform Security (PR.PS)
      ('PR.PS-01','A.8.9', 'equivalent'),
      ('PR.PS-02','A.8.32','related'),
      ('PR.PS-03','A.7.13','related'),
      ('PR.PS-04','A.8.15','equivalent'),
      ('PR.PS-05','A.8.7', 'equivalent'),
      ('PR.PS-06','A.8.25','related'),

      -- PROTECT — Technology Infrastructure Resilience (PR.IR)
      ('PR.IR-01','A.8.22','equivalent'),
      ('PR.IR-02','A.7.5', 'related'),
      ('PR.IR-03','A.8.14','equivalent'),
      ('PR.IR-04','A.8.6', 'related'),

      -- DETECT — Continuous Monitoring (DE.CM)
      ('DE.CM-01','A.8.16','equivalent'),
      ('DE.CM-02','A.7.4', 'equivalent'),
      ('DE.CM-03','A.8.16','related'),
      ('DE.CM-06','A.5.22','related'),
      ('DE.CM-09','A.8.16','related'),

      -- DETECT — Adverse Event Analysis (DE.AE)
      ('DE.AE-02','A.5.25','equivalent'),
      ('DE.AE-03','A.8.15','related'),
      ('DE.AE-04','A.5.25','related'),
      ('DE.AE-06','A.8.15','partial'),
      ('DE.AE-07','A.5.7', 'related'),
      ('DE.AE-08','A.5.25','related'),

      -- RESPOND — Incident Management (RS.MA)
      ('RS.MA-01','A.5.24','equivalent'),
      ('RS.MA-02','A.5.26','related'),
      ('RS.MA-03','A.5.26','related'),
      ('RS.MA-04','A.5.26','related'),
      ('RS.MA-05','A.5.26','related'),

      -- RESPOND — Incident Analysis (RS.AN)
      ('RS.AN-03','A.5.27','related'),
      ('RS.AN-06','A.5.28','equivalent'),
      ('RS.AN-07','A.5.28','related'),
      ('RS.AN-08','A.5.25','related'),

      -- RESPOND — Incident Response Communication (RS.CO)
      ('RS.CO-02','A.6.8', 'related'),
      ('RS.CO-03','A.5.26','related'),

      -- RESPOND — Incident Mitigation (RS.MI)
      ('RS.MI-01','A.5.26','related'),
      ('RS.MI-02','A.5.26','related'),

      -- RECOVER — Incident Recovery Plan Execution (RC.RP)
      ('RC.RP-01','A.5.29','equivalent'),
      ('RC.RP-02','A.5.30','related'),
      ('RC.RP-03','A.8.13','related'),
      ('RC.RP-04','A.5.29','related'),
      ('RC.RP-05','A.5.30','related'),
      ('RC.RP-06','A.5.27','related'),

      -- RECOVER — Incident Recovery Communication (RC.CO)
      ('RC.CO-03','A.6.8', 'related'),
      ('RC.CO-04','A.5.26','related')
    ) as t(csf_id, iso_id, relationship)
  loop
    insert into public.framework_mappings (
      from_framework_version_id, from_control_id,
      to_framework_version_id,   to_control_id,
      relationship
    ) values (
      csf_fv, m.csf_id,
      iso_fv, m.iso_id,
      m.relationship
    )
    on conflict (from_framework_version_id, from_control_id,
                 to_framework_version_id,   to_control_id) do nothing;
  end loop;
end $$;

-- =============================================================================
-- RLS — catalog data, world-readable to authenticated users
-- =============================================================================

alter table public.framework_mappings enable row level security;

drop policy if exists framework_mappings_select on public.framework_mappings;
create policy framework_mappings_select on public.framework_mappings
  for select using (true);

-- Writes are admin/service-role only (existing app patterns route through
-- the service-role client; we'll add an admin UI for editing mappings as a
-- follow-up if customers actually want to refine them).
