'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type {
  Incident,
  IncidentDocument,
  IncidentSeverity,
  IncidentStatus,
} from '@/lib/supabase/types';
import { textToTimeline, timelineToText } from '@/lib/incidents/timeline';

const STATUSES: IncidentStatus[] = ['open', 'contained', 'closed'];
const SEVERITIES: IncidentSeverity[] = ['low', 'medium', 'high', 'critical'];

/** Convert an ISO string to the value a <input type="datetime-local"> expects. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Parse a textarea where each non-empty line becomes one array entry. */
function linesToArray(s: string): string[] {
  return s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}
function arrayToLines(a: string[]): string {
  return a.join('\n');
}

// timelineToText / textToTimeline live in lib/incidents/timeline so the
// PDF report and the editor agree on parsing — the smart split also picks
// up "5/4/2026, 5:12 PM (MT) — Spoofed email…" without an explicit pipe.

export default function IncidentEditor({
  initialIncident,
  initialDocuments,
}: {
  initialIncident: Incident;
  initialDocuments: IncidentDocument[];
}) {
  const router = useRouter();
  const [inc, setInc] = useState<Incident>(initialIncident);
  const [docs, setDocs] = useState<IncidentDocument[]>(initialDocuments);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  // Inline string state for the textarea-backed array fields. We mirror the
  // canonical shape on the Incident object on save, not on every keystroke,
  // so edits don't get reformatted while the user is typing.
  const [findings, setFindings] = useState(arrayToLines(inc.findings));
  const [actions, setActions] = useState(arrayToLines(inc.actions));
  const [recommendations, setRecommendations] = useState(arrayToLines(inc.recommendations));
  const [timelineText, setTimelineText] = useState(timelineToText(inc.timeline));
  const [affectedText, setAffectedText] = useState(inc.affected_users.join(', '));
  const [linkedText, setLinkedText] = useState(inc.linked_control_ids.join(', '));

  function setField<K extends keyof Incident>(k: K, v: Incident[K]) {
    setInc((cur) => ({ ...cur, [k]: v }));
  }

  async function save() {
    setSaving(true); setError(null);
    try {
      const patch: Partial<Incident> = {
        title: inc.title,
        status: inc.status,
        severity: inc.severity,
        category: inc.category,
        detected_at: inc.detected_at,
        contained_at: inc.contained_at,
        closed_at: inc.closed_at,
        reported_by: inc.reported_by,
        description: inc.description,
        affected_users: affectedText.split(',').map((s) => s.trim()).filter(Boolean),
        timeline: textToTimeline(timelineText),
        findings: linesToArray(findings),
        actions: linesToArray(actions),
        recommendations: linesToArray(recommendations),
        linked_control_ids: linkedText.split(',').map((s) => s.trim()).filter(Boolean),
      };
      const res = await fetch(`/api/incidents/${inc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
      } else {
        setInc(json.incident as Incident);
        setSavedAt(new Date());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }

  async function uploadFile(file: File) {
    setUploading(true); setUploadError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/incidents/${inc.id}/documents`, { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setUploadError(json.error ?? `HTTP ${res.status}`);
      } else {
        setDocs((d) => [json.document as IncidentDocument, ...d]);
      }
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'upload failed');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function downloadDoc(doc: IncidentDocument) {
    const res = await fetch(`/api/incidents/${inc.id}/documents/${doc.id}`);
    const json = await res.json();
    if (json.url) window.open(json.url, '_blank');
  }

  async function deleteDoc(doc: IncidentDocument) {
    if (!confirm(`Delete ${doc.filename}?`)) return;
    const res = await fetch(`/api/incidents/${inc.id}/documents/${doc.id}`, { method: 'DELETE' });
    if (res.ok) setDocs((d) => d.filter((x) => x.id !== doc.id));
  }

  async function deleteIncident() {
    if (!confirm(`Delete this incident? Attached documents will also be removed.`)) return;
    const res = await fetch(`/api/incidents/${inc.id}`, { method: 'DELETE' });
    if (res.ok) router.push('/incidents');
  }

  return (
    <>
      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">{inc.title || 'Incident'}</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Created {new Date(inc.created_at).toLocaleString()} · Last updated {new Date(inc.updated_at).toLocaleString()}
              {savedAt && <span style={{ color: '#15803D', marginLeft: 12 }}>Saved {savedAt.toLocaleTimeString()}</span>}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="action-btn" onClick={deleteIncident}>Delete</button>
            <a className="action-btn"
               href={`/api/incidents/${inc.id}/report`}
               title="Generate a board-ready PDF executive briefing for this incident"
               // download attr nudges the browser to save instead of preview;
               // Content-Disposition on the route is the real instruction.
               download>
              Generate Executive Report
            </a>
            <button className="action-btn primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {error && <div className="banner error">{error}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FieldRow label="Title">
            <input type="text" value={inc.title} onChange={(e) => setField('title', e.target.value)} style={fieldStyle} />
          </FieldRow>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <FieldRow label="Status">
              <select value={inc.status} onChange={(e) => setField('status', e.target.value as IncidentStatus)} style={fieldStyle}>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </FieldRow>
            <FieldRow label="Severity">
              <select value={inc.severity} onChange={(e) => setField('severity', e.target.value as IncidentSeverity)} style={fieldStyle}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </FieldRow>
            <FieldRow label="Category">
              <input type="text" value={inc.category ?? ''} onChange={(e) => setField('category', e.target.value)}
                placeholder="Business Email Compromise" style={fieldStyle} />
            </FieldRow>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <FieldRow label="Detected at">
              <input type="datetime-local" value={toLocalInput(inc.detected_at)}
                onChange={(e) => setField('detected_at', fromLocalInput(e.target.value))} style={fieldStyle} />
            </FieldRow>
            <FieldRow label="Contained at">
              <input type="datetime-local" value={toLocalInput(inc.contained_at)}
                onChange={(e) => setField('contained_at', fromLocalInput(e.target.value))} style={fieldStyle} />
            </FieldRow>
            <FieldRow label="Closed at">
              <input type="datetime-local" value={toLocalInput(inc.closed_at)}
                onChange={(e) => setField('closed_at', fromLocalInput(e.target.value))} style={fieldStyle} />
            </FieldRow>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FieldRow label="Reported by">
              <input type="text" value={inc.reported_by ?? ''} onChange={(e) => setField('reported_by', e.target.value)}
                placeholder="Universal Systems Inc. (USI)" style={fieldStyle} />
            </FieldRow>
            <FieldRow label="Affected users" hint="Comma-separated email addresses or accounts.">
              <input type="text" value={affectedText} onChange={(e) => setAffectedText(e.target.value)}
                placeholder="user@example.com, …" style={fieldStyle} />
            </FieldRow>
          </div>

          <FieldRow label="Description / Executive Summary">
            <textarea value={inc.description ?? ''} onChange={(e) => setField('description', e.target.value)}
              rows={5} style={{ ...fieldStyle, resize: 'vertical', minHeight: 100 }} />
          </FieldRow>

          <FieldRow label="Timeline" hint="One per line. Either 'when | what' or 'when — what' works (— is em-dash). Example: 2026-04-07 — Sign-in from Denver, CO.">
            <textarea value={timelineText} onChange={(e) => setTimelineText(e.target.value)}
              rows={5} style={{ ...fieldStyle, resize: 'vertical', minHeight: 100, fontFamily: 'JetBrains Mono, monospace' }} />
          </FieldRow>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <FieldRow label="Key findings" hint="One per line.">
              <textarea value={findings} onChange={(e) => setFindings(e.target.value)}
                rows={5} style={{ ...fieldStyle, resize: 'vertical', minHeight: 100 }} />
            </FieldRow>
            <FieldRow label="Containment / Remediation actions" hint="One per line.">
              <textarea value={actions} onChange={(e) => setActions(e.target.value)}
                rows={5} style={{ ...fieldStyle, resize: 'vertical', minHeight: 100 }} />
            </FieldRow>
          </div>

          <FieldRow label="Recommendations" hint="One per line. These often become controls to score higher next quarter.">
            <textarea value={recommendations} onChange={(e) => setRecommendations(e.target.value)}
              rows={4} style={{ ...fieldStyle, resize: 'vertical', minHeight: 80 }} />
          </FieldRow>

          <FieldRow label="Linked NIST CSF controls" hint="Comma-separated control IDs that this incident exposed as gaps. Example: PR.AA-05, DE.AE-02, RS.MA-01">
            <input type="text" value={linkedText} onChange={(e) => setLinkedText(e.target.value)}
              placeholder="PR.AA-05, DE.AE-02" style={fieldStyle} />
          </FieldRow>
        </div>
      </section>

      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Documents</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Incident reports, screenshots, log exports. Files are stored privately and downloaded via short-lived signed URLs.
            </div>
          </div>
          <div>
            <input ref={fileInput} type="file"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
              disabled={uploading} style={{ display: 'none' }} />
            <button className="action-btn primary"
              onClick={() => fileInput.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Upload file'}
            </button>
          </div>
        </div>
        {uploadError && <div className="banner error">{uploadError}</div>}
        <table className="score-table" style={{ marginTop: 0 }}>
          <thead>
            <tr><th>Filename</th><th>Type</th><th>Size</th><th>Uploaded</th><th></th></tr>
          </thead>
          <tbody>
            {docs.length === 0 && (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0' }}>
                  No documents attached yet.
                </td>
              </tr>
            )}
            {docs.map((d) => (
              <tr key={d.id}>
                <td><strong>{d.filename}</strong></td>
                <td style={{ color: 'var(--text-mid)', fontSize: 11 }}>{d.content_type ?? '—'}</td>
                <td className="score-num" style={{ color: 'var(--text-mid)', fontSize: 11 }}>
                  {d.size_bytes != null ? formatBytes(d.size_bytes) : '—'}
                </td>
                <td className="score-num" style={{ color: 'var(--text-mid)', fontSize: 11 }}>
                  {new Date(d.created_at).toLocaleString()}
                </td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="action-btn" onClick={() => downloadDoc(d)}>Download</button>
                  <button className="action-btn" onClick={() => deleteDoc(d)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
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
