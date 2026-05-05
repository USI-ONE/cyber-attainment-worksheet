'use client';

import Link from 'next/link';
import { useState } from 'react';

interface SnapshotRow {
  id: string;
  label: string;
  period: string | null;
  taken_at: string;
  notes_md: string | null;
  framework_version_id: string;
}

export default function SnapshotsClient({ initialSnapshots }: { initialSnapshots: SnapshotRow[] }) {
  const [snapshots, setSnapshots] = useState<SnapshotRow[]>(initialSnapshots);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [period, setPeriod] = useState(quarterToken(new Date()));
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function takeSnapshot(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim()) { setError('Label is required.'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: label.trim(), period: period.trim() || null, notes_md: notes.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
      } else {
        setSnapshots((s) => [json.snapshot as SnapshotRow, ...s]);
        setLabel(''); setNotes(''); setOpen(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Snapshots</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Frozen point-in-time copies of the worksheet · Drives trend &amp; board reporting
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <a className="action-btn"
               href="/api/report/snapshot-compare"
               title="Compare the two most recent snapshots (or last snapshot vs current)"
               download>
              Generate Executive Report
            </a>
            <button className="action-btn primary" onClick={() => setOpen((v) => !v)}>
              {open ? 'Cancel' : 'Lock & Label'}
            </button>
          </div>
        </div>

        {open && (
          <form onSubmit={takeSnapshot} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0 16px' }}>
            <FieldRow label="Label" hint="Short, board-friendly. Example: '2026-Q2 Board Pack'.">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="2026-Q2 Board Pack"
                autoFocus
                required
                style={fieldStyle}
              />
            </FieldRow>
            <FieldRow label="Period" hint="Sortable token. Example: 2026-Q2 or 2026-W18.">
              <input
                type="text"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="2026-Q2"
                style={fieldStyle}
              />
            </FieldRow>
            <FieldRow label="Notes (optional)" hint="Markdown supported. Visible on the snapshot detail.">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What changed since the last snapshot…"
                rows={3}
                style={{ ...fieldStyle, resize: 'vertical', minHeight: 60 }}
              />
            </FieldRow>
            {error && <div className="banner error">{error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="action-btn primary" disabled={busy}>
                {busy ? 'Capturing…' : 'Capture snapshot'}
              </button>
              <button type="button" className="action-btn" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </form>
        )}
      </section>

      <section className="scorecard">
        <table className="score-table" style={{ marginTop: 0 }}>
          <thead>
            <tr>
              <th>Label</th>
              <th>Period</th>
              <th>Taken</th>
              <th>Notes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {snapshots.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0' }}>
                  No snapshots yet. Click <strong>Lock &amp; Label</strong> to capture the current scoring state.
                </td>
              </tr>
            )}
            {snapshots.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.label}</strong></td>
                <td><code style={{ color: 'var(--gold-light)', fontSize: 11 }}>{s.period ?? '—'}</code></td>
                <td className="score-num" style={{ color: 'var(--text-mid)', fontSize: 11 }}>
                  {new Date(s.taken_at).toLocaleString()}
                </td>
                <td style={{ color: 'var(--text-mid)', fontSize: 11, maxWidth: 360, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.notes_md ?? '—'}
                </td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <Link href={`/snapshots/${s.id}`} className="action-btn">Edit scores</Link>
                  <a className="action-btn"
                     href={`/api/report/snapshot-compare?from=${encodeURIComponent(s.id)}&to=current`}
                     title="Compare this snapshot against the current state"
                     download>
                    Compare → current
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

const fieldStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--bg-border)',
  color: 'var(--text)',
  fontFamily: 'Inter, sans-serif',
  fontSize: 13,
  borderRadius: 2,
};

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontFamily: 'Oswald, sans-serif', fontWeight: 500, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-mid)' }}>
        {label}
      </label>
      {children}
      {hint && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{hint}</span>}
    </div>
  );
}

function quarterToken(d: Date): string {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}
