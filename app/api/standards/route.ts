import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';

interface ApplyRequest { standard_id: string; applies: boolean; scope_notes?: string | null }

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  const supabase = createServiceRoleClient();
  const [{ data: cat }, { data: app }] = await Promise.all([
    supabase.from('standards').select('*').order('display_name'),
    supabase.from('tenant_standards').select('*').eq('tenant_id', tenant.id),
  ]);
  return NextResponse.json({ catalog: cat ?? [], applied: app ?? [] });
}

export async function PUT(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return NextResponse.json({ error: 'no tenant' }, { status: 400 });
  let body: ApplyRequest;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }); }
  if (!body.standard_id) return NextResponse.json({ error: 'standard_id required' }, { status: 400 });

  const supabase = createServiceRoleClient();
  if (body.applies) {
    const { error } = await supabase.from('tenant_standards').upsert(
      { tenant_id: tenant.id, standard_id: body.standard_id, applies: true, scope_notes: body.scope_notes ?? null },
      { onConflict: 'tenant_id,standard_id' }
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase.from('tenant_standards').delete()
      .eq('tenant_id', tenant.id).eq('standard_id', body.standard_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
