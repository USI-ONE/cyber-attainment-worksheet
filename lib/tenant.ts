import { createServiceRoleClient } from '@/lib/supabase/server';
import type { Tenant } from '@/lib/supabase/types';

/**
 * Resolve which tenant this request is for.
 *
 * Priority:
 *  1. TENANT_SLUG env var (set per-Vercel-project; pins the deployment to one tenant).
 *  2. Hostname match against `tenants.hostname` column.
 *
 * Uses the service-role client because tenant identity is deployment metadata,
 * not user-scoped data. RLS on the `tenants` table requires a membership, so a
 * user signing in for the first time would otherwise be unable to load the
 * page they just authenticated to. The service-role client is server-side only
 * and only used to fetch the public tenant row (slug, hostname, branding).
 */
export async function resolveTenant(host?: string): Promise<Tenant | null> {
  const supabase = createServiceRoleClient();
  const envSlug = process.env.TENANT_SLUG?.trim();

  if (envSlug) {
    const { data, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('slug', envSlug)
      .maybeSingle();
    if (error) {
      console.error('resolveTenant: env slug lookup failed', { envSlug, error });
      return null;
    }
    return data as Tenant | null;
  }

  if (host) {
    const { data, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('hostname', host)
      .maybeSingle();
    if (error) {
      console.error('resolveTenant: hostname lookup failed', { host, error });
      return null;
    }
    return data as Tenant | null;
  }

  return null;
}
