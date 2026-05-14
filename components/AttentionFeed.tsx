'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AttentionItem, AttentionSeverity, AttentionKind } from '@/lib/attention';

/**
 * AttentionFeed — surfaces the items returned by lib/attention#computeAttention.
 * Renders as a single elevated card with severity tabs at the top and the
 * filtered list below. Each row links straight to the page where the user
 * can act on the item.
 */

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
  vendor_attestation_expired:  '⏱',
  vendor_attestation_expiring: '⏱',
  vendor_assessment_overdue:   '⏱',
  training_record_overdue:     '⏱',
  training_completion_low:     '⚠',
  phishing_click_rate_high:    '!',
};

export default function AttentionFeed({ items }: { items: AttentionItem[] }) {
  const [filter, setFilter] = useState<'ALL' | AttentionSeverity>('ALL');
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
        <div>
          <div className="scorecard-title">Needs Attention</div>
          <div className="scorecard-tag" style={{ marginTop: 4 }}>
            {items.length === 0
              ? 'Nothing requires action right now — clean dashboard.'
              : `${items.length} item${items.length === 1 ? '' : 's'} across risks, DR, IR, incidents, and priorities`}
          </div>
        </div>

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

      {items.length === 0 ? (
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
