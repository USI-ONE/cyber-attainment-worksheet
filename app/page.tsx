import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth';
import type { CurrentScore } from '@/lib/supabase/types';
import SummaryDashboard from '@/components/SummaryDashboard';
import AttentionFeed from '@/components/AttentionFeed';
import { computeAttention } from '@/lib/attention';

export const dynamic = 'force-dynamic';

export default async function Page() {
  // Operator deploy: route by role.
  //   - Platform admins → /hub (cross-tenant portfolio view, the existing landing).
  //   - Anyone else (tenant editors/viewers signed into the hub) → /my-tenants
  //     so they see a picker of tenants they can SSO into, instead of the
  //     operator portfolio they shouldn't be looking at.
  //   - Anonymous → middleware will already have redirected them to /auth/signin.
  if (process.env.OPERATOR_MODE === 'true') {
    const cu = await getCurrentUser();
    if (cu?.user.is_platform_admin) {
      redirect('/hub');
    } else {
      redirect('/my-tenants');
    }
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
