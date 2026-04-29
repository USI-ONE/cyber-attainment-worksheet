import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

async function checkOwnership(registerId: string, tenantId: string) {
  const supabase = createServiceRoleClient();
  const { data } = await supabase.from('register_definitions').select('id, tenant_id').eq('id', registerId).maybeSingle();
  return !!(data && (data as { tenant_id: string }).tenant_id === tenantId);
}

export async function POST(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  let body: { register_id?: string; data?: Record<string, unknown>; display_order?: number };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  if (!body.register_id) return NextResponse.json({ error: 'register_id required' }, { status: 400 });
  if (!(await checkOwnership(body.register_id, tenant.id))) return NextResponse.json({ error: 'register not in tenant' }, { status: 403 });

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from('register_rows').insert({
    register_id: body.register_id,
    data: body.data ?? {},
    display_order: body.display_order ?? 0,
  }).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: data });
}

export async function PATCH(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  let body: { id?: string; data?: Record<string, unknown>; display_order?: number };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createServiceRoleClient();
  // Verify ownership through join
  const { data: row } = await supabase.from('register_rows')
    .select('id, register_id, register_definitions!inner(tenant_id)')
    .eq('id', body.id).maybeSingle();
  const ownerTenant = (row as { register_definitions?: { tenant_id?: string } } | null)?.register_definitions?.tenant_id;
  if (!row || ownerTenant !== tenant.id) {
    return NextResponse.json({ error: 'row not in tenant' }, { status: 404 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if ('data' in body) update.data = body.data;
  if ('display_order' in body) update.display_order = body.display_order;
  const { error } = await supabase.from('register_rows').update(update).eq('id', body.id);
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
  const { data: row } = await supabase.from('register_rows')
    .select('id, register_id, register_definitions!inner(tenant_id)')
    .eq('id', id).maybeSingle();
  const ownerTenant = (row as { register_definitions?: { tenant_id?: string } } | null)?.register_definitions?.tenant_id;
  if (!row || ownerTenant !== tenant.id) {
    return NextResponse.json({ error: 'row not in tenant' }, { status: 404 });
  }
  const { error } = await supabase.from('register_rows').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
