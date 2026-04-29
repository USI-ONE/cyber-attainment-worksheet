import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';

export const dynamic = 'force-dynamic';

const ALLOWED = new Set(['title', 'detail', 'status', 'owner', 'due_date', 'display_order', 'completed_at']);

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  const url = new URL(request.url);
  const control_id = url.searchParams.get('control_id');
  const supabase = createServiceRoleClient();
  let q = supabase.from('work_plan_tasks').select('*').eq('tenant_id', tenant.id);
  if (control_id) q = q.eq('control_id', control_id);
  const { data, error } = await q.order('control_id').order('display_order').order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data ?? [] });
}

export async function POST(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  const fw = await loadActiveFramework(tenant);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  if (!body.control_id || !body.title) return NextResponse.json({ error: 'control_id + title required' }, { status: 400 });
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from('work_plan_tasks').insert({
    tenant_id: tenant.id,
    framework_version_id: fw?.version.id ?? null,
    control_id: String(body.control_id),
    title: String(body.title),
    detail: body.detail ?? null,
    status: body.status ?? 'Not Started',
    owner: body.owner ?? null,
    due_date: body.due_date ?? null,
    display_order: body.display_order ?? 0,
  }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}

export async function PATCH(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of Object.keys(body)) {
    if (k === 'id' || !ALLOWED.has(k)) continue;
    update[k] = body[k];
  }
  if (update.status === 'Complete' && !update.completed_at) update.completed_at = new Date().toISOString();
  else if (update.status && update.status !== 'Complete') update.completed_at = null;
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('work_plan_tasks').update(update).eq('id', body.id).eq('tenant_id', tenant.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('work_plan_tasks').delete().eq('id', id).eq('tenant_id', tenant.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
