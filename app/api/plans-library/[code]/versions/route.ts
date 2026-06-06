import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { getCurrentUser, canAccessTenant } from '@/lib/auth';
import { listLineage } from '@/lib/document-revisions';

/**
 * GET /api/plans-library/[code]/versions
 *
 * Returns the full version history of the document currently attached
 * to a plan, ordered newest first. The "current" version is the one
 * tenant_plans.plan_document_id points at; older versions sit in
 * policy_documents with status='archived'.
 *
 * Authorization: any user with access to the tenant.
 */
export const dynamic = 'force-dynamic';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const host = req.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant', 404);

  const cu = await getCurrentUser();
  if (!canAccessTenant(cu, tenant.id)) return bad('forbidden', 403);

  const sb = createServiceRoleClient();
  const { data: tp } = await sb
    .from('tenant_plans')
    .select('plan_document_id')
    .eq('tenant_id', tenant.id)
    .eq('plan_code', params.code)
    .maybeSingle();
  if (!tp?.plan_document_id) {
    return NextResponse.json({ current_id: null, versions: [] });
  }

  const { data: current } = await sb
    .from('policy_documents')
    .select('id, lineage_id')
    .eq('id', tp.plan_document_id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!current) {
    return NextResponse.json({ current_id: null, versions: [] });
  }

  const versions = await listLineage(sb, {
    tenantId: tenant.id,
    lineageId: current.lineage_id,
  });

  return NextResponse.json({
    current_id: current.id,
    versions: versions.map((v) => ({
      id: v.id,
      version: v.version,
      effective_date: v.effective_date,
      status: v.status,
      change_note: v.change_note,
      uploaded_by: v.uploaded_by,
      size_bytes: v.size_bytes,
      content_type: v.content_type,
      created_at: v.created_at,
      is_current: v.id === current.id,
    })),
  });
}
