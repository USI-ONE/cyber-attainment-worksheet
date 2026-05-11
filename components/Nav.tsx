'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Grouped, dropdown-style navigation for the tenant portal.
 *
 * Static groups: Assess / Plan / Operate / Govern. Conditional groups:
 *   - Settings (any user who can administer THIS tenant — editors + platform
 *     admins) — local tenant administration.
 *   - Admin    (platform admins only) — platform-wide administration.
 *
 * The Portfolio Hub does not appear here — it lives on the operator-only
 * deployment (caw-portfolio-hub) with no tenant chrome.
 */

interface NavItem  { href: string; label: string; tag?: string }
interface NavGroup { id: string; label: string; items: NavItem[] }

const STATIC_GROUPS: NavGroup[] = [
  {
    id: 'assess',
    label: 'Assess',
    items: [
      { href: '/assessment', label: 'Assessment',     tag: 'Guided questionnaire' },
      { href: '/worksheet',  label: 'Worksheet',      tag: 'Per-control scoring' },
      { href: '/maturity',   label: 'Maturity Levels', tag: 'CMM heatmap' },
      { href: '/snapshots',  label: 'Snapshots',      tag: 'Point-in-time captures' },
      { href: '/trend',      label: 'Trend',          tag: 'Maturity over time' },
    ],
  },
  {
    id: 'plan',
    label: 'Plan',
    items: [
      { href: '/risks',      label: 'Risk Register',     tag: 'Heat map + treatments' },
      { href: '/priorities', label: '30-Day Priorities', tag: 'Sprint focus' },
      { href: '/work-plans', label: 'Work Plans',        tag: 'Tactical tasks per control' },
      { href: '/dr-plans',   label: 'Disaster Recovery', tag: 'RTO/RPO + recovery procedures' },
      { href: '/ir-plans',   label: 'IR Playbooks',      tag: 'Per-category response runbooks' },
    ],
  },
  {
    id: 'operate',
    label: 'Operate',
    items: [
      { href: '/incidents', label: 'Incidents',         tag: 'Live + historical log' },
      { href: '/registers', label: 'Registers',         tag: 'Assets, vendors, stakeholders' },
      { href: '/standards', label: 'Security Standards', tag: 'Control standards library' },
    ],
  },
  {
    id: 'govern',
    label: 'Govern',
    items: [
      { href: '/policy',   label: 'Policy Documents',  tag: 'Versioned policy library' },
      { href: '/evidence', label: 'Evidence Library',  tag: 'Audit-ready artifact store' },
      { href: '/kpis',     label: 'Board KPIs',        tag: 'Executive metrics' },
    ],
  },
];

const SETTINGS_GROUP: NavGroup = {
  id: 'settings',
  label: 'Settings',
  items: [
    { href: '/settings/users', label: 'Users', tag: 'Manage this tenant’s members + invites' },
  ],
};

const ADMIN_GROUP: NavGroup = {
  id: 'admin',
  label: 'Admin',
  items: [
    { href: '/admin/users',   label: 'Users',   tag: 'Platform-wide user administration' },
    { href: '/admin/tenants', label: 'Tenants', tag: 'Platform-wide tenant administration' },
  ],
};

export default function Nav({
  canAdminister = false,
  isPlatformAdmin = false,
}: {
  canAdminister?: boolean;
  isPlatformAdmin?: boolean;
}) {
  const pathname = usePathname();
  const [openId, setOpenId] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  // Build the visible groups list each render — cheap, and lets us
  // conditionally insert Settings / Admin based on role props.
  const groups: NavGroup[] = [...STATIC_GROUPS];
  if (canAdminister) groups.push(SETTINGS_GROUP);
  if (isPlatformAdmin) groups.push(ADMIN_GROUP);

  function findGroup(pn: string | null): string | null {
    if (!pn) return null;
    for (const g of groups) {
      for (const it of g.items) {
        if (pn === it.href || pn.startsWith(it.href + '/')) return g.id;
      }
    }
    return null;
  }

  // Close any open menu when the route changes.
  useEffect(() => { setOpenId(null); }, [pathname]);

  // Click-away closes the menu.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!navRef.current) return;
      if (!navRef.current.contains(e.target as Node)) setOpenId(null);
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') setOpenId(null); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, []);

  if (pathname?.startsWith('/auth/')) return null;

  const activeGroup = findGroup(pathname ?? null);
  const dashActive = pathname === '/';

  return (
    <nav className="app-nav" ref={navRef}>
      <div className="app-nav-inner">
        <Link
          href="/"
          className={`nav-tab ${dashActive ? 'active' : ''}`}
          onMouseEnter={() => setOpenId(null)}
        >
          Dashboard
        </Link>

        {groups.map((g) => {
          const isActiveGroup = activeGroup === g.id;
          const isOpen = openId === g.id;
          return (
            <div
              key={g.id}
              className={`nav-group ${isActiveGroup ? 'active' : ''} ${isOpen ? 'open' : ''}`}
              onMouseEnter={() => setOpenId(g.id)}
              onMouseLeave={() => setOpenId((id) => (id === g.id ? null : id))}
            >
              <button
                type="button"
                className={`nav-tab nav-group-trigger ${isActiveGroup ? 'active' : ''}`}
                onClick={() => setOpenId((id) => (id === g.id ? null : g.id))}
                aria-expanded={isOpen}
                aria-haspopup="true"
              >
                {g.label}
                <svg className="nav-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>

              {isOpen && (
                <div className="nav-menu" role="menu">
                  {g.items.map((it) => {
                    const active = pathname === it.href || pathname?.startsWith(it.href + '/');
                    return (
                      <Link
                        key={it.href}
                        href={it.href as never}
                        role="menuitem"
                        className={`nav-menu-item ${active ? 'active' : ''}`}
                        onClick={() => setOpenId(null)}
                      >
                        <span className="nav-menu-label">{it.label}</span>
                        {it.tag && <span className="nav-menu-tag">{it.tag}</span>}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
