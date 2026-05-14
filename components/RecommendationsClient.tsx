'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ControlGap, GapSeverity } from '@/lib/recommendations';
import { GROUP_COLORS } from '@/lib/scoring';

/**
 * /recommendations page UI. Renders a KPI strip + a master gap list. Each
 * row expands into the recommendation checklist for that control.
 *
 * State the client owns:
 *   - severity filter   (default: 'all')
 *   - function filter   (group_id from the framework, default: 'all')
 *   - expanded rows     (Set<control_id>)
 *   - "completed" recs  (Map<control_id, Set<rec_id>>) — purely local so the
 *     user can cross things off as they go. Not persisted yet (a future
 *     `recommendation_checks` table is the natural home).
 *
 * Bookmarking a specific control opens it expanded on load — handy when
 * someone is working off a printed PDF and wants to update the in-app view.
 */

type Summary = {
  total_gaps: number;
  critical: number;
  high: number;
  moderate: number;
  minor: number;
  total_recommendations: number;
  avg_gap: number;
};

interface Props {
  tenantName: string;
  frameworkName: string;
  frameworkVersion: string;
  gaps: ControlGap[];
  summary: Summary;
}

const SEVERITY_LABEL: Record<GapSeverity, string> = {
  critical: 'Critical',
  high:     'High',
  moderate: 'Moderate',
  minor:    'Minor',
};
const SEVERITY_COLOR: Record<GapSeverity, string> = {
  critical: '#DC2626',  // red-600
  high:     '#EA580C',  // orange-600
  moderate: '#F59E0B',  // amber-500
  minor:    '#64748B',  // slate-500
};

