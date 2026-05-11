import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import type { EvidenceArtifact, EvidenceStatus } from '@/lib/supabase/types';

/**
 * GET    /api/evidence/[id]     — returns the row + a short-lived signed
 *                                 download URL (if a file is attached).
 *                                 The bucket is private; direct URLs won't
 *                                 resolve.
 * PATCH  /api/evidence/[id]     — JSON body, partial metadata update.
 *                                 To replace the binary, delete + re-upload.
 * DELETE /api/evidence/[id]     — drops the row and (best-effort) the blob.
 */
export const dynamic = 'force-dynamic';
const BUCKET = 'evidence-artifacts';
const SIGN_TTL = 60;
const STATUSES: readonly EvidenceStatus[] = ['current','superseded','expired','archived'];

function bad(msg: string, code = 400) { return NextResponse.json({ error: msg }, { status: code }); }

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean);
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('evidence_artifacts')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('not found', 404);

  let download_url: string | null = null;
  if (data.storage_path) {
    const { data: signed } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(data.storage_path, SIGN_TTL, { download: data.filename ?? undefined });
    download_url = signed?.signedUrl ?? null;
  }
  return NextResponse.json({ artifact: data as EvidenceArtifact, download_url });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  let body: Partial<EvidenceArtifact>;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const patch: Record<string, unknown> = {};
  if (typeof body.title === 'string') {
    const t = body.title.trim();
    if (!t) return bad('title cannot be empty');
    patch.title = t;
  }
  if (typeof body.category === 'string') {
    const c = body.category.trim();
    if (!c) return bad('category cannot be empty');
    patch.category = c;
  }
  if (typeof body.status === 'string') {
    if (!STATUSES.includes(body.status as EvidenceStatus)) return bad('invalid status');
    patch.status = body.status;
  }
  if ('description'     in body) patch.description     = body.description?.toString() ?? null;
  if ('uploaded_by'     in body) patch.uploaded_by     = body.uploaded_by?.toString().trim() || null;
  if ('collected_date'  in body) patch.collected_date  = body.collected_date || null;
  if ('retention_until' in body) patch.retention_until = body.retention_until || null;

  if (Array.isArray(body.linked_control_ids))     patch.linked_control_ids     = strList(body.linked_control_ids);
  if (Array.isArray(body.linked_risk_ids))        patch.linked_risk_ids        = strList(body.linked_risk_ids);
  if (Array.isArray(body.linked_treatment_ids))   patch.linked_treatment_ids   = strList(body.linked_treatment_ids);
  if (Array.isArray(body.linked_dr_plan_ids))     patch.linked_dr_plan_ids     = strList(body.linked_dr_plan_ids);
  if (Array.isArray(body.linked_ir_playbook_ids)) patch.linked_ir_playbook_ids = strList(body.linked_ir_playbook_ids);
  if (Array.isArray(body.linked_incident_ids))    patch.linked_incident_ids    = strList(body.linked_incident_ids);
  if (Array.isArray(body.linked_policy_doc_ids))  patch.linked_policy_doc_ids  = strList(body.linked_policy_doc_ids);
  if (Array.isArray(body.tags))                   patch.tags                   = strList(body.tags);

  if (Object.keys(patch).length === 0) return bad('no patchable fields');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('evidence_artifacts')
    .update(patch)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .select('*')
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('not found', 404);
  return NextResponse.json({ ok: true, artifact: data as EvidenceArtifact });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const supabase = createServiceRoleClient();
  const { data: row } = await supabase
    .from('evidence_artifacts')
    .select('storage_path')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!row) return bad('not found', 404);

  if (row.storage_path) {
    await supabase.storage.from(BUCKET).remove([row.storage_path]);
  }
  const { error } = await supabase
    .from('evidence_artifacts')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
