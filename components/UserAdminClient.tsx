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
  role: 'editor' | 'viewer' | 'admin';
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
  role: 'editor' | 'viewer' | 'admin' | null;
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
  const [tempPasswordBanner, setTempPasswordBanner] = useState<{
    email: string; password: string; emailSent: boolean;
  } | null>(null);
  const [resetLinkBanner, setResetLinkBanner] = useState<{
    email: string; url: string; emailSent: boolean;
  } | null>(null);
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
    role?: 'editor' | 'viewer' | 'admin';
  }) {
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) { alert(j.error ?? 'invite failed'); return; }

    // The temp-password invite flow returns the shape:
    //   { ok, email, user_id, role, temp_password, sign_in_url, email_sent }
    // The previous link-based invite flow returned:
    //   { ok, invite: { id, email, tenant_id, role, … }, accept_url, accept_url_path }
    // Reading j.invite.id under the new shape threw the "Cannot read
    // properties of undefined (reading 'id')" crash that surfaced in
    // user testing. Now we surface the temp password in a banner and
    // optimistically refresh the user list — the invitee is created
    // immediately as an active profile + membership, not as a pending
    // invite. Pending-invite rows only show up for forgot-password /
    // email-link resets, which is the correct place for them.
    setTempPasswordBanner({
      email: j.email,
      password: j.temp_password,
      emailSent: !!j.email_sent,
    });
    setOpenInvite(false);
    void refreshUserList();
  }

  /**
   * Re-fetch the platform-wide user + membership data after an invite
   * lands, so the new user appears in the table without a hard refresh.
   * Best-effort — if the fetch fails we leave the in-memory list alone.
   */
  async function refreshUserList() {
    try {
      const res = await fetch('/api/admin/users', { cache: 'no-store' });
      if (!res.ok) return;
      const j = await res.json();
      if (Array.isArray(j.users)) setUserList(j.users as AdminProfile[]);
      if (Array.isArray(j.memberships)) setMemList(j.memberships as AdminMembership[]);
      if (Array.isArray(j.pending_invites)) setInvites(j.pending_invites as AdminInvite[]);
    } catch {
      /* noop — the new user will appear on next page load */
    }
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

  async function addMembership(user: AdminProfile, tenant_id: string, role: 'editor' | 'viewer' | 'admin') {
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

  async function deletePermanently(user: AdminProfile) {
    if (user.id === currentUserId) {
      alert("You can't delete your own account.");
      return;
    }
    // Two-confirm gate: hard delete is irreversible, so we want a
    // deliberate pause + verbatim-name typing for the most destructive
    // path. The first confirm is the standard "are you sure" check; the
    // second prompts the admin to type the email to prove they meant it.
    if (!confirm(
      `PERMANENTLY DELETE ${user.email}?\n\n` +
      `This removes the profile row entirely and clears the user from ` +
      `all memberships and active sessions. Audit history is preserved ` +
      `(the user pointer becomes null) but cannot be undone.`,
    )) return;
    const typed = prompt(`Type the user's email to confirm: ${user.email}`);
    if (typed?.trim().toLowerCase() !== user.email.toLowerCase()) {
      alert('Email did not match. Deletion cancelled.');
      return;
    }
    const res = await fetch(`/api/admin/users/${user.id}/permanent`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? 'delete failed');
      return;
    }
    // Drop the user from every piece of local state. Memberships for
    // that user CASCADE on the server side, so we mirror by removing
    // them from memList here too.
    setUserList((s) => s.filter((u) => u.id !== user.id));
    setMemList((s) => s.filter((m) => m.user_id !== user.id));
  }

  async function removeMembership(user_id: string, tenant_id: string) {
    setMemList((s) => s.filter((m) => !(m.user_id === user_id && m.tenant_id === tenant_id)));
    await fetch(`/api/admin/users/${user_id}/memberships?tenant_id=${encodeURIComponent(tenant_id)}`,
      { method: 'DELETE' });
  }

  async function revokeInvite(invite_id: string) {
    // Optimistic: drop from local state immediately so the row doesn't sit
    // there with a "revoking…" spinner. Re-add on failure.
    const previous = invites;
    setInvites((s) => s.filter((i) => i.id !== invite_id));
    const res = await fetch(`/api/admin/invites/${invite_id}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(j.error ?? 'revoke failed');
      setInvites(previous);
    }
  }

  async function resetPassword(user: AdminProfile, method: 'temp_password' | 'email_link') {
    const verb = method === 'temp_password'
      ? `Generate a new temporary password for ${user.email}? Their current password (if any) will stop working and every active session will be revoked.`
      : `Send a password-reset email to ${user.email}? Their current password will be cleared and they'll need to use the link in the email to set a new one.`;
    if (!confirm(verb)) return;
    const res = await fetch(`/api/admin/users/${user.id}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method }),
    });
    const j = await res.json();
    if (!res.ok || !j.ok) { alert(j.error ?? 'reset failed'); return; }
    if (method === 'temp_password') {
      setTempPasswordBanner({
        email: j.email,
        password: j.temp_password,
        emailSent: !!j.email_sent,
      });
    } else {
      setResetLinkBanner({
        email: j.email,
        url: j.reset_url,
        emailSent: !!j.email_sent,
      });
    }
  }

  // -- Render --------------------------------------------------------------

  return (
    <>
      {acceptUrl && (
        <AcceptUrlBanner url={acceptUrl} onDismiss={() => setAcceptUrl(null)} />
      )}

      {tempPasswordBanner && (
        <TempPasswordBanner
          email={tempPasswordBanner.email}
          password={tempPasswordBanner.password}
          emailSent={tempPasswordBanner.emailSent}
          onDismiss={() => setTempPasswordBanner(null)}
        />
      )}

      {resetLinkBanner && (
        <ResetLinkBanner
          email={resetLinkBanner.email}
          url={resetLinkBanner.url}
          emailSent={resetLinkBanner.emailSent}
          onDismiss={() => setResetLinkBanner(null)}
        />
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                      {u.status === 'disabled' ? (
                        <>
                          <button className="action-btn" onClick={() => setStatus(u, 'active')}>Re-enable</button>
                          <button
                            className="action-btn danger"
                            style={{ fontSize: 11 }}
                            title="Permanently remove this user. Audit history is preserved with the user pointer set to null."
                            onClick={() => deletePermanently(u)}
                          >Delete permanently</button>
                        </>
                      ) : u.id === currentUserId ? (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(you)</span>
                      ) : (
                        <>
                          <button
                            className="action-btn"
                            title="Generate a fresh temporary password and force change on next login"
                            onClick={() => resetPassword(u, 'temp_password')}
                          >Reset password</button>
                          <button
                            className="action-btn"
                            title="Email this user a password-reset link"
                            onClick={() => resetPassword(u, 'email_link')}
                            style={{ fontSize: 11 }}
                          >Send reset email</button>
                          <button
                            className="action-btn danger"
                            onClick={() => setStatus(u, 'disabled')}
                            style={{ fontSize: 11 }}
                          >Disable</button>
                        </>
                      )}
                    </div>
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
                <th></th>
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
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="action-btn danger"
                      title="Revoke this invite so the accept-invite link stops working"
                      onClick={() => {
                        if (confirm(`Revoke pending invite for ${i.email}? The accept-invite link will stop working.`)) {
                          revokeInvite(i.id);
                        }
                      }}
                    >Revoke</button>
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

function TempPasswordBanner({ email, password, emailSent, onDismiss }: {
  email: string; password: string; emailSent: boolean; onDismiss: () => void;
}) {
  return (
    <div className="banner success" style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '16px 18px', marginBottom: 18,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
          New temporary password for {email}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-mid)', marginBottom: 8 }}>
          {emailSent
            ? 'We also emailed these credentials to the user. They\'ll be forced to set a new password on their next sign-in.'
            : 'Email service is not configured — read this password to the user directly. They\'ll be forced to set a new password on their next sign-in.'}
        </div>
        <input
          readOnly
          value={password}
          onFocus={(e) => e.target.select()}
          style={{
            width: '100%', padding: '8px 10px',
            background: 'var(--bg-mid)', border: '1px solid var(--bg-border)',
            color: 'var(--text)', fontFamily: 'Inter, sans-serif', fontVariantNumeric: 'tabular-nums',
            fontSize: 13, fontWeight: 600, letterSpacing: '0.02em',
            borderRadius: 6,
          }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button className="action-btn primary" onClick={() => {
          navigator.clipboard.writeText(password)
            .then(() => { /* good */ })
            .catch(() => alert('Clipboard write failed; copy the password manually.'));
        }}>Copy</button>
        <button className="action-btn" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
}

function ResetLinkBanner({ email, url, emailSent, onDismiss }: {
  email: string; url: string; emailSent: boolean; onDismiss: () => void;
}) {
  return (
    <div className="banner success" style={{
      display: 'flex', alignItems: 'flex-start', gap: 12,
      padding: '16px 18px', marginBottom: 18,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
          Password-reset email queued for {email}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-mid)', marginBottom: 8 }}>
          {emailSent
            ? 'We sent a reset link to the user. Their old password is cleared; they must use the link to set a new one. The URL below is the same one we emailed — copy if needed as a fallback.'
            : 'Email service is not configured — copy the URL below and send it to the user manually. Their old password is already cleared.'}
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
          navigator.clipboard.writeText(url)
            .then(() => { /* good */ })
            .catch(() => alert('Clipboard write failed; copy the URL manually.'));
        }}>Copy URL</button>
        <button className="action-btn" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  );
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

type AccessLevel = 'global_admin' | 'tenant_admin' | 'tenant_viewer';

function InviteForm({
  tenants, onSubmit, onCancel,
}: {
  tenants: AdminTenant[];
  onSubmit: (payload: { email: string; display_name?: string; grant_platform_admin: boolean; tenant_id?: string | null; role?: 'editor' | 'viewer' | 'admin' }) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  // Three explicit access levels — picked at invite time, no implicit
  // elevation. Tenant admin = edit access on a single tenant; Tenant
  // viewer = read-only on a single tenant; Global admin = edit everywhere.
  const [level, setLevel] = useState<AccessLevel>('tenant_viewer');
  const [tenantId, setTenantId] = useState('');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes('@')) return;
    if ((level === 'tenant_admin' || level === 'tenant_viewer') && !tenantId) {
      alert('Pick a tenant for this user.');
      return;
    }
    onSubmit({
      email: email.trim(),
      display_name: displayName.trim() || undefined,
      grant_platform_admin: level === 'global_admin',
      tenant_id: level === 'global_admin' ? null : (tenantId || null),
      role: level === 'tenant_admin' ? 'admin'
          : level === 'tenant_viewer' ? 'viewer'
          : undefined,
    });
  }

  return (
    <form onSubmit={submit} style={{
      marginTop: 12, padding: 14,
      background: 'var(--bg-card)', border: '1px solid var(--bg-border)',
      borderRadius: 'var(--r-md)',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Email (required)">
          <input className="score-select" type="email" required autoFocus
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com" />
        </Field>
        <Field label="Display name (optional)">
          <input className="score-select"
            value={displayName} onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Name" />
        </Field>
      </div>

      <Field label="Access level" hint="Pick how much access this user gets. The choice determines whether you also need to pick a tenant below.">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AccessRadio
            level="global_admin"
            current={level}
            onSelect={setLevel}
            title="Global admin"
            sub="Edits every tenant. Sees everything. The MSP role."
          />
          <AccessRadio
            level="tenant_admin"
            current={level}
            onSelect={setLevel}
            title="Tenant admin"
            sub="Edits one tenant's data. No access to other tenants."
          />
          <AccessRadio
            level="tenant_viewer"
            current={level}
            onSelect={setLevel}
            title="Tenant viewer"
            sub="Read-only access to one tenant's data. Most common."
          />
        </div>
      </Field>

      {(level === 'tenant_admin' || level === 'tenant_viewer') && (
        <Field label="Tenant" hint="Which tenant this user gets access to.">
          <select className="score-select" required
            value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            <option value="">— select a tenant —</option>
            {tenants.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
          </select>
        </Field>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="action-btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="action-btn primary" disabled={!email.includes('@')}>Issue invite</button>
      </div>
    </form>
  );
}

function AccessRadio({ level, current, onSelect, title, sub }: {
  level: AccessLevel; current: AccessLevel;
  onSelect: (l: AccessLevel) => void;
  title: string; sub: string;
}) {
  const active = level === current;
  return (
    <label style={{
      display: 'flex', alignItems: 'flex-start', gap: 10,
      padding: '10px 12px',
      background: active ? 'var(--gold-pale)' : 'var(--bg-mid)',
      border: `1px solid ${active ? 'var(--gold)' : 'var(--bg-border)'}`,
      borderRadius: 'var(--r-md)',
      cursor: 'pointer',
    }}>
      <input
        type="radio"
        checked={active}
        onChange={() => onSelect(level)}
        style={{ marginTop: 2 }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{
          fontWeight: 600, fontSize: 13,
          color: active ? 'var(--gold-light)' : 'var(--text)',
        }}>{title}</span>
        <span style={{ fontSize: 11, color: 'var(--text-mid)' }}>{sub}</span>
      </div>
    </label>
  );
}

function MembershipsCell({
  user, memberships, tenantsById, allTenants, onAdd, onRemove,
}: {
  user: AdminProfile;
  memberships: AdminMembership[];
  tenantsById: Record<string, AdminTenant>;
  allTenants: AdminTenant[];
  onAdd: (tenant_id: string, role: 'editor' | 'viewer' | 'admin') => void;
  onRemove: (tenant_id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tid, setTid] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer' | 'admin'>('viewer');

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
          <Pill color={m.role === 'admin' ? '#1E40AF' : m.role === 'editor' ? '#2563EB' : '#64748B'} style={{ fontSize: 10 }}>{m.role}</Pill>
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
          <select className="score-select" value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer' | 'admin')} style={{ fontSize: 11 }}
            title="Tenant admin can edit THIS tenant. Viewer is read-only on this tenant. (Legacy editor role is treated as viewer.)">
            <option value="viewer">viewer (read-only)</option>
            <option value="admin">admin (edits this tenant)</option>
            <option value="editor">editor (legacy, read-only)</option>
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
