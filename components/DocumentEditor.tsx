'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import MarkdownView from '@/components/MarkdownView';
import DocumentDownloadButton from '@/components/DocumentDownloadButton';

/**
 * Client controller for the inline document viewer.
 *
 * Reused by /plans/[code]/view and /policies/[code]/view — the API
 * paths differ (`/api/plans-library/...` vs `/api/policy-library/...`)
 * but the UI flow is identical. The server page passes in the endpoint
 * URLs and the base viewer path.
 *
 * Three modes:
 *   - "read"   : MarkdownView of the current body. Default.
 *   - "edit"   : textarea editor (admins only) + live preview alongside.
 *                Save bumps the document to a new version.
 *   - "history": list of every revision in the lineage.
 *
 * The server page hands us the current document metadata + body; the
 * client fetches version history on demand so the page loads instantly
 * for the common case (read-only viewer).
 */
export type EditorMode = 'read' | 'edit' | 'history';

export interface EditableDocumentMeta {
  id: string;
  title: string;
  version: string | null;
  effective_date: string | null;
  last_reviewed_at: string | null;
  next_review_due: string | null;
}

interface VersionEntry {
  id: string;
  version: string | null;
  effective_date: string | null;
  status: string;
  change_note: string | null;
  uploaded_by: string | null;
  size_bytes: number | null;
  content_type: string | null;
  created_at: string;
  is_current: boolean;
}

export default function DocumentEditor({
  doc, initialBody, canEdit, viewingId,
  editApi, versionsApi, viewerBase,
}: {
  doc: EditableDocumentMeta;
  initialBody: string;
  canEdit: boolean;
  // If present, we're rendering a *specific* historical version, not
  // the live one. Edit is disabled in that mode.
  viewingId?: string | null;
  // Per-context API + URL paths. e.g. for plans:
  //   editApi     = "/api/plans-library/<code>/edit"
  //   versionsApi = "/api/plans-library/<code>/versions"
  //   viewerBase  = "/plans/<code>/view"
  editApi: string;
  versionsApi: string;
  viewerBase: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<EditorMode>('read');
  const [body, setBody] = useState(initialBody);
  const [draft, setDraft] = useState(initialBody);
  const [version, setVersion] = useState<string>(bumpClientSide(doc.version));
  const [changeNote, setChangeNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isViewingHistoricalSnapshot = !!viewingId && viewingId !== doc.id;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(editApi, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: draft,
          version: version.trim() || undefined,
          change_note: changeNote.trim() || undefined,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setError(j.error ?? `save failed (HTTP ${res.status})`);
        return;
      }
      // Refresh the server component so it picks up the new current doc.
      setBody(draft);
      setMode('read');
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Toolbar
        canEdit={canEdit && !isViewingHistoricalSnapshot}
        viewingHistorical={isViewingHistoricalSnapshot}
        mode={mode}
        onMode={(m) => {
          setError(null);
          if (m === 'edit') {
            setDraft(body);
            setVersion(bumpClientSide(doc.version));
            setChangeNote('');
          }
          setMode(m);
        }}
        currentDocId={doc.id}
      />

      {error && (
        <div className="banner error" style={{ marginTop: 8 }}>{error}</div>
      )}

      {mode === 'read' && <MarkdownView source={body} />}

      {mode === 'edit' && (
        <EditPane
          draft={draft} setDraft={setDraft}
          version={version} setVersion={setVersion}
          changeNote={changeNote} setChangeNote={setChangeNote}
          priorVersion={doc.version}
          saving={saving}
          onCancel={() => { setMode('read'); setError(null); }}
          onSave={save}
        />
      )}

      {mode === 'history' && (
        <HistoryPane
          versionsApi={versionsApi}
          viewerBase={viewerBase}
          currentDocId={doc.id}
          viewingId={viewingId ?? null}
        />
      )}
    </>
  );
}

function Toolbar({
  canEdit, viewingHistorical, mode, onMode, currentDocId,
}: {
  canEdit: boolean;
  viewingHistorical: boolean;
  mode: EditorMode;
  onMode: (m: EditorMode) => void;
  currentDocId: string;
}) {
  return (
    <div style={{
      display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12,
      paddingBottom: 10, borderBottom: '1px solid var(--bg-border)',
    }}>
      <button
        type="button"
        className={`action-btn ${mode === 'read' ? 'primary' : ''}`}
        style={{ padding: '3px 10px', fontSize: 12 }}
        onClick={() => onMode('read')}
      >
        Read
      </button>
      {canEdit && (
        <button
          type="button"
          className={`action-btn ${mode === 'edit' ? 'primary' : ''}`}
          style={{ padding: '3px 10px', fontSize: 12 }}
          onClick={() => onMode('edit')}
          title="Save edits as a new version. Prior versions are preserved."
        >
          Edit
        </button>
      )}
      <button
        type="button"
        className={`action-btn ${mode === 'history' ? 'primary' : ''}`}
        style={{ padding: '3px 10px', fontSize: 12 }}
        onClick={() => onMode('history')}
      >
        Version history
      </button>

      <div style={{ flex: 1 }} />

      <DocumentDownloadButton docId={currentDocId} />

      {viewingHistorical && (
        <span style={{
          fontSize: 11, color: '#9A3412', background: '#FED7AA',
          padding: '2px 8px', borderRadius: 4, fontWeight: 600,
        }}>
          Viewing historical revision
        </span>
      )}
    </div>
  );
}

function EditPane({
  draft, setDraft, version, setVersion, changeNote, setChangeNote,
  priorVersion, saving, onCancel, onSave,
}: {
  draft: string;
  setDraft: (s: string) => void;
  version: string;
  setVersion: (s: string) => void;
  changeNote: string;
  setChangeNote: (s: string) => void;
  priorVersion: string | null;
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mid)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
              New version label
            </span>
            <input
              type="text"
              className="score-select"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder={`bump from ${priorVersion ?? '—'}`}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 2 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mid)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
              Change note
            </span>
            <input
              type="text"
              className="score-select"
              value={changeNote}
              onChange={(e) => setChangeNote(e.target.value)}
              placeholder="What changed? (e.g. updated escalation contact in Section 12)"
            />
          </label>
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          style={{
            width: '100%',
            minHeight: '70vh',
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            fontSize: 12.5,
            lineHeight: 1.55,
            padding: 12,
            border: '1px solid var(--bg-border)',
            borderRadius: 4,
            background: 'var(--bg-card)',
            color: 'var(--text)',
            resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="action-btn primary"
            onClick={onSave}
            disabled={saving || draft.trim().length === 0}
          >
            {saving ? 'Saving…' : 'Save as new version'}
          </button>
          <button
            type="button"
            className="action-btn"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>
            Prior version is preserved in history.
          </span>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mid)', letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 4 }}>
          Live preview
        </div>
        <div style={{
          maxHeight: '78vh', overflowY: 'auto',
          padding: 16, border: '1px solid var(--bg-border)', borderRadius: 4,
          background: 'var(--bg-card)',
        }}>
          <MarkdownView source={draft} />
        </div>
      </div>
    </div>
  );
}

