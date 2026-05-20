import { NextResponse, type NextRequest } from 'next/server';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audit, getCurrentUser, canEditTenant } from '@/lib/auth';

/**
 * PATCH /api/policy-library/[code]
 *
 * Upserts the tenant's state for one catalog entry. Editable fields:
 *   status, version, last_reviewed_at, next_review_due, owner_user_id,
 *   policy_document_id, notes.
 *
 * Convenience: when last_reviewed_at is supplied WITHOUT an explicit
 * next_review_due, we compute the next-due date as last_reviewed_at +
 * catalog.default_review_months. Reviewers usually want this behavior;
 * if they want a non-default cadence they can set both dates explicitly.
 *
 * Authorization: canEditTenant (global admin or tenant admin for this
 * tenant). Tenant viewers cannot write.
 */
export const dynamic = 'force-dynamic';

const VALID_STATUS = new Set(['missing', 'draft', 'active', 'expired', 'na']);

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const host = req.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant', 404);

  const cu = await getCurrentUser();
  if (!canEditTenant(cu, tenant.id)) return bad('forbidden', 403);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad('invalid JSON');
  }

  const patch: Record<string, unknown> = {};
  if (typeof body.status === 'string') {
    if (!VALID_STATUS.has(body.status)) return bad(`invalid status: ${body.status}`);
    patch.status = body.status;
  }
  if ('version' in body) {
    patch.version = typeof body.version === 'string' && body.version.trim() ? body.version.trim() : null;
  }
  if ('last_reviewed_at' in body) patch.last_reviewed_at = body.last_reviewed_at || null;
  if ('next_review_due' in body)  patch.next_review_due  = body.next_review_due  || null;
  if ('owner_user_id' in body)    patch.owner_user_id    = body.owner_user_id    || null;
  if ('policy_document_id' in body) patch.policy_document_id = body.policy_document_id || null;
  if ('notes' in body) {
    patch.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
  }

  const sb = createServiceRoleClient();

  // Auto-derive next_review_due from last_reviewed_at + catalog cadence
  // when the caller didn't override.
  if ('last_reviewed_at' in body && body.last_reviewed_at && !('next_review_due' in body)) {
    const { data: cat } = await sb
      .from('policy_library_catalog')
      .select('default_review_months')
      .eq('code', params.code)
      .maybeSingle();
    const months = (cat as { default_review_months?: number } | null)?.default_review_months ?? 12;
    const d = new Date(body.last_reviewed_at as string);
    d.setMonth(d.getMonth() + months);
    patch.next_review_due = d.toISOString().slice(0, 10);
  }

  patch.updated_by = cu!.user.id;

  // Pattern: update-first, fall back to insert if no row exists. Avoids
  // the supabase-js upsert quirk where unsupplied columns get reset to
  // their defaults instead of preserved.
  const { data: updated, error: uErr } = await sb
    .from('tenant_policies')
    .update(patch)
    .eq('tenant_id', tenant.id)
    .eq('policy_code', params.code)
    .select('*')
    .maybeSingle();
  if (uErr) return bad(uErr.message, 500);

  let row = updated;
  if (!row) {
    const { data: inserted, error: iErr } = await sb
      .from('tenant_policies')
      .insert({ tenant_id: tenant.id, policy_code: params.code, ...patch })
      .select('*')
      .maybeSingle();
    if (iErr) return bad(iErr.message, 500);
    row = inserted;
  }

  await audit({
    actor_id: cu!.user.id,
    tenant_id: tenant.id,
    action: 'policy_state_updated',
    detail: { policy_code: params.code, fields: Object.keys(patch).filter((k) => k !== 'updated_by') },
  });

  return NextResponse.json({ state: row });
}
