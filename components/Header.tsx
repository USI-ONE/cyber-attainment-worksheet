import SignOutButton from '@/components/SignOutButton';
import type { Tenant } from '@/lib/supabase/types';
import type { CurrentUser } from '@/lib/auth';

// Operator Portfolio Hub URL — hard-coded for now until per-user config
// surfaces a preferred entry point.
const PORTFOLIO_HUB_URL = 'https://caw-portfolio-hub.vercel.app/hub';

/** Pick the role label + color for the chip badge based on the user's
 *  effective scope on the current tenant. Platform admin trumps tenant
 *  role. A signed-in user with no membership for this tenant shows "no
 *  access" so the chip itself communicates the read-only reason. */
function roleBadge(currentUser: CurrentUser, tenant: Tenant): { label: string; color: string } {
  if (currentUser.user.is_platform_admin) return { label: 'Admin',  color: '#1E40AF' };
  const m = currentUser.memberships.find((m) => m.tenant_id === tenant.id);
  if (m?.role === 'editor') return { label: 'Editor', color: '#10B981' };
  if (m?.role === 'viewer') return { label: 'Viewer', color: '#F59E0B' };
  return { label: 'No access', color: '#94A3B8' };
}

/**
 * Tenant header. Shows the tenant brand, the framework label, an optional
 * Portfolio Hub back-link (for platform admins who landed here from the
 * Hub), and the current-user chip with sign-out + a role pill that
 * communicates read-only / editor / admin status at a glance. If no
 * current user is present, the chip becomes a "Sign in" link.
 */
export default function Header({
  tenant,
  frameworkLabel,
  currentUser,
}: {
  tenant: Tenant;
  frameworkLabel: string | null;
  currentUser: CurrentUser | null;
}) {
  const tagline = ((tenant.brand_config?.tagline as string | undefined) ?? '').trim();

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="brand-lockup">
          <div className="crown-mark" aria-label={`${tenant.display_name} logo`} />
          <div className="brand-text">
            <div className="wordmark">{tenant.display_name}</div>
            {tagline && <div className="tagline">{tagline}</div>}
          </div>
        </div>
        <div className="doc-meta">
          <div className="doc-title">
            {frameworkLabel ? frameworkLabel.split(' · ')[0] : 'TrustOS'}
          </div>
          {frameworkLabel && (
            <div className="doc-sub">{frameworkLabel.split(' · ').slice(1).join(' · ')}</div>
          )}
        </div>

        {/* Portfolio Hub back-link — only useful for platform admins. */}
        {currentUser?.user.is_platform_admin && (
          <a
            href={PORTFOLIO_HUB_URL}
            className="hub-back-link"
            title="Back to the operator Portfolio Hub"
          >
            ← Portfolio Hub
          </a>
        )}

        {currentUser ? (
          <UserChip currentUser={currentUser} tenant={tenant} />
        ) : (
          <a href="/auth/signin" className="hub-back-link" title="Sign in">
            Sign in →
          </a>
        )}
      </div>
    </header>
  );
}

function UserChip({ currentUser, tenant }: { currentUser: CurrentUser; tenant: Tenant }) {
  const label = currentUser.user.display_name?.trim() || currentUser.user.email;
  const badge = roleBadge(currentUser, tenant);
  return (
    <div className="user-chip" title={`${currentUser.user.email} · ${badge.label} — click to manage your account`}>
      {/* The avatar + name is a link to /settings/me — the obvious place
          users look for self-service (change password, etc.). The role
          pill and sign-out button stay outside the link so a click on
          either does the right thing. */}
      <a href="/settings/me" style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        textDecoration: 'none', color: 'inherit',
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 24, height: 24, borderRadius: '50%',
          background: `${badge.color}1a`,
          border: `1px solid ${badge.color}55`,
          color: badge.color,
          fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 10, letterSpacing: 0,
        }}>
          {label.slice(0, 2).toUpperCase()}
        </span>
        <span>{label}</span>
      </a>
      <span style={{
        fontSize: 9, fontWeight: 700,
        padding: '1px 6px',
        borderRadius: 999,
        background: `${badge.color}1a`,
        color: badge.color,
        border: `1px solid ${badge.color}55`,
        textTransform: 'uppercase', letterSpacing: '.06em',
      }}>
        {badge.label}
      </span>
      <SignOutButton />
    </div>
  );
}
