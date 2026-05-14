'use client';

import { useState } from 'react';

export interface TenantMember {
  user_id: string;
  role: 'editor' | 'viewer';
  created_at: string;
  user: {
    id: string;
    email: string;
    display_name: string | null;
    status: 'active' | 'disabled' | 'invited';
    last_login_at: string | null;
    is_platform_admin: boolean;
  } | null;
}

export interface TenantPendingInvite {
  id: string;
  email: string;
  role: 'editor' | 'viewer' | null;
  expires_at: string;
  created_at: string;
}

export default function TenantUsersClient({
  tenantName, currentUserId, isPlatformAdmin,
  initialMembers, initialInvites,
}: {
  tenantName: string;
  currentUserId: string;
  isPlatformAdmin: boolean;
  initialMembers: TenantMember[];
  initialInvites: TenantPendingInvite[];
}) {
  const [members, setMembers] = useState<TenantMember[]>(initialMembers);
  const [invites, setInvites] = useState<TenantPendingInvite[]>(initialInvites);
  const [openInvite, setOpenInvite] = useState(false);
  const [acceptUrl, setAcceptUrl] = useState<string | null>(null);

  async function invite(payload: { email: string; role: 'editor' | 'viewer'; display_name?: string }) {
    const res = await fetch('/api/settings/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) { alert(j.error ?? 'invite failed'); return; }
    // Server returns an explicit accept_url with the tenant's hostname
    // baked in — use it if present, otherwise fall back to origin+path.
    setAcceptUrl(j.accept_url ?? (window.location.origin + j.accept_url_path));
    setInvites((s) => [
      { id: j.invite.id, email: j.invite.email, role: j.invite.role,
        expires_at: j.invite.expires_at, created_at: new Date().toISOString() },
      ...s,
    ]);
    setOpenInvite(false);
  }

  async function changeRole(user_id: string, role: 'editor' | 'viewer') {
    setMembers((s) => s.map((m) => m.user_id === user_id ? { ...m, role } : m));
    const res = await fetch(`/api/settings/users/${user_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? 'update failed');
    }
  }

  async function remove(user_id: string) {
    if (user_id === currentUserId) {
      alert("You can't remove yourself from this tenant. Ask a platform admin or another editor.");
      return;
    }
    if (!confirm('Remove this user from the tenant? Their profile and other-tenant memberships are unaffected.')) return;
    setMembers((s) => s.filter((m) => m.user_id !== user_id));
    await fetch(`/api/settings/users/${user_id}`, { method: 'DELETE' });
  }

  return (
    <>
      {acceptUrl && (
        <div className="banner success" style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 18px', marginBottom: 18 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Invite issued — copy this URL</div>
            <div style={{ fontSize: 11, color: 'var(--text-mid)', marginBottom: 8 }}>
              Send this one-time link to the invitee. It expires in 14 days.
            </div>
            <input readOnly value={acceptUrl} onFocus={(e) => e.target.select()} style={{
              width: '100%', padding: '8px 10px',
              background: 'var(--bg-mid)', border: '1px solid var(--bg-border)',
              color: 'var(--text)', fontFamily: 'Inter, sans-serif', fontSize: 11, borderRadius: 6,
            }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button className="action-btn primary" onClick={() => {
              navigator.clipboard.writeText(acceptUrl).catch(() => alert('Clipboard write failed; copy manually.'));
            }}>Copy URL</button>
            <button className="action-btn" onClick={() => setAcceptUrl(null)}>Dismiss</button>
          </div>
        </div>
      )}

      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Users — {tenantName}</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              {members.length} member{members.length === 1 ? '' : 's'} · {invites.length} pending invite{invites.length === 1 ? '' : 's'}
              {isPlatformAdmin && <span> · you are a platform admin</span>}
            </div>
          </div>
          <button className="action-btn primary" onClick={() => setOpenInvite((v) => !v)}>
            {openInvite ? 'Cancel' : '+ Invite User'}
          </button>
        </div>

        {openInvite && <InviteForm onSubmit={invite} onCancel={() => setOpenInvite(false)} />}

        <table className="score-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>User</th>
              <th>Status</th>
              <th>Role</th>
              <th>Last login</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && (
              <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0' }}>
                No tenant members yet. Click <strong>+ Invite User</strong> to add the first.
              </td></tr>
            )}
            {members.map((m) => {
              const u = m.user;
              if (!u) return null;
              return (
                <tr key={m.user_id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{u.display_name || u.email}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-mid)' }}>
                      {u.email}
                      {u.is_platform_admin && (
                        <span style={{
                          marginLeft: 8, fontSize: 9, fontWeight: 700, padding: '1px 6px',
                          borderRadius: 999, background: 'var(--gold-pale)', color: 'var(--gold-light)',
                          textTransform: 'uppercase', letterSpacing: '.06em',
                        }}>Platform admin</span>
                      )}
                    </div>
                  </td>
                  <td><StatusPill status={u.status} /></td>
                  <td>
                    <select className="score-select" value={m.role}
                      onChange={(e) => changeRole(m.user_id, e.target.value as 'editor' | 'viewer')}>
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                    </select>
                  </td>
                  <td style={{ fontSize: 11, color: 'var(--text-mid)' }}>
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'}
                  </td>
                  <td>
                    <button className="action-btn danger"
                      disabled={m.user_id === currentUserId}
                      onClick={() => remove(m.user_id)}>
                      {m.user_id === currentUserId ? 'You' : 'Remove'}
                    </button>
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
              <div className="scorecard-tag" style={{ marginTop: 4 }}>Awaiting first login. Tokens expire 14 days after issuance.</div>
            </div>
          </div>
          <table className="score-table">
            <thead>
              <tr><th>Email</th><th>Role</th><th>Expires</th><th>Issued</th></tr>
            </thead>
            <tbody>
              {invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.email}</td>
                  <td>{i.role}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-mid)' }}>{new Date(i.expires_at).toLocaleDateString()}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-mid)' }}>{new Date(i.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}

function StatusPill({ status }: { status: 'active' | 'disabled' | 'invited' }) {
  const color = status === 'active' ? '#10B981' : status === 'invited' ? '#F59E0B' : '#94A3B8';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px',
      background: `${color}1a`, color, border: `1px solid ${color}55`,
      borderRadius: 999, fontSize: 11, fontWeight: 600, letterSpacing: '0.04em',
    }}>{status}</span>
  );
}

function InviteForm({
  onSubmit, onCancel,
}: { onSubmit: (payload: { email: string; role: 'editor' | 'viewer'; display_name?: string }) => void; onCancel: () => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('viewer');

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (email.includes('@')) onSubmit({ email: email.trim(), role, display_name: displayName.trim() || undefined }); }}
      style={{
        marginTop: 12, padding: 14, background: 'var(--bg-card)',
        border: '1px solid var(--bg-border)', borderRadius: 'var(--r-md)',
        display: 'grid', gridTemplateColumns: '2fr 2fr 1fr auto auto', gap: 10, alignItems: 'end',
      }}
    >
      <Field label="Email (required)">
        <input className="score-select" type="email" required autoFocus
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
      </Field>
      <Field label="Display name (optional)">
        <input className="score-select" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Name" />
      </Field>
      <Field label="Role">
        <select className="score-select" value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}>
          <option value="viewer">Viewer</option>
          <option value="editor">Editor</option>
        </select>
      </Field>
      <button type="submit" className="action-btn primary" disabled={!email.includes('@')}>Issue invite</button>
      <button type="button" className="action-btn" onClick={onCancel}>Cancel</button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 11, color: 'var(--text-mid)', letterSpacing: '.02em' }}>
        {label}
      </label>
      {children}
    </div>
  );
}
