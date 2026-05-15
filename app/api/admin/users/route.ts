import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  audit, generateTempPassword, getCurrentUser, hashPassword,
  isPlatformAdmin,
} from '@/lib/auth';
import { sendEmail, isEmailConfigured } from '@/lib/email';
import { renderInviteEmail } from '@/lib/email-templates';

/**
 * GET    /api/admin/users          list every profile + their memberships
 *                                  (platform-admin only)
 * POST   /api/admin/users          create / invite a user. Body:
 *                                    { email, display_name?, grant_platform_admin?,
 *                                      tenant_id?, role? }
 *                                  Returns the cleartext token in `invite_token`
 *                                  so the inviter can copy + send manually
 *                                  (no email service wired yet).
 */
export const dynamic = 'force-dynamic';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

export async function GET() {
  const cu = await getCurrentUser();
  if (!isPlatformAdmin(cu)) return bad('platform admin required', 403);

  const supabase = createServiceRoleClient();
  const [usersRes, membershipsRes, invitesRes] = await Promise.all([
    supabase.from('profiles')
      .select('id, email, display_name, is_platform_admin, status, last_login_at, created_at, updated_at, invited_at')
      .order('created_at', { ascending: true }),
    supabase.from('memberships')
      .select('user_id, tenant_id, role, created_at'),
    supabase.from('user_invites')
      .select('id, email, tenant_id, role, grant_platform_admin, expires_at, accepted_at, revoked_at, created_at')
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }),
  ]);

  return NextResponse.json({
    users:       usersRes.data ?? [],
    memberships: membershipsRes.data ?? [],
    pending_invites: invitesRes.data ?? [],
  });
}

export async function POST(request: NextRequest) {
  const cu = await getCurrentUser();
  if (!isPlatformAdmin(cu)) return bad('platform admin required', 403);

  let body: {
    email?: string; display_name?: string;
    grant_platform_admin?: boolean;
    tenant_id?: string | null;
    role?: 'editor' | 'viewer';
  };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const email = (body.email ?? '').trim();
  if (!email || !email.includes('@')) return bad('valid email required');

  const grantPlatform = !!body.grant_platform_admin;
  const tenantId = body.tenant_id || null;
  const role: 'editor' | 'viewer' | null =
    body.role === 'editor' || body.role === 'viewer' ? body.role : null;

  if (tenantId && !role) return bad('role required when tenant_id is set');
  if (!tenantId && !grantPlatform) return bad('must grant platform_admin or assign a tenant + role');

  const supabase = createServiceRoleClient();

  // Sanity check the tenant exists, and capture its hostname so we can
  // return an accept URL pointed at the tenant deploy (not the operator
  // hub the platform admin is inviting from). The session cookie is
  // deploy-scoped, so the invitee needs to land their session on the
  // deploy they'll actually use.
  let tenantHost: string | null = null;
  if (tenantId) {
    const { data: t } = await supabase
      .from('tenants')
      .select('id, slug, hostname')
      .eq('id', tenantId)
      .maybeSingle();
    if (!t) return bad('tenant not found', 404);
    tenantHost = t.hostname || `caw-${t.slug}.vercel.app`;
  }

  // Temp-password invite flow:
  //
  //   1. Generate a strong one-time password (14 chars, mixed-class, no
  //      l/I/1/0/O confusables — see generateTempPassword in lib/auth).
  //   2. Hash it with the same scrypt routine as a real password.
  //   3. Upsert the profile with status='active' (so login works immediately),
  //      password_hash set, and password_must_change=true so the user gets
  //      forced to /auth/change-password on first login.
  //   4. Apply the membership / platform-admin grant right now — there's no
  //      separate "accept" step in this flow.
  //   5. Email the user the temp credentials so they can sign in. The admin
  //      also gets the temp password back in the response for read-aloud /
  //      copy-paste situations.
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);
  const now = new Date().toISOString();

  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .ilike('email', email)
    .maybeSingle();

  let userId: string;
  if (!existing) {
    const { data: inserted, error: insErr } = await supabase
      .from('profiles')
      .insert({
        email,
        display_name: body.display_name?.trim() || null,
        status: 'active',
        password_hash: passwordHash,
        password_must_change: true,
        password_changed_at: now,
        invited_by: cu!.user.id,
        invited_at: now,
      })
      .select('id')
      .single();
    if (insErr || !inserted) return bad(insErr?.message ?? 'profile insert failed', 500);
    userId = inserted.id;
  } else {
    // Existing user: replace the password with the temp one and force a
    // change. Re-issuing a temp password is the operator's "reset this
    // user's credentials" path — equivalent to forgot-password but
    // initiated by an admin.
    userId = existing.id;
    const updates: Record<string, unknown> = {
      password_hash: passwordHash,
      password_must_change: true,
      password_changed_at: now,
      status: 'active',
    };
    if (body.display_name?.trim()) updates.display_name = body.display_name.trim();
    await supabase.from('profiles').update(updates).eq('id', userId);
  }

  // Apply the platform-admin grant if requested.
  if (grantPlatform) {
    await supabase.from('profiles').update({ is_platform_admin: true }).eq('id', userId);
  }

  // Apply the tenant membership if specified. ON CONFLICT updates the role
  // so re-inviting an existing user with a new role works as expected.
  if (tenantId && role) {
    await supabase.from('memberships').upsert({
      user_id: userId,
      tenant_id: tenantId,
      role,
    }, { onConflict: 'user_id,tenant_id' });
  }

  await audit({
    actor_id: cu!.user.id,
    target_id: userId,
    tenant_id: tenantId,
    action: 'invite_issued',
    detail: {
      email, role, grant_platform_admin: grantPlatform,
      flow: 'temp_password',
    },
  });

  // Resolve the tenant display name once for the email body.
  let tenantName: string | null = null;
  if (tenantId) {
    const { data: t } = await supabase
      .from('tenants').select('display_name').eq('id', tenantId).maybeSingle();
    tenantName = (t as { display_name: string } | null)?.display_name ?? null;
  }

  // Build the sign-in URL we put in the email. Tenant-scoped invite without
  // platform admin → tenant deploy. Platform admin → operator hub (request
  // origin). The user's session is set when they sign in on that origin.
  const signInPath = '/auth/signin';
  const requestOrigin = `https://${request.headers.get('host') ?? 'caw-portfolio-hub.vercel.app'}`;
  const signInUrl = (tenantHost && !grantPlatform)
    ? `https://${tenantHost}${signInPath}`
    : `${requestOrigin}${signInPath}`;

  let email_sent = false;
  if (isEmailConfigured()) {
    const { subject, html, text } = renderInviteEmail({
      signInUrl,
      email,
      tempPassword,
      tenantName,
      role,
      isPlatformAdmin: grantPlatform,
      inviterName: cu!.user.display_name ?? cu!.user.email,
    });
    const res = await sendEmail({
      to: email, subject, html, text,
      tags: [{ name: 'kind', value: 'invite' }],
    });
    email_sent = res.sent;
  }

  return NextResponse.json({
    ok: true,
    user_id: userId,
    email,
    tenant_id: tenantId,
    role,
    grant_platform_admin: grantPlatform,
    // Cleartext temp password — return so the admin can read it aloud / paste
    // into a chat if the email doesn't make it through. Returned only on
    // this single response; never persisted in plaintext.
    temp_password: tempPassword,
    sign_in_url: signInUrl,
    email_sent,
  });
}
