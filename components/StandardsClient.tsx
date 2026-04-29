'use client';

import { useState } from 'react';

interface Standard { id: string; slug: string; display_name: string; description: string | null }
interface TenantStandard { tenant_id: string; standard_id: string; applies: boolean; scope_notes: string | null }

export default function StandardsClient({
  initialCatalog,
  initialApplied,
}: {
  initialCatalog: Standard[];
  initialApplied: TenantStandard[];
}) {
  const [applied, setApplied] = useState<Record<string, TenantStandard>>(() => {
    const m: Record<string, TenantStandard> = {};
    for (const a of initialApplied) m[a.standard_id] = a;
    return m;
  });
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(s: Standard, next: boolean) {
    setBusy(s.id);
    setApplied((a) => {
      const copy = { ...a };
      if (next) copy[s.id] = { tenant_id: '', standard_id: s.id, applies: true, scope_notes: copy[s.id]?.scope_notes ?? null };
      else delete copy[s.id];
      return copy;
    });
    const res = await fetch('/api/standards', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ standard_id: s.id, applies: next, scope_notes: applied[s.id]?.scope_notes ?? null }),
    });
    setBusy(null);
    if (!res.ok) {
      // rollback
      setApplied((a) => {
        const copy = { ...a };
        if (next) delete copy[s.id];
        else copy[s.id] = { tenant_id: '', standard_id: s.id, applies: true, scope_notes: null };
        return copy;
      });
    }
  }

  async function setNotes(s: Standard, notes: string) {
    if (!applied[s.id]) return;
    setApplied((a) => ({ ...a, [s.id]: { ...a[s.id], scope_notes: notes } }));
    await fetch('/api/standards', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ standard_id: s.id, applies: true, scope_notes: notes }),
    });
  }

  return (
    <section className="scorecard">
      <div className="scorecard-header">
        <div>
          <div className="scorecard-title">Security Standards</div>
          <div className="scorecard-tag" style={{ marginTop: 4 }}>
            Toggle which compliance frameworks apply · {Object.keys(applied).length}/{initialCatalog.length} active
          </div>
        </div>
      </div>

      <table className="score-table">
        <thead>
          <tr>
            <th style={{ width: 60 }}>Applies</th>
            <th>Standard</th>
            <th>Description</th>
            <th>Scope notes</th>
          </tr>
        </thead>
        <tbody>
          {initialCatalog.map((s) => {
            const isOn = !!applied[s.id];
            return (
              <tr key={s.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={isOn}
                    disabled={busy === s.id}
                    onChange={(e) => toggle(s, e.target.checked)}
                    style={{ width: 18, height: 18, cursor: 'pointer' }}
                  />
                </td>
                <td>
                  <div style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 600, fontSize: 13, color: 'var(--white)' }}>{s.display_name}</div>
                  <code style={{ color: 'var(--gold-light)', fontSize: 10 }}>{s.slug}</code>
                </td>
                <td style={{ color: 'var(--text-mid)', fontSize: 12 }}>{s.description ?? ''}</td>
                <td>
                  {isOn ? (
                    <input
                      type="text"
                      className="score-select"
                      defaultValue={applied[s.id]?.scope_notes ?? ''}
                      onBlur={(e) => setNotes(s, e.target.value)}
                      placeholder="Optional scope notes…"
                    />
                  ) : (
                    <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>not applicable</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
