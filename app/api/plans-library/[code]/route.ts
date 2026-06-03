import { NextResponse, type NextRequest } from 'next/server';
import { resolveTenant } from '@/lib/tenant';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audit, getCurrentUser, canEditTenant } from '@/lib/auth';

/**
 * PATCH /api/plans-library/[code]
 *
 * Upserts the tenant's state for one plans-catalog entry. Editable
 * fields: status, version, last_reviewed_at, next_review_due,
 * owner_user_id, plan_document_id, notes.
 *
 * When last_reviewed_at is supplied without an explicit next_review_due,
 * computes next-due as last_reviewed_at + catalog.default_review_months.
 *
 * Authorization: canEditTenant (global admin or tenant admin).
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
  if ('plan_document_id' in body) patch.plan_document_id = body.plan_document_id || null;
  if ('notes' in body) {
    patch.notes = typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null;
  }

  const sb = createServiceRoleClient();

  // Auto-derive next_review_due if last_reviewed_at is supplied without override.
  if ('last_reviewed_at' in body && body.last_reviewed_at && !('next_review_due' in body)) {
    const { data: cat } = await sb
      .from('plans_library_catalog')
      .select('default_review_months')
      .eq('code', params.code)
      .maybeSingle();
    const months = (cat as { default_review_months?: number } | null)?.default_review_months ?? 12;
    const d = new Date(body.last_reviewed_at as string);
    d.setMonth(d.getMonth() + months);
    patch.next_review_due = d.toISOString().slice(0, 10);
  }

  patch.updated_by = cu!.user.id;

  // Update-first, fall back to insert. Same pattern as the policy library
  // PATCH so partial supplies don't wipe unset fields back to defaults.
  const { data: updated, error: uErr } = await sb
    .from('tenant_plans')
    .update(patch)
    .eq('tenant_id', tenant.id)
    .eq('plan_code', params.code)
    .select('*')
    .maybeSingle();
  if (uErr) return bad(uErr.message, 500);

  let row = updated;
  if (!row) {
    const { data: inserted, error: iErr } = await sb
      .from('tenant_plans')
      .insert({ tenant_id: tenant.id, plan_code: params.code, ...patch })
      .select('*')
      .maybeSingle();
    if (iErr) return bad(iErr.message, 500);
    row = inserted;
  }

  await audit({
    actor_id: cu!.user.id,
    tenant_id: tenant.id,
    action: 'plan_state_updated',
    detail: { plan_code: params.code, fields: Object.keys(patch).filter((k) => k !== 'updated_by') },
  });

  return NextResponse.json({ state: row });
}
