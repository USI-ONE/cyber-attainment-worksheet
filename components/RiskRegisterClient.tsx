'use client';

import { useMemo, useState } from 'react';
import type {
  Risk,
  RiskTreatment,
  RiskTreatmentStatus,
  RiskTreatmentStrategy,
  RiskStatus,
  RiskLevel,
  RiskCategory,
  DrPlan,
  IrPlaybook,
} from '@/lib/supabase/types';

// =============================================================================
// Visual constants
// =============================================================================

const SCORE_BAND = (score: number): { color: string; label: string; tag: string } => {
  if (score >= 20) return { color: '#991B1B', label: 'Extreme',  tag: 'extreme'  };
  if (score >= 15) return { color: '#DC2626', label: 'High',     tag: 'high'     };
  if (score >= 10) return { color: '#F59E0B', label: 'Medium',   tag: 'medium'   };
  if (score >= 5)  return { color: '#EAB308', label: 'Low',      tag: 'low'      };
  return                  { color: '#10B981', label: 'Very Low', tag: 'verylow'  };
};

const LIKELIHOOD_LABEL = ['', 'Rare', 'Unlikely', 'Possible', 'Likely', 'Almost Certain'];
const IMPACT_LABEL     = ['', 'Negligible', 'Minor', 'Moderate', 'Major', 'Catastrophic'];

const CATEGORY_LABELS: Record<RiskCategory, string> = {
  cyber:        'Cyber',
  operational:  'Operational',
  compliance:   'Compliance',
  people:       'People',
  supply_chain: 'Supply chain',
  physical:     'Physical',
  financial:    'Financial',
};

const STRATEGY_LABELS: Record<RiskTreatmentStrategy, { label: string; color: string }> = {
  accept:    { label: 'Accept',    color: '#64748B' },
  mitigate:  { label: 'Mitigate',  color: '#2563EB' },
  transfer:  { label: 'Transfer',  color: '#0EA5E9' },
  avoid:     { label: 'Avoid',     color: '#10B981' },
};

const STATUS_LABELS: Record<RiskStatus, { label: string; color: string }> = {
  open:         { label: 'Open',          color: '#DC2626' },
  in_treatment: { label: 'In treatment',  color: '#F59E0B' },
  accepted:     { label: 'Accepted',      color: '#64748B' },
  closed:       { label: 'Closed',        color: '#10B981' },
  transferred:  { label: 'Transferred',   color: '#0EA5E9' },
};

const TREATMENT_STATUSES: RiskTreatmentStatus[] = ['Not Started','In Progress','Blocked','Complete'];
const TREATMENT_STATUS_COLOR: Record<RiskTreatmentStatus, string> = {
  'Not Started': '#94A3B8',
  'In Progress': '#F59E0B',
  'Blocked':     '#DC2626',
  'Complete':    '#10B981',
};

// =============================================================================
// Top-level client
// =============================================================================

