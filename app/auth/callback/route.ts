import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  // Same open-redirect guard as /api/auth/login: only allow a same-origin
  // path. Reject protocol-relative URLs ('//evil.com'), backslash variants,
  // anything over 1KB. `new URL(next, request.url)` would happily resolve
  // an absolute external URL on its own — we have to whitelist the shape.
  const rawNext = url.searchParams.get('next') ?? '/';
  const next = (
    rawNext.startsWith('/') &&
    !rawNext.startsWith('//') &&
    !rawNext.startsWith('/\\') &&
    rawNext.length <= 1024
  ) ? rawNext : '/';

  if (!code) {
    return NextResponse.redirect(new URL('/auth/signin?error=missing_code', request.url));
  }

  const supabase = createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    // Don't echo the underlying error verbatim — it can leak schema or
    // provider details. Server-side log it; surface a generic code.
    console.error('auth callback: exchangeCodeForSession failed', error);
    return NextResponse.redirect(new URL('/auth/signin?error=callback_failed', request.url));
  }

  return NextResponse.redirect(new URL(next, request.url));
}
