/**
 * Email service abstraction.
 *
 * Today: Resend (https://resend.com). Their HTTP API is clean enough that
 * we don't pull in their SDK — keeps cold starts fast and dependency
 * surface small. Swap providers by editing the `send()` body; the
 * `sendEmail()` shape stays the same.
 *
 * Configuration via env vars on each deploy:
 *
 *   RESEND_API_KEY        Secret key from resend.com/api-keys.
 *                         When UNSET, sendEmail() logs to console and
 *                         returns { sent: false, reason: 'not_configured' }
 *                         so the platform works pre-integration — the
 *                         invite URL is still surfaced in the admin UI for
 *                         manual copy/paste, exactly as before.
 *
 *   EMAIL_FROM            "TrustOS <noreply@usicomputer.com>" — the
 *                         display name + address shown to the recipient.
 *                         Must use a domain you have verified in Resend
 *                         (SPF/DKIM/DMARC).
 *
 *   EMAIL_REPLY_TO        Optional. Inbox a human reads when a recipient
 *                         hits Reply (e.g. "support@usicomputer.com").
 *
 *   EMAIL_BCC             Optional. Comma-separated BCC list. Useful for
 *                         compliance archiving while the email feature is
 *                         young — e.g. BCC the platform admin on every
 *                         outbound mail.
 *
 * Bootstrap steps (one-time, per deploy that should send mail):
 *   1. Create a Resend account and verify usicomputer.com (or whichever
 *      sending domain you want).
 *   2. Generate an API key. Add as `RESEND_API_KEY` on Vercel.
 *   3. Set `EMAIL_FROM` to "TrustOS <noreply@usicomputer.com>".
 *   4. Optionally set EMAIL_REPLY_TO and EMAIL_BCC.
 *   5. Redeploy. New invites will now actually send.
 *
 * The send path is intentionally fire-and-forget at the caller's level
 * (await it if you need to, but a failure doesn't break the API request
 * that triggered it — the invite is already written to the DB).
 */

export interface SendEmailArgs {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  /** Per-call override for the From line; defaults to EMAIL_FROM env. */
  from?: string;
  /** Per-call override for Reply-To; defaults to EMAIL_REPLY_TO env. */
  reply_to?: string;
  /** Free-form tags for searching in Resend's dashboard. */
  tags?: { name: string; value: string }[];
}

export interface SendEmailResult {
  sent: boolean;
  /** Resend message id when sent === true. */
  id?: string;
  /** Reason the message didn't send. 'not_configured' = env vars missing
   *  (expected during rollout). Any other value indicates an error. */
  reason?: 'not_configured' | 'api_error' | 'invalid_args';
  error?: string;
}

function envOr(name: string, fallback: string | null = null): string | null {
  const v = process.env[name];
  if (v == null) return fallback;
  const trimmed = v.trim();
  return trimmed ? trimmed : fallback;
}

/** Send a transactional email. See module docblock for env config. */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = envOr('RESEND_API_KEY');
  const from = args.from ?? envOr('EMAIL_FROM');
  if (!apiKey || !from) {
    // Graceful fallback: log a one-line summary so an admin grepping logs
    // can see what would have been sent. The real fix is to set the env
    // vars; this path keeps invites working in the meantime.
    const recipients = Array.isArray(args.to) ? args.to.join(',') : args.to;
    console.warn(
      `[email] RESEND_API_KEY or EMAIL_FROM not set; not sending. ` +
      `to=${recipients} subject=${JSON.stringify(args.subject)}`,
    );
    return { sent: false, reason: 'not_configured' };
  }

  const replyTo = args.reply_to ?? envOr('EMAIL_REPLY_TO');
  const bcc     = envOr('EMAIL_BCC');

  if (!args.to || (Array.isArray(args.to) && args.to.length === 0)) {
    return { sent: false, reason: 'invalid_args', error: 'missing recipient' };
  }
  if (!args.subject?.trim()) {
    return { sent: false, reason: 'invalid_args', error: 'missing subject' };
  }
  if (!args.html?.trim() && !args.text?.trim()) {
    return { sent: false, reason: 'invalid_args', error: 'missing body (html or text)' };
  }

  const body: Record<string, unknown> = {
    from,
    to: Array.isArray(args.to) ? args.to : [args.to],
    subject: args.subject,
    html: args.html,
    text: args.text,
  };
  if (replyTo) body.reply_to = replyTo;
  if (bcc)     body.bcc      = bcc.split(',').map((s) => s.trim()).filter(Boolean);
  if (args.tags?.length) body.tags = args.tags;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    if (!r.ok) {
      // Surface the failure so the calling route can decide whether to
      // tell the user. Default in callers: don't fail the request — the
      // invite/reset still exists in the DB, the URL is still available
      // for manual delivery.
      console.error(`[email] resend POST failed status=${r.status} body=${text}`);
      return { sent: false, reason: 'api_error', error: text.slice(0, 500) };
    }
    let id: string | undefined;
    try {
      const j = JSON.parse(text) as { id?: string };
      id = j.id;
    } catch { /* ignore */ }
    return { sent: true, id };
  } catch (err) {
    console.error('[email] resend POST threw', err);
    return {
      sent: false, reason: 'api_error',
      error: err instanceof Error ? err.message : 'unknown',
    };
  }
}

/** Convenience: true when the email integration is configured enough to
 *  actually send. UI can use this to decide whether to surface "we
 *  emailed it" vs "please copy this URL." */
export function isEmailConfigured(): boolean {
  return !!envOr('RESEND_API_KEY') && !!envOr('EMAIL_FROM');
}
