import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import {
  audit, canAdministerTenant, generateTempPassword, getCurrentUser,
  hashPassword, isPlatformAdmin, issueInvite,
} from '@/lib/auth';
import { sendEmail, isEmailConfigured } from '@/lib/email';
import { renderInviteEmail, renderPasswordResetEmail } from '@/lib/email-templates';

/**
 * POST /api/settings/users/[user_id]/reset-password
 *
 * Tenant-scoped admin password reset. The acting user must canAdminister
 * this tenant AND the target user must be a member of this tenant (or
 * the actor must be a platform admin). Otherwise tenant editors could
 * use this endpoint to reset passwords for users in other tenants.
 *
 * Behavior matches /api/admin/users/[id]/reset-password — two methods:
 *   method='temp_password' → generate temp, return cleartext, email same
 *   method='email_link'    → issue forgot-password-style reset link, email it
 */
export const dynamic = 'force-dynamic';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

export async function POST(request: NextRequest, { params }: { params: { user_id: string } }) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');

  const cu = await getCurrentUser();
  if (!canAdministerTenant(cu, tenant.id)) return bad('not authorized', 403);

  const supabase = createServiceRoleClient();
  const { data: user } = await supabase
    .from('profiles')
    .select('id, email, display_name, is_platform_admin, status')
    .eq('id', params.user_id)
    .maybeSingle();
  if (!user) return bad('user not found', 404);
  if (user.status === 'disabled') return bad('user is disabled', 400);

  // Tenant scope: target must be a member of THIS tenant unless the actor
  // is a platform admin (who can reach any user from any deploy).
  if (!isPlatformAdmin(cu)) {
    const { data: mem } = await supabase
      .from('memberships')
      .select('user_id')
      .eq('tenant_id', tenant.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!mem) return bad('user is not a member of this tenant', 403);
  }

  let body: { method?: 'temp_password' | 'email_link' };
  try { body = await request.json(); } catch { body = {}; }
  const method = body.method === 'email_link' ? 'email_link' : 'temp_password';

  const ip = request.headers.get('x-forwarded-for') ?? null;
  const ua = request.headers.get('user-agent') ?? null;
  const now = new Date().toISOString();
  const tenantHost = tenant.hostname || `caw-${tenant.slug}.vercel.app`;

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

    let email_sent = false;
    if (isEmailConfigured()) {
      const { subject, html, text } = renderInviteEmail({
        signInUrl: `https://${tenantHost}/auth/signin`,
        email: user.email,
        tempPassword,
        tenantName: tenant.display_name,
        role: null,
        isPlatformAdmin: false,
        inviterName: cu!.user.display_name ?? cu!.user.email,
      });
      const res = await sendEmail({
        to: user.email, subject, html, text,
        tags: [
          { name: 'kind', value: 'password_reset' },
          { name: 'method', value: 'temp_password' },
          { name: 'tenant', value: tenant.slug },
        ],
      });
      email_sent = res.sent;
    }

    await audit({
      actor_id: cu!.user.id, target_id: user.id, tenant_id: tenant.id,
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
  await supabase
    .from('user_invites')
    .update({ revoked_at: now })
    .ilike('email', user.email)
    .is('accepted_at', null)
    .is('revoked_at', null);

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
    tenant_id: tenant.id,
    role: null,
    grant_platform_admin: user.is_platform_admin,
    supabase,
  });

  const resetUrl = `https://${tenantHost}/auth/accept-invite?token=${token}`;

  let email_sent = false;
  if (isEmailConfigured()) {
    const { subject, html, text } = renderPasswordResetEmail({
      resetUrl, email: user.email,
    });
    const res = await sendEmail({
      to: user.email, subject, html, text,
      tags: [
        { name: 'kind', value: 'password_reset' },
        { name: 'method', value: 'email_link' },
        { name: 'tenant', value: tenant.slug },
      ],
    });
    email_sent = res.sent;
  } else {
    console.warn(`[settings reset-password] no email integration; reset URL for ${user.email}: ${resetUrl}`);
  }

  await audit({
    actor_id: cu!.user.id, target_id: user.id, tenant_id: tenant.id,
    action: 'password_reset_admin',
    detail: { email: user.email, method: 'email_link' },
    ip, user_agent: ua,
  });

  return NextResponse.json({
    ok: true,
    method: 'email_link',
    email: user.email,
    reset_url: resetUrl,
    email_sent,
  });
}
