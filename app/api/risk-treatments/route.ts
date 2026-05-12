import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { requireEditAccess } from '@/lib/auth-api';
import type { RiskTreatment, RiskTreatmentStatus } from '@/lib/supabase/types';

/**
 * GET    /api/risk-treatments?risk_id=… — list treatments for a risk
 * GET    /api/risk-treatments            — list every treatment for the tenant
 * POST   /api/risk-treatments            — create (requires risk_id + action)
 * PATCH  /api/risk-treatments            — partial update by id
 * DELETE /api/risk-treatments?id=…       — remove
 *
 * Status "Complete" auto-fills completed_at; transitioning out of "Complete"
 * clears it. Mirrors the work_plan_tasks convention.
 */
export const dynamic = 'force-dynamic';

const STATUSES: readonly RiskTreatmentStatus[] = ['Not Started','In Progress','Blocked','Complete'];

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');
  const supabase = createServiceRoleClient();
  const url = new URL(request.url);
  const riskId = url.searchParams.get('risk_id');
  let qb = supabase.from('risk_treatments').select('*').eq('tenant_id', tenant.id);
  if (riskId) qb = qb.eq('risk_id', riskId);
  const { data, error } = await qb
    .order('risk_id', { ascending: true })
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return bad(error.message, 500);
  return NextResponse.json({ treatments: (data ?? []) as RiskTreatment[] });
}

export async function POST(request: NextRequest) {
  const auth = await requireEditAccess(request);
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  let body: Partial<RiskTreatment>;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const risk_id = body.risk_id?.toString();
  const action = (body.action ?? '').toString().trim();
  if (!risk_id) return bad('risk_id is required');
  if (!action)  return bad('action is required');

  const supabase = createServiceRoleClient();

  // Validate that the risk belongs to this tenant.
  const { data: parent, error: pErr } = await supabase
    .from('risks').select('id, tenant_id').eq('id', risk_id).maybeSingle();
  if (pErr || !parent || parent.tenant_id !== tenant.id) return bad('risk not found', 404);

  const status: RiskTreatmentStatus = STATUSES.includes(body.status as RiskTreatmentStatus)
    ? (body.status as RiskTreatmentStatus) : 'Not Started';

  // Determine next display_order = max + 1 for this risk.
  const { data: siblings } = await supabase
    .from('risk_treatments').select('display_order').eq('risk_id', risk_id);
  const nextOrder = (siblings ?? []).reduce((m, r) => Math.max(m, (r as { display_order: number }).display_order), -1) + 1;

  const { data, error } = await supabase
    .from('risk_treatments')
    .insert({
      risk_id,
      tenant_id: tenant.id,
      action,
      detail:        body.detail?.toString() ?? null,
      status,
      owner:         body.owner?.toString().trim() || null,
      due_date:      body.due_date || null,
      completed_at:  status === 'Complete' ? new Date().toISOString() : null,
      display_order: typeof body.display_order === 'number' ? body.display_order : nextOrder,
    })
    .select('*')
    .single();
  if (error || !data) return bad(error?.message ?? 'insert failed', 500);
  return NextResponse.json({ ok: true, treatment: data as RiskTreatment });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireEditAccess(request);
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  let body: Partial<RiskTreatment> & { id?: string };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  if (!body.id) return bad('id required');

  const patch: Record<string, unknown> = {};
  if (typeof body.action === 'string') {
    const t = body.action.trim();
    if (!t) return bad('action cannot be empty');
    patch.action = t;
  }
  if (typeof body.status === 'string' && STATUSES.includes(body.status as RiskTreatmentStatus)) {
    patch.status = body.status;
    patch.completed_at = body.status === 'Complete' ? new Date().toISOString() : null;
  }
  if ('detail'        in body) patch.detail        = body.detail?.toString() ?? null;
  if ('owner'         in body) patch.owner         = body.owner?.toString().trim() || null;
  if ('due_date'      in body) patch.due_date      = body.due_date || null;
  if ('display_order' in body && typeof body.display_order === 'number') patch.display_order = body.display_order;

  if (Object.keys(patch).length === 0) return bad('no patchable fields');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('risk_treatments')
    .update(patch)
    .eq('id', body.id)
    .eq('tenant_id', tenant.id)
    .select('*')
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('not found', 404);
  return NextResponse.json({ ok: true, treatment: data as RiskTreatment });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireEditAccess(request);
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return bad('id required');
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('risk_treatments')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenant.id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
