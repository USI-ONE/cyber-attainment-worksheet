import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import type { PolicyDocument, PolicyDocumentStatus } from '@/lib/supabase/types';

/**
 * GET  /api/policy-documents — list policy documents for the current tenant.
 * POST /api/policy-documents — upload a new policy document. Multipart/form-data
 *   with field "file" (the binary) and optional metadata fields:
 *   title, version, effective_date (yyyy-mm-dd), owner, status,
 *   description, linked_control_ids (comma-separated or JSON array).
 */
export const dynamic = 'force-dynamic';
const BUCKET = 'policy-documents';
const MAX_BYTES = 25 * 1024 * 1024;
const STATUSES: readonly PolicyDocumentStatus[] = ['draft', 'published', 'archived'];

function bad(msg: string, code = 400) { return NextResponse.json({ error: msg }, { status: code }); }

function safeName(name: string): string {
  return name.replace(/[/\\\\]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 200) || 'file';
}

/** Parse "PR.AA-01, DE.AE-02" or '["PR.AA-01","DE.AE-02"]' uniformly. */
function parseControlIds(raw: FormDataEntryValue | null): string[] {
  if (!raw) return [];
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try { const a = JSON.parse(s); return Array.isArray(a) ? a.map(String).map((x) => x.trim()).filter(Boolean) : []; }
    catch { /* fall through */ }
  }
  return s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
}

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('policy_documents')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('effective_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) return bad(error.message, 500);
  return NextResponse.json({ documents: (data ?? []) as PolicyDocument[] });
}

export async function POST(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  let form: FormData;
  try { form = await request.formData(); } catch { return bad('expected multipart/form-data'); }
  const file = form.get('file');
  if (!(file instanceof File)) return bad('missing "file" field');
  if (file.size === 0) return bad('empty file');
  if (file.size > MAX_BYTES) return bad(`file exceeds ${MAX_BYTES} bytes`);

  const title = (form.get('title')?.toString() ?? '').trim() || file.name;
  const status: PolicyDocumentStatus = STATUSES.includes(form.get('status')?.toString() as PolicyDocumentStatus)
    ? (form.get('status')!.toString() as PolicyDocumentStatus)
    : 'published';

  const supabase = createServiceRoleClient();

  const filename = safeName(file.name || 'upload');
  const random = crypto.randomUUID();
  const docId  = crypto.randomUUID();
  const storagePath = `${tenant.id}/${docId}/${random}-${filename}`;
  const buf = new Uint8Array(await file.arrayBuffer());

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buf, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
  if (upErr) return bad(`storage upload failed: ${upErr.message}`, 500);

  const { data: row, error: rowErr } = await supabase
    .from('policy_documents')
    .insert({
      id: docId,
      tenant_id: tenant.id,
      title,
      version: form.get('version')?.toString().trim() || null,
      effective_date: form.get('effective_date')?.toString() || null,
      owner: form.get('owner')?.toString().trim() || null,
      status,
      description: form.get('description')?.toString() || null,
      storage_path: storagePath,
      filename,
      content_type: file.type || null,
      size_bytes: file.size,
      linked_control_ids: parseControlIds(form.get('linked_control_ids')),
    })
    .select('*')
    .single();
  if (rowErr || !row) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return bad(rowErr?.message ?? 'document insert failed', 500);
  }
  return NextResponse.json({ ok: true, document: row as PolicyDocument });
}
