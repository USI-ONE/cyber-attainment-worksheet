import { NextResponse, type NextRequest } from 'next/server';
import { destroyCurrentSession } from '@/lib/auth';

/**
 * Legacy /api/auth/signout — kept for backwards compatibility with the old
 * SignOutButton form action. Delegates to the standalone session destroy
 * helper from lib/auth and redirects to /auth/signin. New code should call
 * /api/auth/logout directly.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  await destroyCurrentSession();
  return NextResponse.redirect(new URL('/auth/signin', request.url), 303);
}
