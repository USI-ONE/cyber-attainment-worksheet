'use client';

import { useMemo, useRef, useState } from 'react';

/**
 * Plans Library — operational checklist UI. Same shape as
 * PolicyLibraryClient by design so users have one mental model:
 *
 *   1. Catalog of standard plans (platform-wide).
 *   2. Per-tenant state: status / version / last reviewed / next due.
 *   3. Inline download + replace for the attached document.
 */
export interface PlansLibraryItem {
  code: string;
  title: string;
  category: 'resilience' | 'operational' | 'risk_compliance' | 'strategic';
  description: string | null;
  default_review_months: number;
  sort_order: number;
  state: {
    id: string;
    status: 'missing' | 'draft' | 'active' | 'expired' | 'na';
    version: string | null;
    last_reviewed_at: string | null;
    next_review_due: string | null;
    owner_user_id: string | null;
    plan_document_id: string | null;
    notes: string | null;
    updated_at: string;
    updated_by: string | null;
  } | null;
}

const CATEGORY_LABEL: Record<PlansLibraryItem['category'], string> = {
  resilience:       'Resilience',
  operational:      'Operational',
  risk_compliance:  'Risk & Compliance',
  strategic:        'Strategic',
};

const STATUS_STYLES: Record<NonNullable<PlansLibraryItem['state']>['status'], { bg: string; fg: string; label: string }> = {
  missing:  { bg: '#FEE2E2', fg: '#991B1B', label: 'Missing' },
  draft:    { bg: '#FEF3C7', fg: '#92400E', label: 'Draft' },
  active:   { bg: '#D1FAE5', fg: '#065F46', label: 'Active' },
  expired:  { bg: '#FED7AA', fg: '#9A3412', label: 'Expired' },
  na:       { bg: '#E5E7EB', fg: '#374151', label: 'N/A' },
};

function effectiveStatus(item: PlansLibraryItem): NonNullable<PlansLibraryItem['state']>['status'] {
  return item.state?.status ?? 'missing';
}

function daysUntilReview(item: PlansLibraryItem): number | null {
  const d = item.state?.next_review_due;
  if (!d) return null;
  const target = new Date(d + 'T00:00:00');
  const now = new Date();
  const ms = target.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round(ms / 86400000);
}

