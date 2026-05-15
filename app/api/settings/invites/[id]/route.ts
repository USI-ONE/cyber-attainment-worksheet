import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { audit, canAdministerTenant, getCurrentUser, isPlatformAdmin } from '@/lib/auth';

/**
 * DELETE /api/settings/invites/[id]
 *
 * Tenant-scoped invite revoke. Same idea as /api/admin/invites/[id] but
 * limited to invites that belong to the current tenant. Available to any
 * user who canAdministerTenant() this tenant (editors + platform admins).
 */
export const dynamic = 'force-dynamic';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');

  const cu = await getCurrentUser();
  if (!canAdministerTenant(cu, tenant.id)) return bad('not authorized', 403);

  const supabase = createServiceRoleClient();
  const { data: existing } = await supabase
    .from('user_invites')
    .select('id, email, tenant_id, role, grant_platform_admin, revoked_at, accepted_at')
    .eq('id', params.id)
    .maybeSingle();
  if (!existing) return bad('invite not found', 404);

  // Tenant admin can only revoke invites for their own tenant. Platform
  // admin can revoke any invite (and they have /api/admin/invites available
  // too, but this endpoint stays open to them so the UI doesn't need to
  // pick a route based on role).
  if (existing.tenant_id !== tenant.id && !isPlatformAdmin(cu)) {
    return bad('invite belongs to another tenant', 403);
  }
  if (existing.revoked_at || existing.accepted_at) {
    return bad('invite already finalized', 409);
  }

  await supabase
    .from('user_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', params.id);

  await audit({
    actor_id: cu!.user.id,
    tenant_id: tenant.id,
    action: 'invite_revoked',
    detail: {
      email: existing.email,
      role: existing.role,
      grant_platform_admin: existing.grant_platform_admin,
      invite_id: existing.id,
      by_platform_admin: isPlatformAdmin(cu),
    },
  });

  return NextResponse.json({ ok: true, invite_id: existing.id });
}
