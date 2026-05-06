import React from 'react';
import { type NextRequest } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { TrendReport, type TrendSnapshot } from '@/lib/pdf/TrendReport';

/**
 * GET /api/report/trend — Practice maturity trend across all snapshots,
 *   per-function rows × snapshot columns. Mirrors the aggregation in
 *   app/trend/page.tsx so the PDF and on-screen views agree.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function bad(msg: string, code = 400) {
  return new Response(JSON.stringify({ error: msg }), {
    status: code, headers: { 'Content-Type': 'application/json' },
  });
}
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').slice(0, 80) || 'tenant';
}

export async function GET(request: NextRequest) {
  const host = request.headers.get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return bad('no tenant resolved');

  const fw = await loadActiveFramework(tenant);
  if (!fw) return bad('no active framework');

  const supabase = createServiceRoleClient();
  const { data: snaps } = await supabase
    .from('snapshots')
    .select('id, label, period, taken_at')
    .eq('tenant_id', tenant.id)
    .eq('framework_version_id', fw.version.id)
    .order('taken_at', { ascending: true });

  // Pull all snapshot_scores in one shot — pol/pra/gol per row — then bucket
  // per snapshot. Three-axis aggregation so the trend report can plot every
  // dimension (Policy / Practice / Goal) and flag improvements in any of
  // them, not just Practice.
  const snapIds = (snaps ?? []).map((s) => (s as { id: string }).id);
  const { data: rows } = snapIds.length
    ? await supabase
        .from('snapshot_scores')
        .select('snapshot_id, control_id, pol, pra, gol')
        .in('snapshot_id', snapIds)
    : { data: [] as { snapshot_id: string; control_id: string; pol: unknown; pra: unknown; gol: unknown }[] };

  const num = (v: unknown): number | null => {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  };
  type GroupAcc = { polSum: number; polN: number; praSum: number; praN: number; golSum: number; golN: number };
  const aggregated: TrendSnapshot[] = (snaps ?? []).map((s) => {
    const sn = s as { id: string; label: string; period: string | null; taken_at: string };
    const byG: Record<string, GroupAcc> = {};
    let polS = 0, polN = 0, praS = 0, praN = 0, golS = 0, golN = 0;
    for (const r of (rows ?? []) as { snapshot_id: string; control_id: string; pol: unknown; pra: unknown; gol: unknown }[]) {
      if (r.snapshot_id !== sn.id) continue;
      const g = r.control_id.split('.')[0];
      if (!byG[g]) byG[g] = { polSum: 0, polN: 0, praSum: 0, praN: 0, golSum: 0, golN: 0 };
      const pol = num(r.pol), pra = num(r.pra), gol = num(r.gol);
      if (pol != null) { byG[g].polSum += pol; byG[g].polN += 1; polS += pol; polN += 1; }
      if (pra != null) { byG[g].praSum += pra; byG[g].praN += 1; praS += pra; praN += 1; }
      if (gol != null) { byG[g].golSum += gol; byG[g].golN += 1; golS += gol; golN += 1; }
    }
    const by_group: Record<string, { pol: number | null; pra: number | null; gol: number | null }> = {};
    for (const [k, a] of Object.entries(byG)) {
      by_group[k] = {
        pol: a.polN ? a.polSum / a.polN : null,
        pra: a.praN ? a.praSum / a.praN : null,
        gol: a.golN ? a.golSum / a.golN : null,
      };
    }
    return {
      id: sn.id,
      label: sn.label,
      period: sn.period,
      taken_at: sn.taken_at,
      by_group,
      overall_pol: polN ? polS / polN : null,
      overall_pra: praN ? praS / praN : null,
      overall_gol: golN ? golS / golN : null,
    };
  });

  const groups = fw.definition.groups.map((g) => ({ id: g.id, name: g.name }));

  const buffer = await renderToBuffer(
    React.createElement(TrendReport, {
      tenant,
      snapshots: aggregated,
      groups,
      asOf: new Date(),
    }) as React.ReactElement,
  );

  const filename = `${slugify(tenant.slug)}-maturity-trend-${new Date().toISOString().slice(0, 10)}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
