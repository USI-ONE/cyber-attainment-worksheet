import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  audit, getCurrentUser, isPlatformAdmin, issueInvite,
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

  // Pre-create a profile row in 'invited' state (so memberships can FK to
  // it on acceptance). Skip if one already exists for this email.
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .ilike('email', email)
    .maybeSingle();
  if (!existing) {
    await supabase.from('profiles').insert({
      email,
      display_name: body.display_name?.trim() || null,
      status: 'invited',
      invited_by: cu!.user.id,
      invited_at: new Date().toISOString(),
    });
  }

  const { token, invite } = await issueInvite({
    email,
    invited_by: cu!.user.id,
    tenant_id: tenantId,
    role,
    grant_platform_admin: grantPlatform,
    supabase,
  });

  await audit({
    actor_id: cu!.user.id,
    tenant_id: tenantId,
    action: 'invite_issued',
    detail: {
      email, role, grant_platform_admin: grantPlatform,
      invite_id: invite.id,
    },
  });

  // Compose the accept URL with the right host:
  //   - tenant-scoped invite WITHOUT platform admin → tenant deploy host
  //     (so the invitee's session lands where their role applies)
  //   - platform-admin invite (with or without a tenant) → null, client
  //     falls back to window.location.origin which is the operator hub
  //     in practice — exactly where a platform admin wants their session
  const accept_url_path = `/auth/accept-invite?token=${token}`;
  const accept_url = (tenantHost && !grantPlatform)
    ? `https://${tenantHost}${accept_url_path}`
    : null;

  // Resolve the tenant display name once for the email body. We don't pull
  // it inside the .insert chain above because we needed the FK validation
  // result; reuse the existing supabase client.
  let tenantName: string | null = null;
  if (tenantId) {
    const { data: t } = await supabase
      .from('tenants').select('display_name').eq('id', tenantId).maybeSingle();
    tenantName = (t as { display_name: string } | null)?.display_name ?? null;
  }

  // Build the URL we'll put in the email. Prefer the tenant-scoped URL
  // when this is a tenant-only invite; for platform-admin invites fall
  // back to the operator hub, which is where the inviter is acting from.
  const requestOrigin = `https://${request.headers.get('host') ?? 'caw-portfolio-hub.vercel.app'}`;
  const emailUrl = accept_url ?? `${requestOrigin}${accept_url_path}`;

  // Send the invite email if the integration is configured. The DB write
  // already succeeded; an email failure should NOT fail this request —
  // the inviter can fall back to copy/pasting the URL from the response.
  let email_sent = false;
  if (isEmailConfigured()) {
    const { subject, html, text } = renderInviteEmail({
      inviteUrl: emailUrl,
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
    invite: { id: invite.id, email, tenant_id: tenantId, role, grant_platform_admin: grantPlatform, expires_at: invite.expires_at },
    invite_token: token,
    accept_url_path,
    accept_url,
    email_sent,
  });
}
