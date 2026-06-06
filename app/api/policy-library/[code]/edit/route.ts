import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { audit, getCurrentUser, canEditTenant } from '@/lib/auth';
import { bumpVersion, createRevision } from '@/lib/document-revisions';

/**
 * POST /api/policy-library/[code]/edit
 *
 * Save inline text edits to the document attached to one policy-library
 * entry as a brand-new version. Mirrors the file-upload "new revision"
 * flow but with the edited body coming from the request JSON instead of
 * a multipart file. Companion to /api/plans-library/[code]/edit.
 *
 * Request JSON:
 *   content       (required) — full text body of the new version
 *   content_type  (optional) — defaults to text/markdown
 *   version       (optional) — defaults to bumpVersion(prior.version)
 *   change_note   (optional) — short caption describing what changed
 *
 * Authorization: canEditTenant.
 */
export const dynamic = 'force-dynamic';
const MAX_BYTES = 5 * 1024 * 1024;

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { code: string } },
) {
  const host = req.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant', 404);

  const cu = await getCurrentUser();
  if (!canEditTenant(cu, tenant.id)) return bad('forbidden', 403);

  let body: {
    content?: string;
    content_type?: string;
    version?: string;
    change_note?: string;
  };
  try { body = await req.json(); } catch { return bad('expected JSON body'); }

  const content = body.content ?? '';
  if (typeof content !== 'string' || content.length === 0) {
    return bad('content is required');
  }
  if (content.length > MAX_BYTES) {
    return bad(`content exceeds ${MAX_BYTES / 1024 / 1024} MB`, 413);
  }

  const sb = createServiceRoleClient();

  const { data: tpol } = await sb
    .from('tenant_policies')
    .select('id, policy_document_id')
    .eq('tenant_id', tenant.id)
    .eq('policy_code', params.code)
    .maybeSingle();
  if (!tpol?.policy_document_id) {
    return bad('no current document to edit — upload one first', 404);
  }

  const { data: prior } = await sb
    .from('policy_documents')
    .select('*')
    .eq('id', tpol.policy_document_id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!prior) return bad('prior document not found', 404);

  const newVersion = body.version?.trim() || bumpVersion(prior.version);
  const contentType = body.content_type?.trim() || 'text/markdown';

  let revisionResult;
  try {
    revisionResult = await createRevision(sb, {
      priorDoc: prior,
      newContent: content,
      contentType,
      filenameHint: prior.filename ?? `${params.code}.md`,
      newVersion,
      changeNote: body.change_note ?? null,
      editedBy: cu!.user.email || cu!.user.id,
    });
  } catch (e) {
    return bad(e instanceof Error ? e.message : 'revision failed', 500);
  }
  const { doc: newDoc, rollback } = revisionResult;

  // Repoint tenant_policies → new doc; advance review dates.
  const today = new Date().toISOString().slice(0, 10);
  const { data: cat } = await sb
    .from('policy_library_catalog')
    .select('default_review_months')
    .eq('code', params.code)
    .maybeSingle();
  const months = (cat as { default_review_months?: number } | null)?.default_review_months ?? 12;
  const nextDue = new Date();
  nextDue.setMonth(nextDue.getMonth() + months);
  const nextDueStr = nextDue.toISOString().slice(0, 10);

  const { error: linkErr } = await sb
    .from('tenant_policies')
    .update({
      policy_document_id: newDoc.id,
      version: newVersion,
      last_reviewed_at: today,
      next_review_due: nextDueStr,
      status: 'active',
      updated_by: cu!.user.id,
    })
    .eq('id', tpol.id);
  if (linkErr) {
    await rollback();
    return bad(`link update failed: ${linkErr.message}`, 500);
  }

  await audit({
    actor_id: cu!.user.id,
    tenant_id: tenant.id,
    action: 'policy_document_edited',
    detail: {
      policy_code: params.code,
      prior_doc_id: prior.id,
      new_doc_id: newDoc.id,
      prior_version: prior.version,
      new_version: newVersion,
      size_bytes: newDoc.size_bytes,
      change_note: body.change_note ?? null,
    },
  });

  return NextResponse.json({ ok: true, document: newDoc });
}
