import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { canAdministerTenant, getCurrentUser, isPlatformAdmin } from '@/lib/auth';
import TenantUsersClient, {
  type TenantMember, type TenantPendingInvite,
} from '@/components/TenantUsersClient';

/**
 * Tenant-scoped user administration. Available to:
 *   - Platform admins (always)
 *   - Tenant editors (canAdministerTenant returns true for them in v1)
 * Tenant viewers get redirected away.
 */
export const dynamic = 'force-dynamic';

export default async function SettingsUsersPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;

  const cu = await getCurrentUser();
  if (!cu) redirect('/auth/signin?redirect=/settings/users');
  if (!canAdministerTenant(cu, tenant.id)) redirect('/');

  const supabase = createServiceRoleClient();
  const { data: mems } = await supabase
    .from('memberships')
    .select('user_id, role, created_at')
    .eq('tenant_id', tenant.id);

  const userIds = (mems ?? []).map((m) => (m as { user_id: string }).user_id);
  let members: TenantMember[] = [];
  if (userIds.length > 0) {
    const { data: us } = await supabase
      .from('profiles')
      .select('id, email, display_name, status, last_login_at, is_platform_admin')
      .in('id', userIds);
    const usersById = new Map<string, NonNullable<typeof us>[number]>();
    for (const u of (us ?? [])) usersById.set((u as { id: string }).id, u);
    members = (mems ?? []).map((m) => {
      const mm = m as { user_id: string; role: 'editor' | 'viewer'; created_at: string };
      const user = usersById.get(mm.user_id);
      return {
        ...mm,
        user: user ? {
          id: (user as { id: string }).id,
          email: (user as { email: string }).email,
          display_name: (user as { display_name: string | null }).display_name,
          status: (user as { status: 'active'|'disabled'|'invited' }).status,
          last_login_at: (user as { last_login_at: string | null }).last_login_at,
          is_platform_admin: (user as { is_platform_admin: boolean }).is_platform_admin,
        } : null,
      };
    });
  }

  const { data: invites } = await supabase
    .from('user_invites')
    .select('id, email, role, expires_at, created_at')
    .eq('tenant_id', tenant.id)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  return (
    <main className="app-main">
      <TenantUsersClient
        tenantName={tenant.display_name}
        currentUserId={cu.user.id}
        isPlatformAdmin={isPlatformAdmin(cu)}
        initialMembers={members}
        initialInvites={(invites ?? []) as TenantPendingInvite[]}
      />
    </main>
  );
}
