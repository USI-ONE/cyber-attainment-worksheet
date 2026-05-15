'use client';

import { Fragment, useMemo, useRef, useState } from 'react';
import type {
  CurrentScore, FrameworkDefinition, PolicyDocument, PolicyDocumentStatus,
} from '@/lib/supabase/types';
import { reviewForPolicy, type PolicyReview } from '@/lib/policy-review';
import { GROUP_COLORS } from '@/lib/scoring';

const STATUSES: PolicyDocumentStatus[] = ['draft', 'published', 'archived'];
const STATUS_COLORS: Record<PolicyDocumentStatus, string> = {
  draft: '#475569',     // slate-600
  published: '#10B981', // emerald-500
  archived: '#94A3B8',  // slate-400 (faded)
};

export default function PolicyDocumentsTab({
  initialDocuments,
  frameworkDefinition = null,
  scoresByControl = {},
}: {
  initialDocuments: PolicyDocument[];
  frameworkDefinition?: FrameworkDefinition | null;
  scoresByControl?: Record<string, Partial<CurrentScore>>;
}) {
  const [docs, setDocs] = useState<PolicyDocument[]>(initialDocuments);
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
          <div style={{ display: 'flex', gap: 8 }}>
            <input ref={fileInput} type="file"
              accept=".pdf,.docx,.doc,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) pickFile(f); }}
              style={{ display: 'none' }} />
            <a className="action-btn"
               href="/api/report/policy"
               title="Generate a board-ready PDF coverage briefing of all policy documents"
               download>
              Generate Executive Report
            </a>
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
            {docs.map((d) => {
              const isExpanded = expandedId === d.id;
              return (
                <Fragment key={d.id}>
                  <tr>
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
                    <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        className={`action-btn ${isExpanded ? 'primary' : ''}`}
                        onClick={() => setExpandedId(isExpanded ? null : d.id)}
                        title="Expand a coverage + maturity review of this policy"
                      >{isExpanded ? 'Hide review' : 'Review'}</button>
                      <button className="action-btn" onClick={() => download(d)}>Download</button>
                      <button className="action-btn" onClick={() => remove(d)}>Delete</button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={8} style={{ padding: 0, background: 'var(--bg-card)' }}>
                        <PolicyReviewPanel
                          policy={d}
                          framework={frameworkDefinition}
                          scoresByControl={scoresByControl}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
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

/**
 * Expandable per-policy review panel. Three blocks:
 *   1. Summary KPI strip (linked controls, functions touched, avg POL,
 *      at-goal vs below-goal, next review date).
 *   2. Coverage by function — six horizontal bars showing what fraction of
 *      each NIST CSF 2.0 function this policy backs.
 *   3. Linked controls — full enumeration grouped by function/category,
 *      each row showing POL/PRA/GOL inline so you can see at a glance
 *      where the policy is delivering and where it's not.
 *
 * The full review is rendered server-data-driven from
 * lib/policy-review.ts; this component is purely presentational.
 */
function PolicyReviewPanel({
  policy, framework, scoresByControl,
}: {
  policy: PolicyDocument;
  framework: FrameworkDefinition | null;
  scoresByControl: Record<string, Partial<CurrentScore>>;
}) {
  const review = useMemo<PolicyReview>(
    () => reviewForPolicy(policy, framework, scoresByControl),
    [policy, framework, scoresByControl],
  );

  if (!framework) {
    return (
      <div style={{ padding: '18px 22px', fontSize: 12, color: 'var(--text-mid)' }}>
        No active framework — review needs a NIST CSF 2.0 (or equivalent) framework
        assigned to this tenant to render coverage stats. The policy is linked to{' '}
        <strong style={{ color: 'var(--text)' }}>{review.linked_total}</strong> control
        {review.linked_total === 1 ? '' : 's'} but they can&apos;t be grouped by function until
        the framework is loaded.
      </div>
    );
  }

  const fmtScore = (n: number | null) => n == null ? '—' : n.toFixed(1);
  const totalControls = review.by_function.reduce((acc, f) => acc + f.total_in_function, 0);
  const totalCoveragePct = totalControls === 0
    ? 0
    : Math.round((review.linked_total / totalControls) * 1000) / 10;

  return (
    <div style={{ padding: '18px 22px 22px', borderTop: '1px solid var(--bg-border)' }}>
      {/* ----- KPI strip ----- */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 12, marginBottom: 18,
      }}>
        <ReviewKpi
          label="Controls covered"
          value={`${review.linked_total} / ${totalControls}`}
          sub={`${totalCoveragePct.toFixed(1)}% of framework`}
        />
        <ReviewKpi
          label="Functions touched"
          value={`${review.functions_touched} / 6`}
          sub="of NIST CSF 2.0 functions"
        />
        <ReviewKpi
          label="Avg Policy tier"
          value={fmtScore(review.pol_avg)}
          sub={review.pol_avg == null
            ? 'no POL on linked controls'
            : 'on this policy\'s linked controls'}
          accent="#2563EB"
        />
        <ReviewKpi
          label="Avg Practice tier"
          value={fmtScore(review.pra_avg)}
          sub={review.pra_avg == null
            ? 'practice not yet measured'
            : `${review.at_goal} at goal · ${review.below_goal} below · ${review.unmeasured} unmeasured`}
          accent="#F59E0B"
        />
        <ReviewKpi
          label="Next review"
          value={review.next_review_date ?? '—'}
          sub={policy.effective_date
            ? `Effective ${policy.effective_date} · annual cadence`
            : 'No effective date set'}
        />
      </div>

      {/* ----- Coverage by function ----- */}
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--text-mid)',
        textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10,
      }}>Coverage by function</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
        {review.by_function.map((f) => {
          const color = GROUP_COLORS[f.group_id]?.accent ?? 'var(--gold)';
          return (
            <div key={f.group_id} style={{
              display: 'grid', gridTemplateColumns: '120px 1fr 120px',
              alignItems: 'center', gap: 12,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />
                <strong style={{ color: 'var(--text)' }}>{f.group_id}</strong>
                <span style={{ color: 'var(--text-mid)', fontSize: 11 }}>{f.group_name}</span>
              </div>
              <div style={{
                width: '100%', height: 10, background: 'var(--bg-deep)',
                border: '1px solid var(--bg-border)', borderRadius: 5, overflow: 'hidden',
              }}>
                <div style={{
                  width: `${Math.min(100, f.coverage_percent)}%`, height: '100%',
                  background: color, borderRadius: 5, transition: 'width .2s ease',
                }} />
              </div>
              <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-mid)' }}>
                <strong style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                  {f.linked}/{f.total_in_function}
                </strong>
                {' · '}{f.coverage_percent.toFixed(1)}%
                {f.pol_avg != null && (
                  <span style={{ marginLeft: 4 }}>· POL {f.pol_avg.toFixed(1)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ----- Linked controls (collapsed list) ----- */}
      <div style={{
        fontSize: 11, fontWeight: 600, color: 'var(--text-mid)',
        textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 10,
      }}>Linked controls ({review.linked_total})</div>
      {review.linked_controls.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-mid)', padding: 8 }}>
          This policy isn&apos;t linked to any controls yet.
        </div>
      ) : (
        <LinkedControlsList controls={review.linked_controls} />
      )}
    </div>
  );
}

function ReviewKpi({ label, value, sub, accent }: {
  label: string; value: string; sub: string; accent?: string;
}) {
  return (
    <div style={{
      padding: '10px 12px',
      background: 'var(--bg-mid)',
      border: '1px solid var(--bg-border)',
      borderRadius: 8,
      boxShadow: 'var(--shadow-sm)',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 600, color: accent ?? 'var(--text-mid)',
        textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4,
      }}>{label}</div>
      <div style={{
        fontSize: 18, fontWeight: 700, color: 'var(--text)',
        fontVariantNumeric: 'tabular-nums', lineHeight: 1.1,
      }}>{value}</div>
      <div style={{ fontSize: 10.5, color: 'var(--text-mid)', marginTop: 4 }}>
        {sub}
      </div>
    </div>
  );
}

/**
 * Linked-controls list, grouped by function for scannability and collapsed
 * by default. Each control row shows the three score dimensions
 * (POL / PRA / GOL) inline so a reviewer can see at a glance whether this
 * policy's promised coverage is being delivered.
 */
function LinkedControlsList({ controls }: {
  controls: PolicyReview['linked_controls'];
}) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const grouped = useMemo(() => {
    const map = new Map<string, { group_name: string; rows: typeof controls }>();
    for (const c of controls) {
      const key = c.group_id;
      if (!map.has(key)) map.set(key, { group_name: c.group_name, rows: [] });
      map.get(key)!.rows.push(c);
    }
    return [...map.entries()];
  }, [controls]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {grouped.map(([groupId, { group_name, rows }]) => {
        const isOpen = openGroups.has(groupId);
        const color = GROUP_COLORS[groupId]?.accent ?? 'var(--gold)';
        return (
          <div key={groupId} style={{
            background: 'var(--bg-mid)',
            border: '1px solid var(--bg-border)',
            borderRadius: 6,
            overflow: 'hidden',
          }}>
            <button
              type="button"
              onClick={() => setOpenGroups((s) => {
                const next = new Set(s);
                if (next.has(groupId)) next.delete(groupId); else next.add(groupId);
                return next;
              })}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', background: 'transparent', border: 'none',
                cursor: 'pointer', textAlign: 'left', fontSize: 12,
              }}
            >
              <span style={{ color, fontSize: 14 }}>{isOpen ? '▾' : '▸'}</span>
              <strong style={{ color: 'var(--text)' }}>{groupId}</strong>
              <span style={{ color: 'var(--text-mid)' }}>{group_name}</span>
              <span style={{ marginLeft: 'auto', color: 'var(--text-mid)', fontVariantNumeric: 'tabular-nums' }}>
                {rows.length} control{rows.length === 1 ? '' : 's'}
              </span>
            </button>
            {isOpen && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-card)' }}>
                    <th style={th}>Control</th>
                    <th style={th}>Category</th>
                    <th style={{ ...th, maxWidth: 0 }}>Outcome</th>
                    <th style={{ ...th, textAlign: 'right' }}>POL</th>
                    <th style={{ ...th, textAlign: 'right' }}>PRA</th>
                    <th style={{ ...th, textAlign: 'right' }}>GOL</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.control_id} style={{ borderTop: '1px solid var(--bg-border)' }}>
                      <td style={td}><code style={{ color: 'var(--gold-light)', fontWeight: 600 }}>{c.control_id}</code></td>
                      <td style={{ ...td, color: 'var(--text-mid)' }}>{c.category_name}</td>
                      <td style={{ ...td, color: 'var(--text-mid)', maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.outcome}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.pol?.toFixed(1) ?? '—'}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.pra?.toFixed(1) ?? '—'}</td>
                      <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{c.gol?.toFixed(1) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

const th: React.CSSProperties = {
  textAlign: 'left', padding: '6px 12px',
  fontSize: 10, fontWeight: 600, color: 'var(--text-mid)',
  textTransform: 'uppercase', letterSpacing: '0.04em',
};
const td: React.CSSProperties = { padding: '6px 12px' };

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
