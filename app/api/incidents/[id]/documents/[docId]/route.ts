import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';

/**
 * GET    /api/incidents/[id]/documents/[docId] — returns a 60-second signed
 *        download URL. The bucket is private, so direct URLs won't resolve.
 * DELETE /api/incidents/[id]/documents/[docId] — removes the row and the blob.
 */
export const dynamic = 'force-dynamic';
const BUCKET = 'incident-documents';
const SIGN_TTL = 60; // seconds

function bad(msg: string, code = 400) { return NextResponse.json({ error: msg }, { status: code }); }

export async function GET(request: NextRequest, { params }: { params: { id: string; docId: string } }) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const supabase = createServiceRoleClient();
  const { data: doc, error } = await supabase
    .from('incident_documents')
    .select('storage_path, filename, content_type')
    .eq('id', params.docId)
    .eq('incident_id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!doc) return bad('not found', 404);

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(doc.storage_path, SIGN_TTL, { download: doc.filename });
  if (signErr || !signed) return bad(signErr?.message ?? 'sign failed', 500);
  return NextResponse.json({ url: signed.signedUrl, filename: doc.filename, content_type: doc.content_type });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string; docId: string } }) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const supabase = createServiceRoleClient();
  const { data: doc } = await supabase
    .from('incident_documents')
    .select('storage_path')
    .eq('id', params.docId)
    .eq('incident_id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!doc) return bad('not found', 404);

  await supabase.storage.from(BUCKET).remove([doc.storage_path]);
  const { error } = await supabase
    .from('incident_documents')
    .delete()
    .eq('id', params.docId)
    .eq('tenant_id', tenant.id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
