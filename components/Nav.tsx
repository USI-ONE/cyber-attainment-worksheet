'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Grouped, dropdown-style navigation for the tenant portal.
 *
 * Static groups: Assess / Plan / Operate / Govern. Conditional group:
 *   - Settings — visible to any signed-in user, but only ever shows
 *     "My Account" on a tenant deploy. User-management (invite users,
 *     reset passwords, revoke invites, tenant administration) lives at
 *     the operator hub, not on individual tenant portals. This keeps
 *     identity centralized: every user signs in once at the hub and
 *     SSOs into the tenant they're assigned to.
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
      { href: '/recommendations', label: 'Recommendations',   tag: 'Practice-gap action checklist' },
      { href: '/risks',           label: 'Risk Register',     tag: 'Heat map + treatments' },
      { href: '/priorities',      label: '30-Day Priorities', tag: 'Sprint focus' },
      { href: '/work-plans',      label: 'Work Plans',        tag: 'Tactical tasks per control' },
      { href: '/dr-plans',        label: 'Disaster Recovery', tag: 'RTO/RPO + recovery procedures' },
      { href: '/ir-plans',        label: 'IR Playbooks',      tag: 'Per-category response runbooks' },
    ],
  },
  {
    id: 'operate',
    label: 'Operate',
    items: [
      { href: '/incidents', label: 'Incidents',         tag: 'Live + historical log' },
      { href: '/training',  label: 'Awareness Training', tag: 'Annual training + phishing simulations' },
      { href: '/vendors',   label: 'Vendor Risk',       tag: 'Third-party register + attestation tracking' },
      { href: '/registers', label: 'Registers',         tag: 'Assets, stakeholders, compliance' },
      { href: '/standards', label: 'Security Standards', tag: 'Control standards library' },
    ],
  },
  {
    id: 'govern',
    label: 'Govern',
    items: [
      { href: '/policies',  label: 'Policy Library',     tag: 'Standard-policy checklist with review cadence' },
      { href: '/policy',    label: 'Policy Documents',   tag: 'Cybersecurity policy + linked artifacts' },
      { href: '/evidence',  label: 'Evidence Library',   tag: 'Audit-ready artifact store' },
      { href: '/compliance', label: 'Compliance Progress', tag: 'Per-framework attainment dashboard' },
      { href: '/crosswalk', label: 'Compliance Crosswalk', tag: 'Per-control mapping drill-down' },
      { href: '/kpis',      label: 'Board KPIs',         tag: 'Executive metrics' },
    ],
  },
];

/** Settings group on a tenant deploy is now "My Account only" — every
 *  user-management responsibility (invite, role change, password reset,
 *  invite revoke, platform-wide admin) is owned by the operator hub. The
 *  canAdminister prop is still threaded through so we can re-introduce a
 *  per-tenant settings item later if needed; today it has no effect on
 *  what renders here. */
const SETTINGS_GROUP_ID = 'settings';
function buildSettingsGroup({ signedIn }: { signedIn: boolean }): NavGroup | null {
  if (!signedIn) return null;
  return {
    id: SETTINGS_GROUP_ID,
    label: 'Settings',
    items: [
      { href: '/settings/me', label: 'My Account', tag: 'Change password, view your access' },
    ],
  };
}

export default function Nav({
  signedIn = false,
  canAdminister = false,
  isPlatformAdmin = false,
}: {
  signedIn?: boolean;
  canAdminister?: boolean;
  isPlatformAdmin?: boolean;
}) {
  const pathname = usePathname();
  const [openId, setOpenId] = useState<string | null>(null);
  const navRef = useRef<HTMLDivElement>(null);

  // Build the visible groups list each render — cheap, and lets us
  // conditionally insert Settings / Admin based on role props. Settings
  // shows for any signed-in user (so viewers can reach My Account);
  // Admin stays platform-admin-only.
  const groups: NavGroup[] = [...STATIC_GROUPS];
  const settings = buildSettingsGroup({ signedIn });
  if (settings) groups.push(settings);
  // Admin nav group intentionally NOT injected here — admin tools live at
  // the operator hub (caw-portfolio-hub). Even platform admins reach them
  // from the hub, not from each tenant deploy.
  void canAdminister; void isPlatformAdmin;

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
