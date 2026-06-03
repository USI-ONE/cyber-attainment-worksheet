// Hand-written DB types for the tables we use. Replace with `supabase gen types` later if desired.

/**
 * Mirrors the Postgres `membership_role` enum (see migrations 0015 + 0023).
 *
 *   editor  — historical role. Today behaves the same as `viewer` (read-only)
 *             because edit privileges are platform-admin-only. Preserved
 *             for forward-compat with a possible future per-tenant
 *             admin tier.
 *   viewer  — read access to that tenant's data.
 *   admin   — on a tenant flagged is_admin_tenant=true, confers effective
 *             platform-admin (see lib/auth.ts elevation logic). On any
 *             non-admin tenant, treated the same as editor/viewer.
 */
export type MembershipRole = 'editor' | 'viewer' | 'admin';

export interface Tenant {
  id: string;
  slug: string;
  hostname: string | null;
  display_name: string;
  brand_config: BrandConfig;
  created_at: string;
}

export interface BrandConfig {
  logo_url?: string;
  display_name_override?: string;
  [key: string]: unknown;
}

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
}

export interface Membership {
  user_id: string;
  tenant_id: string;
  role: MembershipRole;
  created_at: string;
}

export interface Framework {
  id: string;
  slug: string;
  display_name: string;
  description: string | null;
}

export interface FrameworkVersion {
  id: string;
  framework_id: string;
  version: string;
  definition: FrameworkDefinition;
  published_at: string;
  is_current: boolean;
}

export interface FrameworkDefinition {
  schema_version: number;
  framework: { slug: string; display_name: string; description?: string };
  scoring: {
    dimensions: { key: string; label: string; description?: string }[];
    tiers: { value: number; label: string }[];
  };
  groups: FrameworkGroup[];
}

export interface FrameworkGroup {
  id: string;
  name: string;
  description?: string;
  categories: FrameworkCategory[];
}

export interface FrameworkCategory {
  id: string;
  name: string;
  controls: FrameworkControl[];
}

export interface FrameworkControl {
  id: string;
  outcome: string;
}

export interface CurrentScore {
  tenant_id: string;
  framework_version_id: string;
  control_id: string;
  pol: number | null;
  pra: number | null;
  gol: number | null;
  prio: number | null;
  owner: string | null;
  status: string | null;
  notes: string | null;
  updated_by: string | null;
  updated_at: string;
}

export type ScoreField = 'pol' | 'pra' | 'gol' | 'prio' | 'owner' | 'status' | 'notes';

// ---------------------------------------------------------------------------
// Incidents — see db/migrations/0009_incidents.sql
// ---------------------------------------------------------------------------

export type IncidentStatus = 'open' | 'contained' | 'closed';
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

/** A single timeline entry. `at` is freeform so users can log ranges
 * ("April 22–30, 2026") or full timestamps. The UI orders them as written. */
export interface IncidentTimelineEntry {
  at: string;
  event: string;
}

