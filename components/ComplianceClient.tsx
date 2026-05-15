'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type {
  ComplianceProgressSummary, TargetControlRow,
} from '@/lib/compliance-progress';

/**
 * /compliance — Cross-framework compliance progress dashboard.
 *
 * Each non-active framework gets its own tab. Inside the tab:
 *   - Overall % bar (attainment via inheritance) + KPI strip
 *   - Per-theme breakdown bars
 *   - Sortable / filterable list of all target controls with their
 *     inherited Practice score and source-mapping count
 *
 * "Attainment" is hard-coded to inherited_pra >= 3.0 — the same Defined-
 * tier threshold the NIST CSF attainment dashboard uses. The threshold
 * could become tenant-configurable later if anyone asks.
 */
export default function ComplianceClient({
  tenantName, sourceName, sourceVersion, summaries,
}: {
  tenantName: string;
  sourceName: string;
  sourceVersion: string;
  summaries: ComplianceProgressSummary[];
}) {
  const [activeIdx, setActiveIdx] = useState(0);

  if (summaries.length === 0) {
    return (
      <>
        <Header tenantName={tenantName} sourceName={sourceName} sourceVersion={sourceVersion} />
        <div className="placeholder">
          <h2>No other frameworks to track yet</h2>
          <p>
            The platform only has one framework loaded (your active one). When ISO 27001,
            CIS Controls, or another framework is added to the catalog and mapped to
            {' '}<strong>{sourceName}</strong>, that framework&apos;s attainment will appear here.
          </p>
        </div>
      </>
    );
  }

  const active = summaries[activeIdx];

  return (
    <>
      <Header tenantName={tenantName} sourceName={sourceName} sourceVersion={sourceVersion} />

      {/* Framework tab strip — one tab per non-active framework. Today
          there's just one (ISO 27001:2022); kept as tabs so adding CIS /
          HIPAA / SOC 2 later doesn't need a layout change. */}
      {summaries.length > 1 && (
        <div className="scorecard" style={{ padding: '6px 8px', display: 'flex', gap: 4, marginBottom: 14 }}>
          {summaries.map((s, idx) => (
            <button
              key={s.framework.framework_version_id}
              onClick={() => setActiveIdx(idx)}
              className={`nav-tab ${idx === activeIdx ? 'active' : ''}`}
              style={{ fontSize: 12, padding: '8px 14px' }}
            >
              {s.framework.display_name}
              <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: 11 }}>
                {s.framework.version}
              </span>
            </button>
          ))}
        </div>
      )}

      <FrameworkSection summary={active} sourceName={sourceName} sourceVersion={sourceVersion} />
    </>
  );
}

function Header({ tenantName, sourceName, sourceVersion }: {
  tenantName: string; sourceName: string; sourceVersion: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
          Compliance Progress
        </h1>
        <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-mid)' }}>
          {tenantName}&apos;s attainment toward other frameworks, inherited from{' '}
          <strong style={{ color: 'var(--text)' }}>{sourceName} {sourceVersion}</strong> via
          the crosswalk mappings.
        </div>
      </div>
      <Link href="/crosswalk" className="action-btn" style={{ textDecoration: 'none' }}>
        Per-control drill-down →
      </Link>
    </div>
  );
}

