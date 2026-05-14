'use client';

import { useState } from 'react';

export interface AdminTenantRow {
  id: string;
  slug: string;
  hostname: string | null;
  display_name: string;
  brand_config: Record<string, unknown> | null;
  created_at: string;
}

export default function TenantAdminClient({
  tenants, memberCounts,
}: {
  tenants: AdminTenantRow[];
  memberCounts: Record<string, { editors: number; viewers: number }>;
}) {
  const [list, setList] = useState<AdminTenantRow[]>(tenants);
  const [creating, setCreating] = useState(false);

  async function createTenant(payload: { slug: string; display_name: string; hostname?: string }) {
    const res = await fetch('/api/admin/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) { alert(j.error ?? 'create failed'); return; }
    setList((s) => [...s, j.tenant as AdminTenantRow].sort((a, b) => a.display_name.localeCompare(b.display_name)));
    setCreating(false);
  }

  async function patchTenant(id: string, fields: Partial<AdminTenantRow>) {
    setList((s) => s.map((t) => t.id === id ? { ...t, ...fields } : t));
    const res = await fetch(`/api/admin/tenants/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? 'update failed');
    }
  }

  return (
    <>
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <KpiTile label="Tenants" value={list.length.toString()} sub="active portals" accent="#2563EB" />
        <KpiTile label="Total Editors" value={Object.values(memberCounts).reduce((s, c) => s + c.editors, 0).toString()} sub="across all tenants" accent="#10B981" />
        <KpiTile label="Total Viewers" value={Object.values(memberCounts).reduce((s, c) => s + c.viewers, 0).toString()} sub="across all tenants" accent="#64748B" />
      </div>

      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Tenants</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Each row is a client deployment. Slug is immutable; display name, hostname, and brand_config are editable.
            </div>
          </div>
          <button className="action-btn primary" onClick={() => setCreating((v) => !v)}>
            {creating ? 'Cancel' : '+ New Tenant'}
          </button>
        </div>

        {creating && <NewTenantForm onSubmit={createTenant} onCancel={() => setCreating(false)} />}

        <table className="score-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Display name</th>
              <th>Slug</th>
              <th>Hostname</th>
              <th>Editors</th>
              <th>Viewers</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => {
              const counts = memberCounts[t.id] ?? { editors: 0, viewers: 0 };
              return (
                <tr key={t.id}>
                  <td>
                    <input className="score-select" defaultValue={t.display_name}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== t.display_name) patchTenant(t.id, { display_name: v });
                      }} />
                  </td>
                  <td><code style={{ fontFamily: 'Inter, sans-serif', fontSize: 11, color: 'var(--text-mid)' }}>{t.slug}</code></td>
                  <td>
                    <input className="score-select" defaultValue={t.hostname ?? ''}
                      placeholder={`caw-${t.slug}.vercel.app`}
                      onBlur={(e) => {
                        const v = e.target.value.trim() || null;
                        if (v !== t.hostname) patchTenant(t.id, { hostname: v });
                      }} />
                  </td>
                  <td style={{ fontFamily: 'Inter, sans-serif' }}>{counts.editors}</td>
                  <td style={{ fontFamily: 'Inter, sans-serif' }}>{counts.viewers}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-mid)' }}>{new Date(t.created_at).toLocaleDateString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
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

function NewTenantForm({
  onSubmit, onCancel,
}: { onSubmit: (payload: { slug: string; display_name: string; hostname?: string }) => void; onCancel: () => void }) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!slug || !name) return;
        onSubmit({ slug: slug.trim(), display_name: name.trim(), hostname: hostname.trim() || undefined });
      }}
      style={{
        marginTop: 12, padding: 14, background: 'var(--bg-card)',
        border: '1px solid var(--bg-border)', borderRadius: 'var(--r-md)',
        display: 'grid', gridTemplateColumns: '1fr 2fr 2fr auto auto', gap: 10, alignItems: 'end',
      }}
    >
      <Field label="Slug" hint="kebab-case, immutable">
        <input className="score-select" required pattern="[a-z0-9][a-z0-9-]*" autoFocus
          value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="acme-corp" />
      </Field>
      <Field label="Display name">
        <input className="score-select" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corporation" />
      </Field>
      <Field label="Hostname (optional)" hint="Production hostname for tenant routing">
        <input className="score-select" value={hostname} onChange={(e) => setHostname(e.target.value)} placeholder={`caw-${slug || 'tenant'}.vercel.app`} />
      </Field>
      <button type="submit" className="action-btn primary" disabled={!slug || !name}>Create</button>
      <button type="button" className="action-btn" onClick={onCancel}>Cancel</button>
    </form>
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