export default function RecommendationsClient({
  tenantName, frameworkName, frameworkVersion, gaps, summary,
}: Props) {
  const [sevFilter, setSevFilter] = useState<'all' | GapSeverity>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Map<string, Set<string>>>(new Map());

  const groups = useMemo(() => {
    // Distinct group_ids in display order. Preserve original order from the
    // gap list (already framework-ordered by buildGapAnalysis's walk).
    const seen = new Set<string>();
    const out: { id: string; name: string }[] = [];
    for (const g of gaps) {
      if (!seen.has(g.group_id)) {
        seen.add(g.group_id);
        out.push({ id: g.group_id, name: g.group_name });
      }
    }
    return out;
  }, [gaps]);

  const filtered = useMemo(() => {
    return gaps.filter((g) => {
      if (sevFilter !== 'all' && g.severity !== sevFilter) return false;
      if (groupFilter !== 'all' && g.group_id !== groupFilter) return false;
      return true;
    });
  }, [gaps, sevFilter, groupFilter]);

  function toggleExpanded(controlId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(controlId)) next.delete(controlId); else next.add(controlId);
      return next;
    });
  }
  function toggleChecked(controlId: string, recId: string) {
    setChecked((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(controlId) ?? []);
      if (set.has(recId)) set.delete(recId); else set.add(recId);
      next.set(controlId, set);
      return next;
    });
  }
  function isChecked(controlId: string, recId: string): boolean {
    return checked.get(controlId)?.has(recId) ?? false;
  }
  function progressFor(g: ControlGap): { done: number; total: number } {
    const total = g.recommendations.length;
    const done = (checked.get(g.control_id)?.size ?? 0);
    return { done: Math.min(done, total), total };
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
            Practice Gap Recommendations
          </h1>
          <div style={{ marginTop: 4, fontSize: 13, color: 'var(--text-mid)' }}>
            Every control where {tenantName}&apos;s Practice score is below the goal — with the next action that closes the gap.
            <span style={{ marginLeft: 8, color: 'var(--text-dim)' }}>
              {frameworkName} {frameworkVersion}
            </span>
          </div>
        </div>
        <a
          href="/api/report/recommendations"
          className="action-btn primary"
          target="_blank"
          rel="noopener"
          style={{ textDecoration: 'none' }}
        >
          Generate PDF
        </a>
      </div>

      {/* KPI strip */}
      <div className="kpi-row">
        <KpiTile label="Controls with gaps" value={summary.total_gaps} sub="below the goal you set" />
        <KpiTile label="Critical" value={summary.critical} sub="≥ 2 tier gap" accent={SEVERITY_COLOR.critical} />
        <KpiTile label="High" value={summary.high} sub="≥ 1.5 tier gap" accent={SEVERITY_COLOR.high} />
        <KpiTile label="Action items" value={summary.total_recommendations} sub={`avg ${summary.avg_gap} tier gap`} />
      </div>

      {gaps.length === 0 && (
        <div className="placeholder">
          <h2>No gaps to recommend on</h2>
          <p>
            Every control is at or above its goal — or no goals have been set yet on{' '}
            <Link href="/worksheet">the worksheet</Link>. Set a Goal score on each control to surface targeted recommendations here.
          </p>
        </div>
      )}

      {gaps.length > 0 && (
        <>
          {/* Filters */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14,
            padding: '12px 14px', background: 'var(--bg-mid)', border: '1px solid var(--bg-border)',
            borderRadius: 'var(--r-md)',
          }}>
            <span style={{ fontSize: 12, color: 'var(--text-mid)', alignSelf: 'center', marginRight: 4, fontWeight: 600 }}>Severity</span>
            <FilterChip active={sevFilter === 'all'} onClick={() => setSevFilter('all')}>All</FilterChip>
            {(['critical', 'high', 'moderate', 'minor'] as GapSeverity[]).map((s) => (
              <FilterChip key={s} active={sevFilter === s} onClick={() => setSevFilter(s)} accent={SEVERITY_COLOR[s]}>
                {SEVERITY_LABEL[s]}
              </FilterChip>
            ))}
            <span style={{ width: 1, background: 'var(--bg-border)', margin: '0 6px' }} />
            <span style={{ fontSize: 12, color: 'var(--text-mid)', alignSelf: 'center', marginRight: 4, fontWeight: 600 }}>Function</span>
            <FilterChip active={groupFilter === 'all'} onClick={() => setGroupFilter('all')}>All</FilterChip>
            {groups.map((g) => (
              <FilterChip
                key={g.id}
                active={groupFilter === g.id}
                onClick={() => setGroupFilter(g.id)}
                accent={GROUP_COLORS[g.id]?.accent ?? 'var(--gold)'}
              >
                {g.name}
              </FilterChip>
            ))}
          </div>

          {/* Gap list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((g) => {
              const isOpen = expanded.has(g.control_id);
              const accent = GROUP_COLORS[g.group_id]?.accent ?? 'var(--gold)';
              const prog = progressFor(g);
              return (
                <div
                  key={g.control_id}
                  style={{
                    background: 'var(--bg-mid)', border: '1px solid var(--bg-border)',
                    borderRadius: 'var(--r-lg)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
                  }}
                >
                  {/* Header row */}
                  <button
                    type="button"
                    onClick={() => toggleExpanded(g.control_id)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto auto auto',
                      alignItems: 'center', gap: 14,
                      width: '100%', padding: '14px 18px', border: 'none', background: 'transparent',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    {/* Severity chip */}
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: 0,
                      padding: '4px 8px', borderRadius: 999,
                      background: `${SEVERITY_COLOR[g.severity]}1a`,
                      color: SEVERITY_COLOR[g.severity],
                      border: `1px solid ${SEVERITY_COLOR[g.severity]}55`,
                      whiteSpace: 'nowrap', textTransform: 'uppercase',
                    }}>
                      {SEVERITY_LABEL[g.severity]}
                    </span>

                    {/* Control + outcome */}
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                        <code style={{
                          fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 13,
                          color: accent,
                        }}>{g.control_id}</code>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{g.category_name}</span>
                      </div>
                      <div style={{
                        fontSize: 13, color: 'var(--text)', marginTop: 2,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{g.outcome}</div>
                    </div>

                    {/* Tier transition */}
                    <span style={{
                      fontSize: 12, color: 'var(--text-mid)', whiteSpace: 'nowrap',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      <strong style={{ color: 'var(--text)' }}>{g.current_tier}</strong>
                      <span style={{ margin: '0 6px', color: 'var(--text-muted)' }}>→</span>
                      <strong style={{ color: 'var(--text)' }}>{g.target_tier}</strong>
                    </span>

                    {/* Gap badge */}
                    <span style={{
                      fontFamily: 'Inter, sans-serif', fontVariantNumeric: 'tabular-nums',
                      fontWeight: 700, fontSize: 14, color: SEVERITY_COLOR[g.severity],
                      minWidth: 48, textAlign: 'right',
                    }}>
                      +{g.gap.toFixed(1)}
                    </span>

                    {/* Expand chevron */}
                    <svg
                      width="14" height="14" viewBox="0 0 14 14"
                      style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform .15s ease', color: 'var(--text-dim)' }}
                      aria-hidden="true"
                    >
                      <path d="M3 5L7 9L11 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>

                  {/* Expanded body */}
                  {isOpen && (
                    <div style={{
                      padding: '0 18px 16px 18px', borderTop: '1px solid var(--bg-border)',
                    }}>
                      {/* Meta strip: progress + owner + assessment Q snapshot + jump-link */}
                      <div style={{
                        display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center',
                        padding: '12px 0', fontSize: 12, color: 'var(--text-mid)',
                      }}>
                        <span>
                          <strong style={{ color: 'var(--text)' }}>{prog.done}/{prog.total}</strong> actions complete
                        </span>
                        {g.owner && (
                          <span>· Owner: <strong style={{ color: 'var(--text)' }}>{g.owner}</strong></span>
                        )}
                        <span>· Assessment:
                          <AssessmentDot value={g.q1} label="Q1" />
                          <AssessmentDot value={g.q2} label="Q2" />
                          <AssessmentDot value={g.q3} label="Q3" />
                          <AssessmentDot value={g.q4 ? 'yes' : 'no'} label="Q4" />
                        </span>
                        <span style={{ marginLeft: 'auto' }}>
                          <Link href={`/assessment/${g.control_id}` as never}
                                style={{ color: 'var(--gold)', fontWeight: 500 }}>
                            Edit assessment →
                          </Link>
                        </span>
                      </div>

                      {/* Recommendation checklist */}
                      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {g.recommendations.map((r) => {
                          const done = isChecked(g.control_id, r.id);
                          return (
                            <li
                              key={r.id}
                              style={{
                                display: 'flex', gap: 10, alignItems: 'flex-start',
                                padding: '10px 12px',
                                background: done ? 'var(--gold-pale)' : 'var(--bg)',
                                border: '1px solid var(--bg-border)',
                                borderRadius: 'var(--r-md)',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={done}
                                onChange={() => toggleChecked(g.control_id, r.id)}
                                style={{ marginTop: 3 }}
                                aria-label={`Mark recommendation complete: ${r.action}`}
                              />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                  fontSize: 13, fontWeight: 600,
                                  color: done ? 'var(--text-mid)' : 'var(--text)',
                                  textDecoration: done ? 'line-through' : 'none',
                                }}>
                                  {r.action}
                                </div>
                                <div style={{
                                  fontSize: 11.5, color: 'var(--text-mid)', marginTop: 3, lineHeight: 1.5,
                                }}>
                                  {r.why}
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

function KpiTile({ label, value, sub, accent }: {
  label: string; value: number; sub?: string; accent?: string;
}) {
  return (
    <div className="kpi-tile" style={accent ? { ['--accent' as never]: accent } : undefined}>
      <div className="kpi-tile-label" style={accent ? { color: accent } : undefined}>{label}</div>
      <div className="kpi-tile-value">{value}</div>
      {sub && <div className="kpi-tile-sub">{sub}</div>}
    </div>
  );
}

function FilterChip({ active, accent, onClick, children }: {
  active: boolean; accent?: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 10px', fontSize: 12, fontWeight: 500,
        border: `1px solid ${active ? (accent ?? 'var(--gold)') : 'var(--bg-border)'}`,
        background: active ? (accent ? `${accent}14` : 'var(--gold-pale)') : 'var(--bg-mid)',
        color: active ? (accent ?? 'var(--gold)') : 'var(--text-mid)',
        borderRadius: 999, cursor: 'pointer',
        transition: 'background .12s ease, border-color .12s ease, color .12s ease',
      }}
    >
      {children}
    </button>
  );
}

function AssessmentDot({ value, label }: { value: 'no' | 'partial' | 'yes' | null; label: string }) {
  const color =
    value === 'yes' ? '#10B981' :
    value === 'partial' ? '#F59E0B' :
    value === 'no' ? '#DC2626' :
    '#CBD5E1';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 6,
    }} title={`${label}: ${value ?? 'unanswered'}`}>
      <span style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
        background: color,
      }} />
      <span style={{ fontSize: 10.5, color: 'var(--text-dim)', fontWeight: 600 }}>{label}</span>
    </span>
  );
}
