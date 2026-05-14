/**
 * Email templates — invite, password reset, welcome.
 *
 * Pure functions returning { subject, html, text }. The HTML is inline-
 * styled because most email clients strip or sandbox external stylesheets,
 * and we don't have a brand image hosted yet. The text fallback is what
 * recipients on plain-text clients (most mobile defaults still try HTML;
 * spam filters often check that text exists at all) actually read.
 *
 * Keep the templates tight: a single CTA button, supporting context, no
 * imagery. Long-running professional emails read better than marketing-
 * style designs in transactional contexts.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface BrandPalette {
  productName: string;
  primary: string;
  primaryHover: string;
  body: string;
  muted: string;
  bgPanel: string;
  bgPage: string;
}

const BRAND: BrandPalette = {
  productName: 'TrustOS',
  primary:      '#2563EB',
  primaryHover: '#1E40AF',
  body:         '#0F172A',
  muted:        '#64748B',
  bgPanel:      '#FFFFFF',
  bgPage:       '#F5F7FB',
};

/** Top-and-bottom HTML chrome shared by every template. The `body` arg
 *  is the rendered card content. */
function shell({ preheader, body }: { preheader: string; body: string }): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${BRAND.productName}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bgPage};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.body};">
<span style="display:none;font-size:1px;color:${BRAND.bgPage};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preheader}</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.bgPage};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:${BRAND.bgPanel};border-radius:12px;box-shadow:0 1px 3px rgba(15,23,42,0.06);overflow:hidden;">
      <tr><td style="padding:24px 28px 8px;">
        <div style="font-family:'Oswald',sans-serif;font-weight:700;font-size:18px;letter-spacing:.06em;color:${BRAND.body};">
          ${BRAND.productName}
        </div>
        <div style="font-size:11px;color:${BRAND.muted};margin-top:2px;letter-spacing:.02em;">
          Cybersecurity &amp; compliance management
        </div>
      </td></tr>
      <tr><td style="padding:12px 28px 28px;color:${BRAND.body};font-size:14px;line-height:1.55;">
        ${body}
      </td></tr>
    </table>
    <div style="margin-top:14px;font-size:11px;color:${BRAND.muted};max-width:560px;line-height:1.5;">
      You're receiving this email because someone with administrator rights to a
      ${BRAND.productName} tenant invited you or because you initiated an account action.
      If this wasn't you, you can ignore this message and nothing will change.
    </div>
  </td></tr>
</table>
</body>
</html>`;
}

function button({ href, label }: { href: string; label: string }): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;">
    <tr><td style="background:${BRAND.primary};border-radius:8px;">
      <a href="${href}" style="display:inline-block;padding:11px 22px;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-weight:600;font-size:14px;color:#fff;text-decoration:none;">
        ${label}
      </a>
    </td></tr>
  </table>`;
}

function urlBlock(url: string): string {
  return `<div style="font-family:'JetBrains Mono','Courier New',monospace;font-size:11px;color:${BRAND.muted};background:${BRAND.bgPage};border:1px solid #E2E8F0;border-radius:6px;padding:10px 12px;margin:8px 0 18px;word-break:break-all;">
    ${url}
  </div>`;
}

// =============================================================================
// Invite — sent when an admin creates a user and issues an accept token
// =============================================================================

export function renderInviteEmail({
  inviteUrl, tenantName, role, isPlatformAdmin, inviterName,
}: {
  inviteUrl: string;
  /** "Universal Systems Inc." — null if the invite is platform-admin-only. */
  tenantName: string | null;
  /** "editor" / "viewer" — null if no tenant grant. */
  role: string | null;
  /** true when invite carries grant_platform_admin. */
  isPlatformAdmin: boolean;
  /** Display name or email of the admin who issued the invite. */
  inviterName: string | null;
}): RenderedEmail {
  const grants: string[] = [];
  if (isPlatformAdmin) grants.push('Platform administrator (every tenant + admin tools)');
  if (tenantName && role) grants.push(`${role.charAt(0).toUpperCase() + role.slice(1)} on ${tenantName}`);
  const grantSummary = grants.length === 0 ? 'Access pending' : grants.join('<br>');

  const preheader = `You've been invited to ${BRAND.productName}. Set a password to activate your account.`;

  const html = shell({
    preheader,
    body: `
      <h1 style="font-family:'Oswald',sans-serif;font-weight:600;font-size:22px;margin:0 0 6px;color:${BRAND.body};">
        You're invited to ${BRAND.productName}
      </h1>
      <p style="margin:0 0 14px;color:${BRAND.muted};font-size:13px;">
        ${inviterName ? `${escapeHtml(inviterName)} ` : 'An administrator '}has set up an account for you.
        Click the button below to set a password and sign in.
      </p>

      <div style="background:${BRAND.bgPage};border-radius:8px;padding:12px 14px;font-size:13px;color:${BRAND.body};margin-bottom:8px;">
        <strong style="font-size:11px;color:${BRAND.muted};text-transform:uppercase;letter-spacing:.06em;">Your access</strong><br>
        ${grantSummary}
      </div>

      ${button({ href: inviteUrl, label: 'Set my password' })}

      <p style="margin:0;color:${BRAND.muted};font-size:12px;">
        The link is single-use and expires in 14 days. If it doesn't work, your administrator can issue a fresh one.
      </p>
      <p style="margin:14px 0 4px;color:${BRAND.muted};font-size:11px;">
        Trouble with the button? Copy this URL into your browser:
      </p>
      ${urlBlock(inviteUrl)}
    `,
  });

  const text = [
    `You're invited to ${BRAND.productName}`,
    '',
    `${inviterName ? inviterName + ' ' : 'An administrator '}has set up an account for you.`,
    'Click the link below to set a password and sign in.',
    '',
    'YOUR ACCESS',
    isPlatformAdmin ? 'Platform administrator (every tenant + admin tools)' : '',
    tenantName && role ? `${role.charAt(0).toUpperCase() + role.slice(1)} on ${tenantName}` : '',
    '',
    inviteUrl,
    '',
    'The link is single-use and expires in 14 days.',
    'If it doesn\'t work, ask your administrator to issue a fresh invite.',
  ].filter(Boolean).join('\n');

  return {
    subject: tenantName
      ? `You're invited to ${tenantName} on ${BRAND.productName}`
      : `You're invited to ${BRAND.productName}`,
    html, text,
  };
}

