'use client';

import { useMemo, useState } from 'react';

interface Column { key: string; label: string; type: 'text' | 'date' | 'number' | 'select'; options?: string[] }
interface RegisterDef { id: string; slug: string; name: string; description: string | null; columns: Column[]; display_order: number }
interface RegisterRow { id: string; register_id: string; data: Record<string, string>; display_order: number }

export default function RegistersClient({
  initialDefs, initialRows,
}: {
  initialDefs: RegisterDef[];
  initialRows: RegisterRow[];
}) {
  const [defs, setDefs] = useState<RegisterDef[]>(initialDefs);
  const [rows, setRows] = useState<RegisterRow[]>(initialRows);
  const [activeId, setActiveId] = useState<string | null>(initialDefs[0]?.id ?? null);
  const [busy, setBusy] = useState(false);

  const active = defs.find((d) => d.id === activeId) ?? null;
  const visibleRows = useMemo(() => rows.filter((r) => r.register_id === activeId), [rows, activeId]);

  async function seedDefaults() {
    setBusy(true);
    const res = await fetch('/api/registers', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'seed_defaults' }),
    });
    setBusy(false);
    if (res.ok) location.reload();
  }

  async function addRow() {
    if (!active) return;
    const empty: Record<string, string> = {};
    for (const c of active.columns) empty[c.key] = '';
    const res = await fetch('/api/register-rows', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ register_id: active.id, data: empty, display_order: visibleRows.length }),
    });
    const j = await res.json();
    if (res.ok) setRows((xs) => [...xs, j.row as RegisterRow]);
  }

  async function patchCell(rowId: string, key: string, value: string) {
    setRows((xs) => xs.map((r) => r.id === rowId ? { ...r, data: { ...r.data, [key]: value } } : r));
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    await fetch('/api/register-rows', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: rowId, data: { ...row.data, [key]: value } }),
    });
  }

  async function removeRow(rowId: string) {
    setRows((xs) => xs.filter((x) => x.id !== rowId));
    await fetch(`/api/register-rows?id=${encodeURIComponent(rowId)}`, { method: 'DELETE' });
  }

  async function deleteRegister(id: string) {
    if (!confirm('Delete this register and all its rows?')) return;
    setDefs((xs) => xs.filter((x) => x.id !== id));
    setRows((xs) => xs.filter((x) => x.register_id !== id));
    if (activeId === id) setActiveId(defs.find((d) => d.id !== id)?.id ?? null);
    await fetch(`/api/registers?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  if (defs.length === 0) {
    return (
      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Registers</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Multi-table registry: stakeholders, compliance, vendor risk, assets, incidents
            </div>
          </div>
        </div>
        <div style={{ padding: '24px 0', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-mid)', marginBottom: 16 }}>
            No registers yet. Seed the standard set (Stakeholder Registry, Compliance Register,
            Vendor Risk Register, Asset Inventory, Incident Log) to get started.
          </p>
          <button className="action-btn primary" onClick={seedDefaults} disabled={busy}>
            {busy ? 'Seeding…' : 'Seed default registers'}
          </button>
        </div>
      </section>
    );
  }

  return (
    <>
      <section className="scorecard">
        <div className="scorecard-header" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="scorecard-title">Registers</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>{defs.length} registers</div>
          </div>
          <div className="fn-filters" style={{ flex: 1, justifyContent: 'flex-end' }}>
            {defs.map((d) => (
              <button key={d.id} className={`fn-btn ${activeId === d.id ? 'active' : ''}`} onClick={() => setActiveId(d.id)}>
                {d.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      {active && (
        <section className="scorecard">
          <div className="scorecard-header">
            <div>
              <div className="scorecard-title">{active.name}</div>
              <div className="scorecard-tag" style={{ marginTop: 4 }}>
                {active.description ?? `${visibleRows.length} rows`}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="action-btn primary" onClick={addRow}>+ Add row</button>
              <button className="action-btn danger" onClick={() => deleteRegister(active.id)}>Delete register</button>
            </div>
          </div>
          <table className="score-table">
            <thead>
              <tr>
                {active.columns.map((c) => <th key={c.key}>{c.label}</th>)}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={active.columns.length + 1} style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)' }}>
                    No rows yet. Click <strong>+ Add row</strong>.
                  </td>
                </tr>
              )}
              {visibleRows.map((r) => (
                <tr key={r.id}>
                  {active.columns.map((c) => <td key={c.key}><CellEditor col={c} value={r.data[c.key] ?? ''} onChange={(v) => patchCell(r.id, c.key, v)} /></td>)}
                  <td><button className="action-btn danger" onClick={() => removeRow(r.id)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function CellEditor({ col, value, onChange }: { col: Column; value: string; onChange: (v: string) => void }) {
  if (col.type === 'select' && col.options) {
    return (
      <select className="score-select" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {col.options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (col.type === 'date') {
    return <input type="date" className="score-select" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  if (col.type === 'number') {
    return <input type="number" className="score-select" defaultValue={value} onBlur={(e) => onChange(e.target.value)} />;
  }
  return <input type="text" className="score-select" defaultValue={value} onBlur={(e) => onChange(e.target.value)} />;
}
