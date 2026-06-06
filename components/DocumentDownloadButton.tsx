'use client';

import { useState } from 'react';

/**
 * Tiny client button that fetches a 60-second signed download URL for a
 * policy_documents row and opens it in a new tab. Used by the inline
 * viewer page so the rest of the page stays a server component.
 */
export default function DocumentDownloadButton({
  docId, label = 'Download',
}: {
  docId: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      const res = await fetch(`/api/policy-documents/${docId}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.download_url) {
        alert(j.error ?? 'download failed');
        return;
      }
      window.open(j.download_url, '_blank', 'noopener');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="action-btn"
      onClick={go}
      disabled={busy}
    >
      {busy ? 'Preparing…' : label}
    </button>
  );
}
