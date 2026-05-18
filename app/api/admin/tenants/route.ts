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

/**
 * POST /api/admin/tenants — create a new tenant.
 *
 * Required body: { slug, display_name }
 * Optional onboarding extras:
 *   hostname              — defaults to caw-<slug>.vercel.app
 *   brand_config          — full BrandConfig object
 *   is_admin_tenant       — defaults to false
 *   framework_version_id  — when set, assigns this framework as the
 *                           tenant's active framework via tenant_frameworks
 *   seed_scores           — when 'baseline', seeds current_scores rows for
 *                           every control in the chosen framework with
 *                           pol=baseline_pol (default 3.0) + gol=baseline_gol
 *                           (default 3.0). Requires framework_version_id.
 *   baseline_pol          — POL value to seed (default 3.0)
 *   baseline_gol          — GOL value to seed (default 3.0)
 *
 * Returns the created tenant row + a summary of side-effects so the UI
 * can show "Framework assigned · 106 baseline scores seeded".
 */
export async function POST(request: NextRequest) {
  const cu = await getCurrentUser();
  if (!isPlatformAdmin(cu)) return bad('platform admin required', 403);

  let body: {
    slug?: string;
    display_name?: string;
    hostname?: string;
    brand_config?: Record<string, unknown>;
    is_admin_tenant?: boolean;
    framework_version_id?: string;
    seed_scores?: 'none' | 'baseline';
    baseline_pol?: number;
    baseline_gol?: number;
  };
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const slug = (body.slug ?? '').trim();
  const display_name = (body.display_name ?? '').trim();
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) return bad('slug must be kebab-case (a-z0-9, hyphens)');
  if (!display_name) return bad('display_name required');

  const supabase = createServiceRoleClient();

  // 1. Create the tenant row. Hostname defaults to the platform's
  //    Vercel-naming convention; the admin can change it later.
  const defaultHostname = `caw-${slug}.vercel.app`;
  const { data: tenant, error } = await supabase
    .from('tenants')
    .insert({
      slug,
      display_name,
      hostname: body.hostname?.trim() || defaultHostname,
      brand_config: body.brand_config ?? {},
      is_admin_tenant: !!body.is_admin_tenant,
    })
    .select('*')
    .single();
  if (error) return bad(error.message, 500);

  await audit({
    actor_id: cu!.user.id, tenant_id: tenant.id, action: 'tenant_created',
    detail: { slug, display_name, is_admin_tenant: !!body.is_admin_tenant },
  });

  let framework_assigned: { framework_version_id: string; control_count: number } | null = null;
  let baseline_seeded: { count: number; pol: number; gol: number } | null = null;

  // 2. Optionally assign the active framework + seed baseline scores.
  if (body.framework_version_id) {
    // Verify the framework exists before any other work.
    const { data: fv } = await supabase
      .from('framework_versions')
      .select('id, definition')
      .eq('id', body.framework_version_id)
      .maybeSingle();
    if (!fv) return bad('framework_version_id not found', 400);

    await supabase
      .from('tenant_frameworks')
      .insert({ tenant_id: tenant.id, framework_version_id: fv.id });

    // Walk the framework definition to extract every control_id. The
    // definition shape is { groups: [{ categories: [{ controls: [{ id, ... }] }] }] }
    type CtrlDef = { id: string };
    type CatDef = { controls: CtrlDef[] };
    type GrpDef = { categories: CatDef[] };
    const groups = (fv.definition as { groups?: GrpDef[] })?.groups ?? [];
    const controlIds: string[] = [];
    for (const g of groups) {
      for (const cat of g.categories ?? []) {
        for (const ctrl of cat.controls ?? []) {
          if (ctrl?.id) controlIds.push(ctrl.id);
        }
      }
    }
    framework_assigned = { framework_version_id: fv.id, control_count: controlIds.length };

    // 3. Seed baseline scores if requested.
    if (body.seed_scores === 'baseline' && controlIds.length > 0) {
      const pol = typeof body.baseline_pol === 'number' ? body.baseline_pol : 3.0;
      const gol = typeof body.baseline_gol === 'number' ? body.baseline_gol : 3.0;
      const nowIso = new Date().toISOString();
      const rows = controlIds.map((cid) => ({
        tenant_id: tenant.id,
        framework_version_id: fv.id,
        control_id: cid,
        pol, gol,
        updated_at: nowIso,
      }));
      // Single bulk insert. on-conflict isn't possible here (tenant is new,
      // so no conflicts can exist) but we use upsert in case the API gets
      // retried by a flaky client — keeps the call idempotent.
      const { error: scoreErr } = await supabase
        .from('current_scores')
        .upsert(rows, { onConflict: 'tenant_id,framework_version_id,control_id' });
      if (scoreErr) {
        // Roll forward — tenant is already created, framework already
        // assigned. Surface the partial state to the UI so the admin
        // can investigate without ending up with an orphaned tenant.
        return NextResponse.json({
          ok: true,
          tenant,
          framework_assigned,
          baseline_seeded: null,
          warning: `Tenant + framework created, but baseline seeding failed: ${scoreErr.message}. You can re-run seeding from /admin/tenants/${tenant.id}.`,
        });
      }
      baseline_seeded = { count: rows.length, pol, gol };
    }
  }

  return NextResponse.json({
    ok: true,
    tenant,
    framework_assigned,
    baseline_seeded,
  });
}
