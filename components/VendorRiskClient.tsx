'use client';

import { useMemo, useState } from 'react';
import type {
  Vendor, VendorAttestation,
  VendorCriticality, VendorDataSensitivity, VendorType, VendorStatus,
  AttestationType, AttestationStatus,
} from '@/lib/supabase/types';

// =============================================================================
// Constants
// =============================================================================

const CRIT_META: Record<VendorCriticality, { color: string; label: string }> = {
  low:      { color: '#94A3B8', label: 'Low'      },
  medium:   { color: '#0EA5E9', label: 'Medium'   },
  high:     { color: '#F59E0B', label: 'High'     },
  critical: { color: '#DC2626', label: 'Critical' },
};

const TYPE_LABEL: Record<VendorType, string> = {
  saas:            'SaaS',
  msp:             'MSP',
  hardware:        'Hardware',
  consulting:      'Consulting',
  payments:        'Payments',
  infrastructure:  'Infrastructure',
  contractor:      'Contractor',
  other:           'Other',
};

const SENS_META: Record<VendorDataSensitivity, { color: string; label: string }> = {
  none:         { color: '#94A3B8', label: 'No data'        },
  public:       { color: '#94A3B8', label: 'Public'         },
  internal:     { color: '#0EA5E9', label: 'Internal'       },
  confidential: { color: '#F59E0B', label: 'Confidential'   },
  pii:          { color: '#DC2626', label: 'PII'            },
  phi:          { color: '#991B1B', label: 'PHI'            },
  financial:    { color: '#DC2626', label: 'Financial'      },
  regulated:    { color: '#991B1B', label: 'Regulated'      },
};

const STATUS_META: Record<VendorStatus, { color: string; label: string }> = {
  pending:    { color: '#F59E0B', label: 'Pending'    },
  active:     { color: '#10B981', label: 'Active'     },
  offboarded: { color: '#64748B', label: 'Offboarded' },
};

const ATTESTATION_TYPES: AttestationType[] = [
  'soc2_type1','soc2_type2','iso_27001','iso_27017','iso_27018','iso_27701',
  'pci_dss','hipaa_baa','fedramp_high','fedramp_moderate','cmmc',
  'cyber_insurance','penetration_test','vulnerability_scan','other',
];
const ATTESTATION_LABELS: Record<AttestationType, string> = {
  soc2_type1:       'SOC 2 Type I',
  soc2_type2:       'SOC 2 Type II',
  iso_27001:        'ISO 27001',
  iso_27017:        'ISO 27017',
  iso_27018:        'ISO 27018',
  iso_27701:        'ISO 27701',
  pci_dss:          'PCI DSS',
  hipaa_baa:        'HIPAA BAA',
  fedramp_high:     'FedRAMP High',
  fedramp_moderate: 'FedRAMP Moderate',
  cmmc:             'CMMC',
  cyber_insurance:  'Cyber Insurance',
  penetration_test: 'Penetration Test',
  vulnerability_scan: 'Vulnerability Scan',
  other:            'Other',
};

const ATTESTATION_STATUS_COLOR: Record<AttestationStatus, string> = {
  pending:    '#F59E0B',
  current:    '#10B981',
  expired:    '#DC2626',
  superseded: '#94A3B8',
  archived:   '#64748B',
};

// =============================================================================
// Top-level
// =============================================================================

