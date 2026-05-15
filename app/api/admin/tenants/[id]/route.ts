import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audit, getCurrentUser, isPlatformAdmin } from '@/lib/auth';

/**
 * PATCH  /api/admin/tenants/[id]   update display_name / hostname /
 *                                  brand_config (slug is immutable —
 *                                  changing it would break tenant routing).
 */
export const dynamic = 'force-dynamic';

function bad(msg: string, code = 400) { return NextResponse.json({ error: msg }, { status: code }); }

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const cu = await getCurrentUser();
  if (!isPlatformAdmin(cu)) return bad('platform admin required', 403);

  let body: {
    display_name?: string;
    hostname?: string;
    brand_config?: Record<string, unknown>;
    is_admin_tenant?: boolean;
  };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const patch: Record<string, unknown> = {};
  if (typeof body.display_name === 'string') {
    const t = body.display_name.trim();
    if (!t) return bad('display_name cannot be empty');
    patch.display_name = t;
  }
  if ('hostname' in body) patch.hostname = body.hostname?.trim() || null;
  if (body.brand_config && typeof body.brand_config === 'object') patch.brand_config = body.brand_config;
  if (typeof body.is_admin_tenant === 'boolean') patch.is_admin_tenant = body.is_admin_tenant;

  if (Object.keys(patch).length === 0) return bad('no patchable fields');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('tenants')
    .update(patch)
    .eq('id', params.id)
    .select('*')
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('tenant not found', 404);

  await audit({
    actor_id: cu!.user.id, tenant_id: params.id, action: 'tenant_updated',
    detail: { fields: Object.keys(patch) },
  });

  return NextResponse.json({ ok: true, tenant: data });
}
