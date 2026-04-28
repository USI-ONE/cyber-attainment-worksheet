import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

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

// Service-role client for trusted server-side ops (e.g., import endpoint after authz check).
// Never expose this client to the browser.
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const secret = process.env.SUPABASE_SECRET_KEY!;
  if (!secret) throw new Error('SUPABASE_SECRET_KEY is not set');
  return createServerClient(url, secret, {
    cookies: { get: () => undefined, set: () => {}, remove: () => {} },
  });
}
