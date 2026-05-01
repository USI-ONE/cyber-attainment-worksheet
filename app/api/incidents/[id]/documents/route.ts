import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import type { IncidentDocument } from '@/lib/supabase/types';

/**
 * GET  /api/incidents/[id]/documents — list documents attached to an incident
 * POST /api/incidents/[id]/documents — upload a file (multipart/form-data, field "file")
 *
 * Files are stored under `<tenant_id>/<incident_id>/<random>-<sanitized-name>`
 * in the private `incident-documents` bucket. The DB row holds the original
 * filename + content type + size for display.
 */
export const dynamic = 'force-dynamic';
const BUCKET = 'incident-documents';
const MAX_BYTES = 25 * 1024 * 1024; // 25 MB upload cap — covers PDFs/screenshots, blocks runaway uploads.

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
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  let form: FormData;
  try { form = await request.formData(); } catch { return bad('expected multipart/form-data'); }
  const file = form.get('file');
  if (!(file instanceof File)) return bad('missing "file" field');
  if (file.size === 0) return bad('empty file');
  if (file.size > MAX_BYTES) return bad(`file exceeds ${MAX_BYTES} bytes`);

  const supabase = createServiceRoleClient();

  // Confirm the incident belongs to the current tenant — guards against an
  // attacker with a guessed incident ID using one tenant's URL to write into
  // another tenant's storage tree.
  const { data: inc } = await supabase
    .from('incidents')
    .select('id')
    .eq('id', params.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (!inc) return bad('incident not found', 404);

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
