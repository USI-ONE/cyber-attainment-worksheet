'use client';

import { useMemo, useRef, useState } from 'react';
import type {
  EvidenceArtifact, EvidenceStatus,
  Risk, DrPlan, IrPlaybook, Incident, PolicyDocument,
} from '@/lib/supabase/types';

// =============================================================================
// Constants
// =============================================================================

const CATEGORY_LABELS: Record<string, string> = {
  access_review:       'Access Review',
  config_screenshot:   'Config Screenshot',
  training_record:     'Training Record',
  dr_test_result:      'DR Test Result',
  ir_tabletop_record:  'IR Tabletop',
  vulnerability_scan:  'Vulnerability Scan',
  penetration_test:    'Penetration Test',
  audit_evidence:      'Audit Evidence',
  policy_attestation:  'Policy Attestation',
  backup_verification: 'Backup Verification',
  log_export:          'Log Export',
  certification:       'Certification',
  incident_report:     'Incident Report',
  other:               'Other',
};
const CATEGORY_KEYS = Object.keys(CATEGORY_LABELS);

const STATUS_COLORS: Record<EvidenceStatus, string> = {
  current:    '#10B981',
  superseded: '#94A3B8',
  expired:    '#DC2626',
  archived:   '#64748B',
};

// =============================================================================
// Top-level
// =============================================================================

