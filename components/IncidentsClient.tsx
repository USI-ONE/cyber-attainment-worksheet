'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { Incident, IncidentSeverity, IncidentStatus } from '@/lib/supabase/types';

const SEVERITY_COLORS: Record<IncidentSeverity, string> = {
  low:      '#9AAEC1',
  medium:   '#FCD34D',
  high:     '#F59E0B',
  critical: '#FCA5A5',
};
const STATUS_COLORS: Record<IncidentStatus, string> = {
  open:      '#FCA5A5',
  contained: '#FCD34D',
  closed:    '#86D69E',
};

export default function IncidentsClient({ initialIncidents }: { initialIncidents: Incident[] }) {
  const [incidents, setIncidents] = useState<Incident[]>(initialIncidents);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<IncidentSeverity>('medium');
  const [category, setCategory] = useState('');
  const [detectedAt, setDetectedAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createIncident(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError('Title is required.'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          severity,
          category: category.trim() || null,
          detected_at: detectedAt ? new Date(detectedAt).toISOString() : null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
      } else {
        setIncidents((s) => [json.incident as Incident, ...s]);
        setTitle(''); setCategory(''); setDetectedAt(''); setSeverity('medium'); setOpen(false);
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
            <div className="scorecard-title">Incidents</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Log of security incidents · Attach reports, link to NIST CSF controls, drive remediation
            </div>
          </div>
          <button className="action-btn primary" onClick={() => setOpen((v) => !v)}>
            {open ? 'Cancel' : 'Log incident'}
          </button>
        </div>

        {open && (
          <form onSubmit={createIncident} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0 16px' }}>
            <FieldRow label="Title" hint="Short, scannable. Example: 'M365 account compromise — jdoe@…'">
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="M365 account compromise — jdoe@…" autoFocus required style={fieldStyle} />
            </FieldRow>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <FieldRow label="Severity">
                <select value={severity} onChange={(e) => setSeverity(e.target.value as IncidentSeverity)} style={fieldStyle}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </FieldRow>
              <FieldRow label="Category" hint="BEC, phishing, malware, lost device, …">
                <input type="text" value={category} onChange={(e) => setCategory(e.target.value)}
                  placeholder="Business Email Compromise" style={fieldStyle} />
              </FieldRow>
              <FieldRow label="Detected at" hint="When the incident started or was first detected.">
                <input type="datetime-local" value={detectedAt} onChange={(e) => setDetectedAt(e.target.value)} style={fieldStyle} />
              </FieldRow>
            </div>
            {error && <div className="banner error">{error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="action-btn primary" disabled={busy}>
                {busy ? 'Creating…' : 'Create incident'}
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
              <th>Title</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Category</th>
              <th>Detected</th>
              <th>Linked controls</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {incidents.length === 0 && (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0' }}>
                  No incidents logged yet. Click <strong>Log incident</strong> to record one.
                </td>
              </tr>
            )}
            {incidents.map((i) => (
              <tr key={i.id}>
                <td><strong>{i.title}</strong></td>
                <td><Pill color={SEVERITY_COLORS[i.severity]}>{i.severity}</Pill></td>
                <td><Pill color={STATUS_COLORS[i.status]}>{i.status}</Pill></td>
                <td style={{ color: 'var(--text-mid)', fontSize: 12 }}>{i.category ?? '—'}</td>
                <td className="score-num" style={{ color: 'var(--text-mid)', fontSize: 11 }}>
                  {i.detected_at ? new Date(i.detected_at).toLocaleString() : '—'}
                </td>
                <td style={{ fontSize: 11 }}>
                  {i.linked_control_ids.length === 0
                    ? <span style={{ color: 'var(--text-muted)' }}>—</span>
                    : i.linked_control_ids.map((c) => (
                        <code key={c} style={{ color: 'var(--gold-light)', marginRight: 6 }}>{c}</code>
                      ))}
                </td>
                <td><Link href={`/incidents/${i.id}`} className="action-btn">Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      background: `${color}22`,
      color,
      border: `1px solid ${color}55`,
      borderRadius: 999,
      fontSize: 11,
      fontWeight: 600,
      textTransform: 'capitalize',
      letterSpacing: '0.04em',
    }}>{children}</span>
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
