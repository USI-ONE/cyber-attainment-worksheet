import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';

/**
 * Score upsert endpoint. Phase 1.5: no auth.
 *
 * Phase 2: this route gets a `requireEditor()` guard that reads the session
 * cookie and rejects anyone who isn't editor on the resolved tenant.
 *
 * Body: { control_id, field, value }
 *   field    = 'pol' | 'pra' | 'gol' | 'prio' | 'owner' | 'status' | 'notes'
 *   value    = number | string | null
 */
const SCORE_FIELDS = new Set(['pol', 'pra', 'gol', 'prio', 'owner', 'status', 'notes']);
const TIER_FIELDS = new Set(['pol', 'pra', 'gol', 'prio']);

export async function POST(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) {
    return NextResponse.json({ error: 'no tenant resolved' }, { status: 400 });
  }

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
  } else if (TIER_FIELDS.has(field)) {
    const n = typeof value === 'number' ? value : parseInt(String(value), 10);
    if (!Number.isFinite(n) || n < 1 || n > 4) {
      return NextResponse.json({ error: `${field} must be 1..4 or null` }, { status: 400 });
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
