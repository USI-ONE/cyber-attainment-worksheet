import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  audit, createSessionForUser, findValidInvite, hashPassword, hashToken,
} from '@/lib/auth';
import { sendEmail, isEmailConfigured } from '@/lib/email';
import { renderWelcomeEmail } from '@/lib/email-templates';

/**
 * POST /api/auth/accept-invite
 * Body: { token, password, display_name? }
 *
 * Finds the invite by token, marks it accepted, ensures a profile row exists
 * for the email (creating it if necessary), sets the password, applies the
 * platform-admin / tenant membership grants the invite carried, then
 * starts a session and returns the redirect target.
 *
 * GET is also provided so the /auth/accept-invite page can validate the
 * token before showing the password form (so the user doesn't type a
 * password against a dead link).
 */
export const dynamic = 'force-dynamic';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get('token') ?? '';
  const invite = await findValidInvite(token);
  if (!invite) return bad('invalid or expired invite', 404);
  return NextResponse.json({
    ok: true,
    email: invite.email,
    grants: {
      platform_admin: invite.grant_platform_admin,
      tenant_id: invite.tenant_id,
      role: invite.role,
    },
  });
}

export async function POST(request: NextRequest) {
  let body: { token?: string; password?: string; display_name?: string };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const token = body.token ?? '';
  const password = body.password ?? '';
  if (!token) return bad('token is required');
  if (password.length < 12) return bad('password must be at least 12 characters');

  const supabase = createServiceRoleClient();
  const invite = await findValidInvite(token, supabase);
  if (!invite) return bad('invalid or expired invite', 404);

  const ip = request.headers.get('x-forwarded-for') ?? null;
  const ua = request.headers.get('user-agent') ?? null;

  // 1. Hash the password.
  const password_hash = await hashPassword(password);

  // 2. Find or create the profile row for this email.
  const emailLower = invite.email.trim().toLowerCase();
  const { data: existing } = await supabase
    .from('profiles')
    .select('id, status, is_platform_admin, display_name')
    .ilike('email', emailLower)
    .maybeSingle();

  let userId: string;
  if (existing) {
    userId = existing.id;
    const update: Record<string, unknown> = {
      password_hash,
      password_changed_at: new Date().toISOString(),
      status: 'active',
    };
    if (body.display_name && !existing.display_name) update.display_name = body.display_name.trim();
    if (invite.grant_platform_admin) update.is_platform_admin = true;
    await supabase.from('profiles').update(update).eq('id', userId);
  } else {
    const { data: created, error } = await supabase
      .from('profiles')
      .insert({
        email: invite.email,
        display_name: (body.display_name ?? '').trim() || null,
        password_hash,
        password_changed_at: new Date().toISOString(),
        is_platform_admin: invite.grant_platform_admin,
        status: 'active',
        invited_by: invite.invited_by,
        invited_at: invite.created_at,
      })
      .select('id')
      .single();
    if (error || !created) return bad(error?.message ?? 'profile create failed', 500);
    userId = created.id;
  }

  // 3. Apply tenant membership if the invite carried one.
  if (invite.tenant_id && invite.role) {
    await supabase
      .from('memberships')
      .upsert({
        user_id: userId,
        tenant_id: invite.tenant_id,
        role: invite.role,
      }, { onConflict: 'user_id,tenant_id' });
  }

  // 4. Mark the invite consumed.
  await supabase
    .from('user_invites')
    .update({ accepted_at: new Date().toISOString(), accepted_by: userId })
    .eq('token_hash', hashToken(token));

  // 5. Revoke all existing sessions for this user BEFORE minting a new
  //    one. Two scenarios where this matters:
  //      a) Reset flow — the user's old password just got replaced; any
  //         pre-reset session is no longer trusted.
  //      b) Invite hijack — if a reset link was intercepted, the
  //         attacker shouldn't get to coexist with the legitimate user's
  //         session indefinitely. Revoking forces every other device to
  //         re-authenticate with the new credential.
  //    The new session created on line below is still valid because
  //    sessions are filtered on token_hash + revoked_at IS NULL by
  //    getCurrentUserByToken, and we revoke BEFORE create.
  await supabase
    .from('sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('revoked_at', null);

  // 6. Start a session for the user who just consumed the invite.
  await createSessionForUser(userId, { user_agent: ua, ip }, supabase);

  await audit({
    actor_id: userId, target_id: userId,
    tenant_id: invite.tenant_id,
    action: 'invite_accepted',
    detail: {
      email: invite.email,
      grant_platform_admin: invite.grant_platform_admin,
      role: invite.role,
    },
    ip, user_agent: ua,
  });

  // 6. Welcome email. Best-effort; failure doesn't fail the request
  //    (the user is already signed in). Skipped when Resend isn't
  //    configured — see lib/email.ts module docblock.
  if (isEmailConfigured()) {
    let tenantName: string | null = null;
    if (invite.tenant_id) {
      const { data: t } = await supabase
        .from('tenants').select('display_name').eq('id', invite.tenant_id).maybeSingle();
      tenantName = (t as { display_name: string } | null)?.display_name ?? null;
    }
    const requestOrigin = `https://${request.headers.get('host') ?? ''}`;
    const { subject, html, text } = renderWelcomeEmail({
      displayName: body.display_name ?? null,
      tenantName,
      isPlatformAdmin: invite.grant_platform_admin,
      signInUrl: `${requestOrigin}/`,
    });
    await sendEmail({
      to: invite.email, subject, html, text,
      tags: [{ name: 'kind', value: 'welcome' }],
    });
  }

  return NextResponse.json({ ok: true, redirect: '/' });
}
