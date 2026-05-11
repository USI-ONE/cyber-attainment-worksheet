import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audit, getCurrentUser, isPlatformAdmin } from '@/lib/auth';

/**
 * POST   /api/admin/users/[id]/memberships
 *   Body: { tenant_id, role: 'editor' | 'viewer' }
 *   Upserts a membership row. Platform admin only.
 *
 * DELETE /api/admin/users/[id]/memberships?tenant_id=…
 *   Removes the membership for (user, tenant). Platform admin only.
 */
export const dynamic = 'force-dynamic';

function bad(msg: string, code = 400) { return NextResponse.json({ error: msg }, { status: code }); }

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const cu = await getCurrentUser();
  if (!isPlatformAdmin(cu)) return bad('platform admin required', 403);

  let body: { tenant_id?: string; role?: string };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  if (!body.tenant_id) return bad('tenant_id required');
  if (body.role !== 'editor' && body.role !== 'viewer') return bad('role must be editor or viewer');

  const supabase = createServiceRoleClient();

  const { data: t } = await supabase.from('tenants').select('id').eq('id', body.tenant_id).maybeSingle();
  if (!t) return bad('tenant not found', 404);
  const { data: u } = await supabase.from('profiles').select('id, email').eq('id', params.id).maybeSingle();
  if (!u) return bad('user not found', 404);

  const { data, error } = await supabase
    .from('memberships')
    .upsert({ user_id: params.id, tenant_id: body.tenant_id, role: body.role }, { onConflict: 'user_id,tenant_id' })
    .select('*')
    .single();
  if (error) return bad(error.message, 500);

  await audit({
    actor_id: cu!.user.id, target_id: params.id, tenant_id: body.tenant_id,
    action: 'role_changed',
    detail: { role: body.role, email: u.email },
  });

  return NextResponse.json({ ok: true, membership: data });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const cu = await getCurrentUser();
  if (!isPlatformAdmin(cu)) return bad('platform admin required', 403);

  const tenant_id = new URL(request.url).searchParams.get('tenant_id');
  if (!tenant_id) return bad('tenant_id required');

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('memberships')
    .delete()
    .eq('user_id', params.id)
    .eq('tenant_id', tenant_id);
  if (error) return bad(error.message, 500);

  await audit({
    actor_id: cu!.user.id, target_id: params.id, tenant_id,
    action: 'membership_removed',
  });

  return NextResponse.json({ ok: true });
}
