'use client';

import { useMemo, useState } from 'react';
import type {
  CurrentScore,
  FrameworkDefinition,
  FrameworkGroup,
  ScoreField,
} from '@/lib/supabase/types';
import {
  GROUP_COLORS,
  PRIORITY_LABELS,
  STATUS_OPTIONS,
  TIER_LABELS,
  TIER_MAX,
  TIER_VALUES,
  tierColor,
  computeGroupAverages,
  computeOverallTotals,
  type GroupAverage,
} from '@/lib/scoring';
type Scores = Record<string, Partial<CurrentScore>>;

type Filter = 'ALL' | string;

const RADAR = {
  pol: { stroke: '#C9A961', fill: 'rgba(201,169,97,0.18)', label: 'Policy' },
  pra: { stroke: '#F59E0B', fill: 'rgba(245,158,11,0.18)', label: 'Practice' },
  gol: { stroke: '#22C55E', fill: 'rgba(34,197,94,0.18)', label: 'Goal' },
};

export default function WorksheetView({
  tenantId,
  frameworkVersionId,
  definition,
  initialScores,
}: {
  tenantId: string;
  frameworkVersionId: string;
  definition: FrameworkDefinition;
  initialScores: Record<string, CurrentScore>;
  saveEndpoint?: string;
  extraSaveFields?: Record<string, unknown>;
  title?: string;
  subtitle?: string;
}) {
  const [scores, setScores] = useState<Scores>(initialScores);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [savingMessage, setSavingMessage] = useState<string | null>(null);

  const groupAverages = useMemo(
    () => computeGroupAverages(definition, scores),
    [definition, scores],
  );
  const totals = useMemo(() => computeOverallTotals(groupAverages), [groupAverages]);

  const updateField = async (controlId: string, field: ScoreField, raw: string) => {
    const value: string | number | null =
      raw === '' || raw == null
        ? null
        : field === 'pol' || field === 'pra' || field === 'gol'
        ? parseFloat(raw)
        : field === 'prio'
        ? parseInt(raw)
        : raw;

    setScores((prev) => {
      const next = { ...prev };
      const row = { ...(next[controlId] ?? {}) };
      if (value == null) delete (row as Record<string, unknown>)[field];
      else (row as Record<string, unknown>)[field] = value;
      next[controlId] = row;
      return next;
    });

    setSavingMessage('Saving…');

    try {
      const res = await fetch(saveEndpoint ?? '/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          control_id: controlId,
          framework_version_id: frameworkVersionId,
          field,
          value,
          ...(extraSaveFields ?? {}),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setSavingMessage(`Save failed: ${j.error ?? 'unknown'}`);
        setTimeout(() => setSavingMessage(null), 4000);
      } else {
        setSavingMessage(null);
      }
    } catch (e) {
      setSavingMessage(`Save failed: ${e instanceof Error ? e.message : 'network error'}`);
      setTimeout(() => setSavingMessage(null), 4000);
    }
  };

  const toggleCollapse = (groupId: string) =>
    setCollapsed((c) => ({ ...c, [groupId]: !c[groupId] }));

  const allCollapsed = definition.groups.every((g) => collapsed[g.id]);
  const collapseAll = () => {
    const all = !allCollapsed;
    const next: Record<string, boolean> = {};
    for (const g of definition.groups) next[g.id] = all;
    setCollapsed(next);
  };

  const exportCsv = () => {
    const rows: string[][] = [
      [
        'Control', 'Group', 'Category', 'Outcome',
        'Policy Score', 'Policy Tier',
        'Practice Score', 'Practice Tier',
        'Goal Score', 'Goal Tier',
        'Gap', 'Priority', 'Owner', 'Status', 'Notes',
      ],
    ];
    for (const g of definition.groups) {
      for (const cat of g.categories) {
        for (const ctrl of cat.controls) {
          const r = scores[ctrl.id] ?? {};
          const pol = r.pol ?? '';
          const pra = r.pra ?? '';
          const gol = r.gol ?? '';
          const gap = pra && gol ? (Number(gol) - Number(pra)) : '';
          rows.push([
            ctrl.id,
            g.name,
            cat.name,
            `"${ctrl.outcome.replace(/"/g, '""')}"`,
            String(pol),
            pol ? TIER_LABELS[pol as number] ?? '' : '',
            String(pra),
            pra ? TIER_LABELS[pra as number] ?? '' : '',
            String(gol),
            gol ? TIER_LABELS[gol as number] ?? '' : '',
            gap === '' ? '' : (gap > 0 ? '+' + gap : String(gap)),
            r.prio ? PRIORITY_LABELS[r.prio as number] ?? '' : '',
            r.owner ?? '',
            r.status ?? '',
            `"${(r.notes ?? '').replace(/"/g, '""').replace(/\n/g, ' ')}"`,
          ]);
        }
      }
    }
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${definition.framework.slug}_assessment_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <>
      <Scorecard avgs={groupAverages} totals={totals} />

      <Dashboard groups={definition.groups} scores={scores} />

      <div className="control-bar">
        <div className="search-box">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ID, outcome, category, or keyword..."
            autoComplete="off"
          />
        </div>
        <div className="fn-filters">
          <button className={`fn-btn ${filter === 'ALL' ? 'active' : ''}`} onClick={() => setFilter('ALL')}>All</button>
          {definition.groups.map((g) => (
            <button
              key={g.id}
              className={`fn-btn ${filter === g.id ? 'active' : ''}`}
              onClick={() => setFilter(g.id)}
            >
              {g.name.charAt(0) + g.name.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <button className="action-btn" onClick={collapseAll}>
          {allCollapsed ? 'Expand All' : 'Collapse All'}
        </button>
        <button className="action-btn primary" onClick={exportCsv}>Export CSV</button>
      </div>

      {savingMessage && <div className="banner">{savingMessage}</div>}

      <CsfTable
        groups={definition.groups}
        scores={scores}
        collapsed={collapsed}
        toggleCollapse={toggleCollapse}
        filter={filter}
        search={search.toLowerCase().trim()}
        updateField={updateField}
      />
    </>
  );
}

function Scorecard({ avgs, totals }: { avgs: GroupAverage[]; totals: ReturnType<typeof computeOverallTotals> }) {
  return (
    <section className="scorecard">
      <div className="scorecard-header">
        <div>
          <div className="scorecard-title">Executive Scorecard</div>
          <div className="scorecard-tag" style={{ marginTop: 4 }}>
            Policy · Practice · Goal — Averaged by Function
          </div>
        </div>
        <div style={{ display: 'flex', gap: 24 }}>
          <Total label="Practice" value={totals.pra_avg} colorClass="practice" />
          <Total label="Goal" value={totals.gol_avg} colorClass="goal" />
          <Total
            label="Gap"
            value={totals.gap}
            colorClass={
              totals.gap == null ? '' : totals.gap > 0 ? 'gap positive' : 'gap zero'
            }
            sign
          />
        </div>
      </div>
      <div className="scorecard-grid">
        <div className="radar-wrap">
          <Radar avgs={avgs} />
          <div className="radar-legend">
            {(['pol', 'pra', 'gol'] as const).map((k) => (
              <div className="radar-legend-item" key={k}>
                <span className="radar-legend-swatch" style={{ background: RADAR[k].stroke }} />
                <span>{RADAR[k].label}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
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
                return (
                  <tr key={a.group_id}>
                    <td>
                      <div className="score-fn-cell">
                        <span className="score-fn-dot" style={{ background: c.accent }} />
                        <span className="score-fn-code" style={{ color: c.accent }}>{a.group_id}</span>
                        <span className="score-fn-name">{a.group_name}</span>
                      </div>
                    </td>
                    <td><Cell n={a.pol} cls="policy" /></td>
                    <td><Cell n={a.pra} cls="practice" /></td>
                    <td><Cell n={a.gol} cls="goal" /></td>
                    <td>
                      <span className={`score-num gap ${gap == null ? 'empty' : gap > 0 ? 'positive' : 'zero'}`}>
                        {gap == null ? '—' : (gap > 0 ? '+' : '') + gap.toFixed(2)}
                      </span>
                    </td>
                    <td className="score-num">{a.pra_n}/{a.total}</td>
                  </tr>
                );
              })}
              <tr className="totals">
                <td><strong>Overall</strong></td>
                <td><Cell n={totals.pol_avg ?? 0} cls="policy" /></td>
                <td><Cell n={totals.pra_avg ?? 0} cls="practice" /></td>
                <td><Cell n={totals.gol_avg ?? 0} cls="goal" /></td>
                <td>
                  <span className={`score-num gap ${totals.gap == null ? 'empty' : totals.gap > 0 ? 'positive' : 'zero'}`}>
                    {totals.gap == null ? '—' : (totals.gap > 0 ? '+' : '') + totals.gap.toFixed(2)}
                  </span>
                </td>
                <td className="score-num">{totals.scored_pra}/{totals.total}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function Total({ label, value, colorClass, sign }: {
  label: string; value: number | null; colorClass: string; sign?: boolean;
}) {
  const display =
    value == null ? '—' :
    sign ? (value > 0 ? '+' : '') + value.toFixed(2) : value.toFixed(2);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <span className={`score-num ${colorClass}`} style={{ fontSize: 18 }}>{display}</span>
      <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '.1em', textTransform: 'uppercase', marginTop: 3 }}>
        {label}
      </span>
    </div>
  );
}

function Cell({ n, cls }: { n: number; cls: string }) {
  if (!n) return <span className="score-num empty">—</span>;
  return <span className={`score-num ${cls}`}>{n.toFixed(2)}</span>;
}

function Radar({ avgs }: { avgs: GroupAverage[] }) {
  const cx = 180, cy = 180, maxR = 130;
  const axes = avgs.map((a) => a.group_id);
  const N = axes.length;
  const pt = (i: number, value: number, max = TIER_MAX) => {
    const angle = ((i * (360 / N)) - 90) * Math.PI / 180;
    const r = (value / max) * maxR;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  };
  const polyPts = (key: 'pol' | 'pra' | 'gol') =>
    avgs.map((a, i) => pt(i, a[key])).map((p) => p.join(',')).join(' ');
  const ringPts = (level: number) =>
    avgs.map((_, i) => pt(i, level)).map((p) => p.join(',')).join(' ');

  return (
    <svg className="radar-svg" viewBox="0 0 360 360" xmlns="http://www.w3.org/2000/svg">
      {[1, 2, 3, 4, 5].map((level) => {
        const isTarget = level === 3;
        return (
          <polygon
            key={level}
            points={ringPts(level)}
            fill="none"
            stroke={isTarget ? 'rgba(201,169,97,0.25)' : 'rgba(255,255,255,0.07)'}
            strokeWidth={1}
            strokeDasharray={isTarget ? '3,3' : 'none'}
          />
        );
      })}
      {axes.map((_, i) => {
        const [x, y] = pt(i, TIER_MAX);
        return (
          <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
        );
      })}
      {[1, 2, 3, 4, 5].map((level) => {
        const [x, y] = pt(0, level);
        return (
          <text key={level} x={x + 4} y={y + 3} fill="rgba(255,255,255,0.35)" fontSize={9} fontFamily="JetBrains Mono">
            {level}
          </text>
        );
      })}
      {axes.map((id, i) => {
        const [x, y] = pt(i, TIER_MAX + 0.7);
        const c = GROUP_COLORS[id] ?? { accent: '#C9A961' };
        return (
          <text
            key={id}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={c.accent}
            fontSize={13}
            fontWeight={600}
            fontFamily="Oswald"
            letterSpacing="0.06em"
          >
            {id}
          </text>
        );
      })}
      <polygon points={polyPts('gol')} fill={RADAR.gol.fill} stroke={RADAR.gol.stroke} strokeWidth={2} strokeLinejoin="round" />
      <polygon points={polyPts('pol')} fill={RADAR.pol.fill} stroke={RADAR.pol.stroke} strokeWidth={2} strokeLinejoin="round" />
      <polygon points={polyPts('pra')} fill={RADAR.pra.fill} stroke={RADAR.pra.stroke} strokeWidth={2} strokeLinejoin="round" />
      {avgs.map((a, i) => {
        const [x, y] = pt(i, a.pra);
        return <circle key={a.group_id} cx={x} cy={y} r={3.5} fill={RADAR.pra.stroke} />;
      })}
      {avgs.map((a, i) => {
        const [x, y] = pt(i, TIER_MAX - 0.05);
        if (!a.pra) return null;
        return (
          <text key={`val-${a.group_id}`} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            fill={RADAR.pra.stroke} fontSize={11} fontWeight={600} fontFamily="JetBrains Mono"
            style={{ paintOrder: 'stroke', stroke: 'var(--bg-mid)', strokeWidth: 3, strokeLinejoin: 'round' }}>
            {a.pra.toFixed(2)}
          </text>
        );
      })}
    </svg>
  );
}

function Dashboard({ groups, scores }: { groups: FrameworkGroup[]; scores: Scores }) {
  return (
    <section className="dash">
      {groups.map((g) => {
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

function CsfTable({
  groups, scores, collapsed, toggleCollapse, filter, search, updateField,
}: {
  groups: FrameworkGroup[];
  scores: Scores;
  collapsed: Record<string, boolean>;
  toggleCollapse: (id: string) => void;
  filter: Filter;
  search: string;
  updateField: (controlId: string, field: ScoreField, value: string) => void;
}) {
  return (
    <table className="csf-table">
      <thead>
        <tr>
          <th style={{ minWidth: 90 }}>Control</th>
          <th>Outcome</th>
          <th className="col-policy" style={{ minWidth: 108 }} title="Documented in formal written policy?">Policy</th>
          <th className="col-practice" style={{ minWidth: 108 }} title="Actually implemented and practiced?">Practice</th>
          <th className="col-goal" style={{ minWidth: 108 }} title="Target tier?">Goal</th>
          <th style={{ minWidth: 48, textAlign: 'center' }} title="Goal − Practice">Gap</th>
          <th style={{ minWidth: 96 }}>Priority</th>
          <th style={{ minWidth: 120 }}>Owner</th>
          <th style={{ minWidth: 120 }}>Status</th>
          <th style={{ minWidth: 200 }}>Notes</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => {
          if (filter !== 'ALL' && filter !== g.id) return null;
          const c = GROUP_COLORS[g.id] ?? { accent: '#C9A961', text: '#E8D29B', bg: '' };
          const isCol = !!collapsed[g.id];

          let scored = 0, total = 0;
          for (const cat of g.categories) {
            for (const ctrl of cat.controls) {
              total++;
              if (scores[ctrl.id]?.pra != null) scored++;
            }
          }

          return (
            <FunctionBlock
              key={g.id}
              group={g}
              scores={scores}
              colorAccent={c.accent}
              colorText={c.text}
              colorBg={c.bg}
              collapsed={isCol}
              onToggle={() => toggleCollapse(g.id)}
              search={search}
              updateField={updateField}
              scored={scored}
              total={total}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function FunctionBlock({
  group, scores, colorAccent, colorText, colorBg, collapsed, onToggle, search, updateField, scored, total,
}: {
  group: FrameworkGroup;
  scores: Scores;
  colorAccent: string;
  colorText: string;
  colorBg: string;
  collapsed: boolean;
  onToggle: () => void;
  search: string;
  updateField: (controlId: string, field: ScoreField, value: string) => void;
  scored: number;
  total: number;
}) {
  return (
    <>
      <tr
        className={`fn-row ${collapsed ? 'collapsed' : ''}`}
        onClick={onToggle}
        style={{
          ['--fn-bg' as never]: colorBg,
          ['--fn-accent' as never]: colorAccent,
          ['--fn-text' as never]: colorText,
        }}
      >
        <td colSpan={10}>
          <div className="fn-row-inner">
            <span className="fn-toggle">▼</span>
            <span className="fn-code">{group.id}</span>
            <span className="fn-name">{group.name}</span>
            <span className="fn-desc">{group.description}</span>
            <span className="fn-summary">{scored}/{total} scored</span>
          </div>
        </td>
      </tr>
      {!collapsed && group.categories.map((cat) => {
        const visibleControls = cat.controls.filter((ctrl) => {
          if (!search) return true;
          return (
            ctrl.id.toLowerCase().includes(search) ||
            ctrl.outcome.toLowerCase().includes(search) ||
            cat.name.toLowerCase().includes(search)
          );
        });
        if (visibleControls.length === 0) return null;
        return (
          <FrameworkCategorySection
            key={cat.id}
            categoryId={cat.id}
            categoryName={cat.name}
            controls={visibleControls}
            scores={scores}
            colorAccent={colorAccent}
            colorText={colorText}
            updateField={updateField}
          />
        );
      })}
    </>
  );
}

function FrameworkCategorySection({
  categoryId, categoryName, controls, scores, colorAccent, colorText, updateField,
}: {
  categoryId: string;
  categoryName: string;
  controls: { id: string; outcome: string }[];
  scores: Scores;
  colorAccent: string;
  colorText: string;
  updateField: (controlId: string, field: ScoreField, value: string) => void;
}) {
  return (
    <>
      <tr className="cat-row" style={{ ['--fn-accent' as never]: colorAccent, ['--fn-text' as never]: colorText }}>
        <td colSpan={10}>
          <span className="cat-id">{categoryId}</span>
          {categoryName}
          <span className="cat-count">{controls.length}</span>
        </td>
      </tr>
      {controls.map((ctrl) => (
        <SubcategoryRow
          key={ctrl.id}
          control={ctrl}
          row={scores[ctrl.id] ?? {}}
          updateField={updateField}
        />
      ))}
    </>
  );
}

function SubcategoryRow({
  control,
  row,
  updateField,
}: {
  control: { id: string; outcome: string };
  row: Partial<CurrentScore>;
  updateField: (controlId: string, field: ScoreField, value: string) => void;
}) {
  const gap = row.pra && row.gol ? row.gol - row.pra : null;
  const gapCls =
    gap == null ? 'gap-empty' : gap > 0 ? 'gap-positive' : gap < 0 ? 'gap-negative' : 'gap-zero';
  const gapStr = gap == null ? '—' : (gap > 0 ? '+' : '') + gap;

  const prio = row.prio ?? 0;
  const status = (row.status ?? '') as string;

  return (
    <tr className="sub-row">
      <td className="col-id">{control.id}</td>
      <td className="col-outcome">{control.outcome}</td>
      <td><ScoreSelect value={row.pol} onChange={(v) => updateField(control.id, 'pol', v)} /></td>
      <td><ScoreSelect value={row.pra} onChange={(v) => updateField(control.id, 'pra', v)} /></td>
      <td><ScoreSelect value={row.gol} onChange={(v) => updateField(control.id, 'gol', v)} /></td>
      <td className={`gap-cell ${gapCls}`}>{gapStr}</td>
      <td className="input-cell">
        <select
          className={`priority-select ${prio === 1 ? 'prio-low' : prio === 2 ? 'prio-medium' : prio === 3 ? 'prio-high' : prio === 4 ? 'prio-critical' : ''}`}
          value={row.prio ?? ''}
          onChange={(e) => updateField(control.id, 'prio', e.target.value)}
        >
          <option value="">—</option>
          {PRIORITY_LABELS.slice(1).map((lbl, i) => (
            <option key={lbl} value={i + 1}>{lbl}</option>
          ))}
        </select>
      </td>
      <td className="input-cell">
        <input
          type="text"
          value={row.owner ?? ''}
          onChange={(e) => updateField(control.id, 'owner', e.target.value)}
          placeholder="—"
        />
      </td>
      <td className="input-cell">
        <select
          className={`status-select status-${(status || 'not-started').toLowerCase().replace(/\s+/g, '-')}`}
          value={row.status ?? ''}
          onChange={(e) => updateField(control.id, 'status', e.target.value)}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s || '—'}</option>
          ))}
        </select>
      </td>
      <td className="input-cell">
        <textarea
          value={row.notes ?? ''}
          onChange={(e) => updateField(control.id, 'notes', e.target.value)}
          placeholder="—"
        />
      </td>
    </tr>
  );
}

function ScoreSelect({
  value,
  onChange,
}: {
  value: number | null | undefined;
  onChange: (value: string) => void;
}) {
  const v = value == null ? null : (typeof value === 'number' ? value : parseFloat(String(value)));
  const has = v != null && v > 0;
  const color = has ? tierColor(v) : 'transparent';
  const pct = has ? (Math.min(v, TIER_MAX) / TIER_MAX) * 100 : 0;
  const valStr = v == null ? '' : Number.isInteger(v) ? v.toString() : v.toFixed(1);
  return (
    <div className="score-cell">
      <div className="score-wrap" style={{ ['--score-color' as never]: color }}>
        <select
          className={`score-select ${has ? 'has-value' : ''}`}
          value={valStr}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          {TIER_VALUES.map((tv) => {
            const lbl = Number.isInteger(tv) ? `${tv} — ${TIER_LABELS[tv]}` : `${tv.toFixed(1)}`;
            return <option key={tv} value={tv}>{lbl}</option>;
          })}
        </select>
        <div className="score-bar"><div className="score-bar-fill" style={{ width: `${pct}%` }} /></div>
      </div>
    </div>
  );
}
