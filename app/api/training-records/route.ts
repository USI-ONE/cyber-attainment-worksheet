import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { requireEditAccess } from '@/lib/auth-api';
import type { TrainingRecord, TrainingRecordStatus } from '@/lib/supabase/types';

/**
 * GET    /api/training-records?campaign_id=…   list records for one campaign
 * GET    /api/training-records                  list every record for the tenant
 * POST   /api/training-records                  create (requires campaign_id +
 *                                               trainee identifier — at least
 *                                               email OR name)
 * PATCH  /api/training-records                  partial update by id
 * DELETE /api/training-records?id=…            remove
 *
 * Status auto-flips:
 *   - Setting completed_at → status = 'complete'
 *   - Clearing completed_at when status was 'complete' → 'assigned'
 *   - status='complete' without completed_at → server stamps completed_at = now
 */
export const dynamic = 'force-dynamic';

const STATUSES: readonly TrainingRecordStatus[] =
  ['assigned','in_progress','complete','overdue','exempt','failed'];

function bad(msg: string, code = 400) { return NextResponse.json({ error: msg }, { status: code }); }

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');
  const url = new URL(request.url);
  const campaignId = url.searchParams.get('campaign_id');
  const supabase = createServiceRoleClient();
  let qb = supabase.from('training_records').select('*').eq('tenant_id', tenant.id);
  if (campaignId) qb = qb.eq('campaign_id', campaignId);
  const { data, error } = await qb.order('due_date', { ascending: true, nullsFirst: false });
  if (error) return bad(error.message, 500);
  return NextResponse.json({ records: (data ?? []) as TrainingRecord[] });
}

export async function POST(request: NextRequest) {
  const auth = await requireEditAccess(request);
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  let body: Partial<TrainingRecord>;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  const campaign_id = body.campaign_id?.toString();
  if (!campaign_id) return bad('campaign_id required');
  if (!body.trainee_email && !body.trainee_name) {
    return bad('at least one of trainee_email or trainee_name is required');
  }

  const supabase = createServiceRoleClient();
  // Tenant-scope: confirm the campaign belongs to this tenant.
  const { data: parent } = await supabase
    .from('training_campaigns').select('id, tenant_id').eq('id', campaign_id).maybeSingle();
  if (!parent || parent.tenant_id !== tenant.id) return bad('campaign not found', 404);

  const status: TrainingRecordStatus = STATUSES.includes(body.status as TrainingRecordStatus)
    ? (body.status as TrainingRecordStatus) : 'assigned';
  const completed_at = status === 'complete' && !body.completed_at
    ? new Date().toISOString().slice(0, 10) : (body.completed_at ?? null);

  const { data, error } = await supabase
    .from('training_records')
    .insert({
      tenant_id: tenant.id, campaign_id,
      trainee_email: body.trainee_email?.toString().trim() || null,
      trainee_name:  body.trainee_name?.toString().trim()  || null,
      trainee_role:  body.trainee_role?.toString().trim()  || null,
      assigned_at: body.assigned_at || new Date().toISOString().slice(0, 10),
      due_date: body.due_date || null,
      completed_at,
      status,
      score: typeof body.score === 'number' ? body.score : null,
      notes: body.notes?.toString() ?? null,
    })
    .select('*')
    .single();
  if (error || !data) return bad(error?.message ?? 'insert failed', 500);
  return NextResponse.json({ ok: true, record: data as TrainingRecord });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireEditAccess(request);
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  let body: Partial<TrainingRecord> & { id?: string };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  if (!body.id) return bad('id required');

  const patch: Record<string, unknown> = {};
  if (typeof body.status === 'string' && STATUSES.includes(body.status as TrainingRecordStatus)) {
    patch.status = body.status;
    if (body.status === 'complete' && !('completed_at' in body)) {
      patch.completed_at = new Date().toISOString().slice(0, 10);
    } else if (body.status !== 'complete' && !('completed_at' in body)) {
      patch.completed_at = null;
    }
  }
  if ('trainee_email' in body) patch.trainee_email = body.trainee_email?.toString().trim() || null;
  if ('trainee_name'  in body) patch.trainee_name  = body.trainee_name?.toString().trim() || null;
  if ('trainee_role'  in body) patch.trainee_role  = body.trainee_role?.toString().trim() || null;
  if ('assigned_at'   in body) patch.assigned_at   = body.assigned_at || null;
  if ('due_date'      in body) patch.due_date      = body.due_date || null;
  if ('completed_at'  in body) patch.completed_at  = body.completed_at || null;
  if ('score'         in body) patch.score         = typeof body.score === 'number' ? body.score : null;
  if ('notes'         in body) patch.notes         = body.notes?.toString() ?? null;

  if (Object.keys(patch).length === 0) return bad('no patchable fields');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('training_records')
    .update(patch)
    .eq('id', body.id)
    .eq('tenant_id', tenant.id)
    .select('*')
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('not found', 404);
  return NextResponse.json({ ok: true, record: data as TrainingRecord });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireEditAccess(request);
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return bad('id required');
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('training_records')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenant.id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
