'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Accept-invite page. Reads ?token=…, validates server-side against the
 * user_invites table, then prompts for a password (and an optional display
 * name). On submit it calls /api/auth/accept-invite which:
 *   - hashes the password and stores it on the profile row
 *   - applies platform-admin / tenant-membership grants the invite carried
 *   - marks the invite consumed
 *   - starts a session and sets the cookie
 *
 * Then the page hard-navigates to / so server components see the new session.
 */
export default function AcceptInvitePage() {
  const params = useSearchParams();
  const token = params.get('token') ?? '';

  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [grants, setGrants] = useState<{ platform_admin: boolean; tenant_id: string | null; role: string | null } | null>(null);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!token) { setStatus('invalid'); return; }
      try {
        const res = await fetch(`/api/auth/accept-invite?token=${encodeURIComponent(token)}`);
        const j = await res.json();
        if (cancelled) return;
        if (!res.ok || !j.ok) {
          setError(j.error ?? 'invalid invite');
          setStatus('invalid');
        } else {
          setEmail(j.email);
          setGrants(j.grants);
          setStatus('valid');
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'network error');
        setStatus('invalid');
      }
    }
    check();
    return () => { cancelled = true; };
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 12) { setError('Password must be at least 12 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, display_name: displayName.trim() || undefined }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setError(j.error ?? 'invite acceptance failed');
        setBusy(false);
        return;
      }
      window.location.href = j.redirect ?? '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network error');
      setBusy(false);
    }
  }

  if (status === 'loading') {
    return (
      <main className="signin-page">
        <div className="signin-card">
          <p className="signin-sub" style={{ textAlign: 'center', margin: 0 }}>Validating invite…</p>
        </div>
      </main>
    );
  }

  if (status === 'invalid') {
    return (
      <main className="signin-page">
        <div className="signin-card">
          <h1 className="signin-title">Invite link invalid</h1>
          <p className="signin-sub">
            This invitation has expired, been revoked, or already been used.
            Ask your administrator to issue a new one.
          </p>
          {error && <p className="signin-error">{error}</p>}
          <a href="/auth/signin" className="signin-btn" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 12 }}>
            Go to sign-in
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="signin-page">
      <div className="signin-card">
        <h1 className="signin-title">Welcome — set your password</h1>
        <p className="signin-sub">
          Account: <strong>{email}</strong>
        </p>
        {grants && (
          <p className="signin-sub" style={{ marginTop: -8 }}>
            {grants.platform_admin && <span>Platform administrator · </span>}
            {grants.role && <span>Tenant role: <strong>{grants.role}</strong></span>}
          </p>
        )}

        <form onSubmit={submit}>
          <Field label="Display name (optional)">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
              style={inputStyle}
            />
          </Field>
          <Field label="New password (12+ characters)" style={{ marginTop: 12 }}>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              autoFocus
              style={inputStyle}
            />
          </Field>
          <Field label="Confirm password" style={{ marginTop: 12 }}>
            <input
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              style={inputStyle}
            />
          </Field>
          <button type="submit" disabled={busy} className="signin-btn" style={{ marginTop: 16 }}>
            {busy ? 'Activating…' : 'Set password and sign in'}
          </button>
        </form>
        {error && <p className="signin-error">{error}</p>}
      </div>
    </main>
  );
}

function Field({ label, children, style }: { label: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...style }}>
      <label style={{ fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 11, color: 'var(--text-mid)', letterSpacing: '.02em' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: 'var(--bg-deep)',
  border: '1px solid var(--bg-border)',
  color: 'var(--text)',
  fontFamily: 'Inter, sans-serif',
  fontSize: 13,
  borderRadius: 6,
};
