import { redirect } from 'next/navigation';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser, isPlatformAdmin } from '@/lib/auth';
import UserAdminClient, {
  type AdminProfile, type AdminMembership, type AdminInvite, type AdminTenant,
} from '@/components/UserAdminClient';

/**
 * Platform-level user administration. Visible only to platform admins.
 * Non-admins get bounced to the dashboard so the URL is never a leak.
 */
export const dynamic = 'force-dynamic';

export default async function AdminUsersPage() {
  const cu = await getCurrentUser();
  if (!cu) redirect('/auth/signin?redirect=/admin/users');
  if (!isPlatformAdmin(cu)) redirect('/');

  const supabase = createServiceRoleClient();
  const [usersRes, membershipsRes, tenantsRes, invitesRes] = await Promise.all([
    supabase.from('profiles')
      .select('id, email, display_name, is_platform_admin, status, last_login_at, created_at')
      .order('created_at', { ascending: true }),
    supabase.from('memberships')
      .select('user_id, tenant_id, role, created_at'),
    supabase.from('tenants')
      .select('id, slug, display_name')
      .order('display_name'),
    supabase.from('user_invites')
      .select('id, email, tenant_id, role, grant_platform_admin, expires_at, created_at')
      .is('accepted_at', null)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false }),
  ]);

  return (
    <main className="app-main">
      <UserAdminClient
        currentUserId={cu.user.id}
        users={(usersRes.data ?? []) as AdminProfile[]}
        memberships={(membershipsRes.data ?? []) as AdminMembership[]}
        tenants={(tenantsRes.data ?? []) as AdminTenant[]}
        pendingInvites={(invitesRes.data ?? []) as AdminInvite[]}
      />
    </main>
  );
}
