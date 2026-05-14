'use client';

import { useState } from 'react';

/**
 * Forgot-password form.
 *
 * Posts to /api/auth/forgot-password, which always returns 200 regardless
 * of whether the email exists. That's a deliberate anti-enumeration
 * choice — the UI matches it by showing the same "check your inbox"
 * message in both cases.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      // The server always returns 200 with { ok: true } — don't reveal
      // whether the account exists. Show the same confirmation either way.
      if (!res.ok) {
        setError('Something went wrong. Try again in a moment.');
      } else {
        setSent(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network error');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <main className="signin-page">
        <div className="signin-card">
          <h1 className="signin-title">Check your inbox</h1>
          <p className="signin-sub">
            If <strong>{email}</strong> matches an account, we&apos;ve sent a
            password-reset link that expires in 14 days. Old sessions for
            that account are now revoked.
          </p>
          <p style={{ marginTop: 18, fontSize: 11, color: 'var(--text-muted)' }}>
            Didn&apos;t receive an email? Check spam, then ask an
            administrator to issue a fresh invite for you. We don&apos;t
            confirm whether an email is registered.
          </p>
          <a href="/auth/signin" className="signin-btn" style={{
            display: 'block', textAlign: 'center',
            textDecoration: 'none', marginTop: 14,
          }}>
            Back to sign in
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="signin-page">
      <div className="signin-card">
        <h1 className="signin-title">Reset your password</h1>
        <p className="signin-sub">
          Enter the email on your TrustOS account. We&apos;ll send a one-time
          link to set a new password.
        </p>

        <form onSubmit={submit}>
          <label style={{
            fontFamily: 'Inter, sans-serif', fontWeight: 600, fontSize: 11,
            color: 'var(--text-mid)', letterSpacing: '.02em',
          }}>Email</label>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@yourcompany.com"
            style={{
              width: '100%', marginTop: 4, padding: '10px 12px',
              background: 'var(--bg-deep)', border: '1px solid var(--bg-border)',
              color: 'var(--text)', fontFamily: 'Inter, sans-serif',
              fontSize: 13, borderRadius: 6,
            }}
          />
          <button type="submit" disabled={busy || !email} className="signin-btn" style={{ marginTop: 16 }}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>

        {error && <p className="signin-error">{error}</p>}

        <p style={{ marginTop: 14, textAlign: 'center' }}>
          <a href="/auth/signin" style={{ fontSize: 12, color: 'var(--text-mid)', textDecoration: 'none' }}>
            ← Back to sign in
          </a>
        </p>
      </div>
    </main>
  );
}
