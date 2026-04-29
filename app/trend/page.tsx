import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { createServiceRoleClient } from '@/lib/supabase/server';
import TrendChart, { type TrendSeries } from '@/components/TrendChart';
import { GROUP_COLORS } from '@/lib/scoring';

export const dynamic = 'force-dynamic';

interface SnapAgg {
  snapshot_id: string;
  taken_at: string;
  label: string;
  period: string | null;
  by_group: Record<string, { pra_avg: number | null; gol_avg: number | null; n: number }>;
  overall_pra: number | null;
  overall_gol: number | null;
}

export default async function TrendPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;

  const fw = await loadActiveFramework(tenant);
  if (!fw) return <main className="app-main"><div className="banner error">No framework.</div></main>;

  const supabase = createServiceRoleClient();
  const { data: snapshots } = await supabase
    .from('snapshots')
    .select('id, label, period, taken_at')
    .eq('tenant_id', tenant.id)
    .eq('framework_version_id', fw.version.id)
    .order('taken_at', { ascending: true });

  const snaps = (snapshots ?? []) as { id: string; label: string; period: string | null; taken_at: string }[];

  const aggregated: SnapAgg[] = [];
  for (const s of snaps) {
    const { data: rows } = await supabase
      .from('snapshot_scores')
      .select('control_id, pra, gol')
      .eq('snapshot_id', s.id);
    const by_group: SnapAgg['by_group'] = {};
    let praSum = 0, praN = 0, golSum = 0, golN = 0;
    for (const r of (rows ?? []) as { control_id: string; pra: number | null; gol: number | null }[]) {
      const g = r.control_id.split('.')[0];
      if (!by_group[g]) by_group[g] = { pra_avg: null, gol_avg: null, n: 0 };
      if (r.pra != null) {
        const cur = by_group[g];
        cur.pra_avg = ((cur.pra_avg ?? 0) * cur.n + r.pra) / (cur.n + 1);
        cur.n++;
        praSum += r.pra; praN++;
      }
      if (r.gol != null) {
        golSum += r.gol; golN++;
      }
    }
    aggregated.push({
      snapshot_id: s.id,
      taken_at: s.taken_at,
      label: s.label,
      period: s.period,
      by_group,
      overall_pra: praN ? praSum / praN : null,
      overall_gol: golN ? golSum / golN : null,
    });
  }

  const series: TrendSeries[] = fw.definition.groups.map((g) => {
    const c = GROUP_COLORS[g.id] ?? { accent: '#C9A961' };
    return {
      key: g.id,
      label: g.name,
      color: c.accent,
      points: aggregated.map((a) => ({
        x: new Date(a.taken_at).getTime(),
        xLabel: a.period ?? a.label,
        y: a.by_group[g.id]?.pra_avg ?? null,
      })),
    };
  });
  series.unshift({
    key: 'OVERALL',
    label: 'Overall',
    color: '#C9A961',
    points: aggregated.map((a) => ({
      x: new Date(a.taken_at).getTime(),
      xLabel: a.period ?? a.label,
      y: a.overall_pra,
    })),
    thick: true,
  });

  return (
    <main className="app-main">
      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Practice Maturity Trend</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              {fw.definition.framework.display_name} · {snaps.length} snapshots
            </div>
          </div>
        </div>
        {snaps.length < 2 ? (
          <div className="banner">
            Need at least 2 snapshots to draw a trend. Take snapshots periodically (e.g., before each board meeting) on the <strong>Snapshots</strong> tab.
          </div>
        ) : (
          <TrendChart series={series} />
        )}
      </section>
    </main>
  );
}
