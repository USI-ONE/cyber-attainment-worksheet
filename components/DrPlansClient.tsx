'use client';

import { useMemo, useState } from 'react';
import type { DrPlan, DrTestResult, DrTier, DrPlanStatus } from '@/lib/supabase/types';

const TIER_META: Record<DrTier, { label: string; color: string; tag: string }> = {
  1: { label: 'Tier 1 — Critical',  color: '#DC2626', tag: 'mission-critical, RTO ≤ 4h' },
  2: { label: 'Tier 2 — Important', color: '#F59E0B', tag: 'business-important, RTO ≤ 24h' },
  3: { label: 'Tier 3 — Standard',  color: '#475569', tag: 'standard, RTO ≤ 72h' },
};

const RESULT_META: Record<DrTestResult, { color: string; label: string }> = {
  pass:    { color: '#10B981', label: 'Pass' },
  partial: { color: '#F59E0B', label: 'Partial' },
  fail:    { color: '#DC2626', label: 'Fail' },
};

const STATUS_META: Record<DrPlanStatus, { color: string }> = {
  draft:    { color: '#94A3B8' },
  active:   { color: '#10B981' },
  archived: { color: '#64748B' },
};

export default function DrPlansClient({ initialPlans }: { initialPlans: DrPlan[] }) {
  const [plans, setPlans] = useState<DrPlan[]>(initialPlans);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const grouped = useMemo(() => {
    const out: Record<DrTier, DrPlan[]> = { 1: [], 2: [], 3: [] };
    for (const p of plans) out[p.tier].push(p);
    return out;
  }, [plans]);

  const stats = useMemo(() => {
    const total = plans.length;
    const tested = plans.filter((p) => p.last_tested).length;
    const overdue = plans.filter((p) => {
      if (!p.next_test_due) return false;
      return new Date(p.next_test_due).getTime() < Date.now();
    }).length;
    const failed = plans.filter((p) => p.last_test_result === 'fail').length;
    return { total, tested, overdue, failed };
  }, [plans]);

  async function createPlan(name: string, tier: DrTier) {
    setBusy(true);
    const res = await fetch('/api/dr-plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, tier, status: 'draft' }),
    });
    setBusy(false);
    const j = await res.json();
    if (!res.ok || !j.ok) return alert(j.error ?? 'create failed');
    setPlans((s) => [j.plan as DrPlan, ...s]);
    setOpenId(j.plan.id);
    setCreating(false);
  }

  async function patchPlan(id: string, fields: Partial<DrPlan>) {
    setPlans((s) => s.map((p) => p.id === id ? { ...p, ...fields } : p));
    const res = await fetch('/api/dr-plans', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? `update failed (${res.status})`);
    }
  }

  async function removePlan(id: string) {
    if (!confirm('Delete this DR plan? This cannot be undone.')) return;
    setPlans((s) => s.filter((p) => p.id !== id));
    if (openId === id) setOpenId(null);
    await fetch(`/api/dr-plans?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  const openPlan = openId ? plans.find((p) => p.id === openId) ?? null : null;

  return (
    <>
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KpiTile label="Total DR Plans" value={stats.total.toString()} sub="across all tiers" accent="#2563EB" />
        <KpiTile label="Tested" value={`${stats.tested}/${stats.total}`} sub="have a recorded test" accent="#10B981" />
        <KpiTile label="Overdue" value={stats.overdue.toString()} sub={stats.overdue > 0 ? 'past next-test date' : 'all on schedule'} accent={stats.overdue > 0 ? '#DC2626' : '#94A3B8'} />
        <KpiTile label="Failing" value={stats.failed.toString()} sub={stats.failed > 0 ? 'last test failed' : 'no failed tests'} accent={stats.failed > 0 ? '#DC2626' : '#10B981'} />
      </div>

      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Disaster Recovery Plans</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Per-system recovery procedures with RTO/RPO, backup story, and test cadence
            </div>
          </div>
          <button className="action-btn primary" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : '+ New DR Plan'}
          </button>
        </div>

        {creating && <NewPlanForm busy={busy} onCancel={() => setCreating(false)} onSubmit={createPlan} />}

        {plans.length === 0 && !creating && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-mid)' }}>
            No DR plans yet. Click <strong>+ New DR Plan</strong> to start one.
          </div>
        )}

        {([1, 2, 3] as DrTier[]).map((tier) => {
          const ps = grouped[tier];
          if (ps.length === 0) return null;
          const meta = TIER_META[tier];
          return (
            <div key={tier} style={{ marginTop: 18 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
                <span style={{
                  fontFamily: 'Oswald, sans-serif', fontWeight: 600, fontSize: 13,
                  color: meta.color, letterSpacing: '.04em',
                }}>
                  {meta.label}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{meta.tag}</span>
              </div>
              <table className="score-table">
                <thead>
                  <tr>
                    <th>System / Plan</th>
                    <th className="num">RTO</th>
                    <th className="num">RPO</th>
                    <th>Last test</th>
                    <th>Next due</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {ps.map((p) => {
                    const overdue = p.next_test_due && new Date(p.next_test_due).getTime() < Date.now();
                    return (
                      <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(p.id)}>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--text)' }}>{p.name}</div>
                          {p.system_name && <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 2 }}>{p.system_name}</div>}
                        </td>
                        <td className="num score-num">{fmtMinutes(p.rto_minutes)}</td>
                        <td className="num score-num">{fmtMinutes(p.rpo_minutes)}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-mid)' }}>
                          {p.last_tested
                            ? <span>
                                {p.last_tested}
                                {p.last_test_result && (
                                  <Pill color={RESULT_META[p.last_test_result].color} style={{ marginLeft: 8 }}>
                                    {RESULT_META[p.last_test_result].label}
                                  </Pill>
                                )}
                              </span>
                            : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                        </td>
                        <td style={{ fontSize: 12, color: overdue ? 'var(--gap-pos)' : 'var(--text-mid)', fontWeight: overdue ? 600 : 400 }}>
                          {p.next_test_due ?? '—'}
                          {overdue && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600 }}>OVERDUE</span>}
                        </td>
                        <td><Pill color={STATUS_META[p.status].color}>{p.status}</Pill></td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <button className="action-btn" onClick={() => setOpenId(p.id)}>Open</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </section>

      {openPlan && (
        <PlanEditor
          plan={openPlan}
          onClose={() => setOpenId(null)}
          onPatch={(fields) => patchPlan(openPlan.id, fields)}
          onDelete={() => removePlan(openPlan.id)}
        />
      )}
    </>
  );
}

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

function fmtMinutes(m: number | null): string {
  if (m == null) return '—';
  if (m < 60) return `${m}m`;
  if (m < 60 * 24) return `${Math.round(m / 60 * 10) / 10}h`;
  return `${Math.round(m / 60 / 24 * 10) / 10}d`;
}

function NewPlanForm({
  busy, onCancel, onSubmit,
}: { busy: boolean; onCancel: () => void; onSubmit: (name: string, tier: DrTier) => void }) {
  const [name, setName] = useState('');
  const [tier, setTier] = useState<DrTier>(2);
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSubmit(name.trim(), tier); }}
      style={{ display: 'flex', gap: 10, padding: '12px 0 4px', flexWrap: 'wrap', alignItems: 'flex-end' }}
    >
      <Field label="Plan name" hint="e.g. 'Production Database Recovery'" style={{ flex: 1, minWidth: 280 }}>
        <input className="score-select" value={name} onChange={(e) => setName(e.target.value)} autoFocus
          placeholder="Production Database Recovery" />
      </Field>
      <Field label="Tier" style={{ width: 200 }}>
        <select className="score-select" value={tier} onChange={(e) => setTier(Number(e.target.value) as DrTier)}>
          <option value={1}>Tier 1 — Critical</option>
          <option value={2}>Tier 2 — Important</option>
          <option value={3}>Tier 3 — Standard</option>
        </select>
      </Field>
      <button type="submit" className="action-btn primary" disabled={busy || !name.trim()}>
        {busy ? 'Creating…' : 'Create plan'}
      </button>
      <button type="button" className="action-btn" onClick={onCancel}>Cancel</button>
    </form>
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

function PlanEditor({
  plan, onClose, onPatch, onDelete,
}: {
  plan: DrPlan;
  onClose: () => void;
  onPatch: (fields: Partial<DrPlan>) => void;
  onDelete: () => void;
}) {
  return (
    <section className="scorecard" style={{ borderColor: TIER_META[plan.tier].color }}>
      <div className="scorecard-header">
        <div>
          <div className="scorecard-title">{plan.name}</div>
          <div className="scorecard-tag" style={{ marginTop: 4 }}>
            <span style={{ color: TIER_META[plan.tier].color, fontWeight: 600 }}>
              {TIER_META[plan.tier].label}
            </span>
            {plan.system_name && <span> · {plan.system_name}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="action-btn danger" onClick={onDelete}>Delete</button>
          <button className="action-btn" onClick={onClose}>Close</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Field label="System / asset">
          <input className="score-select" defaultValue={plan.system_name ?? ''}
            onBlur={(e) => onPatch({ system_name: e.target.value })} />
        </Field>
        <Field label="Tier">
          <select className="score-select" value={plan.tier}
            onChange={(e) => onPatch({ tier: Number(e.target.value) as DrTier })}>
            <option value={1}>Tier 1 — Critical</option>
            <option value={2}>Tier 2 — Important</option>
            <option value={3}>Tier 3 — Standard</option>
          </select>
        </Field>
        <Field label="Status">
          <select className="score-select" value={plan.status}
            onChange={(e) => onPatch({ status: e.target.value as DrPlanStatus })}>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </Field>
        <Field label="RTO (minutes)" hint="Recovery Time Objective — max acceptable downtime">
          <input type="number" className="score-select" defaultValue={plan.rto_minutes ?? ''}
            onBlur={(e) => onPatch({ rto_minutes: e.target.value ? Number(e.target.value) : null })} />
        </Field>
        <Field label="RPO (minutes)" hint="Recovery Point Objective — max acceptable data loss">
          <input type="number" className="score-select" defaultValue={plan.rpo_minutes ?? ''}
            onBlur={(e) => onPatch({ rpo_minutes: e.target.value ? Number(e.target.value) : null })} />
        </Field>
        <Field label="Recovery owner">
          <input className="score-select" defaultValue={plan.recovery_owner ?? ''}
            onBlur={(e) => onPatch({ recovery_owner: e.target.value })} />
        </Field>
      </div>

      <Field label="Description" style={{ marginBottom: 16 }}>
        <textarea className="score-select" rows={3} defaultValue={plan.description ?? ''}
          onBlur={(e) => onPatch({ description: e.target.value })}
          placeholder="What this plan covers, who it serves, and why it exists." />
      </Field>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Field label="Backup method">
          <input className="score-select" defaultValue={plan.backup_method ?? ''}
            onBlur={(e) => onPatch({ backup_method: e.target.value })}
            placeholder="Veeam → Wasabi (immutable)" />
        </Field>
        <Field label="Backup frequency">
          <input className="score-select" defaultValue={plan.backup_frequency ?? ''}
            onBlur={(e) => onPatch({ backup_frequency: e.target.value })}
            placeholder="Hourly / Daily 02:00 MT" />
        </Field>
        <Field label="Backup retention">
          <input className="score-select" defaultValue={plan.backup_retention ?? ''}
            onBlur={(e) => onPatch({ backup_retention: e.target.value })}
            placeholder="30d operational + 1y archive" />
        </Field>
      </div>

      <StringListEditor
        label="Recovery steps"
        hint="Ordered procedure executed during a recovery event."
        items={plan.recovery_steps}
        onChange={(items) => onPatch({ recovery_steps: items })}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        <StringListEditor
          label="Recovery team"
          hint="Members on the activation roster."
          items={plan.recovery_team}
          onChange={(items) => onPatch({ recovery_team: items })}
          inline
        />
        <StringListEditor
          label="Dependencies"
          hint="Upstream systems / vendors / credentials required."
          items={plan.dependencies}
          onChange={(items) => onPatch({ dependencies: items })}
          inline
        />
      </div>

      <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--bg-border)' }}>
        <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 12 }}>
          Test history
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
          <Field label="Last tested">
            <input type="date" className="score-select" defaultValue={plan.last_tested ?? ''}
              onChange={(e) => onPatch({ last_tested: e.target.value || null })} />
          </Field>
          <Field label="Last test result">
            <select className="score-select" value={plan.last_test_result ?? ''}
              onChange={(e) => onPatch({ last_test_result: (e.target.value || null) as DrTestResult | null })}>
              <option value="">—</option>
              <option value="pass">Pass</option>
              <option value="partial">Partial</option>
              <option value="fail">Fail</option>
            </select>
          </Field>
          <Field label="Next test due">
            <input type="date" className="score-select" defaultValue={plan.next_test_due ?? ''}
              onChange={(e) => onPatch({ next_test_due: e.target.value || null })} />
          </Field>
          <Field label="Linked controls" hint="Comma-separated NIST CSF IDs">
            <input className="score-select" defaultValue={plan.linked_control_ids.join(', ')}
              onBlur={(e) => onPatch({ linked_control_ids: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder="RC.RP-01, RC.RP-02" />
          </Field>
        </div>
        <Field label="Last test notes" style={{ marginTop: 12 }}>
          <textarea className="score-select" rows={2} defaultValue={plan.last_test_notes ?? ''}
            onBlur={(e) => onPatch({ last_test_notes: e.target.value })}
            placeholder="Findings, gaps discovered, follow-up actions." />
        </Field>
      </div>
    </section>
  );
}

function StringListEditor({
  label, hint, items, onChange, inline,
}: {
  label: string;
  hint?: string;
  items: string[];
  onChange: (items: string[]) => void;
  inline?: boolean;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div>
      <Field label={label} hint={hint}>
        <div />
      </Field>
      <ol style={{ listStyle: inline ? 'disc' : 'decimal', margin: '4px 0 8px 18px', padding: 0, color: 'var(--text)' }}>
        {items.length === 0 && <li style={{ color: 'var(--text-muted)', listStyle: 'none', marginLeft: -18 }}>—</li>}
        {items.map((s, i) => (
          <li key={i} style={{ marginBottom: 4, fontSize: 12, lineHeight: 1.5 }}>
            <span style={{ marginRight: 8 }}>{s}</span>
            <button type="button" className="action-btn danger"
              style={{ padding: '0 6px', fontSize: 11 }}
              onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button>
          </li>
        ))}
      </ol>
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="score-select" value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              e.preventDefault();
              onChange([...items, draft.trim()]); setDraft('');
            }
          }}
          placeholder={inline ? 'Add and press Enter' : 'Add a step and press Enter'} />
        <button type="button" className="action-btn"
          onClick={() => { if (draft.trim()) { onChange([...items, draft.trim()]); setDraft(''); } }}>
          + Add
        </button>
      </div>
    </div>
  );
}
