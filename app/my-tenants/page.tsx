import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { createServiceRoleClient } from '@/lib/supabase/server';
import MyTenantsClient from '@/components/MyTenantsClient';
import type { CurrentUser } from '@/lib/auth';

/**
 * /my-tenants — landing page for any signed-in user on the operator hub.
 *
 * Shows the user a list of every tenant they have access to (platform
 * admins see every tenant; tenant members see only the tenants they're
 * a member of). Each row has an "Open" button that calls
 * /api/hub/sso/issue to mint a one-time SSO token, then redirects the
 * browser to caw-<slug>.vercel.app/auth/sso?token=… so the user lands
 * authenticated on the tenant deploy without re-typing their password.
 *
 * Auth flow this enables:
 *   1. User signs in once at the hub.
 *   2. Lands here, sees their tenants.
 *   3. Clicks Open → SSO handshake → tenant deploy with session cookie.
 *
 * Only renders on the operator deploy. On tenant deploys (where the
 * user is already on a specific tenant) this page redirects to /.
 */
export const dynamic = 'force-dynamic';

export default async function MyTenantsPage() {
  if (process.env.OPERATOR_MODE !== 'true') {
    redirect('/');
  }

  const cu = await getCurrentUser();
  if (!cu) redirect('/auth/signin?redirect=/my-tenants');

  const supabase = createServiceRoleClient();

  // Platform admins see every tenant; tenant members see only the
  // tenants they're a member of. Both go through the same UI — the only
  // difference is the row list.
  let tenantIds: string[] | null = null;
  if (!cu.user.is_platform_admin) {
    tenantIds = cu.memberships.map((m) => m.tenant_id);
    if (tenantIds.length === 0) {
      return (
        <main className="app-main">
          <NoMemberships email={cu.user.email} />
        </main>
      );
    }
  }

  let query = supabase
    .from('tenants')
    .select('id, slug, display_name, hostname, brand_config')
    .order('display_name');
  if (tenantIds !== null) query = query.in('id', tenantIds);
  const { data: tenants } = await query;

  // Annotate each tenant with the user's role on it so the picker can
  // show "platform admin / editor / viewer" next to the display name.
  const memByTenant = new Map<string, 'editor' | 'viewer' | 'admin'>();
  for (const m of cu.memberships) memByTenant.set(m.tenant_id, m.role);

  type Row = {
    id: string; slug: string; display_name: string;
    hostname: string | null; brand_config: { theme?: { primary?: string }; logo_url?: string } | null;
  };
  const rows = ((tenants ?? []) as Row[]).map((t) => ({
    id: t.id,
    slug: t.slug,
    display_name: t.display_name,
    hostname: t.hostname,
    primary_color: t.brand_config?.theme?.primary ?? null,
    logo_url: t.brand_config?.logo_url ?? null,
    role: memByTenant.get(t.id) ?? null,
  }));

  return (
    <main className="app-main">
      <MyTenantsClient
        user={cu}
        tenants={rows}
      />
    </main>
  );
}

function NoMemberships({ email }: { email: string }) {
  return (
    <section className="scorecard" style={{ textAlign: 'center', maxWidth: 600, margin: '40px auto' }}>
      <div className="scorecard-title">No tenant access</div>
      <div className="scorecard-tag" style={{ marginTop: 8 }}>
        Your account ({email}) is signed in, but doesn&apos;t have access to any tenant yet.
        Ask a platform administrator to grant you access.
      </div>
      <div style={{ marginTop: 18 }}>
        <a href="/auth/signout" className="action-btn">Sign out</a>
      </div>
    </section>
  );
}

// Re-export CurrentUser type so the client component can import it without
// reaching into lib/auth (which pulls Node crypto, blowing up RSC bundling).
export type { CurrentUser };
