'use client';

import { useState } from 'react';

/**
 * Forced password change form. Lives on /auth/change-password and is
 * always reachable for a signed-in user; the server component on that page
 * gates whether to render us (only when password_must_change is true).
 *
 * Two notable differences from the regular /settings/me change form:
 *   1. We collect current_password = the temp password from the invite
 *      email, so the API can still verify identity against the hash.
 *   2. After a successful change we do a hard navigation to `nextUrl` so
 *      every server component re-reads the session cookie and the
 *      password_must_change flag is freshly cleared everywhere.
 */
export default function ChangePasswordForcedClient({
  email, nextUrl,
}: { email: string; nextUrl: string }) {
  const [tempPassword, setTempPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    tempPassword.length > 0 &&
    newPassword.length >= 12 &&
    newPassword === confirmPassword &&
    newPassword !== tempPassword;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_password: tempPassword,
          new_password: newPassword,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setError(j.error ?? 'password change failed');
        setBusy(false);
        return;
      }
      // Hard navigation so server components re-read profiles.password_must_change.
      window.location.href = nextUrl || '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network error');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Field label="Account email">
        <input
          type="email"
          value={email}
          disabled
          style={{ ...inputStyle, color: 'var(--text-mid)', background: 'var(--gold-pale)' }}
        />
      </Field>
      <Field label="Temporary password (from invite email)" style={{ marginTop: 12 }}>
        <input
          type="password"
          required
          autoFocus
          value={tempPassword}
          onChange={(e) => setTempPassword(e.target.value)}
          autoComplete="current-password"
          style={inputStyle}
        />
      </Field>
      <Field label="New password" style={{ marginTop: 12 }}>
        <input
          type="password"
          required
          minLength={12}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="At least 12 characters"
          autoComplete="new-password"
          style={inputStyle}
        />
      </Field>
      <Field label="Confirm new password" style={{ marginTop: 12 }}>
        <input
          type="password"
          required
          minLength={12}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          style={inputStyle}
        />
      </Field>

      {newPassword.length > 0 && newPassword.length < 12 && (
        <p style={{ marginTop: 8, fontSize: 11, color: 'var(--red-text)' }}>
          New password must be at least 12 characters.
        </p>
      )}
      {confirmPassword.length > 0 && newPassword !== confirmPassword && (
        <p style={{ marginTop: 8, fontSize: 11, color: 'var(--red-text)' }}>
          Passwords don&apos;t match.
        </p>
      )}
      {newPassword.length > 0 && newPassword === tempPassword && (
        <p style={{ marginTop: 8, fontSize: 11, color: 'var(--red-text)' }}>
          New password must differ from the temporary one.
        </p>
      )}

      <button type="submit" disabled={!valid || busy} className="signin-btn" style={{ marginTop: 16 }}>
        {busy ? 'Saving…' : 'Set new password and continue'}
      </button>

      {error && <p className="signin-error">{error}</p>}

      <p style={{
        marginTop: 14, fontSize: 11, color: 'var(--text-muted)',
        textAlign: 'center', lineHeight: 1.5,
      }}>
        We&apos;ll sign you out of any other devices when you save. Your current
        sign-in stays active.
      </p>
    </form>
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