export default function EvidenceLibraryClient({
  initialArtifacts, risks, drPlans, irPlaybooks, incidents, policyDocs,
}: {
  initialArtifacts: EvidenceArtifact[];
  risks: Pick<Risk, 'id' | 'code' | 'title' | 'residual_score'>[];
  drPlans: Pick<DrPlan, 'id' | 'name' | 'tier'>[];
  irPlaybooks: Pick<IrPlaybook, 'id' | 'name' | 'category'>[];
  incidents: Pick<Incident, 'id' | 'title' | 'severity' | 'status' | 'detected_at'>[];
  policyDocs: Pick<PolicyDocument, 'id' | 'title' | 'version' | 'status'>[];
}) {
  const [artifacts, setArtifacts] = useState<EvidenceArtifact[]>(initialArtifacts);
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [filterCat, setFilterCat] = useState<'ALL' | string>('ALL');
  const [search, setSearch] = useState('');

  const stats = useMemo(() => {
    const total = artifacts.length;
    const linkedToControls = artifacts.filter((a) => a.linked_control_ids.length > 0).length;
    const linkedToRisks = artifacts.filter((a) => a.linked_risk_ids.length > 0).length;
    const soon = artifacts.filter((a) => {
      if (a.status !== 'current' || !a.retention_until) return false;
      const days = Math.floor((new Date(a.retention_until).getTime() - Date.now()) / 86400000);
      return days >= 0 && days <= 30;
    }).length;
    const expired = artifacts.filter((a) => {
      if (a.status !== 'current' || !a.retention_until) return false;
      return new Date(a.retention_until).getTime() < Date.now();
    }).length;
    return { total, linkedToControls, linkedToRisks, soon, expired };
  }, [artifacts]);

  const categoryCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of artifacts) c[a.category] = (c[a.category] ?? 0) + 1;
    return c;
  }, [artifacts]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return artifacts.filter((a) => {
      if (filterCat !== 'ALL' && a.category !== filterCat) return false;
      if (!term) return true;
      const hay = [
        a.title, a.description ?? '', a.filename ?? '',
        a.uploaded_by ?? '',
        ...a.tags,
        ...a.linked_control_ids,
      ].join(' ').toLowerCase();
      return hay.includes(term);
    });
  }, [artifacts, filterCat, search]);

  async function uploadArtifact(form: FormData) {
    setUploading(true);
    try {
      const res = await fetch('/api/evidence', { method: 'POST', body: form });
      const j = await res.json();
      if (!res.ok || !j.ok) return alert(j.error ?? 'upload failed');
      setArtifacts((s) => [j.artifact as EvidenceArtifact, ...s]);
      setOpenId(j.artifact.id);
    } finally {
      setUploading(false);
    }
  }

  async function patchArtifact(id: string, fields: Partial<EvidenceArtifact>) {
    setArtifacts((s) => s.map((a) => a.id === id ? { ...a, ...fields } : a));
    const res = await fetch(`/api/evidence/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? `update failed (${res.status})`);
    }
  }

  async function removeArtifact(id: string) {
    if (!confirm('Delete this evidence artifact? The file will be deleted from storage.')) return;
    setArtifacts((s) => s.filter((a) => a.id !== id));
    if (openId === id) setOpenId(null);
    await fetch(`/api/evidence/${id}`, { method: 'DELETE' });
  }

  async function downloadArtifact(id: string) {
    const res = await fetch(`/api/evidence/${id}`);
    const j = await res.json();
    if (j.download_url) window.open(j.download_url, '_blank');
    else alert('No file attached to this artifact.');
  }

  const open = openId ? artifacts.find((a) => a.id === openId) ?? null : null;

  return (
    <>
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KpiTile label="Total Artifacts" value={stats.total.toString()} sub="in the library" accent="#2563EB" />
        <KpiTile label="Linked to Controls" value={`${stats.linkedToControls}/${stats.total || 1}`} sub="covering NIST CSF" accent="#10B981" />
        <KpiTile label="Linked to Risks" value={`${stats.linkedToRisks}/${stats.total || 1}`} sub="treatment proof" accent="#0EA5E9" />
        <KpiTile
          label={stats.expired > 0 ? 'Expired' : 'Expiring (30d)'}
          value={(stats.expired > 0 ? stats.expired : stats.soon).toString()}
          sub={stats.expired > 0 ? 'past retention' : 'within 30 days'}
          accent={stats.expired > 0 ? '#DC2626' : stats.soon > 0 ? '#F59E0B' : '#94A3B8'}
        />
      </div>

      <section className="scorecard">
        <div className="scorecard-header" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="scorecard-title">Evidence Library</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Audit-ready proof for controls, risks, DR tests, IR tabletops, training, scans, and policies
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="score-select"
              placeholder="Search title, tag, control…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 220 }}
            />
            {/* Plain .action-btn (not .primary) so a viewer's read-only mode
                doesn't grey it out — report generation is a read operation. */}
            <a
              className="action-btn"
              href="/api/report/audit-binder"
              download
              title="Generate an auditor-ready PDF that walks every NIST CSF control and lists the linked evidence, policies, risks, DR plans, and IR playbooks."
            >
              Generate Audit Binder
            </a>
            <button className="action-btn primary" onClick={() => setUploading((v) => !v)}>
              {uploading ? 'Cancel' : '+ Upload Evidence'}
            </button>
          </div>
        </div>

        {uploading && <UploadForm onSubmit={uploadArtifact} onCancel={() => setUploading(false)} />}

        <div className="fn-filters" style={{ marginTop: 12 }}>
          <button className={`fn-btn ${filterCat === 'ALL' ? 'active' : ''}`} onClick={() => setFilterCat('ALL')}>
            All · {artifacts.length}
          </button>
          {CATEGORY_KEYS.filter((k) => categoryCounts[k]).map((k) => (
            <button key={k} className={`fn-btn ${filterCat === k ? 'active' : ''}`} onClick={() => setFilterCat(k)}>
              {CATEGORY_LABELS[k]} · {categoryCounts[k]}
            </button>
          ))}
        </div>

        {visible.length === 0 ? (
          <EmptyState totalCount={artifacts.length} hasSearch={!!search.trim() || filterCat !== 'ALL'} />
        ) : (
          <table className="score-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>Title / file</th>
                <th>Category</th>
                <th>Collected</th>
                <th>Retention until</th>
                <th>Linked</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => {
                const totalLinks =
                  a.linked_control_ids.length +
                  a.linked_risk_ids.length +
                  a.linked_dr_plan_ids.length +
                  a.linked_ir_playbook_ids.length +
                  a.linked_incident_ids.length +
                  a.linked_policy_doc_ids.length;
                const days = a.retention_until
                  ? Math.floor((new Date(a.retention_until).getTime() - Date.now()) / 86400000)
                  : null;
                const overdue = a.status === 'current' && days != null && days < 0;
                return (
                  <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(a.id)}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{a.title}</div>
                      {a.filename && (
                        <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 2, fontFamily: 'Inter, sans-serif' }}>
                          {a.filename}
                          {a.size_bytes != null && <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>· {fmtBytes(a.size_bytes)}</span>}
                        </div>
                      )}
                      {!a.filename && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, fontStyle: 'italic' }}>metadata-only (no file attached)</div>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-mid)' }}>{CATEGORY_LABELS[a.category] ?? a.category}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-mid)' }}>{a.collected_date ?? '—'}</td>
                    <td style={{ fontSize: 12, color: overdue ? 'var(--gap-pos)' : 'var(--text-mid)', fontWeight: overdue ? 600 : 400 }}>
                      {a.retention_until ?? '—'}
                      {overdue && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600 }}>EXPIRED</span>}
                    </td>
                    <td style={{ fontSize: 11 }}>
                      {totalLinks === 0
                        ? <span style={{ color: 'var(--text-muted)' }}>unlinked</span>
                        : <span style={{ color: 'var(--text-mid)' }}>{totalLinks} link{totalLinks === 1 ? '' : 's'}</span>}
                    </td>
                    <td><Pill color={STATUS_COLORS[a.status]}>{a.status}</Pill></td>
                    <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                      {a.storage_path && (
                        <button className="action-btn" onClick={() => downloadArtifact(a.id)} style={{ marginRight: 4 }}>
                          Download
                        </button>
                      )}
                      <button className="action-btn" onClick={() => setOpenId(a.id)}>Open</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {open && (
        <EvidenceEditor
          artifact={open}
          risks={risks}
          drPlans={drPlans}
          irPlaybooks={irPlaybooks}
          incidents={incidents}
          policyDocs={policyDocs}
          onClose={() => setOpenId(null)}
          onPatch={(fields) => patchArtifact(open.id, fields)}
          onDelete={() => removeArtifact(open.id)}
          onDownload={() => downloadArtifact(open.id)}
        />
      )}
    </>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function KpiTile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="kpi-tile" style={{ ['--accent' as never]: accent }}>
      <div className="kpi-tile-label">{label}</div>
      <div className="kpi-tile-value">{value}</div>
      <div className="kpi-tile-sub">{sub}</div>
    </div>
  );
}

function Pill({ color, children, style }: { color: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px',
      background: `${color}1a`, color, border: `1px solid ${color}55`,
      borderRadius: 999, fontSize: 11, fontWeight: 600, textTransform: 'capitalize', letterSpacing: '0.04em',
      ...style,
    }}>{children}</span>
  );
}

function Field({ label, hint, children, style }: { label: string; hint?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      <label style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 11, color: 'var(--text-mid)', letterSpacing: '.02em' }}>
        {label}
      </label>
      {children}
      {hint && <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{hint}</span>}
    </div>
  );
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function EmptyState({ totalCount, hasSearch }: { totalCount: number; hasSearch: boolean }) {
  return (
    <div style={{ padding: '36px 0', textAlign: 'center', color: 'var(--text-mid)' }}>
      {totalCount === 0 ? (
        <>
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            <strong>No evidence yet.</strong> The library starts empty for every tenant.
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 480, margin: '0 auto', lineHeight: 1.5 }}>
            Click <strong>Upload Evidence</strong> to add your first artifact. Common starters: a screenshot
            of M365 Conditional Access policies (proves PR.AA-01 + PR.AA-05), a CSV export of last quarter&apos;s
            user access review (proves PR.AA-05), or last year&apos;s pentest report (proves ID.RA-07).
          </div>
        </>
      ) : (
        <>No artifacts match this filter{hasSearch ? ' / search' : ''}.</>
      )}
    </div>
  );
}

// =============================================================================
// Upload form
// =============================================================================

function UploadForm({
  onSubmit, onCancel,
}: { onSubmit: (form: FormData) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('access_review');
  const [collected, setCollected] = useState('');
  const [retention, setRetention] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const fd = new FormData();
    fd.set('title', title.trim());
    fd.set('category', category);
    if (collected) fd.set('collected_date', collected);
    if (retention) fd.set('retention_until', retention);
    if (description.trim()) fd.set('description', description.trim());
    if (tags.trim()) fd.set('tags', tags.trim());
    const f = fileRef.current?.files?.[0];
    if (f) fd.set('file', f);
    onSubmit(fd);
  }

  return (
    <form onSubmit={submit} style={{
      marginTop: 12, padding: 14,
      background: 'var(--bg-card)', border: '1px solid var(--bg-border)',
      borderRadius: 'var(--r-md)', display: 'grid',
      gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10,
    }}>
      <Field label="Title (required)" hint="What this artifact proves — e.g. 'Q1 2026 Access Review (all M365 users)'." style={{ gridColumn: 'span 4' }}>
        <input className="score-select" value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Q1 2026 Access Review (all M365 users)" autoFocus />
      </Field>
      <Field label="Category">
        <select className="score-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>)}
        </select>
      </Field>
      <Field label="Collected date">
        <input type="date" className="score-select" value={collected} onChange={(e) => setCollected(e.target.value)} />
      </Field>
      <Field label="Retention until" hint="Optional — used for expiry alerts.">
        <input type="date" className="score-select" value={retention} onChange={(e) => setRetention(e.target.value)} />
      </Field>
      <Field label="File">
        <input type="file" className="score-select" ref={fileRef} />
      </Field>
      <Field label="Description" style={{ gridColumn: 'span 3' }}>
        <input className="score-select" value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional: what's inside, methodology, scope." />
      </Field>
      <Field label="Tags" hint="Comma-separated, e.g. m365, pii, audit-2026">
        <input className="score-select" value={tags} onChange={(e) => setTags(e.target.value)}
          placeholder="m365, audit-2026" />
      </Field>
      <div style={{ gridColumn: 'span 4', display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button type="button" className="action-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="action-btn primary" disabled={!title.trim()}>Upload</button>
      </div>
    </form>
  );
}

// =============================================================================
// Detail editor
// =============================================================================

function EvidenceEditor({
  artifact, risks, drPlans, irPlaybooks, incidents, policyDocs,
  onClose, onPatch, onDelete, onDownload,
}: {
  artifact: EvidenceArtifact;
  risks: Pick<Risk, 'id' | 'code' | 'title' | 'residual_score'>[];
  drPlans: Pick<DrPlan, 'id' | 'name' | 'tier'>[];
  irPlaybooks: Pick<IrPlaybook, 'id' | 'name' | 'category'>[];
  incidents: Pick<Incident, 'id' | 'title' | 'severity' | 'status' | 'detected_at'>[];
  policyDocs: Pick<PolicyDocument, 'id' | 'title' | 'version' | 'status'>[];
  onClose: () => void;
  onPatch: (fields: Partial<EvidenceArtifact>) => void;
  onDelete: () => void;
  onDownload: () => void;
}) {
  return (
    <section className="scorecard" style={{ borderColor: STATUS_COLORS[artifact.status] }}>
      <div className="scorecard-header" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="scorecard-title">{artifact.title}</div>
          <div className="scorecard-tag" style={{ marginTop: 4 }}>
            {CATEGORY_LABELS[artifact.category] ?? artifact.category}
            {artifact.filename && <span> · {artifact.filename}</span>}
            {artifact.size_bytes != null && <span> · {fmtBytes(artifact.size_bytes)}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {artifact.storage_path && (
            <button className="action-btn" onClick={onDownload}>Download</button>
          )}
          <button className="action-btn danger" onClick={onDelete}>Delete</button>
          <button className="action-btn" onClick={onClose}>Close</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
        <div>
          <Field label="Title">
            <input className="score-select" defaultValue={artifact.title}
              onBlur={(e) => onPatch({ title: e.target.value })} />
          </Field>
          <Field label="Description" hint="Methodology, scope, who produced it." style={{ marginTop: 12 }}>
            <textarea className="score-select" rows={3} defaultValue={artifact.description ?? ''}
              onBlur={(e) => onPatch({ description: e.target.value })} />
          </Field>
          <Field label="Tags" hint="Comma-separated. Editing replaces the list." style={{ marginTop: 12 }}>
            <input className="score-select" defaultValue={artifact.tags.join(', ')}
              onBlur={(e) => onPatch({ tags: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
          </Field>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field label="Category">
            <select className="score-select" value={artifact.category}
              onChange={(e) => onPatch({ category: e.target.value })}>
              {CATEGORY_KEYS.map((k) => <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>)}
              {!CATEGORY_KEYS.includes(artifact.category) && (
                <option value={artifact.category}>{artifact.category}</option>
              )}
            </select>
          </Field>
          <Field label="Status">
            <select className="score-select" value={artifact.status}
              onChange={(e) => onPatch({ status: e.target.value as EvidenceStatus })}>
              <option value="current">Current</option>
              <option value="superseded">Superseded</option>
              <option value="expired">Expired</option>
              <option value="archived">Archived</option>
            </select>
          </Field>
          <Field label="Collected date">
            <input type="date" className="score-select" defaultValue={artifact.collected_date ?? ''}
              onChange={(e) => onPatch({ collected_date: e.target.value || null })} />
          </Field>
          <Field label="Retention until" hint="When this evidence ages out and needs refresh.">
            <input type="date" className="score-select" defaultValue={artifact.retention_until ?? ''}
              onChange={(e) => onPatch({ retention_until: e.target.value || null })} />
          </Field>
          <Field label="Uploaded by">
            <input className="score-select" defaultValue={artifact.uploaded_by ?? ''}
              onBlur={(e) => onPatch({ uploaded_by: e.target.value })} placeholder="Name or role" />
          </Field>
        </div>
      </div>

      <div style={{
        marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--bg-border)',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24,
      }}>
        <div>
          <SectionHeading>Cross-references</SectionHeading>
          <Field label="NIST CSF controls" hint="Comma-separated. e.g. PR.AA-01, PR.AA-05, DE.AE-02.">
            <input className="score-select" defaultValue={artifact.linked_control_ids.join(', ')}
              onBlur={(e) => onPatch({ linked_control_ids: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder="PR.AA-01, PR.AA-05" />
          </Field>
          <LinkedSelect
            label="Linked risks"
            hint="Risks whose treatment is proven by this evidence."
            all={risks.map((r) => ({ id: r.id, label: `${r.code} — ${r.title} (residual ${r.residual_score})` }))}
            selectedIds={artifact.linked_risk_ids}
            onChange={(ids) => onPatch({ linked_risk_ids: ids })}
            style={{ marginTop: 10 }}
          />
          <LinkedSelect
            label="Linked DR plans"
            hint="DR plans this evidence tests / documents."
            all={drPlans.map((d) => ({ id: d.id, label: `[T${d.tier}] ${d.name}` }))}
            selectedIds={artifact.linked_dr_plan_ids}
            onChange={(ids) => onPatch({ linked_dr_plan_ids: ids })}
            style={{ marginTop: 10 }}
          />
        </div>
        <div>
          <SectionHeading>&nbsp;</SectionHeading>
          <LinkedSelect
            label="Linked IR playbooks"
            hint="Playbooks this evidence exercises (tabletop, real activation)."
            all={irPlaybooks.map((p) => ({ id: p.id, label: `[${p.category}] ${p.name}` }))}
            selectedIds={artifact.linked_ir_playbook_ids}
            onChange={(ids) => onPatch({ linked_ir_playbook_ids: ids })}
          />
          <LinkedSelect
            label="Linked incidents"
            hint="Incidents this evidence documents."
            all={incidents.map((i) => ({ id: i.id, label: `[${i.severity}] ${i.title}` }))}
            selectedIds={artifact.linked_incident_ids}
            onChange={(ids) => onPatch({ linked_incident_ids: ids })}
            style={{ marginTop: 10 }}
          />
          <LinkedSelect
            label="Linked policy documents"
            hint="Policy docs this evidence attests to."
            all={policyDocs.map((p) => ({ id: p.id, label: `${p.title}${p.version ? ' v' + p.version : ''}` }))}
            selectedIds={artifact.linked_policy_doc_ids}
            onChange={(ids) => onPatch({ linked_policy_doc_ids: ids })}
            style={{ marginTop: 10 }}
          />
        </div>
      </div>
    </section>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 12,
      color: 'var(--text)', marginBottom: 8,
      textTransform: 'uppercase', letterSpacing: '.04em',
    }}>
      {children}
    </div>
  );
}

function LinkedSelect({
  label, hint, all, selectedIds, onChange, style,
}: {
  label: string;
  hint?: string;
  all: { id: string; label: string }[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  style?: React.CSSProperties;
}) {
  if (all.length === 0) {
    return (
      <div style={style}>
        <Field label={label} hint={hint}><div /></Field>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '4px 0' }}>
          No items available — create one in the relevant module first.
        </div>
      </div>
    );
  }
  return (
    <div style={style}>
      <Field label={label} hint={hint}><div /></Field>
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        maxHeight: 140, overflowY: 'auto',
        border: '1px solid var(--bg-border)', borderRadius: 'var(--r-sm)',
        padding: '6px 8px', background: 'var(--bg-mid)',
      }}>
        {all.map((it) => {
          const checked = selectedIds.includes(it.id);
          return (
            <label key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onChange(checked
                  ? selectedIds.filter((id) => id !== it.id)
                  : [...selectedIds, it.id])}
              />
              {it.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}
