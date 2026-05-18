import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { audit, createSessionForUser, hashToken } from '@/lib/auth';

/**
 * GET /auth/sso?token=<plaintext>
 *
 * Tenant-side handler that consumes a one-time SSO token minted by
 * /api/hub/sso/issue on the hub. Successful exchange:
 *   1. Hashes the incoming token, looks up the matching sso_tokens row.
 *   2. Validates: not used, not expired, tenant matches the hostname we
 *      resolved for THIS request (defense against a leaked token being
 *      replayed against the wrong tenant deploy).
 *   3. Marks the row used_at = now() so the same URL can't be reused.
 *   4. Creates a tenant-scoped session for the user via createSessionForUser
 *      (which writes a sessions row + sets the cookie on this origin).
 *   5. Redirects to the row's target_path (defaults to /).
 *
 * Failure modes redirect to /auth/signin?reason=... so the user has a way
 * forward — the signin page can read the reason query param later to show a
 * helpful "your link expired" hint.
 */
export const dynamic = 'force-dynamic';

function fail(request: NextRequest, reason: string) {
  // Redirect to the local signin page with a reason hint. The signin form
  // can surface this later; for now it at least lands the user somewhere
  // sensible instead of a bare 401 JSON.
  const url = new URL('/auth/signin', request.url);
  url.searchParams.set('reason', reason);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return fail(request, 'missing_token');

  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return fail(request, 'no_tenant');

  const supabase = createServiceRoleClient();
  const token_hash = hashToken(token);

  // Atomic burn: read+write in a single UPDATE filtered on (token_hash
  // matches AND used_at is still null AND not expired AND tenant matches).
  // If two GETs race, only one will get a row back here — the second sees
  // empty data and bounces to /auth/signin with reason=token_already_used.
  // The previous read-then-write pattern allowed both concurrent callers
  // to pass the validate-then-burn check before either UPDATE landed.
  const nowIso = new Date().toISOString();
  const { data: burned } = await supabase
    .from('sso_tokens')
    .update({ used_at: nowIso })
    .eq('token_hash', token_hash)
    .eq('tenant_id', tenant.id)
    .is('used_at', null)
    .gt('expires_at', nowIso)
    .select('id, user_id, target_path')
    .maybeSingle();

  if (!burned) {
    // We don't know which precondition failed (token unknown, already used,
    // expired, or wrong tenant) without a second query, but for SSO failure
    // surface a single bucket — the user just needs to sign in again. Avoid
    // a fingerprinting query that would tell an attacker whether the token
    // existed at all.
    return fail(request, 'sso_token_invalid');
  }

  // Confirm the user is still active. Disabled accounts shouldn't be
  // re-authenticated even with a freshly-burnt valid token.
  const { data: user } = await supabase
    .from('profiles')
    .select('id, status, password_must_change')
    .eq('id', burned.user_id)
    .maybeSingle();
  if (!user) return fail(request, 'user_not_found');
  if (user.status !== 'active') return fail(request, 'user_disabled');

  const ip = request.headers.get('x-forwarded-for') ?? null;
  const ua = request.headers.get('user-agent') ?? null;

  // Mint a session for the user on this tenant origin. createSessionForUser
  // writes a sessions row + sets the cookie. The cookie is scoped to the
  // current request's origin via Next's cookies() — so caw-<slug>.vercel.app
  // gets its own session cookie, separate from the hub's.
  await createSessionForUser(user.id, { user_agent: ua, ip }, supabase);

  await audit({
    actor_id: user.id, target_id: user.id, tenant_id: tenant.id,
    action: 'sso_login',
    detail: { tenant_slug: tenant.slug, target_path: burned.target_path },
    ip, user_agent: ua,
  });

  // Re-validate target_path on consume. It was sanitized on issue, but
  // defense-in-depth: reject anything that isn't a same-origin path
  // (starts with "/" but not "//", which would be a protocol-relative URL
  // that could redirect to an attacker domain).
  let target = burned.target_path ?? '/';
  if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//')) {
    target = '/';
  }
  if (user.password_must_change) target = '/auth/change-password';
  return NextResponse.redirect(new URL(target, request.url));
}
