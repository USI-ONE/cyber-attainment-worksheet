'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';

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

  // Tenant creation moved to a dedicated wizard at /admin/tenants/new
  // that also handles framework assignment + baseline-score seeding.
  // The inline NewTenantForm + createTenant helper below are no longer
  // wired up but kept around in case we want a quick-create path back.

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

  // Logo upload — multipart POST to /api/admin/tenants/[id]/logo.
  // On success the server returns the canonical (cache-free) public URL.
  // We splice that into the row's brand_config so the preview updates
  // immediately. (`?v=<ts>` is appended on the IMG src only — not stored —
  // to bypass the browser cache when the same extension is re-uploaded.)
  async function uploadLogo(id: string, file: File): Promise<string | null> {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/api/admin/tenants/${id}/logo`, { method: 'POST', body: form });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(j.error ?? 'logo upload failed');
      return null;
    }
    const newUrl: string = j.logo_url;
    setList((s) => s.map((t) => t.id === id
      ? { ...t, brand_config: { ...(t.brand_config ?? {}), logo_url: newUrl } }
      : t));
    return newUrl;
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
              Each row is a client deployment. Slug is immutable; display name, hostname, brand_config, and the admin-tenant flag are editable.
              {' '}<em>The admin-tenant flag is deprecated</em> — access levels are set per-user at invite time (Global admin / Tenant admin / Tenant viewer). The column below is read-only and will be removed in a future migration.
            </div>
          </div>
          <Link href="/admin/tenants/new" className="action-btn primary">
            + New Tenant
          </Link>
        </div>

        <table className="score-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Logo</th>
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
              const logoUrl = (t.brand_config as { logo_url?: string } | null)?.logo_url ?? null;
              return (
                <tr key={t.id}>
                  <td>
                    <LogoCell
                      tenantId={t.id}
                      logoUrl={logoUrl}
                      onUpload={(file) => uploadLogo(t.id, file)}
                    />
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input className="score-select" defaultValue={t.display_name}
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== t.display_name) patchTenant(t.id, { display_name: v });
                        }} />
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

/**
 * Logo thumbnail + "Change…" button for a single tenant row.
 * Hidden file input is per-row (cheap, simpler than juggling shared refs)
 * and accepts the same MIME set the bucket allows.
 *
 * After upload, `previewBust` is bumped so the <img> reloads even when the
 * canonical URL is unchanged (same extension overwrite — browsers would
 * otherwise serve the cached version).
 */
function LogoCell({
  tenantId, logoUrl, onUpload,
}: {
  tenantId: string;
  logoUrl: string | null;
  onUpload: (file: File) => Promise<string | null>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [previewBust, setPreviewBust] = useState(0);

  const previewSrc = logoUrl
    ? `${logoUrl}${logoUrl.includes('?') ? '&' : '?'}v=${previewBust}`
    : null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          width: 36, height: 36, borderRadius: 6,
          background: previewSrc ? `#fff center/contain no-repeat url("${previewSrc}")` : 'var(--bg-surface)',
          border: '1px solid var(--bg-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, color: 'var(--text-muted)', flexShrink: 0,
        }}
        aria-label={previewSrc ? 'Current tenant logo' : 'No logo set'}
      >
        {previewSrc ? null : 'none'}
      </div>
      <button
        type="button"
        className="action-btn"
        style={{ padding: '4px 10px', fontSize: 11 }}
        disabled={busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Uploading…' : (logoUrl ? 'Change' : 'Upload')}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/svg+xml,image/webp,image/avif"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          // Clear the input first so re-selecting the same filename later
          // still triggers onChange.
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          const newUrl = await onUpload(file);
          setBusy(false);
          if (newUrl) setPreviewBust((n) => n + 1);
        }}
        data-tenant-id={tenantId}
      />
    </div>
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
