import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import type { AssessmentResponse } from '@/lib/supabase/types';

/**
 * GET /api/assessment — list all assessment responses for the current tenant
 *   on the active framework. Used by the landing page to compute progress
 *   and show per-control status.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant resolved' }, { status: 400 });

  const fw = await loadActiveFramework(tenant);
  if (!fw) return NextResponse.json({ error: 'no active framework' }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('assessment_responses')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('framework_version_id', fw.version.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ responses: (data ?? []) as AssessmentResponse[] });
}
