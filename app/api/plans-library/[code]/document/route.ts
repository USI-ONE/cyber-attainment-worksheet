import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { audit, getCurrentUser, canEditTenant } from '@/lib/auth';

/**
 * POST /api/plans-library/[code]/document
 *
 * Upload a new version of the document attached to one plans library
 * entry. Reuses the policy-documents storage bucket + table (a document
 * is a document; the table name is historical). Behaviour mirrors the
 * policy library's document upload:
 *
 *   1. New file uploaded as a fresh policy_documents row.
 *   2. Prior document marked status='archived' (file kept for history).
 *   3. tenant_plans.plan_document_id repointed to the new row; version,
 *      last_reviewed_at, and next_review_due bumped.
 *
 * Multipart fields:
 *   file        (required) — the file to upload
 *   version     (optional) — version label; default = today's YYYY-MM-DD
 *   description (optional) — change description for the document list
 *
 * Authorization: canEditTenant.
 */
export const dynamic = 'force-dynamic';
const BUCKET = 'policy-documents';
const MAX_BYTES = 25 * 1024 * 1024;

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

function safeName(name: string): string {
  return name.replace(/[/\\]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 200) || 'file';
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

  let form: FormData;
  try { form = await req.formData(); } catch { return bad('expected multipart/form-data'); }
  const file = form.get('file');
  if (!(file instanceof File)) return bad('missing "file" field');
  if (file.size === 0) return bad('empty file');
  if (file.size > MAX_BYTES) return bad(`file exceeds ${MAX_BYTES / 1024 / 1024} MB`);

  const sb = createServiceRoleClient();

  // Look up catalog entry for canonical title + cadence.
  const { data: cat, error: catErr } = await sb
    .from('plans_library_catalog')
    .select('code, title, default_review_months')
    .eq('code', params.code)
    .maybeSingle();
  if (catErr) return bad(catErr.message, 500);
  if (!cat) return bad('unknown plan code', 404);

  // Existing tenant_plans row (may not exist if no prior upload).
  const { data: tpRow } = await sb
    .from('tenant_plans')
    .select('id, plan_document_id')
    .eq('tenant_id', tenant.id)
    .eq('plan_code', params.code)
    .maybeSingle();

  const filename = safeName(file.name || `${params.code}`);
  const docId    = crypto.randomUUID();
  const random   = crypto.randomUUID();
  const storagePath = `${tenant.id}/${docId}/${random}-${filename}`;
  const buf = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await sb.storage
    .from(BUCKET)
    .upload(storagePath, buf, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  if (upErr) return bad(`upload failed: ${upErr.message}`, 500);

  const today = new Date().toISOString().slice(0, 10);
  const newVersion =
    (form.get('version')?.toString().trim()) || today;

  const { data: newDoc, error: insErr } = await sb
    .from('policy_documents')
    .insert({
      id: docId,
      tenant_id: tenant.id,
      title: cat.title,
      version: newVersion,
      effective_date: today,
      status: 'published',
      description: form.get('description')?.toString() || null,
      storage_path: storagePath,
      filename,
      content_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: cu!.user.email || cu!.user.id,
      linked_control_ids: [],
      // policy_code column was added by migration 0026 to tag policy
      // library docs. Plans docs reuse it as a generic "doc kind" tag
      // namespaced under `plan:<code>` so a future cleanup can split
      // tables without breaking queries today.
      policy_code: `plan:${params.code}`,
    })
    .select('*')
    .single();
  if (insErr || !newDoc) {
    await sb.storage.from(BUCKET).remove([storagePath]);
    return bad(insErr?.message ?? 'insert failed', 500);
  }

  // Archive prior version — keep the file, just flip status.
  if (tpRow?.plan_document_id && tpRow.plan_document_id !== docId) {
    await sb
      .from('policy_documents')
      .update({ status: 'archived' })
      .eq('id', tpRow.plan_document_id);
  }

  // Repoint tenant_plans, bump review dates.
  const nextDue = new Date();
  nextDue.setMonth(nextDue.getMonth() + (cat.default_review_months ?? 12));
  const nextDueStr = nextDue.toISOString().slice(0, 10);

  const tpPatch = {
    plan_document_id: docId,
    version:          newVersion,
    last_reviewed_at: today,
    next_review_due:  nextDueStr,
    status:           'active',
    updated_by:       cu!.user.id,
  };

  if (tpRow) {
    await sb.from('tenant_plans').update(tpPatch).eq('id', tpRow.id);
  } else {
    await sb.from('tenant_plans').insert({
      tenant_id:  tenant.id,
      plan_code:  params.code,
      ...tpPatch,
    });
  }

  await audit({
    actor_id:  cu!.user.id,
    tenant_id: tenant.id,
    action:    'plan_document_uploaded',
    detail:    {
      plan_code:  params.code,
      doc_id:     docId,
      version:    newVersion,
      size_bytes: file.size,
      replaced:   tpRow?.plan_document_id ?? null,
    },
  });

  return NextResponse.json({ ok: true, document: newDoc });
}
