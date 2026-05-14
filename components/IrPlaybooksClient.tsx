'use client';

import { useMemo, useState } from 'react';
import type {
  IrPlaybook,
  IrPlaybookSeverity,
  IrPlaybookStatus,
  IrCommunicationsEntry,
  IrEscalationContact,
  IrRegulatoryNotification,
} from '@/lib/supabase/types';

const SEV_COLOR: Record<IrPlaybookSeverity, string> = {
  low:      '#475569',
  medium:   '#F59E0B',
  high:     '#DC2626',
  critical: '#991B1B',
};

const STATUS_COLOR: Record<IrPlaybookStatus, string> = {
  draft:    '#94A3B8',
  active:   '#10B981',
  archived: '#64748B',
};

// Standard categories — users can still type custom ones in the Edit form.
const CATEGORY_OPTIONS = [
  'bec',
  'ransomware',
  'phishing',
  'malware',
  'lost_device',
  'data_breach',
  'ddos',
  'insider',
  'supply_chain',
  'physical',
  'other',
];

const CATEGORY_LABELS: Record<string, string> = {
  bec:           'Business Email Compromise',
  ransomware:    'Ransomware',
  phishing:      'Phishing',
  malware:       'Malware',
  lost_device:   'Lost / Stolen Device',
  data_breach:   'Data Breach',
  ddos:          'DDoS',
  insider:       'Insider Threat',
  supply_chain:  'Supply-Chain Compromise',
  physical:      'Physical Security',
  other:         'Other',
};