export default function RiskRegisterClient({
  initialRisks, initialTreatments, drPlanIndex, irPlaybookIndex,
}: {
  initialRisks: Risk[];
  initialTreatments: RiskTreatment[];
  drPlanIndex: Pick<DrPlan, 'id' | 'name' | 'tier'>[];
  irPlaybookIndex: Pick<IrPlaybook, 'id' | 'name' | 'category'>[];
}) {
  const [risks, setRisks] = useState<Risk[]>(initialRisks);
  const [treatments, setTreatments] = useState<RiskTreatment[]>(initialTreatments);
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView]     = useState<'residual' | 'inherent'>('residual');
  const [cellFilter, setCellFilter] = useState<{ l: RiskLevel; i: RiskLevel } | null>(null);
  const [creating, setCreating] = useState(false);

  // --- Computed -----------------------------------------------------------

  const stats = useMemo(() => {
    const total = risks.length;
    const critical = risks.filter((r) => r.residual_score >= 15).length;
    const inFlight = treatments.filter((t) => t.status === 'In Progress').length;
    const overdueReview = risks.filter((r) =>
      r.next_review_due && new Date(r.next_review_due).getTime() < Date.now()
    ).length;
    return { total, critical, inFlight, overdueReview };
  }, [risks, treatments]);

  const treatmentsByRisk = useMemo(() => {
    const m: Record<string, RiskTreatment[]> = {};
    for (const t of treatments) (m[t.risk_id] ??= []).push(t);
    for (const id of Object.keys(m)) m[id].sort((a, b) => a.display_order - b.display_order);
    return m;
  }, [treatments]);

  const visibleRisks = useMemo(() => {
    if (!cellFilter) return risks;
    return risks.filter((r) =>
      view === 'residual'
        ? r.residual_likelihood === cellFilter.l && r.residual_impact === cellFilter.i
        : r.inherent_likelihood === cellFilter.l && r.inherent_impact === cellFilter.i
    );
  }, [risks, cellFilter, view]);

  const openRisk = openId ? risks.find((r) => r.id === openId) ?? null : null;
  const openTreatments = openRisk ? (treatmentsByRisk[openRisk.id] ?? []) : [];

  // --- Mutations ----------------------------------------------------------

  async function createRisk(title: string, category: RiskCategory) {
    const res = await fetch('/api/risks', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, category, status: 'open' }),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) return alert(j.error ?? 'create failed');
    setRisks((s) => [j.risk as Risk, ...s]);
    setOpenId(j.risk.id);
    setCreating(false);
  }

  async function patchRisk(id: string, fields: Partial<Risk>) {
    setRisks((s) => s.map((r) => r.id === id ? { ...r, ...fields } : r));
    const res = await fetch('/api/risks', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? `update failed (${res.status})`);
      return;
    }
    // Server may have updated generated columns (residual_score etc.)
    const j = await res.json();
    if (j.risk) setRisks((s) => s.map((r) => r.id === id ? (j.risk as Risk) : r));
  }

  async function removeRisk(id: string) {
    if (!confirm('Delete this risk? Treatments will be deleted too. This cannot be undone.')) return;
    setRisks((s) => s.filter((r) => r.id !== id));
    setTreatments((s) => s.filter((t) => t.risk_id !== id));
    if (openId === id) setOpenId(null);
    await fetch(`/api/risks?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async function addTreatment(risk_id: string, action: string) {
    const res = await fetch('/api/risk-treatments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ risk_id, action }),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) return alert(j.error ?? 'create failed');
    setTreatments((s) => [...s, j.treatment as RiskTreatment]);
  }

  async function patchTreatment(id: string, fields: Partial<RiskTreatment>) {
    setTreatments((s) => s.map((t) => t.id === id ? { ...t, ...fields } : t));
    await fetch('/api/risk-treatments', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    });
  }

  async function removeTreatment(id: string) {
    setTreatments((s) => s.filter((t) => t.id !== id));
    await fetch(`/api/risk-treatments?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // --- Render -------------------------------------------------------------

  return (
    <>
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KpiTile label="Total Risks" value={stats.total.toString()} sub="on the register" accent="#2563EB" />
        <KpiTile label="High / Extreme" value={stats.critical.toString()} sub={`residual ≥ 15 — ${stats.critical > 0 ? 'attention' : 'within appetite'}`} accent={stats.critical > 0 ? '#DC2626' : '#10B981'} />
        <KpiTile label="Treatments in Flight" value={stats.inFlight.toString()} sub="status = In Progress" accent="#F59E0B" />
        <KpiTile label="Review Overdue" value={stats.overdueReview.toString()} sub={stats.overdueReview > 0 ? 'past next-review date' : 'all current'} accent={stats.overdueReview > 0 ? '#DC2626' : '#94A3B8'} />
      </div>

      <HeatMapSection
        risks={risks}
        view={view}
        onViewChange={setView}
        cellFilter={cellFilter}
        onCellFilter={setCellFilter}
      />

      <RegisterSection
        risks={visibleRisks}
        totalRisks={risks.length}
        view={view}
        cellFilter={cellFilter}
        treatmentsByRisk={treatmentsByRisk}
        onClearFilter={() => setCellFilter(null)}
        onOpen={setOpenId}
        creating={creating}
        onToggleCreate={() => setCreating((v) => !v)}
        onCreate={createRisk}
      />

      {openRisk && (
        // key={openRisk.id} forces a fresh mount when the user switches
        // from one open risk to another. The title/description/rationale/
        // code/owner inputs are uncontrolled (defaultValue + onBlur), and
        // without remount, React reconciles the same component instance —
        // so those fields keep showing the PREVIOUS risk's text while the
        // controlled selects (category/status/etc.) correctly update. The
        // user then types over what they think is Risk B's title but is
        // actually Risk A's, blurs, and Risk B gets saved with stale text.
        // Behavior looks like "I can't edit this risk."
        <RiskDetailEditor
          key={openRisk.id}
          risk={openRisk}
          treatments={openTreatments}
          drPlanIndex={drPlanIndex}
          irPlaybookIndex={irPlaybookIndex}
          onClose={() => setOpenId(null)}
          onPatch={(fields) => patchRisk(openRisk.id, fields)}
          onDelete={() => removeRisk(openRisk.id)}
          onAddTreatment={(action) => addTreatment(openRisk.id, action)}
          onPatchTreatment={patchTreatment}
          onRemoveTreatment={removeTreatment}
        />
      )}
    </>
  );
}

// =============================================================================
// KPI tile
// =============================================================================

function KpiTile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="kpi-tile" style={{ ['--accent' as never]: accent }}>
      <div className="kpi-tile-label">{label}</div>
      <div className="kpi-tile-value">{value}</div>
      <div className="kpi-tile-sub">{sub}</div>
    </div>
  );
}

