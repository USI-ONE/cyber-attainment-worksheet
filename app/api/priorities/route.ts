import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';

export const dynamic = 'force-dynamic';

const ALLOWED_FIELDS = new Set([
  'control_id', 'title', 'detail', 'owner', 'status', 'priority_level', 'due_date', 'completed_at',
]);

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('priorities')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('completed_at', { ascending: true, nullsFirst: true })
    .order('priority_level', { ascending: false })
    .order('due_date', { ascending: true, nullsFirst: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ priorities: data ?? [] });
}

export async function POST(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  const fw = await loadActiveFramework(tenant);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  if (!body.title || typeof body.title !== 'string') return NextResponse.json({ error: 'title required' }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('priorities')
    .insert({
      tenant_id: tenant.id,
      framework_version_id: fw?.version.id ?? null,
      title: String(body.title),
      detail: body.detail ?? null,
      control_id: body.control_id ?? null,
      owner: body.owner ?? null,
      status: body.status ?? 'Not Started',
      priority_level: body.priority_level ?? null,
      due_date: body.due_date ?? null,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ priority: data });
}

export async function PATCH(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  if (!body.id || typeof body.id !== 'string') return NextResponse.json({ error: 'id required' }, { status: 400 });
  const id = body.id;

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of Object.keys(body)) {
    if (k === 'id') continue;
    if (!ALLOWED_FIELDS.has(k)) continue;
    update[k] = body[k];
  }
  if (update.status === 'Complete' && !update.completed_at) {
    update.completed_at = new Date().toISOString();
  } else if (update.status && update.status !== 'Complete') {
    update.completed_at = null;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('priorities').update(update).eq('id', id).eq('tenant_id', tenant.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('priorities').delete().eq('id', id).eq('tenant_id', tenant.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
