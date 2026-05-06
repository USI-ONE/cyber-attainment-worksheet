import SignOutButton from '@/components/SignOutButton';
import type { Tenant } from '@/lib/supabase/types';

// Hard-coded for now — small enough that an env var is overkill and we want
// the link to render even if env vars aren't surfaced to the layout. Will
// move to a config when client-side user auth ships and per-user hub access
// becomes a thing.
const PORTFOLIO_HUB_URL = 'https://caw-portfolio-hub.vercel.app/hub';

export default function Header({
  tenant,
  frameworkLabel,
  userEmail,
}: {
  tenant: Tenant;
  frameworkLabel: string | null;
  userEmail?: string | null;
}) {
  // Tagline is per-tenant. No platform default — empty if the tenant hasn't set one.
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
        {/*
          Operator-side back-link to the Portfolio Hub. Visible to anyone
          loading a tenant portal today because there's no per-user auth yet
          — the only person reaching these URLs is the MSP. When client-tenant
          users land here we'll gate this on role.
        */}
        <a
          href={PORTFOLIO_HUB_URL}
          className="hub-back-link"
          title="Back to the operator Portfolio Hub"
        >
          ← Portfolio Hub
        </a>
        {userEmail && (
          <div className="user-chip">
            <span>{userEmail}</span>
            <SignOutButton />
          </div>
        )}
      </div>
    </header>
  );
}
