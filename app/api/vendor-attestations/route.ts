import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { requireEditAccess } from '@/lib/auth-api';
import type { AttestationStatus, AttestationType, VendorAttestation } from '@/lib/supabase/types';

/**
 * GET    /api/vendor-attestations?vendor_id=…   list for one vendor
 * GET    /api/vendor-attestations               list every attestation for the tenant
 * POST   /api/vendor-attestations               create (requires vendor_id + attestation_type + title)
 * PATCH  /api/vendor-attestations               partial update by id
 * DELETE /api/vendor-attestations?id=…          remove
 */
export const dynamic = 'force-dynamic';

const TYPES: readonly AttestationType[] = [
  'soc2_type1','soc2_type2','iso_27001','iso_27017','iso_27018','iso_27701',
  'pci_dss','hipaa_baa','fedramp_high','fedramp_moderate','cmmc',
  'cyber_insurance','penetration_test','vulnerability_scan',
  'tpsa','ddq',
  'other',
];
const STATS: readonly AttestationStatus[] = ['pending','current','expired','superseded','archived'];

function bad(msg: string, code = 400) { return NextResponse.json({ error: msg }, { status: code }); }

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');
  const url = new URL(request.url);
  const vendorId = url.searchParams.get('vendor_id');
  const supabase = createServiceRoleClient();
  let qb = supabase.from('vendor_attestations').select('*').eq('tenant_id', tenant.id);
  if (vendorId) qb = qb.eq('vendor_id', vendorId);
  const { data, error } = await qb.order('expires_on', { ascending: true, nullsFirst: false });
  if (error) return bad(error.message, 500);
  return NextResponse.json({ attestations: (data ?? []) as VendorAttestation[] });
}

export async function POST(request: NextRequest) {
  const auth = await requireEditAccess(request);
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  let body: Partial<VendorAttestation>;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const vendor_id = body.vendor_id?.toString();
  const attestation_type = body.attestation_type as AttestationType;
  const title = (body.title ?? '').toString().trim();
  if (!vendor_id) return bad('vendor_id required');
  if (!TYPES.includes(attestation_type)) return bad('invalid attestation_type');
  if (!title) return bad('title required');

  const supabase = createServiceRoleClient();
  // Verify the vendor belongs to this tenant.
  const { data: parent } = await supabase
    .from('vendors').select('id, tenant_id').eq('id', vendor_id).maybeSingle();
  if (!parent || parent.tenant_id !== tenant.id) return bad('vendor not found', 404);

  const status: AttestationStatus = STATS.includes(body.status as AttestationStatus)
    ? (body.status as AttestationStatus) : 'current';

  const { data, error } = await supabase
    .from('vendor_attestations')
    .insert({
      tenant_id: tenant.id, vendor_id,
      attestation_type, title,
      issued_on: body.issued_on || null,
      expires_on: body.expires_on || null,
      status,
      evidence_artifact_id: body.evidence_artifact_id?.toString() || null,
      findings_critical: typeof body.findings_critical === 'number' ? body.findings_critical : 0,
      findings_major:    typeof body.findings_major    === 'number' ? body.findings_major    : 0,
      findings_minor:    typeof body.findings_minor    === 'number' ? body.findings_minor    : 0,
      notes: body.notes?.toString() ?? null,
      // Caller may pre-populate the checklist (e.g. with the default
      // template); otherwise it stays null until the UI seeds one on
      // first open.
      checklist: body.checklist ?? null,
    })
    .select('*')
    .single();
  if (error || !data) return bad(error?.message ?? 'insert failed', 500);
  return NextResponse.json({ ok: true, attestation: data as VendorAttestation });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireEditAccess(request);
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  let body: Partial<VendorAttestation> & { id?: string };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  if (!body.id) return bad('id required');

  const patch: Record<string, unknown> = {};
  if (typeof body.title === 'string') {
    const t = body.title.trim();
    if (!t) return bad('title cannot be empty');
    patch.title = t;
  }
  if (typeof body.attestation_type === 'string' && TYPES.includes(body.attestation_type as AttestationType))
    patch.attestation_type = body.attestation_type;
  if (typeof body.status === 'string' && STATS.includes(body.status as AttestationStatus))
    patch.status = body.status;
  if ('issued_on'  in body) patch.issued_on  = body.issued_on  || null;
  if ('expires_on' in body) patch.expires_on = body.expires_on || null;
  if ('evidence_artifact_id' in body) patch.evidence_artifact_id = body.evidence_artifact_id?.toString() || null;
  if (typeof body.findings_critical === 'number') patch.findings_critical = body.findings_critical;
  if (typeof body.findings_major    === 'number') patch.findings_major    = body.findings_major;
  if (typeof body.findings_minor    === 'number') patch.findings_minor    = body.findings_minor;
  if ('notes' in body) patch.notes = body.notes?.toString() ?? null;
  // Checklist is sent as the full object on each save — UI debounces
  // writes so we don't store one row per keystroke. Server doesn't
  // shape-validate the items beyond accepting the JSON.
  if ('checklist' in body) patch.checklist = body.checklist ?? null;

  if (Object.keys(patch).length === 0) return bad('no patchable fields');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('vendor_attestations')
    .update(patch)
    .eq('id', body.id)
    .eq('tenant_id', tenant.id)
    .select('*')
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('not found', 404);
  return NextResponse.json({ ok: true, attestation: data as VendorAttestation });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireEditAccess(request);
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return bad('id required');
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('vendor_attestations')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenant.id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
