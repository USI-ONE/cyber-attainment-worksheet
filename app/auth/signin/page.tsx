'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function SignInPage() {
  const params = useSearchParams();
  const redirectTo = params.get('redirect') || '/';
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <main className="signin-page">
      <div className="signin-card">
        <h1 className="signin-title">Cyber Attainment Worksheet</h1>
        <p className="signin-sub">Sign in with your Microsoft account to continue.</p>
        <button onClick={signInWithAzure} disabled={busy} className="signin-btn">
          {busy ? 'Redirecting…' : 'Sign in with Microsoft'}
        </button>
        {error && <p className="signin-error">{error}</p>}
      </div>
    </main>
  );
}
