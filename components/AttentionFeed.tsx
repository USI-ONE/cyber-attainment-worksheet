'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AttentionItem, AttentionSeverity, AttentionKind } from '@/lib/attention';

/**
 * AttentionFeed — surfaces the items returned by lib/attention#computeAttention.
 * Renders as a single elevated card with severity tabs at the top and the
 * filtered list below. Each row links straight to the page where the user
 * can act on the item.
 *
 * Collapsible. The user can hide the row list while keeping the
 * severity counters visible — useful for a returning visitor who's
 * already triaged. Preference is stashed in localStorage so the
 * collapsed state persists across page loads on this device.
 */
const COLLAPSED_STORAGE_KEY = 'caw_attention_feed_collapsed';

const SEV_META: Record<AttentionSeverity, { color: string; label: string; bg: string }> = {
  critical: { color: '#991B1B', label: 'Critical', bg: 'rgba(153,27,27,0.08)' },
  high:     { color: '#DC2626', label: 'High',     bg: 'rgba(220,38,38,0.08)' },
  medium:   { color: '#F59E0B', label: 'Medium',   bg: 'rgba(245,158,11,0.08)' },
  low:      { color: '#475569', label: 'Low',      bg: 'rgba(71,85,105,0.06)' },
};

const KIND_LABEL: Record<AttentionKind, string> = {
  high_risk_untreated:     'Risk — no treatment in flight',
  high_risk_no_treatments: 'Risk — no treatments logged',
  risk_review_overdue:     'Risk — review overdue',
  dr_test_overdue:         'DR plan — test overdue',
  dr_test_failed:          'DR plan — last test failed',
  playbook_review_overdue: 'IR playbook — review overdue',
  incident_open_critical:  'Incident — open high/critical',
  priority_overdue:        'Priority — overdue',
  task_overdue:            'Work plan task — overdue',
  evidence_expired:           'Evidence — retention expired',
  evidence_expiring:          'Evidence — expiring soon',
  evidence_review_overdue:    'Evidence — review overdue',
  evidence_review_due_soon:   'Evidence — review due soon',
  vendor_attestation_expired:  'Vendor — attestation expired',
  vendor_attestation_expiring: 'Vendor — attestation expiring',
  vendor_assessment_overdue:   'Vendor — assessment overdue',
  training_record_overdue:     'Training — records overdue',
  training_completion_low:     'Training — completion low',
  phishing_click_rate_high:    'Phishing — elevated click rate',
};

const KIND_ICON: Record<AttentionKind, string> = {
  high_risk_untreated:     '⚠',
  high_risk_no_treatments: '⚠',
  risk_review_overdue:     '⏱',
  dr_test_overdue:         '⏱',
  dr_test_failed:          '✕',
  playbook_review_overdue: '⏱',
  incident_open_critical:  '!',
  priority_overdue:        '⏱',
  task_overdue:            '⏱',
  evidence_expired:            '⏱',
  evidence_expiring:           '⏱',
  evidence_review_overdue:     '⏱',
  evidence_review_due_soon:    '⏱',
  vendor_attestation_expired:  '⏱',
  vendor_attestation_expiring: '⏱',
  vendor_assessment_overdue:   '⏱',
  training_record_overdue:     '⏱',
  training_completion_low:     '⚠',
  phishing_click_rate_high:    '!',
};

