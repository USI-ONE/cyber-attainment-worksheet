import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { audit, canAdministerTenant, getCurrentUser } from '@/lib/auth';

/**
 * PATCH  /api/settings/users/[user_id]   body: { role: 'editor' | 'viewer' | 'admin' }
 *                                        change a member's role IN THIS tenant.
 *                                        role='admin' on a tenant flagged
 *                                        is_admin_tenant=true grants the user
 *                                        platform-wide admin access.
 * DELETE /api/settings/users/[user_id]   remove user from THIS tenant
 *                                        (their profile and other-tenant
 *                                        memberships are untouched)
 *
 * Platform admins can use this on any tenant deploy via canAdministerTenant.
 */
export const dynamic = 'force-dynamic';

const VALID_ROLES = new Set(['editor', 'viewer', 'admin']);

function bad(msg: string, code = 400) { return NextResponse.json({ error: msg }, { status: code }); }

export async function PATCH(request: NextRequest, { params }: { params: { user_id: string } }) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');

  const cu = await getCurrentUser();
  if (!canAdministerTenant(cu, tenant.id)) return bad('not authorized', 403);

  let body: { role?: string };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  if (!body.role || !VALID_ROLES.has(body.role)) {
    return bad('role must be editor, viewer, or admin');
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('memberships')
    .update({ role: body.role })
    .eq('user_id', params.user_id)
    .eq('tenant_id', tenant.id)
    .select('*')
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('membership not found', 404);

  await audit({
    actor_id: cu!.user.id, target_id: params.user_id, tenant_id: tenant.id,
    action: 'role_changed', detail: { role: body.role },
  });

  return NextResponse.json({ ok: true, membership: data });
}

export async function DELETE(_request: NextRequest, { params }: { params: { user_id: string } }) {
  const host = _request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');

  const cu = await getCurrentUser();
  if (!canAdministerTenant(cu, tenant.id)) return bad('not authorized', 403);

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('memberships')
    .delete()
    .eq('user_id', params.user_id)
    .eq('tenant_id', tenant.id);
  if (error) return bad(error.message, 500);

  await audit({
    actor_id: cu!.user.id, target_id: params.user_id, tenant_id: tenant.id,
    action: 'membership_removed',
  });

  return NextResponse.json({ ok: true });
}
