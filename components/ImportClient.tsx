'use client';

import { useState } from 'react';

interface ImportResult {
  ok: boolean;
  imported_controls: number;
  skipped: number;
  snapshot_id: string;
  snapshot_label: string;
}

const LEGACY_EXPORT_SNIPPET = `(()=>{const k='cl_csf20_v1';const d=localStorage.getItem(k);if(!d){alert('No legacy data found in localStorage under key '+k);return;}const a=document.createElement('a');a.href='data:application/json;charset=utf-8,'+encodeURIComponent(d);a.download='legacy-'+new Date().toISOString().slice(0,10)+'.json';document.body.appendChild(a);a.click();document.body.removeChild(a);})();`;

export default function ImportClient({ tenantSlug }: { tenantSlug: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit() {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });
      const json = (await res.json()) as ImportResult & { error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
      } else {
        setResult(json);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(LEGACY_EXPORT_SNIPPET);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <section className="scorecard">
      <div className="scorecard-header">
        <div>
          <div className="scorecard-title">Legacy Data Import</div>
          <div className="scorecard-tag" style={{ marginTop: 4 }}>
            Tenant · {tenantSlug}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 0' }}>
        <div>
          <p style={{ color: 'var(--text)', marginBottom: 8 }}>
            <strong>Step 1.</strong> Open the legacy site (e.g.{' '}
            <code>https://usi-one.github.io/Collision-Leaders/</code>) in a separate tab.
          </p>
          <p style={{ color: 'var(--text)', marginBottom: 8 }}>
            <strong>Step 2.</strong> Open the browser console (F12 → Console) and paste this
            snippet, then press Enter. A JSON file will download.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
            <pre style={{
              flex: 1,
              background: 'var(--bg-deep)',
              border: '1px solid var(--bg-border)',
              padding: 12,
              fontSize: 11,
              fontFamily: 'JetBrains Mono, monospace',
              overflowX: 'auto',
              borderRadius: 2,
              color: 'var(--text)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {LEGACY_EXPORT_SNIPPET}
            </pre>
            <button className="action-btn" onClick={copySnippet} style={{ alignSelf: 'flex-start' }}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div>
          <p style={{ color: 'var(--text)', marginBottom: 12 }}>
            <strong>Step 3.</strong> Upload the downloaded JSON file here. The server will populate
            the current scores for this tenant and create a baseline snapshot dated today.
          </p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              style={{ flex: 1, color: 'var(--text-mid)' }}
            />
            <button
              className="action-btn primary"
              disabled={!file || busy}
              onClick={handleSubmit}
            >
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>

        {error && <div className="banner error">{error}</div>}
        {result && (
          <div className="banner success">
            Imported {result.imported_controls} controls
            {result.skipped > 0 && ` (${result.skipped} skipped)`}.
            Baseline snapshot &quot;{result.snapshot_label}&quot; created.
            <div style={{ marginTop: 8 }}>
              <a href="/" style={{ color: 'var(--gold-light)', textDecoration: 'underline' }}>
                Open the worksheet →
              </a>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
