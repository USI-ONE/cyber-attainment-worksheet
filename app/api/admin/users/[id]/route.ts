import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audit, getCurrentUser, isPlatformAdmin } from '@/lib/auth';

/**
 * GET    /api/admin/users/[id]   one user + memberships
 * PATCH  /api/admin/users/[id]   update display_name / status /
 *                                is_platform_admin
 * DELETE /api/admin/users/[id]   set status='disabled' + revoke all sessions
 *                                (does not delete the row — keeps audit
 *                                history intact)
 */
export const dynamic = 'force-dynamic';

function bad(msg: string, code = 400) { return NextResponse.json({ error: msg }, { status: code }); }

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const cu = await getCurrentUser();
  if (!isPlatformAdmin(cu)) return bad('platform admin required', 403);

  const supabase = createServiceRoleClient();
  const { data: user } = await supabase
    .from('profiles')
    .select('id, email, display_name, is_platform_admin, status, last_login_at, created_at, updated_at, invited_at')
    .eq('id', params.id)
    .maybeSingle();
  if (!user) return bad('user not found', 404);

  const { data: memberships } = await supabase
    .from('memberships')
    .select('user_id, tenant_id, role, created_at')
    .eq('user_id', params.id);

  return NextResponse.json({ user, memberships: memberships ?? [] });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const cu = await getCurrentUser();
  if (!isPlatformAdmin(cu)) return bad('platform admin required', 403);

  let body: { display_name?: string; status?: string; is_platform_admin?: boolean };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const patch: Record<string, unknown> = {};
  if ('display_name' in body) patch.display_name = body.display_name?.toString().trim() || null;
  if (typeof body.is_platform_admin === 'boolean') patch.is_platform_admin = body.is_platform_admin;
  if (typeof body.status === 'string') {
    if (!['active', 'disabled', 'invited'].includes(body.status)) return bad('invalid status');
    patch.status = body.status;
  }
  if (Object.keys(patch).length === 0) return bad('no patchable fields');

  // Guardrail: a platform admin cannot strip their own platform-admin flag —
  // that's how we avoid locking the platform out by accident.
  if (params.id === cu!.user.id && patch.is_platform_admin === false) {
    return bad('cannot revoke your own platform_admin flag', 400);
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', params.id)
    .select('id, email, display_name, is_platform_admin, status, last_login_at, created_at, updated_at')
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('user not found', 404);

  // If status flipped to disabled, revoke every active session so the user
  // is kicked off immediately, not at the next cookie expiry.
  if (patch.status === 'disabled') {
    await supabase
      .from('sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', params.id)
      .is('revoked_at', null);
  }

  if ('is_platform_admin' in patch) {
    await audit({
      actor_id: cu!.user.id, target_id: params.id,
      action: patch.is_platform_admin ? 'platform_admin_granted' : 'platform_admin_revoked',
      detail: { email: data.email },
    });
  }
  if (patch.status) {
    await audit({
      actor_id: cu!.user.id, target_id: params.id,
      action: patch.status === 'disabled' ? 'user_disabled' : 'user_status_changed',
      detail: { status: patch.status, email: data.email },
    });
  }

  return NextResponse.json({ ok: true, user: data });
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const cu = await getCurrentUser();
  if (!isPlatformAdmin(cu)) return bad('platform admin required', 403);
  if (params.id === cu!.user.id) return bad('cannot disable yourself', 400);

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('profiles')
    .update({ status: 'disabled' })
    .eq('id', params.id)
    .select('id, email')
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('user not found', 404);

  await supabase
    .from('sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', params.id)
    .is('revoked_at', null);

  await audit({
    actor_id: cu!.user.id, target_id: params.id,
    action: 'user_disabled', detail: { email: data.email },
  });
  return NextResponse.json({ ok: true });
}