export default function AttentionFeed({ items }: { items: AttentionItem[] }) {
  const [filter, setFilter] = useState<'ALL' | AttentionSeverity>('ALL');
  // Collapsed defaults to false so first-time visitors see the feed. The
  // initial render on both server and client uses this default, then a
  // useEffect on mount overrides from localStorage. The two-step
  // assignment avoids hydration mismatch warnings.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1') {
        setCollapsed(true);
      }
    } catch {
      /* localStorage unavailable (private mode, SSR) — fall back to expanded */
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try { window.localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? '1' : '0'); } catch { /* noop */ }
      return next;
    });
  }

  const counts = {
    critical: items.filter((i) => i.severity === 'critical').length,
    high:     items.filter((i) => i.severity === 'high').length,
    medium:   items.filter((i) => i.severity === 'medium').length,
    low:      items.filter((i) => i.severity === 'low').length,
  };
  const visible = filter === 'ALL' ? items : items.filter((i) => i.severity === filter);

  return (
    <section className="scorecard" style={{ marginBottom: 18 }}>
      <div className="scorecard-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand needs-attention feed' : 'Collapse needs-attention feed'}
          title={collapsed ? 'Show notifications' : 'Hide notifications'}
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
            <div className="scorecard-title">Needs Attention</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              {items.length === 0
                ? 'Nothing requires action right now — clean dashboard.'
                : collapsed
                  ? `${items.length} item${items.length === 1 ? '' : 's'} hidden — click to expand`
                  : `${items.length} item${items.length === 1 ? '' : 's'} across risks, DR, IR, incidents, and priorities`}
            </div>
          </div>
        </button>

        {items.length > 0 && (
          <div className="fn-filters">
            <button className={`fn-btn ${filter === 'ALL' ? 'active' : ''}`} onClick={() => setFilter('ALL')}>
              All · {items.length}
            </button>
            {(['critical', 'high', 'medium', 'low'] as AttentionSeverity[]).map((s) => (
              counts[s] > 0 && (
                <button
                  key={s}
                  className={`fn-btn ${filter === s ? 'active' : ''}`}
                  onClick={() => setFilter(s)}
                  style={filter === s ? {
                    background: SEV_META[s].color, borderColor: SEV_META[s].color, color: '#fff',
                  } : { color: SEV_META[s].color, borderColor: `${SEV_META[s].color}55` }}
                >
                  {SEV_META[s].label} · {counts[s]}
                </button>
              )
            ))}
          </div>
        )}
      </div>

      {/* Body is hidden when the user has collapsed the card. The
          counters/filter chips above stay visible so the user still sees
          at-a-glance severity totals even while collapsed. */}
      {!collapsed && (
        items.length === 0 ? (
          <div style={{
            padding: '20px 0', textAlign: 'center', color: 'var(--text-mid)', fontSize: 13,
          }}>
            <span style={{ fontSize: 22, marginRight: 8, color: '#10B981' }}>✓</span>
            No risks, DR tests, playbooks, incidents, priorities, or tasks need attention right now.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {visible.map((it, idx) => (
              <AttentionRow key={idx} item={it} />
            ))}
            {visible.length === 0 && (
              <div style={{ padding: '16px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                No {filter} items.
              </div>
            )}
          </div>
        )
      )}
    </section>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const meta = SEV_META[item.severity];
  return (
    <Link
      href={item.href as never}
      style={{
        display: 'grid',
        gridTemplateColumns: '4px 28px 1fr auto',
        gap: 12, alignItems: 'center',
        padding: '10px 12px',
        background: meta.bg,
        borderRadius: 'var(--r-md)',
        border: '1px solid transparent',
        textDecoration: 'none',
        color: 'var(--text)',
        transition: 'border-color .12s ease, transform .12s ease',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = `${meta.color}55`; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'transparent'; }}
    >
      <span style={{
        width: 4, height: 28, background: meta.color, borderRadius: 999,
      }} />
      <span style={{
        width: 28, height: 28, borderRadius: '50%',
        background: meta.color,
        color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, fontWeight: 700, lineHeight: 1,
      }}>
        {KIND_ICON[item.kind]}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            {KIND_LABEL[item.kind]}
          </span>
          {item.age_days != null && item.age_days > 0 && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'Inter, sans-serif' }}>
              {item.age_days}d old
            </span>
          )}
        </div>
        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginTop: 1,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.title}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--text-mid)', marginTop: 2 }}>
          {item.detail}
        </div>
      </div>
      <span style={{
        color: meta.color, fontWeight: 600, fontSize: 12,
        whiteSpace: 'nowrap', marginLeft: 8,
      }}>
        Open →
      </span>
    </Link>
  );
}
