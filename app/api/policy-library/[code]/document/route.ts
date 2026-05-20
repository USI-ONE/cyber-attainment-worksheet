import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { audit, getCurrentUser, canEditTenant } from '@/lib/auth';

/**
 * POST /api/policy-library/[code]/document
 *
 * Upload a new version of the document attached to one policy library
 * entry. This is the "edited file → upload to replace" path:
 *
 *   1. The new file is uploaded as a NEW policy_documents row tagged with
 *      policy_code so version history is queryable.
 *   2. The previous document (if any) is marked status='archived' — file
 *      preserved, just no longer the current version.
 *   3. tenant_policies.policy_document_id is repointed to the new doc.
 *      version, last_reviewed_at, and next_review_due are bumped.
 *
 * Multipart fields:
 *   file       (required) — the file to upload
 *   version    (optional) — version label; defaults to today's YYYY-MM-DD
 *   description(optional) — change description shown in document list
 *
 * Authorization: canEditTenant (global admin or tenant admin).
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

  const supabase = createServiceRoleClient();

  // Look up the catalog entry to get the canonical title and review cadence.
  const { data: cat, error: catErr } = await supabase
    .from('policy_library_catalog')
    .select('code, title, default_review_months')
    .eq('code', params.code)
    .maybeSingle();
  if (catErr) return bad(catErr.message, 500);
  if (!cat) return bad('unknown policy code', 404);

  // Find the existing tenant_policies row (may not exist yet — first upload).
  const { data: tpRow } = await supabase
    .from('tenant_policies')
    .select('id, policy_document_id')
    .eq('tenant_id', tenant.id)
    .eq('policy_code', params.code)
    .maybeSingle();

  // Build a stable storage path: tenant/doc-id/uuid-filename
  // (Mirrors the existing /api/policy-documents path pattern so the
  // existing GET-with-signed-URL works without any change.)
  const filename = safeName(file.name || `${params.code}`);
  const docId    = crypto.randomUUID();
  const random   = crypto.randomUUID();
  const storagePath = `${tenant.id}/${docId}/${random}-${filename}`;
  const buf = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buf, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  if (upErr) return bad(`upload failed: ${upErr.message}`, 500);

  const today = new Date().toISOString().slice(0, 10);
  const newVersion =
    (form.get('version')?.toString().trim()) || today;

  const { data: newDoc, error: insErr } = await supabase
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
      policy_code: params.code,
    })
    .select('*')
    .single();
  if (insErr || !newDoc) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return bad(insErr?.message ?? 'insert failed', 500);
  }

  // Archive the prior version (keep the file — it's now history, not garbage).
  if (tpRow?.policy_document_id && tpRow.policy_document_id !== docId) {
    await supabase
      .from('policy_documents')
      .update({ status: 'archived' })
      .eq('id', tpRow.policy_document_id);
  }

  // Repoint the tenant_policies row (or create it if this is the first upload).
  const nextDue = new Date();
  nextDue.setMonth(nextDue.getMonth() + (cat.default_review_months ?? 12));
  const nextDueStr = nextDue.toISOString().slice(0, 10);

  const tpPatch = {
    policy_document_id: docId,
    version:            newVersion,
    last_reviewed_at:   today,
    next_review_due:    nextDueStr,
    status:             'active',
    updated_by:         cu!.user.id,
  };

  if (tpRow) {
    await supabase.from('tenant_policies').update(tpPatch).eq('id', tpRow.id);
  } else {
    await supabase.from('tenant_policies').insert({
      tenant_id:   tenant.id,
      policy_code: params.code,
      ...tpPatch,
    });
  }

  await audit({
    actor_id:  cu!.user.id,
    tenant_id: tenant.id,
    action:    'policy_document_uploaded',
    detail:    {
      policy_code: params.code,
      doc_id:      docId,
      version:     newVersion,
      size_bytes:  file.size,
      replaced:    tpRow?.policy_document_id ?? null,
    },
  });

  return NextResponse.json({ ok: true, document: newDoc });
}
