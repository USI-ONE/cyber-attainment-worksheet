import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import ChangePasswordForcedClient from '@/components/ChangePasswordForcedClient';

/**
 * /auth/change-password — forced password change after a temp-password invite.
 *
 * This is the destination the API login redirects to when password_must_change
 * is true on the user's profile. It's a server page so we can:
 *   1. Require a real session (no session → /auth/signin).
 *   2. If the user lands here without password_must_change set, send them
 *      straight to where they wanted to go — the forced flow is opportunistic;
 *      regular voluntary password changes still belong on /settings/me.
 *
 * The form itself is a client component (ChangePasswordForcedClient) because
 * it needs to call /api/me/password from the browser and then navigate.
 *
 * IMPORTANT: this page is inside /auth/* which is a PUBLIC_PATH in middleware,
 * so it always renders even when AUTH_REQUIRED=true. That's intentional —
 * the user needs to be able to reach it once their session is established
 * but before they've satisfied the must-change requirement.
 */
export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams?: { next?: string };
}) {
  const cu = await getCurrentUser();
  if (!cu) {
    // No session — bounce to signin. After signin, the login handler will
    // re-route here if must-change is still set.
    const next = searchParams?.next ?? '/';
    redirect(`/auth/signin?redirect=${encodeURIComponent(`/auth/change-password?next=${encodeURIComponent(next)}`)}`);
  }

  // If they don't need a change (e.g., bookmarked the URL), drop them where
  // they were headed. Defensive: prevents a permanent redirect loop if any
  // outside force-redirect ever lands on us by mistake.
  if (!cu.user.password_must_change) {
    redirect(searchParams?.next || '/');
  }

  return (
    <main className="signin-page">
      <div className="signin-card">
        <h1 className="signin-title">Set your password</h1>
        <p className="signin-sub">
          Your account is using a temporary password from your invite. Choose
          a new password below to finish setting up your account.
        </p>
        <ChangePasswordForcedClient
          email={cu.user.email}
          nextUrl={searchParams?.next ?? '/'}
        />
      </div>
    </main>
  );
}
