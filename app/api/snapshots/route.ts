import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';

/**
 * POST /api/snapshots
 *   Body: { label: string, period?: string, notes_md?: string }
 *   Creates a snapshot row and copies all current_scores into snapshot_scores.
 *
 * GET /api/snapshots
 *   Returns the tenant's snapshot list (newest first), without scores.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant resolved' }, { status: 400 });

  const fw = await loadActiveFramework(tenant);
  if (!fw) return NextResponse.json({ error: 'no active framework' }, { status: 400 });

  let body: { label?: string; period?: string; notes_md?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const label = (body.label || '').trim();
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });

  const supabase = createServiceRoleClient();

  const { data: snap, error: snapErr } = await supabase
    .from('snapshots')
    .insert({
      tenant_id: tenant.id,
      framework_version_id: fw.version.id,
      label,
      period: body.period?.trim() || null,
      notes_md: body.notes_md?.trim() || null,
    })
    .select('id, label, period, taken_at, notes_md')
    .single();
  if (snapErr || !snap) {
    return NextResponse.json({ error: snapErr?.message ?? 'snapshot insert failed' }, { status: 500 });
  }

  const { data: scores } = await supabase
    .from('current_scores')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('framework_version_id', fw.version.id);

  if (scores && scores.length > 0) {
    const snapRows = scores.map((r) => ({
      snapshot_id: snap.id,
      control_id: r.control_id,
      pol: r.pol, pra: r.pra, gol: r.gol, prio: r.prio,
      owner: r.owner, status: r.status, notes: r.notes,
    }));
    const { error: ssErr } = await supabase.from('snapshot_scores').insert(snapRows);
    if (ssErr) {
      // Best-effort cleanup: remove the snapshot row so we don't leave a partial record.
      await supabase.from('snapshots').delete().eq('id', snap.id);
      return NextResponse.json({ error: ssErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, snapshot: snap, score_count: scores?.length ?? 0 });
}

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant resolved' }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('snapshots')
    .select('id, label, period, taken_at, notes_md, framework_version_id')
    .eq('tenant_id', tenant.id)
    .order('taken_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ snapshots: data ?? [] });
}
