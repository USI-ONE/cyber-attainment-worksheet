import { NextResponse, type NextRequest } from 'next/server';
import {
  MUST_CHANGE_ALLOWED_PREFIXES,
  MUST_CHANGE_COOKIE_NAME,
  PATHNAME_HEADER,
  SESSION_COOKIE_NAME,
} from '@/lib/auth-shared';
// IMPORTANT: do NOT import from '@/lib/auth' here. That module pulls in
// node:crypto (scrypt, randomBytes), which the Edge runtime middleware
// runs under does not support. Constants live in lib/auth-shared so
// middleware can pick them up without dragging Node-only APIs into the
// Edge bundle.

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

// MUST_CHANGE_ALLOWED_PREFIXES now lives in lib/auth-shared so both the
// edge middleware and the server-side layout gate read from the same
// source. Keeps the two checks from drifting.

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

  // Stash the request pathname so server components can read it without
  // resorting to internal Next.js headers. layout.tsx uses this for the
  // server-side password_must_change gate.
  const reqHeaders = new Headers(request.headers);
  reqHeaders.set(PATHNAME_HEADER, pathname);
  const pass = NextResponse.next({ request: { headers: reqHeaders } });

  // Force-password-change gate runs BEFORE the public-path check — a user
  // mid-temp-password flow should land back on /auth/change-password even
  // when they try to visit, e.g., /auth/signin again. Cookie-only check
  // here is fast; the layout re-verifies against the DB for users who
  // tampered with the cookie.
  const hasMustChange = !!request.cookies.get(MUST_CHANGE_COOKIE_NAME)?.value;
  if (hasMustChange) {
    const allowed = MUST_CHANGE_ALLOWED_PREFIXES.some((p) => pathname.startsWith(p));
    if (!allowed) {
      const url = new URL('/auth/change-password', request.url);
      url.searchParams.set('next', pathname + request.nextUrl.search);
      const redir = NextResponse.redirect(url);
      withSecurityHeaders(redir);
      return redir;
    }
  }

  if (isPublic(pathname)) {
    withSecurityHeaders(pass);
    return pass;
  }

  const hasCookie = !!request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const authRequired = process.env.AUTH_REQUIRED === 'true';
  const mustHaveSession = isAlwaysProtected(pathname) || authRequired;

  if (mustHaveSession && !hasCookie) {
    const signIn = new URL('/auth/signin', request.url);
    signIn.searchParams.set('redirect', pathname + request.nextUrl.search);
    const redir = NextResponse.redirect(signIn);
    withSecurityHeaders(redir);
    return redir;
  }

  withSecurityHeaders(pass);
  return pass;
}

/**
 * Set platform-wide response headers on every navigation/API response.
 * Cheap and broadly defensive — closes click-jacking, MIME-sniff, basic
 * referrer-leak vectors. Permissions-Policy locks down APIs we don't use.
 *
 * CSP is intentionally NOT included here as a strict policy yet because
 * the Next.js dev server + inline styles from @react-pdf and the chrome
 * extension landscape make a single strict policy disruptive to tune.
 * Adding it is in the medium-term backlog — see the security audit.
 */
function withSecurityHeaders(res: NextResponse): void {
  // Stop browsers from MIME-sniffing — turns "Content-Type: text/plain"
  // serving as HTML into a non-issue.
  res.headers.set('X-Content-Type-Options', 'nosniff');
  // Click-jacking protection. SAMEORIGIN allows our own in-app iframes
  // (none today) while blocking any third-party site from framing us.
  res.headers.set('X-Frame-Options', 'SAMEORIGIN');
  // Don't leak full URLs to third-party origins in the Referer header.
  // strict-origin-when-cross-origin sends only the scheme+host on
  // cross-origin requests, full URL on same-origin.
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Deny features we never use. Keeps a compromised dependency from
  // popping a camera/mic prompt.
  res.headers.set('Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)',
  );
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
