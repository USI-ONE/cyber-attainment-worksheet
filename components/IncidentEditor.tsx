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

/** One row in the bulk-upload progress list. `error` populated on failure. */
type UploadItem = {
  id: string;
  filename: string;
  size: number;
  status: 'queued' | 'uploading' | 'done' | 'failed';
  error?: string;
};

/**
 * Run uploads with a max-concurrency cap so a 20-file batch neither stalls
 * (sequential is slow) nor hammers the server (all-at-once can exhaust
 * the Supabase Storage rate limit on small projects). Three is empirically
 * a comfortable spot for the project's serverless function quotas.
 */
const UPLOAD_CONCURRENCY = 3;

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
  // Per-file progress for bulk uploads. The list is cleared on the next
  // upload kick-off, so failed items stay visible until the user retries.
  const [uploadQueue, setUploadQueue] = useState<UploadItem[]>([]);
  const [draggingOver, setDraggingOver] = useState(false);
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

  /**
   * Bulk upload entry point. Works for one file or many — the file picker
   * (with `multiple`) and the drop zone both funnel here. Drives the
   * per-file progress list while running at most UPLOAD_CONCURRENCY
   * uploads in flight at a time.
   */
  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);

    const queue: UploadItem[] = files.map((f) => ({
      id: crypto.randomUUID(),
      filename: f.name,
      size: f.size,
      status: 'queued',
    }));
    setUploadQueue(queue);

    let cursor = 0;
    let failures = 0;

    async function worker() {
      while (cursor < files.length) {
        const idx = cursor++;
        const file = files[idx];
        const itemId = queue[idx].id;
        setUploadQueue((q) => q.map((x) => x.id === itemId ? { ...x, status: 'uploading' } : x));
        try {
          const fd = new FormData();
          fd.append('file', file);
          const res = await fetch(`/api/incidents/${inc.id}/documents`, { method: 'POST', body: fd });
          const json = await res.json().catch(() => ({}));
          if (!res.ok || !json.ok) {
            failures++;
            setUploadQueue((q) => q.map((x) => x.id === itemId
              ? { ...x, status: 'failed', error: json.error ?? `HTTP ${res.status}` }
              : x));
          } else {
            setUploadQueue((q) => q.map((x) => x.id === itemId ? { ...x, status: 'done' } : x));
            setDocs((d) => [json.document as IncidentDocument, ...d]);
          }
        } catch (err) {
          failures++;
          setUploadQueue((q) => q.map((x) => x.id === itemId
            ? { ...x, status: 'failed', error: err instanceof Error ? err.message : 'upload failed' }
            : x));
        }
      }
    }

    // Spin up workers up to the concurrency cap (or as many as there are
    // files, whichever is smaller).
    await Promise.all(
      Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, () => worker()),
    );

    setUploading(false);
    if (fileInput.current) fileInput.current.value = '';
    if (failures > 0) {
      setUploadError(`${failures} of ${files.length} upload${failures > 1 ? 's' : ''} failed — see the list below.`);
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
              {savedAt && <span style={{ color: '#10B981', marginLeft: 12 }}>Saved {savedAt.toLocaleTimeString()}</span>}
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
              rows={5} style={{ ...fieldStyle, resize: 'vertical', minHeight: 100, fontFamily: 'Inter, sans-serif' }} />
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

      <section
        className="scorecard"
        // Drop zone: drag a folder's worth of files onto the section to
        // queue them all. The visual feedback while dragging is a 2px
        // accent outline; we use a CSS-variable fallback so themed
        // tenants get a sensible color.
        onDragOver={(e) => {
          if (uploading) return;
          // Without preventDefault the browser will navigate to the file.
          e.preventDefault();
          if (!draggingOver) setDraggingOver(true);
        }}
        onDragLeave={(e) => {
          // Only clear when the drag actually leaves the section, not when
          // it crosses into a child element.
          if (e.currentTarget === e.target) setDraggingOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDraggingOver(false);
          if (uploading) return;
          const dropped = Array.from(e.dataTransfer.files);
          if (dropped.length) uploadFiles(dropped);
        }}
        style={draggingOver ? { outline: '2px dashed var(--gold, #2563EB)', outlineOffset: -4 } : undefined}
      >
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Documents</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Incident reports, screenshots, log exports. Files are stored privately and downloaded via short-lived signed URLs.
              {' '}<em>Drag multiple files onto this card or use the button to select several at once.</em>
            </div>
          </div>
          <div>
            <input ref={fileInput} type="file" multiple
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length) uploadFiles(files);
              }}
              disabled={uploading} style={{ display: 'none' }} />
            <button className="action-btn primary"
              onClick={() => fileInput.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading…' : 'Upload files'}
            </button>
          </div>
        </div>
        {uploadError && <div className="banner error">{uploadError}</div>}
        {uploadQueue.length > 0 && (
          <UploadProgressList
            items={uploadQueue}
            onDismiss={() => setUploadQueue([])}
            uploading={uploading}
          />
        )}
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
      <label style={{ fontFamily: 'Inter, sans-serif', fontWeight: 500, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--text-mid)' }}>
        {label}
      </label>
      {children}
      {hint && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{hint}</span>}
    </div>
  );
}

const STATUS_COLOR: Record<UploadItem['status'], string> = {
  queued:    'var(--text-muted)',
  uploading: '#F59E0B', // amber
  done:      '#10B981', // emerald
  failed:    '#DC2626', // red
};

const STATUS_LABEL: Record<UploadItem['status'], string> = {
  queued:    'Queued',
  uploading: 'Uploading…',
  done:      'Done',
  failed:    'Failed',
};

/**
 * Compact per-file progress list for a bulk upload. Stays visible after
 * the batch finishes so the user can see which files failed and what
 * went wrong; a "Clear" button dismisses it once they've read the result.
 */
function UploadProgressList({
  items, onDismiss, uploading,
}: {
  items: UploadItem[];
  onDismiss: () => void;
  uploading: boolean;
}) {
  const counts = items.reduce(
    (acc, it) => { acc[it.status]++; return acc; },
    { queued: 0, uploading: 0, done: 0, failed: 0 } as Record<UploadItem['status'], number>,
  );
  return (
    <div style={{
      marginTop: 10, marginBottom: 8,
      padding: 10, border: '1px solid var(--bg-border)',
      borderRadius: 4, background: 'var(--bg-card)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <strong style={{ fontSize: 12 }}>
          Bulk upload — {counts.done} done · {counts.uploading} uploading · {counts.queued} queued
          {counts.failed > 0 && <span style={{ color: STATUS_COLOR.failed }}> · {counts.failed} failed</span>}
        </strong>
        {!uploading && (
          <button className="action-btn" style={{ fontSize: 11, padding: '3px 9px' }} onClick={onDismiss}>
            Clear
          </button>
        )}
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {items.map((it) => (
          <div key={it.id} style={{
            display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 8,
            fontSize: 11, padding: '3px 6px',
            borderBottom: '1px dotted var(--bg-border)',
          }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.filename}>
              {it.filename}
            </span>
            <span style={{ color: 'var(--text-muted)' }}>{formatBytes(it.size)}</span>
            <span style={{ color: STATUS_COLOR[it.status], fontWeight: 600 }}>
              {STATUS_LABEL[it.status]}
            </span>
            {it.error && (
              <span style={{ gridColumn: '1 / -1', color: STATUS_COLOR.failed, fontSize: 10 }}>
                {it.error}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
