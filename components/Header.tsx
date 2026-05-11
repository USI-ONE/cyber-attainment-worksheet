import SignOutButton from '@/components/SignOutButton';
import type { Tenant } from '@/lib/supabase/types';
import type { CurrentUser } from '@/lib/auth';

// Operator Portfolio Hub URL — hard-coded for now until per-user config
// surfaces a preferred entry point.
const PORTFOLIO_HUB_URL = 'https://caw-portfolio-hub.vercel.app/hub';

/**
 * Tenant header. Shows the tenant brand, the framework label, an optional
 * Portfolio Hub back-link (for platform admins who landed here from the
 * Hub), and the current-user chip with sign-out. If no current user is
 * present, the chip becomes a "Sign in" link so unauthenticated visitors
 * always have a clear path to the sign-in page.
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
            {frameworkLabel ? frameworkLabel.split(' · ')[0] : 'Cyber Attainment Worksheet'}
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
          <UserChip currentUser={currentUser} />
        ) : (
          <a href="/auth/signin" className="hub-back-link" title="Sign in">
            Sign in →
          </a>
        )}
      </div>
    </header>
  );
}

function UserChip({ currentUser }: { currentUser: CurrentUser }) {
  const label = currentUser.user.display_name?.trim() || currentUser.user.email;
  return (
    <div className="user-chip" title={currentUser.user.email}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 24, height: 24, borderRadius: '50%',
          background: currentUser.user.is_platform_admin ? 'var(--gold-pale)' : 'var(--bg-card)',
          border: '1px solid ' + (currentUser.user.is_platform_admin ? 'var(--gold-border)' : 'var(--bg-border)'),
          color: currentUser.user.is_platform_admin ? 'var(--gold-light)' : 'var(--text-mid)',
          fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 10,
        }}>
          {label.slice(0, 2).toUpperCase()}
        </span>
        <span>{label}</span>
        {currentUser.user.is_platform_admin && (
          <span style={{
            fontSize: 9, fontWeight: 700,
            padding: '1px 6px',
            borderRadius: 999,
            background: 'var(--gold-pale)',
            color: 'var(--gold-light)',
            textTransform: 'uppercase', letterSpacing: '.06em',
          }}>
            Admin
          </span>
        )}
      </span>
      <SignOutButton />
    </div>
  );
}
