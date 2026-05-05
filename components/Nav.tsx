'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type TabGroup = 'core' | 'planning' | 'governance' | 'reporting' | 'operator';

const TABS: { href: string; label: string; group: TabGroup }[] = [
  { href: '/hub',         label: 'Portfolio Hub',     group: 'operator' }, // operator-only — filtered out for customer tenants
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

export default function Nav({ isOperator = false }: { isOperator?: boolean }) {
  const pathname = usePathname();
  // Hide nav on the sign-in page (not currently used while auth is off, but harmless)
  if (pathname?.startsWith('/auth/')) return null;

  // The Portfolio Hub link is only useful on the operator deploy; on customer
  // tenants the page itself returns a placeholder, but we hide the link too so
  // the nav doesn't dangle a non-functional entry.
  const visibleTabs = TABS.filter((t) => t.group !== 'operator' || isOperator);

  return (
    <nav className="app-nav">
      <div className="app-nav-inner">
        {visibleTabs.map((t) => {
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
