import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import {
  audit, canAdministerTenant, getCurrentUser, isPlatformAdmin, issueInvite,
} from '@/lib/auth';
import { sendEmail, isEmailConfigured } from '@/lib/email';
import { renderInviteEmail } from '@/lib/email-templates';

/**
 * Tenant-scoped user management — for tenant admins (= editors today) to
 * manage their own tenant's members. Platform admins can use this same
 * endpoint on any tenant deploy.
 *
 * GET  /api/settings/users    list users with a membership in THIS tenant
 *                             + pending invites for THIS tenant
 * POST /api/settings/users    invite a user to THIS tenant (with the given
 *                             role). Returns the cleartext invite token for
 *                             the inviter to send manually.
 */
export const dynamic = 'force-dynamic';

function bad(msg: string, code = 400) { return NextResponse.json({ error: msg }, { status: code }); }

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');

  const cu = await getCurrentUser();
  if (!canAdministerTenant(cu, tenant.id)) return bad('not authorized', 403);

  const supabase = createServiceRoleClient();
  const { data: mems } = await supabase
    .from('memberships')
    .select('user_id, role, created_at')
    .eq('tenant_id', tenant.id);

  const userIds = (mems ?? []).map((m) => (m as { user_id: string }).user_id);
  const usersById: Record<string, unknown> = {};
  if (userIds.length > 0) {
    const { data: us } = await supabase
      .from('profiles')
      .select('id, email, display_name, status, last_login_at, is_platform_admin')
      .in('id', userIds);
    for (const u of (us ?? []) as { id: string }[]) usersById[u.id] = u;
  }

  const members = (mems ?? []).map((m) => {
    const mm = m as { user_id: string; role: string; created_at: string };
    return { ...mm, user: usersById[mm.user_id] ?? null };
  });

  const { data: invites } = await supabase
    .from('user_invites')
    .select('id, email, role, expires_at, created_at, invited_by')
    .eq('tenant_id', tenant.id)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  return NextResponse.json({ members, pending_invites: invites ?? [] });
}

export async function POST(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');

  const cu = await getCurrentUser();
  if (!canAdministerTenant(cu, tenant.id)) return bad('not authorized', 403);

  let body: { email?: string; role?: string; display_name?: string };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const email = (body.email ?? '').trim();
  if (!email || !email.includes('@')) return bad('valid email required');
  if (body.role !== 'editor' && body.role !== 'viewer') return bad('role must be editor or viewer');

  const supabase = createServiceRoleClient();

  // Pre-create a profile row in 'invited' state if not already known.
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
    tenant_id: tenant.id,
    role: body.role,
    grant_platform_admin: false,
    supabase,
  });

  await audit({
    actor_id: cu!.user.id, tenant_id: tenant.id, action: 'invite_issued',
    detail: { email, role: body.role, by_platform_admin: isPlatformAdmin(cu) },
  });

  // Construct an explicit tenant-deploy URL. /settings/users is already
  // executing on a tenant deploy, so window.location.origin would do the
  // right thing — but if the tenant has a custom hostname configured
  // (different from the Vercel default), prefer that. Falls back to the
  // standard caw-<slug>.vercel.app if no custom hostname is set.
  const tenantHost = tenant.hostname || `caw-${tenant.slug}.vercel.app`;
  const accept_url_path = `/auth/accept-invite?token=${token}`;
  const accept_url = `https://${tenantHost}${accept_url_path}`;

  // Send the invite email if Resend is configured. Failure to send does
  // NOT fail the request — the URL is still surfaced in the response so
  // the inviter can fall back to copy/paste.
  let email_sent = false;
  if (isEmailConfigured()) {
    const { subject, html, text } = renderInviteEmail({
      inviteUrl: accept_url,
      tenantName: tenant.display_name,
      role: body.role,
      isPlatformAdmin: false,
      inviterName: cu!.user.display_name ?? cu!.user.email,
    });
    const res = await sendEmail({
      to: email, subject, html, text,
      tags: [{ name: 'kind', value: 'invite' }, { name: 'tenant', value: tenant.slug }],
    });
    email_sent = res.sent;
  }

  return NextResponse.json({
    ok: true,
    invite: { id: invite.id, email, role: body.role, expires_at: invite.expires_at },
    invite_token: token,
    accept_url_path,
    accept_url,
    email_sent,
  });
}
