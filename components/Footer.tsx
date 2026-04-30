import type { Tenant } from '@/lib/supabase/types';

export default function Footer({ tenant }: { tenant: Tenant }) {
  // Tagline is per-tenant. No platform default — empty if the tenant hasn't set one.
  const tagline = ((tenant.brand_config?.tagline as string | undefined) ?? '').trim();
  return (
    <footer className="app-footer" style={{ maxWidth: 1700, margin: '0 auto', padding: '0 28px 32px' }}>
      <div>
        {tenant.display_name} · NIST Cybersecurity Framework 2.0 · Practice Attainment Assessment
      </div>
      {tagline && <div className="app-footer-tag">{tagline}</div>}
      <div className="app-footer-meta">Universal Systems Inc. · CIO Office</div>
    </footer>
  );
}