function FrameworkSection({ summary, sourceName, sourceVersion }: {
  summary: ComplianceProgressSummary;
  sourceName: string;
  sourceVersion: string;
}) {
  return (
    <>
      <section className="scorecard">
        <div className="scorecard-header" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div className="scorecard-title">{summary.framework.display_name}</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Inherited from {sourceName} {sourceVersion} · attainment threshold = 3.0 (&quot;Defined&quot;)
            </div>
          </div>
          <div style={{
            fontVariantNumeric: 'tabular-nums', fontWeight: 700, fontSize: 28, color: 'var(--text)',
            textAlign: 'right',
          }}>
            {summary.overall.percent.toFixed(1)}%
            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-mid)', marginTop: 2 }}>
              {summary.overall.attained} of {summary.overall.total} controls attained
            </div>
          </div>
        </div>

        {/* Overall bar */}
        <ProgressBar percent={summary.overall.percent} color="var(--gold)" height={14} />
        <div style={{ display: 'flex', gap: 18, marginTop: 8, fontSize: 11, color: 'var(--text-mid)', flexWrap: 'wrap' }}>
          <span><strong style={{ color: 'var(--text)' }}>{summary.overall.attained}</strong> attained (≥ 3.0)</span>
          <span><strong style={{ color: 'var(--text)' }}>{summary.overall.below}</strong> below threshold</span>
          <span><strong style={{ color: 'var(--text)' }}>{summary.overall.unmeasured}</strong> unmeasured (no mapping)</span>
          {summary.overall.avg_inherited_pra != null && (
            <span>avg inherited PRA: <strong style={{ color: 'var(--text)' }}>{summary.overall.avg_inherited_pra.toFixed(2)}</strong></span>
          )}
        </div>
      </section>

      {/* Per-theme breakdown */}
      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">By theme</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              {summary.framework.display_name} top-level groups · each bar = % of theme attained
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {summary.themes.map((t) => (
            <div key={t.group_id} style={{
              display: 'grid', gridTemplateColumns: '220px 1fr 140px',
              alignItems: 'center', gap: 14,
            }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>{t.group_id}</div>
                <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>{t.group_name}</div>
              </div>
              <ProgressBar percent={t.percent} color="var(--gold)" height={10} />
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontWeight: 700, fontSize: 14, color: 'var(--text)',
                  fontVariantNumeric: 'tabular-nums',
                }}>{t.percent.toFixed(1)}%</div>
                <div style={{ fontSize: 10.5, color: 'var(--text-mid)', fontVariantNumeric: 'tabular-nums' }}>
                  {t.attained}/{t.total}
                  {t.avg_inherited_pra != null && (
                    <span> · avg {t.avg_inherited_pra.toFixed(2)}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <ControlsTable controls={summary.controls} />
    </>
  );
}

function ControlsTable({ controls }: { controls: TargetControlRow[] }) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'attained' | 'below' | 'unmeasured'>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');

  const groups = useMemo(() => {
    const seen = new Set<string>();
    const out: { id: string; name: string }[] = [];
    for (const c of controls) {
      if (!seen.has(c.group_id)) { seen.add(c.group_id); out.push({ id: c.group_id, name: c.group_name }); }
    }
    return out;
  }, [controls]);

  const visible = useMemo(() => controls.filter((c) =>
    (statusFilter === 'all' || c.status === statusFilter) &&
    (groupFilter === 'all' || c.group_id === groupFilter),
  ), [controls, statusFilter, groupFilter]);

  return (
    <section className="scorecard">
      <div className="scorecard-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="scorecard-title">All target controls</div>
          <div className="scorecard-tag" style={{ marginTop: 4 }}>
            Sorted by inherited Practice score · {controls.length} total
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>All</Chip>
          <Chip active={statusFilter === 'attained'} onClick={() => setStatusFilter('attained')} accent="#10B981">Attained</Chip>
          <Chip active={statusFilter === 'below'} onClick={() => setStatusFilter('below')} accent="#F59E0B">Below</Chip>
          <Chip active={statusFilter === 'unmeasured'} onClick={() => setStatusFilter('unmeasured')} accent="#94A3B8">Unmeasured</Chip>
          <span style={{ width: 1, background: 'var(--bg-border)', margin: '0 4px' }} />
          <select
            className="score-select"
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            style={{ fontSize: 12, padding: '4px 10px' }}
          >
            <option value="all">All themes</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.id} — {g.name}</option>)}
          </select>
        </div>
      </div>

      <table className="score-table">
        <thead>
          <tr>
            <th>Control</th>
            <th>Category</th>
            <th>Outcome</th>
            <th style={{ textAlign: 'right' }}>Inherited PRA</th>
            <th style={{ textAlign: 'right' }}>Sources</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 && (
            <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0' }}>
              No controls match the current filter.
            </td></tr>
          )}
          {visible.map((c) => (
            <tr key={c.control_id}>
              <td><code style={{ fontWeight: 700, color: 'var(--gold-light)' }}>{c.control_id}</code></td>
              <td style={{ fontSize: 11, color: 'var(--text-mid)' }}>{c.category_name}</td>
              <td style={{
                fontSize: 12, color: 'var(--text)', maxWidth: 460,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{c.outcome}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {c.inherited_pra != null
                  ? <strong style={{ color: 'var(--text)' }}>{c.inherited_pra.toFixed(2)}</strong>
                  : <span style={{ color: 'var(--text-muted)' }}>—</span>}
              </td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--text-mid)', fontSize: 11 }}>
                {c.source_count}
              </td>
              <td>
                <StatusPill status={c.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ProgressBar({ percent, color, height }: { percent: number; color: string; height: number }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div style={{
      width: '100%', height,
      background: 'var(--bg-card)', border: '1px solid var(--bg-border)',
      borderRadius: height / 2, overflow: 'hidden', position: 'relative',
    }}>
      <div style={{
        height: '100%', width: `${clamped}%`,
        background: color, borderRadius: height / 2,
        transition: 'width .25s ease',
      }} />
    </div>
  );
}

function Chip({ active, accent, onClick, children }: {
  active: boolean; accent?: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button" onClick={onClick}
      style={{
        padding: '5px 10px', fontSize: 12, fontWeight: 500,
        border: `1px solid ${active ? (accent ?? 'var(--gold)') : 'var(--bg-border)'}`,
        background: active ? (accent ? `${accent}14` : 'var(--gold-pale)') : 'var(--bg-mid)',
        color: active ? (accent ?? 'var(--gold)') : 'var(--text-mid)',
        borderRadius: 999, cursor: 'pointer',
      }}
    >{children}</button>
  );
}

function StatusPill({ status }: { status: TargetControlRow['status'] }) {
  const map = {
    attained: { color: '#10B981', label: 'Attained' },
    below:    { color: '#F59E0B', label: 'Below' },
    unmeasured: { color: '#94A3B8', label: 'Unmeasured' },
  } as const;
  const { color, label } = map[status];
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px',
      background: `${color}1a`, color, border: `1px solid ${color}55`,
      borderRadius: 999, fontSize: 11, fontWeight: 600,
    }}>{label}</span>
  );
}
