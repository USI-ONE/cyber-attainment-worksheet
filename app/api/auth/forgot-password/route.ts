import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audit, hashToken, issueInvite } from '@/lib/auth';
import { sendEmail, isEmailConfigured } from '@/lib/email';
import { renderPasswordResetEmail } from '@/lib/email-templates';

/**
 * POST /api/auth/forgot-password   Body: { email }
 *
 * Always returns 200 with { ok: true } regardless of whether the email
 * exists. That's the right behavior — leaking "this account exists / does
 * not" via the response is a classic enumeration vulnerability. If the
 * email DOES exist:
 *   1. Revoke any pending invites for that email.
 *   2. Clear password_hash + flip status='invited' on the profile, so
 *      the only path back in is the new invite.
 *   3. Revoke every active session so a stolen browser tab gets kicked.
 *   4. Issue a fresh invite token, preserving the user's existing
 *      platform-admin grant (the invite re-grants what they already had).
 *   5. Send the reset email if Resend is configured.
 *
 * If the email does NOT exist, the request is silently a no-op (still
 * returns 200, audit logs an attempt for visibility).
 *
 * No rate limiting here yet. If abuse becomes real, add per-IP and
 * per-email throttling at the edge or via a simple in-DB counter.
 */
export const dynamic = 'force-dynamic';

function ok() {
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  let body: { email?: string };
  try { body = await request.json(); } catch { return ok(); }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    // Still return 200 — don't leak validation logic to a probe.
    return ok();
  }

  const ip = request.headers.get('x-forwarded-for') ?? null;
  const ua = request.headers.get('user-agent') ?? null;

  const supabase = createServiceRoleClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, is_platform_admin, status')
    .ilike('email', email)
    .maybeSingle();

  if (!profile) {
    // Account doesn't exist. Audit the attempt without revealing.
    await audit({
      action: 'password_reset_requested',
      detail: { email, found: false },
      ip, user_agent: ua,
    });
    return ok();
  }

  // 1. Revoke any pending invites for this email. Issuing a new one below
  //    supersedes them anyway, but explicit revoke keeps user_invites tidy.
  await supabase
    .from('user_invites')
    .update({ revoked_at: new Date().toISOString() })
    .ilike('email', email)
    .is('accepted_at', null)
    .is('revoked_at', null);

  // 2. Issue the reset token. NOTE: we do NOT clear the current
  //    password_hash here. Previously this route would null the hash +
  //    revoke sessions immediately on request — that turned the endpoint
  //    into a lockout primitive (anyone who knows your email could lock
  //    you out repeatedly). The hash is now cleared and sessions revoked
  //    only when the user actually consumes the reset link in
  //    /api/auth/accept-invite, proving they control the inbox.
  const { token } = await issueInvite({
    email: profile.email,
    invited_by: null,           // self-service, no inviter
    tenant_id: null,
    role: null,
    grant_platform_admin: profile.is_platform_admin,
    supabase,
  });

  // 4. Compose the URL on the deploy that received this request — keeps
  //    the session cookie scoped to the same origin the user is using.
  const requestOrigin = `https://${request.headers.get('host') ?? ''}`;
  const resetUrl = `${requestOrigin}/auth/accept-invite?token=${token}`;

  // 5. Send the email if configured.
  if (isEmailConfigured()) {
    const { subject, html, text } = renderPasswordResetEmail({
      resetUrl, email: profile.email,
    });
    await sendEmail({
      to: profile.email, subject, html, text,
      tags: [{ name: 'kind', value: 'password_reset' }],
    });
  } else {
    // Configuration not present. Log only that we'd-have-sent and the token
    // hash, NOT the cleartext URL — anyone with deploy log access could
    // otherwise hijack a reset by reading the log line.
    console.warn(`[forgot-password] no email integration; reset queued for ${profile.email} (token_hash=${hashToken(token).slice(0, 12)})`);
  }

  await audit({
    target_id: profile.id,
    action: 'password_reset_requested',
    detail: { email: profile.email, found: true },
    ip, user_agent: ua,
  });

  return ok();
}
