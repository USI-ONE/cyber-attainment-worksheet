import { NextResponse, type NextRequest } from 'next/server';

/**
 * Auth is intentionally OFF for Phase 1.5.
 *
 * Reason: Supabase's admin-issued magic links and email magic links use the
 * legacy implicit flow (#access_token=... in the URL fragment). Our
 * /auth/callback handler is server-side and cannot read URL fragments,
 * which means signed-in users get bounced back to the sign-in page.
 *
 * The right fix is a client-side callback that reads the fragment and calls
 * supabase.auth.setSession(). That's queued for a follow-up. For now we ship
 * the worksheet with no auth gate so the platform delivers value while the
 * proper auth flow is rebuilt. Vercel URLs are unguessable enough for
 * short-term comfort, but treat this build as not-yet-public.
 *
 * This middleware is a no-op pass-through. RLS still applies for any
 * call that goes through the user (anon) Supabase client; reads/writes
 * that require privilege are routed through server-side API routes that
 * use the service role.
 */
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
