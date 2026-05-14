'use client';

import { useMemo, useState } from 'react';

// =============================================================================
// Types — kept local + exported so the page can hand server-fetched rows in
// without an extra type round-trip through lib/supabase/types.
// =============================================================================

export interface AdminProfile {
  id: string;
  email: string;
  display_name: string | null;
  is_platform_admin: boolean;
  status: 'active' | 'disabled' | 'invited';
  last_login_at: string | null;
  created_at: string;
}
export interface AdminMembership {
  user_id: string;
  tenant_id: string;
  role: 'editor' | 'viewer';
  created_at: string;
}
export interface AdminTenant {
  id: string;
  slug: string;
  display_name: string;
}
export interface AdminInvite {
  id: string;
  email: string;
  tenant_id: string | null;
  role: 'editor' | 'viewer' | null;
  grant_platform_admin: boolean;
  expires_at: string;
  created_at: string;
}

const STATUS_COLOR: Record<AdminProfile['status'], string> = {
  active:   '#10B981',
  invited:  '#F59E0B',
  disabled: '#94A3B8',
};

export default function UserAdminClient({
  currentUserId, users, memberships, tenants, pendingInvites,
}: {
  currentUserId: string;
  users: AdminProfile[];
  memberships: AdminMembership[];
  tenants: AdminTenant[];
  pendingInvites: AdminInvite[];
}) {
  const [userList, setUserList] = useState<AdminProfile[]>(users);
  const [memList, setMemList] = useState<AdminMembership[]>(memberships);
  const [invites, setInvites] = useState<AdminInvite[]>(pendingInvites);
  const [openInvite, setOpenInvite] = useState(false);
  const [acceptUrl, setAcceptUrl] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const tenantsById = useMemo(() => {
    const m: Record<string, AdminTenant> = {};
    for (const t of tenants) m[t.id] = t;
    return m;
  }, [tenants]);

  const memsByUser = useMemo(() => {
    const m: Record<string, AdminMembership[]> = {};
    for (const x of memList) (m[x.user_id] ??= []).push(x);
    return m;
  }, [memList]);

  const visible = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return userList;
    return userList.filter((u) =>
      u.email.toLowerCase().includes(term)
      || (u.display_name ?? '').toLowerCase().includes(term)
    );
  }, [userList, filter]);

  // -- Mutations -----------------------------------------------------------

  async function createInvite(payload: {
    email: string; display_name?: string;
    grant_platform_admin: boolean;
    tenant_id?: string | null;
    role?: 'editor' | 'viewer';
  }) {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) { alert(j.error ?? 'invite failed'); return; }
    // Prefer the server-built URL — it knows the tenant's hostname so a
    // tenant-scoped invite issued from the operator hub still produces a
    // URL pointed at the tenant deploy (where the invitee's session needs
    // to live). Fall back to origin+path for platform-admin invites where
    // the server returns accept_url = null.
    setAcceptUrl(j.accept_url ?? (window.location.origin + j.accept_url_path));
    setInvites((s) => [
      { id: j.invite.id, email: j.invite.email, tenant_id: j.invite.tenant_id,
        role: j.invite.role, grant_platform_admin: j.invite.grant_platform_admin,
        expires_at: j.invite.expires_at, created_at: new Date().toISOString() },
      ...s,
    ]);
    setOpenInvite(false);
  }

  async function togglePlatformAdmin(user: AdminProfile) {
    if (user.id === currentUserId && user.is_platform_admin) {
      alert('You cannot remove your own platform-admin flag.');
      return;
    }
    const next = !user.is_platform_admin;
    setUserList((s) => s.map((u) => u.id === user.id ? { ...u, is_platform_admin: next } : u));
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_platform_admin: next }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? 'update failed');
      setUserList((s) => s.map((u) => u.id === user.id ? { ...u, is_platform_admin: !next } : u));
    }
  }

  async function setStatus(user: AdminProfile, status: AdminProfile['status']) {
    if (user.id === currentUserId && status === 'disabled') {
      alert('You cannot disable your own account.');
      return;
    }
    setUserList((s) => s.map((u) => u.id === user.id ? { ...u, status } : u));
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? 'update failed');
    }
  }

  async function addMembership(user: AdminProfile, tenant_id: string, role: 'editor' | 'viewer') {
    const res = await fetch(`/api/admin/users/${user.id}/memberships`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id, role }),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) { alert(j.error ?? 'add failed'); return; }
    setMemList((s) => {
      const without = s.filter((m) => !(m.user_id === user.id && m.tenant_id === tenant_id));
      return [...without, j.membership as AdminMembership];
    });
  }

  async function removeMembership(user_id: string, tenant_id: string) {
    setMemList((s) => s.filter((m) => !(m.user_id === user_id && m.tenant_id === tenant_id)));
    await fetch(`/api/admin/users/${user_id}/memberships?tenant_id=${encodeURIComponent(tenant_id)}`,
      { method: 'DELETE' });
  }

  // -- Render --------------------------------------------------------------

  return (
    <>
      {acceptUrl && (
        <AcceptUrlBanner url={acceptUrl} onDismiss={() => setAcceptUrl(null)} />
      )}

      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KpiTile label="Total Users" value={userList.length.toString()} sub="across all roles" accent="#2563EB" />
        <KpiTile label="Platform Admins" value={userList.filter((u) => u.is_platform_admin).length.toString()} sub="USI super-admins" accent="#1E40AF" />
        <KpiTile label="Pending Invites" value={invites.length.toString()} sub="awaiting first login" accent="#F59E0B" />
        <KpiTile label="Disabled" value={userList.filter((u) => u.status === 'disabled').length.toString()} sub="cannot sign in" accent="#94A3B8" />
      </div>

      <section className="scorecard">
        <div className="scorecard-header" style={{ flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="scorecard-title">Users</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Platform-level user administration · platform-admin only
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="score-select"
              placeholder="Search email or name…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              style={{ minWidth: 240 }}
            />
            <button className="action-btn primary" onClick={() => setOpenInvite((v) => !v)}>
              {openInvite ? 'Cancel' : '+ Invite User'}
            </button>
          </div>
        </div>

        {openInvite && (
          <InviteForm tenants={tenants} onSubmit={createInvite} onCancel={() => setOpenInvite(false)} />
        )}

        <table className="score-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>User</th>
              <th>Status</th>
              <th>Platform Admin</th>
              <th>Tenant Memberships</th>
              <th>Last login</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((u) => {
              const ms = memsByUser[u.id] ?? [];
              return (
                <tr key={u.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{u.display_name || u.email}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>{u.email}</div>
                  </td>
                  <td><StatusPill status={u.status} /></td>
                  <td>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={u.is_platform_admin}
                        disabled={u.id === currentUserId && u.is_platform_admin}
                        onChange={() => togglePlatformAdmin(u)}
                      />
                      {u.is_platform_admin
                        ? <span style={{ color: 'var(--gold-light)', fontWeight: 600 }}>Yes</span>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </label>
                  </td>
                  <td>
                    <MembershipsCell
                      user={u}
                      memberships={ms}
                      tenantsById={tenantsById}
                      allTenants={tenants}
                      onAdd={(tid, role) => addMembership(u, tid, role)}
                      onRemove={(tid) => removeMembership(u.id, tid)}
                    />
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--text-mid)' }}>
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {u.status === 'disabled' ? (
                      <button className="action-btn" onClick={() => setStatus(u, 'active')}>Re-enable</button>
                    ) : u.id === currentUserId ? (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(you)</span>
                    ) : (
                      <button className="action-btn danger" onClick={() => setStatus(u, 'disabled')}>Disable</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {invites.length > 0 && (
        <section className="scorecard">
          <div className="scorecard-header">
            <div>
              <div className="scorecard-title">Pending Invites</div>
              <div className="scorecard-tag" style={{ marginTop: 4 }}>
                Awaiting first login. Tokens expire 14 days after issuance.
              </div>
            </div>
          </div>
          <table className="score-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Grants</th>
                <th>Expires</th>
                <th>Issued</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td style={{ fontSize: 12 }}>
                    {i.grant_platform_admin && <Pill color="#1E40AF">Platform Admin</Pill>}
                    {i.tenant_id && i.role && (
                      <Pill color="#2563EB" style={{ marginLeft: i.grant_platform_admin ? 6 : 0 }}>
                        {tenantsById[i.tenant_id]?.display_name ?? i.tenant_id} · {i.role}
                      </Pill>
                    )}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--text-mid)' }}>
                    {new Date(i.expires_at).toLocaleDateString()}
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--text-mid)' }}>
                    {new Date(i.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
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

function StatusPill({ status }: { status: AdminProfile['status'] }) {
  return <Pill color={STATUS_COLOR[status]}>{status}</Pill>;
}

function AcceptUrlBanner({ url, onDismiss }: { url: string; onDismiss: () => void }) {
  return (
    <div className="banner success" style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '16px 18px', marginBottom: 18,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Invite issued — copy this URL</div>
        <div style={{ fontSize: 11, color: 'var(--text-mid)', marginBottom: 8 }}>
          Send this one-time link to the invitee. It expires in 14 days. Once used it cannot be reused.
        </div>
        <input
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          style={{
            width: '100%', padding: '8px 10px',
            background: 'var(--bg-mid)', border: '1px solid var(--bg-border)',
            color: 'var(--text)', fontFamily: 'Inter, sans-serif', fontSize: 11,
            borderRadius: 6,
          }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button className="action-btn primary" onClick={() => {
          navigator.clipboard.writeText(url).then(() => { /* success */ }).catch(() => alert('Clipboard write failed; copy the URL manually.'));
        }}>Copy URL</button>
        <button className="action-btn" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}

function InviteForm({
  tenants, onSubmit, onCancel,
}: {
  tenants: AdminTenant[];
  onSubmit: (payload: { email: string; display_name?: string; grant_platform_admin: boolean; tenant_id?: string | null; role?: 'editor' | 'viewer' }) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [grantPlatform, setGrantPlatform] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('viewer');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes('@')) return;
    if (!grantPlatform && !tenantId) {
      alert('Either grant platform admin OR assign a tenant + role (or both).');
      return;
    }
    onSubmit({
      email: email.trim(),
      display_name: displayName.trim() || undefined,
      grant_platform_admin: grantPlatform,
      tenant_id: tenantId || null,
      role: tenantId ? role : undefined,
    });
  }

  return (
    <form onSubmit={submit} style={{
      marginTop: 12, padding: 14,
      background: 'var(--bg-card)', border: '1px solid var(--bg-border)',
      borderRadius: 'var(--r-md)',
      display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 10,
    }}>
      <Field label="Email (required)" style={{ gridColumn: 'span 2' }}>
        <input className="score-select" type="email" required autoFocus
          value={email} onChange={(e) => setEmail(e.target.value)}
          placeholder="user@example.com" />
      </Field>
      <Field label="Display name (optional)" style={{ gridColumn: 'span 2' }}>
        <input className="score-select"
          value={displayName} onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Name" />
      </Field>
      <Field label="Platform admin" hint="Grants access to /admin and every tenant.">
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, paddingTop: 8, fontSize: 13 }}>
          <input type="checkbox" checked={grantPlatform} onChange={(e) => setGrantPlatform(e.target.checked)} />
          Grant platform-admin role
        </label>
      </Field>
      <Field label="Assign to tenant">
        <select className="score-select" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
          <option value="">— none —</option>
          {tenants.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
        </select>
      </Field>
      <Field label="Role in tenant">
        <select className="score-select" value={role}
          disabled={!tenantId}
          onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}>
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
        </select>
      </Field>
      <div style={{ gridColumn: 'span 4', display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
        <button type="button" className="action-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="action-btn primary" disabled={!email.includes('@')}>Issue invite</button>
      </div>
    </form>
  );
}

function MembershipsCell({
  user, memberships, tenantsById, allTenants, onAdd, onRemove,
}: {
  user: AdminProfile;
  memberships: AdminMembership[];
  tenantsById: Record<string, AdminTenant>;
  allTenants: AdminTenant[];
  onAdd: (tenant_id: string, role: 'editor' | 'viewer') => void;
  onRemove: (tenant_id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tid, setTid] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('viewer');

  const heldTenantIds = new Set(memberships.map((m) => m.tenant_id));
  const available = allTenants.filter((t) => !heldTenantIds.has(t.id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {memberships.length === 0 ? (
        <span style={{ fontSize: 11, color: user.is_platform_admin ? 'var(--text-muted)' : 'var(--gap-pos)' }}>
          {user.is_platform_admin ? '— (platform admin)' : 'no memberships'}
        </span>
      ) : memberships.map((m) => (
        <div key={m.tenant_id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
          <span style={{ fontWeight: 600 }}>{tenantsById[m.tenant_id]?.display_name ?? m.tenant_id}</span>
          <Pill color={m.role === 'editor' ? '#2563EB' : '#64748B'} style={{ fontSize: 10 }}>{m.role}</Pill>
          <button className="action-btn danger" style={{ padding: '0 6px', fontSize: 11, lineHeight: 1.4 }}
            onClick={() => onRemove(m.tenant_id)}>×</button>
        </div>
      ))}

      {open ? (
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <select className="score-select" value={tid} onChange={(e) => setTid(e.target.value)} style={{ fontSize: 11 }}>
            <option value="">tenant…</option>
            {available.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
          </select>
          <select className="score-select" value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')} style={{ fontSize: 11 }}>
            <option value="viewer">viewer</option>
            <option value="editor">editor</option>
          </select>
          <button className="action-btn" disabled={!tid}
            onClick={() => { onAdd(tid, role); setTid(''); setOpen(false); }}>OK</button>
          <button className="action-btn" onClick={() => setOpen(false)}>×</button>
        </div>
      ) : available.length > 0 ? (
        <button className="action-btn" style={{ alignSelf: 'flex-start', padding: '2px 8px', fontSize: 11, marginTop: 4 }} onClick={() => setOpen(true)}>
          + Add membership
        </button>
      ) : null}
    </div>
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
