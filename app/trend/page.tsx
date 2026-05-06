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
  by_group: Record<string, { pol_avg: number | null; pra_avg: number | null; gol_avg: number | null; pol_n: number; pra_n: number; gol_n: number }>;
  overall_pol: number | null;
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

  // Accumulate per-snapshot averages for all three score columns. Numeric
  // values come back from the DB as strings (numeric column), so coerce.
  const num = (v: unknown): number | null => {
    if (v == null) return null;
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : null;
  };
  const aggregated: SnapAgg[] = [];
  for (const s of snaps) {
    const { data: rows } = await supabase
      .from('snapshot_scores')
      .select('control_id, pol, pra, gol')
      .eq('snapshot_id', s.id);
    const by_group: SnapAgg['by_group'] = {};
    let polSum = 0, polN = 0, praSum = 0, praN = 0, golSum = 0, golN = 0;
    for (const r of (rows ?? []) as { control_id: string; pol: unknown; pra: unknown; gol: unknown }[]) {
      const g = r.control_id.split('.')[0];
      if (!by_group[g]) by_group[g] = { pol_avg: null, pra_avg: null, gol_avg: null, pol_n: 0, pra_n: 0, gol_n: 0 };
      const cur = by_group[g];
      const pol = num(r.pol); const pra = num(r.pra); const gol = num(r.gol);
      if (pol != null) {
        cur.pol_avg = ((cur.pol_avg ?? 0) * cur.pol_n + pol) / (cur.pol_n + 1);
        cur.pol_n++;
        polSum += pol; polN++;
      }
      if (pra != null) {
        cur.pra_avg = ((cur.pra_avg ?? 0) * cur.pra_n + pra) / (cur.pra_n + 1);
        cur.pra_n++;
        praSum += pra; praN++;
      }
      if (gol != null) {
        cur.gol_avg = ((cur.gol_avg ?? 0) * cur.gol_n + gol) / (cur.gol_n + 1);
        cur.gol_n++;
        golSum += gol; golN++;
      }
    }
    aggregated.push({
      snapshot_id: s.id,
      taken_at: s.taken_at,
      label: s.label,
      period: s.period,
      by_group,
      overall_pol: polN ? polSum / polN : null,
      overall_pra: praN ? praSum / praN : null,
      overall_gol: golN ? golSum / golN : null,
    });
  }

  // Three thick "overall" series (Policy / Practice / Goal) — these are the
  // headline trend lines the board reads. Per-function lines are kept as thin
  // background series so a click-through reveals where the movement is.
  // Colors match the radar / executive report convention.
  const series: TrendSeries[] = [];
  series.push({
    key: 'OVERALL_POL', label: 'Policy (overall)', color: '#A6873B',
    points: aggregated.map((a) => ({
      x: new Date(a.taken_at).getTime(), xLabel: a.period ?? a.label, y: a.overall_pol,
    })),
    thick: true,
  });
  series.push({
    key: 'OVERALL_PRA', label: 'Practice (overall)', color: '#B45309',
    points: aggregated.map((a) => ({
      x: new Date(a.taken_at).getTime(), xLabel: a.period ?? a.label, y: a.overall_pra,
    })),
    thick: true,
  });
  series.push({
    key: 'OVERALL_GOL', label: 'Goal (overall)', color: '#15803D',
    points: aggregated.map((a) => ({
      x: new Date(a.taken_at).getTime(), xLabel: a.period ?? a.label, y: a.overall_gol,
    })),
    thick: true,
  });
  // Per-function Practice trend (faded background lines so the headline
  // overall lines stand out).
  for (const g of fw.definition.groups) {
    const c = GROUP_COLORS[g.id] ?? { accent: '#A6873B' };
    series.push({
      key: g.id,
      label: g.name + ' (Practice)',
      color: c.accent,
      points: aggregated.map((a) => ({
        x: new Date(a.taken_at).getTime(),
        xLabel: a.period ?? a.label,
        y: a.by_group[g.id]?.pra_avg ?? null,
      })),
    });
  }

  return (
    <main className="app-main">
      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Maturity Trend</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              {fw.definition.framework.display_name} · {snaps.length} snapshots · Policy · Practice · Goal
            </div>
          </div>
          <a className="action-btn primary"
             href="/api/report/trend"
             title="Generate a board-ready PDF trend briefing"
             download>
            Generate Executive Report
          </a>
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
