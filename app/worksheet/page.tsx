import { headers } from 'next/headers';
import WorksheetView from '@/components/WorksheetView';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { CurrentScore } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

export default async function WorksheetPage() {
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

  return (
    <main className="app-main">
      <WorksheetView
        tenantId={tenant.id}
        frameworkVersionId={fw.version.id}
        definition={fw.definition}
        initialScores={scores}
      />
    </main>
  );
}
