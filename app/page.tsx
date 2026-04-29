import { headers } from 'next/headers';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import WorksheetView from '@/components/WorksheetView';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { CurrentScore } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);

  if (!tenant) {
    return (
      <main className="app-main">
        <div className="banner error">
          No tenant resolved for this deployment. Set <code>TENANT_SLUG</code> in env, or
          insert a <code>tenants</code> row whose <code>hostname</code> matches{' '}
          <code>{host || '(unknown host)'}</code>.
        </div>
      </main>
    );
  }

  const fw = await loadActiveFramework(tenant);
  if (!fw) {
    return (
      <>
        <Header tenant={tenant} frameworkLabel={null} />
        <main className="app-main">
          <div className="banner error">
            No active framework for tenant <code>{tenant.slug}</code>.
          </div>
        </main>
        <Footer tenant={tenant} />
      </>
    );
  }

  // Phase 1.5: auth is off. Use service-role client so the worksheet renders
  // for any visitor. RLS is bypassed only here (read-only score load) and in
  // /api/score (write); both are server-side.
  const supabase = createServiceRoleClient();
  const { data: scoreRows, error } = await supabase
    .from('current_scores')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('framework_version_id', fw.version.id);

  if (error) {
    console.error('Load current_scores failed', error);
  }

  const scores: Record<string, CurrentScore> = {};
  for (const r of (scoreRows ?? []) as CurrentScore[]) {
    scores[r.control_id] = r;
  }

  const totalControls = fw.definition.groups.reduce(
    (acc, g) => acc + g.categories.reduce((a, c) => a + c.controls.length, 0),
    0,
  );

  const frameworkLabel = `${fw.definition.framework.display_name} · ${totalControls} Controls · Live Assessment`;

  return (
    <>
      <Header tenant={tenant} frameworkLabel={frameworkLabel} userEmail={null} />
      <main className="app-main">
        <WorksheetView
          tenantId={tenant.id}
          frameworkVersionId={fw.version.id}
          definition={fw.definition}
          initialScores={scores}
        />
      </main>
      <Footer tenant={tenant} />
    </>
  );
}
