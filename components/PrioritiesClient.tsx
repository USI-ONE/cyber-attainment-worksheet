'use client';

import { useState } from 'react';

interface Priority {
  id: string;
  control_id: string | null;
  title: string;
  detail: string | null;
  owner: string | null;
  status: string;
  priority_level: number | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string;
}

const STATUSES = ['Not Started', 'In Progress', 'Blocked', 'Complete'];
const PRIORITY = ['', 'Low', 'Medium', 'High', 'Critical'];

export default function PrioritiesClient({
  initial,
  controls,
}: {
  initial: Priority[];
  controls: { id: string; outcome: string }[];
}) {
  const [list, setList] = useState<Priority[]>(initial);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    title: '', detail: '', control_id: '', owner: '', status: 'Not Started',
    priority_level: 3, due_date: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setErr('Title required'); return; }
    setBusy(true); setErr(null);
    const res = await fetch('/api/priorities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: form.title.trim(),
        detail: form.detail.trim() || null,
        control_id: form.control_id || null,
        owner: form.owner.trim() || null,
        status: form.status,
        priority_level: form.priority_level || null,
        due_date: form.due_date || null,
      }),
    });
    const j = await res.json();
    setBusy(false);
    if (!res.ok) { setErr(j.error ?? 'failed'); return; }
    setList((xs) => [j.priority, ...xs]);
    setForm({ title: '', detail: '', control_id: '', owner: '', status: 'Not Started', priority_level: 3, due_date: '' });
    setAdding(false);
  }

  async function patch(id: string, fields: Partial<Priority>) {
    setList((xs) => xs.map((x) => (x.id === id ? { ...x, ...fields } : x)));
    await fetch('/api/priorities', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    });
  }

  async function remove(id: string) {
    if (!confirm('Delete this priority?')) return;
    setList((xs) => xs.filter((x) => x.id !== id));
    await fetch(`/api/priorities?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  const open = list.filter((p) => p.status !== 'Complete');
  const done = list.filter((p) => p.status === 'Complete');

  return (
    <>
      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">30-Day Priorities</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Short-list of items to focus on this cycle · {open.length} open · {done.length} complete
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <a className="action-btn"
               href="/api/report/work-plan"
               title="Generate a board-ready PDF Work Plan & 30-Day Priorities briefing"
               download>
              Generate Executive Report
            </a>
            <button className="action-btn primary" onClick={() => setAdding((v) => !v)}>
              {adding ? 'Cancel' : '+ Add priority'}
            </button>
          </div>
        </div>

        {adding && (
          <form onSubmit={add} style={{ display: 'grid', gap: 10, gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 90px', alignItems: 'end', padding: '6px 0 14px' }}>
            <Field label="Title" required>
              <input className="score-select" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Roll out MFA across executive accounts" />
            </Field>
            <Field label="Control">
              <select className="score-select" value={form.control_id} onChange={(e) => setForm({ ...form, control_id: e.target.value })}>
                <option value="">—</option>
                {controls.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
              </select>
            </Field>
            <Field label="Owner">
              <input className="score-select" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} placeholder="e.g. CISO" />
            </Field>
            <Field label="Priority">
              <select className="score-select" value={form.priority_level} onChange={(e) => setForm({ ...form, priority_level: parseInt(e.target.value) })}>
                <option value={1}>Low</option><option value={2}>Medium</option><option value={3}>High</option><option value={4}>Critical</option>
              </select>
            </Field>
            <Field label="Due">
              <input type="date" className="score-select" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </Field>
            <button type="submit" className="action-btn primary" disabled={busy}>{busy ? '…' : 'Add'}</button>
            {err && <div className="banner error" style={{ gridColumn: '1 / -1' }}>{err}</div>}
          </form>
        )}

        <PriorityTable rows={open} onPatch={patch} onRemove={remove} />
      </section>

      {done.length > 0 && (
        <section className="scorecard">
          <div className="scorecard-header">
            <div>
              <div className="scorecard-title" style={{ color: 'var(--text-mid)' }}>Completed</div>
            </div>
          </div>
          <PriorityTable rows={done} onPatch={patch} onRemove={remove} />
        </section>
      )}
    </>
  );
}

function PriorityTable({
  rows, onPatch, onRemove,
}: {
  rows: Priority[];
  onPatch: (id: string, fields: Partial<Priority>) => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
}) {
  if (rows.length === 0) {
    return <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>None.</div>;
  }
  return (
    <table className="score-table">
      <thead>
        <tr>
          <th>Title</th>
          <th>Control</th>
          <th>Owner</th>
          <th>Priority</th>
          <th>Status</th>
          <th>Due</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => {
          const due = p.due_date ? new Date(p.due_date) : null;
          const overdue = due && p.status !== 'Complete' && due.getTime() < Date.now();
          return (
            <tr key={p.id}>
              <td><strong>{p.title}</strong>{p.detail && <div style={{ color: 'var(--text-mid)', fontSize: 11 }}>{p.detail}</div>}</td>
              <td><code style={{ color: 'var(--gold-light)', fontSize: 11 }}>{p.control_id ?? '—'}</code></td>
              <td>
                <input className="score-select" defaultValue={p.owner ?? ''}
                  onBlur={(e) => onPatch(p.id, { owner: e.target.value || null })} />
              </td>
              <td>
                <select className="score-select" value={p.priority_level ?? ''}
                  onChange={(e) => onPatch(p.id, { priority_level: e.target.value ? parseInt(e.target.value) : null })}>
                  <option value="">—</option>
                  <option value={1}>Low</option><option value={2}>Medium</option><option value={3}>High</option><option value={4}>Critical</option>
                </select>
              </td>
              <td>
                <select className="score-select" value={p.status}
                  onChange={(e) => onPatch(p.id, { status: e.target.value })}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </td>
              <td style={{ color: overdue ? 'var(--red-text)' : 'var(--text-mid)', fontFamily: 'JetBrains Mono', fontSize: 11 }}>
                <input type="date" className="score-select" defaultValue={p.due_date ?? ''}
                  onChange={(e) => onPatch(p.id, { due_date: e.target.value || null })} />
              </td>
              <td><button className="action-btn danger" onClick={() => onRemove(p.id)}>×</button></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-mid)' }}>
        {label}{required ? ' *' : ''}
      </label>
      {children}
    </div>
  );
}
