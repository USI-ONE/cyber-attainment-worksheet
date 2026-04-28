import type { Metadata } from 'next';
import './globals.css';
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
  // Resolve tenant once at the layout level so metadata + crown image are tenant-scoped.
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  const logoUrl = tenant?.brand_config?.logo_url;
  const rootStyle: React.CSSProperties = logoUrl
    ? { ['--crown-image' as never]: `url("${logoUrl}")` }
    : {};

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
      <body style={rootStyle}>{children}</body>
    </html>
  );
}
