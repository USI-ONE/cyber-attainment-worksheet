import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { CurrentScore } from '@/lib/supabase/types';
import SummaryDashboard from '@/components/SummaryDashboard';
import AttentionFeed from '@/components/AttentionFeed';
import { computeAttention } from '@/lib/attention';

export const dynamic = 'force-dynamic';

export default async function Page() {
  // Operator deploy: there is no tenant scoring to show; route the user to
  // the Portfolio Hub which is the actual landing page for that deployment.
  if (process.env.OPERATOR_MODE === 'true') {
    redirect('/hub');
  }

  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) {
    return (
      <main className="app-main">
        <div className="banner error">No tenant resolved.</div>
      </main>
    );
  }

  const fw = await loadActiveFramework(tenant);
  if (!fw) {
    return (
      <main className="app-main">
        <div className="banner error">No active framework.</div>
      </main>
    );
  }

  // Pull scores + attention feed in parallel so the page render time is
  // gated by the slower of the two, not their sum.
  const supabase = createServiceRoleClient();
  const [scoresRes, attention] = await Promise.all([
    supabase.from('current_scores')
      .select('*')
      .eq('tenant_id', tenant.id)
      .eq('framework_version_id', fw.version.id),
    computeAttention(tenant.id, supabase),
  ]);

  const scores: Record<string, CurrentScore> = {};
  for (const r of (scoresRes.data ?? []) as CurrentScore[]) scores[r.control_id] = r;

  return (
    <main className="app-main">
      <AttentionFeed items={attention} />
      <SummaryDashboard definition={fw.definition} scores={scores} />
    </main>
  );
}
