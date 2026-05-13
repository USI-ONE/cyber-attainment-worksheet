'use client';

import { useState } from 'react';

/**
 * My Account — self-service settings. Today: change-password.
 *
 * The password form posts to /api/me/password which verifies the current
 * password, writes a new scrypt hash, and revokes every OTHER active
 * session for the user. The current session stays alive so a successful
 * change keeps the user signed in.
 *
 * Empty-state hint covers users whose account was admin-created and who
 * have never gone through accept-invite — they need an invite link, not
 * this form.
 */
export default function MyAccountClient({
  email, displayName, isPlatformAdmin, membershipCount, lastLoginAt,
}: {
  email: string;
  displayName: string | null;
  isPlatformAdmin: boolean;
  membershipCount: number;
  lastLoginAt: string | null;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 12) {
      setError('New password must be at least 12 characters.');
      return;
    }
    if (next !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    if (next === current) {
      setError('New password must differ from your current one.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/me/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setError(j.error ?? `update failed (${res.status})`);
      } else {
        setSuccess(true);
        setCurrent('');
        setNext('');
        setConfirm('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">My Account</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Self-service settings for the signed-in user
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <Field label="Email">
            <div style={{ fontSize: 13, color: 'var(--text)' }}>{email}</div>
          </Field>
          <Field label="Display name">
            <div style={{ fontSize: 13, color: 'var(--text)' }}>
              {displayName?.trim() || <span style={{ color: 'var(--text-muted)' }}>—</span>}
            </div>
          </Field>
          <Field label="Last sign-in">
            <div style={{ fontSize: 12, color: 'var(--text-mid)' }}>
              {lastLoginAt ? new Date(lastLoginAt).toLocaleString() : '—'}
            </div>
          </Field>
          <Field label="Access">
            <div style={{ fontSize: 12, color: 'var(--text-mid)' }}>
              {isPlatformAdmin && (
                <span style={{
                  display: 'inline-block', marginRight: 8,
                  padding: '1px 8px', borderRadius: 999,
                  background: 'var(--gold-pale)', color: 'var(--gold-light)',
                  border: '1px solid var(--gold-border)',
                  fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
                }}>Platform admin</span>
              )}
              {membershipCount === 0
                ? 'No tenant memberships'
                : `${membershipCount} tenant membership${membershipCount === 1 ? '' : 's'}`}
            </div>
          </Field>
        </div>
      </section>

      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Change Password</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              You stay signed in after the change. Every other active session
              for your account is revoked so a stolen browser tab can&apos;t
              keep its access.
            </div>
          </div>
        </div>

        <form onSubmit={submit} style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12,
          alignItems: 'end', maxWidth: 900,
        }}>
          <Field label="Current password">
            <input
              type="password"
              required
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="score-select"
              autoFocus
            />
          </Field>
          <Field label="New password (12+ characters)">
            <input
              type="password"
              required
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="score-select"
            />
          </Field>
          <Field label="Confirm new password">
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="score-select"
            />
          </Field>

          <div style={{ gridColumn: 'span 3', display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              type="submit"
              className="action-btn primary"
              disabled={busy || !current || !next || !confirm}
            >
              {busy ? 'Updating…' : 'Update password'}
            </button>
            {success && (
              <span style={{
                fontSize: 12, color: 'var(--green-text)',
                background: 'rgba(16,185,129,0.10)',
                border: '1px solid rgba(16,185,129,0.40)',
                padding: '4px 10px', borderRadius: 999,
              }}>
                Password updated. Other sessions revoked.
              </span>
            )}
            {error && (
              <span style={{
                fontSize: 12, color: 'var(--red-text)',
                background: 'rgba(220,38,38,0.08)',
                border: '1px solid rgba(220,38,38,0.40)',
                padding: '4px 10px', borderRadius: 999,
              }}>
                {error}
              </span>
            )}
          </div>
        </form>

        <p style={{ marginTop: 14, fontSize: 11, color: 'var(--text-muted)', maxWidth: 720 }}>
          If you forgot your current password, ask an administrator to issue
          you a fresh invite link from <code>/admin/users</code> (platform
          admins) or <code>/settings/users</code> (tenant editors). The
          invite revokes your old password and lets you set a new one.
        </p>
      </section>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{
        fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 11,
        color: 'var(--text-mid)', letterSpacing: '.02em',
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}
