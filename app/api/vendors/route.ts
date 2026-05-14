import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { requireEditAccess } from '@/lib/auth-api';
import type {
  Vendor, VendorCriticality, VendorDataSensitivity, VendorStatus, VendorType,
} from '@/lib/supabase/types';

/**
 * GET    /api/vendors            list every vendor for the tenant
 * POST   /api/vendors            create a vendor (requires `name`)
 * PATCH  /api/vendors            partial update by `id`
 * DELETE /api/vendors?id=…       cascade-removes attestations via FK
 */
export const dynamic = 'force-dynamic';

const TYPES: readonly VendorType[] = ['saas','msp','hardware','consulting','payments','infrastructure','contractor','other'];
const CRITS: readonly VendorCriticality[] = ['low','medium','high','critical'];
const SENS:  readonly VendorDataSensitivity[] = ['none','public','internal','confidential','pii','phi','financial','regulated'];
const STAT:  readonly VendorStatus[] = ['pending','active','offboarded'];

function bad(msg: string, code = 400) { return NextResponse.json({ error: msg }, { status: code }); }
function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('vendors')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('criticality', { ascending: false })
    .order('name', { ascending: true });
  if (error) return bad(error.message, 500);
  return NextResponse.json({ vendors: (data ?? []) as Vendor[] });
}

export async function POST(request: NextRequest) {
  const auth = await requireEditAccess(request);
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  let body: Partial<Vendor>;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const name = (body.name ?? '').trim();
  if (!name) return bad('name is required');

  const vendor_type     : VendorType            = TYPES.includes(body.vendor_type     as VendorType)            ? body.vendor_type     as VendorType            : 'saas';
  const criticality     : VendorCriticality     = CRITS.includes(body.criticality     as VendorCriticality)     ? body.criticality     as VendorCriticality     : 'medium';
  const data_sensitivity: VendorDataSensitivity = SENS .includes(body.data_sensitivity as VendorDataSensitivity) ? body.data_sensitivity as VendorDataSensitivity : 'none';
  const status          : VendorStatus          = STAT .includes(body.status           as VendorStatus)           ? body.status           as VendorStatus           : 'active';

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('vendors')
    .insert({
      tenant_id: tenant.id,
      name,
      service_description: body.service_description?.toString() ?? null,
      vendor_type, criticality, data_sensitivity, status,
      access_summary: body.access_summary?.toString() ?? null,
      owner: body.owner?.toString().trim() || null,
      primary_contact: body.primary_contact?.toString().trim() || null,
      contact_email: body.contact_email?.toString().trim() || null,
      contract_renewal_at: body.contract_renewal_at || null,
      annual_spend_usd: typeof body.annual_spend_usd === 'number' ? body.annual_spend_usd : null,
      website: body.website?.toString().trim() || null,
      notes: body.notes?.toString() ?? null,
      linked_risk_ids:     strList(body.linked_risk_ids),
      linked_control_ids:  strList(body.linked_control_ids),
      linked_incident_ids: strList(body.linked_incident_ids),
      last_assessed_at: body.last_assessed_at || null,
      next_assessment_at: body.next_assessment_at || null,
    })
    .select('*')
    .single();
  if (error || !data) return bad(error?.message ?? 'insert failed', 500);
  return NextResponse.json({ ok: true, vendor: data as Vendor });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireEditAccess(request);
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  let body: Partial<Vendor> & { id?: string };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  if (!body.id) return bad('id required');

  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string') {
    const t = body.name.trim();
    if (!t) return bad('name cannot be empty');
    patch.name = t;
  }
  if (typeof body.vendor_type === 'string'      && TYPES.includes(body.vendor_type as VendorType))           patch.vendor_type      = body.vendor_type;
  if (typeof body.criticality === 'string'      && CRITS.includes(body.criticality as VendorCriticality))    patch.criticality      = body.criticality;
  if (typeof body.data_sensitivity === 'string' && SENS .includes(body.data_sensitivity as VendorDataSensitivity)) patch.data_sensitivity = body.data_sensitivity;
  if (typeof body.status === 'string'           && STAT .includes(body.status as VendorStatus))              patch.status           = body.status;

  if ('service_description' in body) patch.service_description = body.service_description?.toString() ?? null;
  if ('access_summary'     in body) patch.access_summary     = body.access_summary?.toString() ?? null;
  if ('owner'              in body) patch.owner              = body.owner?.toString().trim() || null;
  if ('primary_contact'    in body) patch.primary_contact    = body.primary_contact?.toString().trim() || null;
  if ('contact_email'      in body) patch.contact_email      = body.contact_email?.toString().trim() || null;
  if ('contract_renewal_at' in body) patch.contract_renewal_at = body.contract_renewal_at || null;
  if ('annual_spend_usd'   in body) patch.annual_spend_usd   = typeof body.annual_spend_usd === 'number' ? body.annual_spend_usd : null;
  if ('website'            in body) patch.website            = body.website?.toString().trim() || null;
  if ('notes'              in body) patch.notes              = body.notes?.toString() ?? null;
  if ('last_assessed_at'   in body) patch.last_assessed_at   = body.last_assessed_at || null;
  if ('next_assessment_at' in body) patch.next_assessment_at = body.next_assessment_at || null;
  if (Array.isArray(body.linked_risk_ids))     patch.linked_risk_ids     = strList(body.linked_risk_ids);
  if (Array.isArray(body.linked_control_ids))  patch.linked_control_ids  = strList(body.linked_control_ids);
  if (Array.isArray(body.linked_incident_ids)) patch.linked_incident_ids = strList(body.linked_incident_ids);

  if (Object.keys(patch).length === 0) return bad('no patchable fields');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('vendors')
    .update(patch)
    .eq('id', body.id)
    .eq('tenant_id', tenant.id)
    .select('*')
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('not found', 404);
  return NextResponse.json({ ok: true, vendor: data as Vendor });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireEditAccess(request);
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return bad('id required');
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('vendors')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenant.id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
