import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { requireEditAccess } from '@/lib/auth-api';
import type { EvidenceArtifact, EvidenceStatus } from '@/lib/supabase/types';
import { EVIDENCE_CATEGORIES } from '@/lib/supabase/types';

/**
 * GET  /api/evidence — list every evidence artifact for the current tenant,
 *      newest collected first.
 * POST /api/evidence — accepts TWO request shapes:
 *
 *   1. multipart/form-data (legacy / small files / metadata-only):
 *      streams the bytes through Next.js → Supabase Storage. Subject to
 *      Vercel's serverless function body cap (~4.5 MB) before our code
 *      ever runs, so this path is only viable for files under that cap
 *      or for metadata-only records.
 *
 *   2. application/json with `{title, ..., storage_path, filename,
 *      content_type, size, artifact_id}`:
 *      the client has already PUT the bytes to Supabase directly using
 *      a URL from /signed-upload. This route just verifies the path lives
 *      under this tenant + the reserved artifact id, and inserts the DB
 *      row. This is the path that makes up-to-100 MB uploads work in
 *      production.
 *
 * All cross-reference arrays accept either a JSON array string or a
 * comma-separated list (multipart mode); JSON mode expects proper arrays.
 */
export const dynamic = 'force-dynamic';
const BUCKET = 'evidence-artifacts';
const MAX_BYTES = 100 * 1024 * 1024; // 100 MB application cap
const STATUSES: readonly EvidenceStatus[] = ['current','superseded','expired','archived'];

function bad(msg: string, code = 400) { return NextResponse.json({ error: msg }, { status: code }); }

function safeName(name: string): string {
  return name.replace(/[/\\]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 200) || 'file';
}

function parseStringArray(raw: FormDataEntryValue | null): string[] {
  if (!raw) return [];
  const s = String(raw).trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const a = JSON.parse(s);
      return Array.isArray(a) ? a.map(String).map((x) => x.trim()).filter(Boolean) : [];
    } catch { /* fall through to CSV path */ }
  }
  return s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
}

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('evidence_artifacts')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('collected_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) return bad(error.message, 500);
  return NextResponse.json({ artifacts: (data ?? []) as EvidenceArtifact[] });
}

export async function POST(request: NextRequest) {
  const auth = await requireEditAccess(request);
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();

  // ---- JSON register mode (post direct-upload via /signed-upload) ----
  if (contentType.startsWith('application/json')) {
    return registerAfterDirectUpload(request, tenant.id);
  }

  // ---- Legacy multipart path (backward compat + metadata-only) ----
  let form: FormData;
  try { form = await request.formData(); } catch { return bad('expected multipart/form-data or application/json'); }

  const title = (form.get('title')?.toString() ?? '').trim();
  if (!title) return bad('title is required');

  const categoryRaw = (form.get('category')?.toString() ?? 'other').trim();
  // Allow any non-empty string in DB; UI exposes the EVIDENCE_CATEGORIES set.
  const category = categoryRaw || 'other';

  const statusRaw = form.get('status')?.toString() as EvidenceStatus | null;
  const status: EvidenceStatus = STATUSES.includes(statusRaw as EvidenceStatus)
    ? (statusRaw as EvidenceStatus) : 'current';

  const supabase = createServiceRoleClient();

  // Optional file. If present, store under a unique path then write the row.
  const file = form.get('file');
  let storage_path: string | null = null;
  let filename: string | null = null;
  let content_type: string | null = null;
  let size_bytes: number | null = null;

  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_BYTES) return bad(`file exceeds ${MAX_BYTES / 1024 / 1024} MB`, 413);
    const artifactId = crypto.randomUUID();
    const random = crypto.randomUUID();
    filename = safeName(file.name || 'upload');
    storage_path = `${tenant.id}/${artifactId}/${random}-${filename}`;
    content_type = file.type || 'application/octet-stream';
    size_bytes = file.size;

    const buf = new Uint8Array(await file.arrayBuffer());
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storage_path, buf, { contentType: content_type, upsert: false });
    if (upErr) return bad(`storage upload failed: ${upErr.message}`, 500);
  }

  const { data: row, error: rowErr } = await supabase
    .from('evidence_artifacts')
    .insert({
      tenant_id: tenant.id,
      title,
      description: form.get('description')?.toString() || null,
      category,
      storage_path,
      filename,
      content_type,
      size_bytes,
      uploaded_by: form.get('uploaded_by')?.toString().trim() || null,
      collected_date: form.get('collected_date')?.toString() || null,
      retention_until: form.get('retention_until')?.toString() || null,
      status,
      linked_control_ids:     parseStringArray(form.get('linked_control_ids')),
      linked_risk_ids:        parseStringArray(form.get('linked_risk_ids')),
      linked_treatment_ids:   parseStringArray(form.get('linked_treatment_ids')),
      linked_dr_plan_ids:     parseStringArray(form.get('linked_dr_plan_ids')),
      linked_ir_playbook_ids: parseStringArray(form.get('linked_ir_playbook_ids')),
      linked_incident_ids:    parseStringArray(form.get('linked_incident_ids')),
      linked_policy_doc_ids:  parseStringArray(form.get('linked_policy_doc_ids')),
      tags:                   parseStringArray(form.get('tags')),
    })
    .select('*')
    .single();

  if (rowErr || !row) {
    // Best-effort: clean up the orphaned blob if the DB insert failed.
    if (storage_path) await supabase.storage.from(BUCKET).remove([storage_path]);
    return bad(rowErr?.message ?? 'insert failed', 500);
  }

  // Silence unused-import lint when categories aren't strictly validated here;
  // they're still exported for the UI.
  void EVIDENCE_CATEGORIES;

  return NextResponse.json({ ok: true, artifact: row as EvidenceArtifact });
}

