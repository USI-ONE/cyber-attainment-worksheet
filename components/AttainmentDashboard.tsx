'use client';

import { useMemo } from 'react';
import type { CurrentScore, FrameworkDefinition } from '@/lib/supabase/types';
import { GROUP_COLORS } from '@/lib/scoring';
import { computeAttainment } from '@/lib/attainment';

type Scores = Record<string, Partial<CurrentScore>>;

/**
 * NIST CSF 2.0 Compliance Attainment — bar-chart breakdown shown above
 * the radar on every tenant dashboard. Answers "how close are we to the
 * goals we set for ourselves?" at a glance:
 *
 *   - Overall % attained across all measurable controls (those with a
 *     goal set), expressed as a single wide progress bar at the top.
 *   - One per-function bar (GV / ID / PR / DE / RS / RC) showing the same
 *     metric scoped to that function.
 *   - Right-side micro-stats: "M of N controls · avg 0.4 tier gap" so the
 *     reader sees both the discrete attainment AND the tightness of the
 *     miss on the controls that aren't there yet.
 *
 * Attainment math lives in lib/attainment.ts — same module would feed a
 * future printable board report if we want it.
 */
export default function AttainmentDashboard({
  definition,
  scores,
}: {
  definition: FrameworkDefinition;
  scores: Scores;
}) {
  const summary = useMemo(() => computeAttainment(definition, scores), [definition, scores]);

  // If nothing has a goal yet, render an empty-state card pointing at the
  // worksheet so the user knows where to set goals. Showing a "0% attained"
  // bar against a 0/0 denominator would look broken.
  if (summary.overall.total === 0) {
    return (
      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Compliance Attainment</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Progress toward NIST CSF 2.0 goals you set on the worksheet
            </div>
          </div>
        </div>
        <div style={{
          padding: '24px 8px', textAlign: 'center', color: 'var(--text-mid)', fontSize: 13,
        }}>
          No Goal scores set yet. <a href="/worksheet" style={{ color: 'var(--gold)', fontWeight: 600 }}>Open the worksheet</a>
          {' '}and choose a target tier for each control to see your attainment here.
        </div>
      </section>
    );
  }

  return (
    <section className="scorecard">
      <div className="scorecard-header" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <div className="scorecard-title">Compliance Attainment</div>
          <div className="scorecard-tag" style={{ marginTop: 4 }}>
            NIST CSF 2.0 · controls where current Practice meets or exceeds the Goal you set
          </div>
        </div>
        <div style={{
          fontFamily: 'Inter, sans-serif', fontVariantNumeric: 'tabular-nums',
          fontWeight: 700, fontSize: 28, color: 'var(--text)',
          textAlign: 'right',
        }}>
          {summary.overall.percent.toFixed(1)}%
          <div style={{
            fontSize: 11, fontWeight: 500, color: 'var(--text-mid)',
            letterSpacing: 0, marginTop: 2,
          }}>
            {summary.overall.attained} of {summary.overall.total} controls attained
          </div>
        </div>
      </div>

      {/* Overall progress bar */}
      <div style={{ marginTop: 8, marginBottom: 18 }}>
        <ProgressBar
          percent={summary.overall.percent}
          color="var(--gold)"
          height={14}
        />
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          marginTop: 6, fontSize: 11, color: 'var(--text-mid)',
        }}>
          <span>
            {summary.overall.unmeasured > 0 && (
              <>
                <strong style={{ color: 'var(--text)' }}>{summary.overall.unmeasured}</strong>{' '}
                awaiting Practice score
                {summary.overall.below > 0 && ' · '}
              </>
            )}
            {summary.overall.below > 0 && (
              <>
                <strong style={{ color: 'var(--text)' }}>{summary.overall.below}</strong>{' '}
                below goal · avg{' '}
                <strong style={{ color: 'var(--text)' }}>{summary.overall.gap_avg.toFixed(2)}</strong>{' '}
                tier gap
              </>
            )}
          </span>
          <a href="/recommendations" style={{ color: 'var(--gold)', fontWeight: 500 }}>
            View recommendations →
          </a>
        </div>
      </div>

      {/* Per-function bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {summary.functions.map((f) => {
          const color = GROUP_COLORS[f.group_id]?.accent ?? 'var(--gold)';
          return (
            <div key={f.group_id} style={{
              display: 'grid', gridTemplateColumns: '160px 1fr 110px',
              alignItems: 'center', gap: 14,
            }}>
              {/* Function label */}
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontWeight: 600, fontSize: 13, color: 'var(--text)',
                  display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <span style={{
                    display: 'inline-block', width: 8, height: 8,
                    borderRadius: 2, background: color,
                  }} />
                  {f.group_id}
                  <span style={{
                    fontWeight: 400, fontSize: 11, color: 'var(--text-mid)',
                  }}>{f.group_name}</span>
                </div>
              </div>

              {/* Progress bar */}
              <ProgressBar percent={f.percent} color={color} height={10} />

              {/* Right-side numbers */}
              <div style={{ textAlign: 'right' }}>
                <div style={{
                  fontFamily: 'Inter, sans-serif', fontVariantNumeric: 'tabular-nums',
                  fontWeight: 700, fontSize: 14, color: 'var(--text)',
                }}>{f.percent.toFixed(1)}%</div>
                <div style={{
                  fontSize: 10.5, color: 'var(--text-mid)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {f.attained}/{f.total}
                  {f.gap_avg > 0 && (
                    <span> · gap {f.gap_avg.toFixed(2)}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Generic horizontal progress bar with a flat shadcn look. Caps at 100%
 * visually even when the percent passes 100 (which can happen if every
 * control in a function has been over-achieved — gol exceeded — but the
 * label still shows the real number).
 */
function ProgressBar({ percent, color, height }: {
  percent: number;
  color: string;
  height: number;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div style={{
      width: '100%',
      height,
      background: 'var(--bg-card)',
      border: '1px solid var(--bg-border)',
      borderRadius: height / 2,
      overflow: 'hidden',
      position: 'relative',
    }}>
      <div style={{
        height: '100%',
        width: `${clamped}%`,
        background: color,
        borderRadius: height / 2,
        transition: 'width .25s ease',
      }} />
    </div>
  );
}
