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

  const { data: row } = await supabase
    .from('sso_tokens')
    .select('id, user_id, tenant_id, target_path, expires_at, used_at')
    .eq('token_hash', token_hash)
    .maybeSingle();
  if (!row) return fail(request, 'invalid_token');
  if (row.used_at) return fail(request, 'token_already_used');
  if (new Date(row.expires_at).getTime() < Date.now()) return fail(request, 'token_expired');
  if (row.tenant_id !== tenant.id) return fail(request, 'tenant_mismatch');

  // Confirm the user is still active before minting a session — a disabled
  // account shouldn't be re-authenticated even if a fresh token is in flight.
  const { data: user } = await supabase
    .from('profiles')
    .select('id, status, password_must_change')
    .eq('id', row.user_id)
    .maybeSingle();
  if (!user) return fail(request, 'user_not_found');
  if (user.status !== 'active') return fail(request, 'user_disabled');

  // Burn the token first so a network retry or back-button can't reuse it.
  // We're inside the service role so a fast double-tap will see used_at set.
  await supabase
    .from('sso_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id);

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
    detail: { tenant_slug: tenant.slug, target_path: row.target_path },
    ip, user_agent: ua,
  });

  // If the user is in "must change password" state, route them to the
  // change-password page first; middleware would do this anyway on the
  // next request, but a direct redirect saves the round-trip.
  const target = user.password_must_change ? '/auth/change-password' : (row.target_path ?? '/');
  return NextResponse.redirect(new URL(target, request.url));
}
