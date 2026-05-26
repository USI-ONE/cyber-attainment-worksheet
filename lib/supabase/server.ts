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
 *
 * The client itself carries no per-request state (it's a fetch wrapper with
 * service-role auth headers baked in), so we cache it at module scope. On
 * Vercel a warm function instance re-uses module state across invocations,
 * which means the same client — and the underlying undici connection pool —
 * gets re-used. Cold starts still pay the construction cost once.
 */
// Module-scope cache for the service-role client. The non-cached factory
// is split into its own function so its inferred return type — including
// supabase-js's generic plumbing — can be referenced by `ReturnType<...>`
// without creating a self-referential cycle on the exported wrapper.
function _makeServiceRoleClient() {
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

let _cachedServiceRoleClient: ReturnType<typeof _makeServiceRoleClient> | null = null;
export function createServiceRoleClient(): ReturnType<typeof _makeServiceRoleClient> {
  if (_cachedServiceRoleClient) return _cachedServiceRoleClient;
  _cachedServiceRoleClient = _makeServiceRoleClient();
  return _cachedServiceRoleClient;
}