export interface Incident {
  id: string;
  tenant_id: string;
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  category: string | null;
  detected_at: string | null;
  contained_at: string | null;
  closed_at: string | null;
  reported_by: string | null;
  affected_users: string[];
  description: string | null;
  timeline: IncidentTimelineEntry[];
  findings: string[];
  actions: string[];
  recommendations: string[];
  linked_control_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface IncidentDocument {
  id: string;
  incident_id: string;
  tenant_id: string;
  storage_path: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Policy documents — see db/migrations/0010_policy_documents.sql
// ---------------------------------------------------------------------------

export type PolicyDocumentStatus = 'draft' | 'published' | 'archived';

// ---------------------------------------------------------------------------
// Assessment responses — see db/migrations/0011_assessment_responses.sql
// ---------------------------------------------------------------------------

export type AssessmentAnswer = 'no' | 'partial' | 'yes';

/**
 * One answered item inside an assessment response. `id` corresponds to
 * the AssessmentItem.id in lib/assessment-questions.ts. Notes are
 * optional per-item assessor commentary that doesn't affect score.
 */
export interface ItemAnswer {
  id: string;
  answer: AssessmentAnswer | null;
  notes?: string | null;
}

export interface AssessmentResponse {
  tenant_id: string;
  framework_version_id: string;
  control_id: string;
  // New primary shape — variable-length list of answered items.
  items_answered: ItemAnswer[];
  // Evidence narrative (text). Distinct from per-item notes; this is the
  // "describe an improvement / example" prompt that earns the Optimizing
  // tier when filled and every item is Yes.
  q4_improvement: string | null;
  // Legacy fixed-shape fields. Backfilled by migration 0029 from the
  // first three items so existing readers (recommendations, audit
  // binder) keep working. Write-path mirrors the first three items
  // back into these columns. New code should read items_answered.
  q1_documented: AssessmentAnswer | null;
  q2_followed:   AssessmentAnswer | null;
  q3_measured:   AssessmentAnswer | null;
  notes: string | null;
  computed_score: number | null;
  responded_by: string | null;
  responded_at: string;
}

export interface PolicyDocument {
  id: string;
  tenant_id: string;
  title: string;
  version: string | null;
  effective_date: string | null;       // ISO date (yyyy-mm-dd) from Postgres date
  owner: string | null;
  status: PolicyDocumentStatus;
  description: string | null;
  storage_path: string;
  filename: string;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  linked_control_ids: string[];
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Plans Library — operational counterpart to the Policy Library.
// See db/migrations/0030_plans_library.sql.
// ---------------------------------------------------------------------------

export type PlanCategory = 'resilience' | 'operational' | 'risk_compliance' | 'strategic';
export type PlanStatus   = 'missing' | 'draft' | 'active' | 'expired' | 'na';

export interface PlanCatalogEntry {
  code: string;
  title: string;
  category: PlanCategory;
  description: string | null;
  default_review_months: number;
  sort_order: number;
}

export interface TenantPlanState {
  id: string;
  tenant_id: string;
  plan_code: string;
  status: PlanStatus;
  version: string | null;
  last_reviewed_at: string | null;
  next_review_due: string | null;
  owner_user_id: string | null;
  plan_document_id: string | null;
  notes: string | null;
  updated_at: string;
  updated_by: string | null;
}

// ---------------------------------------------------------------------------
// DR Plans + IR Playbooks — see db/migrations/0012_dr_ir_planning.sql
// ---------------------------------------------------------------------------

export type DrPlanStatus  = 'draft' | 'active' | 'archived';
export type DrTestResult  = 'pass' | 'partial' | 'fail';
export type DrTier        = 1 | 2 | 3;

export interface DrPlan {
  id: string;
  tenant_id: string;
  name: string;
  system_name: string | null;
  tier: DrTier;
  rto_minutes: number | null;
  rpo_minutes: number | null;
  description: string | null;
  backup_method: string | null;
  backup_frequency: string | null;
  backup_retention: string | null;
  recovery_steps: string[];
  recovery_owner: string | null;
  recovery_team: string[];
  dependencies: string[];
  last_tested: string | null;       // yyyy-mm-dd
  last_test_result: DrTestResult | null;
  last_test_notes: string | null;
  next_test_due: string | null;     // yyyy-mm-dd
  linked_control_ids: string[];
  status: DrPlanStatus;
  created_at: string;
  updated_at: string;
}

export type IrPlaybookStatus   = 'draft' | 'active' | 'archived';
export type IrPlaybookSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface IrCommunicationsEntry {
  audience: string;
  when: string;
  channel: string;
  message_template: string;
}

export interface IrEscalationContact {
  role: string;
  name: string;
  phone: string;
  email: string;
  when_to_contact: string;
}

export interface IrRegulatoryNotification {
  regulation: string;
  deadline_hours: number;
  contact: string;
  trigger: string;
}

// ---------------------------------------------------------------------------
// Risks + Risk Treatments — see db/migrations/0013_risk_register.sql
// ---------------------------------------------------------------------------

export type RiskCategory =
  | 'cyber' | 'operational' | 'compliance' | 'people'
  | 'supply_chain' | 'physical' | 'financial';
export type RiskTreatmentStrategy = 'accept' | 'mitigate' | 'transfer' | 'avoid';
export type RiskStatus = 'open' | 'in_treatment' | 'accepted' | 'closed' | 'transferred';
/** 1 (rare/minor) … 5 (almost certain / catastrophic). */
export type RiskLevel = 1 | 2 | 3 | 4 | 5;

export interface Risk {
  id: string;
  tenant_id: string;
  code: string;
  title: string;
  description: string | null;
  category: RiskCategory;
  rationale: string | null;
  inherent_likelihood: RiskLevel;
  inherent_impact: RiskLevel;
  inherent_score: number;              // generated, 1..25
  residual_likelihood: RiskLevel;
  residual_impact: RiskLevel;
  residual_score: number;              // generated, 1..25
  treatment_strategy: RiskTreatmentStrategy;
  owner: string | null;
  status: RiskStatus;
  linked_control_ids: string[];
  linked_dr_plan_ids: string[];
  linked_ir_playbook_ids: string[];
  linked_incident_ids: string[];
  last_reviewed: string | null;        // yyyy-mm-dd
  next_review_due: string | null;
  created_at: string;
  updated_at: string;
}

export type RiskTreatmentStatus = 'Not Started' | 'In Progress' | 'Blocked' | 'Complete';

// ---------------------------------------------------------------------------
// Security Awareness Training — see db/migrations/0018_training.sql
// ---------------------------------------------------------------------------

export type TrainingCampaignKind =
  | 'awareness' | 'phishing' | 'role_specific' | 'onboarding' | 'tabletop' | 'other';
export type TrainingCampaignStatus = 'planned' | 'active' | 'completed' | 'archived';

export interface TrainingCampaign {
  id: string;
  tenant_id: string;
  name: string;
  kind: TrainingCampaignKind;
  description: string | null;
  vendor: string | null;
  scheduled_at: string | null;
  completed_at: string | null;
  target_audience: string | null;
  status: TrainingCampaignStatus;
  recipient_count: number;
  clicked_count: number;
  reported_count: number;
  credentials_submitted_count: number;
  attachment_opened_count: number;
  linked_control_ids: string[];
  linked_risk_ids: string[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type TrainingRecordStatus =
  | 'assigned' | 'in_progress' | 'complete' | 'overdue' | 'exempt' | 'failed';

export interface TrainingRecord {
  id: string;
  tenant_id: string;
  campaign_id: string;
  trainee_email: string | null;
  trainee_name: string | null;
  trainee_role: string | null;
  assigned_at: string | null;
  due_date: string | null;
  completed_at: string | null;
  status: TrainingRecordStatus;
  score: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Vendor Risk — see db/migrations/0017_vendor_risk.sql
// ---------------------------------------------------------------------------

export type VendorType =
  | 'saas' | 'msp' | 'hardware' | 'consulting'
  | 'payments' | 'infrastructure' | 'contractor' | 'other';
export type VendorCriticality = 'low' | 'medium' | 'high' | 'critical';
export type VendorDataSensitivity =
  | 'none' | 'public' | 'internal' | 'confidential'
  | 'pii' | 'phi' | 'financial' | 'regulated';
export type VendorStatus = 'pending' | 'active' | 'offboarded';

export interface Vendor {
  id: string;
  tenant_id: string;
  name: string;
  service_description: string | null;
  vendor_type: VendorType;
  criticality: VendorCriticality;
  data_sensitivity: VendorDataSensitivity;
  access_summary: string | null;
  status: VendorStatus;
  owner: string | null;
  primary_contact: string | null;
  contact_email: string | null;
  contract_renewal_at: string | null;
  annual_spend_usd: number | null;
  website: string | null;
  notes: string | null;
  linked_risk_ids: string[];
  linked_control_ids: string[];
  linked_incident_ids: string[];
  last_assessed_at: string | null;
  next_assessment_at: string | null;
  created_at: string;
  updated_at: string;
}

export type AttestationType =
  | 'soc2_type1' | 'soc2_type2'
  | 'iso_27001' | 'iso_27017' | 'iso_27018' | 'iso_27701'
  | 'pci_dss' | 'hipaa_baa'
  | 'fedramp_high' | 'fedramp_moderate' | 'cmmc'
  | 'cyber_insurance' | 'penetration_test' | 'vulnerability_scan'
  | 'tpsa' | 'ddq'
  | 'other';
export type AttestationStatus = 'pending' | 'current' | 'expired' | 'superseded' | 'archived';

/** One question in a TPSA / DDQ audit checklist. response=null means
 *  "unanswered" — the auditor hasn't gotten to it yet. */
export interface AttestationChecklistItem {
  id: string;
  label: string;
  response: 'yes' | 'no' | 'na' | null;
  notes: string;
}

export interface AttestationChecklist {
  template_version: string;
  items: AttestationChecklistItem[];
}

export interface VendorAttestation {
  id: string;
  tenant_id: string;
  vendor_id: string;
  attestation_type: AttestationType;
  title: string;
  issued_on: string | null;
  expires_on: string | null;
  status: AttestationStatus;
  evidence_artifact_id: string | null;
  findings_critical: number;
  findings_major: number;
  findings_minor: number;
  notes: string | null;
  /** Structured audit checklist. Populated automatically when the
   *  attestation is of type 'tpsa' or 'ddq'; null otherwise. */
  checklist: AttestationChecklist | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Evidence Library — see db/migrations/0014_evidence_library.sql
// ---------------------------------------------------------------------------

export type EvidenceStatus   = 'current' | 'superseded' | 'expired' | 'archived';

/** Pre-baked category set the UI exposes as filter pills. The DB column is
 *  free text so adding more categories later is a code-only change. */
export const EVIDENCE_CATEGORIES = [
  'access_review',
  'config_screenshot',
  'training_record',
  'dr_test_result',
  'ir_tabletop_record',
  'vulnerability_scan',
  'penetration_test',
  'audit_evidence',
  'policy_attestation',
  'backup_verification',
  'log_export',
  'certification',
  'incident_report',
  'other',
] as const;
export type EvidenceCategory = typeof EVIDENCE_CATEGORIES[number];

export interface EvidenceArtifact {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  category: EvidenceCategory | string;       // any string accepted in DB
  storage_path: string | null;
  filename: string | null;
  content_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  collected_date: string | null;             // yyyy-mm-dd
  retention_until: string | null;            // yyyy-mm-dd
  status: EvidenceStatus;
  linked_control_ids: string[];
  linked_risk_ids: string[];                 // uuid[]
  linked_treatment_ids: string[];            // uuid[]
  linked_dr_plan_ids: string[];              // uuid[]
  linked_ir_playbook_ids: string[];          // uuid[]
  linked_incident_ids: string[];             // uuid[]
  linked_policy_doc_ids: string[];           // uuid[]
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface RiskTreatment {
  id: string;
  risk_id: string;
  tenant_id: string;
  action: string;
  detail: string | null;
  status: RiskTreatmentStatus;
  owner: string | null;
  due_date: string | null;             // yyyy-mm-dd
  completed_at: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}

export interface IrPlaybook {
  id: string;
  tenant_id: string;
  name: string;
  category: string;                          // 'bec' | 'ransomware' | 'phishing' | …
  severity_default: IrPlaybookSeverity;
  description: string | null;
  trigger_conditions: string | null;
  detection_sources: string[];
  containment_steps: string[];
  eradication_steps: string[];
  recovery_steps: string[];
  communications_plan: IrCommunicationsEntry[];
  escalation_contacts: IrEscalationContact[];
  evidence_to_preserve: string[];
  regulatory_notifications: IrRegulatoryNotification[];
  linked_control_ids: string[];
  last_reviewed: string | null;              // yyyy-mm-dd
  last_tabletop: string | null;              // yyyy-mm-dd
  next_review_due: string | null;            // yyyy-mm-dd
  status: IrPlaybookStatus;
  created_at: string;
  updated_at: string;
}
