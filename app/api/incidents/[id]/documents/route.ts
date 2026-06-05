import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { requireEditAccess } from '@/lib/auth-api';
import type { IncidentDocument } from '@/lib/supabase/types';

/**
 * GET  /api/incidents/[id]/documents — list documents attached to an incident
 * POST /api/incidents/[id]/documents — register or upload an attachment
 *
 * The POST handler accepts TWO request shapes:
 *
 *   1. multipart/form-data with a `file` field (legacy / small files):
 *      streams the bytes through Next.js → Supabase Storage. Subject to
 *      Vercel's serverless function body cap (~4.5 MB) before our code
 *      ever runs, so this path is only viable for small files.
 *
 *   2. application/json with `{storage_path, filename, content_type, size}`:
 *      the client already PUT the bytes to Supabase directly using a URL
 *      from /signed-upload. This route just verifies the path lives under
 *      the tenant + incident tree and inserts the DB row. This is the path
 *      that makes 20 MB uploads work in production.
 *
 * Files are stored under `<tenant_id>/<incident_id>/<random>-<sanitized-name>`
 * in the private `incident-documents` bucket. The DB row holds the original
 * filename + content type + size for display.
 */
export const dynamic = 'force-dynamic';
const BUCKET = 'incident-documents';
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB application cap.

function bad(msg: string, code = 400) { return NextResponse.json({ error: msg }, { status: code }); }

function safeName(name: string): string {
  // Strip path separators and normalize whitespace so the storage key stays tame.
  return name.replace(/[/\\\\]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 200) || 'file';
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('incident_documents')
    .select('*')
    .eq('incident_id', params.id)
    .eq('tenant_id', tenant.id)
    .order('created_at', { ascending: false });
  if (error) return bad(error.message, 500);
  return NextResponse.json({ documents: (data ?? []) as IncidentDocument[] });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireEditAccess(request);
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  const supabase = createServiceRoleClient();

  // Tenant-scoping guard — used by both branches below. Guards against an
  // attacker with a guessed incident ID using one tenant's URL to write into
  // another tenant's storage tree.
  const { data: inc } = await supabase
    .from('incidents')
    .select('id')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!inc) return bad('incident not found', 404);

  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
  const expectedPrefix = `${tenant.id}/${params.id}/`;

  // --- Branch 2: client already uploaded directly to Supabase, just register. ---
  if (contentType.startsWith('application/json')) {
    let body: {
      storage_path?: string;
      filename?: string;
      content_type?: string | null;
      size?: number;
    };
    try { body = await request.json(); } catch { return bad('expected JSON body'); }

    const storagePath = body.storage_path ?? '';
    const filename    = safeName(body.filename ?? 'upload');
    const size        = Number(body.size);

    if (!storagePath.startsWith(expectedPrefix)) return bad('storage_path is outside this incident');
    if (!Number.isFinite(size) || size <= 0) return bad('missing or invalid "size"');
    if (size > MAX_BYTES) return bad(`file exceeds ${MAX_BYTES / 1024 / 1024} MB`, 413);

    // Verify the blob actually landed at the path the client claims it did,
    // and pin the recorded size to what Storage saw — never trust the
    // client's reported size for the DB row.
    const dir = storagePath.slice(0, storagePath.lastIndexOf('/'));
    const file = storagePath.slice(storagePath.lastIndexOf('/') + 1);
    const { data: listed, error: listErr } = await supabase
      .storage
      .from(BUCKET)
      .list(dir, { search: file, limit: 1 });
    if (listErr) return bad(`storage check failed: ${listErr.message}`, 500);
    const found = (listed ?? []).find((o) => o.name === file);
    if (!found) return bad('file not found at storage_path — upload may have failed', 400);
    const observedSize = (found.metadata as { size?: number } | null)?.size ?? size;
    if (observedSize > MAX_BYTES) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return bad(`file exceeds ${MAX_BYTES / 1024 / 1024} MB`, 413);
    }

    const { data: row, error: rowErr } = await supabase
      .from('incident_documents')
      .insert({
        incident_id:  params.id,
        tenant_id:    tenant.id,
        storage_path: storagePath,
        filename,
        content_type: body.content_type ?? null,
        size_bytes:   observedSize,
      })
      .select('*')
      .single();
    if (rowErr || !row) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return bad(rowErr?.message ?? 'document insert failed', 500);
    }
    return NextResponse.json({ ok: true, document: row as IncidentDocument });
  }

  // --- Branch 1: legacy multipart relay — only viable for small files. ---
  let form: FormData;
  try { form = await request.formData(); } catch { return bad('expected multipart/form-data or application/json'); }
  const file = form.get('file');
  if (!(file instanceof File)) return bad('missing "file" field');
  if (file.size === 0) return bad('empty file');
  if (file.size > MAX_BYTES) return bad(`file exceeds ${MAX_BYTES / 1024 / 1024} MB`, 413);

  const filename = safeName(file.name || 'upload');
  const random = crypto.randomUUID();
  const storagePath = `${tenant.id}/${params.id}/${random}-${filename}`;
  const buf = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buf, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  if (upErr) return bad(`storage upload failed: ${upErr.message}`, 500);

  const { data: row, error: rowErr } = await supabase
    .from('incident_documents')
    .insert({
      incident_id: params.id,
      tenant_id: tenant.id,
      storage_path: storagePath,
      filename,
      content_type: file.type || null,
      size_bytes: file.size,
    })
    .select('*')
    .single();
  if (rowErr || !row) {
    // Roll back the blob if the row failed to insert.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return bad(rowErr?.message ?? 'document insert failed', 500);
  }
  return NextResponse.json({ ok: true, document: row as IncidentDocument });
}