function Pill({ color, children, style }: { color: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px',
      background: `${color}1a`, color, border: `1px solid ${color}55`,
      borderRadius: 999, fontSize: 11, fontWeight: 600, textTransform: 'capitalize', letterSpacing: '0.04em',
      ...style,
    }}>{children}</span>
  );
}

function Field({ label, hint, children, style }: { label: string; hint?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      <label style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 11, color: 'var(--text-mid)', letterSpacing: '.02em' }}>
        {label}
      </label>
      {children}
      {hint && <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{hint}</span>}
    </div>
  );
}

// =============================================================================
// Heat Map (5×5 grid)
// =============================================================================

function HeatMapSection({
  risks, view, onViewChange, cellFilter, onCellFilter,
}: {
  risks: Risk[];
  view: 'residual' | 'inherent';
  onViewChange: (v: 'residual' | 'inherent') => void;
  cellFilter: { l: RiskLevel; i: RiskLevel } | null;
  onCellFilter: (c: { l: RiskLevel; i: RiskLevel } | null) => void;
}) {
  // grid[likelihood][impact] = risks landing there
  const grid: Record<number, Record<number, Risk[]>> = {};
  for (let l = 1; l <= 5; l++) {
    grid[l] = {};
    for (let i = 1; i <= 5; i++) grid[l][i] = [];
  }
  for (const r of risks) {
    const l = view === 'residual' ? r.residual_likelihood : r.inherent_likelihood;
    const i = view === 'residual' ? r.residual_impact     : r.inherent_impact;
    grid[l][i].push(r);
  }

  return (
    <section className="scorecard">
      <div className="scorecard-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="scorecard-title">Risk Heat Map</div>
          <div className="scorecard-tag" style={{ marginTop: 4 }}>
            Likelihood × Impact grid · {view === 'residual' ? 'showing residual exposure after treatment' : 'showing inherent exposure before treatment'}
          </div>
        </div>
        <div className="fn-filters">
          <button className={`fn-btn ${view === 'inherent' ? 'active' : ''}`} onClick={() => onViewChange('inherent')}>Inherent</button>
          <button className={`fn-btn ${view === 'residual' ? 'active' : ''}`} onClick={() => onViewChange('residual')}>Residual</button>
          {cellFilter && (
            <button className="fn-btn" onClick={() => onCellFilter(null)}>× Clear cell filter</button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 16, alignItems: 'stretch' }}>
        {/* Y-axis label */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          writingMode: 'vertical-rl', transform: 'rotate(180deg)',
          fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 12,
          color: 'var(--text-mid)', letterSpacing: '.06em', textTransform: 'uppercase',
        }}>
          Likelihood →
        </div>

        <div>
          {/* Grid: 5 rows (likelihood 5 → 1 top-to-bottom) × 5 cols (impact 1 → 5) + axis labels */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '60px repeat(5, 1fr)',
            gridTemplateRows: 'repeat(5, 1fr) auto',
            gap: 6,
          }}>
            {([5, 4, 3, 2, 1] as RiskLevel[]).map((l) => (
              <RowGroup key={l} likelihood={l} grid={grid} cellFilter={cellFilter} onCellFilter={onCellFilter} />
            ))}
            {/* X-axis labels row */}
            <div />
            {([1, 2, 3, 4, 5] as RiskLevel[]).map((i) => (
              <div key={i} style={{
                fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 11,
                color: 'var(--text-mid)', textAlign: 'center', paddingTop: 6,
                textTransform: 'uppercase', letterSpacing: '.04em',
              }}>
                {IMPACT_LABEL[i]}
                <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>{i}</div>
              </div>
            ))}
          </div>

          {/* X-axis title */}
          <div style={{
            textAlign: 'center', marginTop: 8,
            fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 12,
            color: 'var(--text-mid)', letterSpacing: '.06em', textTransform: 'uppercase',
          }}>
            Impact →
          </div>

          {/* Score-band legend */}
          <div style={{ display: 'flex', gap: 14, marginTop: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { score: 25, label: 'Extreme (20-25)' },
              { score: 15, label: 'High (15-19)' },
              { score: 10, label: 'Medium (10-14)' },
              { score: 5,  label: 'Low (5-9)' },
              { score: 1,  label: 'Very Low (1-4)' },
            ].map((b) => {
              const band = SCORE_BAND(b.score);
              return (
                <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 14, height: 14, background: band.color, borderRadius: 3 }} />
                  <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>{b.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function RowGroup({
  likelihood, grid, cellFilter, onCellFilter,
}: {
  likelihood: RiskLevel;
  grid: Record<number, Record<number, Risk[]>>;
  cellFilter: { l: RiskLevel; i: RiskLevel } | null;
  onCellFilter: (c: { l: RiskLevel; i: RiskLevel } | null) => void;
}) {
  return (
    <>
      <div style={{
        fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 11,
        color: 'var(--text-mid)', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        textAlign: 'center', textTransform: 'uppercase', letterSpacing: '.04em',
      }}>
        <span>{LIKELIHOOD_LABEL[likelihood]}</span>
        <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>{likelihood}</span>
      </div>
      {([1, 2, 3, 4, 5] as RiskLevel[]).map((impact) => {
        const cellRisks = grid[likelihood][impact];
        const score = likelihood * impact;
        const band = SCORE_BAND(score);
        const isActive = cellFilter?.l === likelihood && cellFilter?.i === impact;
        return (
          <button
            key={impact}
            type="button"
            onClick={() => onCellFilter(isActive ? null : { l: likelihood, i: impact })}
            style={{
              background: band.color,
              border: isActive ? '3px solid var(--text)' : '1px solid rgba(255,255,255,0.4)',
              borderRadius: 'var(--r-md)',
              minHeight: 64,
              padding: 6,
              cursor: 'pointer',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              transition: 'transform .12s ease, box-shadow .12s ease',
              color: '#fff',
              boxShadow: isActive ? 'var(--shadow-md)' : 'none',
            }}
            title={`${LIKELIHOOD_LABEL[likelihood]} × ${IMPACT_LABEL[impact]} — score ${score}\n${cellRisks.length} risk(s)`}
          >
            <span style={{
              fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 18, lineHeight: 1,
            }}>
              {cellRisks.length || ''}
            </span>
            {cellRisks.length > 0 && (
              <span style={{ fontSize: 9, opacity: .9, lineHeight: 1 }}>
                {cellRisks.length === 1 ? 'risk' : 'risks'}
              </span>
            )}
            <span style={{
              position: 'absolute', top: 3, right: 5,
              fontFamily: 'Inter, sans-serif', fontSize: 9, opacity: .8, fontWeight: 600,
            }}>
              {score}
            </span>
          </button>
        );
      })}
    </>
  );
}

// =============================================================================
// Register table
// =============================================================================

function RegisterSection({
  risks, totalRisks, view, cellFilter, treatmentsByRisk,
  onClearFilter, onOpen, creating, onToggleCreate, onCreate,
}: {
  risks: Risk[];
  totalRisks: number;
  view: 'residual' | 'inherent';
  cellFilter: { l: RiskLevel; i: RiskLevel } | null;
  treatmentsByRisk: Record<string, RiskTreatment[]>;
  onClearFilter: () => void;
  onOpen: (id: string) => void;
  creating: boolean;
  onToggleCreate: () => void;
  onCreate: (title: string, category: RiskCategory) => void;
}) {
  return (
    <section className="scorecard">
      <div className="scorecard-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div className="scorecard-title">Risk Register</div>
          <div className="scorecard-tag" style={{ marginTop: 4 }}>
            {cellFilter
              ? <>{risks.length} of {totalRisks} risks · filtered to {LIKELIHOOD_LABEL[cellFilter.l]} × {IMPACT_LABEL[cellFilter.i]} ({view})
                  <button className="action-btn" style={{ marginLeft: 8 }} onClick={onClearFilter}>Clear</button></>
              : <>{totalRisks} risks · sorted by residual score</>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <a className="action-btn" href="/api/report/risk-treatment-plan" download
             title="Generate a board-ready PDF Risk Treatment Plan briefing">
            Generate Risk Treatment Plan
          </a>
          <button className="action-btn primary" onClick={onToggleCreate}>
            {creating ? 'Cancel' : '+ New Risk'}
          </button>
        </div>
      </div>

      {creating && <NewRiskForm onSubmit={onCreate} onCancel={onToggleCreate} />}

      <table className="score-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Risk</th>
            <th>Category</th>
            <th className="num">Inherent</th>
            <th className="num">Residual</th>
            <th>Strategy</th>
            <th>Treatments</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {risks.length === 0 && (
            <tr><td colSpan={9} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>
              {totalRisks === 0
                ? <>No risks yet. Click <strong>+ New Risk</strong> to start the register.</>
                : <>No risks match this cell. Pick a different cell or clear the filter.</>}
            </td></tr>
          )}
          {risks.map((r) => {
            const inh = SCORE_BAND(r.inherent_score);
            const res = SCORE_BAND(r.residual_score);
            const ts = treatmentsByRisk[r.id] ?? [];
            const tsOpen     = ts.filter((t) => t.status !== 'Complete').length;
            const tsComplete = ts.filter((t) => t.status === 'Complete').length;
            return (
              <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => onOpen(r.id)}>
                <td><code style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'var(--text-mid)', fontWeight: 600 }}>{r.code}</code></td>
                <td>
                  <div style={{ fontWeight: 600 }}>{r.title}</div>
                  {r.description && (
                    <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 2,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 380 }}>
                      {r.description}
                    </div>
                  )}
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-mid)' }}>{CATEGORY_LABELS[r.category]}</td>
                <td className="num">
                  <span style={{ display: 'inline-block', minWidth: 32, padding: '2px 8px',
                    background: `${inh.color}1a`, color: inh.color, borderRadius: 6,
                    fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 12 }}>
                    {r.inherent_score}
                  </span>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{r.inherent_likelihood}×{r.inherent_impact}</div>
                </td>
                <td className="num">
                  <span style={{ display: 'inline-block', minWidth: 32, padding: '2px 8px',
                    background: `${res.color}1a`, color: res.color, borderRadius: 6,
                    fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 12 }}>
                    {r.residual_score}
                  </span>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{r.residual_likelihood}×{r.residual_impact}</div>
                </td>
                <td><Pill color={STRATEGY_LABELS[r.treatment_strategy].color}>{STRATEGY_LABELS[r.treatment_strategy].label}</Pill></td>
                <td style={{ fontSize: 11 }}>
                  {ts.length === 0
                    ? <span style={{ color: 'var(--text-muted)' }}>—</span>
                    : <span style={{ color: 'var(--text-mid)' }}>{tsComplete}/{ts.length} done · {tsOpen} open</span>}
                </td>
                <td><Pill color={STATUS_LABELS[r.status].color}>{STATUS_LABELS[r.status].label}</Pill></td>
                <td onClick={(e) => e.stopPropagation()}>
                  <button className="action-btn" onClick={() => onOpen(r.id)}>Open</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function NewRiskForm({
  onSubmit, onCancel,
}: { onSubmit: (title: string, category: RiskCategory) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<RiskCategory>('cyber');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (title.trim()) onSubmit(title.trim(), category); }}
      style={{ display: 'flex', gap: 10, padding: '12px 0 16px', flexWrap: 'wrap', alignItems: 'flex-end' }}
    >
      <Field label="Risk title" hint="e.g. 'AI-generated voice phishing of finance staff'" style={{ flex: 1, minWidth: 300 }}>
        <input className="score-select" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus
          placeholder="AI-generated voice phishing of finance staff" />
      </Field>
      <Field label="Category" style={{ width: 200 }}>
        <select className="score-select" value={category} onChange={(e) => setCategory(e.target.value as RiskCategory)}>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <button type="submit" className="action-btn primary" disabled={!title.trim()}>Create risk</button>
      <button type="button" className="action-btn" onClick={onCancel}>Cancel</button>
    </form>
  );
}

// =============================================================================
// Risk Detail Editor
// =============================================================================

function RiskDetailEditor({
  risk, treatments, drPlanIndex, irPlaybookIndex,
  onClose, onPatch, onDelete,
  onAddTreatment, onPatchTreatment, onRemoveTreatment,
}: {
  risk: Risk;
  treatments: RiskTreatment[];
  drPlanIndex: Pick<DrPlan, 'id' | 'name' | 'tier'>[];
  irPlaybookIndex: Pick<IrPlaybook, 'id' | 'name' | 'category'>[];
  onClose: () => void;
  onPatch: (fields: Partial<Risk>) => void;
  onDelete: () => void;
  onAddTreatment: (action: string) => void;
  onPatchTreatment: (id: string, fields: Partial<RiskTreatment>) => void;
  onRemoveTreatment: (id: string) => void;
}) {
  const res = SCORE_BAND(risk.residual_score);
  const inh = SCORE_BAND(risk.inherent_score);
  const [newAction, setNewAction] = useState('');

  return (
    <section className="scorecard" style={{ borderColor: res.color }}>
      <div className="scorecard-header">
        <div>
          <div className="scorecard-title">
            <code style={{ fontFamily: 'Inter, sans-serif', fontSize: 14, color: 'var(--text-mid)', marginRight: 10 }}>{risk.code}</code>
            {risk.title}
          </div>
          <div className="scorecard-tag" style={{ marginTop: 4 }}>
            {CATEGORY_LABELS[risk.category]}
            <span style={{ marginLeft: 12, color: inh.color, fontWeight: 600 }}>
              Inherent {risk.inherent_score} ({inh.label})
            </span>
            <span style={{ marginLeft: 6, color: 'var(--text-muted)' }}>→</span>
            <span style={{ marginLeft: 6, color: res.color, fontWeight: 600 }}>
              Residual {risk.residual_score} ({res.label})
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="action-btn danger" onClick={onDelete}>Delete</button>
          <button className="action-btn" onClick={onClose}>Close</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
        <div>
          <Field label="Title">
            <input className="score-select" defaultValue={risk.title}
              onBlur={(e) => onPatch({ title: e.target.value })} />
          </Field>
          <Field label="Description" style={{ marginTop: 12 }}>
            <textarea className="score-select" rows={3} defaultValue={risk.description ?? ''}
              onBlur={(e) => onPatch({ description: e.target.value })}
              placeholder="What could happen, in plain language." />
          </Field>
          <Field label="Rationale" hint="Threat + vulnerability behind this risk — the 'why' for the board." style={{ marginTop: 12 }}>
            <textarea className="score-select" rows={3} defaultValue={risk.rationale ?? ''}
              onBlur={(e) => onPatch({ rationale: e.target.value })}
              placeholder="Threat actor capability + organizational vulnerability + business consequence." />
          </Field>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Code">
              <input className="score-select" defaultValue={risk.code}
                onBlur={(e) => onPatch({ code: e.target.value })} />
            </Field>
            <Field label="Category">
              <select className="score-select" value={risk.category}
                onChange={(e) => onPatch({ category: e.target.value as RiskCategory })}>
                {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Owner">
            <input className="score-select" defaultValue={risk.owner ?? ''}
              onBlur={(e) => onPatch({ owner: e.target.value })} placeholder="Risk owner" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Treatment strategy">
              <select className="score-select" value={risk.treatment_strategy}
                onChange={(e) => onPatch({ treatment_strategy: e.target.value as RiskTreatmentStrategy })}>
                <option value="accept">Accept</option>
                <option value="mitigate">Mitigate</option>
                <option value="transfer">Transfer</option>
                <option value="avoid">Avoid</option>
              </select>
            </Field>
            <Field label="Status">
              <select className="score-select" value={risk.status}
                onChange={(e) => onPatch({ status: e.target.value as RiskStatus })}>
                <option value="open">Open</option>
                <option value="in_treatment">In treatment</option>
                <option value="accepted">Accepted</option>
                <option value="transferred">Transferred</option>
                <option value="closed">Closed</option>
              </select>
            </Field>
          </div>
        </div>
      </div>

      <div style={{
        marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--bg-border)',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24,
      }}>
        <ScoreEditor
          heading="Inherent (before treatment)"
          color={inh.color}
          label={`${inh.label} · ${risk.inherent_score}`}
          likelihood={risk.inherent_likelihood}
          impact={risk.inherent_impact}
          onChange={(l, i) => onPatch({ inherent_likelihood: l, inherent_impact: i })}
        />
        <ScoreEditor
          heading="Residual (after treatment)"
          color={res.color}
          label={`${res.label} · ${risk.residual_score}`}
          likelihood={risk.residual_likelihood}
          impact={risk.residual_impact}
          onChange={(l, i) => onPatch({ residual_likelihood: l, residual_impact: i })}
        />
      </div>

      {/* Treatments */}
      <div style={{ marginTop: 22 }}>
        <div style={{
          fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 13,
          color: 'var(--text)', paddingBottom: 6, marginBottom: 10,
          borderBottom: '1px solid var(--bg-border)',
        }}>
          Treatment plan ({treatments.length})
        </div>

        {treatments.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 10 }}>
            No treatment actions yet. Add one below.
          </div>
        )}

        {treatments.length > 0 && (
          <table className="score-table">
            <thead>
              <tr>
                <th style={{ width: '38%' }}>Action</th>
                <th>Owner</th>
                <th>Due</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {treatments.map((t) => (
                <tr key={t.id}>
                  <td>
                    <input className="score-select" defaultValue={t.action}
                      onBlur={(e) => onPatchTreatment(t.id, { action: e.target.value })} />
                    {t.detail && (
                      <textarea className="score-select" rows={2} defaultValue={t.detail}
                        onBlur={(e) => onPatchTreatment(t.id, { detail: e.target.value })}
                        style={{ marginTop: 4, fontSize: 11 }}
                        placeholder="Detail (optional)" />
                    )}
                    {!t.detail && (
                      <textarea className="score-select" rows={1} defaultValue=""
                        onBlur={(e) => e.target.value && onPatchTreatment(t.id, { detail: e.target.value })}
                        style={{ marginTop: 4, fontSize: 11 }}
                        placeholder="+ Add detail" />
                    )}
                  </td>
                  <td>
                    <input className="score-select" defaultValue={t.owner ?? ''}
                      onBlur={(e) => onPatchTreatment(t.id, { owner: e.target.value })} />
                  </td>
                  <td>
                    <input type="date" className="score-select" defaultValue={t.due_date ?? ''}
                      onChange={(e) => onPatchTreatment(t.id, { due_date: e.target.value || null })} />
                  </td>
                  <td>
                    <select
                      className="score-select"
                      value={t.status}
                      onChange={(e) => onPatchTreatment(t.id, { status: e.target.value as RiskTreatmentStatus })}
                      style={{ color: TREATMENT_STATUS_COLOR[t.status], fontWeight: 600 }}
                    >
                      {TREATMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td>
                    <button className="action-btn danger" onClick={() => onRemoveTreatment(t.id)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <input className="score-select"
            placeholder="Add a treatment action — e.g. 'Roll out FIDO2 keys to admin roles'"
            value={newAction}
            onChange={(e) => setNewAction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newAction.trim()) {
                onAddTreatment(newAction.trim()); setNewAction('');
              }
            }}
            style={{ flex: 1 }} />
          <button type="button" className="action-btn"
            onClick={() => { if (newAction.trim()) { onAddTreatment(newAction.trim()); setNewAction(''); } }}>
            + Add action
          </button>
        </div>
      </div>

      {/* Cross-references */}
      <div style={{
        marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--bg-border)',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24,
      }}>
        <div>
          <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 12, color: 'var(--text)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Cross-references
          </div>
          <Field label="NIST CSF controls" hint="Comma-separated control IDs that treat this risk.">
            <input className="score-select" defaultValue={risk.linked_control_ids.join(', ')}
              onBlur={(e) => onPatch({ linked_control_ids: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder="PR.AA-01, PR.AA-05, DE.AE-02" />
          </Field>
          <Field label="Linked DR plans" hint="Disaster Recovery plans that protect against this risk." style={{ marginTop: 10 }}>
            <LinkedSelect
              all={drPlanIndex.map((d) => ({ id: d.id, label: `[T${d.tier}] ${d.name}` }))}
              selectedIds={risk.linked_dr_plan_ids}
              onChange={(ids) => onPatch({ linked_dr_plan_ids: ids })}
            />
          </Field>
          <Field label="Linked IR playbooks" hint="Response playbooks that activate when this risk materializes." style={{ marginTop: 10 }}>
            <LinkedSelect
              all={irPlaybookIndex.map((p) => ({ id: p.id, label: `[${p.category}] ${p.name}` }))}
              selectedIds={risk.linked_ir_playbook_ids}
              onChange={(ids) => onPatch({ linked_ir_playbook_ids: ids })}
            />
          </Field>
        </div>
        <div>
          <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 12, color: 'var(--text)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Review cadence
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Last reviewed">
              <input type="date" className="score-select" defaultValue={risk.last_reviewed ?? ''}
                onChange={(e) => onPatch({ last_reviewed: e.target.value || null })} />
            </Field>
            <Field label="Next review due">
              <input type="date" className="score-select" defaultValue={risk.next_review_due ?? ''}
                onChange={(e) => onPatch({ next_review_due: e.target.value || null })} />
            </Field>
          </div>
        </div>
      </div>
    </section>
  );
}

function ScoreEditor({
  heading, color, label, likelihood, impact, onChange,
}: {
  heading: string;
  color: string;
  label: string;
  likelihood: RiskLevel;
  impact: RiskLevel;
  onChange: (l: RiskLevel, i: RiskLevel) => void;
}) {
  return (
    <div style={{
      border: `1px solid ${color}55`, borderLeft: `4px solid ${color}`,
      background: `${color}0a`, borderRadius: 'var(--r-md)', padding: 14,
    }}>
      <div style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 12, color: 'var(--text)', textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {heading}
      </div>
      <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 20, fontWeight: 700, color, marginTop: 4 }}>
        {label}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
        <Field label="Likelihood (1-5)">
          <select className="score-select" value={likelihood}
            onChange={(e) => onChange(Number(e.target.value) as RiskLevel, impact)}>
            {([1,2,3,4,5] as RiskLevel[]).map((n) => (
              <option key={n} value={n}>{n} — {LIKELIHOOD_LABEL[n]}</option>
            ))}
          </select>
        </Field>
        <Field label="Impact (1-5)">
          <select className="score-select" value={impact}
            onChange={(e) => onChange(likelihood, Number(e.target.value) as RiskLevel)}>
            {([1,2,3,4,5] as RiskLevel[]).map((n) => (
              <option key={n} value={n}>{n} — {IMPACT_LABEL[n]}</option>
            ))}
          </select>
        </Field>
      </div>
    </div>
  );
}

function LinkedSelect({
  all, selectedIds, onChange,
}: {
  all: { id: string; label: string }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  if (all.length === 0) {
    return <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 0' }}>No items available.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 130, overflowY: 'auto' }}>
      {all.map((it) => {
        const checked = selectedIds.includes(it.id);
        return (
          <label key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={() => onChange(checked
                ? selectedIds.filter((id) => id !== it.id)
                : [...selectedIds, it.id])}
            />
            {it.label}
          </label>
        );
      })}
    </div>
  );
}
