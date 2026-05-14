import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { requireEditAccess } from '@/lib/auth-api';
import type {
  TrainingCampaign, TrainingCampaignKind, TrainingCampaignStatus,
} from '@/lib/supabase/types';

/**
 * GET    /api/training-campaigns          list all campaigns for the tenant
 * POST   /api/training-campaigns          create (requires `name`)
 * PATCH  /api/training-campaigns          partial update by `id`
 * DELETE /api/training-campaigns?id=…     cascade-deletes records via FK
 */
export const dynamic = 'force-dynamic';

const KINDS:    readonly TrainingCampaignKind[]    = ['awareness','phishing','role_specific','onboarding','tabletop','other'];
const STATUSES: readonly TrainingCampaignStatus[] = ['planned','active','completed','archived'];

function bad(msg: string, code = 400) { return NextResponse.json({ error: msg }, { status: code }); }
function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string');
}
function intOr(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : fallback;
}

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant');
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('training_campaigns')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('scheduled_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) return bad(error.message, 500);
  return NextResponse.json({ campaigns: (data ?? []) as TrainingCampaign[] });
}

export async function POST(request: NextRequest) {
  const auth = await requireEditAccess(request);
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  let body: Partial<TrainingCampaign>;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  const name = (body.name ?? '').trim();
  if (!name) return bad('name is required');

  const kind: TrainingCampaignKind = KINDS.includes(body.kind as TrainingCampaignKind)
    ? (body.kind as TrainingCampaignKind) : 'awareness';
  const status: TrainingCampaignStatus = STATUSES.includes(body.status as TrainingCampaignStatus)
    ? (body.status as TrainingCampaignStatus) : 'active';

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('training_campaigns')
    .insert({
      tenant_id: tenant.id,
      name, kind, status,
      description: body.description?.toString() ?? null,
      vendor: body.vendor?.toString().trim() || null,
      scheduled_at: body.scheduled_at || null,
      completed_at: body.completed_at || null,
      target_audience: body.target_audience?.toString().trim() || 'All employees',
      recipient_count:             intOr(body.recipient_count),
      clicked_count:               intOr(body.clicked_count),
      reported_count:              intOr(body.reported_count),
      credentials_submitted_count: intOr(body.credentials_submitted_count),
      attachment_opened_count:     intOr(body.attachment_opened_count),
      linked_control_ids: strList(body.linked_control_ids),
      linked_risk_ids:    strList(body.linked_risk_ids),
      notes: body.notes?.toString() ?? null,
    })
    .select('*')
    .single();
  if (error || !data) return bad(error?.message ?? 'insert failed', 500);
  return NextResponse.json({ ok: true, campaign: data as TrainingCampaign });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireEditAccess(request);
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  let body: Partial<TrainingCampaign> & { id?: string };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }
  if (!body.id) return bad('id required');

  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string') {
    const t = body.name.trim();
    if (!t) return bad('name cannot be empty');
    patch.name = t;
  }
  if (typeof body.kind === 'string'   && KINDS.includes(body.kind as TrainingCampaignKind))     patch.kind = body.kind;
  if (typeof body.status === 'string' && STATUSES.includes(body.status as TrainingCampaignStatus)) patch.status = body.status;

  if ('description'    in body) patch.description    = body.description?.toString() ?? null;
  if ('vendor'         in body) patch.vendor         = body.vendor?.toString().trim() || null;
  if ('scheduled_at'   in body) patch.scheduled_at   = body.scheduled_at || null;
  if ('completed_at'   in body) patch.completed_at   = body.completed_at || null;
  if ('target_audience' in body) patch.target_audience = body.target_audience?.toString().trim() || null;
  if ('notes'          in body) patch.notes          = body.notes?.toString() ?? null;
  if (typeof body.recipient_count             === 'number') patch.recipient_count             = intOr(body.recipient_count);
  if (typeof body.clicked_count               === 'number') patch.clicked_count               = intOr(body.clicked_count);
  if (typeof body.reported_count              === 'number') patch.reported_count              = intOr(body.reported_count);
  if (typeof body.credentials_submitted_count === 'number') patch.credentials_submitted_count = intOr(body.credentials_submitted_count);
  if (typeof body.attachment_opened_count     === 'number') patch.attachment_opened_count     = intOr(body.attachment_opened_count);
  if (Array.isArray(body.linked_control_ids)) patch.linked_control_ids = strList(body.linked_control_ids);
  if (Array.isArray(body.linked_risk_ids))    patch.linked_risk_ids    = strList(body.linked_risk_ids);

  if (Object.keys(patch).length === 0) return bad('no patchable fields');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('training_campaigns')
    .update(patch)
    .eq('id', body.id)
    .eq('tenant_id', tenant.id)
    .select('*')
    .maybeSingle();
  if (error) return bad(error.message, 500);
  if (!data) return bad('not found', 404);
  return NextResponse.json({ ok: true, campaign: data as TrainingCampaign });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireEditAccess(request);
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return bad('id required');
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from('training_campaigns')
    .delete()
    .eq('id', id)
    .eq('tenant_id', tenant.id);
  if (error) return bad(error.message, 500);
  return NextResponse.json({ ok: true });
}
