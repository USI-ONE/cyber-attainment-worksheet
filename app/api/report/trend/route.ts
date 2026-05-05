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

  // Pull all snapshot_scores in one shot, then bucket per snapshot. Cheaper
  // than N round-trips when there are many snapshots.
  const snapIds = (snaps ?? []).map((s) => (s as { id: string }).id);
  const { data: rows } = snapIds.length
    ? await supabase
        .from('snapshot_scores')
        .select('snapshot_id, control_id, pra')
        .in('snapshot_id', snapIds)
    : { data: [] as { snapshot_id: string; control_id: string; pra: number | null }[] };

  type Acc = { sum: number; n: number };
  const aggregated: TrendSnapshot[] = (snaps ?? []).map((s) => {
    const sn = s as { id: string; label: string; period: string | null; taken_at: string };
    const byG: Record<string, Acc> = {};
    let oSum = 0, oN = 0;
    for (const r of (rows ?? []) as { snapshot_id: string; control_id: string; pra: number | null }[]) {
      if (r.snapshot_id !== sn.id || r.pra == null) continue;
      const v = typeof r.pra === 'number' ? r.pra : parseFloat(String(r.pra));
      if (!Number.isFinite(v)) continue;
      const g = r.control_id.split('.')[0];
      if (!byG[g]) byG[g] = { sum: 0, n: 0 };
      byG[g].sum += v; byG[g].n += 1;
      oSum += v; oN += 1;
    }
    const by_group: Record<string, number | null> = {};
    for (const [k, a] of Object.entries(byG)) by_group[k] = a.n ? a.sum / a.n : null;
    return {
      id: sn.id,
      label: sn.label,
      period: sn.period,
      taken_at: sn.taken_at,
      by_group,
      overall: oN ? oSum / oN : null,
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

  const filename = `${slugify(tenant.slug)}-practice-trend-${new Date().toISOString().slice(0, 10)}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
