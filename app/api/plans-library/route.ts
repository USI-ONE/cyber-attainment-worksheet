import { NextResponse, type NextRequest } from 'next/server';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser, canAccessTenant } from '@/lib/auth';

/**
 * GET /api/plans-library
 *
 * Returns the platform-wide plans catalog joined with the current
 * tenant's per-plan state. Any member of the tenant can read. Writes
 * go through PATCH /api/plans-library/[code] which requires
 * canEditTenant.
 */
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const host = req.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 404 });

  const cu = await getCurrentUser();
  if (!canAccessTenant(cu, tenant.id)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const sb = createServiceRoleClient();
  const [{ data: catalog, error: cErr }, { data: states, error: sErr }] = await Promise.all([
    sb.from('plans_library_catalog').select('*').order('sort_order'),
    sb.from('tenant_plans').select('*').eq('tenant_id', tenant.id),
  ]);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  const stateByCode = new Map<string, unknown>(
    (states ?? []).map((s) => [(s as { plan_code: string }).plan_code, s]),
  );
  const items = (catalog ?? []).map((c) => ({
    ...c,
    state: stateByCode.get((c as { code: string }).code) ?? null,
  }));
  return NextResponse.json({ items });
}
