import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  const supabase = createServiceRoleClient();
  const { data: defs } = await supabase
    .from('kpi_definitions')
    .select('*')
    .eq('tenant_id', tenant.id)
    .order('display_order')
    .order('name');
  const ids = (defs ?? []).map((d) => d.id);
  let observations: Record<string, unknown>[] = [];
  if (ids.length > 0) {
    const { data: obs } = await supabase
      .from('kpi_observations')
      .select('*')
      .in('kpi_definition_id', ids)
      .order('observed_at', { ascending: false });
    observations = obs ?? [];
  }
  return NextResponse.json({ definitions: defs ?? [], observations });
}

export async function POST(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const slug = String(body.slug ?? '').trim();
  const name = String(body.name ?? '').trim();
  if (!slug || !name) return NextResponse.json({ error: 'slug + name required' }, { status: 400 });

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('kpi_definitions')
    .insert({
      tenant_id: tenant.id,
      slug,
      name,
      description: body.description ?? null,
      unit: body.unit ?? null,
      target_value: body.target_value ?? null,
      target_direction: body.target_direction ?? 'up',
      display_order: body.display_order ?? 0,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ definition: data });
}

export async function DELETE(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from('kpi_definitions').delete()
    .eq('id', id).eq('tenant_id', tenant.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
