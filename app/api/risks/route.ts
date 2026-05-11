import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import type {
  Risk,
  RiskCategory,
  RiskLevel,
  RiskStatus,
  RiskTreatmentStrategy,
} from '@/lib/supabase/types';

/**
 * GET    /api/risks          — list all risks for the tenant
 * POST   /api/risks          — create a risk
 * PATCH  /api/risks          — update by `id` (partial)
 * DELETE /api/risks?id=…     — remove (cascades treatments via FK)
 *
 * On create: if `code` is omitted, the next R-### is auto-assigned. Inherent
 * and residual scores are generated columns in Postgres, so callers send only
 * likelihood + impact; the score round-trips for free.
 */
export const dynamic = 'force-dynamic';

const CATEGORIES: readonly RiskCategory[] =
  ['cyber','operational','compliance','people','supply_chain','physical','financial'];
const STRATEGIES: readonly RiskTreatmentStrategy[] = ['accept','mitigate','transfer','avoid'];
const STATUSES:   readonly RiskStatus[] = ['open','in_treatment','accepted','closed','transferred'];

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}
function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}
function level(v: unknown, fallback: RiskLevel = 3): RiskLevel {
  const n = typeof v === 'number' ? v : Number(v);
  if (n === 1 || n === 2 || n === 3 || n === 4 || n === 5) return n as RiskLevel;
  return fallback;
}

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('risks')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('residual_score', { ascending: false })
    .order('inherent_score', { ascending: false })
    .order('code', { ascending: true });
  if (error) return bad(error.message, 500);
  return NextResponse.json({ risks: (data ?? []) as Risk[] });
}

export async function POST(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');
  let body: Partial<Risk>;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const title = (body.title ?? '').trim();
  if (!title) return bad('title is required');

  const supabase = createServiceRoleClient();

  // Auto-assign code if not supplied. Take max numeric suffix + 1; if none,
  // start at R-001.
  let code = body.code?.toString().trim() || '';
  if (!code) {
    const { data: existing } = await supabase
      .from('risks').select('code').eq('tenant_id', tenant.id);
    let max = 0;
    for (const r of (existing ?? []) as { code: string }[]) {
      const m = /^R-(\d+)$/.exec(r.code);
      if (m) max = Math.max(max, Number(m[1]));
    }
    code = `R-${String(max + 1).padStart(3, '0')}`;
  }

  const category: RiskCategory = CATEGORIES.includes(body.category as RiskCategory)
    ? (body.category as RiskCategory) : 'cyber';
  const strategy: RiskTreatmentStrategy = STRATEGIES.includes(body.treatment_strategy as RiskTreatmentStrategy)
    ? (body.treatment_strategy as RiskTreatmentStrategy) : 'mitigate';
  const status: RiskStatus = STATUSES.includes(body.status as RiskStatus)
    ? (body.status as RiskStatus) : 'open';

  const { data, error } = await supabase
    .from('risks')
    .insert({
      tenant_id: tenant.id,
      code, title,
      description:           body.description?.toString() ?? null,
      category,
      rationale:             body.rationale?.toString() ?? null,
      inherent_likelihood:   level(body.inherent_likelihood),
      inherent_impact:       level(body.inherent_impact),
      residual_likelihood:   level(body.residual_likelihood, level(body.inherent_likelihood)),
      residual_impact:       level(body.residual_impact,     level(body.inherent_impact)),
      treatment_strategy:    strategy,
      owner:                 body.owner?.toString().trim() || null,
      status,
      linked_control_ids:    strList(body.linked_control_ids),
      linked_dr_plan_ids:    strList(body.linked_dr_plan_ids),
      linked_ir_playbook_ids: strList(body.linked_ir_playbook_ids),
      linked_incident_ids:   strList(body.linked_incident_ids),
      last_reviewed:         body.last_reviewed || null,
      next_review_due:       body.next_review_due || null,
    })
    .select('*')
    .single();
  if (error || !data) return bad(error?.message ?? 'insert failed', 500);
  return NextResponse.json({ ok: true, risk: data as Risk });
}

export async function PATCH(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');
  let body: Partial<Risk> & { id?: string };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  if (!body.id) return bad('id required');

  const patch: Record<string, unknown> = {};
  if (typeof body.code === 'string') {
    const t = body.code.trim();
    if (!t) return bad('code cannot be empty');
    patch.code = t;
  }
  if (typeof body.title === 'string') {
    const t = body.title.trim();
    if (!t) return bad('title cannot be empty');
    patch.title = t;
  }
  if (typeof body.category === 'string' && CATEGORIES.includes(body.category as RiskCategory))
    patch.category = body.category;
  if (typeof body.treatment_strategy === 'string' && STRATEGIES.includes(body.treatment_strategy as RiskTreatmentStrategy))
    patch.treatment_strategy = body.treatment_strategy;
  if (typeof body.status === 'string' && STATUSES.includes(body.status as RiskStatus))
    patch.status = body.status;

  if ('description'         in body) patch.description         = body.description?.toString() ?? null;
  if ('rationale'           in body) patch.rationale           = body.rationale?.toString() ?? null;
  if ('owner'               in body) patch.owner               = body.owner?.toString().trim() || null;
  if ('last_reviewed'       in body) patch.last_reviewed       = body.last_reviewed || null;
  if ('next_review_due'     in body) patch.next_review_due     = body.next_review_due || null;
  if ('inherent_likelihood' in body) patch.inherent_likelihood = level(body.inherent_likelihood);
  if ('inherent_impact'     in body) patch.inherent_impact     = level(body.inherent_impact);
  if ('residual_likelihood' in body) patch.residual_likelihood = level(body.residual_likelihood);
  if ('residual_impact'     in body) patch.residual_impact     = level(body.residual_impact);

  if (Array.isArray(body.linked_control_ids))     patch.linked_control_ids     = strList(body.linked_control_ids);
  if (Array.isArray(body.linked_dr_plan_ids))     patch.linked_dr_plan_ids     = strList(body.linked_dr_plan_ids);
  if (Array.isArray(body.linked_ir_playbook_ids)) patch.linked_ir_playbook_ids = strList(body.linked_ir_playbook_ids);
  if (Array.isArray(body.linked_incident_ids))    patch.linked_incident_ids    = strList(body.linked_incident_ids);

  if (Object.keys(patch).length === 0) return bad('no patchable fields');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('risks')
    .update(patch)
    .eq('id', body.id)
    .eq('tenant_id', tenant.id)
    .select('*')
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('not found', 404);
  return NextResponse.json({ ok: true, risk: data as Risk });
}

export async function DELETE(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return bad('id required');
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('risks')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenant.id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
