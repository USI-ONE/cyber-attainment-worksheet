import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { requireEditAccess } from '@/lib/auth-api';

/**
 * POST /api/evidence/signed-upload
 *
 * Issues a short-lived signed upload URL so the browser can PUT an
 * evidence artifact directly to Supabase Storage instead of relaying
 * through this Next.js route. The relay path (POST /api/evidence with
 * multipart body) is capped at Vercel's ~4.5 MB serverless request-body
 * limit; direct upload sidesteps that and lets us honor a real 100 MB
 * application cap.
 *
 * Request JSON:
 *   filename:     string
 *   content_type: string | null
 *   size:         number   (used for the server-side cap pre-check)
 *
 * Response JSON:
 *   signed_url:   string  — PUT the raw file body here
 *   storage_path: string  — opaque key the client echoes back to the
 *                            POST /api/evidence register call
 *   token:        string  — included for Supabase clients that prefer
 *                            uploadToSignedUrl() over a raw PUT
 *   artifact_id:  string  — the UUID we've reserved for this artifact
 *                            (client passes it back so the register step
 *                            can insert with a known id and match the
 *                            storage path prefix on the server side)
 */
export const dynamic = 'force-dynamic';
const BUCKET = 'evidence-artifacts';
const MAX_BYTES = 100 * 1024 * 1024; // 100 MB application cap

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

function safeName(name: string): string {
  return name.replace(/[/\\]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 200) || 'file';
}

export async function POST(request: NextRequest) {
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

  // Reserve the artifact id up-front so the storage path can carry it and
  // the register step can INSERT with the same id (matches how incidents
  // reserve an id in the signed-upload → register handshake).
  const artifactId = crypto.randomUUID();
  const random = crypto.randomUUID();
  const storagePath = `${tenant.id}/${artifactId}/${random}-${filename}`;

  const { data, error } = await supabase
    .storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);
  if (error || !data) return bad(error?.message ?? 'signed url failed', 500);

  return NextResponse.json({
    signed_url:   data.signedUrl,
    storage_path: data.path,
    token:        data.token,
    artifact_id:  artifactId,
  });
}
