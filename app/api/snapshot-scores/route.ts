import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';

/**
 * POST /api/snapshot-scores  (used as the saveEndpoint for the snapshot editor)
 *   Body: { snapshot_id, control_id, field, value }
 *
 * Upserts a single field on snapshot_scores. Tenant ownership is verified by
 * joining the snapshot's tenant_id against the resolved tenant.
 */
export const dynamic = 'force-dynamic';

const SCORE_FIELDS = new Set(['pol', 'pra', 'gol', 'prio', 'owner', 'status', 'notes']);
const TIER_FIELDS = new Set(['pol', 'pra', 'gol']);

export async function POST(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });

  let body: { snapshot_id?: string; control_id?: string; field?: string; value?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const { snapshot_id, control_id, field, value } = body;
  if (!snapshot_id || !control_id || !field) {
    return NextResponse.json({ error: 'snapshot_id, control_id, field required' }, { status: 400 });
  }
  if (!SCORE_FIELDS.has(field)) return NextResponse.json({ error: `unknown field "${field}"` }, { status: 400 });

  const supabase = createServiceRoleClient();
  // Verify the snapshot belongs to this tenant
  const { data: snap } = await supabase
    .from('snapshots')
    .select('id, tenant_id')
    .eq('id', snapshot_id)
    .maybeSingle();
  if (!snap || (snap as { tenant_id: string }).tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'snapshot not in tenant' }, { status: 404 });
  }

  let normalized: number | string | null = null;
  if (value === null || value === '' || value === undefined) {
    normalized = null;
  } else if (TIER_FIELDS.has(field)) {
    const n = typeof value === 'number' ? value : parseFloat(String(value));
    if (!Number.isFinite(n) || n < 0 || n > 5) {
      return NextResponse.json({ error: `${field} must be 0..5 or null` }, { status: 400 });
    }
    normalized = n;
  } else if (field === 'prio') {
    const n = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (!Number.isFinite(n) || n < 1 || n > 4) {
      return NextResponse.json({ error: 'prio must be 1..4 or null' }, { status: 400 });
    }
    normalized = n;
  } else {
    normalized = String(value);
  }

  const { error } = await supabase
    .from('snapshot_scores')
    .upsert({ snapshot_id, control_id, [field]: normalized }, { onConflict: 'snapshot_id,control_id' });
  if (error) {
    console.error('snapshot_scores upsert failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
