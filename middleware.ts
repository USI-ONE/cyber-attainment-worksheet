import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth';

/**
 * Auth gating middleware. Three classes of routes:
 *
 *   PUBLIC               /auth/*, /api/auth/*, /_next/*, /favicon.ico, /api/health
 *                        — always allowed, never redirected.
 *
 *   ALWAYS-PROTECTED     /admin/*, /api/admin/*, /settings/*, /api/settings/*
 *                        — must have a session cookie; missing cookie =>
 *                        redirect to /auth/signin. (Role enforcement runs
 *                        inside the route — middleware only checks "has a
 *                        cookie that *might* be valid.")
 *
 *   FLAGGED              everything else
 *                        — controlled by the AUTH_REQUIRED env var. When
 *                        AUTH_REQUIRED=true on the deploy, this category
 *                        also requires a session cookie. When false (default
 *                        during rollout), anonymous access is allowed and
 *                        the page renders against the service-role client
 *                        like it did before user management existed.
 *
 * The cookie's mere presence is not proof of validity — a stale or revoked
 * token still passes this check. That's intentional: middleware runs at
 * the edge with minimal DB access. Every server component and API route
 * that needs a real identity calls lib/auth#getCurrentUser, which validates
 * the session against the DB. The middleware is a cheap pre-filter.
 */

const PUBLIC_PATHS = [
  '/auth/',
  '/api/auth/',
  '/api/health',
  '/favicon.ico',
];

const ALWAYS_PROTECTED_PREFIXES = [
  '/admin/',
  '/api/admin/',
  '/settings/',
  '/api/settings/',
];

function isPublic(pathname: string): boolean {
  if (pathname === '/auth' || pathname === '/auth/') return true;
  for (const p of PUBLIC_PATHS) if (pathname.startsWith(p)) return true;
  // Next.js internals and static assets — _next is excluded via matcher
  // already, but be defensive.
  if (pathname.startsWith('/_next/')) return true;
  return false;
}

function isAlwaysProtected(pathname: string): boolean {
  for (const p of ALWAYS_PROTECTED_PREFIXES) {
    if (pathname.startsWith(p)) return true;
  }
  // Also treat the literal /admin and /settings (no trailing slash) as
  // protected — Next can serve either form depending on rewrite config.
  if (pathname === '/admin' || pathname === '/settings') return true;
  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const hasCookie = !!request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authRequired = process.env.AUTH_REQUIRED === 'true';
  const mustHaveSession = isAlwaysProtected(pathname) || authRequired;

  if (mustHaveSession && !hasCookie) {
    const signIn = new URL('/auth/signin', request.url);
    signIn.searchParams.set('redirect', pathname + request.nextUrl.search);
    return NextResponse.redirect(signIn);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
