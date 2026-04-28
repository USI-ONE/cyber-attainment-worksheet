import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';

interface LegacyRow {
  pol?: number | string;
  pra?: number | string;
  gol?: number | string;
  prio?: number | string;
  own?: string;
  sts?: string;
  nts?: string;
}

function parseTier(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return Number.isFinite(n) && n >= 1 && n <= 4 ? n : null;
}

function legacyKeyToControlId(legacyKey: string): string {
  // Legacy storage replaced all '.' with '-'. Reverse the FIRST hyphen only:
  // 'GV-OC-01' -> 'GV.OC-01'
  return legacyKey.replace('-', '.');
}

export async function POST(request: NextRequest) {
  const supabase = createClient();

  const { data: userData, error: authError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (authError || !user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) {
    return NextResponse.json({ error: 'no tenant resolved' }, { status: 400 });
  }

  const { data: membership } = await supabase
    .from('memberships')
    .select('role')
    .eq('user_id', user.id)
    .eq('tenant_id', tenant.id)
    .maybeSingle();
  if (membership?.role !== 'editor') {
    return NextResponse.json({ error: 'editor role required for this tenant' }, { status: 403 });
  }

  const { data: tf } = await supabase
    .from('tenant_frameworks')
    .select('framework_version_id')
    .eq('tenant_id', tenant.id)
    .limit(1)
    .maybeSingle();
  if (!tf) {
    return NextResponse.json({ error: 'no active framework for tenant' }, { status: 400 });
  }
  const frameworkVersionId = tf.framework_version_id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const data = (body as { data?: Record<string, LegacyRow> })?.data;
  if (!data || typeof data !== 'object') {
    return NextResponse.json({ error: 'expected { data: {...} }' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const rows = [] as Array<Record<string, unknown>>;
  let skipped = 0;
  for (const [legacyKey, raw] of Object.entries(data)) {
    if (!raw || typeof raw !== 'object') { skipped++; continue; }
    const r = raw as LegacyRow;
    rows.push({
      tenant_id: tenant.id,
      framework_version_id: frameworkVersionId,
      control_id: legacyKeyToControlId(legacyKey),
      pol: parseTier(r.pol),
      pra: parseTier(r.pra),
      gol: parseTier(r.gol),
      prio: parseTier(r.prio),
      owner: r.own ?? null,
      status: r.sts ?? null,
      notes: r.nts ?? null,
      updated_by: user.id,
      updated_at: now,
    });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: 'no rows to import' }, { status: 400 });
  }

  const { error: upsertError } = await supabase
    .from('current_scores')
    .upsert(rows, { onConflict: 'tenant_id,framework_version_id,control_id' });

  if (upsertError) {
    console.error('import: current_scores upsert failed', upsertError);
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  const today = now.slice(0, 10);
  const { data: snap, error: snapError } = await supabase
    .from('snapshots')
    .insert({
      tenant_id: tenant.id,
      framework_version_id: frameworkVersionId,
      label: `Import baseline ${today}`,
      period: today,
      taken_by: user.id,
      notes_md: 'Created automatically during legacy localStorage import.',
    })
    .select('id, label')
    .single();
  if (snapError || !snap) {
    console.error('import: snapshot insert failed', snapError);
    return NextResponse.json({ error: snapError?.message ?? 'snapshot insert failed' }, { status: 500 });
  }

  const snapshotRows = rows.map((r) => ({
    snapshot_id: snap.id,
    control_id: r.control_id,
    pol: r.pol, pra: r.pra, gol: r.gol, prio: r.prio,
    owner: r.owner, status: r.status, notes: r.notes,
  }));
  const { error: snapScoresError } = await supabase
    .from('snapshot_scores')
    .insert(snapshotRows);
  if (snapScoresError) {
    console.error('import: snapshot_scores insert failed', snapScoresError);
    return NextResponse.json({ error: snapScoresError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    imported_controls: rows.length,
    skipped,
    snapshot_id: snap.id,
    snapshot_label: snap.label,
  });
}
