'use client';

import { useMemo } from 'react';
import type { CurrentScore, FrameworkDefinition } from '@/lib/supabase/types';
import {
  GROUP_COLORS,
  computeGroupAverages,
  computeCategoryAverages,
  computeOverallTotals,
  type GroupAverage,
} from '@/lib/scoring';
import Radar from '@/components/Radar';

type Scores = Record<string, Partial<CurrentScore>>;

export default function SummaryDashboard({
  definition,
  scores,
}: {
  definition: FrameworkDefinition;
  scores: Scores;
}) {
  const avgs = useMemo(() => computeGroupAverages(definition, scores), [definition, scores]);
  const catAvgs = useMemo(() => computeCategoryAverages(definition, scores), [definition, scores]);
  const totals = useMemo(() => computeOverallTotals(avgs), [avgs]);

  return (
    <>
      <KpiTiles totals={totals} />

      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Executive Scorecard</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Policy · Practice · Goal — radar plots {catAvgs.length} categories grouped under the 6 functions
            </div>
          </div>
        </div>
        <div className="scorecard-grid">
          <div className="radar-wrap">
            <Radar avgs={catAvgs} />
            <div className="radar-legend">
              <Legend swatch="#C9A961" label="Policy" />
              <Legend swatch="#F59E0B" label="Practice" />
              <Legend swatch="#22C55E" label="Goal" />
            </div>
          </div>
          <div>
            <FunctionTable avgs={avgs} totals={totals} />
          </div>
        </div>
      </section>

      <DashboardCards definition={definition} scores={scores} />
    </>
  );
}

function KpiTiles({ totals }: { totals: ReturnType<typeof computeOverallTotals> }) {
  const fmt = (n: number | null) => (n == null ? '—' : n.toFixed(2));
  const gap = totals.gap;
  const gapStr = gap == null ? '—' : (gap > 0 ? '+' : '') + gap.toFixed(2);
  const gapAccent = gap == null ? '#9AAEC1' : gap > 0 ? '#FCA5A5' : '#86D69E';
  return (
    <div className="kpi-row">
      <Tile label="Avg Policy"   value={fmt(totals.pol_avg)} sub={`${totals.scored_pol}/${totals.total} scored`} accent="#C9A961" />
      <Tile label="Avg Practice" value={fmt(totals.pra_avg)} sub={`${totals.scored_pra}/${totals.total} scored`} accent="#F59E0B" />
      <Tile label="Avg Goal"     value={fmt(totals.gol_avg)} sub={`${totals.scored_gol}/${totals.total} scored`} accent="#22C55E" />
      <Tile label="Gap to Goal"  value={gapStr} sub={gap == null ? 'awaiting scores' : gap > 0 ? 'below target' : 'meeting target'} accent={gapAccent} />
    </div>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="kpi-tile" style={{ ['--accent' as never]: accent }}>
      <div className="kpi-tile-label">{label}</div>
      <div className="kpi-tile-value">{value}</div>
      <div className="kpi-tile-sub">{sub}</div>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <div className="radar-legend-item">
      <span className="radar-legend-swatch" style={{ background: swatch }} />
      <span>{label}</span>
    </div>
  );
}

function FunctionTable({ avgs, totals }: { avgs: GroupAverage[]; totals: ReturnType<typeof computeOverallTotals> }) {
  const cell = (n: number, cls: string) =>
    !n ? <span className="score-num empty">—</span> : <span className={`score-num ${cls}`}>{n.toFixed(2)}</span>;

  return (
    <table className="score-table">
      <thead>
        <tr>
          <th>Function</th>
          <th className="num">Policy</th>
          <th className="num">Practice</th>
          <th className="num">Goal</th>
          <th className="num">Gap</th>
          <th className="num">Scored</th>
        </tr>
      </thead>
      <tbody>
        {avgs.map((a) => {
          const c = GROUP_COLORS[a.group_id] ?? { accent: '#C9A961', text: '#E8D29B', bg: '' };
          const gap = a.pra && a.gol ? a.gol - a.pra : null;
          const gapCls = gap == null ? 'empty' : gap > 0 ? 'positive' : 'zero';
          return (
            <tr key={a.group_id}>
              <td>
                <div className="score-fn-cell">
                  <span className="score-fn-dot" style={{ background: c.accent }} />
                  <span className="score-fn-code" style={{ color: c.accent }}>{a.group_id}</span>
                  <span className="score-fn-name">{a.group_name}</span>
                </div>
              </td>
              <td className="num">{cell(a.pol, 'policy')}</td>
              <td className="num">{cell(a.pra, 'practice')}</td>
              <td className="num">{cell(a.gol, 'goal')}</td>
              <td className="num">
                <span className={`score-num gap ${gapCls}`}>
                  {gap == null ? '—' : (gap > 0 ? '+' : '') + gap.toFixed(2)}
                </span>
              </td>
              <td className="num score-num">{a.pra_n}/{a.total}</td>
            </tr>
          );
        })}
        <tr className="totals">
          <td><strong>Overall</strong></td>
          <td className="num">{cell(totals.pol_avg ?? 0, 'policy')}</td>
          <td className="num">{cell(totals.pra_avg ?? 0, 'practice')}</td>
          <td className="num">{cell(totals.gol_avg ?? 0, 'goal')}</td>
          <td className="num">
            <span className={`score-num gap ${totals.gap == null ? 'empty' : totals.gap > 0 ? 'positive' : 'zero'}`}>
              {totals.gap == null ? '—' : (totals.gap > 0 ? '+' : '') + totals.gap.toFixed(2)}
            </span>
          </td>
          <td className="num score-num">{totals.scored_pra}/{totals.total}</td>
        </tr>
      </tbody>
    </table>
  );
}

function DashboardCards({ definition, scores }: { definition: FrameworkDefinition; scores: Scores }) {
  return (
    <section className="dash">
      {definition.groups.map((g) => {
        const c = GROUP_COLORS[g.id] ?? { accent: '#C9A961', text: '#E8D29B', bg: '' };
        let scored = 0, totalPra = 0, total = 0;
        for (const cat of g.categories) {
          for (const ctrl of cat.controls) {
            total++;
            const r = scores[ctrl.id];
            if (r?.pra != null) { scored++; totalPra += r.pra; }
          }
        }
        const avg = scored ? (totalPra / scored).toFixed(1) : '—';
        const pct = total ? Math.round((scored / total) * 100) : 0;
        return (
          <div className="dash-card" key={g.id} style={{ ['--fn-color' as never]: c.accent }}>
            <div className="dash-card-fn">{g.id}</div>
            <div className="dash-card-name">{g.name}</div>
            <div className="dash-card-stats">
              <div className="dash-stat">
                <span className="dash-stat-val">{avg}</span>
                <span className="dash-stat-lbl">Avg</span>
              </div>
              <div className="dash-stat">
                <span className="dash-stat-val">{scored}/{total}</span>
                <span className="dash-stat-lbl">Scored</span>
              </div>
            </div>
            <div className="dash-progress">
              <div className="dash-progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </section>
  );
}
