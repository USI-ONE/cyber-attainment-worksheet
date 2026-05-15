'use client';

import { useState } from 'react';

export interface AdminTenantRow {
  id: string;
  slug: string;
  hostname: string | null;
  display_name: string;
  brand_config: Record<string, unknown> | null;
  /** When true, every member of this tenant (any role) gets effective
   *  platform-admin access. See lib/auth.ts elevation logic. */
  is_admin_tenant: boolean;
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
      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KpiTile label="Tenants" value={list.length.toString()} sub="active portals" accent="#2563EB" />
        <KpiTile label="Admin Tenants" value={list.filter((t) => t.is_admin_tenant).length.toString()} sub="members get platform-admin access" accent="#1E40AF" />
        <KpiTile label="Total Editors" value={Object.values(memberCounts).reduce((s, c) => s + c.editors, 0).toString()} sub="across all tenants" accent="#10B981" />
        <KpiTile label="Total Viewers" value={Object.values(memberCounts).reduce((s, c) => s + c.viewers, 0).toString()} sub="across all tenants" accent="#64748B" />
      </div>

      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Tenants</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Each row is a client deployment. Slug is immutable; display name, hostname, brand_config, and the admin-tenant flag are editable.
              {' '}<strong>Admin tenant</strong> grants every member of that tenant platform-wide access.
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
              <th title="When on, every member of this tenant gets effective platform-admin access — they can see and edit every other tenant in the hub.">Admin tenant</th>
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input className="score-select" defaultValue={t.display_name}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== t.display_name) patchTenant(t.id, { display_name: v });
                        }} />
                      {t.is_admin_tenant && (
                        <span style={{
                          fontSize: 9, fontWeight: 700, padding: '2px 6px',
                          borderRadius: 999, background: '#1E40AF1a',
                          color: '#1E40AF', border: '1px solid #1E40AF55',
                          textTransform: 'uppercase', letterSpacing: '.06em',
                          whiteSpace: 'nowrap',
                        }}>Admin</span>
                      )}
                    </div>
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
                  <td>
                    <label style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      cursor: 'pointer', fontSize: 12,
                    }}>
                      <input
                        type="checkbox"
                        checked={t.is_admin_tenant}
                        onChange={(e) => {
                          const next = e.target.checked;
                          if (next && !confirm(`Mark "${t.display_name}" as an admin tenant? Every current and future member of this tenant will get platform-admin access across all tenants.`)) {
                            e.target.checked = false;
                            return;
                          }
                          if (!next && t.is_admin_tenant && !confirm(`Remove admin-tenant flag from "${t.display_name}"? Members will lose platform-wide access (unless they have profiles.is_platform_admin set directly).`)) {
                            e.target.checked = true;
                            return;
                          }
                          patchTenant(t.id, { is_admin_tenant: next });
                        }}
                      />
                      {t.is_admin_tenant
                        ? <span style={{ color: '#1E40AF', fontWeight: 600 }}>On</span>
                        : <span style={{ color: 'var(--text-muted)' }}>Off</span>}
                    </label>
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
