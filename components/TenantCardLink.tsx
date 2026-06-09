'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';

/**
 * Click-through wrapper for Portfolio Hub tenant cards.
 *
 * Replaces the bare <a href={tenant.url}> the hub used to render with an
 * anchor that, on click, requests an SSO token from /api/hub/sso/issue
 * and navigates to the signed URL. The end result: a hub user (typically
 * platform admin) clicks a card and lands inside that tenant deploy
 * already authenticated, instead of seeing the tenant's sign-in page.
 *
 * The href is still set to the tenant URL so:
 *   - middle-click / open-in-new-tab still works (without SSO; user will
 *     see the tenant's sign-in page, which is acceptable degradation)
 *   - right-click "Copy link" gives a usable URL
 *   - the card has correct keyboard semantics and screen-reader exposure
 *
 * Errors fall through to the bare URL navigation, so a 60-second SSO
 * window or network blip never leaves the user stranded on the hub.
 */
export default function TenantCardLink({
  tenantId,
  fallbackUrl,
  className,
  style,
  children,
}: {
  tenantId: string;
  fallbackUrl: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const [busy, setBusy] = useState(false);

  async function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    // Honor browser conventions: ctrl/cmd/shift/middle-click should
    // open the bare URL in a new tab without SSO. Only intercept the
    // primary plain left-click.
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/hub/sso/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenant_id: tenantId }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.redirect_url) {
        window.location.assign(j.redirect_url);
        return;
      }
      // Fall back to the raw URL — user will hit the tenant's sign-in
      // and can authenticate there. Better than getting stuck on the hub.
      window.location.assign(fallbackUrl);
    } catch {
      window.location.assign(fallbackUrl);
    }
  }

  return (
    <a
      href={fallbackUrl}
      onClick={handleClick}
      className={className}
      style={{
        ...style,
        textDecoration: 'none',
        color: 'inherit',
        cursor: busy ? 'progress' : 'pointer',
        opacity: busy ? 0.85 : 1,
      }}
      aria-busy={busy ? true : undefined}
    >
      {children}
    </a>
  );
}
