import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audit, getCurrentUser, isPlatformAdmin } from '@/lib/auth';

/**
 * DELETE /api/admin/users/[id]/permanent
 *
 * Hard-delete a profile row. Refuses unless:
 *   - the caller is a platform admin
 *   - the target user's status is 'disabled' (you must soft-disable first
 *     so deletion is a deliberate two-step action, not a one-click oops)
 *   - the target isn't the caller (no self-delete)
 *
 * On success:
 *   - profile row is removed
 *   - memberships + sessions + sso_tokens cascade-delete
 *     (per the FK definitions in migration 0015 / 0020)
 *   - audit_log / audit_log_user / current_scores / snapshots /
 *     kpi_observations / snapshot_shares / framework_mappings rows that
 *     referenced the user via *_by columns set those columns NULL
 *     (per migration 0024) — the historical rows stay intact, just the
 *     "who did this" pointer is cleared
 *   - user_invites rows that referenced the user as invited_by /
 *     accepted_by have those columns set NULL (was already the case)
 *
 * Audit log gets a final 'user_deleted' row BEFORE the delete fires, so
 * the action itself is recorded with the actor's id and the target's
 * email captured in detail. The deletion will then null out the
 * target_id column on that very row (per the FK), but the email + actor
 * stay, so an auditor can still trace what happened.
 */
export const dynamic = 'force-dynamic';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const cu = await getCurrentUser();
  if (!isPlatformAdmin(cu)) return bad('platform admin required', 403);
  if (params.id === cu!.user.id) return bad('cannot delete yourself', 400);

  const supabase = createServiceRoleClient();
  const { data: target } = await supabase
    .from('profiles')
    .select('id, email, display_name, status, is_platform_admin')
    .eq('id', params.id)
    .maybeSingle();
  if (!target) return bad('user not found', 404);
  if (target.status !== 'disabled') {
    return bad('user must be disabled before permanent deletion. Disable first, then delete.', 400);
  }

  // Snapshot the email + display name BEFORE delete so the audit row
  // can capture identity that will otherwise be lost.
  const snapshot = {
    email: target.email,
    display_name: target.display_name,
    was_platform_admin: target.is_platform_admin,
  };

  // Write the audit row first. The trigger-less audit() helper inserts
  // into audit_log_user with actor_id + target_id; target_id will get
  // null'd by the FK cascade after the delete, but the detail json
  // preserves the email.
  await audit({
    actor_id: cu!.user.id,
    target_id: target.id,
    action: 'user_deleted_permanently',
    detail: snapshot,
  });

  const { error: delErr } = await supabase
    .from('profiles')
    .delete()
    .eq('id', params.id);
  if (delErr) return bad(delErr.message, 500);

  return NextResponse.json({
    ok: true,
    deleted: snapshot,
  });
}
