import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  audit, canAccessTenant, generateToken, getCurrentUser, hashToken,
} from '@/lib/auth';

/**
 * POST /api/hub/sso/issue
 *
 * Hub-side endpoint that mints a one-time, 60-second SSO token bound to
 * (current user, target tenant). Used by the "My Tenants" picker on
 * the operator hub so a user can click into a tenant deploy without
 * re-entering their password — the tenant deploy's GET /auth/sso handler
 * exchanges the token for a tenant-scoped session cookie.
 *
 * Authorization: the current user must canAccessTenant() the target
 * (platform admin OR a tenant member). Non-members can't mint a token
 * for tenants they have no business reaching.
 *
 * Lives under /api/hub/ but works on any deploy with OPERATOR_MODE=true.
 *
 * Body: { tenant_id: string, target_path?: string }
 * Response: { ok: true, redirect_url: "https://caw-<slug>.vercel.app/auth/sso?token=..." }
 */
export const dynamic = 'force-dynamic';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

const TTL_SECONDS = 60;

export async function POST(request: NextRequest) {
  const cu = await getCurrentUser();
  if (!cu) return bad('authentication required', 401);

  let body: { tenant_id?: string; target_path?: string };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  const tenantId = body.tenant_id?.toString();
  if (!tenantId) return bad('tenant_id required');

  // Light path validation — keep the redirect tightly scoped to in-app
  // pages. Reject anything that isn't a path or could be a protocol-
  // relative URL.
  let targetPath = (body.target_path ?? '/').toString();
  if (!targetPath.startsWith('/') || targetPath.startsWith('//')) {
    targetPath = '/';
  }

  if (!canAccessTenant(cu, tenantId)) {
    return bad('no access to this tenant', 403);
  }

  const supabase = createServiceRoleClient();
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, slug, hostname, display_name')
    .eq('id', tenantId)
    .maybeSingle();
  if (!tenant) return bad('tenant not found', 404);

  const token = generateToken();
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();

  const ip = request.headers.get('x-forwarded-for') ?? null;
  const ua = request.headers.get('user-agent') ?? null;

  const { error } = await supabase.from('sso_tokens').insert({
    user_id: cu.user.id,
    tenant_id: tenant.id,
    token_hash: hashToken(token),
    target_path: targetPath,
    expires_at: expiresAt,
    ip, user_agent: ua,
  });
  if (error) return bad(error.message, 500);

  // Build the redirect URL pointed at the tenant deploy. Prefer the
  // tenants.hostname field, fall back to caw-<slug>.vercel.app to match the
  // platform's deploy-naming convention.
  const tenantHost = tenant.hostname || `caw-${tenant.slug}.vercel.app`;
  const redirectUrl = `https://${tenantHost}/auth/sso?token=${encodeURIComponent(token)}`;

  await audit({
    actor_id: cu.user.id,
    target_id: cu.user.id,
    tenant_id: tenant.id,
    action: 'sso_token_issued',
    detail: { tenant_slug: tenant.slug, target_path: targetPath },
    ip, user_agent: ua,
  });

  return NextResponse.json({
    ok: true,
    redirect_url: redirectUrl,
    tenant_slug: tenant.slug,
    tenant_display_name: tenant.display_name,
  });
}
