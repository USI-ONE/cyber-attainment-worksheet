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
