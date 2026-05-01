import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import type { PolicyDocument, PolicyDocumentStatus } from '@/lib/supabase/types';

/**
 * GET    /api/policy-documents/[id] — returns the row plus a 60-second signed
 *        download URL. Bucket is private; direct URLs won't resolve.
 * PATCH  /api/policy-documents/[id] — partial metadata update.
 *        (To replace the file itself, delete + re-upload.)
 * DELETE /api/policy-documents/[id] — removes both the row and the blob.
 */
export const dynamic = 'force-dynamic';
const BUCKET = 'policy-documents';
const SIGN_TTL = 60;
const STATUSES: readonly PolicyDocumentStatus[] = ['draft', 'published', 'archived'];

function bad(msg: string, code = 400) { return NextResponse.json({ error: msg }, { status: code }); }

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('policy_documents')
    .select('*')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('not found', 404);

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(data.storage_path, SIGN_TTL, { download: data.filename });

  return NextResponse.json({
    document: data as PolicyDocument,
    download_url: signed?.signedUrl ?? null,
  });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  let body: Partial<PolicyDocument>;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const patch: Record<string, unknown> = {};
  if (typeof body.title === 'string') {
    const t = body.title.trim();
    if (!t) return bad('title cannot be empty');
    patch.title = t;
  }
  if (typeof body.status === 'string') {
    if (!STATUSES.includes(body.status as PolicyDocumentStatus)) return bad('invalid status');
    patch.status = body.status;
  }
  if ('version' in body)         patch.version        = body.version?.toString().trim() || null;
  if ('effective_date' in body)  patch.effective_date = body.effective_date || null;
  if ('owner' in body)           patch.owner          = body.owner?.toString().trim() || null;
  if ('description' in body)     patch.description    = body.description?.toString() ?? null;
  if (Array.isArray(body.linked_control_ids)) {
    patch.linked_control_ids = body.linked_control_ids.map(String).map((s) => s.trim()).filter(Boolean);
  }

  if (Object.keys(patch).length === 0) return bad('no patchable fields');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('policy_documents')
    .update(patch)
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .select('*')
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('not found', 404);
  return NextResponse.json({ ok: true, document: data as PolicyDocument });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const supabase = createServiceRoleClient();
  const { data: doc } = await supabase
    .from('policy_documents')
    .select('storage_path')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!doc) return bad('not found', 404);

  await supabase.storage.from(BUCKET).remove([doc.storage_path]);
  const { error } = await supabase
    .from('policy_documents')
    .delete()
    .eq('id', params.id)
    .eq('tenant_id', tenant.id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