export default function VendorRiskClient({
  initialVendors, initialAttestations,
}: {
  initialVendors: Vendor[];
  initialAttestations: VendorAttestation[];
}) {
  const [vendors, setVendors] = useState<Vendor[]>(initialVendors);
  const [attestations, setAttestations] = useState<VendorAttestation[]>(initialAttestations);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [critFilter, setCritFilter] = useState<'ALL' | VendorCriticality>('ALL');
  const [search, setSearch] = useState('');

  const attestationsByVendor = useMemo(() => {
    const m = new Map<string, VendorAttestation[]>();
    for (const a of attestations) (m.get(a.vendor_id) ?? m.set(a.vendor_id, []).get(a.vendor_id)!).push(a);
    return m;
  }, [attestations]);

  const stats = useMemo(() => {
    const total = vendors.filter((v) => v.status === 'active').length;
    const critical = vendors.filter((v) => v.status === 'active' && v.criticality === 'critical').length;
    const todayMs = Date.now();
    const expired = attestations.filter((a) => a.status === 'current' && a.expires_on && new Date(a.expires_on).getTime() < todayMs).length;
    const expiringSoon = attestations.filter((a) => {
      if (a.status !== 'current' || !a.expires_on) return false;
      const t = new Date(a.expires_on).getTime();
      return t >= todayMs && t - todayMs <= 60 * 86400 * 1000;
    }).length;
    return { total, critical, expired, expiringSoon };
  }, [vendors, attestations]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return vendors.filter((v) => {
      if (critFilter !== 'ALL' && v.criticality !== critFilter) return false;
      if (term) {
        const hay = `${v.name} ${v.service_description ?? ''} ${v.owner ?? ''} ${v.vendor_type}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [vendors, critFilter, search]);

  async function createVendor(name: string, vendor_type: VendorType) {
    const res = await fetch('/api/vendors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, vendor_type, status: 'active' }),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) return alert(j.error ?? 'create failed');
    setVendors((s) => [j.vendor as Vendor, ...s]);
    setCreating(false);
    setOpenId(j.vendor.id);
  }

  async function patchVendor(id: string, fields: Partial<Vendor>) {
    setVendors((s) => s.map((v) => v.id === id ? { ...v, ...fields } : v));
    const res = await fetch('/api/vendors', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? `update failed (${res.status})`);
    }
  }

  async function removeVendor(id: string) {
    if (!confirm('Remove this vendor? Their attestations will be deleted too.')) return;
    setVendors((s) => s.filter((v) => v.id !== id));
    setAttestations((s) => s.filter((a) => a.vendor_id !== id));
    if (openId === id) setOpenId(null);
    await fetch(`/api/vendors?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async function addAttestation(vendor_id: string, payload: Partial<VendorAttestation>) {
    const res = await fetch('/api/vendor-attestations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vendor_id, ...payload }),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) return alert(j.error ?? 'create failed');
    setAttestations((s) => [...s, j.attestation as VendorAttestation]);
  }

  async function patchAttestation(id: string, fields: Partial<VendorAttestation>) {
    setAttestations((s) => s.map((a) => a.id === id ? { ...a, ...fields } : a));
    await fetch('/api/vendor-attestations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    });
  }

  async function removeAttestation(id: string) {
    setAttestations((s) => s.filter((a) => a.id !== id));
    await fetch(`/api/vendor-attestations?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  const open = openId ? vendors.find((v) => v.id === openId) ?? null : null;
  const openAtt = open ? attestationsByVendor.get(open.id) ?? [] : [];

  return (
    <>
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KpiTile label="Active Vendors" value={stats.total.toString()} sub="on the register" accent="#2563EB" />
        <KpiTile label="Critical" value={stats.critical.toString()} sub="business-critical relationships" accent={stats.critical > 0 ? '#DC2626' : '#94A3B8'} />
        <KpiTile label="Expired Attestations" value={stats.expired.toString()} sub={stats.expired > 0 ? 'need refresh now' : 'all current'} accent={stats.expired > 0 ? '#DC2626' : '#10B981'} />
        <KpiTile label="Expiring (60d)" value={stats.expiringSoon.toString()} sub="renewal coming up" accent={stats.expiringSoon > 0 ? '#F59E0B' : '#94A3B8'} />
      </div>

      <section className="scorecard">
        <div className="scorecard-header" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="scorecard-title">Vendors</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Third-party relationships with criticality, data sensitivity, and attestation tracking
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="score-select"
              placeholder="Search name, owner, service…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ minWidth: 240 }}
            />
            <button className="action-btn primary" onClick={() => setCreating((v) => !v)}>
              {creating ? 'Cancel' : '+ New Vendor'}
            </button>
          </div>
        </div>

        {creating && <NewVendorForm onSubmit={createVendor} onCancel={() => setCreating(false)} />}

        <div className="fn-filters" style={{ marginTop: 12 }}>
          <button className={`fn-btn ${critFilter === 'ALL' ? 'active' : ''}`} onClick={() => setCritFilter('ALL')}>All</button>
          {(['critical','high','medium','low'] as VendorCriticality[]).map((c) => (
            <button key={c} className={`fn-btn ${critFilter === c ? 'active' : ''}`} onClick={() => setCritFilter(c)}>
              {CRIT_META[c].label}
            </button>
          ))}
        </div>

        <table className="score-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Vendor</th>
              <th>Type</th>
              <th>Criticality</th>
              <th>Data sensitivity</th>
              <th>Owner</th>
              <th>Attestations</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)' }}>
                {vendors.length === 0
                  ? <>No vendors yet. Click <strong>+ New Vendor</strong>.</>
                  : 'No vendors match this filter.'}
              </td></tr>
            )}
            {visible.map((v) => {
              const ats = attestationsByVendor.get(v.id) ?? [];
              const cur = ats.filter((a) => a.status === 'current').length;
              const exp = ats.filter((a) => a.status === 'current' && a.expires_on && new Date(a.expires_on).getTime() < Date.now()).length;
              return (
                <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(v.id)}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{v.name}</div>
                    {v.service_description && (
                      <div style={{ fontSize: 11, color: 'var(--text-mid)', marginTop: 2,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 380 }}>
                        {v.service_description}
                      </div>
                    )}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-mid)' }}>{TYPE_LABEL[v.vendor_type]}</td>
                  <td><Pill color={CRIT_META[v.criticality].color}>{CRIT_META[v.criticality].label}</Pill></td>
                  <td><Pill color={SENS_META[v.data_sensitivity].color}>{SENS_META[v.data_sensitivity].label}</Pill></td>
                  <td style={{ fontSize: 12, color: 'var(--text-mid)' }}>{v.owner ?? '—'}</td>
                  <td style={{ fontSize: 11 }}>
                    {ats.length === 0
                      ? <span style={{ color: 'var(--text-muted)' }}>none</span>
                      : <span style={{ color: exp > 0 ? 'var(--gap-pos)' : 'var(--text-mid)' }}>
                          {cur}/{ats.length} current{exp > 0 ? ` · ${exp} expired` : ''}
                        </span>}
                  </td>
                  <td><Pill color={STATUS_META[v.status].color}>{STATUS_META[v.status].label}</Pill></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <button className="action-btn" onClick={() => setOpenId(v.id)}>Open</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {open && (
        <VendorEditor
          vendor={open}
          attestations={openAtt}
          onClose={() => setOpenId(null)}
          onPatch={(fields) => patchVendor(open.id, fields)}
          onDelete={() => removeVendor(open.id)}
          onAddAttestation={(payload) => addAttestation(open.id, payload)}
          onPatchAttestation={patchAttestation}
          onRemoveAttestation={removeAttestation}
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

function NewVendorForm({
  onSubmit, onCancel,
}: { onSubmit: (name: string, vendor_type: VendorType) => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<VendorType>('saas');
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSubmit(name.trim(), type); }}
      style={{
        marginTop: 12, padding: 14, background: 'var(--bg-card)',
        border: '1px solid var(--bg-border)', borderRadius: 'var(--r-md)',
        display: 'grid', gridTemplateColumns: '2fr 1fr auto auto', gap: 10, alignItems: 'end',
      }}
    >
      <Field label="Vendor name (required)" hint="e.g. 'Microsoft 365 (Microsoft Corporation)'.">
        <input className="score-select" value={name} onChange={(e) => setName(e.target.value)} autoFocus
          placeholder="Microsoft 365 (Microsoft Corporation)" />
      </Field>
      <Field label="Type">
        <select className="score-select" value={type} onChange={(e) => setType(e.target.value as VendorType)}>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <button type="submit" className="action-btn primary" disabled={!name.trim()}>Create vendor</button>
      <button type="button" className="action-btn" onClick={onCancel}>Cancel</button>
    </form>
  );
}

// =============================================================================
// Vendor editor
// =============================================================================

function VendorEditor({
  vendor, attestations,
  onClose, onPatch, onDelete,
  onAddAttestation, onPatchAttestation, onRemoveAttestation,
}: {
  vendor: Vendor;
  attestations: VendorAttestation[];
  onClose: () => void;
  onPatch: (fields: Partial<Vendor>) => void;
  onDelete: () => void;
  onAddAttestation: (payload: Partial<VendorAttestation>) => void;
  onPatchAttestation: (id: string, fields: Partial<VendorAttestation>) => void;
  onRemoveAttestation: (id: string) => void;
}) {
  const [newType, setNewType] = useState<AttestationType>('soc2_type2');
  const [newTitle, setNewTitle] = useState('');
  const [newExpires, setNewExpires] = useState('');
  const crit = CRIT_META[vendor.criticality];

  return (
    <section className="scorecard" style={{ borderColor: crit.color }}>
      <div className="scorecard-header">
        <div>
          <div className="scorecard-title">{vendor.name}</div>
          <div className="scorecard-tag" style={{ marginTop: 4 }}>
            {TYPE_LABEL[vendor.vendor_type]} · <span style={{ color: crit.color, fontWeight: 600 }}>{crit.label}</span>
            {vendor.data_sensitivity !== 'none' && <span> · holds {SENS_META[vendor.data_sensitivity].label}</span>}
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
            <input className="score-select" defaultValue={vendor.name}
              onBlur={(e) => onPatch({ name: e.target.value })} />
          </Field>
          <Field label="Service description" style={{ marginTop: 12 }}>
            <textarea className="score-select" rows={3} defaultValue={vendor.service_description ?? ''}
              onBlur={(e) => onPatch({ service_description: e.target.value })}
              placeholder="What service the vendor provides + how it's used in the tenant." />
          </Field>
          <Field label="Access summary" hint="What the vendor can see / write. Drives audit-trail review." style={{ marginTop: 12 }}>
            <textarea className="score-select" rows={2} defaultValue={vendor.access_summary ?? ''}
              onBlur={(e) => onPatch({ access_summary: e.target.value })}
              placeholder="e.g. Global admin via OAuth · SOC SIEM read-only · API secret with PII export rights" />
          </Field>
          <Field label="Notes" style={{ marginTop: 12 }}>
            <textarea className="score-select" rows={2} defaultValue={vendor.notes ?? ''}
              onBlur={(e) => onPatch({ notes: e.target.value })}
              placeholder="Free-form: contract terms, escalation path, known issues." />
          </Field>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Type">
              <select className="score-select" value={vendor.vendor_type}
                onChange={(e) => onPatch({ vendor_type: e.target.value as VendorType })}>
                {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Criticality">
              <select className="score-select" value={vendor.criticality}
                onChange={(e) => onPatch({ criticality: e.target.value as VendorCriticality })}>
                {Object.entries(CRIT_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Data sensitivity">
              <select className="score-select" value={vendor.data_sensitivity}
                onChange={(e) => onPatch({ data_sensitivity: e.target.value as VendorDataSensitivity })}>
                {Object.entries(SENS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select className="score-select" value={vendor.status}
                onChange={(e) => onPatch({ status: e.target.value as VendorStatus })}>
                {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Internal owner">
            <input className="score-select" defaultValue={vendor.owner ?? ''}
              onBlur={(e) => onPatch({ owner: e.target.value })} placeholder="e.g. IT Manager" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Primary contact (vendor)">
              <input className="score-select" defaultValue={vendor.primary_contact ?? ''}
                onBlur={(e) => onPatch({ primary_contact: e.target.value })} />
            </Field>
            <Field label="Contact email">
              <input className="score-select" type="email" defaultValue={vendor.contact_email ?? ''}
                onBlur={(e) => onPatch({ contact_email: e.target.value })} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Contract renewal">
              <input type="date" className="score-select" defaultValue={vendor.contract_renewal_at ?? ''}
                onChange={(e) => onPatch({ contract_renewal_at: e.target.value || null })} />
            </Field>
            <Field label="Annual spend (USD)">
              <input type="number" className="score-select" defaultValue={vendor.annual_spend_usd ?? ''}
                onBlur={(e) => onPatch({ annual_spend_usd: e.target.value ? Number(e.target.value) : null })} />
            </Field>
          </div>
          <Field label="Website">
            <input className="score-select" type="url" defaultValue={vendor.website ?? ''}
              onBlur={(e) => onPatch({ website: e.target.value })} placeholder="https://" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Last assessed">
              <input type="date" className="score-select" defaultValue={vendor.last_assessed_at ?? ''}
                onChange={(e) => onPatch({ last_assessed_at: e.target.value || null })} />
            </Field>
            <Field label="Next assessment due">
              <input type="date" className="score-select" defaultValue={vendor.next_assessment_at ?? ''}
                onChange={(e) => onPatch({ next_assessment_at: e.target.value || null })} />
            </Field>
          </div>
        </div>
      </div>

      {/* Attestations */}
      <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--bg-border)' }}>
        <div style={{
          fontFamily: 'Oswald, sans-serif', fontWeight: 600, fontSize: 13,
          color: 'var(--text)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.04em',
        }}>
          Attestations ({attestations.length})
        </div>

        {attestations.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 12 }}>
            No attestations on file yet. Add the vendor&apos;s SOC 2 / ISO 27001 / HIPAA BAA below.
          </div>
        ) : (
          <table className="score-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Title</th>
                <th>Issued</th>
                <th>Expires</th>
                <th>Findings</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {attestations.map((a) => {
                const todayMs = Date.now();
                const overdue = a.status === 'current' && a.expires_on && new Date(a.expires_on).getTime() < todayMs;
                return (
                  <tr key={a.id}>
                    <td>
                      <select className="score-select" value={a.attestation_type}
                        onChange={(e) => onPatchAttestation(a.id, { attestation_type: e.target.value as AttestationType })}>
                        {ATTESTATION_TYPES.map((t) => <option key={t} value={t}>{ATTESTATION_LABELS[t]}</option>)}
                      </select>
                    </td>
                    <td>
                      <input className="score-select" defaultValue={a.title}
                        onBlur={(e) => onPatchAttestation(a.id, { title: e.target.value })} />
                    </td>
                    <td>
                      <input type="date" className="score-select" defaultValue={a.issued_on ?? ''}
                        onChange={(e) => onPatchAttestation(a.id, { issued_on: e.target.value || null })} />
                    </td>
                    <td style={{ color: overdue ? 'var(--gap-pos)' : 'var(--text)' }}>
                      <input type="date" className="score-select" defaultValue={a.expires_on ?? ''}
                        onChange={(e) => onPatchAttestation(a.id, { expires_on: e.target.value || null })} />
                      {overdue && <span style={{ marginLeft: 4, fontSize: 9, fontWeight: 700, color: 'var(--gap-pos)' }}>EXPIRED</span>}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--text-mid)' }}>
                      {a.findings_critical}/{a.findings_major}/{a.findings_minor}
                      <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 4 }}>(C/M/m)</span>
                    </td>
                    <td>
                      <select className="score-select" value={a.status}
                        style={{ color: ATTESTATION_STATUS_COLOR[a.status], fontWeight: 600 }}
                        onChange={(e) => onPatchAttestation(a.id, { status: e.target.value as AttestationStatus })}>
                        {(['pending','current','expired','superseded','archived'] as AttestationStatus[]).map((s) =>
                          <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                    <td><button className="action-btn danger" onClick={() => onRemoveAttestation(a.id)}>×</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {/* Add attestation row */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newTitle.trim()) return;
            onAddAttestation({
              attestation_type: newType,
              title: newTitle.trim(),
              expires_on: newExpires || null,
              status: 'current',
            });
            setNewTitle(''); setNewExpires(''); setNewType('soc2_type2');
          }}
          style={{
            marginTop: 12, padding: 10, background: 'var(--bg-card)',
            border: '1px solid var(--bg-border)', borderRadius: 'var(--r-md)',
            display: 'grid', gridTemplateColumns: '180px 2fr 160px auto', gap: 8, alignItems: 'end',
          }}
        >
          <Field label="Type">
            <select className="score-select" value={newType} onChange={(e) => setNewType(e.target.value as AttestationType)}>
              {ATTESTATION_TYPES.map((t) => <option key={t} value={t}>{ATTESTATION_LABELS[t]}</option>)}
            </select>
          </Field>
          <Field label="Title (required)">
            <input className="score-select" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. FY2025 SOC 2 Type II" />
          </Field>
          <Field label="Expires">
            <input type="date" className="score-select" value={newExpires} onChange={(e) => setNewExpires(e.target.value)} />
          </Field>
          <button type="submit" className="action-btn" disabled={!newTitle.trim()}>+ Add attestation</button>
        </form>
      </div>
    </section>
  );
}
