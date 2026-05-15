import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { destroyCurrentSession, getCurrentUser } from '@/lib/auth';
import { MUST_CHANGE_COOKIE_NAME } from '@/lib/auth-shared';

/**
 * POST /api/auth/logout — revoke the current session (if any) and clear the
 * cookie. Always returns 303 → /auth/signin so the browser navigates to the
 * sign-in page after the form submit.
 *
 * GET kept as an alias for browser navigations (e.g. SignOutButton). Both
 * methods do the same thing.
 */
export const dynamic = 'force-dynamic';

async function doLogout(request: NextRequest) {
  await destroyCurrentSession();
  // Always clear the must-change cookie on logout. Otherwise a user whose
  // session ended mid-change-flow would re-enter at /auth/signin and find
  // themselves trapped in the force-change loop with no session to satisfy.
  cookies().delete(MUST_CHANGE_COOKIE_NAME);
  return NextResponse.redirect(new URL('/auth/signin', request.url), 303);
}

export async function POST(request: NextRequest) { return doLogout(request); }
export async function GET(request: NextRequest) {
  // Slight extra: only allow GET-as-logout if there IS a session — defends
  // against trivial CSRF-like GET that would log a user out unexpectedly.
  const cu = await getCurrentUser();
  if (!cu) return NextResponse.redirect(new URL('/auth/signin', request.url), 303);
  return doLogout(request);
}
