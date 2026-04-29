import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

/**
 * TEMPORARY: diagnostic endpoint. Reports presence (not values) of the env
 * vars resolveTenant depends on, plus the result of the tenant lookup.
 * Delete this file once auth is restored.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const envReport = {
    TENANT_SLUG: process.env.TENANT_SLUG ? `len=${process.env.TENANT_SLUG.length}` : 'MISSING',
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL
      ? process.env.NEXT_PUBLIC_SUPABASE_URL
      : 'MISSING',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      ? `len=${process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.length}`
      : 'MISSING',
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY
      ? `len=${process.env.SUPABASE_SECRET_KEY.length}`
      : 'MISSING',
  };

  let tenantQuery: unknown = 'not attempted';
  if (process.env.SUPABASE_SECRET_KEY && process.env.TENANT_SLUG) {
    try {
      const sb = createServiceRoleClient();
      const { data, error } = await sb
        .from('tenants')
        .select('slug, display_name')
        .eq('slug', process.env.TENANT_SLUG.trim())
        .maybeSingle();
      tenantQuery = error ? { error: error.message, code: error.code } : { data };
    } catch (e) {
      tenantQuery = { threw: e instanceof Error ? e.message : String(e) };
    }
  }

  return NextResponse.json({ env: envReport, tenantQuery });
}
