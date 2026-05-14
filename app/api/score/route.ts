import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { requireEditAccess } from '@/lib/auth-api';

/**
 * Score upsert endpoint. Gated by requireEditAccess — a signed-in viewer
 * gets 403, an editor or platform admin proceeds, anonymous behavior is
 * preserved while AUTH_REQUIRED is off (rollout mode).
 *
 * Body: { control_id, field, value }
 *   field    = 'pol' | 'pra' | 'gol' | 'prio' | 'owner' | 'status' | 'notes'
 *   value    = number | string | null
 */
const SCORE_FIELDS = new Set(['pol', 'pra', 'gol', 'prio', 'owner', 'status', 'notes']);
const TIER_FIELDS = new Set(['pol', 'pra', 'gol', 'prio']);

export async function POST(request: NextRequest) {
  const auth = await requireEditAccess(request);
  if (auth instanceof NextResponse) return auth;
  const { tenant } = auth;

  let body: { control_id?: string; field?: string; value?: unknown; framework_version_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const { control_id, field, value, framework_version_id } = body;
  if (!control_id || !field || !framework_version_id) {
    return NextResponse.json(
      { error: 'control_id, field, framework_version_id required' },
      { status: 400 },
    );
  }
  if (!SCORE_FIELDS.has(field)) {
    return NextResponse.json({ error: `unknown field "${field}"` }, { status: 400 });
  }

  let normalized: number | string | null = null;
  if (value === null || value === '' || value === undefined) {
    normalized = null;
  } else if (field === 'prio') {
    // Priority is a 1..4 integer label (P1..P4). parseInt is correct here —
    // any half-step would be a UI bug.
    const n = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (!Number.isFinite(n) || n < 1 || n > 4) {
      return NextResponse.json({ error: 'prio must be 1..4 or null' }, { status: 400 });
    }
    normalized = n;
  } else if (TIER_FIELDS.has(field)) {
    // CMM tier scores (pol / pra / gol) accept the same half-step ladder the
    // worksheet ScoreSelect renders: 0.5 .. 5.0 in 0.5 increments. parseInt
    // here is the original bug — it truncated 4.5 to 4 and rejected 0.5/4.5/5
    // entirely, so any half-step or "Optimizing" (5) save returned 400 and
    // the worksheet flashed "Save failed". parseFloat + a half-step range
    // restores the intended scoring grain.
    const n = typeof value === 'number' ? value : parseFloat(String(value));
    if (!Number.isFinite(n) || n < 0.5 || n > 5 || (n * 2) % 1 !== 0) {
      return NextResponse.json(
        { error: `${field} must be a 0.5..5 half-step or null` },
        { status: 400 },
      );
    }
    normalized = n;
  } else {
    normalized = String(value);
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('current_scores').upsert(
    {
      tenant_id: tenant.id,
      framework_version_id,
      control_id,
      [field]: normalized,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'tenant_id,framework_version_id,control_id' },
  );

  if (error) {
    console.error('upsert current_scores failed', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
