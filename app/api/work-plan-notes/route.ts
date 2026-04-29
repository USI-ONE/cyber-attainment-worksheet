import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  const fw = await loadActiveFramework(tenant);
  if (!fw) return NextResponse.json({ notes: {} });
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('work_plan_notes')
    .select('control_id, notes')
    .eq('tenant_id', tenant.id)
    .eq('framework_version_id', fw.version.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const map: Record<string, string> = {};
  for (const r of data ?? []) map[(r as { control_id: string }).control_id] = (r as { notes: string }).notes ?? '';
  return NextResponse.json({ notes: map });
}

export async function PUT(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  const fw = await loadActiveFramework(tenant);
  if (!fw) return NextResponse.json({ error: 'no framework' }, { status: 400 });
  let body: { control_id?: string; notes?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  if (!body.control_id) return NextResponse.json({ error: 'control_id required' }, { status: 400 });
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('work_plan_notes').upsert({
    tenant_id: tenant.id,
    framework_version_id: fw.version.id,
    control_id: body.control_id,
    notes: body.notes ?? '',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'tenant_id,framework_version_id,control_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
