import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audit, createSessionForUser, verifyPassword } from '@/lib/auth';

/**
 * POST /api/auth/login
 * Body: { email, password }
 * On success: sets the session cookie (via createSessionForUser) and returns
 *   { ok: true, user: {...}, redirect: string }.
 * On failure: returns { error } with 401. Failed attempts are audited so
 *   abusive accounts surface in audit_log_user.
 */
export const dynamic = 'force-dynamic';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string; redirect?: string };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const email = (body.email ?? '').trim().toLowerCase();
  const password = body.password ?? '';
  if (!email || !password) return bad('email and password are required');

  const supabase = createServiceRoleClient();
  const { data: user } = await supabase
    .from('profiles')
    .select('id, email, display_name, password_hash, is_platform_admin, status')
    .ilike('email', email)
    .maybeSingle();

  const ip = request.headers.get('x-forwarded-for') ?? null;
  const ua = request.headers.get('user-agent') ?? null;

  if (!user || user.status !== 'active' || !user.password_hash) {
    await audit({
      action: 'login_fail',
      detail: { email, reason: !user ? 'not_found' : user.status !== 'active' ? 'inactive' : 'no_password' },
      ip, user_agent: ua,
    });
    return bad('invalid credentials', 401);
  }

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    await audit({
      target_id: user.id, action: 'login_fail',
      detail: { email, reason: 'bad_password' },
      ip, user_agent: ua,
    });
    return bad('invalid credentials', 401);
  }

  await createSessionForUser(user.id, { user_agent: ua, ip }, supabase);
  await audit({
    actor_id: user.id, target_id: user.id, action: 'login_success',
    detail: { email },
    ip, user_agent: ua,
  });

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id, email: user.email, display_name: user.display_name,
      is_platform_admin: user.is_platform_admin,
    },
    redirect: body.redirect && body.redirect.startsWith('/') ? body.redirect : '/',
  });
}
