'use client';

import { useState } from 'react';
import type { CurrentUser } from '@/lib/auth';

/**
 * /my-tenants UI. Each row renders a tenant card with an "Open" button that:
 *   1. POSTs to /api/hub/sso/issue with the tenant_id.
 *   2. Receives a one-time SSO redirect URL pointing at caw-<slug>.vercel.app/auth/sso?token=…
 *   3. window.location.assign()s the browser to that URL.
 *   4. The tenant-side /auth/sso handler exchanges the token for a session
 *      cookie scoped to that subdomain and redirects to /.
 *
 * The user never sees the SSO token itself — the round-trip happens in two
 * navigations, and the cookie set on the tenant origin is the durable
 * authentication state going forward.
 */

interface TenantRow {
  id: string;
  slug: string;
  display_name: string;
  hostname: string | null;
  primary_color: string | null;
  logo_url: string | null;
  role: 'editor' | 'viewer' | 'admin' | null;
}

export default function MyTenantsClient({
  user,
  tenants,
}: {
  user: CurrentUser;
  tenants: TenantRow[];
}) {
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(tenant: TenantRow) {
    setOpeningId(tenant.id);
    setError(null);
    try {
      const res = await fetch('/api/hub/sso/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenant.id }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setError(j.error ?? `HTTP ${res.status}`);
        setOpeningId(null);
        return;
      }
      // Hand control to the browser — full navigation so the tenant
      // deploy's /auth/sso handler runs server-side and the Set-Cookie
      // response is committed before any client JS executes.
      window.location.assign(j.redirect_url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'sso failed');
      setOpeningId(null);
    }
  }

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: 'var(--text)' }}>
          Your tenants
        </h1>
        <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-mid)' }}>
          Signed in as <strong style={{ color: 'var(--text)' }}>{user.user.display_name || user.user.email}</strong>
          {user.user.is_platform_admin && (
            <span style={{
              marginLeft: 8, fontSize: 10, fontWeight: 700, padding: '2px 8px',
              borderRadius: 999, background: 'var(--gold-pale)',
              color: 'var(--gold-light)', letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}>Platform Admin</span>
          )}
        </div>
      </div>

      {error && (
        <div className="banner error" style={{ marginBottom: 18, padding: '12px 14px' }}>
          {error}
        </div>
      )}

      {user.user.is_platform_admin && (
        <div className="banner" style={{
          marginBottom: 18, padding: '10px 14px', fontSize: 12,
          background: 'var(--gold-pale)', border: '1px solid var(--gold-border)', borderRadius: 8,
        }}>
          You can also reach the cross-tenant <a href="/hub" style={{ fontWeight: 600 }}>Portfolio Hub</a>
          {' '}or <a href="/admin/users" style={{ fontWeight: 600 }}>platform user administration</a> directly.
        </div>
      )}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 14,
      }}>
        {tenants.map((t) => {
          const accent = t.primary_color || 'var(--gold)';
          const opening = openingId === t.id;
          return (
            <div key={t.id} style={{
              background: 'var(--bg-mid)', border: '1px solid var(--bg-border)',
              borderRadius: 10, boxShadow: 'var(--shadow-sm)',
              padding: 18, display: 'flex', flexDirection: 'column', gap: 10,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {t.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={t.logo_url}
                    alt={t.display_name}
                    style={{ width: 40, height: 40, objectFit: 'contain', borderRadius: 6 }}
                  />
                ) : (
                  <div style={{
                    width: 40, height: 40, borderRadius: 6,
                    background: `${accent}1a`, border: `1px solid ${accent}55`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 16, color: accent,
                  }}>{t.display_name.slice(0, 2).toUpperCase()}</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontWeight: 600, fontSize: 15, color: 'var(--text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{t.display_name}</div>
                  <div style={{
                    fontSize: 11, color: 'var(--text-mid)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{t.hostname ?? `caw-${t.slug}.vercel.app`}</div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{
                  fontSize: 11, fontWeight: 600,
                  padding: '3px 8px', borderRadius: 999,
                  background: 'var(--bg-card)', color: 'var(--text-mid)',
                  border: '1px solid var(--bg-border)',
                  textTransform: 'capitalize',
                }}>
                  {user.user.is_platform_admin
                    ? 'platform admin'
                    : (t.role ?? 'no role')}
                </span>
                <button
                  className="action-btn primary"
                  onClick={() => open(t)}
                  disabled={opening}
                  style={{ minWidth: 80 }}
                >
                  {opening ? 'Opening…' : 'Open →'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