// -----------------------------------------------------------------------------
// JSON register mode — used after the client has PUT the file directly to
// Supabase Storage via a URL from /signed-upload. We verify the blob actually
// landed at the claimed path (and inside this tenant's prefix + reserved
// artifact id), pin size_bytes to what Storage observed, then insert the row.
// -----------------------------------------------------------------------------
async function registerAfterDirectUpload(request: NextRequest, tenantId: string) {
  let body: {
    title?: string;
    description?: string | null;
    category?: string;
    status?: EvidenceStatus;
    uploaded_by?: string | null;
    collected_date?: string | null;
    retention_until?: string | null;
    last_reviewed_at?: string | null;
    review_expires_at?: string | null;
    linked_control_ids?: string[];
    linked_risk_ids?: string[];
    linked_treatment_ids?: string[];
    linked_dr_plan_ids?: string[];
    linked_ir_playbook_ids?: string[];
    linked_incident_ids?: string[];
    linked_policy_doc_ids?: string[];
    tags?: string[];
    // Direct-upload fields:
    artifact_id?: string;
    storage_path?: string;
    filename?: string;
    content_type?: string | null;
    size?: number;
  };
  try { body = await request.json(); } catch { return bad('expected JSON body'); }

  const title = (body.title ?? '').trim();
  if (!title) return bad('title is required');

  const artifactId  = body.artifact_id?.trim() ?? '';
  const storagePath = body.storage_path?.trim() ?? '';
  const filename    = safeName(body.filename ?? 'upload');
  const claimedSize = Number(body.size);
  if (!artifactId)  return bad('artifact_id required');
  if (!storagePath) return bad('storage_path required');
  if (!Number.isFinite(claimedSize) || claimedSize <= 0) return bad('missing or invalid "size"');
  if (claimedSize > MAX_BYTES) return bad(`file exceeds ${MAX_BYTES / 1024 / 1024} MB`, 413);

  // The storage_path must be under this tenant's + this artifact's prefix.
  // Guards against a caller passing back a storage_path from a different
  // tenant or forging a path they didn't reserve.
  const expectedPrefix = `${tenantId}/${artifactId}/`;
  if (!storagePath.startsWith(expectedPrefix)) return bad('storage_path is outside this tenant / artifact scope');

  const supabase = createServiceRoleClient();

  // Verify the blob actually landed at the path the client claims, and
  // pin the recorded size to what Storage saw — never trust the client's
  // reported size for the DB row.
  const dir  = storagePath.slice(0, storagePath.lastIndexOf('/'));
  const name = storagePath.slice(storagePath.lastIndexOf('/') + 1);
  const { data: listed, error: listErr } = await supabase
    .storage
    .from(BUCKET)
    .list(dir, { search: name, limit: 1 });
  if (listErr) return bad(`storage check failed: ${listErr.message}`, 500);
  const found = (listed ?? []).find((o) => o.name === name);
  if (!found) return bad('file not found at storage_path — upload may have failed');
  const observedSize = (found.metadata as { size?: number } | null)?.size ?? claimedSize;
  if (observedSize > MAX_BYTES) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return bad(`file exceeds ${MAX_BYTES / 1024 / 1024} MB`, 413);
  }

  const statusRaw = body.status;
  const status: EvidenceStatus = STATUSES.includes(statusRaw as EvidenceStatus)
    ? (statusRaw as EvidenceStatus) : 'current';

  const { data: row, error: rowErr } = await supabase
    .from('evidence_artifacts')
    .insert({
      id:                     artifactId,
      tenant_id:              tenantId,
      title,
      description:            body.description ?? null,
      category:               (body.category ?? 'other').trim() || 'other',
      storage_path:           storagePath,
      filename,
      content_type:           body.content_type ?? 'application/octet-stream',
      size_bytes:             observedSize,
      uploaded_by:            body.uploaded_by ?? null,
      collected_date:         body.collected_date  || null,
      retention_until:        body.retention_until || null,
      last_reviewed_at:       body.last_reviewed_at  || null,
      review_expires_at:      body.review_expires_at || null,
      status,
      linked_control_ids:     Array.isArray(body.linked_control_ids)     ? body.linked_control_ids     : [],
      linked_risk_ids:        Array.isArray(body.linked_risk_ids)        ? body.linked_risk_ids        : [],
      linked_treatment_ids:   Array.isArray(body.linked_treatment_ids)   ? body.linked_treatment_ids   : [],
      linked_dr_plan_ids:     Array.isArray(body.linked_dr_plan_ids)     ? body.linked_dr_plan_ids     : [],
      linked_ir_playbook_ids: Array.isArray(body.linked_ir_playbook_ids) ? body.linked_ir_playbook_ids : [],
      linked_incident_ids:    Array.isArray(body.linked_incident_ids)    ? body.linked_incident_ids    : [],
      linked_policy_doc_ids:  Array.isArray(body.linked_policy_doc_ids)  ? body.linked_policy_doc_ids  : [],
      tags:                   Array.isArray(body.tags)                   ? body.tags                   : [],
    })
    .select('*')
    .single();
  if (rowErr || !row) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return bad(rowErr?.message ?? 'insert failed', 500);
  }
  return NextResponse.json({ ok: true, artifact: row as EvidenceArtifact });
}
