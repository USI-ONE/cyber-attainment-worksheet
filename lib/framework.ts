import { createClient } from '@/lib/supabase/server';
import type { FrameworkDefinition, FrameworkVersion, Tenant } from '@/lib/supabase/types';

/**
 * Load the active framework version(s) for this tenant.
 * Phase 1: returns the first one (most tenants have just NIST CSF 2.0).
 * Phase 2+: surface a switcher when a tenant has multiple active frameworks.
 */
export async function loadActiveFramework(tenant: Tenant): Promise<{
  version: FrameworkVersion;
  definition: FrameworkDefinition;
} | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('tenant_frameworks')
    .select('framework_version_id, framework_versions(*)')
    .eq('tenant_id', tenant.id)
    .limit(1);

  if (error) {
    console.error('loadActiveFramework: tenant_frameworks query failed', error);
    return null;
  }
  if (!data || data.length === 0) return null;

  const fv = data[0].framework_versions as unknown as FrameworkVersion;
  if (!fv) return null;
  return { version: fv, definition: fv.definition };
}
