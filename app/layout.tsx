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
  const rootStyle: React.CSSProperties = {};
  if (brand.logo_url) rootStyle['--crown-image' as never] = `url("${brand.logo_url}")`;
  if (brand.theme?.primary)        rootStyle['--gold' as never]         = brand.theme.primary;
  if (brand.theme?.primary_light)  rootStyle['--gold-light' as never]   = brand.theme.primary_light;
  if (brand.theme?.primary_bright) rootStyle['--gold-bright' as never]  = brand.theme.primary_bright;
  if (brand.theme?.primary_pale)   rootStyle['--gold-pale' as never]    = brand.theme.primary_pale;
  if (brand.theme?.primary_border) rootStyle['--gold-border' as never]  = brand.theme.primary_border;
  if (brand.theme?.secondary)      rootStyle['--brand-secondary' as never] = brand.theme.secondary;
  if (brand.theme?.accent)         rootStyle['--brand-accent' as never]    = brand.theme.accent;

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
