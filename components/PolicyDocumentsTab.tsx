'use client';

import { useRef, useState } from 'react';
import type { PolicyDocument, PolicyDocumentStatus } from '@/lib/supabase/types';

const STATUSES: PolicyDocumentStatus[] = ['draft', 'published', 'archived'];
const STATUS_COLORS: Record<PolicyDocumentStatus, string> = {
  draft: '#9AAEC1',
  published: '#86D69E',
  archived: '#FCA5A5',
};

export default function PolicyDocumentsTab({ initialDocuments }: { initialDocuments: PolicyDocument[] }) {
  const [docs, setDocs] = useState<PolicyDocument[]>(initialDocuments);
  const [open, setOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [pending, setPending] = useState<File | null>(null);

  // form fields
  const [title, setTitle] = useState('');
  const [version, setVersion] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [owner, setOwner] = useState('');
  const [status, setStatus] = useState<PolicyDocumentStatus>('published');
  const [description, setDescription] = useState('');
  const [linkedText, setLinkedText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickFile(f: File) {
    setPending(f);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
    setOpen(true);
  }

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!pending) { setError('Choose a file first.'); return; }
    setBusy(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('file', pending);
      fd.append('title', title.trim() || pending.name);
      if (version.trim())       fd.append('version', version.trim());
      if (effectiveDate)        fd.append('effective_date', effectiveDate);
      if (owner.trim())         fd.append('owner', owner.trim());
      fd.append('status', status);
      if (description.trim())   fd.append('description', description.trim());
      if (linkedText.trim())    fd.append('linked_control_ids', linkedText.trim());

      const res = await fetch('/api/policy-documents', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
      } else {
        setDocs((d) => [json.document as PolicyDocument, ...d]);
        // reset form
        setPending(null); setTitle(''); setVersion(''); setEffectiveDate('');
        setOwner(''); setStatus('published'); setDescription(''); setLinkedText('');
        setOpen(false);
        if (fileInput.current) fileInput.current.value = '';
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function download(doc: PolicyDocument) {
    const res = await fetch(`/api/policy-documents/${doc.id}`);
    const json = await res.json();
    if (json.download_url) window.open(json.download_url, '_blank');
  }

  async function remove(doc: PolicyDocument) {
    if (!confirm(`Delete ${doc.title}? The file will be removed from storage.`)) return;
    const res = await fetch(`/api/policy-documents/${doc.id}`, { method: 'DELETE' });
    if (res.ok) setDocs((d) => d.filter((x) => x.id !== doc.id));
  }

  return (
    <>
      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Policy Documents</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Uploaded artifacts that back NIST CSF 2.0 scoring · {docs.length} document{docs.length === 1 ? '' : 's'}
            </div>
          </div>
          <div>
            <input ref={fileInput} type="file"
              accept=".pdf,.docx,.doc,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); }}
              style={{ display: 'none' }} />
            <button className="action-btn primary" onClick={() => fileInput.current?.click()} disabled={busy}>
              {busy ? 'Uploading…' : 'Upload policy'}
            </button>
          </div>
        </div>

        {open && pending && (
          <form onSubmit={upload} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '8px 0 16px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>
              <strong>File:</strong> {pending.name} · {(pending.size / 1024).toFixed(1)} KB
            </div>
            <FieldRow label="Title">
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="IT Policies and Procedures" autoFocus required style={fieldStyle} />
            </FieldRow>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <FieldRow label="Version" hint="Freeform — '1.2', '2026-Q2', etc.">
                <input type="text" value={version} onChange={(e) => setVersion(e.target.value)} style={fieldStyle} />
              </FieldRow>
              <FieldRow label="Effective date">
                <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} style={fieldStyle} />
              </FieldRow>
              <FieldRow label="Status">
                <select value={status} onChange={(e) => setStatus(e.target.value as PolicyDocumentStatus)} style={fieldStyle}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </FieldRow>
            </div>
            <FieldRow label="Owner" hint="Person or role responsible (Director of IT, CISO, etc.)">
              <input type="text" value={owner} onChange={(e) => setOwner(e.target.value)} style={fieldStyle} />
            </FieldRow>
            <FieldRow label="Linked NIST CSF controls" hint="Comma-separated control IDs this document satisfies. Example: PR.AA-05, DE.AE-02, RS.MA-01">
              <input type="text" value={linkedText} onChange={(e) => setLinkedText(e.target.value)}
                placeholder="PR.AA-05, DE.AE-02" style={fieldStyle} />
            </FieldRow>
            <FieldRow label="Description (optional)">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                rows={3} style={{ ...fieldStyle, resize: 'vertical', minHeight: 60 }} />
            </FieldRow>
            {error && <div className="banner error">{error}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="action-btn primary" disabled={busy}>
                {busy ? 'Uploading…' : 'Upload'}
              </button>
              <button type="button" className="action-btn"
                onClick={() => { setOpen(false); setPending(null); if (fileInput.current) fileInput.current.value = ''; }}>
                Cancel
              </button>
            </div>
          </form>
        )}

        <table className="score-table" style={{ marginTop: 0 }}>
          <thead>
            <tr>
              <th>Title</th>
              <th>Version</th>
              <th>Effective</th>
              <th>Status</th>
              <th>Owner</th>
              <th>Linked controls</th>
              <th>Size</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '24px 0' }}>
                  No policy documents uploaded yet. Click <strong>Upload policy</strong> to add one.
                </td>
              </tr>
            )}
            {docs.map((d) => (
              <tr key={d.id}>
                <td><strong>{d.title}</strong>{d.description && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{d.description.slice(0, 90)}{d.description.length > 90 ? '…' : ''}</div>}</td>
                <td><code style={{ color: 'var(--gold-light)', fontSize: 11 }}>{d.version ?? '—'}</code></td>
                <td className="score-num" style={{ color: 'var(--text-mid)', fontSize: 11 }}>{d.effective_date ?? '—'}</td>
                <td>
                  <span style={{
                    display: 'inline-block', padding: '2px 8px',
                    background: `${STATUS_COLORS[d.status]}22`, color: STATUS_COLORS[d.status],
                    border: `1px solid ${STATUS_COLORS[d.status]}55`, borderRadius: 999,
                    fontSize: 11, fontWeight: 600, textTransform: 'capitalize',
                  }}>{d.status}</span>
                </td>
                <td style={{ color: 'var(--text-mid)', fontSize: 11 }}>{d.owner ?? '—'}</td>
                <td style={{ fontSize: 11, maxWidth: 300 }}>
                  {d.linked_control_ids.length === 0
                    ? <span style={{ color: 'var(--text-muted)' }}>—</span>
                    : <span style={{ color: 'var(--gold-light)' }}>
                        {d.linked_control_ids.length} control{d.linked_control_ids.length === 1 ? '' : 's'}
                      </span>}
                </td>
                <td className="score-num" style={{ color: 'var(--text-mid)', fontSize: 11 }}>
                  {d.size_bytes != null ? formatBytes(d.size_bytes) : '—'}
                </td>
                <td style={{ display: 'flex', gap: 6 }}>
                  <button className="action-btn" onClick={() => download(d)}>Download</button>
                  <button className="action-btn" onClick={() => remove(d)}>Delete</button>
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
