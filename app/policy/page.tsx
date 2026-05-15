import { headers } from 'next/headers';
import { resolveTenant } from '@/lib/tenant';
import { loadActiveFramework } from '@/lib/framework';
import { createServiceRoleClient } from '@/lib/supabase/server';
import PolicyClient from '@/components/PolicyClient';
import type { CurrentScore, FrameworkDefinition, PolicyDocument } from '@/lib/supabase/types';

export const dynamic = 'force-dynamic';

export default async function PolicyPage() {
  const host = headers().get('host') ?? undefined;
  const tenant = await resolveTenant(host);
  if (!tenant) return <main className="app-main"><div className="banner error">No tenant.</div></main>;

  // Pull policy + framework + scores in parallel. Framework definition +
  // scores power the per-policy Review panel (coverage by function, avg
  // POL on linked controls, gap-to-goal summary). When the tenant has no
  // active framework yet, the review panel falls back to a plain list of
  // linked control IDs without the grouping.
  const supabase = createServiceRoleClient();
  const [{ data: sections }, { data: documents }, fw] = await Promise.all([
    supabase.from('policy_sections').select('*').eq('tenant_id', tenant.id)
      .order('display_order').order('created_at'),
    supabase.from('policy_documents').select('*').eq('tenant_id', tenant.id)
      .order('effective_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
    loadActiveFramework(tenant),
  ]);

  // Scores only matter if there's a framework — the Review panel uses them
  // to summarize "how does this policy contribute to your maturity?"
  let scoresByControl: Record<string, Partial<CurrentScore>> = {};
  if (fw) {
    const { data: scoreRows } = await supabase
      .from('current_scores')
      .select('control_id, pol, pra, gol')
      .eq('tenant_id', tenant.id)
      .eq('framework_version_id', fw.version.id);
    for (const r of (scoreRows ?? []) as Pick<CurrentScore, 'control_id' | 'pol' | 'pra' | 'gol'>[]) {
      scoresByControl[r.control_id] = r;
    }
  }

  return (
    <main className="app-main">
      <PolicyClient
        initialSections={sections ?? []}
        initialDocuments={(documents ?? []) as PolicyDocument[]}
        frameworkDefinition={fw?.definition ?? null}
        scoresByControl={scoresByControl}
      />
    </main>
  );
}
