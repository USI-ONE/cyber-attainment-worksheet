'use client';

import { useMemo, useState } from 'react';

interface KpiDef {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  unit: string | null;
  target_value: number | string | null;
  target_direction: 'up' | 'down';
  display_order: number;
  enabled: boolean;
}
interface KpiObs {
  id: number;
  kpi_definition_id: string;
  observed_at: string;
  value: number | string | null;
  notes_md: string | null;
}

const DEFAULT_DEFS = [
  { slug: 'pra-avg', name: 'Avg Practice Maturity', unit: 'tier', target_value: 3, target_direction: 'up' as const, description: 'Average practice tier across scored controls.' },
  { slug: 'scored-pct', name: '% Controls Scored', unit: '%', target_value: 100, target_direction: 'up' as const, description: 'Percentage of framework controls with a recorded practice score.' },
  { slug: 'open-critical', name: 'Open Critical Priorities', unit: 'count', target_value: 0, target_direction: 'down' as const, description: 'Number of open priorities at Critical level.' },
  { slug: 'days-since-snapshot', name: 'Days Since Last Snapshot', unit: 'days', target_value: 30, target_direction: 'down' as const, description: 'Time since the most recent locked snapshot.' },
];

export default function KPIsClient({ initialDefs, initialObs }: { initialDefs: KpiDef[]; initialObs: KpiObs[] }) {
  const [defs, setDefs] = useState<KpiDef[]>(initialDefs);
  const [obs, setObs] = useState<KpiObs[]>(initialObs);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ slug: '', name: '', description: '', unit: '', target_value: '', target_direction: 'up' as 'up' | 'down' });
  const [err, setErr] = useState<string | null>(null);

  const obsByDef = useMemo(() => {
    const m: Record<string, KpiObs[]> = {};
    for (const o of obs) {
      if (!m[o.kpi_definition_id]) m[o.kpi_definition_id] = [];
      m[o.kpi_definition_id].push(o);
    }
    return m;
  }, [obs]);

  async function addDef(e: React.FormEvent) {
    e.preventDefault();
    if (!form.slug.trim() || !form.name.trim()) { setErr('slug + name required'); return; }
    const res = await fetch('/api/kpis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: form.slug.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        unit: form.unit.trim() || null,
        target_value: form.target_value ? parseFloat(form.target_value) : null,
        target_direction: form.target_direction,
      }),
    });
    const j = await res.json();
    if (!res.ok) { setErr(j.error ?? 'failed'); return; }
    setDefs((xs) => [...xs, j.definition].sort((a, b) => a.display_order - b.display_order || a.name.localeCompare(b.name)));
    setForm({ slug: '', name: '', description: '', unit: '', target_value: '', target_direction: 'up' });
    setAdding(false);
    setErr(null);
  }

  async function addDefault(p: typeof DEFAULT_DEFS[0]) {
    const res = await fetch('/api/kpis', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(p),
    });
    const j = await res.json();
    if (res.ok) setDefs((xs) => [...xs, j.definition]);
  }

  async function removeDef(id: string) {
    if (!confirm('Remove this KPI definition and all its observations?')) return;
    setDefs((xs) => xs.filter((x) => x.id !== id));
    setObs((xs) => xs.filter((x) => x.kpi_definition_id !== id));
    await fetch(`/api/kpis?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async function recordObs(defId: string, observed_at: string, value: string, notes: string) {
    const res = await fetch('/api/kpi-observations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kpi_definition_id: defId,
        observed_at,
        value: value === '' ? null : parseFloat(value),
        notes_md: notes.trim() || null,
      }),
    });
    const j = await res.json();
    if (res.ok) {
      setObs((xs) => {
        const filtered = xs.filter((o) => !(o.kpi_definition_id === defId && o.observed_at === observed_at));
        return [...filtered, j.observation].sort((a, b) => a.observed_at.localeCompare(b.observed_at));
      });
    }
  }

  const presents = new Set(defs.map((d) => d.slug));
  const remainingDefaults = DEFAULT_DEFS.filter((d) => !presents.has(d.slug));

  return (
    <>
      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Board KPIs</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Define metrics, record observations, plot trends · {defs.length} KPI{defs.length === 1 ? '' : 's'} defined
            </div>
          </div>
          <button className="action-btn primary" onClick={() => setAdding((v) => !v)}>{adding ? 'Cancel' : '+ Define KPI'}</button>
        </div>

        {adding && (
          <form onSubmit={addDef} style={{ display: 'grid', gap: 10, gridTemplateColumns: '1fr 1.5fr 1fr 90px 90px 1fr 80px', alignItems: 'end', padding: '6px 0 14px' }}>
            <Field label="Slug *"><input className="score-select" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="kebab-id" /></Field>
            <Field label="Name *"><input className="score-select" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Avg Practice Maturity" /></Field>
            <Field label="Unit"><input className="score-select" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="%, count, tier…" /></Field>
            <Field label="Target"><input className="score-select" type="number" step="0.01" value={form.target_value} onChange={(e) => setForm({ ...form, target_value: e.target.value })} /></Field>
            <Field label="Direction">
              <select className="score-select" value={form.target_direction} onChange={(e) => setForm({ ...form, target_direction: e.target.value as 'up' | 'down' })}>
                <option value="up">↑ higher better</option>
                <option value="down">↓ lower better</option>
              </select>
            </Field>
            <Field label="Description"><input className="score-select" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
            <button type="submit" className="action-btn primary">Add</button>
            {err && <div className="banner error" style={{ gridColumn: '1 / -1' }}>{err}</div>}
          </form>
        )}

        {defs.length === 0 && (
          <div style={{ padding: '16px 0' }}>
            <div style={{ marginBottom: 12, color: 'var(--text-mid)' }}>No KPIs yet. Quick-add common board metrics:</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {DEFAULT_DEFS.map((d) => (
                <button key={d.slug} className="action-btn" onClick={() => addDefault(d)}>+ {d.name}</button>
              ))}
            </div>
          </div>
        )}
        {defs.length > 0 && remainingDefaults.length > 0 && (
          <div style={{ padding: '6px 0', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '.1em', textTransform: 'uppercase' }}>Quick add:</span>
            {remainingDefaults.map((d) => <button key={d.slug} className="action-btn" onClick={() => addDefault(d)}>+ {d.name}</button>)}
          </div>
        )}
      </section>

      {defs.map((d) => (
        <KpiCard key={d.id} def={d} observations={obsByDef[d.id] ?? []} onRecord={recordObs} onRemove={removeDef} />
      ))}
    </>
  );
}

function KpiCard({
  def, observations, onRecord, onRemove,
}: {
  def: KpiDef;
  observations: KpiObs[];
  onRecord: (defId: string, date: string, value: string, notes: string) => Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [value, setValue] = useState('');
  const [notes, setNotes] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await onRecord(def.id, date, value, notes);
    setValue(''); setNotes('');
  }

  const sorted = [...observations].sort((a, b) => a.observed_at.localeCompare(b.observed_at));
  const latest = sorted[sorted.length - 1];
  const target = def.target_value != null ? Number(def.target_value) : null;
  const arrow = def.target_direction === 'up' ? '↑' : '↓';

  return (
    <section className="scorecard">
      <div className="scorecard-header">
        <div>
          <div className="scorecard-title">{def.name}</div>
          <div className="scorecard-tag" style={{ marginTop: 4 }}>
            {def.description ?? def.slug} {def.unit ? `· ${def.unit}` : ''} {target != null ? `· target ${arrow} ${target}` : ''}
          </div>
        </div>
        <button className="action-btn danger" onClick={() => onRemove(def.id)}>Delete</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 24, alignItems: 'start' }}>
        <div>
          <div className="kpi-tile-label">Latest</div>
          <div className="kpi-tile-value">{latest?.value != null ? Number(latest.value).toFixed(2) : '—'}</div>
          <div className="kpi-tile-sub">{latest ? new Date(latest.observed_at).toLocaleDateString() : 'no observations yet'}</div>
        </div>
        <Sparkline obs={sorted} target={target} direction={def.target_direction} />
      </div>

      <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: '180px 140px 1fr 80px', gap: 10, alignItems: 'end', marginTop: 18 }}>
        <Field label="Observed at">
          <input type="date" className="score-select" value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label={`Value${def.unit ? ' (' + def.unit + ')' : ''}`}>
          <input type="number" step="0.01" className="score-select" value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
        <Field label="Notes (optional)">
          <input type="text" className="score-select" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <button type="submit" className="action-btn primary">Record</button>
      </form>
    </section>
  );
}

function Sparkline({ obs, target, direction }: { obs: KpiObs[]; target: number | null; direction: 'up' | 'down' }) {
  const W = 600, H = 120, PAD = 8;
  if (obs.length === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>No observations yet.</div>;
  }
  const vals = obs.map((o) => (o.value != null ? Number(o.value) : null)).filter((v): v is number => v != null);
  const ymin = Math.min(...vals, target ?? Number.POSITIVE_INFINITY);
  const ymax = Math.max(...vals, target ?? Number.NEGATIVE_INFINITY);
  const yspan = Math.max(1e-9, ymax - ymin);

  const xScale = (i: number) => PAD + (i / Math.max(1, obs.length - 1)) * (W - 2 * PAD);
  const yScale = (v: number) => H - PAD - ((v - ymin) / yspan) * (H - 2 * PAD);

  const path = obs
    .map((o, i) => {
      const v = o.value != null ? Number(o.value) : null;
      if (v == null) return null;
      return `${i === 0 ? 'M' : 'L'} ${xScale(i).toFixed(1)} ${yScale(v).toFixed(1)}`;
    })
    .filter((s): s is string => !!s)
    .join(' ');

  const lastVal = vals[vals.length - 1];
  const accent = target == null ? '#A6873B' :
    direction === 'up' ? (lastVal >= target ? '#15803D' : '#B91C1C') :
    (lastVal <= target ? '#15803D' : '#B91C1C');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', maxWidth: '100%' }}>
      {target != null && (
        <line x1={PAD} y1={yScale(target)} x2={W - PAD} y2={yScale(target)} stroke="rgba(201,169,97,0.45)" strokeDasharray="3,3" />
      )}
      <path d={path} fill="none" stroke={accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {obs.map((o, i) => {
        const v = o.value != null ? Number(o.value) : null;
        if (v == null) return null;
        return <circle key={o.id} cx={xScale(i)} cy={yScale(v)} r={3} fill={accent} stroke="var(--bg-mid)" strokeWidth={1.5} />;
      })}
    </svg>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-mid)' }}>
        {label}
      </label>
      {children}
    </div>
  );
}
