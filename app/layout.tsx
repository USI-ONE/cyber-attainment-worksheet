import type { Metadata } from 'next';
import './globals.css';
import Nav from '@/components/Nav';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { resolveTenant } from '@/lib/tenant';
import { headers } from 'next/headers';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await resolveTenant();
  const name = tenant?.display_name ?? 'Cyber Attainment Worksheet';
  return {
    title: `${name} — Cyber Attainment Worksheet`,
    description: 'Multi-tenant cyber framework attainment platform.',
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
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
      <body style={rootStyle}>
        {tenant && <Header tenant={tenant} frameworkLabel={null} userEmail={null} />}
        {tenant && <Nav />}
        {children}
        {tenant && <Footer tenant={tenant} />}
      </body>
    </html>
  );
}
