import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  audit, destroyCurrentSession, getCurrentUser, hashPassword, verifyPassword,
} from '@/lib/auth';

/**
 * POST /api/me/password — self-service password change for the signed-in
 * user. Body: { current_password, new_password }.
 *
 * Flow:
 *   1. Verify there's a valid session.
 *   2. Verify the supplied current_password against profiles.password_hash.
 *      A correct old password is required even for editors — otherwise a
 *      stolen browser session would let an attacker take over the account
 *      permanently by setting a password the real user can't override.
 *   3. Hash and store the new password.
 *   4. Revoke every OTHER active session for this user so any device the
 *      attacker might have stays signed in is kicked out.
 *   5. Keep the CURRENT session alive (the user just authenticated; no
 *      reason to bounce them back to /auth/signin).
 *   6. Audit the event.
 *
 * No platform/tenant role required — any user can change their own password.
 */
export const dynamic = 'force-dynamic';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

export async function POST(request: NextRequest) {
  const cu = await getCurrentUser();
  if (!cu) return bad('authentication required', 401);

  let body: { current_password?: string; new_password?: string };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const current = body.current_password ?? '';
  const next    = body.new_password ?? '';
  if (!current) return bad('current_password is required');
  if (next.length < 12) return bad('new password must be at least 12 characters');
  if (next === current) return bad('new password must differ from the current one');

  // Pull the password hash separately — getCurrentUser intentionally does
  // NOT include the hash in its return shape.
  const supabase = createServiceRoleClient();
  const { data: row } = await supabase
    .from('profiles')
    .select('password_hash')
    .eq('id', cu.user.id)
    .maybeSingle();
  if (!row?.password_hash) {
    // No password on file — happens if the account was created by an admin
    // and never went through accept-invite. Tell the user to use the invite
    // URL instead of this endpoint.
    return bad('no password set on this account; ask an admin to issue an invite', 400);
  }

  const ok = await verifyPassword(current, row.password_hash);
  if (!ok) {
    await audit({
      actor_id: cu.user.id, target_id: cu.user.id,
      action: 'password_change_fail',
      detail: { reason: 'bad_current_password' },
      ip: request.headers.get('x-forwarded-for') ?? null,
      user_agent: request.headers.get('user-agent') ?? null,
    });
    return bad('current password is incorrect', 401);
  }

  const newHash = await hashPassword(next);
  const { error: upErr } = await supabase
    .from('profiles')
    .update({
      password_hash: newHash,
      password_changed_at: new Date().toISOString(),
    })
    .eq('id', cu.user.id);
  if (upErr) return bad(upErr.message, 500);

  // Revoke every OTHER active session for this user. Defines "other" as
  // anything that isn't the current session, identified by session_id from
  // getCurrentUser.
  await supabase
    .from('sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', cu.user.id)
    .is('revoked_at', null)
    .neq('id', cu.session_id);

  await audit({
    actor_id: cu.user.id, target_id: cu.user.id,
    action: 'password_changed',
    ip: request.headers.get('x-forwarded-for') ?? null,
    user_agent: request.headers.get('user-agent') ?? null,
  });

  void destroyCurrentSession; // imported but reserved for /api/me/password/revoke-all
  return NextResponse.json({ ok: true });
}
