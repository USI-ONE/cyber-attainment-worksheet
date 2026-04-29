import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { CurrentScore, FrameworkGroup } from '@/lib/supabase/types';
import { GROUP_COLORS, TIER_LABELS } from '@/lib/scoring';

export const dynamic = 'force-dynamic';

export default async function MaturityPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;

  const fw = await loadActiveFramework(tenant);
  if (!fw) return <main className="app-main"><div className="banner error">No framework.</div></main>;

  const supabase = createServiceRoleClient();
  const { data: scoreRows } = await supabase
    .from('current_scores')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('framework_version_id', fw.version.id);

  const scores: Record<string, CurrentScore> = {};
  for (const r of (scoreRows ?? []) as CurrentScore[]) scores[r.control_id] = r;

  const groups = fw.definition.groups;

  return (
    <main className="app-main">
      <section className="scorecard">
        <div className="scorecard-header">
          <div>
            <div className="scorecard-title">Maturity Levels</div>
            <div className="scorecard-tag" style={{ marginTop: 4 }}>
              Practice tier per control · 1=Partial · 2=Risk Informed · 3=Repeatable · 4=Adaptive
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <LegendChip tier={1} />
            <LegendChip tier={2} />
            <LegendChip tier={3} />
            <LegendChip tier={4} />
          </div>
        </div>
        <div className="maturity-grid">
          {groups.map((g) => <FunctionRow key={g.id} group={g} scores={scores} />)}
        </div>
      </section>
    </main>
  );
}

function FunctionRow({ group, scores }: { group: FrameworkGroup; scores: Record<string, CurrentScore> }) {
  const c = GROUP_COLORS[group.id] ?? { accent: '#C9A961', text: '#E8D29B', bg: '' };
  return (
    <div className="maturity-fn-row" style={{ ['--fn-accent' as never]: c.accent }}>
      <div className="maturity-fn-label">{group.id} — {group.name}</div>
      <div className="maturity-controls">
        {group.categories.flatMap((cat) =>
          cat.controls.map((ctrl) => {
            const r = scores[ctrl.id];
            const tier = r?.pra ?? 0;
            const goalTier = r?.gol ?? 0;
            return (
              <span key={ctrl.id} className="maturity-cell" data-tier={tier}>
                {ctrl.id.replace(/^[A-Z]+\./, '').replace(/-/, '·')}
                <span className="maturity-cell-tooltip">
                  {ctrl.id} — practice: {tier ? `${tier} ${TIER_LABELS[tier]}` : 'unscored'}
                  {goalTier ? ` · goal: ${goalTier}` : ''}
                </span>
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}

function LegendChip({ tier }: { tier: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-mid)', letterSpacing: '.05em' }}>
      <span className="maturity-cell" data-tier={tier} style={{ width: 22, height: 14 }} />
      <span>{TIER_LABELS[tier]}</span>
    </div>
  );
}
