import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { buildGapAnalysis, summarizeGaps } from '@/lib/recommendations';
import RecommendationsClient from '@/components/RecommendationsClient';
import type { AssessmentResponse, CurrentScore } from '@/lib/supabase/types';

/**
 * /recommendations — practice-gap-driven action checklist.
 *
 * Surfaces every control where Practice score (current_scores.pra) is below
 * the Goal score the tenant declared on /worksheet. For each, builds a list
 * of concrete next steps from the assessment answers + a generic per-tier
 * playbook. The companion PDF lives at /api/report/recommendations.
 *
 * Why "pra < gol" instead of an absolute floor: the tenant already declared
 * which tier each control should reach. Recommending action on a control
 * already at goal would be noise — this page exists to focus attention on
 * what the user themselves said is below target.
 */
export const dynamic = 'force-dynamic';

export default async function RecommendationsPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) {
    return <main className="app-main"><div className="banner error">No tenant.</div></main>;
  }
  const fw = await loadActiveFramework(tenant);
  if (!fw) {
    return <main className="app-main"><div className="banner error">No active framework.</div></main>;
  }

  const supabase = createServiceRoleClient();

  // Pull scores + assessment responses in parallel — both are tenant-scoped
  // and we'll join them in-memory by control_id.
  const [scoresRes, respRes] = await Promise.all([
    supabase
      .from('current_scores')
      .select('control_id, pra, gol, prio, owner')
      .eq('tenant_id', tenant.id)
      .eq('framework_version_id', fw.version.id),
    supabase
      .from('assessment_responses')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('framework_version_id', fw.version.id),
  ]);

  const scoresByControl = new Map<string, Pick<CurrentScore, 'pra' | 'gol' | 'prio' | 'owner'>>();
  for (const row of (scoresRes.data ?? []) as Pick<CurrentScore, 'control_id' | 'pra' | 'gol' | 'prio' | 'owner'>[]) {
    scoresByControl.set(row.control_id, row);
  }
  const responsesByControl = new Map<string, AssessmentResponse>();
  for (const row of (respRes.data ?? []) as AssessmentResponse[]) {
    responsesByControl.set(row.control_id, row);
  }

  const gaps = buildGapAnalysis({
    definition: fw.definition,
    scoresByControl,
    responsesByControl,
  });
  const summary = summarizeGaps(gaps);

  return (
    <main className="app-main">
      <RecommendationsClient
        tenantName={tenant.display_name}
        frameworkName={fw.definition.framework.display_name}
        frameworkVersion={fw.version.version}
        gaps={gaps}
        summary={summary}
      />
    </main>
  );
}