export default function IrPlaybooksClient({ initialPlaybooks }: { initialPlaybooks: IrPlaybook[] }) {
  const [playbooks, setPlaybooks] = useState<IrPlaybook[]>(initialPlaybooks);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'ALL' | string>('ALL');

  const stats = useMemo(() => {
    const total = playbooks.length;
    const active = playbooks.filter((p) => p.status === 'active').length;
    const reviewed = playbooks.filter((p) => p.last_reviewed).length;
    const tabletopped = playbooks.filter((p) => p.last_tabletop).length;
    const stale = playbooks.filter((p) => {
      if (!p.next_review_due) return false;
      return new Date(p.next_review_due).getTime() < Date.now();
    }).length;
    return { total, active, reviewed, tabletopped, stale };
  }, [playbooks]);

  const filtered = filter === 'ALL' ? playbooks : playbooks.filter((p) => p.category === filter);

  async function createPlaybook(name: string, category: string) {
    setBusy(true);
    const res = await fetch('/api/ir-playbooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, category, status: 'draft' }),
    });
    setBusy(false);
    const j = await res.json();
    if (!res.ok || !j.ok) return alert(j.error ?? 'create failed');
    setPlaybooks((s) => [j.playbook as IrPlaybook, ...s]);
    setOpenId(j.playbook.id);
    setCreating(false);
  }

  async function patchPlaybook(id: string, fields: Partial<IrPlaybook>) {
    setPlaybooks((s) => s.map((p) => p.id === id ? { ...p, ...fields } : p));
    const res = await fetch('/api/ir-playbooks', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? `update failed (${res.status})`);
    }
  }

  async function removePlaybook(id: string) {
    if (!confirm('Delete this playbook? This cannot be undone.')) return;
    setPlaybooks((s) => s.filter((p) => p.id !== id));
    if (openId === id) setOpenId(null);
    await fetch(`/api/ir-playbooks?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  const open = openId ? playbooks.find((p) => p.id === openId) ?? null : null;

  return (
    <>
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KpiTile label="Total Playbooks" value={stats.total.toString()} sub={`${stats.active} active`} accent="#2563EB" />
        <KpiTile label="Reviewed" value={`${stats.reviewed}/${stats.total}`} sub="have a review date" accent="#10B981" />
        <KpiTile label="Tabletop-tested" value={`${stats.tabletopped}/${stats.total}`} sub="have a tabletop on record" accent="#0EA5E9" />
        <KpiTile label="Review overdue" value={stats.stale.toString()} sub={stats.stale > 0 ? 'past next-review date' : 'all current'} accent={stats.stale > 0 ? '#DC2626' : '#94A3B8'} />
      </div>

      <section className="scorecard">
        <div className="scorecard-header" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="scorecard-title">IR Playbooks</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Per-category response runbooks · containment, eradication, recovery, comms, escalation, reg notifications
            </div>
          </div>
          <div className="fn-filters">
            <button className={`fn-btn ${filter === 'ALL' ? 'active' : ''}`} onClick={() => setFilter('ALL')}>All</button>
            {Array.from(new Set(playbooks.map((p) => p.category))).map((c) => (
              <button key={c} className={`fn-btn ${filter === c ? 'active' : ''}`} onClick={() => setFilter(c)}>
                {CATEGORY_LABELS[c] ?? c}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {/* Plain .action-btn (not .primary) so it stays clickable for
                viewers — generating a printable runbook PDF is a read op. */}
            <a className="action-btn"
               href="/api/report/ir-playbooks"
               download
               title="Generate a printable IR Playbook Binder — every active playbook with response phases, comms matrix, escalation contacts, and regulatory clocks.">
              Generate IR Binder
            </a>
            <button className="action-btn primary" onClick={() => setCreating((v) => !v)}>
              {creating ? 'Cancel' : '+ New Playbook'}
            </button>
          </div>
        </div>

        {creating && <NewPlaybookForm busy={busy} onCancel={() => setCreating(false)} onSubmit={createPlaybook} />}

        {filtered.length === 0 && !creating && (
          <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-mid)' }}>
            {playbooks.length === 0
              ? <>No playbooks yet. Click <strong>+ New Playbook</strong> to start one.</>
              : <>No playbooks match this filter.</>}
          </div>
        )}

        {filtered.length > 0 && (
          <table className="score-table">
            <thead>
              <tr>
                <th>Playbook</th>
                <th>Category</th>
                <th>Default severity</th>
                <th>Last reviewed</th>
                <th>Last tabletop</th>
                <th>Next review</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const overdue = p.next_review_due && new Date(p.next_review_due).getTime() < Date.now();
                return (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(p.id)}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      {p.description && (
                        <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 2,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 380 }}>
                          {p.description}
                        </div>
                      )}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-mid)' }}>{CATEGORY_LABELS[p.category] ?? p.category}</td>
                    <td><Pill color={SEV_COLOR[p.severity_default]}>{p.severity_default}</Pill></td>
                    <td style={{ fontSize: 12, color: 'var(--text-mid)' }}>{p.last_reviewed ?? '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-mid)' }}>{p.last_tabletop ?? '—'}</td>
                    <td style={{ fontSize: 12, color: overdue ? 'var(--gap-pos)' : 'var(--text-mid)', fontWeight: overdue ? 600 : 400 }}>
                      {p.next_review_due ?? '—'}
                      {overdue && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600 }}>STALE</span>}
                    </td>
                    <td><Pill color={STATUS_COLOR[p.status]}>{p.status}</Pill></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="action-btn" onClick={() => setOpenId(p.id)}>Open</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {open && (
        <PlaybookEditor
          playbook={open}
          onClose={() => setOpenId(null)}
          onPatch={(fields) => patchPlaybook(open.id, fields)}
          onDelete={() => removePlaybook(open.id)}
        />
      )}
    </>
  );
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

function NewPlaybookForm({
  busy, onCancel, onSubmit,
}: { busy: boolean; onCancel: () => void; onSubmit: (name: string, category: string) => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('bec');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSubmit(name.trim(), category); }}
      style={{ display: 'flex', gap: 10, padding: '12px 0 4px', flexWrap: 'wrap', alignItems: 'flex-end' }}
    >
      <Field label="Playbook name" hint="e.g. 'Phishing — Credential Harvest Variant'" style={{ flex: 1, minWidth: 280 }}>
        <input className="score-select" value={name} onChange={(e) => setName(e.target.value)} autoFocus
          placeholder="Phishing — Credential Harvest Variant" />
      </Field>
      <Field label="Category" style={{ width: 240 }}>
        <select className="score-select" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
        </select>
      </Field>
      <button type="submit" className="action-btn primary" disabled={busy || !name.trim()}>
        {busy ? 'Creating…' : 'Create playbook'}
      </button>
      <button type="button" className="action-btn" onClick={onCancel}>Cancel</button>
    </form>
  );
}

function PlaybookEditor({
  playbook, onClose, onPatch, onDelete,
}: {
  playbook: IrPlaybook;
  onClose: () => void;
  onPatch: (fields: Partial<IrPlaybook>) => void;
  onDelete: () => void;
}) {
  return (
    <section className="scorecard" style={{ borderColor: SEV_COLOR[playbook.severity_default] }}>
      <div className="scorecard-header">
        <div>
          <div className="scorecard-title">{playbook.name}</div>
          <div className="scorecard-tag" style={{ marginTop: 4 }}>
            {CATEGORY_LABELS[playbook.category] ?? playbook.category}
            {' · '}
            <span style={{ color: SEV_COLOR[playbook.severity_default], fontWeight: 600 }}>
              default severity: {playbook.severity_default}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="action-btn danger" onClick={onDelete}>Delete</button>
          <button className="action-btn" onClick={onClose}>Close</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Field label="Name">
          <input className="score-select" defaultValue={playbook.name}
            onBlur={(e) => onPatch({ name: e.target.value })} />
        </Field>
        <Field label="Category">
          <select className="score-select" value={playbook.category}
            onChange={(e) => onPatch({ category: e.target.value })}>
            {CATEGORY_OPTIONS.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c] ?? c}</option>)}
            {!CATEGORY_OPTIONS.includes(playbook.category) && (
              <option value={playbook.category}>{playbook.category}</option>
            )}
          </select>
        </Field>
        <Field label="Default severity">
          <select className="score-select" value={playbook.severity_default}
            onChange={(e) => onPatch({ severity_default: e.target.value as IrPlaybookSeverity })}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </Field>
      </div>

      <Field label="Description" style={{ marginBottom: 16 }}>
        <textarea className="score-select" rows={3} defaultValue={playbook.description ?? ''}
          onBlur={(e) => onPatch({ description: e.target.value })}
          placeholder="When this playbook applies, what success looks like, key risks." />
      </Field>

      <Field label="Trigger conditions" hint="What signals or events activate this playbook." style={{ marginBottom: 16 }}>
        <textarea className="score-select" rows={2} defaultValue={playbook.trigger_conditions ?? ''}
          onBlur={(e) => onPatch({ trigger_conditions: e.target.value })} />
      </Field>

      <StringListEditor
        label="Detection sources"
        hint="Where alerts originate (EDR, SIEM, user reports, MSP SOC)."
        items={playbook.detection_sources}
        onChange={(items) => onPatch({ detection_sources: items })}
        inline
      />

      <SectionHeader>Response phases</SectionHeader>
      <StringListEditor
        label="Containment steps"
        hint="Stop the bleed — isolate, disable, revoke."
        items={playbook.containment_steps}
        onChange={(items) => onPatch({ containment_steps: items })}
      />
      <div style={{ height: 12 }} />
      <StringListEditor
        label="Eradication steps"
        hint="Remove the threat — find scope, cut persistence, close the entry vector."
        items={playbook.eradication_steps}
        onChange={(items) => onPatch({ eradication_steps: items })}
      />
      <div style={{ height: 12 }} />
      <StringListEditor
        label="Recovery steps"
        hint="Restore service safely — reset creds, validate, monitor, harden."
        items={playbook.recovery_steps}
        onChange={(items) => onPatch({ recovery_steps: items })}
      />

      <SectionHeader>Communications &amp; escalation</SectionHeader>
      <CommunicationsEditor
        items={playbook.communications_plan}
        onChange={(items) => onPatch({ communications_plan: items })}
      />
      <div style={{ height: 12 }} />
      <EscalationEditor
        items={playbook.escalation_contacts}
        onChange={(items) => onPatch({ escalation_contacts: items })}
      />

      <SectionHeader>Evidence &amp; regulatory</SectionHeader>
      <StringListEditor
        label="Evidence to preserve"
        hint="What logs / artifacts must be captured before any rebuild or wipe."
        items={playbook.evidence_to_preserve}
        onChange={(items) => onPatch({ evidence_to_preserve: items })}
      />
      <div style={{ height: 12 }} />
      <RegulatoryEditor
        items={playbook.regulatory_notifications}
        onChange={(items) => onPatch({ regulatory_notifications: items })}
      />

      <SectionHeader>Review cadence</SectionHeader>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
        <Field label="Last reviewed">
          <input type="date" className="score-select" defaultValue={playbook.last_reviewed ?? ''}
            onChange={(e) => onPatch({ last_reviewed: e.target.value || null })} />
        </Field>
        <Field label="Last tabletop">
          <input type="date" className="score-select" defaultValue={playbook.last_tabletop ?? ''}
            onChange={(e) => onPatch({ last_tabletop: e.target.value || null })} />
        </Field>
        <Field label="Next review due">
          <input type="date" className="score-select" defaultValue={playbook.next_review_due ?? ''}
            onChange={(e) => onPatch({ next_review_due: e.target.value || null })} />
        </Field>
        <Field label="Status">
          <select className="score-select" value={playbook.status}
            onChange={(e) => onPatch({ status: e.target.value as IrPlaybookStatus })}>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </Field>
      </div>
      <Field label="Linked NIST CSF controls" hint="Comma-separated, e.g. RS.MA-01, DE.AE-02" style={{ marginTop: 12 }}>
        <input className="score-select" defaultValue={playbook.linked_control_ids.join(', ')}
          onBlur={(e) => onPatch({ linked_control_ids: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
      </Field>
    </section>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 13,
      color: 'var(--text)', marginTop: 22, marginBottom: 12,
      paddingBottom: 6, borderBottom: '1px solid var(--bg-border)',
    }}>
      {children}
    </div>
  );
}

function StringListEditor({
  label, hint, items, onChange, inline,
}: {
  label: string;
  hint?: string;
  items: string[];
  onChange: (items: string[]) => void;
  inline?: boolean;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div>
      <Field label={label} hint={hint}><div /></Field>
      <ol style={{ listStyle: inline ? 'disc' : 'decimal', margin: '4px 0 8px 18px', padding: 0, color: 'var(--text)' }}>
        {items.length === 0 && <li style={{ color: 'var(--text-muted)', listStyle: 'none', marginLeft: -18 }}>—</li>}
        {items.map((s, i) => (
          <li key={i} style={{ marginBottom: 4, fontSize: 12, lineHeight: 1.5 }}>
            <span style={{ marginRight: 8 }}>{s}</span>
            <button type="button" className="action-btn danger"
              style={{ padding: '0 6px', fontSize: 11 }}
              onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button>
          </li>
        ))}
      </ol>
      <div style={{ display: 'flex', gap: 6 }}>
        <input className="score-select" value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) {
              e.preventDefault();
              onChange([...items, draft.trim()]); setDraft('');
            }
          }}
          placeholder={inline ? 'Add and press Enter' : 'Add a step and press Enter'} />
        <button type="button" className="action-btn"
          onClick={() => { if (draft.trim()) { onChange([...items, draft.trim()]); setDraft(''); } }}>
          + Add
        </button>
      </div>
    </div>
  );
}

function CommunicationsEditor({
  items, onChange,
}: { items: IrCommunicationsEntry[]; onChange: (items: IrCommunicationsEntry[]) => void }) {
  function update(i: number, patch: Partial<IrCommunicationsEntry>) {
    onChange(items.map((it, j) => j === i ? { ...it, ...patch } : it));
  }
  function remove(i: number) { onChange(items.filter((_, j) => j !== i)); }
  function add() { onChange([...items, { audience: '', when: '', channel: '', message_template: '' }]); }

  return (
    <div>
      <Field label="Communications plan" hint="Who needs to know, when, on what channel, and what message goes out."><div /></Field>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No entries yet.</div>}
        {items.map((it, i) => (
          <div key={i} style={{
            border: '1px solid var(--bg-border)', borderRadius: 'var(--r-md)',
            padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, position: 'relative',
            background: 'var(--bg-card)',
          }}>
            <button type="button" className="action-btn danger"
              style={{ position: 'absolute', top: 8, right: 8, padding: '0 8px', fontSize: 11 }}
              onClick={() => remove(i)}>×</button>
            <Field label="Audience">
              <input className="score-select" defaultValue={it.audience}
                onBlur={(e) => update(i, { audience: e.target.value })} placeholder="Affected user" />
            </Field>
            <Field label="When">
              <input className="score-select" defaultValue={it.when}
                onBlur={(e) => update(i, { when: e.target.value })} placeholder="Within 1 hour of detection" />
            </Field>
            <Field label="Channel">
              <input className="score-select" defaultValue={it.channel}
                onBlur={(e) => update(i, { channel: e.target.value })} placeholder="Phone (not email)" />
            </Field>
            <Field label="Message template" style={{ gridColumn: 'span 3' }}>
              <textarea className="score-select" rows={2} defaultValue={it.message_template}
                onBlur={(e) => update(i, { message_template: e.target.value })}
                placeholder="What you would say verbatim if this event happened right now." />
            </Field>
          </div>
        ))}
        <button type="button" className="action-btn" onClick={add} style={{ alignSelf: 'flex-start' }}>+ Add audience</button>
      </div>
    </div>
  );
}

function EscalationEditor({
  items, onChange,
}: { items: IrEscalationContact[]; onChange: (items: IrEscalationContact[]) => void }) {
  function update(i: number, patch: Partial<IrEscalationContact>) {
    onChange(items.map((it, j) => j === i ? { ...it, ...patch } : it));
  }
  function remove(i: number) { onChange(items.filter((_, j) => j !== i)); }
  function add() { onChange([...items, { role: '', name: '', phone: '', email: '', when_to_contact: '' }]); }

  return (
    <div>
      <Field label="Escalation contacts" hint="The people / firms to call. Phone numbers should work after hours."><div /></Field>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No contacts yet.</div>}
        {items.map((it, i) => (
          <div key={i} style={{
            border: '1px solid var(--bg-border)', borderRadius: 'var(--r-md)',
            padding: 10, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1.2fr auto', gap: 8,
            background: 'var(--bg-card)', alignItems: 'end',
          }}>
            <Field label="Role">
              <input className="score-select" defaultValue={it.role}
                onBlur={(e) => update(i, { role: e.target.value })} placeholder="CIO" />
            </Field>
            <Field label="Name">
              <input className="score-select" defaultValue={it.name}
                onBlur={(e) => update(i, { name: e.target.value })} placeholder="Jane Doe" />
            </Field>
            <Field label="Phone">
              <input className="score-select" defaultValue={it.phone}
                onBlur={(e) => update(i, { phone: e.target.value })} placeholder="555-555-5555" />
            </Field>
            <Field label="Email">
              <input className="score-select" defaultValue={it.email}
                onBlur={(e) => update(i, { email: e.target.value })} placeholder="jane@example.com" />
            </Field>
            <Field label="When to contact">
              <input className="score-select" defaultValue={it.when_to_contact}
                onBlur={(e) => update(i, { when_to_contact: e.target.value })} placeholder="High severity or >5 accounts" />
            </Field>
            <button type="button" className="action-btn danger" onClick={() => remove(i)} style={{ height: 30 }}>×</button>
          </div>
        ))}
        <button type="button" className="action-btn" onClick={add} style={{ alignSelf: 'flex-start' }}>+ Add contact</button>
      </div>
    </div>
  );
}

function RegulatoryEditor({
  items, onChange,
}: { items: IrRegulatoryNotification[]; onChange: (items: IrRegulatoryNotification[]) => void }) {
  function update(i: number, patch: Partial<IrRegulatoryNotification>) {
    onChange(items.map((it, j) => j === i ? { ...it, ...patch } : it));
  }
  function remove(i: number) { onChange(items.filter((_, j) => j !== i)); }
  function add() { onChange([...items, { regulation: '', deadline_hours: 72, contact: '', trigger: '' }]); }

  function fmtDeadline(hours: number) {
    if (!hours) return 'Immediate';
    if (hours < 24) return `${hours}h`;
    if (hours < 168) return `${Math.round(hours / 24)}d`;
    return `${Math.round(hours / 24 / 7)}wk`;
  }

  return (
    <div>
      <Field label="Regulatory notifications" hint="Reporting obligations triggered by this incident type. Clocks start at confirmation."><div /></Field>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No notifications configured.</div>}
        {items.map((it, i) => (
          <div key={i} style={{
            border: '1px solid var(--bg-border)', borderRadius: 'var(--r-md)',
            padding: 10, display: 'grid', gridTemplateColumns: '1.2fr 80px 1fr 1.2fr auto', gap: 8,
            background: 'var(--bg-card)', alignItems: 'end',
          }}>
            <Field label="Regulation">
              <input className="score-select" defaultValue={it.regulation}
                onBlur={(e) => update(i, { regulation: e.target.value })} placeholder="HIPAA Breach Notification" />
            </Field>
            <Field label={`Deadline (${fmtDeadline(it.deadline_hours)})`}>
              <input type="number" className="score-select" defaultValue={it.deadline_hours}
                onBlur={(e) => update(i, { deadline_hours: Number(e.target.value) || 0 })} />
            </Field>
            <Field label="Contact">
              <input className="score-select" defaultValue={it.contact}
                onBlur={(e) => update(i, { contact: e.target.value })} placeholder="HHS OCR + affected individuals" />
            </Field>
            <Field label="Trigger">
              <input className="score-select" defaultValue={it.trigger}
                onBlur={(e) => update(i, { trigger: e.target.value })} placeholder="PHI was accessed" />
            </Field>
            <button type="button" className="action-btn danger" onClick={() => remove(i)} style={{ height: 30 }}>×</button>
          </div>
        ))}
        <button type="button" className="action-btn" onClick={add} style={{ alignSelf: 'flex-start' }}>+ Add obligation</button>
      </div>
    </div>
  );
}
