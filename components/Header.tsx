import SignOutButton from '@/components/SignOutButton';
import type { Tenant } from '@/lib/supabase/types';

export default function Header({
  tenant,
  frameworkLabel,
  userEmail,
}: {
  tenant: Tenant;
  frameworkLabel: string | null;
  userEmail?: string | null;
}) {
  const tagline = (tenant.brand_config?.tagline as string | undefined) ?? 'The Crown of Quality';

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="brand-lockup">
          <div className="crown-mark" aria-label={`${tenant.display_name} logo`} />
          <div className="brand-text">
            <div className="wordmark">{tenant.display_name}</div>
            <div className="tagline">{tagline}</div>
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
