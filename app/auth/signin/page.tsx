'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function SignInPage() {
  const params = useSearchParams();
  const redirectTo = params.get('redirect') || '/';
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  async function signInWithMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
      },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function signInWithAzure() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: {
        redirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(redirectTo)}`,
        scopes: 'openid email profile offline_access',
      },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <main className="signin-page">
        <div className="signin-card">
          <h1 className="signin-title">Check your email</h1>
          <p className="signin-sub">
            We sent a sign-in link to <strong>{email}</strong>. Click it to continue.
          </p>
          <button
            type="button"
            className="signin-btn"
            style={{ background: 'transparent', border: '1px solid var(--bg-border)', color: 'var(--text-mid)' }}
            onClick={() => { setSent(false); setEmail(''); }}
          >
            Use a different email
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="signin-page">
      <div className="signin-card">
        <h1 className="signin-title">Cyber Attainment Worksheet</h1>
        <p className="signin-sub">Enter your work email to receive a sign-in link.</p>
        <form onSubmit={signInWithMagicLink}>
          <input
            type="email"
            required
            autoFocus
            placeholder="you@yourcompany.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 12px',
              marginBottom: 12,
              background: 'var(--bg-deep)',
              border: '1px solid var(--bg-border)',
              color: 'var(--text)',
              fontFamily: 'Inter, sans-serif',
              fontSize: 13,
              borderRadius: 2,
            }}
          />
          <button type="submit" disabled={busy || !email} className="signin-btn">
            {busy ? 'Sending…' : 'Send sign-in link'}
          </button>
        </form>
        <button
          type="button"
          onClick={signInWithAzure}
          disabled={busy}
          className="signin-btn"
          style={{ marginTop: 10, background: 'transparent', border: '1px solid var(--gold-border)', color: 'var(--gold-light)' }}
        >
          Sign in with Microsoft
        </button>
        <p style={{ marginTop: 10, fontSize: 10, color: 'var(--text-muted)', letterSpacing: '.05em' }}>
          Microsoft sign-in requires Entra to be configured in Supabase. If it errors, use the email link.
        </p>
        {error && <p className="signin-error">{error}</p>}
      </div>
    </main>
  );
}
