// Hand-written DB types for the tables we use. Replace with `supabase gen types` later if desired.

export type MembershipRole = 'editor' | 'viewer';

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

export interface AssessmentResponse {
  tenant_id: string;
  framework_version_id: string;
  control_id: string;
  q1_documented: AssessmentAnswer | null;
  q2_followed:   AssessmentAnswer | null;
  q3_measured:   AssessmentAnswer | null;
  q4_improvement: string | null;
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
