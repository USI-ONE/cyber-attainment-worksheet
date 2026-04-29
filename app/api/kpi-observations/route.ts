import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  const kpi_definition_id = String(body.kpi_definition_id ?? '');
  const observed_at = String(body.observed_at ?? '');
  if (!kpi_definition_id || !observed_at) return NextResponse.json({ error: 'kpi_definition_id + observed_at required' }, { status: 400 });

  const supabase = createServiceRoleClient();
  // Check the def belongs to this tenant before writing
  const { data: def } = await supabase
    .from('kpi_definitions')
    .select('id, tenant_id')
    .eq('id', kpi_definition_id)
    .maybeSingle();
  if (!def || def.tenant_id !== tenant.id) {
    return NextResponse.json({ error: 'definition not found for tenant' }, { status: 404 });
  }

  const { data, error } = await supabase
    .from('kpi_observations')
    .upsert(
      {
        kpi_definition_id,
        observed_at,
        value: body.value ?? null,
        notes_md: body.notes_md ?? null,
      },
      { onConflict: 'kpi_definition_id,observed_at' }
    )
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ observation: data });
}

export async function DELETE(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createServiceRoleClient();
  // Verify ownership via join
  const { data: obs } = await supabase
    .from('kpi_observations')
    .select('id, kpi_definition_id, kpi_definitions!inner(tenant_id)')
    .eq('id', id)
    .maybeSingle();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ownerTenant = (obs as any)?.kpi_definitions?.tenant_id;
  if (!obs || ownerTenant !== tenant.id) {
    return NextResponse.json({ error: 'observation not found for tenant' }, { status: 404 });
  }

  const { error } = await supabase.from('kpi_observations').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
