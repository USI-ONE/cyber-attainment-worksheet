'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { AssessmentResponse, FrameworkDefinition } from '@/lib/supabase/types';
import { GROUP_COLORS, controlsOf } from '@/lib/scoring';
import { isComplete, tierForScore } from '@/lib/assessment';

/**
 * Landing page for the guided Practice assessment. Shows overall progress,
 * per-function progress bars, and a per-control list with each control's
 * current Practice score and answered/not-answered indicator. Click any
 * control to jump into the wizard there.
 */
export default function AssessmentLanding({
  definition,
  initialResponses,
}: {
  definition: FrameworkDefinition;
  initialResponses: AssessmentResponse[];
}) {
  const [filter, setFilter] = useState<'ALL' | string>('ALL');
  const responsesByControl = useMemo(() => {
    const m = new Map<string, AssessmentResponse>();
    for (const r of initialResponses) m.set(r.control_id, r);
    return m;
  }, [initialResponses]);

  // Per-function progress: complete = all 3 questions answered.
  const perFunction = definition.groups.map((g) => {
    const ctrls = controlsOf(g);
    const total = ctrls.length;
    let done = 0;
    for (const c of ctrls) {
      const r = responsesByControl.get(c.id);
      if (r && isComplete(r)) done++;
    }
    return { id: g.id, name: g.name, total, done };
  });
  const totalControls = perFunction.reduce((a, b) => a + b.total, 0);
  const totalDone = perFunction.reduce((a, b) => a + b.done, 0);
  const overallPct = totalControls ? Math.round((totalDone / totalControls) * 100) : 0;

  // Pick the next un-answered control for the "Resume" button.
  const nextControl = (() => {
    for (const g of definition.groups) {
      for (const cat of g.categories) {
        for (const ctrl of cat.controls) {
          const r = responsesByControl.get(ctrl.id);
          if (!r || !isComplete(r)) return ctrl.id;
        }
      }
    }
    return definition.groups[0]?.categories[0]?.controls[0]?.id ?? null;
  })();

  const visibleGroups = filter === 'ALL'
    ? definition.groups
    : definition.groups.filter((g) => g.id === filter);

  return (
    <>
      {/* Header + progress */}
      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Practice Assessment</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Guided questionnaire that scores the Practice column control-by-control · {totalDone} of {totalControls} complete ({overallPct}%)
            </div>
          </div>
          {nextControl && (
            <Link className="action-btn primary" href={`/assessment/${nextControl}` as never}>
              {totalDone === 0 ? 'Start →' : 'Resume →'}
            </Link>
          )}
        </div>

        {/* Per-function progress bars */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, marginTop: 12,
        }}>
          {perFunction.map((f) => {
            const c = GROUP_COLORS[f.id] ?? { accent: '#C9A961' };
            const pct = f.total ? Math.round((f.done / f.total) * 100) : 0;
            return (
              <div key={f.id} style={{
                border: '1px solid var(--bg-border)',
                borderRadius: 4, padding: '8px 10px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{
                    fontFamily: 'Oswald, sans-serif', fontWeight: 600, fontSize: 11,
                    color: c.accent, letterSpacing: '0.06em',
                  }}>{f.id}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{f.done}/{f.total}</span>
                </div>
                <div style={{
                  width: '100%', height: 4, background: 'var(--bg-deep)',
                  borderRadius: 2, overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${pct}%`, height: '100%', background: c.accent,
                    transition: 'width 0.3s',
                  }} />
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
                  {f.name}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Function filter pills */}
      <section className="scorecard" style={{ paddingBottom: 6 }}>
        <div className="fn-filters">
          <button className={`fn-btn ${filter === 'ALL' ? 'active' : ''}`} onClick={() => setFilter('ALL')}>All</button>
          {definition.groups.map((g) => (
            <button
              key={g.id}
              className={`fn-btn ${filter === g.id ? 'active' : ''}`}
              onClick={() => setFilter(g.id)}
            >
              {g.id} ({perFunction.find((f) => f.id === g.id)?.done ?? 0}/{perFunction.find((f) => f.id === g.id)?.total ?? 0})
            </button>
          ))}
        </div>
      </section>

      {/* Control list */}
      {visibleGroups.map((g) => {
        const c = GROUP_COLORS[g.id] ?? { accent: '#C9A961' };
        return (
          <section className="scorecard" key={g.id}>
            <div className="scorecard-header">
              <div>
                <div className="scorecard-title" style={{ color: c.accent }}>
                  {g.id} · {g.name}
                </div>
              </div>
            </div>
            <table className="score-table" style={{ marginTop: 0 }}>
              <thead>
                <tr>
                  <th>Control</th>
                  <th>Outcome</th>
                  <th className="num">Practice</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {g.categories.flatMap((cat) =>
                  cat.controls.map((ctrl) => {
                    const r = responsesByControl.get(ctrl.id);
                    const complete = r ? isComplete(r) : false;
                    const score = r?.computed_score ?? null;
                    return (
                      <tr key={ctrl.id}>
                        <td><code style={{ color: c.accent, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{ctrl.id}</code></td>
                        <td style={{ fontSize: 12, color: 'var(--text-mid)', maxWidth: 480 }}>{ctrl.outcome}</td>
                        <td className="num score-num">
                          {score != null ? score.toFixed(1) : <span className="empty">—</span>}
                        </td>
                        <td style={{ fontSize: 11 }}>
                          {complete ? (
                            <span style={{ color: '#86D69E' }}>✓ {tierForScore(score)}</span>
                          ) : r ? (
                            <span style={{ color: 'var(--gold-light)' }}>● In progress</span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>○ Not started</span>
                          )}
                        </td>
                        <td>
                          <Link className="action-btn" href={`/assessment/${ctrl.id}` as never}>
                            {complete ? 'Review' : r ? 'Continue' : 'Start'}
                          </Link>
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </section>
        );
      })}
    </>
  );
}
