import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { requireEditAccess } from '@/lib/auth-api';
import type { EvidenceArtifact, EvidenceStatus } from '@/lib/supabase/types';
import { EVIDENCE_CATEGORIES } from '@/lib/supabase/types';

/**
 * GET  /api/evidence — list every evidence artifact for the current tenant,
 *      newest collected first.
 * POST /api/evidence — multipart/form-data upload. Required: title. The file
 *      is optional — a metadata-only row is fine (e.g. you're recording that
 *      a quarterly access review was completed but the artifact lives in a
 *      different system). All cross-reference arrays accept either a JSON
 *      array string or a comma-separated list.
 */
export const dynamic = 'force-dynamic';
const BUCKET = 'evidence-artifacts';
const MAX_BYTES = 50 * 1024 * 1024;  // 50 MB ceiling per artifact
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

  let form: FormData;
  try { form = await request.formData(); } catch { return bad('expected multipart/form-data'); }

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
    if (file.size > MAX_BYTES) return bad(`file exceeds ${MAX_BYTES} bytes`);
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
