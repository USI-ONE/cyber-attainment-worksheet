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
