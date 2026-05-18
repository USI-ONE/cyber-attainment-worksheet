'use client';

import { useEffect, useState } from 'react';
import type { AttentionItem } from '@/lib/attention';

/**
 * Portfolio Watchlist card on /hub.
 *
 * Server (app/hub/page.tsx) gathers the cross-tenant critical/high
 * attention items and hands them in as `items`. This client component
 * adds the collapse-toggle behavior + localStorage persistence, mirroring
 * AttentionFeed.
 *
 * Items are pre-sorted server-side. The card supports two views:
 *   - expanded: full row list (current behavior)
 *   - collapsed: just the header + counts, row list hidden
 *
 * Persistence key is scoped to the hub so the dashboard's Needs Attention
 * collapse state lives separately.
 */

const COLLAPSED_STORAGE_KEY = 'caw_portfolio_watchlist_collapsed';

export interface WatchlistEntry {
  tenant: {
    id: string;
    display_name: string;
    url: string;
  };
  item: AttentionItem;
}

export default function PortfolioWatchlist({ items }: { items: WatchlistEntry[] }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1') setCollapsed(true);
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? '1' : '0'); } catch { /* noop */ }
      return next;
    });
  }

  const tenantCount = new Set(items.map((w) => w.tenant.id)).size;

  return (
    <section className="scorecard">
      <div className="scorecard-header">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand portfolio watchlist' : 'Collapse portfolio watchlist'}
          title={collapsed ? 'Show watchlist' : 'Hide watchlist'}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'transparent', border: 'none', padding: 0,
            cursor: 'pointer', textAlign: 'left', flex: '1 1 auto', minWidth: 0,
          }}
        >
          <svg
            width="14" height="14" viewBox="0 0 14 14"
            aria-hidden="true"
            style={{
              flexShrink: 0,
              transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
              transition: 'transform .15s ease',
              color: 'var(--text-mid)',
            }}
          >
            <path d="M3 5L7 9L11 5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ minWidth: 0 }}>
            <div className="scorecard-title">Portfolio Watchlist</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              {items.length === 0
                ? 'No critical or high items across the portfolio right now — clean board.'
                : collapsed
                  ? `${items.length} item${items.length === 1 ? '' : 's'} hidden — click to expand`
                  : `${items.length} critical / high item${items.length === 1 ? '' : 's'} across ${tenantCount} tenant${tenantCount === 1 ? '' : 's'}`}
            </div>
          </div>
        </button>
      </div>

      {!collapsed && (
        items.length === 0 ? (
          <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-mid)', fontSize: 13 }}>
            <span style={{ fontSize: 22, marginRight: 8, color: '#10B981' }}>✓</span>
            Nothing critical or high across all tenants.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map((w, idx) => {
              const sevColor = w.item.severity === 'critical' ? '#991B1B' : '#DC2626';
              const sevBg    = w.item.severity === 'critical' ? 'rgba(153,27,27,0.08)' : 'rgba(220,38,38,0.08)';
              return (
                <a
                  key={idx}
                  href={w.tenant.url + w.item.href}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'grid', gridTemplateColumns: '4px 1fr auto auto', gap: 12, alignItems: 'center',
                    padding: '10px 12px', background: sevBg,
                    borderRadius: 'var(--r-md)', textDecoration: 'none', color: 'var(--text)',
                  }}
                >
                  <span style={{ width: 4, height: 28, background: sevColor, borderRadius: 999 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 10, fontWeight: 700, color: sevColor,
                      textTransform: 'uppercase', letterSpacing: '.04em',
                    }}>
                      {w.tenant.display_name}
                    </div>
                    <div style={{ fontWeight: 600, fontSize: 13, marginTop: 1,
                                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {w.item.title}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-mid)', marginTop: 2 }}>
                      {w.item.detail}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: sevColor,
                    textTransform: 'uppercase', letterSpacing: '.04em',
                  }}>
                    {w.item.severity}
                  </span>
                  <span style={{ color: sevColor, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>
                    Open →
                  </span>
                </a>
              );
            })}
          </div>
        )
      )}
    </section>
  );
}