// =============================================================================
// Password reset — fresh invite generated via /api/auth/forgot-password
// =============================================================================

export function renderPasswordResetEmail({
  resetUrl, email,
}: {
  resetUrl: string;
  email: string;
}): RenderedEmail {
  const preheader = `A password reset was requested for ${email}. Click to set a new password.`;
  const html = shell({
    preheader,
    body: `
      <h1 style="font-family:'Oswald',sans-serif;font-weight:600;font-size:22px;margin:0 0 6px;color:${BRAND.body};">
        Reset your ${BRAND.productName} password
      </h1>
      <p style="margin:0 0 14px;color:${BRAND.muted};font-size:13px;">
        A password reset was requested for <strong style="color:${BRAND.body};">${escapeHtml(email)}</strong>.
        Click below to choose a new password. Every existing session for this account will be revoked.
      </p>

      ${button({ href: resetUrl, label: 'Set a new password' })}

      <p style="margin:0;color:${BRAND.muted};font-size:12px;">
        The link is single-use and expires in 14 days.
        If you didn't request this, you can safely ignore this email — nothing has changed.
      </p>
      <p style="margin:14px 0 4px;color:${BRAND.muted};font-size:11px;">
        Trouble with the button? Copy this URL into your browser:
      </p>
      ${urlBlock(resetUrl)}
    `,
  });
  const text = [
    `Reset your ${BRAND.productName} password`,
    '',
    `A password reset was requested for ${email}.`,
    'Click the link below to set a new password.',
    '',
    resetUrl,
    '',
    'The link is single-use and expires in 14 days.',
    'If you didn\'t request this, ignore this email — nothing has changed.',
  ].join('\n');
  return { subject: `Reset your ${BRAND.productName} password`, html, text };
}

// =============================================================================
// Welcome — sent after a user accepts an invite + sets their password
// =============================================================================

export function renderWelcomeEmail({
  displayName, tenantName, isPlatformAdmin, signInUrl,
}: {
  displayName: string | null;
  tenantName: string | null;
  isPlatformAdmin: boolean;
  signInUrl: string;
}): RenderedEmail {
  const greet = displayName?.trim() ? `Welcome, ${escapeHtml(displayName.trim())}` : `Welcome to ${BRAND.productName}`;
  const where = isPlatformAdmin
    ? 'You have platform-administrator access to every tenant and the admin tools.'
    : tenantName
      ? `You can sign in to ${escapeHtml(tenantName)} now.`
      : 'You can sign in to TrustOS now.';

  const html = shell({
    preheader: `Your ${BRAND.productName} account is active. Sign in to get started.`,
    body: `
      <h1 style="font-family:'Oswald',sans-serif;font-weight:600;font-size:22px;margin:0 0 6px;color:${BRAND.body};">
        ${greet}
      </h1>
      <p style="margin:0 0 14px;color:${BRAND.muted};font-size:13px;">
        Your account is active. ${where}
      </p>
      ${button({ href: signInUrl, label: 'Sign in' })}
      <p style="margin:0;color:${BRAND.muted};font-size:12px;">
        You can change your password any time under <strong>Settings → My Account</strong> in the app.
      </p>
    `,
  });
  const text = [
    greet,
    '',
    `Your account is active. ${where}`,
    '',
    `Sign in: ${signInUrl}`,
    '',
    'You can change your password any time under Settings → My Account in the app.',
  ].join('\n');
  return { subject: `Welcome to ${BRAND.productName}`, html, text };
}

// =============================================================================
// Helpers
// =============================================================================

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
