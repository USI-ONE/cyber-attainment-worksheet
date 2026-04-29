import { headers } from 'next/headers';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import WorksheetView from '@/components/WorksheetView';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { createClient } from '@/lib/supabase/server';
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
            No active framework for tenant <code>{tenant.slug}</code>. Insert a row in
            <code> tenant_frameworks</code> linking this tenant to a framework version.
          </div>
        </main>
        <Footer tenant={tenant} />
      </>
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Check membership before loading scores. Without a membership row, RLS will
  // silently return no rows, but the user experience is better with an explicit
  // "you don't have access yet" banner than a confusing empty worksheet.
  const { data: membership } = await supabase
    .from('memberships')
    .select('role')
    .eq('user_id', user?.id ?? '')
    .eq('tenant_id', tenant.id)
    .maybeSingle();

  if (!membership) {
    return (
      <>
        <Header tenant={tenant} frameworkLabel={null} userEmail={user?.email ?? null} />
        <main className="app-main">
          <div className="banner">
            <strong>You&apos;re signed in as {user?.email ?? '(unknown)'}.</strong>
            <br />
            You don&apos;t have access to <strong>{tenant.display_name}</strong> yet.
            Ask the administrator (the CIO) to grant you a membership for tenant
            slug <code>{tenant.slug}</code>. Once granted, refresh this page.
          </div>
        </main>
        <Footer tenant={tenant} />
      </>
    );
  }

  // Load current scores. RLS scopes rows to memberships, but we already
  // confirmed membership above, so this returns the tenant's full score set.
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
      <Header tenant={tenant} frameworkLabel={frameworkLabel} userEmail={user?.email ?? null} />
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
