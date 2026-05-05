import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { createServiceRoleClient } from '@/lib/supabase/server';
import AssessmentLanding from '@/components/AssessmentLanding';
import type { AssessmentResponse } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

export default async function AssessmentLandingPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;
  const fw = await loadActiveFramework(tenant);
  if (!fw) return <main className="app-main"><div className="banner error">No active framework.</div></main>;

  const supabase = createServiceRoleClient();
  const { data: rows } = await supabase
    .from('assessment_responses')
    .select('*')
    .eq('tenant_id', tenant.id)
    .eq('framework_version_id', fw.version.id);

  return (
    <main className="app-main">
      <AssessmentLanding
        definition={fw.definition}
        initialResponses={(rows ?? []) as AssessmentResponse[]}
      />
    </main>
  );
}
