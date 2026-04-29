import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

/**
 * User-context server client. Reads/writes the Supabase auth cookie via
 * next/headers, so RLS policies are evaluated against auth.uid().
 * Use this for any operation that should be scoped to the signed-in user.
 */
export function createClient() {
  const cookieStore = cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

  return createServerClient(url, key, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // setting cookies from a Server Component is a no-op; middleware handles refresh.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: '', ...options });
        } catch {
          // see above
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS. Server-side only — never expose to the
 * browser. Use this only for trusted operations:
 *   - tenant identity / framework metadata lookups (deployment-scoped data)
 *   - import endpoint after the user has been authz-checked separately
 *
 * NOTE: We use createClient from @supabase/supabase-js (not createServerClient
 * from @supabase/ssr). The ssr variant is designed around user sessions and
 * cookies; with the service-role key it does not behave as a fully privileged
 * client. The supabase-js client treats the key as a Bearer token and Postgres
 * sees the service_role JWT, which RLS bypasses by design.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const secret = process.env.SUPABASE_SECRET_KEY!;
  if (!secret) {
    throw new Error(
      'SUPABASE_SECRET_KEY is not set. Add it as a sensitive env var on the Vercel project.',
    );
  }
  return createSupabaseClient(url, secret, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
