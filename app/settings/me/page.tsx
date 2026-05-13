import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import MyAccountClient from '@/components/MyAccountClient';

/**
 * Self-service account page for the signed-in user. Today this is just
 * the change-password form; future additions (display-name edit, MFA,
 * personal access tokens, session revocation) bolt on under the same path.
 *
 * Accessible to every signed-in user regardless of role — no tenant
 * membership required. A user with zero memberships can still rotate
 * their own password.
 */
export const dynamic = 'force-dynamic';

export default async function MyAccountPage() {
  const cu = await getCurrentUser();
  if (!cu) redirect('/auth/signin?redirect=/settings/me');

  return (
    <main className="app-main">
      <MyAccountClient
        email={cu.user.email}
        displayName={cu.user.display_name}
        isPlatformAdmin={cu.user.is_platform_admin}
        membershipCount={cu.memberships.length}
        lastLoginAt={cu.user.last_login_at}
      />
    </main>
  );
}
