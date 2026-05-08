import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import type { DrPlan, DrPlanStatus, DrTestResult, DrTier } from '@/lib/supabase/types';

/**
 * GET    /api/dr-plans          — list all DR plans for the tenant
 * POST   /api/dr-plans          — create a DR plan (only `name` is required)
 * PATCH  /api/dr-plans          — update by `id` (partial)
 * DELETE /api/dr-plans?id=…     — remove
 */
export const dynamic = 'force-dynamic';

const STATUSES: readonly DrPlanStatus[] = ['draft', 'active', 'archived'];
const RESULTS:  readonly DrTestResult[] = ['pass', 'partial', 'fail'];

function bad(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}

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
    .from('dr_plans')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('tier', { ascending: true })
    .order('name', { ascending: true });
  if (error) return bad(error.message, 500);
  return NextResponse.json({ plans: (data ?? []) as DrPlan[] });
}

export async function POST(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');
  let body: Partial<DrPlan>;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const name = (body.name ?? '').trim();
  if (!name) return bad('name is required');

  const tier: DrTier = (body.tier === 1 || body.tier === 2 || body.tier === 3) ? body.tier : 2;
  const status: DrPlanStatus = STATUSES.includes(body.status as DrPlanStatus)
    ? (body.status as DrPlanStatus) : 'draft';

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('dr_plans')
    .insert({
      tenant_id: tenant.id,
      name,
      system_name:        body.system_name?.toString().trim() || null,
      tier,
      rto_minutes:        typeof body.rto_minutes === 'number' ? body.rto_minutes : null,
      rpo_minutes:        typeof body.rpo_minutes === 'number' ? body.rpo_minutes : null,
      description:        body.description?.toString() ?? null,
      backup_method:      body.backup_method?.toString().trim() || null,
      backup_frequency:   body.backup_frequency?.toString().trim() || null,
      backup_retention:   body.backup_retention?.toString().trim() || null,
      recovery_steps:     strList(body.recovery_steps),
      recovery_owner:     body.recovery_owner?.toString().trim() || null,
      recovery_team:      strList(body.recovery_team),
      dependencies:       strList(body.dependencies),
      last_tested:        body.last_tested || null,
      last_test_result:   RESULTS.includes(body.last_test_result as DrTestResult)
                            ? body.last_test_result : null,
      last_test_notes:    body.last_test_notes?.toString() ?? null,
      next_test_due:      body.next_test_due || null,
      linked_control_ids: strList(body.linked_control_ids),
      status,
    })
    .select('*')
    .single();
  if (error || !data) return bad(error?.message ?? 'insert failed', 500);
  return NextResponse.json({ ok: true, plan: data as DrPlan });
}

export async function PATCH(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');
  let body: Partial<DrPlan> & { id?: string };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  if (!body.id) return bad('id required');

  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string') {
    const t = body.name.trim();
    if (!t) return bad('name cannot be empty');
    patch.name = t;
  }
  if (body.tier === 1 || body.tier === 2 || body.tier === 3) patch.tier = body.tier;
  if (typeof body.status === 'string' && STATUSES.includes(body.status as DrPlanStatus))
    patch.status = body.status;
  if ('system_name'      in body) patch.system_name      = body.system_name?.toString().trim() || null;
  if ('rto_minutes'      in body) patch.rto_minutes      = typeof body.rto_minutes === 'number' ? body.rto_minutes : null;
  if ('rpo_minutes'      in body) patch.rpo_minutes      = typeof body.rpo_minutes === 'number' ? body.rpo_minutes : null;
  if ('description'      in body) patch.description      = body.description?.toString() ?? null;
  if ('backup_method'    in body) patch.backup_method    = body.backup_method?.toString().trim() || null;
  if ('backup_frequency' in body) patch.backup_frequency = body.backup_frequency?.toString().trim() || null;
  if ('backup_retention' in body) patch.backup_retention = body.backup_retention?.toString().trim() || null;
  if ('recovery_owner'   in body) patch.recovery_owner   = body.recovery_owner?.toString().trim() || null;
  if ('last_tested'      in body) patch.last_tested      = body.last_tested || null;
  if ('last_test_notes'  in body) patch.last_test_notes  = body.last_test_notes?.toString() ?? null;
  if ('next_test_due'    in body) patch.next_test_due    = body.next_test_due || null;
  if ('last_test_result' in body) {
    patch.last_test_result = RESULTS.includes(body.last_test_result as DrTestResult)
      ? body.last_test_result : null;
  }
  if (Array.isArray(body.recovery_steps))     patch.recovery_steps     = strList(body.recovery_steps);
  if (Array.isArray(body.recovery_team))      patch.recovery_team      = strList(body.recovery_team);
  if (Array.isArray(body.dependencies))       patch.dependencies       = strList(body.dependencies);
  if (Array.isArray(body.linked_control_ids)) patch.linked_control_ids = strList(body.linked_control_ids);

  if (Object.keys(patch).length === 0) return bad('no patchable fields');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('dr_plans')
    .update(patch)
    .eq('id', body.id)
    .eq('tenant_id', tenant.id)
    .select('*')
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('not found', 404);
  return NextResponse.json({ ok: true, plan: data as DrPlan });
}

export async function DELETE(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return bad('id required');
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('dr_plans')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenant.id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
