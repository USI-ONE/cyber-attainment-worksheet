/**
 * Write-side authorization guards for API routes.
 *
 * Until this module existed, every write endpoint resolved the tenant from
 * the hostname and ran the operation through the service-role Supabase
 * client — meaning a signed-in viewer could call POST / PATCH / DELETE and
 * the server happily wrote. The auth foundation (5f26863) gated PAGE
 * navigation but never reached the API surface.
 *
 * Each write endpoint now calls `requireEditAccess(request)` at the top.
 * On success it returns { tenant, currentUser } and the route proceeds.
 * On failure it returns a NextResponse with the correct status code — the
 * route returns it verbatim. Idiom:
 *
 *     const auth = await requireEditAccess(request);
 *     if (auth instanceof NextResponse) return auth;
 *     const { tenant, currentUser } = auth;
 *
 * Behavior matrix for requireEditAccess:
 *
 *   AUTH_REQUIRED | session    | role             | result
 *   --------------|------------|------------------|---------------------------
 *   any           | platform   | (any)            | allow
 *   any           | editor     | this tenant      | allow
 *   any           | viewer     | this tenant      | 403 (the bug fix)
 *   any           | signed in  | no membership    | 403
 *   true          | none       | n/a              | 401
 *   false         | none       | n/a              | allow (rollout-mode legacy)
 *
 * The AUTH_REQUIRED=false branch preserves anonymous behavior during the
 * rollout phase so we don't break tenant deploys that haven't enforced
 * auth yet. Once every deploy has AUTH_REQUIRED=true, that branch becomes
 * dead and signed-in is mandatory for writes everywhere.
 *
 * requireViewAccess is the read-side variant: it allows signed-in users
 * with any membership for the tenant (or platform admins) and falls back
 * to anonymous when AUTH_REQUIRED=false. Use it sparingly — most GET
 * handlers don't call it because the platform's read posture is open
 * within the tenant.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { resolveTenant } from '@/lib/tenant';
import { canAccessTenant, canEditTenant, getCurrentUser, type CurrentUser } from '@/lib/auth';
import type { Tenant } from '@/lib/supabase/types';

export interface AuthContext {
  tenant: Tenant;
  currentUser: CurrentUser | null;
}

function bad(msg: string, code: number) {
  return NextResponse.json({ error: msg }, { status: code });
}

export async function requireEditAccess(
  request: NextRequest,
): Promise<AuthContext | NextResponse> {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved', 400);

  const currentUser = await getCurrentUser();
  const authRequired = process.env.AUTH_REQUIRED === 'true';

  if (!currentUser) {
    if (authRequired) return bad('authentication required', 401);
    // Loose mode: pre-auth behavior preserved during rollout.
    return { tenant, currentUser: null };
  }

  if (!canEditTenant(currentUser, tenant.id)) {
    return bad('editor role required for this tenant', 403);
  }
  return { tenant, currentUser };
}

export async function requireViewAccess(
  request: NextRequest,
): Promise<AuthContext | NextResponse> {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved', 400);

  const currentUser = await getCurrentUser();
  const authRequired = process.env.AUTH_REQUIRED === 'true';

  if (!currentUser) {
    if (authRequired) return bad('authentication required', 401);
    return { tenant, currentUser: null };
  }

  if (!canAccessTenant(currentUser, tenant.id)) {
    return bad('no access to this tenant', 403);
  }
  return { tenant, currentUser };
}
