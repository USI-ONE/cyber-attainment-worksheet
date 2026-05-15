import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import {
  audit, canAdministerTenant, generateTempPassword, getCurrentUser,
  hashPassword, isPlatformAdmin,
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

  // Temp-password invite flow — same shape as /api/admin/users POST, but
  // bound to THIS tenant and locked to non-platform-admin grants.
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

  // Apply the membership for this tenant. Upsert so re-invites with a
  // changed role take effect.
  await supabase.from('memberships').upsert({
    user_id: userId,
    tenant_id: tenant.id,
    role: body.role,
  }, { onConflict: 'user_id,tenant_id' });

  await audit({
    actor_id: cu!.user.id,
    target_id: userId,
    tenant_id: tenant.id,
    action: 'invite_issued',
    detail: {
      email,
      role: body.role,
      by_platform_admin: isPlatformAdmin(cu),
      flow: 'temp_password',
    },
  });

  const tenantHost = tenant.hostname || `caw-${tenant.slug}.vercel.app`;
  const signInUrl = `https://${tenantHost}/auth/signin`;

  let email_sent = false;
  if (isEmailConfigured()) {
    const { subject, html, text } = renderInviteEmail({
      signInUrl,
      email,
      tempPassword,
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
    user_id: userId,
    email,
    role: body.role,
    temp_password: tempPassword,
    sign_in_url: signInUrl,
    email_sent,
  });
}
