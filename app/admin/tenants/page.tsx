import { redirect } from 'next/navigation';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser, isPlatformAdmin } from '@/lib/auth';
import TenantAdminClient, {
  type AdminTenantRow,
} from '@/components/TenantAdminClient';

/**
 * Platform-level tenant administration. Platform-admin only.
 */
export const dynamic = 'force-dynamic';

export default async function AdminTenantsPage() {
  const cu = await getCurrentUser();
  if (!cu) redirect('/auth/signin?redirect=/admin/tenants');
  if (!isPlatformAdmin(cu)) redirect('/');

  const supabase = createServiceRoleClient();
  const [tenantsRes, membershipsRes] = await Promise.all([
    supabase.from('tenants')
      .select('id, slug, hostname, display_name, brand_config, created_at')
      .order('display_name'),
    supabase.from('memberships').select('tenant_id, role'),
  ]);

  const counts: Record<string, { editors: number; viewers: number }> = {};
  for (const m of (membershipsRes.data ?? []) as { tenant_id: string; role: string }[]) {
    if (!counts[m.tenant_id]) counts[m.tenant_id] = { editors: 0, viewers: 0 };
    if (m.role === 'editor') counts[m.tenant_id].editors++;
    else if (m.role === 'viewer') counts[m.tenant_id].viewers++;
  }

  return (
    <main className="app-main">
      <TenantAdminClient
        tenants={(tenantsRes.data ?? []) as AdminTenantRow[]}
        memberCounts={counts}
      />
    </main>
  );
}
