'use client';

import { useMemo, useState } from 'react';
import type {
  TrainingCampaign, TrainingRecord,
  TrainingCampaignKind, TrainingCampaignStatus,
  TrainingRecordStatus,
} from '@/lib/supabase/types';

// =============================================================================
// Constants
// =============================================================================

const KIND_LABEL: Record<TrainingCampaignKind, string> = {
  awareness:     'Annual Awareness',
  phishing:      'Phishing Simulation',
  role_specific: 'Role-Specific',
  onboarding:    'Onboarding',
  tabletop:      'Tabletop Exercise',
  other:         'Other',
};

const KIND_COLOR: Record<TrainingCampaignKind, string> = {
  awareness:     '#2563EB',
  phishing:      '#DC2626',
  role_specific: '#10B981',
  onboarding:    '#0EA5E9',
  tabletop:      '#F59E0B',
  other:         '#64748B',
};

const STATUS_COLOR: Record<TrainingCampaignStatus, string> = {
  planned:   '#94A3B8',
  active:    '#10B981',
  completed: '#0EA5E9',
  archived:  '#64748B',
};

const RECORD_STATUS_COLOR: Record<TrainingRecordStatus, string> = {
  assigned:    '#94A3B8',
  in_progress: '#F59E0B',
  complete:    '#10B981',
  overdue:     '#DC2626',
  exempt:      '#64748B',
  failed:      '#991B1B',
};

const RECORD_STATUSES: TrainingRecordStatus[] =
  ['assigned','in_progress','complete','overdue','exempt','failed'];

// =============================================================================
// Top-level
// =============================================================================