export default function PlansLibraryClient({
  items: initialItems, canEdit,
}: {
  items: PlansLibraryItem[];
  canEdit: boolean;
}) {
  const [items, setItems] = useState<PlansLibraryItem[]>(initialItems);

  const counts = useMemo(() => {
    let active = 0, dueSoon = 0, missing = 0, overdue = 0;
    for (const it of items) {
      const st = effectiveStatus(it);
      if (st === 'active') active++;
      if (st === 'missing' || st === 'expired') missing++;
      const days = daysUntilReview(it);
      if (days !== null) {
        if (days < 0) overdue++;
        else if (days <= 30) dueSoon++;
      }
    }
    return { active, dueSoon, missing, overdue };
  }, [items]);

  const groups = useMemo(() => {
    const order: PlansLibraryItem['category'][] = ['resilience','operational','risk_compliance','strategic'];
    return order
      .map((cat) => ({
        category: cat,
        label: CATEGORY_LABEL[cat],
        rows: items.filter((i) => i.category === cat),
      }))
      .filter((g) => g.rows.length > 0);
  }, [items]);

  async function uploadPlanDocument(code: string, file: File, version?: string): Promise<string | null> {
    const form = new FormData();
    form.append('file', file);
    if (version) form.append('version', version);
    const res = await fetch(`/api/plans-library/${code}/document`, { method: 'POST', body: form });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(j.error ?? 'document upload failed');
      return null;
    }
    const newDocId: string = j.document.id;
    const newVersion: string = j.document.version;
    const today = new Date().toISOString().slice(0, 10);
    setItems((cur) => cur.map((it) => it.code === code
      ? {
          ...it,
          state: {
            ...(it.state ?? makeBlankState()),
            plan_document_id: newDocId,
            version: newVersion,
            last_reviewed_at: today,
            status: 'active',
          },
        }
      : it));
    return newDocId;
  }

  async function patch(code: string, fields: Record<string, unknown>) {
    setItems((cur) => cur.map((it) => it.code === code
      ? { ...it, state: { ...(it.state ?? makeBlankState()), ...fields } as PlansLibraryItem['state'] }
      : it));

    const res = await fetch(`/api/plans-library/${code}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(j.error ?? 'update failed');
      return;
    }
    if (j.state) {
      setItems((cur) => cur.map((it) => it.code === code ? { ...it, state: j.state } : it));
    }
  }

  return (
    <>
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KpiTile label="Active" value={counts.active.toString()} sub="plans in force" accent="#10B981" />
        <KpiTile label="Due within 30 days" value={counts.dueSoon.toString()} sub="upcoming reviews" accent="#F59E0B" />
        <KpiTile label="Overdue" value={counts.overdue.toString()} sub="past next-review date" accent="#DC2626" />
        <KpiTile label="Missing or expired" value={counts.missing.toString()} sub="not in force" accent="#64748B" />
      </div>

      <section className="scorecard" style={{ marginTop: 16 }}>
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Plans Library</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              The standard set of operational plans every organization should maintain. Mark each one Active when it&apos;s in force; attach the actual plan document via Upload. Review cadence is typically annual.
              {!canEdit && <> &middot; <em>Read-only view</em></>}
            </div>
          </div>
        </div>

        {groups.map((g) => (
          <div key={g.category} style={{ marginTop: 18 }}>
            <h3 style={{
              fontFamily: 'Inter, sans-serif', fontSize: 12, fontWeight: 700,
              letterSpacing: '.06em', textTransform: 'uppercase',
              color: 'var(--text-mid)', margin: '0 0 6px 0',
            }}>
              {g.label}
            </h3>
            <table className="score-table">
              <thead>
                <tr>
                  <th style={{ width: '36%' }}>Plan</th>
                  <th>Status</th>
                  <th>Version</th>
                  <th>Last reviewed</th>
                  <th>Next due</th>
                  <th>Document</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((it) => (
                  <PlanRow
                    key={it.code}
                    item={it}
                    canEdit={canEdit}
                    onChange={patch}
                    onReplaced={uploadPlanDocument}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
    </>
  );
}

function PlanRow({
  item, canEdit, onChange, onReplaced,
}: {
  item: PlansLibraryItem;
  canEdit: boolean;
  onChange: (code: string, fields: Record<string, unknown>) => void;
  onReplaced: (code: string, file: File, version?: string) => Promise<string | null>;
}) {
  const st = effectiveStatus(item);
  const style = STATUS_STYLES[st];
  const days = daysUntilReview(item);

  let dueColor = 'var(--text-mid)';
  let dueLabel = item.state?.next_review_due ?? '—';
  if (days !== null) {
    if (days < 0)        { dueColor = '#DC2626'; dueLabel = `${item.state!.next_review_due} (${Math.abs(days)}d overdue)`; }
    else if (days <= 30) { dueColor = '#F59E0B'; dueLabel = `${item.state!.next_review_due} (in ${days}d)`; }
  }

  return (
    <tr>
      <td>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{item.title}</span>
          {item.description && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{item.description}</span>
          )}
        </div>
      </td>
      <td>
        {canEdit ? (
          <select
            className="score-select"
            value={st}
            onChange={(e) => onChange(item.code, { status: e.target.value })}
          >
            <option value="missing">Missing</option>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="na">N/A</option>
          </select>
        ) : (
          <span style={{
            fontSize: 10.5, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
            background: style.bg, color: style.fg, letterSpacing: '.04em',
          }}>{style.label}</span>
        )}
      </td>
      <td>
        {canEdit ? (
          <input
            className="score-select" style={{ width: 80 }}
            defaultValue={item.state?.version ?? ''}
            placeholder="e.g. 1.0"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== (item.state?.version ?? '')) onChange(item.code, { version: v });
            }}
          />
        ) : (
          <span style={{ fontFamily: 'Inter, sans-serif', fontSize: 12 }}>{item.state?.version ?? '—'}</span>
        )}
      </td>
      <td>
        {canEdit ? (
          <input
            type="date"
            className="score-select"
            defaultValue={item.state?.last_reviewed_at ?? ''}
            onBlur={(e) => {
              const v = e.target.value || null;
              if (v !== (item.state?.last_reviewed_at ?? null)) onChange(item.code, { last_reviewed_at: v });
            }}
          />
        ) : (
          <span style={{ fontSize: 12 }}>{item.state?.last_reviewed_at ?? '—'}</span>
        )}
      </td>
      <td style={{ color: dueColor, fontSize: 12 }}>
        {canEdit ? (
          <input
            type="date"
            className="score-select"
            defaultValue={item.state?.next_review_due ?? ''}
            onBlur={(e) => {
              const v = e.target.value || null;
              if (v !== (item.state?.next_review_due ?? null)) onChange(item.code, { next_review_due: v });
            }}
          />
        ) : (
          dueLabel
        )}
      </td>
      <td>
        <DocumentCell
          code={item.code}
          docId={item.state?.plan_document_id ?? null}
          canEdit={canEdit}
          onReplaced={onReplaced}
        />
      </td>
    </tr>
  );
}

function DocumentCell({
  code, docId, canEdit, onReplaced,
}: {
  code: string;
  docId: string | null;
  canEdit: boolean;
  onReplaced: (code: string, file: File, version?: string) => Promise<string | null>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'idle' | 'downloading' | 'uploading'>('idle');

  async function download() {
    if (!docId) return;
    setBusy('downloading');
    try {
      const res = await fetch(`/api/policy-documents/${docId}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.download_url) {
        alert(j.error ?? 'download failed');
        return;
      }
      window.open(j.download_url, '_blank', 'noopener');
    } finally {
      setBusy('idle');
    }
  }

  async function pickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const version = window.prompt(
      'Version label for this upload (e.g. 1.1, 2026-Q3). Leave blank for today\'s date.',
      '',
    );
    if (version === null) return;
    setBusy('uploading');
    await onReplaced(code, file, version.trim() || undefined);
    setBusy('idle');
  }

  if (busy !== 'idle') {
    return <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>{busy === 'downloading' ? 'Preparing…' : 'Uploading…'}</span>;
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {docId && (
        <button
          type="button"
          className="action-btn"
          style={{ padding: '3px 9px', fontSize: 11 }}
          onClick={download}
        >
          Download
        </button>
      )}
      {canEdit && (
        <button
          type="button"
          className="action-btn"
          style={{ padding: '3px 9px', fontSize: 11 }}
          onClick={() => fileRef.current?.click()}
        >
          {docId ? 'Replace' : 'Upload'}
        </button>
      )}
      {!docId && !canEdit && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>—</span>
      )}
      <input
        ref={fileRef}
        type="file"
        style={{ display: 'none' }}
        onChange={pickFile}
      />
    </div>
  );
}

function makeBlankState(): NonNullable<PlansLibraryItem['state']> {
  return {
    id: '',
    status: 'missing',
    version: null,
    last_reviewed_at: null,
    next_review_due: null,
    owner_user_id: null,
    plan_document_id: null,
    notes: null,
    updated_at: new Date().toISOString(),
    updated_by: null,
  };
}

function KpiTile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="kpi-tile" style={{ ['--accent' as never]: accent }}>
      <div className="kpi-tile-label">{label}</div>
      <div className="kpi-tile-value">{value}</div>
      <div className="kpi-tile-sub">{sub}</div>
    </div>
  );
}
