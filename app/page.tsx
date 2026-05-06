import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { CurrentScore } from '@/lib/supabase/types';
import SummaryDashboard from '@/components/SummaryDashboard';

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

  const supabase = createServiceRoleClient();
  const { data: scoreRows } = await supabase
    .from('current_scores')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('framework_version_id', fw.version.id);

  const scores: Record<string, CurrentScore> = {};
  for (const r of (scoreRows ?? []) as CurrentScore[]) scores[r.control_id] = r;

  return (
    <main className="app-main">
      <SummaryDashboard definition={fw.definition} scores={scores} />
    </main>
  );
}
