import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { destroyCurrentSession } from '@/lib/auth';
import { MUST_CHANGE_COOKIE_NAME } from '@/lib/auth-shared';

/**
 * POST /api/auth/logout — revoke the current session (if any) and clear
 * the cookie. Always returns 303 → /auth/signin so the browser navigates
 * to the sign-in page after the form submit.
 *
 * Previously this route also accepted GET (so a plain <a href> could log
 * the user out). That made cross-site logout-griefing possible: an
 * <img src="https://hub/api/auth/logout"> embedded on any third-party
 * page would log the user out next time they visited it. SignOutButton
 * already POSTs (it's a <form method="post">), so dropping GET costs
 * nothing in real UX and closes the griefing vector.
 *
 * Imports kept for backward-compat: getCurrentUser was referenced by the
 * previous GET handler — now unused.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  await destroyCurrentSession();
  // Always clear the must-change cookie on logout. Otherwise a user whose
  // session ended mid-change-flow would re-enter at /auth/signin and find
  // themselves trapped in the force-change loop with no session to satisfy.
  cookies().delete(MUST_CHANGE_COOKIE_NAME);
  return NextResponse.redirect(new URL('/auth/signin', request.url), 303);
}

