import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';

/**
 * GET /api/policy-documents/[id]/content
 *
 * Streams the document's raw bytes back to the browser with
 * `Content-Disposition: inline` so the browser renders it in-place
 * (PDFs in an <iframe>, images directly, etc.) instead of triggering
 * a download.
 *
 * Tenant-scoped — the document's tenant_id must match the host's tenant.
 * The bucket is private; this route is the only way to retrieve content
 * inline.
 */
export const dynamic = 'force-dynamic';
const BUCKET = 'policy-documents';

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved', 404);

  const supabase = createServiceRoleClient();
  const { data: doc, error } = await supabase
    .from('policy_documents')
    .select('storage_path, filename, content_type')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!doc) return bad('not found', 404);

  const { data: blob, error: dlErr } = await supabase
    .storage
    .from(BUCKET)
    .download(doc.storage_path);
  if (dlErr || !blob) return bad(dlErr?.message ?? 'download failed', 500);

  const contentType =
    doc.content_type ||
    blob.type ||
    'application/octet-stream';

  // Quote the filename so spaces / punctuation don't break parsing.
  const safeName = (doc.filename ?? 'document').replace(/"/g, '');

  return new NextResponse(blob, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${safeName}"`,
      // Short cache — the document body itself rarely changes for a given id,
      // but tenant access can revoke at any time, so keep it private.
      'Cache-Control': 'private, max-age=60',
    },
  });
}