function HistoryPane({
  versionsApi, viewerBase, currentDocId, viewingId,
}: {
  versionsApi: string;
  viewerBase: string;
  currentDocId: string;
  viewingId: string | null;
}) {
  const [versions, setVersions] = useState<VersionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(versionsApi);
        const j = await res.json().catch(() => ({}));
        if (!res.ok) { setError(j.error ?? `HTTP ${res.status}`); return; }
        if (alive) setVersions(j.versions ?? []);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'load failed');
      }
    })();
    return () => { alive = false; };
  }, [versionsApi]);

  if (error) return <div className="banner error">{error}</div>;
  if (!versions) return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>;
  if (versions.length === 0) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No prior versions yet.</div>;
  }

  return (
    <table className="score-table">
      <thead>
        <tr>
          <th>Version</th>
          <th>Saved</th>
          <th>By</th>
          <th>Change note</th>
          <th>Size</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {versions.map((v) => {
          const isCurrent = v.id === currentDocId;
          const isBeingViewed = v.id === viewingId;
          return (
            <tr key={v.id} style={{ background: isBeingViewed ? 'var(--bg-card)' : undefined }}>
              <td>
                <strong>v{v.version ?? '—'}</strong>
                {isCurrent && (
                  <span style={{
                    marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                    background: '#D1FAE5', color: '#065F46', letterSpacing: '.04em',
                  }}>CURRENT</span>
                )}
                {!isCurrent && v.status === 'archived' && (
                  <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-muted)' }}>archived</span>
                )}
              </td>
              <td style={{ fontSize: 12 }}>{new Date(v.created_at).toLocaleString()}</td>
              <td style={{ fontSize: 12, color: 'var(--text-mid)' }}>{v.uploaded_by ?? '—'}</td>
              <td style={{ fontSize: 12 }}>{v.change_note ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
              <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{formatBytes(v.size_bytes)}</td>
              <td>
                {isCurrent ? (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>shown above</span>
                ) : (
                  <a
                    className="action-btn"
                    href={`${viewerBase}?v=${v.id}`}
                    style={{ padding: '3px 9px', fontSize: 11 }}
                  >
                    View this version
                  </a>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function bumpClientSide(prev: string | null | undefined): string {
  // Mirror of lib/document-revisions.ts bumpVersion. Kept in sync —
  // the server is the source of truth, but pre-filling the field with
  // the expected bump makes editing smoother.
  if (!prev || !prev.trim()) return '1.1';
  const trimmed = prev.trim();
  const m = trimmed.match(/^(.*?)(\d+)$/);
  if (!m) return `${trimmed}.1`;
  const [, head, last] = m;
  return `${head}${String(parseInt(last, 10) + 1)}`;
}

function formatBytes(n: number | null): string {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