export default function TrainingClient({
  initialCampaigns, initialRecords,
}: {
  initialCampaigns: TrainingCampaign[];
  initialRecords: TrainingRecord[];
}) {
  const [campaigns, setCampaigns] = useState<TrainingCampaign[]>(initialCampaigns);
  const [records, setRecords] = useState<TrainingRecord[]>(initialRecords);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [kindFilter, setKindFilter] = useState<'ALL' | TrainingCampaignKind>('ALL');

  const recordsByCampaign = useMemo(() => {
    const m = new Map<string, TrainingRecord[]>();
    for (const r of records) (m.get(r.campaign_id) ?? m.set(r.campaign_id, []).get(r.campaign_id)!).push(r);
    return m;
  }, [records]);

  // Headline KPIs across campaigns.
  const stats = useMemo(() => {
    const todayMs = Date.now();
    const active = campaigns.filter((c) => c.status === 'active');
    const totalAssigned = records.length;
    const completed = records.filter((r) => r.status === 'complete').length;
    const completion = totalAssigned ? (completed / totalAssigned) * 100 : null;
    const overdue = records.filter((r) =>
      r.status !== 'complete' && r.status !== 'exempt' &&
      r.due_date && new Date(r.due_date).getTime() < todayMs
    ).length;

    // Latest phishing simulation click rate.
    const phishCampaigns = campaigns
      .filter((c) => c.kind === 'phishing' && c.recipient_count > 0)
      .sort((a, b) => (b.scheduled_at ?? '').localeCompare(a.scheduled_at ?? ''));
    const lastPhish = phishCampaigns[0] ?? null;
    const phishRate = lastPhish && lastPhish.recipient_count > 0
      ? (lastPhish.clicked_count / lastPhish.recipient_count) * 100 : null;

    return {
      active_count: active.length,
      completion, overdue,
      last_phish_rate: phishRate,
      last_phish_name: lastPhish?.name ?? null,
    };
  }, [campaigns, records]);

  const visible = useMemo(() => {
    return campaigns.filter((c) => kindFilter === 'ALL' || c.kind === kindFilter);
  }, [campaigns, kindFilter]);

  // -- Mutations ------------------------------------------------------------

  async function createCampaign(name: string, kind: TrainingCampaignKind) {
    const res = await fetch('/api/training-campaigns', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, kind, status: 'active' }),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) return alert(j.error ?? 'create failed');
    setCampaigns((s) => [j.campaign as TrainingCampaign, ...s]);
    setCreating(false);
    setOpenId(j.campaign.id);
  }

  async function patchCampaign(id: string, fields: Partial<TrainingCampaign>) {
    setCampaigns((s) => s.map((c) => c.id === id ? { ...c, ...fields } : c));
    const res = await fetch('/api/training-campaigns', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? `update failed (${res.status})`);
    }
  }

  async function removeCampaign(id: string) {
    if (!confirm('Delete this campaign and all its training records?')) return;
    setCampaigns((s) => s.filter((c) => c.id !== id));
    setRecords((s) => s.filter((r) => r.campaign_id !== id));
    if (openId === id) setOpenId(null);
    await fetch(`/api/training-campaigns?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async function addRecord(campaign_id: string, payload: Partial<TrainingRecord>) {
    const res = await fetch('/api/training-records', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ campaign_id, ...payload }),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) return alert(j.error ?? 'create failed');
    setRecords((s) => [...s, j.record as TrainingRecord]);
  }

  async function patchRecord(id: string, fields: Partial<TrainingRecord>) {
    setRecords((s) => s.map((r) => r.id === id ? { ...r, ...fields } : r));
    await fetch('/api/training-records', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    });
  }

  async function removeRecord(id: string) {
    setRecords((s) => s.filter((r) => r.id !== id));
    await fetch(`/api/training-records?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  const open = openId ? campaigns.find((c) => c.id === openId) ?? null : null;
  const openRecs = open ? recordsByCampaign.get(open.id) ?? [] : [];

  return (
    <>
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KpiTile
          label="Active Campaigns"
          value={stats.active_count.toString()}
          sub="awareness / phishing / role-specific"
          accent="#2563EB"
        />
        <KpiTile
          label="Completion Rate"
          value={stats.completion == null ? '—' : `${stats.completion.toFixed(0)}%`}
          sub={`${records.filter((r) => r.status === 'complete').length} of ${records.length} records`}
          accent={
            stats.completion == null ? '#94A3B8'
              : stats.completion >= 90 ? '#10B981'
              : stats.completion >= 70 ? '#F59E0B'
              : '#DC2626'
          }
        />
        <KpiTile
          label="Overdue"
          value={stats.overdue.toString()}
          sub={stats.overdue > 0 ? 'past due date' : 'all on schedule'}
          accent={stats.overdue > 0 ? '#DC2626' : '#10B981'}
        />
        <KpiTile
          label="Latest Phishing Click Rate"
          value={stats.last_phish_rate == null ? '—' : `${stats.last_phish_rate.toFixed(1)}%`}
          sub={stats.last_phish_name ?? 'no campaigns yet'}
          accent={
            stats.last_phish_rate == null ? '#94A3B8'
              : stats.last_phish_rate <= 5 ? '#10B981'
              : stats.last_phish_rate <= 15 ? '#F59E0B'
              : '#DC2626'
          }
        />
      </div>

      <section className="scorecard">
        <div className="scorecard-header" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="scorecard-title">Training Campaigns</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Awareness + phishing-simulation programs · completion + click-rate KPIs
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="fn-filters">
              <button className={`fn-btn ${kindFilter === 'ALL' ? 'active' : ''}`} onClick={() => setKindFilter('ALL')}>All</button>
              {(Object.keys(KIND_LABEL) as TrainingCampaignKind[]).map((k) => (
                <button key={k} className={`fn-btn ${kindFilter === k ? 'active' : ''}`} onClick={() => setKindFilter(k)}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            <button className="action-btn primary" onClick={() => setCreating((v) => !v)}>
              {creating ? 'Cancel' : '+ New Campaign'}
            </button>
          </div>
        </div>

        {creating && <NewCampaignForm onSubmit={createCampaign} onCancel={() => setCreating(false)} />}

        <table className="score-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Kind</th>
              <th>Status</th>
              <th>Scheduled</th>
              <th>Audience</th>
              <th>Outcome</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>
                {campaigns.length === 0
                  ? <>No training campaigns yet. Click <strong>+ New Campaign</strong>.</>
                  : 'No campaigns match this filter.'}
              </td></tr>
            )}
            {visible.map((c) => {
              const recs = recordsByCampaign.get(c.id) ?? [];
              const done = recs.filter((r) => r.status === 'complete').length;
              const isPhishing = c.kind === 'phishing';
              const clickRate = isPhishing && c.recipient_count > 0
                ? (c.clicked_count / c.recipient_count) * 100 : null;
              const reportRate = isPhishing && c.recipient_count > 0
                ? (c.reported_count / c.recipient_count) * 100 : null;
              return (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(c.id)}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    {c.vendor && <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 2 }}>{c.vendor}</div>}
                  </td>
                  <td><Pill color={KIND_COLOR[c.kind]}>{KIND_LABEL[c.kind]}</Pill></td>
                  <td><Pill color={STATUS_COLOR[c.status]}>{c.status}</Pill></td>
                  <td style={{ fontSize: 11, color: 'var(--text-mid)' }}>{c.scheduled_at ?? '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-mid)' }}>{c.target_audience ?? '—'}</td>
                  <td style={{ fontSize: 11 }}>
                    {isPhishing ? (
                      <>
                        <span style={{ color: 'var(--text-mid)' }}>
                          {c.recipient_count} sent · {' '}
                        </span>
                        <span style={{
                          color: clickRate != null && clickRate > 15 ? 'var(--gap-pos)' :
                                 clickRate != null && clickRate > 5  ? 'var(--amber-text)' :
                                 'var(--green-text)',
                          fontWeight: 600,
                        }}>
                          {clickRate != null ? `${clickRate.toFixed(1)}% click` : '—'}
                        </span>
                        {reportRate != null && (
                          <span style={{ color: 'var(--text-muted)' }}> · {reportRate.toFixed(0)}% report</span>
                        )}
                      </>
                    ) : recs.length > 0 ? (
                      <span style={{ color: 'var(--text-mid)' }}>{done}/{recs.length} complete</span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>no records</span>
                    )}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="action-btn" onClick={() => setOpenId(c.id)}>Open</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {open && (
        <CampaignEditor
          campaign={open}
          records={openRecs}
          onClose={() => setOpenId(null)}
          onPatch={(fields) => patchCampaign(open.id, fields)}
          onDelete={() => removeCampaign(open.id)}
          onAddRecord={(payload) => addRecord(open.id, payload)}
          onPatchRecord={patchRecord}
          onRemoveRecord={removeRecord}
        />
      )}
    </>
  );
}

// =============================================================================
// Sub-components
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
      borderRadius: 999, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
      textTransform: 'capitalize',
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

function NewCampaignForm({
  onSubmit, onCancel,
}: { onSubmit: (name: string, kind: TrainingCampaignKind) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TrainingCampaignKind>('awareness');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSubmit(name.trim(), kind); }}
      style={{
        marginTop: 12, padding: 14, background: 'var(--bg-card)',
        border: '1px solid var(--bg-border)', borderRadius: 'var(--r-md)',
        display: 'grid', gridTemplateColumns: '2fr 1fr auto auto', gap: 10, alignItems: 'end',
      }}
    >
      <Field label="Campaign name (required)" hint="e.g. 'Q3 Phishing Simulation — Credential Harvest'.">
        <input className="score-select" value={name} onChange={(e) => setName(e.target.value)} autoFocus
          placeholder="Q3 Phishing Simulation — Credential Harvest" />
      </Field>
      <Field label="Kind">
        <select className="score-select" value={kind} onChange={(e) => setKind(e.target.value as TrainingCampaignKind)}>
          {(Object.keys(KIND_LABEL) as TrainingCampaignKind[]).map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </select>
      </Field>
      <button type="submit" className="action-btn primary" disabled={!name.trim()}>Create campaign</button>
      <button type="button" className="action-btn" onClick={onCancel}>Cancel</button>
    </form>
  );
}

// =============================================================================
// Campaign editor
// =============================================================================

function CampaignEditor({
  campaign, records,
  onClose, onPatch, onDelete,
  onAddRecord, onPatchRecord, onRemoveRecord,
}: {
  campaign: TrainingCampaign;
  records: TrainingRecord[];
  onClose: () => void;
  onPatch: (fields: Partial<TrainingCampaign>) => void;
  onDelete: () => void;
  onAddRecord: (payload: Partial<TrainingRecord>) => void;
  onPatchRecord: (id: string, fields: Partial<TrainingRecord>) => void;
  onRemoveRecord: (id: string) => void;
}) {
  const isPhish = campaign.kind === 'phishing';
  const clickRate = isPhish && campaign.recipient_count > 0
    ? (campaign.clicked_count / campaign.recipient_count) * 100 : null;
  const reportRate = isPhish && campaign.recipient_count > 0
    ? (campaign.reported_count / campaign.recipient_count) * 100 : null;
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newDue, setNewDue] = useState('');

  return (
    <section className="scorecard" style={{ borderColor: KIND_COLOR[campaign.kind] }}>
      <div className="scorecard-header">
        <div>
          <div className="scorecard-title">{campaign.name}</div>
          <div className="scorecard-tag" style={{ marginTop: 4 }}>
            <span style={{ color: KIND_COLOR[campaign.kind], fontWeight: 600 }}>
              {KIND_LABEL[campaign.kind]}
            </span>
            {campaign.vendor && <span> · {campaign.vendor}</span>}
            {campaign.scheduled_at && <span> · scheduled {campaign.scheduled_at}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="action-btn danger" onClick={onDelete}>Delete</button>
          <button className="action-btn" onClick={onClose}>Close</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
        <div>
          <Field label="Name">
            <input className="score-select" defaultValue={campaign.name}
              onBlur={(e) => onPatch({ name: e.target.value })} />
          </Field>
          <Field label="Description" style={{ marginTop: 12 }}>
            <textarea className="score-select" rows={3} defaultValue={campaign.description ?? ''}
              onBlur={(e) => onPatch({ description: e.target.value })}
              placeholder="Modules covered · lure used · scope · expected outcome." />
          </Field>
          <Field label="Notes" style={{ marginTop: 12 }}>
            <textarea className="score-select" rows={2} defaultValue={campaign.notes ?? ''}
              onBlur={(e) => onPatch({ notes: e.target.value })}
              placeholder="Lessons learned · follow-ups · vendor invoice reference." />
          </Field>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Kind">
              <select className="score-select" value={campaign.kind}
                onChange={(e) => onPatch({ kind: e.target.value as TrainingCampaignKind })}>
                {(Object.keys(KIND_LABEL) as TrainingCampaignKind[]).map((k) =>
                  <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className="score-select" value={campaign.status}
                onChange={(e) => onPatch({ status: e.target.value as TrainingCampaignStatus })}>
                {(['planned','active','completed','archived'] as TrainingCampaignStatus[]).map((s) =>
                  <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Vendor">
            <input className="score-select" defaultValue={campaign.vendor ?? ''}
              onBlur={(e) => onPatch({ vendor: e.target.value })}
              placeholder="KnowBe4 · Proofpoint · Internal" />
          </Field>
          <Field label="Target audience">
            <input className="score-select" defaultValue={campaign.target_audience ?? ''}
              onBlur={(e) => onPatch({ target_audience: e.target.value })}
              placeholder="All employees · IT staff · Executives" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Scheduled">
              <input type="date" className="score-select" defaultValue={campaign.scheduled_at ?? ''}
                onChange={(e) => onPatch({ scheduled_at: e.target.value || null })} />
            </Field>
            <Field label="Completed">
              <input type="date" className="score-select" defaultValue={campaign.completed_at ?? ''}
                onChange={(e) => onPatch({ completed_at: e.target.value || null })} />
            </Field>
          </div>
        </div>
      </div>

      {/* Phishing aggregates block */}
      {isPhish && (
        <div style={{
          marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--bg-border)',
        }}>
          <div style={{
            fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 13,
            color: 'var(--text)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.04em',
          }}>
            Phishing Simulation Outcomes
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
            <Field label="Recipients">
              <input type="number" className="score-select" defaultValue={campaign.recipient_count}
                onBlur={(e) => onPatch({ recipient_count: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Clicked">
              <input type="number" className="score-select" defaultValue={campaign.clicked_count}
                onBlur={(e) => onPatch({ clicked_count: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Reported">
              <input type="number" className="score-select" defaultValue={campaign.reported_count}
                onBlur={(e) => onPatch({ reported_count: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Credentials submitted">
              <input type="number" className="score-select" defaultValue={campaign.credentials_submitted_count}
                onBlur={(e) => onPatch({ credentials_submitted_count: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Attachments opened">
              <input type="number" className="score-select" defaultValue={campaign.attachment_opened_count}
                onBlur={(e) => onPatch({ attachment_opened_count: Number(e.target.value) || 0 })} />
            </Field>
          </div>
          {clickRate != null && (
            <div style={{
              marginTop: 12, padding: '10px 14px',
              background: 'var(--bg-card)', borderRadius: 'var(--r-md)',
              display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap',
            }}>
              <Stat label="Click rate" value={`${clickRate.toFixed(1)}%`} color={
                clickRate <= 5 ? '#10B981' : clickRate <= 15 ? '#F59E0B' : '#DC2626'
              } />
              {reportRate != null && (
                <Stat label="Report rate" value={`${reportRate.toFixed(1)}%`} color={
                  reportRate >= 25 ? '#10B981' : reportRate >= 10 ? '#F59E0B' : '#DC2626'
                } />
              )}
              {campaign.recipient_count > 0 && campaign.credentials_submitted_count > 0 && (
                <Stat
                  label="Credentials submitted"
                  value={`${campaign.credentials_submitted_count} / ${campaign.recipient_count}`}
                  color="#DC2626"
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Per-trainee records (for non-phishing) */}
      {!isPhish && (
        <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--bg-border)' }}>
          <div style={{
            fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 13,
            color: 'var(--text)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.04em',
          }}>
            Training Records ({records.length})
          </div>

          {records.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
              No records assigned yet. Add trainees below — one row per person.
            </div>
          ) : (
            <table className="score-table">
              <thead>
                <tr>
                  <th>Trainee</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Due</th>
                  <th>Completed</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const overdue = r.status !== 'complete' && r.status !== 'exempt' &&
                    r.due_date && new Date(r.due_date).getTime() < Date.now();
                  return (
                    <tr key={r.id}>
                      <td><input className="score-select" defaultValue={r.trainee_name ?? ''}
                        onBlur={(e) => onPatchRecord(r.id, { trainee_name: e.target.value })} /></td>
                      <td><input className="score-select" type="email" defaultValue={r.trainee_email ?? ''}
                        onBlur={(e) => onPatchRecord(r.id, { trainee_email: e.target.value })} /></td>
                      <td><input className="score-select" defaultValue={r.trainee_role ?? ''}
                        onBlur={(e) => onPatchRecord(r.id, { trainee_role: e.target.value })} /></td>
                      <td style={{ color: overdue ? 'var(--gap-pos)' : 'var(--text)' }}>
                        <input type="date" className="score-select" defaultValue={r.due_date ?? ''}
                          onChange={(e) => onPatchRecord(r.id, { due_date: e.target.value || null })} />
                      </td>
                      <td>
                        <input type="date" className="score-select" defaultValue={r.completed_at ?? ''}
                          onChange={(e) => onPatchRecord(r.id, { completed_at: e.target.value || null })} />
                      </td>
                      <td>
                        <select className="score-select" value={r.status}
                          style={{ color: RECORD_STATUS_COLOR[r.status], fontWeight: 600 }}
                          onChange={(e) => onPatchRecord(r.id, { status: e.target.value as TrainingRecordStatus })}>
                          {RECORD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td>
                        <input type="number" min={0} max={100} step={0.5} className="score-select"
                          defaultValue={r.score ?? ''}
                          onBlur={(e) => onPatchRecord(r.id, {
                            score: e.target.value ? Number(e.target.value) : null,
                          })} />
                      </td>
                      <td><button className="action-btn danger" onClick={() => onRemoveRecord(r.id)}>×</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {/* Add record */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim() && !newEmail.trim()) return;
              onAddRecord({
                trainee_name: newName.trim() || null,
                trainee_email: newEmail.trim() || null,
                due_date: newDue || null,
                status: 'assigned',
              });
              setNewName(''); setNewEmail(''); setNewDue('');
            }}
            style={{
              marginTop: 12, padding: 10,
              background: 'var(--bg-card)', border: '1px solid var(--bg-border)',
              borderRadius: 'var(--r-md)',
              display: 'grid', gridTemplateColumns: '1fr 1.5fr 1fr auto', gap: 8, alignItems: 'end',
            }}
          >
            <Field label="Trainee name">
              <input className="score-select" value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder="Jane Doe" />
            </Field>
            <Field label="Email">
              <input className="score-select" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                placeholder="jane@example.com" />
            </Field>
            <Field label="Due">
              <input type="date" className="score-select" value={newDue} onChange={(e) => setNewDue(e.target.value)} />
            </Field>
            <button type="submit" className="action-btn"
              disabled={!newName.trim() && !newEmail.trim()}>+ Add trainee</button>
          </form>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '.04em', textTransform: 'uppercase', fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ fontFamily: 'Inter, sans-serif', fontWeight: 700, fontSize: 22, color }}>
        {value}
      </span>
    </div>
  );
}
