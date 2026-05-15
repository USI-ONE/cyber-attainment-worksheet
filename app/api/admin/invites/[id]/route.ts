import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audit, getCurrentUser, isPlatformAdmin } from '@/lib/auth';

/**
 * DELETE /api/admin/invites/[id]
 *
 * Revoke a pending invite. Sets user_invites.revoked_at on the row so any
 * outstanding accept-invite URL stops working. We don't physically delete
 * the row — keeping it preserves the audit trail (who invited whom, when),
 * and the existing "pending" filter on the user list (accepted_at is null
 * AND revoked_at is null AND expires_at > now()) already hides revoked rows.
 *
 * Idempotent: revoking an already-revoked invite is a no-op.
 * Platform-admin only.
 */
export const dynamic = 'force-dynamic';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const cu = await getCurrentUser();
  if (!isPlatformAdmin(cu)) return bad('platform admin required', 403);

  const supabase = createServiceRoleClient();
  const { data: invite, error } = await supabase
    .from('user_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', params.id)
    .is('revoked_at', null)
    .select('id, email, tenant_id, role, grant_platform_admin')
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!invite) {
    // Either no such invite, or it's already revoked / accepted. Surface as
    // 404 so the UI knows to refresh; not 200, since a stale UI revoking a
    // no-longer-listed invite is a hint something else is off.
    return bad('invite not found or already finalized', 404);
  }

  await audit({
    actor_id: cu!.user.id,
    tenant_id: invite.tenant_id,
    action: 'invite_revoked',
    detail: {
      email: invite.email,
      role: invite.role,
      grant_platform_admin: invite.grant_platform_admin,
      invite_id: invite.id,
    },
  });

  return NextResponse.json({ ok: true, invite_id: invite.id });
}
