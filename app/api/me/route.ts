import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';

/**
 * GET /api/me — returns the current signed-in user (with memberships)
 * or { user: null } if no session. Used by client components that need
 * to know who's logged in without prop-drilling.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const cu = await getCurrentUser();
  if (!cu) return NextResponse.json({ user: null });
  return NextResponse.json({
    user: cu.user,
    memberships: cu.memberships,
    session_expires_at: cu.session_expires_at,
  });
}
