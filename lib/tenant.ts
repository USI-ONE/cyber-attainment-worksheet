import { createClient } from '@/lib/supabase/server';
import type { Tenant } from '@/lib/supabase/types';

/**
 * Resolve which tenant this request is for.
 *
 * Priority:
 *  1. TENANT_SLUG env var (set per-Vercel-project; pins the deployment to one tenant).
 *  2. Hostname match against `tenants.hostname` column.
 *
 * In local dev, set TENANT_SLUG in .env.local to whichever tenant you're working on.
 */
export async function resolveTenant(host?: string): Promise<Tenant | null> {
  const supabase = createClient();
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
