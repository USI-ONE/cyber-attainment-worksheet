import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { requireEditAccess } from '@/lib/auth-api';

/**
 * POST /api/incidents/[id]/documents/signed-upload
 *
 * Issues a short-lived signed upload URL so the browser can PUT the file
 * directly to Supabase Storage instead of relaying through this Next.js
 * route. The relay path was capped at Vercel's ~4.5 MB serverless request-
 * body limit; direct upload sidesteps that and lets us honor a real
 * 20 MB application cap.
 *
 * Request JSON:
 *   filename:      string
 *   content_type:  string | null
 *   size:          number   (used for the server-side cap pre-check)
 *
 * Response JSON:
 *   signed_url:   string   — PUT the raw file body here
 *   storage_path: string   — opaque key the client echoes back to the
 *                            POST /documents register call
 *   token:        string   — included for Supabase clients that prefer
 *                            uploadToSignedUrl() over a raw PUT
 */
export const dynamic = 'force-dynamic';
const BUCKET = 'incident-documents';
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB application cap.

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

function safeName(name: string): string {
  return name.replace(/[/\\]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 200) || 'file';
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireEditAccess(request);
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  let body: { filename?: string; content_type?: string | null; size?: number };
  try { body = await request.json(); } catch { return bad('expected JSON body'); }

  const filename = safeName(body.filename ?? 'upload');
  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0) return bad('missing or invalid "size"');
  if (size > MAX_BYTES) {
    return bad(`file exceeds ${MAX_BYTES / 1024 / 1024} MB`, 413);
  }

  const supabase = createServiceRoleClient();

  // Same tenant-scoping guard the multipart route uses.
  const { data: inc } = await supabase
    .from('incidents')
    .select('id')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!inc) return bad('incident not found', 404);

  const random = crypto.randomUUID();
  const storagePath = `${tenant.id}/${params.id}/${random}-${filename}`;

  const { data, error } = await supabase
    .storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);
  if (error || !data) return bad(error?.message ?? 'signed url failed', 500);

  return NextResponse.json({
    signed_url:   data.signedUrl,
    storage_path: data.path,
    token:        data.token,
  });
}
