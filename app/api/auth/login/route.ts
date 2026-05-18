import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audit, createSessionForUser, verifyPassword } from '@/lib/auth';
import { MUST_CHANGE_COOKIE_NAME, SESSION_TTL_DAYS } from '@/lib/auth-shared';

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
    .select('id, email, display_name, password_hash, is_platform_admin, status, password_must_change')
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
    detail: { email, must_change_password: !!user.password_must_change },
    ip, user_agent: ua,
  });

  // Redirect logic:
  //   - If the user MUST change their password (admin issued a temp-password
  //     invite), force them to /auth/change-password regardless of what
  //     they originally tried to reach. The page itself bounces back to
  //     `redirect` after a successful change.
  //   - Otherwise, honor the redirect they passed in (defaulting to /).
  // Open-redirect guard. body.redirect.startsWith('/') is necessary but not
  // sufficient — '//evil.com' also starts with '/' and would resolve as a
  // protocol-relative URL to an external host. Reject anything that isn't
  // an unambiguous same-origin path: starts with '/', but NOT '//' and NOT
  // '/\\' (the latter is how some browsers normalize backslashes into
  // protocol-relative). Also enforce a sane length cap.
  const rawRedirect = typeof body.redirect === 'string' ? body.redirect : '';
  const requestedRedirect = (
    rawRedirect.startsWith('/') &&
    !rawRedirect.startsWith('//') &&
    !rawRedirect.startsWith('/\\') &&
    rawRedirect.length <= 1024
  ) ? rawRedirect : '/';
  const mustChange = !!user.password_must_change;
  const redirect = mustChange
    ? `/auth/change-password?next=${encodeURIComponent(requestedRedirect)}`
    : requestedRedirect;

  // Set the middleware gate cookie when forced password change is required.
  // HttpOnly so the browser can't read or tamper from JS; SameSite=Lax so
  // it travels on the post-login redirect; same TTL as the session itself
  // (irrelevant in practice since /api/me/password clears it on success).
  if (mustChange) {
    cookies().set({
      name: MUST_CHANGE_COOKIE_NAME,
      value: '1',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
    });
  } else {
    // Defensive: if a stale cookie is laying around (e.g., the admin
    // cleared the flag in the DB out-of-band), make sure middleware
    // doesn't keep bouncing the user.
    cookies().delete(MUST_CHANGE_COOKIE_NAME);
  }

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id, email: user.email, display_name: user.display_name,
      is_platform_admin: user.is_platform_admin,
    },
    password_must_change: mustChange,
    redirect,
  });
}
