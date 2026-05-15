import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  audit, generateTempPassword, getCurrentUser, hashPassword, isPlatformAdmin,
  issueInvite,
} from '@/lib/auth';
import { sendEmail, isEmailConfigured } from '@/lib/email';
import { renderInviteEmail, renderPasswordResetEmail } from '@/lib/email-templates';

/**
 * POST /api/admin/users/[id]/reset-password
 *
 * Admin-initiated password reset for an existing user. Two methods:
 *
 *   1. method='temp_password' (the default)
 *      Generate a fresh 14-char temp password, hash it, set
 *      profiles.password_must_change=true, and revoke every active session
 *      for the user. Returns the cleartext password in the response so the
 *      admin can read it to the user (and emails the same credentials if
 *      the email service is wired up).
 *
 *   2. method='email_link'
 *      Issue a one-time accept-invite-style reset token via the existing
 *      issueInvite helper, clear the user's password, set status='invited',
 *      and send a reset email with the link. Equivalent to the user
 *      hitting /auth/forgot-password themselves, but admin-initiated and
 *      not gated by anti-enumeration (we already know who to reset).
 *
 * Both methods revoke every active session for the user, so any device
 * the user is signed in on gets kicked.
 *
 * Platform-admin only.
 */
export const dynamic = 'force-dynamic';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const cu = await getCurrentUser();
  if (!isPlatformAdmin(cu)) return bad('platform admin required', 403);

  let body: { method?: 'temp_password' | 'email_link' };
  try { body = await request.json(); } catch { body = {}; }
  const method = body.method === 'email_link' ? 'email_link' : 'temp_password';

  const supabase = createServiceRoleClient();
  const { data: user } = await supabase
    .from('profiles')
    .select('id, email, display_name, is_platform_admin, status')
    .eq('id', params.id)
    .maybeSingle();
  if (!user) return bad('user not found', 404);
  if (user.status === 'disabled') {
    return bad('user is disabled; re-enable before resetting their password', 400);
  }

  const ip = request.headers.get('x-forwarded-for') ?? null;
  const ua = request.headers.get('user-agent') ?? null;
  const now = new Date().toISOString();

  // Always revoke active sessions on either method — the password is
  // effectively rotated and any device the user is on shouldn't keep its
  // pre-reset session token.
  await supabase
    .from('sessions')
    .update({ revoked_at: now })
    .eq('user_id', user.id)
    .is('revoked_at', null);

  if (method === 'temp_password') {
    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);

    const { error: upErr } = await supabase
      .from('profiles')
      .update({
        password_hash: passwordHash,
        password_must_change: true,
        password_changed_at: now,
        status: 'active',
      })
      .eq('id', user.id);
    if (upErr) return bad(upErr.message, 500);

    // Email the same credentials when email is wired up. We reuse the
    // invite-email shell because the content is identical: "your account
    // is ready, here's your temp password, sign in".
    let email_sent = false;
    if (isEmailConfigured()) {
      // For an admin-initiated reset the sign-in URL is the request origin
      // by default (admin is acting on the hub); if there's no membership
      // we can't reasonably pick a tenant URL, so use the request host.
      const requestOrigin = `https://${request.headers.get('host') ?? 'caw-portfolio-hub.vercel.app'}`;
      const { subject, html, text } = renderInviteEmail({
        signInUrl: `${requestOrigin}/auth/signin`,
        email: user.email,
        tempPassword,
        tenantName: null,
        role: null,
        isPlatformAdmin: user.is_platform_admin,
        inviterName: cu!.user.display_name ?? cu!.user.email,
      });
      const res = await sendEmail({
        to: user.email, subject, html, text,
        tags: [{ name: 'kind', value: 'password_reset' }, { name: 'method', value: 'temp_password' }],
      });
      email_sent = res.sent;
    }

    await audit({
      actor_id: cu!.user.id,
      target_id: user.id,
      action: 'password_reset_admin',
      detail: { email: user.email, method: 'temp_password' },
      ip, user_agent: ua,
    });

    return NextResponse.json({
      ok: true,
      method: 'temp_password',
      email: user.email,
      temp_password: tempPassword,
      email_sent,
    });
  }

  // method === 'email_link'
  // Revoke any in-flight invite tokens before issuing a fresh one, so the
  // user can't be confused by stale links and the most recent one always
  // wins.
  await supabase
    .from('user_invites')
    .update({ revoked_at: now })
    .ilike('email', user.email)
    .is('accepted_at', null)
    .is('revoked_at', null);

  // Clear password + flip status so the only path back in is the new link.
  await supabase
    .from('profiles')
    .update({
      password_hash: null,
      password_must_change: false,
      status: 'invited',
    })
    .eq('id', user.id);

  const { token } = await issueInvite({
    email: user.email,
    invited_by: cu!.user.id,
    tenant_id: null,
    role: null,
    grant_platform_admin: user.is_platform_admin,
    supabase,
  });

  const requestOrigin = `https://${request.headers.get('host') ?? 'caw-portfolio-hub.vercel.app'}`;
  const resetUrl = `${requestOrigin}/auth/accept-invite?token=${token}`;

  let email_sent = false;
  if (isEmailConfigured()) {
    const { subject, html, text } = renderPasswordResetEmail({
      resetUrl, email: user.email,
    });
    const res = await sendEmail({
      to: user.email, subject, html, text,
      tags: [{ name: 'kind', value: 'password_reset' }, { name: 'method', value: 'email_link' }],
    });
    email_sent = res.sent;
  } else {
    console.warn(`[admin reset-password] no email integration; reset URL for ${user.email}: ${resetUrl}`);
  }

  await audit({
    actor_id: cu!.user.id,
    target_id: user.id,
    action: 'password_reset_admin',
    detail: { email: user.email, method: 'email_link' },
    ip, user_agent: ua,
  });

  return NextResponse.json({
    ok: true,
    method: 'email_link',
    email: user.email,
    reset_url: resetUrl,  // surfaced so the admin can copy/paste if email fails
    email_sent,
  });
}
