import { createServiceRoleClient } from '@/lib/supabase/server';
import type { FrameworkDefinition, FrameworkVersion, Tenant } from '@/lib/supabase/types';

/**
 * Load the active framework version for this tenant.
 *
 * Service-role client: tenant_frameworks rows are deployment metadata. A user
 * without a membership still needs the framework loaded to render the chrome
 * and (later) the access-denied banner. RLS on tenant_frameworks would
 * otherwise hide this row from a not-yet-granted user.
 *
 * Phase 1: returns the first active framework. A future switcher (multi-
 * framework tenants) will list all rows.
 */
export async function loadActiveFramework(tenant: Tenant): Promise<{
  version: FrameworkVersion;
  definition: FrameworkDefinition;
} | null> {
  const supabase = createServiceRoleClient();
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
