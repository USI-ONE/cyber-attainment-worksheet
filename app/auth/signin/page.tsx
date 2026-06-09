'use client';

import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';

/**
 * Standalone email + password sign-in. No Microsoft, no magic-link, no
 * external service. Calls /api/auth/login which sets the session cookie
 * via lib/auth#createSessionForUser.
 *
 * Future SSO additions (OIDC/SAML) drop in as additional buttons under the
 * email form without disturbing this flow.
 */
export default function SignInPage() {
  const params = useSearchParams();
  const router = useRouter();
  const redirectTo = params.get('redirect') || '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, redirect: redirectTo }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setError(j.error ?? 'sign-in failed');
        setBusy(false);
        return;
      }
      // Use a hard navigation so server components re-read the session cookie.
      window.location.href = j.redirect ?? redirectTo;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network error');
      setBusy(false);
    }
  }

  return (
    <main className="signin-page">
      <div className="signin-card">
        <h1 className="signin-title">SecureOS</h1>
        <p className="signin-sub">Sign in with your email and password.</p>

        <form onSubmit={submit}>
          <Field label="Email">
            <input
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@yourcompany.com"
              style={inputStyle}
            />
          </Field>
          <Field label="Password" style={{ marginTop: 12 }}>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder=""
              autoComplete="current-password"
              style={inputStyle}
            />
          </Field>
          <button type="submit" disabled={busy || !email || !password} className="signin-btn" style={{ marginTop: 16 }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {error && <p className="signin-error">{error}</p>}

        <p style={{ marginTop: 14, textAlign: 'center' }}>
          <a href="/auth/forgot-password" style={{
            fontSize: 12, color: 'var(--gold-light)', textDecoration: 'none',
          }}>
            Forgot your password?
          </a>
        </p>

        <p style={{
          marginTop: 14, fontSize: 11, color: 'var(--text-muted)',
          textAlign: 'center', lineHeight: 1.5,
        }}>
          New users receive a one-time invite link from their administrator.
        </p>

        {/* SSO additions (Microsoft Entra, Google Workspace, generic OIDC)
            will land here as additional buttons under this divider once
            configured. The email+password flow above is the always-on
            fallback. */}
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
