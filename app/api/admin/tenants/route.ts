import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { audit, getCurrentUser, isPlatformAdmin } from '@/lib/auth';

/**
 * GET    /api/admin/tenants   list every tenant with member counts
 * POST   /api/admin/tenants   create a new tenant. Body:
 *                             { slug, display_name, hostname?, brand_config? }
 */
export const dynamic = 'force-dynamic';

function bad(msg: string, code = 400) { return NextResponse.json({ error: msg }, { status: code }); }

export async function GET() {
  const cu = await getCurrentUser();
  if (!isPlatformAdmin(cu)) return bad('platform admin required', 403);

  const supabase = createServiceRoleClient();
  const [tenantsRes, membershipsRes] = await Promise.all([
    supabase.from('tenants').select('*').order('display_name'),
    supabase.from('memberships').select('tenant_id, role'),
  ]);

  const counts: Record<string, { editors: number; viewers: number }> = {};
  for (const m of (membershipsRes.data ?? []) as { tenant_id: string; role: string }[]) {
    if (!counts[m.tenant_id]) counts[m.tenant_id] = { editors: 0, viewers: 0 };
    if (m.role === 'editor') counts[m.tenant_id].editors++;
    else if (m.role === 'viewer') counts[m.tenant_id].viewers++;
  }

  return NextResponse.json({
    tenants: tenantsRes.data ?? [],
    member_counts: counts,
  });
}

export async function POST(request: NextRequest) {
  const cu = await getCurrentUser();
  if (!isPlatformAdmin(cu)) return bad('platform admin required', 403);

  let body: { slug?: string; display_name?: string; hostname?: string; brand_config?: Record<string, unknown> };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const slug = (body.slug ?? '').trim();
  const display_name = (body.display_name ?? '').trim();
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) return bad('slug must be kebab-case (a-z0-9, hyphens)');
  if (!display_name) return bad('display_name required');

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from('tenants')
    .insert({
      slug,
      display_name,
      hostname: body.hostname?.trim() || null,
      brand_config: body.brand_config ?? {},
    })
    .select('*')
    .single();
  if (error) return bad(error.message, 500);

  await audit({
    actor_id: cu!.user.id, tenant_id: data.id, action: 'tenant_created',
    detail: { slug, display_name },
  });

  return NextResponse.json({ ok: true, tenant: data });
}
