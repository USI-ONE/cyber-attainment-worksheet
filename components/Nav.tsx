'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type TabGroup = 'core' | 'planning' | 'governance' | 'reporting';

// Tenant-portal nav. The Portfolio Hub does not appear here — it lives on
// its own operator-only deployment (caw-portfolio-hub) with no tenant chrome.
const TABS: { href: string; label: string; group: TabGroup }[] = [
  { href: '/',            label: 'Summary Dashboard', group: 'core' },
  { href: '/assessment',  label: 'Assessment',        group: 'core' },
  { href: '/standards',   label: 'Security Standards', group: 'governance' },
  { href: '/priorities',  label: '30-Day Priorities',  group: 'planning' },
  { href: '/work-plans',  label: 'Work Plans',         group: 'planning' },
  { href: '/registers',   label: 'Registers',          group: 'governance' },
  { href: '/incidents',   label: 'Incidents',          group: 'governance' },
  { href: '/kpis',        label: 'Board KPIs',         group: 'reporting' },
  { href: '/policy',      label: 'Security Policy',    group: 'governance' },
  { href: '/maturity',    label: 'Maturity Levels',    group: 'reporting' },
  { href: '/worksheet',   label: 'Worksheet',          group: 'core' },
  { href: '/snapshots',   label: 'Snapshots',          group: 'reporting' },
  { href: '/trend',       label: 'Trend',              group: 'reporting' },
];

export default function Nav() {
  const pathname = usePathname();
  // Hide nav on the sign-in page (not currently used while auth is off, but harmless)
  if (pathname?.startsWith('/auth/')) return null;

  return (
    <nav className="app-nav">
      <div className="app-nav-inner">
        {TABS.map((t) => {
          const active = t.href === '/' ? pathname === '/' : pathname?.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={t.href as never}
              className={`nav-tab ${active ? 'active' : ''}`}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
