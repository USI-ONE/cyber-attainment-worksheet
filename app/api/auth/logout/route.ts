import { NextResponse, type NextRequest } from 'next/server';
import { destroyCurrentSession, getCurrentUser } from '@/lib/auth';

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
