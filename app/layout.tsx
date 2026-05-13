import type { Metadata } from 'next';
import './globals.css';
import Nav from '@/components/Nav';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import SignOutButton from '@/components/SignOutButton';
import ReadOnlyBanner from '@/components/ReadOnlyBanner';
import ReadOnlyEnforcer from '@/components/ReadOnlyEnforcer';
import { resolveTenant } from '@/lib/tenant';
import { getCurrentUser } from '@/lib/auth';
import { headers } from 'next/headers';

export async function generateMetadata(): Promise<Metadata> {
  // Operator deploy gets a generic Portfolio Hub title; tenant deploys
  // pull their display_name from the resolved tenant.
  if (process.env.OPERATOR_MODE === 'true') {
    return {
      title: 'Portfolio Hub — TrustOS',
      description: 'Operator-level overview of every TrustOS tenant portal.',
    };
  }
  const tenant = await resolveTenant();
  const name = tenant?.display_name ?? 'TrustOS';
  return {
    title: `${name} — TrustOS`,
    description: 'Cybersecurity & compliance management. Part of the USI managed-services suite.',
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const host = headers().get('host') ?? undefined;
  const [tenant, currentUser] = await Promise.all([
    resolveTenant(host),
    getCurrentUser(),
  ]);

  // Determine whether the signed-in user can administer THIS tenant (editor
  // OR platform admin). Drives the conditional Nav groups (Settings, Admin).
  const isPlatformAdmin = !!currentUser?.user.is_platform_admin;
  const canEdit = isPlatformAdmin
    || (!!tenant && !!currentUser?.memberships.some((m) => m.tenant_id === tenant.id && m.role === 'editor'));
  const canAdminister = canEdit;

  // Read-only mode: signed-in user who CAN'T edit this tenant. Drives the
  // ReadOnlyBanner above main content and a body[data-readonly] attribute
  // that disables editable inputs via CSS in globals.css. Anonymous browsing
  // (no currentUser) is NOT read-only mode — the user simply hasn't signed
  // in yet, and the legacy AUTH_REQUIRED=false rollout flag still permits
  // unauthenticated edits at the API layer.
  const readOnly = !!currentUser && !!tenant && !canEdit;
  const brand = (tenant?.brand_config ?? {}) as {
    logo_url?: string;
    tagline?: string;
    theme?: {
      primary?: string;
      primary_light?: string;
      primary_bright?: string;
      primary_pale?: string;
      primary_border?: string;
      secondary?: string;
      accent?: string;
    };
  };

  // Map brand theme tokens onto the existing CSS variables so the whole
  // dark-navy chrome rebrands without needing per-component overrides.
  // The platform default is the gold scheme; tenants can substitute
  // (e.g., USI uses Juniper #458C5E + Nebula #3B697A).
  // Built as Record<string, string> because React.CSSProperties does not
  // permit arbitrary CSS-variable property assignment under strict TS.
  const cssVars: Record<string, string> = {};
  if (brand.logo_url) cssVars['--crown-image'] = `url("${brand.logo_url}")`;
  if (brand.theme?.primary)        cssVars['--gold']             = brand.theme.primary;
  if (brand.theme?.primary_light)  cssVars['--gold-light']       = brand.theme.primary_light;
  if (brand.theme?.primary_bright) cssVars['--gold-bright']      = brand.theme.primary_bright;
  if (brand.theme?.primary_pale)   cssVars['--gold-pale']        = brand.theme.primary_pale;
  if (brand.theme?.primary_border) cssVars['--gold-border']      = brand.theme.primary_border;
  if (brand.theme?.secondary)      cssVars['--brand-secondary']  = brand.theme.secondary;
  if (brand.theme?.accent)         cssVars['--brand-accent']     = brand.theme.accent;
  const rootStyle = cssVars as React.CSSProperties;

  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Oswald:wght@500;600;700&family=JetBrains+Mono:wght@500;600&display=swap"
        />
      </head>
      <body style={rootStyle} data-readonly={readOnly ? 'true' : undefined}>
        {/*
          Operator-mode (the Portfolio Hub deploy) skips all tenant chrome —
          it's not a tenant. Customer tenant deploys render the normal
          Header / Nav / Footer with their brand pulled from brand_config.
        */}
        {process.env.OPERATOR_MODE === 'true' ? (
          <>
            <header style={{
              padding: '14px 20px',
              borderBottom: '1px solid var(--bg-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 16,
            }}>
              <span style={{
                fontFamily: 'Oswald, sans-serif', fontWeight: 700, fontSize: 14,
                letterSpacing: '0.2em', textTransform: 'uppercase',
              }}>Portfolio Hub</span>
              <span style={{ flex: 1, fontSize: 11, color: 'var(--text-muted)' }}>
                TrustOS · Operator
              </span>
              {currentUser ? (
                <div className="user-chip">
                  <span>{currentUser.user.display_name?.trim() || currentUser.user.email}</span>
                  {currentUser.user.is_platform_admin && (
                    <span style={{
                      fontSize: 9, fontWeight: 700, padding: '1px 6px',
                      borderRadius: 999, background: 'var(--gold-pale)',
                      color: 'var(--gold-light)',
                      textTransform: 'uppercase', letterSpacing: '.06em',
                    }}>Admin</span>
                  )}
                  <SignOutButton />
                </div>
              ) : (
                <a href="/auth/signin" className="hub-back-link">Sign in →</a>
              )}
            </header>
            {/* Operator-mode top-level nav. Hub is the home; Admin pages are
                only visible to signed-in platform admins. */}
            {isPlatformAdmin && (
              <nav style={{
                padding: '6px 20px',
                borderBottom: '1px solid var(--bg-border)',
                display: 'flex', gap: 4,
                background: 'rgba(245,247,251,0.85)',
              }}>
                <a href="/hub" className="nav-tab" style={{ padding: '8px 14px' }}>Portfolio</a>
                <a href="/admin/users" className="nav-tab" style={{ padding: '8px 14px' }}>Users</a>
                <a href="/admin/tenants" className="nav-tab" style={{ padding: '8px 14px' }}>Tenants</a>
              </nav>
            )}
          </>
        ) : (
          <>
            {tenant && <Header tenant={tenant} frameworkLabel={null} currentUser={currentUser} />}
            {tenant && (
              <Nav
                signedIn={!!currentUser}
                canAdminister={canAdminister}
                isPlatformAdmin={isPlatformAdmin}
              />
            )}
            {readOnly && currentUser && tenant && (
              <ReadOnlyBanner tenant={tenant} currentUser={currentUser} />
            )}
            {readOnly && <ReadOnlyEnforcer />}
          </>
        )}
        {children}
        {tenant && process.env.OPERATOR_MODE !== 'true' && <Footer tenant={tenant} />}
      </body>
    </html>
  );
}
